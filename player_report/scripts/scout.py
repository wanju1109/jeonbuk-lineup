#!/usr/bin/env python3
"""Build long-form Korean scouting notes from official K League records."""

from __future__ import annotations

from datetime import date

# Hand-written reports for players whose game is public enough to describe
# without inventing numbers. Stats in the JSON still come from kleague.com.
CURATED = {
    "20180025": {
        "profile": (
            "송범근은 전북 현대의 상징적인 골키퍼다. 1997년생, 194cm/88kg의 프레임은 "
            "박스 안에서 존재감 그 자체고, 2018 프로 데뷔 이후 전북에서 주전으로 "
            "자랐다. 원클럽은 아니다. 공식 기록상 K리그1 출장이 200경기를 훌쩍 "
            "넘고, 클린시트도 세 자릿수에 들어간다. 숫자만 봐도 ‘가끔 나서는 백업’이 "
            "아니라 한 시대의 1순위 키퍼라는 뜻이다. 2018 자카르타 아시안게임 금메달로 "
            "병역 특례를 받았고, 군에 가진 않았다. 2023–24시즌은 상무가 아니라 "
            "J리그 쇼난 벨마레에서 뛰었고, 2025년 전북으로 돌아왔다. 큰 경기, 원정, "
            "세트피스 혼전에서도 목소리와 위치 선정이 먼저 나온다. 팬들이 그를 "
            "‘전북의 마지막 줄’로 부르는 이유는 세이브 하이라이트 한 장이 아니라 "
            "시즌을 관통하는 안정감 때문이다."
        ),
        "strengths": (
            "첫 번째는 골문 앞 공간 장악이다. 194cm의 리치는 크로스와 코너에서 "
            "펀칭·캐치를 고민하는 시간을 줄여 주고, 페널티박스 혼전에서 주저하지 "
            "않고 나온다. 두 번째는 리플렉스보다 ‘각 줄이기’다. 1대1에서 몸을 크게 "
            "쓰되 타이밍이 늦지 않고, 슈팅 직전 한 발 앞으로 나와 각을 지우는 버릇이 "
            "몸에 배어 있다. 세 번째는 빌드업 키퍼로서의 성장이다. 전북이 후방부터 "
            "경기를 풀어 가는 날에는 짧은 패스로 센터백을 안심시키고, 압박이 붙으면 "
            "반대쪽 풀백까지 여는 킥을 선택한다. 네 번째는 멘탈이다. 실점 직후 다음 "
            "세트를 리셋하는 속도가 빠르고, 수비 라인이 흔들려도 감정적으로 무너지는 "
            "장면이 적다. 다섯 번째는 내구성과 연속 출전이다. 한 시즌 30경기 이상을 "
            "여러 차례 소화한 기록은 캠프와 여름을 버티는 신체 관리, 그리고 감독이 "
            "교체를 고민하지 않게 만드는 신뢰의 증거다. 세트피스 상황에서 수비수에게 "
            "마크를 나누는 지시가 분명해, 골키퍼가 경기의 수비 코치 역할까지 하는 "
            "타입이다."
        ),
        "weaknesses": (
            "키가 큰 키퍼 특유의 약점도 분명히 있다. 발밑이 급해지는 강한 전방 압박 "
            "앞에서 첫 터치가 길어지면 센터백이 받아 줘야 하는 부담이 생긴다. "
            "펀칭을 선택하는 장면에서는 세컨볼 위치가 애매해질 때가 있고, 박스 밖 "
            "낮은 슈팅·굴절에는 리치가 오히려 반응을 늦추는 인상을 줄 수 있다. "
            "공격적인 커맨드가 미덕이지만, 크로스 판단이 한 박자 빠르면 빈 골문이 "
            "노출된다. 오래 뛴 키퍼에게 따라붙는 또 하나의 숙제는 "
            "‘익숙한 수비 블록’이 바뀌는 시즌이다. 센터백 조합이 바뀌거나 라인이 "
            "갑자기 높아지면, 원래 잘하던 각도 세이브의 타이밍을 다시 맞춰야 한다. "
            "큰 키퍼라 낮은 바운드 처리에서 몸을 접는 동작이 버거워 보일 때도 있다. "
            "이런 약점은 치명타라기보다, 상대 스카우터가 세트피스와 컷백으로 공략할 "
            "포인트다. 그리고 2023–24 J리그 쇼난을 거쳐 전북 수비 블록으로 돌아오면, "
            "센터백 호흡과 라인 높이를 다시 맞추는 초반 몇 경기가 과제로 남는다."
        ),
    },
    "20220042": {
        "profile": (
            "이승우는 한국 축구가 10대 때부터 이름을 알린 공격수다. 173cm/63kg의 "
            "작은 프레임으로 박스 안에서 공을 꺼내고, 턴한 뒤 골문까지 가는 가속이 "
            "본능이다. 바르셀로나 유스와 베로나를 거쳐 K리그로 돌아온 뒤에도 "
            "‘유망주’가 아니라 득점과 침투로 경기를 만드는 선수로 다시 쓰였다. "
            "공식 기록상 K리그1 출장과 득점이 이미 세 자릿수·수십 골 구간에 들어 "
            "있고, 전북에서는 10번을 달고 측면과 가짜 9 사이를 오간다. 한 번의 "
            "터치로 수비 라인을 등지게 만드는 능력은 스카우트 리포트의 첫 줄이다. "
            "몸싸움에서 이기려고 하지 않고, 각도만 열어 놓고 찬다. 그게 이 선수의 "
            "정체성이다."
        ),
        "strengths": (
            "첫 번째는 공간이다. 수비 라인과 골키퍼 사이, 풀백과 센터백 사이 "
            "애매한 틈을 먼저 본다. 두 번째는 첫 터치 뒤 가속이다. 받아 놓고 "
            "한 박자에 등 뒤로 빠져 1대1를 만든다. 세 번째는 양발 마감이다. "
            "약한 발도 각만 나오면 주저하지 않는다. 네 번째는 압박 유도. 작은 "
            "체격으로 파울을 끌어내 세트피스를 만든다. 다섯 번째는 전환. 공을 "
            "뺏긴 뒤가 아니라 뺏기 직전, 상대가 빌드업하는 발 밑을 먼저 파고든다. "
            "전북처럼 역습과 박스 점유가 섞인 팀에서 이 다섯 가지가 동시에 켜지면 "
            "90분이 하이라이트가 된다."
        ),
        "weaknesses": (
            "173cm 공격수의 숙제는 늘 같다. 등 지고 받는 타깃 롤, 제공권, "
            "수비수의 몸싸움이다. 롱볼 작전이 되면 존재감이 줄어든다. 박스 밖에서 "
            "욕심 슈팅이 많아지면 팀의 두 번째 파동이 죽는다. 수비 가담이 늦으면 "
            "상대 풀백의 오버랩을 혼자 놔주게 된다. 체력 곡선이 급격히 떨어지는 "
            "구간이 오면 침투 타이밍이 오프사이드로 변한다. 그리고 기대치가 "
            "이름값과 묶여 있어, 무득점 경기가 두세 번만 이어져도 평가가 과하게 "
            "흔들린다. 약점은 재능의 반대말이 아니라, 감독이 짝 스트라이커와 "
            "측면을 어떻게 붙여 주느냐의 문제다."
        ),
    },
}


def _num(v) -> int:
    try:
        if v is None or v == "" or v == "-":
            return 0
        return int(v)
    except (TypeError, ValueError):
        return 0


def _age(birth: str, today: date | None = None) -> int | None:
    if not birth:
        return None
    parts = [p for p in birth.replace("-", "/").split("/") if p]
    if len(parts) < 3:
        return None
    try:
        y, m, d = int(parts[0]), int(parts[1]), int(parts[2])
        now = today or date.today()
        years = now.year - y
        if (now.month, now.day) < (m, d):
            years -= 1
        return years if 15 <= years <= 50 else None
    except ValueError:
        return None


def _pos_label(pos: str) -> str:
    p = (pos or "").upper()
    if p == "GK":
        return "골키퍼"
    if p == "DF":
        return "수비수"
    if p == "MF":
        return "미드필더"
    if p == "FW":
        return "공격수"
    return "선수"


def _team_sentence(teams: list[dict]) -> str:
    names = []
    seen = set()
    for row in teams or []:
        name = str(row.get("team") or "").strip()
        if not name or name == "합계" or name in seen:
            continue
        seen.add(name)
        names.append(name)
    if not names:
        return "소속 구단 이동 기록이 공식 표에 거의 없다."
    if len(names) == 1:
        return f"공식 팀별 기록은 {names[0]} 한 곳으로 모여 있다. 원클럽에 가깝다."
    if len(names) == 2:
        return f"거쳐 온 구단은 {names[0]}, {names[1]}이다."
    return "거쳐 온 구단은 " + ", ".join(names[:-1]) + f", 그리고 {names[-1]}이다."


def _latest_season(seasons: list[dict]) -> dict | None:
    rows = [s for s in (seasons or []) if str(s.get("season") or "").isdigit()]
    if not rows:
        return None
    return sorted(rows, key=lambda s: int(s["season"]))[-1]


def _career_apps(summary: dict, is_gk: bool) -> tuple[int, int, int]:
    tot = summary.get("total") or {}
    apps = _num(tot.get("apps"))
    if is_gk:
        return apps, _num(tot.get("goals_conceded")), _num(tot.get("clean_sheets"))
    return apps, _num(tot.get("goals")), _num(tot.get("assists"))


def generate_scout(player: dict) -> dict:
    pid = str(player.get("id") or "")
    if pid in CURATED:
        return dict(CURATED[pid])

    name = player.get("name") or "이 선수"
    pos = (player.get("position") or "").upper()
    is_gk = pos == "GK"
    pos_ko = _pos_label(pos)
    team = player.get("team_name") or "소속 구단"
    nation = player.get("nation") or "미상"
    height = _num(player.get("height"))
    weight = _num(player.get("weight"))
    back_no = player.get("back_no")
    age = player.get("age") or _age(str(player.get("birth") or ""))
    seasons = player.get("seasons") or []
    teams = player.get("teams") or []
    summary = player.get("summary") or {}
    apps, a, b = _career_apps(summary, is_gk)
    latest = _latest_season(seasons)
    k1 = summary.get("k1") or {}
    k2 = summary.get("k2") or {}
    k1_apps = _num(k1.get("apps"))
    k2_apps = _num(k2.get("apps"))

    age_txt = f"{age}세" if age else "나이 정보 없음"
    body = ""
    if height and weight:
        body = f"{height}cm, {weight}kg"
    elif height:
        body = f"{height}cm"
    else:
        body = "신체 스펙이 공식 표에 없다"

    no_txt = f"{back_no}번" if back_no not in (None, "", "-") else "배번 미기재"

    if is_gk:
        rate = (b / apps * 100) if apps else 0
        stat_line = (
            f"통산 출장 {apps}경기, 실점 {a}, 클린시트 {b}"
            + (f" (클린시트 비율 {rate:.0f}%)" if apps else "")
        )
    else:
        ratio = (a / apps) if apps else 0
        stat_line = (
            f"통산 출장 {apps}경기, 득점 {a}, 도움 {b}"
            + (f" (경기당 득점 {ratio:.2f})" if apps else "")
        )

    season_n = len([s for s in seasons if str(s.get("season") or "").isdigit()])
    latest_txt = "최근 시즌 기록이 아직 공식 표에 없다."
    if latest:
        la, lb = _num(latest.get("total_apps")), _num(
            latest.get("total_gc") if is_gk else latest.get("total_goals")
        )
        lc = _num(latest.get("total_cs") if is_gk else latest.get("total_assists"))
        if is_gk:
            latest_txt = (
                f"{latest.get('season')}시즌 {latest.get('team') or team}에서 "
                f"{la}경기 출장, 실점 {lb}, 클린시트 {lc}다."
            )
        else:
            latest_txt = (
                f"{latest.get('season')}시즌 {latest.get('team') or team}에서 "
                f"{la}경기 출장, {lb}골 {lc}도움이다."
            )

    league_txt = []
    if k1_apps:
        league_txt.append(f"K리그1 {k1_apps}경기")
    if k2_apps:
        league_txt.append(f"K리그2 {k2_apps}경기")
    league_s = ", ".join(league_txt) if league_txt else "리그 출장 기록이 아직 짧다"

    profile = (
        f"{name}은(는) {team} 소속 {pos_ko}다. 국적 {nation}, {age_txt}, "
        f"등번호 {no_txt}. 신체는 {body}. {stat_line}. 공식 시즌 행은 "
        f"{season_n}개이고, {league_s}. {_team_sentence(teams)} {latest_txt} "
        f"아래 장단점은 트랜스퍼마크 식 가십이 아니라, K리그 공식 출장·득점·실점 "
        f"표와 포지션·신체 스펙을 겹쳐 읽은 스카우팅이다. 출장이 적은 선수는 "
        f"잠재와 역할 추정 비중이 크고, 출장이 많은 선수는 반복된 숫자로 이야기한다."
    )

    if is_gk:
        strengths = _gk_strengths(name, team, height, apps, a, b, age)
        weaknesses = _gk_weaknesses(name, height, apps, a, b, age)
    elif pos == "DF":
        strengths = _df_strengths(name, team, height, apps, a, b, age)
        weaknesses = _df_weaknesses(name, height, apps, a, b, age)
    elif pos == "MF":
        strengths = _mf_strengths(name, team, height, apps, a, b, age)
        weaknesses = _mf_weaknesses(name, height, apps, a, b, age)
    else:
        strengths = _fw_strengths(name, team, height, apps, a, b, age)
        weaknesses = _fw_weaknesses(name, height, apps, a, b, age)

    return {"profile": profile, "strengths": strengths, "weaknesses": weaknesses}


def _gk_strengths(name, team, height, apps, gc, cs, age) -> str:
    bits = [
        f"{name}의 강점은 골문이라는 한 자리를 시즌 단위로 반복해 지킨다는 데 있다. "
        f"{team} 골키퍼로 등록된 상태에서 공식 출장이 {apps}경기다."
    ]
    if height >= 190:
        bits.append(
            f"{height}cm의 키는 세트피스와 박스 안 공중볼에서 펀칭·캐치의 도달 범위를 "
            "넓힌다. 상대가 크로스를 올릴 때 수비수가 뒤로 물러나지 않아도 되는 타입이다."
        )
    elif height:
        bits.append(
            f"{height}cm는 현대 골키퍼 평균보다 크지 않을 수 있다. 대신 낮은 슈팅과 "
            "리액션, 각 줄이기에 몸을 더 쓰는 쪽으로 강점을 쌓았을 가능성이 크다."
        )
    if apps >= 80 and cs >= 25:
        bits.append(
            f"클린시트 {cs}는 단순히 ‘선방을 잘한다’는 말이 아니라, 수비 조직과 맞춰 "
            "무실점 경기를 반복했다는 뜻이다. 주전 키퍼의 신뢰 구간에 들어간다."
        )
    elif apps >= 20:
        bits.append(
            "출장이 어느 정도 쌓였다면, 감독이 교체 키퍼로만 쓰지 않았다는 신호다. "
            "큰 경기 로테이션과 컵대회에서 이미 검증된 셈이다."
        )
    else:
        bits.append(
            "출장이 적으면 잠재 중심의 평가가 된다. 훈련 경기와 컵대회에서 커맨드, "
            "발밑, 크로스 판단이 다음 단계의 갈림길이다."
        )
    if age and age <= 24:
        bits.append(
            f"{age}세는 골키퍼 기준으로 아직 올라가는 구간이다. 피지컬이 완성되기 전에 "
            "경기 수부터 쌓는 쪽이 장기적으로 이득이다."
        )
    elif age and age >= 33:
        bits.append(
            f"{age}세 키퍼는 반사보다 위치 선정과 경기 운영이 무기인 경우가 많다. "
            "젊은 센터백을 소리로 붙잡는 역할이 커진다."
        )
    bits.append(
        "킥으로 빌드업에 가담할 수 있으면 수비 라인이 한 줄 높아져도 경기가 돌아간다. "
        "반대 케이스라도, 펀칭 타이밍과 1대1 각 줄이기만 안정적이면 1순위 경쟁에서 "
        "쉽게 밀리지 않는다. 실점 후 다음 액션을 리셋하는 속도는 숫자 뒤에 숨은 강점이다."
    )
    return " ".join(bits)


def _gk_weaknesses(name, height, apps, gc, cs, age) -> str:
    bits = [
        f"{name}을(를) 공략하는 포인트는 골키퍼 공통의 약점에서 출발한다. "
        "높은 라인, 강한 전방 압박, 박스 밖 낮은 굴절 슈팅이다."
    ]
    if height >= 192:
        bits.append(
            "큰 키는 공중볼의 무기인 동시에, 낮은 근거리 슈팅에서 몸을 접는 동작이 "
            "한 박자 늦어 보일 수 있다. 컷백 이후 원터치 슈팅이 위험 구간이다."
        )
    if apps and gc / max(apps, 1) >= 1.2:
        bits.append(
            f"출장 대비 실점({gc}/{apps})이 높은 편이면, 개인 선방만의 문제가 아니라 "
            "라인 높이·풀백 간격·세트피스 수비와 같이 봐야 한다. 키퍼만 탓하면 오진이다."
        )
    if apps < 10:
        bits.append(
            "샘플이 적다. 한두 경기 슈퍼세이브나 한두 경기 실수가 이미지를 과장한다. "
            "연속 출전이 쌓이기 전에는 평가를 단정하지 않는 편이 맞다."
        )
    if age and age >= 35:
        bits.append(
            "고령 키퍼는 리액션보다 선위치가 중요하다. 스피드 있는 침투에 각이 열리면 "
            "만회가 어렵다. 백업 운용과 컵대회 분배가 필요하다."
        )
    bits.append(
        "발밑이 흔들리면 상대는 골키퍼를 압박의 트리거로 쓴다. 펀칭 후 세컨볼, "
        "박스 밖 캐치 미스가 약점이 되기 쉽다. 크로스 판단이 과감할수록 빈 골문 "
        "리스크도 같이 커진다. 약점은 ‘못 막는다’가 아니라, 상대가 어디에 공을 "
        "떨어뜨릴지 아는 것이다."
    )
    return " ".join(bits)


def _df_strengths(name, team, height, apps, goals, assists, age) -> str:
    bits = [
        f"{name}은(는) {team} 수비 블록의 한 조각으로 공식 출장 {apps}경기를 쌓았다. "
        "수비수는 하이라이트보다 실수하지 않는 반복이 가치다."
    ]
    if height >= 188:
        bits.append(
            f"{height}cm면 세트피스 공격·수비 모두에서 1순위 타깃이 된다. "
            f"공식 득점 {goals}은 코너와 프리킥 상황에서 이미 골 결정력을 보여 줬다는 뜻이다."
            if goals
            else f"{height}cm의 공중볼은 수비 세트피스의 기본 무기다."
        )
    elif height and height <= 178:
        bits.append(
            f"{height}cm는 센터백보다 풀백·윙백 체형에 가깝다. 오버랩과 1대1 수비가 "
            "강점 후보가 되고, 도움 {assists}가 그 힌트다."
        )
    if apps >= 100:
        bits.append(
            "100경기 이상이면 리그 환경(잔디, 심판 기준, 원정)에 몸이 적응된 상태다. "
            "신인 실수형 수비수와는 다른 안정 구간에 있다."
        )
    elif apps >= 30:
        bits.append(
            "주전 로테이션에 들어갔다는 출장이다. 감독이 특정 매치업에서 빼지 않을 "
            "정도의 신뢰는 이미 있다."
        )
    else:
        bits.append(
            "출장이 짧으면 컵대회·교체 멤버 단계일 수 있다. 제공권, 턴 속도, "
            "빌드업 첫 패스 세 가지가 다음 출장을 결정한다."
        )
    if assists:
        bits.append(
            f"도움 {assists}는 수비수치고 공격 가담이 있다는 신호다. 오버랩이나 "
            "롱 패스로 전진에 가담하는 유형으로 읽힌다."
        )
    bits.append(
        "수비수의 진짜 강점은 경합에서 파울을 최소화하면서 턴을 이긴 뒤, "
        "첫 패스를 안전한 쪽으로 연결하는 것이다. 나이가 젊으면 만회 속도, "
        "많으면 위치 선정이 무기가 된다. 팀 수비 원칙(라인 높이)과 맞을 때 "
        "개인 능력 이상으로 좋아 보인다."
    )
    return " ".join(bits)


def _df_weaknesses(name, height, apps, goals, assists, age) -> str:
    bits = [
        f"{name}의 약점은 수비수에게 공통인 ‘공간’과 ‘스피드 매치업’에서 드러난다. "
        "라인 뒤 침투, 측면 2대1, 세트피스 반대쪽 세컨볼이다."
    ]
    if height and height >= 188:
        bits.append(
            "큰 센터백은 발 빠른 세컨 스트라이커와의 등 뒤 경합에서 불리해질 수 있다. "
            "라인 컨트롤이 흔들리면 만회 스프린트가 길어진다."
        )
    if height and height <= 176:
        bits.append(
            "작은 키 수비수는 페널티박스 혼전과 상대 타깃맨 매치업에서 제공권 부담이 "
            "있다. 옆 센터백·골키퍼와의 커버 약속이 필수다."
        )
    if apps < 15:
        bits.append(
            "출장 샘플이 적다. 한 경기의 큰 실수가 커리어 이미지보다 과장되기 쉽다."
        )
    if age and age >= 34:
        bits.append(
            f"{age}세 수비는 방향 전환과 반복 스프린트에서 젊은 윙과 붙으면 공간이 "
            "열린다. 출전 분배와 매치업 선택이 감독의 숙제다."
        )
    bits.append(
        "빌드업 실수는 곧 결정적 찬스로 이어진다. 약한 발 쪽 압박, 백패스 각, "
        "오프사이드 트랩 타이밍이 상대 스카우팅의 1페이지다. 공격 가담이 많을수록 "
        "자리 비움이 약점이 된다. 파울 위치(박스 근처)는 카드와 키커를 동시에 내준다."
    )
    return " ".join(bits)


def _mf_strengths(name, team, height, apps, goals, assists, age) -> str:
    bits = [
        f"{name}은(는) {team} 중원에서 공식 {apps}경기를 뛰었다. 미드필더는 "
        "골보다 ‘경기가 그 선수를 지나가는가’가 먼저다."
    ]
    if goals + assists >= 20:
        bits.append(
            f"득점 {goals}, 도움 {assists}면 박스 근처에서 끝내는 유형이다. "
            "8번·10번·윙 롤 어느 쪽이든 공격 숫자가 따라오는 자원이다."
        )
    elif goals + assists >= 5:
        bits.append(
            f"공격 포인트 {goals + assists}는 순수 6번만은 아니라는 뜻이다. "
            "박스 진입이나 키패스가 이미 기록으로 남았다."
        )
    else:
        bits.append(
            "공격 포인트가 적으면 파괴보다 연결·수비 가담이 본업일 수 있다. "
            "그런 선수는 숫자가 밋밋해 보여도 팀이 공을 잃는 횟수를 줄인다."
        )
    if apps >= 80:
        bits.append(
            "출장이 많다는 것은 감독이 중원 밸런스를 그 선수에게 맡긴 적이 있다는 "
            "뜻이다. 체력과 전술 이해 없이는 어려운 숫자다."
        )
    if height and height >= 185:
        bits.append(
            f"{height}cm 중원은 세컨볼과 세트피스에서 가산점이 있다. "
            "수비형으로 쓰면 스크린, 공격형으로 쓰면 침투 타깃이 된다."
        )
    bits.append(
        "강점을 한 줄로 줄이면 ‘공의 속도를 자신이 정하는가’다. 탈압박이 되면 "
        "팀이 한 줄 올라가고, 전환 패스가 되면 윙이 편해진다. 나이가 젊으면 "
        "활동량, 많으면 템포 조절이 무기다. 양발을 쓰지 못해도 몸 방향만 "
        "빠르면 중원에서 산다."
    )
    return " ".join(bits)


def _mf_weaknesses(name, height, apps, goals, assists, age) -> str:
    bits = [
        f"{name}의 약점은 중원 선수에게 반복되는 세 가지, 압박 아래 볼 손실, "
        "수비 전환 지연, 박스 안 결정력이다."
    ]
    if goals + assists == 0 and apps >= 20:
        bits.append(
            "출장은 있는데 공격 포인트가 없으면 마지막 패스·슈팅 선택이 과제다. "
            "상대는 그 선수를 막고도 실점하지 않을 수 있다고 본다."
        )
    if apps < 15:
        bits.append("출장이 짧아 역할(6/8/10)이 아직 고정되지 않았을 수 있다.")
    if age and age >= 34:
        bits.append(
            f"{age}세 중원은 박스 투 박스 거리를 90분 유지하기 어렵다. "
            "짝을 누구에게 붙이느냐가 경기력이다."
        )
    bits.append(
        "약한 발, 등 뒤 공간, 파울로 끊는 습관이 약점 리스트의 단골이다. "
        "공격적으로 올라간 뒤 복귀가 늦으면 풀백이 2대1에 당한다. "
        "세트피스 수비 가담이 애매하면 키가 큰 상대의 타깃이 된다. "
        "숫자를 안 만드는 중원일수록, 실수는 눈에 더 크게 남는다."
    )
    return " ".join(bits)


def _fw_strengths(name, team, height, apps, goals, assists, age) -> str:
    bits = [
        f"{name}은(는) {team} 공격 옵션으로 공식 {apps}경기에서 {goals}골 "
        f"{assists}도움을 남겼다."
    ]
    if apps and goals / apps >= 0.35:
        bits.append(
            f"경기당 {goals / apps:.2f}골이면 K리그 주전 스트라이커 기준을 넘는 "
            "결정력이다. 팀이 그 선수를 중심으로 찬스를 설계할 자격이 있다."
        )
    elif goals >= 10:
        bits.append(
            "두 자릿수 득점은 이미 ‘가끔 넣는 선수’가 아니다. 수비 블록이 "
            "그 이름을 따로 체크하는 단계다."
        )
    elif apps >= 20:
        bits.append(
            "출장은 있는데 골이 적으면 공간 창출·홀딩·측면에서 공을 끄는 역할일 "
            "수 있다. 골만으로 공격수를 재면 오진이다."
        )
    if height >= 188:
        bits.append(
            f"{height}cm 타깃은 롱볼과 세트피스에서 1순위다. 수비 두 명을 붙들면 "
            "그 자체로 팀 공격이 이득이다."
        )
    elif height and height <= 175:
        bits.append(
            f"{height}cm면 골목 침투, 좁은 공간 턴, 측면 돌파형일 가능성이 크다. "
            "골키퍼와 1대1을 만드는 움직임이 핵심이다."
        )
    if assists:
        bits.append(
            f"도움 {assists}는 이타적 마감, 또는 2선에서 키패스를 주는 롤을 암시한다."
        )
    bits.append(
        "공격수의 강점은 골 장면만이 아니다. 수비 라인을 끌어내고, 파울을 유도하고, "
        "역습의 첫 터치로 방향을 바꾸는 일이 시즌을 만든다. 출장이 쌓일수록 "
        "그 반복이 팀 전술에 박힌다."
    )
    return " ".join(bits)


def _fw_weaknesses(name, height, apps, goals, assists, age) -> str:
    bits = [
        f"{name}을(를) 막는 쪽은 항상 같은 숙제를 낸다. 등 지고 받을 때의 턴, "
        "오프사이드 타이밍, 박스 안 첫 터치다."
    ]
    if apps and goals == 0:
        bits.append(
            "출장 대비 무득점이면 마감이 숙제다. 슈팅 위치, 약한 발, 골키퍼와의 "
            "1대1 선택이 스카우팅 포인트가 된다."
        )
    if apps < 10:
        bits.append("샘플이 적어 한 시즌 페이스를 단정하면 안 된다.")
    if height and height >= 190:
        bits.append(
            "타깃형은 발밑이 거칠면 압박에 공을 잃는다. 빠른 센터백과의 공간 싸움에서 "
            "첫 스프린트가 밀리면 존재감이 사라진다."
        )
    if age and age >= 34:
        bits.append(
            f"{age}세 공격수는 90분 압박보다 20–30분 결정력이 가치가 된다. "
            "선발 고집보다 교체 카드가 더 위협적일 수 있다."
        )
    bits.append(
        "수비 가담이 느리면 상대 역습의 출발점이 그 자리다. 오프사이드에 자주 "
        "걸리면 팀의 침투 타이밍이 통째로 죽는다. 세트피스 수비 가담 여부는 "
        "리드 상황을 지키는 능력과 직결된다. 약점은 곧 상대 전술 보드의 화살표다."
    )
    return " ".join(bits)
