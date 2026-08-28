#!/usr/bin/env python3
"""
K LEAGUE data collector for GitHub Actions.

This script runs on GitHub's server, not in the user's browser.
It downloads the official K LEAGUE schedule and match-chart pages,
then stores the original match-chart HTML locally for p_report.html.

It does not invent game IDs or statistics.
"""

from __future__ import annotations

import html as html_lib
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlparse

import requests
from bs4 import BeautifulSoup

BASE = "https://portal.kleague.com"
SCHEDULE_URL = BASE + "/view/schedule/list.do"
MATCH_CHART_URLS = [
    BASE + "/data/matc/matchChartPre.do",
    BASE + "/data/matc/matchChart.do",
]

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
MATCH_DIR = DATA_DIR / "matches"
YEAR = os.environ.get("KLEAGUE_YEAR") or str(datetime.now(timezone(timedelta(hours=9))).year)
LEAGUES = [("1", 33), ("2", 39)]

session = requests.Session()
session.headers.update({
    "User-Agent": "Mozilla/5.0 (compatible; KLeagueReportCollector/1.0)",
    "Accept": "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    "Referer": BASE + "/",
})

def clean(v):
    return re.sub(r"\s+", " ", str(v or "")).strip()

def decode(v):
    try:
        return unquote(html_lib.unescape(v))
    except Exception:
        return v

def params_from_text(text):
    """Extract query-like parameters from href/onclick/JS."""
    out = {}
    text = decode(text or "")
    patterns = [
        r'([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["\']([^"\']+)["\']',
        r'([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([0-9]+)',
        r'[?&;]([A-Za-z_][A-Za-z0-9_]*)=([^&;,\s\)]+)',
    ]
    for pat in patterns:
        for m in re.finditer(pat, text):
            out[m.group(1).lower()] = decode(m.group(2))
    return out

def first_param(p, *names):
    for n in names:
        if n.lower() in p and p[n.lower()] != "":
            return p[n.lower()]
    return ""

def parse_teams(text):
    text = clean(text)
    m = re.search(r"(.{1,30}?)\s*:\s*(.{1,30}?)(?:\s*\(|\s+\d{1,2}:\d{2}|$)", text)
    if not m:
        return None
    home, away = clean(m.group(1)), clean(m.group(2))
    if not home or not away:
        return None
    return home, away

def absolute_href(raw):
    raw = decode(raw or "")
    m = re.search(r'https?://[^"\'\s)]+', raw)
    return m.group(0) if m else ""

def parse_schedule_page(text, year, league_id):
    soup = BeautifulSoup(text, "html.parser")
    found = {}

    # First priority: actual links / onclicks containing game_id.
    for el in soup.find_all(True):
        href = el.get("href") or ""
        onclick = el.get("onclick") or ""
        raw = f"{href} {onclick}"
        if not re.search(r"(game[_-]?id|gameId)", raw, re.I):
            continue

        p = params_from_text(raw)
        game_id = first_param(p, "game_id", "gameid", "gameId")
        if not game_id or not str(game_id).isdigit():
            m = re.search(r"(?:game[_-]?id|gameId)\s*[=:]\s*[\"']?(\d+)", raw, re.I)
            game_id = m.group(1) if m else ""
        if not game_id:
            continue

        # The link text is normally the safest source of the matchup.
        text_value = clean(el.get_text(" ", strip=True))
        teams = parse_teams(text_value)

        # If the anchor text is not enough, use its nearest parent.
        if not teams:
            parent = el.parent
            for _ in range(3):
                if not parent:
                    break
                teams = parse_teams(clean(parent.get_text(" ", strip=True)))
                if teams:
                    break
                parent = parent.parent

        item = {
            "game_id": str(game_id),
            "league_id": str(league_id),
            "year": str(year),
            "round": first_param(p, "round", "round_id", "roundid", "roundId"),
            "round_id": first_param(p, "round_id", "roundid", "roundId", "round"),
            "meet_seq": first_param(p, "meet_seq", "meetseq", "meetSeq"),
            "date": first_param(p, "game_date", "gamedate", "gameDate"),
            "time": first_param(p, "game_time", "gametime", "gameTime"),
            "url": absolute_href(raw),
        }
        if teams:
            item["home"], item["away"] = teams

        found[str(game_id)] = {**found.get(str(game_id), {}), **item}

    # Secondary: raw HTML can contain GAME_ID even if the visible element
    # doesn't expose it as a clean href. We still require a real game_id.
    for m in re.finditer(
        r"(?:GAME_ID|game_id|gameId)\s*[:=]\s*[\"']?(\d+)[\"']?",
        text,
        re.I,
    ):
        gid = m.group(1)
        if gid in found:
            continue
        window = clean(BeautifulSoup(text[max(0, m.start()-1000):m.end()+1000], "html.parser").get_text(" ", strip=True))
        teams = parse_teams(window)
        if teams:
            found[gid] = {
                "game_id": gid,
                "league_id": str(league_id),
                "year": str(year),
                "home": teams[0],
                "away": teams[1],
            }

    return list(found.values())

def extract_meta(html):
    """Best-effort extraction of round/date/time from chart JS variables."""
    out = {}
    patterns = {
        "round": [
            r'["\']?(?:round|ROUND|round_no|ROUND_NO|roundNum|ROUND_NUM)["\']?\s*[:=]\s*["\']?([^,"\'}\s]+)',
        ],
        "round_id": [
            r'["\']?(?:round_id|ROUND_ID|roundId|ROUNDID)["\']?\s*[:=]\s*["\']?([^,"\'}\s]+)',
        ],
        "date": [
            r'["\']?(?:game_date|GAME_DATE|gameDate)["\']?\s*[:=]\s*["\']?([^,"\'}\s]+)',
        ],
        "time": [
            r'["\']?(?:game_time|GAME_TIME|gameTime)["\']?\s*[:=]\s*["\']?([^,"\'}\s]+)',
        ],
    }
    for key, pats in patterns.items():
        for pat in pats:
            m = re.search(pat, html)
            if m:
                out[key] = clean(m.group(1))
                break
    return out

def fetch(url, params=None, timeout=30):
    r = session.get(url, params=params, timeout=timeout)
    r.raise_for_status()
    r.encoding = r.apparent_encoding or r.encoding
    return r.text

def fetch_chart(item):
    q = {}
    for k in ("year", "meet_seq", "game_id", "round_id"):
        v = item.get(k)
        if v:
            q[k if k != "year" else "meet_year"] = v

    candidates = []
    if item.get("url"):
        candidates.append(item["url"])
    for u in MATCH_CHART_URLS:
        candidates.append(u)

    last = None
    for url in candidates:
        try:
            if "?" in url:
                text = fetch(url)
            else:
                text = fetch(url, params=q)
            if "chartCompDataSet" in text and "chartMatchDataSet" in text:
                return text
        except Exception as exc:
            last = exc
    raise RuntimeError(f"match chart fetch failed for game_id={item.get('game_id')}: {last}")

def load_index(year):
    p = DATA_DIR / f"{year}.json"
    if not p.exists():
        return {"year": year, "updated_at": None, "matches": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"year": year, "updated_at": None, "matches": []}

def save_index(year, matches):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "year": str(year),
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "matches": sorted(
            matches,
            key=lambda x: (
                str(x.get("round") or "999"),
                str(x.get("date") or ""),
                str(x.get("game_id") or ""),
            ),
        ),
    }
    (DATA_DIR / f"{year}.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

def should_refresh(item):
    path = ROOT / item.get("data_file", "")
    if not path.exists():
        return True

    # Re-fetch recent/future matches so live/updating match-chart data can settle.
    raw = item.get("date") or ""
    try:
        dt = datetime.strptime(raw[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
        age = datetime.now(timezone.utc) - dt
        return age < timedelta(days=14)
    except Exception:
        return False

def main():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    MATCH_DIR.mkdir(parents=True, exist_ok=True)

    existing = load_index(YEAR)
    by_id = {str(x.get("game_id")): x for x in existing.get("matches", []) if x.get("game_id")}

    total_schedule = 0

    for league_id, _ in LEAGUES:
        for month in range(1, 13):
            url = SCHEDULE_URL
            try:
                text = fetch(url, params={
                    "year": YEAR,
                    "month": f"{month:02d}",
                    "leagueId": league_id,
                })
                items = parse_schedule_page(text, YEAR, league_id)
                total_schedule += len(items)
                for item in items:
                    gid = item["game_id"]
                    old = by_id.get(gid, {})
                    merged = {**old, **{k: v for k, v in item.items() if v}}
                    by_id[gid] = merged
            except Exception as exc:
                print(f"[WARN] schedule {YEAR}-{month:02d} league={league_id}: {exc}")

    # Fetch only games whose chart data is missing or recently played.
    for gid, item in sorted(by_id.items()):
        if not should_refresh(item):
            continue
        try:
            chart = fetch_chart(item)
            path = MATCH_DIR / f"{gid}.html"
            path.write_text(chart, encoding="utf-8")

            meta = extract_meta(chart)
            for key in ("round", "round_id", "date", "time"):
                if meta.get(key) and not item.get(key):
                    item[key] = meta[key]

            item["data_file"] = f"./data/matches/{gid}.html"
            item["fetched_at"] = datetime.now(timezone.utc).isoformat()
            by_id[gid] = item
            print(f"[OK] game_id={gid} {item.get('home','')} : {item.get('away','')}")
            time.sleep(0.3)
        except Exception as exc:
            print(f"[WARN] game_id={gid}: {exc}")

    save_index(YEAR, list(by_id.values()))
    print(f"[DONE] schedule candidates={total_schedule}, stored matches={len(by_id)}")

if __name__ == "__main__":
    main()
