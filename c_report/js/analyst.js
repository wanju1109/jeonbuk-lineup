/*
 * Long-form tactical narrative generator.
 *
 * Consumes the metric context produced by Tactics.analyze() and turns it into
 * chapters written the way a first-team performance analyst would brief a
 * coaching staff: observation, mechanism, consequence. Every claim is bound to
 * a number that exists in the context, so nothing here is invented.
 */

const Analyst = (() => {
  /* Korean topic/subject particles depend on the final jamo of the noun. */
  function hasBatchim(word) {
    const s = String(word || "");
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
    if (seq.avgPasses >= 3.2 && prog.avgPassLength <= 19) return "짧은 패스로 상대를 끌어내는 점유 지향";
    if (seq.avgPasses <= 1.6 && prog.avgPassLength >= 20) return "1~2회 터치로 넘기는 다이렉트 지향";
    if (seq.avgPasses <= 2.2) return "빠르게 앞으로 내보내는 속공 지향";
    return "상황에 따라 점유와 직선 전개를 섞는 혼합형";
  }

  function pressModel(team) {
    const p = team.pressing;
    if (p.ppda !== null && p.ppda <= 9 && p.defLineHeight >= 44) return "전방에서 붙잡는 하이 프레스";
    if (p.ppda !== null && p.ppda <= 13) return "하프라인 위에서 조이는 미드 프레스";
    if (p.defLineHeight <= 33) return "자기 진영에 내려앉는 로우 블록";
    return "중원에 선을 긋는 미드 블록";
  }

  function chip(label, home, away, hint) {
    return { label, home, away, hint };
  }

  /* ------------------------------------------------------------------ */

  function chapterModels(ctx) {
    const { home, away, homeName, awayName, tilt } = ctx;
    const paragraphs = [];

    paragraphs.push(
      `${topic(homeName)} ${possessionModel(home)}, 수비 국면에서는 ${pressModel(home)}로 경기했습니다. ` +
        `${topic(awayName)} ${possessionModel(away)}에 ${pressModel(away)}입니다. ` +
        `두 팀의 의도가 정면으로 부딪힌 지점은 ${homeName}의 볼 소유를 ${awayName}가 어느 높이에서 끊으려 했느냐입니다.`
    );

    paragraphs.push(
      `공격 진영 터치 점유율(필드 틸트)은 ${homeName} ${pctText(tilt.home)} · ${awayName} ${pctText(tilt.away)}입니다. ` +
        `이 수치는 "누가 공을 오래 가졌나"가 아니라 "누가 상대 골문 근처에서 공을 만졌나"를 뜻합니다. ` +
        (Math.abs(tilt.home - 50) >= 15
          ? `${subject(tilt.home > tilt.away ? homeName : awayName)} 경기의 물리적 위치를 확실히 지배했습니다.`
          : `양 팀이 서로의 최종 3선을 비슷한 빈도로 밟았습니다. 영토로는 우열이 갈리지 않은 경기입니다.`)
    );

    paragraphs.push(
      `공격 전개 횟수는 ${homeName} ${home.sequences.count}회(평균 ${fmt(home.sequences.avgPasses, 2)}패스), ` +
        `${awayName} ${away.sequences.count}회(평균 ${fmt(away.sequences.avgPasses, 2)}패스). ` +
        `6패스 이상 이어진 '긴 전개'는 ${home.sequences.sustained}회 대 ${away.sequences.sustained}회이고, ` +
        `전개가 슈팅으로 끝난 비율은 ${pctText(home.sequences.shotRate)} 대 ${pctText(away.sequences.shotRate)}입니다. ` +
        (home.sequences.avgPasses > away.sequences.avgPasses + 0.8
          ? `${topic(homeName)} 공을 오래 쥐었지만, 그 소유가 슈팅으로 환산되는 효율은 별개의 문제입니다.`
          : `양 팀 모두 공을 길게 쥐기보다 빠르게 결론을 내려 했습니다.`)
    );

    return {
      id: "models",
      kicker: "01 · GAME MODEL",
      title: "두 팀은 어떤 경기를 하려 했나",
      lead: "먼저 의도를 읽습니다. 결과는 그 다음입니다.",
      paragraphs,
      metrics: [
        chip("필드 틸트", pctText(tilt.home), pctText(tilt.away), "공격 진영 터치 점유율"),
        chip("공격 전개", `${home.sequences.count}회`, `${away.sequences.count}회`, "끊기지 않은 공격 단위"),
        chip("전개당 패스", fmt(home.sequences.avgPasses, 2), fmt(away.sequences.avgPasses, 2), "높을수록 점유형"),
        chip("평균 패스 거리", `${fmt(home.progression.avgPassLength)}m`, `${fmt(away.progression.avgPassLength)}m`, "길수록 다이렉트"),
      ],
    };
  }

  function chapterShape(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const paragraphs = [];
    const hf = home.shape.formation;
    const af = away.shape.formation;

    paragraphs.push(
      `선발 11명의 평균 위치를 세로선으로 묶으면 ${homeName}은 ${hf.label ? `${hf.label} 형태` : "명확히 나뉘지 않는 형태"}, ` +
        `${awayName}는 ${af.label ? `${af.label} 형태` : "명확히 나뉘지 않는 형태"}로 관측됩니다. ` +
        `이건 감독이 칠판에 적은 숫자가 아니라, 90분 동안 선수들이 실제로 서 있던 자리의 평균입니다. ` +
        `공식 포메이션과 다르다면 그 차이 자체가 정보입니다.`
    );

    paragraphs.push(
      `블록 높이(필드 플레이어 평균 X)는 ${homeName} ${fmt(home.shape.blockHeight)} · ${awayName} ${fmt(away.shape.blockHeight)}입니다. ` +
        `팀의 세로 길이(최전방과 최후방 평균 위치의 간격)는 ${fmt(home.shape.depthSpread)} 대 ${fmt(away.shape.depthSpread)}, ` +
        `가로 폭은 ${fmt(home.shape.widthSpread)} 대 ${fmt(away.shape.widthSpread)}입니다. ` +
        (home.shape.depthSpread >= 30
          ? `${homeName}의 세로 간격이 넓다는 건 라인 사이 공간이 그만큼 열려 있었다는 뜻입니다. 공을 잃는 순간 그 공간이 그대로 상대의 활주로가 됩니다.`
          : `${homeName}은 블록을 촘촘하게 유지했습니다. 컴팩트한 팀은 잃어도 덜 다칩니다.`)
    );

    const hTop = home.network.topPair;
    if (hTop && hTop.a && hTop.b) {
      paragraphs.push(
        `${homeName}의 최다 연결 조합은 ${hTop.a.name}(#${hTop.a.backNo}) ↔ ${hTop.b.name}(#${hTop.b.backNo}) ${hTop.count}회입니다. ` +
          (hTop.a.position === "DF" && hTop.b.position === "DF"
            ? `두 명 모두 수비 라인입니다. 볼 순환의 무게중심이 뒤에 머물렀다는 신호이고, 점유율 수치가 높아도 그 대부분이 '전진하지 않는 소유'였을 가능성을 시사합니다.`
            : `볼 순환의 축이 수비 라인 밖에 있었다는 점은 긍정적입니다. 빌드업이 실제로 한 칸 앞에서 이뤄졌다는 뜻입니다.`)
      );
    }

    return {
      id: "shape",
      kicker: "02 · SHAPE",
      title: "실제로 서 있던 자리 — 관측 포메이션",
      lead: "평균 위치는 거짓말을 하지 않습니다. 지시가 아니라 결과이기 때문입니다.",
      paragraphs,
      metrics: [
        chip("관측 형태", hf.label || "-", af.label || "-", "평균 위치 기반 추정"),
        chip("블록 높이", fmt(home.shape.blockHeight), fmt(away.shape.blockHeight), "필드 플레이어 평균 X"),
        chip("세로 간격", fmt(home.shape.depthSpread), fmt(away.shape.depthSpread), "라인 사이 늘어짐"),
        chip("가로 폭", fmt(home.shape.widthSpread), fmt(away.shape.widthSpread), "폭 사용 범위"),
      ],
    };
  }

  function chapterBuildUp(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const paragraphs = [];
    const hp = home.progression;
    const ap = away.progression;

    paragraphs.push(
      `패스 성공률은 ${homeName} ${pctText(hp.accuracy)}(${hp.completed}/${hp.passes}), ` +
        `${awayName} ${pctText(ap.accuracy)}(${ap.completed}/${ap.passes})입니다. ` +
        `다만 성공률만으로는 빌드업의 질을 알 수 없습니다. 옆으로 돌린 패스도 성공은 성공이기 때문입니다.`
    );

    paragraphs.push(
      `전진 패스(12m 이상 전방으로 이동한 패스)는 ${homeName} ${hp.progressive}회로 전체의 ${pctText(hp.progressiveRate)}, ` +
        `${awayName} ${ap.progressive}회로 ${pctText(ap.progressiveRate)}입니다. ` +
        `뒤로 돌린 패스는 ${hp.backward}회 대 ${ap.backward}회. ` +
        (hp.progressiveRate < ap.progressiveRate
          ? `${topic(homeName)} 패스 총량은 많지만 그중 앞으로 나아간 비중은 오히려 낮습니다. 볼을 '가지고 있는 것'과 '전진시키는 것'이 분리된 전형적인 패턴입니다.`
          : `${topic(homeName)} 소유를 전진으로 바꾸는 비율에서도 앞섰습니다.`)
    );

    paragraphs.push(
      `긴 패스(25m 이상) 비중은 ${homeName} ${pctText(hp.longRate)}, ${awayName} ${pctText(ap.longRate)}이고, ` +
        `좌우 전환 패스는 ${hp.switches}회 대 ${ap.switches}회입니다. ` +
        (ap.longRate > hp.longRate + 4
          ? `${topic(awayName)} 압박을 받으면 앞으로 길게 걷어내는 선택을 더 자주 했습니다. 이건 도피가 아니라 설계일 수 있습니다. 세컨드 볼을 누가 줍느냐가 이 팀의 승부처였습니다.`
          : `${topic(homeName)} 긴 패스 의존도가 상대보다 높았습니다. 1선 압박을 정면으로 통과하지 못했다는 방증입니다.`)
    );

    return {
      id: "buildup",
      kicker: "03 · BUILD-UP",
      title: "볼을 앞으로 옮기는 방식",
      lead: "점유율은 수단입니다. 전진했는지가 목적입니다.",
      paragraphs,
      metrics: [
        chip("전진 패스", `${hp.progressive} (${pctText(hp.progressiveRate)})`, `${ap.progressive} (${pctText(ap.progressiveRate)})`, "12m 이상 전방 이동"),
        chip("패스 성공률", pctText(hp.accuracy), pctText(ap.accuracy), "연결 정확도"),
        chip("롱패스 비중", pctText(hp.longRate), pctText(ap.longRate), "25m 이상"),
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
      `박스 안으로 들어간 패스는 ${homeName} ${hp.intoBox}회, ${awayName} ${ap.intoBox}회입니다. ` +
        `그중 측면에서 올린 크로스성 전달이 ${homeName} ${hp.crossIntoBox}회(${pctText(hp.crossShare)}), ` +
        `${awayName} ${ap.crossIntoBox}회(${pctText(ap.crossShare)})이고, ` +
        `땅볼로 박스에 꽂아 넣은 패스는 ${hp.groundIntoBox}회 대 ${ap.groundIntoBox}회입니다.`
    );

    paragraphs.push(
      `박스 정면 포켓(이른바 존 14)으로 진입한 패스는 ${homeName} ${hp.zone14}회, ${awayName} ${ap.zone14}회. ` +
        `찬스로 이어진 키패스는 ${hp.keyPasses}회 대 ${ap.keyPasses}회입니다. ` +
        `존 14는 골문과 가장 가까운 '생각할 수 있는 공간'입니다. 여기를 통과하지 못하면 공격은 결국 바깥에서 돌게 됩니다.`
    );

    /* The central diagnostic: territory that never converts into shot value. */
    const crossHeavy = hp.crossShare >= 55 && hp.intoBox >= 20;
    const cheapShots = hs.avgXg > 0 && hs.avgXg < 0.1 && hs.shots >= 12;
    if (crossHeavy && cheapShots) {
      paragraphs.push(
        `여기서 이 경기의 핵심 진단이 나옵니다. ${topic(homeName)} 박스 진입 ${hp.intoBox}회 중 ${hp.crossIntoBox}회를 크로스로 처리했고, ` +
          `존 14 진입은 ${hp.zone14}회에 그쳤습니다. 그 결과가 슈팅 ${hs.shots}개에 평균 xG ${fmt(hs.avgXg, 3)}입니다. ` +
          `슈팅 하나하나의 기대값이 ${fmt(hs.avgXg * 100, 1)}%라는 건, 대부분이 수비수 사이에서 몸을 비틀어 때린 슈팅이라는 뜻입니다. ` +
          `점유와 영토를 가져오고도 골이 나오지 않는 팀의 전형적인 실패 경로입니다. 문제는 '많이 못 만든 것'이 아니라 '싸구려로 만든 것'입니다.`
      );
    } else if (cheapShots) {
      paragraphs.push(
        `${topic(homeName)} 슈팅 ${hs.shots}개를 기록했지만 평균 xG는 ${fmt(hs.avgXg, 3)}에 불과합니다. ` +
          `xG 0.06 미만의 '희망 슈팅'이 ${hs.poor}개(${pctText(hs.poorRate)})입니다. 슈팅 수는 지표가 아니라 착시일 수 있습니다.`
      );
    } else {
      paragraphs.push(
        `${homeName}의 슈팅 평균 xG는 ${fmt(hs.avgXg, 3)}, ${awayName}는 ${fmt(as.avgXg, 3)}입니다. ` +
          `박스 안 슈팅 비중은 ${homeName} ${hs.box}/${hs.shots}, ${awayName} ${as.box}/${as.shots}로, ` +
          `${subject(hs.avgXg >= as.avgXg ? homeName : awayName)} 더 좋은 자리에서 때렸습니다.`
      );
    }

    paragraphs.push(
      `박스 밖 슈팅은 ${homeName} ${hs.outside}개(${pctText(hs.outsideRate)}), ${awayName} ${as.outside}개(${pctText(as.outsideRate)}). ` +
        `골문 정면 6야드 부근에서 나온 슈팅은 ${hs.sixYard}개 대 ${as.sixYard}개입니다. ` +
        `xG 0.25 이상의 결정적 기회는 ${hs.big}개 대 ${as.big}개였습니다.`
    );

    return {
      id: "final-third",
      kicker: "04 · FINAL THIRD",
      title: "마지막 30m — 영토를 골로 바꾸지 못한 이유",
      lead: "박스 안까지는 누구나 갑니다. 어떻게 들어갔는지가 골을 만듭니다.",
      paragraphs,
      metrics: [
        chip("박스 침투 패스", `${hp.intoBox}회`, `${ap.intoBox}회`, "박스 밖 → 박스 안"),
        chip("크로스 의존도", pctText(hp.crossShare), pctText(ap.crossShare), "박스 침투 중 크로스 비율"),
        chip("존 14 진입", `${hp.zone14}회`, `${ap.zone14}회`, "박스 정면 포켓"),
        chip("슈팅당 xG", fmt(hs.avgXg, 3), fmt(as.avgXg, 3), "기회의 품질"),
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
      `PPDA(상대에게 허용한 패스 ÷ 우리 수비 액션)는 ${homeName} ${ppdaText(hp)}, ${awayName} ${ppdaText(ap)}입니다. ` +
        `숫자가 낮을수록 상대가 몇 번 패스하기도 전에 달려들었다는 뜻입니다. ` +
        (hp.ppda !== null && ap.ppda !== null
          ? hp.ppda < ap.ppda
            ? `${topic(homeName)} 훨씬 공격적으로 압박했고, ${topic(awayName)} 상대에게 볼을 내주고 기다리는 쪽을 택했습니다.`
            : `${topic(awayName)} 더 적극적으로 볼을 뺏으러 나왔습니다.`
          : "")
    );

    paragraphs.push(
      `수비 액션의 평균 높이는 ${homeName} ${fmt(hp.defLineHeight)}, ${awayName} ${fmt(ap.defLineHeight)}입니다. ` +
        `상대 진영(X 60 이상)에서 볼을 되찾은 횟수는 ${hp.ballWonHigh}회(${pctText(hp.ballWonHighRate)}) 대 ${ap.ballWonHigh}회(${pctText(ap.ballWonHighRate)}). ` +
        (hp.defLineHeight - ap.defLineHeight >= 8
          ? `${homeName}의 수비 개입 지점이 ${fmt(hp.defLineHeight - ap.defLineHeight)}만큼 더 높습니다. 라인을 올려 상대를 가둔 대신, 등 뒤 공간은 계속 열려 있었다는 뜻이기도 합니다.`
          : `양 팀의 수비 개입 높이 차이는 크지 않습니다. 압박 라인보다는 개별 매치업에서 승부가 갈렸습니다.`)
    );

    const hTop = topLane(hp.laneDef, ctx.lanes);
    const aTop = topLane(ap.laneDef, ctx.lanes);
    paragraphs.push(
      `수비 개입이 가장 잦았던 통로는 ${homeName}이 ${hTop.lane.label}(${pctText(hTop.share)}), ` +
        `${awayName}가 ${aTop.lane.label}(${pctText(aTop.share)})입니다. ` +
        `한쪽 통로에 수비 부하가 몰렸다면, 상대가 그쪽을 계획적으로 공략했거나 그쪽 매치업이 무너지고 있었다는 신호입니다.`
    );

    return {
      id: "press",
      kicker: "05 · PRESSING",
      title: "압박의 높이와 되찾는 지점",
      lead: "어디서 뺏느냐가 다음 공격의 출발점을 결정합니다.",
      paragraphs,
      metrics: [
        chip("PPDA", ppdaText(hp), ppdaText(ap), "낮을수록 강한 압박"),
        chip("수비 라인 높이", fmt(hp.defLineHeight), fmt(ap.defLineHeight), "수비 액션 평균 X"),
        chip("높은 위치 회수", `${hp.ballWonHigh}회`, `${ap.ballWonHigh}회`, "상대 진영 볼 탈취"),
        chip("압박 시도", `${hp.pressTotal}회`, `${ap.pressTotal}회`, "기록된 압박 액션"),
      ],
    };
  }

  function chapterTransition(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hs = home.sequences;
    const as = away.sequences;
    const paragraphs = [];

    paragraphs.push(
      `볼을 잡은 뒤 12초 안에 슈팅까지 간 전개는 ${homeName} ${hs.fastShots}회, ${awayName} ${as.fastShots}회입니다. ` +
        `2패스 이하로 끝낸 직선적 슈팅은 ${hs.direct}회 대 ${as.direct}회. ` +
        `전환은 조직이 갖춰지기 전의 국면이라, 같은 슈팅이라도 기대값이 높게 나오는 구간입니다.`
    );

    paragraphs.push(
      `공격 전개가 시작된 평균 지점은 ${homeName} X ${fmt(hs.avgStartX)}, ${awayName} X ${fmt(as.avgStartX)}이고, ` +
        `상대 진영(X 60 이상)에서 시작된 전개 비율은 ${pctText(hs.startedHighRate)} 대 ${pctText(as.startedHighRate)}입니다. ` +
        (hs.startedHighRate > as.startedHighRate + 10
          ? `${topic(homeName)} 높은 곳에서 공격을 시작하는 횟수가 훨씬 많았습니다. 그런데도 결정력이 따라오지 않았다면, 문제는 '기회를 못 만든 것'이 아니라 '만든 상황을 마무리 구조로 연결하지 못한 것'입니다.`
          : `공격 시작 지점의 높이는 두 팀이 비슷했습니다.`)
    );

    return {
      id: "transition",
      kicker: "06 · TRANSITION",
      title: "전환 — 조직이 무너진 3초",
      lead: "가장 값싼 골은 상대가 정렬하기 전에 나옵니다.",
      paragraphs,
      metrics: [
        chip("속공 슈팅", `${hs.fastShots}회`, `${as.fastShots}회`, "볼 획득 12초 내 슈팅"),
        chip("직선 마무리", `${hs.direct}회`, `${as.direct}회`, "2패스 이하 슈팅"),
        chip("전개 시작 높이", fmt(hs.avgStartX), fmt(as.avgStartX), "공격 시작 평균 X"),
        chip("높은 시작 비율", pctText(hs.startedHighRate), pctText(as.startedHighRate), "상대 진영 전개 시작"),
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
        `${homeName}의 최종 3선 진입을 다섯 통로로 나누면 가장 많이 쓴 길은 ${main.lane.label}입니다` +
          `(${main.homeAttack}회, ${pctText(main.homeAttackShare)}). ` +
          `측면 두 통로의 합은 ${pctText(wingShare)}, 왼쪽 계열 ${pctText(leftShare)} 대 오른쪽 계열 ${pctText(rightShare)}로 ` +
          (spread >= 12
            ? `한쪽으로 뚜렷하게 기울었습니다. 상대 블록을 옆으로 밀어붙이기는 쉽지만, 반대쪽에 생기는 공간을 스스로 버리는 선택이기도 합니다.`
            : `좌우가 비교적 고르게 나뉘었습니다. 폭을 넓게 쓰긴 했지만, 어느 한쪽에서 결정적인 우위를 만들지는 못했다는 뜻입니다.`)
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
          `여기서 ${awayName}의 수비 의도가 드러납니다. ${conceded.lane.label}에서는 ${homeName}의 진입 ${conceded.homeAttack}회에 대해 ` +
            `수비 개입이 ${conceded.awayDefend}회(진입 1회당 ${fmt(conceded.awayResistance, 2)}회)뿐이었지만, ` +
            `${guarded.lane.label}에서는 진입 ${guarded.homeAttack}회에 ${guarded.awayDefend}회(1회당 ${fmt(guarded.awayResistance, 2)}회)로 대응했습니다. ` +
            `${topic(awayName)} ${withObject(conceded.lane.label)} 내주고 ${withObject(guarded.lane.label)} 걸어 잠갔다는 뜻입니다. ` +
            `로우 블록의 교과서적인 선택이고, 상대 입장에서는 "많이 들어갔다"가 아니라 "허락된 곳으로만 들어갔다"가 정확한 표현입니다.`
        );
      }
    }

    const awayMain = [...matchups].sort((a, b) => b.awayAttack - a.awayAttack)[0];
    if (awayMain && awayMain.awayLane && awayMain.awayAttack > 0) {
      paragraphs.push(
        `${awayName}의 최종 3선 진입은 자기 기준 ${awayMain.awayLane.label}에 ${awayMain.awayAttack}회(${pctText(awayMain.awayAttackShare)})로 가장 많았고, ` +
          `${topic(homeName)} 그 통로에서 ${awayMain.homeDefend}회 수비 개입했습니다. ` +
          `상대가 반복해서 같은 문을 두드렸다면, 그 문을 닫는 것이 다음 맞대결 준비의 1순위입니다.`
      );
    }

    return {
      id: "matchups",
      kicker: "07 · MATCH-UPS",
      title: "통로별 매치업 — 어디를 내주고 어디를 잠갔나",
      lead: "경기는 필드 전체가 아니라 두세 개의 통로에서 결정됩니다.",
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
      `15분 단위로 기대득점을 끊어 보면, ${homeName}의 최고 구간은 ${bestHome.from}~${bestHome.to}분(xG ${fmt(bestHome.home, 2)} 대 ${fmt(bestHome.away, 2)}), ` +
        `${awayName}의 최고 구간은 ${bestAway.from}~${bestAway.to}분(xG ${fmt(bestAway.away, 2)} 대 ${fmt(bestAway.home, 2)})입니다. ` +
        `경기 전체의 평균이 아니라 이 구간들이 실제 승부가 움직인 시간대입니다.`
    );

    if (momentum.goals.length) {
      const g = momentum.goals
        .map((x) => `${x.minute}분 ${x.side === "home" ? homeName : awayName}${x.setPiece ? `(${x.setPiece})` : ""}`)
        .join(", ");
      paragraphs.push(
        `득점 시점은 ${g}입니다. 누적 xG는 ${homeName} ${fmt(momentum.homeTotal, 2)} · ${awayName} ${fmt(momentum.awayTotal, 2)}로 끝났습니다. ` +
          `누적 곡선이 완만하게 오르는 팀은 기회를 꾸준히 쌓은 팀이고, 계단처럼 뛰는 팀은 소수의 큰 기회로 승부한 팀입니다.`
      );
    }

    return {
      id: "phases",
      kicker: "08 · PHASES",
      title: "경기가 움직인 시간대",
      lead: "90분은 평균이 아니라 몇 개의 구간으로 이루어집니다.",
      paragraphs,
    };
  }

  function chapterSetPieces(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hs = home.setPieces;
    const as = away.setPieces;
    const paragraphs = [];

    paragraphs.push(
      `코너킥은 ${homeName} ${hs.corners}개 · ${awayName} ${as.corners}개, 프리킥 상황은 ${hs.freeKicks}회 대 ${as.freeKicks}회입니다. ` +
        `세트피스에서 나온 슈팅은 ${hs.setPieceShots}개(xG ${fmt(hs.setPieceXg, 2)}) 대 ${as.setPieceShots}개(xG ${fmt(as.setPieceXg, 2)}).`
    );

    if (hs.corners >= 6 && hs.setPieceXg < 0.3) {
      paragraphs.push(
        `${topic(homeName)} 코너킥을 ${hs.corners}개나 얻고도 세트피스 기대득점이 ${fmt(hs.setPieceXg, 2)}에 그쳤습니다. ` +
          `흐름에서 막힌 팀에게 세트피스는 가장 값싼 득점 경로입니다. 여기서 xG가 쌓이지 않는다면 루틴 자체를 다시 설계해야 합니다.`
      );
    } else if (as.penalties) {
      paragraphs.push(
        `${topic(awayName)} 페널티킥을 얻었습니다. PK 한 번의 기대득점은 약 0.78로, 흐름에서 만드는 열 번의 슈팅과 맞먹습니다. ` +
          `박스 안에서의 파울 하나가 경기 전체의 계산을 바꿔 놓는 이유입니다.`
      );
    } else {
      paragraphs.push(
        `세트피스가 경기를 지배한 흔적은 크지 않습니다. 다만 접전에서는 이 영역이 가장 먼저 승부를 가릅니다.`
      );
    }

    return {
      id: "setpiece",
      kicker: "09 · SET PIECES",
      title: "정지된 볼",
      lead: "흐름이 막힐수록 세트피스의 가치는 올라갑니다.",
      paragraphs,
      metrics: [
        chip("코너킥", `${hs.corners}개`, `${as.corners}개`, "획득 수"),
        chip("세트피스 슈팅", `${hs.setPieceShots}개`, `${as.setPieceShots}개`, "정지 상황 발생 슈팅"),
        chip("세트피스 xG", fmt(hs.setPieceXg, 2), fmt(as.setPieceXg, 2), "정지 상황 기대득점"),
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
        `${homeName}의 볼 순환 허브는 ${tag(hub)}입니다. ` +
          `평균 위치 X ${fmt(hub.x)} / Y ${fmt(hub.y)}에서 ${hub.stat.touches}회 관여했고 패스 성공률은 ${pctText(hub.stat.accuracy)}입니다. ` +
          `팀의 템포가 이 선수의 첫 터치 방향에 따라 결정됐습니다.`
      );
    }

    const engines = rank(home.players, "progressive", 3);
    if (engines.length) {
      const first = engines[0];
      if (named.has(first.playerId)) {
        const second = engines.find((p) => !named.has(p.playerId));
        paragraphs.push(
          `전진 패스도 같은 선수가 최다입니다(${first.name} ${first.stat.progressive}회). ` +
            `볼을 가장 많이 만지는 선수가 전진까지 책임진다는 건, 상대가 그 한 명만 지우면 빌드업 전체가 멈춘다는 뜻입니다. ` +
            (second
              ? `두 번째 전진 통로는 ${tag(second)}의 ${second.stat.progressive}회였고, 이 격차가 곧 의존도입니다.`
              : `대체 경로가 사실상 없었습니다.`)
        );
        if (second) named.add(second.playerId);
      } else {
        named.add(first.playerId);
        paragraphs.push(
          `전진을 실제로 담당한 선수는 ${tag(first)}으로 전진 패스 ${first.stat.progressive}회를 기록했습니다. ` +
            `볼을 많이 만지는 선수와 앞으로 밀어내는 선수가 다르다면, 그 사이의 연결 고리가 곧 팀의 병목입니다.`
        );
      }
    }

    const creator = rank(home.players, "keyPasses", 2)[0];
    if (creator) {
      const s = creator.stat;
      const crossHeavy = s.intoBox >= 6 && s.crosses / s.intoBox >= 0.7;
      paragraphs.push(
        `찬스 창출의 중심은 ${tag(creator)}입니다. 키패스 ${s.keyPasses}회, 박스 침투 패스 ${s.intoBox}회` +
          (s.crosses ? `(그중 크로스 ${s.crosses}회)` : "") +
          `. ` +
          (crossHeavy
            ? `박스로 향한 전달이 사실상 전부 크로스였다는 점이 중요합니다. 이 선수를 막는 방법은 마크가 아니라 크로스 각도를 미리 지우는 것이고, 상대는 그걸 알고 있었습니다.`
            : `상대가 이 선수를 지우면 공격의 마지막 연결이 끊깁니다.`)
      );
      named.add(creator.playerId);
    }

    const stopper = rank(home.players, "defActions", 5)[0];
    if (stopper) {
      paragraphs.push(
        `수비 부하는 ${tag(stopper)}에게 집중됐습니다. 수비 액션 ${stopper.stat.defActions}회, 볼 회수 ${stopper.stat.ballWon}회입니다. ` +
          `공격 가담이 잦은 선수에게 수비 회수까지 몰렸다면 체력 배분과 커버 구조를 함께 손봐야 합니다.`
      );
    }

    const danger = rank(away.players, "xg", 0.01)[0] || rank(away.players, "shots", 1)[0];
    if (danger) {
      paragraphs.push(
        `${awayName} 쪽 최대 위협은 ${tag(danger)}입니다. ` +
          `슈팅 ${danger.stat.shots}회, xG ${fmt(danger.stat.xg, 2)}, 득점 ${danger.stat.goals}골. ` +
          (danger.stat.goals >= 2
            ? `한 선수에게 이 정도로 집중된 결과는 우연이 아니라 구조입니다. 이 선수가 공을 받는 첫 지점(평균 X ${fmt(danger.x)} / Y ${fmt(danger.y)})을 어디서 끊을지부터 정해야 합니다.`
            : `다음 맞대결에서는 이 선수가 받는 첫 패스를 어디서 끊을지부터 정해야 합니다.`)
      );
    }

    return {
      id: "individuals",
      kicker: "10 · INDIVIDUALS",
      title: "역할과 부하 — 누가 무엇을 짊어졌나",
      lead: "시스템은 사람으로 실행됩니다.",
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
        `크로스 의존을 낮춰야 합니다. 박스 침투 ${hp.intoBox}회 중 ${hp.crossIntoBox}회가 크로스였고 존 14 진입은 ${hp.zone14}회뿐입니다. ` +
          `측면에서 올리기 전에 하프스페이스로 한 번 접어 들어가는 3인 조합(윙어–인사이드 MF–풀백 오버랩)을 훈련 우선순위로 잡아야 합니다.`
      );
    }
    if (hs.outsideRate >= 30 && hs.shots >= 12) {
      items.push(
        `박스 밖 슈팅 비중이 ${pctText(hs.outsideRate)}입니다. 슈팅 선택 기준을 팀 원칙으로 명문화하고, ` +
          `그 자리에서는 슈팅 대신 컷백 각도를 먼저 찾는 훈련이 필요합니다.`
      );
    }
    if (home.pressing.defLineHeight >= 44 && away.sequences.fastShots >= 5) {
      items.push(
        `높은 수비 라인(평균 X ${fmt(home.pressing.defLineHeight)})을 유지하는 동안 상대에게 속공 슈팅 ${away.sequences.fastShots}회를 허용했습니다. ` +
          `압박이 깨지는 순간의 커버링 미드필더 위치를 고정해 등 뒤 공간을 관리해야 합니다.`
      );
    }
    if (home.sequences.avgPasses >= 2.5 && hs.avgXg < 0.1) {
      items.push(
        `소유를 슈팅 품질로 환산하는 마지막 단계가 비어 있습니다. 전개당 패스 ${fmt(home.sequences.avgPasses, 2)}회를 유지하되, ` +
          `박스 진입 직전 2패스를 '땅볼·중앙·컷백'으로 제한하는 규칙을 적용해 볼 만합니다.`
      );
    }
    if (home.setPieces.corners >= 6 && home.setPieces.setPieceXg < 0.3) {
      items.push(
        `코너킥 ${home.setPieces.corners}개에서 세트피스 xG ${fmt(home.setPieces.setPieceXg, 2)}입니다. 니어포스트 플릭·세컨드 볼 배치를 재설계할 여지가 큽니다.`
      );
    }
    if (as.avgXg > hs.avgXg + 0.05) {
      items.push(
        `${topic(awayName)} 더 적은 슈팅으로 더 좋은 자리를 잡았습니다(슈팅당 xG ${fmt(as.avgXg, 3)} 대 ${fmt(hs.avgXg, 3)}). ` +
          `상대가 어떤 경로로 박스 중앙에 도달했는지 영상으로 되짚고, 그 경로의 첫 단추를 차단하는 것이 수비 과제입니다.`
      );
    }
    if (!items.length) {
      items.push(
        "지표상 뚜렷한 구조적 결함은 보이지 않습니다. 이런 경기는 개별 매치업과 결정력 편차가 결과를 가르므로, 세부 장면 단위의 복기가 더 유효합니다."
      );
    }

    const closing =
      meta?.score && meta.score.home !== undefined
        ? `최종 스코어 ${meta.score.home}-${meta.score.away}. 스코어는 하나의 결과일 뿐이고, 위의 구조는 다음 경기에도 그대로 반복됩니다. 고쳐야 할 것은 결과가 아니라 경로입니다.`
        : "고쳐야 할 것은 결과가 아니라 경로입니다.";

    return {
      id: "prescription",
      kicker: "11 · PRESCRIPTION",
      title: "전력분석관 처방 — 다음 경기까지 무엇을 바꿀 것인가",
      lead: "분석의 목적은 설명이 아니라 개선입니다.",
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
        if (ch && ch.paragraphs && ch.paragraphs.length) chapters.push(ch);
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
