# korea_coach — K리그 한국 감독

2026시즌 K리그1·K리그2 **한국인 감독**의 연대기, 축구, 장점과 허점을 칼럼으로 읽는 페이지입니다.
외국인 사령탑은 넣지 않았습니다.

## URL

```text
https://wanju1109.github.io/jeonbuk-lineup/korea_coach/
```

- 특정 감독: `?q=<opaque>`
- 작성자 화면: `?x=jb7k`

공유 링크에는 작성자 키를 넣지 않습니다. 링크를 받은 독자는 칼럼만 보고,
링크 만들기 버튼은 보이지 않습니다.

## 데이터

```powershell
python korea_coach/scripts/build_coaches.py
```

초상은 위키미디어 공용에서 받은 파일을 `korea_coach/img/`에 둡니다.
공용 초상이 없는 감독은 이니셜 초상으로 대체합니다.

기록의 근거는 한국어 위키백과 감독 항목, 2026 개막 미디어데이 보도, `team_report` 프로필입니다.
해석은 참고용입니다.
