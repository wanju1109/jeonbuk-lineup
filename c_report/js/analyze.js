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

  function goals(events, meta) {
    const list = Array.isArray(events) ? events : [];
    const hs = Number(meta?.score?.home);
    const as = Number(meta?.score?.away);
    if (Number.isFinite(hs) && Number.isFinite(as) && hs === 0 && as === 0) {
      return [];
    }
    const allowed = new Set(
      [meta?.home?.team_id, meta?.away?.team_id].filter(Boolean)
    );
    return list
      .filter((e) => e && e.TYPE_DETAIL_CD === "GL")
      .filter((e) => !allowed.size || allowed.has(e.TEAM_ID))
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

  function flowAfterFirstGoal(events, homeId, awayId, meta) {
    const goalList = goals(
      events,
      meta || { home: { team_id: homeId }, away: { team_id: awayId } }
    );
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

  /*
   * Compare this match's crowd to the HOME club's season home average.
   * Never mix Jeonbuk home+away crowds: that produced a fake "시즌 평균(수집분)"
   * (e.g. 14,186) that is not any club's official home figure.
   */
  function clubNameKey(name) {
    return String(name || "")
      .replace(/현대모터스/g, "")
      .replace(/현대/g, "")
      .replace(/상무/g, "")
      .replace(/FC/gi, "")
      .replace(/HD/gi, "")
      .replace(/[()]/g, "")
      .replace(/\s+/g, "")
      .trim();
  }

  function officialHomeAvg(clubAttendance, homeName) {
    const key = clubNameKey(homeName);
    const clubs = clubAttendance && Array.isArray(clubAttendance.clubs) ? clubAttendance.clubs : [];
    if (!key || !clubs.length) return null;
    const hit = clubs.find((c) => clubNameKey(c.name) === key);
    const avg = hit != null ? Number(hit.avg) : NaN;
    if (!hit || !Number.isFinite(avg) || avg <= 0) return null;
    const games = Number(hit.games);
    return {
      avg,
      games: Number.isFinite(games) && games > 0 ? games : 0,
      asOf: clubAttendance.as_of || "",
    };
  }

  function collectedHomeAvg(index, homeName) {
    const key = clubNameKey(homeName);
    if (!key) return null;
    const nums = (index?.matches || [])
      .filter((m) => clubNameKey(m.home) === key)
      .map((m) => Number(m.attendance))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (!nums.length) return null;
    const sum = nums.reduce((s, n) => s + n, 0);
    return { avg: sum / nums.length, games: nums.length };
  }

  function attendanceCompare(meta, index, clubAttendance) {
    const att = Number(meta?.attendance);
    if (!Number.isFinite(att) || att <= 0) {
      return { available: false };
    }
    const homeName = String(meta.home?.name || "").trim();
    if (!homeName) {
      return { available: false };
    }

    const official = officialHomeAvg(clubAttendance, homeName);
    const collected = collectedHomeAvg(index, homeName);
    const picked = official || collected;
    if (!picked) {
      return { available: false };
    }

    const baseline = picked.avg;
    const source = official ? "official" : "collected";
    const baselineLabel =
      source === "official" ? `${homeName} 시즌 홈 평균` : `${homeName} 홈 평균(수집분)`;
    const diff = att - baseline;
    const pct = baseline ? (diff / baseline) * 100 : 0;
    const isHome = clubNameKey(homeName) === clubNameKey("전북");
    return {
      available: true,
      attendance: att,
      avgAll: collected ? Math.round(collected.avg) : null,
      avgHome: Math.round(baseline),
      baseline: Math.round(baseline),
      baselineLabel,
      diff: Math.round(diff),
      pct: Math.round(pct * 10) / 10,
      sampleSize: picked.games,
      homeSampleSize: picked.games,
      isHome,
      source,
      asOf: official ? official.asOf : "",
    };
  }

  function lineupSides(lineup) {
    return {
      home: lineup?.home || [],
      away: lineup?.away || [],
      subs: lineup?.subs || [],
    };
  }

  function pickBySeed(seed, items) {
    const arr = (items || []).filter(Boolean);
    if (!arr.length) return "";
    const s = String(seed ?? "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return arr[(h >>> 0) % arr.length];
  }

  function subAbsMinute(s) {
    if (!s) return null;
    const period = Number(s.period || 0);
    const m = Number(s.minute ?? s.min);
    if (!Number.isFinite(m)) return null;
    if (period >= 2) return 45 + m;
    return m;
  }

  function subSwapLabel(s) {
    if (!s) return "";
    const team = s.team_name || "";
    const fmt = (p) => {
      if (!p || !p.name) return "";
      return p.back_no != null && p.back_no !== "" ? `#${p.back_no} ${p.name}` : p.name;
    };
    const outN = fmt(s.player_out);
    const inN = fmt(s.player_in);
    if (outN && inN) return `${team} ${outN} → ${inN}`.trim();
    if (inN) return `${team} ${inN} 투입`.trim();
    return "";
  }

  function isHalfTimeSub(s) {
    const period = Number(s?.period || 0);
    const m = Number(s?.minute ?? s?.min);
    const label = String(s?.time_label || "");
    if (period === 2 && Number.isFinite(m) && m <= 1) return true;
    return /후반\s*0\s*'/.test(label);
  }

  function shotSplitAt(events, absMin, homeId, awayId) {
    const blank = () => ({ shots: 0, xg: 0 });
    const before = { [homeId]: blank(), [awayId]: blank() };
    const after = { [homeId]: blank(), [awayId]: blank() };
    if (!Number.isFinite(absMin)) return { before, after };
    const t = absMin * 60;
    for (const e of events || []) {
      if (e.TYPE_CD !== "ST") continue;
      const row = (absSeconds(e) < t ? before : after)[e.TEAM_ID];
      if (!row) continue;
      row.shots += 1;
      row.xg += Number(e.EXPECTED_GOAL || 0);
    }
    return { before, after };
  }

  function buildSubParagraphs(meta, events, lineup, p1h, p1a, p2h, p2a) {
    const subs = lineup?.subs || [];
    if (!subs.length) return null;
    const home = meta.home.name;
    const away = meta.away.name;
    const homeId = meta.home.team_id;
    const awayId = meta.away.team_id;
    const hs = Number(meta.score?.home);
    const as = Number(meta.score?.away);
    const seed = `${meta.game_id || ""}:${meta.round || ""}:${subs.length}`;
    const homeSubs = subs.filter((s) => s.team_id === homeId || s.ha === "H");
    const awaySubs = subs.filter((s) => s.team_id === awayId || s.ha === "A");
    const ordered = [...subs].sort((a, b) => {
      const pa = subAbsMinute(a);
      const pb = subAbsMinute(b);
      if (pa == null && pb == null) return 0;
      if (pa == null) return 1;
      if (pb == null) return -1;
      return pa - pb;
    });
    const first = ordered[0];
    const last = ordered[ordered.length - 1];
    const firstMin = subAbsMinute(first);
    const lastMin = subAbsMinute(last);
    const htCount = subs.filter(isHalfTimeSub).length;
    const lateCount = subs.filter((s) => {
      const m = subAbsMinute(s);
      return m != null && m >= 75;
    }).length;
    const firstSwap = subSwapLabel(first);
    const lastSwap = last && last !== first ? subSwapLabel(last) : "";
    const firstLabel = first?.time_label || (Number.isFinite(firstMin) ? `${firstMin}분` : "");

    const countLine = `기록된 교체는 ${subs.length}회입니다. ${home} ${homeSubs.length}회, ${away} ${awaySubs.length}회.`;

    let open;
    if (hs === 0 && as === 0) {
      open = pickBySeed(seed + ":open0", [
        `${countLine} ${firstLabel ? `첫 카드는 ${firstLabel}${firstSwap ? ` · ${firstSwap}` : ""}입니다.` : ""} 0-0이 이어진 날의 교체는 점수판을 뒤집는 한 방이 아니라, 막힌 길을 다른 길로 바꿔 보려는 손입니다.`,
        `${countLine} ${firstSwap ? `시작은 ${firstSwap}.` : ""} 무득점 경기에선 교체 한 명이 골을 보장하지 않습니다. 다만 누가 공을 받을지, 어느 높이에서 싸울지는 분명히 바뀝니다.`,
        `${countLine} 스코어가 끝까지 0-0이면 교체는 ‘체력 교체’로 보이기 쉽습니다. ${firstLabel ? `${firstLabel}에 나온 첫 카드는` : "첫 카드는"} 그 교착을 흔들려는 시도로 읽는 편이 맞습니다.`,
      ]);
    } else if (hs !== as) {
      const leader = hs > as ? home : away;
      const trailer = hs > as ? away : home;
      open = pickBySeed(seed + ":openW", [
        `${countLine} ${firstLabel ? `가장 이른 교체는 ${firstLabel}입니다.` : ""} ${eunNeun(leader)} 리드를 지키려 했고, ${eunNeun(trailer)} 흐름을 바꾸려 했습니다. 같은 교체라도 하는 쪽의 숙제는 정반대입니다.`,
        `${countLine} ${firstSwap ? `첫 장면은 ${firstSwap}.` : ""} ${iGa(leader)} 앞서 있는 그림에서 카드를 썼고, ${eunNeun(trailer)} 추격 카드를 꺼내야 하는 입장이었습니다.`,
        `${countLine} 리드 팀의 교체는 템포를 죽이는 쪽에, 추격 팀의 교체는 문을 여는 쪽에 가깝습니다. ${firstLabel ? `${firstLabel} 전후가 그 갈림입니다.` : ""}`,
      ]);
    } else {
      open = pickBySeed(seed + ":openD", [
        `${countLine} ${firstLabel ? `첫 교체는 ${firstLabel}${firstSwap ? ` · ${firstSwap}` : ""}입니다.` : ""} 동점 상황에서 나온 카드는 수비 한 장을 더 쌓기보다, 다음 골의 방향을 바꾸려는 성격이 강합니다.`,
        `${countLine} 스코어가 묶인 채 교체가 이어졌습니다. ${firstSwap ? `시작은 ${firstSwap}.` : "먼저 움직인 쪽이 경기의 다음 그림을 제안한 셈입니다."}`,
      ]);
    }

    let timing;
    if (htCount >= 1) {
      timing = pickBySeed(seed + ":ht", [
        `하프타임 전후 교체가 ${htCount}회입니다. 전반을 보고 조합을 고친 계획 수정에 가깝습니다. 체력이 떨어져서가 아니라, 그림 자체를 갈아 끼운 겁니다.`,
        `후반 시작과 함께 카드가 나왔습니다. 쉬는 시간에 전술을 고친 신호입니다. 60분 전에 급하게 불을 끈 교체와는 결이 다릅니다.`,
      ]);
    } else if (Number.isFinite(firstMin) && firstMin <= 60 && !isHalfTimeSub(first)) {
      timing = pickBySeed(seed + ":early", [
        `${firstLabel || "이른 시간"}에 이미 카드를 썼습니다. 측면 1대1이나 중원 싸움에서 밀렸다고 보고 시스템을 바꾼 신호일 때가 많습니다.`,
        `이른 교체는 체력 안배가 아닙니다. 전반에 계획이 통하지 않았다고 본 쪽의 항복 선언에 가깝습니다.`,
      ]);
    } else if (lateCount >= 3 || (Number.isFinite(lastMin) && lastMin >= 80)) {
      timing = pickBySeed(seed + ":late", [
        `후반 막판 교체가 ${lateCount || subs.length}회입니다. ${lastSwap ? `마지막은 ${lastSwap}.` : ""} 리드를 지키거나, 세트피스 한 방을 노리거나, 추가시간 다리를 바꾸는 카드입니다.`,
        `교체의 무게가 후반 끝에 실렸습니다. 흔한 그림이지만, 한 명이 들어가며 템포가 확 바뀌기도 합니다. ${lastLabelLine(last, lastSwap)}`,
      ]);
    } else {
      timing = pickBySeed(seed + ":mid", [
        `후반 중반 전후가 교체 중심입니다. 체력 관리와 역할 교체가 겹친 구간입니다. ${firstSwap ? `시작은 ${firstSwap}.` : ""}`,
        `한 번에 그림을 갈아엎기보다, 구간마다 한 장씩 바꾼 날에 가깝습니다. ${lastSwap ? `마지막 카드는 ${lastSwap}.` : ""}`,
      ]);
    }

    const split = shotSplitAt(events, firstMin, homeId, awayId);
    const bShots = (split.before[homeId]?.shots || 0) + (split.before[awayId]?.shots || 0);
    const aShots = (split.after[homeId]?.shots || 0) + (split.after[awayId]?.shots || 0);
    const h2open =
      (p2h?.shots || 0) + (p2a?.shots || 0) >= (p1h?.shots || 0) + (p1a?.shots || 0) + 4;
    let effect;
    if (hs === 0 && as === 0) {
      effect = pickBySeed(seed + ":fx0", [
        `교체 이후에도 골망은 안 흔들렸습니다. 문을 열려고 사람을 바꿨지만, 마지막 25m에서 길이 끝까지 안 나온 날입니다.`,
        `카드를 꺼내도 0-0이면, 문제는 얼굴이 아니라 길이었을 수 있습니다. 선수만 바뀌고 박스 진입 패턴은 그대로인 그림입니다.`,
        aShots > bShots + 2
          ? `첫 교체 이후 슈팅은 늘었습니다. 경기는 열렸는데 마무리가 안 된, 답답한 0-0입니다.`
          : `교체 전후 슈팅 양이 크게 안 늘었습니다. 흐름을 흔들려 했지만, 상대 블록이 그대로 버틴 쪽에 가깝습니다.`,
      ]);
    } else if (h2open || aShots >= bShots + 4) {
      effect = pickBySeed(seed + ":fxOpen", [
        `교체 이후 슈팅이 늘었습니다. 적어도 경기를 열리게 만드는 데는 성공한 조정입니다. 열리기만 하고 실점하면 라인 높이 관리가 실패한 것입니다.`,
        `사람이 바뀐 뒤 슈팅이 늘었다면 과제는 통한 겁니다. 남은 질문은 그 슈팅이 좋은 자리였느냐입니다.`,
      ]);
    } else {
      effect = pickBySeed(seed + ":fxFlat", [
        `교체 후에도 슈팅이 크게 늘지 않았습니다. 팀 구조보다 선수 한 명을 바꾼 교체에 가까웠을 수 있습니다.`,
        `얼굴은 바뀌었는데 길은 그대로인 그림입니다. 다음 경기에선 교체 한 장의 과제를 더 분명하게 가져가야 합니다.`,
      ]);
    }

    return [open, timing, effect].map((t) => String(t || "").replace(/\s+/g, " ").trim()).filter(Boolean);
  }

  function lastLabelLine(last, lastSwap) {
    if (lastSwap) return `마지막은 ${lastSwap}.`;
    if (last?.time_label) return `마지막 카드는 ${last.time_label}.`;
    return "";
  }

  function playerHead(p) {
    const no = p.backNo != null && p.backNo !== "" ? `#${p.backNo} ` : "";
    const cap = p.captain ? " (C)" : "";
    const pos = p.position || "";
    const kind = p.starter === false ? "후보 투입" : "선발";
    return `${no}${p.name || "선수"}${cap} · ${kind}${pos ? ` ${pos}` : ""}`;
  }

  function dutyParagraph(p) {
    const d = p.duty || (typeof Tactics !== "undefined" && Tactics.dutyNote ? Tactics.dutyNote(p) : null);
    if (!d) return playerHead(p);
    const play = d.play ? ` 기록: ${d.play}.` : "";
    return `${playerHead(p)}. 부여: 시트 ${d.assigned}. 실제: ${d.actual}.${play} ${d.verdict}`;
  }

  function buildDutyChapter(meta, events, players, lineup) {
    if (typeof Tactics === "undefined" || typeof Tactics.playerDuties !== "function") {
      return null;
    }
    let pack;
    try {
      pack = Tactics.playerDuties(meta, events, players, lineup);
    } catch (err) {
      console.error(err);
      return null;
    }
    const home = pack.home;
    const away = pack.away;
    if (!home?.starters?.length && !away?.starters?.length) return null;

    const paras = [];
    paras.push(
      "감독이 락커룸에서 한 말은 포털에 없습니다. 대신 경기 시트 포지션을 ‘부여한 역할’로, 평균 위치와 패스·슈팅·수비 기록을 ‘실제로 뛴 역할’로 읽습니다. 둘이 같으면 지시한 구간에서 그 일을 한 것이고, 다르면 감독이 그렇게 썼거나 선수가 자리를 이탈한 겁니다."
    );

    const sideBlock = (side) => {
      const form = side.formation ? `${side.formation} 형태` : "형태를 숫자로 못 읽은 날";
      const boss = side.manager ? `${side.manager} 감독` : `${side.name}`;
      paras.push(
        `${side.name} — ${boss}의 선발. 평균 자리로 보면 ${form}입니다.`
      );
      for (const p of side.starters || []) paras.push(dutyParagraph(p));
      if (side.bench?.length) {
        paras.push(`${side.name} 후보 투입 ${side.bench.length}명.`);
        for (const p of side.bench) paras.push(dutyParagraph(p));
      }
      if (side.unused?.length) {
        const names = side.unused
          .map((p) => (p.backNo != null && p.backNo !== "" ? `#${p.backNo} ${p.name}` : p.name))
          .join(", ");
        paras.push(`${side.name}에서 뛰지 않은 후보: ${names}.`);
      }
    };

    sideBlock(home);
    sideBlock(away);

    return {
      kicker: "06 · 역할",
      title: "감독이 맡긴 일, 선수가 한 일",
      format: "duty",
      lead: paras[0],
      sides: [home, away],
      paragraphs: paras,
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

  /* Ignore a trailing gloss like "하프스페이스(왼쪽 안쪽)" when picking 은/는. */
  function particleStem(name) {
    return String(name || "").replace(/\([^)]*\)\s*$/g, "").trim();
  }

  function lastHangulCode(name) {
    const s = particleStem(name);
    if (!s) return 0;
    return s.charCodeAt(s.length - 1);
  }

  /** Attach Korean topic particle 은/는 by Hangul batchim. */
  function eunNeun(name) {
    const s = String(name || "");
    const ch = lastHangulCode(name);
    if (ch >= 0xac00 && ch <= 0xd7a3) {
      return (ch - 0xac00) % 28 ? `${s}은` : `${s}는`;
    }
    return `${s}은(는)`;
  }

  function iGa(name) {
    const s = String(name || "");
    const ch = lastHangulCode(name);
    if (ch >= 0xac00 && ch <= 0xd7a3) {
      return (ch - 0xac00) % 28 ? `${s}이` : `${s}가`;
    }
    return `${s}이(가)`;
  }

  function eulReul(name) {
    const s = String(name || "");
    const ch = lastHangulCode(name);
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
    return `xG ${v.toFixed(2)} (같은 자리에서 100번 때리면 약 ${pct}골)`;
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
        `xG(골이 될 확률 합)은 ${h.xg} 대 ${a.xg}입니다. 이 숫자는 슈팅을 몇 번 했는지가 아니라, 얼마나 좋은 자리에서 때렸는지를 보여 줍니다. ` +
        `스코어와 내용이 같은 방향을 가리키면, 팬 입장에선 속이 덜 끓는 승리입니다.`;
    } else if (hs < as && xgGap > 0.15) {
      thesis =
        `${iGa(home)} 기회는 더 많이 만들었습니다. xG(골이 될 확률 합)은 ${h.xg} 대 ${a.xg}인데, 스코어는 ${hs}-${as}로 졌습니다. ` +
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
        `스코어는 ${hs}-${as}로 비겼습니다. xG(골이 될 확률 합)은 ${h.xg} 대 ${a.xg}입니다. ` +
        `비긴 경기일수록 이 두 숫자를 같이 봐야 합니다. 경기를 지배한 팀과 골을 넣은 팀이 다를 수 있거든요. ` +
        `한쪽이 앞에서 공을 오래 가졌는데 스코어가 같다면, 마지막 25m에서 길이 막혔다는 뜻입니다.`;
    } else {
      thesis =
        `최종 스코어는 ${hs}-${as}입니다. 슈팅 ${h.shots}-${a.shots}, xG(골이 될 확률 합) ${h.xg}-${a.xg}. ` +
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
        `쉽게 말하면 ${iGa(home)} 수비 블록을 낮게 깔고, 상대가 앞으로 나와 주길 기다린 날입니다. 버팀의 성패는 역습 한 방과 세트피스에서 갈립니다.`;
    } else if (Math.abs(terrGap) < 4) {
      structure =
        `양 팀이 비슷한 높이에서 맞붙었습니다(${home} ${zoneH.avgX}, ${away} ${zoneA.avgX}). ` +
        `한쪽이 상대를 가둔 경기가 아니라, 중원에서 공을 주워 가는 싸움이 핵심이었습니다. ` +
        `이런 날은 화려한 공격보다 ‘떨어진 공을 누가 먼저 잡느냐’가 더 중요합니다.`;
    } else {
      structure =
        `${eunNeun(home)} 평균적으로 ${zoneH.avgX} 지점, ${eunNeun(away)} ${zoneA.avgX} 지점에서 공을 만졌습니다. ` +
        `하프라인 위쪽에서 누가 공을 잡느냐가 템포를 정했습니다. 앞에서 잡으면 공격이 한 박자 빨라지고, 뒤에서 잡으면 상대가 숨을 고릅니다.`;
    }

    if (h.presses > a.presses * 1.25) {
      structure +=
        ` 압박도 ${home} ${h.presses}회, ${away} ${a.presses}회로 ${iGa(home)} 더 많이 달려들었습니다. ` +
        `압박이 많다는 건 상대가 편안하게 패스를 돌리지 못하게 했다는 뜻입니다.`;
    } else if (a.presses > h.presses * 1.25) {
      structure +=
        ` 압박은 ${away} ${a.presses}회, ${home} ${h.presses}회로 ${away} 쪽이 더 많았습니다. ` +
        `${iGa(home)} 뒤에서 공을 돌리려다 자주 끊겼을 수 있습니다. 끊긴 자리가 높으면 바로 실점 위기가 됩니다.`;
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
    const flow = flowAfterFirstGoal(events, homeId, awayId, meta);
    const goalList = goals(events, meta);
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
        `${eunNeun(home)} 공을 수비 쪽 ${zoneH.thirds.def}%, 중원 ${zoneH.thirds.mid}%, 상대 골문 쪽 ${zoneH.thirds.atk}%에서 만졌습니다. 축구장은 우리 골문 앞, 가운데, 상대 골문 앞 세 덩어리로 보면 이해가 쉽습니다. 상대 골문 쪽 비율이 높을수록 앞에서 경기를 한 팀입니다.`,
        `${eunNeun(away)} 수비 쪽 ${zoneA.thirds.def}%, 중원 ${zoneA.thirds.mid}%, 상대 골문 쪽 ${zoneA.thirds.atk}%입니다.`,
        `${home}의 전진 패스(앞으로 약 12m 이상 간 패스)는 ${zoneH.progressivePasses}회, 전체 패스의 ${zoneH.progressiveRate}%입니다. ${eunNeun(away)} ${zoneA.progressivePasses}회(${zoneA.progressiveRate}%)입니다. 옆으로만 돌리는 패스는 성공해도 골문과 거리가 안 줄어듭니다. 전진 패스가 많아야 공격이 살아납니다.`,
        `패스가 동료에게 간 비율은 ${home} ${passRate(h)}%(${h.passOk}/${h.passes}), ${away} ${passRate(a)}%(${a.passOk}/${a.passes})입니다. 성공률이 높아도 앞으로 안 가면, 식당에서 메뉴만 고르고 밥을 안 시킨 것과 비슷합니다.`,
        zoneH.avgX > zoneA.avgX + 5
          ? `${iGa(home)} 더 앞에서 경기를 하며 상대를 눌렀습니다. 다만 앞에서 공을 가졌다고 박스까지 들어간 것은 아닙니다. 페널티박스 안 터치는 ${home} ${zoneH.boxTouches}회, ${away} ${zoneA.boxTouches}회입니다. 앞에서 만지다 바깥에서 맴돌면, 점유율은 높은데 골 냄새는 안 나는 날이 됩니다.`
          : zoneA.avgX > zoneH.avgX + 5
            ? `${iGa(away)} 더 높은 위치에서 경기를 했습니다. ${eunNeun(home)} 골문 앞에 내려앉아 버티다 역습 타이밍을 노렸을 수 있습니다. 이런 경기는 답답해 보여도, 한 방만 살리면 스코어가 뒤집힙니다.`
            : `양 팀이 비슷한 높이에서 맞붙았습니다. 이런 날은 첫 압박 뒤 떨어진 공, 그리고 왼쪽에서 오른쪽으로 넘기는 패스가 승부를 가릅니다. 화려한 패턴보다 ‘누가 더 빨리 주워 가나’의 싸움입니다.`,
        `${home}의 좌우 사용은 왼쪽 ${zoneH.width.left}%, 가운데 ${zoneH.width.center}%, 오른쪽 ${zoneH.width.right}%입니다. 주로 ${eulReul(sideLabel(zoneH.width))} 썼습니다.`,
        `${eunNeun(away)} 왼쪽 ${zoneA.width.left}%, 가운데 ${zoneA.width.center}%, 오른쪽 ${zoneA.width.right}%입니다. 주로 ${eulReul(sideLabel(zoneA.width))} 썼습니다. 한쪽만 고집하면 상대가 그 길을 미리 막을 수 있고, 너무 고르면 결정적인 우위가 안 나옵니다.`,
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
        `파이널 서드(상대 골문 근처)에서 공을 만진 횟수는 ${home} ${zoneH.finalThirdTouches}회, ${away} ${zoneA.finalThirdTouches}회입니다. 앞에서 많이 만졌는데 슈팅 확률이 낮으면, 들어가긴 했는데 마지막 길이 막힌 날입니다. 택시를 타고 목적지 앞에서 내린 것과 비슷합니다.`,
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
        `전반의 xG(골이 될 확률 합)은 ${p1h.xg} 대 ${p1a.xg}, 슈팅은 ${p1h.shots} 대 ${p1a.shots}입니다. 전반은 몸이 덜 풀리고, 서로 탐색하는 시간입니다.`,
        `후반은 확률 합 ${p2h.xg} 대 ${p2a.xg}, 슈팅 ${p2h.shots} 대 ${p2a.shots}입니다. 후반에는 체력이 떨어지고 교체가 나오면서, 공간이 갑자기 열리기도 합니다.`,
        p2h.xg + p2a.xg > p1h.xg + p1a.xg + 0.3
          ? "후반에 경기가 더 열렸습니다. 쉽게 말하면 전반엔 문을 잠가 두다가, 후반에 열쇠를 놓고 나온 그림입니다. 체력·교체·스코어 추격이 라인을 올리며 공간이 생긴 전형적인 후반형 경기입니다."
          : p1h.xg + p1a.xg > p2h.xg + p2a.xg + 0.3
            ? "전반에 기회가 몰리고 후반은 잠겼습니다. 이긴 팀이 템포를 늦추거나, 추격하는 팀이 조급해져 패턴이 단순해졌을 수 있습니다. 후반이 조용하면 리드 팀이 경기를 잘 관리한 겁니다."
            : "전·후반의 기회 양은 비슷합니다. 90분 평균보다, 특정 15분에 누가 더 집중했느냐가 더 중요했던 날입니다.",
        flow.hasFirstGoal
          ? `선제골은 ${flow.clock}, ${flow.scorerSide === "home" ? home : away}입니다. 첫 골은 스코어만 바꾸는 게 아니라, 두 팀의 마음도 바꿉니다. 이후 xG(골이 될 확률 합)은 ${flow.after[homeId].xg} 대 ${flow.after[awayId].xg}, 슈팅은 ${flow.after[homeId].shots} 대 ${flow.after[awayId].shots}입니다. ${
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
          ? `${home}에서 공을 가장 많이 만진 선수는 ${touchH.name}입니다. 기록 ${touchH.touches}회, 패스 ${touchH.passOk}/${touchH.passes}. 중원과 측면을 이어 주는 축이었습니다. 공이 이 선수에게 모였다는 건, 그날 공격이 이 선수를 거쳐 갔다는 뜻입니다.`
          : `${home}에서 공을 가장 많이 만진 선수를 특정하기 어렵습니다.`,
        passH && passH.player_id !== touchH?.player_id
          ? `패스가 가장 잘 통한 선수는 ${passH.name}입니다(${passH.passOk}성공/${passH.passes}시도). 템포를 늦추거나 옆으로 열어 주는 안전장치 역할이 컸습니다. 위기일 때 공을 이 선수에게 주면, 팀이 한숨 돌립니다.`
          : null,
        threatH && (threatH.shots > 0 || threatH.xg > 0)
          ? `가장 위협적인 선수는 ${threatH.name}입니다. 슈팅 ${threatH.shots}회, xG(골이 될 확률 합) ${threatH.xg.toFixed(2)}, 골 ${threatH.goals}. ${
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

    const dutyChapter = buildDutyChapter(meta, events, players, lineup);
    if (dutyChapter) chapters.push(dutyChapter);

    const goalChapters = buildGoalNarratives(goalList, events, meta, pmap);
    if (goalChapters.length) {
      chapters.push({
        kicker: "07 · 골 장면",
        title: "골은 어떻게 나왔나",
        paragraphs: goalChapters.map((g) => `${g.title}. ${g.text}`),
      });
    }

    const subParas = buildSubParagraphs(meta, events, lineup, p1h, p1a, p2h, p2a);
    if (subParas && subParas.length) {
      chapters.push({
        kicker: "08 · 교체",
        title: "교체와 후반 조정",
        paragraphs: subParas,
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
      kicker: "09 · 다음에 고칠 점",
      title: "다음 경기를 위한 메모",
      paragraphs: coaching,
    });

    chapters.push({
      kicker: "NOTE",
      title: "이 글을 읽는 법",
      paragraphs: [
        "이 브리핑은 K리그 포털에 찍힌 패스·슈팅·태클 위치를 바탕으로 자동으로 만든 글입니다. 감독이 실제로 지시한 내용과 다를 수 있고, 그날 눈에 보이는 행동에 대한 해석입니다. 선수 역할의 ‘부여’는 경기 시트 포지션이고, ‘실제’는 평균 위치와 기록으로 추정한 이름입니다.",
        "어려운 용어는 오른쪽 용어 가이드에 풀어 두었습니다. 아래 히트맵, 슈팅 맵, 골 스토리에서 같은 이야기를 그림으로 다시 확인해 보세요. 글과 그림이 만나면, 경기가 훨씬 선명해집니다.",
      ],
    });

    return {
      chapters,
      metrics: { zoneH, zoneA, shotH, shotA, actH, actA, state },
    };
  }

  /**
   * Other-club match → Jeonbuk-perspective scout note.
   * Style contrast of both sides, then edge / risk / target / caution for Jeonbuk.
   */
  function styleTagsFor(zone, shot, row) {
    const tags = [];
    if (zone.avgX >= 54) tags.push("전진 점유");
    else if (zone.avgX <= 46) tags.push("낮은 블록");
    else tags.push("중원 균형");
    if (zone.progressiveRate >= 18) tags.push("직선 패스");
    else if (zone.passes >= 80 && zone.progressiveRate < 12) tags.push("측면 순환");
    if (zone.highPressShare >= 45 && (zone.presses || 0) >= 6) tags.push("높은 압박");
    if (shot.n >= 4 && shot.box >= shot.outBox) tags.push("박스 안 마무리");
    else if (shot.n >= 4 && shot.outBox > shot.box) tags.push("박스 밖 슈팅");
    if (shot.big >= 2) tags.push("고품질 기회");
    if (row.xg > 0 && row.goals + 0.35 < row.xg) tags.push("결정력↓");
    if (row.goals > row.xg + 0.35) tags.push("결정력↑");
    const side = sideLabel(zone.width || {});
    if (side && side !== "여러 곳") tags.push(`${side} 편중`);
    return tags;
  }

  function buildJeonbukScoutNote(meta, events, players, lineup) {
    const homeId = meta.home.team_id;
    const awayId = meta.away.team_id;
    const home = meta.home.name || "홈";
    const away = meta.away.name || "원정";
    const stats = teamStats(events, homeId, awayId);
    const h = stats[homeId] || {};
    const a = stats[awayId] || {};
    const zoneH = zoneShare(events, homeId, homeId);
    const zoneA = zoneShare(events, awayId, homeId);
    const shotH = shotProfile(events, homeId, homeId);
    const shotA = shotProfile(events, awayId, homeId);
    const tagsH = styleTagsFor(zoneH, shotH, h);
    const tagsA = styleTagsFor(zoneA, shotA, a);

    const contrast =
      `${home}은(는) ${tagsH.slice(0, 3).join(" · ") || "혼합형"} 그림이고, ` +
      `${away}은(는) ${tagsA.slice(0, 3).join(" · ") || "혼합형"} 그림입니다. ` +
      `점유 높이(평균 터치)는 ${home} ${zoneH.avgX} · ${away} ${zoneA.avgX}, ` +
      `xG(골이 될 확률 합)는 ${home} ${h.xg ?? 0} · ${away} ${a.xg ?? 0}, ` +
      `슈팅은 ${h.shots ?? 0}-${a.shots ?? 0}입니다. ` +
      `전북이 다음에 이 스타일과 마주친다는 가정으로 읽습니다.`;

    const edges = [];
    const risks = [];
    const targets = [];
    const cautions = [];

    const pushUnique = (arr, text) => {
      if (!text || arr.includes(text)) return;
      arr.push(text);
    };

    // High line / progressive side → space in behind for Jeonbuk
    for (const [name, zone, shot, row] of [
      [home, zoneH, shotH, h],
      [away, zoneA, shotA, a],
    ]) {
      if (zone.avgX >= 54) {
        pushUnique(
          edges,
          `${name}처럼 라인을 올린 팀을 만나면, 전북은 한 방에 등 뒤 공간을 열 수 있습니다. 측면 돌파 뒤 컷백·스루패스가 잘 통합니다.`
        );
        pushUnique(
          cautions,
          `${name}의 높은 점유/압박 구간에서는 전북이 빌드업 실수를 허용하면 바로 박스 위기가 됩니다. 첫 패스 실패를 줄여야 합니다.`
        );
      }
      if (zone.avgX <= 46) {
        pushUnique(
          edges,
          `${name}처럼 내려앉는 팀은 전북이 영토를 가져가기 쉽습니다. 페널티박스 진입 횟수를 늘리는 쪽이 유리합니다.`
        );
        pushUnique(
          risks,
          `${name}형 낮은 블록은 전북의 템포를 죽입니다. 점유만 높고 슈팅 질이 떨어지면 역습 한 방에 끌려갈 수 있습니다.`
        );
        pushUnique(
          targets,
          `${name}을(를) 상대할 때는 박스 밖 남발보다, 오버랩·하프스페이스 침투로 박스 안 컷백을 노리는 편이 맞습니다.`
        );
      }
      if (shot.outBox > shot.box && shot.n >= 5) {
        pushUnique(
          edges,
          `${name}은(는) 박스 밖 슈팅 비중이 큽니다. 전북이 박스 입구만 단단히 막으면 상대 기회 질이 급격히 떨어집니다.`
        );
      }
      if (shot.big >= 2 || (shot.box >= 4 && shot.avgXg >= 0.12)) {
        pushUnique(
          cautions,
          `${name}은(는) 좋은 자리 슈팅이 있었습니다. 전북이 라인 간격이 벌어지는 전환 순간을 특히 조심해야 합니다.`
        );
        pushUnique(
          risks,
          `${name}의 고품질 기회 패턴이 전북 수비에도 재현되면 스코어를 한번에 내줄 수 있습니다.`
        );
      }
      if (row.xg > 0 && row.goals + 0.35 < row.xg) {
        pushUnique(
          edges,
          `${name}은(는) xG 대비 득점이 적었습니다. 같은 기회를 전북이 만들면 마무리만 살리면 우위가 됩니다.`
        );
      }
      if (row.goals > (row.xg || 0) + 0.35) {
        pushUnique(
          cautions,
          `${name}은(는) 적은 기회도 골로 바꿨습니다. 전북이 ‘한 방만 막으면 된다’고 방심하면 위험합니다.`
        );
      }
      if (zone.progressiveRate >= 18) {
        pushUnique(
          targets,
          `${name}의 직선 패스 경로(전진 패스 ${zone.progressiveRate}%)를 전북이 중원에서 끊으면, 상대 템포가 바로 죽습니다.`
        );
      }
      if ((zone.width?.left || 0) >= 40 || (zone.width?.right || 0) >= 40) {
        const wing = (zone.width?.left || 0) >= (zone.width?.right || 0) ? "왼쪽" : "오른쪽";
        pushUnique(
          targets,
          `${name} 공격이 ${wing}에 몰렸습니다. 전북은 그 측면을 의도적으로 열어 두고 반대쪽 역습을 준비하거나, 풀백 숫자를 맞춰 잠그는 선택이 가능합니다.`
        );
      }
      if ((zone.highPressShare || 0) >= 45 && (zone.presses || 0) >= 6) {
        pushUnique(
          risks,
          `${name}의 높은 압박 비중은 전북 빌드업을 흔듭니다. 롱볼·측면 탈출 옵션을 미리 정해 두지 않으면 중원에서 끊깁니다.`
        );
        pushUnique(
          targets,
          `${name} 압박이 과열되는 순간, 전북이 한 템포 빠른 스루패스로 라인을 넘기면 빅찬스가 납니다.`
        );
      }
    }

    // Relative contrast between the two clubs
    if (zoneH.avgX - zoneA.avgX >= 6) {
      pushUnique(
        edges,
        `${home}이(가) ${away}보다 앞에서 싸웠습니다. 전북이 ${away}형 수비 블록을 만나면 오늘 ${home}이(가) 가져간 영토 우위와 비슷한 그림을 그릴 수 있습니다.`
      );
    } else if (zoneA.avgX - zoneH.avgX >= 6) {
      pushUnique(
        edges,
        `${away}이(가) ${home}보다 앞에서 싸웠습니다. 전북이 ${home}형 내려앉은 팀을 상대할 때 참고할 점유 높이입니다.`
      );
    }
    if ((h.xg || 0) + 0.25 < (a.xg || 0) && meta.score.home >= meta.score.away) {
      pushUnique(
        cautions,
        `스코어는 ${home} 쪽이 나았지만 기회 질은 ${away}이(가) 더 좋았습니다. 전북도 ‘이기고 있는데 더 위험한’ 구간에 빠지지 않도록 리드 관리가 필요합니다.`
      );
    }
    if ((a.xg || 0) + 0.25 < (h.xg || 0) && meta.score.away >= meta.score.home) {
      pushUnique(
        cautions,
        `스코어는 ${away} 쪽이 나았지만 기회 질은 ${home}이(가) 더 좋았습니다. 효율형 팀에 끌려가지 않으려면 전북의 첫 실점 전 마무리가 중요합니다.`
      );
    }

    // Fallbacks so every card has content
    if (!edges.length) {
      edges.push(
        `양 팀의 스타일이 극단적이지 않습니다. 전북이 중원 볼 경합과 측면 오버랩에서 숫자 우위를 가져가면 경기를 자기 템포로 가져올 여지가 있습니다.`
      );
    }
    if (!risks.length) {
      risks.push(
        `팽팽한 중원 싸움에서는 전북이 조급해져 박스 밖 슈팅으로 흐르면 불리합니다. 오늘 경기처럼 기회가 비슷할수록 전환 수비 한 장면이 승부를 가릅니다.`
      );
    }
    if (!targets.length) {
      targets.push(
        `전북이 노릴 1순위는 파이널 서드 진입 후 컷백입니다. ${home}/${away} 모두 박스 안 터치·슈팅 질이 승부처였습니다.`
      );
    }
    if (!cautions.length) {
      cautions.push(
        `세트피스와 역습 첫 패스를 최우선으로 막아야 합니다. 오늘도 짧은 순간의 마무리가 스코어를 갈랐을 가능성이 큽니다.`
      );
    }

    return {
      kicker: "00 · 전북 시점",
      title: `${home} vs ${away} — 전북이 읽어야 할 스타일 대비`,
      contrast,
      tags: { home: tagsH, away: tagsA },
      cards: [
        { key: "edge", label: "전북이 유리한 점", items: edges.slice(0, 3) },
        { key: "risk", label: "전북이 불리한 점", items: risks.slice(0, 3) },
        { key: "target", label: "전북이 노려야 할 점", items: targets.slice(0, 3) },
        { key: "caution", label: "전북이 조심해야 할 점", items: cautions.slice(0, 3) },
      ],
    };
  }

  function buildFullReportText(meta, stats, goalList, pmap, events, players, pageUrl, lineup) {
    const h = stats[meta.home.team_id];
    const a = stats[meta.away.team_id];
    const lines = [];
    const url = pageUrl || "https://wanju1109.github.io/jeonbuk-lineup/c_report/";
    const briefing = buildTacticalBriefing(meta, events, players, lineup);

    lines.push("JEONBUK MATCH AI REPORT");
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
    if (!goalList.length) {
      const hs = Number(meta?.score?.home);
      const as = Number(meta?.score?.away);
      if (hs === 0 && as === 0) {
        lines.push("스코어 0-0. 골 스토리로 풀어 줄 장면이 없습니다.");
      } else {
        lines.push("이 경기 CHALK BOARD에 골 이벤트가 없습니다.");
      }
    }
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
    lines.push("xG(같은 자리에서 100번 때리면 약 몇 골인가). 예: xG 0.10 (같은 자리에서 100번 때리면 약 10골).");
    lines.push("히트맵(선수가 공을 많이 만진 자리). 어디에 있었는지 한눈에 보여 줍니다.");
    lines.push("패스 성공(동료에게 공이 제대로 간 패스). 성공률과 함께 앞으로 갔는지도 보세요.");
    lines.push("CHALK BOARD(K리그 포털의 슈팅·패스·태클 위치 기록).");
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
    buildJeonbukScoutNote,
    buildFullReportText,
  };
})();

window.Analyze = Analyze;
