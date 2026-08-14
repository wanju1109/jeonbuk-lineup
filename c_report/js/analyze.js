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
      yellows: 0,
      clearances: 0,
      interceptions: 0,
      aerialWon: 0,
      presses: 0,
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
      if (d === "YLC") row.yellows += 1;
      if (d === "CLG") row.clearances += 1;
      if (d === "INT" || d === "CUT") row.interceptions += 1;
      if (d === "ADW") row.aerialWon += 1;
      if (d === "OPCS" || d === "OPCU") row.presses += 1;
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

  function periodStats(events, homeId, awayId) {
    const blank = () => ({ xg: 0, shots: 0, sot: 0, goals: 0, passes: 0, passOk: 0 });
    const out = {
      1: { [homeId]: blank(), [awayId]: blank() },
      2: { [homeId]: blank(), [awayId]: blank() },
    };
    for (const e of events) {
      const period = Number(e.PERIOD_ID || 1) <= 1 ? 1 : 2;
      const row = out[period][e.TEAM_ID];
      if (!row) continue;
      const d = e.TYPE_DETAIL_CD;
      if (e.TYPE_CD === "ST") {
        row.shots += 1;
        row.xg += Number(e.EXPECTED_GOAL || 0);
        if (d === "GL") row.goals += 1;
        if (d === "GL") row.sot += 1;
        else if (d !== "MST" && d !== "BT" && d !== "STB" && e.SHOT_GOALPOST_SITE) row.sot += 1;
      }
      if (e.TYPE_CD === "PS") {
        row.passes += 1;
        if (d === "PSS") row.passOk += 1;
      }
    }
    for (const period of [1, 2]) {
      for (const id of [homeId, awayId]) {
        out[period][id].xg = Number(out[period][id].xg.toFixed(2));
      }
    }
    return out;
  }

  function flowAfterFirstGoal(events, homeId, awayId) {
    const goalList = goals(events);
    if (!goalList.length) {
      return {
        hasFirstGoal: false,
        text: "골이 없어 선제골 이후 흐름을 나눌 수 없습니다.",
      };
    }
    const first = goalList[0];
    const t0 = absSeconds(first);
    const before = { [homeId]: { xg: 0, shots: 0, goals: 0 }, [awayId]: { xg: 0, shots: 0, goals: 0 } };
    const after = { [homeId]: { xg: 0, shots: 0, goals: 0 }, [awayId]: { xg: 0, shots: 0, goals: 0 } };

    for (const e of events) {
      if (e.TYPE_CD !== "ST") continue;
      const bucket = absSeconds(e) < t0 ? before : after;
      const row = bucket[e.TEAM_ID];
      if (!row) continue;
      row.shots += 1;
      row.xg += Number(e.EXPECTED_GOAL || 0);
      if (e.TYPE_DETAIL_CD === "GL") row.goals += 1;
    }
    for (const side of [before, after]) {
      for (const id of [homeId, awayId]) {
        side[id].xg = Number(side[id].xg.toFixed(2));
      }
    }

    const scorerSide = first.TEAM_ID === homeId ? "home" : "away";
    return {
      hasFirstGoal: true,
      firstGoal: first,
      scorerSide,
      before,
      after,
      clock: formatClock(first),
    };
  }

  function attendanceCompare(meta, index) {
    const att = meta?.attendance;
    const rows = (index?.matches || []).filter((m) => m.attendance != null && m.attendance !== "");
    const nums = rows.map((m) => Number(m.attendance)).filter((n) => !Number.isNaN(n) && n > 0);
    if (att == null || !nums.length) {
      return { available: false };
    }
    const avgAll = nums.reduce((s, n) => s + n, 0) / nums.length;
    const homeName = meta.home?.name || "전북";
    const homeRows = rows.filter((m) => String(m.home || "").includes(homeName) || String(m.home || "") === homeName);
    const homeNums = homeRows.map((m) => Number(m.attendance)).filter((n) => !Number.isNaN(n) && n > 0);
    const avgHome = homeNums.length ? homeNums.reduce((s, n) => s + n, 0) / homeNums.length : null;
    const isHome = String(meta.home?.name || "").includes("전북");
    const baseline = isHome && avgHome != null ? avgHome : avgAll;
    const baselineLabel = isHome && avgHome != null ? "시즌 홈 평균" : "시즌 평균(수집분)";
    const diff = Number(att) - baseline;
    const pct = baseline ? (diff / baseline) * 100 : 0;
    return {
      available: true,
      attendance: Number(att),
      avgAll: Math.round(avgAll),
      avgHome: avgHome != null ? Math.round(avgHome) : null,
      baseline: Math.round(baseline),
      baselineLabel,
      diff: Math.round(diff),
      pct: Math.round(pct * 10) / 10,
      sampleSize: nums.length,
      homeSampleSize: homeNums.length,
      isHome,
    };
  }

  function lineupSides(lineup) {
    return {
      home: lineup?.home || [],
      away: lineup?.away || [],
      subs: lineup?.subs || [],
    };
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

  /**
   * Normalize event coords so each team "attacks to the right" for territory math.
   * Period 2 flips absolute pitch; then away side is mirrored for team-perspective.
   */
  function teamPerspectivePoint(event, homeId) {
    const x0 = Number(event.START_POINT_X);
    const y0 = Number(event.START_POINT_Y);
    const x1 = Number(event.END_POINT_X);
    const y1 = Number(event.END_POINT_Y);
    const period = Number(event.PERIOD_ID || 1);
    const flip = period === 2;
    const mapX = (x) => (flip ? 100 - x : x);
    const mapY = (y) => (flip ? 100 - y : y);
    let x = mapX(x0);
    let y = mapY(y0);
    let ex = Number.isFinite(x1) ? mapX(x1) : null;
    let ey = Number.isFinite(y1) ? mapY(y1) : null;
    if (event.TEAM_ID !== homeId) {
      x = 100 - x;
      y = 100 - y;
      if (ex != null) ex = 100 - ex;
      if (ey != null) ey = 100 - ey;
    }
    return { x, y, ex, ey };
  }

  function pct(n, d) {
    if (!d) return 0;
    return Math.round((n / d) * 1000) / 10;
  }

  /** Attach Korean topic particle 은/는 by Hangul batchim. */
  function eunNeun(name) {
    const s = String(name || "");
    const ch = s.charCodeAt(s.length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3) {
      return (ch - 0xac00) % 28 ? `${s}은` : `${s}는`;
    }
    return `${s}은(는)`;
  }

  function iGa(name) {
    const s = String(name || "");
    const ch = s.charCodeAt(s.length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3) {
      return (ch - 0xac00) % 28 ? `${s}이` : `${s}가`;
    }
    return `${s}이(가)`;
  }

  function passRate(row) {
    return pct(row.passOk, row.passes);
  }

  function sideLabel(widthShare) {
    if (widthShare.left >= 38) return "왼쪽 하프스페이스·왼쪽 측면";
    if (widthShare.right >= 38) return "오른쪽 하프스페이스·오른쪽 측면";
    if (widthShare.center >= 45) return "중앙 채널";
    return "좌·중앙·우를 고르게 쓰는 분산 패턴";
  }

  function zoneShare(events, teamId, homeId) {
    let defn = 0;
    let mid = 0;
    let atk = 0;
    let left = 0;
    let center = 0;
    let right = 0;
    let sumX = 0;
    let n = 0;
    let prog = 0;
    let passes = 0;
    let finalThirdTouches = 0;
    let boxTouches = 0;
    let pressesHigh = 0;
    let presses = 0;

    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      const useful =
        e.TYPE_CD === "PS" ||
        e.TYPE_CD === "ST" ||
        e.TYPE_CD === "DF" ||
        e.TYPE_CD === "DU" ||
        e.TYPE_CD === "FO";
      if (!useful) continue;
      const pt = teamPerspectivePoint(e, homeId);
      if (!Number.isFinite(pt.x) || !Number.isFinite(pt.y)) continue;
      n += 1;
      sumX += pt.x;
      if (pt.x < 33) defn += 1;
      else if (pt.x < 66) mid += 1;
      else atk += 1;
      if (pt.y < 33) left += 1;
      else if (pt.y > 67) right += 1;
      else center += 1;
      if (pt.x >= 66) finalThirdTouches += 1;
      if (pt.x >= 82 && pt.y >= 20 && pt.y <= 80) boxTouches += 1;

      if (e.TYPE_CD === "PS") {
        passes += 1;
        if (pt.ex != null && pt.ex - pt.x >= 12) prog += 1;
      }
      if (e.TYPE_DETAIL_CD === "OPCS" || e.TYPE_DETAIL_CD === "OPCU") {
        presses += 1;
        if (pt.x >= 55) pressesHigh += 1;
      }
    }

    return {
      avgX: n ? Math.round((sumX / n) * 10) / 10 : 50,
      thirds: {
        def: pct(defn, n),
        mid: pct(mid, n),
        atk: pct(atk, n),
        defN: defn,
        midN: mid,
        atkN: atk,
        n,
      },
      width: {
        left: pct(left, n),
        center: pct(center, n),
        right: pct(right, n),
      },
      progressivePasses: prog,
      passes,
      progressiveRate: pct(prog, passes),
      finalThirdTouches,
      boxTouches,
      presses,
      pressesHigh,
      highPressShare: pct(pressesHigh, presses),
    };
  }

  function shotProfile(events, teamId, homeId) {
    const shots = events.filter((e) => e.TEAM_ID === teamId && e.TYPE_CD === "ST");
    let left = 0;
    let center = 0;
    let right = 0;
    let box = 0;
    let outBox = 0;
    let big = 0;
    let low = 0;
    let sumXg = 0;
    for (const e of shots) {
      const pt = teamPerspectivePoint(e, homeId);
      const xg = Number(e.EXPECTED_GOAL || 0);
      sumXg += xg;
      if (xg >= 0.25) big += 1;
      else if (xg < 0.08) low += 1;
      if (pt.y < 33) left += 1;
      else if (pt.y > 67) right += 1;
      else center += 1;
      if (pt.x >= 82) box += 1;
      else outBox += 1;
    }
    return {
      n: shots.length,
      left,
      center,
      right,
      box,
      outBox,
      big,
      low,
      avgXg: shots.length ? Math.round((sumXg / shots.length) * 1000) / 1000 : 0,
      channel: sideLabel({
        left: pct(left, shots.length),
        center: pct(center, shots.length),
        right: pct(right, shots.length),
      }),
    };
  }

  function keyActors(events, players, teamId, homeId, limit = 3) {
    const ranked = rankPlayers(events, players, homeId).filter((p) => p.team_id === teamId);
    const creators = [...ranked].sort((a, b) => b.passOk - a.passOk || b.touches - a.touches);
    const finishers = [...ranked].sort((a, b) => b.xg - a.xg || b.shots - a.shots);
    const carriers = [...ranked].sort((a, b) => b.touches - a.touches);

    const defActions = new Map();
    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      const d = e.TYPE_DETAIL_CD;
      if (!["TKS", "TKU", "INT", "CUT", "CLG", "RCV", "OPCS"].includes(d)) continue;
      const id = String(e.PLAYER_ID);
      defActions.set(id, (defActions.get(id) || 0) + 1);
    }
    const defenders = ranked
      .map((p) => ({ ...p, def: defActions.get(p.player_id) || 0 }))
      .sort((a, b) => b.def - a.def);

    return {
      touchLeader: carriers[0] || null,
      passer: creators[0] || null,
      threat: finishers[0] || null,
      defender: defenders[0] || null,
      topTouch: carriers.slice(0, limit),
      topThreat: finishers.filter((p) => p.shots > 0 || p.xg > 0).slice(0, limit),
    };
  }

  function describeGameState(meta, stats, periods, flow, zoneH, zoneA) {
    const home = meta.home.name;
    const away = meta.away.name;
    const h = stats[meta.home.team_id];
    const a = stats[meta.away.team_id];
    const hs = meta.score.home;
    const as = meta.score.away;
    const xgGap = Math.round((h.xg - a.xg) * 100) / 100;
    const terrGap = Math.round((zoneH.avgX - zoneA.avgX) * 10) / 10;

    let thesis = "";
    if (hs > as && xgGap >= 0.2) {
      thesis = `${iGa(home)} 영토와 기회 품질을 동시에 가져간 경기입니다. 스코어(${hs}-${as})가 과정과 대체로 일치합니다.`;
    } else if (hs < as && xgGap > 0.15) {
      thesis = `${iGa(home)} xG(${h.xg} vs ${a.xg})와 최종 진영 점유에서는 앞섰지만, 결과(${hs}-${as})는 반대입니다. ‘기회는 만들었고, 상대는 마무리를 했다’는 전형적인 효율 패배 구도입니다.`;
    } else if (hs < as && xgGap < -0.15) {
      thesis = `${iGa(away)} 기회 품질과 결과까지 장악한 경기입니다. ${eunNeun(home)} 수비 블록이 무너진 구간에서 상처가 누적됐습니다.`;
    } else if (hs > as && xgGap < -0.1) {
      thesis = `${iGa(home)} 기회 품질에서는 밀렸지만 결과(${hs}-${as})를 가져갔습니다. 전환·세트피스·PK처럼 ‘한 방’의 효율이 승부를 가른 그림입니다.`;
    } else if (hs === as) {
      thesis = `스코어는 ${hs}-${as}로 균형을 이뤘습니다. xG ${h.xg}-${a.xg}, 영토 지표(평균 진영 ${zoneH.avgX} vs ${zoneA.avgX})를 함께 보면 누가 경기를 ‘지배했는지’와 ‘끝냈는지’가 갈립니다.`;
    } else {
      thesis = `최종 ${hs}-${as}. 슈팅 ${h.shots}-${a.shots}, xG ${h.xg}-${a.xg}. 숫자는 팽팽했지만, 결정적 국면의 선택이 결과를 갈랐습니다.`;
    }

    let structure = "";
    if (zoneH.avgX >= 52 && zoneA.avgX <= 45) {
      structure = `${iGa(home)} 상대를 자기 진영으로 밀어 넣는 전진 압박·점유형에 가깝고, ${eunNeun(away)} 미드블록·로우블록에서 전환을 노리는 그림입니다.`;
    } else if (zoneA.avgX >= 52 && zoneH.avgX <= 45) {
      structure = `${iGa(away)} 필드를 밀어붙였고 ${eunNeun(home)} 깊은 수비에서 버티는 구도였습니다.`;
    } else if (Math.abs(terrGap) < 4) {
      structure = `양 팀의 평균 진영 높이가 비슷해(${zoneH.avgX} vs ${zoneA.avgX}), 미드필드 듀얼과 2차 볼 경합이 승부처였습니다.`;
    } else {
      structure = `${home} 평균 진영 ${zoneH.avgX}, ${away} ${zoneA.avgX}. 누가 하프라인 위쪽에서 공을 잡느냐가 템포를 결정했습니다.`;
    }

    if (h.presses > a.presses * 1.25) {
      structure += ` 압박 횟수(${h.presses} vs ${a.presses})도 ${iGa(home)} 앞서, 의도적으로 상대 빌드업을 끊으려 한 흔적이 있습니다.`;
    } else if (a.presses > h.presses * 1.25) {
      structure += ` ${away}의 압박(${a.presses} vs ${h.presses})이 더 많아, ${home} 빌드업이 자주 끊겼을 가능성이 큽니다.`;
    }

    return { thesis, structure, xgGap, terrGap };
  }

  function buildGoalNarratives(goalList, events, meta, pmap) {
    return goalList.map((g, gi) => {
      const team = g.TEAM_ID === meta.home.team_id ? meta.home.name : meta.away.name;
      const scorer = nameOf(pmap, g.PLAYER_ID);
      const xg = Number(g.EXPECTED_GOAL || 0);
      const pk = g.TYPE_DETAIL_CD2 === "PK";
      const seq = sequenceBeforeGoal(events, g, 28);
      const passChain = seq.filter((e) => e.TYPE_CD === "PS" || e.TYPE_DETAIL_CD === "AST");
      const names = [...new Set(passChain.map((e) => nameOf(pmap, e.PLAYER_ID)))];
      let pattern = "";
      if (pk) {
        pattern = "PK로 마무리된 장면입니다. 세트피스/파울 유도 구간이 이미 승부처가 됐다는 뜻입니다.";
      } else if (xg >= 0.35) {
        pattern = `xG ${xg.toFixed(2)}의 고확률 기회 — 박스 안 결정적 위치에서의 마무리가 골로 연결됐습니다.`;
      } else if (xg <= 0.1) {
        pattern = `xG ${xg.toFixed(2)}의 낮은 확률 슈팅이 들어갔습니다. 수비 조직이 흔들리기보다, 한 순간의 집중력·운·개인 기량이 겹친 골에 가깝습니다.`;
      } else {
        pattern = `xG ${xg.toFixed(2)} 수준의 준수한 기회. 빌드업이 슈팅 지점까지 연결됐다는 점이 중요합니다.`;
      }
      const chainText = names.length
        ? `직전 연결에 관여한 선수: ${names.slice(0, 5).join(" → ")}.`
        : "짧은 전환 또는 개인 돌파 후 바로 슈팅으로 이어진 장면입니다.";
      return {
        title: `골 ${gi + 1} · ${formatClock(g)} · ${team} ${scorer}${pk ? " (PK)" : ""}`,
        text: `${pattern} ${chainText}`,
      };
    });
  }

  function buildTacticalBriefing(meta, events, players, lineup) {
    const homeId = meta.home.team_id;
    const awayId = meta.away.team_id;
    const home = meta.home.name;
    const away = meta.away.name;
    const stats = teamStats(events, homeId, awayId);
    const periods = periodStats(events, homeId, awayId);
    const flow = flowAfterFirstGoal(events, homeId, awayId);
    const goalList = goals(events);
    const pmap = playerMap(players);
    const zoneH = zoneShare(events, homeId, homeId);
    const zoneA = zoneShare(events, awayId, homeId);
    const shotH = shotProfile(events, homeId, homeId);
    const shotA = shotProfile(events, awayId, homeId);
    const actH = keyActors(events, players, homeId, homeId);
    const actA = keyActors(events, players, awayId, homeId);
    const state = describeGameState(meta, stats, periods, flow, zoneH, zoneA);
    const h = stats[homeId];
    const a = stats[awayId];
    const chapters = [];

    chapters.push({
      kicker: "01 · MATCH THESIS",
      title: "오늘 경기의 한 줄 정의",
      paragraphs: [state.thesis, state.structure],
    });

    chapters.push({
      kicker: "02 · TERRITORY & BUILD-UP",
      title: "영토 싸움과 빌드업",
      paragraphs: [
        `${home} 평균 진영 높이 ${zoneH.avgX} (수비3분면 ${zoneH.thirds.def}% / 중원 ${zoneH.thirds.mid}% / 공격 ${zoneH.thirds.atk}%), ${away}는 ${zoneA.avgX} (수비 ${zoneA.thirds.def}% / 중원 ${zoneA.thirds.mid}% / 공격 ${zoneA.thirds.atk}%).`,
        `${home}의 전진 패스(약 12m 이상 전진) ${zoneH.progressivePasses}회(패스 대비 ${zoneH.progressiveRate}%), ${away} ${zoneA.progressivePasses}회(${zoneA.progressiveRate}%). 패스 성공률은 ${home} ${passRate(h)}% (${h.passOk}/${h.passes}), ${away} ${passRate(a)}% (${a.passOk}/${a.passes}).`,
        zoneH.avgX > zoneA.avgX + 5
          ? `${iGa(home)} 필드 높이를 유지한 채 상대를 눌러 붙였습니다. 다만 높은 점유가 곧바로 박스 침투로 이어졌는지는 슈팅 위치와 박스 터치(${home} ${zoneH.boxTouches} vs ${away} ${zoneA.boxTouches})로 검증해야 합니다.`
          : zoneA.avgX > zoneH.avgX + 5
            ? `${iGa(away)} 더 높은 위치에서 플레이했습니다. ${eunNeun(home)} 낮은 블록에서 전환 타이밍을 노리는 매치플랜이 강제됐을 수 있습니다.`
            : `양 팀이 비슷한 높이에서 맞붙었습니다. 이런 날은 ‘첫 압박 후 2차 볼’과 측면 전환의 정확도가 승부를 가릅니다.`,
        `폭 사용: ${eunNeun(home)} ${sideLabel(zoneH.width)} 중심(좌 ${zoneH.width.left}% · 중앙 ${zoneH.width.center}% · 우 ${zoneH.width.right}%), ${eunNeun(away)} ${sideLabel(zoneA.width)} 중심입니다.`,
      ],
    });

    chapters.push({
      kicker: "03 · CHANCE CREATION",
      title: "기회는 어디서 만들어졌나",
      paragraphs: [
        `${home} 슈팅 ${shotH.n}개(박스 안 ${shotH.box} / 박스 밖 ${shotH.outBox}), 평균 xG ${shotH.avgXg}. 주 채널은 ${shotH.channel}. 고확률(xG≥0.25) ${shotH.big}개, 저확률(xG<0.08) ${shotH.low}개.`,
        `${away} 슈팅 ${shotA.n}개(박스 안 ${shotA.box} / 박스 밖 ${shotA.outBox}), 평균 xG ${shotA.avgXg}. 주 채널은 ${shotA.channel}. 고확률 ${shotA.big}개, 저확률 ${shotA.low}개.`,
        shotH.avgXg + 0.03 < shotA.avgXg && h.xg >= a.xg
          ? `${eunNeun(home)} 슈팅 수는 충분했지만 평균 기회 품질이 떨어져, ‘양만 많고 질이 약한’ 패턴이 섞여 있습니다. 컷백·중앙 침투보다 바깥쪽 슈팅 비중이 높았는지 점검할 지점입니다.`
          : shotA.big > shotH.big
            ? `${iGa(away)} 고확률 기회를 더 많이 만들었습니다. 수비 라인 간격이 벌어지는 순간, 혹은 전환 1~2패스에서 박스까지 도달한 장면이 승부처였습니다.`
            : `양 팀의 기회 구조가 비슷해 보입니다. 이런 매치는 골키퍼 선방·포스트·결정력 편차가 스코어를 크게 벌립니다.`,
        `최종 진영 터치 ${home} ${zoneH.finalThirdTouches} vs ${away} ${zoneA.finalThirdTouches}. 공격 3분면 점유와 실제 슈팅 xG가 어긋나면, ‘들어갔는데 마무리 동선이 막힌’ 날입니다.`,
      ],
    });

    const p1h = periods[1][homeId];
    const p1a = periods[1][awayId];
    const p2h = periods[2][homeId];
    const p2a = periods[2][awayId];
    chapters.push({
      kicker: "04 · GAME PHASES",
      title: "전반·후반, 그리고 선제골 이후",
      paragraphs: [
        `전반 xG ${p1h.xg}-${p1a.xg} · 슈팅 ${p1h.shots}-${p1a.shots}. 후반 xG ${p2h.xg}-${p2a.xg} · 슈팅 ${p2h.shots}-${p2a.shots}.`,
        p2h.xg + p2a.xg > p1h.xg + p1a.xg + 0.3
          ? "후반에 경기 개방도가 커졌습니다. 체력·교체·스코어 추격이 라인을 올리며 공간이 열린 전형적인 후반형 매치입니다."
          : p1h.xg + p1a.xg > p2h.xg + p2a.xg + 0.3
            ? "전반에 기회가 몰리고 후반은 잠긴 흐름입니다. 리드 팀이 템포를 죽여 성공했거나, 추격 팀이 조급해지며 패턴이 단순해졌을 수 있습니다."
            : "전·후반의 기회 총량이 비슷합니다. 특정 15분 구간의 집중력 싸움이 더 중요했던 날입니다.",
        flow.hasFirstGoal
          ? `선제골은 ${flow.clock} (${flow.scorerSide === "home" ? home : away}). 이후 xG ${flow.after[homeId].xg}-${flow.after[awayId].xg}, 슈팅 ${flow.after[homeId].shots}-${flow.after[awayId].shots}. ${
              flow.scorerSide === "away" && flow.after[homeId].xg > flow.after[awayId].xg
                ? `${iGa(home)} 추격 국면에서 볼은 가져왔지만, 실점 전후 수비 전환의 상처가 이미 스코어에 각인된 상태였습니다.`
                : flow.scorerSide === "home" && flow.after[awayId].xg > flow.after[homeId].xg
                  ? `리드 이후 ${away}의 반격 xG가 더 컸습니다. 게임 관리(라인 높이·파울 위치·측면 지연)에서 틈이 있었습니다.`
                  : "선제골 팀이 이후 흐름도 대체로 가져가며 게임 스테이트를 굳혔습니다."
            }`
          : "무득점 흐름이라면, 세트피스와 전환 1회 찬스가 갑자기 승부를 가를 수 있는 날이었습니다.",
      ],
    });

    const touchH = actH.touchLeader;
    const threatH = actH.threat;
    const passH = actH.passer;
    const defH = actH.defender;
    const touchA = actA.touchLeader;
    const threatA = actA.threat;
    chapters.push({
      kicker: "05 · PLAYER ROLES",
      title: "움직임과 역할 — 누가 경기를 만들었나",
      paragraphs: [
        touchH
          ? `${home} 볼 관여 1순위는 ${touchH.name}(이벤트 ${touchH.touches}, 패스 ${touchH.passOk}/${touchH.passes}). 중원·측면 연결의 허브로 경기를 순환시킨 축입니다.`
          : `${home} 측 핵심 볼 관여 선수를 특정하기 어렵습니다.`,
        passH && passH.player_id !== touchH?.player_id
          ? `패스 성공 중심은 ${passH.name}(${passH.passOk}성공/${passH.passes}시도). 템포를 늦추거나 측면으로 열어주는 ‘안전 밸브’ 역할이 두드러집니다.`
          : null,
        threatH && (threatH.shots > 0 || threatH.xg > 0)
          ? `위협 창출의 뾰족함은 ${threatH.name}(슈팅 ${threatH.shots}, xG ${threatH.xg.toFixed(2)}, 골 ${threatH.goals}). ${
              threatH.xg >= 0.4 && threatH.goals === 0
                ? "기회를 받았으나 마무리가 아쉬운 날입니다."
                : threatH.goals > 0
                  ? "결정적 장면에서 존재감을 남겼습니다."
                  : "박스 진입·슈팅 타이밍을 계속 만들어 낸 공격 자원입니다."
            }`
          : null,
        defH && defH.def > 0
          ? `수비 개입(태클·차단·클리어·압박)에서 ${iGa(defH.name)} ${defH.def}회로 가장 바빴습니다. 상대 주 공격 채널을 막아선 1차 방패입니다.`
          : null,
        touchA
          ? `${away} 쪽에서는 ${iGa(touchA.name)} 볼을 가장 많이 만졌고(이벤트 ${touchA.touches}), 위협은 ${
              threatA ? `${threatA.name}(xG ${threatA.xg.toFixed(2)})` : "분산"
            } 쪽입니다.`
          : null,
        "히트맵에서 같은 선수의 터치가 한쪽으로 쏠리면, 그 채널이 팀의 ‘계획된 출구’입니다. 반대로 넓게 흩어지면 점유는 되지만 패턴이 없다는 신호일 수 있습니다.",
      ].filter(Boolean),
    });

    const goalChapters = buildGoalNarratives(goalList, events, meta, pmap);
    if (goalChapters.length) {
      chapters.push({
        kicker: "06 · GOALS AS TACTICS",
        title: "골 장면 = 전술의 결과",
        paragraphs: goalChapters.map((g) => `【${g.title}】 ${g.text}`),
      });
    }

    const subs = lineup?.subs || [];
    if (subs.length) {
      const homeSubs = subs.filter((s) => s.team_id === homeId || s.ha === "H");
      const awaySubs = subs.filter((s) => s.team_id === awayId || s.ha === "A");
      const earliest = [...subs].sort(
        (a, b) => Number(a.minute ?? a.min ?? 99) - Number(b.minute ?? b.min ?? 99)
      )[0];
      const earlyMin = Number(earliest?.minute ?? earliest?.min);
      const earlyLabel = earliest?.time_label || (Number.isFinite(earlyMin) ? `${earlyMin}분` : "");
      chapters.push({
        kicker: "07 · ADJUSTMENTS",
        title: "교체와 후반 조정",
        paragraphs: [
          `기록된 교체 ${subs.length}회 (${home} ${homeSubs.length} · ${away} ${awaySubs.length}). ${
            earlyLabel ? `가장 이른 조정은 ${earlyLabel} 전후입니다.` : ""
          }`,
          Number.isFinite(earlyMin) && earlyMin <= 60
            ? "이른 교체는 매치업 패배(측면 1대1, 중원 듀얼)를 인정하고 시스템을 바꾼 신호일 때가 많습니다."
            : "후반 중후반 교체가 중심이라면, 체력·리드 관리·추격 카드 성격이 강합니다.",
          p2h.shots + p2a.shots >= p1h.shots + p1a.shots + 4
            ? "교체 이후 슈팅이 늘었다면, 적어도 ‘경기는 열리게’ 만드는 데는 성공한 조정입니다. 반대로 열리기만 하고 실점하면 라인 높이 관리 실패입니다."
            : "교체 후에도 슈팅 총량이 크게 늘지 않았다면, 구조 변화보다 개인 매치업 교체에 가까웠을 수 있습니다.",
        ],
      });
    }

    const coaching = [];
    if (h.xg > a.xg && meta.score.home < meta.score.away) {
      coaching.push(
        `${home}: 최종 진영 점유를 박스 안 터치·컷백으로 번역하는 마지막 15m 패턴이 부족했습니다. 측면 돌파 후 중앙 침투 타이밍을 훈련 포인트로 가져가세요.`
      );
      coaching.push(
        `${away}: 낮은 평균 진영에도 결과를 낸 ‘효율형’ 승리입니다. 전환 1~2패스의 속도와 첫 슈팅 선택의 대담함이 강점이었습니다.`
      );
    } else if (meta.score.home > meta.score.away) {
      coaching.push(`${home}: 리드 이후 게임 스테이트 관리(파울 위치, 측면 지연, 세트피스 방어)를 다음 경기도 같은 기준으로 유지할 만합니다.`);
      coaching.push(`${away}: 추격 과정에서 라인을 올릴 때 등 뒤 공간 허용이 실점과 연결되지 않았는지 영상으로 재확인할 필요가 있습니다.`);
    } else {
      coaching.push("양 팀 모두 중원 2차 볼과 측면 전환의 정확도가 다음 매치 준비의 1순위입니다.");
    }
    if (shotH.outBox > shotH.box && shotH.n >= 6) {
      coaching.push(`${home} 박스 밖 슈팅 비중이 높습니다. 슈팅 금지 구역을 정하고, 한 템포 더 가진 뒤 박스 진입을 강제하는 원칙이 필요합니다.`);
    }
    if (zoneH.highPressShare >= 55 && h.presses >= 8) {
      coaching.push(`${home}의 높은 위치 압박 비중이 큽니다. 압박 실패 시 중원 커버 섀도우(커버링 미드필더) 위치를 고정해야 카운터에 안 뚫립니다.`);
    }

    chapters.push({
      kicker: "08 · COACHING POINTS",
      title: "전력분석관 메모",
      paragraphs: coaching,
    });

    chapters.push({
      kicker: "NOTE",
      title: "읽는 법",
      paragraphs: [
        "이 브리핑은 K리그 포털 CHALK BOARD(Bepro11) 이벤트 좌표·유형을 바탕으로 자동 생성됩니다. 포메이션 공식 표기·코칭 스태프의 실제 지시와는 다를 수 있으며, ‘관찰 가능한 행동’에 대한 해석입니다.",
        "아래 히트맵·슈팅맵·골 스토리에서 같은 주장을 좌표로 재확인하세요.",
      ],
    });

    return {
      chapters,
      metrics: { zoneH, zoneA, shotH, shotA, actH, actA, state },
    };
  }

  function buildFullReportText(meta, stats, goalList, pmap, events, players, pageUrl, lineup) {
    const h = stats[meta.home.team_id];
    const a = stats[meta.away.team_id];
    const lines = [];
    const url = pageUrl || "https://wanju1109.github.io/jeonbuk-lineup/c_report/";
    const briefing = buildTacticalBriefing(meta, events, players, lineup);

    lines.push("JEONBUK MATCH REPORT");
    lines.push(`${meta.competition} ${meta.round}라운드 · ${meta.home.name} vs ${meta.away.name}`);
    lines.push("CHALK BOARD 이벤트로 골 장면, 히트맵, xG를 한 번에 읽는 전북 팬 매치 리포트.");
    lines.push("");
    lines.push(`▶ 인터랙티브 리포트(히트맵/골 궤적 포함): ${url}`);
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("0. 전력분석 브리핑");
    lines.push("━━━━━━━━━━━━━━━━━━━━");
    for (const ch of briefing.chapters) {
      if (ch.kicker === "NOTE") continue;
      lines.push("");
      lines.push(`[${ch.kicker}] ${ch.title}`);
      for (const p of ch.paragraphs) lines.push(p);
    }
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
        meta.home.manager ? `${meta.home.name} 감독 ${meta.home.manager}` : "",
        meta.away.manager ? `${meta.away.name} 감독 ${meta.away.manager}` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    );
    lines.push("");
    lines.push(`[핵심] ${briefing.metrics.state.thesis}`);
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push("2. 숫자로 보는 승부");
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
        lines.push(`  ${i + 1}. ${nameOf(pmap, e.PLAYER_ID)} · ${label} · ${formatClock(e)}`);
      });
    });
    lines.push("");

    lines.push("━━━━━━━━━━━━━━━━━━━━");
    lines.push(`4. ${meta.home.name} 선수 터치/패스/슈팅`);
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
    lines.push(`5. ${meta.away.name} 선수 터치/패스/슈팅`);
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
    periodStats,
    flowAfterFirstGoal,
    attendanceCompare,
    lineupSides,
    sequenceBeforeGoal,
    playerEvents,
    rankPlayers,
    buildTacticalBriefing,
    buildFullReportText,
  };
})();

window.Analyze = Analyze;
