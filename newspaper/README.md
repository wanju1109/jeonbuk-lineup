# newspaper — 전주성 조간

전북현대 팬을 위한 아침 신문. 매일 07:00(KST)에 새 호를 만들어 에버그린 자유게시판에 iframe으로 올린다.
제1호는 2026-10-23, 이후 하루에 1호씩.

- 보기: `https://wanju1109.github.io/jeonbuk-lineup/newspaper/` (최신호), `?no=N` (지난 호)
- PC는 면 탭으로 넘겨 보고, 휴대폰은 모든 면이 한 줄로 이어진다.

## 매일 흐름 (`.github/workflows/newspaper-daily.yml`)

| 시각(KST) | 단계 | 스크립트 |
|---|---|---|
| 06:17 | 기록·게시판 수집 | `scripts/build_context.py` — 순위, 지난 경기 부가기록, 다음 경기, 선수 사진 목록, 에버그린 글 제목, 루머 게시판(`scripts/boards.py`: 추꾸·에펨코리아·루리웹) |
| ~06:20 | 취재·편집 | `scripts/generate_issue.py` — Claude가 웹 검색으로 뉴스·루머를 모으고 `issues/{no}.json`을 쓴다 |
| ~06:50 | 커밋 | `issues/{no}.json`, `issues/index.json` |
| 07:00 | 게시 | `scripts/post_evergreen.py` — Pages 반영을 확인한 뒤 로그인해서 글쓰기 |

편집 규칙: 경기 리포트·데이터 분석 면은 경기 다음 날에만(6~7면 특별판), 경기 프리뷰 면은 경기 당일에만 싣는다. 큰 이야기가 있는 날에는 특집 면을 넣는다.

## 필요한 설정 (Settings → Secrets and variables → Actions)

| 이름 | 종류 | 내용 |
|---|---|---|
| `ANTHROPIC_API_KEY` | Secret | console.anthropic.com 에서 만든 API 키 |
| `EVERGREEN_ID` | Secret | 에버그린 아이디 |
| `EVERGREEN_PW` | Secret | 에버그린 비밀번호 |
| `CHUGGU_ID` / `CHUGGU_PW` | Secret | 추꾸 계정 (선택). 루머 게시판 본문을 읽을 때만 쓴다. 없으면 제목만 읽는다 |
| `EVERGREEN_CATEGORY` | Variable | 말머리 번호. 기본 211(칼럼/분석). 자유 147, 기사 148, 기록/통계 213 |

## 수동 실행

Actions → `newspaper daily (전주성 조간)` → Run workflow
- `post`: `dry-run`(기본, 로그인과 글쓰기 화면만 확인) / `no`(신문만 만들기) / `yes`(실제 게시)
- 같은 호를 두 번 올리지 않도록 `issues/posted.json`에 기록한다.

## 사진

- `img/library.json`: 저작권이 확인된 자료 사진(Wikimedia Commons). 새 사진은 여기에 출처와 함께 추가한다.
- 선수 사진은 `player_report/data/index.json`의 공식 프로필 URL, 감독 사진은 `korea_coach/img`를 쓴다.
