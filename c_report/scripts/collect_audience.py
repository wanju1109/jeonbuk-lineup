#!/usr/bin/env python3
"""Collect official match attendance (total + away) from kleague.com record API.

Source: https://www.kleague.com/record/audience.do
  - type=game     → per-match audienceQty / awayAudienceQty
  - type=team     → home-club season totals
  - type=awayTeam → traveling away-fan season totals

Writes:
  - c_report/data/audience-games.json
  - c_report/data/club-attendance.json
  - patches meta.attendance / attendance_home / attendance_away on match JSON
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT / "c_report" / "data"
GAMES_PATH = DATA_DIR / "audience-games.json"
CLUB_PATH = DATA_DIR / "club-attendance.json"
META_JSON = {"index.json", "schedule.json", "club-attendance.json", "collected.json", "audience-games.json"}

YEAR = str(os.environ.get("KLEAGUE_YEAR") or datetime.now().year)
LEAGUE_ID = str(os.environ.get("KLEAGUE_LEAGUE_ID") or "1")
LIMIT = int(os.environ.get("KLEAGUE_AUD_LIMIT") or "100")

UA = {
    "User-Agent": "Mozilla/5.0 (compatible; jeonbuk-lineup/1.0)",
    "Accept": "application/json, text/javascript, */*; q=0.01",
    "X-Requested-With": "XMLHttpRequest",
    "Referer": "https://www.kleague.com/record/audience.do",
}


def club_name_key(name: str) -> str:
    raw = str(name or "")
    return (
        raw.replace("FC", "")
        .replace("fc", "")
        .replace("HD", "")
        .replace("상무", "")
        .replace(" ", "")
        .replace("()", "")
        .strip()
    )


def http_get_json(url: str) -> dict:
    req = urllib.request.Request(url, headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=45) as res:
            raw = res.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        body = ""
        try:
            body = exc.read().decode("utf-8", "replace")[:240]
        except Exception:
            body = ""
        raise RuntimeError(f"HTTP {exc.code} for {url}: {body}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"network error for {url}: {exc}") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON from {url}") from exc
    if not isinstance(data, dict):
        raise RuntimeError(f"unexpected payload type from {url}")
    if not isinstance(data.get("data"), dict):
        code = data.get("resultCode")
        msg = data.get("resultMsg") or ""
        raise RuntimeError(f"API error code={code} msg={msg}")
    return data


def fetch_audience_pages(typ: str, team_id: str = "all") -> list[dict]:
    rows: list[dict] = []
    page = 1
    total = None
    while page <= 40:
        qs = urllib.parse.urlencode(
            {
                "leagueId": LEAGUE_ID,
                "year": YEAR,
                "teamId": team_id,
                "type": typ,
                "page": str(page),
                "limit": str(LIMIT),
            }
        )
        url = f"https://www.kleague.com/record/audienceDetailList.do?{qs}"
        payload = http_get_json(url)
        block = payload.get("data") if isinstance(payload.get("data"), dict) else {}
        chunk = block.get("audienceResultList") or []
        if not isinstance(chunk, list):
            chunk = []
        try:
            total = int(block.get("totalCount") or 0)
        except (TypeError, ValueError):
            total = len(chunk)
        rows.extend([r for r in chunk if isinstance(r, dict)])
        print(f"[AUD] type={typ} page={page} +{len(chunk)} total={total}")
        if not chunk:
            break
        if total and len(rows) >= total:
            break
        page += 1
        time.sleep(0.25)
    return rows


def to_int(value) -> int | None:
    try:
        n = int(value)
    except (TypeError, ValueError):
        return None
    return n


def build_games_index(game_rows: list[dict]) -> dict:
    by_id: dict[str, dict] = {}
    for row in game_rows:
        gid = str(row.get("gameId") or "").strip()
        if not gid or gid == "0":
            continue
        total = to_int(row.get("audienceQty"))
        away = to_int(row.get("awayAudienceQty"))
        if total is None:
            continue
        if away is None:
            away = 0
        if away < 0:
            away = 0
        if away > total:
            # Keep totals authoritative if a bad away value appears.
            away = 0
        home = total - away
        by_id[gid] = {
            "game_id": gid,
            "year": str(row.get("year") or YEAR),
            "date": str(row.get("gameDate") or "").replace("/", "-"),
            "home": row.get("homeTeamName") or "",
            "away": row.get("awayTeamName") or "",
            "score": f"{row.get('homeGoal')}:{row.get('awayGoal')}",
            "venue": row.get("fieldNameFull") or "",
            "attendance": total,
            "attendance_home": home,
            "attendance_away": away,
            "weekday": row.get("weekDay") or "",
            "meet_seq": row.get("meetSeq"),
        }
    return by_id


def build_club_attendance(home_rows: list[dict], away_rows: list[dict]) -> dict:
    clubs: dict[str, dict] = {}
    for row in home_rows:
        name = str(row.get("homeTeamName") or "").strip()
        if not name:
            continue
        key = club_name_key(name)
        total = to_int(row.get("audienceQty")) or 0
        away_at_home = to_int(row.get("awayAudienceQty")) or 0
        games = to_int(row.get("gameCnt")) or 0
        avg = to_int(row.get("audienceQtyAvg"))
        if avg is None and games > 0:
            avg = round(total / games)
        home_fans = max(total - away_at_home, 0)
        home_fans_avg = round(home_fans / games) if games > 0 else None
        clubs[key] = {
            "name": name,
            "total": total,
            "away_at_home": away_at_home,
            "games": games,
            "avg": avg,
            "home_fans_avg": home_fans_avg,
        }

    for row in away_rows:
        name = str(row.get("awayTeamName") or "").strip()
        if not name:
            continue
        key = club_name_key(name)
        entry = clubs.get(key) or {"name": name}
        away_total = to_int(row.get("awayAudienceQty")) or 0
        away_games = to_int(row.get("gameCnt")) or 0
        away_avg = to_int(row.get("awayAudienceQtyAvg"))
        if away_avg is None and away_games > 0:
            away_avg = round(away_total / away_games)
        # stadium total when this club travels (optional context)
        stadium_total = to_int(row.get("audienceQty"))
        stadium_avg = to_int(row.get("audienceQtyAvg"))
        entry.update(
            {
                "away_fans_total": away_total,
                "away_games": away_games,
                "away_fans_avg": away_avg,
                "away_stadium_total": stadium_total,
                "away_stadium_avg": stadium_avg,
            }
        )
        clubs[key] = entry

    as_of = datetime.now().strftime("%Y-%m-%d")
    ordered = sorted(
        clubs.values(),
        key=lambda c: (-(c.get("avg") or 0), c.get("name") or ""),
    )
    return {
        "as_of": as_of,
        "year": YEAR,
        "league": "K리그1" if LEAGUE_ID == "1" else f"league {LEAGUE_ID}",
        "source": "kleague.com/record/audienceDetailList.do",
        "clubs": ordered,
    }


def iter_match_files() -> list[Path]:
    rows: list[Path] = []
    if not DATA_DIR.exists():
        return rows
    for path in DATA_DIR.glob("*.json"):
        if path.name in META_JSON:
            continue
        if path.stem.isdigit():
            rows.append(path)
    for sub in DATA_DIR.glob("*"):
        if not sub.is_dir():
            continue
        for path in sub.glob("*.json"):
            if path.stem.isdigit():
                rows.append(path)
    return rows


def patch_match_files(games: dict[str, dict]) -> int:
    updated = 0
    for path in iter_match_files():
        gid = path.stem
        row = games.get(gid)
        if not row:
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[WARN] skip {path.name}: {exc}")
            continue
        if not isinstance(data, dict):
            continue
        meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
        changed = False
        for key in ("attendance", "attendance_home", "attendance_away"):
            new_v = row.get(key)
            if new_v is None:
                continue
            if meta.get(key) != new_v:
                meta[key] = new_v
                changed = True
        if meta.get("attendance_source") != "kleague_record_audience":
            meta["attendance_source"] = "kleague_record_audience"
            changed = True
        if not changed:
            continue
        data["meta"] = meta
        try:
            path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:
            print(f"[WARN] write failed {path.name}: {exc}")
            continue
        updated += 1
    return updated


def patch_index(games: dict[str, dict]) -> None:
    index_path = DATA_DIR / "index.json"
    if not index_path.exists():
        return
    try:
        index = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[WARN] index.json: {exc}")
        return
    matches = index.get("matches")
    if not isinstance(matches, list):
        return
    changed = False
    for m in matches:
        if not isinstance(m, dict):
            continue
        row = games.get(str(m.get("game_id") or ""))
        if not row:
            continue
        for key in ("attendance", "attendance_home", "attendance_away"):
            if row.get(key) is None:
                continue
            if m.get(key) != row.get(key):
                m[key] = row.get(key)
                changed = True
    if changed:
        index["updated_at"] = datetime.now(timezone.utc).isoformat()
        index_path.write_text(
            json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print("[OK] patched index.json attendance fields")


def main() -> int:
    print(f"[INFO] audience collect year={YEAR} leagueId={LEAGUE_ID}")
    try:
        game_rows = fetch_audience_pages("game")
        home_rows = fetch_audience_pages("team")
        away_rows = fetch_audience_pages("awayTeam")
    except RuntimeError as exc:
        print(f"[ERR] {exc}")
        return 1

    games = build_games_index(game_rows)
    club = build_club_attendance(home_rows, away_rows)
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "year": YEAR,
        "league_id": LEAGUE_ID,
        "source": "kleague.com/record/audienceDetailList.do",
        "count": len(games),
        "games": games,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    GAMES_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    CLUB_PATH.write_text(json.dumps(club, ensure_ascii=False, indent=2), encoding="utf-8")
    n = patch_match_files(games)
    patch_index(games)
    sample = games.get("166")
    print(f"[DONE] games={len(games)} clubs={len(club.get('clubs') or [])} patched_matches={n}")
    if sample:
        print(
            f"[SAMPLE] 166 total={sample['attendance']} "
            f"home={sample['attendance_home']} away={sample['attendance_away']}"
        )
    return 0


if __name__ == "__main__":
    sys.exit(main())
