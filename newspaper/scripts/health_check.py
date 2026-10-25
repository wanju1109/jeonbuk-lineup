"""오늘 올라가야 할 글이 다 올라갔는지 점검한다. 빠진 게 있으면 한 줄씩 출력하고 종료 코드 1.

클라우드 점검 루틴이 09:30·19:30(KST)에 돌리고, 문제가 있으면 휴대폰으로 알린다.
집 PC가 게시 후 저장소에 남기는 기록(issues/posted.json, issues/reports_posted.json)을 본다.

usage: python newspaper/scripts/health_check.py [--evening]
  --evening: 저녁 점검. 프리뷰(내일 경기)까지 확인한다. 프리뷰는 공개가 늦으면 12시·18시에 올라가므로 아침엔 보지 않는다.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KST = dt.timezone(dt.timedelta(hours=9))
FIRST = dt.date(2026, 10, 23)


def load(rel: str, default=None):
    p = ROOT / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evening", action="store_true")
    ap.add_argument("--date")
    args = ap.parse_args()
    today = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(KST).date()
    no = (today - FIRST).days + 1
    problems = []

    posted = load("newspaper/issues/posted.json", {})
    reports = load("newspaper/issues/reports_posted.json", {})
    if not (ROOT / "newspaper" / "issues" / f"{no}.json").exists():
        problems.append(f"제{no}호 신문이 만들어지지 않았습니다(클라우드 루틴 실패 가능). claude.ai/code/routines 에서 '전주성 조간 매일 발행' 실행 기록을 확인하세요.")
    elif str(no) not in posted:
        problems.append(f"제{no}호가 에버그린에 올라가지 않았습니다(PC 꺼짐·로그인 안 함·게시 오류). PC를 켜거나 post.html?no={no} 로 직접 올려 주세요.")

    y = (today - dt.timedelta(days=1)).isoformat()
    m = next((m for m in load("c_report/data/index.json", {}).get("matches", []) if m["date"] == y and m.get("score")), None)
    if m and f"report:{m['game_id']}" not in reports:
        problems.append(f"어제({y}) {m['home']} vs {m['away']} 매치 리포트가 에버그린에 올라가지 않았습니다.")

    if args.evening:
        t = (today + dt.timedelta(days=1)).isoformat()
        p = next((p for p in load("p_report/data/index.json", {}).get("matches", [])
                  if p.get("jeonbuk_match") and str(p.get("kickoff", "")).startswith(t)), None)
        if p and p.get("published") and f"preview:{p['game_id']}" not in reports:
            problems.append(f"내일({t}) {p['home']} vs {p['away']} 프리뷰가 에버그린에 올라가지 않았습니다.")

    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("이상 없음")


if __name__ == "__main__":
    main()
