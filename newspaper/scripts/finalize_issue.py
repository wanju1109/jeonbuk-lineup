"""편집장(Claude 루틴)이 쓴 초고 JSON을 검사하고 발행 파일로 만든다.

- 블록 형식, span, 사진 키를 검사한다. 빠진 필드는 null로 채운다.
- build_context.py가 계산한 기록(data)과 사용한 사진 정보(assets)를 붙여
  newspaper/issues/{no}.json 을 쓰고 issues/index.json 을 갱신한다.

usage: python newspaper/scripts/finalize_issue.py --context ctx.json --draft draft.json [--check]
종료 코드 1 = 고쳐야 할 문제가 있음 (메시지를 보고 초고를 고친 뒤 다시 실행)
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
NP = ROOT / "newspaper"

BLOCK_TYPES = {"hero", "article", "photo", "cutout", "figs", "list", "timeline", "signal", "talk", "quiz", "table", "quote", "box", "bars", "chart", "index"}
BLOCK_FIELDS = ("type", "span", "rule_top", "variant", "kicker", "title", "dek", "byline", "paragraphs", "image", "caption", "big", "chart", "items")
ITEM_FIELDS = ("tag", "title", "text", "label", "date", "state", "source_name", "source_url", "value")
CHARTS = {"standings", "next", "form", "scoreboard", "goal_timeline", "shotmap", "compare"}
MATCH_CHARTS = {"scoreboard", "goal_timeline", "shotmap", "compare"}
BANNED = ["jeonbuk-lineup", "—"]


def check(issue: dict, ctx: dict, lib: dict) -> list[str]:
    errs: list[str] = []
    for k in ("headline", "summary", "strip", "pages"):
        if k not in issue:
            errs.append(f"issue.{k} 없음")
    if errs:
        return errs
    if len(issue["headline"]) > 40:
        errs.append(f"headline이 너무 깁니다({len(issue['headline'])}자, 40자 이내)")
    if not 4 <= len(issue["pages"]) <= 8:
        errs.append(f"면 수 {len(issue['pages'])} (4~8면)")
    text = json.dumps(issue, ensure_ascii=False)
    for w in BANNED:
        if w in text:
            errs.append(f"쓰면 안 되는 표현이 있습니다: {w!r}")
    known = set(lib) | set(ctx["assets"])
    has_last = bool(ctx["data"].get("last"))
    for pi, page in enumerate(issue["pages"], 1):
        for k in ("tab", "teaser", "folio", "blocks"):
            if k not in page:
                errs.append(f"{pi}면: {k} 없음")
        photos = 0
        for bi, b in enumerate(page.get("blocks", []), 1):
            where = f"{pi}면 {bi}번째 블록({b.get('type')})"
            if b.get("type") not in BLOCK_TYPES:
                errs.append(f"{where}: 알 수 없는 type")
            if b.get("span", 12) not in (12, 8, 7, 6, 5, 4):
                errs.append(f"{where}: span은 12/8/7/6/5/4")
            img = b.get("image")
            if img:
                if img not in known:
                    errs.append(f"{where}: 사진 키 {img!r}가 목록에 없습니다")
                else:
                    photos += 1
            if b.get("type") in ("hero", "photo", "cutout") and not img:
                errs.append(f"{where}: image가 필요합니다")
            if b.get("type") == "chart":
                if b.get("chart") not in CHARTS:
                    errs.append(f"{where}: chart는 {sorted(CHARTS)} 중 하나")
                elif b["chart"] in MATCH_CHARTS and not has_last:
                    errs.append(f"{where}: 지난 경기 기록이 없어 {b['chart']}를 쓸 수 없습니다")
            for it in b.get("items") or []:
                u = it.get("source_url")
                if u and not re.match(r"^https?://", u):
                    errs.append(f"{where}: source_url이 주소 형식이 아닙니다: {u}")
        if photos == 0 and pi < len(issue["pages"]):  # 마지막 루머 데스크 면은 사진 없이도 된다
            errs.append(f"{pi}면: 사진이 없습니다(면마다 1개 이상)")
    first = issue["pages"][0].get("blocks", []) if issue["pages"] else []
    if not first or first[0].get("type") != "hero":
        errs.append("1면 첫 블록은 hero여야 합니다")
    return errs


def normalize(issue: dict) -> None:
    for page in issue["pages"]:
        for b in page["blocks"]:
            for f in BLOCK_FIELDS:
                b.setdefault(f, None)
            b["span"] = b["span"] or 12
            b["rule_top"] = bool(b["rule_top"])
            for it in b["items"] or []:
                for f in ITEM_FIELDS:
                    it.setdefault(f, None)


def finalize(ctx: dict, issue: dict, lib: dict) -> Path:
    used = {}
    for page in issue["pages"]:
        for b in page["blocks"]:
            if b.get("image") and b["image"] not in lib:
                used[b["image"]] = ctx["assets"][b["image"]]
    data = copy.deepcopy(ctx["data"])
    if data.get("last"):
        data["last"].pop("lineup", None)
        data["last"].pop("players", None)
        data["last"]["shots"] = [s[:6] for s in data["last"].get("shots", [])]
    out = {"no": ctx["no"], "date": ctx["date"], "matchday_after": ctx["matchday_after"], **issue, "assets": used, "data": data}
    path = NP / "issues" / f"{ctx['no']}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

    idx_path = NP / "issues" / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"issues": []}
    idx["issues"] = [i for i in idx["issues"] if i["no"] != ctx["no"]] + [{"no": ctx["no"], "date": ctx["date"], "headline": issue["headline"]}]
    idx["issues"].sort(key=lambda i: i["no"])
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=1), encoding="utf-8")
    return path


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--context", required=True)
    ap.add_argument("--draft", required=True)
    ap.add_argument("--check", action="store_true", help="검사만 하고 저장하지 않는다")
    args = ap.parse_args()
    ctx = json.loads(Path(args.context).read_text(encoding="utf-8"))
    try:
        issue = json.loads(Path(args.draft).read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        sys.exit(f"초고 JSON 문법 오류: {e}")
    lib = json.loads((NP / "img" / "library.json").read_text(encoding="utf-8"))["images"]
    errs = check(issue, ctx, lib)
    if errs:
        print("고칠 것:\n- " + "\n- ".join(errs))
        sys.exit(1)
    normalize(issue)
    if args.check:
        print("검사 통과")
        return
    path = finalize(ctx, issue, lib)
    print(f"완성: {path.relative_to(ROOT)} · 제{ctx['no']}호 · {issue['headline']} · {len(issue['pages'])}면")


if __name__ == "__main__":
    main()
