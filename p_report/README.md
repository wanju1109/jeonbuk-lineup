# p_report — JEONBUK MATCH AI PREVIEW

전북현대 **다가올 경기**를 킥오프 약 **48시간 전**에 자동으로 준비하는 프리뷰 페이지입니다.

경기 후 분석은 `c_report`(JEONBUK MATCH AI REPORT)를 사용합니다.

## URL

```text
https://wanju1109.github.io/jeonbuk-lineup/p_report/
```

작성자 화면: `?x=jb7k`  
특정 경기: `?q=<opaque>` (c_report와 같은 XOR 인코딩)

## 구성

| 섹션 | 내용 |
|------|------|
| 다가올 경기 | 카운트다운 · VS · 한줄 전망 |
| 프리뷰 카드 | 유리 / 불리·조심 / 관전 / 상대 경계 |
| 스타일 | 최근 폼 기반 태그 · 평균 xG/슈팅 |
| 최근 폼 · 맞대결 | 전북/상대 최근 결과, H2H |
| 링크 만들기 | evergreenjb용 링크 카드 |

## 데이터 생성

`c_report`의 `schedule.json` + `index.json`(+ 경기 JSON)을 읽어 `p_report/data/` 에 씁니다.

```powershell
python p_report/scripts/build_preview.py
```

환경변수:

- `PREVIEW_HOURS` — 공개 윈도우 (기본 48)
- `KLEAGUE_YEAR` — 시즌 연도

규칙:

- 전북 **미종료** 다음 경기는 항상 생성 (48시간 밖이면 `published: false` 초안)
- 킥오프까지 0~48시간이면 `published: true` / `within_48h: true`
- 킥오프 시각이 없으면 `date_md` + **19:00 KST** 가정

## 자동 갱신

GitHub Actions `p_report preview build`

- 3시간마다 일정 갱신 시도 + 프리뷰 재생성
- `workflow_dispatch`로 수동 실행 가능

## 로컬 확인

```powershell
cd p_report
python -m http.server 8081
```

브라우저: http://localhost:8081/?x=jb7k
