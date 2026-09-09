# fun_records — 재미로 보는 전북현대 기록

K리그1 전북현대 **2020~현재** 경기 결과로 잡학 기록 카드를 만듭니다.

## URL

```text
https://wanju1109.github.io/jeonbuk-lineup/fun_records/
```

## 데이터 갱신

```powershell
# 1) 포털에서 전북 경기 스코어 수집 (2020~현재)
python fun_records/scripts/collect_history.py

# 2) (선택) 골 상세까지 칠판 백필 — 느림
$env:FUN_FETCH_GOALS="1"
python fun_records/scripts/collect_history.py

# 3) 기록 JSON 생성
python fun_records/scripts/build_records.py
```

브라우저 **새로고침 · 기록 다시 찾기** 버튼은 `history.json`을 다시 읽어
날짜 간격·연승·맞대결 갭 등을 재계산하고 카드 순서를 섞습니다.

## 구성

| 경로 | 역할 |
|------|------|
| `data/history.json` | 전북 경기 이력 |
| `data/records.json` | 사전 생성 기록(백업) |
| `js/engine.js` | 클라이언트 기록 엔진 |
| `index.html` | UI |
