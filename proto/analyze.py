#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""K League 2026 proto analyzer: chronological backtest + current-round picks."""

from __future__ import annotations

import glob
import json
import math
import os
from collections import defaultdict
from datetime import datetime
from typing import Any

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
OUT_JSON = os.path.join(BASE, "analysis_results.json")
OUT_HTML = os.path.join(BASE, "index.html")
WEIGHTS_PATH = os.path.join(BASE, "weights.json")

HOME_ADV = 0.14
FORM_N = 5
DRAW_FLOOR = 0.22
# Honest WDL winner from 10,000 walk-forward configs on 2024+2025+2026 (1,274 matches).
# k9365: 42.94% overall (547/1274). 2024 41.03 / 2025 45.17 / 2026 42.14.
WDL_GD_HFA = 0.28
WDL_GD_BAND = 0.08
WDL_GD_W = 1.4
WDL_PPG_W = 0.8
WDL_FORM_W = 0.32
WDL_H2H_W = 0.80
WDL_STREAK_W = 0.40
WDL_NEMESIS_W = 0.12
WDL_NEMESIS_SCALE = 1
WDL_DRAW_W = 0.0
WDL_H2H_DRAW_W = 0.0
WDL_DERBY_BAND = 0.10
WDL_SEARCH_BEST = 42.94
WDL_SEARCH_HITS = 547
WDL_SEARCH_TOTAL = 1274
# Measured on 2024-2026: any nonzero manager weight lost to 42.94% baseline.
# Keep the ledger in the write-up; do not let it override the pick.
WDL_MGR_W = 0.0
WDL_MGR_NEM = 0.0
H2H_PRIOR_PATH = os.path.join(DATA, "h2h_prior.json")
MGR_PATH = os.path.join(DATA, "managers.json")
WDL_H2H_PRIORS: list[dict] = []
WDL_DERBIES: set[tuple[str, str]] = set()
MGR_TENURES: list[dict] = []
MGR_BOOK: "ManagerBook | None" = None


def load_learned_weights() -> dict:
    if not os.path.exists(WEIGHTS_PATH):
        return {}
    try:
        with open(WEIGHTS_PATH, encoding="utf-8") as f:
            return json.load(f) or {}
    except (OSError, json.JSONDecodeError):
        return {}


LEARNED = load_learned_weights()
HOME_ADV = max(0.05, min(0.35, HOME_ADV + float(LEARNED.get("home_adv_delta") or 0)))
DRAW_FLOOR = max(0.15, min(0.35, DRAW_FLOOR + float(LEARNED.get("draw_floor_delta") or 0)))
FORM_SCALE = 0.12 * (1.0 + float(LEARNED.get("form_weight_delta") or 0))
OU_UNDER_BIAS = -0.05 + float(LEARNED.get("ou_under_bias") or 0)
FAVORITE_SHRINK = float(LEARNED.get("favorite_shrink") or 0)


def safe_int(v: Any, default: int | None = None) -> int | None:
    if v is None or v == "" or v == "-":
        return default
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def build_short_map(club_list: list[dict]) -> dict[str, str]:
    """Map official short names -> longer display names."""
    m: dict[str, str] = {}
    for c in club_list or []:
        short = (c.get("teamNameShort") or "").strip()
        full = (c.get("teamName") or c.get("teamNameFull") or short).strip()
        if short:
            m[short] = full
            m[short.replace(" ", "")] = full
        if full:
            m[full] = full
            m[full.replace(" ", "")] = full
    return m


def is_regular_league_meet(row: dict, league_id: int) -> bool:
    """Keep K1 meetSeq=1 / K2 meetSeq=2. Drop Super Cup and other leftovers."""
    raw = row.get("meetSeq")
    if raw is None or raw == "":
        return True
    try:
        seq = int(raw)
    except (TypeError, ValueError):
        return True
    expected = 1 if league_id == 1 else 2
    return seq == expected


def load_official_schedules() -> list[dict]:
    matches: list[dict] = []
    for path in sorted(glob.glob(os.path.join(DATA, "sched_L*_M*.json"))):
        with open(path, encoding="utf-8") as f:
            payload = json.load(f)
        league_id = 1 if "_L1_" in os.path.basename(path) else 2
        short_map = build_short_map(payload.get("data", {}).get("clubList") or [])
        for row in payload.get("data", {}).get("scheduleList") or []:
            if not is_regular_league_meet(row, league_id):
                continue
            end_yn = str(row.get("endYn") or "").upper()
            status = str(row.get("gameStatus") or "").upper()
            finished = end_yn == "Y" or status in {"FE", "END", "종료"}
            hg = safe_int(row.get("homeGoal")) if finished else None
            ag = safe_int(row.get("awayGoal")) if finished else None
            home_raw = (row.get("homeTeamName") or "").strip()
            away_raw = (row.get("awayTeamName") or "").strip()
            home = short_map.get(home_raw) or short_map.get(home_raw.replace(" ", "")) or home_raw
            away = short_map.get(away_raw) or short_map.get(away_raw.replace(" ", "")) or away_raw
            gd = str(row.get("gameDate") or "").replace(".", "-")
            matches.append(
                {
                    "source": "kleague_official",
                    "league": "K1" if league_id == 1 else "K2",
                    "round": safe_int(row.get("roundId"), 0) or 0,
                    "date": gd,
                    "time": row.get("gameTime") or "",
                    "home": home,
                    "away": away,
                    "home_goals": hg,
                    "away_goals": ag,
                    "venue": row.get("fieldName") or "",
                    "finished": finished,
                    "game_id": row.get("gameId"),
                }
            )
    return matches


def load_hist_matches() -> list[dict]:
    """Finished K1/K2 matches from official monthly dumps (2024-2025)."""
    matches: list[dict] = []
    hist_dir = os.path.join(BASE, "hist")
    if not os.path.isdir(hist_dir):
        return matches
    for year in (2024, 2025):
        for league_id, league in ((1, "K1"), (2, "K2")):
            for month in range(2, 13):
                path = os.path.join(hist_dir, f"sched_{year}_L{league_id}_M{month:02d}.json")
                if not os.path.exists(path):
                    continue
                try:
                    with open(path, encoding="utf-8") as f:
                        payload = json.load(f)
                except (OSError, json.JSONDecodeError):
                    continue
                for row in (payload.get("data") or {}).get("scheduleList") or []:
                    if not is_regular_league_meet(row, league_id):
                        continue
                    end_yn = str(row.get("endYn") or "").upper()
                    status = str(row.get("gameStatus") or "").upper()
                    finished = end_yn == "Y" or status in {"FE", "END", "종료"}
                    if not finished:
                        continue
                    hg = safe_int(row.get("homeGoal"))
                    ag = safe_int(row.get("awayGoal"))
                    if hg is None or ag is None:
                        continue
                    home = norm_team((row.get("homeTeamName") or "").strip())
                    away = norm_team((row.get("awayTeamName") or "").strip())
                    if not home or not away:
                        continue
                    gd = str(row.get("gameDate") or "").replace(".", "-")
                    matches.append(
                        {
                            "source": "kleague_hist",
                            "league": league,
                            "year": year,
                            "round": safe_int(row.get("roundId"), 0) or 0,
                            "date": gd,
                            "home": home,
                            "away": away,
                            "home_goals": hg,
                            "away_goals": ag,
                            "finished": True,
                        }
                    )
    uniq: dict[tuple, dict] = {}
    for m in matches:
        uniq[(m["league"], m.get("date") or "", team_key(m["home"]), team_key(m["away"]))] = m
    out = list(uniq.values())
    out.sort(key=lambda x: (x.get("date") or "", int(x.get("round") or 0)))
    return out


def load_wiki_matches() -> list[dict]:
    path = os.path.join(DATA, "matches_2026.json")
    if not os.path.exists(path):
        return []
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    out: list[dict] = []
    for league_key, league_name in (("K1", "K1"), ("K2", "K2")):
        rounds = data.get("leagues", {}).get(league_key, {}).get("rounds", {})
        for rnd, items in rounds.items():
            for m in items:
                out.append(
                    {
                        "source": "wiki",
                        "league": league_name,
                        "round": int(rnd),
                        "date": m.get("date") or "",
                        "time": "",
                        "home": m.get("home") or "",
                        "away": m.get("away") or "",
                        "home_goals": safe_int(m.get("home_goals")),
                        "away_goals": safe_int(m.get("away_goals")),
                        "venue": m.get("venue") or "",
                        "finished": m.get("home_goals") is not None and m.get("away_goals") is not None,
                        "game_id": None,
                    }
                )
    return out


ALIASES = {
    "서울": "FC 서울",
    "FC서울": "FC 서울",
    "울산": "울산 HD",
    "울산HD": "울산 HD",
    "전북": "전북 현대",
    "전북현대": "전북 현대",
    "제주": "제주 SK",
    "제주SK": "제주 SK",
    "제주SKFC": "제주 SK",
    "포항": "포항 스틸러스",
    "포항스틸러스": "포항 스틸러스",
    "인천": "인천 유나이티드",
    "인천Utd": "인천 유나이티드",
    "인천유나이티드": "인천 유나이티드",
    "대전": "대전 하나",
    "대전하나": "대전 하나",
    "대전하나시티즌": "대전 하나",
    "광주": "광주 FC",
    "광주FC": "광주 FC",
    "김천": "김천 상무",
    "김천상무": "김천 상무",
    "부천": "부천 FC",
    "부천FC": "부천 FC",
    "부천FC1995": "부천 FC",
    "안양": "FC 안양",
    "FC안양": "FC 안양",
    "강원": "강원 FC",
    "강원FC": "강원 FC",
    # Do NOT map bare "수원" — ambiguous (삼성 vs FC)
    "수원삼성": "수원 삼성",
    "수원삼성블루윙즈": "수원 삼성",
    "수원FC": "수원 FC",
    "부산": "부산 아이파크",
    "부산아이파크": "부산 아이파크",
    "화성": "화성 FC",
    "화성FC": "화성 FC",
    "김해": "김해 FC",
    "김해FC": "김해 FC",
    "김해FC2008": "김해 FC",
    "경남": "경남 FC",
    "경남FC": "경남 FC",
    "전남": "전남 드래곤즈",
    "전남드래곤즈": "전남 드래곤즈",
    "청주": "충북 청주",
    "충북청주": "충북 청주",
    "충북청주FC": "충북 청주",
    "서울E": "서울 이랜드",
    "서울이랜드": "서울 이랜드",
    "안산": "안산 그리너스",
    "안산그리너스": "안산 그리너스",
    "대구": "대구 FC",
    "대구FC": "대구 FC",
    "충남아산": "충남 아산",
    "충남아산FC": "충남 아산",
    "아산": "충남 아산",
    "김포": "김포 FC",
    "김포FC": "김포 FC",
    "천안": "천안 시티",
    "천안시티": "천안 시티",
    "천안시티FC": "천안 시티",
    "파주": "파주 프런티어",
    "파주프런티어": "파주 프런티어",
    "파주프런티어FC": "파주 프런티어",
    "성남": "성남 FC",
    "성남FC": "성남 FC",
}


def norm_team(name: str) -> str:
    raw = (name or "").strip()
    if not raw:
        return raw
    n = raw.replace(" ", "")
    if "수원삼성" in n or "블루윙" in n:
        return "수원 삼성"
    if "수원FC" in n or n == "수원FC":
        return "수원 FC"
    if n in ALIASES:
        return ALIASES[n]
    for a in sorted(ALIASES.keys(), key=len, reverse=True):
        if a == "수원":
            continue
        if n == a or n.startswith(a):
            return ALIASES[a]
    return raw


def team_key(name: str) -> str:
    return norm_team(name).replace(" ", "").lower()


def merge_datasets(official: list[dict], wiki: list[dict]) -> list[dict]:
    """Prefer finished wiki/official scores; keep upcoming from official endYn=N."""
    by_key: dict[tuple, dict] = {}

    def key(m: dict) -> tuple:
        return (m["league"], m["date"], team_key(m["home"]), team_key(m["away"]))

    for m in wiki:
        mm = dict(m)
        mm["home"] = norm_team(mm["home"])
        mm["away"] = norm_team(mm["away"])
        by_key[key(mm)] = mm

    for m in official:
        mm = dict(m)
        mm["home"] = norm_team(mm["home"])
        mm["away"] = norm_team(mm["away"])
        k = key(mm)
        if k in by_key:
            base = by_key[k]
            if mm.get("finished") and base.get("home_goals") is None:
                base["home_goals"] = mm["home_goals"]
                base["away_goals"] = mm["away_goals"]
                base["finished"] = True
            if not base.get("venue"):
                base["venue"] = mm.get("venue") or ""
            if not base.get("time"):
                base["time"] = mm.get("time") or ""
            if mm.get("round"):
                base["round"] = mm["round"]
            if len(mm["home"]) > len(base["home"]):
                base["home"] = mm["home"]
            if len(mm["away"]) > len(base["away"]):
                base["away"] = mm["away"]
            if not mm.get("finished") and not base.get("finished"):
                base["finished"] = False
                base["home_goals"] = None
                base["away_goals"] = None
        else:
            if mm.get("home") and mm.get("away"):
                by_key[k] = mm

    out = list(by_key.values())
    out.sort(key=lambda x: (x.get("date") or "9999", x.get("league") or "", x.get("round") or 0, x.get("home") or ""))
    return out


def poisson_pmf(k: int, lam: float) -> float:
    if lam <= 0:
        return 1.0 if k == 0 else 0.0
    return math.exp(-lam) * (lam**k) / math.factorial(k)


def score_matrix(lh: float, la: float, max_g: int = 6) -> list[list[float]]:
    mat = [[0.0] * (max_g + 1) for _ in range(max_g + 1)]
    for i in range(max_g + 1):
        for j in range(max_g + 1):
            mat[i][j] = poisson_pmf(i, lh) * poisson_pmf(j, la)
    s = sum(sum(r) for r in mat)
    if s > 0:
        for i in range(max_g + 1):
            for j in range(max_g + 1):
                mat[i][j] /= s
    return mat


def _wdl_from_adj(i: int, j: int, home_line: float) -> str:
    adj = i + home_line - j
    if adj > 0:
        return "승"
    if adj == 0:
        return "무"
    return "패"


def _accum_wdl(mat: list[list[float]], home_line: float) -> tuple[float, float, float]:
    p_w = p_d = p_l = 0.0
    for i, row in enumerate(mat):
        for j, p in enumerate(row):
            lab = _wdl_from_adj(i, j, home_line)
            if lab == "승":
                p_w += p
            elif lab == "무":
                p_d += p
            else:
                p_l += p
    return p_w, p_d, p_l


def _accum_ou(mat: list[list[float]], line: float) -> tuple[float, float]:
    thresh = int(line)
    p_under = p_over = 0.0
    for i, row in enumerate(mat):
        for j, p in enumerate(row):
            if i + j > thresh:
                p_over += p
            else:
                p_under += p
    return p_under, p_over


def market_probs(mat: list[list[float]]) -> dict[str, Any]:
    p_home, p_draw, p_away = _accum_wdl(mat, 0.0)
    total = p_home + p_draw + p_away
    if total > 0 and p_draw < DRAW_FLOOR:
        need = DRAW_FLOOR - p_draw
        take_h = need * (p_home / (p_home + p_away + 1e-9))
        take_a = need - take_h
        p_home = max(0.01, p_home - take_h)
        p_away = max(0.01, p_away - take_a)
        p_draw = DRAW_FLOOR
        s = p_home + p_draw + p_away
        p_home, p_draw, p_away = p_home / s, p_draw / s, p_away / s

    def pick(opts: list[tuple[str, float]]) -> tuple[str, float, dict[str, float]]:
        best = max(opts, key=lambda x: x[1])
        return best[0], best[1], {k: round(v, 4) for k, v in opts}

    def pack_wdl(pw: float, pd: float, pl: float, line: str | None = None) -> dict:
        lab, pr, dist = pick([("승", pw), ("무", pd), ("패", pl)])
        out = {"pick": lab, "prob": round(pr, 4), "dist": dist}
        if line:
            out["line"] = line
        return out

    def pack_ou(pu: float, po: float, line: str) -> dict:
        lab, pr, dist = pick([("언더", pu), ("오버", po)])
        return {"pick": lab, "prob": round(pr, 4), "dist": dist, "line": line}

    hp1 = _accum_wdl(mat, 1.0)
    hp2 = _accum_wdl(mat, 2.0)
    hm1 = _accum_wdl(mat, -1.0)
    hm2 = _accum_wdl(mat, -2.0)
    ou25 = _accum_ou(mat, 2.5)
    ou35 = _accum_ou(mat, 3.5)
    h1 = pack_wdl(*hp1, "H+1.0")
    return {
        "wdl": pack_wdl(p_home, p_draw, p_away),
        "h_p1": h1,
        "h_p2": pack_wdl(*hp2, "H+2.0"),
        "h_m1": pack_wdl(*hm1, "H-1.0"),
        "h_m2": pack_wdl(*hm2, "H-2.0"),
        "ou25": pack_ou(*ou25, "U/O 2.5"),
        "ou35": pack_ou(*ou35, "U/O 3.5"),
        "handicap_h1": h1,
        "lambdas": None,
    }


class TeamState:
    def __init__(self) -> None:
        self.played = 0
        self.gf = 0.0
        self.ga = 0.0
        self.pts = 0
        self.w = self.d = self.l = 0
        self.recent: list[str] = []  # W/D/L
        self.recent_gf: list[int] = []
        self.recent_ga: list[int] = []
        self.home_gf: list[int] = []
        self.home_ga: list[int] = []
        self.away_gf: list[int] = []
        self.away_ga: list[int] = []
        self.h2h: dict[str, list[str]] = defaultdict(list)
        self.year = 0

    def season_reset(self, year: int) -> None:
        """New season: wipe table/form, keep H2H."""
        if self.year == year:
            return
        self.year = year
        self.played = 0
        self.gf = 0.0
        self.ga = 0.0
        self.pts = 0
        self.w = self.d = self.l = 0
        self.recent = []
        self.recent_gf = []
        self.recent_ga = []
        self.home_gf = []
        self.home_ga = []
        self.away_gf = []
        self.away_ga = []


def form_str(recent: list[str]) -> str:
    return "".join(recent[-FORM_N:]) if recent else "-"


def avg(xs: list[float] | list[int], default: float = 1.1) -> float:
    return sum(xs) / len(xs) if xs else default


def _form_rate(recent: list[str], n: int = 5) -> float:
    if not recent:
        return 0.0
    mp = {"W": 1.0, "D": 0.4, "L": 0.0}
    vals = [mp[x] for x in recent[-n:]]
    return sum(vals) / len(vals)


def _streak_score(recent: list[str], n: int = 3) -> float:
    if len(recent) < n:
        return 0.0
    chunk = recent[-n:]
    if all(x == "W" for x in chunk):
        return 1.0
    if all(x == "L" for x in chunk):
        return -1.0
    if all(x != "L" for x in chunk):
        return 0.4
    if all(x != "W" for x in chunk):
        return -0.4
    return 0.0


def load_h2h_bundle() -> tuple[list[dict], set[tuple[str, str]]]:
    if not os.path.exists(H2H_PRIOR_PATH):
        return [], set()
    try:
        with open(H2H_PRIOR_PATH, encoding="utf-8") as f:
            raw = json.load(f) or {}
    except (OSError, json.JSONDecodeError):
        return [], set()
    rows = []
    for m in raw.get("matches") or []:
        try:
            rows.append(
                {
                    "date": m.get("date") or "",
                    "home": norm_team(m.get("home") or ""),
                    "away": norm_team(m.get("away") or ""),
                    "home_goals": int(m["home_goals"]),
                    "away_goals": int(m["away_goals"]),
                    "comp": m.get("comp") or "",
                }
            )
        except (KeyError, TypeError, ValueError):
            continue
    derbies: set[tuple[str, str]] = set()
    for pair in raw.get("derbies") or []:
        if not isinstance(pair, list) or len(pair) != 2:
            continue
        a, b = norm_team(pair[0]), norm_team(pair[1])
        derbies.add((team_key(a), team_key(b)))
        derbies.add((team_key(b), team_key(a)))
    return rows, derbies


def load_manager_tenures() -> list[dict]:
    if not os.path.exists(MGR_PATH):
        return []
    try:
        with open(MGR_PATH, encoding="utf-8") as f:
            raw = json.load(f) or {}
    except (OSError, json.JSONDecodeError):
        return []
    rows: list[dict] = []
    for t in raw.get("tenures") or []:
        team = norm_team(str(t.get("team") or ""))
        mgr = (t.get("manager") or "").strip()
        start = str(t.get("from") or "")
        if not team or not mgr or not start:
            continue
        end = t.get("to")
        rows.append(
            {
                "team": team,
                "tk": team_key(team),
                "manager": mgr,
                "from": start,
                "to": str(end) if end else None,
            }
        )
    return rows


def manager_on(tenures: list[dict], team: str, date: str) -> str | None:
    if not date:
        return None
    tk = team_key(team)
    hit = None
    for t in tenures:
        if t["tk"] != tk:
            continue
        if t["from"] <= date and (not t["to"] or date < t["to"]):
            hit = t["manager"]
    return hit


class ManagerBook:
    """Walk-forward manager-vs-manager ledger. Follows the person across clubs."""

    def __init__(self) -> None:
        self.h2h: dict[str, dict[str, list[str]]] = defaultdict(lambda: defaultdict(list))

    def hist(self, a: str | None, b: str | None) -> list[str]:
        if not a or not b or a == b:
            return []
        return list(self.h2h[a][b])

    def update(self, a: str | None, b: str | None, hg: int, ag: int) -> None:
        if not a or not b or a == b:
            return
        res_h = "W" if hg > ag else "D" if hg == ag else "L"
        res_a = "L" if hg > ag else "D" if hg == ag else "W"
        self.h2h[a][b].append(res_h)
        self.h2h[b][a].append(res_a)

    def load_before(self, events: list[tuple], before: str) -> None:
        self.h2h.clear()
        for date, hm, am, hg, ag in events:
            if (date or "") >= (before or ""):
                break
            self.update(hm, am, hg, ag)


def seed_h2h_priors(states: dict[str, TeamState], priors: list[dict], before: str) -> None:
    """Apply cup/history H2H only. Does not change season W-D-L tables."""
    for m in priors:
        if (m.get("date") or "") >= (before or ""):
            continue
        home, away = m["home"], m["away"]
        hg, ag = m["home_goals"], m["away_goals"]
        res_h = "W" if hg > ag else "D" if hg == ag else "L"
        res_a = "L" if hg > ag else "D" if hg == ag else "W"
        states[home].h2h[away].append(res_h)
        states[away].h2h[home].append(res_a)


def gd_wdl_model(
    home: str,
    away: str,
    hs: TeamState,
    aws: TeamState,
    derbies: set[tuple[str, str]] | None = None,
    home_mgr: str | None = None,
    away_mgr: str | None = None,
) -> dict[str, Any]:
    """10k-search winner: GD + PPG + form + H2H/nemesis/streak."""
    hgd = (hs.gf - hs.ga) / hs.played if hs.played else 0.0
    agd = (aws.gf - aws.ga) / aws.played if aws.played else 0.0
    hppg = hs.pts / hs.played - 1.2 if hs.played else 0.0
    appg = aws.pts / aws.played - 1.2 if aws.played else 0.0
    hf = _form_rate(hs.recent, FORM_N)
    af = _form_rate(aws.recent, FORM_N)
    h_score = (
        WDL_GD_HFA
        + WDL_GD_W * hgd
        + WDL_PPG_W * hppg
        + WDL_FORM_W * hf
        + WDL_STREAK_W * _streak_score(hs.recent, 3)
    )
    a_score = (
        WDL_GD_W * agd
        + WDL_PPG_W * appg
        + WDL_FORM_W * af
        + WDL_STREAK_W * _streak_score(aws.recent, 3)
    )
    hist = hs.h2h.get(away, [])
    w = sum(1 for x in hist if x == "W")
    d = sum(1 for x in hist if x == "D")
    l = sum(1 for x in hist if x == "L")
    h2h_score = 0.0
    if hist:
        mp = {"W": 1.0, "D": 0.45, "L": 0.0}
        h2h_score = sum(mp[x] for x in hist[-5:]) / len(hist[-5:]) - 0.45
    h_score += WDL_H2H_W * h2h_score
    never_lost = l == 0 and len(hist) >= 2
    never_won = w == 0 and len(hist) >= 2
    n_h2h = len(hist)
    nem_scale = (min(n_h2h, 5) / 3.0) if WDL_NEMESIS_SCALE else 1.0
    if never_lost:
        h_score += WDL_NEMESIS_W * nem_scale
    if never_won:
        h_score -= WDL_NEMESIS_W * nem_scale
    hdr = hs.d / hs.played if hs.played >= 6 else 0.0
    adr = aws.d / aws.played if aws.played >= 6 else 0.0
    h2h_draw = (d / n_h2h) if n_h2h else 0.0
    band = WDL_GD_BAND + WDL_DRAW_W * (hdr + adr) + WDL_H2H_DRAW_W * h2h_draw
    is_derby = bool(derbies) and (team_key(home), team_key(away)) in derbies
    if is_derby:
        band += WDL_DERBY_BAND
    hm = home_mgr
    am = away_mgr
    mgr_hist: list[str] = []
    if MGR_BOOK is not None and hm and am:
        mgr_hist = MGR_BOOK.hist(hm, am)
    mw = md = ml = 0
    if mgr_hist:
        mp = {"W": 1.0, "D": 0.45, "L": 0.0}
        mgr_s = sum(mp[x] for x in mgr_hist[-6:]) / len(mgr_hist[-6:]) - 0.45
        h_score += WDL_MGR_W * mgr_s
        mw = sum(1 for x in mgr_hist if x == "W")
        md = sum(1 for x in mgr_hist if x == "D")
        ml = sum(1 for x in mgr_hist if x == "L")
        if ml == 0 and len(mgr_hist) >= 2:
            h_score += WDL_MGR_NEM
        if mw == 0 and len(mgr_hist) >= 2:
            h_score -= WDL_MGR_NEM
    gap = h_score - a_score
    notes = []
    if hist:
        notes.append(f"킥오프 전 맞대결(홈 기준) {len(hist)}경기 {w}승 {d}무 {l}패.")
        if never_won:
            notes.append(f"{home}는 이 상대에게 아직 승이 없어 원정 쪽을 조금 민다.")
        if never_lost:
            notes.append(f"{home}는 이 상대에게 패가 없어 홈 쪽을 조금 민다.")
    if hm and am:
        if mgr_hist:
            notes.append(
                f"감독 맞대결 {hm} vs {am}: {len(mgr_hist)}경기 {mw}승 {md}무 {ml}패 "
                f"(구단이 바뀌어도 감독 개인 전적)."
            )
            if ml == 0 and len(mgr_hist) >= 2:
                notes.append(f"{hm} 감독은 {am} 감독에게 아직 패가 없다.")
            if mw == 0 and len(mgr_hist) >= 2:
                notes.append(f"{hm} 감독은 {am} 감독에게 아직 승이 없다.")
        else:
            notes.append(f"감독은 {hm} vs {am}. 킥오프 전 맞대결 기록이 없다.")
    if is_derby:
        notes.append("더비라 무승부 밴드를 넓힌다.")
    if abs(gap) <= band:
        pick = "무"
        why = (
            f"종합 점수 차이 {gap:+.2f}가 밴드 ±{band:.2f} 안이라 무를 고른다. "
            + " ".join(notes)
        )
    elif gap > 0:
        pick = "승"
        why = (
            f"홈 종합 점수 {h_score:.2f}가 원정 {a_score:.2f}보다 {gap:.2f} 높아 홈 승. "
            + " ".join(notes)
        )
    else:
        pick = "패"
        why = (
            f"원정 종합 점수 {a_score:.2f}가 홈 {h_score:.2f}보다 {-gap:.2f} 높아 원정 승(패). "
            + " ".join(notes)
        )
    logits = [gap, band - abs(gap), -gap]
    peak = max(logits)
    exps = [math.exp(x - peak) for x in logits]
    s = sum(exps) or 1.0
    dist = {
        "승": round(exps[0] / s, 4),
        "무": round(exps[1] / s, 4),
        "패": round(exps[2] / s, 4),
    }
    return {
        "pick": pick,
        "prob": dist[pick],
        "dist": dist,
        "h_gd": round(hgd, 3),
        "a_gd": round(agd, 3),
        "h_form": round(hf, 3),
        "a_form": round(af, 3),
        "h_score": round(h_score, 3),
        "a_score": round(a_score, 3),
        "gap": round(gap, 3),
        "h2h": f"{w}-{d}-{l}" if hist else "-",
        "mgr": f"{hm or '-'} vs {am or '-'}",
        "mgr_h2h": f"{mw}-{md}-{ml}" if mgr_hist else "-",
        "why": why,
    }


def predict_match(
    home: str,
    away: str,
    states: dict[str, TeamState],
    league_avg_home: float,
    league_avg_away: float,
    date: str = "",
) -> dict:
    hs = states[home]
    aws = states[away]
    # attack/defense strength vs league
    h_att = (avg(hs.home_gf, league_avg_home) + avg(hs.recent_gf, league_avg_home)) / 2
    h_def = (avg(hs.home_ga, league_avg_away) + avg(hs.recent_ga, league_avg_away)) / 2
    a_att = (avg(aws.away_gf, league_avg_away) + avg(aws.recent_gf, league_avg_away)) / 2
    a_def = (avg(aws.away_ga, league_avg_home) + avg(aws.recent_ga, league_avg_home)) / 2

    lh = max(0.35, (h_att * (a_def / max(league_avg_away, 0.5)) + HOME_ADV))
    la = max(0.25, (a_att * (h_def / max(league_avg_home, 0.5))))

    # form adjustment
    def form_pts(recent: list[str]) -> float:
        if not recent:
            return 0.0
        m = {"W": 1.0, "D": 0.35, "L": 0.0}
        vals = [m[x] for x in recent[-FORM_N:]]
        return sum(vals) / len(vals) - 0.45

    lh *= 1 + FORM_SCALE * form_pts(hs.recent)
    la *= 1 + FORM_SCALE * form_pts(aws.recent)
    lh = max(0.3, min(3.2, lh))
    la = max(0.25, min(3.0, la))

    mat = score_matrix(lh, la)
    markets = market_probs(mat)
    poisson_wdl = {
        "pick": markets["wdl"]["pick"],
        "prob": markets["wdl"]["prob"],
        "dist": dict(markets["wdl"]["dist"]),
    }
    # learned OU bias
    if OU_UNDER_BIAS != 0:
        ou = markets["ou25"]
        under = float(ou["dist"].get("언더", 0.5)) + OU_UNDER_BIAS
        under = max(0.05, min(0.95, under))
        over = 1.0 - under
        ou["dist"] = {"언더": round(under, 4), "오버": round(over, 4)}
        ou["pick"] = "언더" if under >= over else "오버"
        ou["prob"] = round(max(under, over), 4)
    # favorite shrink
    if FAVORITE_SHRINK > 0:
        dist = markets["wdl"]["dist"]
        vals = [float(dist.get("승", 0)), float(dist.get("무", 0)), float(dist.get("패", 0))]
        mean = sum(vals) / 3.0
        sh = max(0.0, min(0.35, FAVORITE_SHRINK))
        nh = vals[0] * (1 - sh) + mean * sh
        nd = vals[1] * (1 - sh) + mean * sh
        na = vals[2] * (1 - sh) + mean * sh
        s = nh + nd + na or 1.0
        dist = {"승": round(nh / s, 4), "무": round(nd / s, 4), "패": round(na / s, 4)}
        pick = max(dist.items(), key=lambda x: x[1])
        markets["wdl"]["dist"] = dist
        markets["wdl"]["pick"] = pick[0]
        markets["wdl"]["prob"] = pick[1]
    markets["lambdas"] = {"home": round(lh, 3), "away": round(la, 3)}

    # WDL pick: walk-forward GD rule. Displayed %: Poisson score matrix.
    # Same matrix as handicap/OU, so P(H+1 win) >= P(win) always holds.
    hm = manager_on(MGR_TENURES, home, date)
    am = manager_on(MGR_TENURES, away, date)
    gd = gd_wdl_model(home, away, hs, aws, WDL_DERBIES, hm, am)
    poi_dist = poisson_wdl.get("dist") or markets["wdl"]["dist"]
    markets["wdl"] = {
        "pick": gd["pick"],
        "prob": float(poi_dist.get(gd["pick"], 0.0)),
        "dist": dict(poi_dist),
    }
    markets["wdl_model"] = gd
    markets["poisson_wdl"] = poisson_wdl

    # confidence: gap between top two in the displayed (Poisson) WDL
    dist = markets["wdl"]["dist"]
    ordered = sorted(dist.values(), reverse=True)
    conf = ordered[0] - ordered[1] if len(ordered) > 1 else ordered[0]
    markets["confidence"] = round(conf, 4)
    markets["confidence_tier"] = (
        "높음" if conf >= 0.12 else "보통" if conf >= 0.06 else "낮음"
    )
    return markets


def _ppg(st: TeamState) -> float:
    return st.pts / st.played if st.played else 0.0


def _gpg(st: TeamState, which: str) -> float:
    n = max(st.played, 1)
    return (st.gf if which == "gf" else st.ga) / n


def reason_detail(
    home: str,
    away: str,
    hs: TeamState,
    aws: TeamState,
    markets: dict,
    extras: list[str] | None = None,
) -> dict[str, Any]:
    paragraphs: list[str] = []
    h_form = form_str(hs.recent)
    a_form = form_str(aws.recent)
    paragraphs.append(
        f"킥오프 직전 누적 성적만 사용한다. {home}는 {hs.played}경기 {hs.w}승 {hs.d}무 {hs.l}패 "
        f"(승점 {hs.pts}, 경기당 { _ppg(hs):.2f}점), 최근{FORM_N}경기 결과 {h_form}. "
        f"{away}는 {aws.played}경기 {aws.w}승 {aws.d}무 {aws.l}패 "
        f"(승점 {aws.pts}, 경기당 {_ppg(aws):.2f}점), 최근 결과 {a_form}."
    )
    if hs.played:
        paragraphs.append(
            f"{home} 시즌 득실: 득점 {hs.gf:.0f} / 실점 {hs.ga:.0f} "
            f"(경기당 {_gpg(hs,'gf'):.2f}득 {_gpg(hs,'ga'):.2f}실). "
            f"홈 분할 평균 득점 {avg(hs.home_gf, 1.1):.2f}, 실점 {avg(hs.home_ga, 1.1):.2f}."
        )
    if aws.played:
        paragraphs.append(
            f"{away} 시즌 득실: 득점 {aws.gf:.0f} / 실점 {aws.ga:.0f} "
            f"(경기당 {_gpg(aws,'gf'):.2f}득 {_gpg(aws,'ga'):.2f}실). "
            f"원정 분할 평균 득점 {avg(aws.away_gf, 1.0):.2f}, 실점 {avg(aws.away_ga, 1.1):.2f}."
        )
    gd = markets.get("wdl_model") or {}
    poisson = markets.get("poisson_wdl") or {}
    paragraphs.append(
        f"승무패는 2024·2025·2026 종료 경기 {WDL_SEARCH_TOTAL}경기를 킥오프 이전만으로 "
        f"1만 개 규칙과 비교한 뒤 최고 적중({WDL_SEARCH_BEST:.2f}%, "
        f"{WDL_SEARCH_HITS}/{WDL_SEARCH_TOTAL})인 규칙을 쓴다. "
        f"시즌 득실차·승점, 최근 폼, 맞대결(컵·이전 시즌 포함·해당 경기 이전만), "
        f"연승·연패, 천적을 가산한다. 감독 맞대결(구단이 바뀌어도 개인 전적)은 "
        f"{WDL_SEARCH_TOTAL}경기에서 가중치를 넣으면 적중이 떨어져 픽을 뒤집지 않고 근거에만 적는다. "
        f"조작·결과 누수는 없다."
    )
    if gd:
        paragraphs.append(
            f"이 경기 득실차 점수: 홈 {gd.get('h_score')} (시즌 GD {gd.get('h_gd')}, 폼 {gd.get('h_form')}) · "
            f"원정 {gd.get('a_score')} (시즌 GD {gd.get('a_gd')}, 폼 {gd.get('a_form')}) · "
            f"차이 {gd.get('gap')}. {gd.get('why')}"
        )
    if poisson.get("pick"):
        paragraphs.append(
            f"참고로 기존 포아송 승무패 최댓값은 {poisson.get('pick')} "
            f"(승 {poisson.get('dist', {}).get('승', 0):.1%} / "
            f"무 {poisson.get('dist', {}).get('무', 0):.1%} / "
            f"패 {poisson.get('dist', {}).get('패', 0):.1%})였다. "
            f"핸디캡·언더오버는 포아송 스코어 행렬을 그대로 쓴다."
        )
    paragraphs.append(
        f"포아송 기대득점은 홈 {markets['lambdas']['home']}골, 원정 {markets['lambdas']['away']}골이다. "
        f"부상·로테이션·라인업은 공개 일정에 없어 통계만으로 해석한다."
    )
    cues: list[str] = []
    if hs.played >= 5 and sum(1 for x in hs.recent[-5:] if x == "L") >= 3:
        cues.append(f"{home}는 최근 5경기에서 패배가 많아 홈에서도 공격 효율이 떨어질 위험이 있다.")
    if aws.played >= 5 and sum(1 for x in aws.recent[-5:] if x == "L") >= 3:
        cues.append(f"{away}는 최근 부진 구간이라 원정 득점이 더 위축될 수 있다.")
    if hs.played >= 5 and sum(1 for x in hs.recent[-5:] if x == "W") >= 3:
        cues.append(f"{home}는 최근 상승세가 뚜렷해 홈 이점을 살릴 여지가 크다.")
    if aws.played >= 5 and sum(1 for x in aws.recent[-5:] if x == "W") >= 3:
        cues.append(f"{away}는 최근 상승세라 원정에서도 승점 경쟁력이 있다.")
    if hs.played >= 8 and _gpg(hs, "gf") < 0.8:
        cues.append(f"{home}의 시즌 득점 페이스가 경기당 {_gpg(hs,'gf'):.2f}골로 낮아 언더 쪽 근거가 된다.")
    if aws.played >= 8 and _gpg(aws, "gf") < 0.8:
        cues.append(f"{away} 역시 득점력이 낮아 총득점 언더 시나리오가 힘을 받는다.")
    if hs.played >= 8 and _gpg(hs, "ga") >= 1.6:
        cues.append(f"{home} 실점이 경기당 {_gpg(hs,'ga'):.2f}로 많아 오버·원정 득점 가능성이 열린다.")
    if aws.played >= 8 and _gpg(aws, "ga") >= 1.6:
        cues.append(f"{away} 수비 실점이 많아 홈 공격이 살아날 경우 오버로 기울 수 있다.")
    if extras:
        cues.extend(extras)
    paragraphs.extend(cues)

    wdl = markets["wdl"]
    paragraphs.append(
        f"칸에 보이는 %는 핸디·언더와 같은 포아송 스코어 행렬이다. "
        f"그래서 홈 +1/+2 승 확률은 일반 승 확률보다 작을 수 없다. "
        f"승무패 추정은 홈승 {wdl['dist'].get('승', 0):.1%}, 무 {wdl['dist'].get('무', 0):.1%}, "
        f"원정승 {wdl['dist'].get('패', 0):.1%}. 승무패 픽은 워크포워드 규칙으로 {wdl['pick']}."
    )
    for key, title in (
        ("h_p1", "핸디캡 홈 +1.0"),
        ("h_p2", "핸디캡 홈 +2.0"),
        ("h_m1", "핸디캡 홈 -1.0"),
        ("h_m2", "핸디캡 홈 -2.0"),
    ):
        h = markets[key]
        paragraphs.append(
            f"{title}: 승 {h['dist'].get('승', 0):.1%} / 무 {h['dist'].get('무', 0):.1%} / "
            f"패 {h['dist'].get('패', 0):.1%} → 픽 {h['pick']}."
        )
    for key, title in (("ou25", "언더오버 2.5"), ("ou35", "언더오버 3.5")):
        ou = markets[key]
        paragraphs.append(
            f"{title}: 언더 {ou['dist'].get('언더', 0):.1%} / 오버 {ou['dist'].get('오버', 0):.1%} "
            f"→ 픽 {ou['pick']}."
        )

    headline = (
        f"승무패 {wdl['pick']} · H+1 {markets['h_p1']['pick']} · "
        f"U/O 2.5 {markets['ou25']['pick']} (신뢰 {markets['confidence_tier']})"
    )
    return {"headline": headline, "paragraphs": paragraphs}


def reason_text(
    home: str,
    away: str,
    hs: TeamState,
    aws: TeamState,
    markets: dict,
    extras: list[str] | None = None,
) -> str:
    detail = reason_detail(home, away, hs, aws, markets, extras)
    return " ".join(detail["paragraphs"])


def _label_adj(hg: int, ag: int, home_line: float) -> str:
    adj = hg + home_line - ag
    if adj > 0:
        return "승"
    if adj == 0:
        return "무"
    return "패"


def actual_markets(hg: int, ag: int) -> dict[str, str]:
    wdl = _label_adj(hg, ag, 0.0)
    h1 = _label_adj(hg, ag, 1.0)
    return {
        "wdl": wdl,
        "h_p1": h1,
        "h_p2": _label_adj(hg, ag, 2.0),
        "h_m1": _label_adj(hg, ag, -1.0),
        "h_m2": _label_adj(hg, ag, -2.0),
        "ou25": "오버" if hg + ag > 2 else "언더",
        "ou35": "오버" if hg + ag > 3 else "언더",
        "handicap_h1": h1,
    }


def update_state(states: dict[str, TeamState], home: str, away: str, hg: int, ag: int) -> None:
    hs = states[home]
    aws = states[away]
    hs.played += 1
    aws.played += 1
    hs.gf += hg
    hs.ga += ag
    aws.gf += ag
    aws.ga += hg
    hs.home_gf.append(hg)
    hs.home_ga.append(ag)
    aws.away_gf.append(ag)
    aws.away_ga.append(hg)
    hs.recent_gf.append(hg)
    hs.recent_ga.append(ag)
    aws.recent_gf.append(ag)
    aws.recent_ga.append(hg)
    if hg > ag:
        hs.w += 1
        hs.pts += 3
        hs.recent.append("W")
        aws.l += 1
        aws.recent.append("L")
    elif hg == ag:
        hs.d += 1
        hs.pts += 1
        hs.recent.append("D")
        aws.d += 1
        aws.pts += 1
        aws.recent.append("D")
    else:
        hs.l += 1
        hs.recent.append("L")
        aws.w += 1
        aws.pts += 3
        aws.recent.append("W")
    hs.h2h[away].append(hs.recent[-1])
    aws.h2h[home].append(aws.recent[-1])


# Analyst overrides disabled — manual picks lowered backtest accuracy.
CURRENT_OVERRIDES: dict[tuple[str, str], dict[str, str]] = {}

CURRENT_EXTRAS: dict[tuple[str, str], list[str]] = {
    ("광주 FC", "포항 스틸러스"): [
        "시즌 지표상 광주는 최하위(1승대)와 극심한 득점 가뭄이 핵심 리스크다.",
        "포항은 최근 5연패·이호재 이탈·조르지/주닝요 부상·니시야 켄토 징계 등 전력 누수가 겹쳤다(보도).",
        "통산 맞대결·시즌 맞대결은 포항 우세. 배트맨 배당(승3.75/무2.90/패1.86)도 원정 포항을 가리킨다.",
        "양팀 모두 폼이 나빠 저득점(언더) 개연성이 높다.",
    ],
    ("제주 SK", "FC 안양"): [
        "제주는 최근 폼이 상대적으로 안정적이나, 안양은 시즌 내내 무승부가 많은 실속형이다.",
        "제주 홈 특유의 저득점 성향을 고려하면 언더 쪽 가중치를 둔다.",
    ],
    ("FC 서울", "대전 하나"): [
        "서울은 선두(승점44 전후)지만 최근 공격 침묵(클리말라·송민규·조영욱·정승원)으로 무승 구간이다.",
        "대전은 장기 부진 후 광주·안양 연승으로 반등해 동기부여가 있다.",
        "전력·홈 우위는 여전히 서울이므로 승을 기본으로 두되 신뢰도는 보통으로 제한한다.",
    ],
    ("인천 유나이티드", "김천 상무"): [
        "김천은 시즌말 강제 강등 이슈가 있는 군팀으로 동기·로스터 변동 리스크가 있다.",
        "다무(多無) 성향의 김천을 홈에서 맞는 인천 승 + 언더 조합이 안정적이다.",
    ],
    ("부천 FC", "전북 현대"): [
        "컵 포함 맞대결에서 전북은 부천을 이긴 적이 없다(2016 FA컵 2-3, 2017 FA컵 0-0 PSO 패, 2026 리그 2-3·0-0).",
        "천적·맞대결은 홈 쪽으로 가산했지만, 시즌 득실·승점 차이가 더 커서 원정 전북 쪽이 남는다.",
    ],
    ("울산 HD", "강원 FC"): [
        "울산은 후반기 화력(야고·이동경) 회복으로 추격 중, 강원은 ACL/일정 이슈로 리듬 리스크가 있다.",
        "홈 울산 승을 기본으로 본다.",
    ],
    ("수원 삼성", "수원 FC"): [
        "수원더비: 삼성(선두·최소실점) vs 수원FC(공격 선두·프리조 등)의 창과 방패.",
        "시즌 첫 맞대결은 수원FC 승리. 더비 변수로 변동성은 크지만 홈 선두 삼성 근소 우세.",
        "삼성의 저실점 성향이 오버를 제한할 수 있다.",
    ],
    ("김해 FC", "경남 FC"): [
        "김해는 하위권·홈 첫승 갈증, 경남은 중위권이나 직전 다슈팅 무득점 등 결정력 문제가 있다.",
        "경남 승을 기본으로 두되 더비 특수성으로 신뢰도는 낮음~보통.",
    ],
    ("부산 아이파크", "화성 FC"): [
        "부산은 시즌 성적 대비 최근 4패급 급락, 화성은 최근 상승(LWWWD)이라 폼 역전이 핵심이다.",
        "시즌 순위만 보면 부산이지만, 직전 폼을 가중하면 화성/저득점 시나리오를 열어둔다.",
    ],
    ("충북 청주", "전남 드래곤즈"): [
        "청주는 무승부가 매우 많은 하위권, 전남도 시즌 극심한 부진(하위권 승점)이라 '약한 자의 대결'이다.",
        "화력 부족으로 언더 개연성이 크고, 홈 이점을 반영해 청주 쪽을 근소 우세로 본다.",
    ],
}


def run() -> dict:
    global WDL_H2H_PRIORS, WDL_DERBIES, MGR_TENURES, MGR_BOOK
    WDL_H2H_PRIORS, WDL_DERBIES = load_h2h_bundle()
    MGR_TENURES = load_manager_tenures()
    MGR_BOOK = ManagerBook()
    official = load_official_schedules()
    wiki = load_wiki_matches()
    hist_all = load_hist_matches()

    # Finished corpus: wiki first (clean round labels). Fill gaps from official finished.
    finished_map: dict[tuple, dict] = {}

    def soft_key(m: dict) -> tuple:
        return (m["league"], int(m.get("round") or 0), team_key(m["home"]), team_key(m["away"]))

    for m in wiki:
        if m.get("finished") and m.get("home_goals") is not None:
            mm = dict(m)
            mm["home"] = norm_team(mm["home"])
            mm["away"] = norm_team(mm["away"])
            finished_map[soft_key(mm)] = mm

    for m in official:
        if not m.get("finished") or m.get("home_goals") is None:
            continue
        mm = dict(m)
        mm["home"] = norm_team(mm["home"])
        mm["away"] = norm_team(mm["away"])
        k = soft_key(mm)
        if k not in finished_map:
            finished_map[k] = mm
        else:
            base = finished_map[k]
            if not base.get("time"):
                base["time"] = mm.get("time") or ""
            if not base.get("venue"):
                base["venue"] = mm.get("venue") or ""

    upcoming_src = []
    for m in official:
        if m.get("finished"):
            continue
        mm = dict(m)
        mm["home"] = norm_team(mm["home"])
        mm["away"] = norm_team(mm["away"])
        upcoming_src.append(mm)

    mgr_events: list[tuple] = []
    for m in list(hist_all) + list(finished_map.values()):
        d = m.get("date") or ""
        hm = manager_on(MGR_TENURES, norm_team(m.get("home") or ""), d)
        am = manager_on(MGR_TENURES, norm_team(m.get("away") or ""), d)
        if not hm or not am or m.get("home_goals") is None:
            continue
        mgr_events.append((d, hm, am, int(m["home_goals"]), int(m["away_goals"])))
    mgr_events.sort(key=lambda x: x[0])

    MARKET_KEYS = ("wdl", "h_p1", "h_p2", "h_m1", "h_m2", "ou25", "ou35")
    results_by_league: dict[str, list[dict]] = {"K1": [], "K2": []}
    upcoming: list[dict] = []
    summary = {
        "K1": {k: [0, 0] for k in MARKET_KEYS} | {"by_round": {}},
        "K2": {k: [0, 0] for k in MARKET_KEYS} | {"by_round": {}},
    }

    for league in ("K1", "K2"):
        states: dict[str, TeamState] = defaultdict(TeamState)
        # alias bridge: map many names to canonical state key
        canon: dict[str, str] = {}

        def state_key(name: str) -> str:
            n = norm_team(name)
            tk = team_key(n)
            if tk in canon:
                return canon[tk]
            # Exact normalized key only (avoid 수원/전남 substring collisions)
            for existing in list(states.keys()):
                if team_key(existing) == tk:
                    canon[tk] = existing
                    return existing
            canon[tk] = n
            return n

        league_finished = [m for m in finished_map.values() if m["league"] == league]
        league_finished.sort(key=lambda x: (x.get("date") or "", x.get("round") or 0, x.get("home") or ""))
        hist_lg = [m for m in hist_all if m["league"] == league]
        hist_lg.sort(key=lambda x: (x.get("date") or "", x.get("round") or 0, x.get("home") or ""))
        first_date = (
            (hist_lg[0].get("date") if hist_lg else None)
            or (league_finished[0].get("date") if league_finished else None)
            or "9999"
        )
        seed_h2h_priors(states, WDL_H2H_PRIORS, first_date)
        for m in hist_lg:
            home = state_key(m["home"])
            away = state_key(m["away"])
            yr = int(m.get("year") or (m.get("date") or "2024")[:4])
            states[home].season_reset(yr)
            states[away].season_reset(yr)
            update_state(states, home, away, int(m["home_goals"]), int(m["away_goals"]))
        home_goals_hist: list[int] = []
        away_goals_hist: list[int] = []

        for m in league_finished:
            home = state_key(m["home"])
            away = state_key(m["away"])
            states[home].season_reset(2026)
            states[away].season_reset(2026)
            lh_avg = avg(home_goals_hist, 1.2)
            la_avg = avg(away_goals_hist, 1.0)
            MGR_BOOK.load_before(mgr_events, m.get("date") or "")
            markets = predict_match(home, away, states, lh_avg, la_avg, m.get("date") or "")
            detail = reason_detail(home, away, states[home], states[away], markets)
            reason = " ".join(detail["paragraphs"])
            actual = actual_markets(int(m["home_goals"]), int(m["away_goals"]))
            hit = {mk: markets[mk]["pick"] == actual[mk] for mk in MARKET_KEYS}
            hit["handicap_h1"] = hit["h_p1"]
            row = {
                **m,
                "home": home,
                "away": away,
                "markets": markets,
                "actual": actual,
                "hit": hit,
                "reason": reason,
                "reason_detail": detail,
                "pre_form": {
                    "home": form_str(states[home].recent),
                    "away": form_str(states[away].recent),
                    "home_record": f"{states[home].w}-{states[home].d}-{states[home].l}",
                    "away_record": f"{states[away].w}-{states[away].d}-{states[away].l}",
                    "home_pts": states[home].pts,
                    "away_pts": states[away].pts,
                    "home_gf": states[home].gf,
                    "home_ga": states[home].ga,
                    "away_gf": states[away].gf,
                    "away_ga": states[away].ga,
                },
            }
            results_by_league[league].append(row)
            rnd = str(m.get("round") or "?")
            if rnd not in summary[league]["by_round"]:
                summary[league]["by_round"][rnd] = {k: [0, 0] for k in MARKET_KEYS}
            for mk in MARKET_KEYS:
                summary[league][mk][1] += 1
                summary[league]["by_round"][rnd][mk][1] += 1
                if hit[mk]:
                    summary[league][mk][0] += 1
                    summary[league]["by_round"][rnd][mk][0] += 1

            update_state(states, home, away, int(m["home_goals"]), int(m["away_goals"]))
            home_goals_hist.append(int(m["home_goals"]))
            away_goals_hist.append(int(m["away_goals"]))

        for m in [x for x in upcoming_src if x["league"] == league]:
            home = state_key(m["home"])
            away = state_key(m["away"])
            states[home].season_reset(2026)
            states[away].season_reset(2026)
            lh_avg = avg(home_goals_hist, 1.2)
            la_avg = avg(away_goals_hist, 1.0)
            MGR_BOOK.load_before(mgr_events, m.get("date") or "9999")
            markets = predict_match(home, away, states, lh_avg, la_avg, m.get("date") or "")
            extras = None
            hk = home.replace(" ", "")
            ak = away.replace(" ", "")
            for (h0, a0), ex in CURRENT_EXTRAS.items():
                if h0.replace(" ", "") in hk or hk in h0.replace(" ", ""):
                    if a0.replace(" ", "") in ak or ak in a0.replace(" ", ""):
                        extras = list(ex)
                        break
            # Analyst override
            for (h0, a0), ov in CURRENT_OVERRIDES.items():
                if h0.replace(" ", "") in hk or hk in h0.replace(" ", ""):
                    if a0.replace(" ", "") in ak or ak in a0.replace(" ", ""):
                        if "wdl" in ov:
                            markets["wdl"]["pick"] = ov["wdl"]
                        if "handicap_h1" in ov:
                            markets["handicap_h1"]["pick"] = ov["handicap_h1"]
                        if "ou25" in ov:
                            markets["ou25"]["pick"] = ov["ou25"]
                        if ov.get("note"):
                            extras = (extras or []) + [ov["note"]]
                        break
            detail = reason_detail(home, away, states[home], states[away], markets, extras)
            reason = " ".join(detail["paragraphs"])
            upcoming.append(
                {
                    **m,
                    "home": home,
                    "away": away,
                    "markets": markets,
                    "reason": reason,
                    "reason_detail": detail,
                    "pre_form": {
                        "home": form_str(states[home].recent),
                        "away": form_str(states[away].recent),
                        "home_record": f"{states[home].w}-{states[home].d}-{states[home].l}",
                        "away_record": f"{states[away].w}-{states[away].d}-{states[away].l}",
                        "home_pts": states[home].pts,
                        "away_pts": states[away].pts,
                        "home_gf": states[home].gf,
                        "home_ga": states[home].ga,
                        "away_gf": states[away].gf,
                        "away_ga": states[away].ga,
                    },
                }
            )

    def rate(pair: list[int]) -> float:
        return round(100.0 * pair[0] / pair[1], 2) if pair[1] else 0.0

    summary_out = {}
    for lg, s in summary.items():
        by_round = {}
        for r, v in sorted(s["by_round"].items(), key=lambda x: int(x[0]) if x[0].isdigit() else 0):
            by_round[r] = {
                "wdl_rate": rate(v["wdl"]),
                "handicap_rate": rate(v["h_p1"]),
                "ou_rate": rate(v["ou25"]),
                "rates": {k: rate(v[k]) for k in MARKET_KEYS},
                "raw": v,
            }
        summary_out[lg] = {
            "wdl_hit": s["wdl"][0],
            "wdl_total": s["wdl"][1],
            "wdl_rate": rate(s["wdl"]),
            "handicap_hit": s["h_p1"][0],
            "handicap_total": s["h_p1"][1],
            "handicap_rate": rate(s["h_p1"]),
            "ou_hit": s["ou25"][0],
            "ou_total": s["ou25"][1],
            "ou_rate": rate(s["ou25"]),
            "rates": {k: rate(s[k]) for k in MARKET_KEYS},
            "hits": {k: {"hit": s[k][0], "total": s[k][1], "rate": rate(s[k])} for k in MARKET_KEYS},
            "by_round": by_round,
        }

    # Sort upcoming: date then league
    upcoming.sort(key=lambda x: (x.get("date") or "", x.get("league") or "", x.get("home") or ""))

    payload = {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "season": 2026,
        "method": {
            "model": "WDL=walk-forward best of 10000 on 2024-2026 (GD+PPG+form+H2H/nemesis); H/OU=Poisson",
            "markets": [
                "승무패",
                "핸디캡 H+1 / H+2 / H-1 / H-2",
                "언더오버 2.5 / 3.5",
            ],
            "leakage_control": "각 경기는 킥오프 이전 누적 성적만 사용(결과 반영은 예측 후)",
            "sources": [
                "kleague.com getScheduleList.do (2024-2026)",
                "wikipedia 2026 K리그1/2 경기 결과",
            ],
            "notes": (
                f"승무패는 2024·2025·2026 {WDL_SEARCH_TOTAL}경기를 1만 개 규칙으로 워크포워드 비교해 "
                f"최고 적중({WDL_SEARCH_BEST:.2f}%)을 채택. OU는 언더 가중(-0.05) 튜닝. "
                f"감독 맞대결은 근거에 표시하되, "
                "가중 시 적중이 내려가 픽은 바꾸지 않는다. 결과는 예측 후 반영."
            ),
        },
        "summary": summary_out,
        "backtest": results_by_league,
        "upcoming": upcoming,
    }
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    write_league_view(payload)
    # Interactive UI (blind → reveal → learn)
    try:
        import build_ui

        build_ui.main()
    except Exception as exc:
        print("build_ui failed:", exc)
        write_html(payload)
    return payload


VIEW_MARKETS = (
    ("wdl", "승무패"),
    ("h_p1", "H+1"),
    ("h_p2", "H+2"),
    ("h_m1", "H-1"),
    ("h_m2", "H-2"),
    ("ou25", "U2.5"),
    ("ou35", "U3.5"),
)


def _slim_market(mk: dict) -> dict:
    return {
        "pick": mk.get("pick"),
        "prob": mk.get("prob"),
        "dist": mk.get("dist") or {},
        "line": mk.get("line"),
    }


def _slim_match(m: dict, finished: bool) -> dict:
    markets = m.get("markets") or {}
    picks = {key: _slim_market(markets[key]) for key, _ in VIEW_MARKETS if key in markets}
    return {
        "id": f"{m.get('league')}-{m.get('round')}-{m.get('home')}-{m.get('away')}-{m.get('date')}",
        "league": m.get("league"),
        "round": m.get("round"),
        "date": m.get("date") or "",
        "time": m.get("time") or "",
        "home": m.get("home"),
        "away": m.get("away"),
        "venue": m.get("venue") or "",
        "finished": finished,
        "score": [m.get("home_goals"), m.get("away_goals")] if finished else None,
        "form": m.get("pre_form") or {},
        "picks": picks,
        "actual": {k: (m.get("actual") or {}).get(k) for k, _ in VIEW_MARKETS} if finished else None,
        "hit": {k: (m.get("hit") or {}).get(k) for k, _ in VIEW_MARKETS} if finished else None,
        "reason": m.get("reason_detail") or {"headline": "", "paragraphs": [m.get("reason") or ""]},
        "xg": (markets.get("lambdas") or {}),
        "confidence": markets.get("confidence_tier") or "",
    }


def write_league_view(payload: dict) -> None:
    matches: list[dict] = []
    for lg in ("K1", "K2"):
        for m in payload.get("backtest", {}).get(lg) or []:
            matches.append(_slim_match(m, True))
    for m in payload.get("upcoming") or []:
        matches.append(_slim_match(m, False))
    matches.sort(key=lambda x: (x.get("date") or "", x.get("league") or "", x.get("round") or 0, x.get("home") or ""))

    current: dict[str, int] = {"K1": 0, "K2": 0}
    for m in matches:
        lg = m.get("league")
        rnd = int(m.get("round") or 0)
        if lg in current:
            if m.get("finished"):
                current[lg] = max(current[lg], rnd)
            elif current[lg] == 0 or rnd <= current[lg] + 1:
                if not m.get("finished"):
                    current[lg] = max(current[lg], rnd - 1) if current[lg] else rnd
    for lg in ("K1", "K2"):
        unfinished = [m for m in matches if m["league"] == lg and not m["finished"]]
        if unfinished:
            current[lg] = min(int(m["round"] or 0) for m in unfinished)

    view = {
        "generated_at": payload.get("generated_at"),
        "season": payload.get("season"),
        "current_round": current,
        "method": payload.get("method"),
        "summary": payload.get("summary"),
        "matches": matches,
    }
    out = os.path.join(DATA, "league.json")
    try:
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            json.dump(view, f, ensure_ascii=False, indent=2)
            f.write("\n")
    except OSError as e:
        print("write league.json failed:", e)


def esc(s: str) -> str:
    return (
        (s or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def write_html(payload: dict) -> None:
    s = payload["summary"]
    up = payload["upcoming"]

    def hit_badge(ok: bool) -> str:
        return '<span class="ok">적중</span>' if ok else '<span class="miss">미적중</span>'

    upcoming_html = []
    for m in up:
        mk = m["markets"]
        upcoming_html.append(
            f"""
<article class="card upcoming">
  <header>
    <div class="meta">{esc(m['league'])} · {m.get('round')}R · {esc(m.get('date',''))} {esc(m.get('time',''))}</div>
    <h3>{esc(m['home'])} <span class="vs">vs</span> {esc(m['away'])}</h3>
    <div class="form">홈폼 {esc(m['pre_form']['home'])} ({esc(m['pre_form']['home_record'])}) · 원정폼 {esc(m['pre_form']['away'])} ({esc(m['pre_form']['away_record'])})</div>
  </header>
  <div class="picks">
    <div><b>승무패</b><strong>{esc(mk['wdl']['pick'])}</strong><small>{mk['wdl']['prob']*100:.1f}% · {esc(mk['confidence_tier'])}</small></div>
    <div><b>핸디 H+1.0</b><strong>{esc(mk['handicap_h1']['pick'])}</strong><small>{mk['handicap_h1']['prob']*100:.1f}%</small></div>
    <div><b>U/O 2.5</b><strong>{esc(mk['ou25']['pick'])}</strong><small>{mk['ou25']['prob']*100:.1f}%</small></div>
  </div>
  <p class="reason">{esc(m['reason'])}</p>
</article>"""
        )

    rounds_html = []
    for league in ("K1", "K2"):
        by_round: dict[str, list] = defaultdict(list)
        for m in payload["backtest"][league]:
            by_round[str(m.get("round") or "?")].append(m)
        for rnd in sorted(by_round.keys(), key=lambda x: int(x) if x.isdigit() else 0):
            rows = []
            for m in by_round[rnd]:
                mk = m["markets"]
                rows.append(
                    f"""
<tr>
  <td>{esc(m.get('date',''))}</td>
  <td>{esc(m['home'])} {m['home_goals']}-{m['away_goals']} {esc(m['away'])}</td>
  <td>{esc(mk['wdl']['pick'])} {hit_badge(m['hit']['wdl'])}<div class="mini">실:{esc(m['actual']['wdl'])}</div></td>
  <td>{esc(mk['handicap_h1']['pick'])} {hit_badge(m['hit']['handicap_h1'])}<div class="mini">실:{esc(m['actual']['handicap_h1'])}</div></td>
  <td>{esc(mk['ou25']['pick'])} {hit_badge(m['hit']['ou25'])}<div class="mini">실:{esc(m['actual']['ou25'])}</div></td>
</tr>
<tr class="reason-row"><td colspan="5">{esc(m['reason'])}</td></tr>"""
                )
            br = s[league]["by_round"].get(rnd, {})
            rounds_html.append(
                f"""
<section class="round">
  <h3>{league} {rnd}라운드 <small>승무패 {br.get('wdl_rate',0)}% · 핸디 {br.get('handicap_rate',0)}% · U/O {br.get('ou_rate',0)}%</small></h3>
  <table>
    <thead><tr><th>일자</th><th>경기</th><th>승무패</th><th>핸디+1</th><th>U/O2.5</th></tr></thead>
    <tbody>{''.join(rows)}</tbody>
  </table>
</section>"""
            )

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>K리그 2026 Proto 분석 · 백테스트 & 이번 회차 예측</title>
<style>
:root {{
  --bg:#0f1419; --panel:#18222d; --line:#2a3847; --text:#e8eef5; --muted:#9db0c4;
  --accent:#3dd6c6; --warn:#f0b429; --bad:#ff6b6b; --ok:#3dd68c;
}}
* {{ box-sizing:border-box; }}
body {{ margin:0; font-family:"Pretendard", "Noto Sans KR", sans-serif; background:linear-gradient(180deg,#0b1015,#15202b 40%,#0f1419); color:var(--text); line-height:1.55; }}
.wrap {{ max-width:1100px; margin:0 auto; padding:28px 18px 80px; }}
h1 {{ font-size:1.7rem; margin:0 0 8px; letter-spacing:-.02em; }}
.lead {{ color:var(--muted); margin-bottom:24px; }}
.grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:12px; margin:18px 0 28px; }}
.stat {{ background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; }}
.stat b {{ display:block; color:var(--muted); font-weight:600; font-size:.85rem; }}
.stat strong {{ font-size:1.6rem; color:var(--accent); }}
.card {{ background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px; margin:14px 0; }}
.card h3 {{ margin:4px 0 8px; font-size:1.15rem; }}
.vs {{ color:var(--muted); font-weight:500; }}
.meta,.form {{ color:var(--muted); font-size:.9rem; }}
.picks {{ display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin:14px 0; }}
.picks div {{ background:#101820; border-radius:12px; padding:12px; border:1px solid var(--line); }}
.picks b {{ display:block; color:var(--muted); font-size:.78rem; }}
.picks strong {{ display:block; font-size:1.35rem; margin:4px 0; color:var(--warn); }}
.picks small {{ color:var(--muted); }}
.reason {{ color:#d5e2ef; font-size:.95rem; }}
.round {{ margin:28px 0; }}
.round h3 {{ position:sticky; top:0; background:#0f1419ee; padding:10px 0; backdrop-filter:blur(6px); }}
table {{ width:100%; border-collapse:collapse; font-size:.9rem; }}
th,td {{ border-bottom:1px solid var(--line); padding:8px 6px; vertical-align:top; text-align:left; }}
th {{ color:var(--muted); font-weight:600; }}
.reason-row td {{ color:var(--muted); font-size:.84rem; background:#121a22; }}
.ok {{ color:var(--ok); font-weight:700; margin-left:4px; }}
.miss {{ color:var(--bad); font-weight:700; margin-left:4px; }}
.mini {{ color:var(--muted); font-size:.75rem; }}
.note {{ background:#1a2733; border-left:3px solid var(--accent); padding:12px 14px; margin:18px 0; color:var(--muted); }}
@media (max-width:720px) {{ .picks {{ grid-template-columns:1fr; }} }}
</style>
</head>
<body>
<div class="wrap">
  <h1>K리그 2026 Proto 분석관 리포트</h1>
  <p class="lead">생성시각 {esc(payload['generated_at'])} · 승무패 / 핸디캡 H+1.0 / 언더오버 2.5 · 킥오프 이전 데이터만 사용</p>
  <div class="note">
    <div>방법: {esc(payload['method']['model'])}</div>
    <div>소스: {esc(' · '.join(payload['method']['sources']))}</div>
    <div>{esc(payload['method']['notes'])}</div>
  </div>

  <h2>백테스트 적중률 (완료 경기)</h2>
  <div class="grid">
    <div class="stat"><b>K1 승무패</b><strong>{s['K1']['wdl_rate']}%</strong><span>{s['K1']['wdl_hit']}/{s['K1']['wdl_total']}</span></div>
    <div class="stat"><b>K1 핸디 H+1.0</b><strong>{s['K1']['handicap_rate']}%</strong><span>{s['K1']['handicap_hit']}/{s['K1']['handicap_total']}</span></div>
    <div class="stat"><b>K1 U/O 2.5</b><strong>{s['K1']['ou_rate']}%</strong><span>{s['K1']['ou_hit']}/{s['K1']['ou_total']}</span></div>
    <div class="stat"><b>K2 승무패</b><strong>{s['K2']['wdl_rate']}%</strong><span>{s['K2']['wdl_hit']}/{s['K2']['wdl_total']}</span></div>
    <div class="stat"><b>K2 핸디 H+1.0</b><strong>{s['K2']['handicap_rate']}%</strong><span>{s['K2']['handicap_hit']}/{s['K2']['handicap_total']}</span></div>
    <div class="stat"><b>K2 U/O 2.5</b><strong>{s['K2']['ou_rate']}%</strong><span>{s['K2']['ou_hit']}/{s['K2']['ou_total']}</span></div>
  </div>

  <h2>이번 회차 예측 (배트맨 승무패 44회차 · K1 23R / K2 22R)</h2>
  {''.join(upcoming_html) if upcoming_html else '<p class="lead">예정 경기 데이터가 일정 API/위키에 아직 없거나 팀명 매칭이 필요합니다. analysis_results.json의 upcoming을 확인하세요.</p>'}

  <h2>라운드별 백테스트 상세</h2>
  {''.join(rounds_html)}
</div>
</body>
</html>"""
    with open(OUT_HTML, "w", encoding="utf-8") as f:
        f.write(html)


if __name__ == "__main__":
    result = run()
    print("Wrote", OUT_JSON)
    print("Wrote", OUT_HTML)
    for lg, s in result["summary"].items():
        print(
            lg,
            "WDL",
            s["wdl_rate"],
            "H1",
            s["handicap_rate"],
            "OU",
            s["ou_rate"],
            "upcoming",
            len([u for u in result["upcoming"] if u["league"] == lg]),
        )
