"""위키미디어 공용(Commons)에서 전북 관련 자유 라이선스 사진을 찾아 img/library.json에 더한다.

- 선수 경기 사진: 파일 이름이 "YYMMDD 팀 vs 팀 (선수이름)" 꼴인 것. 선수 이름별로 묶는다.
- 경기장·응원 사진: 검색어별로 몇 장씩.
사진 파일은 저장소에 넣지 않고 upload.wikimedia.org 썸네일 주소를 그대로 쓴다(출처·라이선스는 credit에 기록).
자주 돌릴 필요는 없다. 새 사진이 올라왔을 것 같을 때 한 번씩 실행한다.

usage: python newspaper/scripts/collect_commons.py
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "newspaper" / "img" / "library.json"
API = "https://commons.wikimedia.org/w/api.php"
OK_LICENSES = ("CC0", "CC BY", "Public domain", "PD")  # CC BY, CC BY-SA 모두 포함

S = requests.Session()
S.headers["User-Agent"] = "jeonju-morning/0.1 (Jeonbuk fan newspaper; github.com/wanju1109)"


def search(q: str, limit: int = 200) -> list[dict]:
    out, offset = [], 0
    while offset < limit:
        params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6, "gsrsearch": q,
                  "gsrlimit": 50, "gsroffset": offset, "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 1280}
        for _ in range(3):
            r = S.get(API, params=params, timeout=30)
            if r.ok and r.text.startswith("{"):
                break
            time.sleep(3)
        else:
            break
        data = r.json()
        for p in (data.get("query", {}).get("pages") or {}).values():
            ii = p["imageinfo"][0]
            m = ii.get("extmetadata", {})
            out.append({
                "title": p["title"], "w": ii["width"], "h": ii["height"], "thumb": ii.get("thumburl") or ii["url"],
                "page": ii.get("descriptionurl"),
                "license": m.get("LicenseShortName", {}).get("value", ""),
                "artist": re.sub(r"<[^>]+>", "", m.get("Artist", {}).get("value", "")).strip(),
            })
        if "continue" not in data:
            break
        offset = data["continue"].get("gsroffset", offset + 50)
        time.sleep(1)
    return out


def usable(f: dict) -> bool:
    t = f["title"].lower()
    return (f["license"].startswith(OK_LICENSES) and f["w"] >= 900 and t.endswith((".jpg", ".jpeg"))
            and "logo" not in t and "emblem" not in t)


def entry(f: dict, alt: str, desc: str) -> dict:
    return {"src": f["thumb"].split("?")[0], "alt": alt, "desc": desc,
            "credit": f"사진 {f['artist'] or '작자 미상'} / Wikimedia Commons ({f['license']})", "source": f["page"],
            "shape": "세로" if f["h"] > f["w"] else "가로"}


def main() -> None:
    lib = json.loads(LIB.read_text(encoding="utf-8"))
    images, people = lib["images"], lib.setdefault("people", {})
    known_src = {v["src"] for v in images.values()}
    added = 0

    # 1) 전북 선수 경기 사진: "260411 FC 서울 vs 전북 (이동준).jpg", "260912 전북 vs FC 서울 (Italo).jpg"
    pat = re.compile(r"File:(\d{6}) (.+?) vs (.+?) \((.+?)\)(?: (\d+))?\.jpe?g$", re.I)
    files = search('"vs 전북"') + search('"전북 vs"')
    for f in files:
        m = pat.match(f["title"])
        if not m or not usable(f) or "전북" not in (m[2] + m[3]):
            continue
        ymd, a, b, name, n = m.groups()
        src = f["thumb"].split("?")[0]
        if src in known_src:
            continue
        date = f"20{ymd[:2]}.{ymd[2:4]}.{ymd[4:]}"
        key = f"commons:{name}:{ymd}{'-' + n if n else ''}"
        images[key] = entry(f, f"{name} ({date} {a} vs {b})", f"{name} 경기 사진. {date} {a} vs {b}")
        people.setdefault(name, []).append(key)
        known_src.add(src)
        added += 1

    # 2) 경기장·응원·도시 사진
    for q, tag in [("Jeonju World Cup Stadium", "전주월드컵경기장"), ("Jeonbuk fans", "전북 응원"),
                   ("Jeonbuk Hyundai Motors", "전북현대"), ("Jeonju Hanok Village", "전주 한옥마을")]:
        for f in search(q, 60):
            src = f["thumb"].split("?")[0]
            if not usable(f) or src in known_src or re.match(r"File:\d{6} ", f["title"]):
                continue
            name = re.sub(r"^File:|\.jpe?g$", "", f["title"], flags=re.I)
            key = f"commons:{tag}:{len([k for k in images if k.startswith('commons:' + tag)]) + 1}"
            images[key] = entry(f, name, f"{tag}: {name}")
            known_src.add(src)
            added += 1

    for name in people:
        people[name] = sorted(set(people[name]))
    LIB.write_text(json.dumps(lib, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"사진 {added}장 추가 · 전체 {len(images)}장 · 선수 {len(people)}명")


if __name__ == "__main__":
    main()
