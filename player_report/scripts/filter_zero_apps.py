#!/usr/bin/env python3
"""Drop players with 0 official appearances this year from index.json."""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
PLAYER_DIR = DATA / "players"
sys.path.insert(0, str(Path(__file__).resolve().parent))

from collect_players import YEAR, write_json, year_apps  # noqa: E402


def main() -> int:
    idx_path = DATA / "index.json"
    index = json.loads(idx_path.read_text(encoding="utf-8"))
    log_path = Path(__file__).with_name("_drop_zero_apps.txt")
    lines = []
    dropped = 0
    kept = 0
    for lg in index.get("leagues") or []:
        for team in lg.get("teams") or []:
            kept_rows = []
            for entry in team.get("players") or []:
                pid = str(entry.get("id") or "")
                path = PLAYER_DIR / f"{pid}.json"
                apps = 0
                name = str(entry.get("name") or "")
                if path.is_file():
                    try:
                        full = json.loads(path.read_text(encoding="utf-8"))
                        apps = year_apps(full)
                        name = str(full.get("name") or name)
                    except (OSError, json.JSONDecodeError):
                        apps = 0
                if apps <= 0:
                    dropped += 1
                    lines.append(
                        "DROP %s %s %s apps=%s"
                        % (team.get("id"), pid, name, apps)
                    )
                    continue
                kept += 1
                kept_rows.append(entry)
            team["players"] = kept_rows
            lines.append(
                "TEAM %s %s kept=%d"
                % (team.get("id"), team.get("name"), len(kept_rows))
            )
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    index["year"] = YEAR
    index["note"] = (
        "보도/커뮤니티 재가공용. 현재 명단은 데이터포털 선수목록 중 올해 공식 출장 1경기 이상. 기록은 K리그 선수 상세."
    )
    write_json(idx_path, index)
    lines.append("done dropped=%d kept=%d" % (dropped, kept))
    log_path.write_text("\n".join(lines), encoding="utf-8")
    print("dropped", dropped, "kept", kept, "log", log_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
