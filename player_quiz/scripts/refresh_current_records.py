"""Refresh official season rows for players already on the current squad index.

Does not rebuild the squad list. A failed detail page keeps the previous file.
"""
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "player_report/scripts"))
import collect_players as source  # noqa: E402

INDEX = ROOT / "player_report/data/index.json"
PLAYER_DIR = ROOT / "player_report/data/players"
KEEP = (
    "name",
    "name_en",
    "position",
    "back_no",
    "nation",
    "height",
    "weight",
    "birth",
    "age",
    "summary",
    "seasons",
    "teams",
)


def roster_ids(index: dict) -> list[str]:
    seen: set[str] = set()
    ids: list[str] = []
    for league in index.get("leagues") or []:
        for team in league.get("teams") or []:
            for card in team.get("players") or []:
                pid = str(card.get("id") or "")
                if not pid or pid in seen:
                    continue
                seen.add(pid)
                ids.append(pid)
    return ids


def main() -> int:
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    ids = roster_ids(index)
    ok = skipped = failed = 0
    for i, pid in enumerate(ids, 1):
        path = PLAYER_DIR / f"{pid}.json"
        try:
            html = source.fetch(f"{source.BASE}/record/playerDetail.do?playerId={pid}")
            detail = source.parse_detail(html, pid)
            if not detail.get("name") or not isinstance(detail.get("seasons"), list):
                raise ValueError("detail missing name or seasons")
            player = {}
            if path.is_file():
                player = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(player, dict):
                player = {}
            player["id"] = pid
            for key in KEEP:
                value = detail.get(key)
                if value not in (None, "", []):
                    player[key] = value
            player["fetched_at"] = datetime.now(timezone.utc).isoformat()
            player["source"] = player.get("source") or "K LEAGUE official playerDetail"
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(player, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
            ok += 1
        except Exception as exc:
            failed += 1
            print(f"FAIL {pid} {exc}", flush=True)
        if i == 1 or i % 40 == 0 or i == len(ids):
            print(f"progress {i}/{len(ids)} ok={ok} fail={failed}", flush=True)
        time.sleep(0.12)
    index["updated_at"] = datetime.now(timezone.utc).isoformat()
    INDEX.write_text(json.dumps(index, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"DONE ok={ok} skipped={skipped} fail={failed}", flush=True)
    return 1 if ok == 0 else 0


if __name__ == "__main__":
    raise SystemExit(main())
