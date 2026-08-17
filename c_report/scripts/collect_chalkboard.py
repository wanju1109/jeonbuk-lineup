#!/usr/bin/env python3
"""
Collect K League CHALK BOARD events for Jeonbuk matches.

Uses the public guest portal session (same as data.kleague.com).
Writes c_report/data/{game_id}.json and updates c_report/data/index.json.
"""

from __future__ import annotations

import json
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
INDEX_PATH = DATA_DIR / "index.json"

BASE = "https://portal.kleague.com"
GUEST_LOGIN = BASE + "/user/loginById.do?portalGuest=rstNE9zxjdkUC9kbUA08XQ=="
MATCH_LIST = BASE + "/data/matc/getMatchInfoByRoundIdForSelectTagJson.do"
ROUND_LIST = BASE + "/data/matc/getRoundInfoByMeetYearSeqForSelectTagJson.do"
MAIN_FRAME = BASE + "/mainFrame.do"

YEAR = os.environ.get("KLEAGUE_YEAR") or str(datetime.now().year)
MEET_SEQ = os.environ.get("KLEAGUE_MEET_SEQ") or "1"  # K League 1
ROUND = os.environ.get("KLEAGUE_ROUND")  # optional single round
GAME_ID = os.environ.get("KLEAGUE_GAME_ID")  # optional single game
TEAM_FILTER = os.environ.get("KLEAGUE_TEAM") or "전북"

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


class PortalClient:
    def __init__(self) -> None:
        self.cookie = ""
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())

    def request(
        self,
        url: str,
        data: dict | None = None,
        method: str = "GET",
        timeout: int = 60,
    ) -> str:
        body = None
        headers = {
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
            "Referer": BASE + "/mainFrame.do",
            "Origin": BASE,
        }
        if data is not None:
            body = urllib.parse.urlencode(data).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            method = "POST"
        req = urllib.request.Request(url, data=body, headers=headers, method=method)
        try:
            with self.opener.open(req, timeout=timeout) as resp:
                raw = resp.read()
                encoding = resp.headers.get_content_charset() or "utf-8"
                return raw.decode(encoding, "replace")
        except urllib.error.HTTPError as exc:
            raise RuntimeError(f"HTTP {exc.code} for {url}") from exc
        except urllib.error.URLError as exc:
            raise RuntimeError(f"network error for {url}: {exc}") from exc

    def login_guest(self) -> None:
        html = self.request(GUEST_LOGIN)
        if "K LEAGUE" not in html and "mainFrame" not in html:
            # Still may have redirected; continue and fail later if needed.
            pass


def extract_js_array(html: str, var_name: str) -> list | None:
    """Extract a JS array assigned to var_name using bracket matching."""
    patterns = [
        f"var {var_name}=",
        f"var {var_name} =",
        f"{var_name}=",
        f"{var_name} =",
    ]
    start = -1
    for pat in patterns:
        idx = html.find(pat)
        if idx >= 0:
            start = idx + len(pat)
            break
    if start < 0:
        return None

    while start < len(html) and html[start] in " \t\r\n":
        start += 1
    if start >= len(html) or html[start] != "[":
        return None

    depth = 0
    in_str = False
    esc = False
    end = -1
    for i in range(start, len(html)):
        ch = html[i]
        if in_str:
            if esc:
                esc = False
                continue
            if ch == "\\":
                esc = True
                continue
            if ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
            continue
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i + 1
                break
    if end < 0:
        return None
    try:
        return json.loads(html[start:end])
    except json.JSONDecodeError:
        return None


def parse_options(option_tag: str) -> list[dict]:
    out = []
    for m in re.finditer(
        r'<option\s+value="(\d+)"([^>]*)>(.*?)</option>',
        option_tag or "",
        flags=re.I | re.S,
    ):
        gid = m.group(1)
        attrs = m.group(2)
        text = unescape(re.sub(r"\s+", " ", m.group(3))).strip()
        end_yn = "Y" if re.search(r'data-endYn\s*=\s*"Y"', attrs, re.I) else "N"
        home, away, date = "", "", ""
        tm = re.match(r"(.+?)\s+VS\s+(.+?)\s+\((\d+),\s*([^)]+)\)", text, re.I)
        if tm:
            home, away, date = tm.group(1).strip(), tm.group(2).strip(), tm.group(4).strip()
        out.append(
            {
                "game_id": gid,
                "label": text,
                "end_yn": end_yn,
                "home": home,
                "away": away,
                "date_md": date,
            }
        )
    return out


def flatten_players(player_blocks) -> list[dict]:
    flat = []
    seen = set()
    if not isinstance(player_blocks, list):
        return flat
    for block in player_blocks:
        if not isinstance(block, list):
            continue
        for p in block:
            if not isinstance(p, dict) or not p.get("player_id"):
                continue
            key = f"{p.get('team_id')}|{p.get('player_id')}"
            if key in seen:
                continue
            seen.add(key)
            flat.append(p)
    return flat


def _clean_html_text(text: str) -> str:
    text = unescape(text or "")
    text = text.replace("\xa0", " ").replace("&#013;", "\n")
    text = re.sub(r"&nbsp;", " ", text, flags=re.I)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _box_field(html: str, label: str) -> str:
    pat = (
        rf'class="match-prame-boxTxt01"\s*>\s*{re.escape(label)}\s*</span>\s*'
        rf'<span class="match-prame-boxTxt02"[^>]*>(.*?)</span>'
    )
    m = re.search(pat, html, flags=re.I | re.S)
    return _clean_html_text(m.group(1)) if m else ""


def parse_match_frame_meta(html: str) -> dict:
    """Parse venue/attendance/weather/referee/managers from mainFrame HTML."""
    venue = _box_field(html, "장소")
    date_raw = _box_field(html, "경기일자")
    att_raw = _box_field(html, "관중수")
    weather_raw = _box_field(html, "날씨")
    referee = _box_field(html, "주심")

    kickoff = ""
    m_time = re.search(r'id="gameTime"\s+value="([^"]*)"', html, flags=re.I)
    if m_time:
        kickoff = _clean_html_text(m_time.group(1))

    field_from_param = ""
    m_field = re.search(r'"fieldName"\s*:\s*"([^"]*)"', html)
    if m_field:
        field_from_param = _clean_html_text(m_field.group(1))
    if not venue and field_from_param:
        venue = field_from_param

    attendance = None
    digits = re.sub(r"[^\d]", "", att_raw)
    if digits:
        try:
            attendance = int(digits)
        except ValueError:
            attendance = None

    weather = weather_raw
    temperature_c = None
    wm = re.search(r"(.+?)\(\s*([\d.]+)\s*℃\s*\)", weather_raw)
    if wm:
        weather = _clean_html_text(wm.group(1))
        try:
            temperature_c = float(wm.group(2))
        except ValueError:
            temperature_c = None

    officials = {"referee": referee, "ar1": "", "ar2": "", "fourth": "", "var": "", "avar": ""}
    m_title = re.search(
        r'class="match-prame-boxTxt01"\s*>\s*주심\s*</span>\s*'
        r'<span class="match-prame-boxTxt02"\s+title="([^"]*)"',
        html,
        flags=re.I | re.S,
    )
    if m_title:
        title = unescape(m_title.group(1))
        title = title.replace("\xa0", " ").replace("&nbsp;", " ")
        title = title.replace("&#013;", "\n").replace("\r", "\n")
        for line in re.split(r"[\n]+", title):
            line = re.sub(r"\s+", " ", line).strip()
            if ":" not in line:
                continue
            key, val = [x.strip() for x in line.split(":", 1)]
            if key.startswith("부심1"):
                officials["ar1"] = val
            elif key.startswith("부심2"):
                officials["ar2"] = val
            elif key.startswith("대기심"):
                officials["fourth"] = val
            elif key == "VAR":
                officials["var"] = val
            elif key == "AVAR":
                officials["avar"] = val

    managers = re.findall(
        r"감독</li>\s*<li class=\"main-soccer-txt02[^\"]*\"[^>]*>\s*([^<]+)</li>",
        html,
        flags=re.I | re.S,
    )
    home_manager = _clean_html_text(managers[0]) if len(managers) > 0 else ""
    away_manager = _clean_html_text(managers[1]) if len(managers) > 1 else ""

    date = ""
    dm = re.search(r"(\d{4})[./-](\d{1,2})[./-](\d{1,2})", date_raw)
    if dm:
        date = f"{dm.group(1)}-{int(dm.group(2)):02d}-{int(dm.group(3)):02d}"

    return {
        "venue": venue,
        "date": date,
        "kickoff": kickoff,
        "attendance": attendance,
        "weather": weather,
        "temperature_c": temperature_c,
        "humidity": None,  # not published on portal chalkboard frame
        "referee": referee,
        "officials": officials,
        "home_manager": home_manager,
        "away_manager": away_manager,
    }


def infer_team_names(events: list, players: list, home_hint: str, away_hint: str) -> tuple[dict, dict]:
    home_id = next((e.get("TEAM_ID") for e in events if e.get("HA_CODE") == "H"), None)
    away_id = next((e.get("TEAM_ID") for e in events if e.get("HA_CODE") == "A"), None)
    if not home_id and players:
        # fallback: majority of first XI team ids is unreliable; use hints only
        home_id = "K05"
    if not away_id:
        away_id = "K04"

    def name_for(team_id: str, hint: str) -> str:
        if hint:
            return hint
        return "홈" if team_id == home_id else "원정"

    return (
        {"team_id": home_id, "name": name_for(home_id, home_hint), "short": name_for(home_id, home_hint), "manager": ""},
        {"team_id": away_id, "name": name_for(away_id, away_hint), "short": name_for(away_id, away_hint), "manager": ""},
    )


def parse_score_from_goals(events: list, home_id: str, away_id: str) -> tuple[int, int]:
    goals = [e for e in events if e.get("TYPE_DETAIL_CD") == "GL"]
    hs = sum(1 for g in goals if g.get("TEAM_ID") == home_id)
    as_ = sum(1 for g in goals if g.get("TEAM_ID") == away_id)
    return hs, as_


def load_index() -> dict:
    if not INDEX_PATH.exists():
        return {"matches": [], "updated_at": None}
    try:
        return json.loads(INDEX_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"matches": [], "updated_at": None}


def save_index(matches: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    uniq = {}
    for m in matches:
        gid = str(m.get("game_id") or "")
        if not gid:
            continue
        uniq[gid] = m
    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "matches": sorted(
            uniq.values(),
            key=lambda x: (str(x.get("year") or ""), int(x.get("round") or 0), str(x.get("game_id") or "")),
        ),
    }
    INDEX_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def fetch_rounds(client: PortalClient, year: str, meet_seq: str) -> list[str]:
    text = client.request(
        ROUND_LIST,
        data={"meetYear": year, "meetSeq": meet_seq},
    )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError("round list JSON parse failed") from exc
    rounds = []
    for m in re.finditer(r'<option\s+value="(\d+)"', data.get("optionTag") or "", re.I):
        rounds.append(m.group(1))
    return rounds


def fetch_matches(client: PortalClient, year: str, meet_seq: str, round_id: str) -> list[dict]:
    text = client.request(
        MATCH_LIST,
        data={"meetYear": year, "meetSeq": meet_seq, "roundId": round_id},
    )
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"match list JSON parse failed for round {round_id}") from exc
    return parse_options(data.get("optionTag") or "")


def fetch_chalkboard(client: PortalClient, year: str, meet_seq: str, round_id: str, game_id: str) -> dict:
    html = client.request(
        MAIN_FRAME,
        data={
            "meetYear": year,
            "meetSeq": meet_seq,
            "roundId": round_id,
            "gameId": game_id,
            "selectedMenuCd": "0302",
        },
    )
    events = extract_js_array(html, "jsonResultData")
    players_raw = extract_js_array(html, "chalkPlayerListJson")
    if not events:
        raise RuntimeError(f"jsonResultData missing for game_id={game_id}")
    players = flatten_players(players_raw or [])

    lineup_html = ""
    lineup = {"home": [], "away": [], "subs": []}
    try:
        lineup_html = client.request(
            MAIN_FRAME,
            data={
                "meetYear": year,
                "meetSeq": meet_seq,
                "roundId": round_id,
                "gameId": game_id,
                "selectedMenuCd": "0301",
            },
        )
        chart = extract_js_array(lineup_html, "chartDataSet")
        lineup = parse_lineup_chart(chart)
    except Exception as exc:
        print(f"[WARN] lineup fetch failed game_id={game_id}: {exc}")

    return {
        "html": html,
        "lineup_html": lineup_html,
        "events": events,
        "players": players,
        "lineup": lineup,
    }


def _parse_clock_blob(text: str) -> dict | None:
    raw = _clean_html_text(text or "")
    if not raw:
        return None
    kind = ""
    up = raw.upper()
    if "OUT" in up:
        kind = "OUT"
    elif re.search(r"\bIN\b", up) or raw.endswith("IN") or " IN" in raw:
        kind = "IN"
    period = 1 if "전반" in raw else (2 if "후반" in raw else None)
    m = re.search(r"(\d+)\s*분", raw)
    minute = int(m.group(1)) if m else None
    label = raw
    if period == 1 and minute is not None:
        label = f"전반 {minute}'"
    elif period == 2 and minute is not None:
        label = f"후반 {minute}'"
    return {"raw": raw, "kind": kind, "period": period, "minute": minute, "label": label}


def parse_lineup_chart(chart) -> dict:
    """Parse official match sheet players from menu 0301 chartDataSet."""
    rows: list[dict] = []
    if isinstance(chart, list):
        for block in chart:
            if not isinstance(block, list):
                continue
            cand = [
                x
                for x in block
                if isinstance(x, dict) and x.get("playerId") and x.get("playerSeq") is not None
            ]
            if len(cand) >= 11:
                rows = cand
                break

    by_id: dict[str, dict] = {}
    for r in rows:
        pid = str(r.get("playerId"))
        in_info = _parse_clock_blob(str(r.get("evntTime05") or ""))
        out_info = _parse_clock_blob(str(r.get("evntTime06") or ""))
        seq = int(r.get("playerSeq") or 99)
        row = {
            "player_id": pid,
            "name": r.get("name") or "",
            "back_no": r.get("backNo"),
            "team_id": r.get("teamId") or "",
            "team_name": r.get("teamNm") or "",
            "ha": r.get("ha") or "",
            "position": r.get("positionNm") or "",
            "position_code": r.get("positionCode"),
            "seq": seq,
            "starter": seq <= 11,
            "minutes": r.get("workTime"),
            "yellow": int(r.get("ycCnt") or 0),
            "red": int(r.get("rcCnt") or 0),
            "captain": str(r.get("captainYn") or "N").upper() == "Y",
            "in_label": in_info["label"] if in_info and in_info["kind"] == "IN" else (in_info["label"] if in_info else ""),
            "out_label": out_info["label"] if out_info and out_info["kind"] == "OUT" else (out_info["label"] if out_info else ""),
            "in_period": in_info["period"] if in_info else None,
            "in_minute": in_info["minute"] if in_info else None,
            "out_period": out_info["period"] if out_info else None,
            "out_minute": out_info["minute"] if out_info else None,
        }
        by_id[pid] = row

    home = sorted([p for p in by_id.values() if p["ha"] == "H"], key=lambda x: x["seq"])
    away = sorted([p for p in by_id.values() if p["ha"] == "A"], key=lambda x: x["seq"])

    # Pair substitutions: OUT starter + IN sub around same clock label
    subs = []
    for side, team_rows in (("H", home), ("A", away)):
        outs = [p for p in team_rows if p.get("out_label")]
        ins = [p for p in team_rows if p.get("in_label")]
        used_in = set()
        for out_p in outs:
            match_in = None
            for in_p in ins:
                if in_p["player_id"] in used_in:
                    continue
                if out_p.get("out_label") and in_p.get("in_label") and out_p["out_label"] == in_p["in_label"]:
                    match_in = in_p
                    break
            if not match_in:
                for in_p in ins:
                    if in_p["player_id"] in used_in:
                        continue
                    if (
                        out_p.get("out_period") == in_p.get("in_period")
                        and out_p.get("out_minute") is not None
                        and in_p.get("in_minute") is not None
                        and abs(out_p["out_minute"] - in_p["in_minute"]) <= 1
                    ):
                        match_in = in_p
                        break
            if match_in:
                used_in.add(match_in["player_id"])
                subs.append(
                    {
                        "ha": side,
                        "team_id": out_p["team_id"],
                        "team_name": out_p["team_name"],
                        "time_label": out_p.get("out_label") or match_in.get("in_label") or "",
                        "period": out_p.get("out_period") or match_in.get("in_period"),
                        "minute": out_p.get("out_minute") if out_p.get("out_minute") is not None else match_in.get("in_minute"),
                        "player_out": {
                            "player_id": out_p["player_id"],
                            "name": out_p["name"],
                            "back_no": out_p["back_no"],
                        },
                        "player_in": {
                            "player_id": match_in["player_id"],
                            "name": match_in["name"],
                            "back_no": match_in["back_no"],
                        },
                    }
                )
        for in_p in ins:
            if in_p["player_id"] in used_in:
                continue
            subs.append(
                {
                    "ha": side,
                    "team_id": in_p["team_id"],
                    "team_name": in_p["team_name"],
                    "time_label": in_p.get("in_label") or "",
                    "period": in_p.get("in_period"),
                    "minute": in_p.get("in_minute"),
                    "player_out": None,
                    "player_in": {
                        "player_id": in_p["player_id"],
                        "name": in_p["name"],
                        "back_no": in_p["back_no"],
                    },
                }
            )

    def sort_key(s: dict):
        period = s.get("period") or 9
        minute = s.get("minute") if s.get("minute") is not None else 99
        return (period, minute)

    subs.sort(key=sort_key)
    return {"home": home, "away": away, "subs": subs}


def build_payload(
    year: str,
    meet_seq: str,
    round_id: str,
    match: dict,
    events: list,
    players: list,
    html: str,
    lineup: dict | None = None,
) -> dict:
    home_meta, away_meta = infer_team_names(events, players, match.get("home") or "", match.get("away") or "")
    hs, as_ = parse_score_from_goals(events, home_meta["team_id"], away_meta["team_id"])
    frame = parse_match_frame_meta(html)

    date = frame.get("date") or ""
    if not date and match.get("date_md"):
        mmdd = match["date_md"].replace(".", "/")
        if re.match(r"\d{2}/\d{2}", mmdd):
            date = f"{year}-{mmdd[0:2]}-{mmdd[3:5]}"

    if frame.get("home_manager"):
        home_meta["manager"] = frame["home_manager"]
    if frame.get("away_manager"):
        away_meta["manager"] = frame["away_manager"]

    weather_disp = frame.get("weather") or ""
    if frame.get("temperature_c") is not None:
        weather_disp = f"{weather_disp} {frame['temperature_c']:g}℃".strip()

    return {
        "meta": {
            "meet_year": year,
            "meet_seq": int(meet_seq) if str(meet_seq).isdigit() else meet_seq,
            "competition": "하나은행 K리그1" if str(meet_seq) == "1" else f"대회 {meet_seq}",
            "round": int(round_id),
            "game_id": str(match["game_id"]),
            "date": date,
            "kickoff": frame.get("kickoff") or "",
            "venue": frame.get("venue") or "",
            "attendance": frame.get("attendance"),
            "weather": weather_disp,
            "temperature_c": frame.get("temperature_c"),
            "humidity": frame.get("humidity"),
            "referee": frame.get("referee") or "",
            "officials": frame.get("officials") or {},
            "home": home_meta,
            "away": away_meta,
            "score": {"home": hs, "away": as_},
            "source": "K LEAGUE PORTAL CHALK BOARD",
            "note": "보도/커뮤니티 재가공용. 부가기록(Bepro11) 기준. 자동 수집.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        },
        "lineup": lineup or {"home": [], "away": [], "subs": []},
        "players": players,
        "events": events,
    }


def main() -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    client = PortalClient()
    print(f"[INFO] guest login year={YEAR} meetSeq={MEET_SEQ}")
    client.login_guest()

    index = load_index()
    by_id = {str(m.get("game_id")): m for m in index.get("matches", []) if m.get("game_id")}

    if GAME_ID:
        round_ids = [ROUND] if ROUND else fetch_rounds(client, YEAR, MEET_SEQ)
    elif ROUND:
        round_ids = [str(ROUND)]
    else:
        round_ids = fetch_rounds(client, YEAR, MEET_SEQ)

    collected = 0
    for rid in round_ids:
        try:
            matches = fetch_matches(client, YEAR, MEET_SEQ, rid)
        except Exception as exc:
            print(f"[WARN] round {rid} list failed: {exc}")
            continue

        for match in matches:
            if GAME_ID and str(match["game_id"]) != str(GAME_ID):
                continue
            if match.get("end_yn") != "Y":
                continue
            label = match.get("label") or ""
            if TEAM_FILTER and TEAM_FILTER not in label:
                continue

            gid = str(match["game_id"])
            out_path = DATA_DIR / f"{gid}.json"
            try:
                print(f"[FETCH] R{rid} {label}")
                packed = fetch_chalkboard(client, YEAR, MEET_SEQ, rid, gid)
                payload = build_payload(
                    YEAR,
                    MEET_SEQ,
                    rid,
                    match,
                    packed["events"],
                    packed["players"],
                    packed["html"],
                    packed.get("lineup"),
                )
                out_path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
                by_id[gid] = {
                    "game_id": gid,
                    "year": YEAR,
                    "round": int(rid),
                    "home": payload["meta"]["home"]["name"],
                    "away": payload["meta"]["away"]["name"],
                    "score": f"{payload['meta']['score']['home']}:{payload['meta']['score']['away']}",
                    "date": payload["meta"].get("date") or "",
                    "venue": payload["meta"].get("venue") or "",
                    "attendance": payload["meta"].get("attendance"),
                    "file": f"./data/{gid}.json",
                    "label": label,
                }
                collected += 1
                print(f"[OK] game_id={gid} events={len(payload['events'])}")
                time.sleep(0.4)
            except Exception as exc:
                print(f"[WARN] game_id={gid}: {exc}")

    save_index(list(by_id.values()))
    print(f"[DONE] collected={collected}, index={len(by_id)}")


if __name__ == "__main__":
    main()
