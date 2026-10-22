"""집 PC에서 오늘 호를 에버그린에 올린다 (윈도우 작업 스케줄러가 실행).

에버그린은 해외 데이터센터(GitHub Actions, 클라우드) 접속을 막아서 게시만 집 PC에서 한다.
- 07:00에 실행되고, PC가 꺼져 있었으면 켜진 뒤 바로 실행된다(작업 스케줄러 '놓친 작업 실행').
- 아직 오늘 호가 공개되지 않았으면 최대 3시간 기다린다.
- 한 번 올린 호는 다시 올리지 않는다(이 PC의 기록 + 저장소 posted.json).
- 계정은 윈도우 자격 증명 관리자(keyring)에서 읽는다. 처음 한 번:
    python -m keyring set jeonju-morning EVERGREEN_ID
    python -m keyring set jeonju-morning EVERGREEN_PW

usage: python newspaper/scripts/post_local.py [--dry-run] [--no N]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
STATE = Path(os.environ.get("LOCALAPPDATA", Path.home())) / "JeonjuMorning" / "posted.json"
LOG = STATE.with_name("post.log")
PAGES = "https://wanju1109.github.io/jeonbuk-lineup/newspaper/"
FIRST = dt.date(2026, 10, 23)


def log(msg: str) -> None:
    line = f"{dt.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    LOG.parent.mkdir(parents=True, exist_ok=True)
    with LOG.open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def load_credentials() -> None:
    if os.environ.get("EVERGREEN_ID") and os.environ.get("EVERGREEN_PW"):
        return
    import keyring

    for key in ("EVERGREEN_ID", "EVERGREEN_PW"):
        val = keyring.get_password("jeonju-morning", key)
        if not val:
            sys.exit(f"자격 증명 관리자에 {key}가 없습니다: python -m keyring set jeonju-morning {key}")
        os.environ[key] = val


def issue_online(no: int) -> bool:
    try:
        r = requests.get(f"{PAGES}issues/{no}.json", params={"t": int(time.time())}, timeout=20)
        return r.ok and r.json().get("no") == no
    except (requests.RequestException, ValueError):
        return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no", type=int)
    ap.add_argument("--wait-hours", type=float, default=3)
    args = ap.parse_args()

    no = args.no or (dt.date.today() - FIRST).days + 1
    if no < 1:
        log(f"제1호(2026-10-23) 전이라 할 일 없음")
        return
    state = json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}
    if str(no) in state and not args.dry_run:
        log(f"제{no}호는 이미 올렸음: {state[str(no)]}")
        return

    deadline = time.time() + args.wait_hours * 3600
    while not issue_online(no):
        if time.time() > deadline:
            log(f"제{no}호가 {args.wait_hours}시간 안에 올라오지 않아 그만둠")
            sys.exit(1)
        log(f"제{no}호 대기 중…")
        time.sleep(300)

    subprocess.run(["git", "-C", str(ROOT), "pull", "-q", "--ff-only"], check=False)
    load_credentials()
    cmd = [sys.executable, str(ROOT / "newspaper" / "scripts" / "post_evergreen.py"), "--no", str(no)]
    if args.dry_run:
        cmd.append("--dry-run")
    r = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
    log((r.stdout + r.stderr).strip())
    if r.returncode != 0:
        sys.exit(r.returncode)
    if not args.dry_run:
        posted = json.loads((ROOT / "newspaper" / "issues" / "posted.json").read_text(encoding="utf-8")) if (ROOT / "newspaper" / "issues" / "posted.json").exists() else {}
        state[str(no)] = posted.get(str(no), "posted")
        STATE.write_text(json.dumps(state, ensure_ascii=False, indent=1), encoding="utf-8")
        # 휴대폰 게시용 페이지(post.html)가 '이미 게시됨'을 보여주도록 저장소에도 기록
        git = ["git", "-C", str(ROOT)]
        subprocess.run(git + ["add", "newspaper/issues/posted.json"], check=False)
        if subprocess.run(git + ["commit", "-q", "-m", f"chore(newspaper): 제{no}호 에버그린 게시 기록"], check=False).returncode == 0:
            subprocess.run(git + ["pull", "-q", "--rebase"], check=False)
            subprocess.run(git + ["push", "-q"], check=False)


if __name__ == "__main__":
    main()
