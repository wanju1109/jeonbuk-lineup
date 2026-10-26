"""발행된 호를 에버그린 자유게시판에 iframe 글로 올린다.

환경변수: EVERGREEN_ID, EVERGREEN_PW (GitHub Secrets), EVERGREEN_CATEGORY(말머리 번호, 기본 211 칼럼/분석)
usage: python newspaper/scripts/post_evergreen.py --no N [--dry-run] [--wait-pages]
"""

from __future__ import annotations

import argparse
import html
import json
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).parent))
from evergreen import CATEGORIES, Evergreen, EvergreenError  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PAGES = "https://wanju1109.github.io/jeonbuk-lineup/newspaper/"


IFRAME_HEIGHT = 1500  # 고정 높이. 신문이 더 길면 칸 안에서 스크롤한다(사용자 선택)


def body_html(no, url: str, summary: str) -> str:
    u = html.escape(url, quote=True)
    return (
        f'<p><b>전주성 조간 제{no}호</b> · {html.escape(summary)}</p>'
        f'<p><a href="{u}" target="_blank">휴대폰에서는 여기를 눌러 새 창으로 크게 보세요</a></p>'
        '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">'
        f'<iframe src="{u}" title="전주성 조간 제{no}호" width="100%" height="{IFRAME_HEIGHT}" '
        f'style="width:100%;max-width:1100px;height:{IFRAME_HEIGHT}px;border:0;border-radius:12px;overflow:hidden;background:#e9efe6;display:block;" '
        'loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>'
    )


def wait_for_pages(no, timeout: int = 900) -> None:
    """GitHub Pages가 새 호 JSON을 내보낼 때까지 기다린다."""
    url = f"{PAGES}issues/{no}.json"
    start = time.time()
    while time.time() - start < timeout:
        try:
            r = requests.get(url, params={"t": int(time.time())}, timeout=20)
            if r.ok and str(r.json().get("no")) == str(no):
                print(f"Pages 반영 확인 ({int(time.time() - start)}초)")
                return
        except (requests.RequestException, ValueError):
            pass
        time.sleep(20)
    raise SystemExit(f"{timeout}초 동안 Pages에 제{no}호가 올라오지 않았습니다")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--no", required=True, help="호수. 특별호는 4-1처럼")
    ap.add_argument("--dry-run", action="store_true", help="로그인·글쓰기 화면만 확인하고 올리지 않는다")
    ap.add_argument("--wait-pages", action="store_true")
    ap.add_argument("--force", action="store_true", help="이미 올린 호도 다시 올린다")
    ap.add_argument("--update", metavar="URL", help="이미 올린 글(https://evergreenjb.me/free/번호)을 새 내용으로 고친다")
    args = ap.parse_args()

    posted_path = ROOT / "newspaper" / "issues" / "posted.json"
    posted = json.loads(posted_path.read_text(encoding="utf-8")) if posted_path.exists() else {}
    if str(args.no) in posted and not args.force and not args.dry_run and not args.update:
        print(f"제{args.no}호는 이미 올렸습니다: {posted[str(args.no)]}")
        return

    issue = json.loads((ROOT / "newspaper" / "issues" / f"{args.no}.json").read_text(encoding="utf-8"))
    cat = int(os.environ.get("EVERGREEN_CATEGORY") or CATEGORIES["칼럼/분석"])
    d = issue["date"]
    title = f"[전주성 조간 제{args.no}호] {issue['headline']}"
    url = f"{PAGES}?no={args.no}"

    if args.wait_pages and not args.dry_run:
        wait_for_pages(args.no)

    eg = Evergreen()
    try:
        if not eg.login():
            raise SystemExit("EVERGREEN_ID / EVERGREEN_PW Secrets가 없습니다")
        mark = f"[전주성 조간 제{args.no}호]"
        dup = next((p for p in eg.list_posts(cat) + eg.list_posts() if p.title.startswith(mark)), None)
        if dup and not args.force and not args.update:  # 휴대폰으로 먼저 직접 올린 경우
            print(f"이미 게시판에 있음: {dup.url}")
            if not args.dry_run:
                posted[str(args.no)] = dup.url
                posted_path.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")
            return
        srl = args.update.rstrip("/").rsplit("/", 1)[-1] if args.update else None
        result = eg.post(title, body_html(args.no, url, issue.get("summary", "")), cat, dry_run=args.dry_run, document_srl=srl)
    except EvergreenError as e:
        raise SystemExit(str(e))
    print(f"{d} 제{args.no}호 · 말머리 {cat} · {result}")
    if not args.dry_run:
        posted[str(args.no)] = result
        posted_path.write_text(json.dumps(posted, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
