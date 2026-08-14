/* Match analysis helpers derived from CHALK BOARD event JSON. */

const Analyze = (() => {
  const DETAIL = {
    PSS: "패스 성공",
    PSU: "패스 실패",
    GL: "골",
    MST: "벗어난 슈팅",
    BT: "블락된 슈팅",
    AST: "도움",
    TKS: "태클 성공",
    TKU: "태클 시도",
    DS: "드리블 성공",
    DU: "드리블/경합",
    FOC: "파울",
    FOW: "피파울",
    INT: "인터셉트",
    CUT: "차단",
    CLG: "클리어링",
    RCV: "볼 획득",
    GC: "선방",
    YLC: "경고",
    STB: "슈팅 차단",
    OPCS: "압박 성공",
    OPCU: "압박",
  };

  function absSeconds(e) {
    const min = Number(e.MIN_TIME || 0);
    const sec = Number(e.SEC_TIME || 0);
    return min * 60 + sec;
  }

  function formatClock(e) {
    const period = Number(e.PERIOD_ID || 1);
    const min = Number(e.MIN_TIME || 0);
    const sec = Number(e.SEC_TIME || 0);
    if (period === 1) {
      if (min <= 45) return `전반 ${min}'`;
      return `전반 45+${min - 45}'`;
    }
    const second = min - 45;
    if (second <= 45) return `후반 ${Math.max(second, 0)}'`;
    return `후반 45+${second - 45}'`;
  }

  function playerMap(players) {
    const map = new Map();
    for (const p of players || []) {
      map.set(String(p.player_id), p);
    }
    return map;
  }

  function nameOf(map, playerId, fallback = "선수") {
    const p = map.get(String(playerId));
    if (!p) return fallback;
    return p.NAME || p.name || fallback;
  }

  function teamStats(events, homeId, awayId) {
    const blank = () => ({
      shots: 0,
      sot: 0,
      goals: 0,
      xg: 0,
      passes: 0,
      passOk: 0,
      tackles: 0,
      dribbles: 0,
      fouls: 0,
      saves: 0,
    });
    const out = { [homeId]: blank(), [awayId]: blank() };

    for (const e of events) {
      const row = out[e.TEAM_ID];
      if (!row) continue;
      const d = e.TYPE_DETAIL_CD;
      if (e.TYPE_CD === "ST") {
        row.shots += 1;
        row.xg += Number(e.EXPECTED_GOAL || 0);
        if (d === "GL") row.goals += 1;
      }
      if (e.TYPE_CD === "PS") {
        row.passes += 1;
        if (d === "PSS") row.passOk += 1;
      }
      if (d === "TKS" || d === "TKU") row.tackles += 1;
      if (d === "DS" || d === "DU") row.dribbles += 1;
      if (d === "FOC") row.fouls += 1;
      if (d === "GC") row.saves += 1;
    }

    // Recompute SOT more reliably: goals + shots with goalpost site and not missed/blocked
    for (const teamId of [homeId, awayId]) {
      out[teamId].sot = events.filter((e) => {
        if (e.TEAM_ID !== teamId || e.TYPE_CD !== "ST") return false;
        if (e.TYPE_DETAIL_CD === "GL") return true;
        if (e.TYPE_DETAIL_CD === "MST" || e.TYPE_DETAIL_CD === "BT" || e.TYPE_DETAIL_CD === "STB") return false;
        return Boolean(e.SHOT_GOALPOST_SITE);
      }).length;
      out[teamId].xg = Number(out[teamId].xg.toFixed(2));
    }
    return out;
  }

  function goals(events) {
    return events
      .filter((e) => e.TYPE_DETAIL_CD === "GL")
      .sort((a, b) => absSeconds(a) - absSeconds(b));
  }

  function sequenceBeforeGoal(events, goal, windowSec = 25) {
    const t = absSeconds(goal);
    const team = goal.TEAM_ID;
    const prior = events
      .filter((e) => e.TEAM_ID === team && absSeconds(e) <= t && absSeconds(e) >= t - windowSec)
      .sort((a, b) => absSeconds(a) - absSeconds(b));

    // Keep pass-like and the goal itself
    const useful = prior.filter(
      (e) => e.TYPE_CD === "PS" || e.TYPE_DETAIL_CD === "AST" || e.TYPE_DETAIL_CD === "GL" || e.TYPE_CD === "ST"
    );
    return useful.slice(-8);
  }

  function playerEvents(events, playerId, typeFilter) {
    return events.filter((e) => {
      if (String(e.PLAYER_ID) !== String(playerId)) return false;
      if (!typeFilter || typeFilter === "ALL") return true;
      if (typeFilter === "PS") return e.TYPE_CD === "PS";
      if (typeFilter === "ST") return e.TYPE_CD === "ST";
      if (typeFilter === "DF") return e.TYPE_CD === "DF" || ["TKS", "TKU", "INT", "CUT", "CLG", "RCV"].includes(e.TYPE_DETAIL_CD);
      if (typeFilter === "DR") return ["DS", "DU"].includes(e.TYPE_DETAIL_CD);
      if (typeFilter === "FO") return e.TYPE_CD === "FO";
      if (typeFilter === "GK") return e.TYPE_CD === "GK" || e.TYPE_DETAIL_CD === "GC";
      return true;
    });
  }

  function rankPlayers(events, players, homeId) {
    const map = playerMap(players);
    const stats = new Map();
    for (const e of events) {
      const id = String(e.PLAYER_ID);
      if (!stats.has(id)) {
        const p = map.get(id);
        stats.set(id, {
          player_id: id,
          name: nameOf(map, id),
          team_id: e.TEAM_ID,
          back_no: e.back_no || p?.back_no || "",
          pos: p?.Position_Name || "",
          touches: 0,
          passes: 0,
          passOk: 0,
          shots: 0,
          xg: 0,
          goals: 0,
        });
      }
      const row = stats.get(id);
      row.touches += 1;
      if (e.TYPE_CD === "PS") {
        row.passes += 1;
        if (e.TYPE_DETAIL_CD === "PSS") row.passOk += 1;
      }
      if (e.TYPE_CD === "ST") {
        row.shots += 1;
        row.xg += Number(e.EXPECTED_GOAL || 0);
      }
      if (e.TYPE_DETAIL_CD === "GL") row.goals += 1;
    }

    return [...stats.values()]
      .filter((p) => p.team_id === homeId || true)
      .sort((a, b) => b.touches - a.touches);
  }

  function buildFullReportText(meta, stats, goalList, pmap, events, players, pageUrl) {
    const h = stats[meta.home.team_id];
    const a = stats[meta.away.team_id];
    const lines = [];
    const url = pageUrl || "https://wanju1109.github.io/jeonbuk-lineup/c_report/";

    lines.push("JEONBUK MATCH REPORT");
    lines.push(`${meta.competition} ${meta.round}라운드 · ${meta.home.name} vs ${meta.away.name}`);
    lines.push("CHALK BOARD 이벤트로 골 장면, 히트맵, xG를 한 번에 읽는 전북 팬 매치 리포트.");
    lines.push("");
    lines.push(`▶ 인터랙티브 리포트(히트맵/골 궤적 포함): ${url}`);
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("1. 경기 한눈에");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push(`${meta.home.name} ${meta.score.home} : ${meta.score.away} ${meta.away.name}`);
    lines.push(
      [
        meta.competition,
        `${meta.round}라운드`,
        meta.date,
        meta.venue,
        meta.attendance ? `관중 ${Number(meta.attendance).toLocaleString()}` : "",
        meta.weather || "",
        meta.referee ? `주심 ${meta.referee}` : "",
        meta.home.manager ? `전북 감독 ${meta.home.manager}` : "",
        meta.away.manager ? `제주 감독 ${meta.away.manager}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    );
    lines.push("");
    if (h.xg > a.xg && meta.score.home < meta.score.away) {
      lines.push(
        `[핵심] 전북 xG ${h.xg} > 제주 ${a.xg}. 기회 품질은 앞섰지만 스코어는 ${meta.score.home}-${meta.score.away}. 만들었는데 못 넣었다기보다, 상대는 넣었고 우리는 마무리가 아쉬웠다는 그림입니다.`
      );
    } else {
      lines.push(
        `[핵심] 최종 스코어 ${meta.score.home}-${meta.score.away}. 슈팅 ${h.shots}-${a.shots}, xG ${h.xg}-${a.xg}.`
      );
    }
    lines.push(
      "[초보] xG(예상 득점)는 슈팅 위치·상황을 점수로 환산한 값입니다. 0.05면 어려운 슈팅, 0.30이면 꽤 좋은 기회예요."
    );
    lines.push(
      `[전문가] 전북 슈팅 ${h.shots} / 제주 ${a.shots}. 패스량(${h.passes} vs ${a.passes})은 전북이 앞섰고, 제주는 결정력(특히 PK 포함 마무리)로 승부를 갈랐습니다.`
    );
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("2. 숫자로 보는 승부 (전북 : 제주)");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push(`xG(골 기대값)  ${h.xg} : ${a.xg}`);
    lines.push(`슈팅           ${h.shots} : ${a.shots}`);
    lines.push(`유효슈팅(추정) ${h.sot} : ${a.sot}`);
    lines.push(`패스           ${h.passes} : ${a.passes}`);
    lines.push(`패스 성공      ${h.passOk} : ${a.passOk}`);
    lines.push(
      `패스 성공률    ${h.passes ? ((h.passOk / h.passes) * 100).toFixed(1) : "-"}% : ${
        a.passes ? ((a.passOk / a.passes) * 100).toFixed(1) : "-"
      }%`
    );
    lines.push(`태클           ${h.tackles} : ${a.tackles}`);
    lines.push(`드리블         ${h.dribbles} : ${a.dribbles}`);
    lines.push(`파울           ${h.fouls} : ${a.fouls}`);
    lines.push(`선방           ${h.saves} : ${a.saves}`);
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("3. 골 스토리");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    goalList.forEach((g, gi) => {
      const nm = nameOf(pmap, g.PLAYER_ID);
      const team = g.TEAM_ID === meta.home.team_id ? meta.home.name : meta.away.name;
      const pk = g.TYPE_DETAIL_CD2 === "PK" ? " (PK)" : "";
      lines.push("");
      lines.push(
        `[골 ${gi + 1}] ${formatClock(g)} · ${team} ${nm}${pk} · #${g.back_no || "-"} · xG ${Number(
          g.EXPECTED_GOAL || 0
        ).toFixed(2)}`
      );
      const seq = sequenceBeforeGoal(events, g, 28);
      seq.forEach((e, i) => {
        const label = DETAIL[e.TYPE_DETAIL_CD] || e.TYPE_CD || "액션";
        lines.push(
          `  ${i + 1}. ${nameOf(pmap, e.PLAYER_ID)} · ${label} · ${formatClock(e)}`
        );
      });
    });
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("4. 전북 선수 터치/패스/슈팅");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    const rankedHome = rankPlayers(events, players, meta.home.team_id).filter(
      (p) => p.team_id === meta.home.team_id
    );
    rankedHome.slice(0, 16).forEach((p) => {
      lines.push(
        `#${p.back_no || "-"} ${p.name} (${p.pos || "-"}) · 이벤트 ${p.touches} · 패스 ${p.passOk}/${p.passes} · 슈팅 ${p.shots} · xG ${p.xg.toFixed(
          2
        )} · 골 ${p.goals}`
      );
    });
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("5. 제주 선수 터치/패스/슈팅");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    const rankedAway = rankPlayers(events, players, meta.home.team_id).filter(
      (p) => p.team_id === meta.away.team_id
    );
    rankedAway.slice(0, 16).forEach((p) => {
      lines.push(
        `#${p.back_no || "-"} ${p.name} (${p.pos || "-"}) · 이벤트 ${p.touches} · 패스 ${p.passOk}/${p.passes} · 슈팅 ${p.shots} · xG ${p.xg.toFixed(
          2
        )} · 골 ${p.goals}`
      );
    });
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("6. 용어 가이드");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("xG: 그 슈팅이 평균적으로 골이 될 확률. 0.1이면 10번 중 1번 들어갈 자리.");
    lines.push("히트맵: 선수가 많이 터치한 지역. 어디에 있었나를 한눈에 보여줍니다.");
    lines.push("패스 성공: 동료에게 정상 연결된 패스. 성공률과 함께 전진 여부를 보세요.");
    lines.push("CHALK BOARD: K리그 포털의 이벤트 좌표 보드(슈팅·패스·태클 위치).");
    lines.push("");
    lines.push(`히트맵·슈팅맵·골 궤적은 페이지에서 그대로 볼 수 있습니다: ${url}`);
    lines.push("");
    lines.push("데이터: K리그 포털 CHALK BOARD(Bepro11 부가기록) 재가공 · 공식기록과 다를 수 있음");
    return lines.join("\n");
  }

  return {
    DETAIL,
    absSeconds,
    formatClock,
    playerMap,
    nameOf,
    teamStats,
    goals,
    sequenceBeforeGoal,
    playerEvents,
    rankPlayers,
    buildFullReportText,
  };
})();

window.Analyze = Analyze;
