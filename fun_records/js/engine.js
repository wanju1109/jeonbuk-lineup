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

  function winStreaks(rows, minLen) {
    const out = [];
    let i = 0;
    while (i < rows.length) {
      if (rows[i].result !== "W") {
        i += 1;
        continue;
      }
      let j = i;
      while (j < rows.length && rows[j].result === "W") j += 1;
      const length = j - i;
      if (length >= minLen) out.push({ start: rows[i], end: rows[j - 1], length });
      i = j;
    }
    return out;
  }

  function gamesBetween(rows, afterDate, untilDate) {
    let started = false;
    let n = 0;
    for (const m of rows) {
      if (m.date === afterDate) {
        started = true;
        continue;
      }
      if (!started) continue;
      if (untilDate && m.date === untilDate) break;
      n += 1;
    }
    return n;
  }

  function quirkFacts(rows) {
    const out = [];
    if (rows.length < 10) return out;
    const asOf = rows[rows.length - 1].date;

    for (const minLen of [2, 3, 4]) {
      const streaks = winStreaks(rows, minLen);
      if (!streaks.length) continue;
      const label = `${minLen}연승`;
      let cur = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].result === "W") cur += 1;
        else break;
      }
      const last = streaks[streaks.length - 1];
      if (cur >= minLen && streaks.length >= 2) {
        const prev = streaks[streaks.length - 2];
        const gapDays = daysBetween(prev.end.date, last.start.date);
        const gapGames = gamesBetween(rows, prev.end.date, last.start.date);
        if (gapDays != null && gapDays >= 30) {
          out.push(
            fact(
              `streak_gap_${minLen}`,
              "잡학",
              `${label} 공백`,
              `${prev.end.date}에 ${prev.length}연승이 끝난 뒤, 다음 ${label}까지 ${gapDays}일·${gapGames}경기가 걸렸습니다.`,
              `공백 종료: ${last.start.date}부터 ${last.length}연승 (~${last.end.date}, vs ${last.end.opponent})`,
              asOf,
              ["연승", "공백"],
              96
            )
          );
        }
      } else if (cur < minLen) {
        const gapDays = daysBetween(last.end.date, asOf);
        const gapGames = gamesBetween(rows, last.end.date, null);
        if (gapDays != null && gapDays >= 14) {
          out.push(
            fact(
              `streak_drought_${minLen}`,
              "잡학",
              `${label} 가뭄`,
              `${last.end.date} 이후 ${label}이 없습니다. 벌써 ${gapDays}일·${gapGames}경기째.`,
              `그날 ${last.length}연승이 끝났습니다 (vs ${last.end.opponent}, ${last.end.hs}:${last.end.as}).`,
              asOf,
              ["연승", "가뭄"],
              97
            )
          );
        }
      }
    }

    const wins = rows.filter((m) => m.result === "W");
    if (wins.length >= 2) {
      let best = null;
      for (let i = 0; i < wins.length - 1; i++) {
        const d = daysBetween(wins[i].date, wins[i + 1].date);
        if (d == null) continue;
        if (!best || d > best.d) best = { d, a: wins[i], b: wins[i + 1] };
      }
      if (best && best.d >= 60) {
        out.push(
          fact(
            "longest_win_wait",
            "잡학",
            "가장 길었던 승리 공백",
            `승리와 승리 사이 최장 간격은 ${best.d}일 — ${best.a.date} vs ${best.a.opponent} 다음이 ${best.b.date} vs ${best.b.opponent}.`,
            "",
            asOf,
            ["승리", "공백"],
            88
          )
        );
      }
    }

    const byMd = new Map();
    for (const m of rows) {
      const md = String(m.date || "").slice(5, 10);
      if (md.length !== 5) continue;
      if (!byMd.has(md)) byMd.set(md, []);
      byMd.get(md).push(m);
    }
    let calendarDone = false;
    const mdEntries = [...byMd.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [md, lst] of mdEntries) {
      if (lst.length < 3 || calendarDone) break;
      const results = lst.map((x) => x.result);
      const draws = results.filter((r) => r === "D").length;
      if (draws >= 2 && new Set(results).size <= 2) {
        const [month, day] = md.split("-").map(Number);
        out.push(
          fact(
            `calendar_${md}`,
            "잡학",
            `${month}월 ${day}일의 저주?`,
            `${month}월 ${day}일 전북 경기는 지금까지 ${lst.length}번 — 무승부 ${draws}·승 ${results.filter((r) => r === "W").length}·패 ${results.filter((r) => r === "L").length}.`,
            lst.map((x) => `${x.date} ${x.result}(${x.hs}:${x.as})`).join(", "),
            asOf,
            ["기념일", "캘린더"],
            93
          )
        );
        calendarDone = true;
      }
    }
    const may5 = byMd.get("05-05") || [];
    if (may5.length >= 2) {
      out.push(
        fact(
          "calendar_05_05",
          "잡학",
          "5월 5일 전북",
          `어린이날(5/5) 전북 경기는 ${may5.length}번: ` + may5.map((x) => `${x.year} ${x.result}`).join(" / ") + ".",
          may5.map((x) => `${x.date} ${x.result}(${x.hs}:${x.as}) vs ${x.opponent}`).join(", "),
          asOf,
          ["5월5일", "캘린더"],
          94
        )
      );
    }

    const scoreC = new Map();
    for (const m of rows) {
      const sc = `${m.hs}:${m.as}`;
      scoreC.set(sc, (scoreC.get(sc) || 0) + 1);
    }
    const scoreRank = [...scoreC.entries()].sort((a, b) => b[1] - a[1]);
    if (scoreRank.length) {
      const [sc, n] = scoreRank[0];
      const pct = Math.round((1000 * n) / rows.length) / 10;
      out.push(
        fact(
          "favorite_score",
          "잡학",
          "가장 자주 나온 스코어",
          `2020년 이후 가장 흔한 스코어는 ${sc} — ${n}번(${pct}%).`,
          scoreRank.slice(0, 3).map(([s, c]) => `${s} ${c}회`).join(" · "),
          asOf,
          ["스코어"],
          72
        )
      );
    }

    const opps = [...new Set(rows.map((m) => m.opponent).filter(Boolean))].sort();
    for (const opp of opps) {
      const away = rows.filter((m) => m.opponent === opp && m.ha === "A");
      if (away.length >= 2 && away.every((m) => m.result !== "W")) {
        const last = away[away.length - 1];
        out.push(
          fact(
            `never_away_win_${opp}`,
            "잡학",
            `${opp} 원정 무승`,
            `2020년 이후 ${opp} 원정에서 아직 이겨 본 적이 없습니다 (${away.length}경기).`,
            `최근: ${last.date} ${last.result} ${last.hs}:${last.as}`,
            asOf,
            ["원정", opp],
            91
          )
        );
      }
    }

    const years = [...new Set(rows.map((m) => String(m.year)).filter(Boolean))].sort();
    const firstBits = [];
    for (const y of years.slice(-4)) {
      const fw = rows.find((m) => String(m.year) === y && m.result === "W");
      if (fw) firstBits.push(`${y} ${fw.date.slice(5)} vs ${fw.opponent}`);
    }
    if (firstBits.length) {
      out.push(
        fact(
          "season_first_wins",
          "잡학",
          "시즌 첫 승 달력",
          "최근 시즌 첫 승: " + firstBits.join(" · ") + ".",
          "",
          asOf,
          ["시즌", "첫승"],
          70
        )
      );
    }

    let bestBlank = [];
    let curBlank = [];
    for (const m of rows) {
      if (Number(m.gf || 0) === 0) curBlank.push(m);
      else {
        if (curBlank.length > bestBlank.length) bestBlank = curBlank.slice();
        curBlank = [];
      }
    }
    if (curBlank.length > bestBlank.length) bestBlank = curBlank.slice();
    if (bestBlank.length >= 2) {
      out.push(
        fact(
          "worst_blank",
          "잡학",
          "최장 무득점 행진",
          `최장 무득점은 ${bestBlank.length}경기 (${bestBlank[0].date}~${bestBlank[bestBlank.length - 1].date}).`,
          bestBlank.map((m) => `${m.date} vs ${m.opponent} ${m.hs}:${m.as}`).join(" → "),
          asOf,
          ["무득점"],
          82
        )
      );
    }
    curBlank = [];
    for (let i = rows.length - 1; i >= 0; i--) {
      if (Number(rows[i].gf || 0) === 0) curBlank.push(rows[i]);
      else break;
    }
    if (curBlank.length >= 2) {
      out.push(
        fact(
          "current_blank",
          "잡학",
          "지금 무득점 중?",
          `최근 ${curBlank.length}경기 연속 무득점입니다.`,
          "",
          asOf,
          ["무득점"],
          86
        )
      );
    }

    const wRows = rows.filter((m) => m.result === "W");
    if (wRows.length) {
      const one = wRows.filter((m) => Math.abs(Number(m.gf || 0) - Number(m.ga || 0)) === 1);
      const pct = Math.round((1000 * one.length) / wRows.length) / 10;
      out.push(
        fact(
          "one_goal_wins",
          "잡학",
          "1골 차 승리 비중",
          `승리 ${wRows.length}경기 중 1골 차 승리가 ${one.length}번(${pct}%).`,
          one.length
            ? `최근 1골 차 승: ${one[one.length - 1].date} vs ${one[one.length - 1].opponent} (${one[one.length - 1].hs}:${one[one.length - 1].as})`
            : "",
          asOf,
          ["승리"],
          74
        )
      );
    }

    const btts = rows.filter((m) => Number(m.gf || 0) > 0 && Number(m.ga || 0) > 0);
    out.push(
      fact(
        "btts_rate",
        "잡학",
        "양팀 득점(BTTS)",
        `양 팀이 모두 득점한 경기는 ${btts.length}/${rows.length} (${Math.round((1000 * btts.length) / rows.length) / 10}%).`,
        "",
        asOf,
        ["BTTS"],
        66
      )
    );

    let lastBig = null;
    for (const m of rows) {
      if (Number(m.gf || 0) >= 3) lastBig = m;
    }
    if (lastBig) {
      const d = daysBetween(lastBig.date, asOf);
      const gamesSince = gamesBetween(rows, lastBig.date, null);
      if (d != null && d >= 20 && gamesSince >= 3) {
        out.push(
          fact(
            "big_win_drought",
            "잡학",
            "대량득점 가뭄",
            `3골 이상 넣은 경기가 ${lastBig.date} 이후 ${d}일·${gamesSince}경기째 없습니다.`,
            `그날 vs ${lastBig.opponent} ${lastBig.hs}:${lastBig.as} (${lastBig.gf}골)`,
            asOf,
            ["득점", "가뭄"],
            84
          )
        );
      }
    }

    let bestD = [];
    let curD = [];
    for (const m of rows) {
      if (m.result === "D") curD.push(m);
      else {
        if (curD.length > bestD.length) bestD = curD.slice();
        curD = [];
      }
    }
    if (curD.length > bestD.length) bestD = curD.slice();
    if (bestD.length >= 3) {
      out.push(
        fact(
          "draw_cluster",
          "잡학",
          "무승부 클러스터",
          `최장 연속 무는 ${bestD.length}경기 (${bestD[0].date}~${bestD[bestD.length - 1].date}).`,
          "",
          asOf,
          ["무승부"],
          78
        )
      );
    }

    const weekend = [];
    const weekday = [];
    for (const m of rows) {
      const dt = parseDate(m.date);
      if (!dt) continue;
      (dt.getDay() === 0 || dt.getDay() === 6 ? weekend : weekday).push(m);
    }
    if (weekend.length >= 20 && weekday.length >= 15) {
      const wp = Math.round((1000 * weekend.filter((m) => m.result === "W").length) / weekend.length) / 10;
      const dp = Math.round((1000 * weekday.filter((m) => m.result === "W").length) / weekday.length) / 10;
      const better = wp >= dp ? "주말" : "평일";
      out.push(
        fact(
          "weekend_weekday",
          "잡학",
          "주말 vs 평일",
          `주말 승률 ${wp}%(${weekend.length}경기), 평일 승률 ${dp}%(${weekday.length}경기) — ${better}에 더 강했습니다.`,
          "",
          asOf,
          ["주말", "평일"],
          69
        )
      );
    }

    const byOpp = new Map();
    for (const m of rows) {
      if (!m.opponent) continue;
      if (!byOpp.has(m.opponent)) byOpp.set(m.opponent, []);
      byOpp.get(m.opponent).push(m);
    }
    for (const [opp, lst] of byOpp) {
      if (lst.length < 3) continue;
      const tail = lst.slice(-3);
      if (new Set(tail.map((m) => m.result)).size === 1) {
        const res = tail[0].result;
        const label = { W: "승리", D: "무승부", L: "패배" }[res] || res;
        out.push(
          fact(
            `opp_same3_${opp}_${res}`,
            "잡학",
            `${opp}전 최근 3연속 ${label}`,
            `${opp} 상대 최근 3경기가 모두 ${label}입니다.`,
            tail.map((m) => `${m.date} ${m.hs}:${m.as} (${m.ha === "H" ? "홈" : "원정"})`).join(" · "),
            asOf,
            [opp, "연속"],
            87
          )
        );
      }
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
      ...quirkFacts(rows),
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
