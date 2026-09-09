#!/usr/bin/env python3
"""Build fun_records/data/records.json from history + curated seeds.

Also used as a reference for the client-side engine (js/engine.js).
"""

from __future__ import annotations

import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
KST = timezone(timedelta(hours=9))
JEONBUK = "전북"

# Curated seeds — kept even when chalkboard history is incomplete.
# days_since is recomputed at build / refresh time from as_of_date.
CURATED = [
    {
        "id": "seed_foreign_winger_italo",
        "category": "득점",
        "title": "외국인 윙어 리그 득점",
        "template": "전북현대 리그 {days}일 만에 외국인 윙어 득점",
        "detail": "2026-09-09 강원전 이탈로. 직전 마지막 골은 2024년 9월 14일 vs FC수원전 에르난데스",
        "anchor_date": "2024-09-14",
        "event_date": "2026-09-09",
        "tags": ["외국인", "윙어", "득점", "이탈로"],
        "priority": 100,
    },
]


def now_kst() -> datetime:
    return datetime.now(KST)


def parse_date(s: str) -> datetime | None:
    try:
        return datetime.strptime(str(s)[:10], "%Y-%m-%d").replace(tzinfo=KST)
    except ValueError:
        return None


def days_between(a: str, b: str) -> int | None:
    da, db = parse_date(a), parse_date(b)
    if not da or not db:
        return None
    return abs((db.date() - da.date()).days)


def load_history() -> dict:
    path = DATA / "history.json"
    if not path.exists():
        return {"matches": []}
    return json.loads(path.read_text(encoding="utf-8"))


def finished(matches: list[dict]) -> list[dict]:
    return [m for m in matches if m.get("result") in ("W", "D", "L") and m.get("date")]


def fact(
    fid: str,
    category: str,
    title: str,
    text: str,
    detail: str = "",
    as_of: str = "",
    tags: list[str] | None = None,
    priority: int = 50,
) -> dict:
    return {
        "id": fid,
        "category": category,
        "title": title,
        "text": text,
        "detail": detail,
        "as_of": as_of,
        "tags": tags or [],
        "priority": priority,
    }


def streak_facts(rows: list[dict]) -> list[dict]:
    out = []
    if not rows:
        return out
    # Current streak from end
    last = rows[-1]["result"]
    n = 0
    for m in reversed(rows):
        if m["result"] != last:
            break
        n += 1
    label = {"W": "연승", "D": "연무", "L": "연패"}[last]
    out.append(
        fact(
            "streak_current",
            "흐름",
            f"현재 {label}",
            f"전북은 현재 {n}경기 {label} 흐름입니다.",
            detail=f"기준 경기: {rows[-1].get('date')} vs {rows[-1].get('opponent')} ({rows[-1].get('hs')}:{rows[-1].get('as')})",
            as_of=rows[-1].get("date") or "",
            tags=["연승", "연패", "연무"],
            priority=90,
        )
    )
    # Longest W streak in window
    best = cur = 0
    best_end = None
    for m in rows:
        if m["result"] == "W":
            cur += 1
            if cur > best:
                best = cur
                best_end = m
        else:
            cur = 0
    if best >= 3 and best_end:
        out.append(
            fact(
                "streak_longest_w",
                "흐름",
                "최장 연승",
                f"2020년 이후 최장 연승은 {best}연승입니다.",
                detail=f"해당 구간의 끝: {best_end.get('date')} vs {best_end.get('opponent')}",
                as_of=best_end.get("date") or "",
                tags=["연승"],
                priority=70,
            )
        )
    return out


def venue_h2h_facts(rows: list[dict]) -> list[dict]:
    out = []
    latest = rows[-1] if rows else None
    as_of = latest.get("date") if latest else ""

    def last_match(pred, label, title, how: str):
        hits = [m for m in rows if pred(m)]
        if not hits:
            out.append(
                fact(
                    f"never_{label}",
                    "맞대결",
                    title,
                    f"2020년 이후 기록상 {how}가 한 번도 없습니다.",
                    as_of=as_of or "",
                    tags=["맞대결"],
                    priority=80,
                )
            )
            return
        last = hits[-1]
        d = days_between(last.get("date") or "", as_of or last.get("date") or "")
        gap = f" ({d}일 전)" if d is not None and as_of else ""
        out.append(
            fact(
                f"last_{label}",
                "맞대결",
                title,
                f"마지막으로 {how}은 {last.get('date')} vs {last.get('opponent')} ({last.get('hs')}:{last.get('as')}){gap}.",
                detail=f"{last.get('year')}시즌 {last.get('round')}R · {'홈' if last.get('ha')=='H' else '원정'}",
                as_of=as_of or last.get("date") or "",
                tags=["맞대결", last.get("opponent") or ""],
                priority=85,
            )
        )

    opponents = sorted({m.get("opponent") for m in rows if m.get("opponent")})
    for opp in opponents:
        last_match(
            lambda m, o=opp: m.get("opponent") == o and m.get("ha") == "A" and m.get("result") == "L",
            f"away_loss_{opp}",
            f"{opp} 원정 패배",
            f"{opp} 원정에서 패한 것",
        )
        last_match(
            lambda m, o=opp: m.get("opponent") == o and m.get("ha") == "A" and m.get("result") == "W",
            f"away_win_{opp}",
            f"{opp} 원정 승리",
            f"{opp} 원정에서 이긴 것",
        )
        last_match(
            lambda m, o=opp: m.get("opponent") == o and m.get("ha") == "H" and m.get("result") == "L",
            f"home_loss_{opp}",
            f"{opp} 상대 홈 패배",
            f"홈에서 {opp}에게 패한 것",
        )

    seoul_away_l = [m for m in rows if m.get("opponent") == "서울" and m.get("ha") == "A" and m.get("result") == "L"]
    if seoul_away_l and as_of:
        last = seoul_away_l[-1]
        d = days_between(last["date"], as_of)
        years = round((d or 0) / 365.25, 1) if d is not None else None
        if d is not None and d >= 365:
            title = "서울 원정 무패 기간"
            text = f"서울 원정에서 마지막으로 패한 지 약 {years}년({d}일)입니다. 그날은 {last['date']}."
        else:
            title = "서울 원정 마지막 패배"
            text = (
                f"서울 원정 마지막 패배는 {last['date']} ({last.get('hs')}:{last.get('as')})"
                + (f", {d}일 전입니다." if d is not None else "입니다.")
            )
        out.append(
            fact(
                "seoul_away_loss_gap",
                "맞대결",
                title,
                text,
                detail=f"직전 패: {last['date']} 서울 vs 전북 {last.get('hs')}:{last.get('as')}",
                as_of=as_of,
                tags=["서울", "원정"],
                priority=95,
            )
        )
    return out


def scoreline_facts(rows: list[dict]) -> list[dict]:
    out = []
    if not rows:
        return out
    as_of = rows[-1].get("date") or ""

    # Clean sheet streak
    n = 0
    for m in reversed(rows):
        if int(m.get("ga") or 0) == 0:
            n += 1
        else:
            break
    if n >= 1:
        out.append(
            fact(
                "cs_streak",
                "수비",
                "무실점 행진",
                f"최근 {n}경기 연속 무실점입니다." if n > 1 else "직전 경기에서 무실점을 기록했습니다.",
                as_of=as_of,
                tags=["무실점"],
                priority=75,
            )
        )

    # High scoring
    best = max(rows, key=lambda m: int(m.get("gf") or 0))
    if int(best.get("gf") or 0) >= 4:
        out.append(
            fact(
                "most_goals_game",
                "득점",
                "한 경기 최다골",
                f"2020년 이후 한 경기 최다골은 {best.get('date')} vs {best.get('opponent')} {best.get('gf')}골입니다.",
                detail=f"스코어 {best.get('hs')}:{best.get('as')}",
                as_of=best.get("date") or "",
                tags=["득점"],
                priority=65,
            )
        )

    # Biggest win / loss
    best_diff = max(rows, key=lambda m: int(m.get("gf") or 0) - int(m.get("ga") or 0))
    worst_diff = min(rows, key=lambda m: int(m.get("gf") or 0) - int(m.get("ga") or 0))
    bd = int(best_diff.get("gf") or 0) - int(best_diff.get("ga") or 0)
    wd = int(worst_diff.get("gf") or 0) - int(worst_diff.get("ga") or 0)
    if bd >= 3:
        out.append(
            fact(
                "biggest_win",
                "스코어",
                "최다 득실차 승리",
                f"가장 큰 승리는 {best_diff.get('date')} vs {best_diff.get('opponent')} ({best_diff.get('hs')}:{best_diff.get('as')}, +{bd}).",
                as_of=best_diff.get("date") or "",
                tags=["승리"],
                priority=68,
            )
        )
    if wd <= -3:
        out.append(
            fact(
                "biggest_loss",
                "스코어",
                "최다 실점차 패배",
                f"가장 큰 패배는 {worst_diff.get('date')} vs {worst_diff.get('opponent')} ({worst_diff.get('hs')}:{worst_diff.get('as')}, {wd}).",
                as_of=worst_diff.get("date") or "",
                tags=["패배"],
                priority=60,
            )
        )

    # Home/away records
    home = [m for m in rows if m.get("ha") == "H"]
    away = [m for m in rows if m.get("ha") == "A"]
    for label, subset in (("홈", home), ("원정", away)):
        if not subset:
            continue
        w = sum(1 for m in subset if m["result"] == "W")
        d = sum(1 for m in subset if m["result"] == "D")
        l = sum(1 for m in subset if m["result"] == "L")
        out.append(
            fact(
                f"record_{label}",
                "시즌누적",
                f"{label} 전적 (2020~)",
                f"{label} {len(subset)}경기 {w}승 {d}무 {l}패.",
                as_of=as_of,
                tags=[label],
                priority=55,
            )
        )
    return out


def goal_player_facts(rows: list[dict]) -> list[dict]:
    out = []
    goals = []
    for m in rows:
        for g in m.get("goals") or []:
            goals.append({**g, "date": m.get("date"), "opponent": m.get("opponent"), "year": m.get("year")})
    if not goals:
        return out
    as_of = rows[-1].get("date") or ""

    # Foreign goals
    foreign = [g for g in goals if g.get("foreign")]
    if foreign:
        last = foreign[-1]
        prev = foreign[-2] if len(foreign) >= 2 else None
        d = days_between(prev["date"], last["date"]) if prev else None
        text = f"최근 외국인 득점은 {last.get('date')} {last.get('name')} (vs {last.get('opponent')})."
        detail = ""
        if prev and d is not None:
            detail = f"그 전 외국인 골은 {prev.get('date')} {prev.get('name')} · 간격 {d}일"
        out.append(
            fact(
                "last_foreign_goal",
                "득점",
                "외국인 선수 득점",
                text,
                detail=detail,
                as_of=as_of,
                tags=["외국인", "득점"],
                priority=92,
            )
        )

    wingers = [g for g in goals if g.get("winger") or (g.get("foreign") and g.get("position") in ("FW", "MF"))]
    # Prefer explicit winger flag
    wing_goals = [g for g in goals if g.get("winger")]
    if wing_goals:
        last = wing_goals[-1]
        prev = wing_goals[-2] if len(wing_goals) >= 2 else None
        text = f"외국인 윙어 최근 골: {last.get('date')} {last.get('name')} vs {last.get('opponent')}."
        detail = ""
        if prev:
            d = days_between(prev["date"], last["date"])
            detail = f"직전은 {prev.get('date')} {prev.get('name')}" + (f" · {d}일 만" if d is not None else "")
        out.append(
            fact(
                "last_foreign_winger_goal",
                "득점",
                "외국인 윙어 득점",
                text,
                detail=detail,
                as_of=as_of,
                tags=["외국인", "윙어"],
                priority=98,
            )
        )

    # Top scorers in chalkboard sample
    from collections import Counter

    c = Counter(g.get("name") for g in goals if g.get("name"))
    if c:
        name, n = c.most_common(1)[0]
        out.append(
            fact(
                "top_scorer_sample",
                "득점",
                "칠판 기준 최다골",
                f"가용 칠판 데이터 기준 최다골은 {name} {n}골입니다.",
                detail="칠판이 있는 경기에 한정된 샘플 기록입니다.",
                as_of=as_of,
                tags=["득점"],
                priority=50,
            )
        )
    return out


def curated_facts(as_of: str) -> list[dict]:
    out = []
    for c in CURATED:
        event = c.get("event_date") or as_of
        anchor = c.get("anchor_date") or ""
        d = days_between(anchor, event) if anchor and event else None
        text = c.get("template", "").format(days=d if d is not None else "?")
        out.append(
            fact(
                c["id"],
                c.get("category") or "시드",
                c.get("title") or "",
                text,
                detail=c.get("detail") or "",
                as_of=event or as_of,
                tags=c.get("tags") or [],
                priority=int(c.get("priority") or 100),
            )
        )
    return out


def misc_facts(rows: list[dict]) -> list[dict]:
    out = []
    if len(rows) < 5:
        return out
    as_of = rows[-1].get("date") or ""
    # First win of window
    first_w = next((m for m in rows if m["result"] == "W"), None)
    if first_w:
        out.append(
            fact(
                "first_win_window",
                "타임라인",
                "집계 구간 첫 승",
                f"집계 시작 후 첫 승리는 {first_w.get('date')} vs {first_w.get('opponent')} ({first_w.get('hs')}:{first_w.get('as')}).",
                as_of=first_w.get("date") or "",
                tags=["타임라인"],
                priority=40,
            )
        )
    # Draws
    draws = [m for m in rows if m["result"] == "D"]
    out.append(
        fact(
            "draw_count",
            "시즌누적",
            "무승부 횟수",
            f"2020년 이후 무승부는 {len(draws)}경기입니다.",
            as_of=as_of,
            tags=["무승부"],
            priority=45,
        )
    )
    # 0-0
    zo = [m for m in rows if int(m.get("gf") or 0) == 0 and int(m.get("ga") or 0) == 0]
    if zo:
        out.append(
            fact(
                "last_0_0",
                "스코어",
                "마지막 0-0",
                f"마지막 0-0은 {zo[-1].get('date')} vs {zo[-1].get('opponent')}.",
                as_of=as_of,
                tags=["0-0"],
                priority=58,
            )
        )
    # Comeback? (can't know without period scores) — skip
    # Attendance max
    with_att = [m for m in rows if isinstance(m.get("attendance"), (int, float)) and m.get("attendance")]
    if with_att:
        top = max(with_att, key=lambda m: float(m["attendance"]))
        out.append(
            fact(
                "max_attendance",
                "관중",
                "최다 관중",
                f"집계된 경기 중 최다 관중은 {top.get('date')} vs {top.get('opponent')} {int(top['attendance']):,}명.",
                detail=top.get("venue") or "",
                as_of=top.get("date") or "",
                tags=["관중"],
                priority=48,
            )
        )
    return out


def build(seed: int | None = None) -> dict:
    hist = load_history()
    rows = finished(hist.get("matches") or [])
    as_of = rows[-1]["date"] if rows else now_kst().strftime("%Y-%m-%d")
    facts = []
    facts.extend(curated_facts(as_of))
    facts.extend(streak_facts(rows))
    facts.extend(venue_h2h_facts(rows))
    facts.extend(scoreline_facts(rows))
    facts.extend(goal_player_facts(rows))
    facts.extend(misc_facts(rows))

    # Deduplicate by id
    seen = set()
    uniq = []
    for f in facts:
        if f["id"] in seen:
            continue
        seen.add(f["id"])
        uniq.append(f)

    rng = random.Random(seed if seed is not None else int(now_kst().timestamp()))
    # Stable sort by priority then shuffle within same priority band for refresh feel
    uniq.sort(key=lambda f: (-int(f.get("priority") or 0), rng.random()))

    return {
        "generated_at": now_kst().isoformat(),
        "as_of": as_of,
        "seed": seed,
        "history_matches": len(rows),
        "history_from": hist.get("from_year"),
        "history_to": hist.get("to_year"),
        "records_n": len(uniq),
        "records": uniq,
        "note": "재미로 보는 전북현대 기록. 공식 통계와 다를 수 있습니다.",
    }


def main() -> int:
    DATA.mkdir(parents=True, exist_ok=True)
    payload = build()
    dest = DATA / "records.json"
    dest.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[DONE] records={payload['records_n']} as_of={payload['as_of']} -> {dest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
