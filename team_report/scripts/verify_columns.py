#!/usr/bin/env python3
"""Headless check of js/column.js against every dossier, using a real JS engine.

Development-only helper; the nightly workflow does not run it.

    python -m pip install py-mini-racer
    python team_report/scripts/verify_columns.py            # check all 29 clubs
    python team_report/scripts/verify_columns.py K05 K22    # also dump two columns

Full columns are written to scripts/columns.out.txt in UTF-8, because the
Windows console mangles Korean when stdout is redirected.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from py_mini_racer import py_mini_racer

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
TEAM_XOR = 0x3B7D
BAD_TOKENS = ("undefined", "NaN", "null", "[object Object]")


def encode_team_ref(team_id: str) -> str:
    m = re.fullmatch(r"K(\d{1,2})", team_id.strip(), re.IGNORECASE)
    if not m:
        return ""
    n = int(m.group(1))
    if n <= 0:
        return ""
    value = n ^ TEAM_XOR
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    out = ""
    while value:
        out = digits[value % 36] + out
        value //= 36
    return out or "0"


def decode_team_ref(ref: str) -> str:
    raw = ref.strip().lower()
    if not raw or not re.fullmatch(r"[0-9a-z]+", raw):
        return ""
    n = int(raw, 36) ^ TEAM_XOR
    if n <= 0 or n > 99:
        return ""
    return f"K{n:02d}"


def check_syntax(ctx: py_mini_racer.MiniRacer, name: str) -> bool:
    """Parse a browser script without running it, to catch syntax errors."""
    source = (ROOT / "js" / name).read_text(encoding="utf-8")
    try:
        ctx.call("(function (src) { new Function(src); return true; })", source)
    except Exception as err:  # noqa: BLE001 - any parse failure is a failure
        print(f"FAIL: {name} does not parse: {err}")
        return False
    return True


def main() -> int:
    ctx = py_mini_racer.MiniRacer()
    ctx.eval("var window = {};")
    if not check_syntax(ctx, "app.js"):
        return 1
    ctx.eval((ROOT / "js" / "column.js").read_text(encoding="utf-8"))

    index = json.loads((DATA / "index.json").read_text(encoding="utf-8"))
    failures = 0
    checked = 0
    rows: list[tuple] = []

    for league in index["leagues"]:
        table_js = json.dumps(league["table"], ensure_ascii=False)
        for row in league["table"]:
            tid = row["team_id"]
            path = DATA / "teams" / f"{tid}.json"
            if not path.exists():
                print(f"FAIL: missing dossier {tid}")
                failures += 1
                continue

            ref = encode_team_ref(tid)
            if decode_team_ref(ref) != tid:
                print(f"FAIL: url round-trip {tid} -> {ref} -> {decode_team_ref(ref)}")
                failures += 1

            team_js = path.read_text(encoding="utf-8")
            try:
                column = ctx.call("window.TeamColumn.build", json.loads(team_js), json.loads(table_js))
            except Exception as err:  # noqa: BLE001 - report any engine failure
                print(f"FAIL: {tid} threw {err}")
                failures += 1
                continue

            if not column or not column.get("headline") or not column.get("sections"):
                print(f"FAIL: {tid} produced an empty column")
                failures += 1
                continue

            blob = column["headline"] + "\n"
            for section in column["sections"]:
                if not section.get("title") or not section.get("paragraphs"):
                    print(f"FAIL: {tid} section '{section.get('id')}' is empty")
                    failures += 1
                blob += "\n".join(section["paragraphs"]) + "\n"

            for token in BAD_TOKENS:
                if token in blob:
                    print(f"FAIL: {tid} column contains '{token}'")
                    failures += 1
                    break

            checked += 1
            rows.append((league["id"], tid, row["name"], ref, len(column["sections"]), len(blob), column["headline"]))

    print(f"checked={checked} failures={failures}\n")
    for lg, tid, name, ref, sections, length, headline in rows:
        print(f"{lg} {tid} {name:<6} ref={ref:<4} 섹션 {sections:>2} · {length:>5}자 · {headline}")

    if len(sys.argv) > 1:
        lines: list[str] = []
        for tid in sys.argv[1:]:
            path = DATA / "teams" / f"{tid}.json"
            if not path.exists():
                print(f"[WARN] no dossier for {tid}")
                continue
            team = json.loads(path.read_text(encoding="utf-8"))
            league = next(l for l in index["leagues"] if l["id"] == team["league"])
            column = ctx.call("window.TeamColumn.build", team, league["table"])
            lines.append("=" * 78)
            lines.append(column["headline"])
            lines.append(column["standfirst"])
            for section in column["sections"]:
                lines.append("")
                lines.append(f"[{section['title']}]")
                lines.extend("  " + para for para in section["paragraphs"])
            lines.append("")
        out = ROOT / "scripts" / "columns.out.txt"
        out.write_text("\n".join(lines), encoding="utf-8")
        print(f"wrote {out}")

    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
