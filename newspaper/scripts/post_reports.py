"""매치 리포트(경기 다음 날)와 프리뷰(경기 전날)를 에버그린 칼럼/분석에 iframe 글로 올린다.

집 PC 작업 스케줄러가 post_local.py(신문) 다음에 실행한다. 하루 여러 번 돌아도 같은 글은 한 번만 올린다.
- 매치 리포트: 어제 전북 경기의 c_report 데이터(스코어·라인업·이벤트)가 다 모였으면 올린다.
- 프리뷰: 내일 전북 경기의 p_report가 공개(published)됐으면 올린다.
계정은 post_local.py와 같은 곳(윈도우 자격 증명 관리자)에서 읽는다.

usage: python newspaper/scripts/post_reports.py [--dry-run] [--date YYYY-MM-DD]
"""

from __future__ import annotations

import argparse
import datetime as dt
import html
import json
import os
import subprocess
import sys
from pathlib import Path

if sys.stdout is None:  # 작업 스케줄러(pythonw)에는 콘솔이 없다
    sys.stdout = open(os.devnull, "w", encoding="utf-8")
if sys.stderr is None:
    sys.stderr = open(os.devnull, "w", encoding="utf-8")

sys.path.insert(0, str(Path(__file__).parent))
from evergreen import CATEGORIES, Evergreen, EvergreenError  # noqa: E402
from post_local import LOG, load_credentials, log  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SITE = "https://wanju1109.github.io/jeonbuk-lineup/"
STATE = LOG.with_name("reports_posted.json")
MATCH_XOR = 0x5A3C  # c_report·p_report 주소의 경기 번호 감추기(app.js와 같다)


def match_ref(game_id: str) -> str:
    n, digits, out = int(game_id) ^ MATCH_XOR, "0123456789abcdefghijklmnopqrstuvwxyz", ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out or "0"


def body(title: str, url: str, height: int, lines: list[str]) -> str:
    u, e = html.escape(url, quote=True), html.escape(url + "&f=y", quote=True)
    head = "".join(f"<p>{html.escape(x)}</p>" for x in lines)
    return (
        f"{head}<p><a href=\"{u}\" target=\"_blank\">휴대폰에서는 여기를 눌러 새 창으로 크게 보세요</a></p>"
        '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">'
        f'<iframe src="{e}" title="{html.escape(title)}" width="100%" height="{height}" '
        f'style="width:100%;max-width:1100px;height:{height}px;border:0;border-radius:12px;overflow:hidden;background:#f3f7f2;display:block;" '
        'loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>'
    )


def load(rel: str):
    return json.loads((ROOT / rel).read_text(encoding="utf-8"))


def match_report_job(today: dt.date) -> dict | None:
    """어제 전북 경기의 매치 리포트. 데이터가 덜 모였으면 None."""
    y = (today - dt.timedelta(days=1)).isoformat()
    m = next((m for m in load("c_report/data/index.json")["matches"] if m["date"] == y and m.get("score")), None)
    if not m:
        return None
    f = ROOT / "c_report" / "data" / f"{m['game_id']}.json"
    if not f.exists():
        log(f"매치 리포트: {y} 경기 데이터 파일이 아직 없음")
        return None
    g = json.loads(f.read_text(encoding="utf-8"))
    if not g.get("events") or not g.get("lineup", {}).get("home"):
        log(f"매치 리포트: {y} 경기 이벤트·라인업이 아직 덜 모임")
        return None
    h, a = m["score"].split(":")
    comp = g.get("meta", {}).get("competition") or "하나은행 K리그1"
    title = f"[JEONBUK MATCH AI REPORT] {comp} {m['round']}라운드 · {m['home']} vs {m['away']}"
    url = f"{SITE}c_report/?q={match_ref(m['game_id'])}"
    lines = [f"{comp} {m['round']}라운드 {m['home']} {h}-{a} {m['away']} · {m.get('venue', '')}",
             "골 장면, 슈팅 지도, 패스 연결, 선수별 기록을 한 화면에서 볼 수 있습니다."]
    return {"key": f"report:{m['game_id']}", "title": title, "html": body("전북 매치 리포트", url, 980, lines)}


def preview_job(today: dt.date) -> dict | None:
    """내일 전북 경기의 프리뷰. 아직 공개 전이면 None."""
    t = (today + dt.timedelta(days=1)).isoformat()
    idx = load("p_report/data/index.json")
    m = next((m for m in idx.get("matches", []) if m.get("jeonbuk_match") and str(m.get("kickoff", "")).startswith(t)), None)
    if not m:
        return None
    if not m.get("published") or not (ROOT / "p_report" / "data" / f"{m['game_id']}.json").exists():
        log(f"프리뷰: {t} 경기 프리뷰가 아직 공개 전")
        return None
    k = dt.datetime.fromisoformat(m["kickoff"])
    pm = load(f"p_report/data/{m['game_id']}.json").get("meta", {})
    comp = pm.get("competition") or "하나은행 K리그1"
    title = f"[JEONBUK MATCH AI PREVIEW] {comp} {m['round']}라운드 · {m['home']} vs {m['away']}"
    url = f"{SITE}p_report/?q={match_ref(m['game_id'])}"
    lines = [f"내일 {k.month}월 {k.day}일 {comp} {m['round']}라운드 {m['home']} vs {m['away']}",
             "예상 라인업, 최근 흐름, 상대 전적, 관전 포인트를 정리했습니다."]
    return {"key": f"preview:{m['game_id']}", "title": title, "html": body("전북 매치 프리뷰", url, 920, lines)}


def record_in_repo(key: str, url: str) -> None:
    """클라우드 점검 루틴이 볼 수 있게 저장소에도 게시 기록을 남긴다(newspaper/issues/reports_posted.json)."""
    path = ROOT / "newspaper" / "issues" / "reports_posted.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    data[key] = url
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    git = ["git", "-C", str(ROOT)]
    subprocess.run(git + ["add", str(path)], check=False)
    if subprocess.run(git + ["commit", "-q", "-m", f"chore(newspaper): {key} 에버그린 게시 기록"], check=False).returncode == 0:
        subprocess.run(git + ["pull", "-q", "--rebase"], check=False)
        subprocess.run(git + ["push", "-q"], check=False)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--date", help="기준 날짜(기본 오늘)")
    args = ap.parse_args()
    today = dt.date.fromisoformat(args.date) if args.date else dt.date.today()

    subprocess.run(["git", "-C", str(ROOT), "pull", "-q", "--ff-only"], check=False)
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    jobs = [j for j in (match_report_job(today), preview_job(today)) if j and (j["key"] not in state or args.dry_run)]
    if not jobs:
        return
    load_credentials()
    eg = Evergreen()
    try:
        eg.login()
        cat = int(os.environ.get("EVERGREEN_CATEGORY") or CATEGORIES["칼럼/분석"])
        board = eg.list_posts(cat) + eg.list_posts()
        for j in jobs:
            dup = next((p for p in board if p.title.strip() == j["title"]), None)
            if dup:  # 이미 누가(휴대폰 등) 올렸으면 기록만
                log(f"이미 게시판에 있음: {dup.title} {dup.url}")
                result = dup.url
            else:
                result = eg.post(j["title"], j["html"], cat, dry_run=args.dry_run)
                log(f"{j['title']} · {result}")
            if not args.dry_run:
                state[j["key"]] = result
                STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
                record_in_repo(j["key"], result)
    except EvergreenError as e:
        log(f"리포트·프리뷰 게시 실패: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
