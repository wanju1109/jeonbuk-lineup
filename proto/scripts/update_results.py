#!/usr/bin/env python3
"""Fill finished scores into proto/data/league.json and recompute hit rates.

Picks stay as generated. This script only applies official K League scores
to unfinished fixtures and rebuilds summary / current_round.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PROTO_DATA = ROOT / "proto" / "data" / "league.json"
C_REPORT_SCRIPTS = ROOT / "c_report" / "scripts"
YEAR = os.environ.get("KLEAGUE_YEAR") or str(datetime.now().year)
KST = timezone(timedelta(hours=9))

MEETS = (
    ("K1", os.environ.get("KLEAGUE_MEET_K1") or "1"),
    ("K2", os.environ.get("KLEAGUE_MEET_K2") or "2"),
)

MARKETS = ("wdl", "h_p1", "h_p2", "h_m1", "h_m2", "ou25", "ou35")

# Longest aliases first so 수원삼성 / 서울이랜드 win over 수원 / 서울.
ALIASES = (
    "수원삼성",
    "수원fc",
    "서울이랜드",
    "부산아이파크",
    "충남아산",
    "충북청주",
    "전남",
    "김포",
    "경남",
    "성남",
    "안산",
    "천안",
    "화성",
    "김천",
    "포항",
    "울산",
    "전북",
    "인천",
    "대전",
    "부천",
    "광주",
    "강원",
    "제주",
    "안양",
    "서울",
)


def now_kst() -> datetime:
    return datetime.now(KST)


def key_team(name: str) -> str:
    n = re.sub(r"\s+", "", str(name or "")).lower()
    n = n.replace("서울e", "서울이랜드")
    n = n.replace("유나이티드", "").replace("united", "")
    n = n.replace("하나시티즌", "하나").replace("시티즌", "")
    n = n.replace("skfc", "sk")
    n = n.replace("fc1995", "").replace("1995", "").replace("2008", "")
    n = n.replace("스틸러스", "").replace("아이파크", "")
    n = n.replace("드래곤즈", "").replace("블루윙즈", "")
    n = n.replace("상무", "").replace("현대", "")
    n = n.replace("그리너스", "")
    if n.startswith("fc"):
        n = n[2:]
    if n == "수원fc" or n.startswith("수원fc"):
        return "수원fc"
    if n.endswith("fc"):
        n = n[:-2]
    if n in ("수원", "수원삼성") or n.startswith("수원삼성") or "블루윙" in n:
        return "수원삼성"
    if "이랜드" in n:
        return "서울이랜드"
    if n in ("아산", "충남아산"):
        return "충남아산"
    if "파주" in n:
        return "파주"
    if "용인" in n:
        return "용인"
    if "김해" in n:
        return "김해"
    if "대구" in n:
        return "대구"
    for alias in ALIASES:
        if alias in n:
            return alias
    return n


def actuals(home: int, away: int) -> dict[str, str]:
    if home > away:
        wdl = "승"
    elif home < away:
        wdl = "패"
    else:
        wdl = "무"

    def hd(line: int) -> str:
        adj = home + line
        if adj > away:
            return "승"
        if adj < away:
            return "패"
        return "무"

    total = home + away
    return {
        "wdl": wdl,
        "h_p1": hd(1),
        "h_p2": hd(2),
        "h_m1": hd(-1),
        "h_m2": hd(-2),
        "ou25": "오버" if total > 2.5 else "언더",
        "ou35": "오버" if total > 3.5 else "언더",
    }


def hits_for(match: dict, act: dict[str, str]) -> dict[str, bool]:
    picks = match.get("picks") or {}
    out: dict[str, bool] = {}
    for key in MARKETS:
        pick = ((picks.get(key) or {}).get("pick")) if isinstance(picks.get(key), dict) else None
        out[key] = bool(pick) and pick == act.get(key)
    return out


def pct(hit: int, total: int) -> float:
    if total <= 0:
        return 0.0
    return round(100.0 * hit / total, 2)


def rebuild_summary(matches: list[dict]) -> dict:
    summary: dict[str, dict] = {}
    for lg in ("K1", "K2"):
        rows = [m for m in matches if m.get("league") == lg and m.get("finished")]
        raw = {k: [0, 0] for k in MARKETS}
        by_round: dict[str, dict] = {}
        for m in rows:
            act = m.get("actual") or {}
            hit = m.get("hit") or {}
            rnd = str(m.get("round"))
            if rnd not in by_round:
                by_round[rnd] = {
                    "wdl_rate": 0.0,
                    "handicap_rate": 0.0,
                    "ou_rate": 0.0,
                    "rates": {k: 0.0 for k in MARKETS},
                    "raw": {k: [0, 0] for k in MARKETS},
                }
            for key in MARKETS:
                if act.get(key) is None:
                    continue
                raw[key][1] += 1
                by_round[rnd]["raw"][key][1] += 1
                if hit.get(key):
                    raw[key][0] += 1
                    by_round[rnd]["raw"][key][0] += 1
        for rnd, block in by_round.items():
            rates = {}
            for key in MARKETS:
                h, t = block["raw"][key]
                rates[key] = pct(h, t)
            block["rates"] = rates
            block["wdl_rate"] = rates["wdl"]
            block["handicap_rate"] = rates["h_p1"]
            block["ou_rate"] = rates["ou25"]
        hits = {}
        for key in MARKETS:
            h, t = raw[key]
            hits[key] = {"hit": h, "total": t, "rate": pct(h, t)}
        summary[lg] = {
            "wdl_hit": hits["wdl"]["hit"],
            "wdl_total": hits["wdl"]["total"],
            "wdl_rate": hits["wdl"]["rate"],
            "handicap_hit": hits["h_p1"]["hit"],
            "handicap_total": hits["h_p1"]["total"],
            "handicap_rate": hits["h_p1"]["rate"],
            "ou_hit": hits["ou25"]["hit"],
            "ou_total": hits["ou25"]["total"],
            "ou_rate": hits["ou25"]["rate"],
            "rates": {k: hits[k]["rate"] for k in MARKETS},
            "hits": hits,
            "by_round": dict(sorted(by_round.items(), key=lambda kv: int(kv[0]))),
        }
    return summary


def current_rounds(matches: list[dict]) -> dict[str, int]:
    out: dict[str, int] = {}
    for lg in ("K1", "K2"):
        by_r: dict[int, list[dict]] = {}
        for m in matches:
            if m.get("league") != lg:
                continue
            try:
                rnd = int(m.get("round"))
            except (TypeError, ValueError):
                continue
            by_r.setdefault(rnd, []).append(m)
        if not by_r:
            out[lg] = 1
            continue
        chosen = max(by_r)
        for rnd in sorted(by_r):
            rows = by_r[rnd]
            if not all(r.get("finished") for r in rows):
                chosen = rnd
                break
        out[lg] = chosen
    return out


def load_league() -> dict:
    if not PROTO_DATA.exists():
        raise FileNotFoundError(f"missing {PROTO_DATA}")
    try:
        return json.loads(PROTO_DATA.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"league.json parse failed: {exc}") from exc


def save_league(data: dict) -> None:
    PROTO_DATA.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2)
    PROTO_DATA.write_text(text + "\n", encoding="utf-8")


def import_portal():
    sys.path.insert(0, str(C_REPORT_SCRIPTS))
    try:
        from collect_chalkboard import (  # noqa: WPS433
            MAIN_FRAME,
            PortalClient,
            fetch_matches,
            parse_official_score,
        )
    except ImportError as exc:
        raise RuntimeError(f"cannot import portal helpers: {exc}") from exc
    return PortalClient, fetch_matches, parse_official_score, MAIN_FRAME


def fetch_official(
    client,
    parse_official_score,
    main_frame: str,
    year: str,
    meet_seq: str,
    round_id: str,
    game_id: str,
) -> tuple[int, int] | None:
    try:
        html = client.request(
            main_frame,
            data={
                "meetYear": year,
                "meetSeq": meet_seq,
                "roundId": round_id,
                "gameId": game_id,
                "selectedMenuCd": "0302",
            },
        )
    except Exception as exc:
        print(f"[WARN] score fetch failed game={game_id}: {exc}")
        return None
    return parse_official_score(html)


def apply_scores(data: dict, scores: dict) -> int:
    updated = 0
    for match in data.get("matches") or []:
        if match.get("finished") and match.get("score"):
            continue
        lg = match.get("league")
        try:
            rnd = int(match.get("round"))
        except (TypeError, ValueError):
            continue
        key = (lg, key_team(match.get("home") or ""), key_team(match.get("away") or ""), rnd)
        score = scores.get(key)
        if not score:
            continue
        hs, aws = score
        act = actuals(hs, aws)
        match["finished"] = True
        match["score"] = [hs, aws]
        match["actual"] = act
        match["hit"] = hits_for(match, act)
        updated += 1
        print(
            f"[APPLY] {lg} R{rnd} {match.get('home')} {hs}:{aws} {match.get('away')} "
            f"wdl={act['wdl']}"
        )
    return updated


def main() -> int:
    data = load_league()
    pending = [m for m in data.get("matches") or [] if not m.get("finished")]
    print(f"[INFO] league.json pending={len(pending)}")
    if not pending:
        print("[DONE] nothing to update")
        return 0

    PortalClient, fetch_matches, parse_official_score, MAIN_FRAME = import_portal()
    client = PortalClient()
    try:
        client.login_guest()
    except Exception as exc:
        print(f"[ERR] portal login failed: {exc}")
        return 1

    # Only hit the portal for rounds that still have unfinished proto matches.
    needed: dict[str, set[int]] = {"K1": set(), "K2": set()}
    for m in pending:
        lg = m.get("league")
        if lg in needed:
            try:
                needed[lg].add(int(m.get("round")))
            except (TypeError, ValueError):
                pass

    scores: dict[tuple, tuple[int, int]] = {}
    for league, meet_seq in MEETS:
        rounds_needed = sorted(needed.get(league) or [])
        if not rounds_needed:
            continue
        print(f"[INFO] fetching {league} rounds {rounds_needed}")
        for rid in rounds_needed:
            try:
                rows = fetch_matches(client, YEAR, meet_seq, str(rid))
            except Exception as exc:
                print(f"[WARN] {league} R{rid} list failed: {exc}")
                continue
            for row in rows:
                home = row.get("home") or ""
                away = row.get("away") or ""
                gid = str(row.get("game_id") or "")
                end_yn = str(row.get("end_yn") or "N").upper()
                if not gid:
                    continue
                score = fetch_official(
                    client,
                    parse_official_score,
                    MAIN_FRAME,
                    YEAR,
                    meet_seq,
                    str(rid),
                    gid,
                )
                time.sleep(0.12)
                if score is None:
                    continue
                hs, aws = score
                if end_yn != "Y" and hs == 0 and aws == 0:
                    continue
                scores[(league, key_team(home), key_team(away), int(rid))] = (hs, aws)
                print(f"[OK] {league} R{rid} {home} {hs}:{aws} {away} end={end_yn}")
            time.sleep(0.08)

    print(f"[INFO] portal scores={len(scores)}")
    updated = apply_scores(data, scores)
    leftover = []
    for match in data.get("matches") or []:
        if match.get("finished"):
            continue
        leftover.append(
            f"{match.get('league')} R{match.get('round')} "
            f"{key_team(match.get('home') or '')} vs {key_team(match.get('away') or '')} "
            f"({match.get('home')} / {match.get('away')})"
        )
    for line in leftover:
        print("[PENDING] " + line)
    data["summary"] = rebuild_summary(data.get("matches") or [])
    data["current_round"] = current_rounds(data.get("matches") or [])
    data["generated_at"] = now_kst().strftime("%Y-%m-%d %H:%M:%S")
    try:
        save_league(data)
    except OSError as exc:
        print(f"[ERR] write failed: {exc}")
        return 1
    print(
        f"[DONE] updated={updated} current_round={data['current_round']} "
        f"path={PROTO_DATA}"
    )
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as exc:
        print(f"[ERR] {exc}")
        sys.exit(1)
