# newspaper — 전주성 조간

전북현대 팬을 위한 아침 신문. 매일 07:00(KST)에 새 호를 만들어 에버그린 자유게시판에 iframe으로 올린다.
제1호는 2026-10-23, 이후 하루에 1호씩.

- 보기: `https://wanju1109.github.io/jeonbuk-lineup/newspaper/` (최신호), `?no=N` (지난 호)
- PC는 면 탭으로 넘겨 보고, 휴대폰은 모든 면이 한 줄로 이어진다.

## 매일 흐름 (API 키 없음, PC 꺼져 있어도 됨)

| 시각(KST) | 누가 | 하는 일 |
|---|---|---|
| 05:45 | GitHub Actions `newspaper-inbox.yml` | 에버그린 로그인 → 루머 탭 제목을 `inbox/boards.json`에 저장 (`scripts/collect_inbox.py`) |
| 06:05 | Claude 루틴 (claude.ai/code/routines, 구독 사용) | `EDITOR.md` 지침대로 기록 계산(`build_context.py`) → 뉴스·루머 취재 → 초고 → `finalize_issue.py` 검사 → `issues/{no}.json` push |
| 07:00 | GitHub Actions `newspaper-post.yml` | 새 호 push를 받아 07:00까지 기다린 뒤 에버그린 칼럼/분석에 iframe 글 게시 (`post_evergreen.py`) |

편집 규칙: 경기 리포트·데이터 분석 면은 경기 다음 날에만(6~7면 특별판), 경기 프리뷰 면은 경기 당일에만. 큰 이야기가 있는 날은 특집 면.
루머 게시판: 추꾸·에펨코리아·루리웹(`scripts/boards.py`, 공개 목록), 에버그린 루머(회원 전용, 제목만).

## 필요한 설정 (Settings → Secrets and variables → Actions)

| 이름 | 종류 | 내용 |
|---|---|---|
| `EVERGREEN_ID` / `EVERGREEN_PW` | Secret | 에버그린 계정 (루머 탭 읽기, 글쓰기) |
| `EVERGREEN_CATEGORY` | Variable | 말머리 번호. 기본 211(칼럼/분석) |

## 수동 실행

- Actions → `newspaper post` → Run workflow: `mode`=`dry-run`(로그인·글쓰기 화면만 확인) / `yes`(실제 게시), `no`=호수
- 같은 호를 두 번 올리지 않도록 `issues/posted.json`에 기록한다.
- 루틴을 바로 돌리려면 claude.ai/code/routines 에서 '지금 실행'.

## 사진

- `img/library.json`: 저작권이 확인된 자료 사진(Wikimedia Commons). 새 사진은 여기에 출처와 함께 추가한다.
- 선수 사진은 `player_report/data/index.json`의 공식 프로필 URL, 감독 사진은 `korea_coach/img`를 쓴다.
