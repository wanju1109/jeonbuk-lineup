# c_report — 전북 매치 리포트

K리그 포털 **CHALK BOARD** 이벤트 좌표를 재가공해, 초보 팬도 읽고 전문가도 깊게 보는 전북현대 경기 분석 페이지입니다.

## 첫 경기

- 2026 하나은행 K리그1 22R
- 전북 1 : 3 제주 (`game_id=131`, 2026-08-08)
- 데이터: `data/131.json` (이벤트 1187개)

## GitHub Pages 배포

1. 이 `c_report` 폴더 전체를 `wanju1109/jeonbuk-lineup` 저장소 루트에 추가
2. 커밋 & 푸시 (`main`)
3. 접속 URL 예:

```text
https://wanju1109.github.io/jeonbuk-lineup/c_report/
```

이미 repo에 GitHub Pages가 켜져 있으면 푸시 후 1~2분 뒤 열립니다.

## 로컬 확인

`file://` 로는 JSON fetch가 막힐 수 있습니다. 프로젝트 루트에서:

```bash
cd c_report
python -m http.server 8080
```

브라우저: http://localhost:8080/

## 페이지 구성

| 섹션 | 내용 |
|------|------|
| 경기 한눈에 | 스코어 + 초보/전문가 스토리 |
| 숫자로 보는 승부 | xG, 슈팅, 패스, 태클 비교 |
| 골 스토리 | 골 직전 패스 시퀀스 + 피치 궤적 |
| 선수 히트맵 | 패스/슈팅/수비/드리블/파울/선방 |
| 슈팅 맵 | xG 크기 원, 골 강조 |
| 커뮤니티 업로드 | 리포트 링크 공유 + 전체 본문 복사 (요약 없음) |

## 데이터 스키마 (요약)

`events[]` 주요 필드:

- `START_POINT_X/Y`, `END_POINT_X/Y` — 피치 좌표 (0~100)
- `TYPE_CD` — `PS` 패스, `ST` 슈팅, `DF` 수비, `FO` 파울, `GK` GK, `DU` 경합
- `TYPE_DETAIL_CD` — `PSS/PSU`, `GL`, `TKS`, `GC` 등
- `EXPECTED_GOAL` — 슈팅 xG
- `PERIOD_ID`, `MIN_TIME`, `SEC_TIME`, `PLAYER_ID`, `TEAM_ID`

팀 코드: 전북 `K05`, 제주 `K04`

## 다른 라운드 보기

1. 상단에서 **연도 / 라운드** 선택
2. **데이터 가져오기** 클릭
3. 전북 경기가 자동으로 열립니다

이미 **2026시즌 1~22R 전북 경기 22개**가 수집되어 있습니다.

자동 갱신:
- GitHub Actions `c_report chalk board collect` (6시간마다)
- 로컬: `python c_report/scripts/collect_chalkboard.py`

워크플로 파일은 저장소 루트 `.github/workflows/c-report-collect.yml` 에 두세요.

## 주의

- 부가기록(Bepro11) 기준이라 공식기록과 다를 수 있습니다.
- 연맹 이용약상 보도/커뮤니티용 **재가공** 형태로 사용하세요. 원본 대량 재판매은 금지입니다.
