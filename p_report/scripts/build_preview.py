#!/usr/bin/env python3
"""
Build JEONBUK MATCH AI PREVIEW payloads for upcoming Jeonbuk fixtures.

Window: kickoff within the next PREVIEW_HOURS (default 48).
Also always refreshes the next unfinished Jeonbuk match as a draft
(published=false) so editors can review early.

Reads:
  - c_report/data/schedule.json
  - c_report/data/index.json
  - c_report/data/{game_id}.json (when present)

Writes:
  - p_report/data/index.json
  - p_report/data/{game_id}.json
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent
C_DATA = REPO / "c_report" / "data"
OUT_DIR = ROOT / "data"
INDEX_OUT = OUT_DIR / "index.json"

PREVIEW_HOURS = float(os.environ.get("PREVIEW_HOURS") or "48")
YEAR = os.environ.get("KLEAGUE_YEAR") or str(datetime.now().year)
JEONBUK = "전북"
KST = timezone(timedelta(hours=9))


def now_kst() -> datetime:
    return datetime.now(KST)


def load_json(path: Path) -> dict | list | None:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        print(f"[WARN] failed to read {path}: {exc}")
        return None


def parse_md_kickoff(year: str, date_md: str, kickoff_hint: str = "") -> datetime | None:
    """Build aware datetime from MM/DD (+ optional HH:MM). Default 19:00 KST."""
    md = (date_md or "").strip()
    if not md:
        return None
    m = re.match(r"^(\d{1,2})/(\d{1,2})$", md)
    if not m:
        return None
    month, day = int(m.group(1)), int(m.group(2))
    hour, minute = 19, 0
    hint = (kickoff_hint or "").strip()
    tm = re.search(r"(\d{1,2}):(\d{2})", hint)
    if tm:
        hour, minute = int(tm.group(1)), int(tm.group(2))
    try:
        return datetime(int(year), month, day, hour, minute, tzinfo=KST)
    except ValueError:
        return None


def is_jeonbuk_row(row: dict) -> bool:
    blob = f"{row.get('home') or ''}{row.get('away') or ''}{row.get('label') or ''}"
    return JEONBUK in blob


def result_for(team: str, home: str, away: str, score: str) -> str:
    try:
        hs, aws = score.split(":")
        h, a = int(hs.strip()), int(aws.strip())
    except Exception:
        return "?"
    if team in (home or ""):
        if h > a:
            return "W"
        if h < a:
            return "L"
        return "D"
    if team in (away or ""):
        if a > h:
            return "W"
        if a < h:
            return "L"
        return "D"
    return "?"


def recent_form(index_matches: list[dict], team: str, limit: int = 5) -> list[dict]:
    rows = []
    for m in index_matches:
        home, away = m.get("home") or "", m.get("away") or ""
        if team not in home and team not in away:
            continue
        score = m.get("score") or ""
        rows.append(
            {
                "game_id": str(m.get("game_id") or ""),
                "round": m.get("round"),
                "date": m.get("date") or "",
                "home": home,
                "away": away,
                "score": score,
                "result": result_for(team, home, away, score),
                "opponent": away if team in home else home,
                "ha": "H" if team in home else "A",
            }
        )
    rows.sort(key=lambda x: (str(x.get("date") or ""), int(x.get("round") or 0)))
    return rows[-limit:]


def h2h_rows(index_matches: list[dict], opponent: str, limit: int = 5) -> list[dict]:
    out = []
    for m in index_matches:
        home, away = m.get("home") or "", m.get("away") or ""
        if JEONBUK not in f"{home}{away}":
            continue
        if opponent not in f"{home}{away}":
            continue
        out.append(
            {
                "game_id": str(m.get("game_id") or ""),
                "round": m.get("round"),
                "date": m.get("date") or "",
                "home": home,
                "away": away,
                "score": m.get("score") or "",
                "result": result_for(JEONBUK, home, away, m.get("score") or ""),
            }
        )
    out.sort(key=lambda x: (str(x.get("date") or ""), int(x.get("round") or 0)))
    return out[-limit:]


def summarize_match_file(path: Path, team_name: str) -> dict | None:
    data = load_json(path)
    if not isinstance(data, dict):
        return None
    meta = data.get("meta") or {}
    home = meta.get("home") or {}
    away = meta.get("away") or {}
    home_name = home.get("name") or ""
    away_name = away.get("name") or ""
    if team_name not in home_name and team_name not in away_name:
        return None
    team_id = home.get("team_id") if team_name in home_name else away.get("team_id")
    events = data.get("events") or []
    shots = 0
    sot = 0
    xg = 0.0
    goals = 0
    for e in events:
        if str(e.get("TEAM_ID") or "") != str(team_id or ""):
            continue
        if e.get("TYPE_CD") == "ST":
            shots += 1
            xg += float(e.get("EXPECTED_GOAL") or 0)
            if e.get("TYPE_DETAIL_CD") == "GL":
                goals += 1
                sot += 1
            elif e.get("SHOT_GOALPOST_SITE") and e.get("TYPE_DETAIL_CD") not in (
                "MST",
                "BT",
                "STB",
            ):
                sot += 1
    return {
        "game_id": str(meta.get("game_id") or path.stem),
        "shots": shots,
        "sot": sot,
        "xg": round(xg, 2),
        "goals": goals,
    }


def style_blob(form: list[dict], samples: list[dict], name: str) -> dict:
    results = [r.get("result") for r in form if r.get("result") in ("W", "D", "L")]
    wins = results.count("W")
    draws = results.count("D")
    losses = results.count("L")
    tags = []
    if wins >= 3:
        tags.append("상승세")
    if losses >= 3:
        tags.append("부진")
    if draws >= 2 and wins <= 1:
        tags.append("비기는 흐름")
    avg_xg = 0.0
    avg_shots = 0.0
    if samples:
        avg_xg = round(sum(s["xg"] for s in samples) / len(samples), 2)
        avg_shots = round(sum(s["shots"] for s in samples) / len(samples), 1)
        if avg_xg >= 1.4:
            tags.append("기회 창출↑")
        elif avg_xg and avg_xg < 0.9:
            tags.append("기회 부족")
        if avg_shots >= 12:
            tags.append("슈팅 많음")
    if not tags:
        tags.append("데이터 축적 중")
    return {
        "name": name,
        "tags": tags[:4],
        "record": f"{wins}승 {draws}무 {losses}패 / 최근 {len(results)}경기",
        "avg_xg": avg_xg,
        "avg_shots": avg_shots,
    }


def build_cards(jb: dict, opp: dict, opponent: str, ha: str) -> list[dict]:
    edges, risks, keys, watches = [], [], [], []

    if "상승세" in jb["tags"]:
        edges.append("전북 최근 결과가 좋다. 템포를 먼저 가져가면 상대가 쫓아오는 그림이 된다.")
    if "기회 창출↑" in jb["tags"]:
        edges.append(f"전북 최근 경기당 xG 평균 {jb['avg_xg']}. 박스 진입만 유지하면 기회는 열린다.")
    if "부진" in opp["tags"]:
        edges.append(f"{opponent} 최근 흐름이 좋지 않다. 초반 압박으로 실수를 유도할 만하다.")
    if ha == "H":
        edges.append("홈 이점. 전주에서 라인 높이를 올려도 관중·익숙한 공간이 받쳐 준다.")
    else:
        risks.append("원정이다. 초반 실점하면 추격 템포가 무거워지니 첫 20분 전환 수비가 핵심이다.")

    if "기회 부족" in jb["tags"]:
        risks.append("전북 최근 기회 질이 낮다. 점유만 하고 슈팅 질이 떨어지면 역습에 취약하다.")
    if "상승세" in opp["tags"]:
        risks.append(f"{opponent}이(가) 상승세다. 한 방에 무너지지 않게 세트피스·역습 첫 패스를 막아야 한다.")
    if "슈팅 많음" in opp["tags"]:
        watches.append(f"{opponent} 슈팅 빈도가 높다. 박스 입구 차단과 세컨볼 정리 우선.")

    keys.append("전북 측면 오버랩 후 컷백이 통하는지 — 중앙만 막히면 답답한 점유로 흐른다.")
    keys.append(f"{opponent}의 첫 압박 라인 높이 — 빌드업 실수를 줄이면 전북이 경기를 가져온다.")
    keys.append("리드 후 템포 관리 — 최근 K리그는 한 골 리드 뒤 역습 한 방이 승부를 가른다.")

    if not edges:
        edges.append("중원 볼 경합과 측면 숫자에서 앞서면 전북 페이스로 가져올 수 있다.")
    if not risks:
        risks.append("조급한 박스 밖 슈팅은 금물. 기회가 비슷할수록 전환 수비 한 장면이 승부처다.")
    if not watches:
        watches.append(f"{opponent} 세트피스와 역습 첫 패스. 짧은 순간의 마무리를 경계한다.")

    return [
        {"key": "edge", "label": "전북이 유리한 점", "items": edges[:3]},
        {"key": "risk", "label": "전북이 불리한·조심할 점", "items": risks[:3]},
        {"key": "key", "label": "관전 포인트", "items": keys[:3]},
        {"key": "watch", "label": f"{opponent} 경계 포인트", "items": watches[:3]},
    ]


def form_line(form: list[dict]) -> str:
    if not form:
        return "최근 결과 데이터 없음"
    return " ".join(r.get("result") or "?" for r in form)


def build_preview_payload(row: dict, index_matches: list[dict], kickoff: datetime, published: bool) -> dict:
    home = row.get("home") or ""
    away = row.get("away") or ""
    opponent = away if JEONBUK in home else home
    ha = "H" if JEONBUK in home else "A"
    jb_form = recent_form(index_matches, JEONBUK, 5)
    opp_form = recent_form(index_matches, opponent, 5)
    h2h = h2h_rows(index_matches, opponent, 5)

    jb_samples = []
    opp_samples = []
    for r in jb_form:
        p = C_DATA / f"{r['game_id']}.json"
        s = summarize_match_file(p, JEONBUK)
        if s:
            jb_samples.append(s)
    for r in opp_form:
        p = C_DATA / f"{r['game_id']}.json"
        s = summarize_match_file(p, opponent)
        if s:
            opp_samples.append(s)

    jb_style = style_blob(jb_form, jb_samples, JEONBUK)
    opp_style = style_blob(opp_form, opp_samples, opponent)
    cards = build_cards(jb_style, opp_style, opponent, ha)

    hours = (kickoff - now_kst()).total_seconds() / 3600.0
    thesis = (
        f"{home} vs {away}. 전북 최근 {form_line(jb_form)}, "
        f"{opponent} 최근 {form_line(opp_form)}. "
        f"{'홈' if ha == 'H' else '원정'}에서 "
        f"{'초반 템포를 가져가며 박스 진입 질을 올리는 것' if '기회 창출↑' in jb_style['tags'] or ha == 'H' else '실점 없이 버티다 측면 한 방을 노리는 것'}이  Prematch 핵심이다."
    )
    # keep thesis clean Korean without leftover English
    thesis = thesis.replace(" Prematch 핵심이다.", "이 프리뷰의 핵심이다.")

    headline = f"{int(row.get('round') or 0)}R PREVIEW · {home} vs {away}"
    return {
        "meta": {
            "game_id": str(row.get("game_id") or ""),
            "year": str(row.get("year") or YEAR),
            "round": int(row.get("round") or 0),
            "competition": "하나은행 K리그1",
            "home": {"name": home},
            "away": {"name": away},
            "opponent": opponent,
            "ha": ha,
            "kickoff": kickoff.isoformat(),
            "kickoff_label": kickoff.strftime("%Y-%m-%d %H:%M KST"),
            "date_md": row.get("date_md") or "",
            "label": row.get("label") or f"{home} VS {away}",
            "hours_to_kickoff": round(hours, 1),
            "within_48h": 0 <= hours <= PREVIEW_HOURS,
            "published": published,
            "generated_at": now_kst().isoformat(),
            "preview_hours": PREVIEW_HOURS,
        },
        "headline": headline,
        "thesis": thesis,
        "form": {"jeonbuk": jb_form, "opponent": opp_form},
        "h2h": h2h,
        "style": {"jeonbuk": jb_style, "opponent": opp_style},
        "cards": cards,
        "sources": [
            "c_report/data/schedule.json",
            "c_report/data/index.json",
            "c_report chalk board match files (when available)",
        ],
        "note": "킥오프 시각이 일정에 없으면 당일 19:00 KST로 가정합니다. 포털 확정 시각과 다를 수 있습니다.",
    }


def pick_targets(schedule_matches: list[dict]) -> list[tuple[dict, datetime, bool]]:
    """Return (row, kickoff, published) for Jeonbuk unfinished matches."""
    now = now_kst()
    upcoming: list[tuple[dict, datetime]] = []
    for row in schedule_matches:
        if not is_jeonbuk_row(row):
            continue
        if str(row.get("end_yn") or "N").upper() == "Y":
            continue
        kickoff = parse_md_kickoff(str(row.get("year") or YEAR), str(row.get("date_md") or ""))
        if not kickoff:
            continue
        if kickoff < now - timedelta(hours=3):
            continue
        upcoming.append((row, kickoff))
    upcoming.sort(key=lambda x: x[1])
    if not upcoming:
        return []

    by_id: dict[str, tuple[dict, datetime, bool]] = {}
    # Always include the next match (may be draft if >48h).
    next_row, next_ko = upcoming[0]
    next_hours = (next_ko - now).total_seconds() / 3600.0
    by_id[str(next_row.get("game_id") or "")] = (
        next_row,
        next_ko,
        0 <= next_hours <= PREVIEW_HOURS,
    )
    # Also include every Jeonbuk match inside the preview window.
    for row, kickoff in upcoming:
        hours = (kickoff - now).total_seconds() / 3600.0
        if 0 <= hours <= PREVIEW_HOURS:
            by_id[str(row.get("game_id") or "")] = (row, kickoff, True)
    return list(by_id.values())


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    schedule = load_json(C_DATA / "schedule.json") or {}
    index = load_json(C_DATA / "index.json") or {}
    schedule_matches = schedule.get("matches") if isinstance(schedule, dict) else []
    index_matches = index.get("matches") if isinstance(index, dict) else []
    if not isinstance(schedule_matches, list):
        schedule_matches = []
    if not isinstance(index_matches, list):
        index_matches = []

    targets = pick_targets(schedule_matches)
    if not targets:
        payload = {
            "updated_at": now_kst().isoformat(),
            "preview_hours": PREVIEW_HOURS,
            "matches": [],
            "active_game_id": "",
            "note": "예정된 전북 미종료 경기가 없거나 schedule.json이 비어 있습니다.",
        }
        INDEX_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[DONE] no upcoming Jeonbuk matches")
        return

    entries = []
    active_id = ""
    for row, kickoff, published in sorted(targets, key=lambda x: x[1]):
        preview = build_preview_payload(row, index_matches, kickoff, published)
        gid = preview["meta"]["game_id"]
        out_path = OUT_DIR / f"{gid}.json"
        out_path.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
        entries.append(
            {
                "game_id": gid,
                "year": preview["meta"]["year"],
                "round": preview["meta"]["round"],
                "home": preview["meta"]["home"]["name"],
                "away": preview["meta"]["away"]["name"],
                "kickoff": preview["meta"]["kickoff"],
                "kickoff_label": preview["meta"]["kickoff_label"],
                "hours_to_kickoff": preview["meta"]["hours_to_kickoff"],
                "within_48h": preview["meta"]["within_48h"],
                "published": published,
                "headline": preview["headline"],
                "file": f"./data/{gid}.json",
            }
        )
        print(
            f"[OK] game_id={gid} published={published} "
            f"in={preview['meta']['hours_to_kickoff']}h {preview['headline']}"
        )
        if published and not active_id:
            active_id = gid
    if not active_id and entries:
        active_id = entries[0]["game_id"]

    INDEX_OUT.write_text(
        json.dumps(
            {
                "updated_at": now_kst().isoformat(),
                "preview_hours": PREVIEW_HOURS,
                "active_game_id": active_id,
                "matches": entries,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"[DONE] previews={len(entries)} active={active_id}")


if __name__ == "__main__":
    main()
