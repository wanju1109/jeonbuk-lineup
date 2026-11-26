"""경기 중 정리 글(전반 총정리, 후반 총정리)에 쓸 공식 기록을 K리그 매치센터에서 가져온다.

클라우드 루틴 '전주성 조간 경기 정리'가 경기 날 매시 40분(KST 13:40~23:40)에 돌면서 쓴다. 지침은 newspaper/LIVE.md.

usage:
  python newspaper/scripts/live_match.py plan                  # 이번 실행이 맡을 일(전반/후반/없음)을 JSON으로 출력
  python newspaper/scripts/live_match.py wait --phase half     # 전반 종료(후반은 경기 종료)까지 최대 9분 기다림. 0=도달, 3=아직
  python newspaper/scripts/live_match.py snapshot --phase half --base /tmp/ctx.json --out /tmp/live_ctx.json
  python newspaper/scripts/live_match.py sleep 300             # 인터뷰 기사를 다시 찾기 전에 기다릴 때
  --game, --now 로 경기와 시각을 정해 시험할 수 있다(예: --game 211 --now 2026-11-21T14:40).
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
LIVE = ROOT / "newspaper" / "live"
KST = dt.timezone(dt.timedelta(hours=9))
API = "https://www.kleague.com/api/ddf/match/"
HALF_AFTER = 47   # 킥오프 뒤 전반 종료까지(분, 대략)
FULL_AFTER = 112  # 킥오프 뒤 경기 종료까지(분, 대략)
SLOT_MIN = 40     # 루틴이 도는 분(매시 40분)

S = requests.Session()
S.headers.update({"User-Agent": "Mozilla/5.0", "X-Requested-With": "XMLHttpRequest", "Referer": "https://www.kleague.com/match.do"})


def post(name: str, data: dict) -> dict:
    for i in range(3):
        try:
            r = S.post(API + name, data=data, timeout=20)
            r.raise_for_status()
            j = r.json()
            if str(j.get("resultCode")) == "200":
                return j.get("data") or {}
        except Exception:
            if i == 2:
                raise
        time.sleep(3)
    return {}


def load(rel: str, default=None):
    p = ROOT / rel
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def now_kst(arg: str | None) -> dt.datetime:
    return dt.datetime.fromisoformat(arg).replace(tzinfo=KST) if arg else dt.datetime.now(KST)


def find_game(day: dt.date, game: str | None) -> dict | None:
    """그날 전북의 K리그1 경기(c_report 일정표). 킥오프 시각과 팀 코드는 K리그 매치센터에서 읽는다."""
    sched = load("c_report/data/schedule.json", {}).get("matches", [])
    if game:
        m = next((x for x in sched if str(x["game_id"]) == str(game)), None)
    else:
        md = f"{day.month:02d}/{day.day:02d}"
        m = next((x for x in sched if x.get("date_md") == md and "전북" in (x["home"], x["away"])), None)
    if not m:
        return None
    year = str(m.get("year") or day.year)
    html = S.get(f"https://www.kleague.com/match.do?year={year}&leagueId=1&gameId={m['game_id']}&meetSeq=1", timeout=20).text
    t = re.search(r"(\d{4})/(\d{2})/(\d{2})\s*\([^)]+\)\s*(\d{1,2}):(\d{2})", html)
    if not t:
        return None
    y, mo, d, hh, mm = map(int, t.groups())
    kick = dt.datetime(y, mo, d, hh, mm, tzinfo=KST)
    rg = post("getRoundGameList.do", {"year": year, "leagueId": "1", "roundId": str(m["round"]), "meetSeq": "1"}).get("roundGameList", [])
    g = next((x for x in rg if str(x["gameId"]) == str(m["game_id"])), {})
    # 선발 명단(킥오프 약 1시간 전 공개). 페이지의 '출전 선수 명단'에 홈 11명, 원정 11명 순서로 나온다
    i = html.find("출전 선수 명단")
    seg = re.sub(r"<[^>]+>", " ", html[i:i + 120000]) if i >= 0 else ""
    xi = [f"{n}.{name}" for n, name in re.findall(r"(\d+)\.([가-힣A-Za-z]+)", seg)[:22]]
    return {
        "game_id": str(m["game_id"]), "year": year, "round": m["round"], "kickoff": kick.isoformat(),
        "home": g.get("homeTeamName") or m["home"], "away": g.get("awayTeamName") or m["away"],
        "home_code": g.get("homeTeam"), "away_code": g.get("awayTeam"), "venue": g.get("fieldNameFull"),
        "starters": {"home": xi[:11], "away": xi[11:22]} if len(xi) == 22 else None,
    }


def done(key: str) -> bool:
    return any(i["key"] == key for i in load("newspaper/live/index.json", {"posts": []})["posts"])


def cmd_plan(a) -> None:
    now = now_kst(a.now)
    slot = now.replace(minute=SLOT_MIN, second=0, microsecond=0)
    if now.minute < SLOT_MIN - 10:
        slot -= dt.timedelta(hours=1)
    m = find_game(now.date(), a.game)
    out = {"now": now.isoformat(timespec="minutes"), "phase": None, "game": m}
    if m:
        kick = dt.datetime.fromisoformat(m["kickoff"])
        for phase, after in (("half", HALF_AFTER), ("full", FULL_AFTER)):
            exp = kick + dt.timedelta(minutes=after)
            # 매시 40분 실행 하나가 [실행 5분 전, 55분 뒤) 사이에 끝날 것으로 보이는 단계만 맡는다. 겹치지 않게.
            if slot - dt.timedelta(minutes=5) <= exp < slot + dt.timedelta(minutes=55) and not done(f"{m['game_id']}-{phase}"):
                out.update(phase=phase, expected=exp.isoformat(timespec="minutes"), key=f"{m['game_id']}-{phase}")
                break
    print(json.dumps(out, ensure_ascii=False, indent=1))


def status(m: dict) -> str:
    return str(post("matchInfo.do", {"year": m["year"], "meetSeq": "1", "gameId": m["game_id"]}).get("gameStatus") or "")


def reached(phase: str, st: str) -> bool:
    if phase == "half":
        return st.startswith(("1E", "2S", "2E", "3", "4")) or st == "FE"
    return st == "FE"


def cmd_wait(a) -> None:
    m = find_game(now_kst(a.now).date(), a.game)
    if not m:
        sys.exit("오늘 전북 경기를 찾지 못했습니다")
    end = time.time() + a.max_sec
    while True:
        st = status(m)
        if reached(a.phase, st):
            print(f"도달: gameStatus={st}")
            return
        if time.time() > end:
            print(f"아직: gameStatus={st} (다시 실행)")
            sys.exit(3)
        time.sleep(60)


def events(info: dict, key: str) -> list[dict]:
    out = []
    for e in info.get(key) or []:
        if e.get("eventName") in ("파울",):
            continue
        half = int(e.get("halfType") or 1)
        mn = int(e.get("timeMin") or 0) + (45 if half == 2 else 0)
        out.append({"minute": mn, "half": half, "event": e.get("eventName"), "team": e.get("teamName") or "",
                    "player": e.get("playerName") or "", "player2": e.get("playerName2") or ""})
    return out


PLAYER_KEYS = {"minutePlay": "분", "shot": "슈팅", "shotOnTarget": "유효", "goal": "골", "assist": "도움", "pass": "패스",
               "passAcc": "패스성공", "exAttKeyPass": "키패스", "crosAcc": "크로스성공", "dribbleSuccess": "드리블성공",
               "tackleSuccess": "태클성공", "intercept": "가로채기", "chalgWon": "경합승리", "airChalgWon": "공중볼승리",
               "ballRecoverie": "볼회복", "foul": "파울", "goalkeeperSave": "선방", "playerPoint": "평점"}


def players(rows: list[dict]) -> list[dict]:
    out = []
    for p in rows or []:
        r = {"name": p.get("playerName"), "pos": p.get("playerPos"), "no": p.get("backNo")}
        r.update({v: p.get(k) for k, v in PLAYER_KEYS.items() if p.get(k) not in (None, 0, 0.0)})
        out.append(r)
    return out


def diff(after: dict, before: dict) -> dict:
    return {k: (after.get(k) - before.get(k, 0)) if isinstance(after.get(k), (int, float)) else after.get(k) for k in after}


def cmd_snapshot(a) -> None:
    now = now_kst(a.now)
    m = find_game(now.date(), a.game)
    if not m:
        sys.exit("오늘 전북 경기를 찾지 못했습니다")
    b = {"year": m["year"], "meetSeq": "1", "gameId": m["game_id"]}
    info = post("matchInfo.do", b)
    rec = post("matchRecord.do", b)
    pos = post("possession.do", b)
    det = post("getMatchRecordAllDetail.do", {"year": m["year"], "yearTst": m["year"], "meetSeq": "1", "gameId": m["game_id"], "gameIdTst": m["game_id"],
                                              "homeTeam": m["home_code"], "awayTeam": m["away_code"], "roundId": str(m["round"])})
    raw = {"taken_at": now.isoformat(timespec="minutes"), "game": m, "info": info, "record": rec, "possession": pos, "detail": det}
    LIVE.joinpath("raw").mkdir(parents=True, exist_ok=True)
    LIVE.joinpath("raw", f"{m['game_id']}-{a.phase}.json").write_text(json.dumps(raw, ensure_ascii=False, indent=1), encoding="utf-8")

    jb = "home" if m["home"] == "전북" else "away"
    goals = [{"side": "H", "player": g["name"], "label": f"{g['time']}'", "minute": g["time"], "pk": False, "og": bool(g.get("isOwnGoal"))} for g in info.get("homeScorer") or []]
    goals += [{"side": "A", "player": g["name"], "label": f"{g['time']}'", "minute": g["time"], "pk": False, "og": bool(g.get("isOwnGoal"))} for g in info.get("awayScorer") or []]
    h, aw = rec.get("home") or {}, rec.get("away") or {}
    compare = [[lab, h.get(k, 0), aw.get(k, 0)] for lab, k in
               (("슈팅", "attempts"), ("유효슈팅", "onTarget"), ("코너킥", "corners"), ("파울", "fouls"), ("경고", "yellowCards"), ("오프사이드", "offsides"))]
    compare.insert(2, ["점유율", float(h.get("possession") or 0), float(aw.get("possession") or 0), "%"])
    kick = dt.datetime.fromisoformat(m["kickoff"])
    last = {"game_id": m["game_id"], "date": kick.date().isoformat(), "round": m["round"], "home": m["home"], "away": m["away"],
            "venue": m["venue"], "comp": f"K리그1 {m['round']}R", "score": [info.get("homeGoal", 0), info.get("awayGoal", 0)],
            "date_label": f"{kick.month}월 {kick.day}일 {kick:%H:%M} 킥오프", "goals": sorted(goals, key=lambda g: g["minute"]),
            "compare": compare, "partial": True, "live": a.phase}
    live = {
        "phase": a.phase, "key": f"{m['game_id']}-{a.phase}", "game_status": info.get("gameStatus"), "jeonbuk_side": jb,
        "kickoff": m["kickoff"], "starters": m["starters"],
        "timeline": events(info, "firstHalf") + events(info, "secondHalf"),
        "record": rec, "possession_by_15min": pos,
        "players": {"home": players(det.get("listH")), "away": players(det.get("listA"))},
        "source": f"https://www.kleague.com/match.do?year={m['year']}&leagueId=1&gameId={m['game_id']}&meetSeq=1",
    }
    if a.phase == "full":
        hr = load(f"newspaper/live/raw/{m['game_id']}-half.json")
        if hr:  # 후반만의 기록 = 경기 전체 - 전반 종료 때 기록
            live["second_half_record"] = {"home": diff(h, hr["record"].get("home") or {}), "away": diff(aw, hr["record"].get("away") or {})}
            live["half_time_score"] = [hr["info"].get("homeGoal", 0), hr["info"].get("awayGoal", 0)]
    pv = load(f"p_report/data/{m['game_id']}.json")
    if pv:  # 경기 전에 예상한 것(조간 프리뷰). 킥오프 시각은 틀릴 수 있어 쓰지 않는다
        live["preview"] = {k: pv.get(k) for k in ("headline", "thesis", "scout", "lineups", "style")}
    ctx = json.loads(Path(a.base).read_text(encoding="utf-8"))
    ctx.update(no=f"L{m['game_id']}-{a.phase}", matchday_after=False, matchday_today=True, notables=[], live=live)
    ctx["data"]["last"] = last
    Path(a.out).write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"snapshot: {m['home']} {last['score'][0]}-{last['score'][1]} {m['away']} · gameStatus={info.get('gameStatus')} · 이벤트 {len(live['timeline'])}개 · "
          f"선수 {len(live['players']['home'])}+{len(live['players']['away'])}명 -> {a.out}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["plan", "wait", "snapshot", "sleep"])
    ap.add_argument("seconds", nargs="?", type=int, default=300)
    ap.add_argument("--phase", choices=["half", "full"])
    ap.add_argument("--game")
    ap.add_argument("--now")
    ap.add_argument("--max-sec", type=int, default=540)
    ap.add_argument("--base")
    ap.add_argument("--out")
    a = ap.parse_args()
    if a.cmd == "sleep":
        time.sleep(min(a.seconds, 540))
        return
    {"plan": cmd_plan, "wait": cmd_wait, "snapshot": cmd_snapshot}[a.cmd](a)


if __name__ == "__main__":
    main()
