#!/usr/bin/env python3
"""Build K League 1/2 club season dossiers for the team analysis page.

Sources (all local, no network):
  - proto/data/league.json          : every K1/K2 fixture and official score
  - player_report/data/index.json   : club identity (short/full name, colour, emblem)
  - player_report/data/players/*.json : squad and 2026 scoring contributions
  - c_report/data/club-attendance.json : K League 1 gate figures
  - team_report/data/team_profiles.json : hand-written manager/objective notes

Writes:
  - team_report/data/index.json          : league tables + club directory
  - team_report/data/teams/{team_id}.json : one dossier per club
"""

from __future__ import annotations

import json
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT_DIR = ROOT / "team_report" / "data"
TEAMS_DIR = OUT_DIR / "teams"
INDEX_OUT = OUT_DIR / "index.json"
PROFILES_PATH = OUT_DIR / "team_profiles.json"

LEAGUE_SRC = ROOT / "proto" / "data" / "league.json"
PLAYER_INDEX = ROOT / "player_report" / "data" / "index.json"
PLAYER_DIR = ROOT / "player_report" / "data" / "players"
ATTENDANCE_SRC = ROOT / "c_report" / "data" / "club-attendance.json"
EXCLUSIONS_SRC = ROOT / "p_report" / "data" / "lineup_exclusions.json"

KST = timezone(timedelta(hours=9))

# K League tie-break order: points, goals for, goal difference, wins.
SORT_KEY = ("points", "gf", "gd", "win")

LEAGUE_META = {
    "K1": {
        "id": "K1",
        "name": "K리그1",
        "league_id": "1",
        # Final split adds five more matches once the portal publishes them.
        "extra_games": 5,
        "acl_two": 3,
        "final_a": 6,
        # 2026 has no automatic relegation: the bottom club plays a promotion
        # /relegation playoff against the K League 2 playoff runner-up.
        "relegation_playoff": 12,
    },
    "K2": {
        "id": "K2",
        "name": "K리그2",
        "league_id": "2",
        "extra_games": 0,
        # K League 1 grows to 14 clubs in 2027, so the top two go up directly
        # and 3rd through 6th contest the promotion playoff.
        "promotion_auto": 2,
        "promotion_playoff": 6,
    },
}

# proto/league.json uses display names; map them onto player_report club ids.
NAME_TO_TEAM_ID = {
    "전북 현대": "K05",
    "강원 FC": "K21",
    "광주 FC": "K22",
    "김천 상무": "K35",
    "대전 하나": "K10",
    "부천 FC": "K26",
    "FC 서울": "K09",
    "FC 안양": "K27",
    "울산 HD": "K01",
    "인천 유나이티드": "K18",
    "제주 SK": "K04",
    "포항 스틸러스": "K03",
    "경남 FC": "K20",
    "김포 FC": "K36",
    "김해 FC": "K41",
    "대구 FC": "K17",
    "부산 아이파크": "K06",
    "서울 이랜드": "K31",
    "성남 FC": "K08",
    "수원 삼성": "K02",
    "수원 FC": "K29",
    "안산 그리너스": "K32",
    "용인 FC": "K42",
    "전남 드래곤즈": "K07",
    "천안 시티": "K38",
    "충남 아산": "K34",
    "충북 청주": "K37",
    "파주 프론티어": "K40",
    "파주 프런티어": "K40",
    "화성 FC": "K39",
}


def now_kst() -> datetime:
    return datetime.now(KST)


def load_json(path: Path) -> dict | list | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return None
    except (OSError, json.JSONDecodeError) as err:
        print(f"[WARN] cannot read {path.name}: {err}")
        return None


def save_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def squash(name: str) -> str:
    """Loose key so a renamed display string still resolves to a club."""
    return re.sub(r"[\s·]+", "", str(name or "")).lower()


def build_name_lookup(directory: dict[str, dict]) -> dict[str, str]:
    lookup: dict[str, str] = {}
    for raw, tid in NAME_TO_TEAM_ID.items():
        lookup[squash(raw)] = tid
    for tid, meta in directory.items():
        for key in (meta.get("name"), meta.get("full")):
            if key:
                lookup.setdefault(squash(key), tid)
    return lookup


def load_directory() -> dict[str, dict]:
    """team_id -> club identity from the player report index."""
    data = load_json(PLAYER_INDEX)
    out: dict[str, dict] = {}
    if not isinstance(data, dict):
        print("[WARN] player_report index missing; club metadata will be thin")
        return out
    for league in data.get("leagues") or []:
        if not isinstance(league, dict):
            continue
        league_key = "K1" if str(league.get("id")) == "1" else "K2"
        for team in league.get("teams") or []:
            if not isinstance(team, dict):
                continue
            tid = str(team.get("id") or "").strip()
            if not tid:
                continue
            players = team.get("players") or []
            out[tid] = {
                "team_id": tid,
                "name": str(team.get("name") or tid),
                "full": str(team.get("full") or team.get("name") or tid),
                "league": league_key,
                "league_name": str(league.get("name") or LEAGUE_META[league_key]["name"]),
                "color": str(team.get("color") or "#0f2a1c"),
                "emblem": str(team.get("emblem") or ""),
                "home": str(team.get("home") or ""),
                "squad_size": len(players),
            }
    return out


def finished_matches(data: dict) -> list[dict]:
    rows: list[dict] = []
    for m in data.get("matches") or []:
        if not isinstance(m, dict) or not m.get("finished"):
            continue
        score = m.get("score")
        if not isinstance(score, (list, tuple)) or len(score) < 2:
            continue
        try:
            home_goals, away_goals = int(score[0]), int(score[1])
        except (TypeError, ValueError):
            continue
        rows.append(
            {
                "league": str(m.get("league") or ""),
                "round": int(m.get("round") or 0),
                "date": str(m.get("date") or ""),
                "home": str(m.get("home") or ""),
                "away": str(m.get("away") or ""),
                "home_goals": home_goals,
                "away_goals": away_goals,
            }
        )
    rows.sort(key=lambda r: (r["date"], r["round"]))
    return rows


def blank_record() -> dict:
    return {"played": 0, "win": 0, "draw": 0, "loss": 0, "gf": 0, "ga": 0, "gd": 0, "points": 0}


def apply_result(rec: dict, gf: int, ga: int) -> None:
    rec["played"] += 1
    rec["gf"] += gf
    rec["ga"] += ga
    rec["gd"] = rec["gf"] - rec["ga"]
    if gf > ga:
        rec["win"] += 1
        rec["points"] += 3
    elif gf == ga:
        rec["draw"] += 1
        rec["points"] += 1
    else:
        rec["loss"] += 1


def rank_table(records: dict[str, dict]) -> list[str]:
    """Club ids ordered by K League tie-breaks."""
    return sorted(
        records.keys(),
        key=lambda tid: tuple(-int(records[tid].get(k, 0)) for k in SORT_KEY),
    )


def team_fixtures(rows: list[dict], lookup: dict[str, str], team_id: str) -> list[dict]:
    """Chronological fixtures for one club, from the club's own perspective."""
    out: list[dict] = []
    for r in rows:
        home_id = lookup.get(squash(r["home"]))
        away_id = lookup.get(squash(r["away"]))
        if team_id not in (home_id, away_id):
            continue
        is_home = team_id == home_id
        gf = r["home_goals"] if is_home else r["away_goals"]
        ga = r["away_goals"] if is_home else r["home_goals"]
        out.append(
            {
                "round": r["round"],
                "date": r["date"],
                "venue": "H" if is_home else "A",
                "opponent_id": away_id if is_home else home_id,
                "opponent": r["away"] if is_home else r["home"],
                "gf": gf,
                "ga": ga,
                "result": "W" if gf > ga else ("D" if gf == ga else "L"),
            }
        )
    return out


def streaks(results: list[str]) -> dict:
    """Current run plus the season's longest win/unbeaten/winless spells."""
    out = {
        "current_type": "",
        "current_len": 0,
        "longest_win": 0,
        "longest_unbeaten": 0,
        "longest_winless": 0,
        "longest_loss": 0,
    }
    if not results:
        return out
    cur_type, cur_len = results[-1], 0
    for res in reversed(results):
        if res != cur_type:
            break
        cur_len += 1
    out["current_type"] = cur_type
    out["current_len"] = cur_len

    run_win = run_unbeaten = run_winless = run_loss = 0
    for res in results:
        run_win = run_win + 1 if res == "W" else 0
        run_loss = run_loss + 1 if res == "L" else 0
        run_unbeaten = run_unbeaten + 1 if res in ("W", "D") else 0
        run_winless = run_winless + 1 if res in ("L", "D") else 0
        out["longest_win"] = max(out["longest_win"], run_win)
        out["longest_loss"] = max(out["longest_loss"], run_loss)
        out["longest_unbeaten"] = max(out["longest_unbeaten"], run_unbeaten)
        out["longest_winless"] = max(out["longest_winless"], run_winless)
    return out


def split_record(fixtures: list[dict], venue: str) -> dict:
    rec = blank_record()
    for f in fixtures:
        if f["venue"] != venue:
            continue
        apply_result(rec, f["gf"], f["ga"])
    return rec


def window_record(fixtures: list[dict], size: int) -> dict:
    rec = blank_record()
    for f in fixtures[-size:]:
        apply_result(rec, f["gf"], f["ga"])
    return rec


def rank_history(rows: list[dict], lookup: dict[str, str], league: str) -> dict[str, list[dict]]:
    """Rank and points after each completed round, per club."""
    league_rows = [r for r in rows if r["league"] == league]
    ids = set()
    for r in league_rows:
        for side in ("home", "away"):
            tid = lookup.get(squash(r[side]))
            if tid:
                ids.add(tid)
    records = {tid: blank_record() for tid in ids}
    history: dict[str, list[dict]] = {tid: [] for tid in ids}
    rounds = sorted({r["round"] for r in league_rows})
    for rnd in rounds:
        for r in league_rows:
            if r["round"] != rnd:
                continue
            home_id = lookup.get(squash(r["home"]))
            away_id = lookup.get(squash(r["away"]))
            if home_id in records:
                apply_result(records[home_id], r["home_goals"], r["away_goals"])
            if away_id in records:
                apply_result(records[away_id], r["away_goals"], r["home_goals"])
        order = rank_table(records)
        for pos, tid in enumerate(order, start=1):
            rec = records[tid]
            if rec["played"] <= 0:
                continue
            history[tid].append(
                {
                    "round": rnd,
                    "rank": pos,
                    "points": rec["points"],
                    "played": rec["played"],
                    "gd": rec["gd"],
                }
            )
    return history


def departed_player_ids() -> set[str]:
    """Players the preview pipeline already flagged as having left their club.

    Their goals still count toward the season total, but they must not be
    presented as part of the current squad.
    """
    data = load_json(EXCLUSIONS_SRC)
    out: set[str] = set()
    if not isinstance(data, dict):
        return out
    for row in data.get("players") or []:
        if not isinstance(row, dict):
            continue
        reason = str(row.get("reason") or "")
        if "이적" in reason or "임대" in reason or "방출" in reason:
            pid = str(row.get("player_id") or "").strip()
            if pid:
                out.add(pid)
    return out


def season_contributions(team_id: str, year: str, departed: set[str]) -> dict:
    """Goals/assists for the club's current squad in the given season."""
    scorers: list[dict] = []
    if not PLAYER_DIR.exists():
        return {"players": [], "squad_size": 0, "avg_age": None, "foreign": 0}
    ages: list[int] = []
    foreign = 0
    squad = 0
    for path in PLAYER_DIR.glob("*.json"):
        data = load_json(path)
        if not isinstance(data, dict):
            continue
        if str(data.get("team_id") or "") != team_id:
            continue
        squad += 1
        age = data.get("age")
        if isinstance(age, int) and 15 <= age <= 50:
            ages.append(age)
        if str(data.get("nation") or "한국") != "한국":
            foreign += 1
        goals = assists = apps = 0
        for row in data.get("seasons") or []:
            if not isinstance(row, dict) or str(row.get("season") or "") != year:
                continue
            for bucket in ("k1", "k2", "po", "cup"):
                stat = row.get(bucket)
                if not isinstance(stat, dict):
                    continue
                goals += int(stat.get("goals") or 0)
                assists += int(stat.get("assists") or 0)
                apps += int(stat.get("apps") or 0)
        if goals or assists or apps:
            pid = str(data.get("id") or "")
            scorers.append(
                {
                    "player_id": pid,
                    "departed": pid in departed,
                    "name": str(data.get("name") or ""),
                    "position": str(data.get("position") or ""),
                    "back_no": data.get("back_no"),
                    "age": age,
                    "apps": apps,
                    "goals": goals,
                    "assists": assists,
                    "points": goals + assists,
                }
            )
    scorers.sort(key=lambda p: (-p["goals"], -p["assists"], -p["apps"], p["name"]))
    return {
        "players": scorers,
        "squad_size": squad,
        "avg_age": round(sum(ages) / len(ages), 1) if ages else None,
        "foreign": foreign,
    }


def attendance_for(name: str) -> dict | None:
    data = load_json(ATTENDANCE_SRC)
    if not isinstance(data, dict):
        return None
    for club in data.get("clubs") or []:
        if not isinstance(club, dict):
            continue
        club_name = str(club.get("name") or "")
        if club_name and (club_name == name or name in club_name or club_name in name):
            return {
                "avg": club.get("avg"),
                "total": club.get("total"),
                "games": club.get("games"),
                "home_fans_avg": club.get("home_fans_avg"),
                "away_fans_avg": club.get("away_fans_avg"),
            }
    return None


def objective_for(
    league: str,
    rank: int,
    total: int,
    remaining: int,
    gap_to_leader: int,
    gap_to_cut: int,
    gap_below: int | None,
    gap_to_auto: int,
) -> dict:
    """Where the club realistically stands with the run-in left.

    Catching the leader is judged at one point per remaining match; chasing a
    cut line is judged at 1.5. Sweeping every fixture is arithmetic, not a
    forecast, so three points per game is never used.
    """
    meta = LEAGUE_META[league]
    catch_leader = remaining
    catch_cut = remaining * 1.5

    if league == "K1":
        if rank == 1:
            return {
                "band": "우승 경쟁",
                "detail": f"리그를 이끄는 자리에서 남은 {remaining}경기를 관리하면 트로피가 손에 들어옵니다.",
            }
        if rank <= meta["final_a"] and gap_to_leader <= catch_leader:
            return {
                "band": "우승 경쟁",
                "detail": f"선두와 {gap_to_leader}점 차. 남은 {remaining}경기로 뒤집을 수 있는 거리입니다.",
            }
        if rank <= meta["acl_two"]:
            return {
                "band": "ACL 진출권",
                "detail": "아시아 무대 티켓이 걸린 자리. 지키는 쪽이 된 순간 부담도 함께 옵니다.",
            }
        if rank <= meta["final_a"]:
            return {
                "band": "파이널A 경쟁",
                "detail": "상위 스플릿 진입권. 여기서 밀리면 시즌의 성격이 통째로 바뀝니다.",
            }
        if rank >= meta["relegation_playoff"]:
            return {
                "band": "승강 플레이오프권",
                "detail": (
                    "순위표의 맨 아래입니다. 다만 올해 강등은 김천 상무의 최종 순위에 달려 있습니다. "
                    "김천이 11위 안에 들면 이 자리의 팀이 K리그2 승격 PO 준우승팀과 승강 플레이오프를 치르고, "
                    "김천이 12위로 마치면 승강 플레이오프 자체가 열리지 않습니다."
                ),
            }
        if rank == meta["relegation_playoff"] - 1 and gap_below is not None and gap_below <= 6:
            return {
                "band": "잔류 경쟁",
                "detail": f"바로 아래와 {gap_below}점 차. 한 번만 미끄러져도 최하위 자리가 눈앞입니다.",
            }
        if gap_to_cut <= catch_cut:
            return {
                "band": "파이널A 추격",
                "detail": f"6위와 {gap_to_cut}점 차. 상위 스플릿이 아직 사정권입니다.",
            }
        return {
            "band": "중위권",
            "detail": "위도 아래도 멀어진 자리. 시즌의 방향을 스스로 정해야 합니다.",
        }

    # 2026 is the one season with two direct tickets, because K League 1 goes
    # to 14 clubs in 2027. Missing the top two is a real cost, not a nuance.
    if rank <= meta["promotion_auto"]:
        detail = (
            f"리그 선두에서 남은 {remaining}경기를 버티면 다이렉트 승격입니다."
            if rank == 1
            else "올해는 2위까지 곧바로 올라갑니다. 플레이오프를 건너뛸 수 있는 자리에 서 있습니다."
        )
        return {"band": "자동 승격권", "detail": detail}
    if rank <= meta["promotion_playoff"]:
        # Being mathematically within reach of second is not the same as
        # contending for it; only a genuinely tight gap earns the label.
        if gap_to_auto <= catch_leader * 0.6:
            return {
                "band": "자동 승격 도전",
                "detail": f"2위와 {gap_to_auto}점 차. 플레이오프를 건너뛰고 곧장 올라갈 수 있는 거리입니다.",
            }
        return {
            "band": "승격 플레이오프권",
            "detail": "3위부터 6위가 겨루는 플레이오프 진입권. 순위 한 칸이 대진을 통째로 바꿉니다.",
        }
    if gap_to_cut <= catch_cut:
        return {
            "band": "PO 추격권",
            "detail": f"플레이오프 컷인 6위와 {gap_to_cut}점 차. 남은 {remaining}경기면 아직 늦지 않았습니다.",
        }
    if rank >= total - 2:
        return {
            "band": "하위권",
            "detail": "순위표 바닥. 내년을 위한 재건이 먼저 보이는 자리입니다.",
        }
    return {
        "band": "중위권",
        "detail": "승격권과는 멀어졌고 강등 걱정도 없는, 시즌의 색이 옅어진 구간입니다.",
    }


def style_tags(
    table: dict,
    home: dict,
    away: dict,
    scoring: dict,
    league_avg: dict,
    gf_rank: int,
    ga_rank: int,
    total_teams: int,
) -> list[str]:
    """Short descriptors derived purely from this season's numbers."""
    tags: list[str] = []
    played = max(table["played"], 1)
    gf_pg = table["gf"] / played
    ga_pg = table["ga"] / played
    bottom = total_teams - 2

    if gf_rank <= 2:
        tags.append("리그 최상급 화력")
    elif gf_rank <= 4:
        tags.append("화력 우위")
    elif gf_rank >= bottom:
        tags.append("득점 빈곤")

    if ga_rank <= 2:
        tags.append("리그 최고 수비")
    elif ga_rank <= 4:
        tags.append("수비 안정")
    elif ga_rank >= bottom:
        tags.append("수비 불안")

    if gf_pg >= league_avg["gf"] * 1.1 and ga_pg >= league_avg["ga"] * 1.1:
        tags.append("공격 올인형")
    if gf_pg <= league_avg["gf"] and ga_pg <= league_avg["ga"] * 0.9:
        tags.append("실리 축구")

    home_ppg = home["points"] / home["played"] if home["played"] else 0
    away_ppg = away["points"] / away["played"] if away["played"] else 0
    if home["played"] >= 5 and away["played"] >= 5:
        if home_ppg - away_ppg >= 0.8:
            tags.append("홈 강세")
        elif away_ppg - home_ppg >= 0.5:
            tags.append("원정에 강한 팀")

    if scoring["clean_sheets"] / played >= 0.35:
        tags.append("클린시트 다수")
    if scoring["failed_to_score"] / played >= 0.35:
        tags.append("침묵하는 공격")
    if table["draw"] / played >= 0.33:
        tags.append("무승부 체질")
    if scoring["one_goal_games"] / played >= 0.45:
        tags.append("한 골 승부사")
    return tags


def build_team_payload(
    meta: dict,
    fixtures: list[dict],
    table_rows: list[str],
    records: dict[str, dict],
    directory: dict[str, dict],
    history: list[dict],
    league_avg: dict,
    metric_ranks: dict,
    total_rounds: int,
    scheduled_games: int,
    year: str,
    profile: dict,
    departed: set[str],
) -> dict:
    team_id = meta["team_id"]
    league = meta["league"]
    rec = records[team_id]
    rank = table_rows.index(team_id) + 1
    total_teams = len(table_rows)

    home = split_record(fixtures, "H")
    away = split_record(fixtures, "A")
    results = [f["result"] for f in fixtures]

    clean_sheets = sum(1 for f in fixtures if f["ga"] == 0)
    failed_to_score = sum(1 for f in fixtures if f["gf"] == 0)
    both_scored = sum(1 for f in fixtures if f["gf"] > 0 and f["ga"] > 0)
    one_goal_games = sum(1 for f in fixtures if abs(f["gf"] - f["ga"]) == 1)
    comeback_pool = sorted(fixtures, key=lambda f: (f["gf"] - f["ga"]))
    biggest_loss = comeback_pool[0] if comeback_pool else None
    biggest_win = comeback_pool[-1] if comeback_pool else None

    half = max(total_rounds // 2, 1)
    first_half = [f for f in fixtures if f["round"] <= half]
    second_half = [f for f in fixtures if f["round"] > half]

    def phase(rows: list[dict]) -> dict:
        acc = blank_record()
        for f in rows:
            apply_result(acc, f["gf"], f["ga"])
        acc["ppg"] = round(acc["points"] / acc["played"], 2) if acc["played"] else 0.0
        return acc

    above = table_rows[rank - 2] if rank >= 2 else ""
    below = table_rows[rank] if rank < total_teams else ""
    leader_points = records[table_rows[0]]["points"]
    remaining = max(scheduled_games - rec["played"], 0)

    cut_rank = LEAGUE_META[league]["final_a"] if league == "K1" else LEAGUE_META[league]["promotion_playoff"]
    cut_index = min(cut_rank, total_teams) - 1
    gap_to_cut = max(records[table_rows[cut_index]]["points"] - rec["points"], 0)

    # K League 2 hands out two direct tickets in 2026, so the second spot is a
    # line worth measuring on its own.
    auto_index = min(LEAGUE_META["K2"]["promotion_auto"], total_teams) - 1
    gap_to_auto = (
        max(records[table_rows[auto_index]]["points"] - rec["points"], 0)
        if league == "K2"
        else 0
    )

    scoring = {
        "gf_per_game": round(rec["gf"] / rec["played"], 2) if rec["played"] else 0.0,
        "ga_per_game": round(rec["ga"] / rec["played"], 2) if rec["played"] else 0.0,
        "clean_sheets": clean_sheets,
        "failed_to_score": failed_to_score,
        "both_scored": both_scored,
        "one_goal_games": one_goal_games,
        "biggest_win": biggest_win,
        "biggest_loss": biggest_loss,
    }

    squad = season_contributions(team_id, year, departed)
    top_scorer = squad["players"][0] if squad["players"] else None
    goal_share = (
        round(top_scorer["goals"] / rec["gf"], 3)
        if top_scorer and rec["gf"] > 0 and top_scorer["goals"] > 0
        else 0.0
    )

    gap_below = (rec["points"] - records[below]["points"]) if below else None
    context = objective_for(
        league,
        rank,
        total_teams,
        remaining,
        leader_points - rec["points"],
        gap_to_cut,
        gap_below,
        gap_to_auto,
    )
    # A club's situation can be settled off the pitch (relocation, licence,
    # points deduction). team_profiles.json may override the verdict.
    if profile.get("band_override"):
        context = {
            "band": str(profile["band_override"]),
            "detail": str(profile.get("band_detail") or context["detail"]),
        }

    tags = style_tags(
        rec,
        home,
        away,
        scoring,
        league_avg,
        metric_ranks["gf"].get(team_id, total_teams),
        metric_ranks["ga"].get(team_id, total_teams),
        total_teams,
    )

    ranks_seen = [h["rank"] for h in history]
    payload = {
        "team_id": team_id,
        "name": meta["name"],
        "full": meta["full"],
        "league": league,
        "league_name": meta["league_name"],
        "color": meta["color"],
        "emblem": meta["emblem"],
        "home_url": meta["home"],
        "season": year,
        "generated_at": now_kst().isoformat(timespec="seconds"),
        "table": {
            "rank": rank,
            "teams": total_teams,
            "played": rec["played"],
            "win": rec["win"],
            "draw": rec["draw"],
            "loss": rec["loss"],
            "gf": rec["gf"],
            "ga": rec["ga"],
            "gd": rec["gd"],
            "points": rec["points"],
            "ppg": round(rec["points"] / rec["played"], 2) if rec["played"] else 0.0,
            "remaining": remaining,
            "scheduled": scheduled_games,
            "gap_to_leader": leader_points - rec["points"],
            "gap_to_cut": gap_to_cut,
            "cut_rank": cut_rank,
            "gap_above": (records[above]["points"] - rec["points"]) if above else None,
            "gap_below": gap_below,
            "above": directory.get(above, {}).get("name", "") if above else "",
            "below": directory.get(below, {}).get("name", "") if below else "",
        },
        "splits": {
            "home": {**home, "ppg": round(home["points"] / home["played"], 2) if home["played"] else 0.0},
            "away": {**away, "ppg": round(away["points"] / away["played"], 2) if away["played"] else 0.0},
        },
        "form": {
            "results": results,
            "last5": results[-5:],
            "last10": results[-10:],
            "last5_record": window_record(fixtures, 5),
            "last10_record": window_record(fixtures, 10),
            "streaks": streaks(results),
        },
        "scoring": scoring,
        "trend": {
            "history": history,
            "best_rank": min(ranks_seen) if ranks_seen else rank,
            "worst_rank": max(ranks_seen) if ranks_seen else rank,
            "first_half": phase(first_half),
            "second_half": phase(second_half),
        },
        "fixtures": fixtures,
        "squad": {
            "size": squad["squad_size"] or meta.get("squad_size", 0),
            "avg_age": squad["avg_age"],
            "foreign": squad["foreign"],
            "top_scorers": squad["players"][:5],
            "top_assists": sorted(
                squad["players"], key=lambda p: (-p["assists"], -p["goals"], p["name"])
            )[:5],
            "goal_share": goal_share,
        },
        "attendance": attendance_for(meta["name"]),
        "context": {**context, "tags": tags},
        "profile": profile,
    }
    return payload


def league_averages(records: dict[str, dict]) -> dict:
    played = sum(r["played"] for r in records.values()) or 1
    return {
        "gf": sum(r["gf"] for r in records.values()) / played,
        "ga": sum(r["ga"] for r in records.values()) / played,
    }


def metric_rank_map(records: dict[str, dict]) -> dict[str, dict[str, int]]:
    """Per-game scoring and concession ranks, used for the style tags."""

    def order(key: str, descending: bool) -> dict[str, int]:
        ids = sorted(
            records.keys(),
            key=lambda tid: (records[tid][key] / max(records[tid]["played"], 1)),
            reverse=descending,
        )
        return {tid: pos for pos, tid in enumerate(ids, start=1)}

    return {"gf": order("gf", True), "ga": order("ga", False)}


def scheduled_per_team(data: dict, lookup: dict[str, str], league: str) -> dict[str, int]:
    """Fixtures on the calendar per club, finished or not."""
    counts: dict[str, int] = {}
    for m in data.get("matches") or []:
        if not isinstance(m, dict) or str(m.get("league") or "") != league:
            continue
        for side in ("home", "away"):
            tid = lookup.get(squash(str(m.get(side) or "")))
            if tid:
                counts[tid] = counts.get(tid, 0) + 1
    extra = LEAGUE_META[league]["extra_games"]
    return {tid: n + extra for tid, n in counts.items()}


def main() -> int:
    league_data = load_json(LEAGUE_SRC)
    if not isinstance(league_data, dict):
        print(f"[ERROR] cannot read {LEAGUE_SRC}")
        return 1

    directory = load_directory()
    if not directory:
        print("[ERROR] club directory is empty; run player_report collector first")
        return 1

    lookup = build_name_lookup(directory)
    rows = finished_matches(league_data)
    if not rows:
        print("[ERROR] no finished matches in league.json")
        return 1

    year = str(league_data.get("season") or now_kst().year)
    departed = departed_player_ids()
    profiles_raw = load_json(PROFILES_PATH)
    profiles = profiles_raw.get("teams") if isinstance(profiles_raw, dict) else {}
    if not isinstance(profiles, dict):
        profiles = {}

    unmatched = {
        r[side]
        for r in rows
        for side in ("home", "away")
        if not lookup.get(squash(r[side]))
    }
    for name in sorted(unmatched):
        print(f"[WARN] no club id for '{name}'")

    TEAMS_DIR.mkdir(parents=True, exist_ok=True)
    index_leagues = []
    written = 0

    for league_key, meta in LEAGUE_META.items():
        league_rows = [r for r in rows if r["league"] == league_key]
        if not league_rows:
            print(f"[WARN] {league_key}: no finished matches")
            continue
        ids = [tid for tid, m in directory.items() if m["league"] == league_key]
        records = {tid: blank_record() for tid in ids}
        for r in league_rows:
            home_id = lookup.get(squash(r["home"]))
            away_id = lookup.get(squash(r["away"]))
            if home_id in records:
                apply_result(records[home_id], r["home_goals"], r["away_goals"])
            if away_id in records:
                apply_result(records[away_id], r["away_goals"], r["home_goals"])
        records = {tid: rec for tid, rec in records.items() if rec["played"] > 0}
        if not records:
            continue

        order = rank_table(records)
        history_all = rank_history(rows, lookup, league_key)
        avg = league_averages(records)
        ranks = metric_rank_map(records)
        scheduled = scheduled_per_team(league_data, lookup, league_key)
        total_rounds = max(
            (int(m.get("round") or 0) for m in league_data.get("matches") or [] if m.get("league") == league_key),
            default=max(r["round"] for r in league_rows),
        )

        table_view = []
        for pos, tid in enumerate(order, start=1):
            rec = records[tid]
            club = directory[tid]
            fixtures = team_fixtures(rows, lookup, tid)
            payload = build_team_payload(
                club,
                fixtures,
                order,
                records,
                directory,
                history_all.get(tid, []),
                avg,
                ranks,
                total_rounds,
                scheduled.get(tid, rec["played"]),
                year,
                profiles.get(tid) if isinstance(profiles.get(tid), dict) else {},
                departed,
            )
            save_json(TEAMS_DIR / f"{tid}.json", payload)
            written += 1
            table_view.append(
                {
                    "rank": pos,
                    "team_id": tid,
                    "name": club["name"],
                    "full": club["full"],
                    "color": club["color"],
                    "emblem": club["emblem"],
                    "played": rec["played"],
                    "win": rec["win"],
                    "draw": rec["draw"],
                    "loss": rec["loss"],
                    "gf": rec["gf"],
                    "ga": rec["ga"],
                    "gd": rec["gd"],
                    "points": rec["points"],
                    "ppg": round(rec["points"] / rec["played"], 2) if rec["played"] else 0.0,
                    "last5": [f["result"] for f in fixtures][-5:],
                    "band": payload["context"]["band"],
                    "file": f"./data/teams/{tid}.json",
                }
            )
            print(
                f"[OK] {league_key} {pos:>2}. {club['name']:<5} "
                f"{rec['played']}경기 승점 {rec['points']} ({payload['context']['band']})"
            )

        index_leagues.append(
            {
                "id": league_key,
                "name": meta["name"],
                "teams": len(table_view),
                "total_rounds": total_rounds,
                "played_rounds": max(r["round"] for r in league_rows),
                "table": table_view,
            }
        )

    latest = max(r["date"] for r in rows)
    save_json(
        INDEX_OUT,
        {
            "updated_at": now_kst().isoformat(timespec="seconds"),
            "season": year,
            "as_of": latest,
            "source": "proto/data/league.json · player_report · c_report",
            "leagues": index_leagues,
        },
    )
    print(f"[DONE] dossiers={written} as_of={latest}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
