#!/usr/bin/env python3
"""
Build JEONBUK MATCH AI PREVIEW payloads for upcoming Jeonbuk fixtures.

Window: kickoff within the next PREVIEW_HOURS (default 48).
Also always refreshes the next unfinished Jeonbuk match as a draft
(published=false) so editors can review early.

Reads:
  - c_report/data/schedule.json
  - c_report/data/index.json
  - c_report/data chalkboard JSON (2026: {game_id}.json, later: {year}/{game_id}.json)
  - c_report/data/club-attendance.json (optional)

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
EXCLUSIONS_PATH = OUT_DIR / "lineup_exclusions.json"

PREVIEW_HOURS = float(os.environ.get("PREVIEW_HOURS") or "48")
OTHER_PREVIEW_DAYS = float(os.environ.get("OTHER_PREVIEW_DAYS") or "7")
LEGACY_FLAT_YEAR = "2026"
META_JSON = ("index.json", "schedule.json", "club-attendance.json", "collected.json")
YELLOW_BAN_EVERY = 5  # legacy; real thresholds are 5 then +3 then +2
_YELLOW_LEDGER_CACHE: dict[str, dict[str, list[dict]]] = {}
_TEAM_FINISHED_GAMES_CACHE: dict[str, list[str]] = {}


def kleague_year() -> str:
    env = (os.environ.get("KLEAGUE_YEAR") or "").strip()
    if env:
        return env
    return str(datetime.now(timezone(timedelta(hours=9))).year)


YEAR = kleague_year()
JEONBUK = "전북"
KST = timezone(timedelta(hours=9))

TEAM_IDS = {
    "울산": "K01",
    "포항": "K03",
    "제주": "K04",
    "전북": "K05",
    "서울": "K09",
    "대전": "K10",
    "인천": "K18",
    "강원": "K21",
    "광주": "K22",
    "부천": "K26",
    "안양": "K27",
    "김천": "K35",
}

VENUE_BY_HOME = {
    "전북": "전주 월드컵",
    "김천": "김천 종합",
    "울산": "울산 문수",
    "포항": "포항 스틸야드",
    "제주": "제주 월드컵",
    "서울": "서울 월드컵",
    "대전": "대전 월드컵",
    "인천": "인천 전용",
    "강원": "강릉하이원아레나",
    "광주": "광주 월드컵",
    "부천": "부천 종합",
    "안양": "안양 종합",
}


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


def team_id_for(name: str) -> str:
    key = (name or "").strip()
    return TEAM_IDS.get(key, "")


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


def blank_team_row() -> dict:
    return {
        "shots": 0,
        "sot": 0,
        "goals": 0,
        "xg": 0.0,
        "passes": 0,
        "pass_ok": 0,
        "tackles": 0,
        "dribbles": 0,
        "fouls": 0,
        "presses": 0,
        "interceptions": 0,
        "clearances": 0,
        "aerial_won": 0,
        "touches": 0,
        "final_third": 0,
    }


def team_perspective_point(event: dict, home_id: str) -> tuple[float, float] | None:
    try:
        x0 = float(event.get("START_POINT_X"))
        y0 = float(event.get("START_POINT_Y"))
    except (TypeError, ValueError):
        return None
    period = int(event.get("PERIOD_ID") or 1)
    flip = period == 2
    x = (100 - x0) if flip else x0
    y = (100 - y0) if flip else y0
    if str(event.get("TEAM_ID") or "") != str(home_id):
        x = 100 - x
        y = 100 - y
    if not (0 <= x <= 100 and 0 <= y <= 100):
        return None
    return x, y


def zone_share(events: list, team_id: str, home_id: str) -> dict:
    n = 0
    sum_x = 0.0
    final_third = 0
    for e in events:
        if str(e.get("TEAM_ID") or "") != str(team_id):
            continue
        if e.get("TYPE_CD") not in ("PS", "ST", "DF", "DU", "FO"):
            continue
        pt = team_perspective_point(e, home_id)
        if not pt:
            continue
        x, _y = pt
        n += 1
        sum_x += x
        if x >= 66:
            final_third += 1
    return {
        "avg_x": round(sum_x / n, 1) if n else 50.0,
        "final_third_pct": round(100.0 * final_third / n, 1) if n else 0.0,
        "touches": n,
    }


def team_row_from_events(events: list, team_id: str, home_id: str) -> dict:
    row = blank_team_row()
    if not team_id:
        return row
    tid = str(team_id)
    for e in events:
        if str(e.get("TEAM_ID") or "") != tid:
            continue
        row["touches"] += 1
        d = e.get("TYPE_DETAIL_CD")
        if e.get("TYPE_CD") == "ST":
            row["shots"] += 1
            row["xg"] += float(e.get("EXPECTED_GOAL") or 0)
            if d == "GL":
                row["goals"] += 1
        if e.get("TYPE_CD") == "PS":
            row["passes"] += 1
            if d == "PSS":
                row["pass_ok"] += 1
        if d in ("TKS", "TKU"):
            row["tackles"] += 1
        if d in ("DS", "DU"):
            row["dribbles"] += 1
        if d == "FOC":
            row["fouls"] += 1
        if d in ("OPCS", "OPCU"):
            row["presses"] += 1
        if d in ("INT", "CUT"):
            row["interceptions"] += 1
        if d == "CLG":
            row["clearances"] += 1
        if d == "ADW":
            row["aerial_won"] += 1

    zone = zone_share(events, tid, home_id)
    row["final_third"] = zone["touches"]
    row["final_third_pct"] = zone["final_third_pct"]
    row["avg_x"] = zone["avg_x"]

    row["sot"] = sum(
        1
        for e in events
        if str(e.get("TEAM_ID") or "") == tid
        and e.get("TYPE_CD") == "ST"
        and (
            e.get("TYPE_DETAIL_CD") == "GL"
            or (
                e.get("TYPE_DETAIL_CD") not in ("MST", "BT", "STB")
                and e.get("SHOT_GOALPOST_SITE")
            )
        )
    )
    row["xg"] = round(row["xg"], 2)
    if row["passes"]:
        row["pass_pct"] = round(100.0 * row["pass_ok"] / row["passes"], 1)
    else:
        row["pass_pct"] = 0.0
    return row


def parse_match_file(path: Path, year: str | None = None) -> dict | None:
    data = load_json(path)
    if not isinstance(data, dict):
        return None
    meta = data.get("meta") or {}
    home = meta.get("home") or {}
    away = meta.get("away") or {}
    home_id = str(home.get("team_id") or "")
    away_id = str(away.get("team_id") or "")
    if not home_id or not away_id:
        return None
    events = data.get("events") or []
    score = meta.get("score") or {}
    score_txt = f"{score.get('home', '-')}:{score.get('away', '-')}"
    return {
        "game_id": str(meta.get("game_id") or path.stem),
        "year": str(meta.get("meet_year") or year or YEAR),
        "round": meta.get("round"),
        "date": meta.get("date") or "",
        "home": home.get("name") or "",
        "away": away.get("name") or "",
        "home_id": home_id,
        "away_id": away_id,
        "score": score_txt,
        "venue": meta.get("venue") or "",
        "attendance": meta.get("attendance"),
        "stats": {
            home_id: team_row_from_events(events, home_id, home_id),
            away_id: team_row_from_events(events, away_id, home_id),
        },
    }


def match_catalog_key(year: str, gid: str) -> str:
    return f"{year}|{gid}"


def iter_c_match_paths() -> list[tuple[str, Path]]:
    rows: list[tuple[str, Path]] = []
    if not C_DATA.exists():
        return rows
    for path in C_DATA.glob("*.json"):
        if path.name in META_JSON:
            continue
        if path.stem.isdigit():
            rows.append((LEGACY_FLAT_YEAR, path))
    for folder in sorted(C_DATA.glob("20[0-9][0-9]")):
        if not folder.is_dir():
            continue
        for path in folder.glob("*.json"):
            if path.stem.isdigit():
                rows.append((folder.name, path))
    return rows


def load_match_catalog() -> dict[str, dict]:
    catalog: dict[str, dict] = {}
    for year, path in iter_c_match_paths():
        parsed = parse_match_file(path, year)
        if parsed:
            catalog[match_catalog_key(str(parsed.get("year") or year), parsed["game_id"])] = parsed
    return catalog


def recent_form_catalog(catalog: dict[str, dict], team: str, limit: int = 5) -> list[dict]:
    rows = []
    for m in catalog.values():
        home, away = m.get("home") or "", m.get("away") or ""
        if team not in home and team not in away:
            continue
        team_id = m["home_id"] if team in home else m["away_id"]
        opp_id = m["away_id"] if team in home else m["home_id"]
        st = m["stats"].get(team_id, blank_team_row())
        opp_st = m["stats"].get(opp_id, blank_team_row())
        rows.append(
            {
                "game_id": m["game_id"],
                "year": m.get("year") or YEAR,
                "round": m.get("round"),
                "date": m.get("date") or "",
                "home": home,
                "away": away,
                "score": m.get("score") or "",
                "result": result_for(team, home, away, m.get("score") or ""),
                "opponent": away if team in home else home,
                "ha": "H" if team in home else "A",
                "xg": st.get("xg", 0),
                "xga": opp_st.get("xg", 0),
                "shots": st.get("shots", 0),
                "sot": st.get("sot", 0),
                "goals_for": st.get("goals", 0),
                "goals_against": opp_st.get("goals", 0),
            }
        )
    rows.sort(key=lambda x: (str(x.get("date") or ""), int(x.get("round") or 0)))
    return rows[-limit:]


def schedule_date_iso(row: dict) -> str:
    year = str(row.get("year") or YEAR)
    md = (row.get("date_md") or "").strip()
    m = re.match(r"^(\d{1,2})/(\d{1,2})$", md)
    if not m:
        return ""
    try:
        return f"{year}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    except ValueError:
        return ""


def index_by_game_id(index_matches: list[dict]) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for m in index_matches:
        gid = str(m.get("game_id") or "")
        if gid:
            out[match_catalog_key(str(m.get("year") or YEAR), gid)] = m
    return out


def form_row_from_schedule(row: dict, team: str, idx: dict[str, dict]) -> dict:
    gid = str(row.get("game_id") or "")
    home = row.get("home") or ""
    away = row.get("away") or ""
    opp = away if team in home else home
    ha = "H" if team in home else "A"
    hit = idx.get(match_catalog_key(str(row.get("year") or YEAR), gid)) or {}
    score = (hit.get("score") or "").strip()
    date = (hit.get("date") or "").strip() or schedule_date_iso(row)
    return {
        "game_id": gid,
        "year": str(row.get("year") or YEAR),
        "round": row.get("round"),
        "date": date,
        "home": home,
        "away": away,
        "score": score or "-",
        "result": result_for(team, home, away, score) if score else "?",
        "opponent": opp,
        "ha": ha,
        "xg": None,
        "xga": None,
        "shots": None,
        "sot": None,
        "goals_for": None,
        "goals_against": None,
        "stats_limited": True,
    }


def schedule_already_played(row: dict) -> bool:
    """Treat a fixture as played even if schedule.json still has end_yn=N.

    Jeonbuk-only collects often leave other-team results marked unfinished.
    """
    if str(row.get("end_yn") or "N").upper() == "Y":
        return True
    kickoff = parse_md_kickoff(str(row.get("year") or YEAR), str(row.get("date_md") or ""))
    if not kickoff:
        return False
    return now_kst() - kickoff >= timedelta(hours=2)


def recent_form_merged(
    catalog: dict[str, dict],
    schedule_matches: list[dict],
    index_matches: list[dict],
    team: str,
    limit: int = 5,
) -> list[dict]:
    idx = index_by_game_id(index_matches)
    by_key: dict[str, dict] = {}
    for r in recent_form_catalog(catalog, team, 999):
        by_key[match_catalog_key(str(r.get("year") or YEAR), str(r["game_id"]))] = r
    for row in schedule_matches:
        if not schedule_already_played(row):
            continue
        home, away = row.get("home") or "", row.get("away") or ""
        if team not in home and team not in away:
            continue
        gid = str(row.get("game_id") or "")
        key = match_catalog_key(str(row.get("year") or YEAR), gid)
        if not gid or key in by_key:
            continue
        by_key[key] = form_row_from_schedule(row, team, idx)
    rows = sorted(
        by_key.values(),
        key=lambda x: (str(x.get("date") or ""), int(x.get("round") or 0)),
    )
    return rows[-limit:]


def fetch_scores_for_form(
    form: list[dict],
    team: str,
    schedule_matches: list[dict],
) -> None:
    """Fill score and xG/shots for schedule-only form rows from K League portal."""
    if os.environ.get("FORM_SCORE_FETCH", "1").lower() in ("0", "false", "no"):
        return
    pending = [r for r in form if r.get("stats_limited")]
    if not pending:
        return
    try:
        import sys

        script_dir = str(REPO / "c_report" / "scripts")
        if script_dir not in sys.path:
            sys.path.insert(0, script_dir)
        from collect_chalkboard import (  # noqa: WPS433
            MAIN_FRAME,
            PortalClient,
            extract_js_array,
            parse_official_score,
            resolve_match_score,
        )
    except Exception as exc:
        print(f"[WARN] form portal fetch unavailable: {exc}")
        return

    sched_by_id = {
        match_catalog_key(str(m.get("year") or YEAR), str(m.get("game_id"))): m
        for m in schedule_matches
        if m.get("game_id")
    }
    client = PortalClient()
    try:
        client.login_guest()
    except Exception as exc:
        print(f"[WARN] guest login failed: {exc}")
        return

    for r in pending:
        gid = str(r.get("game_id") or "")
        sched = sched_by_id.get(match_catalog_key(str(r.get("year") or YEAR), gid)) or {}
        year = str(sched.get("year") or r.get("year") or YEAR)
        round_id = str(sched.get("round") or r.get("round") or "")
        if not round_id:
            continue
        home = r.get("home") or sched.get("home") or ""
        away = r.get("away") or sched.get("away") or ""
        try:
            html = client.request(
                MAIN_FRAME,
                data={
                    "meetYear": year,
                    "meetSeq": "1",
                    "roundId": round_id,
                    "gameId": gid,
                    "selectedMenuCd": "0302",
                },
            )
            events = extract_js_array(html, "jsonResultData") or []
            home_id = next((e.get("TEAM_ID") for e in events if e.get("HA_CODE") == "H"), None)
            away_id = next((e.get("TEAM_ID") for e in events if e.get("HA_CODE") == "A"), None)
            if not home_id:
                home_id = team_id_for(home) or None
            if not away_id:
                away_id = team_id_for(away) or None

            hs = aws = None
            score_source = ""
            if home_id and away_id and events:
                hs, aws, score_source = resolve_match_score(
                    html, events, str(home_id), str(away_id)
                )
            else:
                official = parse_official_score(html)
                if official is not None:
                    hs, aws = official
                    score_source = "official"
                elif events and home_id and away_id:
                    from collect_chalkboard import parse_score_from_goals  # noqa: WPS433

                    hs, aws = parse_score_from_goals(events, str(home_id), str(away_id))
                    score_source = "events"

            if hs is None or aws is None:
                print(f"[WARN] portal form fetch no score game_id={gid}")
                continue

            score = f"{hs}:{aws}"
            r["score"] = score
            r["result"] = result_for(team, home, away, score)
            r["goals_for"] = hs if team in home else aws
            r["goals_against"] = aws if team in home else hs
            r["score_source"] = score_source

            if events and home_id and away_id:
                tid = home_id if team in home else away_id
                oid = away_id if team in home else home_id
                st = team_row_from_events(events, str(tid), str(home_id))
                ost = team_row_from_events(events, str(oid), str(home_id))
                r["xg"] = st.get("xg", 0)
                r["xga"] = ost.get("xg", 0)
                r["shots"] = st.get("shots", 0)
                r["sot"] = st.get("sot", 0)
                r["pass_pct"] = st.get("pass_pct", 0)
                r["final_third_pct"] = st.get("final_third_pct", 0)
                r["presses"] = st.get("presses", 0)
                r["stats_source"] = "portal"
            else:
                # Score filled; chalkboard events missing — keep limited stats flag off for result.
                r["stats_source"] = "portal_score_only"
            r["stats_limited"] = False
            print(f"[OK] form score {home} {score} {away} (game_id={gid}, {score_source})")
        except Exception as exc:
            print(f"[WARN] portal form fetch game_id={gid}: {exc}")


def h2h_rows(catalog: dict[str, dict], opponent: str, limit: int = 5) -> list[dict]:
    out = []
    for m in catalog.values():
        home, away = m.get("home") or "", m.get("away") or ""
        if JEONBUK not in f"{home}{away}":
            continue
        if opponent not in f"{home}{away}":
            continue
        out.append(
            {
                "game_id": m["game_id"],
                "round": m.get("round"),
                "date": m.get("date") or "",
                "home": home,
                "away": away,
                "score": m.get("score") or "",
                "result": result_for(JEONBUK, home, away, m.get("score") or ""),
                "venue": m.get("venue") or "",
            }
        )
    out.sort(key=lambda x: (str(x.get("date") or ""), int(x.get("round") or 0)))
    return out[-limit:]


def avg_stats(samples: list[dict]) -> dict:
    if not samples:
        return blank_team_row()
    keys = [
        "shots",
        "sot",
        "goals",
        "xg",
        "passes",
        "pass_ok",
        "tackles",
        "dribbles",
        "fouls",
        "presses",
        "interceptions",
        "final_third_pct",
        "pass_pct",
        "avg_x",
    ]
    out = {}
    for k in keys:
        vals = [float(s.get(k) or 0) for s in samples]
        out[k] = round(sum(vals) / len(vals), 2 if k == "xg" else 1)
    out["games"] = len(samples)
    return out


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
    avg = avg_stats(samples)
    avg_xg = float(avg.get("xg") or 0)
    avg_xga = 0.0
    if form:
        xga_vals = [float(r.get("xga") or 0) for r in form if r.get("xga") is not None]
        if xga_vals:
            avg_xga = round(sum(xga_vals) / len(xga_vals), 2)
    avg_shots = float(avg.get("shots") or 0)
    avg_sot = float(avg.get("sot") or 0)
    avg_pass = float(avg.get("pass_pct") or 0)
    avg_ft = float(avg.get("final_third_pct") or 0)
    avg_press = float(avg.get("presses") or 0)
    avg_ax = float(avg.get("avg_x") or 50)

    if avg_xg >= 1.4:
        tags.append("기회 창출↑")
    elif avg_xg and avg_xg < 0.9:
        tags.append("기회 부족")
    if avg_shots >= 12:
        tags.append("슈팅 많음")
    if avg_xga >= 1.3:
        tags.append("수비 기회 허용")
    elif avg_xga and avg_xga < 0.8:
        tags.append("수비 단단")
    if avg_pass >= 82:
        tags.append("패스 안정")
    if avg_ft >= 28:
        tags.append("전진 점유")
    elif avg_ft and avg_ft < 22:
        tags.append("낮은 블록형")
    if avg_press >= 18:
        tags.append("적극 압박")
    if avg_ax >= 54 and "전진 점유" not in tags:
        tags.append("전진 점유")
    elif avg_ax <= 46 and "낮은 블록형" not in tags:
        tags.append("낮은 블록형")
    tags = list(dict.fromkeys(tags))
    if not tags:
        tags.append("데이터 축적 중")

    gf = sum(int(r.get("goals_for") or 0) for r in form)
    ga = sum(int(r.get("goals_against") or 0) for r in form)

    return {
        "name": name,
        "team_id": team_id_for(name),
        "tags": tags[:5],
        "record": f"{wins}승 {draws}무 {losses}패 / 최근 {len(results)}경기",
        "goals_for": gf,
        "goals_against": ga,
        "goal_diff": gf - ga,
        "avg_xg": avg_xg,
        "avg_xga": avg_xga,
        "avg_shots": avg_shots,
        "avg_sot": avg_sot,
        "avg_pass_pct": avg_pass,
        "avg_final_third_pct": avg_ft,
        "avg_presses": avg_press,
        "avg_x": avg_ax,
        "samples": avg.get("games", 0),
    }


def build_matchup(team_a: dict, team_b: dict, name_a: str, name_b: str) -> dict:
    return {
        "rows": [
            {
                "label": "경기당 xG",
                "jeonbuk": team_a.get("avg_xg"),
                "opponent": team_b.get("avg_xg"),
                "better": "jeonbuk"
                if float(team_a.get("avg_xg") or 0) > float(team_b.get("avg_xg") or 0)
                else "opponent"
                if float(team_b.get("avg_xg") or 0) > float(team_a.get("avg_xg") or 0)
                else "even",
            },
            {
                "label": "경기당 xGA(허용 xG)",
                "jeonbuk": team_a.get("avg_xga"),
                "opponent": team_b.get("avg_xga"),
                "better": "jeonbuk"
                if float(team_a.get("avg_xga") or 99) < float(team_b.get("avg_xga") or 99)
                else "opponent"
                if float(team_b.get("avg_xga") or 99) < float(team_a.get("avg_xga") or 99)
                else "even",
            },
            {
                "label": "슈팅",
                "jeonbuk": team_a.get("avg_shots"),
                "opponent": team_b.get("avg_shots"),
                "better": "jeonbuk"
                if float(team_a.get("avg_shots") or 0) > float(team_b.get("avg_shots") or 0)
                else "opponent"
                if float(team_b.get("avg_shots") or 0) > float(team_a.get("avg_shots") or 0)
                else "even",
            },
            {
                "label": "유효슈팅",
                "jeonbuk": team_a.get("avg_sot"),
                "opponent": team_b.get("avg_sot"),
                "better": "jeonbuk"
                if float(team_a.get("avg_sot") or 0) > float(team_b.get("avg_sot") or 0)
                else "opponent"
                if float(team_b.get("avg_sot") or 0) > float(team_a.get("avg_sot") or 0)
                else "even",
            },
            {
                "label": "패스 성공률",
                "jeonbuk": team_a.get("avg_pass_pct"),
                "opponent": team_b.get("avg_pass_pct"),
                "suffix": "%",
                "better": "jeonbuk"
                if float(team_a.get("avg_pass_pct") or 0) > float(team_b.get("avg_pass_pct") or 0)
                else "opponent"
                if float(team_b.get("avg_pass_pct") or 0) > float(team_a.get("avg_pass_pct") or 0)
                else "even",
            },
            {
                "label": "파이널 서드 터치",
                "jeonbuk": team_a.get("avg_final_third_pct"),
                "opponent": team_b.get("avg_final_third_pct"),
                "suffix": "%",
                "better": "jeonbuk"
                if float(team_a.get("avg_final_third_pct") or 0) > float(team_b.get("avg_final_third_pct") or 0)
                else "opponent"
                if float(team_b.get("avg_final_third_pct") or 0) > float(team_a.get("avg_final_third_pct") or 0)
                else "even",
            },
            {
                "label": "압박 시도(PPDA proxy)",
                "jeonbuk": team_a.get("avg_presses"),
                "opponent": team_b.get("avg_presses"),
                "better": "jeonbuk"
                if float(team_a.get("avg_presses") or 0) > float(team_b.get("avg_presses") or 0)
                else "opponent"
                if float(team_b.get("avg_presses") or 0) > float(team_a.get("avg_presses") or 0)
                else "even",
            },
        ],
        "summary": (
            f"최근 {team_a.get('samples', 0)}경기 기준 — {name_a} xG {team_a.get('avg_xg')} / xGA {team_a.get('avg_xga')}, "
            f"{name_b} xG {team_b.get('avg_xg')} / xGA {team_b.get('avg_xga')}."
        ),
    }


def match_raw_path(year: str, gid: str) -> Path:
    y = str(year or YEAR)
    g = str(gid or "")
    if y == LEGACY_FLAT_YEAR:
        return C_DATA / f"{g}.json"
    return C_DATA / y / f"{g}.json"


def blank_player_row() -> dict:
    return {
        "player_id": "",
        "name": "",
        "back_no": "",
        "pos": "",
        "team_id": "",
        "games": 0,
        "minutes": 0,
        "touches": 0,
        "passes": 0,
        "pass_ok": 0,
        "keypass": 0,
        "shots": 0,
        "sot": 0,
        "goals": 0,
        "xg": 0.0,
        "press": 0,
        "intercept": 0,
        "tackle": 0,
        "dribble": 0,
    }


def _yn(v) -> bool:
    return str(v or "").upper() in ("Y", "T", "1", "TRUE")


def _ensure_player(bucket: dict[str, dict], pid: str) -> dict:
    row = bucket.get(pid)
    if row is None:
        row = blank_player_row()
        row["player_id"] = pid
        bucket[pid] = row
    return row


def ingest_players_from_match(bucket: dict[str, dict], data: dict, team_id: str) -> bool:
    """Fold one chalkboard match into per-player totals for team_id."""
    tid = str(team_id or "")
    if not tid or not isinstance(data, dict):
        return False
    lineup = data.get("lineup") if isinstance(data.get("lineup"), dict) else {}
    saw = False
    for side in ("home", "away"):
        for pl in lineup.get(side) or []:
            if not isinstance(pl, dict):
                continue
            if str(pl.get("team_id") or "") != tid:
                continue
            pid = str(pl.get("player_id") or "").strip()
            if not pid:
                continue
            row = _ensure_player(bucket, pid)
            saw = True
            if pl.get("name"):
                row["name"] = str(pl.get("name") or row["name"])
            if pl.get("back_no") not in (None, ""):
                row["back_no"] = pl.get("back_no")
            if pl.get("position"):
                row["pos"] = str(pl.get("position") or row["pos"])
            row["team_id"] = tid
            try:
                mins = int(pl.get("minutes") or 0)
            except (TypeError, ValueError):
                mins = 0
            row["minutes"] += max(mins, 0)
            if pl.get("starter") or mins > 0:
                row["games"] += 1

    name_by_id = {
        str(p.get("player_id") or ""): str(p.get("NAME") or p.get("name") or "")
        for p in (data.get("players") or [])
        if isinstance(p, dict)
    }
    back_by_id = {
        str(p.get("player_id") or ""): p.get("back_no")
        for p in (data.get("players") or [])
        if isinstance(p, dict)
    }
    pos_by_id = {
        str(p.get("player_id") or ""): str(p.get("Position_Name") or "")
        for p in (data.get("players") or [])
        if isinstance(p, dict)
    }

    for e in data.get("events") or []:
        if not isinstance(e, dict):
            continue
        if str(e.get("TEAM_ID") or "") != tid:
            continue
        pid = str(e.get("PLAYER_ID") or "").strip()
        if not pid:
            continue
        row = _ensure_player(bucket, pid)
        saw = True
        row["team_id"] = tid
        if not row["name"] and name_by_id.get(pid):
            row["name"] = name_by_id[pid]
        if row["back_no"] in (None, "") and back_by_id.get(pid) not in (None, ""):
            row["back_no"] = back_by_id[pid]
        if not row["pos"] and pos_by_id.get(pid):
            row["pos"] = pos_by_id[pid]
        typ = str(e.get("TYPE_CD") or "")
        det = str(e.get("TYPE_DETAIL_CD") or "")
        if not (typ == "GK" and not det):
            row["touches"] += 1
        if typ == "PS":
            row["passes"] += 1
            if det == "PSS":
                row["pass_ok"] += 1
            if _yn(e.get("KEYPASS_YN_CD")):
                row["keypass"] += 1
        if typ == "ST":
            row["shots"] += 1
            try:
                row["xg"] += float(e.get("EXPECTED_GOAL") or 0)
            except (TypeError, ValueError):
                pass
            if det == "GL":
                row["goals"] += 1
                row["sot"] += 1
            elif det == "AST":
                row["sot"] += 1
        if det == "DS":
            row["dribble"] += 1
        elif det == "DU" and typ == "DU":
            row["dribble"] += 1
        if det in ("OPCS", "OPCU"):
            row["press"] += 1
        if det in ("INT", "CUT"):
            row["intercept"] += 1
        if det in ("TKS", "TKU"):
            row["tackle"] += 1
    return saw


def recent_chalkboard_refs(
    catalog: dict[str, dict],
    team: str,
    limit: int = 5,
) -> list[tuple[str, str]]:
    """Most recent finished matches for team that have chalkboard JSON on disk."""
    rows: list[tuple[str, int, str, str]] = []
    for m in catalog.values():
        home, away = m.get("home") or "", m.get("away") or ""
        if team not in home and team not in away:
            continue
        year = str(m.get("year") or YEAR)
        gid = str(m.get("game_id") or "")
        if not gid or not match_raw_path(year, gid).exists():
            continue
        rows.append((str(m.get("date") or ""), int(m.get("round") or 0), year, gid))
    rows.sort(key=lambda x: (x[0], x[1]))
    return [(y, g) for _d, _r, y, g in rows[-limit:]]


def finalize_player_rows(bucket: dict[str, dict]) -> list[dict]:
    out = []
    for row in bucket.values():
        if not row.get("name") and row.get("touches", 0) <= 0:
            continue
        if int(row.get("games") or 0) <= 0 and int(row.get("touches") or 0) <= 0:
            continue
        if int(row.get("games") or 0) <= 0 and int(row.get("touches") or 0) > 0:
            row["games"] = 1
        rec = dict(row)
        rec["xg"] = round(float(rec.get("xg") or 0), 2)
        out.append(rec)
    return out


def aggregate_team_players(
    catalog: dict[str, dict],
    team: str,
    team_id: str,
    limit: int = 5,
) -> tuple[list[dict], dict]:
    refs = recent_chalkboard_refs(catalog, team, limit)
    bucket: dict[str, dict] = {}
    used_ids: list[str] = []
    for year, gid in refs:
        data = load_json(match_raw_path(year, gid))
        if not isinstance(data, dict):
            continue
        if ingest_players_from_match(bucket, data, team_id):
            used_ids.append(gid)
    players = finalize_player_rows(bucket)
    used = len(used_ids)
    meta = {
        "games": used,
        "sample_note": f"최근 가용 칠판 데이터 {used}경기 기준" if used else "선수 칠판 데이터 부족",
        "game_ids": used_ids,
    }
    return players, meta


def player_tag(p: dict) -> str:
    name = str(p.get("name") or "?")
    back = p.get("back_no")
    if back not in (None, ""):
        return f"#{back} {name}"
    return name


def attack_score(p: dict) -> float:
    return (
        float(p.get("xg") or 0) * 3.0
        + float(p.get("goals") or 0) * 2.2
        + float(p.get("keypass") or 0) * 1.1
        + float(p.get("shots") or 0) * 0.2
        + float(p.get("sot") or 0) * 0.35
    )


def hub_score(p: dict) -> float:
    return (
        float(p.get("keypass") or 0) * 3.0
        + float(p.get("passes") or 0) * 0.025
        + float(p.get("touches") or 0) * 0.012
        + float(p.get("xg") or 0) * 0.8
        + float(p.get("goals") or 0) * 0.5
    )


def danger_score(p: dict) -> float:
    return attack_score(p) + float(p.get("press") or 0) * 0.12 + float(p.get("dribble") or 0) * 0.25


def player_stat_line(p: dict) -> str:
    parts = [
        f"최근 {int(p.get('games') or 0)}경기",
        f"xG {p.get('xg')}",
        f"골 {int(p.get('goals') or 0)}",
        f"슈팅 {int(p.get('shots') or 0)}",
        f"키패스 {int(p.get('keypass') or 0)}",
    ]
    if int(p.get("press") or 0) >= 6:
        parts.append(f"압박 {int(p.get('press') or 0)}")
    if int(p.get("touches") or 0) >= 120:
        parts.append(f"터치 {int(p.get('touches') or 0)}")
    return " · ".join(parts)


def serialize_player_focus(p: dict, note: str) -> dict:
    return {
        "player_id": p.get("player_id") or "",
        "name": p.get("name") or "",
        "back_no": p.get("back_no"),
        "pos": p.get("pos") or "",
        "games": int(p.get("games") or 0),
        "xg": p.get("xg"),
        "goals": int(p.get("goals") or 0),
        "shots": int(p.get("shots") or 0),
        "keypass": int(p.get("keypass") or 0),
        "touches": int(p.get("touches") or 0),
        "press": int(p.get("press") or 0),
        "minutes": int(p.get("minutes") or 0),
        "note": note,
        "stat_line": player_stat_line(p),
    }


def pick_unique(players: list[dict], scorers, limit: int, exclude: set[str] | None = None) -> list[dict]:
    exclude = exclude or set()
    ranked = sorted(players, key=scorers, reverse=True)
    out = []
    for p in ranked:
        pid = str(p.get("player_id") or "")
        if not pid or pid in exclude:
            continue
        if not p.get("name"):
            continue
        out.append(p)
        exclude.add(pid)
        if len(out) >= limit:
            break
    return out


def build_prep_items(
    focus_side: dict,
    opp: dict,
    opponent: str,
    ha: str,
    focus_name: str = "전북",
) -> list[str]:
    """Actionable prep notes from opponent style — not a copy of scout bullets."""
    items: list[str] = []

    def push(text: str) -> None:
        if text and text not in items:
            items.append(text)

    tags = opp.get("tags") or []
    if "적극 압박" in tags:
        push(
            f"{opponent} 최근 압박 시도가 많습니다(경기당 {opp.get('avg_presses')}). "
            "빌드업은 짧은 3패스·서드맨으로 첫 압박을 통과해야 합니다."
        )
    if "낮은 블록형" in tags:
        push(
            f"{opponent}은(는) 낮은 블록·후방 점유 비중이 큽니다. "
            "중앙 고집보다 측면 오버랩 후 컷백·하프스페이스 침투로 박스를 열어야 합니다."
        )
    if "전진 점유" in tags or float(opp.get("avg_final_third_pct") or 0) >= 26:
        push(
            f"{opponent} 파이널 서드 터치 {opp.get('avg_final_third_pct')}%. "
            "볼 손실 순간 뒷공간을 내주지 않게 미드필더의 즉시 커버가 필요합니다."
        )
    if "슈팅 많음" in tags or float(opp.get("avg_shots") or 0) >= 12:
        push(
            f"{opponent} 경기당 슈팅 {opp.get('avg_shots')}·유효슈팅 {opp.get('avg_sot')}. "
            "박스 안 2선 슈팅 각을 먼저 막고, 세트피스 수비 위치를 고정하세요."
        )
    if "수비 기회 허용" in tags or float(opp.get("avg_xga") or 0) >= 1.25:
        push(
            f"{opponent} 허용 xG {opp.get('avg_xga')}로 수비 구멍이 있습니다. "
            "초반 압박으로 실수를 유도한 뒤 빠른 전환으로 xG를 쌓는 편이 맞습니다."
        )
    if "기회 창출↑" in tags or float(opp.get("avg_xg") or 0) >= 1.35:
        push(
            f"{opponent} 최근 xG {opp.get('avg_xg')}로 기회 질이 좋습니다. "
            "라인 간격을 좁히고, 역습 첫 패스 각을 막는 것이 실점 방지의 핵심입니다."
        )
    if "비기는 흐름" in tags:
        push(
            f"{opponent} 최근 비기는 흐름입니다. 선제골 이후 템포를 죽이지 말고 "
            "두 번째 슈팅 루트까지 밀어붙여야 승점 3이 열립니다."
        )
    if "상승세" in tags:
        push(
            f"{opponent}이(가) 상승세입니다. 한 골 차 리드에도 역습·세트피스 한 장면을 끝까지 경계하세요."
        )
    if ha == "A":
        push(
            "원정 초반 20분: 실점 없이 버티며 상대 압박 높이를 파악한 뒤, "
            "측면 전환으로 템포를 가져오는 순서가 안전합니다."
        )
    else:
        push(
            "홈에서는 초반부터 라인 높이를 올려 상대를 하프라인 밖으로 밀어내고, "
            "관중 앞에서 전환 속도를 유지하세요."
        )
    if float(focus_side.get("avg_pass_pct") or 0) >= float(opp.get("avg_pass_pct") or 0) + 3:
        push(
            f"{focus_name} 패스 성공률 {focus_side.get('avg_pass_pct')}%가 "
            f"{opponent}({opp.get('avg_pass_pct')}%)보다 높습니다. "
            "점유를 지키되 박스 밖 남발은 줄이고 컷백 완성도를 올리세요."
        )
    if not items:
        push(
            f"{opponent} 최근 지표가 비슷합니다. 중원 밀도·측면 1대1·세트피스 세 구간에서 "
            "먼저 우위를 가져가는 쪽이 경기를 가져갑니다."
        )
    return items[:5]


def build_player_focus(
    jb_players: list[dict],
    opp_players: list[dict],
    jb_meta: dict,
    opp_meta: dict,
    jb_style: dict,
    opp_style: dict,
    opponent: str,
    ha: str,
) -> dict:
    jb_key_raw = pick_unique(jb_players, attack_score, 4)
    opp_danger_raw = pick_unique(opp_players, danger_score, 4)
    used = {str(p.get("player_id")) for p in opp_danger_raw}
    opp_hub_raw = pick_unique(opp_players, hub_score, 4, exclude=used)
    if len(opp_hub_raw) < 2:
        opp_hub_raw = pick_unique(opp_players, hub_score, 4)

    def jb_note(p: dict) -> str:
        if float(p.get("xg") or 0) >= 0.7 or int(p.get("goals") or 0) >= 1:
            return "마무·기회 창출의 중심축. 박스 진입·컷백 완성도를 이 선수에게 연결하세요."
        if int(p.get("keypass") or 0) >= 4:
            return "키패스로 공격 루트를 여는 타입. 하프스페이스·측면 전환의 종착점이 됩니다."
        if str(p.get("pos") or "").upper() in ("DF", "WB") and int(p.get("touches") or 0) >= 200:
            return "빌드업·오버랩 참여도가 높은 수비 자원. 전진 패스 성공이 템포를 가릅니다."
        return "최근 폼에서 영향력이 큰 자원. 선발·교체 모두 관전 포인트입니다."

    def danger_note(p: dict) -> str:
        if int(p.get("goals") or 0) >= 1 or float(p.get("xg") or 0) >= 0.4:
            return "박스 안·주변 마무리를 최우선 마크. 세트피스·크로스가 오면 1순위로 붙으세요."
        if int(p.get("keypass") or 0) >= 3:
            return "키패스 각을 막는 것이 실점 예방. 받는 발·턴 방향을 먼저 차단하세요."
        if int(p.get("press") or 0) >= 8:
            return "전방 압박으로 빌드업을 흔드는 타입. 첫 패스 실수를 유도당하지 마세요."
        return "터치·슈팅 관여가 잦아 놓치면 위험. 사이드 전환 후 2선 슈팅을 경계하세요."

    def hub_note(p: dict) -> str:
        if int(p.get("keypass") or 0) >= 3:
            return f"{opponent} 최근 공격이 이 선수의 연결을 거쳐 가는 비중이 큽니다. 압박 트리거로 잡으세요."
        if int(p.get("touches") or 0) >= 150:
            return "볼 순환의 허브. 압박 타이밍을 여기에 맞추면 상대 템포가 죽습니다."
        return "전개 1옵션으로 자주 관여합니다. 받을 공간을 좁히면 측면으로 몰아갈 수 있습니다."

    jb_key = [serialize_player_focus(p, jb_note(p)) for p in jb_key_raw]
    opp_danger = [serialize_player_focus(p, danger_note(p)) for p in opp_danger_raw]
    opp_hub = [serialize_player_focus(p, hub_note(p)) for p in opp_hub_raw]
    prep = build_prep_items(jb_style, opp_style, opponent, ha, focus_name="전북")

    if not jb_key:
        jb_key = []
        prep = prep  # keep
    if not opp_danger:
        opp_danger = []
    if not opp_hub:
        opp_hub = []

    return {
        "jeonbuk_key": jb_key,
        "opponent_danger": opp_danger,
        "opponent_hub": opp_hub,
        "prep": prep,
        "meta": {
            "jeonbuk": jb_meta,
            "opponent": opp_meta,
        },
    }


def build_focus_cards(focus: dict, opponent: str, home_name: str = "", away_name: str = "", jeonbuk: bool = True) -> list[dict]:
    """Preview cards focused on players + prep — intentionally different from scout."""
    if jeonbuk:
        key_label = "이번 경기 전북 핵심 선수"
        danger_label = "조심해야 할 상대 선수"
        hub_label = f"최근 {opponent} 전개·공격 중심"
        prep_label = f"{opponent} 스타일 대비법"
        jb_items = [
            f"{player_tag({'name': p.get('name'), 'back_no': p.get('back_no')})} — {p.get('stat_line')}. {p.get('note')}"
            for p in focus.get("jeonbuk_key") or []
        ]
        if not jb_items:
            jb_items = ["최근 칠판 선수 데이터가 부족합니다. 팀 지표·라인업 공개 후 갱신됩니다."]
        danger_items = [
            f"{player_tag({'name': p.get('name'), 'back_no': p.get('back_no')})} — {p.get('stat_line')}. {p.get('note')}"
            for p in focus.get("opponent_danger") or []
        ]
        if not danger_items:
            danger_items = [f"{opponent} 최근 선수 단위 데이터가 부족합니다. 세트피스·역습 1옵션을 우선 경계하세요."]
        hub_items = [
            f"{player_tag({'name': p.get('name'), 'back_no': p.get('back_no')})} — {p.get('stat_line')}. {p.get('note')}"
            for p in focus.get("opponent_hub") or []
        ]
        if not hub_items:
            hub_items = [f"{opponent} 볼 순환 허브 데이터가 부족합니다. 중원 키패스·측면 전환 각을 먼저 보세요."]
        prep_items = list(focus.get("prep") or [])
        return [
            {
                "key": "jb_key",
                "label": key_label,
                "items": jb_items[:4],
                "players": focus.get("jeonbuk_key") or [],
            },
            {
                "key": "opp_watch",
                "label": danger_label,
                "items": danger_items[:4],
                "players": focus.get("opponent_danger") or [],
            },
            {
                "key": "opp_hub",
                "label": hub_label,
                "items": hub_items[:4],
                "players": focus.get("opponent_hub") or [],
            },
            {
                "key": "prep",
                "label": prep_label,
                "items": prep_items[:5],
                "players": [],
            },
        ]

    # Neutral (other-team) preview: home key / away danger / hubs / prep
    home_key = focus.get("jeonbuk_key") or []
    away_danger = focus.get("opponent_danger") or []
    away_hub = focus.get("opponent_hub") or []

    def item_lines(rows: list[dict], empty: str) -> list[str]:
        lines = [
            f"{player_tag({'name': p.get('name'), 'back_no': p.get('back_no')})} — {p.get('stat_line')}. {p.get('note')}"
            for p in rows
        ]
        return lines[:4] or [empty]

    return [
        {
            "key": "jb_key",
            "label": f"{home_name} 핵심 선수",
            "items": item_lines(home_key, f"{home_name} 최근 선수 데이터가 부족합니다."),
            "players": home_key,
        },
        {
            "key": "opp_watch",
            "label": f"조심할 {away_name} 선수",
            "items": item_lines(away_danger, f"{away_name} 선수 단위 데이터가 부족합니다."),
            "players": away_danger,
        },
        {
            "key": "opp_hub",
            "label": f"최근 {away_name} 전개 중심",
            "items": item_lines(away_hub, f"{away_name} 전개 허브 데이터가 부족합니다."),
            "players": away_hub,
        },
        {
            "key": "prep",
            "label": "매치업 대비 포인트",
            "items": (focus.get("prep") or [])[:5],
            "players": [],
        },
    ]


def build_scout(jb: dict, opp: dict, opponent: str, ha: str) -> dict:
    contrast = (
        f"전북은 {', '.join(jb['tags'][:3])} 흐름이고, "
        f"{opponent}은(는) {', '.join(opp['tags'][:3])} 그림입니다. "
        f"최근 xG {jb.get('avg_xg')} vs {opp.get('avg_xg')}, "
        f"슈팅 {jb.get('avg_shots')} vs {opp.get('avg_shots')}, "
        f"유효슈팅 {jb.get('avg_sot')} vs {opp.get('avg_sot')}, "
        f"패스 성공률 {jb.get('avg_pass_pct')}% vs {opp.get('avg_pass_pct')}%, "
        f"파이널 서드 터치 {jb.get('avg_final_third_pct')}% vs {opp.get('avg_final_third_pct')}%, "
        f"평균 터치 높이 {jb.get('avg_x')} vs {opp.get('avg_x')}, "
        f"압박 {jb.get('avg_presses')} vs {opp.get('avg_presses')}입니다."
    )

    edges, risks, targets, cautions = [], [], [], []

    def push(arr: list, text: str) -> None:
        if text and text not in arr:
            arr.append(text)

    if float(jb.get("avg_xg") or 0) >= float(opp.get("avg_xg") or 0) + 0.25:
        push(
            edges,
            f"전북이 최근 기회 질(xG {jb.get('avg_xg')})에서 {opponent}({opp.get('avg_xg')})보다 앞서 있습니다. "
            "박스 진입만 유지하면 득점 루트가 더 많습니다.",
        )
    if float(jb.get("avg_xga") or 0) <= float(opp.get("avg_xga") or 0) - 0.2:
        push(
            edges,
            f"전북이 허용 xG {jb.get('avg_xga')}로 수비 기회 관리가 {opponent}({opp.get('avg_xga')})보다 낫습니다.",
        )
    if float(jb.get("avg_pass_pct") or 0) >= float(opp.get("avg_pass_pct") or 0) + 4:
        push(
            edges,
            f"패스 성공률 {jb.get('avg_pass_pct')}% vs {opp.get('avg_pass_pct')}%. "
            "점유를 지키며 템포를 조절할 여지가 있습니다.",
        )
    if float(jb.get("avg_sot") or 0) >= float(opp.get("avg_sot") or 0) + 0.8:
        push(
            edges,
            f"유효슈팅 {jb.get('avg_sot')} vs {opp.get('avg_sot')}. "
            "박스 안 마무리 빈도가 앞서면 한 방이 더 자주 옵니다.",
        )
    if "상승세" in jb["tags"]:
        push(edges, "전북 최근 승점 흐름이 좋습니다. 템포를 먼저 가져가면 상대가 쫓아오는 그림이 됩니다.")
    if "부진" in opp["tags"]:
        push(edges, f"{opponent} 최근 흐름이 좋지 않습니다. 초반 압박으로 실수를 유도할 만합니다.")
    if ha == "H":
        push(edges, "홈 이점. 전주에서 라인 높이를 올려도 관중·익숙한 공간이 받쳐 줍니다.")
    else:
        push(risks, "원정입니다. 초반 실점하면 추격 템포가 무거워지니 첫 20분 전환 수비가 핵심입니다.")

    if "기회 부족" in jb["tags"]:
        push(
            risks,
            "전북 최근 기회 질이 낮습니다. 점유만 하고 슈팅 질이 떨어지면 역습에 취약합니다.",
        )
    if float(jb.get("avg_xga") or 0) >= 1.2:
        push(
            risks,
            f"전북이 경기당 xGA {jb.get('avg_xga')}를 허용 중입니다. 한 번의 정리 실패가 곧바로 실점으로 이어질 수 있습니다.",
        )
    if float(opp.get("avg_xg") or 0) >= float(jb.get("avg_xg") or 0) + 0.2:
        push(
            risks,
            f"{opponent} xG {opp.get('avg_xg')}가 전북({jb.get('avg_xg')})보다 높습니다. "
            "기회 질 격차를 전환 수비로 메워야 합니다.",
        )
    if "상승세" in opp["tags"]:
        push(
            risks,
            f"{opponent}이(가) 상승세입니다. 한 방에 무너지지 않게 세트피스·역습 첫 패스를 막아야 합니다.",
        )
    if "적극 압박" in opp["tags"]:
        push(
            cautions,
            f"{opponent}의 압박 시도가 많습니다(경기당 {opp.get('avg_presses')}). "
            "빌드업 첫 패스 실패를 줄이지 않으면 박스 위기가 바로 옵니다.",
        )
    if "낮은 블록형" in opp["tags"]:
        push(
            risks,
            f"{opponent}형 낮은 블록은 전북 템포를 죽입니다. 점유만 높고 마무리가 약하면 역습 한 방에 끌려갈 수 있습니다.",
        )
        push(
            targets,
            "박스 밖 남발보다 오버랩·하프스페이스 침투 후 컷백을 노리는 편이 맞습니다.",
        )
    if float(opp.get("avg_shots") or 0) >= 12:
        push(
            cautions,
            f"{opponent} 경기당 슈팅 {opp.get('avg_shots')}. 박스 주변 2선 슈팅과 세트피스 동선을 우선 차단하세요.",
        )

    push(targets, "전북 측면 오버랩 후 컷백이 통하는지 — 중앙만 막히면 답답한 점유로 흐릅니다.")
    push(targets, f"{opponent}의 첫 압박 라인 높이 — 빌드업 실수를 줄이면 전북이 경기를 가져옵니다.")
    push(
        targets,
        f"필드 틸트 지표: 파이널 서드 {jb.get('avg_final_third_pct')}% vs {opp.get('avg_final_third_pct')}%, "
        f"터치 높이 {jb.get('avg_x')} vs {opp.get('avg_x')}.",
    )
    push(targets, "리드 후 템포 관리 — 최근 K리그는 한 골 리드 뒤 역습 한 방이 승부를 가릅니다.")
    push(cautions, f"{opponent} 세트피스와 역습 첫 패스. 짧은 순간의 마무리를 경계합니다.")

    if not edges:
        push(edges, "중원 볼 경합과 측면 숫자에서 앞서면 전북 페이스로 가져올 수 있습니다.")
    if not risks:
        push(risks, "조급한 박스 밖 슈팅은 금물. 기회가 비슷할수록 전환 수비 한 장면이 승부처입니다.")

    return {
        "contrast": contrast,
        "edge": edges[:5],
        "risk": risks[:5],
        "target": targets[:5],
        "caution": cautions[:5],
    }


def h2h_summary(h2h: list[dict]) -> dict:
    w = sum(1 for r in h2h if r.get("result") == "W")
    d = sum(1 for r in h2h if r.get("result") == "D")
    l = sum(1 for r in h2h if r.get("result") == "L")
    return {"wins": w, "draws": d, "losses": l, "games": len(h2h)}


def build_match_pulse(team_a: str, team_b: str, form_a: list[dict], form_b: list[dict]) -> dict:
    """Expose the useful trends behind the preview without claiming a result prediction."""
    def summary(name: str, rows: list[dict]) -> dict:
        played = len(rows)
        wins = sum(r.get("result") == "W" for r in rows)
        draws = sum(r.get("result") == "D" for r in rows)
        goals_for = sum(int(r.get("goals_for") or 0) for r in rows)
        goals_against = sum(int(r.get("goals_against") or 0) for r in rows)
        xg_rows = [r for r in rows if r.get("xg") is not None and not r.get("stats_limited")]
        xg = sum(float(r.get("xg") or 0) for r in xg_rows)
        return {"name": name, "sample": played, "points": wins * 3 + draws,
                "ppg": round((wins * 3 + draws) / played, 2) if played else None,
                "goals_pg": round(goals_for / played, 2) if played else None,
                "conceded_pg": round(goals_against / played, 2) if played else None,
                "xg_delta": round(goals_for - xg, 2) if xg_rows else None,
                "xg_sample": len(xg_rows),
                "clean_sheets": sum(int(r.get("goals_against") or 0) == 0 for r in rows)}
    a, b = summary(team_a, form_a), summary(team_b, form_b)
    if a["ppg"] is not None and b["ppg"] is not None and abs(a["ppg"] - b["ppg"]) >= 0.4:
        lead = team_a if a["ppg"] > b["ppg"] else team_b
        verdict = f"최근 승점 흐름은 {lead} 쪽이 더 좋습니다. 다만 최근 5경기 표본으로 보는 프리뷰입니다."
    else:
        verdict = "최근 승점 흐름은 팽팽합니다. 한 번의 전환·세트피스가 결과를 바꿀 수 있는 매치업입니다."
    return {"home": a, "away": b, "verdict": verdict,
            "sample_note": "최근 5경기 기준 · xG 대비 득점은 xG가 있는 경기만 반영"}


def load_lineup_exclusions(team_id: str | None = None) -> dict[str, str]:
    """player_id -> reason from manual override file."""
    data = load_json(EXCLUSIONS_PATH)
    out: dict[str, str] = {}
    if not isinstance(data, dict):
        return out
    want = str(team_id or "").upper()
    for row in data.get("players") or []:
        if not isinstance(row, dict):
            continue
        pid = str(row.get("player_id") or "").strip()
        if not pid:
            continue
        team_ids = [str(t).upper() for t in (row.get("team_ids") or []) if t]
        if want and team_ids and want not in team_ids:
            continue
        reason = str(row.get("reason") or "제외").strip() or "제외"
        out[pid] = reason
    return out


def team_yellow_ledger(catalog: dict[str, dict], team_id: str) -> dict[str, list[dict]]:
    """One-pass chronological yellow apps per player for a club."""
    tid = str(team_id)
    cached = _YELLOW_LEDGER_CACHE.get(tid)
    if cached is not None:
        return cached
    by_pid: dict[str, list[dict]] = {}
    matches = sorted(
        catalog.values(),
        key=lambda m: (str(m.get("date") or ""), int(m.get("round") or 0), str(m.get("game_id") or "")),
    )
    for m in matches:
        if not isinstance(m, dict):
            continue
        year = str(m.get("year") or YEAR)
        gid = str(m.get("game_id") or "")
        path = match_raw_path(year, gid)
        if not path.exists():
            continue
        data = load_json(path)
        if not isinstance(data, dict):
            continue
        lineup = data.get("lineup") if isinstance(data.get("lineup"), dict) else {}
        event_yellow: dict[str, int] = {}
        for e in data.get("events") or []:
            if not isinstance(e, dict):
                continue
            pid = str(e.get("PLAYER_ID") or "")
            if not pid:
                continue
            code = e.get("TYPE_DETAIL_CD")
            # Only single yellows count toward accumulation (not Y2C pair / straight red).
            if code == "YLC":
                event_yellow[pid] = event_yellow.get(pid, 0) + 1
        for side in ("home", "away"):
            for pl in lineup.get(side) or []:
                if not isinstance(pl, dict):
                    continue
                if str(pl.get("team_id") or "") != tid:
                    continue
                pid = str(pl.get("player_id") or "")
                if not pid:
                    continue
                yellow = int(pl.get("yellow") or 0)
                if yellow <= 0:
                    yellow = event_yellow.get(pid, 0)
                by_pid.setdefault(pid, []).append(
                    {
                        "date": str(m.get("date") or ""),
                        "round": int(m.get("round") or 0),
                        "game_id": gid,
                        "yellow": max(yellow, 0),
                        "minutes": int(pl.get("minutes") or 0),
                    }
                )
    _YELLOW_LEDGER_CACHE[tid] = by_pid
    return by_pid


def finished_team_game_ids(team: str) -> list[str]:
    """Chronological finished league game_ids for a club (from schedule)."""
    name = str(team or "").strip()
    if not name:
        return []
    cached = _TEAM_FINISHED_GAMES_CACHE.get(name)
    if cached is not None:
        return cached
    schedule = load_json(C_DATA / "schedule.json")
    matches = schedule.get("matches") if isinstance(schedule, dict) else []
    rows: list[tuple[tuple, str]] = []
    if isinstance(matches, list):
        for m in matches:
            if not isinstance(m, dict):
                continue
            if m.get("home") != name and m.get("away") != name:
                continue
            if str(m.get("end_yn") or "").upper() != "Y":
                continue
            md = str(m.get("date_md") or "00/00")
            try:
                mm_s, dd_s = md.split("/", 1)
                key = (int(mm_s), int(dd_s), int(m.get("round") or 0), str(m.get("game_id") or ""))
            except (TypeError, ValueError):
                key = (0, 0, int(m.get("round") or 0), str(m.get("game_id") or ""))
            gid = str(m.get("game_id") or "").strip()
            if gid:
                rows.append((key, gid))
    rows.sort(key=lambda r: r[0])
    out = [gid for _, gid in rows]
    _TEAM_FINISHED_GAMES_CACHE[name] = out
    return out


def yellow_ban_thresholds(limit: int = 400) -> list[int]:
    """K League player yellow-accumulation ban thresholds: 5, then +3, then +2 forever."""
    out = [5, 8]
    n = 10
    while n <= limit:
        out.append(n)
        n += 2
    return out


def yellow_ban_pending(
    apps: list[dict],
    team_finished_gids: list[str] | None = None,
    every: int = YELLOW_BAN_EVERY,
) -> bool:
    """True when the next league match should be a yellow-accumulation ban.

    Ban is consumed by the next finished team match after a threshold, even if
    chalkboard lineup for that match is missing (player sat out).
    """
    if not apps:
        return False
    by_gid = {str(a.get("game_id") or ""): a for a in apps if a.get("game_id")}
    thresholds = yellow_ban_thresholds() if every == YELLOW_BAN_EVERY else list(range(every, 400, every))
    total = 0
    ban_left = 0
    thr_i = 0
    # Prefer schedule order; fall back to appearance order only.
    sequence = list(team_finished_gids or [])
    if not sequence:
        sequence = [str(a.get("game_id") or "") for a in apps if a.get("game_id")]
    for gid in sequence:
        if ban_left > 0:
            ban_left -= 1
            continue
        app = by_gid.get(str(gid))
        if not app:
            continue
        y = int(app.get("yellow") or 0)
        if y <= 0:
            continue
        before = total
        total += y
        while thr_i < len(thresholds) and thresholds[thr_i] <= total:
            if before < thresholds[thr_i] <= total:
                ban_left += 1
            thr_i += 1
    return ban_left > 0


def unavailable_player_ids(
    catalog: dict[str, dict],
    team: str,
    team_id: str,
) -> dict[str, str]:
    """player_id -> reason for XI/bench exclusion."""
    blocked = load_lineup_exclusions(team_id)
    ledger = team_yellow_ledger(catalog, team_id)
    finished = finished_team_game_ids(team)
    for pid, apps in ledger.items():
        if pid in blocked:
            continue
        if yellow_ban_pending(apps, finished):
            blocked[pid] = "경고 누적 출전정지(자동)"
    return blocked


def build_lineup_projection(catalog: dict[str, dict], team: str, team_id: str, limit: int = 5) -> dict:
    """Create a transparent expected XI from recent official starting XIs."""
    refs = recent_chalkboard_refs(catalog, team, limit)
    bucket: dict[str, dict] = {}
    used = 0
    blocked = unavailable_player_ids(catalog, team, team_id)
    excluded_notes: list[str] = []
    for order, (year, gid) in enumerate(refs, start=1):
        data = load_json(match_raw_path(year, gid))
        lineup = data.get("lineup") if isinstance(data, dict) and isinstance(data.get("lineup"), dict) else {}
        matched = False
        for side in ("home", "away"):
            for pl in lineup.get(side) or []:
                if not isinstance(pl, dict) or str(pl.get("team_id") or "") != str(team_id):
                    continue
                matched = True
                pid = str(pl.get("player_id") or "")
                if not pid:
                    continue
                if pid in blocked:
                    name = str(pl.get("name") or pid)
                    note = f"{name} · {blocked[pid]}"
                    if note not in excluded_notes:
                        excluded_notes.append(note)
                    continue
                row = bucket.setdefault(
                    pid,
                    {
                        "player_id": pid,
                        "name": "",
                        "back_no": "",
                        "pos": "",
                        "starts": 0,
                        "apps": 0,
                        "minutes": 0,
                        "score": 0.0,
                    },
                )
                row["name"] = str(pl.get("name") or row["name"])
                row["back_no"] = pl.get("back_no", row["back_no"])
                position = str(pl.get("position") or "")
                if position and position != "대기":
                    row["pos"] = position
                starter, mins = bool(pl.get("starter")), int(pl.get("minutes") or 0)
                row["apps"] += 1
                row["minutes"] += max(mins, 0)
                row["starts"] += int(starter)
                row["score"] += (4.0 if starter else 0.6) * order + min(max(mins, 0), 100) / 100
        if matched:
            used += 1
    rows = sorted(bucket.values(), key=lambda r: (r["score"], r["starts"], r["minutes"]), reverse=True)
    gks = [r for r in rows if r.get("pos") == "GK"]
    xi = (gks[:1] + [r for r in rows if r.get("pos") != "GK"])[:11]
    picked = {r["player_id"] for r in xi}
    bench = [r for r in rows if r["player_id"] not in picked][:5]
    for row in xi + bench:
        row["score"] = round(row["score"], 2)
    confidence = (
        "높음"
        if used >= 5 and sum(r["starts"] >= 3 for r in xi) >= 8
        else "보통"
        if used >= 3
        else "낮음"
    )
    disclaimer = (
        "예상 XI이며 부상·징계·당일 컨디션·감독 선택은 완벽히 반영되지 않을 수 있습니다. "
        "공식 선발 명단과 다를 수 있습니다."
    )
    if excluded_notes:
        disclaimer += " 제외: " + "; ".join(excluded_notes[:6]) + "."
    return {
        "team": team,
        "xi": xi,
        "bench": bench,
        "sample_games": used,
        "confidence": confidence,
        "excluded": [
            {"name": n.split(" · ")[0], "reason": n.split(" · ", 1)[-1]} for n in excluded_notes
        ],
        "method": "최근 가용 경기의 선발 횟수·출전 시간·최신 경기 가중치로 산출(이적·경고누적 제외)",
        "disclaimer": disclaimer,
    }


def form_line(form: list[dict]) -> str:
    if not form:
        return "데이터 없음"
    return " ".join(r.get("result") or "?" for r in form)


def lookup_venue(home: str, index_matches: list[dict], game_id: str) -> str:
    for m in index_matches:
        if str(m.get("game_id") or "") == str(game_id):
            if m.get("venue"):
                return str(m["venue"])
    return VENUE_BY_HOME.get(home, "")


def lookup_attendance(home: str) -> dict | None:
    data = load_json(C_DATA / "club-attendance.json")
    if not isinstance(data, dict):
        return None
    clubs = data.get("clubs") or []
    for c in clubs:
        name = str(c.get("name") or "")
        if home in name or name.startswith(home):
            return {"avg": c.get("avg"), "games": c.get("games"), "total": c.get("total")}
    return None


def build_briefing(
    home: str,
    away: str,
    opponent: str,
    ha: str,
    jb: dict,
    opp: dict,
    jb_form: list[dict],
    opp_form: list[dict],
    h2h_sum: dict,
    venue: str,
) -> list[str]:
    paras = []
    paras.append(
        f"{home} vs {away}. "
        f"전북 최근 {form_line(jb_form)} ({jb.get('record')}, {jb.get('goals_for')}득 {jb.get('goals_against')}실). "
        f"{opponent}은 {form_line(opp_form)} ({opp.get('record')}, {opp.get('goals_for')}득 {opp.get('goals_against')}실)."
    )
    paras.append(
        f"최근 5경기 평균 — 전북 xG {jb.get('avg_xg')}·슈팅 {jb.get('avg_shots')}·유효슈팅 {jb.get('avg_sot')}, "
        f"{opponent} xG {opp.get('avg_xg')}·슈팅 {opp.get('avg_shots')}·유효슈팅 {opp.get('avg_sot')}. "
        f"패스 성공률 {jb.get('avg_pass_pct')}% vs {opp.get('avg_pass_pct')}%."
    )
    if h2h_sum.get("games"):
        paras.append(
            f"올 시즌 맞대결 {h2h_sum['games']}경기 — 전북 {h2h_sum['wins']}승 {h2h_sum['draws']}무 {h2h_sum['losses']}패."
        )
    if venue:
        loc = "홈" if ha == "H" else "원정"
        paras.append(
            f"경기장 {venue} · 전북 {loc}. "
            f"{'전주 홈에서 템포와 라인 높이를 올리는 쪽이 유리합니다.' if ha == 'H' else '원정에서는 첫 실점 방어와 전환 속도가 관건입니다.'}"
        )
    return paras


def h2h_rows_teams(catalog: dict[str, dict], team_a: str, team_b: str, limit: int = 5) -> list[dict]:
    out = []
    for m in catalog.values():
        home, away = m.get("home") or "", m.get("away") or ""
        if team_a not in f"{home}{away}" or team_b not in f"{home}{away}":
            continue
        out.append(
            {
                "game_id": m["game_id"],
                "round": m.get("round"),
                "date": m.get("date") or "",
                "home": home,
                "away": away,
                "score": m.get("score") or "",
                "result": result_for(team_a, home, away, m.get("score") or ""),
                "venue": m.get("venue") or "",
            }
        )
    out.sort(key=lambda x: (str(x.get("date") or ""), int(x.get("round") or 0)))
    return out[-limit:]


def build_neutral_scout(home: dict, away: dict, home_name: str, away_name: str) -> dict:
    contrast = (
        f"{home_name}은 {', '.join(home['tags'][:3])} 흐름이고, "
        f"{away_name}은(는) {', '.join(away['tags'][:3])} 그림입니다. "
        f"최근 xG {home.get('avg_xg')} vs {away.get('avg_xg')}, "
        f"슈팅 {home.get('avg_shots')} vs {away.get('avg_shots')}, "
        f"파이널 서드 터치 {home.get('avg_final_third_pct')}% vs {away.get('avg_final_third_pct')}%입니다."
    )
    edges, risks, targets, cautions = [], [], [], []

    def push(arr: list, text: str) -> None:
        if text and text not in arr:
            arr.append(text)

    if float(home.get("avg_xg") or 0) >= float(away.get("avg_xg") or 0) + 0.2:
        push(
            edges,
            f"{home_name}이(가) 최근 xG {home.get('avg_xg')}로 {away_name}({away.get('avg_xg')})보다 기회 질에서 앞섭니다. 홈에서 템포를 가져가기 좋습니다.",
        )
    if "상승세" in home["tags"]:
        push(edges, f"{home_name} 최근 승점 흐름이 좋습니다. 초반 압박이 통하면 주도권을 잡기 쉽습니다.")
    if "부진" in away["tags"]:
        push(edges, f"{away_name} 최근 흐름이 좋지 않습니다. {home_name}이 실수를 유도할 여지가 있습니다.")
    push(edges, f"홈 이점({home_name}). 익숙한 경기장에서 라인 높이·템포 조절이 유리합니다.")

    if float(away.get("avg_xg") or 0) >= float(home.get("avg_xg") or 0) + 0.2:
        push(
            risks,
            f"{away_name}의 xG {away.get('avg_xg')}가 더 높습니다. {home_name}이 실점을 막는 전환 수비가 관건입니다.",
        )
    if "상승세" in away["tags"]:
        push(risks, f"{away_name}이(가) 상승세입니다. 한 번의 역습·세트피스에 흔들릴 수 있습니다.")
    if "적극 압박" in away["tags"]:
        push(cautions, f"{away_name} 압박 시도가 많습니다. {home_name} 빌드업 첫 패스 실수를 줄여야 합니다.")

    push(targets, "중원 볼 경합과 측면 숫자 — 누가 더 넓게 펼치는지가 초반 분위기를 가릅니다.")
    push(targets, "첫 골 전후 템포 변화 — K리그는 선제골 이후 한 방 역습이 자주 나옵니다.")
    push(targets, "세트피스·코너 연결 — xG가 낮을수록 dead ball 비중이 커집니다.")
    push(cautions, f"{away_name} 역습 첫 패스와 {home_name}의 앞공간 커버.")

    if not edges:
        push(edges, "양 팀 지표가 비슷합니다. 중원 밀도와 측면 1대1에서 먼저 우위를 잡는 쪽이 유리합니다.")
    if not risks:
        push(risks, "조급한 장거리 슈팅은 금물. 기회가 비슷할수록 전환 수비 한 장면이 승부처입니다.")

    return {
        "contrast": contrast,
        "edge": edges[:4],
        "risk": risks[:4],
        "target": targets[:4],
        "caution": cautions[:4],
    }


def build_neutral_cards(scout: dict, home_name: str, away_name: str) -> list[dict]:
    # Kept for backward compatibility; prefer build_focus_cards.
    return [
        {"key": "edge", "label": f"{home_name}이 유리한 점", "items": scout["edge"][:4]},
        {"key": "risk", "label": f"{home_name}이 불리한·조심할 점", "items": scout["risk"][:4]},
        {"key": "key", "label": "관전 포인트", "items": scout["target"][:4]},
        {"key": "watch", "label": f"{away_name} 경계 포인트", "items": scout["caution"][:4]},
    ]


def build_neutral_briefing(
    home: str,
    away: str,
    home_style: dict,
    away_style: dict,
    home_form: list[dict],
    away_form: list[dict],
    h2h_sum: dict,
    venue: str,
) -> list[str]:
    paras = [
        (
            f"{home} vs {away}. "
            f"{home} 최근 {form_line(home_form)} ({home_style.get('record')}). "
            f"{away} 최근 {form_line(away_form)} ({away_style.get('record')})."
        ),
        (
            f"최근 5경기 평균 — {home} xG {home_style.get('avg_xg')}·슈팅 {home_style.get('avg_shots')}, "
            f"{away} xG {away_style.get('avg_xg')}·슈팅 {away_style.get('avg_shots')}. "
            f"패스 성공률 {home_style.get('avg_pass_pct')}% vs {away_style.get('avg_pass_pct')}%."
        ),
    ]
    if h2h_sum.get("games"):
        paras.append(
            f"올 시즌 맞대결 {h2h_sum['games']}경기 — {home} 기준 {h2h_sum['wins']}승 {h2h_sum['draws']}무 {h2h_sum['losses']}패."
        )
    if venue:
        paras.append(f"경기장 {venue} · {home} 홈. 홈팀이 템포와 공간을 가져가는지 먼저 보면 됩니다.")
    return paras


def team_samples(catalog: dict[str, dict], form: list[dict], team: str) -> list[dict]:
    samples = []
    for r in form:
        m = catalog.get(match_catalog_key(str(r.get("year") or YEAR), str(r["game_id"])))
        if m:
            tid = m["home_id"] if team in (m.get("home") or "") else m["away_id"]
            samples.append(m["stats"].get(tid, blank_team_row()))
            continue
        if r.get("xg") is not None and not r.get("stats_limited"):
            samples.append(
                {
                    "shots": r.get("shots") or 0,
                    "sot": r.get("sot") or 0,
                    "goals": r.get("goals_for") or 0,
                    "xg": r.get("xg") or 0,
                    "passes": 0,
                    "pass_ok": 0,
                    "pass_pct": r.get("pass_pct") or 0.0,
                    "presses": r.get("presses") or 0,
                    "final_third_pct": r.get("final_third_pct") or 0.0,
                    "avg_x": 50.0,
                }
            )
    return samples


def build_preview_payload(
    row: dict,
    catalog: dict[str, dict],
    index_matches: list[dict],
    schedule_matches: list[dict],
    kickoff: datetime,
    published: bool,
) -> dict:
    home = row.get("home") or ""
    away = row.get("away") or ""
    if JEONBUK not in f"{home}{away}":
        return _build_neutral_preview(row, catalog, index_matches, schedule_matches, kickoff, published)
    return _build_jeonbuk_preview(row, catalog, index_matches, schedule_matches, kickoff, published)


def _build_jeonbuk_preview(
    row: dict,
    catalog: dict[str, dict],
    index_matches: list[dict],
    schedule_matches: list[dict],
    kickoff: datetime,
    published: bool,
) -> dict:
    home = row.get("home") or ""
    away = row.get("away") or ""
    opponent = away if JEONBUK in home else home
    ha = "H" if JEONBUK in home else "A"
    game_id = str(row.get("game_id") or "")

    jb_form = recent_form_merged(catalog, schedule_matches, index_matches, JEONBUK, 5)
    opp_form = recent_form_merged(catalog, schedule_matches, index_matches, opponent, 5)
    fetch_scores_for_form(jb_form, JEONBUK, schedule_matches)
    fetch_scores_for_form(opp_form, opponent, schedule_matches)
    h2h = h2h_rows(catalog, opponent, 5)
    h2h_sum = h2h_summary(h2h)

    jb_samples = team_samples(catalog, jb_form, JEONBUK)
    opp_samples = team_samples(catalog, opp_form, opponent)

    jb_style = style_blob(jb_form, jb_samples, JEONBUK)
    opp_style = style_blob(opp_form, opp_samples, opponent)
    scout = build_scout(jb_style, opp_style, opponent, ha)
    jb_players, jb_pmeta = aggregate_team_players(
        catalog, JEONBUK, team_id_for(JEONBUK), 5
    )
    opp_players, opp_pmeta = aggregate_team_players(
        catalog, opponent, team_id_for(opponent), 5
    )
    focus = build_player_focus(
        jb_players,
        opp_players,
        jb_pmeta,
        opp_pmeta,
        jb_style,
        opp_style,
        opponent,
        ha,
    )
    cards = build_focus_cards(focus, opponent, jeonbuk=True)
    matchup = build_matchup(jb_style, opp_style, JEONBUK, opponent)
    pulse = build_match_pulse(
        home, away,
        jb_form if ha == "H" else opp_form,
        opp_form if ha == "H" else jb_form,
    )
    lineups = {"home": build_lineup_projection(catalog, home, team_id_for(home)), "away": build_lineup_projection(catalog, away, team_id_for(away))}
    venue = lookup_venue(home, index_matches, game_id) or VENUE_BY_HOME.get(home, "")
    attendance = lookup_attendance(home)

    hours = (kickoff - now_kst()).total_seconds() / 3600.0
    thesis = (
        f"{home} vs {away}. 전북 최근 {form_line(jb_form)}, {opponent} 최근 {form_line(opp_form)}. "
        f"{'홈' if ha == 'H' else '원정'}에서 "
        f"{'기회 질(xG)과 슈팅 빈도를 유지하는 것' if float(jb_style.get('avg_xg') or 0) >= 1.2 else '실점 없이 측면 한 방을 노리는 것'}"
        f"이 이 경기의 핵심입니다."
    )
    briefing = build_briefing(
        home, away, opponent, ha, jb_style, opp_style, jb_form, opp_form, h2h_sum, venue
    )
    if jb_pmeta.get("sample_note") or opp_pmeta.get("sample_note"):
        briefing.append(
            f"선수 포커스 — 전북: {jb_pmeta.get('sample_note')}, "
            f"{opponent}: {opp_pmeta.get('sample_note')}."
        )

    headline = f"{int(row.get('round') or 0)}R PREVIEW · {home} vs {away}"
    return {
        "meta": {
            "game_id": game_id,
            "year": str(row.get("year") or YEAR),
            "round": int(row.get("round") or 0),
            "competition": "하나은행 K리그1",
            "home": {"name": home, "team_id": team_id_for(home)},
            "away": {"name": away, "team_id": team_id_for(away)},
            "opponent": opponent,
            "ha": ha,
            "jeonbuk_match": True,
            "venue": venue,
            "attendance_hint": attendance,
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
        "briefing": briefing,
        "scout": scout,
        "matchup": matchup,
        "pulse": pulse,
        "lineups": lineups,
        "h2h_summary": h2h_sum,
        "form": {"jeonbuk": jb_form, "opponent": opp_form},
        "h2h": h2h,
        "style": {"jeonbuk": jb_style, "opponent": opp_style},
        "players": {
            "jeonbuk": focus.get("jeonbuk_key") or [],
            "opponent_danger": focus.get("opponent_danger") or [],
            "opponent_hub": focus.get("opponent_hub") or [],
            "meta": focus.get("meta") or {},
        },
        "cards": cards,
        "sources": [
            "c_report/data/schedule.json",
            "c_report/data/index.json",
            "c_report chalk board match files",
            "c_report/data/club-attendance.json",
        ],
        "note": "킥오프 시각이 일정에 없으면 당일 19:00 KST로 가정합니다. 포털 확정 시각과 다를 수 있습니다. 선수 포커스는 가용 칠판 경기 기준입니다.",
    }


def _build_neutral_preview(
    row: dict,
    catalog: dict[str, dict],
    index_matches: list[dict],
    schedule_matches: list[dict],
    kickoff: datetime,
    published: bool,
) -> dict:
    home = row.get("home") or ""
    away = row.get("away") or ""
    game_id = str(row.get("game_id") or "")

    home_form = recent_form_merged(catalog, schedule_matches, index_matches, home, 5)
    away_form = recent_form_merged(catalog, schedule_matches, index_matches, away, 5)
    fetch_scores_for_form(home_form, home, schedule_matches)
    fetch_scores_for_form(away_form, away, schedule_matches)
    h2h = h2h_rows_teams(catalog, home, away, 5)
    h2h_sum = h2h_summary(h2h)

    home_samples = team_samples(catalog, home_form, home)
    away_samples = team_samples(catalog, away_form, away)
    home_style = style_blob(home_form, home_samples, home)
    away_style = style_blob(away_form, away_samples, away)
    scout = build_neutral_scout(home_style, away_style, home, away)
    home_players, home_pmeta = aggregate_team_players(
        catalog, home, team_id_for(home), 5
    )
    away_players, away_pmeta = aggregate_team_players(
        catalog, away, team_id_for(away), 5
    )
    focus = build_player_focus(
        home_players,
        away_players,
        home_pmeta,
        away_pmeta,
        home_style,
        away_style,
        away,
        "H",
    )
    # Rephrase prep for neutral home perspective
    focus["prep"] = build_prep_items(home_style, away_style, away, "H", focus_name=home)
    cards = build_focus_cards(
        focus, away, home_name=home, away_name=away, jeonbuk=False
    )
    matchup = build_matchup(home_style, away_style, home, away)
    pulse = build_match_pulse(home, away, home_form, away_form)
    lineups = {"home": build_lineup_projection(catalog, home, team_id_for(home)), "away": build_lineup_projection(catalog, away, team_id_for(away))}
    venue = lookup_venue(home, index_matches, game_id) or VENUE_BY_HOME.get(home, "")
    attendance = lookup_attendance(home)

    hours = (kickoff - now_kst()).total_seconds() / 3600.0
    thesis = (
        f"{home} vs {away}. {home} 최근 {form_line(home_form)}, {away} 최근 {form_line(away_form)}. "
        f"홈 {home}이(가) 템포를 가져가며 xG {home_style.get('avg_xg')} 수준의 기회를 유지할 수 있는지가 관건입니다."
    )
    briefing = build_neutral_briefing(
        home, away, home_style, away_style, home_form, away_form, h2h_sum, venue
    )
    briefing.append(
        f"선수 포커스 — {home}: {home_pmeta.get('sample_note')}, "
        f"{away}: {away_pmeta.get('sample_note')}."
    )
    headline = f"{int(row.get('round') or 0)}R PREVIEW · {home} vs {away}"
    return {
        "meta": {
            "game_id": game_id,
            "year": str(row.get("year") or YEAR),
            "round": int(row.get("round") or 0),
            "competition": "하나은행 K리그1",
            "home": {"name": home, "team_id": team_id_for(home)},
            "away": {"name": away, "team_id": team_id_for(away)},
            "opponent": away,
            "ha": "H",
            "jeonbuk_match": False,
            "venue": venue,
            "attendance_hint": attendance,
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
        "briefing": briefing,
        "scout": scout,
        "matchup": matchup,
        "pulse": pulse,
        "lineups": lineups,
        "h2h_summary": h2h_sum,
        "form": {"jeonbuk": home_form, "opponent": away_form},
        "h2h": h2h,
        "style": {"jeonbuk": home_style, "opponent": away_style},
        "players": {
            "jeonbuk": focus.get("jeonbuk_key") or [],
            "opponent_danger": focus.get("opponent_danger") or [],
            "opponent_hub": focus.get("opponent_hub") or [],
            "meta": focus.get("meta") or {},
        },
        "cards": cards,
        "sources": [
            "c_report/data/schedule.json",
            "c_report/data/index.json",
            "c_report chalk board match files",
            "c_report/data/club-attendance.json",
        ],
        "note": "킥오프 시각이 일정에 없으면 당일 19:00 KST로 가정합니다. 포털 확정 시각과 다를 수 있습니다. 선수 포커스는 가용 칠판 경기 기준입니다.",
    }


def pick_other_targets(schedule_matches: list[dict]) -> list[tuple[dict, datetime, bool]]:
    """Non-Jeonbuk unfinished fixtures within OTHER_PREVIEW_DAYS (48h = published)."""
    now = now_kst()
    upcoming: list[tuple[dict, datetime]] = []
    for row in schedule_matches:
        if is_jeonbuk_row(row):
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
    horizon = OTHER_PREVIEW_DAYS * 24.0
    for row, kickoff in upcoming:
        hours = (kickoff - now).total_seconds() / 3600.0
        if hours < 0 or hours > horizon:
            continue
        gid = str(row.get("game_id") or "")
        key = match_catalog_key(str(row.get("year") or YEAR), gid)
        published = 0 <= hours <= PREVIEW_HOURS
        prev = by_id.get(key)
        if prev is None or (published and not prev[2]):
            by_id[key] = (row, kickoff, published)
    return list(by_id.values())


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
    next_row, next_ko = upcoming[0]
    next_hours = (next_ko - now).total_seconds() / 3600.0
    by_id[match_catalog_key(str(next_row.get("year") or YEAR), str(next_row.get("game_id") or ""))] = (
        next_row,
        next_ko,
        0 <= next_hours <= PREVIEW_HOURS,
    )
    for row, kickoff in upcoming:
        hours = (kickoff - now).total_seconds() / 3600.0
        if 0 <= hours <= PREVIEW_HOURS:
            by_id[match_catalog_key(str(row.get("year") or YEAR), str(row.get("game_id") or ""))] = (
                row,
                kickoff,
                True,
            )
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

    catalog = load_match_catalog()
    print(f"[INFO] match catalog={len(catalog)} files")

    targets = pick_targets(schedule_matches)
    other_targets = pick_other_targets(schedule_matches)
    merged: dict[str, tuple[dict, datetime, bool]] = {}
    for row, kickoff, published in targets:
        merged[match_catalog_key(str(row.get("year") or YEAR), str(row.get("game_id") or ""))] = (
            row,
            kickoff,
            published,
        )
    for row, kickoff, published in other_targets:
        key = match_catalog_key(str(row.get("year") or YEAR), str(row.get("game_id") or ""))
        if key not in merged:
            merged[key] = (row, kickoff, published)

    if not merged:
        payload = {
            "updated_at": now_kst().isoformat(),
            "preview_hours": PREVIEW_HOURS,
            "matches": [],
            "active_game_id": "",
            "note": "예정된 미종료 경기가 없거나 schedule.json이 비어 있습니다.",
        }
        INDEX_OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print("[DONE] no upcoming matches")
        return

    entries = []
    active_id = ""
    for row, kickoff, published in sorted(merged.values(), key=lambda x: x[1]):
        preview = build_preview_payload(row, catalog, index_matches, schedule_matches, kickoff, published)
        gid = preview["meta"]["game_id"]
        out_path = OUT_DIR / f"{gid}.json"
        out_path.write_text(json.dumps(preview, ensure_ascii=False, indent=2), encoding="utf-8")
        is_jb = preview["meta"].get("jeonbuk_match", True)
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
                "jeonbuk_match": is_jb,
                "headline": preview["headline"],
                "file": f"./data/{gid}.json",
            }
        )
        print(
            f"[OK] game_id={gid} jb={is_jb} published={published} "
            f"in={preview['meta']['hours_to_kickoff']}h {preview['headline']}"
        )
        if is_jb and published and not active_id:
            active_id = gid
    if not active_id:
        for e in entries:
            if e.get("jeonbuk_match"):
                active_id = e["game_id"]
                break
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
