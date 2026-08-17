/* Match analysis helpers derived from CHALK BOARD event JSON. */

const Analyze = (() => {
  const DETAIL = {
    PSS: "패스 성공",
    PSU: "패스 실패",
    GL: "골",
    MST: "벗어난 슈팅",
    BT: "블락된 슈팅",
    /* AST only ever appears on TYPE_CD "ST" and always carries an xG value:
       it is a shot on target that was kept out, not an assist. */
    AST: "유효 슈팅",
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
    /* Goalkeeper codes. GC lines up one-for-one with the opponent's goals,
       while CT + PC account for every on-target shot that was not scored. */
    GC: "실점",
    CT: "선방 (캐치)",
    PC: "선방 (쳐내기)",
    ARS: "골키퍼 볼 처리",
    ARU: "골키퍼 볼 처리 실패",
    YLC: "경고",
    RDC: "퇴장",
    OFS: "오프사이드",
    MISS: "수비 미스",
    STB: "슈팅 차단",
    ADW: "공중볼 경합 성공",
    ADL: "공중볼 경합 실패",
    GDW: "지상 경합 성공",
    GDL: "지상 경합 실패",
    STCS: "세트피스 패스 성공",
    STCU: "세트피스 패스 실패",
    OPCS: "압박 성공",
    OPCU: "압박",
  };

  /*
   * A goal kick is logged as a bare TYPE_CD "GK" row with no detail code, and
   * the very same restart is logged again as the pass that follows it. It is
   * the only event type the portal leaves without a detail code, so treating
   * it as a duplicate keeps touch counts and the goalkeeper filter honest.
   */
  function isGoalKick(e) {
    return e.TYPE_CD === "GK" && !e.TYPE_DETAIL_CD;
  }

  function actionLabel(e) {
    if (!e) return "액션";
    const named = DETAIL[e.TYPE_DETAIL_CD];
    if (named) return named;
    if (isGoalKick(e)) return "골킥";
    return e.TYPE_CD || "액션";
  }

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
      conceded: 0,
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
      if (d === "CT" || d === "PC") row.saves += 1;
      if (d === "GC") row.conceded += 1;
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
      /* Goal kicks are excluded: they are restarts, not goalkeeping actions,
         and outfield players take plenty of them. */
      if (typeFilter === "GK") return e.TYPE_CD === "GK" && !isGoalKick(e);
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
      if (!isGoalKick(e)) row.touches += 1;
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

  function eulReul(name) {
    const s = String(name || "");
    const ch = s.charCodeAt(s.length - 1);
    if (ch >= 0xac00 && ch <= 0xd7a3) {
      return (ch - 0xac00) % 28 ? `${s}을` : `${s}를`;
    }
    return `${s}을(를)`;
  }

  function passRate(row) {
    return pct(row.passOk, row.passes);
  }

  function sideLabel(widthShare) {
    if (widthShare.left >= 38) return "왼쪽";
    if (widthShare.right >= 38) return "오른쪽";
    if (widthShare.center >= 45) return "가운데";
    return "여러 곳";
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

  function xgTalk(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v < 0) return "";
    const pct = Math.round(v * 100);
    return `같은 자리에서 100번 때리면 약 ${pct}골 (xG ${v.toFixed(2)})`;
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
      thesis =
        `${iGa(home)} 더 좋은 기회를 만들었고, 스코어도 ${hs}-${as}로 이겼습니다. ` +
        `쉽게 말하면 ‘잘 싸웠고, 잘 이긴’ 경기입니다. ` +
        `골이 될 확률을 다 더하면 ${h.xg} 대 ${a.xg}입니다. 이 숫자는 슈팅을 몇 번 했는지가 아니라, 얼마나 좋은 자리에서 때렸는지를 보여 줍니다. ` +
        `스코어와 내용이 같은 방향을 가리키면, 팬 입장에선 속이 덜 끓는 승리입니다.`;
    } else if (hs < as && xgGap > 0.15) {
      thesis =
        `${iGa(home)} 기회는 더 많이 만들었습니다. 골이 될 확률을 다 더하면 ${h.xg} 대 ${a.xg}인데, 스코어는 ${hs}-${as}로 졌습니다. ` +
        `쉽게 말하면 문을 더 많이 두드렸는데, 상대가 한 방을 더 잘 넣었습니다. ` +
        `슈팅 숫자가 많아도 골이 안 나면 답답합니다. 그날은 그 답답함이 스코어로 나온 날입니다. ` +
        `‘만들었는데 못 넣었다’보다 정확한 말은 ‘상대는 넣었고, 우리는 마지막이 아쉬웠다’입니다.`;
    } else if (hs < as && xgGap < -0.15) {
      thesis =
        `${iGa(away)} 더 좋은 기회를 만들었고, 스코어까지 가져갔습니다. ` +
        `${eunNeun(home)} 수비가 한두 장면 무너지면서 실점이 쌓인 그림입니다. ` +
        `이런 경기는 점유율을 오래 봐도 속이 안 풀립니다. 상대가 더 위험한 자리에서 때렸기 때문입니다.`;
    } else if (hs > as && xgGap < -0.1) {
      thesis =
        `${iGa(home)} 기회 질에서는 밀렸지만 ${hs}-${as}로 이겼습니다. ` +
        `쉽게 말하면 ‘많이 때린 팀’이 아니라 ‘한 방을 살린 팀’이 이긴 날입니다. ` +
        `역습, 코너킥, 페널티킥처럼 짧은 순간에 나온 골이 승부를 가릅니다. 이런 승리는 짜릿하지만, 같은 패턴이 다음 경기에 또 통한다는 보장은 없습니다.`;
    } else if (hs === as) {
      thesis =
        `스코어는 ${hs}-${as}로 비겼습니다. 골이 될 확률 합은 ${h.xg} 대 ${a.xg}입니다. ` +
        `비긴 경기일수록 이 두 숫자를 같이 봐야 합니다. 경기를 지배한 팀과 골을 넣은 팀이 다를 수 있거든요. ` +
        `한쪽이 앞에서 공을 오래 가졌는데 스코어가 같다면, 마지막 25m에서 길이 막혔다는 뜻입니다.`;
    } else {
      thesis =
        `최종 스코어는 ${hs}-${as}입니다. 슈팅 ${h.shots}-${a.shots}, 골이 될 확률 합 ${h.xg}-${a.xg}. ` +
        `숫자는 팽팽했습니다. 이런 날은 결정적인 한 장면, 골키퍼 한 번의 선방, 또는 세트피스 하나가 결과를 갈라 버립니다.`;
    }

    let structure = "";
    if (zoneH.avgX >= 52 && zoneA.avgX <= 45) {
      structure =
        `경기장 그림을 떠올려 보세요. ${iGa(home)} 상대를 자기 진영으로 밀어 붙이며 공을 지켰고, ${eunNeun(away)} 골문 앞에 내려앉아 버티다 역습을 노렸습니다. ` +
        `앞에서 공을 가진 팀이 항상 이기는 건 아닙니다. 다만 그날 누가 상대를 가뒀는지는 이 그림이 가장 잘 보여 줍니다.`;
    } else if (zoneA.avgX >= 52 && zoneH.avgX <= 45) {
      structure =
        `${iGa(away)} 필드를 밀어붙였고, ${eunNeun(home)} 자기 골문 앞에서 버티는 구도였습니다. ` +
        `쉽게 말하면 ${home}이 수비 블록을 낮게 깔고, 상대가 앞으로 나와 주길 기다린 날입니다. 버팀의 성패는 역습 한 방과 세트피스에서 갈립니다.`;
    } else if (Math.abs(terrGap) < 4) {
      structure =
        `양 팀이 비슷한 높이에서 맞붙었습니다(${home} ${zoneH.avgX}, ${away} ${zoneA.avgX}). ` +
        `한쪽이 상대를 가둔 경기가 아니라, 중원에서 공을 주워 가는 싸움이 핵심이었습니다. ` +
        `이런 날은 화려한 공격보다 ‘떨어진 공을 누가 먼저 잡느냐’가 더 중요합니다.`;
    } else {
      structure =
        `${home}은 평균적으로 ${zoneH.avgX} 지점, ${away}는 ${zoneA.avgX} 지점에서 공을 만졌습니다. ` +
        `하프라인 위쪽에서 누가 공을 잡느냐가 템포를 정했습니다. 앞에서 잡으면 공격이 한 박자 빨라지고, 뒤에서 잡으면 상대가 숨을 고릅니다.`;
    }

    if (h.presses > a.presses * 1.25) {
      structure +=
        ` 압박도 ${home} ${h.presses}회, ${away} ${a.presses}회로 ${iGa(home)} 더 많이 달려들었습니다. ` +
        `압박이 많다는 건 상대가 편안하게 패스를 돌리지 못하게 했다는 뜻입니다.`;
    } else if (a.presses > h.presses * 1.25) {
      structure +=
        ` 압박은 ${away} ${a.presses}회, ${home} ${h.presses}회로 ${away} 쪽이 더 많았습니다. ` +
        `${home}이 뒤에서 공을 돌리려다 자주 끊겼을 수 있습니다. 끊긴 자리가 높으면 바로 실점 위기가 됩니다.`;
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
      const passChain = seq.filter((e) => e.TYPE_CD === "PS");
      const names = [...new Set(passChain.map((e) => nameOf(pmap, e.PLAYER_ID)))];
      let pattern = "";
      if (pk) {
        pattern =
          `페널티킥으로 넣은 골입니다. 킥 자체보다 그 전에 박스 안에서 파울을 얻어 낸 장면이 이미 승부처였습니다. ` +
          `PK 한 번은 ${xgTalk(0.78)}입니다. 흐름에서 만드는 슈팅 열 번과 맞먹는 한 방입니다.`;
      } else if (xg >= 0.35) {
        pattern =
          `${xgTalk(xg)}. 거의 넣어야 하는 좋은 자리였고, 그 슈팅이 그대로 들어갔습니다. ` +
          `이런 골은 ‘운’보다 ‘그 자리까지 공을 가져간 과정’이 더 중요합니다. 박스 안까지 들어간 팀이 보상을 받은 장면입니다.`;
      } else if (xg <= 0.1) {
        pattern =
          `${xgTalk(xg)}. 어려운 슈팅이 들어갔습니다. ` +
          `수비가 크게 무너졌다기보다, 한 순간의 기량이나 운이 겹친 골에 가깝습니다. 이런 골은 경기 분위기 한 방을 바꿔 버리지만, 같은 자리에서 다음에도 들어간다고 믿기는 어렵습니다.`;
      } else {
        pattern =
          `${xgTalk(xg)}. 괜찮은 기회였습니다. ` +
          `패스가 슈팅 자리까지 끊기지 않고 이어졌다는 점이 핵심입니다. 마지막 25m에서 길이 열리면 이런 골이 나옵니다.`;
      }
      const chainText = names.length
        ? `골 직전 공이 지나간 선수입니다: ${names.slice(0, 5).join(" → ")}. 이 순서를 따라가면 그날 공격이 어떤 길로 들어왔는지가 보입니다.`
        : "짧은 역습이거나, 혼자 치고 들어가 바로 슈팅한 장면입니다. 패스가 길지 않았다는 건, 상대가 자리를 잡기 전에 승부가 났다는 뜻입니다.";
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
      kicker: "01 · 한줄 요약",
      title: "오늘 경기는 이렇게 읽으면 됩니다",
      paragraphs: [
        state.thesis,
        state.structure,
        "아래부터는 그 한 줄을 장면으로 풀어 갑니다. 공을 어디에 뒀는지, 슈팅이 얼마나 좋은 자리였는지, 누가 경기를 이끌었는지를 쉬운 말로 따라가 보세요.",
      ],
    });

    chapters.push({
      kicker: "02 · 공을 어디에 뒀나",
      title: "어느 높이에서, 어느 쪽으로 경기를 했나",
      paragraphs: [
        `${home}은 공을 수비 쪽 ${zoneH.thirds.def}%, 중원 ${zoneH.thirds.mid}%, 상대 골문 쪽 ${zoneH.thirds.atk}%에서 만졌습니다. 축구장은 우리 골문 앞, 가운데, 상대 골문 앞 세 덩어리로 보면 이해가 쉽습니다. 상대 골문 쪽 비율이 높을수록 앞에서 경기를 한 팀입니다.`,
        `${away}는 수비 쪽 ${zoneA.thirds.def}%, 중원 ${zoneA.thirds.mid}%, 상대 골문 쪽 ${zoneA.thirds.atk}%입니다.`,
        `${home}의 앞으로 간 패스(약 12m 이상)는 ${zoneH.progressivePasses}회, 전체 패스의 ${zoneH.progressiveRate}%입니다. ${away}는 ${zoneA.progressivePasses}회(${zoneA.progressiveRate}%)입니다. 옆으로만 돌리는 패스는 성공해도 골문과 거리가 안 줄어듭니다. 앞으로 간 패스가 많아야 공격이 살아납니다.`,
        `패스가 동료에게 간 비율은 ${home} ${passRate(h)}%(${h.passOk}/${h.passes}), ${away} ${passRate(a)}%(${a.passOk}/${a.passes})입니다. 성공률이 높아도 앞으로 안 가면, 식당에서 메뉴만 고르고 밥을 안 시킨 것과 비슷합니다.`,
        zoneH.avgX > zoneA.avgX + 5
          ? `${iGa(home)} 더 앞에서 경기를 하며 상대를 눌렀습니다. 다만 앞에서 공을 가졌다고 박스까지 들어간 것은 아닙니다. 페널티박스 안 터치는 ${home} ${zoneH.boxTouches}회, ${away} ${zoneA.boxTouches}회입니다. 앞에서 만지다 바깥에서 맴돌면, 점유율은 높은데 골 냄새는 안 나는 날이 됩니다.`
          : zoneA.avgX > zoneH.avgX + 5
            ? `${iGa(away)} 더 높은 위치에서 경기를 했습니다. ${eunNeun(home)} 골문 앞에 내려앉아 버티다 역습 타이밍을 노렸을 수 있습니다. 이런 경기는 답답해 보여도, 한 방만 살리면 스코어가 뒤집힙니다.`
            : `양 팀이 비슷한 높이에서 맞붙았습니다. 이런 날은 첫 압박 뒤 떨어진 공, 그리고 왼쪽에서 오른쪽으로 넘기는 패스가 승부를 가릅니다. 화려한 패턴보다 ‘누가 더 빨리 주워 가나’의 싸움입니다.`,
        `${home}의 좌우 사용은 왼쪽 ${zoneH.width.left}%, 가운데 ${zoneH.width.center}%, 오른쪽 ${zoneH.width.right}%입니다. 주로 ${eulReul(sideLabel(zoneH.width))} 썼습니다.`,
        `${away}는 왼쪽 ${zoneA.width.left}%, 가운데 ${zoneA.width.center}%, 오른쪽 ${zoneA.width.right}%입니다. 주로 ${eulReul(sideLabel(zoneA.width))} 썼습니다. 한쪽만 고집하면 상대가 그 길을 미리 막을 수 있고, 너무 고르면 결정적인 우위가 안 나옵니다.`,
      ],
    });

    chapters.push({
      kicker: "03 · 기회는 어디서",
      title: "슈팅은 어디서, 얼마나 좋은 자리였나",
      paragraphs: [
        `슈팅 숫자만 보면 속습니다. 박스 밖에서 발만 휘두른 슈팅과, 골키퍼와 마주한 슈팅은 전혀 다른 기회입니다.`,
        `${home} 슈팅은 ${shotH.n}개입니다. 박스 안 ${shotH.box}개, 박스 밖 ${shotH.outBox}개. 슈팅 하나당 평균은 ${xgTalk(shotH.avgXg)}입니다.`,
        `주로 ${shotH.channel}에서 때렸습니다. 좋은 자리는 ${xgTalk(0.25)} 이상으로 ${shotH.big}개, 어려운 자리는 ${xgTalk(0.08)} 미만으로 ${shotH.low}개입니다.`,
        `${away} 슈팅은 ${shotA.n}개입니다. 박스 안 ${shotA.box}개, 박스 밖 ${shotA.outBox}개. 슈팅 하나당 평균은 ${xgTalk(shotA.avgXg)}입니다.`,
        `주로 ${shotA.channel}에서 때렸습니다. 좋은 자리 ${shotA.big}개, 어려운 자리 ${shotA.low}개입니다.`,
        shotH.avgXg + 0.03 < shotA.avgXg && h.xg >= a.xg
          ? `${eunNeun(home)} 슈팅 숫자는 충분했지만, 자리의 질이 떨어졌습니다. 양만 많고 질이 약한 패턴입니다. 쉽게 말하면 문을 여러 번 두드렸는데, 열쇠 구멍은 잘 못 찾은 날입니다.`
          : shotA.big > shotH.big
            ? `${iGa(away)} 더 좋은 자리에서 더 많이 때렸습니다. 수비 간격이 벌어진 순간, 또는 역습 한두 패스에 박스까지 들어간 장면이 승부처였습니다. 위험한 자리는 한두 번이면 충분합니다.`
            : `양 팀의 기회 질은 비슷해 보입니다. 이런 경기는 골키퍼 선방, 골대, 마무리 한 방이 스코어를 크게 벌립니다. 팬이 손에 땀을 쥐는 이유가 바로 여기입니다.`,
        `상대 골문 근처에서 공을 만진 횟수는 ${home} ${zoneH.finalThirdTouches}회, ${away} ${zoneA.finalThirdTouches}회입니다. 앞에서 많이 만졌는데 슈팅 확률이 낮으면, 들어가긴 했는데 마지막 길이 막힌 날입니다. 택시를 타고 목적지 앞에서 내린 것과 비슷합니다.`,
      ],
    });

    const p1h = periods[1][homeId];
    const p1a = periods[1][awayId];
    const p2h = periods[2][homeId];
    const p2a = periods[2][awayId];
    chapters.push({
      kicker: "04 · 전반과 후반",
      title: "전반·후반, 그리고 선제골 이후",
      paragraphs: [
        `전반의 골이 될 확률 합은 ${p1h.xg} 대 ${p1a.xg}, 슈팅은 ${p1h.shots} 대 ${p1a.shots}입니다. 전반은 몸이 덜 풀리고, 서로 탐색하는 시간입니다.`,
        `후반은 확률 합 ${p2h.xg} 대 ${p2a.xg}, 슈팅 ${p2h.shots} 대 ${p2a.shots}입니다. 후반에는 체력이 떨어지고 교체가 나오면서, 공간이 갑자기 열리기도 합니다.`,
        p2h.xg + p2a.xg > p1h.xg + p1a.xg + 0.3
          ? "후반에 경기가 더 열렸습니다. 쉽게 말하면 전반엔 문을 잠가 두다가, 후반에 열쇠를 놓고 나온 그림입니다. 체력·교체·스코어 추격이 라인을 올리며 공간이 생긴 전형적인 후반형 경기입니다."
          : p1h.xg + p1a.xg > p2h.xg + p2a.xg + 0.3
            ? "전반에 기회가 몰리고 후반은 잠겼습니다. 이긴 팀이 템포를 늦추거나, 추격하는 팀이 조급해져 패턴이 단순해졌을 수 있습니다. 후반이 조용하면 리드 팀이 경기를 잘 관리한 겁니다."
            : "전·후반의 기회 양은 비슷합니다. 90분 평균보다, 특정 15분에 누가 더 집중했느냐가 더 중요했던 날입니다.",
        flow.hasFirstGoal
          ? `선제골은 ${flow.clock}, ${flow.scorerSide === "home" ? home : away}입니다. 첫 골은 스코어만 바꾸는 게 아니라, 두 팀의 마음도 바꿉니다. 이후 골이 될 확률 합은 ${flow.after[homeId].xg} 대 ${flow.after[awayId].xg}, 슈팅은 ${flow.after[homeId].shots} 대 ${flow.after[awayId].shots}입니다. ${
              flow.scorerSide === "away" && flow.after[homeId].xg > flow.after[awayId].xg
                ? `${iGa(home)} 실점 이후 공을 가져오며 추격했지만, 이미 스코어에 상처가 난 상태였습니다. 쫓아가는 팀은 바빠 보이고, 지키는 팀은 한 방만 막으면 됩니다.`
                : flow.scorerSide === "home" && flow.after[awayId].xg > flow.after[homeId].xg
                  ? `리드한 뒤 ${away}의 반격 기회가 더 좋았습니다. 라인을 너무 올리거나, 파울 위치·측면으로 시간을 끄는 플레이에서 틈이 있었습니다. 이기고 있는데 더 위험한 건, 팬 속이 제일 타들어 가는 구간입니다.`
                  : "선제골을 넣은 팀이 이후 흐름도 대체로 가져가며 경기를 굳혔습니다. 넣고 나서도 상대를 가둘 수 있으면, 그 승리는 탄탄합니다."
            }`
          : "골이 없는 흐름이라면, 코너킥이나 역습 한 방이 갑자기 승부를 가를 수 있는 날이었습니다. 이런 경기는 0-0처럼 보여도 언제든 한 장면으로 끝납니다.",
      ],
    });

    const touchH = actH.touchLeader;
    const threatH = actH.threat;
    const passH = actH.passer;
    const defH = actH.defender;
    const touchA = actA.touchLeader;
    const threatA = actA.threat;
    chapters.push({
      kicker: "05 · 누가 이끌었나",
      title: "공을 만진 사람, 기회를 만든 사람",
      paragraphs: [
        touchH
          ? `${home}에서 공을 가장 많이 만진 선수는 ${touchH.name}입니다. 기록 ${touchH.touches}회, 패스 ${touchH.passOk}/${touchH.passes}. 중원과 측면을 이어 주는 축이었습니다. 이 선수가 공을 받으면 경기가 한 박자 느려지거나 빨라집니다.`
          : `${home}에서 공을 가장 많이 만진 선수를 특정하기 어렵습니다.`,
        passH && passH.player_id !== touchH?.player_id
          ? `패스가 가장 잘 통한 선수는 ${passH.name}입니다(${passH.passOk}성공/${passH.passes}시도). 템포를 늦추거나 옆으로 열어 주는 안전장치 역할이 컸습니다. 위기일 때 공을 이 선수에게 주면, 팀이 한숨 돌립니다.`
          : null,
        threatH && (threatH.shots > 0 || threatH.xg > 0)
          ? `가장 위협적인 선수는 ${threatH.name}입니다. 슈팅 ${threatH.shots}회, 골이 될 확률 합 ${threatH.xg.toFixed(2)}, 골 ${threatH.goals}. ${
              threatH.xg >= 0.4 && threatH.goals === 0
                ? "기회를 받았지만 마무리가 아쉬운 날이었습니다. 좋은 자리에 서서도 골망이 안 흔들리면, 팬은 그 장면을 며칠씩 곱씹게 됩니다."
                : threatH.goals > 0
                  ? "결정적인 장면에서 존재감을 남겼습니다. 팀이 문을 두드릴 때, 마지막에 문을 연 사람입니다."
                  : "박스에 들어가고 슈팅 타이밍을 계속 만들어 낸 공격 자원입니다. 골이 없어도, 상대 수비는 이 선수를 놓치면 안 됩니다."
            }`
          : null,
        defH && defH.def > 0
          ? `수비에서 가장 바빴던 선수는 ${defH.name}입니다. 태클·차단·클리어·압박을 합쳐 ${defH.def}회입니다. 상대의 주 공격 길을 막아 선 1차 방패였습니다. 공격 하이라이트에는 잘 안 나오지만, 이 선수가 없으면 경기가 금방 뚫립니다.`
          : null,
        touchA
          ? `${away}에서는 ${iGa(touchA.name)} 공을 가장 많이 만졌습니다(기록 ${touchA.touches}회). 위협은 ${
              threatA ? `${threatA.name}(확률 합 ${threatA.xg.toFixed(2)})` : "여러 선수에게 흩어져"
            } 쪽입니다.`
          : null,
        "히트맵에서 한 선수의 터치가 한쪽으로 몰리면, 그 길이 팀이 정해 둔 출구입니다. 반대로 넓게 흩어지면 공은 가졌지만 패턴이 없었다는 신호일 수 있습니다. 아래 히트맵에서 그 그림을 직접 확인해 보세요.",
      ].filter(Boolean),
    });

    const goalChapters = buildGoalNarratives(goalList, events, meta, pmap);
    if (goalChapters.length) {
      chapters.push({
        kicker: "06 · 골 장면",
        title: "골은 어떻게 나왔나",
        paragraphs: goalChapters.map((g) => `${g.title}. ${g.text}`),
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
        kicker: "07 · 교체",
        title: "교체와 후반 조정",
        paragraphs: [
          `기록된 교체는 ${subs.length}회입니다. ${home} ${homeSubs.length}회, ${away} ${awaySubs.length}회. ${
            earlyLabel ? `가장 이른 교체는 ${earlyLabel} 전후입니다.` : ""
          } 교체는 체력 보충만이 아닙니다. 감독이 “이 그림으론 안 된다”고 판단한 순간이기도 합니다.`,
          Number.isFinite(earlyMin) && earlyMin <= 60
            ? "이른 교체는 측면 1대1이나 중원 싸움에서 밀렸다고 보고, 시스템을 바꾼 신호일 때가 많습니다. 60분 전에 카드를 쓰면, 그만큼 경기가 계획대로 안 돌아가고 있다는 뜻입니다."
            : "후반 중후반 교체가 중심이라면, 체력 관리·리드 지키기·추격 카드 성격이 강합니다. 흔한 그림이지만, 한 명이 들어가며 템포가 확 바뀌기도 합니다.",
          p2h.shots + p2a.shots >= p1h.shots + p1a.shots + 4
            ? "교체 이후 슈팅이 늘었다면, 적어도 경기를 열리게 만드는 데는 성공한 조정입니다. 열리기만 하고 실점하면 라인 높이 관리가 실패한 것입니다. 문을 열었는데 상대가 먼저 들어간 날이죠."
            : "교체 후에도 슈팅이 크게 늘지 않았다면, 팀 구조보다 선수 한 명을 바꾼 교체에 가까웠을 수 있습니다. 얼굴은 바뀌었는데 길은 그대로인 그림입니다.",
        ],
      });
    }

    const coaching = [];
    if (h.xg > a.xg && meta.score.home < meta.score.away) {
      coaching.push(
        `${home}: 앞에서 공을 가졌지만, 박스 안으로 땅볼을 넣거나 컷백으로 연결하는 마지막 패턴이 부족했습니다. 측면을 돌파한 뒤 가운데로 들어오는 타이밍을 훈련 포인트로 가져가면 좋습니다. 쉽게 말하면 ‘문 앞까지는 갔는데, 초인종을 안 누른’ 날입니다.`
      );
      coaching.push(
        `${away}: 뒤에서 버티고도 결과를 낸 효율형 승리입니다. 역습 한두 패스의 속도와, 첫 슈팅을 과감하게 때린 선택이 강점이었습니다. 적게 때리고 많이 넣는 팀은, 팬을 애타게 만들면서도 결국 웃게 합니다.`
      );
    } else if (meta.score.home > meta.score.away) {
      coaching.push(`${home}: 리드한 뒤 파울 위치, 측면으로 시간을 끄는 플레이, 세트피스 수비를 다음 경기도 같은 기준으로 유지할 만합니다.`);
      coaching.push(`${away}: 추격하려고 라인을 올렸을 때, 등 뒤 공간이 실점과 연결되지 않았는지 영상으로 다시 보면 좋습니다.`);
    } else {
      coaching.push("양 팀 모두 중원에서 떨어진 공, 그리고 왼쪽에서 오른쪽으로 넘기는 패스의 정확도가 다음 경기 준비의 1순위입니다.");
    }
    if (shotH.outBox > shotH.box && shotH.n >= 6) {
      coaching.push(`${home} 박스 밖 슈팅이 더 많습니다. 그 자리에서는 일단 참고, 한 템포 더 가진 뒤 박스 안으로 들어가는 원칙이 필요합니다.`);
    }
    if (zoneH.highPressShare >= 55 && h.presses >= 8) {
      coaching.push(`${home}의 앞선 압박 비중이 큽니다. 압박이 깨지는 순간, 중원을 커버하는 미드필더 자리를 고정해야 역습에 안 뚫립니다.`);
    }

    chapters.push({
      kicker: "08 · 다음에 고칠 점",
      title: "다음 경기를 위한 메모",
      paragraphs: coaching,
    });

    chapters.push({
      kicker: "NOTE",
      title: "이 글을 읽는 법",
      paragraphs: [
        "이 브리핑은 K리그 포털에 찍힌 패스·슈팅·태클 위치를 바탕으로 자동으로 만든 글입니다. 감독이 실제로 지시한 내용과 다를 수 있고, 그날 눈에 보이는 행동에 대한 해석입니다.",
        "어려운 용어는 오른쪽 용어 가이드에 풀어 두었습니다. 아래 히트맵, 슈팅 맵, 골 스토리에서 같은 이야기를 그림으로 다시 확인해 보세요. 글과 그림이 만나면, 경기가 훨씬 선명해집니다.",
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
    lines.push("스코어만 보면 아쉽고, 숫자만 보면 어렵습니다. 골이 어떻게 나왔는지, 누가 어디서 뛰었는지를 이야기로 풀어 드립니다.");
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
    lines.push(`xG(골이 될 확률 합)  ${h.xg} : ${a.xg}`);
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
        const label = actionLabel(e);
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
    lines.push("xG: 같은 자리에서 100번 때리면 약 몇 골인가. 예: 같은 자리에서 100번 때리면 약 10골 (xG 0.10).");
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
    actionLabel,
    isGoalKick,
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
