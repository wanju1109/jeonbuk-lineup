"""검수표. 초고에서 '사실 확인이 필요한 문장'을 기계적으로 뽑고, 검수자가 채운 결과를 검사한다.

무엇을 확인할지는 글 쓴 사람이 아니라 이 스크립트가 정한다(사진 설명, 제목, 처음·최초·연속 같은 기록 주장,
소속·경력, 수상·부상, 일정·장소, 등급표의 공식·보도 항목). 검수자는 각 줄의 출처를 다시 열어 대조하고
grade·source·verdict를 채운다. finalize_issue.py는 채워지지 않은 줄이 하나라도 있으면 발행하지 않는다.

usage: python newspaper/scripts/review.py --context ctx.json --draft draft.json --out review.json
  이미 review.json이 있으면 문장이 그대로인 줄은 채운 내용을 유지하고, 바뀐 문장만 새 줄로 만든다.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
NP = ROOT / "newspaper"

# 이 표현이 들어간 문장은 반드시 검수한다
RISK = {
    "기록·처음": r"최초|사상|역대|처음|첫\s?(?:우승|승|골|출전|선발|경기|결승|도전)|데뷔|\d+\s?년 만|연속|연패|최다|최소|최연소|최고령|유일|신기록|통산|디펜딩",
    "소속·경력": r"N팀|B팀|K3|K4|K리그2|클럽하우스|보조경기장|우선지명|준프로|임대|이적|계약|영입|입단|은퇴|출신|거쳤|거친|홈구장|홈경기",
    "수상·징계·부상": r"수상|상을 받|MVP|영플레이어|득점상|수비상|지도자상|이달의|징계|퇴장|부상|결장|복귀|소집",
    "일정·장소": r"킥오프|\d{1,2}:\d{2}|오[전후]\s?\d{1,2}시|경기장에서|구장에서|에서 열린|에서 열렸|에서 치른|중계",
}
RISK_RE = {k: re.compile(v) for k, v in RISK.items()}

GRADES = ("공식", "기록", "보도", "사진정보", "의견")
# 의견(조간의 평가·전망·질문)으로 넘길 수 없는 것
NO_OPINION_KINDS = {"사진설명", "등급표", "경과"}
NO_OPINION_RISKS = {"기록·처음", "일정·장소"}
SKIP_TAGS = {"설", "바람", "BEST", "WORST"}


def load_facts() -> dict:
    return json.loads((NP / "facts.json").read_text(encoding="utf-8"))


def host(url: str) -> str:
    return (urlparse(url or "").hostname or "").lower()


def host_in(url: str, hosts: list[str]) -> bool:
    h = host(url)
    return any(h == x or h.endswith("." + x) for x in hosts)


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.?!])\s+", text or "") if s.strip()]


def risks(text: str) -> list[str]:
    return [k for k, rx in RISK_RE.items() if rx.search(text)]


def rid(text: str) -> str:
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]


def is_sources_box(b: dict) -> bool:
    return b.get("type") == "box" and "출처" in f"{b.get('kicker') or ''}{b.get('title') or ''}"


def is_correction(b: dict) -> bool:
    return "바로잡습니다" in (b.get("kicker") or "")


def units(issue: dict, lib: dict, assets: dict) -> list[dict]:
    """초고에서 검수 대상 줄을 뽑는다. 같은 문장은 한 번만."""
    rows: list[dict] = []
    seen: set[str] = set()

    def add(text, where, kind, must=False, ref=None):
        text = (text or "").strip()
        if len(text) < 4:
            return
        r = risks(text)
        if not (must or r):
            return
        i = rid(text)
        if i in seen:
            return
        seen.add(i)
        rows.append({"id": i, "where": where, "kind": kind, "risk": r, "text": text, **({"ref": ref} if ref else {}),
                     "grade": "", "source_name": "", "source_url": "", "verdict": "", "memo": ""})

    add(issue.get("headline"), "1면 제목(headline)", "제목", must=True)
    add(issue.get("summary"), "요약(summary)", "제목", must=True)
    for s in issue.get("strip") or []:
        add(s, "띠(strip)", "제목", must=True)

    for pi, page in enumerate(issue.get("pages") or [], 1):
        for b in page.get("blocks") or []:
            t = b.get("type")
            where = f"{pi}면 {t}" + (f" '{(b.get('title') or '')[:14]}'" if b.get("title") else "")
            if t in ("talk", "index", "chart") or is_sources_box(b):
                continue
            img = b.get("image")
            if img and b.get("caption"):
                info = lib.get(img) or assets.get(img) or {}
                ref = {"image": img, "desc": info.get("desc") or info.get("alt") or info.get("name") or "", **({"note": info["note"]} if info.get("note") else {})}
                add(b["caption"], where + " 사진 설명", "사진설명", must=True, ref=ref)
            elif b.get("caption"):
                add(b["caption"], where + " 설명", "본문")
            if t == "hero":
                add(" / ".join(x for x in (b.get("title"), b.get("dek")) if x), where, "제목", must=True)
            else:
                for f in ("title", "dek", "big"):
                    add(b.get(f), where, "본문")
            for para in b.get("paragraphs") or []:
                for s in sentences(para):
                    add(s, where, "본문")
            for it in b.get("items") or []:
                ref = {"source_name": it.get("source_name"), "source_url": it.get("source_url")} if it.get("source_url") else None
                if t == "list":
                    if (it.get("tag") or "") in SKIP_TAGS:
                        continue
                    add(f"[{it.get('tag') or ''}] {it.get('title') or ''} · {it.get('text') or ''}", where, "등급표", must=True, ref=ref)
                elif t == "timeline":
                    add(f"{it.get('date') or ''} {it.get('title') or ''} · {it.get('text') or ''}", where, "경과", must=True, ref=ref)
                elif t == "quiz":
                    add(f"Q. {it.get('title') or ''} / A. {it.get('text') or ''}", where, "본문")
                else:
                    bits = [it.get(k) for k in ("label", "value", "title", "text")]
                    add(" · ".join(str(x) for x in bits if x not in (None, "")), where, "본문", ref=ref)
    return rows


def merge(rows: list[dict], old: list[dict]) -> list[dict]:
    """문장이 그대로인 줄은 이전에 채운 내용을 유지한다."""
    done = {r["id"]: r for r in old}
    for r in rows:
        o = done.get(r["id"])
        if o:
            for f in ("grade", "source_name", "source_url", "verdict", "memo"):
                r[f] = o.get(f) or ""
    return rows


def check_rows(need: list[dict], filled: list[dict], facts: dict) -> list[str]:
    """검수표가 다 채워졌는지, 출처가 등급에 맞는지 본다."""
    errs: list[str] = []
    got = {r.get("id"): r for r in filled}
    for n in need:
        r = got.get(n["id"])
        head = f"검수 {n['where']}: “{n['text'][:46]}”"
        if not r or not (r.get("grade") and r.get("verdict")):
            errs.append(f"{head} 검수 안 됨(검수표를 다시 만들어 이 줄을 채우세요)")
            continue
        g, url = r.get("grade"), (r.get("source_url") or "").strip()
        if r.get("verdict") != "일치":
            errs.append(f"{head} verdict가 '일치'가 아닙니다. 초고를 고치거나 지운 뒤 검수표를 다시 만드세요")
            continue
        if g not in GRADES:
            errs.append(f"{head} grade는 {'/'.join(GRADES)} 중 하나")
        elif g == "공식":
            if not host_in(url, facts["official_hosts"]):
                errs.append(f"{head} '공식'은 구단·연맹·협회 페이지 주소가 있어야 합니다({', '.join(facts['official_hosts'][:4])} …). 언론 기사면 '보도'")
        elif g == "보도":
            if not re.match(r"^https?://", url):
                errs.append(f"{head} '보도'는 기사 주소(source_url)가 필요합니다")
            elif host_in(url, facts["community_hosts"]):
                errs.append(f"{head} 커뮤니티·위키는 사실 확인 근거가 될 수 없습니다. 공식 자료나 기사로 확인하거나 문장을 지우세요")
        elif g == "기록":
            if len((r.get("memo") or "").strip()) < 4:
                errs.append(f"{head} '기록'은 memo에 ctx의 어느 값인지 적습니다(예: data.standings 5위 49점)")
        elif g == "사진정보":
            if n["kind"] != "사진설명":
                errs.append(f"{head} '사진정보'는 사진 설명에만 씁니다")
            elif len(sentences(n["text"])) > 1 or n["risk"]:
                # 사진에 찍힌 것 말고 덧붙인 말이 있다. 지금까지의 오보가 여기서 나왔다
                errs.append(f"{head} 사진 설명에 사진 정보 말고 덧붙인 내용이 있습니다. 그 내용의 출처로 grade를 공식/보도/기록으로 채우거나 덧붙인 말을 지우세요")
        elif g == "의견":
            if n["kind"] in NO_OPINION_KINDS or set(n["risk"]) & NO_OPINION_RISKS:
                errs.append(f"{head} 이 줄은 '의견'으로 넘길 수 없습니다. 출처로 확인하거나 문장을 고치세요")
    return errs


def summary(need: list[dict], filled: list[dict]) -> str:
    got = {r.get("id"): r for r in filled}
    count: dict[str, int] = {}
    for n in need:
        g = (got.get(n["id"]) or {}).get("grade") or "미검수"
        count[g] = count.get(g, 0) + 1
    return f"검수 {len(need)}건: " + " · ".join(f"{k} {v}" for k, v in sorted(count.items()))


def related_facts(issue: dict, facts: dict) -> list[dict]:
    text = json.dumps(issue, ensure_ascii=False)
    return [f for f in facts["facts"] if any(t in text for t in f["topic"])]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--context", required=True)
    ap.add_argument("--draft", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    ctx = json.loads(Path(args.context).read_text(encoding="utf-8"))
    issue = json.loads(Path(args.draft).read_text(encoding="utf-8"))
    lib = json.loads((NP / "img" / "library.json").read_text(encoding="utf-8"))["images"]
    facts = load_facts()
    out = Path(args.out)
    old = json.loads(out.read_text(encoding="utf-8"))["rows"] if out.exists() else []
    rows = merge(units(issue, lib, ctx.get("assets", {})), old)
    out.write_text(json.dumps({"no": ctx.get("no"), "date": ctx.get("date"), "rows": rows}, ensure_ascii=False, indent=1), encoding="utf-8")
    todo = [r for r in rows if not (r["grade"] and r["verdict"])]
    print(f"검수표: {out} · 전체 {len(rows)}줄 · 채울 줄 {len(todo)}")
    for r in todo:
        print(f"- [{r['id']}] {r['where']} ({r['kind']}{', ' + '/'.join(r['risk']) if r['risk'] else ''}): {r['text'][:70]}")
    rel = related_facts(issue, facts)
    if rel:
        print("\n사실표(newspaper/facts.json)에서 이 초고와 관련된 확인된 사실. 초고가 이것과 다르면 초고가 틀린 것이다:")
        today = ctx.get("date") or ""
        for f in rel:
            stale = " ※ 재확인 날짜가 지났으니 출처를 다시 열어 확인" if today and f.get("recheck") and today > f["recheck"] else ""
            print(f"- {f['fact']} ({f['source_name']}, {f['verified']} 확인){stale}")
    if todo:
        sys.exit(2)


if __name__ == "__main__":
    main()
