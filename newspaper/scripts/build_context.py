"""그날 신문의 '사실 재료'를 모은다.

저장소에 이미 쌓이는 공식 기록(proto/league.json, c_report 경기 데이터, 선수 명단)에서
순위·지난 경기 기록·다음 경기·사진 목록을 계산하고, 에버그린 게시판 제목을 읽어 온다.
AI는 이 파일의 숫자를 그대로 쓰고, 뉴스·루머는 웹 검색으로 보탠다.

usage: python newspaper/scripts/build_context.py [--date YYYY-MM-DD] [--out PATH]
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
KST = dt.timezone(dt.timedelta(hours=9))
FIRST_ISSUE = dt.date(2026, 10, 23)  # 제1호
WD = "월화수목금토일"

SHORT = {
    "FC 서울": "서울", "울산 HD": "울산", "전북 현대": "전북", "강원 FC": "강원", "대전 하나": "대전",
    "대전 하나 시티즌": "대전", "제주 SK": "제주", "인천 유나이티드": "인천", "FC 안양": "안양",
    "포항 스틸러스": "포항", "김천 상무": "김천", "부천 FC": "부천", "부천 FC 1995": "부천", "광주 FC": "광주",
}


def short(name: str) -> str:
    return SHORT.get(name) or name.replace("FC", "").split()[0].strip()


def load(rel: str):
    with open(ROOT / rel, encoding="utf-8") as f:
        return json.load(f)


def issue_no(day: dt.date) -> int:
    return (day - FIRST_ISSUE).days + 1


# ---------------- 순위 ----------------
def standings(league: dict) -> list[dict]:
    t = defaultdict(lambda: {"p": 0, "w": 0, "d": 0, "l": 0, "gf": 0, "ga": 0})
    for m in league["matches"]:
        if m["league"] != "K1" or not m.get("finished") or not m.get("score"):
            continue
        (h, a), (x, y) = (m["home"], m["away"]), m["score"]
        for team, gf, ga in ((h, x, y), (a, y, x)):
            r = t[team]
            r["p"] += 1
            r["gf"] += gf
            r["ga"] += ga
            r["w" if gf > ga else "d" if gf == ga else "l"] += 1
    rows = [{"team": k, "short": short(k), **v, "pts": v["w"] * 3 + v["d"]} for k, v in t.items()]
    rows.sort(key=lambda r: (-r["pts"], -r["gf"], -(r["gf"] - r["ga"]), -r["w"]))  # 승점, 다득점, 득실, 다승
    for i, r in enumerate(rows, 1):
        r["rank"] = i
        r["gd"] = r["gf"] - r["ga"]
    return rows


def jeonbuk_matches(league: dict) -> list[dict]:
    return [m for m in league["matches"] if m["league"] == "K1" and "전북" in (m["home"] + m["away"])]


# ---------------- 지난 경기 (c_report 부가기록) ----------------
def minute_label(period: int, minute: int) -> tuple[str, float]:
    minute += 1  # 부가기록 MIN_TIME은 0분부터 센다 (31:20 → 32분)
    if period == 1:
        return (f"45+{minute - 45}'" if minute > 45 else f"{minute}'"), min(minute, 45.5)
    return (f"90+{minute - 90}'" if minute > 90 else f"{minute}'"), min(minute, 94)


def last_match(today: dt.date) -> dict | None:
    idx = load("c_report/data/index.json")["matches"]
    done = [m for m in idx if m.get("score") and m["date"] < today.isoformat()]
    if not done:
        return None
    meta_i = done[-1]
    path = ROOT / "c_report" / "data" / f"{meta_i['game_id']}.json"
    out = {
        "game_id": meta_i["game_id"], "date": meta_i["date"], "round": meta_i.get("round"),
        "home": meta_i["home"], "away": meta_i["away"], "venue": meta_i.get("venue"),
        "attendance": meta_i.get("attendance"), "comp": f"K리그1 {meta_i.get('round')}R",
        "score": [int(x) for x in meta_i["score"].split(":")],
    }
    d = dt.date.fromisoformat(meta_i["date"])
    out["date_label"] = f"{d.month}월 {d.day}일({WD[d.weekday()]})"
    if not path.exists():
        return out
    g = load(f"c_report/data/{meta_i['game_id']}.json")
    meta = g["meta"]
    out["score"] = [meta["score"]["home"], meta["score"]["away"]]  # 공식 스코어 우선
    out["weather"] = meta.get("weather")
    out["referee"] = meta.get("referee")
    out["managers"] = {"home": meta["home"].get("manager"), "away": meta["away"].get("manager")}
    names, lineup = {}, {"home": [], "away": []}
    for side in ("home", "away"):
        for p in g["lineup"][side]:
            names[p["player_id"]] = p["name"]
            lineup[side].append({k: p.get(k) for k in ("player_id", "name", "back_no", "position", "starter", "minutes", "in_label", "out_label", "yellow", "red", "captain")})
    out["lineup"] = lineup

    ev = sorted(g["events"], key=lambda e: (e["PERIOD_ID"], e["MIN_TIME"], e["SEC_TIME"]))
    shots, goals = [], []
    for e in ev:
        if e["TYPE_CD"] != "ST" or e["TYPE_DETAIL_CD"] not in ("GL", "AST", "MST", "BT"):
            continue
        x, y = e["START_POINT_X"], e["START_POINT_Y"]
        # 공격 방향을 오른쪽으로 맞춘다 (홈은 후반, 원정은 전반에 왼쪽 공격)
        if (e["HA_CODE"] == "H") == (e["PERIOD_ID"] == 2):
            x, y = 100 - x, 100 - y
        shots.append([e["HA_CODE"], e["PERIOD_ID"], e["MIN_TIME"], e["TYPE_DETAIL_CD"], round(x, 1), round(y, 1), names.get(e["PLAYER_ID"], "")])
        if e["TYPE_DETAIL_CD"] == "GL":
            label, mnum = minute_label(e["PERIOD_ID"], e["MIN_TIME"])
            og = e.get("OWN_GOAL_CODE") == "Y"
            side = e["HA_CODE"] if not og else ("A" if e["HA_CODE"] == "H" else "H")
            pk = abs(x - 89.5) < 1.6 and abs(y - 50) < 2.5  # 페널티 마크 위 슈팅
            goals.append({"side": side, "player": names.get(e["PLAYER_ID"], ""), "label": label, "minute": mnum, "pk": pk, "og": og})
    out["shots"] = shots
    out["goals"] = goals

    def count(ha, cd, det=None):
        return sum(1 for e in ev if e["HA_CODE"] == ha and e["TYPE_CD"] == cd and (det is None or e["TYPE_DETAIL_CD"] in det))

    pas = {ha: (count(ha, "PS", ("PSS",)), count(ha, "PS", ("PSS", "PSU"))) for ha in "HA"}
    sh = {ha: [s for s in shots if s[0] == ha] for ha in "HA"}
    out["compare"] = [
        ["슈팅", len(sh["H"]), len(sh["A"])],
        ["유효슈팅", sum(s[3] in ("GL", "AST") for s in sh["H"]), sum(s[3] in ("GL", "AST") for s in sh["A"])],
        ["패스 성공", pas["H"][0], pas["A"][0]],
        ["패스 성공률", round(100 * pas["H"][0] / max(1, pas["H"][1]), 1), round(100 * pas["A"][0] / max(1, pas["A"][1]), 1), "%"],
        ["크로스 성공", count("H", "PS", ("OPCS",)), count("A", "PS", ("OPCS",))],
        ["반칙", count("H", "FO", ("FOC",)), count("A", "FO", ("FOC",))],
        ["경고", count("H", "FO", ("YLC",)), count("A", "FO", ("YLC",))],
    ]
    # 선수별 주요 기록 (AI가 '숨은 MVP' 같은 분석에 쓴다)
    per = defaultdict(lambda: defaultdict(int))
    for e in ev:
        n = names.get(e["PLAYER_ID"])
        if not n:
            continue
        p = per[(e["HA_CODE"], n)]
        det = e["TYPE_DETAIL_CD"]
        if e["TYPE_CD"] == "PS" and det in ("PSS", "PSU"):
            p["pass_att"] += 1
            p["pass_ok"] += det == "PSS"
        if det == "OPCS":
            p["cross_ok"] += 1
        if e["TYPE_CD"] == "ST":
            p["shots"] += 1
            p["goals"] += det == "GL"
            p["on_target"] += det in ("GL", "AST")
        if det in ("ADW", "GDW", "TKS", "INT", "CUT", "CLG"):
            p["def_actions"] += 1
    out["players"] = sorted(
        ({"side": k[0], "name": k[1], **v} for k, v in per.items()),
        key=lambda r: (-(r.get("goals", 0) * 10 + r.get("shots", 0) + r.get("def_actions", 0) / 3 + r.get("pass_att", 0) / 20)),
    )[:24]
    return out


# ---------------- 사진 자산 ----------------
def assets(teams: set[str], year: int) -> tuple[dict, list[dict]]:
    a, catalog = {}, []
    try:
        idx = load("player_report/data/index.json")
        for t in idx["leagues"][0]["teams"]:
            if t["name"] not in teams:
                continue
            for p in t["players"]:
                key = f"player:{p['id']}"
                a[key] = {"src": p["photo"], "alt": p["name"], "back_no": p.get("back_no"),
                          "credit": "사진 전북현대 공식 선수 프로필" if t["name"] == "전북" else "사진 K리그 선수 프로필"}
                catalog.append({"key": key, "name": p["name"], "team": t["name"], "no": p.get("back_no"), "pos": p.get("position")})
    except FileNotFoundError:
        pass
    try:
        for c in load("korea_coach/data/coaches.json")["coaches"]:
            if c.get("photo"):
                key = f"coach:{c['id']}"
                a[key] = {"src": "../korea_coach/" + c["photo"].lstrip("./"), "alt": f"{c['name']} 감독", "credit": "사진 Wikimedia Commons"}
                catalog.append({"key": key, "name": c["name"], "team": c["club"], "role": "감독"})
    except FileNotFoundError:
        pass
    return a, catalog


# ---------------- 에버그린 ----------------
def evergreen_board() -> dict:
    sys.path.insert(0, str(Path(__file__).parent))
    from evergreen import CATEGORIES, Evergreen  # noqa: E402

    eg, out = Evergreen(), {"logged_in": False, "free": [], "rumor": [], "rumor_bodies": [], "article": []}
    try:
        out["logged_in"] = eg.login()
    except Exception as e:  # 로그인 실패해도 공개 목록은 읽는다
        out["login_error"] = str(e)
    try:
        out["free"] = [p.__dict__ for p in eg.list_posts() + eg.list_posts(page=2)]
        out["article"] = [p.__dict__ for p in eg.list_posts(CATEGORIES["기사"])]
        if out["logged_in"]:
            rumors = eg.list_posts(CATEGORIES["루머"])
            out["rumor"] = [p.__dict__ for p in rumors]
            out["rumor_bodies"] = [{"title": p.title, "body": eg.read_post(p.url, 800)} for p in rumors[:6]]
    except Exception as e:
        out["error"] = str(e)
    return out


def community_boards(today: dt.date, names: list[str]) -> dict:
    sys.path.insert(0, str(Path(__file__).parent))
    import boards  # noqa: E402

    try:
        return boards.collect(today, names)
    except Exception as e:  # 커뮤니티가 막혀도 신문은 나온다
        return {"posts": [], "bodies": [], "errors": {"all": str(e)[:200]}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--date", help="발행일(KST). 기본은 오늘")
    ap.add_argument("--out", default=os.environ.get("RUNNER_TEMP", "/tmp") + "/jb_context.json")
    ap.add_argument("--no-board", action="store_true", help="에버그린 읽기 생략")
    args = ap.parse_args()

    today = dt.date.fromisoformat(args.date) if args.date else dt.datetime.now(KST).date()
    league = load("proto/data/league.json")
    table = standings(league)
    me = next(r for r in table if r["short"] == "전북")

    jb = jeonbuk_matches(league)
    played = [m for m in jb if m.get("finished") and m["date"] < today.isoformat()]
    upcoming = [m for m in jb if not m.get("finished") and m["date"] >= today.isoformat()]
    form = []
    for m in played[-8:]:
        home = "전북" in m["home"]
        gf, ga = (m["score"][0], m["score"][1]) if home else (m["score"][1], m["score"][0])
        opp = short(m["away"] if home else m["home"])
        form.append({"r": "W" if gf > ga else "D" if gf == ga else "L", "label": f"{opp} {gf}-{ga}"})

    nxt = None
    if upcoming:
        n = upcoming[0]
        nd = dt.date.fromisoformat(n["date"])
        home = "전북" in n["home"]
        opp = n["away"] if home else n["home"]
        row = {r["team"]: r for r in table}
        note = lambda t: f"{row[t]['rank']}위 · 승점 {row[t]['pts']}" if t in row else ""  # noqa: E731
        nxt = {
            "date": n["date"], "time": n.get("time") or "", "home": short(n["home"]), "away": short(n["away"]),
            "opp": opp, "opp_short": short(opp), "is_home": home, "round": n["round"], "venue": n.get("venue") or "",
            "comp": f"K리그1 {n['round']}R", "home_note": note(n["home"]), "away_note": note(n["away"]),
            "when_label": f"{nd.month}월 {nd.day}일({WD[nd.weekday()]}) {n.get('time') or ''}".strip(),
            "d_minus": (nd - today).days,
        }

    lm = last_match(today)
    rnd = max((m["round"] for m in played), default=0)
    split_round = 33
    yesterday = (today - dt.timedelta(days=1)).isoformat()
    teams = {"전북"} | ({nxt["opp_short"]} if nxt else set()) | ({lm["home"], lm["away"]} if lm else set())
    a, catalog = assets(teams, today.year)

    ctx = {
        "date": today.isoformat(),
        "weekday": WD[today.weekday()],
        "no": issue_no(today),
        "matchday_after": bool(lm and lm["date"] == yesterday),
        "matchday_today": bool(nxt and nxt["date"] == today.isoformat()),
        "data": {
            "standings": table,
            "games_left_to_split": max(0, split_round - rnd) if rnd < split_round else 0,
            "jeonbuk": {"rank": me["rank"], "pts": me["pts"], "w": me["w"], "d": me["d"], "l": me["l"], "gf": me["gf"], "ga": me["ga"]},
            "form": form,
            "form_note": "K리그1 기준.",
            "next": nxt,
            "last": lm,
            "upcoming_league": [{"date": m["date"], "home": short(m["home"]), "away": short(m["away"]), "round": m["round"]} for m in upcoming[:5]],
        },
        "assets": a,
        "photo_catalog": catalog,
        "evergreen": {} if args.no_board else evergreen_board(),
        "boards": {} if args.no_board else community_boards(today, [c["name"] for c in catalog if c["team"] == "전북"]),
    }
    Path(args.out).write_text(json.dumps(ctx, ensure_ascii=False, indent=1), encoding="utf-8")
    b = ctx["boards"]
    print(f"context: 제{ctx['no']}호 {ctx['date']} 경기다음날={ctx['matchday_after']} 경기당일={ctx['matchday_today']} "
          f"커뮤니티글={len(b.get('posts', []))} 로그인={b.get('logged_in', [])} 에버그린로그인={ctx['evergreen'].get('logged_in')} -> {args.out}")


if __name__ == "__main__":
    main()
