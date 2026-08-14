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
    return {"html": html, "events": events, "players": players}


def build_payload(
    year: str,
    meet_seq: str,
    round_id: str,
    match: dict,
    events: list,
    players: list,
    html: str,
) -> dict:
    home_meta, away_meta = infer_team_names(events, players, match.get("home") or "", match.get("away") or "")
    hs, as_ = parse_score_from_goals(events, home_meta["team_id"], away_meta["team_id"])

    date = ""
    if match.get("date_md"):
        # date_md like 08/08
        mmdd = match["date_md"].replace(".", "/")
        date = f"{year}-{mmdd.replace('/', '-')}" if re.match(r"\d{2}/\d{2}", mmdd) else ""
        if re.match(r"\d{2}/\d{2}", mmdd):
            date = f"{year}-{mmdd[0:2]}-{mmdd[3:5]}"

    return {
        "meta": {
            "meet_year": year,
            "meet_seq": int(meet_seq) if str(meet_seq).isdigit() else meet_seq,
            "competition": "하나은행 K리그1" if str(meet_seq) == "1" else f"대회 {meet_seq}",
            "round": int(round_id),
            "game_id": str(match["game_id"]),
            "date": date,
            "kickoff": "",
            "venue": "",
            "attendance": None,
            "weather": "",
            "referee": "",
            "home": home_meta,
            "away": away_meta,
            "score": {"home": hs, "away": as_},
            "source": "K LEAGUE PORTAL CHALK BOARD",
            "note": "보도/커뮤니티 재가공용. 부가기록(Bepro11) 기준. 자동 수집.",
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        },
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
                    YEAR, MEET_SEQ, rid, match, packed["events"], packed["players"], packed["html"]
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
