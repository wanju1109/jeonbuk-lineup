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


def _win_streaks(rows: list[dict], min_len: int = 2) -> list[tuple[dict, dict, int]]:
    """Return (start_match, end_match, length) for win streaks >= min_len."""
    out = []
    i = 0
    n = len(rows)
    while i < n:
        if rows[i].get("result") != "W":
            i += 1
            continue
        j = i
        while j < n and rows[j].get("result") == "W":
            j += 1
        length = j - i
        if length >= min_len:
            out.append((rows[i], rows[j - 1], length))
        i = j
    return out


def quirk_facts(rows: list[dict]) -> list[dict]:
    """Odd, story-like trivia — droughts, calendar twins, habits."""
    out: list[dict] = []
    if len(rows) < 10:
        return out
    as_of = rows[-1].get("date") or ""

    # --- Multi-win streak drought (e.g. "no 2+ streak since May 5") ---
    streaks2 = _win_streaks(rows, 2)
    streaks3 = _win_streaks(rows, 3)
    for min_len, streaks, label in ((2, streaks2, "2연승"), (3, streaks3, "3연승"), (4, _win_streaks(rows, 4), "4연승")):
        if len(streaks) < 1:
            continue
        # Current open streak length
        cur = 0
        for m in reversed(rows):
            if m.get("result") == "W":
                cur += 1
            else:
                break
        last_end = streaks[-1][1]
        # If currently on a qualifying streak, talk about the previous gap instead
        if cur >= min_len and len(streaks) >= 2:
            prev_end = streaks[-2][1]
            next_start = streaks[-1][0]
            gap_days = days_between(prev_end.get("date") or "", next_start.get("date") or "")
            gap_games = 0
            started = False
            for m in rows:
                if m.get("date") == prev_end.get("date"):
                    started = True
                    continue
                if not started:
                    continue
                if m.get("date") == next_start.get("date"):
                    break
                gap_games += 1
            if gap_days and gap_days >= 30:
                out.append(
                    fact(
                        f"streak_gap_{min_len}",
                        "잡학",
                        f"{label} 공백",
                        f"{prev_end.get('date')}에 {streaks[-2][2]}연승이 끝난 뒤, "
                        f"다음 {label}까지 {gap_days}일·{gap_games}경기가 걸렸습니다.",
                        detail=(
                            f"공백 종료: {next_start.get('date')}부터 {streaks[-1][2]}연승 "
                            f"(~{last_end.get('date')}, vs {last_end.get('opponent')})"
                        ),
                        as_of=as_of,
                        tags=["연승", "공백"],
                        priority=96,
                    )
                )
        elif cur < min_len:
            gap_days = days_between(last_end.get("date") or "", as_of)
            # games since streak ended
            gap_games = 0
            started = False
            for m in rows:
                if m.get("date") == last_end.get("date"):
                    started = True
                    continue
                if started:
                    gap_games += 1
            if gap_days and gap_days >= 14:
                out.append(
                    fact(
                        f"streak_drought_{min_len}",
                        "잡학",
                        f"{label} 가뭄",
                        f"{last_end.get('date')} 이후 {label}이 없습니다. 벌써 {gap_days}일·{gap_games}경기째.",
                        detail=(
                            f"그날 {streaks[-1][2]}연승이 끝났습니다 "
                            f"(vs {last_end.get('opponent')}, {last_end.get('hs')}:{last_end.get('as')})."
                        ),
                        as_of=as_of,
                        tags=["연승", "가뭄"],
                        priority=97,
                    )
                )

    # --- Longest wait between two wins ---
    wins = [m for m in rows if m.get("result") == "W"]
    if len(wins) >= 2:
        best = None
        for a, b in zip(wins, wins[1:]):
            d = days_between(a.get("date") or "", b.get("date") or "")
            if d is None:
                continue
            if best is None or d > best[0]:
                best = (d, a, b)
        if best and best[0] >= 60:
            d, a, b = best
            out.append(
                fact(
                    "longest_win_wait",
                    "잡학",
                    "가장 길었던 승리 공백",
                    f"승리와 승리 사이 최장 간격은 {d}일 — "
                    f"{a.get('date')} vs {a.get('opponent')} 다음이 {b.get('date')} vs {b.get('opponent')}.",
                    as_of=as_of,
                    tags=["승리", "공백"],
                    priority=88,
                )
            )

    # --- Calendar twins: same month-day across years ---
    by_md: dict[str, list] = {}
    for m in rows:
        md = str(m.get("date") or "")[5:10]
        if len(md) == 5:
            by_md.setdefault(md, []).append(m)
    # Prefer quirky dates with 3+ samples
    for md, lst in sorted(by_md.items(), key=lambda kv: -len(kv[1])):
        if len(lst) < 3:
            continue
        results = [x.get("result") for x in lst]
        # All draws except maybe last
        if results.count("D") >= 2 and len(set(results)) <= 2:
            detail = ", ".join(
                f"{x.get('date')} {x.get('result')}({x.get('hs')}:{x.get('as')})" for x in lst
            )
            month, day = md.split("-")
            out.append(
                fact(
                    f"calendar_{md}",
                    "잡학",
                    f"{int(month)}월 {int(day)}일의 저주?",
                    f"{int(month)}월 {int(day)}일 전북 경기는 지금까지 {len(lst)}번 — "
                    f"무승부 {results.count('D')}·승 {results.count('W')}·패 {results.count('L')}.",
                    detail=detail,
                    as_of=as_of,
                    tags=["기념일", "캘린더"],
                    priority=93,
                )
            )
            break  # one strong calendar card is enough per refresh band; more below
    # Extra calendar: specifically 05-05 if present
    may5 = by_md.get("05-05") or []
    if len(may5) >= 2:
        detail = ", ".join(
            f"{x.get('date')} {x.get('result')}({x.get('hs')}:{x.get('as')}) vs {x.get('opponent')}"
            for x in may5
        )
        out.append(
            fact(
                "calendar_05_05",
                "잡학",
                "5월 5일 전북",
                f"어린이날(5/5) 전북 경기는 {len(may5)}번: "
                + " / ".join(f"{x.get('year')} {x.get('result')}" for x in may5)
                + ".",
                detail=detail,
                as_of=as_of,
                tags=["5월5일", "캘린더"],
                priority=94,
            )
        )

    # --- Most common scoreline ---
    from collections import Counter

    score_c = Counter(f"{m.get('hs')}:{m.get('as')}" for m in rows)
    if score_c:
        sc, n = score_c.most_common(1)[0]
        pct = round(100.0 * n / len(rows), 1)
        out.append(
            fact(
                "favorite_score",
                "잡학",
                "가장 자주 나온 스코어",
                f"2020년 이후 가장 흔한 스코어는 {sc} — {n}번({pct}%).",
                detail=" · ".join(f"{s} {c}회" for s, c in score_c.most_common(3)),
                as_of=as_of,
                tags=["스코어"],
                priority=72,
            )
        )

    # --- Never won away vs opponent ---
    for opp in sorted({m.get("opponent") for m in rows if m.get("opponent")}):
        away = [m for m in rows if m.get("opponent") == opp and m.get("ha") == "A"]
        if len(away) >= 2 and all(m.get("result") != "W" for m in away):
            last = away[-1]
            out.append(
                fact(
                    f"never_away_win_{opp}",
                    "잡학",
                    f"{opp} 원정 무승",
                    f"2020년 이후 {opp} 원정에서 아직 이겨 본 적이 없습니다 ({len(away)}경기).",
                    detail=f"최근: {last.get('date')} {last.get('result')} {last.get('hs')}:{last.get('as')}",
                    as_of=as_of,
                    tags=["원정", opp],
                    priority=91,
                )
            )

    # --- First win of each season ---
    years = sorted({str(m.get("year")) for m in rows if m.get("year")})
    first_bits = []
    for y in years[-4:]:
        fw = next((m for m in rows if str(m.get("year")) == y and m.get("result") == "W"), None)
        if fw:
            first_bits.append(f"{y} {fw.get('date')[5:]} vs {fw.get('opponent')}")
    if first_bits:
        out.append(
            fact(
                "season_first_wins",
                "잡학",
                "시즌 첫 승 달력",
                "최근 시즌 첫 승: " + " · ".join(first_bits) + ".",
                as_of=as_of,
                tags=["시즌", "첫승"],
                priority=70,
            )
        )

    # --- Scoring drought (0 goals streak) ---
    best_blank = []
    cur_blank = []
    for m in rows:
        if int(m.get("gf") or 0) == 0:
            cur_blank.append(m)
        else:
            if len(cur_blank) > len(best_blank):
                best_blank = cur_blank[:]
            cur_blank = []
    if len(cur_blank) > len(best_blank):
        best_blank = cur_blank[:]
    if len(best_blank) >= 2:
        out.append(
            fact(
                "worst_blank",
                "잡학",
                "최장 무득점 행진",
                f"최장 무득점은 {len(best_blank)}경기 "
                f"({best_blank[0].get('date')}~{best_blank[-1].get('date')}).",
                detail=" → ".join(
                    f"{m.get('date')} vs {m.get('opponent')} {m.get('hs')}:{m.get('as')}"
                    for m in best_blank
                ),
                as_of=as_of,
                tags=["무득점"],
                priority=82,
            )
        )
    # current blank?
    cur_blank = []
    for m in reversed(rows):
        if int(m.get("gf") or 0) == 0:
            cur_blank.append(m)
        else:
            break
    if len(cur_blank) >= 2:
        out.append(
            fact(
                "current_blank",
                "잡학",
                "지금 무득점 중?",
                f"최근 {len(cur_blank)}경기 연속 무득점입니다.",
                as_of=as_of,
                tags=["무득점"],
                priority=86,
            )
        )

    # --- One-goal wins habit ---
    w_rows = [m for m in rows if m.get("result") == "W"]
    if w_rows:
        one = [m for m in w_rows if abs(int(m.get("gf") or 0) - int(m.get("ga") or 0)) == 1]
        pct = round(100.0 * len(one) / len(w_rows), 1)
        out.append(
            fact(
                "one_goal_wins",
                "잡학",
                "1골 차 승리 비중",
                f"승리 {len(w_rows)}경기 중 1골 차 승리가 {len(one)}번({pct}%).",
                detail=f"최근 1골 차 승: {one[-1].get('date')} vs {one[-1].get('opponent')} ({one[-1].get('hs')}:{one[-1].get('as')})"
                if one
                else "",
                as_of=as_of,
                tags=["승리"],
                priority=74,
            )
        )

    # --- BTTS ---
    btts = [m for m in rows if int(m.get("gf") or 0) > 0 and int(m.get("ga") or 0) > 0]
    out.append(
        fact(
            "btts_rate",
            "잡학",
            "양팀 득점(BTTS)",
            f"양 팀이 모두 득점한 경기는 {len(btts)}/{len(rows)} "
            f"({round(100.0 * len(btts) / len(rows), 1)}%).",
            as_of=as_of,
            tags=["BTTS"],
            priority=66,
        )
    )

    # --- High-scoring drought (no 3+ gf) ---
    last_big = None
    for m in rows:
        if int(m.get("gf") or 0) >= 3:
            last_big = m
    if last_big:
        d = days_between(last_big.get("date") or "", as_of)
        games_since = 0
        started = False
        for m in rows:
            if m.get("date") == last_big.get("date"):
                started = True
                continue
            if started:
                games_since += 1
        if d and d >= 20 and games_since >= 3:
            out.append(
                fact(
                    "big_win_drought",
                    "잡학",
                    "대량득점 가뭄",
                    f"3골 이상 넣은 경기가 {last_big.get('date')} 이후 {d}일·{games_since}경기째 없습니다.",
                    detail=f"그날 vs {last_big.get('opponent')} {last_big.get('hs')}:{last_big.get('as')} ({last_big.get('gf')}골)",
                    as_of=as_of,
                    tags=["득점", "가뭄"],
                    priority=84,
                )
            )

    # --- Draw clusters ---
    best_d = []
    cur_d = []
    for m in rows:
        if m.get("result") == "D":
            cur_d.append(m)
        else:
            if len(cur_d) > len(best_d):
                best_d = cur_d[:]
            cur_d = []
    if len(cur_d) > len(best_d):
        best_d = cur_d[:]
    if len(best_d) >= 3:
        out.append(
            fact(
                "draw_cluster",
                "잡학",
                "무승부 클러스터",
                f"최장 연속 무는 {len(best_d)}경기 "
                f"({best_d[0].get('date')}~{best_d[-1].get('date')}).",
                as_of=as_of,
                tags=["무승부"],
                priority=78,
            )
        )

    # --- Weekend vs weekday win rate ---
    weekend = []
    weekday = []
    for m in rows:
        dt = parse_date(m.get("date") or "")
        if not dt:
            continue
        (weekend if dt.weekday() >= 5 else weekday).append(m)
    if len(weekend) >= 20 and len(weekday) >= 15:
        wp = round(100.0 * sum(1 for m in weekend if m.get("result") == "W") / len(weekend), 1)
        dp = round(100.0 * sum(1 for m in weekday if m.get("result") == "W") / len(weekday), 1)
        better = "주말" if wp >= dp else "평일"
        out.append(
            fact(
                "weekend_weekday",
                "잡학",
                "주말 vs 평일",
                f"주말 승률 {wp}%({len(weekend)}경기), 평일 승률 {dp}%({len(weekday)}경기) — {better}에 더 강했습니다.",
                as_of=as_of,
                tags=["주말", "평일"],
                priority=69,
            )
        )

    # --- Same opponent thrice same result recently ---
    by_opp: dict[str, list] = {}
    for m in rows:
        by_opp.setdefault(m.get("opponent") or "", []).append(m)
    for opp, lst in by_opp.items():
        if not opp or len(lst) < 3:
            continue
        tail = lst[-3:]
        if len({m.get("result") for m in tail}) == 1:
            res = tail[0].get("result")
            label = {"W": "승리", "D": "무승부", "L": "패배"}.get(res or "", res)
            out.append(
                fact(
                    f"opp_same3_{opp}_{res}",
                    "잡학",
                    f"{opp}전 최근 3연속 {label}",
                    f"{opp} 상대 최근 3경기가 모두 {label}입니다.",
                    detail=" · ".join(
                        f"{m.get('date')} {m.get('hs')}:{m.get('as')} ({'홈' if m.get('ha')=='H' else '원정'})"
                        for m in tail
                    ),
                    as_of=as_of,
                    tags=[opp, "연속"],
                    priority=87,
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
    facts.extend(quirk_facts(rows))
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
