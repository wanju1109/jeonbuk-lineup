"""경기 중 정리 글(전반 총정리, 후반 총정리)을 에버그린 칼럼/분석에 올린다. 집 PC 작업 스케줄러가 5분마다 실행한다.

전북 경기가 있는 날 정오 이후에만 저장소를 받아(newspaper/live/index.json) 아직 안 올린 글을 올린다.
그 밖의 시간에는 아무것도 하지 않고 바로 끝난다. 게시 기록은 매치 리포트와 같은 곳(reports_posted.json, 키 live:{경기}-{half|full}).

usage: python newspaper/scripts/post_live.py [--dry-run] [--force]
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import subprocess
import sys
import time
from pathlib import Path

if sys.stdout is None:  # 작업 스케줄러(pythonw)에는 콘솔이 없다
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

import requests  # noqa: E402

sys.path.insert(0, str(Path(__file__).parent))
from evergreen import CATEGORIES, Evergreen, EvergreenError  # noqa: E402
from post_local import load_credentials, log  # noqa: E402
from post_reports import STATE, record_in_repo  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
PAGES = "https://wanju1109.github.io/jeonbuk-lineup/newspaper/"
IFRAME_HEIGHT = 1500


def match_today(today: dt.date) -> bool:
    p = ROOT / "c_report" / "data" / "schedule.json"
    if not p.exists():
        return True  # 모르면 확인해 본다
    md = f"{today.month:02d}/{today.day:02d}"
    return any(m.get("date_md") == md and "전북" in (m.get("home"), m.get("away"))
               for m in json.loads(p.read_text(encoding="utf-8")).get("matches", []))


def body(p: dict, url: str) -> str:
    u = html.escape(url, quote=True)
    return (
        f"<p><b>{html.escape(p['headline'])}</b></p><p>{html.escape(p.get('summary') or '')}</p>"
        f'<p><a href="{u}" target="_blank">휴대폰에서는 여기를 눌러 새 창으로 크게 보세요</a></p>'
        '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">'
        f'<iframe src="{u}" title="{html.escape(p["title"])}" width="100%" height="{IFRAME_HEIGHT}" '
        f'style="width:100%;max-width:1100px;height:{IFRAME_HEIGHT}px;border:0;border-radius:12px;overflow:hidden;background:#e9efe6;display:block;" '
        'loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>'
    )


def online(key: str) -> bool:
    try:
        r = requests.get(f"{PAGES}live/{key}.json", params={"t": int(time.time())}, timeout=20)
        return r.ok and r.json().get("live") == key
    except (requests.RequestException, ValueError):
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true", help="경기 날·시간 확인을 건너뛴다(시험용)")
    args = ap.parse_args()
    now = dt.datetime.now()
    if not args.force and (now.hour < 12 or not match_today(now.date())):
        return
    subprocess.run(["git", "-C", str(ROOT), "pull", "-q", "--ff-only"], check=False, capture_output=True)
    ip = ROOT / "newspaper" / "live" / "index.json"
    if not ip.exists():
        return
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    today = now.date().isoformat()
    todo = [p for p in json.loads(ip.read_text(encoding="utf-8")).get("posts", [])
            if (p.get("date") == today or args.force) and (f"live:{p['key']}" not in state or args.dry_run)]
    if not todo:
        return
    todo = [p for p in todo if online(p["key"])]  # GitHub Pages에 아직 안 올라왔으면 다음 실행에서
    if not todo:
        log("경기 중 정리 글: Pages 반영 대기")
        return
    load_credentials()
    eg = Evergreen()
    try:
        eg.login()
        cat = int(os.environ.get("EVERGREEN_CATEGORY") or CATEGORIES["칼럼/분석"])
        board = eg.list_posts(cat) + eg.list_posts()
        for p in todo:
            dup = next((b for b in board if b.title.strip() == p["title"]), None)
            if dup:
                log(f"이미 게시판에 있음: {dup.title} {dup.url}")
                result = dup.url
            else:
                result = eg.post(p["title"], body(p, f"{PAGES}?live={p['key']}"), cat, dry_run=args.dry_run)
                log(f"{p['title']} · {result}")
            if not args.dry_run:
                state[f"live:{p['key']}"] = result
                STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
                record_in_repo(state)
    except EvergreenError as e:
        log(f"경기 중 정리 글 게시 실패: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
