#!/usr/bin/env python3
"""
Collect K League 1/2 squads, career tables, and photo URLs.

Current squads: K League Data Portal player list
(data.kleague.com / portal.kleague.com Data Center > Players > Player list).
Records: kleague.com playerDetail.
Photos: club CDN when known, else official CloudFront / portal profile shot.
Writes player_report/data/index.json and player_report/data/players/{id}.json.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
PLAYER_DIR = DATA_DIR / "players"
SCRIPTS = Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))

from scout import _age, generate_scout  # noqa: E402

YEAR = os.environ.get("KLEAGUE_YEAR") or str(datetime.now().year)
FORCE = os.environ.get("KLEAGUE_FORCE", "").lower() in ("1", "true", "yes")
ONLY_TEAM = (os.environ.get("KLEAGUE_TEAM_ID") or "").strip().upper()
SLEEP = float(os.environ.get("KLEAGUE_SLEEP") or "0.25")

BASE = "https://www.kleague.com"
PORTAL = "https://portal.kleague.com"
PORTAL_GUEST = (
    f"{PORTAL}/user/loginById.do?portalGuest=rstNE9zxjdkUC9kbUA08XQ=="
)
PORTAL_PLAYER_LIST = f"{PORTAL}/data/player/playerList.do"
CF = "https://d2tfp74nsbbrkr.cloudfront.net/v1/player"
JBFC_PLAYER_API = "https://api.jbfc.kr/player"

_portal_opener: urllib.request.OpenerDirector | None = None
_portal_by_team: dict[str, list[dict]] | None = None

# Club CDN filename can differ from the official K League player id
# (Dodo: K League 20260374, club file 20269696.png).
_jbfc_by_name: dict[str, dict] | None = None

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

# Official club sites from kleague.com club bar. Player-page templates only
# where the club uses the K League player id in the URL.
CLUB_META = {
    "K01": {"short": "울산", "full": "울산 HD", "home": "https://www.uhdfc.com", "color": "#014291"},
    "K02": {"short": "수원", "full": "수원 삼성", "home": "https://www.bluewings.kr", "color": "#004EA2"},
    "K03": {"short": "포항", "full": "포항 스틸러스", "home": "https://www.steelers.co.kr", "color": "#E4453A"},
    "K04": {"short": "제주", "full": "제주SK FC", "home": "https://www.jejuskfc.com", "color": "#ED7402"},
    "K05": {
        "short": "전북",
        "full": "전북 현대",
        "home": "https://www.hyundai-motorsfc.com",
        "player": "https://hyundai-motorsfc.com/team/player/{id}",
        "photo": "https://jbhd-upload-file.s3.ap-northeast-2.amazonaws.com/images/player/{year}/{id}.png",
        "color": "#037340",
    },
    "K06": {"short": "부산", "full": "부산 아이파크", "home": "https://www.busanipark.com", "color": "#C4161C"},
    "K07": {"short": "전남", "full": "전남 드래곤즈", "home": "https://www.dragons.co.kr", "color": "#FFCC00"},
    "K08": {"short": "성남", "full": "성남FC", "home": "https://seongnamfc.com", "color": "#000000"},
    "K09": {"short": "서울", "full": "FC서울", "home": "https://www.fcseoul.com", "color": "#D9000F"},
    "K10": {"short": "대전", "full": "대전 하나 시티즌", "home": "https://www.dhcfc.kr", "color": "#092E6E"},
    "K17": {"short": "대구", "full": "대구FC", "home": "https://daegufc.co.kr", "color": "#82C0F0"},
    "K18": {"short": "인천", "full": "인천 유나이티드", "home": "https://www.incheonutd.com", "color": "#0A70BF"},
    "K20": {"short": "경남", "full": "경남FC", "home": "http://www.gyeongnamfc.com", "color": "#C41E3A"},
    "K21": {"short": "강원", "full": "강원FC", "home": "https://www.gangwon-fc.com", "color": "#01605C"},
    "K22": {"short": "광주", "full": "광주FC", "home": "https://www.gwangjufc.com", "color": "#C70026"},
    "K26": {"short": "부천", "full": "부천FC1995", "home": "https://www.bfc1995.com", "color": "#BA1E1B"},
    "K27": {"short": "안양", "full": "FC안양", "home": "https://www.fc-anyang.com", "color": "#521E89"},
    "K29": {"short": "수원FC", "full": "수원FC", "home": "https://www.suwonfc.com", "color": "#002B5C"},
    "K31": {"short": "서울E", "full": "서울 이랜드", "home": "https://www.seoulelandfc.com", "color": "#6C1D45"},
    "K32": {"short": "안산", "full": "안산 그리너스", "home": "https://www.greenersfc.com", "color": "#2E8B57"},
    "K34": {"short": "충남아산", "full": "충남 아산", "home": "https://www.asanfc.com", "color": "#0B3A82"},
    "K35": {"short": "김천", "full": "김천 상무", "home": "https://gimcheonfc.com", "color": "#002749"},
    "K36": {"short": "김포", "full": "김포FC", "home": "https://www.gimpofc.com", "color": "#1B4F72"},
    "K37": {"short": "충북청주", "full": "충북 청주", "home": "https://chfc.kr", "color": "#1A5276"},
    "K38": {"short": "천안", "full": "천안 시티", "home": "https://cheonancityfc.kr", "color": "#C0392B"},
    "K39": {"short": "화성", "full": "화성FC", "home": "https://www.hwaseongfc.com", "color": "#1E8449"},
    "K40": {"short": "파주", "full": "파주 프론티어", "home": "https://www.pajufrontier.com", "color": "#1F618D"},
    "K41": {"short": "김해", "full": "김해FC", "home": "https://gimhaefc2008.com", "color": "#1A5276"},
    "K42": {"short": "용인", "full": "용인FC", "home": "https://www.yonginfc.co.kr", "color": "#1ABC9C"},
}

POS_ORDER = {"GK": 0, "DF": 1, "MF": 2, "FW": 3}
STAFF_RE = re.compile(r"(코치|감독|분석|스카우터|트레이너|피지컬|의무|통역|장비)")


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch(url: str, timeout: int = 40) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Referer": BASE + "/",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read()
            enc = resp.headers.get_content_charset() or "utf-8"
            return raw.decode(enc, "replace")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"network error for {url}: {exc}") from exc


def head_ok(url: str, timeout: int = 12) -> bool:
    req = urllib.request.Request(
        url,
        method="HEAD",
        headers={"User-Agent": UA, "Referer": BASE + "/"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            return resp.status == 200 and ("image" in ctype or "octet-stream" in ctype)
    except Exception:
        try:
            req2 = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(req2, timeout=timeout) as resp:
                ctype = (resp.headers.get("Content-Type") or "").lower()
                return resp.status == 200 and ("image" in ctype or "octet-stream" in ctype)
        except Exception:
            return False


def clean(text: str) -> str:
    text = unescape(text or "")
    text = text.replace("\xa0", " ")
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def to_int(text: str) -> int | None:
    t = clean(text).replace(",", "")
    if t in ("", "-", "–"):
        return None
    try:
        return int(t)
    except ValueError:
        return None


def parse_clubs(html: str) -> list[dict]:
    block = re.search(
        r'id="clubList"[^>]*>(.*?)</select>',
        html,
        flags=re.I | re.S,
    )
    if not block:
        return []
    out = []
    seen = set()
    for m in re.finditer(
        r'<option\s+value="(K\d+)"[^>]*>(.*?)</option>',
        block.group(1),
        flags=re.I | re.S,
    ):
        tid = m.group(1).upper()
        if tid in seen:
            continue
        seen.add(tid)
        label = clean(m.group(2))
        meta = CLUB_META.get(tid, {})
        out.append(
            {
                "id": tid,
                "name": meta.get("short") or label,
                "full": meta.get("full") or label,
                "home": meta.get("home") or "",
                "color": meta.get("color") or "#146b4a",
            }
        )
    return out


def last_page(html: str) -> int:
    nums = [int(x) for x in re.findall(r"goToPage\((\d+)\)", html)]
    return max(nums) if nums else 1


def parse_list_cards(html: str, team_id: str, pos: str) -> list[dict]:
    cards = []
    chunks = re.split(r'onclick="onPlayerClicked\((\d+)\)"', html)
    # chunks[0] preamble, then id, body, id, body...
    i = 1
    while i + 1 < len(chunks):
        pid = chunks[i]
        body = chunks[i + 1]
        i += 2
        if STAFF_RE.search(body):
            continue
        img = ""
        im = re.search(r'<img[^>]+src="(https://d2tfp74nsbbrkr[^"]+)"', body)
        if im:
            img = valid_kleague_photo(im.group(1))
        name = ""
        nm = re.search(r'<span class="name">([^<]+)', body)
        if nm:
            name = clean(nm.group(1))
        back = None
        bm = re.search(r'class="num campton">No\.?\s*(\d+)', body)
        if bm:
            back = int(bm.group(1))
        if not name or not pid:
            continue
        cards.append(
            {
                "id": str(pid),
                "name": name,
                "back_no": back,
                "position": pos.upper(),
                "team_id": team_id,
                "kleague_photo": img,
            }
        )
    return cards


def cell_list(row_html: str) -> list[str]:
    return [clean(c) for c in re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", row_html, flags=re.I | re.S)]


def triple_from(stats: list[str], offset: int, is_gk: bool) -> dict:
    a = stats[offset] if offset < len(stats) else ""
    b = stats[offset + 1] if offset + 1 < len(stats) else ""
    c = stats[offset + 2] if offset + 2 < len(stats) else ""
    if is_gk:
        return {
            "apps": to_int(a),
            "goals_conceded": to_int(b),
            "clean_sheets": to_int(c),
        }
    return {"apps": to_int(a), "goals": to_int(b), "assists": to_int(c)}


def pack_record(stats: list[str], is_gk: bool, season: str | None, team: str | None) -> dict | None:
    if len(stats) < 18:
        return None
    rec = {
        "season": season,
        "team": team,
        "k1": triple_from(stats, 0, is_gk),
        "k2": triple_from(stats, 3, is_gk),
        "po": triple_from(stats, 6, is_gk),
        "cup": triple_from(stats, 9, is_gk),
        "super_cup": triple_from(stats, 12, is_gk),
        "total": triple_from(stats, 15, is_gk),
    }
    tot = rec["total"]
    rec["total_apps"] = tot.get("apps")
    if is_gk:
        rec["total_gc"] = tot.get("goals_conceded")
        rec["total_cs"] = tot.get("clean_sheets")
    else:
        rec["total_goals"] = tot.get("goals")
        rec["total_assists"] = tot.get("assists")
    return rec


def parse_stat_block(section_html: str, is_gk: bool, kind: str) -> list[dict]:
    rows = re.findall(r"<tr>(.*?)</tr>", section_html, flags=re.I | re.S)
    out = []
    skip_head = {"시즌", "팀", "대회", "출장", "실점", "클린시트", "득점", "도움", ""}
    for row in rows:
        cells = cell_list(row)
        if len(cells) < 8:
            continue
        if cells[0] in skip_head or cells[0] == "합계":
            continue
        rec = None
        if kind == "summary":
            rec = pack_record(cells, is_gk, None, None)
        elif kind == "season":
            if not (cells[0].isdigit() and len(cells[0]) == 4):
                continue
            rec = pack_record(cells[2:], is_gk, cells[0], cells[1])
        else:
            rec = pack_record(cells[1:], is_gk, None, cells[0])
        if rec:
            out.append(rec)
    return out


def section_after(html: str, title: str) -> str:
    m = re.search(
        rf'<h3 class="tit-box style2">\s*{re.escape(title)}\s*</h3>(.*?)(?:<h3 class="tit-box style2">|$)',
        html,
        flags=re.I | re.S,
    )
    return m.group(1) if m else ""


def parse_detail(html: str, player_id: str) -> dict:
    info = section_after(html, "선수 정보")
    pairs = re.findall(r"<th>(.*?)</th>\s*<td>(.*?)</td>", info, flags=re.I | re.S)
    kv = {clean(k): clean(v) for k, v in pairs}
    pos = kv.get("포지션") or ""
    is_gk = pos.upper() == "GK"
    birth = kv.get("생년월일") or ""
    photo = ""
    pm = re.search(
        r'<div class="img-box">\s*<img src="(https://d2tfp74nsbbrkr[^"]+)"',
        html,
        flags=re.I | re.S,
    )
    if pm:
        photo = valid_kleague_photo(pm.group(1))

    summary_rows = parse_stat_block(section_after(html, "요약"), is_gk, "summary")
    summary = {}
    if summary_rows:
        row0 = summary_rows[0]
        summary = {
            "k1": row0.get("k1") or {},
            "k2": row0.get("k2") or {},
            "po": row0.get("po") or {},
            "cup": row0.get("cup") or {},
            "super_cup": row0.get("super_cup") or {},
            "total": row0.get("total") or {},
        }

    seasons = parse_stat_block(section_after(html, "시즌별"), is_gk, "season")
    teams = parse_stat_block(section_after(html, "팀별"), is_gk, "team")
    for t in teams:
        t.pop("season", None)
    if summary.get("total") and teams:
        tot = summary["total"]
        src = teams[0].get("total") or {}
        for key in tot:
            if tot.get(key) is None and src.get(key) is not None:
                tot[key] = src.get(key)

    home = ""
    hm = re.search(r"공식 홈페이지\s*:\s*<a href=\"([^\"]+)\"", html)
    if hm:
        home = hm.group(1)

    return {
        "id": player_id,
        "name": kv.get("이름") or "",
        "name_en": kv.get("영문명") or "",
        "team_name": kv.get("소속구단") or "",
        "position": pos,
        "back_no": to_int(kv.get("배번") or ""),
        "nation": kv.get("국적") or "",
        "height": to_int(kv.get("키") or ""),
        "weight": to_int(kv.get("몸무게") or ""),
        "birth": birth,
        "age": _age(birth),
        "kleague_photo": photo,
        "club_home": home,
        "is_gk": is_gk,
        "summary": summary,
        "seasons": seasons,
        "teams": teams,
    }


def valid_kleague_photo(url: str) -> str:
    u = (url or "").strip()
    if not u:
        return ""
    if "d2tfp74nsbbrkr.cloudfront.net" in u:
        path = urllib.parse.urlparse(u).path or ""
        if "/player_" not in path and not path.lower().endswith(
            (".png", ".jpg", ".jpeg", ".webp")
        ):
            return ""
    return u


def jbfc_roster() -> dict[str, dict]:
    global _jbfc_by_name
    if _jbfc_by_name is not None:
        return _jbfc_by_name
    by_name: dict[str, dict] = {}
    try:
        req = urllib.request.Request(
            JBFC_PLAYER_API,
            headers={
                "User-Agent": UA,
                "Accept": "application/json",
                "Referer": "https://hyundai-motorsfc.com/team/proteam/mf",
                "Origin": "https://hyundai-motorsfc.com",
            },
        )
        with urllib.request.urlopen(req, timeout=40) as resp:
            payload = json.loads(resp.read().decode("utf-8", "replace"))
        data = payload.get("data") or {}
        for _pos, rows in data.items():
            for row in rows or []:
                name = str(row.get("name") or "").strip()
                if name:
                    by_name[name] = row
        log(f"  jbfc roster {len(by_name)} players")
    except Exception as exc:
        log(f"  jbfc roster skip: {exc}")
        by_name = {}
    _jbfc_by_name = by_name
    return _jbfc_by_name


def club_photo_file_id(team_id: str, player_id: str, name: str) -> str:
    if team_id == "K05":
        row = jbfc_roster().get((name or "").strip())
        cid = str((row or {}).get("kl_player_id") or "").strip()
        if cid:
            return cid
    return player_id


def photo_bundle(team_id: str, player_id: str, kleague_photo: str, name: str = "") -> dict:
    meta = CLUB_META.get(team_id, {})
    club = ""
    tmpl = meta.get("photo")
    if tmpl:
        file_id = club_photo_file_id(team_id, player_id, name)
        club = tmpl.format(year=YEAR, id=file_id)
    portal = (
        f"{PORTAL}/common/playerPhotoById.do?playerId={player_id}"
        f"&recYn=Y&searchYear={YEAR}"
    )
    cf = valid_kleague_photo(kleague_photo)
    if not cf:
        cf = f"{CF}/{YEAR}/{team_id}/player_{player_id}.png"
    page = ""
    if meta.get("player"):
        page = meta["player"].format(id=player_id)
    return {
        "club": club,
        "kleague": cf,
        "portal": portal,
        "club_page": page,
    }


def portal_opener() -> urllib.request.OpenerDirector:
    global _portal_opener
    if _portal_opener is not None:
        return _portal_opener
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
    req = urllib.request.Request(
        PORTAL_GUEST,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
            "Referer": PORTAL + "/",
        },
    )
    try:
        with opener.open(req, timeout=40) as resp:
            resp.read()
    except (urllib.error.HTTPError, urllib.error.URLError) as exc:
        raise RuntimeError(f"portal guest login failed: {exc}") from exc
    _portal_opener = opener
    return opener


def portal_get(url: str, timeout: int = 60) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Referer": PORTAL + "/mainFrame.do",
            "Origin": PORTAL,
        },
    )
    try:
        with portal_opener().open(req, timeout=timeout) as resp:
            raw = resp.read()
            enc = resp.headers.get_content_charset() or "utf-8"
            return raw.decode(enc, "replace")
    except urllib.error.HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} for {url}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"network error for {url}: {exc}") from exc


_PORTAL_POS_RE = re.compile(
    r'<h1 class="club-playerPosition-title">\s*(GK|DF|MF|FW)\s*</h1>'
    r"|moveMainFrameMcPlayer\('0416','(\d+)','(K\d+)'\)",
)
_PORTAL_BOX_RE = re.compile(
    r"moveMainFrameMcPlayer\('0416','(\d+)','(K\d+)'\)[\s\S]{0,1200}?"
    r'club-playerlist-nm-k">\s*(\d+)\.\s*([^<]+)',
)


def parse_portal_player_list(html: str) -> dict[str, list[dict]]:
    """Parse Data Center > Players > Player list cards."""
    pos = ""
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for m in _PORTAL_POS_RE.finditer(html or ""):
        if m.group(1):
            pos = m.group(1)
            continue
        pid, team_id = m.group(2), m.group(3)
        key = (pid, team_id)
        if key in seen:
            continue
        seen.add(key)
        rows.append({"id": pid, "team_id": team_id, "position": pos or ""})
    names: dict[tuple[str, str], tuple[int, str]] = {}
    for m in _PORTAL_BOX_RE.finditer(html or ""):
        names[(m.group(1), m.group(2))] = (int(m.group(3)), clean(m.group(4)))
    by_team: dict[str, list[dict]] = {}
    for row in rows:
        hit = names.get((row["id"], row["team_id"]))
        card = {
            "id": row["id"],
            "name": hit[1] if hit else "",
            "team_id": row["team_id"],
            "position": row["position"],
            "back_no": hit[0] if hit else None,
            "kleague_photo": "",
        }
        by_team.setdefault(row["team_id"], []).append(card)
    for cards in by_team.values():
        cards.sort(
            key=lambda p: (
                POS_ORDER.get(p.get("position") or "", 9),
                p.get("back_no") is None,
                p.get("back_no") or 99,
                p.get("name") or "",
            )
        )
    return by_team


def portal_player_list() -> dict[str, list[dict]]:
    """K League Data Portal player list (current registered squads)."""
    global _portal_by_team
    if _portal_by_team is not None:
        return _portal_by_team
    try:
        html = portal_get(PORTAL_PLAYER_LIST)
        by_team = parse_portal_player_list(html)
        n = sum(len(v) for v in by_team.values())
        log(f"  portal player list {n} players / {len(by_team)} clubs")
        if n < 200:
            raise RuntimeError(f"portal player list too small: {n}")
        _portal_by_team = by_team
    except Exception as exc:
        log(f"  portal player list skip: {exc}")
        _portal_by_team = {}
    return _portal_by_team


def collect_team_players(league_id: str, team: dict) -> list[dict]:
    portal_rows = portal_player_list().get(str(team.get("id") or "").upper()) or []
    if portal_rows:
        log(f"  portal {team.get('id')} {len(portal_rows)}")
        return portal_rows
    found: dict[str, dict] = {}
    for pos in ("gk", "df", "mf", "fw"):
        page = 1
        last = 1
        while page <= last:
            url = (
                f"{BASE}/player.do?leagueId={league_id}&teamId={team['id']}"
                f"&type=active&pos={pos}&page={page}"
            )
            html = fetch(url)
            if page == 1:
                last = last_page(html)
            cards = parse_list_cards(html, team["id"], pos)
            for c in cards:
                prev = found.get(c["id"])
                if not prev:
                    found[c["id"]] = c
                elif not prev.get("kleague_photo") and c.get("kleague_photo"):
                    prev["kleague_photo"] = c["kleague_photo"]
            log(f"  {team['id']} {pos} p{page}/{last} +{len(cards)}")
            page += 1
            time.sleep(SLEEP)
    players = list(found.values())
    players.sort(
        key=lambda p: (
            POS_ORDER.get(p.get("position") or "", 9),
            p.get("back_no") is None,
            p.get("back_no") or 99,
            p.get("name") or "",
        )
    )
    return players


def load_json(path: Path) -> dict | None:
    if not path.is_file():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def write_json(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    tmp.replace(path)


def enrich_player(card: dict, team: dict) -> dict:
    path = PLAYER_DIR / f"{card['id']}.json"
    cached = None if FORCE else load_json(path)
    if cached and cached.get("seasons") is not None and cached.get("name"):
        # Refresh scout text even when records are cached.
        cached["scout"] = generate_scout(cached)
        photos = photo_bundle(
            team["id"],
            card["id"],
            card.get("kleague_photo") or cached.get("photos", {}).get("kleague") or "",
            card.get("name") or cached.get("name") or "",
        )
        cached["photos"] = photos
        write_json(path, cached)
        return cached

    url = f"{BASE}/record/playerDetail.do?playerId={card['id']}"
    html = fetch(url)
    detail = parse_detail(html, card["id"])
    photos = photo_bundle(
        team["id"],
        card["id"],
        card.get("kleague_photo") or detail.get("kleague_photo") or "",
        detail.get("name") or card.get("name") or "",
    )
    player = {
        "id": card["id"],
        "name": detail.get("name") or card.get("name"),
        "name_en": detail.get("name_en") or "",
        "team_id": team["id"],
        "team_name": detail.get("team_name") or team.get("name"),
        "team_full": team.get("full") or team.get("name"),
        "league_id": team.get("league_id") or "",
        "league_name": team.get("league_name") or "",
        "position": detail.get("position") or card.get("position") or "",
        "back_no": detail.get("back_no") if detail.get("back_no") is not None else card.get("back_no"),
        "nation": detail.get("nation") or "",
        "height": detail.get("height"),
        "weight": detail.get("weight"),
        "birth": detail.get("birth") or "",
        "age": detail.get("age"),
        "photos": photos,
        "club_home": detail.get("club_home") or team.get("home") or "",
        "kleague_url": url,
        "summary": detail.get("summary") or {},
        "seasons": detail.get("seasons") or [],
        "teams": detail.get("teams") or [],
        "source": "K LEAGUE official playerDetail",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }
    player["scout"] = generate_scout(player)
    write_json(path, player)
    return player


def keep_on_current_squad(club: dict, player: dict) -> bool:
    """Keep only players on the Data Portal player list for this club."""
    roster = portal_player_list()
    tid = str(club.get("id") or "").upper()
    rows = roster.get(tid) or []
    if not rows:
        return True
    pid = str(player.get("id") or "")
    return any(str(r.get("id")) == pid for r in rows)


def index_entry(player: dict) -> dict:
    photos = player.get("photos") or {}
    club = photos.get("club") or ""
    kleague = valid_kleague_photo(photos.get("kleague") or "")
    portal = photos.get("portal") or ""
    return {
        "id": player.get("id"),
        "name": player.get("name"),
        "back_no": player.get("back_no"),
        "position": player.get("position"),
        "photo": club or kleague or portal or "",
        "photo_fallback": portal or kleague or "",
    }


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    PLAYER_DIR.mkdir(parents=True, exist_ok=True)

    leagues = [
        {"id": "1", "name": "K리그1"},
        {"id": "2", "name": "K리그2"},
    ]
    out_leagues = []
    errors = []

    for lg in leagues:
        log(f"league {lg['name']}")
        list_html = fetch(f"{BASE}/player.do?leagueId={lg['id']}&type=active")
        clubs = parse_clubs(list_html)
        if ONLY_TEAM:
            clubs = [c for c in clubs if c["id"] == ONLY_TEAM]
        if not clubs:
            log(f"  no clubs for league {lg['id']}")
            continue
        team_blocks = []
        for club in clubs:
            club["league_id"] = lg["id"]
            club["league_name"] = lg["name"]
            log(f"team {club['id']} {club['name']}")
            try:
                cards = collect_team_players(lg["id"], club)
            except Exception as exc:
                errors.append(f"{club['id']} list: {exc}")
                log(f"  FAIL list {exc}")
                continue
            players_idx = []
            for card in cards:
                try:
                    full = enrich_player(card, club)
                    if not keep_on_current_squad(club, full):
                        log(f"  drop stale {full.get('id')} {full.get('name')}")
                        continue
                    players_idx.append(index_entry(full))
                    time.sleep(SLEEP)
                except Exception as exc:
                    errors.append(f"{card['id']}: {exc}")
                    log(f"  FAIL {card['id']} {card.get('name')} {exc}")
                    players_idx.append(
                        {
                            "id": card["id"],
                            "name": card.get("name"),
                            "back_no": card.get("back_no"),
                            "position": card.get("position"),
                            "photo": card.get("kleague_photo") or "",
                            "photo_fallback": f"{PORTAL}/common/playerPhotoById.do?playerId={card['id']}&recYn=Y&searchYear={YEAR}",
                        }
                    )
            team_blocks.append(
                {
                    "id": club["id"],
                    "name": club["name"],
                    "full": club["full"],
                    "home": club["home"],
                    "color": club["color"],
                    "emblem": f"{PORTAL}/images/portal/img-emble-{club['id'].lower()}-sm.png",
                    "players": players_idx,
                }
            )
        team_blocks.sort(
            key=lambda t: (
                0 if t.get("id") == "K05" or t.get("name") == "전북" else 1,
                t.get("name") or "",
            )
        )
        out_leagues.append({"id": lg["id"], "name": lg["name"], "teams": team_blocks})

    index = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "year": YEAR,
        "note": "보도/커뮤니티 재가공용. 현재 명단은 K리그 데이터포털 선수목록, 기록은 K리그 선수 상세.",
        "leagues": out_leagues,
        "errors": errors[:50],
    }
    write_json(DATA_DIR / "index.json", index)
    n = sum(len(t.get("players") or []) for lg in out_leagues for t in lg.get("teams") or [])
    log(f"done players={n} errors={len(errors)}")
    return 0 if n else 1


if __name__ == "__main__":
    raise SystemExit(main())
