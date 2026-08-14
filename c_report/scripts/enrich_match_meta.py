#!/usr/bin/env python3
"""Backfill match meta + lineup (0301) into existing JSON and index.json."""

from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from collect_chalkboard import (  # noqa: E402
    DATA_DIR,
    INDEX_PATH,
    MAIN_FRAME,
    MEET_SEQ,
    PortalClient,
    YEAR,
    extract_js_array,
    parse_lineup_chart,
    parse_match_frame_meta,
    save_index,
)


def main() -> None:
    if not INDEX_PATH.exists():
        raise SystemExit(f"missing index: {INDEX_PATH}")

    index = json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    matches = index.get("matches") or []
    if not matches:
        raise SystemExit("no matches in index.json")

    only = os.environ.get("KLEAGUE_GAME_ID")
    client = PortalClient()
    print("[INFO] guest login")
    client.login_guest()

    updated = 0
    out_rows = []
    for row in matches:
        gid = str(row.get("game_id") or "")
        if only and gid != str(only):
            out_rows.append(row)
            continue
        year = str(row.get("year") or YEAR)
        round_id = str(row.get("round") or "")
        file_rel = row.get("file") or f"./data/{gid}.json"
        path = (ROOT / file_rel.replace("./", "")).resolve()
        if not path.exists():
            print(f"[WARN] missing file game={gid}")
            out_rows.append(row)
            continue

        try:
            chalk_html = client.request(
                MAIN_FRAME,
                data={
                    "meetYear": year,
                    "meetSeq": str(MEET_SEQ),
                    "roundId": round_id,
                    "gameId": gid,
                    "selectedMenuCd": "0302",
                },
            )
            frame = parse_match_frame_meta(chalk_html)

            lineup = {"home": [], "away": [], "subs": []}
            try:
                lineup_html = client.request(
                    MAIN_FRAME,
                    data={
                        "meetYear": year,
                        "meetSeq": str(MEET_SEQ),
                        "roundId": round_id,
                        "gameId": gid,
                        "selectedMenuCd": "0301",
                    },
                )
                chart = extract_js_array(lineup_html, "chartDataSet")
                lineup = parse_lineup_chart(chart)
            except Exception as exc:
                print(f"[WARN] lineup game={gid}: {exc}")

            data = json.loads(path.read_text(encoding="utf-8"))
            meta = data.setdefault("meta", {})

            weather_disp = frame.get("weather") or ""
            if frame.get("temperature_c") is not None:
                weather_disp = f"{weather_disp} {frame['temperature_c']:g}℃".strip()

            if frame.get("date"):
                meta["date"] = frame["date"]
            meta["kickoff"] = frame.get("kickoff") or meta.get("kickoff") or ""
            meta["venue"] = frame.get("venue") or meta.get("venue") or ""
            meta["attendance"] = frame.get("attendance")
            meta["weather"] = weather_disp
            meta["temperature_c"] = frame.get("temperature_c")
            meta["humidity"] = frame.get("humidity")
            meta["referee"] = frame.get("referee") or ""
            meta["officials"] = frame.get("officials") or {}
            meta["fetched_at"] = datetime.now(timezone.utc).isoformat()

            home = meta.setdefault("home", {})
            away = meta.setdefault("away", {})
            if frame.get("home_manager"):
                home["manager"] = frame["home_manager"]
            if frame.get("away_manager"):
                away["manager"] = frame["away_manager"]

            data["lineup"] = lineup
            path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

            row = dict(row)
            row["venue"] = meta.get("venue") or ""
            row["attendance"] = meta.get("attendance")
            row["date"] = meta.get("date") or row.get("date") or ""
            out_rows.append(row)
            updated += 1
            print(
                f"[OK] {gid} R{round_id} att={meta.get('attendance')} "
                f"lineup={len(lineup.get('home') or [])}/{len(lineup.get('away') or [])} "
                f"subs={len(lineup.get('subs') or [])}"
            )
            time.sleep(0.35)
        except Exception as exc:
            print(f"[ERR] game={gid}: {exc}")
            out_rows.append(row)

    if only:
        # merge updated row into full list
        by_id = {str(m.get("game_id")): m for m in matches}
        for r in out_rows:
            if str(r.get("game_id")) == str(only):
                by_id[str(only)] = r
        save_index(list(by_id.values()))
    else:
        save_index(out_rows)
    print(f"[DONE] updated={updated}")


if __name__ == "__main__":
    main()
