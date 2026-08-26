#!/usr/bin/env python3
"""Rebuild player_report/data/index.json from the Data Portal player list."""

from __future__ import annotations

import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PLAYER_DIR = DATA / "players"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect_players import (  # noqa: E402
    PORTAL,
    SLEEP,
    YEAR,
    enrich_player,
    index_entry,
    played_this_year,
    portal_player_list,
    write_json,
)


def main() -> int:
    idx_path = DATA / "index.json"
    index = json.loads(idx_path.read_text(encoding="utf-8"))
    roster = portal_player_list()
    if not roster:
        print("FAIL portal player list empty", flush=True)
        return 1

    dropped: list[tuple[str, str, str]] = []
    added: list[tuple[str, str, str]] = []
    errors: list[str] = []

    for lg in index.get("leagues") or []:
        for team in lg.get("teams") or []:
            tid = str(team.get("id") or "").upper()
            club = {
                "id": tid,
                "name": team.get("name"),
                "full": team.get("full") or team.get("name"),
                "home": team.get("home") or "",
                "league_id": lg.get("id"),
                "league_name": lg.get("name"),
            }
            cards = roster.get(tid) or []
            old = {str(p.get("id")): p for p in (team.get("players") or [])}
            new_ids = {str(c.get("id")) for c in cards}
            for pid, row in old.items():
                if pid not in new_ids:
                    dropped.append((tid, pid, str(row.get("name") or "")))
            players_idx = []
            for card in cards:
                pid = str(card.get("id") or "")
                path = PLAYER_DIR / f"{pid}.json"
                try:
                    if path.is_file():
                        full = json.loads(path.read_text(encoding="utf-8"))
                        if card.get("back_no") is not None:
                            full["back_no"] = card["back_no"]
                        if card.get("position"):
                            full["position"] = card["position"]
                        if card.get("name") and not full.get("name"):
                            full["name"] = card["name"]
                    else:
                        full = enrich_player(card, club)
                        time.sleep(SLEEP)
                    if not played_this_year(full):
                        dropped.append(
                            (
                                tid,
                                pid,
                                str(full.get("name") or card.get("name") or ""),
                            )
                        )
                        continue
                    players_idx.append(index_entry(full))
                    if pid not in old:
                        added.append((tid, pid, str(full.get("name") or card.get("name") or "")))
                except Exception as exc:
                    msg = f"{tid} {pid} {card.get('name')}: {exc}"
                    errors.append(msg)
                    print("  FAIL", msg, flush=True)
                    players_idx.append(
                        {
                            "id": pid,
                            "name": card.get("name"),
                            "back_no": card.get("back_no"),
                            "position": card.get("position"),
                            "photo": "",
                            "photo_fallback": (
                                f"{PORTAL}/common/playerPhotoById.do?playerId={pid}"
                                f"&recYn=Y&searchYear={YEAR}"
                            ),
                        }
                    )
            team["players"] = players_idx
            print(f"{tid} {team.get('name')} {len(players_idx)}", flush=True)

    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    index["year"] = YEAR
    index["note"] = (
        "보도/커뮤니티 재가공용. 현재 명단은 데이터포털 선수목록 중 올해 공식 출장 1경기 이상. 기록은 K리그 선수 상세."
    )
    if errors:
        index["errors"] = errors[:50]
    else:
        index.pop("errors", None)
    write_json(idx_path, index)
    print(f"drop {len(dropped)} add {len(added)} errors {len(errors)}", flush=True)
    for row in dropped:
        print("  DROP", row[0], row[1], row[2], flush=True)
    for row in added:
        print("  ADD", row[0], row[1], row[2], flush=True)
    return 0 if not errors else 1


if __name__ == "__main__":
    raise SystemExit(main())
