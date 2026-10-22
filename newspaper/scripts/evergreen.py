"""에버그린(evergreenjb.me, Rhymix) 접속 도우미.

계정은 환경변수 EVERGREEN_ID / EVERGREEN_PW 에서만 읽는다(GitHub Secrets).
코드나 로그에 계정 값을 남기지 않는다.
"""

from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass

import requests

BASE = "https://evergreenjb.me"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

# 자유게시판(mid=free) 말머리. 2026-10 기준 목록 페이지에서 확인한 값.
CATEGORIES = {
    "자유": 147, "기사": 148, "해축": 210, "팁/정보": 2266992, "직관후기": 215,
    "QnA": 10897092, "루머": 212, "칼럼/분석": 211, "기록/통계": 213, "사진": 8360,
}


class EvergreenError(RuntimeError):
    pass


@dataclass
class Post:
    title: str
    url: str
    category: str
    when: str


def _text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


class Evergreen:
    def __init__(self) -> None:
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9"})
        self.logged_in = False

    # --- 공통 ---
    def _csrf(self, page_html: str) -> str:
        m = re.search(r'<meta name="csrf-token" content="([^"]+)"', page_html)
        return m.group(1) if m else ""

    def get(self, path: str, **params) -> str:
        r = self.s.get(BASE + path, params=params or None, timeout=30)
        r.raise_for_status()
        return r.text

    # --- 로그인 ---
    def login(self) -> bool:
        uid, pw = os.environ.get("EVERGREEN_ID"), os.environ.get("EVERGREEN_PW")
        if not uid or not pw:
            return False
        page = self.get("/free")
        token = self._csrf(page)
        r = self.s.post(
            BASE + "/",
            data={
                "act": "procMemberLogin", "mid": "free", "user_id": uid, "password": pw,
                "keep_signed": "Y", "success_return_url": "/free", "_rx_csrf_token": token,
            },
            headers={"Referer": BASE + "/free", "X-CSRF-Token": token},
            timeout=30,
            allow_redirects=True,
        )
        r.raise_for_status()
        self.logged_in = "procMemberLogout" in self.get("/free") or "dispMemberLogout" in r.text
        if not self.logged_in:
            raise EvergreenError("에버그린 로그인 실패: 아이디/비밀번호(Secrets)를 확인하세요")
        return True

    # --- 목록 읽기 ---
    def list_posts(self, category: int | None = None, page: int = 1) -> list[Post]:
        path = f"/free/category/{category}" if category else "/free"
        doc = self.get(path, page=page) if page > 1 else self.get(path)
        posts: list[Post] = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", doc, re.S):
            a = re.search(r'<a[^>]+href="(?:https://evergreenjb\.me)?(/free/\d+)[^"]*"[^>]*>(.*?)</a>', row, re.S)
            if not a:
                continue
            cat = re.search(r'/free/category/\d+"[^>]*>(.*?)</a>', row, re.S)
            when = re.search(r'class="[^"]*(?:time|date|regdate)[^"]*"[^>]*>(.*?)</', row, re.S)
            title = _text(a.group(2))
            if title:
                posts.append(Post(title, BASE + a.group(1), _text(cat.group(1)) if cat else "", _text(when.group(1)) if when else ""))
        return posts

    def read_post(self, url: str, limit: int = 1500) -> str:
        doc = self.s.get(url, timeout=30).text
        m = re.search(r'<div class="[^"]*(?:xe_content|rd_body|document_\d+)[^"]*"[^>]*>(.*?)</div>\s*</div>', doc, re.S)
        return _text(m.group(1) if m else "")[:limit]

    # --- 글쓰기 ---
    def write_form(self) -> dict:
        page = self.get("/index.php", mid="free", act="dispBoardWrite")
        if 'name="title"' not in page and "editor_sequence" not in page:
            raise EvergreenError("글쓰기 화면을 열 수 없습니다(로그인 또는 권한 확인 필요)")
        hidden = dict(re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', page))
        cats = {_text(n): v for v, n in re.findall(r'<option value="(\d+)"[^>]*>(.*?)</option>', page, re.S)}
        return {"csrf": self._csrf(page), "hidden": hidden, "categories": cats}

    def post(self, title: str, content_html: str, category: int, dry_run: bool = False) -> str:
        if not self.logged_in:
            raise EvergreenError("로그인하지 않았습니다")
        form = self.write_form()
        if form["categories"] and str(category) not in form["categories"].values():
            raise EvergreenError(f"말머리 {category}를 글쓰기 화면에서 찾지 못했습니다: {form['categories']}")
        data = {k: v for k, v in form["hidden"].items() if k not in ("act", "error_return_url", "success_return_url")}
        data.update({
            "module": "board", "act": "procBoardInsertDocument", "mid": "free",
            "title": title, "content": content_html, "category_srl": str(category),
            "comment_status": "ALLOW", "status": "PUBLIC", "_rx_csrf_token": form["csrf"],
        })
        if dry_run:
            return "dry-run: 로그인과 글쓰기 화면 확인 완료, 실제로 올리지 않음"
        r = self.s.post(
            BASE + "/",
            data=data,
            headers={
                "Referer": BASE + "/index.php?mid=free&act=dispBoardWrite",
                "X-CSRF-Token": form["csrf"], "X-Requested-With": "XMLHttpRequest",
                "Accept": "application/json, text/javascript, */*; q=0.01",
            },
            timeout=60,
        )
        r.raise_for_status()
        try:
            res = r.json()
        except ValueError as e:
            raise EvergreenError(f"글쓰기 응답을 해석하지 못했습니다: {r.text[:300]}") from e
        if str(res.get("error", "0")) != "0":
            raise EvergreenError(f"글쓰기 실패: {res.get('message')}")
        srl = res.get("document_srl")
        return f"{BASE}/free/{srl}" if srl else BASE + "/free"
