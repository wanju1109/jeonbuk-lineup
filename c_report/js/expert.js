/*
 * Staff briefing for readers who already know the vocabulary.
 *
 * Consumes Tactics.analyze() (including the expert profile) and writes the
 * way a positional-play analyst would debrief a first-team meeting: thesis,
 * mechanism, number, implication. No beginner glosses. Every claim is tied
 * to a figure that exists on the context object.
 */

const ExpertAnalyst = (() => {
  function topic(word) {
    if (window.Analyst && typeof Analyst.topic === "function") return Analyst.topic(word);
    return `${word}은(는)`;
  }

  function subject(word) {
    if (window.Analyst && typeof Analyst.subject === "function") return Analyst.subject(word);
    return `${word}이(가)`;
  }

  function withObject(word) {
    if (window.Analyst && typeof Analyst.withObject === "function") return Analyst.withObject(word);
    return `${word}을(를)`;
  }

  function fmt(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
    return Number(n).toFixed(digits).replace(/\.0+$/, "");
  }

  function pctText(n) {
    return `${fmt(n, 1)}%`;
  }

  function chip(label, home, away, hint) {
    return { label, home, away, hint };
  }

  function tag(p) {
    if (!p) return "미상";
    const role = p.role ? `, ${p.role}` : "";
    return `${p.name}(#${p.backNo ?? "-"}${role})`;
  }

  function ppdaText(p) {
    if (!p || p.ppda === null || p.ppda === undefined) return "산출 불가";
    return fmt(p.ppda, 2);
  }

  function possessLabel(team) {
    const seq = team.sequences;
    const prog = team.progression;
    if (seq.avgPasses >= 3.2 && prog.avgPassLength <= 19) return "포지셔널(짧은 순환으로 블록을 유인)";
    if (seq.avgPasses <= 1.6 && prog.avgPassLength >= 20) return "다이렉트(조기 종단)";
    if (seq.avgPasses <= 2.2) return "전환형(소유보다 전진)";
    return "하이브리드";
  }

  function pressLabel(team) {
    const p = team.pressing;
    if (p.ppda !== null && p.ppda <= 9 && p.defLineHeight >= 44) return "하이 프레스";
    if (p.ppda !== null && p.ppda <= 13) return "미드 프레스";
    if (p.defLineHeight <= 33) return "로우 블록";
    return "미드 블록";
  }

  function sterileInterior(team) {
    const ex = team.expert;
    if (!ex) return false;
    return (
      (ex.occupancy.wingRate >= 48 || team.progression.crossShare >= 50) &&
      team.progression.zone14 <= 8 &&
      team.shooting.avgXg > 0 &&
      team.shooting.avgXg < 0.11
    );
  }

  function thesisLine(ctx) {
    const { home, away, homeName, awayName, tilt } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    if (sterileInterior(home)) {
      return `${subject(homeName)} 필드 틸트 ${pctText(tilt.home)}로 영토는 가져갔으나, 공격 지역 하프스페이스 점유 ${pctText(hx.occupancy.halfSpaceRate)} · 존 14 진입 ${home.progression.zone14}회 · 슈팅당 xG ${fmt(home.shooting.avgXg, 3)}다. 점유가 내부 점유로 번역되지 않은 경기다.`;
    }
    if (hx && home.sequences.avgPasses >= 3.0 && hx.avgDx < 3.5) {
      return `${topic(homeName)} 시퀀스당 ${fmt(home.sequences.avgPasses, 2)}패스로 소유는 유지했으나 완성 패스의 평균 전진량(Δx)이 ${fmt(hx.avgDx, 1)}에 그친다. 블록 앞에서 수평 순환이 목적처럼 작동한 경기다.`;
    }
    if (
      home.pressing.ppda !== null &&
      home.pressing.ppda <= 10 &&
      hx &&
      hx.restBreachRate >= 20 &&
      hx.restLoss >= 4
    ) {
      return `${topic(homeName)} PPDA ${fmt(home.pressing.ppda, 2)}의 하이 프레스를 걸었으나, 공격 지역 턴오버 이후 12초 내 상대 슈팅이 ${hx.restBreach}/${hx.restLoss}회(${pctText(hx.restBreachRate)})다. 프레스의 문제가 아니라 레스트 디펜스의 문제다.`;
    }
    if (hx && hx.betweenLine >= 12 && home.shooting.avgXg >= 0.12) {
      return `${topic(homeName)} 상대 백라인 앞 포켓(라인 사이)으로 ${hx.betweenLine}회 진입했고, 슈팅당 xG ${fmt(home.shooting.avgXg, 3)}로 연결됐다. 내부 점유가 슈팅 질로 번역된 경기다.`;
    }
    if (Math.abs(tilt.home - 50) >= 12 && home.shooting.xg + 0.3 < away.shooting.xg) {
      return `필드 틸트는 ${homeName} ${pctText(tilt.home)}이나 xG는 ${awayName} ${fmt(away.shooting.xg, 2)} 대 ${homeName} ${fmt(home.shooting.xg, 2)}. 영토와 기회 질이 디커플된 경기다.`;
    }
    return `${topic(homeName)} ${possessLabel(home)} × ${pressLabel(home)}, ${topic(awayName)} ${possessLabel(away)} × ${pressLabel(away)}. 필드 틸트 ${pctText(tilt.home)}–${pctText(tilt.away)}, 슈팅당 xG ${fmt(home.shooting.avgXg, 3)}–${fmt(away.shooting.avgXg, 3)}.`;
  }

  /* ------------------------------------------------------------------ */

  function chapterThesis(ctx) {
    const { home, away, homeName, awayName, tilt, meta } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];
    const score =
      meta?.score && meta.score.home !== undefined
        ? `스코어 ${meta.score.home}-${meta.score.away}는 결과다. 아래는 그 결과가 나온 구조다.`
        : "아래는 스코어 이전의 구조다.";

    paragraphs.push(thesisLine(ctx), score);

    paragraphs.push(
      `점유 모델: ${homeName} ${possessLabel(home)} (시퀀스 ${home.sequences.count}회, 평균 ${fmt(home.sequences.avgPasses, 2)}패스, 패스 평균 ${fmt(home.progression.avgPassLength)}m). ${awayName} ${possessLabel(away)} (시퀀스 ${away.sequences.count}회, 평균 ${fmt(away.sequences.avgPasses, 2)}패스, ${fmt(away.progression.avgPassLength)}m).`,
      `수비 모델: ${homeName} ${pressLabel(home)} (PPDA ${ppdaText(home.pressing)}, 수비 개입 높이 ${fmt(home.pressing.defLineHeight)}). ${awayName} ${pressLabel(away)} (PPDA ${ppdaText(away.pressing)}, 높이 ${fmt(away.pressing.defLineHeight)}).`
    );

    if (hx && ax) {
      paragraphs.push(
        `상대 백라인(우리 프레임)은 ${homeName} 기준 x=${fmt(hx.oppLine)}, ${awayName} 기준 x=${fmt(ax.oppLine)}에 섰다. 라인 사이 패스는 ${hx.betweenLine}회 대 ${ax.betweenLine}회, 공격 지역 하프스페이스 점유는 ${pctText(hx.occupancy.halfSpaceRate)} 대 ${pctText(ax.occupancy.halfSpaceRate)}다.`,
        `완성 패스의 평균 전진량 Δx는 ${fmt(hx.avgDx, 1)} 대 ${fmt(ax.avgDx, 1)}. 포털 전방패스 플래그는 ${homeName} Y ${hx.front.y} / 횡(T) ${hx.front.t} / 백(N) ${hx.front.n} (Y 비율 ${pctText(hx.front.yRate)}), ${awayName} Y ${ax.front.y} / T ${ax.front.t} / N ${ax.front.n} (${pctText(ax.front.yRate)}). T가 높고 Y가 낮으면 블록 앞 순환이다.`
      );
    }

    const overH = home.shooting.xgOver;
    const overA = away.shooting.xgOver;
    paragraphs.push(
      `피니시 효율: ${homeName} 골 ${home.shooting.goals ?? "-"} / xG ${fmt(home.shooting.xg, 2)} (오버퍼포먼스 ${overH >= 0 ? "+" : ""}${fmt(overH, 2)}), ${awayName} ${away.shooting.goals ?? "-"} / ${fmt(away.shooting.xg, 2)} (${overA >= 0 ? "+" : ""}${fmt(overA, 2)}). 오버퍼포먼스는 반복되지 않는다고 보는 것이 맞다. 구조를 고칠 대상은 xG가 쌓인 경로이지, 골 그 자체가 아니다.`
    );

    return {
      id: "thesis",
      kicker: "EX · 01 진단",
      title: "오늘 경기의 구조적 가설",
      lead: "스코어를 설명하지 않는다. 점유가 내부 점유로 번역됐는지를 먼저 판정한다.",
      paragraphs,
      metrics: [
        chip("필드 틸트", pctText(tilt.home), pctText(tilt.away), "파이널 서드 터치 점유"),
        chip("PPDA", ppdaText(home.pressing), ppdaText(away.pressing), "낮을수록 강한 프레스"),
        chip("하프스페이스 점유", pctText(hx?.occupancy?.halfSpaceRate), pctText(ax?.occupancy?.halfSpaceRate), "공격 지역 5레인 중"),
        chip("Δx (평균 전진)", fmt(hx?.avgDx, 1), fmt(ax?.avgDx, 1), "완성 패스의 전후 변위"),
        chip("전방패스 Y", pctText(hx?.front?.yRate), pctText(ax?.front?.yRate), "포털 공식 플래그"),
      ],
    };
  }

  function chapterOccupancy(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const hf = home.shape.formation;
    const af = away.shape.formation;
    const paragraphs = [];

    paragraphs.push(
      `평균 위치가 그리는 형태는 ${homeName} ${hf.label || "불명"}, ${awayName} ${af.label || "불명"}이다. 칠판의 숫자가 아니라 90분 점유의 결과다. 지시와 어긋나면 선수가 과제를 재해석한 것이고, 그 재해석이 오늘의 시스템이다.`,
      `블록 높이 ${fmt(home.shape.blockHeight)} 대 ${fmt(away.shape.blockHeight)}, 전후 간격 ${fmt(home.shape.depthSpread)} 대 ${fmt(away.shape.depthSpread)}, 좌우 폭 ${fmt(home.shape.widthSpread)} 대 ${fmt(away.shape.widthSpread)}. 전후가 ${fmt(home.shape.depthSpread)} 이상이면 라인 사이가 상대의 레인이 된다. 폭이 좁으면 하프스페이스가 사라지고 측면만 남는다.`
    );

    if (hx && ax) {
      paragraphs.push(
        `공격 지역 5레인 점유 — ${homeName}: 윙 ${pctText(hx.occupancy.wingRate)} · 하프스페이스 ${pctText(hx.occupancy.halfSpaceRate)} · 중앙 ${pctText(hx.occupancy.centralRate)}. ${awayName}: 윙 ${pctText(ax.occupancy.wingRate)} · 하프스페이스 ${pctText(ax.occupancy.halfSpaceRate)} · 중앙 ${pctText(ax.occupancy.centralRate)}.`,
        hx.occupancy.wingRate >= 50
          ? `${topic(homeName)} 폭을 써서 상대를 벌리려 했다. 포지셔널 플레이에서 폭은 내부를 열기 위한 수단이다. 하프스페이스가 ${pctText(hx.occupancy.halfSpaceRate)}라면, 폭이 내부로 접히지 않고 폭 그 자체로 끝난 것이다.`
          : hx.occupancy.halfSpaceRate >= 36
            ? `${topic(homeName)} 내부를 먼저 점유했다. 하프스페이스 ${pctText(hx.occupancy.halfSpaceRate)}는 상대 풀백–센터백 사이에 프리맨을 두려 했다는 신호다. 이 점유가 존 14와 컷백으로 이어졌는지는 파이널 서드에서 확인한다.`
            : `${topic(homeName)} 중앙 ${pctText(hx.occupancy.centralRate)}에 볼이 몰렸다. 중앙 밀집은 존 14를 노리거나, 반대로 상대 블록의 가장 두꺼운 지점을 정면으로 두드린 것이다. 후자라면 소유는 늘고 기회는 줄었다.`
      );
    }

    const backH = hx ? pctText(hx.backShare) : "-";
    const backA = ax ? pctText(ax.backShare) : "-";
    paragraphs.push(
      `완성 패스 중 GK+DF 비중은 ${homeName} ${backH}, ${awayName} ${backA}. 후방 비중이 높으면 빌드업이 센터백 라인에 묶여 있다는 뜻이다. 8번·10번이 받아주는 높이가 낮아지거나, 상대 첫 압박 라인이 그 높이를 잠근 것이다.`
    );

    return {
      id: "occupy",
      kicker: "EX · 02 점유 기하",
      title: "5레인 점유와 블록의 기하",
      lead: "포지셔널 플레이의 첫 질문은 누가 공을 가졌나가 아니라, 다섯 개 레인 중 어디를 점유했나이다.",
      paragraphs,
      metrics: [
        chip("보이는 형태", hf.label || "-", af.label || "-", "평균 위치 추정"),
        chip("전후 간격", fmt(home.shape.depthSpread), fmt(away.shape.depthSpread), "라인 사이 공간"),
        chip("윙 점유", pctText(hx?.occupancy?.wingRate), pctText(ax?.occupancy?.wingRate), "공격 지역"),
        chip("하프스페이스", pctText(hx?.occupancy?.halfSpaceRate), pctText(ax?.occupancy?.halfSpaceRate), "공격 지역"),
      ],
    };
  }

  function chapterPress(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];

    paragraphs.push(
      `PPDA ${homeName} ${ppdaText(home.pressing)} (${home.pressing.oppPassesLow}패스 / ${home.pressing.defActionsHigh}개입) 대 ${awayName} ${ppdaText(away.pressing)}. 수비 개입 높이 ${fmt(home.pressing.defLineHeight)} 대 ${fmt(away.pressing.defLineHeight)}.`,
      `상대 진영 회수 ${home.pressing.ballWonHigh}회(${pctText(home.pressing.ballWonHighRate)}) 대 ${away.pressing.ballWonHigh}회(${pctText(away.pressing.ballWonHighRate)}). 높은 회수는 다음 공격의 출발점을 25–30m 앞당긴다. 회수 후 슈팅 전환은 레스트 어택 장에서 본다.`
    );

    if (hx && ax) {
      const h1 = hx.thirdAccuracy;
      const a1 = ax.thirdAccuracy;
      paragraphs.push(
        `존별 패스 성공률 — ${homeName} 수비 ${pctText(h1.def.accuracy)}(${h1.def.completed}/${h1.def.passes}) · 중원 ${pctText(h1.mid.accuracy)} · 공격 ${pctText(h1.att.accuracy)}. ${awayName} 수비 ${pctText(a1.def.accuracy)} · 중원 ${pctText(a1.mid.accuracy)} · 공격 ${pctText(a1.att.accuracy)}.`,
        `수비 지역 성공률이 높고 공격 지역이 무너지면, 빌드업은 됐고 라인 브레이크가 실패한 것이다. 반대면 후방 첫 패스에서 이미 프레스에 걸렸다.`,
        home.pressing.ppda !== null && away.pressing.ppda !== null && home.pressing.ppda < away.pressing.ppda
          ? `${subject(homeName)} 더 높은 위치에서 볼을 뺏으러 갔다. 그 대가는 등 뒤다. 상대 속공 슈팅 ${away.sequences.fastShots}회, 레스트 디펜스 붕괴 ${hx.restBreach}/${hx.restLoss}회. 프레스 트리거(백패스, 옆패스, 약한 발)가 작동한 뒤에 커버 각이 닫혔는지를 영상으로 확인해야 한다.`
          : `${topic(homeName)} 상대에게 후방 순환을 허용한 뒤 미드 블록에서 잠갔다. 이 모델은 존 14만 지키면 버틴다. 상대 존 14 진입 ${away.progression.zone14}회가 그 잠금의 성적표다.`
      );

      paragraphs.push(
        `전반 수비 높이 ${fmt(hx.period[1].defLineHeight)} → 후반 ${fmt(hx.period[2].defLineHeight)} (${homeName}). ${awayName} ${fmt(ax.period[1].defLineHeight)} → ${fmt(ax.period[2].defLineHeight)}. 후반에 라인이 내려가면 체력 혹은 스코어 스테이트다. 올라가면서 PPDA가 무너지면 개인 압박만 남고 집단 압박은 죽은 것이다.`,
        `프레스 성공(OPCS) ${hx.press.ok}/${hx.press.total}(${pctText(hx.press.successRate)}) 대 ${ax.press.ok}/${ax.press.total}(${pctText(ax.press.successRate)}). 높은 위치 성공 ${hx.press.highOk} 대 ${ax.press.highOk}. 클리어링 ${hx.clearances} 대 ${ax.clearances}, 오프사이드 ${hx.offsides} 대 ${ax.offsides}, 경고 ${hx.cards} 대 ${ax.cards}.`,
        hx.press.successRate <= 25 && hx.press.total >= 10
          ? `${topic(homeName)} 압박은 많이 나갔으나 성공률 ${pctText(hx.press.successRate)}다. 트리거 없이 달려든 것이다. 백패스·옆패스·약한 발에서만 압박을 열도록 제약을 걸어야 한다.`
          : `클리어링이 ${hx.clearances}회면 박스 안 혼전을 얼마나 허용했는 지표다. 오프사이드 ${hx.offsides}회는 라인의 타이밍이다. 높은 라인인데 오프사이드가 0이면, 함정이 아니라 그냥 높이만 올린 것이다.`
      );
    }

    return {
      id: "press",
      kicker: "EX · 03 빌드업 × 프레스",
      title: "어느 높이에서 싸웠나",
      lead: "프레스의 성적은 PPDA 하나가 아니다. 존별 성공률과 레스트 디펜스가 한 세트다.",
      paragraphs,
      metrics: [
        chip("PPDA", ppdaText(home.pressing), ppdaText(away.pressing), "상대 패스 / 높은 개입"),
        chip("수비 높이", fmt(home.pressing.defLineHeight), fmt(away.pressing.defLineHeight), "개입 평균 x"),
        chip("수비존 패스 성공", pctText(hx?.thirdAccuracy?.def?.accuracy), pctText(ax?.thirdAccuracy?.def?.accuracy), "후방 순환"),
        chip("공격존 패스 성공", pctText(hx?.thirdAccuracy?.att?.accuracy), pctText(ax?.thirdAccuracy?.att?.accuracy), "라인 브레이크"),
        chip("프레스 성공", pctText(hx?.press?.successRate), pctText(ax?.press?.successRate), "OPCS / 압박 시도"),
      ],
    };
  }

  function chapterLines(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];

    if (!hx || !ax) {
      return {
        id: "lines",
        kicker: "EX · 04 라인 사이",
        title: "라인 사이와 서드맨",
        lead: "블록 앞에서 순환하는 것과 블록 안에 들어가는 것은 다른 점유다.",
        paragraphs: ["라인 사이 지표를 계산할 이벤트 밀도가 부족합니다."],
      };
    }

    paragraphs.push(
      `상대 백라인은 우리 프레임에서 ${homeName} 기준 x=${fmt(hx.oppLine)}에 섰다. 그 앞 포켓(라인 −22 ~ −2, 중앙 대역)으로 들어간 완성 패스가 라인 사이 진입이다. ${homeName} ${hx.betweenLine}회, ${awayName} ${ax.betweenLine}회.`,
      `서드맨 콤비네이션(완성 패스 2홉 안에 Δx +8 이상)은 ${hx.thirdMan}회 대 ${ax.thirdMan}회. 서드맨은 압박 받은 선수 대신 세 번째가 전진하는 해법이다. 이 숫자가 낮으면 2홉에서 막히거나, 세 번째가 라인 앞에 남아 있었다는 뜻이다.`
    );

    const hTop = hx.betweenRank?.[0];
    const aTop = ax.betweenRank?.[0];
    if (hTop?.player) {
      paragraphs.push(
        `${homeName} 라인 사이 최다 수신은 ${tag(hTop.player)} ${hTop.count}회다.` +
          (hx.betweenRank[1]?.player
            ? ` 다음 ${tag(hx.betweenRank[1].player)} ${hx.betweenRank[1].count}회.`
            : "") +
          ` 이 선수가 받는 높이가 상대 6번의 과제다. 마크를 따라가면 하프스페이스가 열리고, 존을 지키면 이 선수가 프리맨이 된다.`
      );
    }
    if (aTop?.player) {
      paragraphs.push(
        `${awayName} 쪽 포켓 수신은 ${tag(aTop.player)} ${aTop.count}회. 다음 맞대결의 1순위 트리거는 이 선수의 첫 터치 방향이다.`
      );
    }

    paragraphs.push(
      hx.betweenLine <= 6 && home.sequences.avgPasses >= 2.5
        ? `${topic(homeName)} 소유는 있었으나 라인 사이 ${hx.betweenLine}회다. 전형적인 블록 앞 순환이다. 상대가 한 줄을 내려 간격을 지웠거나, 우리 8번·10번의 수신 위치가 너무 낮았다. 해결은 더 많은 패스가 아니라, 수신 높이를 한 줄 올리는 움직임이다.`
        : hx.betweenLine >= 12 && home.progression.zone14 <= 5
          ? `라인 사이는 ${hx.betweenLine}회 열렸으나 존 14는 ${home.progression.zone14}회다. 포켓까지는 갔고 박스 정면으로는 못 접었다. 마지막 패스의 각이 측면으로 새거나, 스트라이커가 포켓 수신자와 같은 높이에 서 겹친 것이다.`
          : `라인 사이 ${hx.betweenLine}회가 존 14 ${home.progression.zone14}회, 키패스 ${home.progression.keyPasses}회로 이어지는 비율이 오늘의 공격 번역률이다.`
    );

    return {
      id: "lines",
      kicker: "EX · 04 라인 사이",
      title: "블록 안 — 라인 사이와 서드맨",
      lead: "점유의 목적은 상대 라인 사이에 프리맨을 만드는 것이다. 블록 앞 패스는 점유가 아니라 대기열이다.",
      paragraphs,
      metrics: [
        chip("라인 사이 패스", `${hx.betweenLine}회`, `${ax.betweenLine}회`, "백라인 앞 포켓"),
        chip("서드맨", `${hx.thirdMan}회`, `${ax.thirdMan}회`, "2홉 내 전진 연결"),
        chip("존 14", `${home.progression.zone14}회`, `${away.progression.zone14}회`, "박스 정면"),
        chip("상대 백라인 x", fmt(hx.oppLine), fmt(ax.oppLine), "우리 공격 프레임"),
      ],
    };
  }

  function chapterFinal(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const hp = home.progression;
    const ap = away.progression;
    const paragraphs = [];

    paragraphs.push(
      `박스 진입 ${hp.intoBox}회 대 ${ap.intoBox}회. 크로스 ${hp.crossIntoBox}(${pctText(hp.crossShare)}) 대 ${ap.crossIntoBox}(${pctText(ap.crossShare)}). 그라운드 ${hp.groundIntoBox} 대 ${ap.groundIntoBox}. 존 14 ${hp.zone14} 대 ${ap.zone14}. 키패스 ${hp.keyPasses} 대 ${ap.keyPasses}.`
    );

    if (hx && ax) {
      paragraphs.push(
        `컷백(박스 안 낮은 각, 도착 x≥86·y 32–68) ${hx.cutbacks}회 대 ${ax.cutbacks}회. 이른 크로스(측면 출발, 컷백이 아닌 박스 진입) ${hx.highCrosses}회 대 ${ax.highCrosses}회.`,
        hx.highCrosses >= Math.max(8, hx.cutbacks * 3) && hp.crossShare >= 45
          ? `${topic(homeName)} 박스 진입의 주경로가 이른 크로시다. 컷백 ${hx.cutbacks}회 대비 크로스 ${hx.highCrosses}회. 포지셔널 파이널 서드는 풀백이 라인 끝에 도착한 뒤 잘린 컷백, 혹은 하프스페이스에서 존 14로 넣는 땅볼이다. 오늘 그 두 경로가 모두 비어 있으면, 슈팅 숫자는 올라가도 슈팅당 xG는 내려간다.`
          : hx.cutbacks >= 4
            ? `컷백 ${hx.cutbacks}회는 내부가 살아 있었다는 증거다. 도착 지점에 누가 있었는지가 피니시 효율을 가른다.`
            : `컷백이 ${hx.cutbacks}회다. 측면 돌파가 있어도 마지막 패스가 골문 앞을 가로지르지 못했다.`
      );
    }

    paragraphs.push(
      `슈팅 ${home.shooting.shots} 대 ${away.shooting.shots}, 박스 안 ${home.shooting.box} 대 ${away.shooting.box}, 박스 밖 비율 ${pctText(home.shooting.outsideRate)} 대 ${pctText(away.shooting.outsideRate)}. 슈팅당 xG ${fmt(home.shooting.avgXg, 3)} 대 ${fmt(away.shooting.avgXg, 3)}. Big chance(xG≥0.25) ${home.shooting.big} 대 ${away.shooting.big}. 저질(xG<0.06) ${home.shooting.poor}(${pctText(home.shooting.poorRate)}) 대 ${away.shooting.poor}(${pctText(away.shooting.poorRate)}).`,
      `xG 합 ${fmt(home.shooting.xg, 2)} 대 ${fmt(away.shooting.xg, 2)}, 골 ${home.shooting.goals ?? "-"} 대 ${away.shooting.goals ?? "-"}, 오버퍼포먼스 ${home.shooting.xgOver >= 0 ? "+" : ""}${fmt(home.shooting.xgOver, 2)} 대 ${away.shooting.xgOver >= 0 ? "+" : ""}${fmt(away.shooting.xgOver, 2)}.`,
      `실행: 유효(골+온타깃) ${hx?.shots?.on ?? "-"}(${pctText(hx?.shots?.onRate)}) 대 ${ax?.shots?.on ?? "-"}(${pctText(ax?.shots?.onRate)}), 블락 ${hx?.shots?.block ?? "-"}(${pctText(hx?.shots?.blockRate)}) 대 ${ax?.shots?.block ?? "-"}(${pctText(ax?.shots?.blockRate)}), 빗나감 ${hx?.shots?.miss ?? "-"} 대 ${ax?.shots?.miss ?? "-"}. 블락 비율이 높으면 슈팅 각이 첫 수비수에 막힌 것이다. 자리는 됐는데 타이밍이 늦은 패턴이다.`,
      sterileInterior(home)
        ? `진단 재확인. ${topic(homeName)} 영토는 있었고 내부는 없었다. 다음 세션의 제약은 명확하다. 박스 진입을 존 14 또는 컷백만 득점으로 인정하는 게임을 돌린다.`
        : home.shooting.avgXg >= 0.13
          ? `슈팅 질은 유지됐다. 문제는 양의 부족이거나 골키퍼·골포스트다. 구조를 갈아엎을 경기는 아니다.`
          : `슈팅 질이 낮다. 박스 밖 ${pctText(home.shooting.outsideRate)}를 먼저 줄이는 것이 훈련 효율이 크다.`
    );

    return {
      id: "final",
      kicker: "EX · 05 파이널 서드",
      title: "존 14 · 컷백 · 크로스",
      lead: "박스에 들어간 횟수가 아니라, 어떤 각으로 들어갔는지가 슈팅 질을 만든다.",
      paragraphs,
      metrics: [
        chip("존 14", `${hp.zone14}회`, `${ap.zone14}회`, "박스 정면 땅볼"),
        chip("컷백", `${hx?.cutbacks ?? "-"}회`, `${ax?.cutbacks ?? "-"}회`, "낮은 각 횡단"),
        chip("크로스 의존", pctText(hp.crossShare), pctText(ap.crossShare), "박스 진입 중"),
        chip("슈팅당 xG", fmt(home.shooting.avgXg, 3), fmt(away.shooting.avgXg, 3), "기회 질"),
      ],
    };
  }

  function chapterRest(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];

    paragraphs.push(
      `속공 슈팅(획득 12초 내) ${home.sequences.fastShots} 대 ${away.sequences.fastShots}. 직선 마무리(패스 ≤2) ${home.sequences.direct} 대 ${away.sequences.direct}. 시퀀스 시작 높이 ${fmt(home.sequences.avgStartX)} 대 ${fmt(away.sequences.avgStartX)}, 상대 진영 시작 ${pctText(home.sequences.startedHighRate)} 대 ${pctText(away.sequences.startedHighRate)}.`
    );

    if (hx && ax) {
      paragraphs.push(
        `높은 위치 회수 ${hx.highRegain}회 중 슈팅 전환 ${hx.highRegainShot}회(${pctText(hx.highRegainShotRate)}) 대 ${ax.highRegain} / ${ax.highRegainShot}(${pctText(ax.highRegainShotRate)}). 회수만 하고 첫 패스가 뒤로 가면 레스트 어택이 아니다.`,
        `슈팅 없이 죽은 시퀀스 종착 — ${homeName} 수비 ${pctText(hx.diedRate.def)} · 중원 ${pctText(hx.diedRate.mid)} · 공격 ${pctText(hx.diedRate.att)}. ${awayName} ${pctText(ax.diedRate.def)} / ${pctText(ax.diedRate.mid)} / ${pctText(ax.diedRate.att)}. 공격 지역에서 죽으면 상대 레스트 어택의 출발점이 된다.`,
        `레스트 디펜스: 공격 지역 턴오버 후 상대가 12초 내 슈팅한 비율. ${homeName} ${hx.restBreach}/${hx.restLoss}(${pctText(hx.restBreachRate)}), ${awayName} ${ax.restBreach}/${ax.restLoss}(${pctText(ax.restBreachRate)}).`,
        hx.restBreachRate >= 25 && hx.restLoss >= 4
          ? `${topic(homeName)} 앞으로 나간 숫자가 등 뒤를 지우는 숫자보다 컸다. 풀백 오버랩 시 커버 피벗이 볼과 골문 사이에 없었거나, 센터백 간격이 존 14를 내줬다. 다음 세션: 볼이 공격 지역에 있는 동안 뒤로 남은 3인(CB–CB–6)의 간격을 고정하는 제약.`
          : `레스트 디펜스는 버텼다. 실점이 나왔다면 세트피스나 개별 1v1이지, 구조적 붕괴는 아니다.`,
        `공격 지역 패스 실패 ${hx.lossesAtt}회 대 ${ax.lossesAtt}회. 마지막 30m에서의 턴오버는 기회 비용이 가장 큰 손실이다.`
      );
    }

    return {
      id: "rest",
      kicker: "EX · 06 전환",
      title: "레스트 어택과 레스트 디펜스",
      lead: "볼을 가졌을 때의 수비 형태가, 볼을 잃었을 때의 실점 경로를 결정한다.",
      paragraphs,
      metrics: [
        chip("속공 슈팅", `${home.sequences.fastShots}회`, `${away.sequences.fastShots}회`, "12초 내"),
        chip("고위치 회수→슈팅", pctText(hx?.highRegainShotRate), pctText(ax?.highRegainShotRate), "x≥60 시작"),
        chip("레스트 붕괴", pctText(hx?.restBreachRate), pctText(ax?.restBreachRate), "턴오버 후 12초 슈팅"),
        chip("공격존 손실", `${hx?.lossesAtt ?? "-"}회`, `${ax?.lossesAtt ?? "-"}회`, "불완전 패스"),
      ],
    };
  }

  function chapterState(ctx) {
    const { home, away, homeName, awayName, phases, momentum } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];

    paragraphs.push(
      `15분 창에서 ${homeName} 최다 우위는 ${phases.bestHome.from}–${phases.bestHome.to}분(xG ${fmt(phases.bestHome.home, 2)}–${fmt(phases.bestHome.away, 2)}). ${awayName}은 ${phases.bestAway.from}–${phases.bestAway.to}분(${fmt(phases.bestAway.away, 2)}–${fmt(phases.bestAway.home, 2)}).`,
      `누적 xG ${fmt(momentum.homeTotal, 2)}–${fmt(momentum.awayTotal, 2)}. 곡선이 가파른 구간이 실제 경기이고, 평탄한 구간은 소유만 있던 시간이다.`
    );

    if (hx && ax) {
      const labelState = (s, name) =>
        `${name} 무승부 ${s.draw.passes}패스·전진 ${s.draw.progressive}·슈팅 ${s.draw.shots}(xG ${fmt(s.draw.xg, 2)}) / 리드 ${s.lead.passes}·${s.lead.progressive}·${s.lead.shots}(${fmt(s.lead.xg, 2)}) / 트래일 ${s.trail.passes}·${s.trail.progressive}·${s.trail.shots}(${fmt(s.trail.xg, 2)})`;
      paragraphs.push(
        labelState(hx.scoreState, homeName) + ".",
        labelState(ax.scoreState, awayName) + ".",
        hx.scoreState.lead.passes >= 20 && hx.scoreState.lead.progressiveRate < hx.scoreState.draw.progressiveRate - 8
          ? `리드 국면에서 ${topic(homeName)} 전진 비율이 ${pctText(hx.scoreState.lead.progressiveRate)}로 떨어졌다(무승부 ${pctText(hx.scoreState.draw.progressiveRate)}). 킬링 더 게임을 점유로 하려 했으나, 수평 순환이 상대에게 프레스 트리거를 반복 제공했을 수 있다. 리드 후엔 폭을 유지한 채 내부 패스 수를 줄이는 편이 안전하다.`
          : hx.scoreState.trail.passes >= 15 && hx.scoreState.trail.shots <= 1
            ? `트래일 국면에서 패스는 ${hx.scoreState.trail.passes}회였으나 슈팅은 ${hx.scoreState.trail.shots}회. 쫓아가는 점유가 박스에 닿지 못했다.`
            : `스코어 스테이트에 따른 모델 붕괴는 크지 않다. 플랜 A가 90분을 버틴 경기다.`
      );

      paragraphs.push(
        `전반→후반 전진 비율 ${homeName} ${pctText(hx.period[1].progressiveRate)} → ${pctText(hx.period[2].progressiveRate)}, 파이널 서드 터치 ${hx.period[1].finalThird} → ${hx.period[2].finalThird}, 슈팅 ${hx.period[1].shots}(${fmt(hx.period[1].xg, 2)}) → ${hx.period[2].shots}(${fmt(hx.period[2].xg, 2)}). ${awayName} 전진 ${pctText(ax.period[1].progressiveRate)} → ${pctText(ax.period[2].progressiveRate)}, 파이널 ${ax.period[1].finalThird} → ${ax.period[2].finalThird}.`
      );
    }

    return {
      id: "state",
      kicker: "EX · 07 시간",
      title: "스코어 스테이트와 국면",
      lead: "같은 포메이션이 리드와 트래일에서 같은 경기일 수는 없다.",
      paragraphs,
      metrics: [
        chip("전반 전진율", pctText(hx?.period?.[1]?.progressiveRate), pctText(ax?.period?.[1]?.progressiveRate), "H1"),
        chip("후반 전진율", pctText(hx?.period?.[2]?.progressiveRate), pctText(ax?.period?.[2]?.progressiveRate), "H2"),
        chip("전반 xG", fmt(hx?.period?.[1]?.xg, 2), fmt(ax?.period?.[1]?.xg, 2), "슈팅 가치"),
        chip("후반 xG", fmt(hx?.period?.[2]?.xg, 2), fmt(ax?.period?.[2]?.xg, 2), "슈팅 가치"),
      ],
    };
  }

  function chapterNetwork(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];
    const hTop = home.expert?.official?.topPair || home.network.topPair;
    const aTop = away.expert?.official?.topPair || away.network.topPair;
    const official = Boolean(home.expert?.official || away.expert?.official);

    if (hTop?.a && hTop?.b) {
      paragraphs.push(
        (official ? "PASS MATRIX 기준. " : "칠판 추정 연결 기준. ") +
          `${homeName} 최다 커넥션 ${tag(hTop.a)} → ${tag(hTop.b)} ${hTop.count}회. ${awayName}` +
          (aTop?.a && aTop?.b ? ` ${tag(aTop.a)} → ${tag(aTop.b)} ${aTop.count}회.` : " 데이터 부족.")
      );
    }

    const hHub = home.expert?.official?.hub || hx?.hub;
    const aHub = away.expert?.official?.hub || ax?.hub;
    if (hHub?.player) {
      paragraphs.push(
        `${homeName} 패스 네트워크 허브는 ${tag(hHub.player)}다. 관측된 연결의 ${pctText(hHub.share)}(${hHub.count}회)가 이 선수를 지난다.`,
        hHub.share >= 22
          ? `허브 의존 ${pctText(hHub.share)}는 상대에게 과제를 단순화한다. 이 한 명을 존으로 지우면 후방 전개 전체가 멈춘다. 세컨드 허브가 같은 높이에 있어야 하고, 오늘은 그 대안이 약했다.`
          : `허브 집중도는 분산된 편이다. 프리맨이 여러 높이에 있었다는 뜻이다.`
      );
    }
    if (aHub?.player) {
      paragraphs.push(
        `${awayName} 허브 ${tag(aHub.player)} ${pctText(aHub.share)}. 다음 경기 프레스의 1차 타깃이다.`
      );
    }

    const rank = (list, key, min) =>
      [...list].sort((a, b) => (b.stat[key] || 0) - (a.stat[key] || 0)).filter((p) => (p.stat[key] || 0) >= min);

    const prog = rank(home.players, "progressive", 3)[0];
    const creator = rank(home.players, "keyPasses", 1)[0];
    const stopper = rank(home.players, "defActions", 5)[0];
    if (prog) {
      paragraphs.push(
        `${homeName} 전진 패스 1순위 ${tag(prog)} ${prog.stat.progressive}회. 허브와 전진 담당이 동일하면 단일 실패점이다. 다르면 그 사이 패스가 병목이다.`
      );
    }
    if (creator) {
      paragraphs.push(
        `마지막 패스 ${tag(creator)} 키패스 ${creator.stat.keyPasses} · 박스 진입 ${creator.stat.intoBox}` +
          (creator.stat.crosses ? ` (크로스 ${creator.stat.crosses})` : "") +
          `. 이 선수의 수신 각을 지우는 것이 상대 로우 블록의 정답이었을 가능성이 크다.`
      );
    }
    if (stopper) {
      paragraphs.push(
        `수비 부하 ${tag(stopper)} 액션 ${stopper.stat.defActions} · 회수 ${stopper.stat.ballWon}. 오버랩이 잦은 선수에게 이 부하가 겹치면 레스트 디펜스의 구멍이 그 등 뒤에 난다.`
      );
    }

    return {
      id: "network",
      kicker: "EX · 08 네트워크",
      title: "허브와 병목",
      lead: "시스템은 패스 그래프 위에서 실행된다. 한 노드에 몰리면 상대의 프레스 지도가 한 장으로 끝난다.",
      paragraphs,
      metrics: [
        chip("허브 집중", pctText(home.expert?.official?.hub?.share || hx?.hub?.share), pctText(away.expert?.official?.hub?.share || ax?.hub?.share), "연결 점유"),
        chip("최다 커넥션", hTop?.count != null ? `${hTop.count}회` : "-", aTop?.count != null ? `${aTop.count}회` : "-", "페어"),
        chip("전진 패스", `${home.progression.progressive}`, `${away.progression.progressive}`, "Δx≥12m"),
        chip("키패스", `${home.progression.keyPasses}`, `${away.progression.keyPasses}`, "슈팅 직전"),
      ],
    };
  }

  function chapterDuels(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];
    if (!hx || !ax) {
      return {
        id: "duels",
        kicker: "EX · 09 경합",
        title: "공중 · 지상 · 세컨드볼",
        paragraphs: ["경합 지표를 계산할 이벤트가 부족합니다."],
      };
    }

    paragraphs.push(
      `공중 경합 ${homeName} ${hx.aerial.win}승 ${hx.aerial.lose}패 (${pctText(hx.aerial.winRate)}, 수비 지역 ${hx.aerial.def} · 공격 지역 ${hx.aerial.att}), ${awayName} ${ax.aerial.win}승 ${ax.aerial.lose}패 (${pctText(ax.aerial.winRate)}, 수비 ${ax.aerial.def} · 공격 ${ax.aerial.att}).`,
      `지상 경합 ${hx.ground.win}승 ${hx.ground.lose}패 (${pctText(hx.ground.winRate)}) 대 ${ax.ground.win}승 ${ax.ground.lose}패 (${pctText(ax.ground.winRate)}). 드리블 성공 ${hx.dribble.ok} 대 ${ax.dribble.ok}.`,
      `세컨드볼(공중 경합 6초 내 우리 회수/연결) ${hx.aerial.secondBall} 대 ${ax.aerial.secondBall}. 1차 볼을 이겨도 2차 볼을 지면 점유는 상대 것이다.`
    );

    const hTop = hx.aerial.top?.[0];
    const aTop = ax.aerial.top?.[0];
    if (hTop?.player) {
      paragraphs.push(
        `${homeName} 공중 최다 승자 ${tag(hTop.player)} ${hTop.count}회.` +
          (hx.aerial.top[1]?.player ? ` 다음 ${tag(hx.aerial.top[1].player)} ${hx.aerial.top[1].count}회.` : "") +
          (aTop?.player ? ` ${awayName} 쪽은 ${tag(aTop.player)} ${aTop.count}회.` : "")
      );
    }

    paragraphs.push(
      hx.aerial.winRate + 12 <= ax.aerial.winRate && hx.aerial.total >= 8
        ? `${topic(homeName)} 공중에서 밀렸다. 크로스 의존 ${pctText(home.progression.crossShare)}와 겹치면, 스스로 약한 싸움으로 볼을 보낸 것이다. 다음 세트피스는 니어포스트 스크린이 아니라, 땅볼 숏코너 혹은 컷백 루틴이어야 한다.`
        : hx.aerial.att >= 6 && hx.aerial.winRate >= 50
          ? `공격 지역 공중 ${hx.aerial.att}회에 승률 ${pctText(hx.aerial.winRate)}. 박스 공중은 유효한 경로였다. 키커의 존만 고정하면 된다.`
          : `경합의 우열은 크지 않다. 오늘은 듀얼보다 수신 각이 경기를 가른다.`
    );

    return {
      id: "duels",
      kicker: "EX · 09 경합",
      title: "공중 · 지상 · 세컨드볼",
      lead: "포지셔널 팀이 크로스를 고르면, 그 순간부터 경합 지형이 경기다.",
      paragraphs,
      metrics: [
        chip("공중 승률", pctText(hx.aerial.winRate), pctText(ax.aerial.winRate), "ADW / 공중 경합"),
        chip("공격지역 공중", `${hx.aerial.att}회`, `${ax.aerial.att}회`, "x≥66"),
        chip("지상 승률", pctText(hx.ground.winRate), pctText(ax.ground.winRate), "GDW / 지상 경합"),
        chip("세컨드볼", `${hx.aerial.secondBall}회`, `${ax.aerial.secondBall}회`, "경합 6초 내 연결"),
      ],
    };
  }

  function chapterFinish(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];
    if (!hx || !ax) {
      return {
        id: "finish",
        kicker: "EX · 10 실행",
        title: "슈팅 실행과 골키퍼",
        paragraphs: ["슈팅 실행 지표가 부족합니다."],
      };
    }

    paragraphs.push(
      `${homeName} 유효 ${hx.shots.on}(${pctText(hx.shots.onRate)}) · 블락 ${hx.shots.block}(${pctText(hx.shots.blockRate)}) · 빗나감 ${hx.shots.miss}(${pctText(hx.shots.missRate)}) · 골 ${hx.shots.goal}.`,
      `${awayName} 유효 ${ax.shots.on}(${pctText(ax.shots.onRate)}) · 블락 ${ax.shots.block}(${pctText(ax.shots.blockRate)}) · 빗나감 ${ax.shots.miss}(${pctText(ax.shots.missRate)}) · 골 ${ax.shots.goal}.`,
      `골키퍼 선방 ${homeName} 캐치 ${hx.gk.catch} · 펀치 ${hx.gk.punch} (합 ${hx.gk.saves}), ${awayName} ${ax.gk.catch} · ${ax.gk.punch} (${ax.gk.saves}). 슈팅 차단(STB) ${hx.blocks} 대 ${ax.blocks}.`
    );

    paragraphs.push(
      hx.shots.blockRate >= 22 && hx.shots.block >= 3
        ? `블락 ${pctText(hx.shots.blockRate)}는 슈팅 타이밍의 문제다. 존 14까지 갔어도 첫 수비수가 각을 닫은 뒤에 때렸다. 훈련: 컷백 수신자의 첫 터치에서 슈팅, 두 번째 터치는 실점.`
        : hx.shots.onRate <= 28 && home.shooting.shots >= 8
          ? `유효슈팅률 ${pctText(hx.shots.onRate)}. 자리(xG)와 실행이 둘 다 약하면 구조를 먼저 고친다. 자리만 좋고 실행이 나쁘면 피니셔 교체가 더 싸다.`
          : `실행 지표는 구조 진단과 크게 어긋나지 않는다. 골키퍼가 경기를 훔친 날인지는 선방 위치(캐치 vs 펀치)와 xG 오버를 같이 보면 된다.`
    );

    if (hx.gk.saves >= 6) {
      paragraphs.push(
        `${topic(homeName)} 골키퍼가 ${hx.gk.saves}회 개입했다. 펀치 ${hx.gk.punch}회가 많으면 박스 공중이 열렸다는 뜻이고, 캐치가 많으면 상대 슈팅이 중앙·느린 볼이었다.`
      );
    }

    return {
      id: "finish",
      kicker: "EX · 10 실행",
      title: "슈팅 실행과 골키퍼",
      lead: "xG는 자리의 질이다. 유효·블락·선방은 그 자리를 어떻게 처리했나이다.",
      paragraphs,
      metrics: [
        chip("유효슈팅률", pctText(hx.shots.onRate), pctText(ax.shots.onRate), "골+온타깃"),
        chip("블락 비율", pctText(hx.shots.blockRate), pctText(ax.shots.blockRate), "첫 수비수"),
        chip("GK 선방", `${hx.gk.saves}회`, `${ax.gk.saves}회`, "캐치+펀치"),
        chip("슈팅 차단", `${hx.blocks}회`, `${ax.blocks}회`, "STB"),
      ],
    };
  }

  function chapterRestart(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];
    if (!hx || !ax) {
      return {
        id: "restart",
        kicker: "EX · 11 재개",
        title: "세트피스 연쇄",
        paragraphs: ["세트피스 지표가 부족합니다."],
      };
    }

    const hs = home.setPieces;
    const as = away.setPieces;
    paragraphs.push(
      `코너 ${hs.corners} 대 ${as.corners}, 그중 12초 내 슈팅 ${hx.setpiece.cornerShots}(${pctText(hx.setpiece.cornerRate)}) 대 ${ax.setpiece.cornerShots}(${pctText(ax.setpiece.cornerRate)}).`,
      `프리킥 상황 ${hs.freeKicks} 대 ${as.freeKicks}, 12초 내 슈팅 ${hx.setpiece.fkShots}(${pctText(hx.setpiece.fkRate)}) 대 ${ax.setpiece.fkShots}(${pctText(ax.setpiece.fkRate)}). 세트피스 xG ${fmt(hs.setPieceXg, 2)} 대 ${fmt(as.setPieceXg, 2)}, 세트피스 슈팅 ${hs.setPieceShots} 대 ${as.setPieceShots}.`,
      `스로인 ${hs.throwIns} 대 ${as.throwIns}, PK ${hs.penalties} 대 ${as.penalties}.`
    );

    paragraphs.push(
      hs.corners >= 5 && hx.setpiece.cornerRate < 20
        ? `${topic(homeName)} 코너 ${hs.corners}개에서 슈팅 전환 ${pctText(hx.setpiece.cornerRate)}. 키커의 존이 상대 첫 수비수에 걸리거나, 니어/파 스크린이 없다. 흐름이 막힌 날 가장 값싼 골 경로가 비어 있다.`
        : hx.setpiece.cornerRate >= 35 && hx.setpiece.corners >= 3
          ? `코너 → 슈팅 전환 ${pctText(hx.setpiece.cornerRate)}. 루틴은 작동했다. 마무리가 xG로 안 남았다면 세컨드볼 존의 문제고, 남았다면 키퍼다.`
          : `세트피스가 경기를 지배한 흔적은 제한적이다. 접전에서는 이 전환률이 먼저 승부를 가른다.`
    );

    return {
      id: "restart",
      kicker: "EX · 11 재개",
      title: "세트피스 연쇄",
      lead: "코너 숫자가 아니라, 킥 이후 12초에 슈팅이 나왔는지가 루틴의 성적표다.",
      paragraphs,
      metrics: [
        chip("코너→슈팅", pctText(hx.setpiece.cornerRate), pctText(ax.setpiece.cornerRate), "12초 내"),
        chip("FK→슈팅", pctText(hx.setpiece.fkRate), pctText(ax.setpiece.fkRate), "12초 내"),
        chip("세트피스 xG", fmt(hs.setPieceXg, 2), fmt(as.setPieceXg, 2), "정지 상황"),
        chip("PK", `${hs.penalties}`, `${as.penalties}`, "획득"),
      ],
    };
  }

  function chapterSubs(ctx) {
    const { home, away, homeName, awayName } = ctx;
    const hx = home.expert;
    const ax = away.expert;
    const paragraphs = [];
    if (!hx || !ax) {
      return {
        id: "subs",
        kicker: "EX · 12 교체",
        title: "교체 이후 12분",
        paragraphs: ["교체 데이터를 읽지 못했습니다."],
      };
    }

    function describe(name, impact) {
      if (!impact) return `${topic(name)} 비교 가능한 교체 창이 없다.`;
      const b = impact.before;
      const a = impact.after;
      return (
        `${name} ${impact.timeLabel} ${impact.outName} → ${impact.inName}. ` +
        `직전 12분: 패스 ${b.passes} · 전방패스 ${b.frontY}(${pctText(b.frontRate)}) · 전진 ${b.progressive} · 파이널 ${b.finalThird} · 슈팅 ${b.shots}(xG ${fmt(b.xg, 2)}). ` +
        `직후 12분: 패스 ${a.passes} · 전방패스 ${a.frontY}(${pctText(a.frontRate)}) · 전진 ${a.progressive} · 파이널 ${a.finalThird} · 슈팅 ${a.shots}(xG ${fmt(a.xg, 2)}).`
      );
    }

    paragraphs.push(describe(homeName, hx.subImpact), describe(awayName, ax.subImpact));

    if (hx.subImpact) {
      const b = hx.subImpact.before;
      const a = hx.subImpact.after;
      if (a.xg > b.xg + 0.15 || a.finalThird > b.finalThird + 8) {
        paragraphs.push(
          `${topic(homeName)} 교체 이후 창에서 파이널 서드와 xG가 올라갔다. ${withObject(hx.subImpact.inName)} 넣은 과제가 내부 점유 혹은 피니시였다면, 그 과제는 작동했다.`
        );
      } else if (a.frontRate + 8 < b.frontRate && a.xg <= b.xg) {
        paragraphs.push(
          `교체 이후 전방패스 비율이 ${pctText(b.frontRate)} → ${pctText(a.frontRate)}로 떨어졌다. 새 선수가 횡 순환에 흡수됐거나, 상대가 그 교체를 읽고 라인을 내렸다.`
        );
      } else {
        paragraphs.push(
          `첫 의미 있는 교체 전후 12분은 구조가 크게 바뀌지 않았다. 플랜 A의 연장이지, 플랜 B가 아니다.`
        );
      }
    } else {
      paragraphs.push("선발 구조가 교체 없이, 혹은 창이 너무 짧아 비교가 안 되는 경기다.");
    }

    return {
      id: "subs",
      kicker: "EX · 12 교체",
      title: "교체 이후 12분",
      lead: "교체는 이름 교체가 아니라 과제 교체여야 한다. 전후 12분이 그 과제 검사다.",
      paragraphs,
      metrics: [
        chip("교체후 전방Y", pctText(hx.subImpact?.after?.frontRate), pctText(ax.subImpact?.after?.frontRate), "첫 창 12분"),
        chip("교체후 파이널", `${hx.subImpact?.after?.finalThird ?? "-"}`, `${ax.subImpact?.after?.finalThird ?? "-"}`, "12분"),
        chip("교체후 슈팅", `${hx.subImpact?.after?.shots ?? "-"}`, `${ax.subImpact?.after?.shots ?? "-"}`, "12분"),
        chip("교체후 xG", fmt(hx.subImpact?.after?.xg, 2), fmt(ax.subImpact?.after?.xg, 2), "12분"),
      ],
    };
  }

  function chapterStaff(ctx) {
    const { home, away, homeName, awayName, meta } = ctx;
    const hx = home.expert;
    const hp = home.progression;
    const hs = home.shooting;
    const items = [];

    if (hx && (hx.occupancy.wingRate >= 48 || hp.crossShare >= 50) && hp.zone14 <= 8) {
      items.push(
        `제약 1 — 내부 진입. 하프스페이스 점유 ${pctText(hx.occupancy.halfSpaceRate)}, 존 14 ${hp.zone14}회, 컷백 ${hx.cutbacks}회. 15분 게임: 박스 진입은 존 14 또는 컷백만 인정. 하프스페이스 3인(풀백–8–윙) 트라이앵글을 오른쪽에 고정한다.`
      );
    }
    if (hs.outsideRate >= 28 && hs.shots >= 10) {
      items.push(
        `제약 2 — 박스 밖 슈팅 금지. 박스 밖 비율 ${pctText(hs.outsideRate)}. 그 자리에서 슈팅 시 상대 볼. 한 터치 더 가지고 컷백 각을 찾게 한다.`
      );
    }
    if (hx && hx.betweenLine <= 6 && home.sequences.avgPasses >= 2.4) {
      items.push(
        `제약 3 — 수신 높이. 라인 사이 ${hx.betweenLine}회. 10번·8번의 첫 터치가 상대 6번 앞에서 일어나면 리셋. 백라인과 미드 라인 사이에서만 받아도 된다고 규칙을 건다.`
      );
    }
    if (hx && hx.restBreachRate >= 22 && hx.restLoss >= 4) {
      items.push(
        `제약 4 — 레스트 디펜스 3인. 붕괴 ${hx.restBreach}/${hx.restLoss}. 볼이 공격 지역에 있는 동안 CB–CB–6 삼각형이 해체되면 즉시 휘슬. 풀백 오버랩은 6번이 볼과 골문 사이에 있을 때만 허용.`
      );
    }
    if (hx?.hub?.share >= 22) {
      items.push(
        `제약 5 — 세컨드 허브. ${tag(hx.hub.player)} 집중도 ${pctText(hx.hub.share)}. 이 선수를 지나지 않는 전진 시퀀스만 득점으로 인정하는 빌드업 게임을 한 세트 넣는다.`
      );
    }
    if (home.pressing.defLineHeight >= 44 && away.sequences.fastShots >= 4) {
      items.push(
        `제약 6 — 프레스 깨진 뒤의 각. 라인 높이 ${fmt(home.pressing.defLineHeight)}, 상대 속공 슈팅 ${away.sequences.fastShots}회. 첫 압박이 실패한 순간 커버 미들의 위치를 콘으로 고정하고, 그 콘을 지나 역습이 나오면 실점으로 친다.`
      );
    }
    if (hx && hx.front.yRate < 18 && hx.front.t >= 80) {
      items.push(
        `제약 — 수직. 전방패스 Y ${pctText(hx.front.yRate)}, 횡(T) ${hx.front.t}회. 완성 패스 중 T는 점유, Y만 진행이다. 한 시퀀스에 Y가 없으면 리셋하는 빌드업 게임을 넣는다.`
      );
    }
    if (hx && hx.aerial.total >= 10 && hx.aerial.winRate <= 40 && home.progression.crossShare >= 45) {
      items.push(
        `제약 — 약한 공중을 그만 보낸다. 공중 승률 ${pctText(hx.aerial.winRate)}인데 크로스 의존 ${pctText(home.progression.crossShare)}. 크로스 대신 컷백만 득점인 게임을 15분.`
      );
    }
    if (hx && hx.shots.blockRate >= 22 && hx.shots.block >= 3) {
      items.push(
        `제약 — 블락된 슈팅. ${pctText(hx.shots.blockRate)}가 첫 수비수에 맞았다. 컷백 수신 첫 터치 슈팅만 인정.`
      );
    }
    if (hx && hx.setpiece.corners >= 5 && hx.setpiece.cornerRate < 20) {
      items.push(
        `세트피스 루틴. 코너 ${hx.setpiece.corners}개 → 슈팅 ${pctText(hx.setpiece.cornerRate)}. 니어 스크린과 세컨드볼 존을 다시 짠다.`
      );
    }
    if (away.shooting.avgXg > hs.avgXg + 0.04) {
      items.push(
        `수비 과제. ${topic(awayName)} 슈팅당 xG ${fmt(away.shooting.avgXg, 3)} vs ${homeName} ${fmt(hs.avgXg, 3)}. 상대가 존 14·컷백 중 어느 각으로 그 질을 만들었는지 첫 패스부터 차단한다.`
      );
    }
    if (!items.length) {
      items.push(
        "구조적 결함은 뚜렷하지 않다. 이런 경기는 제약 게임보다 장면 단위 복기(마지막 패스의 발, 수신 각, 골키퍼 스타트)가 효율이 크다."
      );
    }

    const closing =
      meta?.score && meta.score.home !== undefined
        ? `최종 ${meta.score.home}-${meta.score.away}. 스코어는 한 번이다. 위의 경로는 다음 주에도 상대가 준비해 온다.`
        : "고쳐야 할 것은 결과가 아니라, 점유가 내부로 번역되는 경로다.";

    return {
      id: "staff",
      kicker: "EX · 13 스태프 노트",
      title: "다음 세션의 제약",
      lead: "분석의 출력은 슬라이드가 아니라 훈련의 규칙이다. 제약이 디브리프를 대체한다.",
      paragraphs: items.concat([closing]),
    };
  }

  function build(ctx) {
    if (!ctx) throw new Error("전문가 분석 컨텍스트가 없습니다.");
    if (!ctx.home?.expert || !ctx.away?.expert) {
      throw new Error("전문가 지표를 계산하지 못했습니다.");
    }
    const chapters = [];
    const builders = [
      chapterThesis,
      chapterOccupancy,
      chapterPress,
      chapterLines,
      chapterFinal,
      chapterRest,
      chapterState,
      chapterNetwork,
      chapterDuels,
      chapterFinish,
      chapterRestart,
      chapterSubs,
      chapterStaff,
    ];
    for (const fn of builders) {
      try {
        const ch = fn(ctx);
        if (ch && ch.paragraphs && ch.paragraphs.length) {
          ch.paragraphs = ch.paragraphs.filter((p) => String(p || "").trim());
          chapters.push(ch);
        }
      } catch (err) {
        console.error("[ExpertAnalyst] chapter failed:", fn.name, err);
      }
    }
    return { chapters };
  }

  return { build, thesisLine };
})();

const ExpertView = (() => {
  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])
    );
  }

  function fmt(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
    return Number(n).toFixed(digits).replace(/\.0+$/, "");
  }

  function metricsHtml(metrics, homeName, awayName) {
    if (!metrics || !metrics.length) return "";
    const rows = metrics
      .map(
        (m) =>
          `<div class="ex-metric">` +
          `<div class="ex-metric-label">${escapeHtml(m.label)}</div>` +
          `<div class="ex-metric-values">` +
          `<span class="ex-metric-home">${escapeHtml(String(m.home))}</span>` +
          `<span class="ex-metric-sep">vs</span>` +
          `<span class="ex-metric-away">${escapeHtml(String(m.away))}</span>` +
          `</div>` +
          (m.hint ? `<div class="ex-metric-hint">${escapeHtml(m.hint)}</div>` : "") +
          `</div>`
      )
      .join("");
    return (
      `<div class="ex-metric-head"><span class="ex-tag home">${escapeHtml(homeName)}</span>` +
      `<span class="ex-tag away">${escapeHtml(awayName)}</span></div>` +
      `<div class="ex-metric-grid">${rows}</div>`
    );
  }

  function stripHtml(ctx) {
    const hx = ctx.home.expert;
    const ax = ctx.away.expert;
    const cells = [
      { k: "필드 틸트", v: `${fmt(ctx.tilt.home, 1)}%` },
      { k: "PPDA", v: ctx.home.pressing.ppda == null ? "-" : fmt(ctx.home.pressing.ppda, 2) },
      { k: "하프스페이스", v: hx ? `${fmt(hx.occupancy.halfSpaceRate, 1)}%` : "-" },
      { k: "라인 사이", v: hx ? `${hx.betweenLine}회` : "-" },
      { k: "존 14", v: `${ctx.home.progression.zone14}회` },
      { k: "레스트 붕괴", v: hx ? `${fmt(hx.restBreachRate, 1)}%` : "-" },
      { k: "전방패스 Y", v: hx ? `${fmt(hx.front.yRate, 1)}%` : "-" },
      { k: "공중 승률", v: hx ? `${fmt(hx.aerial.winRate, 1)}%` : "-" },
      { k: "유효슈팅률", v: hx ? `${fmt(hx.shots.onRate, 1)}%` : "-" },
      { k: "프레스 성공", v: hx ? `${fmt(hx.press.successRate, 1)}%` : "-" },
    ];
    return (
      `<p class="ex-strip-kicker">${escapeHtml(ctx.homeName)} 기준 스태프 스트립` +
      (ax ? ` · ${escapeHtml(ctx.awayName)} 대비` : "") +
      `</p>` +
      `<div class="ex-strip-grid">` +
      cells
        .map(
          (c) =>
            `<div class="ex-strip-cell"><dt>${escapeHtml(c.k)}</dt><dd>${escapeHtml(c.v)}</dd></div>`
        )
        .join("") +
      `</div>`
    );
  }

  function renderChapters(ctx, chapters) {
    const box = $("exChapters");
    if (!box) return;
    if (!chapters || !chapters.length) {
      box.innerHTML = `<article class="ex-chapter"><p>전문가 분석을 만들 이벤트가 부족합니다.</p></article>`;
      return;
    }
    box.innerHTML = chapters
      .map((ch) => {
        const paras = ch.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
        return (
          `<article class="ex-chapter" id="ex-${escapeHtml(ch.id)}" data-outline="${escapeHtml(
            ch.title
          )}">` +
          `<div class="ex-chapter-head">` +
          `<div class="ex-kicker">${escapeHtml(ch.kicker)}</div>` +
          `<h3>${escapeHtml(ch.title)}</h3>` +
          (ch.lead ? `<p class="ex-lead">${escapeHtml(ch.lead)}</p>` : "") +
          `</div>` +
          metricsHtml(ch.metrics, ctx.homeName, ctx.awayName) +
          `<div class="ex-chapter-body">${paras}</div>` +
          `</article>`
        );
      })
      .join("");
  }

  function render(ctx) {
    const section = $("expert");
    if (!section) return;
    if (!ctx) {
      const box = $("exChapters");
      if (box) {
        box.innerHTML = `<article class="ex-chapter"><p>전문가 브리핑을 만들 데이터가 없습니다.</p></article>`;
      }
      return;
    }
    try {
      const { chapters } = ExpertAnalyst.build(ctx);
      if ($("exStrip")) $("exStrip").innerHTML = stripHtml(ctx);
      renderChapters(ctx, chapters);
    } catch (err) {
      console.error("[ExpertView] render failed:", err);
      if ($("exStrip")) $("exStrip").innerHTML = "";
      const box = $("exChapters");
      if (box) {
        box.innerHTML = `<article class="ex-chapter"><p>전문가 브리핑을 만드는 중 오류가 발생했습니다: ${escapeHtml(
          err.message
        )}</p></article>`;
      }
    }
  }

  return { render };
})();

window.ExpertAnalyst = ExpertAnalyst;
window.ExpertView = ExpertView;
