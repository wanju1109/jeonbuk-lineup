(() => {
  const CURATED = [
    {
      id: "seed_foreign_winger_italo",
      category: "득점",
      title: "외국인 윙어 리그 득점",
      template: "전북현대 리그 {days}일 만에 외국인 윙어 득점",
      detail: "2026-09-09 강원전 이탈로. 직전 마지막 골은 2024년 9월 14일 vs FC수원전 에르난데스",
      anchor_date: "2024-09-14",
      event_date: "2026-09-09",
      tags: ["외국인", "윙어", "득점", "이탈로"],
      priority: 100,
    },
  ];

  function parseDate(s) {
    if (!s) return null;
    const d = new Date(`${String(s).slice(0, 10)}T12:00:00+09:00`);
    return Number.isFinite(d.getTime()) ? d : null;
  }

  function daysBetween(a, b) {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return null;
    return Math.round(Math.abs(db - da) / 86400000);
  }

  function finished(matches) {
    return (matches || []).filter((m) => ["W", "D", "L"].includes(m.result) && m.date);
  }

  function fact(id, category, title, text, detail, asOf, tags, priority) {
    return {
      id,
      category,
      title,
      text,
      detail: detail || "",
      as_of: asOf || "",
      tags: tags || [],
      priority: priority ?? 50,
    };
  }

  function streakFacts(rows) {
    const out = [];
    if (!rows.length) return out;
    const last = rows[rows.length - 1].result;
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].result !== last) break;
      n += 1;
    }
    const label = { W: "연승", D: "연무", L: "연패" }[last];
    const m = rows[rows.length - 1];
    out.push(
      fact(
        "streak_current",
        "흐름",
        `현재 ${label}`,
        `전북은 현재 ${n}경기 ${label} 흐름입니다.`,
        `기준 경기: ${m.date} vs ${m.opponent} (${m.hs}:${m.as})`,
        m.date,
        ["연승", "연패", "연무"],
        90
      )
    );

    let best = 0;
    let cur = 0;
    let bestEnd = null;
    for (const row of rows) {
      if (row.result === "W") {
        cur += 1;
        if (cur > best) {
          best = cur;
          bestEnd = row;
        }
      } else cur = 0;
    }
    if (best >= 3 && bestEnd) {
      out.push(
        fact(
          "streak_longest_w",
          "흐름",
          "최장 연승",
          `2020년 이후 최장 연승은 ${best}연승입니다.`,
          `해당 구간의 끝: ${bestEnd.date} vs ${bestEnd.opponent}`,
          bestEnd.date,
          ["연승"],
          70
        )
      );
    }
    return out;
  }

  function lastMatchFact(rows, pred, id, title, how, asOf) {
    const hits = rows.filter(pred);
    if (!hits.length) {
      return fact(
        `never_${id}`,
        "맞대결",
        title,
        `2020년 이후 기록상 ${how}가 한 번도 없습니다.`,
        "",
        asOf,
        ["맞대결"],
        80
      );
    }
    const last = hits[hits.length - 1];
    const d = daysBetween(last.date, asOf || last.date);
    const gap = d != null && asOf ? ` (${d}일 전)` : "";
    return fact(
      `last_${id}`,
      "맞대결",
      title,
      `마지막으로 ${how}은 ${last.date} vs ${last.opponent} (${last.hs}:${last.as})${gap}.`,
      `${last.year}시즌 ${last.round}R · ${last.ha === "H" ? "홈" : "원정"}`,
      asOf || last.date,
      ["맞대결", last.opponent || ""],
      85
    );
  }

  function venueFacts(rows) {
    const out = [];
    const asOf = rows.length ? rows[rows.length - 1].date : "";
    const opponents = [...new Set(rows.map((m) => m.opponent).filter(Boolean))].sort();
    for (const opp of opponents) {
      out.push(
        lastMatchFact(
          rows,
          (m) => m.opponent === opp && m.ha === "A" && m.result === "L",
          `away_loss_${opp}`,
          `${opp} 원정 패배`,
          `${opp} 원정에서 패한 것`,
          asOf
        )
      );
      out.push(
        lastMatchFact(
          rows,
          (m) => m.opponent === opp && m.ha === "A" && m.result === "W",
          `away_win_${opp}`,
          `${opp} 원정 승리`,
          `${opp} 원정에서 이긴 것`,
          asOf
        )
      );
      out.push(
        lastMatchFact(
          rows,
          (m) => m.opponent === opp && m.ha === "H" && m.result === "L",
          `home_loss_${opp}`,
          `${opp} 상대 홈 패배`,
          `홈에서 ${opp}에게 패한 것`,
          asOf
        )
      );
    }

    const seoulAwayL = rows.filter((m) => m.opponent === "서울" && m.ha === "A" && m.result === "L");
    if (seoulAwayL.length && asOf) {
      const last = seoulAwayL[seoulAwayL.length - 1];
      const d = daysBetween(last.date, asOf);
      const years = d != null ? Math.round((d / 365.25) * 10) / 10 : null;
      let title = "서울 원정 마지막 패배";
      let text = `서울 원정 마지막 패배는 ${last.date} (${last.hs}:${last.as})` + (d != null ? `, ${d}일 전입니다.` : "입니다.");
      if (d != null && d >= 365) {
        title = "서울 원정 무패 기간";
        text = `서울 원정에서 마지막으로 패한 지 약 ${years}년(${d}일)입니다. 그날은 ${last.date}.`;
      }
      out.push(
        fact(
          "seoul_away_loss_gap",
          "맞대결",
          title,
          text,
          `직전 패: ${last.date} 서울 vs 전북 ${last.hs}:${last.as}`,
          asOf,
          ["서울", "원정"],
          95
        )
      );
    }
    return out;
  }

  function scoreFacts(rows) {
    const out = [];
    if (!rows.length) return out;
    const asOf = rows[rows.length - 1].date;
    let n = 0;
    for (let i = rows.length - 1; i >= 0; i--) {
      if (Number(rows[i].ga || 0) === 0) n += 1;
      else break;
    }
    if (n >= 1) {
      out.push(
        fact(
          "cs_streak",
          "수비",
          "무실점 행진",
          n > 1 ? `최근 ${n}경기 연속 무실점입니다.` : "직전 경기에서 무실점을 기록했습니다.",
          "",
          asOf,
          ["무실점"],
          75
        )
      );
    }

    const best = rows.reduce((a, b) => (Number(a.gf || 0) >= Number(b.gf || 0) ? a : b));
    if (Number(best.gf || 0) >= 4) {
      out.push(
        fact(
          "most_goals_game",
          "득점",
          "한 경기 최다골",
          `2020년 이후 한 경기 최다골은 ${best.date} vs ${best.opponent} ${best.gf}골입니다.`,
          `스코어 ${best.hs}:${best.as}`,
          best.date,
          ["득점"],
          65
        )
      );
    }

    const diff = (m) => Number(m.gf || 0) - Number(m.ga || 0);
    const bestDiff = rows.reduce((a, b) => (diff(a) >= diff(b) ? a : b));
    const worstDiff = rows.reduce((a, b) => (diff(a) <= diff(b) ? a : b));
    if (diff(bestDiff) >= 3) {
      out.push(
        fact(
          "biggest_win",
          "스코어",
          "최다 득실차 승리",
          `가장 큰 승리는 ${bestDiff.date} vs ${bestDiff.opponent} (${bestDiff.hs}:${bestDiff.as}, +${diff(bestDiff)}).`,
          "",
          bestDiff.date,
          ["승리"],
          68
        )
      );
    }
    if (diff(worstDiff) <= -3) {
      out.push(
        fact(
          "biggest_loss",
          "스코어",
          "최다 실점차 패배",
          `가장 큰 패배는 ${worstDiff.date} vs ${worstDiff.opponent} (${worstDiff.hs}:${worstDiff.as}, ${diff(worstDiff)}).`,
          "",
          worstDiff.date,
          ["패배"],
          60
        )
      );
    }

    for (const [label, subset] of [
      ["홈", rows.filter((m) => m.ha === "H")],
      ["원정", rows.filter((m) => m.ha === "A")],
    ]) {
      if (!subset.length) continue;
      const w = subset.filter((m) => m.result === "W").length;
      const d = subset.filter((m) => m.result === "D").length;
      const l = subset.filter((m) => m.result === "L").length;
      out.push(
        fact(
          `record_${label}`,
          "시즌누적",
          `${label} 전적 (2020~)`,
          `${label} ${subset.length}경기 ${w}승 ${d}무 ${l}패.`,
          "",
          asOf,
          [label],
          55
        )
      );
    }
    return out;
  }

  function goalFacts(rows) {
    const out = [];
    const goals = [];
    for (const m of rows) {
      for (const g of m.goals || []) {
        goals.push({ ...g, date: m.date, opponent: m.opponent, year: m.year });
      }
    }
    if (!goals.length) return out;
    const asOf = rows[rows.length - 1].date;

    const foreign = goals.filter((g) => g.foreign);
    if (foreign.length) {
      const last = foreign[foreign.length - 1];
      const prev = foreign.length >= 2 ? foreign[foreign.length - 2] : null;
      let detail = "";
      if (prev) {
        const d = daysBetween(prev.date, last.date);
        detail = `그 전 외국인 골은 ${prev.date} ${prev.name}` + (d != null ? ` · 간격 ${d}일` : "");
      }
      out.push(
        fact(
          "last_foreign_goal",
          "득점",
          "외국인 선수 득점",
          `최근 외국인 득점은 ${last.date} ${last.name} (vs ${last.opponent}).`,
          detail,
          asOf,
          ["외국인", "득점"],
          92
        )
      );
    }

    const wingGoals = goals.filter((g) => g.winger);
    if (wingGoals.length) {
      const last = wingGoals[wingGoals.length - 1];
      const prev = wingGoals.length >= 2 ? wingGoals[wingGoals.length - 2] : null;
      let detail = "";
      if (prev) {
        const d = daysBetween(prev.date, last.date);
        detail = `직전은 ${prev.date} ${prev.name}` + (d != null ? ` · ${d}일 만` : "");
      }
      out.push(
        fact(
          "last_foreign_winger_goal",
          "득점",
          "외국인 윙어 득점",
          `외국인 윙어 최근 골: ${last.date} ${last.name} vs ${last.opponent}.`,
          detail,
          asOf,
          ["외국인", "윙어"],
          98
        )
      );
    }

    const counts = new Map();
    for (const g of goals) {
      if (!g.name) continue;
      counts.set(g.name, (counts.get(g.name) || 0) + 1);
    }
    let topName = "";
    let topN = 0;
    for (const [name, n] of counts) {
      if (n > topN) {
        topName = name;
        topN = n;
      }
    }
    if (topName) {
      out.push(
        fact(
          "top_scorer_sample",
          "득점",
          "칠판 기준 최다골",
          `가용 칠판 데이터 기준 최다골은 ${topName} ${topN}골입니다.`,
          "칠판이 있는 경기에 한정된 샘플 기록입니다.",
          asOf,
          ["득점"],
          50
        )
      );
    }
    return out;
  }

  function miscFacts(rows) {
    const out = [];
    if (rows.length < 5) return out;
    const asOf = rows[rows.length - 1].date;
    const firstW = rows.find((m) => m.result === "W");
    if (firstW) {
      out.push(
        fact(
          "first_win_window",
          "타임라인",
          "집계 구간 첫 승",
          `집계 시작 후 첫 승리는 ${firstW.date} vs ${firstW.opponent} (${firstW.hs}:${firstW.as}).`,
          "",
          firstW.date,
          ["타임라인"],
          40
        )
      );
    }
    const draws = rows.filter((m) => m.result === "D");
    out.push(
      fact(
        "draw_count",
        "시즌누적",
        "무승부 횟수",
        `2020년 이후 무승부는 ${draws.length}경기입니다.`,
        "",
        asOf,
        ["무승부"],
        45
      )
    );
    const zo = rows.filter((m) => Number(m.gf || 0) === 0 && Number(m.ga || 0) === 0);
    if (zo.length) {
      const last = zo[zo.length - 1];
      out.push(
        fact(
          "last_0_0",
          "스코어",
          "마지막 0-0",
          `마지막 0-0은 ${last.date} vs ${last.opponent}.`,
          "",
          asOf,
          ["0-0"],
          58
        )
      );
    }
    const withAtt = rows.filter((m) => Number(m.attendance) > 0);
    if (withAtt.length) {
      const top = withAtt.reduce((a, b) => (Number(a.attendance) >= Number(b.attendance) ? a : b));
      out.push(
        fact(
          "max_attendance",
          "관중",
          "최다 관중",
          `집계된 경기 중 최다 관중은 ${top.date} vs ${top.opponent} ${Number(top.attendance).toLocaleString()}명.`,
          top.venue || "",
          top.date,
          ["관중"],
          48
        )
      );
    }
    return out;
  }

  function curatedFacts(asOf) {
    return CURATED.map((c) => {
      const event = c.event_date || asOf;
      const d = daysBetween(c.anchor_date, event);
      const text = String(c.template || "").replace("{days}", d != null ? String(d) : "?");
      return fact(c.id, c.category, c.title, text, c.detail, event, c.tags, c.priority);
    });
  }

  function mulberry32(a) {
    return function () {
      let t = (a += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function buildRecords(history, seed) {
    const rows = finished(history?.matches || []);
    const asOf = rows.length ? rows[rows.length - 1].date : new Date().toISOString().slice(0, 10);
    const facts = [
      ...curatedFacts(asOf),
      ...streakFacts(rows),
      ...venueFacts(rows),
      ...scoreFacts(rows),
      ...goalFacts(rows),
      ...miscFacts(rows),
    ];
    const seen = new Set();
    const uniq = [];
    for (const f of facts) {
      if (seen.has(f.id)) continue;
      seen.add(f.id);
      uniq.push(f);
    }
    const rnd = mulberry32(Number(seed) || Date.now());
    uniq.sort((a, b) => b.priority - a.priority || rnd() - 0.5);
    return {
      generated_at: new Date().toISOString(),
      as_of: asOf,
      seed,
      history_matches: rows.length,
      records_n: uniq.length,
      records: uniq,
    };
  }

  window.FunRecordsEngine = { buildRecords, daysBetween, finished };
})();
