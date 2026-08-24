/*
 * Deep tactical analysis engine for K LEAGUE CHALK BOARD event data.
 *
 * Coordinate contract
 * -------------------
 * Raw events use an absolute pitch frame where the home side attacks +x in
 * period 1 and the sides swap in period 2. Every metric here works in a
 * "team perspective" frame: the team under inspection always attacks +x,
 * y < 33 is that team's left flank, y > 67 is its right flank. The frame is
 * produced by an even/odd count of 180-degree rotations, so both x and y are
 * mirrored together and never independently.
 */

const Tactics = (() => {
  const LANES = [
    { key: "lw", label: "왼쪽 측면", short: "좌측", from: 0, to: 20 },
    { key: "lh", label: "왼쪽 하프스페이스(왼쪽 안쪽)", short: "좌안쪽", from: 20, to: 37 },
    { key: "c", label: "중앙", short: "중앙", from: 37, to: 63 },
    { key: "rh", label: "오른쪽 하프스페이스(오른쪽 안쪽)", short: "우안쪽", from: 63, to: 80 },
    { key: "rw", label: "오른쪽 측면", short: "우측", from: 80, to: 100 },
  ];

  const THIRDS = [
    { key: "def", label: "수비 지역", from: 0, to: 100 / 3 },
    { key: "mid", label: "중원", from: 100 / 3, to: 200 / 3 },
    { key: "att", label: "공격 지역", from: 200 / 3, to: 100 },
  ];

  /* Penalty area in 0-100 coordinates. */
  const BOX = { x: 83, yMin: 21, yMax: 79 };
  /* Zone 14: central pocket immediately outside the box. */
  const ZONE14 = { xMin: 66, xMax: 83, yMin: 37, yMax: 63 };

  const BALL_WON = ["TKS", "INT", "CUT", "RCV"];
  const TACKLE_INT_FOUL = ["TKS", "TKU", "INT", "CUT", "FOC"];
  const DEF_ACTION = ["TKS", "TKU", "INT", "CUT", "CLG", "RCV", "FOC", "STB"];
  const PRESS = ["OPCS", "OPCU"];

  /* Max gap (seconds) that still counts as one continuous possession. */
  const POSSESSION_GAP_SEC = 12;
  /* Max gap (seconds) between a completed pass and its receiver's next touch. */
  const RECEIVE_WINDOW_SEC = 8;

  function num(v, fallback = null) {
    if (v === null || v === undefined || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  function round(v, digits = 1) {
    const f = 10 ** digits;
    return Math.round(v * f) / f;
  }

  function share(part, total) {
    if (!total) return 0;
    return round((part / total) * 100, 1);
  }

  function absSeconds(e) {
    const period = num(e.PERIOD_ID, 1) <= 1 ? 1 : 2;
    return (period - 1) * 6000 + num(e.MIN_TIME, 0) * 60 + num(e.SEC_TIME, 0);
  }

  /* Minute on a continuous 0-90+ clock, used for timeline plotting. */
  function timelineMinute(e) {
    const period = num(e.PERIOD_ID, 1) <= 1 ? 1 : 2;
    const min = num(e.MIN_TIME, 0);
    return period === 1 ? Math.min(min, 45) : Math.min(min, 90);
  }

  function chrono(events) {
    return [...events].sort((a, b) => {
      const d = absSeconds(a) - absSeconds(b);
      if (d !== 0) return d;
      return num(a.SEQ, 0) - num(b.SEQ, 0);
    });
  }

  /* Project an event into the given team's attacking frame. */
  function pov(event, teamId, homeId) {
    let x = num(event.START_POINT_X, 50);
    let y = num(event.START_POINT_Y, 50);
    let ex = num(event.END_POINT_X, null);
    let ey = num(event.END_POINT_Y, null);
    const flips =
      (num(event.PERIOD_ID, 1) > 1 ? 1 : 0) + (event.TEAM_ID === homeId ? 0 : 1);
    if (flips % 2 === 1) {
      x = 100 - x;
      y = 100 - y;
      if (ex !== null) ex = 100 - ex;
      if (ey !== null) ey = 100 - ey;
    }
    if (ex === null || ey === null) {
      ex = null;
      ey = null;
    }
    return { x, y, ex, ey };
  }

  function laneOf(y) {
    for (const lane of LANES) {
      if (y >= lane.from && y < lane.to) return lane;
    }
    return LANES[LANES.length - 1];
  }

  function thirdOf(x) {
    for (const t of THIRDS) {
      if (x >= t.from && x < t.to) return t;
    }
    return THIRDS[THIRDS.length - 1];
  }

  function inBox(x, y) {
    return x >= BOX.x && y >= BOX.yMin && y <= BOX.yMax;
  }

  function inZone14(x, y) {
    return x >= ZONE14.xMin && x < ZONE14.xMax && y >= ZONE14.yMin && y <= ZONE14.yMax;
  }

  function isPass(e) {
    return e.TYPE_CD === "PS";
  }

  function isCompletedPass(e) {
    return e.TYPE_CD === "PS" && e.TYPE_DETAIL_CD === "PSS";
  }

  function isShot(e) {
    return e.TYPE_CD === "ST";
  }

  function isGoal(e) {
    return e.TYPE_DETAIL_CD === "GL";
  }

  function setPieceOf(e) {
    const cd = String(e.TYPE_DETAIL_CD2 || "").trim();
    return cd || null;
  }

  /* ------------------------------------------------------------------ *
   * Possession sequences
   * ------------------------------------------------------------------ */

  function possessionSequences(orderedEvents, homeId) {
    const out = [];
    let current = null;
    for (const e of orderedEvents) {
      const t = absSeconds(e);
      if (!current || current.teamId !== e.TEAM_ID || t - current.endSec > POSSESSION_GAP_SEC) {
        if (current) out.push(current);
        const p = pov(e, e.TEAM_ID, homeId);
        current = {
          teamId: e.TEAM_ID,
          startSec: t,
          endSec: t,
          startX: p.x,
          startY: p.y,
          events: [e],
        };
      } else {
        current.events.push(e);
        current.endSec = t;
      }
    }
    if (current) out.push(current);

    for (const seq of out) {
      seq.passes = seq.events.filter(isPass).length;
      seq.shot = seq.events.find(isShot) || null;
      seq.goal = seq.events.some(isGoal);
      seq.durationSec = seq.endSec - seq.startSec;
      seq.timeToShot = seq.shot ? absSeconds(seq.shot) - seq.startSec : null;
    }
    return out;
  }

  function sequenceProfile(sequences, teamId) {
    const mine = sequences.filter((s) => s.teamId === teamId);
    if (!mine.length) {
      return {
        count: 0,
        avgPasses: 0,
        withShot: 0,
        shotRate: 0,
        sustained: 0,
        sustainedRate: 0,
        direct: 0,
        fastShots: 0,
        startedHigh: 0,
        startedHighRate: 0,
        avgStartX: 50,
      };
    }
    const totalPasses = mine.reduce((s, q) => s + q.passes, 0);
    const withShot = mine.filter((s) => s.shot).length;
    const sustained = mine.filter((s) => s.passes >= 6).length;
    const direct = mine.filter((s) => s.shot && s.passes <= 2).length;
    const fastShots = mine.filter((s) => s.shot && s.timeToShot !== null && s.timeToShot <= 12).length;
    const startedHigh = mine.filter((s) => s.startX >= 60).length;
    const avgStartX = mine.reduce((s, q) => s + q.startX, 0) / mine.length;
    return {
      count: mine.length,
      avgPasses: round(totalPasses / mine.length, 2),
      withShot,
      shotRate: share(withShot, mine.length),
      sustained,
      sustainedRate: share(sustained, mine.length),
      direct,
      fastShots,
      startedHigh,
      startedHighRate: share(startedHigh, mine.length),
      avgStartX: round(avgStartX, 1),
    };
  }

  /* ------------------------------------------------------------------ *
   * Pressing / defensive posture
   * ------------------------------------------------------------------ */

  function pressingProfile(events, teamId, oppId, homeId) {
    let oppPassesLow = 0;
    for (const e of events) {
      if (e.TEAM_ID !== oppId || !isPass(e)) continue;
      if (pov(e, oppId, homeId).x <= 60) oppPassesLow += 1;
    }

    let defActionsHigh = 0;
    let pressTotal = 0;
    let pressHigh = 0;
    const defXs = [];
    let ballWonHigh = 0;
    let ballWonTotal = 0;
    const laneDef = {};
    for (const lane of LANES) laneDef[lane.key] = 0;

    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      const d = e.TYPE_DETAIL_CD;
      const p = pov(e, teamId, homeId);
      if (TACKLE_INT_FOUL.includes(d) && p.x >= 40) defActionsHigh += 1;
      if (DEF_ACTION.includes(d)) {
        defXs.push(p.x);
        laneDef[laneOf(p.y).key] += 1;
      }
      if (PRESS.includes(d)) {
        pressTotal += 1;
        if (p.x >= 55) pressHigh += 1;
      }
      if (BALL_WON.includes(d)) {
        ballWonTotal += 1;
        if (p.x >= 60) ballWonHigh += 1;
      }
    }

    const avgDefX = defXs.length ? defXs.reduce((s, v) => s + v, 0) / defXs.length : 50;
    return {
      ppda: defActionsHigh ? round(oppPassesLow / defActionsHigh, 2) : null,
      oppPassesLow,
      defActionsHigh,
      pressTotal,
      pressHigh,
      pressHighRate: share(pressHigh, pressTotal),
      defLineHeight: round(avgDefX, 1),
      defActionCount: defXs.length,
      laneDef,
      ballWonTotal,
      ballWonHigh,
      ballWonHighRate: share(ballWonHigh, ballWonTotal),
    };
  }

  /* ------------------------------------------------------------------ *
   * Ball progression and final-third entry
   * ------------------------------------------------------------------ */

  function progressionProfile(events, teamId, homeId) {
    let passes = 0;
    let completed = 0;
    let progressive = 0;
    let intoBox = 0;
    let crossIntoBox = 0;
    let groundIntoBox = 0;
    let zone14 = 0;
    let keyPasses = 0;
    let longPasses = 0;
    let lengthSum = 0;
    let lengthN = 0;
    let backward = 0;
    let switches = 0;

    const laneTouch = {};
    const laneEntry = {};
    for (const lane of LANES) {
      laneTouch[lane.key] = 0;
      laneEntry[lane.key] = 0;
    }

    let finalThirdTouches = 0;
    let boxTouches = 0;
    let touches = 0;

    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      const p = pov(e, teamId, homeId);
      const touchLike = ["PS", "ST", "DU", "DF", "FO"].includes(e.TYPE_CD);
      if (touchLike) {
        touches += 1;
        laneTouch[laneOf(p.y).key] += 1;
        if (p.x >= THIRDS[2].from) {
          finalThirdTouches += 1;
          laneEntry[laneOf(p.y).key] += 1;
        }
        if (inBox(p.x, p.y)) boxTouches += 1;
      }

      if (e.KEYPASS_YN_CD === "Y") keyPasses += 1;

      if (!isPass(e)) continue;
      passes += 1;
      if (isCompletedPass(e)) completed += 1;

      const len = num(e.PASS_LENGTH, null);
      if (len !== null) {
        lengthSum += len;
        lengthN += 1;
        if (len >= 25) longPasses += 1;
      }

      if (p.ex === null) continue;
      const dx = p.ex - p.x;
      const dy = Math.abs(p.ey - p.y);
      if (dx >= 12) progressive += 1;
      if (dx <= -8) backward += 1;
      if (dy >= 40 && Math.abs(dx) < 25) switches += 1;

      const startedOutsideBox = !inBox(p.x, p.y);
      if (startedOutsideBox && inBox(p.ex, p.ey)) {
        intoBox += 1;
        const fromWide = p.y < BOX.yMin || p.y > BOX.yMax;
        if (fromWide && p.x >= 55) crossIntoBox += 1;
        else groundIntoBox += 1;
      }
      if (!inZone14(p.x, p.y) && inZone14(p.ex, p.ey)) zone14 += 1;
    }

    return {
      passes,
      completed,
      accuracy: share(completed, passes),
      progressive,
      progressiveRate: share(progressive, passes),
      backward,
      switches,
      longPasses,
      longRate: share(longPasses, lengthN),
      avgPassLength: lengthN ? round(lengthSum / lengthN, 1) : 0,
      intoBox,
      crossIntoBox,
      groundIntoBox,
      crossShare: share(crossIntoBox, intoBox),
      zone14,
      keyPasses,
      touches,
      finalThirdTouches,
      boxTouches,
      laneTouch,
      laneEntry,
    };
  }

  /* Share of all final-third touches in the match that belong to a team. */
  function fieldTilt(events, homeId, awayId) {
    const count = { [homeId]: 0, [awayId]: 0 };
    for (const e of events) {
      if (!["PS", "ST", "DU"].includes(e.TYPE_CD)) continue;
      if (count[e.TEAM_ID] === undefined) continue;
      if (pov(e, e.TEAM_ID, homeId).x >= THIRDS[2].from) count[e.TEAM_ID] += 1;
    }
    const total = count[homeId] + count[awayId];
    return {
      home: share(count[homeId], total),
      away: share(count[awayId], total),
      homeN: count[homeId],
      awayN: count[awayId],
    };
  }

  /* ------------------------------------------------------------------ *
   * Zone occupation grid (5 lanes x 3 thirds)
   * ------------------------------------------------------------------ */

  function zoneGrid(events, teamId, homeId) {
    const cells = {};
    let total = 0;
    for (const t of THIRDS) {
      for (const lane of LANES) {
        cells[`${t.key}:${lane.key}`] = 0;
      }
    }
    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      if (!["PS", "ST", "DU", "DF", "FO"].includes(e.TYPE_CD)) continue;
      const p = pov(e, teamId, homeId);
      const key = `${thirdOf(p.x).key}:${laneOf(p.y).key}`;
      if (cells[key] === undefined) continue;
      cells[key] += 1;
      total += 1;
    }
    const grid = THIRDS.map((t) =>
      LANES.map((lane) => {
        const n = cells[`${t.key}:${lane.key}`];
        return { third: t, lane, count: n, share: share(n, total) };
      })
    );
    return { grid, total };
  }

  /* ------------------------------------------------------------------ *
   * Team shape: average positions, formation estimate, pass network
   * ------------------------------------------------------------------ */

  function averagePositions(events, teamId, homeId) {
    const agg = new Map();
    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      if (!["PS", "ST", "DU", "DF", "FO", "GK"].includes(e.TYPE_CD)) continue;
      const id = String(e.PLAYER_ID);
      if (!agg.has(id)) agg.set(id, { sx: 0, sy: 0, n: 0, backNo: e.back_no });
      const row = agg.get(id);
      const p = pov(e, teamId, homeId);
      row.sx += p.x;
      row.sy += p.y;
      row.n += 1;
    }
    const out = new Map();
    for (const [id, row] of agg) {
      out.set(id, {
        playerId: id,
        x: round(row.sx / row.n, 1),
        y: round(row.sy / row.n, 1),
        touches: row.n,
        backNo: row.backNo,
      });
    }
    return out;
  }

  function bandAvgX(players) {
    if (!players.length) return 0;
    return players.reduce((s, p) => s + p.x, 0) / players.length;
  }

  /*
   * Estimate a formation string from the starters' average x positions.
   *
   * Defender and forward counts come from the official position codes. The
   * midfield is split at its widest internal gap, but each resulting band must
   * hold at least two players: without that constraint a single deep-lying
   * midfielder produces shapes like 4-1-5 that no coach would recognise, even
   * though the underlying averages are correct.
   */
  function inferFormation(nodes) {
    const outfield = nodes.filter((n) => n.position !== "GK" && n.touches > 0);
    if (outfield.length < 7) return { label: null, bands: [] };

    const defs = outfield.filter((n) => n.position === "DF").sort((a, b) => a.x - b.x);
    const mids = outfield.filter((n) => n.position === "MF").sort((a, b) => a.x - b.x);
    const fwds = outfield.filter((n) => n.position === "FW").sort((a, b) => a.x - b.x);

    const bands = [];
    if (defs.length) bands.push({ role: "DF", players: defs });

    if (mids.length >= 4) {
      let splitIdx = -1;
      let widest = 0;
      for (let i = 2; i <= mids.length - 2; i += 1) {
        const gap = mids[i].x - mids[i - 1].x;
        if (gap > widest) {
          widest = gap;
          splitIdx = i;
        }
      }
      /* A six-man band is never a real line, so split it at its best gap
       * regardless of how small that gap is. */
      const mustSplit = mids.length >= 6;
      if ((widest >= 4 || mustSplit) && splitIdx > 0) {
        bands.push({ role: "MF", players: mids.slice(0, splitIdx) });
        bands.push({ role: "MF", players: mids.slice(splitIdx) });
      } else {
        bands.push({ role: "MF", players: mids });
      }
    } else if (mids.length) {
      bands.push({ role: "MF", players: mids });
    }

    if (fwds.length) bands.push({ role: "FW", players: fwds });

    /*
     * Merge a forward band into the line behind it only when they genuinely
     * sat level, played enough of the match to trust their average, and the
     * result still reads as a football line. Merging into a band of six
     * produces shapes like 4-6 that describe nothing.
     */
    if (bands.length >= 2) {
      const last = bands[bands.length - 1];
      const prev = bands[bands.length - 2];
      const lastTouches = last.players.reduce((s, p) => s + p.touches, 0);
      const merged = prev.players.length + last.players.length;
      if (
        Math.abs(bandAvgX(last.players) - bandAvgX(prev.players)) < 3 &&
        lastTouches >= 15 &&
        merged <= 5
      ) {
        prev.players = prev.players.concat(last.players);
        bands.pop();
      }
    }

    const counts = bands.map((b) => b.players.length).filter((n) => n > 0);
    return {
      label: counts.length ? counts.join("-") : null,
      bands: bands.map((b) => ({
        role: b.role,
        count: b.players.length,
        avgX: round(bandAvgX(b.players), 1),
        players: b.players,
      })),
    };
  }

  function teamShape(events, players, lineup, side, teamId, homeId) {
    const roster = (lineup && lineup[side]) || [];
    const starters = roster.filter((p) => p.starter);
    const avg = averagePositions(events, teamId, homeId);
    const byId = new Map();
    for (const p of players || []) byId.set(String(p.player_id), p);

    const nodes = starters.map((p) => {
      const id = String(p.player_id);
      const pos = avg.get(id) || { x: 50, y: 50, touches: 0 };
      return {
        playerId: id,
        name: p.name || byId.get(id)?.NAME || "선수",
        backNo: p.back_no ?? pos.backNo ?? "",
        position: p.position || byId.get(id)?.Position_Name || "",
        x: pos.x,
        y: pos.y,
        touches: pos.touches,
        minutes: num(p.minutes, null),
        captain: Boolean(p.captain),
        outLabel: p.out_label || "",
      };
    });

    /* Fall back to event-derived nodes when the lineup feed is missing. */
    if (!nodes.length) {
      for (const [id, pos] of avg) {
        const p = byId.get(id);
        nodes.push({
          playerId: id,
          name: p?.NAME || "선수",
          backNo: p?.back_no ?? pos.backNo ?? "",
          position: p?.Position_Name || "",
          x: pos.x,
          y: pos.y,
          touches: pos.touches,
          minutes: null,
          captain: false,
          outLabel: "",
        });
      }
      nodes.sort((a, b) => b.touches - a.touches);
      nodes.splice(11);
    }

    const withTouches = nodes.filter((n) => n.touches > 0);
    const outfield = withTouches.filter((n) => n.position !== "GK");
    const backLine = withTouches.filter((n) => n.position === "DF");
    const avgX = outfield.length
      ? round(outfield.reduce((s, n) => s + n.x, 0) / outfield.length, 1)
      : 50;
    const defLineX = backLine.length
      ? round(backLine.reduce((s, n) => s + n.x, 0) / backLine.length, 1)
      : round(Math.max(20, avgX - 15), 1);
    const widthSpread = outfield.length
      ? round(
          Math.max(...outfield.map((n) => n.y)) - Math.min(...outfield.map((n) => n.y)),
          1
        )
      : 0;
    const depthSpread = outfield.length
      ? round(
          Math.max(...outfield.map((n) => n.x)) - Math.min(...outfield.map((n) => n.x)),
          1
        )
      : 0;

    return {
      nodes,
      formation: inferFormation(nodes),
      blockHeight: avgX,
      defLineX,
      widthSpread,
      depthSpread,
    };
  }

  /*
   * Infer pass combinations: a completed pass followed within a short window
   * by a different team-mate's event is treated as a completed connection.
   */
  function passNetwork(orderedEvents, teamId, homeId, nodes, limit = 14) {
    const nodeById = new Map(nodes.map((n) => [n.playerId, n]));
    const links = new Map();
    for (let i = 0; i < orderedEvents.length - 1; i += 1) {
      const a = orderedEvents[i];
      if (a.TEAM_ID !== teamId || !isCompletedPass(a)) continue;
      const b = orderedEvents[i + 1];
      if (b.TEAM_ID !== teamId) continue;
      const from = String(a.PLAYER_ID);
      const to = String(b.PLAYER_ID);
      if (from === to) continue;
      if (absSeconds(b) - absSeconds(a) > RECEIVE_WINDOW_SEC) continue;
      if (!nodeById.has(from) || !nodeById.has(to)) continue;
      const key = `${from}>${to}`;
      links.set(key, (links.get(key) || 0) + 1);
    }

    const edges = [...links.entries()]
      .map(([key, count]) => {
        const [from, to] = key.split(">");
        return { from, to, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, limit);

    /* Combined volume per undirected pair, used to judge circulation bias. */
    const pairTotals = new Map();
    for (const [key, count] of links) {
      const [from, to] = key.split(">");
      const pair = [from, to].sort().join("|");
      pairTotals.set(pair, (pairTotals.get(pair) || 0) + count);
    }
    const topPair = [...pairTotals.entries()].sort((a, b) => b[1] - a[1])[0] || null;

    return {
      edges,
      totalLinks: [...links.values()].reduce((s, v) => s + v, 0),
      topPair: topPair
        ? {
            a: nodeById.get(topPair[0].split("|")[0]) || null,
            b: nodeById.get(topPair[0].split("|")[1]) || null,
            count: topPair[1],
          }
        : null,
    };
  }

  /* ------------------------------------------------------------------ *
   * Set pieces and shot quality
   * ------------------------------------------------------------------ */

  function setPieceProfile(events, teamId) {
    const counts = { CK: 0, FK: 0, TH: 0, PK: 0 };
    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      const cd = setPieceOf(e);
      if (cd && counts[cd] !== undefined) counts[cd] += 1;
    }
    const shots = events.filter((e) => e.TEAM_ID === teamId && isShot(e));
    const setShots = shots.filter((e) => setPieceOf(e));
    const setXg = setShots.reduce((s, e) => s + num(e.EXPECTED_GOAL, 0), 0);
    return {
      corners: counts.CK,
      freeKicks: counts.FK,
      throwIns: counts.TH,
      penalties: counts.PK,
      setPieceShots: setShots.length,
      setPieceXg: round(setXg, 2),
    };
  }

  function shotQuality(events, teamId, homeId) {
    const shots = events.filter((e) => e.TEAM_ID === teamId && isShot(e));
    let box = 0;
    let outside = 0;
    let sixYard = 0;
    let xgSum = 0;
    let big = 0;
    let poor = 0;
    let goals = 0;
    const laneCount = {};
    for (const lane of LANES) laneCount[lane.key] = 0;

    for (const e of shots) {
      const p = pov(e, teamId, homeId);
      const xg = num(e.EXPECTED_GOAL, 0);
      xgSum += xg;
      if (xg >= 0.25) big += 1;
      if (xg < 0.06) poor += 1;
      if (inBox(p.x, p.y)) box += 1;
      else outside += 1;
      if (p.x >= 94 && p.y >= 37 && p.y <= 63) sixYard += 1;
      if (isGoal(e)) goals += 1;
      laneCount[laneOf(p.y).key] += 1;
    }

    return {
      shots: shots.length,
      xg: round(xgSum, 2),
      avgXg: shots.length ? round(xgSum / shots.length, 3) : 0,
      box,
      outside,
      outsideRate: share(outside, shots.length),
      sixYard,
      big,
      poor,
      poorRate: share(poor, shots.length),
      goals,
      xgOver: round(goals - xgSum, 2),
      laneCount,
    };
  }

  /* ------------------------------------------------------------------ *
   * Momentum: cumulative xG timeline
   * ------------------------------------------------------------------ */

  function momentumSeries(orderedEvents, homeId, awayId) {
    const points = [];
    let home = 0;
    let away = 0;
    const goals = [];
    for (const e of orderedEvents) {
      if (!isShot(e)) continue;
      const xg = num(e.EXPECTED_GOAL, 0);
      if (e.TEAM_ID === homeId) home += xg;
      else if (e.TEAM_ID === awayId) away += xg;
      else continue;
      const minute = timelineMinute(e);
      points.push({ minute, home: round(home, 3), away: round(away, 3) });
      if (isGoal(e)) {
        goals.push({
          minute,
          side: e.TEAM_ID === homeId ? "home" : "away",
          playerId: String(e.PLAYER_ID),
          xg: round(xg, 2),
          setPiece: setPieceOf(e),
        });
      }
    }
    return { points, goals, homeTotal: round(home, 2), awayTotal: round(away, 2) };
  }

  /*
   * Rolling 15-minute xG balance, used to name the phases where the match
   * actually turned rather than relying on the half-time split alone.
   */
  function pressurePhases(orderedEvents, homeId, awayId, windowMin = 15) {
    const buckets = [];
    for (let start = 0; start < 90; start += windowMin) {
      buckets.push({ from: start, to: start + windowMin, home: 0, away: 0, shots: 0 });
    }
    for (const e of orderedEvents) {
      if (!isShot(e)) continue;
      const minute = timelineMinute(e);
      const idx = Math.min(buckets.length - 1, Math.floor(minute / windowMin));
      const xg = num(e.EXPECTED_GOAL, 0);
      if (e.TEAM_ID === homeId) buckets[idx].home += xg;
      else if (e.TEAM_ID === awayId) buckets[idx].away += xg;
      buckets[idx].shots += 1;
    }
    for (const b of buckets) {
      b.home = round(b.home, 2);
      b.away = round(b.away, 2);
      b.diff = round(b.home - b.away, 2);
    }
    const bestHome = buckets.reduce((a, b) => (b.diff > a.diff ? b : a), buckets[0]);
    const bestAway = buckets.reduce((a, b) => (b.diff < a.diff ? b : a), buckets[0]);
    return { buckets, bestHome, bestAway };
  }

  /* ------------------------------------------------------------------ *
   * Player roles
   * ------------------------------------------------------------------ */

  /*
   * Role names are read relative to the team's own block, not to absolute
   * pitch coordinates. A striker in a side that camps on halfway sits at a
   * lower x than a striker in a deep block, yet plays the same role; the
   * reference points below keep the label tied to the player's job.
   */
  function roleLabel(node, stat, frame) {
    const { x, y, position } = node;
    if (position === "GK") return "골키퍼";
    const block = frame?.blockHeight ?? 50;
    const backLine = frame?.defLineX ?? 40;
    const rel = x - block;
    const wide = y < 25 || y > 75;
    const halfSpace = (y >= 25 && y < 37) || (y > 63 && y <= 75);
    const sideWord = y < 37 ? "왼쪽" : y > 63 ? "오른쪽" : "중앙";

    if (position === "DF") {
      if (wide) return x >= backLine + 6 ? `${sideWord} 오버래핑 풀백(공격형 풀백)` : `${sideWord} 풀백`;
      return x >= backLine + 5 ? "볼플레잉 센터백(전진형 센터백)" : "센터백";
    }
    if (position === "FW") {
      if (wide) return `${sideWord} 윙 포워드`;
      return x >= 70 || rel >= 5 ? "최전방 스트라이커" : "처진 스트라이커";
    }
    /* Midfielders are read by height within the block, then by channel. */
    if (rel <= -6) return stat.progressive >= 8 ? "딥라잉 플레이메이커(뒤에서 키패스하는 미드)" : "홀딩 미드필더(수비형 미드필더)";
    if (rel < 4) {
      if (wide) return `${sideWord} 미드필더`;
      return stat.defActions >= 12 ? "박스 투 박스(수비부터 공격까지 뛰는 미드)" : "중앙 미드필더";
    }
    if (wide) return stat.boxTouches >= 6 ? `${sideWord} 인사이드 윙어(안으로 접는 윙어)` : `${sideWord} 윙어`;
    if (halfSpace) return `${sideWord} 하프스페이스 공격형 미드(안쪽 공격형 미드)`;
    return "공격형 미드필더";
  }

  function playerProfiles(events, teamId, homeId, nodes, frame) {
    const stats = new Map();
    for (const n of nodes) {
      stats.set(n.playerId, {
        passes: 0,
        completed: 0,
        progressive: 0,
        keyPasses: 0,
        intoBox: 0,
        crosses: 0,
        shots: 0,
        xg: 0,
        goals: 0,
        defActions: 0,
        ballWon: 0,
        boxTouches: 0,
        finalThird: 0,
        touches: 0,
        losses: 0,
      });
    }

    for (const e of events) {
      if (e.TEAM_ID !== teamId) continue;
      const id = String(e.PLAYER_ID);
      const s = stats.get(id);
      if (!s) continue;
      /* The portal logs a goal kick twice: once as a bare GK row and once as
         the pass itself. Counting both would inflate keeper involvement. */
      if (Analyze.isGoalKick(e)) continue;
      const p = pov(e, teamId, homeId);
      s.touches += 1;
      if (p.x >= THIRDS[2].from) s.finalThird += 1;
      if (inBox(p.x, p.y)) s.boxTouches += 1;
      if (e.KEYPASS_YN_CD === "Y") s.keyPasses += 1;
      if (DEF_ACTION.includes(e.TYPE_DETAIL_CD)) s.defActions += 1;
      if (BALL_WON.includes(e.TYPE_DETAIL_CD)) s.ballWon += 1;

      if (isPass(e)) {
        s.passes += 1;
        if (isCompletedPass(e)) s.completed += 1;
        else s.losses += 1;
        if (p.ex !== null) {
          if (p.ex - p.x >= 12) s.progressive += 1;
          if (!inBox(p.x, p.y) && inBox(p.ex, p.ey)) {
            s.intoBox += 1;
            if ((p.y < BOX.yMin || p.y > BOX.yMax) && p.x >= 55) s.crosses += 1;
          }
        }
      }
      if (isShot(e)) {
        s.shots += 1;
        s.xg += num(e.EXPECTED_GOAL, 0);
        if (isGoal(e)) s.goals += 1;
      }
    }

    return nodes
      .map((n) => {
        const s = stats.get(n.playerId) || {};
        const stat = {
          ...s,
          xg: round(s.xg || 0, 2),
          accuracy: share(s.completed || 0, s.passes || 0),
        };
        return { ...n, stat, role: roleLabel(n, stat, frame) };
      })
      .sort((a, b) => b.stat.touches - a.stat.touches);
  }

  /* ------------------------------------------------------------------ *
   * Lane matchups
   * ------------------------------------------------------------------ */

  /*
   * Both teams are stored in their own attacking frame, so a lane on one side
   * physically faces its mirror image on the other: an attack down the right
   * arrives in the opponent's left channel.
   */
  const LANE_MIRROR = { lw: "rw", lh: "rh", c: "c", rh: "lh", rw: "lw" };

  function laneMatchups(home, away) {
    const homeAttack = home.progression.laneEntry;
    const awayAttack = away.progression.laneEntry;
    const homeDef = home.pressing.laneDef;
    const awayDef = away.pressing.laneDef;
    const homeAttackTotal = Object.values(homeAttack).reduce((s, v) => s + v, 0);
    const awayAttackTotal = Object.values(awayAttack).reduce((s, v) => s + v, 0);

    return LANES.map((lane) => {
      const mirror = LANE_MIRROR[lane.key];
      const mirrorLane = LANES.find((l) => l.key === mirror) || lane;
      const hAtk = homeAttack[lane.key] || 0;
      const aDef = awayDef[mirror] || 0;
      const aAtk = awayAttack[mirror] || 0;
      const hDef = homeDef[lane.key] || 0;
      return {
        lane,
        awayLane: mirrorLane,
        homeAttack: hAtk,
        homeAttackShare: share(hAtk, homeAttackTotal),
        awayDefend: aDef,
        /* Defensive interventions per attacking entry: low means the channel
         * was conceded, high means it was actively protected. */
        awayResistance: hAtk ? round(aDef / hAtk, 2) : null,
        awayAttack: aAtk,
        awayAttackShare: share(aAtk, awayAttackTotal),
        homeDefend: hDef,
        homeResistance: aAtk ? round(hDef / aAtk, 2) : null,
      };
    });
  }

  /* ------------------------------------------------------------------ *
   * Expert-layer metrics
   *
   * Built after both team objects exist so occupancy can be read against
   * the opponent's actual defensive line, not an absolute pitch mark.
   * ------------------------------------------------------------------ */

  function emptyScoreBucket() {
    return { passes: 0, progressive: 0, shots: 0, xg: 0, finalThird: 0 };
  }

  function emptyPeriodBucket() {
    return {
      progressive: 0,
      passes: 0,
      completed: 0,
      finalThird: 0,
      shots: 0,
      xg: 0,
      defXSum: 0,
      defXN: 0,
    };
  }

  function expertProfile(ordered, sequences, team, opp, homeId, extra) {
    const teamId = team.teamId;
    const oppId = opp.teamId;
    const lineup = extra?.lineup || null;
    const oppLine = 100 - (opp.shape?.defLineX || 40);
    const nodePos = new Map((team.shape?.nodes || []).map((n) => [String(n.playerId), n.position]));
    const byThird = {
      def: { passes: 0, completed: 0 },
      mid: { passes: 0, completed: 0 },
      att: { passes: 0, completed: 0 },
    };
    const died = { def: 0, mid: 0, att: 0 };
    const period = { 1: emptyPeriodBucket(), 2: emptyPeriodBucket() };
    const scoreAcc = {
      draw: emptyScoreBucket(),
      lead: emptyScoreBucket(),
      trail: emptyScoreBucket(),
    };
    const betweenByPlayer = new Map();
    const aerialByPlayer = new Map();
    const pressByPlayer = new Map();

    let betweenLine = 0;
    let cutbacks = 0;
    let highCrosses = 0;
    let lossesAtt = 0;
    let dxSum = 0;
    let dxN = 0;
    let gkDfPasses = 0;
    let completedAll = 0;
    let thirdMan = 0;
    let restLoss = 0;
    let restBreach = 0;
    let frontY = 0;
    let frontN = 0;
    let frontT = 0;
    let aerialWin = 0;
    let aerialLose = 0;
    let aerialDef = 0;
    let aerialAtt = 0;
    let groundWin = 0;
    let groundLose = 0;
    let pressOk = 0;
    let pressFail = 0;
    let pressHighOk = 0;
    let clearances = 0;
    let offsides = 0;
    let cards = 0;
    let dribbleOk = 0;
    let dribbleFail = 0;
    let shotOn = 0;
    let shotMiss = 0;
    let shotBlock = 0;
    let shotGoal = 0;
    let gkCatch = 0;
    let gkPunch = 0;
    let blocks = 0;
    const aerialMoments = [];

    let homeG = 0;
    let awayG = 0;

    function stateOf(tid) {
      const we = tid === homeId ? homeG : awayG;
      const they = tid === homeId ? awayG : homeG;
      if (we > they) return "lead";
      if (we < they) return "trail";
      return "draw";
    }

    for (let i = 0; i < ordered.length; i += 1) {
      const e = ordered[i];
      const pk = num(e.PERIOD_ID, 1) <= 1 ? 1 : 2;
      const st = stateOf(e.TEAM_ID);
      const p = pov(e, e.TEAM_ID, homeId);

      if (e.TEAM_ID === teamId) {
        const bucket = period[pk];
        const thirdKey = thirdOf(p.x).key;
        const touchLike = ["PS", "ST", "DU", "DF", "FO"].includes(e.TYPE_CD);
        if (touchLike && p.x >= THIRDS[2].from) {
          bucket.finalThird += 1;
          scoreAcc[st].finalThird += 1;
        }
        if (DEF_ACTION.includes(e.TYPE_DETAIL_CD)) {
          bucket.defXSum += p.x;
          bucket.defXN += 1;
        }
        if (isShot(e)) {
          const xg = num(e.EXPECTED_GOAL, 0);
          bucket.shots += 1;
          bucket.xg += xg;
          scoreAcc[st].shots += 1;
          scoreAcc[st].xg += xg;
        }
        if (isPass(e)) {
          byThird[thirdKey].passes += 1;
          bucket.passes += 1;
          scoreAcc[st].passes += 1;
          if (isCompletedPass(e)) {
            byThird[thirdKey].completed += 1;
            bucket.completed += 1;
            completedAll += 1;
            const pos = nodePos.get(String(e.PLAYER_ID));
            if (pos === "GK" || pos === "DF") gkDfPasses += 1;
            if (p.ex !== null) {
              const dx = p.ex - p.x;
              dxSum += dx;
              dxN += 1;
              if (dx >= 12) {
                bucket.progressive += 1;
                scoreAcc[st].progressive += 1;
              }
              const pocket =
                p.ex >= oppLine - 22 &&
                p.ex <= oppLine - 2 &&
                p.ey >= 22 &&
                p.ey <= 78;
              if (pocket) {
                betweenLine += 1;
                let recv = String(e.PLAYER_ID);
                const nxt = ordered[i + 1];
                if (
                  nxt &&
                  nxt.TEAM_ID === teamId &&
                  absSeconds(nxt) - absSeconds(e) <= RECEIVE_WINDOW_SEC
                ) {
                  recv = String(nxt.PLAYER_ID);
                }
                betweenByPlayer.set(recv, (betweenByPlayer.get(recv) || 0) + 1);
              }
              if (!inBox(p.x, p.y) && inBox(p.ex, p.ey)) {
                const fromWide = p.y < BOX.yMin || p.y > BOX.yMax;
                if (fromWide && p.x >= 55) {
                  if (p.ex >= 86 && p.ey >= 32 && p.ey <= 68) cutbacks += 1;
                  else highCrosses += 1;
                }
              }
            }
          } else if (p.x >= THIRDS[2].from) {
            lossesAtt += 1;
          }
        }

        const d = e.TYPE_DETAIL_CD;
        const pid = String(e.PLAYER_ID);
        if (isCompletedPass(e)) {
          const fp = e.FRONT_PASS_YN_CD;
          if (fp === "Y") frontY += 1;
          else if (fp === "N") frontN += 1;
          else if (fp === "T") frontT += 1;
        }
        if (d === "ADW" || d === "ADL") {
          if (d === "ADW") {
            aerialWin += 1;
            aerialByPlayer.set(pid, (aerialByPlayer.get(pid) || 0) + 1);
          } else aerialLose += 1;
          if (p.x < THIRDS[0].to) aerialDef += 1;
          if (p.x >= THIRDS[2].from) aerialAtt += 1;
          aerialMoments.push({ t: absSeconds(e), x: p.x, y: p.y, win: d === "ADW", playerId: pid });
        }
        if (d === "GDW") groundWin += 1;
        if (d === "GDL") groundLose += 1;
        if (d === "OPCS") {
          pressOk += 1;
          if (p.x >= 55) pressHighOk += 1;
          pressByPlayer.set(pid, (pressByPlayer.get(pid) || 0) + 1);
        }
        if (d === "OPCU") pressFail += 1;
        if (d === "CLG") clearances += 1;
        if (d === "OFS") offsides += 1;
        if (d === "YLC" || d === "RDC") cards += 1;
        if (d === "DS") dribbleOk += 1;
        if (d === "DU" && e.TYPE_CD === "DU") dribbleFail += 1;
        if (isShot(e)) {
          if (d === "GL") {
            shotGoal += 1;
            shotOn += 1;
          } else if (d === "AST") shotOn += 1;
          else if (d === "BT") shotBlock += 1;
          else if (d === "MST") shotMiss += 1;
        }
        if (d === "CT") gkCatch += 1;
        if (d === "PC") gkPunch += 1;
        if (d === "STB") blocks += 1;
      }

      if (isGoal(e)) {
        if (e.TEAM_ID === homeId) homeG += 1;
        else awayG += 1;
      }
    }

    for (let i = 0; i < ordered.length - 2; i += 1) {
      const a = ordered[i];
      if (a.TEAM_ID !== teamId || !isCompletedPass(a)) continue;
      const pa = pov(a, teamId, homeId);
      let hops = 0;
      let lastT = absSeconds(a);
      for (let j = i + 1; j < ordered.length && hops < 2; j += 1) {
        const b = ordered[j];
        const dt = absSeconds(b) - lastT;
        if (dt > RECEIVE_WINDOW_SEC) break;
        if (b.TEAM_ID !== teamId) continue;
        if (!isCompletedPass(b)) continue;
        const pb = pov(b, teamId, homeId);
        hops += 1;
        lastT = absSeconds(b);
        if (hops === 2) {
          const endX = pb.ex !== null ? pb.ex : pb.x;
          if (endX - pa.x >= 8) thirdMan += 1;
        }
      }
    }

    const mine = sequences.filter((s) => s.teamId === teamId);
    const oppSeq = sequences.filter((s) => s.teamId === oppId);
    let highRegain = 0;
    let highRegainShot = 0;
    for (let si = 0; si < mine.length; si += 1) {
      const seq = mine[si];
      if (seq.startX >= 60) {
        highRegain += 1;
        if (seq.shot) highRegainShot += 1;
      }
      const last = seq.events[seq.events.length - 1];
      if (!last) continue;
      const endX = pov(last, teamId, homeId).x;
      if (!seq.shot) died[thirdOf(endX).key] += 1;
      if (!seq.shot && endX >= 60) {
        restLoss += 1;
        const nextOpp = oppSeq.find((s) => s.startSec >= seq.endSec - 1);
        if (nextOpp && nextOpp.shot && nextOpp.timeToShot !== null && nextOpp.timeToShot <= 12) {
          restBreach += 1;
        }
      }
    }

    const le = team.progression?.laneEntry || {};
    const hs = (le.lh || 0) + (le.rh || 0);
    const wing = (le.lw || 0) + (le.rw || 0);
    const cen = le.c || 0;
    const attLaneN = hs + wing + cen;

    const outCount = new Map();
    for (const edge of team.network?.edges || []) {
      outCount.set(edge.from, (outCount.get(edge.from) || 0) + edge.count);
    }
    let hubId = null;
    let hubCount = 0;
    for (const [id, n] of outCount) {
      if (n > hubCount) {
        hubCount = n;
        hubId = id;
      }
    }
    const hubPlayer = (team.players || []).find((p) => String(p.playerId) === String(hubId)) || null;
    const betweenRank = [...betweenByPlayer.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, n]) => {
        const pl = (team.players || []).find((p) => String(p.playerId) === String(id));
        return { player: pl || null, count: n };
      });

    const thirdAcc = {};
    for (const key of ["def", "mid", "att"]) {
      thirdAcc[key] = {
        passes: byThird[key].passes,
        completed: byThird[key].completed,
        accuracy: share(byThird[key].completed, byThird[key].passes),
      };
    }

    for (const pk of [1, 2]) {
      const b = period[pk];
      b.xg = round(b.xg, 2);
      b.progressiveRate = share(b.progressive, b.passes);
      b.accuracy = share(b.completed, b.passes);
      b.defLineHeight = b.defXN ? round(b.defXSum / b.defXN, 1) : null;
    }

    for (const key of ["draw", "lead", "trail"]) {
      const b = scoreAcc[key];
      b.xg = round(b.xg, 2);
      b.progressiveRate = share(b.progressive, b.passes);
    }

    const diedN = died.def + died.mid + died.att;
    const aerialN = aerialWin + aerialLose;
    const groundN = groundWin + groundLose;
    const pressN = pressOk + pressFail;
    const frontNAll = frontY + frontN + frontT;
    const shotClassified = shotOn + shotMiss + shotBlock;

    let secondBall = 0;
    for (const a of aerialMoments) {
      for (const e of ordered) {
        if (e.TEAM_ID !== teamId) continue;
        const dt = absSeconds(e) - a.t;
        if (dt <= 0) continue;
        if (dt > 6) break;
        if (e.TYPE_DETAIL_CD === "RCV" || isCompletedPass(e)) {
          secondBall += 1;
          break;
        }
      }
    }

    let ck = 0;
    let ckShot = 0;
    let fk = 0;
    let fkShot = 0;
    for (let i = 0; i < ordered.length; i += 1) {
      const e = ordered[i];
      if (e.TEAM_ID !== teamId) continue;
      const sp = setPieceOf(e);
      if (sp !== "CK" && sp !== "FK") continue;
      if (sp === "CK") ck += 1;
      else fk += 1;
      const t0 = absSeconds(e);
      let hit = false;
      for (let j = i + 1; j < ordered.length; j += 1) {
        const n = ordered[j];
        if (absSeconds(n) - t0 > 12) break;
        if (n.TEAM_ID === teamId && isShot(n)) {
          hit = true;
          break;
        }
      }
      if (hit) {
        if (sp === "CK") ckShot += 1;
        else fkShot += 1;
      }
    }

    function windowStats(fromSec, toSec) {
      let passes = 0;
      let completed = 0;
      let y = 0;
      let shots = 0;
      let xg = 0;
      let finalThird = 0;
      let progressive = 0;
      for (const e of ordered) {
        const t = absSeconds(e);
        if (t < fromSec || t >= toSec) continue;
        if (e.TEAM_ID !== teamId) continue;
        const pv = pov(e, teamId, homeId);
        if (["PS", "ST", "DU"].includes(e.TYPE_CD) && pv.x >= THIRDS[2].from) finalThird += 1;
        if (isPass(e)) {
          passes += 1;
          if (isCompletedPass(e)) {
            completed += 1;
            if (e.FRONT_PASS_YN_CD === "Y") y += 1;
            if (pv.ex !== null && pv.ex - pv.x >= 12) progressive += 1;
          }
        }
        if (isShot(e)) {
          shots += 1;
          xg += num(e.EXPECTED_GOAL, 0);
        }
      }
      return {
        passes,
        completed,
        frontY: y,
        frontRate: share(y, completed),
        shots,
        xg: round(xg, 2),
        finalThird,
        progressive,
      };
    }

    function subAbsSec(s) {
      const periodNo = num(s.period, 1) <= 1 ? 1 : 2;
      const minute = num(s.minute, 0);
      const clock = periodNo === 1 ? minute : 45 + minute;
      return (periodNo - 1) * 6000 + clock * 60;
    }

    const teamSubs = (lineup?.subs || [])
      .filter((s) => String(s.team_id) === String(teamId))
      .slice()
      .sort((a, b) => subAbsSec(a) - subAbsSec(b));
    let subImpact = null;
    const pivot = teamSubs.find((s) => num(s.period, 1) > 1) || teamSubs[0] || null;
    if (pivot) {
      const t = subAbsSec(pivot);
      const before = windowStats(Math.max(0, t - 12 * 60), t);
      const after = windowStats(t, t + 12 * 60);
      if (before.passes + after.passes >= 12) {
        subImpact = {
          timeLabel: pivot.time_label || "",
          outName: pivot.player_out?.name || "",
          inName: pivot.player_in?.name || "",
          before,
          after,
        };
      }
    }

    function rankMap(map, n) {
      return [...map.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, n)
        .map(([id, count]) => {
          const pl = (team.players || []).find((p) => String(p.playerId) === String(id));
          return { player: pl || null, count };
        });
    }

    return {
      oppLine: round(oppLine, 1),
      thirdAccuracy: thirdAcc,
      betweenLine,
      betweenRank,
      cutbacks,
      highCrosses,
      lossesAtt,
      avgDx: dxN ? round(dxSum / dxN, 1) : 0,
      backShare: share(gkDfPasses, completedAll),
      thirdMan,
      occupancy: {
        halfSpace: hs,
        wing,
        central: cen,
        halfSpaceRate: share(hs, attLaneN),
        wingRate: share(wing, attLaneN),
        centralRate: share(cen, attLaneN),
      },
      died,
      diedRate: {
        def: share(died.def, diedN),
        mid: share(died.mid, diedN),
        att: share(died.att, diedN),
      },
      highRegain,
      highRegainShot,
      highRegainShotRate: share(highRegainShot, highRegain),
      restLoss,
      restBreach,
      restBreachRate: share(restBreach, restLoss),
      period,
      scoreState: scoreAcc,
      hub: hubPlayer
        ? { player: hubPlayer, count: hubCount, share: share(hubCount, team.network?.totalLinks || 0) }
        : null,
      xgOver: team.shooting?.xgOver ?? round((team.shooting?.goals || 0) - (team.shooting?.xg || 0), 2),
      front: {
        y: frontY,
        n: frontN,
        t: frontT,
        yRate: share(frontY, frontNAll),
        nRate: share(frontN, frontNAll),
        tRate: share(frontT, frontNAll),
      },
      aerial: {
        win: aerialWin,
        lose: aerialLose,
        total: aerialN,
        winRate: share(aerialWin, aerialN),
        def: aerialDef,
        att: aerialAtt,
        secondBall,
        top: rankMap(aerialByPlayer, 3),
      },
      ground: {
        win: groundWin,
        lose: groundLose,
        total: groundN,
        winRate: share(groundWin, groundN),
      },
      press: {
        ok: pressOk,
        fail: pressFail,
        total: pressN,
        successRate: share(pressOk, pressN),
        highOk: pressHighOk,
        top: rankMap(pressByPlayer, 3),
      },
      shots: {
        on: shotOn,
        miss: shotMiss,
        block: shotBlock,
        goal: shotGoal,
        onRate: share(shotOn, shotClassified),
        blockRate: share(shotBlock, shotClassified),
        missRate: share(shotMiss, shotClassified),
      },
      gk: { catch: gkCatch, punch: gkPunch, saves: gkCatch + gkPunch },
      clearances,
      offsides,
      cards,
      dribble: { ok: dribbleOk, fail: dribbleFail },
      blocks,
      setpiece: {
        corners: ck,
        cornerShots: ckShot,
        cornerRate: share(ckShot, ck),
        freeKicks: fk,
        fkShots: fkShot,
        fkRate: share(fkShot, fk),
      },
      subImpact,
    };
  }

  function analyzeTeam(ctxBase, side) {
    const { events, ordered, players, lineup, homeId, awayId } = ctxBase;
    const teamId = side === "home" ? homeId : awayId;
    const oppId = side === "home" ? awayId : homeId;
    const shape = teamShape(events, players, lineup, side, teamId, homeId);
    const frame = { blockHeight: shape.blockHeight, defLineX: shape.defLineX };
    return {
      side,
      teamId,
      shape,
      network: passNetwork(ordered, teamId, homeId, shape.nodes),
      players: playerProfiles(events, teamId, homeId, shape.nodes, frame),
      pressing: pressingProfile(events, teamId, oppId, homeId),
      progression: progressionProfile(events, teamId, homeId),
      sequences: sequenceProfile(ctxBase.sequences, teamId),
      zones: zoneGrid(events, teamId, homeId),
      setPieces: setPieceProfile(events, teamId),
      shooting: shotQuality(events, teamId, homeId),
    };
  }

  function officialMatrixStats(sideMatrix, players) {
    if (!sideMatrix || !Array.isArray(sideMatrix.edges) || !sideMatrix.edges.length) return null;
    const byName = new Map((players || []).map((p) => [p.name, p]));
    let total = 0;
    const outCount = new Map();
    let top = null;
    for (const e of sideMatrix.edges) {
      const n = Number(e.count) || 0;
      if (n <= 0) continue;
      total += n;
      outCount.set(e.from, (outCount.get(e.from) || 0) + n);
      if (!top || n > top.count) top = { ...e, count: n };
    }
    let hubName = null;
    let hubCount = 0;
    for (const [name, n] of outCount) {
      if (n > hubCount) {
        hubName = name;
        hubCount = n;
      }
    }
    const hubPlayer = byName.get(hubName) || (hubName ? { name: hubName, backNo: "-", role: "" } : null);
    return {
      total,
      hub: hubPlayer
        ? { player: hubPlayer, count: hubCount, share: share(hubCount, total) }
        : null,
      topPair: top
        ? {
            a: byName.get(top.from) || { name: top.from, backNo: top.from_back || "-", role: "" },
            b: byName.get(top.to) || { name: top.to, backNo: "-", role: "" },
            count: top.count,
          }
        : null,
    };
  }

  function analyze(meta, events, players, lineup, passMatrix) {
    if (!meta || !Array.isArray(events) || !events.length) {
      throw new Error("전술 분석에 필요한 이벤트 데이터가 없습니다.");
    }
    const homeId = meta.home?.team_id;
    const awayId = meta.away?.team_id;
    if (!homeId || !awayId) {
      throw new Error("팀 ID가 없어 전술 분석을 만들 수 없습니다.");
    }

    const ordered = chrono(events);
    const sequences = possessionSequences(ordered, homeId);
    const base = { events, ordered, players, lineup, homeId, awayId, sequences };

    const home = analyzeTeam(base, "home");
    const away = analyzeTeam(base, "away");
    try {
      home.expert = expertProfile(ordered, sequences, home, away, homeId, { lineup });
      away.expert = expertProfile(ordered, sequences, away, home, homeId, { lineup });
      const hOff = officialMatrixStats(passMatrix?.home, home.players);
      const aOff = officialMatrixStats(passMatrix?.away, away.players);
      if (home.expert && hOff) home.expert.official = hOff;
      if (away.expert && aOff) away.expert.official = aOff;
    } catch (err) {
      console.error("[Tactics] expert profile failed:", err);
      home.expert = null;
      away.expert = null;
    }

    return {
      meta,
      homeId,
      awayId,
      homeName: meta.home?.name || "홈",
      awayName: meta.away?.name || "원정",
      home,
      away,
      tilt: fieldTilt(events, homeId, awayId),
      momentum: momentumSeries(ordered, homeId, awayId),
      phases: pressurePhases(ordered, homeId, awayId),
      matchups: laneMatchups(home, away),
      lanes: LANES,
      thirds: THIRDS,
    };
  }

  return {
    LANES,
    THIRDS,
    analyze,
    chrono,
    pov,
    absSeconds,
    laneOf,
    thirdOf,
    inBox,
    inZone14,
  };
})();

window.Tactics = Tactics;
