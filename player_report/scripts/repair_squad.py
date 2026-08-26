#!/usr/bin/env python3
"""
Fix 2026 squad lists and photo URLs in place.

- Jeonbuk: drop ended loans that K League still lists (not on club API,
  not Korean academy).
- Photos: keep the first URL that actually returns an image. Prefer club
  CDN, then K League CloudFront for 2026..2023, then portal if it is not empty.
"""
from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PLAYER_DIR = DATA / "players"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect_players import (  # noqa: E402
    CF,
    PORTAL,
    YEAR,
    club_photo_file_id,
    index_entry,
    jbfc_roster,
    keep_on_current_squad,
    valid_kleague_photo,
    write_json,
)

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)
MIN_BYTES = 800


def live_image(url: str) -> bool:
    u = (url or "").strip()
    if not u or not u.startswith("http"):
        return False
    if not valid_kleague_photo(u) and "d2tfp74nsbbrkr.cloudfront.net" in u:
        return False
    req = urllib.request.Request(u, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            length = int(resp.headers.get("Content-Length") or 0)
            chunk = resp.read(32)
            size = length or len(chunk)
            if resp.status != 200 or size < MIN_BYTES:
                return False
            if "image" in ctype or "octet-stream" in ctype or ctype == "":
                return True
            return False
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, OSError, ValueError):
        return False


def photo_candidates(team_id: str, player_id: str, name: str, photos: dict) -> list[str]:
    out: list[str] = []
    file_id = club_photo_file_id(team_id, player_id, name)
    if team_id == "K05":
        out.append(
            f"https://jbhd-upload-file.s3.ap-northeast-2.amazonaws.com/images/player/{YEAR}/{file_id}.png"
        )
        if file_id != player_id:
            out.append(
                f"https://jbhd-upload-file.s3.ap-northeast-2.amazonaws.com/images/player/{YEAR}/{player_id}.png"
            )
    for key in ("club", "kleague"):
        u = valid_kleague_photo((photos or {}).get(key) or "") or (photos or {}).get(key) or ""
        if u:
            out.append(u)
    for year in (YEAR, "2025", "2024", "2023"):
        out.append(f"{CF}/{year}/{team_id}/player_{player_id}.png")
    out.append(f"https://d2tfp74nsbbrkr.cloudfront.net/v1/player/player_{player_id}.png")
    out.append(
        f"{PORTAL}/common/playerPhotoById.do?playerId={player_id}&recYn=Y&searchYear={YEAR}"
    )
    seen = set()
    uniq = []
    for url in out:
        if not url or url in seen:
            continue
        seen.add(url)
        uniq.append(url)
    return uniq


def first_live(urls: list[str]) -> str:
    for url in urls:
        if live_image(url):
            return url
    return ""


def repair_player(path: Path, team_id: str) -> dict | None:
    try:
        player = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    pid = str(player.get("id") or path.stem)
    name = str(player.get("name") or "")
    photos = player.get("photos") or {}
    urls = photo_candidates(team_id, pid, name, photos)
    live = first_live(urls)
    club = ""
    kleague = ""
    portal = ""
    if live:
        if "jbhd-upload-file" in live:
            club = live
        elif "d2tfp74nsbbrkr" in live:
            kleague = live
        elif "portal.kleague.com" in live:
            portal = live
        else:
            kleague = live
        # Keep a second working source when the first is club CDN.
        if club:
            rest = [u for u in urls if u != club]
            kleague = first_live(rest) or kleague
    player["photos"] = {
        "club": club,
        "kleague": kleague,
        "portal": portal,
        "club_page": photos.get("club_page") or "",
    }
    write_json(path, player)
    return player


def needs_photo_work(entry: dict) -> bool:
    photo = entry.get("photo") or ""
    fb = entry.get("photo_fallback") or ""
    if not photo:
        return True
    if photo.rstrip("/") == "https://d2tfp74nsbbrkr.cloudfront.net":
        return True
    if "jbhd-upload-file" in photo:
        return True
    if "portal.kleague.com" in photo and not valid_kleague_photo(fb):
        return True
    return False


def main() -> int:
    idx_path = DATA / "index.json"
    index = json.loads(idx_path.read_text(encoding="utf-8"))
    jbfc_roster()
    dropped = []
    photo_jobs = []

    for lg in index.get("leagues") or []:
        for team in lg.get("teams") or []:
            club = {"id": team.get("id"), "name": team.get("name")}
            kept = []
            for entry in team.get("players") or []:
                path = PLAYER_DIR / f"{entry['id']}.json"
                full = None
                if path.is_file():
                    try:
                        full = json.loads(path.read_text(encoding="utf-8"))
                    except (OSError, json.JSONDecodeError):
                        full = None
                probe = full or {
                    "id": entry.get("id"),
                    "name": entry.get("name"),
                    "nation": "",
                }
                if not keep_on_current_squad(club, probe):
                    dropped.append((team.get("id"), entry.get("id"), entry.get("name")))
                    continue
                kept.append(entry)
                if needs_photo_work(entry) or (
                    full and not valid_kleague_photo((full.get("photos") or {}).get("kleague") or "")
                    and not (full.get("photos") or {}).get("club")
                ):
                    photo_jobs.append((path, team.get("id") or "", entry))
            team["players"] = kept

    print(f"drop {len(dropped)} stale", flush=True)
    for row in dropped:
        print("  DROP", row[0], row[1], row[2], flush=True)
    print(f"photo jobs {len(photo_jobs)}", flush=True)

    updated = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futs = {pool.submit(repair_player, path, tid): entry for path, tid, entry in photo_jobs}
        done = 0
        for fut in as_completed(futs):
            entry = futs[fut]
            done += 1
            try:
                player = fut.result()
            except Exception as exc:
                print("  PHOTO FAIL", entry.get("id"), exc, flush=True)
                continue
            if player:
                updated[str(player.get("id"))] = player
            if done % 20 == 0:
                print(f"  photos {done}/{len(photo_jobs)}", flush=True)

    for lg in index.get("leagues") or []:
        for team in lg.get("teams") or []:
            new_rows = []
            for entry in team.get("players") or []:
                full = updated.get(str(entry.get("id")))
                if full:
                    new_rows.append(index_entry(full))
                else:
                    new_rows.append(entry)
            team["players"] = new_rows

    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    index["note"] = (
        "보도/커뮤니티 재가공용. 기록은 K리그 공식 선수 상세. "
        "전북 현재 명단은 구단 프로팀+국내 등록 선수, 사진은 실제로 열리는 파일만."
    )
    write_json(idx_path, index)
    print(f"done dropped={len(dropped)} photos_fixed={len(updated)}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
