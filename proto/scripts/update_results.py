#!/usr/bin/env python3
"""Fill proto/data/league.json with K League fixtures and official scores.

Existing 1–26 picks stay as generated. New rounds (27–33 now, 34–38 finals
and promotion playoffs when the portal publishes them) get Poisson WDL + U/O 2.5
from kickoff-prior results only.
"""

from __future__ import annotations

import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROTO_DIR = ROOT / "proto" / "data"
PROTO_DATA = PROTO_DIR / "league.json"
C_REPORT_SCRIPTS = ROOT / "c_report" / "scripts"
KST = timezone(timedelta(hours=9))


def kleague_year() -> str:
    env = (os.environ.get("KLEAGUE_YEAR") or "").strip()
    if env:
        return env
    return str(datetime.now(KST).year)


YEAR = kleague_year()

MEETS = (
    ("K1", os.environ.get("KLEAGUE_MEET_K1") or "1"),
    ("K2", os.environ.get("KLEAGUE_MEET_K2") or "2"),
)
EXTRA_MEET_SEQS = tuple(
    s.strip()
    for s in (os.environ.get("KLEAGUE_EXTRA_MEETS") or "3,4,5").split(",")
    if s.strip()
)
PO_ROUND_BASE = 39
GOAL_CAP = 8

MARKETS = ("wdl", "ou25")

# Longest aliases first so 수원삼성 / 서울이랜드 win over 수원 / 서울.
ALIASES = (
    "수원삼성",
    "수원fc",
    "서울이랜드",
    "부산아이파크",
    "충남아산",
    "충북청주",
    "전남",
    "김포",
    "경남",
    "성남",
    "안산",
    "천안",
    "화성",
    "김천",
    "포항",
    "울산",
    "전북",
    "인천",
    "대전",
    "부천",
    "광주",
    "강원",
    "제주",
    "안양",
    "서울",
)


def now_kst() -> datetime:
    return datetime.now(KST)


def key_team(name: str) -> str:
    n = re.sub(r"\s+", "", str(name or "")).lower()
    n = n.replace("서울e", "서울이랜드")
    n = n.replace("유나이티드", "").replace("united", "")
    n = n.replace("하나시티즌", "하나").replace("시티즌", "")
    n = n.replace("skfc", "sk")
    n = n.replace("fc1995", "").replace("1995", "").replace("2008", "")
    n = n.replace("스틸러스", "").replace("아이파크", "")
    n = n.replace("드래곤즈", "").replace("블루윙즈", "")
    n = n.replace("상무", "").replace("현대", "")
    n = n.replace("그리너스", "")
    if n.startswith("fc"):
        n = n[2:]
    if n == "수원fc" or n.startswith("수원fc"):
        return "수원fc"
    if n.endswith("fc"):
        n = n[:-2]
    if n in ("수원", "수원삼성") or n.startswith("수원삼성") or "블루윙" in n:
        return "수원삼성"
    if "이랜드" in n:
        return "서울이랜드"
    if n in ("아산", "충남아산"):
        return "충남아산"
    if "파주" in n:
        return "파주"
    if "용인" in n:
        return "용인"
    if "김해" in n:
        return "김해"
    if "대구" in n:
        return "대구"
    for alias in ALIASES:
        if alias in n:
            return alias
    return n


def actuals(home: int, away: int) -> dict[str, str]:
    if home > away:
        wdl = "승"
    elif home < away:
        wdl = "패"
    else:
        wdl = "무"
    total = home + away
    return {
        "wdl": wdl,
        "ou25": "오버" if total > 2.5 else "언더",
    }


def hits_for(match: dict, act: dict[str, str]) -> dict[str, bool]:
    picks = match.get("picks") or {}
    out: dict[str, bool] = {}
    for key in MARKETS:
        pick = ((picks.get(key) or {}).get("pick")) if isinstance(picks.get(key), dict) else None
        out[key] = bool(pick) and pick == act.get(key)
    return out


def pct(hit: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(100.0 * hit / total, 2)


def rebuild_summary(matches: list[dict]) -> dict:
    summary: dict[str, dict] = {}
    for lg in ("K1", "K2"):
        rows = [m for m in matches if m.get("league") == lg and m.get("finished")]
        raw = {k: [0, 0] for k in MARKETS}
        by_round: dict[str, dict] = {}
        for m in rows:
            act = m.get("actual") or {}
            hit = m.get("hit") or {}
            rnd = str(m.get("round"))
            if rnd not in by_round:
                by_round[rnd] = {
                    "wdl_rate": 0.0,
                    "ou_rate": 0.0,
                    "rates": {k: 0.0 for k in MARKETS},
                    "raw": {k: [0, 0] for k in MARKETS},
                }
            for key in MARKETS:
                if act.get(key) is None:
                    continue
                raw[key][1] += 1
                by_round[rnd]["raw"][key][1] += 1
                if hit.get(key):
                    raw[key][0] += 1
                    by_round[rnd]["raw"][key][0] += 1
        for rnd, block in by_round.items():
            rates = {}
            for key in MARKETS:
                h, t = block["raw"][key]
                rates[key] = pct(h, t)
            block["rates"] = rates
            block["wdl_rate"] = rates["wdl"]
            block["ou_rate"] = rates["ou25"]
        hits = {}
        for key in MARKETS:
            h, t = raw[key]
            hits[key] = {"hit": h, "total": t, "rate": pct(h, t)}
        summary[lg] = {
            "wdl_hit": hits["wdl"]["hit"],
            "wdl_total": hits["wdl"]["total"],
            "wdl_rate": hits["wdl"]["rate"],
            "ou_hit": hits["ou25"]["hit"],
            "ou_total": hits["ou25"]["total"],
            "ou_rate": hits["ou25"]["rate"],
            "rates": {k: hits[k]["rate"] for k in MARKETS},
            "hits": hits,
            "by_round": dict(sorted(by_round.items(), key=lambda kv: int(kv[0]))),
        }
    return summary


def keep_keys(src: dict | None, keys: tuple[str, ...]) -> dict | None:
    if not isinstance(src, dict):
        return src
    out: dict = {}
    for k in keys:
        if k in src:
            out[k] = src[k]
    return out


def slim_reason(match: dict) -> dict | None:
    reason = match.get("reason")
    if not isinstance(reason, dict):
        return reason
    picks = match.get("picks") or {}
    wdl = (picks.get("wdl") or {}).get("pick") if isinstance(picks.get("wdl"), dict) else None
    ou = (picks.get("ou25") or {}).get("pick") if isinstance(picks.get("ou25"), dict) else None
    old = str(reason.get("headline") or "")
    conf = ""
    found = re.search(r"\(신뢰 [^)]+\)", old)
    if found:
        conf = " " + found.group(0)
    headline = f"승무패 {wdl or '-'} · U/O 2.5 {ou or '-'}{conf}"
    paras = []
    for p in reason.get("paragraphs") or []:
        s = str(p)
        if s.startswith("핸디캡 홈"):
            continue
        if s.startswith("언더오버 3.5"):
            continue
        s = s.replace(
            "핸디캡·언더오버는 포아송 스코어 행렬을 그대로 쓴다.",
            "U/O 2.5는 포아송 스코어 행렬을 그대로 쓴다.",
        )
        s = s.replace(
            "칸에 보이는 %는 핸디·언더와 같은 포아송 스코어 행렬이다. 그래서 홈 +1/+2 승 확률은 일반 승 확률보다 작을 수 없다. ",
            "칸에 보이는 %는 포아송 스코어 행렬이다. ",
        )
        paras.append(s)
    return {"headline": headline, "paragraphs": paras}


def slim_match(match: dict) -> None:
    picks = match.get("picks")
    if isinstance(picks, dict):
        match["picks"] = keep_keys(picks, MARKETS) or {}
    score = match.get("score")
    if match.get("finished") and isinstance(score, list) and len(score) >= 2:
        try:
            hs = int(score[0])
            aws = int(score[1])
        except (TypeError, ValueError):
            hs = None
            aws = None
        if hs is not None and aws is not None:
            act = actuals(hs, aws)
            match["actual"] = act
            match["hit"] = hits_for(match, act)
        elif isinstance(match.get("actual"), dict):
            match["actual"] = keep_keys(match.get("actual"), MARKETS)
            if isinstance(match.get("hit"), dict):
                match["hit"] = keep_keys(match.get("hit"), MARKETS)
    elif isinstance(match.get("actual"), dict):
        match["actual"] = keep_keys(match.get("actual"), MARKETS)
        if isinstance(match.get("hit"), dict):
            match["hit"] = keep_keys(match.get("hit"), MARKETS)
    reason = slim_reason(match)
    if reason is not None:
        match["reason"] = reason


def slim_league_data(data: dict) -> None:
    method = data.get("method")
    if isinstance(method, dict):
        method["markets"] = ["승무패", "언더오버 2.5"]
        method["model"] = (
            "WDL=walk-forward best of 10000 on 2024-2026 "
            "(GD+PPG+form+H2H/nemesis); U/O 2.5=Poisson"
        )
        notes = str(method.get("notes") or "")
        method["notes"] = notes.replace("핸디캡·언더오버는 포아송", "U/O 2.5는 포아송")
    for match in data.get("matches") or []:
        if isinstance(match, dict):
            slim_match(match)
    data["summary"] = rebuild_summary(data.get("matches") or [])


def current_rounds(matches: list[dict]) -> dict[str, int]:
    today = now_kst().strftime("%Y-%m-%d")
    out: dict[str, int] = {}
    for lg in ("K1", "K2"):
        rows = [m for m in matches if m.get("league") == lg]
        if not rows:
            out[lg] = 1
            continue
        upcoming: list[tuple[str, int]] = []
        max_rnd = 1
        for m in rows:
            try:
                rnd = int(m.get("round"))
            except (TypeError, ValueError):
                continue
            max_rnd = max(max_rnd, rnd)
            if m.get("finished"):
                continue
            d = str(m.get("date") or "9999-99-99")
            upcoming.append((d, rnd))
        future = [x for x in upcoming if x[0] >= today]
        pool = future or upcoming
        if not pool:
            out[lg] = max_rnd
            continue
        pool.sort(key=lambda x: (x[0], x[1]))
        out[lg] = pool[0][1]
    return out


def load_league() -> dict:
    if not PROTO_DATA.exists():
        raise FileNotFoundError(f"missing {PROTO_DATA}")
    try:
        return json.loads(PROTO_DATA.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"league.json parse failed: {exc}") from exc


def season_of(data: dict) -> str:
    s = data.get("season")
    if s is None or s == "":
        return ""
    return str(s)


def empty_season(old: dict, year: str) -> dict:
    try:
        season_val: int | str = int(year)
    except ValueError:
        season_val = year
    method = old.get("method")
    if not isinstance(method, dict):
        method = {}
    return {
        "generated_at": now_kst().strftime("%Y-%m-%d %H:%M:%S"),
        "season": season_val,
        "current_round": {"K1": 1, "K2": 1},
        "method": method,
        "summary": {},
        "matches": [],
    }


def archive_and_reset_if_new_season(data: dict) -> dict:
    old = season_of(data)
    if not old:
        try:
            data["season"] = int(YEAR)
        except ValueError:
            data["season"] = YEAR
        return data
    if old == YEAR:
        return data
    archive = PROTO_DIR / f"league_{old}.json"
    try:
        if not archive.exists():
            archive.write_text(
                json.dumps(data, ensure_ascii=False, indent=2) + "\n",
                encoding="utf-8",
            )
            print(f"[INFO] archived {old} season -> {archive.name}")
        else:
            print(f"[INFO] archive exists {archive.name}, starting {YEAR}")
    except OSError as exc:
        raise RuntimeError(f"archive {archive} failed: {exc}") from exc
    n = len(data.get("matches") or [])
    print(f"[INFO] new season {YEAR}; cleared {n} matches from {old}")
    return empty_season(data, YEAR)


def save_league(data: dict) -> None:
    PROTO_DIR.mkdir(parents=True, exist_ok=True)
    try:
        data["season"] = int(YEAR)
    except ValueError:
        data["season"] = YEAR
    text = json.dumps(data, ensure_ascii=False, indent=2)
    PROTO_DATA.write_text(text + "\n", encoding="utf-8")


def import_portal():
    sys.path.insert(0, str(C_REPORT_SCRIPTS))
    try:
        from collect_chalkboard import (  # noqa: WPS433
            MAIN_FRAME,
            ROUND_LIST,
            PortalClient,
            fetch_matches,
            parse_official_score,
        )
    except ImportError as exc:
        raise RuntimeError(f"cannot import portal helpers: {exc}") from exc
    return PortalClient, fetch_matches, parse_official_score, MAIN_FRAME, ROUND_LIST


def fetch_official(
    client,
    parse_official_score,
    main_frame: str,
    year: str,
    meet_seq: str,
    round_id: str,
    game_id: str,
) -> tuple[int, int] | None:
    try:
        html = client.request(
            main_frame,
            data={
                "meetYear": year,
                "meetSeq": meet_seq,
                "roundId": round_id,
                "gameId": game_id,
                "selectedMenuCd": "0302",
            },
        )
    except Exception as exc:
        print(f"[WARN] score fetch failed game={game_id}: {exc}")
        return None
    return parse_official_score(html)


def fetch_rounds_labeled(client, round_list_url: str, meet_seq: str) -> list[tuple[str, str]]:
    try:
        text = client.request(
            round_list_url,
            data={"meetYear": YEAR, "meetSeq": meet_seq},
        )
        payload = json.loads(text)
    except Exception as exc:
        print(f"[WARN] meet={meet_seq} round list failed: {exc}")
        return []
    tag = payload.get("optionTag") or ""
    out: list[tuple[str, str]] = []
    for m in re.finditer(r'<option\s+value="(\d+)"[^>]*>(.*?)</option>', tag, flags=re.I | re.S):
        rid = m.group(1)
        label = unescape(re.sub(r"<[^>]+>", " ", m.group(2)))
        label = re.sub(r"\s+", " ", label).strip()
        out.append((rid, label))
    return out


def meet_kind(meet_seq: str, labels: list[tuple[str, str]]) -> tuple[str, str] | None:
    blob = " ".join(lab for _, lab in labels)
    if any(k in blob for k in ("컵", "CUP", "Cup")):
        return None
    if meet_seq == "1":
        return ("K1", "league")
    if meet_seq == "2":
        return ("K2", "league")
    if any(k in blob for k in ("승강", "플레이오프", "P.O", "PO")):
        return ("K1", "playoff")
    if any(k in blob for k in ("파이널", "파이날")):
        return ("K1", "final")
    return None


def mapped_round(kind: str, portal_round: int) -> int:
    if kind == "playoff":
        return PO_ROUND_BASE + max(portal_round, 1) - 1
    return portal_round


def iso_date(date_md: str) -> str:
    md = str(date_md or "").replace(".", "/").strip()
    parts = md.split("/")
    if len(parts) != 2:
        return ""
    try:
        month = int(parts[0])
        day = int(parts[1])
    except ValueError:
        return ""
    if month < 1 or month > 12 or day < 1 or day > 31:
        return ""
    return f"{YEAR}-{month:02d}-{day:02d}"


def display_book(matches: list[dict]) -> dict[str, str]:
    book: dict[str, str] = {}
    for m in matches:
        for side in ("home", "away"):
            name = str(m.get(side) or "")
            key = key_team(name)
            if key and key not in book:
                book[key] = name
    return book


def canon_name(book: dict[str, str], raw: str) -> str:
    key = key_team(raw)
    return book.get(key) or str(raw or "").strip()


def match_fingerprint(league: str, home: str, away: str, rnd: int) -> tuple:
    return (league, key_team(home), key_team(away), int(rnd))


def poisson_pmf(lmb: float, k: int) -> float:
    if lmb <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lmb) * (lmb ** k) / math.factorial(k)


def team_record(rows: list[dict], team: str) -> dict:
    key = key_team(team)
    w = d = l = 0
    gf = ga = 0.0
    form: list[str] = []
    for m in rows:
        score = m.get("score")
        if not isinstance(score, list) or len(score) < 2:
            continue
        try:
            hs, aws = int(score[0]), int(score[1])
        except (TypeError, ValueError):
            continue
        home_key = key_team(m.get("home") or "")
        away_key = key_team(m.get("away") or "")
        if home_key == key:
            gf += hs
            ga += aws
            if hs > aws:
                res = "W"
                w += 1
            elif hs < aws:
                res = "L"
                l += 1
            else:
                res = "D"
                d += 1
        elif away_key == key:
            gf += aws
            ga += hs
            if aws > hs:
                res = "W"
                w += 1
            elif aws < hs:
                res = "L"
                l += 1
            else:
                res = "D"
                d += 1
        else:
            continue
        form.append(res)
    games = w + d + l
    return {
        "form": "".join(form[-5:]) if form else "-",
        "record": f"{w}-{d}-{l}",
        "pts": w * 3 + d,
        "gf": gf,
        "ga": ga,
        "games": games,
    }


def prior_finished(matches: list[dict], league: str, before: str) -> list[dict]:
    out = []
    for m in matches:
        if m.get("league") != league or not m.get("finished"):
            continue
        d = str(m.get("date") or "")
        if not d:
            continue
        if before and d >= before:
            continue
        out.append(m)
    return out


def poisson_preview(matches: list[dict], league: str, home: str, away: str, date: str) -> dict:
    prior = prior_finished(matches, league, date)
    home_rec = team_record(prior, home)
    away_rec = team_record(prior, away)
    home_gf = []
    home_ga = []
    away_gf = []
    away_ga = []
    for m in prior:
        score = m.get("score")
        if not isinstance(score, list) or len(score) < 2:
            continue
        try:
            hs, aws = int(score[0]), int(score[1])
        except (TypeError, ValueError):
            continue
        home_gf.append(hs)
        home_ga.append(aws)
        away_gf.append(aws)
        away_ga.append(hs)
    avg_hg = sum(home_gf) / len(home_gf) if home_gf else 1.2
    avg_ag = sum(away_gf) / len(away_gf) if away_gf else 1.0

    def split_avg(team: str, ha: str) -> tuple[float, float]:
        gf_list = []
        ga_list = []
        key = key_team(team)
        for m in prior:
            score = m.get("score")
            if not isinstance(score, list) or len(score) < 2:
                continue
            try:
                hs, aws = int(score[0]), int(score[1])
            except (TypeError, ValueError):
                continue
            if ha == "H" and key_team(m.get("home") or "") == key:
                gf_list.append(hs)
                ga_list.append(aws)
            elif ha == "A" and key_team(m.get("away") or "") == key:
                gf_list.append(aws)
                ga_list.append(hs)
        if not gf_list:
            return avg_hg if ha == "H" else avg_ag, avg_ag if ha == "H" else avg_hg
        return sum(gf_list) / len(gf_list), sum(ga_list) / len(ga_list)

    h_att, h_def = split_avg(home, "H")
    a_att, a_def = split_avg(away, "A")
    xh = max(0.25, min(4.0, (h_att * a_def / max(avg_ag, 0.4) + avg_hg) / 2.0))
    xa = max(0.25, min(4.0, (a_att * h_def / max(avg_hg, 0.4) + avg_ag) / 2.0))

    p_home = p_draw = p_away = 0.0
    p_under = 0.0
    for i in range(GOAL_CAP + 1):
        pi = poisson_pmf(xh, i)
        for j in range(GOAL_CAP + 1):
            pj = poisson_pmf(xa, j)
            p = pi * pj
            if i > j:
                p_home += p
            elif i == j:
                p_draw += p
            else:
                p_away += p
            if i + j <= 2:
                p_under += p
    tot = p_home + p_draw + p_away
    if tot <= 0:
        tot = 1.0
    p_home /= tot
    p_draw /= tot
    p_away /= tot
    p_over = max(0.0, 1.0 - p_under)
    wdl_pick = "승"
    wdl_p = p_home
    if p_draw >= wdl_p:
        wdl_pick, wdl_p = "무", p_draw
    if p_away >= wdl_p:
        wdl_pick, wdl_p = "패", p_away
    ou_pick = "언더" if p_under >= p_over else "오버"
    ou_p = p_under if ou_pick == "언더" else p_over
    return {
        "xg": {"home": round(xh, 3), "away": round(xa, 3)},
        "form": {
            "home": home_rec["form"],
            "away": away_rec["form"],
            "home_record": home_rec["record"],
            "away_record": away_rec["record"],
            "home_pts": home_rec["pts"],
            "away_pts": away_rec["pts"],
            "home_gf": home_rec["gf"],
            "home_ga": home_rec["ga"],
            "away_gf": away_rec["gf"],
            "away_ga": away_rec["ga"],
        },
        "picks": {
            "wdl": {
                "pick": wdl_pick,
                "prob": round(wdl_p, 4),
                "dist": {
                    "승": round(p_home, 4),
                    "무": round(p_draw, 4),
                    "패": round(p_away, 4),
                },
                "line": None,
            },
            "ou25": {
                "pick": ou_pick,
                "prob": round(ou_p, 4),
                "dist": {
                    "언더": round(p_under, 4),
                    "오버": round(p_over, 4),
                },
                "line": "U/O 2.5",
            },
        },
    }


def build_new_match(
    league: str,
    rnd: int,
    home: str,
    away: str,
    date: str,
    date_md: str,
    kind: str,
    existing: list[dict],
) -> dict:
    prev = poisson_preview(existing, league, home, away, date)
    wdl = prev["picks"]["wdl"]["pick"]
    ou = prev["picks"]["ou25"]["pick"]
    stage = "승강 플레이오프" if kind == "playoff" else ("파이널 라운드" if rnd >= 34 else "정규 라운드")
    xh = prev["xg"]["home"]
    xa = prev["xg"]["away"]
    dist = prev["picks"]["wdl"]["dist"]
    oud = prev["picks"]["ou25"]["dist"]
    mid = f"{league}-{rnd}-{home}-{away}-{date or 'tbd'}"
    return {
        "id": mid,
        "league": league,
        "round": rnd,
        "date": date,
        "time": "",
        "home": home,
        "away": away,
        "venue": "",
        "finished": False,
        "score": None,
        "form": prev["form"],
        "picks": prev["picks"],
        "actual": None,
        "hit": None,
        "reason": {
            "headline": f"승무패 {wdl} · U/O 2.5 {ou} (신뢰 보통)",
            "paragraphs": [
                f"킥오프 직전 {league} 종료 경기만 사용한다. {stage}.",
                f"홈 {home} 최근 폼 {prev['form']['home']} ({prev['form']['home_record']}, 승점 {prev['form']['home_pts']}). "
                f"원정 {away} 최근 폼 {prev['form']['away']} ({prev['form']['away_record']}, 승점 {prev['form']['away_pts']}).",
                "27R 이후 승무패와 U/O 2.5는 같은 포아송 스코어 행렬에서 뽑는다. 1–26R 승무패 픽은 기존 워크포워드를 유지한다.",
                f"포아송 기대득점은 홈 {xh}골, 원정 {xa}골이다.",
                f"승무패 추정은 홈승 {dist['승']*100:.1f}%, 무 {dist['무']*100:.1f}%, 원정승 {dist['패']*100:.1f}%. 픽 {wdl}.",
                f"언더오버 2.5: 언더 {oud['언더']*100:.1f}% / 오버 {oud['오버']*100:.1f}% → 픽 {ou}.",
            ],
        },
        "xg": prev["xg"],
        "confidence": "보통",
        "date_md": date_md,
        "stage": kind,
    }


def load_local_k1_rows() -> list[dict]:
    path = ROOT / "c_report" / "data" / "schedule.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    rows = []
    for row in payload.get("matches") or []:
        if str(row.get("year") or "") != str(YEAR):
            continue
        try:
            rnd = int(row.get("round"))
        except (TypeError, ValueError):
            continue
        home = row.get("home") or ""
        away = row.get("away") or ""
        if not home or not away:
            continue
        rows.append(
            {
                "league": "K1",
                "round": rnd,
                "home": home,
                "away": away,
                "end_yn": str(row.get("end_yn") or "N").upper(),
                "date_md": row.get("date_md") or "",
                "game_id": str(row.get("game_id") or ""),
                "kind": "league",
                "meet_seq": "1",
            }
        )
    return rows


def apply_scores(data: dict, scores: dict) -> int:
    updated = 0
    for match in data.get("matches") or []:
        if match.get("finished") and match.get("score"):
            continue
        lg = match.get("league")
        try:
            rnd = int(match.get("round"))
        except (TypeError, ValueError):
            continue
        key = (lg, key_team(match.get("home") or ""), key_team(match.get("away") or ""), rnd)
        score = scores.get(key)
        if not score:
            continue
        hs, aws = score
        act = actuals(hs, aws)
        match["finished"] = True
        match["score"] = [hs, aws]
        match["actual"] = act
        match["hit"] = hits_for(match, act)
        updated += 1
        print(
            f"[APPLY] {lg} R{rnd} {match.get('home')} {hs}:{aws} {match.get('away')} "
            f"wdl={act['wdl']}"
        )
    return updated


def main() -> int:
    try:
        data = load_league()
    except (FileNotFoundError, RuntimeError) as exc:
        print(f"[ERR] {exc}")
        return 1
    try:
        data = archive_and_reset_if_new_season(data)
    except RuntimeError as exc:
        print(f"[ERR] {exc}")
        return 1
    slim_only = os.environ.get("SLIM_ONLY", "").lower() in ("1", "true", "yes")
    if slim_only:
        slim_league_data(data)
        data["generated_at"] = now_kst().strftime("%Y-%m-%d %H:%M:%S")
        try:
            save_league(data)
        except OSError as exc:
            print(f"[ERR] write failed: {exc}")
            return 1
        print(f"[DONE] slim-only current_round={data.get('current_round')} path={PROTO_DATA}")
        return 0

    PortalClient, fetch_matches, parse_official_score, MAIN_FRAME, ROUND_LIST = import_portal()
    client = PortalClient()
    try:
        client.login_guest()
    except Exception as exc:
        print(f"[ERR] portal login failed: {exc}")
        return 1

    catalog: list[dict] = []
    seen_fp: set[tuple] = set()
    meet_jobs: list[tuple[str, str]] = list(MEETS)
    for extra in EXTRA_MEET_SEQS:
        if extra not in {m[1] for m in meet_jobs}:
            meet_jobs.append(("?", extra))

    for league_hint, meet_seq in meet_jobs:
        labeled = fetch_rounds_labeled(client, ROUND_LIST, meet_seq)
        if not labeled:
            continue
        classified = meet_kind(meet_seq, labeled)
        if classified is None:
            print(f"[SKIP] meet={meet_seq} (cup or unknown)")
            continue
        league, kind = classified
        if league_hint in ("K1", "K2") and league != league_hint:
            league = league_hint
        print(f"[INFO] meet={meet_seq} league={league} kind={kind} rounds={len(labeled)}")
        for rid, label in labeled:
            try:
                portal_round = int(rid)
            except ValueError:
                continue
            rnd = mapped_round(kind, portal_round)
            try:
                rows = fetch_matches(client, YEAR, meet_seq, str(rid))
            except Exception as exc:
                print(f"[WARN] {league} R{rid} list failed: {exc}")
                continue
            time.sleep(0.08)
            for row in rows:
                home = row.get("home") or ""
                away = row.get("away") or ""
                if not home or not away:
                    continue
                fp = match_fingerprint(league, home, away, rnd)
                if fp in seen_fp:
                    continue
                seen_fp.add(fp)
                catalog.append(
                    {
                        "league": league,
                        "round": rnd,
                        "home": home,
                        "away": away,
                        "end_yn": str(row.get("end_yn") or "N").upper(),
                        "date_md": row.get("date_md") or "",
                        "game_id": str(row.get("game_id") or ""),
                        "kind": kind,
                        "meet_seq": meet_seq,
                        "portal_round": str(rid),
                    }
                )

    for row in load_local_k1_rows():
        fp = match_fingerprint(row["league"], row["home"], row["away"], row["round"])
        if fp in seen_fp:
            continue
        seen_fp.add(fp)
        catalog.append(row)
        print(
            f"[LOCAL] {row['league']} R{row['round']} {row['home']} vs {row['away']}"
        )

    matches = list(data.get("matches") or [])
    book = display_book(matches)
    existing = {
        match_fingerprint(
            str(m.get("league") or ""),
            str(m.get("home") or ""),
            str(m.get("away") or ""),
            int(m.get("round") or 0),
        )
        for m in matches
        if m.get("round") is not None
    }
    added = 0
    for row in catalog:
        home = canon_name(book, row["home"])
        away = canon_name(book, row["away"])
        book[key_team(home)] = home
        book[key_team(away)] = away
        fp = match_fingerprint(row["league"], home, away, row["round"])
        if fp in existing:
            continue
        date = iso_date(row.get("date_md") or "")
        newbie = build_new_match(
            row["league"],
            row["round"],
            home,
            away,
            date,
            row.get("date_md") or "",
            row.get("kind") or "league",
            matches,
        )
        matches.append(newbie)
        existing.add(fp)
        added += 1
        print(
            f"[ADD] {row['league']} R{row['round']} {home} vs {away} "
            f"{date or row.get('date_md')}"
        )
    data["matches"] = matches
    print(f"[INFO] added fixtures={added} total={len(matches)}")

    pending = [m for m in matches if not m.get("finished")]
    scores: dict[tuple, tuple[int, int]] = {}
    fetch_jobs = []
    pending_fp = {
        match_fingerprint(
            str(m.get("league") or ""),
            str(m.get("home") or ""),
            str(m.get("away") or ""),
            int(m.get("round") or 0),
        )
        for m in pending
        if m.get("round") is not None
    }
    for row in catalog:
        fp = match_fingerprint(row["league"], row["home"], row["away"], row["round"])
        # also match canon names
        fp2 = match_fingerprint(
            row["league"],
            canon_name(book, row["home"]),
            canon_name(book, row["away"]),
            row["round"],
        )
        if fp not in pending_fp and fp2 not in pending_fp:
            continue
        gid = row.get("game_id") or ""
        if not gid:
            continue
        end_yn = row.get("end_yn") or "N"
        fetch_jobs.append((row, gid, end_yn))

    print(f"[INFO] score fetches={len(fetch_jobs)} pending={len(pending)}")
    for row, gid, end_yn in fetch_jobs:
        meet_seq = str(row.get("meet_seq") or "1")
        portal_round = str(row.get("portal_round") or row.get("round") or "")
        score = fetch_official(
            client,
            parse_official_score,
            MAIN_FRAME,
            YEAR,
            meet_seq,
            portal_round,
            gid,
        )
        time.sleep(0.12)
        if score is None:
            continue
        hs, aws = score
        if end_yn != "Y" and hs == 0 and aws == 0:
            continue
        home = canon_name(book, row["home"])
        away = canon_name(book, row["away"])
        scores[(row["league"], key_team(home), key_team(away), int(row["round"]))] = (hs, aws)
        print(
            f"[OK] {row['league']} R{row['round']} {home} {hs}:{aws} {away} end={end_yn}"
        )

    updated = apply_scores(data, scores)
    leftover = []
    for match in data.get("matches") or []:
        if match.get("finished"):
            continue
        leftover.append(
            f"{match.get('league')} R{match.get('round')} "
            f"{key_team(match.get('home') or '')} vs {key_team(match.get('away') or '')} "
            f"({match.get('home')} / {match.get('away')})"
        )
    print(f"[INFO] still unfinished={len(leftover)}")
    data["summary"] = rebuild_summary(data.get("matches") or [])
    data["current_round"] = current_rounds(data.get("matches") or [])
    slim_league_data(data)
    data["generated_at"] = now_kst().strftime("%Y-%m-%d %H:%M:%S")
    try:
        save_league(data)
    except OSError as exc:
        print(f"[ERR] write failed: {exc}")
        return 1
    print(
        f"[DONE] added={added} scored={updated} current_round={data['current_round']} "
        f"path={PROTO_DATA}"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERR] {exc}")
        sys.exit(1)
