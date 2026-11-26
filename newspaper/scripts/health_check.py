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


# 신문을 만드는 클라우드 루틴이 기사·공식 기록을 확인하려면 열려야 하는 곳들
NET_HOSTS = ["www.kleague.com", "data.kleague.com", "hyundai-motorsfc.com", "www.kfa.or.kr", "www.jjan.kr", "sports.khan.co.kr"]


def blocked_hosts() -> list[str]:
    """이 실행 환경에서 접속이 막힌 곳. 사이트가 오류 페이지라도 응답을 주면 접속은 되는 것으로 본다."""
    import urllib.error
    import urllib.request

    def opens(h: str) -> bool:
        for _ in range(2):  # 잠깐 끊긴 것일 수 있어 한 번 더 해 본다
            try:
                req = urllib.request.Request(f"https://{h}/", headers={"User-Agent": "Mozilla/5.0"})
                urllib.request.urlopen(req, timeout=10).close()
                return True
            except urllib.error.HTTPError:
                return True
            except Exception:
                continue
        return False

    return [h for h in NET_HOSTS if not opens(h)]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--evening", action="store_true")
    ap.add_argument("--date")
    ap.add_argument("--no-net", action="store_true", help="사이트 접속 확인을 건너뛴다")
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

    # 경기 중 정리 글(전반·후반 총정리): 만든 지 30분이 지났는데 에버그린에 안 올라간 것
    now = dt.datetime.now(KST)
    for p in load("newspaper/live/index.json", {"posts": []}).get("posts", []):
        made = dt.datetime.fromisoformat(p["made_at"]) if p.get("made_at") else None
        if p.get("date") == today.isoformat() and made and now - made > dt.timedelta(minutes=30) and f"live:{p['key']}" not in reports:
            problems.append(f"'{p['title']}' 글이 만들어졌지만 에버그린에 올라가지 않았습니다(집 PC 꺼짐·게시 오류).")

    if args.evening:
        t = (today + dt.timedelta(days=1)).isoformat()
        p = next((p for p in load("p_report/data/index.json", {}).get("matches", [])
                  if p.get("jeonbuk_match") and str(p.get("kickoff", "")).startswith(t)), None)
        if p and p.get("published") and f"preview:{p['game_id']}" not in reports:
            problems.append(f"내일({t}) {p['home']} vs {p['away']} 프리뷰가 에버그린에 올라가지 않았습니다.")

    # 공식 기록 세 곳(K리그, K리그 데이터포털, 구단) 중 하나라도 안 열리거나, 전체의 절반 이상이 안 열리면 알린다.
    # 언론사 한두 곳이 잠깐 안 열리는 것은 넘긴다. '이상 없음'이면 공식 기록 세 곳은 모두 열린 것이다.
    bad = [] if args.no_net else blocked_hosts()
    if any(h in NET_HOSTS[:3] for h in bad) or len(bad) * 2 >= len(NET_HOSTS):
        problems.append(f"클라우드 실행 환경에서 접속되지 않는 곳이 있습니다({', '.join(bad)}). "
                        "이대로면 신문에 뉴스가 빠지고, 경기 다음 날에는 발행이 안 될 수 있습니다. "
                        "PC에서 claude.ai/code 새 세션 화면 → 입력창 아래 환경 선택 → Default의 설정(톱니) → Network access가 Full인지 확인해 주세요. "
                        "이미 Full이면 그 사이트가 잠깐 멈춘 것일 수 있으니 다음 점검까지 기다려 보세요.")

    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("이상 없음")


if __name__ == "__main__":
    main()
