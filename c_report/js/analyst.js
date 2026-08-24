/*
 * Long-form tactical narrative generator.
 *
 * Consumes the metric context produced by Tactics.analyze() and turns it into
 * chapters written the way a first-team performance analyst would brief a
 * coaching staff: observation, mechanism, consequence. Every claim is bound to
 * a number that exists in the context, so nothing here is invented.
 */

const Analyst = (() => {
  /* Korean topic/subject particles depend on the final jamo of the noun.
   * Strip a trailing gloss so "하프스페이스(왼쪽 안쪽)" keys off 하프스페이스. */
  function hasBatchim(word) {
    const s = String(word || "").replace(/\([^)]*\)\s*$/g, "").trim();
    if (!s) return false;
    const code = s.charCodeAt(s.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return null;
    return (code - 0xac00) % 28 !== 0;
  }

  function topic(word) {
    const b = hasBatchim(word);
    if (b === null) return `${word}은(는)`;
    return b ? `${word}은` : `${word}는`;
  }

  function subject(word) {
    const b = hasBatchim(word);
    if (b === null) return `${word}이(가)`;
    return b ? `${word}이` : `${word}가`;
  }

  function withObject(word) {
    const b = hasBatchim(word);
    if (b === null) return `${word}을(를)`;
    return b ? `${word}을` : `${word}를`;
  }

  function fmt(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(n)) return "-";
    return Number(n).toFixed(digits).replace(/\.0+$/, "");
  }

  function pctText(n) {
    return `${fmt(n, 1)}%`;
  }

  function xgTalk(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return "";
    const pct = Math.round(v * 100);
    return `xG ${v.toFixed(2)} (같은 자리에서 100번 때리면 약 ${pct}골)`;
  }

  function topLane(laneMap, lanes) {
    let best = null;
    let bestN = -1;
    let total = 0;
    for (const lane of lanes) {
      const n = laneMap[lane.key] || 0;
      total += n;
      if (n > bestN) {
        bestN = n;
        best = lane;
      }
    }
    return { lane: best, count: bestN, share: total ? Math.round((bestN / total) * 1000) / 10 : 0 };
  }

  /* Compact verbal read of how a team wanted to hold the ball. */
  function possessionModel(team) {
    const seq = team.sequences;
    const prog = team.progression;
    if (seq.avgPasses >= 3.2 && prog.avgPassLength <= 19) {
      return "점유 유지(짧은 패스로 상대를 끌어내며 공을 지키는 쪽)";
    }
    if (seq.avgPasses <= 1.6 && prog.avgPassLength >= 20) {
      return "다이렉트(한두 번 터치하고 바로 앞으로 넘기는 쪽)";
    }
    if (seq.avgPasses <= 2.2) return "전환형(공을 오래 쥐기보다 빠르게 앞으로 보내는 쪽)";
    return "혼합형(공을 지키는 것과 앞으로 넘기는 것을 섞는 쪽)";
  }

  function pressModel(team) {
    const p = team.pressing;
    if (p.ppda !== null && p.ppda <= 9 && p.defLineHeight >= 44) {
      return "하이 프레스(상대 진영에서부터 달라붙는 강한 압박)";
    }
    if (p.ppda !== null && p.ppda <= 13) return "미드 프레스(하프라인 근처에서 조이는 압박)";
    if (p.defLineHeight <= 33) return "로우 블록(자기 골문 앞에 내려앉아 지키는 수비)";
    return "미드 블록(중원에서 선을 긋고 지키는 수비)";
  }

  function chip(label, home, away, hint) {
    return { label, home, away, hint };
  }

  /* ------------------------------------------------------------------ */

  function chapterModels(ctx) {
    const { home, away, homeName, awayName, tilt } = ctx;
    const paragraphs = [];

    paragraphs.push(
      `축구 경기는 스코어보다 먼저, “오늘 어떻게 싸울까”가 있습니다. ${topic(homeName)} ${possessionModel(home)}이었습니다. 수비할 때는 ${pressModel(home)}로 경기했습니다.`,
      possessionModel(home).startsWith("점유 유지")
        ? `쉽게 말하면 ${topic(homeName)} 공을 오래 돌리며 상대가 지치길 기다리는 쪽에 가깝습니다. 상대가 쫓아오다 빈 공간이 생기면 그때 찌르는 그림이죠.`
        : possessionModel(home).startsWith("다이렉트") || possessionModel(home).startsWith("전환형")
          ? `쉽게 말하면 ${topic(homeName)} 공을 오래 쥐기보다, 한두 번에 앞으로 넘기며 상대가 자리를 잡기 전에 승부를 보려 했습니다.`
          : `${topic(homeName)} 상황에 따라 공을 지키기도, 빠르게 넘기기도 했습니다. 상대가 어떻게 나오느냐에 맞춰 템포를 바꾼 날입니다.`,
      `${topic(awayName)} ${possessionModel(away)}이었습니다. 수비할 때는 ${pressModel(away)}입니다.`,
      `두 팀의 의도가 부딪힌 지점은 이겁니다. ${subject(homeName)} 공을 가지고 있을 때, ${subject(awayName)} 어느 높이에서 끊으려 했느냐. 앞에서 끊으면 바로 역습이 되고, 내려앉아 끊으면 시간이 걸립니다.`
    );

    paragraphs.push(
      `필드 틸트(상대 골문 근처에서 공을 만진 비율)는 ${homeName} ${pctText(tilt.home)}, ${awayName} ${pctText(tilt.away)}입니다.`,
      `이 숫자는 "누가 공을 오래 가졌나"가 아닙니다. "누가 상대 골문 근처에서 공을 만졌나"입니다. 우리 진영에서 패스를 백 번 해도, 상대 골문 앞에 한 번도 안 가면 공격이 아닙니다.`,
      Math.abs(tilt.home - 50) >= 15
        ? `${subject(tilt.home > tilt.away ? homeName : awayName)} 경기장에서 더 앞쪽을 차지했습니다. 앞에서 경기를 하면 상대는 숨이 차고, 우리는 슈팅 거리가 가까워집니다.`
        : `양 팀이 상대 골문 앞을 비슷한 횟수로 밟았습니다. 앞쪽 점유만 보면 우열이 갈리지 않은 경기입니다. 이런 날은 중원에서 떨어진 공 싸움이 더 재미있습니다.`
    );

    paragraphs.push(
      `끊기지 않은 공격은 ${homeName} ${home.sequences.count}회(한 번에 평균 ${fmt(home.sequences.avgPasses, 2)}패스), ${awayName} ${away.sequences.count}회(평균 ${fmt(away.sequences.avgPasses, 2)}패스)입니다.`,
      `패스를 6번 이상 이은 긴 공격은 ${home.sequences.sustained}회 대 ${away.sequences.sustained}회입니다. 길게 이으면 상대를 끌어내지만, 끊기면 등 뒤가 허전해집니다.`,
      `그 공격이 슈팅으로 끝난 비율은 ${pctText(home.sequences.shotRate)} 대 ${pctText(away.sequences.shotRate)}입니다. 공격을 많이 해도 슈팅으로 안 끝나면, 문을 두드리기만 하고 초인종은 안 누른 겁니다.`,
      home.sequences.avgPasses > away.sequences.avgPasses + 0.8
        ? `${topic(homeName)} 공을 더 오래 쥐었습니다. 다만 그 소유가 슈팅으로 이어졌는지는 별개의 문제입니다. 공을 가진 시간과 골 냄새는 꼭 같이 가지 않습니다.`
        : `양 팀 모두 공을 길게 쥐기보다 빠르게 결론을 내려 했습니다. 템포가 빠른 경기는 보기엔 신나지만, 실수도 한 박자 빨리 나옵니다.`
    );

    return {
      id: "models",
      kicker: "01 · 어떤 경기를 하려 했나",
      title: "두 팀은 어떤 경기를 하려 했나",
      lead: "스코어는 결말입니다. 먼저 두 팀이 어떤 싸움을 하려 했는지부터 따라가 봅시다.",
      paragraphs,
      metrics: [
        chip("필드 틸트(골문 근처 점유)", pctText(tilt.home), pctText(tilt.away), "상대 골문 앞에서 공을 만진 비율"),
        chip("공격 횟수", `${home.sequences.count}회`, `${away.sequences.count}회`, "끊기지 않은 공격"),
        chip("한 번에 이은 패스", fmt(home.sequences.avgPasses, 2), fmt(away.sequences.avgPasses, 2), "높을수록 공을 오래 쥠"),
        chip("패스 평균 거리", `${fmt(home.progression.avgPassLength)}m`, `${fmt(away.progression.avgPassLength)}m`, "길수록 앞으로 길게 넘김"),
      ],
    };
  }

  function chapterShape(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const paragraphs = [];
    const hf = home.shape.formation;
    const af = away.shape.formation;

    paragraphs.push(
      `선발 11명이 90분 동안 서 있던 평균 자리를 세로로 묶으면, ${topic(homeName)} ${hf.label ? `${hf.label} 형태` : "뚜렷이 나뉘지 않는 형태"}로 보입니다.`,
      `${topic(awayName)} ${af.label ? `${af.label} 형태` : "뚜렷이 나뉘지 않는 형태"}입니다.`,
      `이건 감독이 칠판에 적은 숫자가 아닙니다. 선수들이 실제로 있던 자리의 평균입니다. 공식 포메이션과 다르다면, 그날 선수들이 지시를 살짝 어기며 경기를 풀어 갔다는 뜻입니다. 그 차이 자체가 정보입니다.`
    );

    paragraphs.push(
      `필드 선수들의 평균 위치는 ${homeName} ${fmt(home.shape.blockHeight)}, ${awayName} ${fmt(away.shape.blockHeight)}입니다. 숫자가 클수록 상대 골문 쪽에 더 가깝게 섰습니다.`,
      `가장 앞과 가장 뒤의 간격은 ${fmt(home.shape.depthSpread)} 대 ${fmt(away.shape.depthSpread)}, 좌우 폭은 ${fmt(home.shape.widthSpread)} 대 ${fmt(away.shape.widthSpread)}입니다.`,
      home.shape.depthSpread >= 30
        ? `${homeName}의 앞뒤 간격이 넓습니다. 쉽게 말하면 공격수와 수비수 사이가 벌어져, 가운데가 텅 비기 쉬운 그림입니다. 공을 잃는 순간 그 공간이 상대의 길이 됩니다.`
        : `${topic(homeName)} 앞뒤를 촘촘하게 유지했습니다. 간격이 좁은 팀은 공을 잃어도 덜 다칩니다. 옆 사람이 바로 도와줄 수 있거든요.`
    );

    const hTop = home.network.topPair;
    if (hTop && hTop.a && hTop.b) {
      paragraphs.push(
        `${homeName}에서 패스가 가장 많이 오간 조합은 ${hTop.a.name}(#${hTop.a.backNo})와 ${hTop.b.name}(#${hTop.b.backNo})입니다. ${hTop.count}회 연결됐습니다.`,
        hTop.a.position === "DF" && hTop.b.position === "DF"
          ? `두 명 모두 수비수입니다. 공 순환의 무게가 뒤에 머물렀다는 신호입니다. 점유율이 높아도, 그 대부분이 앞으로 가지 않는 소유였을 수 있습니다.`
          : `공 순환의 축이 수비 라인 앞에 있었습니다. 후방 전개가 실제로 한 칸 앞에서 이뤄졌다는 뜻입니다.`
      );
    }

    return {
      id: "shape",
      kicker: "02 · 실제로 선 자리",
      title: "실제로 서 있던 자리",
      lead: "평균 위치는 지시가 아니라 결과입니다. 선수들이 실제로 어디에 있었는지를 따라가 봅시다.",
      paragraphs,
      metrics: [
        chip("보이는 형태", hf.label || "-", af.label || "-", "평균 위치로 추정"),
        chip("평균 위치", fmt(home.shape.blockHeight), fmt(away.shape.blockHeight), "필드 선수 평균 자리"),
        chip("앞뒤 간격", fmt(home.shape.depthSpread), fmt(away.shape.depthSpread), "라인 사이가 얼마나 벌어졌는지"),
        chip("좌우 폭", fmt(home.shape.widthSpread), fmt(away.shape.widthSpread), "폭을 얼마나 썼는지"),
      ],
    };
  }

  function chapterBuildUp(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const paragraphs = [];
    const hp = home.progression;
    const ap = away.progression;

    paragraphs.push(
      `패스가 동료에게 간 비율은 ${homeName} ${pctText(hp.accuracy)}(${hp.completed}/${hp.passes}), ${awayName} ${pctText(ap.accuracy)}(${ap.completed}/${ap.passes})입니다.`,
      `다만 성공률만으로는 후방 전개의 질을 알 수 없습니다. 옆으로 돌린 패스도 성공은 성공이기 때문입니다. 성공률 높은 팀이 꼭 더 위험한 건 아닙니다.`
    );

    paragraphs.push(
      `앞으로 12m 이상 간 패스는 ${homeName} ${hp.progressive}회(전체의 ${pctText(hp.progressiveRate)}), ${awayName} ${ap.progressive}회(${pctText(ap.progressiveRate)})입니다.`,
      `뒤로 돌린 패스는 ${hp.backward}회 대 ${ap.backward}회입니다. 뒤로 돌리는 건 안전을 사는 선택이고, 앞으로 보내는 건 위험을 사는 선택입니다.`,
      hp.progressiveRate < ap.progressiveRate
        ? `${topic(homeName)} 패스 숫자는 많지만, 그중 앞으로 간 비중은 오히려 낮습니다. 공을 가지고 있는 것과 앞으로 보내는 것이 따로 논 전형적인 패턴입니다. 팬이 “볼은 많은데 왜 안 들어가?” 하고 답답해하는 바로 그 그림입니다.`
        : `${topic(homeName)} 공을 앞으로 바꾸는 비율에서도 앞섰습니다. 소유가 공격으로 번역된 날입니다.`
    );

    paragraphs.push(
      `25m 이상 긴 패스 비중은 ${homeName} ${pctText(hp.longRate)}, ${awayName} ${pctText(ap.longRate)}입니다.`,
      `왼쪽에서 오른쪽으로 크게 넘긴 패스는 ${hp.switches}회 대 ${ap.switches}회입니다. 반대편으로 크게 넘기면 상대가 뛰어와야 해서, 공간이 한순간에 열립니다.`,
      ap.longRate > hp.longRate + 4
        ? `${topic(awayName)} 압박을 받으면 앞으로 길게 걷어내는 선택을 더 자주 했습니다. 이건 도피가 아니라 설계일 수 있습니다. 떨어진 공을 누가 줍느냐가 이 팀의 승부처였습니다.`
        : `${topic(homeName)} 긴 패스 의존도가 상대보다 높았습니다. 앞선 압박을 정면으로 통과하지 못했다는 신호입니다. 막히면 길게 넘기는 건, 숨 고르기이기도 하고 항복이기도 합니다.`
    );

    return {
      id: "buildup",
      kicker: "03 · 공을 앞으로",
      title: "공을 앞으로 옮기는 방식",
      lead: "점유율은 수단입니다. 앞으로 갔는지가 목적입니다. 공을 오래 가진 팀이 꼭 더 위험한 건 아닙니다.",
      paragraphs,
      metrics: [
        chip("전진 패스(앞으로 간 패스)", `${hp.progressive} (${pctText(hp.progressiveRate)})`, `${ap.progressive} (${pctText(ap.progressiveRate)})`, "12m 이상 전방으로 이동"),
        chip("패스 성공률", pctText(hp.accuracy), pctText(ap.accuracy), "동료에게 공이 간 비율"),
        chip("긴 패스 비중", pctText(hp.longRate), pctText(ap.longRate), "25m 이상"),
        chip("좌우 전환", `${hp.switches}회`, `${ap.switches}회`, "반대편으로 크게 넘긴 패스"),
      ],
    };
  }

  function chapterFinalThird(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hp = home.progression;
    const ap = away.progression;
    const hs = home.shooting;
    const as = away.shooting;
    const paragraphs = [];

    paragraphs.push(
      `페널티박스 안으로 들어간 패스는 ${homeName} ${hp.intoBox}회, ${awayName} ${ap.intoBox}회입니다.`,
      `그중 측면에서 올린 크로스는 ${homeName} ${hp.crossIntoBox}회(${pctText(hp.crossShare)}), ${awayName} ${ap.crossIntoBox}회(${pctText(ap.crossShare)})입니다.`,
      `땅볼로 박스에 넣은 패스는 ${hp.groundIntoBox}회 대 ${ap.groundIntoBox}회입니다.`
    );

    paragraphs.push(
      `존 14(페널티박스 정면, 골문과 가장 가까운 가운데)로 들어간 패스는 ${homeName} ${hp.zone14}회, ${awayName} ${ap.zone14}회입니다.`,
      `키패스(슈팅으로 이어진 패스)는 ${hp.keyPasses}회 대 ${ap.keyPasses}회입니다.`,
      `여기를 통과하지 못하면 공격은 결국 바깥에서 돌게 됩니다.`
    );

    /* The central diagnostic: territory that never converts into shot value. */
    const crossHeavy = hp.crossShare >= 55 && hp.intoBox >= 20;
    const cheapShots = hs.avgXg > 0 && hs.avgXg < 0.1 && hs.shots >= 12;
    if (crossHeavy && cheapShots) {
      paragraphs.push(
        `여기서 이 경기의 핵심이 나옵니다. ${topic(homeName)} 박스 진입 ${hp.intoBox}회 중 ${hp.crossIntoBox}회를 크로스로 처리했습니다.`,
        `존 14(박스 정면)로 들어간 패스는 ${hp.zone14}회에 그쳤습니다. 골문과 가장 가까운 가운데를 잘 못 썼다는 뜻입니다.`,
        `그 결과가 슈팅 ${hs.shots}개입니다. 슈팅 하나당 평균은 ${xgTalk(hs.avgXg)}입니다.`,
        `하나하나의 자리가 이 정도면, 대부분이 수비수 사이에서 몸을 비틀어 때린 슈팅이라는 뜻입니다.`,
        `앞에서 공을 가졌는데도 골이 안 나오는 팀의 전형적인 실패 경로입니다. 문제는 '많이 못 만든 것'이 아니라 '어려운 자리에서 때린 것'입니다. 문을 여러 번 두드렸는데, 열쇠 구멍은 잘 못 찾은 날입니다.`
      );
    } else if (cheapShots) {
      paragraphs.push(
        `${topic(homeName)} 슈팅 ${hs.shots}개를 기록했지만, 하나당 평균은 ${xgTalk(hs.avgXg)}에 불과합니다.`,
        `${xgTalk(0.06)}보다 어려운 슈팅이 ${hs.poor}개(${pctText(hs.poorRate)})입니다. 슈팅 숫자는 착시일 수 있습니다.`
      );
    } else {
      paragraphs.push(
        `${homeName}의 슈팅 하나당 평균은 ${xgTalk(hs.avgXg)}, ${topic(awayName)} ${xgTalk(as.avgXg)}입니다.`,
        `박스 안 슈팅은 ${homeName} ${hs.box}/${hs.shots}, ${awayName} ${as.box}/${as.shots}입니다.`,
        `${subject(hs.avgXg >= as.avgXg ? homeName : awayName)} 더 좋은 자리에서 때렸습니다.`
      );
    }

    paragraphs.push(
      `박스 밖 슈팅은 ${homeName} ${hs.outside}개(${pctText(hs.outsideRate)}), ${awayName} ${as.outside}개(${pctText(as.outsideRate)})입니다.`,
      `골문 정면 가까운 자리에서 나온 슈팅은 ${hs.sixYard}개 대 ${as.sixYard}개입니다.`,
      `${xgTalk(0.25)} 이상의 결정적 기회는 ${hs.big}개 대 ${as.big}개였습니다.`
    );

    return {
      id: "final-third",
      kicker: "04 · 마지막 30m",
      title: "마지막 30m — 앞에서 공을 가졌는데 골이 안 난 이유",
      lead: "박스 안까지는 누구나 갑니다. 어떻게 들어갔는지가 골을 만듭니다. 앞에서 공을 가졌는데 골이 안 나면, 마지막 길이 막힌 겁니다.",
      paragraphs,
      metrics: [
        chip("박스 침투 패스", `${hp.intoBox}회`, `${ap.intoBox}회`, "박스 밖에서 박스 안으로"),
        chip("크로스 의존도", pctText(hp.crossShare), pctText(ap.crossShare), "박스 침투 중 크로스 비율"),
        chip("존 14(박스 정면)", `${hp.zone14}회`, `${ap.zone14}회`, "골문 앞 가운데 공간"),
        chip("슈팅당 xG", fmt(hs.avgXg, 2), fmt(as.avgXg, 2), "xG(같은 자리에서 100번 때리면 약 몇 골)"),
      ],
    };
  }

  function chapterPressing(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hp = home.pressing;
    const ap = away.pressing;
    const paragraphs = [];

    const ppdaText = (p) => (p.ppda === null ? "산출 불가" : fmt(p.ppda, 2));
    paragraphs.push(
      `PPDA(상대가 패스를 몇 번 하는 동안 우리가 한 번 달려들었는지)는 ${homeName} ${ppdaText(hp)}, ${awayName} ${ppdaText(ap)}입니다.`,
      `숫자가 낮을수록 상대가 몇 번 패스하기도 전에 달려들었다는 뜻입니다. 쉽게 말하면 “숨 돌릴 틈을 얼마나 안 줬나”입니다.`,
      hp.ppda !== null && ap.ppda !== null
        ? hp.ppda < ap.ppda
          ? `${topic(homeName)} 훨씬 공격적으로 압박했습니다. ${topic(awayName)} 상대에게 공을 내주고 기다리는 쪽을 택했습니다.`
          : `${topic(awayName)} 더 적극적으로 공을 뺏으러 나왔습니다.`
        : ""
    );

    paragraphs.push(
      `수비 액션의 평균 높이는 ${homeName} ${fmt(hp.defLineHeight)}, ${awayName} ${fmt(ap.defLineHeight)}입니다.`,
      `상대 진영에서 공을 되찾은 횟수는 ${hp.ballWonHigh}회(${pctText(hp.ballWonHighRate)}) 대 ${ap.ballWonHigh}회(${pctText(ap.ballWonHighRate)})입니다.`,
      hp.defLineHeight - ap.defLineHeight >= 8
        ? `${homeName}의 수비 개입 지점이 ${fmt(hp.defLineHeight - ap.defLineHeight)}만큼 더 앞입니다. 라인을 올려 상대를 가둔 대신, 등 뒤 공간은 계속 열려 있었다는 뜻이기도 합니다.`
        : `양 팀의 수비 개입 높이 차이는 크지 않습니다. 압박 라인보다는 선수 대 선수 싸움에서 승부가 갈렸습니다.`
    );

    const hTop = topLane(hp.laneDef, ctx.lanes);
    const aTop = topLane(ap.laneDef, ctx.lanes);
    paragraphs.push(
      `수비가 가장 자주 개입한 길은 ${subject(homeName)} ${hTop.lane.label}(${pctText(hTop.share)}), ${subject(awayName)} ${aTop.lane.label}(${pctText(aTop.share)})입니다.`,
      `한쪽 길에 수비가 몰렸다면, 상대가 그쪽을 계획적으로 공략했거나 그쪽 매치업이 무너지고 있었다는 신호입니다.`
    );

    return {
      id: "press",
      kicker: "05 · 압박",
      title: "어디서 압박하고, 어디서 공을 되찾았나",
      lead: "어디서 뺏느냐가 다음 공격의 출발점을 정합니다.",
      paragraphs,
      metrics: [
        chip("PPDA(압박 강도)", ppdaText(hp), ppdaText(ap), "낮을수록 강하게 눌렀음"),
        chip("수비 라인 높이", fmt(hp.defLineHeight), fmt(ap.defLineHeight), "수비 액션 평균 자리"),
        chip("높은 위치 회수", `${hp.ballWonHigh}회`, `${ap.ballWonHigh}회`, "상대 진영에서 공을 뺏음"),
        chip("압박 시도", `${hp.pressTotal}회`, `${ap.pressTotal}회`, "기록된 압박"),
      ],
    };
  }

  function chapterTransition(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hs = home.sequences;
    const as = away.sequences;
    const paragraphs = [];

    paragraphs.push(
      `공을 잡은 뒤 12초 안에 슈팅까지 간 공격은 ${homeName} ${hs.fastShots}회, ${awayName} ${as.fastShots}회입니다.`,
      `패스 두 번 이하로 끝낸 직선 슈팅은 ${hs.direct}회 대 ${as.direct}회입니다.`,
      `역습은 상대가 자리를 잡기 전이라, 같은 슈팅이라도 xG(골이 될 확률)이 높게 나오는 구간입니다. 상대가 “아직 안 모였어!” 하는 그 3초를 훔치는 싸움입니다.`
    );

    paragraphs.push(
      `공격이 시작된 평균 지점은 ${homeName} ${fmt(hs.avgStartX)}, ${awayName} ${fmt(as.avgStartX)}입니다.`,
      `상대 진영에서 시작된 공격 비율은 ${pctText(hs.startedHighRate)} 대 ${pctText(as.startedHighRate)}입니다.`,
      hs.startedHighRate > as.startedHighRate + 10
        ? `${topic(homeName)} 높은 곳에서 공격을 시작하는 횟수가 훨씬 많았습니다. 그런데도 결정력이 따라오지 않았다면, 문제는 '기회를 못 만든 것'이 아니라 '만든 상황을 마무리로 연결하지 못한 것'입니다.`
        : `공격 시작 지점의 높이는 두 팀이 비슷했습니다.`
    );

    return {
      id: "transition",
      kicker: "06 · 역습",
      title: "역습 — 상대가 자리를 잡기 전 3초",
      lead: "가장 값싼 골은 상대가 정렬하기 전에 나옵니다. 역습 한 방이 90분 점유보다 무거울 수 있습니다.",
      paragraphs,
      metrics: [
        chip("속공 슈팅", `${hs.fastShots}회`, `${as.fastShots}회`, "공 획득 12초 안 슈팅"),
        chip("직선 마무리", `${hs.direct}회`, `${as.direct}회`, "패스 2번 이하 슈팅"),
        chip("공격 시작 높이", fmt(hs.avgStartX), fmt(as.avgStartX), "공격이 시작된 평균 자리"),
        chip("높은 시작 비율", pctText(hs.startedHighRate), pctText(as.startedHighRate), "상대 진영에서 공격 시작"),
      ],
    };
  }

  function chapterMatchups(ctx) {
    const { matchups, homeName, awayName } = ctx;
    const paragraphs = [];
    const byEntry = [...matchups].sort((a, b) => b.homeAttack - a.homeAttack);
    const main = byEntry[0];

    const get = (key) => matchups.find((m) => m.lane.key === key) || { homeAttackShare: 0 };
    const wingShare = get("lw").homeAttackShare + get("rw").homeAttackShare;
    const leftShare = get("lw").homeAttackShare + get("lh").homeAttackShare;
    const rightShare = get("rw").homeAttackShare + get("rh").homeAttackShare;

    if (main && main.lane) {
      const spread = Math.abs(leftShare - rightShare);
      paragraphs.push(
        `${subject(homeName)} 상대 골문 앞 30m에 들어간 길을 다섯으로 나누면, 가장 많이 쓴 길은 ${main.lane.label}입니다.`,
        `${main.homeAttack}회, 전체의 ${pctText(main.homeAttackShare)}입니다.`,
        `왼쪽·오른쪽 측면을 합치면 ${pctText(wingShare)}입니다. 왼쪽 계열 ${pctText(leftShare)}, 오른쪽 계열 ${pctText(rightShare)}입니다.`,
        spread >= 12
          ? `한쪽으로 뚜렷하게 기울었습니다. 상대를 옆으로 밀어붙이기는 쉽지만, 반대쪽에 생기는 공간을 스스로 버리는 선택이기도 합니다.`
          : `좌우가 비교적 고르게 나뉘었습니다. 폭을 넓게 쓰긴 했지만, 어느 한쪽에서 결정적인 우위를 만들지는 못했다는 뜻입니다.`
      );
    }

    /*
     * The most revealing number is not where a team attacked, but how hard the
     * opponent worked to stop it. A channel with many entries and few
     * interventions was conceded on purpose.
     */
    const measured = matchups.filter((m) => m.homeAttack >= 8 && m.awayResistance !== null);
    if (measured.length >= 2) {
      const conceded = [...measured].sort((a, b) => a.awayResistance - b.awayResistance)[0];
      const guarded = [...measured].sort((a, b) => b.awayResistance - a.awayResistance)[0];
      if (conceded.lane.key !== guarded.lane.key) {
        paragraphs.push(
          `여기서 ${awayName}의 수비 의도가 드러납니다.`,
          `${conceded.lane.label}에서는 ${homeName}의 진입 ${conceded.homeAttack}회에 수비 개입이 ${conceded.awayDefend}회뿐입니다. 진입 1회당 ${fmt(conceded.awayResistance, 2)}회입니다.`,
          `${guarded.lane.label}에서는 진입 ${guarded.homeAttack}회에 ${guarded.awayDefend}회(1회당 ${fmt(guarded.awayResistance, 2)}회)로 대응했습니다.`,
          `${topic(awayName)} ${withObject(conceded.lane.label)} 내주고 ${withObject(guarded.lane.label)} 걸어 잠갔다는 뜻입니다.`,
          `골문 앞에 내려앉은 팀의 교과서적인 선택입니다. 상대 입장에서는 "많이 들어갔다"가 아니라 "허락된 곳으로만 들어갔다"가 정확한 표현입니다.`
        );
      }
    }

    const awayMain = [...matchups].sort((a, b) => b.awayAttack - a.awayAttack)[0];
    if (awayMain && awayMain.awayLane && awayMain.awayAttack > 0) {
      paragraphs.push(
        `${subject(awayName)} 상대 골문 앞에 들어간 길은, 자기 기준으로 ${subject(awayMain.awayLane.label)} ${awayMain.awayAttack}회(${pctText(awayMain.awayAttackShare)})로 가장 많았습니다.`,
        `${topic(homeName)} 그 길에서 ${awayMain.homeDefend}회 수비 개입했습니다.`,
        `상대가 같은 문을 반복해서 두드렸다면, 그 문을 닫는 것이 다음 맞대결 준비의 1순위입니다.`
      );
    }

    return {
      id: "matchups",
      kicker: "07 · 어느 길을",
      title: "어디를 내주고 어디를 잠갔나",
      lead: "경기는 필드 전체가 아니라 두세 개의 길에서 결정됩니다. 많이 들어간 길이 아니라, 허락된 길로만 들어갔을 수도 있습니다.",
      paragraphs,
      table: matchups.map((m) => ({
        lane: m.lane.label,
        homeAttack: m.homeAttack,
        homeShare: m.homeAttackShare,
        awayDefend: m.awayDefend,
        awayResistance: m.awayResistance,
        awayAttack: m.awayAttack,
        homeDefend: m.homeDefend,
      })),
    };
  }

  function chapterPhases(ctx) {
    const { phases, homeName, awayName, momentum } = ctx;
    const paragraphs = [];
    const { bestHome, bestAway } = phases;

    paragraphs.push(
      `15분 단위로 xG(골이 될 확률 합)을 끊어 보면, ${homeName}의 최고 구간은 ${bestHome.from}~${bestHome.to}분입니다. 그때 xG 합은 ${fmt(bestHome.home, 2)} 대 ${fmt(bestHome.away, 2)}입니다.`,
      `${awayName}의 최고 구간은 ${bestAway.from}~${bestAway.to}분입니다. 그때 확률 합은 ${fmt(bestAway.away, 2)} 대 ${fmt(bestAway.home, 2)}입니다.`,
      `경기 전체의 평균이 아니라, 이 구간들이 실제 승부가 움직인 시간대입니다.`
    );

    if (momentum.goals.length) {
      const g = momentum.goals
        .map((x) => `${x.minute}분 ${x.side === "home" ? homeName : awayName}${x.setPiece ? `(${x.setPiece})` : ""}`)
        .join(", ");
      paragraphs.push(
        `득점 시점은 ${g}입니다.`,
        `누적 xG(골이 될 확률 합)은 ${homeName} ${fmt(momentum.homeTotal, 2)}, ${awayName} ${fmt(momentum.awayTotal, 2)}로 끝났습니다.`,
        `곡선이 완만하게 오르는 팀은 기회를 꾸준히 쌓은 팀입니다. 계단처럼 뛰는 팀은 소수의 큰 기회로 승부한 팀입니다.`
      );
    }

    return {
      id: "phases",
      kicker: "08 · 시간대",
      title: "경기가 움직인 시간대",
      lead: "90분은 평균이 아니라 몇 개의 구간으로 이루어집니다. 경기가 움직인 15분을 찾으면, 그날 승부가 보입니다.",
      paragraphs,
    };
  }

  function chapterSetPieces(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hs = home.setPieces;
    const as = away.setPieces;
    const paragraphs = [];

    paragraphs.push(
      `코너킥은 ${homeName} ${hs.corners}개, ${awayName} ${as.corners}개입니다. 프리킥 상황은 ${hs.freeKicks}회 대 ${as.freeKicks}회입니다.`,
      `세트피스에서 나온 슈팅은 ${hs.setPieceShots}개(xG 합 ${fmt(hs.setPieceXg, 2)}) 대 ${as.setPieceShots}개(${fmt(as.setPieceXg, 2)})입니다.`
    );

    if (hs.corners >= 6 && hs.setPieceXg < 0.3) {
      paragraphs.push(
        `${topic(homeName)} 코너킥을 ${hs.corners}개나 얻고도 세트피스 xG(골이 될 확률 합)이 ${fmt(hs.setPieceXg, 2)}에 그쳤습니다.`,
        `흐름에서 막힌 팀에게 세트피스는 가장 값싼 득점 경로입니다. 여기서 확률이 쌓이지 않는다면 키커와 움직임 루틴을 다시 설계해야 합니다.`
      );
    } else if (as.penalties) {
      paragraphs.push(
        `${topic(awayName)} 페널티킥을 얻었습니다. PK 한 번은 ${xgTalk(0.78)}로, 흐름에서 만드는 열 번의 슈팅과 맞먹습니다.`,
        `박스 안에서의 파울 하나가 경기 전체의 계산을 바꿔 놓는 이유입니다.`
      );
    } else {
      paragraphs.push(
        `세트피스가 경기를 지배한 흔적은 크지 않습니다. 다만 접전에서는 이 영역이 가장 먼저 승부를 가릅니다.`
      );
    }

    return {
      id: "setpiece",
      kicker: "09 · 세트피스",
      title: "멈춰 선 공",
      lead: "흐름이 막힐수록 코너킥과 프리킥의 가치는 올라갑니다. 멈춰 선 공 하나가, 90분 싸움을 한순간에 끝낼 수 있습니다.",
      paragraphs,
      metrics: [
        chip("코너킥", `${hs.corners}개`, `${as.corners}개`, "획득 수"),
        chip("세트피스 슈팅", `${hs.setPieceShots}개`, `${as.setPieceShots}개`, "정지 상황에서 나온 슈팅"),
        chip("세트피스 xG(정지 상황 기대득점)", fmt(hs.setPieceXg, 2), fmt(as.setPieceXg, 2), "정지 상황 기대득점"),
        chip("프리킥 상황", `${hs.freeKicks}회`, `${as.freeKicks}회`, "기록된 프리킥"),
      ],
    };
  }

  function chapterIndividuals(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const paragraphs = [];
    const named = new Set();

    const rank = (list, key, min = 1) =>
      [...list].sort((a, b) => b.stat[key] - a.stat[key]).filter((p) => p.stat[key] >= min);
    const tag = (p) => `${p.name}(#${p.backNo}, ${p.role})`;

    const hub = rank(home.players, "touches")[0];
    if (hub) {
      named.add(hub.playerId);
      paragraphs.push(
        `${homeName}에서 공을 가장 많이 만진 선수는 ${tag(hub)}입니다.`,
        `평균 자리 ${fmt(hub.x)} / ${fmt(hub.y)}에서 ${hub.stat.touches}회 관여했고, 패스 성공률은 ${pctText(hub.stat.accuracy)}입니다.`,
        `팀의 템포가 이 선수의 첫 터치 방향에 따라 결정됐습니다.`
      );
    }

    const engines = rank(home.players, "progressive", 3);
    if (engines.length) {
      const first = engines[0];
      if (named.has(first.playerId)) {
        const second = engines.find((p) => !named.has(p.playerId));
        paragraphs.push(
          `전진 패스(앞으로 보내는 패스)도 같은 선수가 최다입니다(${first.name} ${first.stat.progressive}회).`,
          `공을 가장 많이 만지는 선수가 전진까지 책임진다는 건, 상대가 그 한 명만 지우면 후방 전개 전체가 멈춘다는 뜻입니다.`,
          second
            ? `두 번째 전진 통로는 ${tag(second)}의 ${second.stat.progressive}회였고, 이 격차가 곧 의존도입니다.`
            : `대체 경로가 사실상 없었습니다.`
        );
        if (second) named.add(second.playerId);
      } else {
        named.add(first.playerId);
        paragraphs.push(
          `전진 패스(앞으로 보내는 패스)를 실제로 담당한 선수는 ${tag(first)}입니다. 전진 패스 ${first.stat.progressive}회입니다.`,
          `공을 많이 만지는 선수와 앞으로 밀어내는 선수가 다르다면, 그 사이의 연결이 곧 팀의 병목입니다.`
        );
      }
    }

    const creator = rank(home.players, "keyPasses", 2)[0];
    if (creator) {
      const s = creator.stat;
      const crossHeavy = s.intoBox >= 6 && s.crosses / s.intoBox >= 0.7;
      paragraphs.push(
        `찬스를 만든 중심은 ${tag(creator)}입니다. 키패스 ${s.keyPasses}회, 박스 침투 패스 ${s.intoBox}회` +
          (s.crosses ? `(그중 크로스 ${s.crosses}회)` : "") +
          `입니다.`,
        crossHeavy
          ? `박스로 향한 전달이 사실상 전부 크로스였다는 점이 중요합니다. 이 선수를 막는 방법은 마크가 아니라 크로스 각도를 미리 지우는 것이고, 상대는 그걸 알고 있었습니다.`
          : `상대가 이 선수를 지우면 공격의 마지막 연결이 끊깁니다.`
      );
      named.add(creator.playerId);
    }

    const stopper = rank(home.players, "defActions", 5)[0];
    if (stopper) {
      paragraphs.push(
        `수비 부하는 ${tag(stopper)}에게 집중됐습니다. 수비 액션 ${stopper.stat.defActions}회, 공 회수 ${stopper.stat.ballWon}회입니다.`,
        `공격 가담이 잦은 선수에게 수비 회수까지 몰렸다면 체력 배분과 커버 구조를 함께 손봐야 합니다.`
      );
    }

    const danger = rank(away.players, "xg", 0.01)[0] || rank(away.players, "shots", 1)[0];
    if (danger) {
      paragraphs.push(
        `${awayName} 쪽 최대 위협은 ${tag(danger)}입니다.`,
        `슈팅 ${danger.stat.shots}회, xG(골이 될 확률 합) ${fmt(danger.stat.xg, 2)}, 득점 ${danger.stat.goals}골입니다.`,
        danger.stat.goals >= 2
          ? `한 선수에게 이 정도로 집중된 결과는 우연이 아니라 구조입니다. 이 선수가 공을 받는 첫 지점(평균 ${fmt(danger.x)} / ${fmt(danger.y)})을 어디서 끊을지부터 정해야 합니다.`
          : `다음 맞대결에서는 이 선수가 받는 첫 패스를 어디서 끊을지부터 정해야 합니다.`
      );
    }

    return {
      id: "individuals",
      kicker: "10 · 선수",
      title: "누가 무엇을 짊어졌나",
      lead: "시스템은 사람으로 실행됩니다. 공을 만진 사람, 앞으로 보낸 사람, 막아 선 사람을 따라가면 경기가 이야기로 바뀝니다.",
      paragraphs,
    };
  }

  function chapterPrescription(ctx) {
    const { home, away, homeName, awayName, meta } = ctx;
    const hp = home.progression;
    const hs = home.shooting;
    const as = away.shooting;
    const items = [];

    if (hp.crossShare >= 55 && hp.intoBox >= 15) {
      items.push(
        `크로스 의존을 낮춰야 합니다. 박스 침투 ${hp.intoBox}회 중 ${hp.crossIntoBox}회가 크로스였고, 존 14(박스 정면) 진입은 ${hp.zone14}회뿐입니다. 측면에서 올리기 전에 안쪽으로 한 번 접어 들어가는 3인 조합(윙어–중앙 미드–풀백 오버랩)을 훈련 우선순위로 잡아야 합니다.`
      );
    }
    if (hs.outsideRate >= 30 && hs.shots >= 12) {
      items.push(
        `박스 밖 슈팅 비중이 ${pctText(hs.outsideRate)}입니다. 그 자리에서는 슈팅 대신, 한 템포 더 가진 뒤 컷백 각도를 먼저 찾는 훈련이 필요합니다.`
      );
    }
    if (home.pressing.defLineHeight >= 44 && away.sequences.fastShots >= 5) {
      items.push(
        `높은 수비 라인(평균 ${fmt(home.pressing.defLineHeight)})을 유지하는 동안 상대에게 속공 슈팅 ${away.sequences.fastShots}회를 허용했습니다. 압박이 깨지는 순간의 커버링 미드필더 위치를 고정해 등 뒤 공간을 관리해야 합니다.`
      );
    }
    if (home.sequences.avgPasses >= 2.5 && hs.avgXg < 0.1) {
      items.push(
        `공을 가진 시간을 슈팅의 질로 바꾸는 마지막 단계가 비어 있습니다. 한 번에 이은 패스 ${fmt(home.sequences.avgPasses, 2)}회는 유지하되, 박스 진입 직전 2패스를 '땅볼·중앙·컷백'으로 제한하는 규칙을 적용해 볼 만합니다.`
      );
    }
    if (home.setPieces.corners >= 6 && home.setPieces.setPieceXg < 0.3) {
      items.push(
        `코너킥 ${home.setPieces.corners}개에서 세트피스 xG(골이 될 확률 합)이 ${fmt(home.setPieces.setPieceXg, 2)}입니다. 가까운 포스트로 꺾어 주는 움직임과, 떨어진 공 자리를 다시 짤 여지가 큽니다.`
      );
    }
    if (as.avgXg > hs.avgXg + 0.05) {
      items.push(
        `${topic(awayName)} 더 적은 슈팅으로 더 좋은 자리를 잡았습니다. ${topic(awayName)} ${xgTalk(as.avgXg)}, ${topic(homeName)} ${xgTalk(hs.avgXg)}. 상대가 어떤 길로 박스 중앙에 도달했는지 영상으로 되짚고, 그 길의 첫 단추를 차단하는 것이 수비 과제입니다.`
      );
    }
    if (!items.length) {
      items.push(
        "지표상 뚜렷한 구조적 결함은 보이지 않습니다. 이런 경기는 선수 대 선수 싸움과 마무리 편차가 결과를 가르므로, 세부 장면 단위의 복기가 더 유효합니다."
      );
    }

    const closing =
      meta?.score && meta.score.home !== undefined
        ? `최종 스코어 ${meta.score.home}-${meta.score.away}. 스코어는 하나의 결과일 뿐입니다. 위의 구조는 다음 경기에도 그대로 반복됩니다. 고쳐야 할 것은 결과가 아니라 경로입니다.`
        : "고쳐야 할 것은 결과가 아니라 경로입니다.";

    return {
      id: "prescription",
      kicker: "11 · 다음에 고칠 점",
      title: "다음 경기까지 무엇을 바꿀 것인가",
      lead: "분석의 목적은 설명이 아니라 다음 경기를 조금 더 잘 보는 것입니다.",
      paragraphs: items.concat([closing]),
    };
  }

  function build(ctx) {
    if (!ctx) throw new Error("전술 분석 컨텍스트가 없습니다.");
    const chapters = [];
    const builders = [
      chapterModels,
      chapterShape,
      chapterBuildUp,
      chapterFinalThird,
      chapterPressing,
      chapterTransition,
      chapterMatchups,
      chapterPhases,
      chapterSetPieces,
      chapterIndividuals,
      chapterPrescription,
    ];
    for (const fn of builders) {
      try {
        const ch = fn(ctx);
        if (ch && ch.paragraphs && ch.paragraphs.length) {
          ch.paragraphs = ch.paragraphs.filter((p) => String(p || "").trim());
          chapters.push(ch);
        }
      } catch (err) {
        /* One broken chapter must not take down the whole briefing. */
        console.error("[Analyst] chapter failed:", fn.name, err);
      }
    }
    return { chapters };
  }

  return { build, topic, subject, withObject };
})();

window.Analyst = Analyst;
