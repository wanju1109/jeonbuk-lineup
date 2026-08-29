#!/usr/bin/env python3
"""Attach Pinnacle + Livescore overseas odds to proto/data/league.json.

Run from repo root:
  python proto/scripts/attach_overseas_odds.py

Requires network. Does not change model picks; only refreshes match.odds blocks.
For full pick regeneration, run regen_picks.py in the local proto workspace.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEAGUE = ROOT / "data" / "league.json"
WORKSPACE = Path(__file__).resolve().parents[3] / "proto"

if WORKSPACE.is_dir():
    sys.path.insert(0, str(WORKSPACE))
else:
    sys.path.insert(0, str(ROOT.parent))

try:
    import odds_merge as OM
except ImportError as exc:
    raise SystemExit(
        "odds_merge module not found. Run from local proto workspace with odds_*.py"
    ) from exc


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else LEAGUE
    data = json.loads(path.read_text(encoding="utf-8"))
    matches = data.get("matches") or []
    n = OM.attach_combined_odds(matches)
    data["matches"] = matches
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("attached odds to", n, "upcoming matches ->", path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
