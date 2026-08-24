#!/usr/bin/env python3
import json
from datetime import datetime, timezone
from pathlib import Path

data_dir = Path(__file__).resolve().parents[1] / "data"
index = {"matches": [], "updated_at": None}

for path in sorted(data_dir.glob("*.json")):
    if path.name == "index.json":
        continue
    data = json.loads(path.read_text(encoding="utf-8"))
    meta = data["meta"]
    home_id = meta["home"]["team_id"]
    away_id = meta["away"]["team_id"]
    goals = [e for e in data["events"] if e.get("TYPE_DETAIL_CD") == "GL"]
    home_score = sum(1 for g in goals if g.get("TEAM_ID") == home_id)
    away_score = sum(1 for g in goals if g.get("TEAM_ID") == away_id)
    meta["score"] = {"home": home_score, "away": away_score}
    path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    index["matches"].append(
        {
            "game_id": str(meta["game_id"]),
            "year": str(meta.get("meet_year") or ""),
            "round": int(meta.get("round") or 0),
            "home": meta["home"]["name"],
            "away": meta["away"]["name"],
            "score": f"{home_score}:{away_score}",
            "date": meta.get("date") or "",
            "file": f"./data/{meta['game_id']}.json",
            "label": f"{meta['home']['name']} VS {meta['away']['name']} ({meta['game_id']})",
        }
    )

index["matches"].sort(key=lambda x: (x["year"], x["round"], x["game_id"]))
index["updated_at"] = datetime.now(timezone.utc).isoformat()
(data_dir / "index.json").write_text(
    json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8"
)
print("fixed", len(index["matches"]))
for row in index["matches"]:
    if row["game_id"] in {"131", "122", "4"}:
        print(row)
