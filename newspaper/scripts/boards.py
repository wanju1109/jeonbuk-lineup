"""커뮤니티 루머 게시판 읽기 (추꾸, 에펨코리아, 루리웹).

에버그린 루머 게시판은 회원 전용이라 evergreen.py에서 로그인 후 읽는다.
추꾸는 목록은 공개, 본문은 회원 전용이라 CHUGGU_ID / CHUGGU_PW가 있으면 로그인한다.
목록 제목과, 전북 관련 글의 본문 앞부분만 가져온다. 닉네임은 버린다.
"""

from __future__ import annotations

import datetime as dt
import html
import os
import re

import requests

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

BOARDS = {
    "추꾸 국내축구 루머": {
        "url": "https://www.chuggu.net/football_k/category/52158",
        "base": "https://www.chuggu.net",
        "row": r"<tr[^>]*>(.*?)</tr>",
        "link": r'<a[^>]*href="(/football_k/\d+)\?category=52158"[^>]*>(.*?)</a>',
        "cate": r'class="ctg_col"[^>]*>(.*?)</td>',
        "when": r'<time datetime="([^"]+)"',
        "body": r'<div class="[^"]*xe_content[^"]*"[^>]*>(.*?)</div>',
        "login": ("CHUGGU_ID", "CHUGGU_PW", "football_k"),
    },
    "에펨코리아 국내축구 루머": {
        "url": "https://www.fmkorea.com/index.php?mid=football_korean&category=108791244",
        "base": "https://www.fmkorea.com",
        "row": r"<tr[^>]*>(.*?)</tr>",
        "link": r'<a href="(/index\.php\?mid=football_korean&amp;category=108791244&amp;document_srl=\d+)" class="hx"[^>]*>(.*?)</a>',
        "cate": r'<td class="cate">(.*?)</td>',
        "when": r'<td class="time">(.*?)</td>',
        "body": r'<div class="[^"]*xe_content[^"]*"[^>]*>(.*?)</div>',
    },
    "루리웹 축구게시판 루머": {
        "url": "https://bbs.ruliweb.com/sports/board/300254?cate=361",
        "base": "",
        "row": r'<tr class="table_body[^"]*"[^>]*>(.*?)</tr>',
        "link": r'<a class="(?:subject_link|deco)[^"]*" href="(https://bbs\.ruliweb\.com/sports/board/300254/read/\d+)[^"]*"[^>]*>(.*?)</a>',
        "cate": r'<td class="divsn[^"]*"[^>]*>(.*?)</td>',
        "when": r'<td class="time"[^>]*>(.*?)</td>',
        "body": r'<div class="view_content[^"]*"[^>]*>(.*?)</div>\s*</div>',
    },
}

# 전북 관련 글을 고를 때 쓰는 기본 단어 (선수 이름은 호출하는 쪽에서 더한다)
JB_WORDS = ["전북", "전주", "녹색", "정정용", "벤투", "포옛", "현대가"]


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def _age_days(when: str, today: dt.date) -> int:
    """목록의 날짜 표기(ISO, 26.10.21, 2026.10.21, 09:20)를 오늘 기준 며칠 전인지로. 시각만 있으면 0."""
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", when) or re.match(r"(\d{4})\.(\d{2})\.(\d{2})", when)
    if not m:
        m2 = re.match(r"(\d{2})\.(\d{2})\.(\d{2})", when)
        if m2:
            return (today - dt.date(2000 + int(m2[1]), int(m2[2]), int(m2[3]))).days
        return 0 if re.match(r"\d{1,2}:\d{2}", when) else 99
    return (today - dt.date(int(m[1]), int(m[2]), int(m[3]))).days


def _get(s: requests.Session, url: str) -> str:
    r = s.get(url, timeout=25)
    r.raise_for_status()
    r.encoding = r.encoding if r.encoding and r.encoding.lower() != "iso-8859-1" else "utf-8"
    return r.text


def read_board(name: str, s: requests.Session | None = None) -> list[dict]:
    cfg = BOARDS[name]
    s = s or _session()
    doc = _get(s, cfg["url"])
    posts, seen = [], set()
    for row in re.findall(cfg["row"], doc, re.S):
        a = re.search(cfg["link"], row, re.S)
        if not a:
            continue
        cate = re.search(cfg["cate"], row, re.S)
        if cate and "공지" in _text(cate.group(1)):
            continue
        url = cfg["base"] + html.unescape(a.group(1))
        title = _text(a.group(2))
        if not title or url in seen:
            continue
        seen.add(url)
        when = re.search(cfg["when"], row, re.S)
        posts.append({"site": name, "title": title, "url": url, "when": _text(when.group(1)) if when else ""})
    return posts


def read_body(name: str, url: str, s: requests.Session | None = None, limit: int = 700) -> str:
    s = s or _session()
    m = re.search(BOARDS[name]["body"], _get(s, url), re.S)
    return _text(m.group(1))[:limit] if m else ""


def login(name: str, s: requests.Session) -> bool:
    """Rhymix 사이트 로그인. 계정 환경변수가 없으면 False."""
    cfg = BOARDS[name]
    if "login" not in cfg:
        return False
    env_id, env_pw, mid = cfg["login"]
    uid, pw = os.environ.get(env_id), os.environ.get(env_pw)
    if not uid or not pw:
        return False
    page = _get(s, cfg["url"])
    m = re.search(r'<meta name="csrf-token" content="([^"]+)"', page)
    token = m.group(1) if m else ""
    s.post(cfg["base"] + "/", data={"act": "procMemberLogin", "mid": mid, "user_id": uid, "password": pw, "keep_signed": "Y", "_rx_csrf_token": token},
           headers={"Referer": cfg["url"], "X-CSRF-Token": token}, timeout=25)
    return "procMemberLogout" in _get(s, cfg["url"]) or "dispMemberLogout" in _get(s, cfg["url"])


def _session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
    return s


def collect(today: dt.date, extra_words: list[str] | None = None, bodies_per_board: int = 4, max_age: int = 3) -> dict:
    """모든 루머 게시판의 최근(max_age일 이내) 글 제목과, 전북 관련 글 본문 일부."""
    words = JB_WORDS + (extra_words or [])
    s, out = _session(), {"posts": [], "bodies": [], "errors": {}, "logged_in": []}
    for name in BOARDS:
        try:
            if login(name, s):
                out["logged_in"].append(name)
        except requests.RequestException as e:
            out["errors"][name + " 로그인"] = str(e)[:120]
        try:
            posts = [p for p in read_board(name, s) if _age_days(p["when"], today) <= max_age][:30]
        except requests.RequestException as e:
            out["errors"][name] = str(e)[:120]
            continue
        out["posts"] += posts
        related = [p for p in posts if any(re.search(rf"(?<![가-힣]){re.escape(w)}", p["title"]) for w in words)][:bodies_per_board]
        for p in related:
            try:
                out["bodies"].append({**p, "body": read_body(name, p["url"], s)})
            except requests.RequestException:
                pass
    return out
