# team_report — K리그 팀분석

K리그1·K리그2 **전 구단(29팀)**의 이번 시즌을 순위·공격·수비·흐름·스쿼드까지 뜯어 칼럼 형태로 읽는 페이지입니다.

전북 경기 단위 분석은 `c_report`(경기 후) / `p_report`(경기 전)를 사용합니다.

## URL

```text
https://wanju1109.github.io/jeonbuk-lineup/team_report/
```

- 특정 구단: `?q=<opaque>` (구단 ID를 XOR 인코딩)
- 작성자 화면: `?x=jb7k`
- 임베드: `?f=y`

공유 링크에는 **작성자 키를 넣지 않습니다.** 링크를 받은 독자는 칼럼과 순위표만 보고,
재생성 버튼과 링크 만들기 도구는 보이지 않습니다.

## 구성

| 섹션 | 내용 |
|------|------|
| 순위표 | K1/K2 전환 · 최근 5경기 · 현재 위치 배지 |
| 클럽 헤드 | 데이터에서 뽑은 헤드라인 · 시즌 성격 태그 |
| 핵심 지표 | 순위 · 승점 · 경기당 승점 · 득실 · 홈/원정 · 무실점 · 남은 경기 |
| 칼럼 | 현위치 / 감독과 그 축구 / 목표와 현실 / 공격 / 수비 / 홈·원정 / 시즌 궤적 / 최근 흐름 / 관중 / 스쿼드 / 남은 시즌 |
| 순위 추이 | 라운드별 순위 SVG 차트 |
| 최근 경기 | 최근 10경기 결과 |
| 링크 만들기 | evergreenjb용 링크 카드 · iframe (작성자 전용) |

## 칼럼은 어떻게 쓰이나

문장은 사람이 미리 써 둔 글이 아니라 **그 시점의 성적에서 생성**됩니다.
`js/column.js` 가 구단 JSON을 받아 조건에 따라 문단을 조립하므로,
성적이 바뀌면 같은 팀이라도 다른 칼럼이 나옵니다.

작성자 화면의 **지금 성적으로 다시 쓰기** 버튼은 캐시를 건너뛰고 최신 JSON을 다시 읽어
칼럼을 처음부터 새로 씁니다. 공유 링크에서는 이 버튼이 노출되지 않습니다.

감독·팀 방향성처럼 기록으로 알 수 없는 내용은 `data/team_profiles.json` 에 적어두면
칼럼에 **감독과 그 축구**, **목표와 현실** 섹션으로 들어갑니다. 비워두면 해당 섹션은 생략됩니다.

## 데이터 생성

```powershell
python team_report/scripts/build_team_report.py
```

읽는 곳:

- `proto/data/league.json` — K1/K2 전 경기 일정·결과 (순위·득실·폼·홈원정 산출)
- `player_report/data/index.json` — 구단 식별자·엠블럼·컬러
- `player_report/data/players/*.json` — 시즌 득점·도움·출전
- `c_report/data/club-attendance.json` — K리그1 관중
- `p_report/data/lineup_exclusions.json` — 시즌 중 이적한 선수 표시
- `team_report/data/team_profiles.json` — 수기 프로필 (선택)

쓰는 곳:

- `team_report/data/index.json` — 리그별 순위표
- `team_report/data/teams/{team_id}.json` — 구단별 시즌 도시에

### 판정 기준

- 남은 경기: 편성된 경기 수 기준, K리그1은 스플릿 5경기를 더해 38경기로 계산
- 선두 추격 가능: 남은 경기당 **1점**, 컷 추격 가능: 경기당 **1.5점**
  (전승 가정은 산술이지 전망이 아니므로 3점은 쓰지 않음)
- 순위 동률: 승점 → 다득점 → 득실차 → 다승

## 자동 갱신

GitHub Actions `team report build`

- 매일 02:10 KST 재생성 후 `chore(team_report): ...` 로 커밋
- `workflow_dispatch`로 수동 실행 가능

## 로컬 확인

```powershell
cd team_report
python -m http.server 8099
```

브라우저: http://localhost:8099/?x=jb7k
