"""전주성 조간 한 호를 만든다.

1단계(취재): Claude가 웹 검색으로 지난 하루 전북현대 뉴스·루머·커뮤니티 반응을 모은다.
2단계(편집): 취재 메모와 build_context.py가 계산한 기록으로 신문 JSON을 쓴다(구조화 출력).
결과: newspaper/issues/{no}.json, newspaper/issues/index.json 갱신.

환경변수: ANTHROPIC_API_KEY
usage: python newspaper/scripts/generate_issue.py --context PATH
"""

from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import anthropic

ROOT = Path(__file__).resolve().parents[2]
NP = ROOT / "newspaper"
MODEL = "claude-opus-5-5"
BETAS = ["server-side-fallback-2026-07-01"]

VOICE = """당신은 전북현대 팬 신문 '전주성 조간'의 편집장이자 기자다. 독자는 전북현대 팬 전체다.

문체
- 스포츠 신문 기자 문체로 쓴다. 문장은 '~했다', '~이다'로 끝낸다. 짧고 단단한 문장.
- 첫 문장에 가장 새롭고 구체적인 사실을 둔다. 숫자, 이름, 장소를 쓴다.
- 팬의 눈높이로 재미있게 쓰되 사실은 정확해야 한다. 과장, 감탄사 남발, 이모지 금지.
- 다음 표현은 쓰지 않는다: 줄표(—)로 끼워 넣는 말, "A가 아니라 B" 식의 대구, 콜론 뒤에 반전을 두는 문장, "주목할 만하다", "귀추가 주목된다", "~라고 할 수 있다", "한편", "이처럼".
- 제목은 신문 제목처럼 짧고 세게. 작은따옴표 인용 제목도 좋다.

사실 규칙
- 순위, 승점, 경기 기록 숫자는 제공된 data의 값만 쓴다. 웹에서 본 숫자와 다르면 data를 따른다.
- 뉴스는 반드시 출처(매체명, URL)를 단다. 출처 없는 이야기는 루머 데스크에서 '설'로만 다룬다.
- 루머 등급: 공식(구단·연맹 발표) / 보도(언론 기사) / 설(커뮤니티, 출처 불명) / 바람(팬의 희망).
- 커뮤니티 글은 닉네임을 쓰지 않고 흐름을 요약한다. 원문을 길게 옮기지 않는다.
- 기사 원문 문장을 그대로 옮기지 않는다. 직접 인용은 한 호에 2개 이하, 각 15단어 이하.
- 모르는 것은 쓰지 않는다. 일정·시간이 불확실하면 '확인 필요'라고 쓴다.
- 'jeonbuk-lineup'이라는 이름은 신문 어디에도 쓰지 않는다. 기록 출처는 'K리그 데이터포털'로만 적는다.
"""

RESEARCH_TASK = """오늘은 {date}({weekday}) 아침이고, 전주성 조간 제{no}호를 만든다.
지난 약 30시간 동안 전북현대와 관련해 나온 소식을 취재해 메모로 정리하라.

찾을 것
1. 언론 기사: 경기 결과·리뷰, 선수단 소식(부상, 복귀, 징계, 인터뷰), 감독·구단 소식, 이적설, 일정·티켓, 경기장, 구단 행사.
2. 루머: 감독 교체설, 이적설 등. 아래 루머 게시판 네 곳을 기본으로 본다(목록은 아래에 미리 읽어 두었다. 필요하면 web_fetch로 더 본다).
   - 추꾸 국내축구 루머 https://www.chuggu.net/football_k/category/52158
   - 에펨코리아 국내축구 루머 https://www.fmkorea.com/index.php?mid=football_korean&category=108791244
   - 에버그린 루머 https://evergreenjb.me/free/category/212 (회원 전용)
   - 루리웹 축구게시판 루머 https://bbs.ruliweb.com/sports/board/300254?cate=361
   전북과 관련된 글은 다른 커뮤니티나 기사로 교차 확인을 시도하고, 확인되면 등급을 올린다.
3. 다음 경기 상대의 최근 상황(순위, 부상자, 감독 발언).
4. {matchday}

아래 '커뮤니티'는 오늘 아침 직접 읽어 온 글 제목과 일부 본문이다(회원 전용 글은 내용 요약만 쓸 것).

메모 형식: 항목마다 [분류] 한 줄 요약 / 핵심 사실(숫자·날짜·인물) / 출처 매체·URL / 신뢰도(공식·보도·설·바람).
마지막에 '오늘의 톱 후보' 3개를 이유와 함께 적는다. 신문 본문은 아직 쓰지 않는다.

[기록 요약]
{facts}

[커뮤니티]
{board}
"""

WRITE_TASK = """취재 메모와 기록 데이터로 전주성 조간 제{no}호({date} {weekday}요일)를 JSON으로 편집하라.

분량과 구성
- {edition}
- 1면: 첫 블록은 hero(가장 큰 뉴스, 사진 필수). 이어서 리드 기사 article(span 8, variant "lead", byline "전주성 조간 편집부"), 그 옆 span 4에 index 블록과 figs(오늘의 숫자 4개).
- 면마다 블록 span 합이 12의 배수가 되게 배치한다(12, 8+4, 7+5, 6+6). 둘째 줄부터는 rule_top true.
- 사진을 아끼지 말 것. 면마다 사진(hero/photo/cutout/article.image) 1개 이상. 선수는 cutout이 가장 보기 좋다.
- 마지막 면은 '루머 데스크': list(루머 등급표, tag는 공식/보도/설/바람), talk(커뮤니티 온도 4~5개), quiz(3문항).
- 마지막 면 맨 끝에 box 블록(span 12)으로 출처 모음(items에 매체명과 URL).

블록 쓰는 법 (type별로 쓰는 필드, 안 쓰는 필드는 null)
- hero: image, kicker, title, dek, caption
- article: kicker, title, dek, byline, paragraphs(3~6문단), image(선택), caption, variant("lead"|"green"|null)
- photo: image, caption
- cutout: image(player: 키), big(큰 숫자나 짧은 말, 6자 이내), paragraphs(2~3줄, 각 20자 이내), caption
- figs: title(선택), items[{{value, label}}]
- list: kicker, title, items[{{tag, title, text, source_name, source_url}}]
- timeline: kicker, title, items[{{date, title, text, state("hot"|null), source_name, source_url}}]
- signal: title, items[{{state("yes"|"no"|"maybe"), title, text}}], big(판정 한 줄)
- talk: title, items[{{text, label}}]
- quiz: title, items[{{title(질문), text(답)}}]
- table: title, items[{{label, value}}]
- quote: title(인용문), byline(누가, 언제)
- box: kicker, title, paragraphs 또는 items[{{title, text, source_name, source_url}}], variant("dark"|"lime"|null)
- bars: title, items[{{label, value(숫자), text(표시값), state("hot"|"green"|null)}}], caption
- chart: title, chart 중 하나 — "standings"(순위), "next"(다음 경기 대진), "form"(최근 폼), {charts}
- index: 1면 목차(자동). 다른 필드 null.
- 각 page에는 tab(탭 이름 6자 안팎), teaser(1면 목차에 들어갈 한 줄), folio(오른쪽 머리글)를 쓴다.

사진 키 (image에는 아래 키만 쓴다)
- 자료 사진: {library}
- 선수·감독: {catalog}

issue 필드: headline(에버그린 게시글 제목에 쓸 1면 제목, 30자 이내), summary(한 줄 요약), strip(제호 아래 띠 3개, 예: "K리그1 3위 · 승점 47"), pages.

[문체 예시: 시제품 제0호 일부]
{example}

[기록 데이터]
{facts}

[취재 메모]
{notes}
"""


# ---------------- 구조화 출력 스키마 ----------------
def nullable(t: str | dict) -> dict:
    if isinstance(t, dict):
        return {"anyOf": [t, {"type": "null"}]}
    return {"type": [t, "null"]}


ITEM = {
    "type": "object",
    "additionalProperties": False,
    "properties": {k: nullable("string") for k in ("tag", "title", "text", "label", "date", "state", "source_name", "source_url")}
    | {"value": {"anyOf": [{"type": "string"}, {"type": "number"}, {"type": "null"}]}},
}
ITEM["required"] = list(ITEM["properties"])

BLOCK_TYPES = ["hero", "article", "photo", "cutout", "figs", "list", "timeline", "signal", "talk", "quiz", "table", "quote", "box", "bars", "chart", "index"]
BLOCK = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "type": {"type": "string", "enum": BLOCK_TYPES},
        "span": {"type": "integer", "enum": [12, 8, 7, 6, 5, 4]},
        "rule_top": {"type": "boolean"},
        "variant": nullable("string"),
        "kicker": nullable("string"),
        "title": nullable("string"),
        "dek": nullable("string"),
        "byline": nullable("string"),
        "paragraphs": nullable({"type": "array", "items": {"type": "string"}}),
        "image": nullable("string"),
        "caption": nullable("string"),
        "big": nullable("string"),
        "chart": nullable("string"),
        "items": nullable({"type": "array", "items": ITEM}),
    },
}
BLOCK["required"] = list(BLOCK["properties"])

PAGE = {
    "type": "object",
    "additionalProperties": False,
    "properties": {"tab": {"type": "string"}, "teaser": {"type": "string"}, "folio": {"type": "string"}, "blocks": {"type": "array", "items": BLOCK}},
    "required": ["tab", "teaser", "folio", "blocks"],
}
SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "headline": {"type": "string"},
        "summary": {"type": "string"},
        "strip": {"type": "array", "items": {"type": "string"}},
        "pages": {"type": "array", "items": PAGE},
    },
    "required": ["headline", "summary", "strip", "pages"],
}


# ---------------- 도우미 ----------------
def final_text(msg) -> str:
    return "\n".join(b.text for b in msg.content if b.type == "text").strip()


def check_stop(msg, stage: str) -> None:
    if msg.stop_reason == "refusal":
        cat = getattr(getattr(msg, "stop_details", None), "category", None)
        raise SystemExit(f"{stage}: 모델이 요청을 거절했습니다 (category={cat})")
    if msg.stop_reason == "max_tokens":
        raise SystemExit(f"{stage}: 출력이 max_tokens에서 잘렸습니다")


def facts_for_prompt(ctx: dict) -> str:
    d = copy.deepcopy(ctx["data"])
    last = d.get("last") or {}
    last.pop("shots", None)
    for side in (last.get("lineup") or {}).values():
        for p in side:
            for k in ("player_id", "captain"):
                p.pop(k, None)
    return json.dumps(d, ensure_ascii=False)


def board_for_prompt(ctx: dict) -> str:
    eg = ctx.get("evergreen") or {}
    lines = []
    for key, label in (("free", "자유게시판"), ("article", "기사 말머리"), ("rumor", "루머 말머리(회원 전용)")):
        for p in eg.get(key, [])[:40]:
            if p.get("category") != "공지":
                lines.append(f"- [{label}/{p.get('category')}] {p['title']} ({p.get('when')})")
    for r in eg.get("rumor_bodies", []):
        lines.append(f"  · 에버그린 루머글 '{r['title']}' 요지: {r['body'][:400]}")
    bd = ctx.get("boards") or {}
    for p in bd.get("posts", []):
        lines.append(f"- [{p['site']}] {p['title']} ({p.get('when', '')[:16]}) {p['url']}")
    for b in bd.get("bodies", []):
        lines.append(f"  · {b['site']} '{b['title']}' 요지: {b['body'][:400]}")
    return "\n".join(lines) or "(읽지 못함)"


def stream(client, **kw):
    with client.beta.messages.stream(model=MODEL, betas=BETAS, fallbacks="default", **kw) as s:
        return s.get_final_message()


# ---------------- 1단계: 취재 ----------------
def research(client, ctx: dict) -> str:
    last = ctx["data"].get("last") or {}
    md = (
        f"어제 {last.get('home')} {last.get('score', ['?', '?'])[0]}:{last.get('score', ['?', '?'])[1]} {last.get('away')} 경기가 있었다. "
        "경기 리뷰, 감독·선수 인터뷰, 평점, 명장면, 팬 반응을 특히 자세히 찾는다."
        if ctx["matchday_after"] else "어제는 전북 경기가 없었다. 팀 소식과 다음 경기 준비 상황을 찾는다."
    )
    if ctx.get("matchday_today"):
        md += " 오늘 전북 경기가 있다. 예상 라인업, 부상·결장자, 상대 팀 최근 흐름, 중계 정보를 찾는다."
    prompt = RESEARCH_TASK.format(date=ctx["date"], weekday=ctx["weekday"], no=ctx["no"], matchday=md, facts=facts_for_prompt(ctx), board=board_for_prompt(ctx))
    tools = [
        {"type": "web_search_20260209", "name": "web_search", "max_uses": 25, "user_location": {"type": "approximate", "country": "KR", "timezone": "Asia/Seoul"}},
        {"type": "web_fetch_20260209", "name": "web_fetch", "max_uses": 15},
    ]
    messages = [{"role": "user", "content": prompt}]
    for _ in range(8):  # pause_turn 이어 가기
        msg = stream(client, max_tokens=64000, system=VOICE, tools=tools, messages=messages, output_config={"effort": "high"})
        if msg.stop_reason != "pause_turn":
            break
        messages = [{"role": "user", "content": prompt}, {"role": "assistant", "content": msg.content}]
    check_stop(msg, "취재")
    notes = final_text(msg)
    if len(notes) < 200:
        raise SystemExit("취재 메모가 비어 있습니다")
    return notes


# ---------------- 2단계: 편집 ----------------
def write(client, ctx: dict, notes: str) -> dict:
    lib = json.loads((NP / "img" / "library.json").read_text(encoding="utf-8"))["images"]
    library = ", ".join(f"{k}({v['desc']})" for k, v in lib.items())
    catalog = "; ".join(f"{c['key']}={c['name']}({c['team']}{' ' + str(c.get('no')) + '번' if c.get('no') else ''}{' 감독' if c.get('role') else ''})" for c in ctx["photo_catalog"])
    charts = '"scoreboard"(지난 경기 스코어), "goal_timeline"(득점·슈팅 흐름), "shotmap"(슈팅 지도), "compare"(팀 기록 비교)' if ctx["data"].get("last") else ""
    parts = []
    if ctx["matchday_after"]:
        parts.append("어제 전북 경기가 있었다. 경기 다음 날 특별판: 6~7면. 2면은 '경기 리포트'(chart scoreboard, 기자 리뷰, goal_timeline), "
                     "3면은 '데이터 분석'(shotmap, compare, 선수 cutout으로 숨은 MVP·결정적 장면 분석, 재미있는 숫자 3개 이상).")
    if ctx.get("matchday_today"):
        parts.append("오늘 전북 경기가 있다. '오늘의 경기' 프리뷰 면을 만든다(chart next, standings, form, 관전 포인트, 예상 라인업·부상자, 상대 감독·주요 선수 사진).")
    if not parts:
        parts.append("어제도 오늘도 전북 경기가 없다: 5면 안팎. 경기 리포트나 경기 프리뷰 면은 만들지 않는다. "
                     "다음 경기는 1면 figs나 strip에 'D-n'으로만 짧게 알린다. 그날의 뉴스, 장외 소식, 루머 데스크로 채운다.")
    parts.append("지난 경기를 다시 보는 면은 경기 다음 날에만, 경기 프리뷰 면은 경기 당일에만 만든다(ACL·컵대회 포함, 취재 메모로 판단).")
    parts.append("특집: 그날 유난히 큰 이야기(감독 교체설, 대형 이적, 구단 사건, 기록 달성)가 있으면 '특집' 면을 하나 만든다. "
                 "timeline으로 경과를 정리하고, signal(루머 신호등)이나 bars(숫자 비교), 인물 사진을 함께 쓴다. 매일 넣지 말고 그럴 만한 날에만 넣는다.")
    edition = " ".join(parts)
    ex_path = NP / "issues" / "0.json"
    example = ""
    if ex_path.exists():
        ex = json.loads(ex_path.read_text(encoding="utf-8"))
        example = json.dumps({"headline": ex["headline"], "pages": ex["pages"][:2]}, ensure_ascii=False)[:9000]
    prompt = WRITE_TASK.format(no=ctx["no"], date=ctx["date"], weekday=ctx["weekday"], edition=edition, charts=charts,
                               library=library, catalog=catalog, example=example, facts=facts_for_prompt(ctx), notes=notes)
    msg = stream(client, max_tokens=64000, system=VOICE, messages=[{"role": "user", "content": prompt}],
                 output_config={"effort": "high", "format": {"type": "json_schema", "schema": SCHEMA}})
    check_stop(msg, "편집")
    return json.loads(final_text(msg))


# ---------------- 저장 ----------------
def finalize(ctx: dict, issue: dict) -> Path:
    lib = json.loads((NP / "img" / "library.json").read_text(encoding="utf-8"))["images"]
    used = {}
    for page in issue["pages"]:
        for b in page["blocks"]:
            img = b.get("image")
            if img and img not in lib:
                if img in ctx["assets"]:
                    used[img] = ctx["assets"][img]
                else:
                    print(f"  알 수 없는 사진 키 제거: {img}", file=sys.stderr)
                    b["image"] = None  # 뷰어가 사진 없는 블록으로 그린다
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
    ap.add_argument("--notes-out", help="취재 메모 저장 경로(디버그용, 저장소 밖에 둘 것)")
    args = ap.parse_args()
    ctx = json.loads(Path(args.context).read_text(encoding="utf-8"))
    client = anthropic.Anthropic(max_retries=4, timeout=1800)
    try:
        notes = research(client, ctx)
        print(f"취재 메모 {len(notes)}자")
        if args.notes_out:
            Path(args.notes_out).write_text(notes, encoding="utf-8")
        issue = write(client, ctx, notes)
    except anthropic.AuthenticationError:
        raise SystemExit("ANTHROPIC_API_KEY가 없거나 잘못됐습니다 (GitHub Secrets 확인)")
    except anthropic.RateLimitError as e:
        raise SystemExit(f"API 사용 한도 초과: {e.message}")
    except anthropic.APIStatusError as e:
        raise SystemExit(f"API 오류 {e.status_code}: {e.message}")
    except anthropic.APIConnectionError:
        raise SystemExit("API 연결 실패")
    path = finalize(ctx, issue)
    print(f"완성: {path.relative_to(ROOT)} · {issue['headline']} · {len(issue['pages'])}면")


if __name__ == "__main__":
    main()
