# 경기 중 정리 글 지침 (전반 총정리 · 후반 총정리)

전북의 K리그1 경기 날, 전반이 끝나면 **전반 총정리**, 경기가 끝나고 전북 감독 인터뷰가 나오면 **후반 총정리**를 쓴다.
다음 날 아침 경기 전체 정리는 조간(EDITOR.md)이 맡는다. 문체·사실·검수 규칙은 EDITOR.md와 같다(먼저 읽는다).
ACL·컵 경기는 K리그 매치센터 기록이 없어 다루지 않는다.

## 순서

1. 할 일을 정한다. `phase`가 null이면 아무것도 하지 말고 끝낸다.
   ```bash
   python -m pip install -q requests
   python newspaper/scripts/live_match.py plan
   ```
2. 기다린다. 전반은 전반 종료, 후반은 경기 종료까지. 한 번에 최대 9분 기다리고 아직이면 종료 코드 3으로 끝나니 **다시 실행한다.**
   예상 시각(expected)보다 50분이 지나도 안 되면(경기 중단 등) 쓰지 말고 끝낸다.
   ```bash
   python newspaper/scripts/live_match.py wait --phase half   # 또는 full
   ```
3. **후반만:** 경기가 끝났으면 전북현대 감독의 경기 뒤 인터뷰를 찾는다(구단 홈페이지 구단뉴스, WebSearch로 언론 기사).
   상대 팀 감독 인터뷰와 경기 전 인터뷰는 치지 않는다. 없으면 `python newspaper/scripts/live_match.py sleep 300`으로 5분 기다렸다가 다시 찾는다.
   경기 종료 뒤 90분까지 없으면 인터뷰 없이 쓰고 "감독 인터뷰는 내일 조간에서 전한다"고 적는다.
4. 기록을 모은다. 오늘 날짜 ctx를 만들고 그 위에 경기 기록을 얹는다.
   ```bash
   python newspaper/scripts/build_context.py --no-board --out /tmp/base.json
   python newspaper/scripts/live_match.py snapshot --phase half --base /tmp/base.json --out /tmp/live.json
   ```
   `/tmp/live.json`의 `live`: 선발(starters), 시간대별 사건(timeline: 골·교체·경고·유효슈팅), 팀 기록(record), 15분 단위 점유율(possession_by_15min),
   선수별 기록(players: 분·슈팅·패스·키패스·태클·가로채기·경합 등, '평점'은 K리그 공식 평점), 경기 전 조간 프리뷰(preview).
   후반에는 후반만의 팀 기록(second_half_record)과 전반 스코어(half_time_score)가 더 있다.
5. 초고를 `/tmp/draft.json`에 쓰고(형식은 EDITOR.md '초고 형식'), 검사·검수·발행한다. 검수 규칙은 EDITOR.md '검수'와 같다.
   ```bash
   python newspaper/scripts/finalize_issue.py --context /tmp/live.json --draft /tmp/draft.json --check
   python newspaper/scripts/review.py --context /tmp/live.json --draft /tmp/draft.json --out /tmp/review.json
   python newspaper/scripts/finalize_issue.py --context /tmp/live.json --draft /tmp/draft.json --review /tmp/review.json
   ```
6. `newspaper/live/{key}.json`, `newspaper/live/index.json`, `newspaper/live/checks/{key}.json`, `newspaper/live/raw/`만 커밋하고 main에 push한다.
   커밋 메시지: `chore(live): {key}`. 에버그린 게시는 집 PC가 5분 안에 한다(index.json을 본다).

## 무엇을 쓰나

글의 뼈대는 **준비한 것 → 실제로 벌어진 것 → 그래서 그려진 그림 → 다음에 볼 것**이다.

- **준비한 것:** 실제 선발(starters)과 조간 프리뷰의 예상(preview.lineups, scout)이 어떻게 달랐는지. 경기 전 감독 인터뷰 기사가 있으면 그 말.
  프리뷰는 조간이 기록으로 만든 예상이다. "구단이 이렇게 준비했다"고 쓰지 않는다. 감독이 말한 것만 '준비'로 쓴다.
- **실제로 벌어진 것:** 골·교체·경고와 시각, 슈팅·유효슈팅·점유율, 15분 단위 점유율의 흐름, 선수별 기록에서 눈에 띄는 것.
- **그림:** 위 기록으로 설명되는 흐름(예: "15분까지 점유율 33%로 밀리다 30분 이후 되찾았다", "슈팅 9개 중 7개가 이탈로·티아고").
  해석은 기록에 근거해 쓰고 '조간 분석'임을 밝힌다. 조간은 경기 영상을 보지 않는다. 영상에서만 알 수 있는 장면(전술 위치, 압박 높이)을 지어내지 않는다.
- **전반 총정리:** 2~3면. 1면 hero(전반 주인공 사진) + 리드 기사 + figs, 2면 chart `scoreboard`·`compare` + timeline(전반 장면) + cutout(전반의 선수) + "후반에 볼 것" list.
  제목 예: "전반 0-0, 전북은 슈팅 9개로 밀어붙였다". 결과를 예단하지 않는다.
- **후반 총정리:** 2~3면. 경기 결과, 후반에 바뀐 것(교체 뒤 흐름, second_half_record), 전북 감독 인터뷰(quote 하나 + 기사), 다음 경기.
  조간 선정 평점·MOM은 다음 날 조간이 하므로 여기서는 하지 않는다. K리그 공식 평점은 '공식 평점'이라고 밝히고 쓸 수 있다.
- 숫자는 `/tmp/live.json`의 값만 쓴다. 출처는 K리그 매치센터(live.source, '공식' 등급)다.
- 사진은 photo_catalog와 library.json에 있는 것만 쓴다. 마지막 면을 뺀 모든 면에 사진이 1개 이상 있어야 한다.
