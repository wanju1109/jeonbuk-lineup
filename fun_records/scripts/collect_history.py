#!/usr/bin/env python3
"""Collect Jeonbuk K League 1 match history (2020–current) for fun records.

Writes:
  fun_records/data/history.json  — matches + goals (when chalkboard exists)
  fun_records/data/players.json  — slim nationality/position lookup

Env:
  FUN_YEAR_FROM  default 2020
  FUN_YEAR_TO    default current KST year
  FUN_FETCH_SCORES  default 1 — portal official scores for finished games
  FUN_FETCH_GOALS   default 0 — also fetch missing Jeonbuk chalkboards (slow)
  FUN_FORCE_SCORES  default 0 — re-fetch scores even if present
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
OUT = ROOT / "data"
C_DATA = REPO / "c_report" / "data"
C_SCRIPTS = REPO / "c_report" / "scripts"
PLAYER_DIR = REPO / "player_report" / "data" / "players"
KST = timezone(timedelta(hours=9))
JEONBUK = "전북"
LEGACY_FLAT_YEAR = "2026"
MEET_SEQ = "1"

# Known Jeonbuk foreign wide attackers (manual tags for trivia).
WINGER_HINTS = {
    "20260365": "이탈로",  # Italo
    "20230224": "모따",
    "20220244": "티아고",
    "20250061": "콤파뇨",
    "20190347": "일류첸코",
}


def now_kst() -> datetime:
    return datetime.now(KST)


def year_range() -> tuple[int, int]:
    y0 = int(os.environ.get("FUN_YEAR_FROM") or "2020")
    y1 = int(os.environ.get("FUN_YEAR_TO") or str(now_kst().year))
    return y0, y1


def load_portal():
    if str(C_SCRIPTS) not in sys.path:
        sys.path.insert(0, str(C_SCRIPTS))
    from collect_chalkboard import (  # noqa: WPS433
        MAIN_FRAME,
        PortalClient,
        extract_js_array,
        fetch_chalkboard,
        fetch_matches,
        fetch_rounds,
        parse_official_score,
        build_payload,
        match_json_path,
    )

    return {
        "PortalClient": PortalClient,
        "MAIN_FRAME": MAIN_FRAME,
        "extract_js_array": extract_js_array,
        "fetch_chalkboard": fetch_chalkboard,
        "fetch_matches": fetch_matches,
        "fetch_rounds": fetch_rounds,
        "parse_official_score": parse_official_score,
        "build_payload": build_payload,
        "match_json_path": match_json_path,
    }


def chalk_path(year: str, gid: str) -> Path:
    if str(year) == LEGACY_FLAT_YEAR:
        return C_DATA / f"{gid}.json"
    return C_DATA / str(year) / f"{gid}.json"


def parse_date(year: str, date_md: str) -> str:
    md = (date_md or "").replace(".", "/").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})$", md)
    if not m:
        return ""
    try:
        return f"{int(year)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    except ValueError:
        return ""


def is_korean(nation: str) -> bool:
    n = (nation or "").strip()
    return n in ("", "한국", "대한민국", "Korea", "South Korea", "KOR")


def load_player_lookup() -> dict[str, dict]:
    out: dict[str, dict] = {}
    if not PLAYER_DIR.is_dir():
        return out
    for path in PLAYER_DIR.glob("*.json"):
        try:
            d = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        pid = str(d.get("id") or path.stem)
        nation = str(d.get("nation") or "")
        pos = str(d.get("position") or "")
        name = str(d.get("name") or "")
        out[pid] = {
            "id": pid,
            "name": name,
            "nation": nation,
            "position": pos,
            "foreign": not is_korean(nation),
            "winger_hint": pid in WINGER_HINTS or name in WINGER_HINTS.values(),
        }
    return out


def extract_goals_from_match(data: dict, players: dict[str, dict]) -> list[dict]:
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    home = meta.get("home") or {}
    away = meta.get("away") or {}
    home_id = str(home.get("team_id") or "")
    away_id = str(away.get("team_id") or "")
    jb_id = ""
    if JEONBUK in str(home.get("name") or ""):
        jb_id = home_id
    elif JEONBUK in str(away.get("name") or ""):
        jb_id = away_id
    if not jb_id:
        return []

    name_map = {}
    pos_map = {}
    for side in ("home", "away"):
        for pl in ((data.get("lineup") or {}).get(side) or []):
            if not isinstance(pl, dict):
                continue
            pid = str(pl.get("player_id") or "")
            if pid:
                name_map[pid] = str(pl.get("name") or name_map.get(pid) or "")
                pos_map[pid] = str(pl.get("position") or pos_map.get(pid) or "")
    for pl in data.get("players") or []:
        if not isinstance(pl, dict):
            continue
        pid = str(pl.get("player_id") or "")
        if not pid:
            continue
        if pl.get("NAME") and not name_map.get(pid):
            name_map[pid] = str(pl.get("NAME"))
        if pl.get("Position_Name") and not pos_map.get(pid):
            pos_map[pid] = str(pl.get("Position_Name"))

    goals = []
    for e in data.get("events") or []:
        if not isinstance(e, dict):
            continue
        if e.get("TYPE_DETAIL_CD") != "GL":
            continue
        if str(e.get("TEAM_ID") or "") != jb_id:
            continue
        pid = str(e.get("PLAYER_ID") or "")
        info = players.get(pid) or {}
        name = info.get("name") or name_map.get(pid) or "?"
        pos = info.get("position") or pos_map.get(pid) or ""
        # Wing heuristic from shot/start Y (0–100). Extreme Y ≈ wide.
        try:
            y = float(e.get("START_POINT_Y") or 50)
        except (TypeError, ValueError):
            y = 50.0
        wide = y <= 28 or y >= 72
        foreign = bool(info.get("foreign"))
        winger = bool(info.get("winger_hint")) or (pos in ("FW", "MF") and wide and foreign)
        goals.append(
            {
                "player_id": pid,
                "name": name,
                "nation": info.get("nation") or "",
                "position": pos,
                "foreign": foreign,
                "winger": winger,
                "period": e.get("PERIOD_ID"),
                "minute": e.get("TIME_MINUTE") or e.get("EVENT_TIME") or e.get("MINUTE"),
            }
        )
    return goals


def result_for(ha: str, hs: int, aws: int) -> str:
    if ha == "H":
        if hs > aws:
            return "W"
        if hs < aws:
            return "L"
        return "D"
    if aws > hs:
        return "W"
    if aws < hs:
        return "L"
    return "D"


def load_existing_history() -> dict:
    path = OUT / "history.json"
    if not path.exists():
        return {"matches": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
    except (OSError, json.JSONDecodeError):
        pass
    return {"matches": []}


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    y0, y1 = year_range()
    fetch_scores = os.environ.get("FUN_FETCH_SCORES", "1").lower() not in ("0", "false", "no")
    fetch_goals = os.environ.get("FUN_FETCH_GOALS", "0").lower() in ("1", "true", "yes")
    force_scores = os.environ.get("FUN_FORCE_SCORES", "0").lower() in ("1", "true", "yes")

    players = load_player_lookup()
    (OUT / "players.json").write_text(
        json.dumps(players, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[INFO] players={len(players)} years={y0}..{y1}")

    existing = load_existing_history()
    by_key = {
        f"{m.get('year')}|{m.get('game_id')}": m
        for m in (existing.get("matches") or [])
        if isinstance(m, dict) and m.get("game_id")
    }

    portal = None
    client = None
    if fetch_scores or fetch_goals:
        try:
            portal = load_portal()
            client = portal["PortalClient"]()
            client.login_guest()
            print("[INFO] portal guest login ok")
        except Exception as exc:
            print(f"[WARN] portal unavailable: {exc}")
            portal = None
            client = None

    for year in range(y0, y1 + 1):
        ys = str(year)
        rounds: list[str] = []
        if client and portal:
            try:
                rounds = [str(r) for r in portal["fetch_rounds"](client, ys, MEET_SEQ)]
            except Exception as exc:
                print(f"[WARN] {ys} rounds failed: {exc}")
                rounds = []
        if not rounds:
            # Fall back to local chalkboards / index for that year.
            if ys == LEGACY_FLAT_YEAR:
                idx = C_DATA / "index.json"
                if idx.exists():
                    try:
                        data = json.loads(idx.read_text(encoding="utf-8"))
                        for m in data.get("matches") or []:
                            if JEONBUK not in f"{m.get('home')}{m.get('away')}":
                                continue
                            gid = str(m.get("game_id") or "")
                            key = f"{ys}|{gid}"
                            row = by_key.get(key) or {
                                "year": ys,
                                "game_id": gid,
                                "round": m.get("round"),
                                "home": m.get("home"),
                                "away": m.get("away"),
                                "date": m.get("date") or "",
                                "venue": m.get("venue") or "",
                            }
                            score = str(m.get("score") or "")
                            if ":" in score:
                                try:
                                    hs, aws = [int(x) for x in score.split(":")]
                                    row["score"] = [hs, aws]
                                    row["hs"] = hs
                                    row["as"] = aws
                                except ValueError:
                                    pass
                            by_key[key] = row
                    except (OSError, json.JSONDecodeError):
                        pass
            print(f"[INFO] year={ys} local/index fallback rows")
            continue

        print(f"[INFO] year={ys} rounds={len(rounds)}")
        for rid in rounds:
            try:
                rows = portal["fetch_matches"](client, ys, MEET_SEQ, rid)
            except Exception as exc:
                print(f"[WARN] {ys} R{rid} list failed: {exc}")
                continue
            time.sleep(0.05)
            for match in rows:
                home = match.get("home") or ""
                away = match.get("away") or ""
                if JEONBUK not in f"{home}{away}":
                    continue
                gid = str(match.get("game_id") or "")
                if not gid:
                    continue
                key = f"{ys}|{gid}"
                row = by_key.get(key) or {
                    "year": ys,
                    "game_id": gid,
                    "round": int(rid) if str(rid).isdigit() else rid,
                    "home": home,
                    "away": away,
                }
                row["year"] = ys
                row["game_id"] = gid
                row["round"] = int(rid) if str(rid).isdigit() else rid
                row["home"] = home
                row["away"] = away
                row["date_md"] = match.get("date_md") or row.get("date_md") or ""
                row["date"] = parse_date(ys, row["date_md"]) or row.get("date") or ""
                row["end_yn"] = str(match.get("end_yn") or row.get("end_yn") or "N").upper()
                row["ha"] = "H" if JEONBUK in home else "A"
                row["opponent"] = away if row["ha"] == "H" else home

                need_score = force_scores or row.get("hs") is None or row.get("as") is None
                if (
                    fetch_scores
                    and client
                    and portal
                    and row.get("end_yn") == "Y"
                    and need_score
                ):
                    try:
                        html = client.request(
                            portal["MAIN_FRAME"],
                            data={
                                "meetYear": ys,
                                "meetSeq": MEET_SEQ,
                                "roundId": str(rid),
                                "gameId": gid,
                                "selectedMenuCd": "0302",
                            },
                        )
                        official = portal["parse_official_score"](html)
                        if official:
                            hs, aws = official
                            row["hs"] = hs
                            row["as"] = aws
                            row["score"] = [hs, aws]
                            row["score_source"] = "official"
                            print(f"[OK] {ys} R{rid} {home} {hs}:{aws} {away}")
                        time.sleep(0.08)
                    except Exception as exc:
                        print(f"[WARN] score {ys}/{gid}: {exc}")

                if row.get("hs") is not None and row.get("as") is not None:
                    row["result"] = result_for(row["ha"], int(row["hs"]), int(row["as"]))
                    row["gf"] = int(row["hs"]) if row["ha"] == "H" else int(row["as"])
                    row["ga"] = int(row["as"]) if row["ha"] == "H" else int(row["hs"])

                # Goals from local chalkboard, optionally fetch.
                path = chalk_path(ys, gid)
                if fetch_goals and client and portal and not path.exists() and row.get("end_yn") == "Y":
                    try:
                        print(f"[FETCH chalk] {ys} {gid}")
                        packed = portal["fetch_chalkboard"](
                            client, ys, MEET_SEQ, str(rid), gid
                        )
                        payload = portal["build_payload"](
                            ys,
                            MEET_SEQ,
                            rid,
                            match,
                            packed["events"],
                            packed["players"],
                            packed["html"],
                            packed.get("lineup"),
                            packed.get("pass_matrix"),
                        )
                        path.parent.mkdir(parents=True, exist_ok=True)
                        path.write_text(
                            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
                        )
                        time.sleep(0.15)
                    except Exception as exc:
                        print(f"[WARN] chalk {ys}/{gid}: {exc}")

                if path.exists():
                    try:
                        data = json.loads(path.read_text(encoding="utf-8"))
                        meta = data.get("meta") or {}
                        if meta.get("venue"):
                            row["venue"] = meta.get("venue")
                        if meta.get("attendance") not in (None, ""):
                            row["attendance"] = meta.get("attendance")
                        if row.get("hs") is None and isinstance(meta.get("score"), dict):
                            row["hs"] = meta["score"].get("home")
                            row["as"] = meta["score"].get("away")
                            row["score"] = [row["hs"], row["as"]]
                            if row["hs"] is not None and row["as"] is not None:
                                row["result"] = result_for(
                                    row["ha"], int(row["hs"]), int(row["as"])
                                )
                                row["gf"] = (
                                    int(row["hs"]) if row["ha"] == "H" else int(row["as"])
                                )
                                row["ga"] = (
                                    int(row["as"]) if row["ha"] == "H" else int(row["hs"])
                                )
                        row["goals"] = extract_goals_from_match(data, players)
                        row["goals_source"] = "chalkboard"
                    except (OSError, json.JSONDecodeError) as exc:
                        print(f"[WARN] read chalk {path}: {exc}")

                by_key[key] = row

    matches = list(by_key.values())
    matches.sort(key=lambda m: (str(m.get("date") or ""), int(m.get("round") or 0)))
    finished = [m for m in matches if m.get("result") in ("W", "D", "L")]
    payload = {
        "team": JEONBUK,
        "competition": "하나은행 K리그1",
        "from_year": y0,
        "to_year": y1,
        "updated_at": now_kst().isoformat(),
        "matches_n": len(matches),
        "finished_n": len(finished),
        "matches": matches,
        "note": "전북 K리그1 기준. 골 상세는 가용 칠판 데이터가 있는 경기만 포함.",
    }
    dest = OUT / "history.json"
    dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[DONE] wrote {dest} matches={len(matches)} finished={len(finished)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
