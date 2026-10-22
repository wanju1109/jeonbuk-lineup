"""로그인이 필요한 게시판 제목을 미리 읽어 newspaper/inbox/boards.json 에 둔다.

GitHub Actions(Secrets 보유)가 05:45 KST에 돌린다. 06:05에 도는 Claude 루틴은 계정이 없으므로
build_context.py가 이 파일을 읽어 합친다. 공개 저장소이므로 회원 전용 글은 **제목만** 저장한다.

환경변수: EVERGREEN_ID, EVERGREEN_PW
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from evergreen import CATEGORIES, Evergreen  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
KST = dt.timezone(dt.timedelta(hours=9))


def main() -> None:
    eg = Evergreen()
    out = {"date": dt.datetime.now(KST).date().isoformat(), "evergreen_logged_in": False, "evergreen_rumor": []}
    try:
        out["evergreen_logged_in"] = eg.login()
        if out["evergreen_logged_in"]:
            out["evergreen_rumor"] = [{"title": p.title, "url": p.url, "when": p.when} for p in eg.list_posts(CATEGORIES["루머"])]
    except Exception as e:
        out["error"] = str(e)[:200]
    path = ROOT / "newspaper" / "inbox" / "boards.json"
    path.parent.mkdir(exist_ok=True)
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"inbox: 에버그린 로그인={out['evergreen_logged_in']} 루머 제목 {len(out['evergreen_rumor'])}개")
    if not out["evergreen_logged_in"]:
        sys.exit(f"에버그린 로그인 실패: {out.get('error', 'Secrets 확인')}")


if __name__ == "__main__":
    main()
