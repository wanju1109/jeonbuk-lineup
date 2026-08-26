#!/usr/bin/env python3
"""Fold CHALK BOARD match JSON into one compact player-season file.

Reads c_report/data/{game_id}.json (Bepro11 extra events).
Writes player_report/data/events_{year}.json.
Does not store raw match files again.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
C_DATA = ROOT.parent / "c_report" / "data"
OUT_DIR = ROOT / "data"
YEAR = os.environ.get("KLEAGUE_YEAR") or str(datetime.now().year)

INT_KEYS = (
    "minutes",
    "passes",
    "pass_ok",
    "keypass",
    "shots",
    "sot",
    "goals",
    "dribble",
    "dribble_ok",
    "tackle",
    "tackle_ok",
    "int",
    "cut",
    "clg",
    "rcv",
    "aerial_w",
    "aerial_l",
    "ground_w",
    "ground_l",
    "fouls",
    "fouled",
    "press",
    "saves",
    "conceded",
    "touches",
)


def blank() -> dict:
    row = {k: 0 for k in INT_KEYS}
    row["xg"] = 0.0
    row["name"] = ""
    row["team_id"] = ""
    row["_games"] = set()
    return row


def is_goal_kick(e: dict) -> bool:
    return str(e.get("TYPE_CD") or "") == "GK" and not e.get("TYPE_DETAIL_CD")


def yn(v) -> bool:
    return str(v or "").upper() in ("Y", "T", "1", "TRUE")


def ensure(players: dict, pid: str) -> dict:
    row = players.get(pid)
    if row is None:
        row = blank()
        players[pid] = row
    return row


def add_lineup_row(players: dict, p: dict, gid: str) -> None:
    pid = str(p.get("player_id") or "").strip()
    if not pid:
        return
    row = ensure(players, pid)
    if p.get("name") and not row["name"]:
        row["name"] = str(p.get("name") or "")
    if p.get("team_id"):
        row["team_id"] = str(p.get("team_id") or "")
    mins = p.get("minutes")
    try:
        m = int(mins) if mins is not None and mins != "" else 0
    except (TypeError, ValueError):
        m = 0
    if m > 0 or p.get("starter"):
        row["_games"].add(gid)
        row["minutes"] += max(m, 0)


def add_event(players: dict, e: dict, gid: str) -> None:
    pid = str(e.get("PLAYER_ID") or "").strip()
    if not pid:
        return
    row = ensure(players, pid)
    row["_games"].add(gid)
    if e.get("TEAM_ID"):
        row["team_id"] = str(e.get("TEAM_ID") or row["team_id"])
    typ = str(e.get("TYPE_CD") or "")
    det = str(e.get("TYPE_DETAIL_CD") or "")
    if not is_goal_kick(e):
        row["touches"] += 1
    if typ == "PS":
        row["passes"] += 1
        if det == "PSS":
            row["pass_ok"] += 1
        if yn(e.get("KEYPASS_YN_CD")):
            row["keypass"] += 1
    if typ == "ST":
        row["shots"] += 1
        try:
            row["xg"] += float(e.get("EXPECTED_GOAL") or 0)
        except (TypeError, ValueError):
            pass
        if det == "GL":
            row["goals"] += 1
            row["sot"] += 1
        elif det == "AST":
            row["sot"] += 1
    if det == "DS":
        row["dribble"] += 1
        row["dribble_ok"] += 1
    elif det == "DU" and typ == "DU":
        row["dribble"] += 1
    if det == "TKS":
        row["tackle"] += 1
        row["tackle_ok"] += 1
    elif det == "TKU":
        row["tackle"] += 1
    if det == "INT":
        row["int"] += 1
    if det == "CUT":
        row["cut"] += 1
    if det == "CLG":
        row["clg"] += 1
    if det == "RCV":
        row["rcv"] += 1
    if det == "ADW":
        row["aerial_w"] += 1
    elif det == "ADL":
        row["aerial_l"] += 1
    if det == "GDW":
        row["ground_w"] += 1
    elif det == "GDL":
        row["ground_l"] += 1
    if det == "FOC":
        row["fouls"] += 1
    elif det == "FOW":
        row["fouled"] += 1
    if det in ("OPCS", "OPCU"):
        row["press"] += 1
    if det in ("CT", "PC"):
        row["saves"] += 1
    if det == "GC":
        row["conceded"] += 1


def ingest_match(path: Path, players: dict) -> str | None:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print("skip %s: %s" % (path.name, exc), flush=True)
        return None
    if not isinstance(data, dict) or not isinstance(data.get("events"), list):
        return None
    meta = data.get("meta") if isinstance(data.get("meta"), dict) else {}
    gid = str(meta.get("game_id") or path.stem)
    lineup = data.get("lineup") if isinstance(data.get("lineup"), dict) else {}
    for side in ("home", "away"):
        rows = lineup.get(side) or []
        if isinstance(rows, list):
            for p in rows:
                if isinstance(p, dict):
                    add_lineup_row(players, p, gid)
    for e in data.get("events") or []:
        if isinstance(e, dict):
            add_event(players, e, gid)
    return gid


def finalize(players: dict) -> dict:
    out = {}
    for pid, row in players.items():
        games = sorted(row.pop("_games"))
        rec = {
            "name": row.get("name") or "",
            "team_id": row.get("team_id") or "",
            "games": len(games),
        }
        for k in INT_KEYS:
            rec[k] = int(row.get(k) or 0)
        rec["xg"] = round(float(row.get("xg") or 0), 2)
        if rec["games"] <= 0 and rec["touches"] <= 0:
            continue
        out[pid] = rec
    return out


def main() -> int:
    if not C_DATA.is_dir():
        print("FAIL missing %s" % C_DATA, flush=True)
        return 1
    players: dict[str, dict] = {}
    games = []
    for path in sorted(C_DATA.glob("*.json"), key=lambda p: p.name):
        if not path.stem.isdigit():
            continue
        gid = ingest_match(path, players)
        if gid:
            games.append(gid)
            print("ok %s players=%d" % (path.name, len(players)), flush=True)
    folded = finalize(players)
    payload = {
        "year": YEAR,
        "source": "K LEAGUE PORTAL CHALK BOARD (Bepro11)",
        "note": "보도/커뮤니티 재가공용. 부가기록이며 공식 출장·골·도움과 다를 수 있다.",
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "games": len(games),
        "players_n": len(folded),
        "players": folded,
    }
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dest = OUT_DIR / ("events_%s.json" % YEAR)
    tmp = dest.with_suffix(".tmp")
    tmp.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    tmp.replace(dest)
    print(
        "wrote %s games=%d players=%d" % (dest, len(games), len(folded)),
        flush=True,
    )
    return 0 if folded else 1


if __name__ == "__main__":
    raise SystemExit(main())
