/**
 * Official K League record helpers, plus a published index.
 * Index uses only apps / goals / assists (GK: conceded / clean sheets).
 * No invented FM 1-20, CA, or PA.
 */
const PlayerEngine = (() => {
  const YEAR = 2026;

  const CURATED_YEARS = {
    "20180025": {
      "2022":
        "시즌이 끝난 뒤 FA로 J리그 쇼난 벨마레에 갔다. K리그 공식 표가 2023–24에 비는 이유다.",
      "2025": "쇼난 벨마레 2년 뒤 전북 복귀. 군 복무가 아니라 J리그였다.",
    },
  };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function jong(word) {
    const s = String(word || "");
    const code = s.charCodeAt(s.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return 0;
    return (code - 0xac00) % 28;
  }

  function eunNeun(name) {
    return String(name) + (jong(name) ? "은" : "는");
  }

  function isGk(p) {
    return String(p?.position || "").toUpperCase() === "GK";
  }

  function seasonRows(p) {
    return (p?.seasons || [])
      .filter((s) => String(s.season || "").match(/^\d{4}$/))
      .sort((a, b) => Number(a.season) - Number(b.season));
  }

  function triple(s, gk) {
    if (!s) return { apps: 0, a: 0, b: 0 };
    const tot = s.total || {};
    if (gk) {
      return {
        apps: num(s.total_apps ?? tot.apps),
        a: num(s.total_gc ?? tot.goals_conceded),
        b: num(s.total_cs ?? tot.clean_sheets),
      };
    }
    return {
      apps: num(s.total_apps ?? tot.apps),
      a: num(s.total_goals ?? tot.goals),
      b: num(s.total_assists ?? tot.assists),
    };
  }

  function addTriple(dst, src) {
    dst.apps += src.apps;
    dst.a += src.a;
    dst.b += src.b;
    return dst;
  }

  function mergedByYear(p) {
    const gk = isGk(p);
    const map = new Map();
    seasonRows(p).forEach((row) => {
      const y = String(row.season);
      const t = triple(row, gk);
      const prev = map.get(y);
      if (!prev) {
        map.set(y, {
          season: y,
          team: row.team || "",
          apps: t.apps,
          a: t.a,
          b: t.b,
          teams: [row.team].filter(Boolean),
        });
        return;
      }
      addTriple(prev, t);
      if (row.team && prev.teams.indexOf(row.team) < 0) prev.teams.push(row.team);
      prev.team = prev.teams.join(" → ");
    });
    return Array.from(map.values()).sort((a, b) => Number(a.season) - Number(b.season));
  }

  function yearMerged(p, year) {
    return mergedByYear(p).find((s) => Number(s.season) === Number(year)) || null;
  }

  function career(p) {
    const gk = isGk(p);
    const tot = p?.summary?.total || {};
    if (gk) {
      return {
        apps: num(tot.apps),
        a: num(tot.goals_conceded),
        b: num(tot.clean_sheets),
      };
    }
    return { apps: num(tot.apps), a: num(tot.goals), b: num(tot.assists) };
  }

  function roleFromApps(apps, yearLen) {
    const full = yearLen >= 30 ? 30 : 22;
    if (apps <= 0) return { key: "bench", label: "대기·미출전" };
    if (apps >= full * 0.7) return { key: "starter", label: "부동의 주전" };
    if (apps >= full * 0.45) return { key: "rotation", label: "로테이션 주전" };
    if (apps >= 8) return { key: "spark", label: "슈퍼서브·스파링" };
    return { key: "backup", label: "백업" };
  }

  function careerRole(p) {
    const rows = mergedByYear(p);
    if (!rows.length) return { key: "unknown", label: "역할 미정", appsAvg: 0 };
    const avg = rows.reduce((s, r) => s + r.apps, 0) / rows.length;
    const role = roleFromApps(avg, 33);
    role.appsAvg = Math.round(avg * 10) / 10;
    return role;
  }

  function yearRole(p, year) {
    const s = yearMerged(p, year);
    const apps = s ? s.apps : 0;
    const role = roleFromApps(apps, Number(year) === YEAR ? 25 : 33);
    role.apps = apps;
    role.season = s;
    return role;
  }

  function rate(n, d, digits) {
    if (!d) return "–";
    return (n / d).toFixed(digits == null ? 2 : digits);
  }

  function clamp01(x) {
    if (!Number.isFinite(x)) return 0;
    return Math.max(0, Math.min(1, x));
  }

  function pct(x) {
    return Math.round(clamp01(x) * 100);
  }

  /**
   * Season index everyone can check against the official table.
   * Field: goal involvements (G+A), the same counting Transfermarkt / broadcast graphics use.
   * GK: clean-sheet rate and goals-against per game.
   * Caps are K League 1 season anchors, not FM attributes.
   */
  function evRow(p, events) {
    if (!events) return null;
    const id = String(p?.id || "");
    if (events[id]) return events[id];
    if (events.players && events.players[id]) return events.players[id];
    return null;
  }

  function pg(n, games) {
    if (!games) return 0;
    return n / games;
  }

  function ratePct(ok, att) {
    const a = num(att);
    const o = num(ok);
    if (!a) return { pct: null, raw: "–", text: "–" };
    const p = Math.round((o / a) * 100);
    return { pct: p, raw: `${o}/${a}`, text: `${p}%` };
  }

  function chalkRates(ev, gk) {
    if (!ev) return [];
    const pass = ratePct(ev.pass_ok, ev.passes);
    const shot = ratePct(ev.sot, ev.shots);
    const drib = ratePct(ev.dribble_ok, ev.dribble);
    const tk = ratePct(ev.tackle_ok, ev.tackle);
    const air = ratePct(ev.aerial_w, num(ev.aerial_w) + num(ev.aerial_l));
    const save = ratePct(ev.saves, num(ev.saves) + num(ev.conceded));
    if (gk) {
      return [
        { key: "save", label: "선방률", hint: "선방/(선방+실점)", group: "골문", ...save },
        { key: "pass", label: "패스 성공률", hint: "성공/시도", group: "패스", ...pass },
        { key: "air", label: "공중볼 승률", hint: "성공/(성공+실패)", group: "수비", ...air },
      ];
    }
    return [
      { key: "shot", label: "슈팅 정확도", hint: "유효슈팅/슈팅", group: "공격", ...shot },
      { key: "drib", label: "드리블 성공률", hint: "성공/시도", group: "공격", ...drib },
      { key: "pass", label: "패스 성공률", hint: "성공/시도", group: "패스", ...pass },
      { key: "tk", label: "태클 성공률", hint: "성공/시도", group: "수비", ...tk },
      { key: "air", label: "공중볼 승률", hint: "성공/(성공+실패)", group: "수비", ...air },
    ];
  }

  function scoreCard(p, events) {
    const gk = isGk(p);
    const y = yearMerged(p, YEAR) || { apps: 0, a: 0, b: 0 };
    const c = career(p);
    const apps = y.apps;
    const appsAxis = pct(apps / 25);
    const careerAppsAxis = pct(c.apps / 200);
    const ev = evRow(p, events);
    const chalkGames = ev ? num(ev.games) : 0;
    const chalk = chalkGames >= 3;
    const rates = chalk ? chalkRates(ev, gk) : [];
    let axes;
    let total;
    let attack;
    let defend;
    let involvements;
    let per = 0;
    let formula;
    let tendNote;

    if (gk) {
      const ga = y.a;
      const cs = y.b;
      const csRate = apps ? cs / apps : 0;
      const gaRate = apps ? ga / apps : 0;
      const axCs = pct(cs / 10);
      const axCsRate = pct(csRate / 0.45);
      const axGa = pct(1 - Math.min(gaRate, 1.5) / 1.5);
      const cCsRate = c.apps ? c.b / c.apps : 0;
      const axCCs = pct(cCsRate / 0.45);
      involvements = cs;
      per = csRate;
      attack = 0;
      if (chalk) {
        const axSave = pct(pg(num(ev.saves), chalkGames) / 4);
        const axPass = pct(pg(num(ev.pass_ok), chalkGames) / 18);
        defend = Math.round(0.4 * axCsRate + 0.35 * axGa + 0.25 * axSave);
        total = Math.round(0.3 * appsAxis + 0.3 * axCsRate + 0.25 * axGa + 0.15 * axSave);
        formula =
          "키퍼 기여점 = 출장·클린율·실점억제(공식) + 선방(칠판). 부가기록(Bepro11).";
        const passR = ratePct(ev.pass_ok, ev.passes);
        const saveR = ratePct(ev.saves, num(ev.saves) + num(ev.conceded));
        tendNote =
          `선방 ${ev.saves} · 실점 ${ev.conceded}` +
          (saveR.pct != null ? ` · 선방률 ${saveR.text}` : "") +
          (passR.pct != null ? ` · 패스 ${passR.text} (${passR.raw})` : "") +
          ` · 칠판 ${chalkGames}경기`;
        axes = [
          { key: "apps", label: "출장 신뢰", value: appsAxis, raw: `${apps}경기` },
          { key: "csRate", label: "클린율", value: axCsRate, raw: apps ? `${Math.round(csRate * 100)}%` : "–" },
          { key: "ga", label: "실점 억제", value: axGa, raw: apps ? `경기당 ${rate(ga, apps)}` : "–" },
          { key: "save", label: "선방", value: axSave, raw: `${num(ev.saves)}회` },
          { key: "pass", label: "패스 성공", value: axPass, raw: passR.pct != null ? `${passR.text} (${passR.raw})` : "–" },
          { key: "air", label: "공중볼", value: pct(pg(num(ev.aerial_w), chalkGames) / 2), raw: `${num(ev.aerial_w)}승` },
        ];
      } else {
        defend = Math.round(0.5 * axCsRate + 0.5 * axGa);
        total = Math.round(0.35 * appsAxis + 0.35 * axCsRate + 0.3 * axGa);
        formula =
          "키퍼 기여점 = 0.35×min(출장/25,1) + 0.35×min(클린율/45%,1) + 0.30×실점억제. 칠판 표본이 적어 공식 표만 사용.";
        tendNote = chalkGames ? `칠판 ${chalkGames}경기뿐이라 공식 클린·실점만.` : "칠판 표본 없음. 공식 클린·실점만.";
        axes = [
          { key: "apps", label: "출장 신뢰", value: appsAxis, raw: `${apps}경기` },
          { key: "cs", label: "클린시트", value: axCs, raw: `${cs}회` },
          { key: "csRate", label: "클린율", value: axCsRate, raw: apps ? `${Math.round(csRate * 100)}%` : "–" },
          { key: "ga", label: "실점 억제", value: axGa, raw: apps ? `경기당 ${rate(ga, apps)}` : "–" },
          { key: "cApps", label: "통산 출장", value: careerAppsAxis, raw: `${c.apps}경기` },
          { key: "cCs", label: "통산 클린율", value: axCCs, raw: c.apps ? `${Math.round(cCsRate * 100)}%` : "–" },
        ];
      }
    } else {
      const g = y.a;
      const a = y.b;
      involvements = g + a;
      per = apps ? involvements / apps : 0;
      const axG = pct(g / 10);
      const axA = pct(a / 8);
      const axPer = pct(per / 0.4);
      const axInv = pct(involvements / 12);
      const axCInv = pct((c.a + c.b) / 40);
      if (chalk) {
        const defActs = num(ev.tackle_ok) + num(ev.int) + num(ev.cut) + num(ev.clg);
        const axShot = pct(pg(num(ev.shots), chalkGames) / 2.4);
        const axKey = pct(pg(num(ev.keypass), chalkGames) / 1.2);
        const axDrib = pct(pg(num(ev.dribble_ok), chalkGames) / 2);
        const axDef = pct(pg(defActs, chalkGames) / 6);
        const axAir = pct(pg(num(ev.aerial_w), chalkGames) / 3);
        attack = Math.round(0.3 * axShot + 0.25 * axKey + 0.2 * axDrib + 0.25 * axPer);
        defend = Math.round(0.7 * axDef + 0.3 * axAir);
        total = Math.round(0.22 * appsAxis + 0.22 * axInv + 0.28 * attack + 0.28 * defend);
        const passR = ratePct(ev.pass_ok, ev.passes);
        const shotR = ratePct(ev.sot, ev.shots);
        const dribR = ratePct(ev.dribble_ok, ev.dribble);
        formula =
          "야수 기여점 = 공식 출장·골+도움 + 칠판 슈팅·키패스·드리블(공격) / 태클·차단·클리어·공중볼(수비). Bepro11 부가기록.";
        tendNote =
          (passR.pct != null ? `패스 ${passR.text} (${passR.raw}) · ` : "") +
          (shotR.pct != null ? `슈팅 정확 ${shotR.text} (${shotR.raw}) · ` : "") +
          `키패스 ${ev.keypass} · 드리블 ${dribR.raw}` +
          ` / 태클 ${ev.tackle_ok}·차단 ${num(ev.int) + num(ev.cut)}·클리어 ${ev.clg}·공중 ${ev.aerial_w}` +
          ` · 칠판 ${chalkGames}경기`;
        axes = [
          { key: "apps", label: "출장 신뢰", value: appsAxis, raw: `${apps}경기` },
          {
            key: "shot",
            label: "슈팅",
            value: axShot,
            raw: shotR.pct != null ? `${num(ev.shots)}회 · ${shotR.text}` : `${num(ev.shots)}회`,
          },
          { key: "key", label: "키패스", value: axKey, raw: `${num(ev.keypass)}회` },
          {
            key: "drib",
            label: "드리블",
            value: axDrib,
            raw: dribR.pct != null ? `${dribR.text} (${dribR.raw})` : "–",
          },
          { key: "def", label: "수비 개입", value: axDef, raw: `${defActs}회` },
          { key: "air", label: "공중볼", value: axAir, raw: `${num(ev.aerial_w)}승` },
        ];
      } else {
        attack = axPer;
        defend = Math.round(appsAxis * (1 - 0.55 * clamp01(per / 0.4)));
        total = Math.round(0.4 * appsAxis + 0.35 * axInv + 0.25 * axPer);
        formula =
          "야수 기여점 = 0.40×출장 + 0.35×(골+도움) + 0.25×경기당 관여. 칠판 표본이 적어 공식 표만 사용.";
        tendNote = chalkGames
          ? `칠판 ${chalkGames}경기뿐이라 공격/수비는 공식 골+도움·출장으로 추정.`
          : "칠판 표본 없음. 공격/수비는 공식 골+도움·출장으로 추정.";
        axes = [
          { key: "apps", label: "출장 신뢰", value: appsAxis, raw: `${apps}경기` },
          { key: "g", label: "득점", value: axG, raw: `${g}골` },
          { key: "ast", label: "도움", value: axA, raw: `${a}도움` },
          { key: "per", label: "경기당 관여", value: axPer, raw: apps ? rate(involvements, apps) : "–" },
          { key: "cApps", label: "통산 출장", value: careerAppsAxis, raw: `${c.apps}경기` },
          { key: "cInv", label: "통산 관여", value: axCInv, raw: `${c.a + c.b} (골+도움)` },
        ];
      }
    }

    let tendKey = "balance";
    let tendLabel = "균형형";
    if (gk) {
      tendKey = "defend";
      tendLabel = apps ? "골문 수비형" : "출전 적음";
    } else if (attack >= defend + 12) {
      tendKey = "attack";
      tendLabel = "공격형";
    } else if (defend >= attack + 12) {
      tendKey = "defend";
      tendLabel = "수비형";
    }
    const denom = attack + defend;
    const needle = denom ? Math.round((defend / denom) * 100) : 50;

    return {
      gk,
      apps,
      involvements,
      per,
      total,
      attack,
      defend,
      appsAxis,
      careerAppsAxis,
      axes,
      tendKey,
      tendLabel,
      tendNote,
      needle,
      formula,
      chalk,
      chalkGames,
      ev,
      rates,
    };
  }

  function rateVal(sc, key) {
    const r = (sc.rates || []).find((x) => x.key === key);
    return r && r.pct != null ? r.pct : null;
  }

  function signed(n) {
    if (!Number.isFinite(n)) return "–";
    return (n > 0 ? "+" : "") + String(n);
  }

  function profileSummary(p) {
    const gk = isGk(p);
    const c = career(p);
    const now = yearMerged(p, YEAR) || { apps: 0, a: 0, b: 0 };
    const name = p.name || "이 선수";
    const team = p.team_full || p.team_name || "소속 팀";
    const pos = p.position || "";
    const bits = [];
    bits.push(
      `${eunNeun(name)} ${team} ${pos || "선수"}다.` +
        (p.nation ? ` 국적 ${p.nation}.` : "") +
        (p.age != null ? ` ${p.age}세.` : "") +
        (p.back_no != null ? ` 등번호 ${p.back_no}번.` : "") +
        (p.height || p.weight ? ` 신체 ${p.height || "–"}cm, ${p.weight || "–"}kg.` : "")
    );
    if (gk) {
      bits.push(
        `K리그 공식 통산 출장 ${c.apps}경기, 실점 ${c.a}, 클린시트 ${c.b}.` +
          (c.apps ? ` 경기당 실점 ${rate(c.a, c.apps)}, 클린시트 ${rate(c.b, c.apps, 2)}.` : "")
      );
      bits.push(
        `${YEAR}시즌 공식 출장 ${now.apps}경기, 실점 ${now.a}, 클린시트 ${now.b}.` +
          (now.apps ? ` 경기당 실점 ${rate(now.a, now.apps)}.` : "")
      );
    } else {
      bits.push(
        `K리그 공식 통산 출장 ${c.apps}경기, 득점 ${c.a}, 도움 ${c.b}.` +
          (c.apps
            ? ` 경기당 득점 ${rate(c.a, c.apps)}, 공격포인트 ${rate(c.a + c.b, c.apps)}.`
            : "")
      );
      bits.push(
        `${YEAR}시즌 공식 출장 ${now.apps}경기, ${now.a}골 ${now.b}도움.` +
          (now.apps ? ` 경기당 득점 ${rate(now.a, now.apps)}.` : "")
      );
    }
    bits.push(
      "아래 숫자는 K리그 선수 상세(공식)와 데이터포털 칠판(Bepro11 부가기록)이다. FM 능력치가 아니다."
    );
    return bits.join(" ");
  }

  function seasonNote(p, row, prev) {
    const year = String(row.season);
    const extra = (CURATED_YEARS[p.id] || {})[year];
    const gk = isGk(p);
    const t = triple(row, gk);
    const prevT = prev ? triple(prev, gk) : null;
    const role = roleFromApps(t.apps, Number(year) === YEAR ? 25 : 33);
    const team = row.team || p.team_name || "소속 팀";
    const bits = [];
    bits.push(`${year}시즌 ${team}. 공식 출장 ${t.apps}경기, 출장 구간 ‘${role.label}’.`);
    if (gk) {
      bits.push(
        `실점 ${t.a}, 클린시트 ${t.b}` +
          (t.apps
            ? ` (경기당 실점 ${rate(t.a, t.apps)}, 클린시트 ${Math.round((t.b / t.apps) * 100)}%).`
            : ".")
      );
    } else {
      bits.push(
        `${t.a}골 ${t.b}도움` +
          (t.apps
            ? ` (경기당 득점 ${rate(t.a, t.apps)}, 공격포인트 ${rate(t.a + t.b, t.apps)}).`
            : ".")
      );
    }
    if (prevT) {
      bits.push(
        `직전 공식 시즌 대비 출장 ${signed(t.apps - prevT.apps)}` +
          (gk
            ? `, 실점 ${signed(t.a - prevT.a)}, 클린시트 ${signed(t.b - prevT.b)}.`
            : `, 득점 ${signed(t.a - prevT.a)}, 도움 ${signed(t.b - prevT.b)}.`)
      );
    }
    if (prev && prev.team && row.team && prev.team !== row.team) {
      bits.push(`${prev.team}에서 ${row.team}으로 옮긴 시즌의 공식 기록이다.`);
    }
    if (extra) bits.push(extra);
    return {
      season: year,
      team,
      role: role.label,
      roleKey: role.key,
      apps: t.apps,
      a: t.a,
      b: t.b,
      text: bits.join(" "),
    };
  }

  function formText(p) {
    const gk = isGk(p);
    const now = yearRole(p, YEAR);
    const past = careerRole(p);
    const prevFull = yearMerged(p, 2025) || yearMerged(p, 2024) || yearMerged(p, 2022);
    const c = career(p);
    const n = now.season || { apps: 0, a: 0, b: 0 };
    const bits = [];
    bits.push(
      `${YEAR}시즌 공식 출장 ${n.apps}경기, 출장 구간 ‘${now.label}’. ` +
        `공식 시즌 평균 출장은 약 ${past.appsAvg}경기다.`
    );
    if (!now.season) {
      bits.push("올해 공식 시즌 행이 아직 없다.");
      return { trend: "flat", text: bits.join(" "), now, spark: mergedByYear(p) };
    }
    if (gk) {
      bits.push(
        `올해 실점 ${n.a}, 클린시트 ${n.b}, 경기당 실점 ${rate(n.a, n.apps)}. ` +
          `통산 경기당 실점 ${rate(c.a, c.apps)}.`
      );
    } else {
      bits.push(
        `올해 ${n.a}골 ${n.b}도움, 경기당 득점 ${rate(n.a, n.apps)}. ` +
          `통산 경기당 득점 ${rate(c.a, c.apps)}.`
      );
    }
    if (prevFull && prevFull.apps && n.apps) {
      if (gk) {
        bits.push(
          `최근 풀시즌(${prevFull.season}) 경기당 실점 ${rate(prevFull.a, prevFull.apps)}.`
        );
      } else {
        bits.push(
          `최근 풀시즌(${prevFull.season}) 경기당 득점 ${rate(prevFull.a, prevFull.apps)}.`
        );
      }
    }

    let trend = "flat";
    if (prevFull && prevFull.apps && n.apps) {
      const nowR = n.a / n.apps;
      const lastR = prevFull.a / prevFull.apps;
      if (gk) {
        trend = nowR < lastR - 0.08 ? "up" : nowR > lastR + 0.08 ? "down" : "flat";
      } else {
        trend = nowR > lastR + 0.08 ? "up" : nowR < lastR - 0.08 ? "down" : "flat";
      }
    }
    return { trend, text: bits.join(" "), now, spark: mergedByYear(p) };
  }

  function roleEssay(p) {
    const past = careerRole(p);
    const now = yearRole(p, YEAR);
    const name = p.name || "이 선수";
    const team = p.team_name || "소속 팀";
    return (
      `${eunNeun(name)} 공식 시즌 평균 출장 약 ${past.appsAvg}경기(구간 ‘${past.label}’). ` +
      `${YEAR}년 ${team} 공식 출장 ${now.apps}경기(구간 ‘${now.label}’). ` +
      `구간 이름은 출장 경기 수만으로 나눈 표이며, 감독 평가나 능력치가 아니다.`
    );
  }

  function officialLine(p, year) {
    const gk = isGk(p);
    const y = yearMerged(p, year) || { apps: 0, a: 0, b: 0 };
    const c = career(p);
    return { gk, year: y, career: c };
  }

  function compareRows(self, other) {
    const a = officialLine(self, YEAR);
    const b = officialLine(other, YEAR);
    const gk = a.gk && b.gk;
    const mixed = a.gk !== b.gk;
    const rows = [
      { key: "yApps", label: `${YEAR} 출장`, mine: a.year.apps, theirs: b.year.apps },
    ];
    if (!mixed && gk) {
      rows.push({ key: "yGc", label: `${YEAR} 실점`, mine: a.year.a, theirs: b.year.a, better: "low" });
      rows.push({ key: "yCs", label: `${YEAR} 클린시트`, mine: a.year.b, theirs: b.year.b });
      rows.push({
        key: "yGpa",
        label: `${YEAR} 경기당 실점`,
        mine: a.year.apps ? Number(rate(a.year.a, a.year.apps)) : null,
        theirs: b.year.apps ? Number(rate(b.year.a, b.year.apps)) : null,
        better: "low",
      });
    } else if (!mixed) {
      rows.push({ key: "yG", label: `${YEAR} 득점`, mine: a.year.a, theirs: b.year.a });
      rows.push({ key: "yA", label: `${YEAR} 도움`, mine: a.year.b, theirs: b.year.b });
      rows.push({
        key: "yGpa",
        label: `${YEAR} 경기당 득점`,
        mine: a.year.apps ? Number(rate(a.year.a, a.year.apps)) : null,
        theirs: b.year.apps ? Number(rate(b.year.a, b.year.apps)) : null,
      });
    } else {
      rows.push({
        key: "yStatA",
        label: a.gk ? `${YEAR} 실점` : `${YEAR} 득점`,
        mine: a.year.a,
        theirs: null,
      });
      rows.push({
        key: "yStatB",
        label: b.gk ? `${YEAR} 실점` : `${YEAR} 득점`,
        mine: null,
        theirs: b.year.a,
      });
    }
    rows.push({ key: "cApps", label: "통산 출장", mine: a.career.apps, theirs: b.career.apps });
    if (!mixed && gk) {
      rows.push({ key: "cGc", label: "통산 실점", mine: a.career.a, theirs: b.career.a, better: "low" });
      rows.push({ key: "cCs", label: "통산 클린시트", mine: a.career.b, theirs: b.career.b });
    } else if (!mixed) {
      rows.push({ key: "cG", label: "통산 득점", mine: a.career.a, theirs: b.career.a });
      rows.push({ key: "cA", label: "통산 도움", mine: a.career.b, theirs: b.career.b });
    }
    rows.forEach((r) => {
      r.d = r.mine != null && r.theirs != null ? Number((r.mine - r.theirs).toFixed(2)) : null;
    });
    return { a, b, rows, mixed, gk };
  }

  function withDiff(rows) {
    (rows || []).forEach((r) => {
      r.d = r.mine != null && r.theirs != null ? Number((r.mine - r.theirs).toFixed(2)) : null;
    });
    return rows || [];
  }

  function compareView(self, other, events) {
    const rec = compareRows(self, other);
    const a = scoreCard(self, events);
    const b = scoreCard(other, events);
    const ae = a.ev || {};
    const be = b.ev || {};
    const sections = [
      {
        title: "기여점",
        rows: withDiff([
          { key: "idx", label: "올해 기여점", mine: a.total, theirs: b.total, scale: 100 },
          { key: "atk", label: "공격 성향", mine: a.attack, theirs: b.attack, scale: 100 },
          { key: "def", label: "수비 성향", mine: a.defend, theirs: b.defend, scale: 100 },
        ]),
      },
    ];
    if (a.chalk || b.chalk) {
      if (a.gk || b.gk) {
        sections.push({
          title: "골문",
          rows: withDiff([
            {
              key: "savep",
              label: "선방률",
              mine: rateVal(a, "save"),
              theirs: rateVal(b, "save"),
              scale: "pct",
            },
            {
              key: "passp",
              label: "패스 성공률",
              mine: rateVal(a, "pass"),
              theirs: rateVal(b, "pass"),
              scale: "pct",
            },
          ]),
        });
      } else {
        sections.push({
          title: "공격",
          rows: withDiff([
            { key: "shot", label: "슈팅", mine: num(ae.shots), theirs: num(be.shots), scale: 0 },
            {
              key: "shotp",
              label: "슈팅 정확도",
              mine: rateVal(a, "shot"),
              theirs: rateVal(b, "shot"),
              scale: "pct",
            },
            { key: "keyp", label: "키패스", mine: num(ae.keypass), theirs: num(be.keypass), scale: 0 },
            {
              key: "dribp",
              label: "드리블 성공률",
              mine: rateVal(a, "drib"),
              theirs: rateVal(b, "drib"),
              scale: "pct",
            },
          ]),
        });
        sections.push({
          title: "패스",
          rows: withDiff([
            {
              key: "passp",
              label: "패스 성공률",
              mine: rateVal(a, "pass"),
              theirs: rateVal(b, "pass"),
              scale: "pct",
            },
          ]),
        });
        sections.push({
          title: "수비",
          rows: withDiff([
            {
              key: "tk",
              label: "태클 성공",
              mine: num(ae.tackle_ok),
              theirs: num(be.tackle_ok),
              scale: 0,
            },
            {
              key: "tkp",
              label: "태클 성공률",
              mine: rateVal(a, "tk"),
              theirs: rateVal(b, "tk"),
              scale: "pct",
            },
            {
              key: "blk",
              label: "차단·클리어",
              mine: num(ae.int) + num(ae.cut) + num(ae.clg),
              theirs: num(be.int) + num(be.cut) + num(be.clg),
              scale: 0,
            },
            {
              key: "air",
              label: "공중볼 성공",
              mine: num(ae.aerial_w),
              theirs: num(be.aerial_w),
              scale: 0,
            },
          ]),
        });
      }
    }
    sections.push({ title: "공식 기록", rows: rec.rows });
    const scoreRows = sections.flatMap((s) => s.rows);
    const useChalkRadar = a.chalk && b.chalk && !a.gk && !b.gk;
    return {
      rec,
      a,
      b,
      sections,
      scoreRows,
      radarLabels: useChalkRadar
        ? ["올해 기여점", "공격 성향", "수비 성향", "슈팅", "수비 개입", "공중볼"]
        : ["올해 기여점", "공격 성향", "수비 성향", "출장 신뢰", "통산 출장"],
      radarMine: useChalkRadar
        ? [
            a.total,
            a.attack,
            a.defend,
            a.axes.find((x) => x.key === "shot")?.value || 0,
            a.axes.find((x) => x.key === "def")?.value || 0,
            a.axes.find((x) => x.key === "air")?.value || 0,
          ]
        : [a.total, a.attack, a.defend, a.appsAxis, a.careerAppsAxis],
      radarTheirs: useChalkRadar
        ? [
            b.total,
            b.attack,
            b.defend,
            b.axes.find((x) => x.key === "shot")?.value || 0,
            b.axes.find((x) => x.key === "def")?.value || 0,
            b.axes.find((x) => x.key === "air")?.value || 0,
          ]
        : [b.total, b.attack, b.defend, b.appsAxis, b.careerAppsAxis],
    };
  }

  function rivalCopy(self, other, events) {
    const sY = yearRole(self, YEAR).season || { apps: 0, a: 0, b: 0 };
    const oY = yearRole(other, YEAR).season || { apps: 0, a: 0, b: 0 };
    const name = other.name || "비교 상대";
    const me = self.name || "이 선수";
    const sameTeam = String(self.team_id || "") === String(other.team_id || "");
    const samePos =
      String(self.position || "").toUpperCase() === String(other.position || "").toUpperCase();
    const bits = [];
    if (sameTeam && samePos) bits.push(`${eunNeun(name)} 같은 팀, 같은 포지션이다.`);
    else if (samePos) bits.push(`${eunNeun(name)} 다른 팀이지만 같은 포지션이다.`);
    else bits.push(`${eunNeun(name)} 포지션이 다르다. 출장 숫자만 나란히 둔다.`);
    bits.push(`올해 공식 출장 ${me} ${sY.apps}경기, ${name} ${oY.apps}경기.`);
    if (isGk(self) && isGk(other)) {
      bits.push(
        `올해 실점 ${me} ${sY.a} / ${name} ${oY.a}, 클린시트 ${me} ${sY.b} / ${name} ${oY.b}.`
      );
    } else if (!isGk(self) && !isGk(other)) {
      bits.push(
        `올해 득점 ${me} ${sY.a} / ${name} ${oY.a}, 도움 ${me} ${sY.b} / ${name} ${oY.b}.`
      );
    }
    const sSc = scoreCard(self, events);
    const oSc = scoreCard(other, events);
    bits.push(
      `올해 기여점 ${me} ${sSc.total}점(${sSc.tendLabel}), ${name} ${oSc.total}점(${oSc.tendLabel}).`
    );
    if (sSc.chalk || oSc.chalk) {
      bits.push("성향은 데이터포털 칠판(슈팅·키패스·태클·공중볼)을 더한 값이다.");
    }
    return bits.join(" ");
  }

  function yearLine(p) {
    const y = yearRole(p, YEAR);
    const s = y.season || { apps: 0, a: 0, b: 0 };
    return { apps: s.apps, a: s.a, b: s.b, label: y.label };
  }

  function build(p, events) {
    const rows = seasonRows(p);
    const notes = rows.map((row, i) => seasonNote(p, row, i ? rows[i - 1] : null)).reverse();
    const form = formText(p);
    const past = careerRole(p);
    const now = yearRole(p, YEAR);
    let shift = "유지";
    if (past.key !== now.key) {
      if (now.key === "starter") shift = "상승";
      else if (past.key === "starter") shift = "하락";
      else shift = "이동";
    }
    return {
      profile: profileSummary(p),
      form,
      role: {
        career: past,
        year: now,
        shift,
        text: roleEssay(p),
      },
      seasons: notes,
      score: scoreCard(p, events),
    };
  }

  return {
    YEAR,
    build,
    rivalCopy,
    compareRows,
    compareView,
    scoreCard,
    career,
    yearRole,
    yearLine,
    isGk,
    triple,
    mergedByYear,
  };
})();
