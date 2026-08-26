/**
 * Scout engine: FM-style 1-20 ratings, season notes, role, 2026 form.
 * Numbers come from official K League appearance/goal/clean-sheet tables
 * plus height/age. This is not Football Manager's database.
 */
const PlayerEngine = (() => {
  const YEAR = 2026;

  const ATTRS = {
    GK: [
      ["reflexes", "반사신경"],
      ["handling", "핸들링"],
      ["aerial", "공중볼"],
      ["command", "커맨드"],
      ["oneOnOne", "1대1"],
      ["kicking", "골킥"],
      ["concentration", "집중력"],
      ["composure", "침착함"],
      ["jumping", "점프"],
      ["leadership", "경기운영"],
    ],
    DF: [
      ["tackling", "태클"],
      ["marking", "마킹"],
      ["heading", "헤더"],
      ["strength", "힘"],
      ["pace", "스피드"],
      ["passing", "패스"],
      ["positioning", "위치선정"],
      ["stamina", "스테미너"],
      ["bravery", "담력"],
      ["jumping", "점프"],
    ],
    MF: [
      ["passing", "패스"],
      ["vision", "시야"],
      ["stamina", "스테미너"],
      ["dribbling", "드리블"],
      ["tackling", "태클"],
      ["pace", "스피드"],
      ["finishing", "결정력"],
      ["teamwork", "팀워크"],
      ["workrate", "활동량"],
      ["composure", "침착함"],
    ],
    FW: [
      ["finishing", "마무리"],
      ["offBall", "침투"],
      ["pace", "스피드"],
      ["dribbling", "드리블"],
      ["heading", "헤더"],
      ["strength", "힘"],
      ["composure", "침착함"],
      ["stamina", "스테미너"],
      ["technique", "테크닉"],
      ["jumping", "점프"],
    ],
  };

  const CURATED_YEARS = {
    "20180025": {
      "2018": "프로 데뷔 시즌부터 전북 골문을 30경기 맡았다. 클린시트 19는 신인 키퍼치고 이례적으로 높다. 이미 ‘언젠가 주전’이 아니라 ‘올해의 주전’으로 시작했다.",
      "2019": "38경기 풀시즌. 출장이 늘어난 만큼 실점도 늘었지만, 한 시즌을 통째로 책임지는 내구력이 증명됐다. 전북의 1순위 장갑이 고정된 해다.",
      "2020": "코로나 단축 시즌에도 27경기를 지켰다. 출장이 줄어도 역할은 그대로 주전이었다. 큰 키퍼의 세트피스 장악이 팀 수비의 습관이 됐다.",
      "2021": "다시 37경기. 실점이 조금 늘었지만 감독이 교체를 고민하지 않았다는 뜻이다. 빌드업 첫 패스를 요구받는 전술 변화의 한가운데 있었다.",
      "2022": "35경기 연속 주전. 커리어 중반의 안정 구간이다. 위치 선정과 커맨드가 반사신경보다 먼저 나오는 타입으로 자리 잡았다.",
      "2025": "군 복무 공백 뒤 복귀 첫 풀시즌. 38경기·클린시트 15. 감각을 되찾는 초반을 지나 다시 전북의 마지막 줄이 됐다.",
      "2026": "시즌 중반 기준 리그 24경기+슈퍼컵. 출장 페이스는 주전 그 자체다. 클린시트 비율도 커리어 평균 근처를 유지하고 있다.",
    },
    "20220042": {
      "2022": "K리그 복귀 이후 수원FC에서 한 시즌을 통째로 뛰며 14골을 넣었다. 유망주 프레임이 득점 프레임으로 바뀐 해다.",
      "2023": "다시 풀시즌, 10골. 출장은 그대로인데 골 페이스가 조금 떨어졌다. 그래도 수원의 1순위 칼끝은 유지됐다.",
      "2024": "시즌 중 전북으로 옮긴 전환의 해. 수원에서 이미 두 자릿수 득점을 찍고 넘어왔기 때문에, 적응보다 ‘바로 써도 되는 공격수’로 읽혔다.",
      "2025": "전북 첫 풀시즌에 가깝다. 출장은 유지됐지만 골은 줄었다. 측면과 가짜 9를 오가는 움직임이 팀 패턴이 되는 대신, 마감 위치는 더 깊숙했다.",
      "2026": "올해도 전북 공격의 칼끝. 몸싸움보다 각과 타이밍으로 골을 만드는 정체성은 그대로고, 골 페이스는 작년보다 살아났다.",
    },
  };

  function num(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, Math.round(n)));
  }

  function scale(x, x0, x1, y0, y1) {
    if (x1 === x0) return y0;
    const t = (x - x0) / (x1 - x0);
    return y0 + t * (y1 - y0);
  }

  function jong(word) {
    const s = String(word || "");
    const code = s.charCodeAt(s.length - 1);
    if (code < 0xac00 || code > 0xd7a3) return 0;
    return (code - 0xac00) % 28;
  }

  function iGa(name) {
    return String(name) + (jong(name) ? "이" : "가");
  }

  function eunNeun(name) {
    return String(name) + (jong(name) ? "은" : "는");
  }

  function eulReul(name) {
    return String(name) + (jong(name) ? "을" : "를");
  }

  function euro(name) {
    const j = jong(name);
    return String(name) + (j === 0 || j === 8 ? "로" : "으로");
  }

  function isGk(p) {
    return String(p?.position || "").toUpperCase() === "GK";
  }

  function posKey(p) {
    const x = String(p?.position || "FW").toUpperCase();
    return ATTRS[x] ? x : "FW";
  }

  function seasonRows(p) {
    return (p?.seasons || [])
      .filter((s) => String(s.season || "").match(/^\d{4}$/))
      .sort((a, b) => {
        const dy = Number(a.season) - Number(b.season);
        if (dy) return dy;
        return 0;
      });
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

  function ageCurve(age, peakLo, peakHi) {
    if (!age) return 0;
    if (age >= peakLo && age <= peakHi) return 2;
    if (age < peakLo) return Math.max(-3, (age - peakLo) * 0.45);
    return Math.max(-4, (peakHi - age) * 0.55);
  }

  function bmi(p) {
    const h = num(p.height) / 100;
    const w = num(p.weight);
    if (!h || !w) return 0;
    return w / (h * h);
  }

  function attributes(p) {
    const gk = isGk(p);
    const pos = posKey(p);
    const c = career(p);
    const y = yearRole(p, YEAR);
    const yT = y.season || { apps: 0, a: 0, b: 0 };
    const age = num(p.age);
    const h = num(p.height);
    const w = num(p.weight);
    const apps = c.apps;
    const gpa = apps ? c.a / apps : 0;
    const spa = apps ? c.b / apps : 0;
    const yApps = yT.apps;
    const yGpa = yApps ? yT.a / yApps : 0;
    const exp = scale(apps, 0, 180, 0, 6);
    const trust = scale(yApps, 0, 24, 0, 4);
    const peak = gk ? ageCurve(age, 28, 33) : ageCurve(age, 26, 31);
    const body = bmi(p);
    const out = {};

    function put(key, raw) {
      out[key] = clamp(raw + peak * 0.35 + trust * 0.4, 1, 20);
    }

    if (gk) {
      const cs = apps ? c.b / apps : 0;
      const ycs = yApps ? yT.b / yApps : cs;
      put("aerial", scale(h, 178, 198, 8, 19) + exp * 0.2);
      put("jumping", scale(h, 176, 196, 9, 18));
      put("handling", 8 + cs * 16 + ycs * 4);
      put("reflexes", 11 + (h && h < 188 ? 2 : 0) + (1 - Math.min(gpa, 1.6) / 1.6) * 5);
      put("command", scale(h, 180, 196, 9, 16) + exp * 0.35 + (y.key === "starter" ? 2 : 0));
      put("oneOnOne", 10 + (1 - Math.min(gpa, 1.5) / 1.5) * 6 + trust);
      put("kicking", 10 + (h && h < 190 ? 2 : 0) + (w && w < 85 ? 1 : 0) + trust * 0.3);
      put("concentration", 9 + scale(yApps, 0, 28, 0, 7) + exp * 0.2);
      put("composure", 10 + exp * 0.4 + (age >= 27 ? 2 : 0));
      put("leadership", 8 + exp * 0.55 + (y.key === "starter" ? 3 : 0));
    } else if (pos === "DF") {
      put("heading", scale(h, 170, 194, 7, 18) + spa * 8);
      put("jumping", scale(h, 170, 194, 8, 18));
      put("strength", scale(body || 23, 20, 26, 8, 18) + scale(w, 65, 90, 0, 3));
      put("pace", scale(h || 180, 192, 168, 8, 17) + (age && age <= 26 ? 2 : 0));
      put("tackling", 10 + exp * 0.4 + trust + (y.key === "starter" ? 1 : 0));
      put("marking", 10 + exp * 0.35 + scale(yApps, 0, 24, 0, 3));
      put("passing", 9 + spa * 12 + (h && h <= 180 ? 1 : 0) + trust * 0.4);
      put("positioning", 9 + exp * 0.5 + (age >= 28 ? 2 : 0));
      put("stamina", 8 + scale(yApps, 0, 28, 0, 8) + scale(apps, 0, 150, 0, 3));
      put("bravery", 11 + trust + (y.key === "starter" ? 2 : 0));
    } else if (pos === "MF") {
      const pts = apps ? (c.a + c.b) / apps : 0;
      put("passing", 10 + pts * 10 + exp * 0.25 + trust * 0.4);
      put("vision", 10 + spa * 14 + pts * 4);
      put("stamina", 9 + scale(yApps, 0, 28, 0, 8));
      put("dribbling", 9 + pts * 8 + (h && h <= 178 ? 2 : 0));
      put("tackling", 9 + (pts < 0.15 ? 3 : 0) + exp * 0.3);
      put("pace", scale(h || 178, 190, 168, 9, 17) + (age && age <= 27 ? 1 : 0));
      put("finishing", 8 + gpa * 18 + yGpa * 6);
      put("teamwork", 11 + exp * 0.3 + (y.key === "starter" || y.key === "rotation" ? 2 : 0));
      put("workrate", 10 + scale(yApps, 0, 26, 0, 7));
      put("composure", 10 + exp * 0.35 + (age >= 27 ? 1 : 0));
    } else {
      put("finishing", 8 + gpa * 22 + yGpa * 8);
      put("offBall", 10 + gpa * 10 + spa * 8 + (h && h <= 176 ? 2 : 0));
      put("pace", scale(h || 178, 192, 168, 8, 18) + (age && age <= 26 ? 2 : 0));
      put("dribbling", 9 + spa * 10 + (h && h <= 176 ? 3 : 0) + gpa * 4);
      put("heading", scale(h, 168, 194, 7, 18) + gpa * 4);
      put("jumping", scale(h, 168, 194, 8, 17));
      put("strength", scale(body || 23, 19, 26, 7, 17) + scale(w, 60, 88, 0, 3));
      put("composure", 10 + gpa * 8 + exp * 0.25);
      put("stamina", 9 + scale(yApps, 0, 26, 0, 7));
      put("technique", 10 + spa * 8 + gpa * 6 + (h && h <= 175 ? 2 : 0));
    }

    const spec = ATTRS[pos];
    const list = spec.map(([key, label]) => ({ key, label, value: out[key] || 8 }));
    const ca = clamp((list.reduce((s, a) => s + a.value, 0) / list.length) * 5.1, 35, 94);
    const pa = clamp(
      ca + (age && age < 24 ? (24 - age) * 2.2 : age > 32 ? (32 - age) * 1.4 : 2),
      40,
      99
    );
    return { list, map: out, ca, pa, pos };
  }

  function seasonNote(p, row, prev) {
    const year = String(row.season);
    const extra = (CURATED_YEARS[p.id] || {})[year];
    const gk = isGk(p);
    const t = triple(row, gk);
    const prevT = prev ? triple(prev, gk) : null;
    const role = roleFromApps(t.apps, Number(year) === YEAR ? 25 : 33);
    const team = row.team || p.team_name || "소속 팀";
    const name = p.name || "이 선수";
    const bits = [];
    bits.push(
      `${year}시즌 ${team}. 공식 출장 ${t.apps}경기로 읽으면 역할은 ‘${role.label}’이다.`
    );
    if (gk) {
      const rate = t.apps ? Math.round((t.b / t.apps) * 100) : 0;
      bits.push(
        `실점 ${t.a}, 클린시트 ${t.b}` +
          (t.apps ? ` (경기당 실점 ${(t.a / t.apps).toFixed(2)}, 클린시트 ${rate}%).` : ".")
      );
      if (prevT && prevT.apps) {
        const inProgress = Number(year) === YEAR;
        const dApps = t.apps - prevT.apps;
        const dCs = (t.apps ? t.b / t.apps : 0) - prevT.b / prevT.apps;
        if (!inProgress && dApps >= 6) bits.push("전년보다 출장이 늘었다. 신뢰를 되찾았거나 경쟁자가 빠졌다.");
        else if (!inProgress && dApps <= -6) bits.push("전년보다 출장이 줄었다. 로테이션·부상·군 복무·경쟁 구도 중 하나다.");
        else if (inProgress && t.apps >= 18) bits.push("시즌이 아직 남았는데도 주전 샘플은 이미 찼다. 출장 감소로 읽으면 안 된다.");
        if (dCs >= 0.08) bits.push("클린시트 비율이 올라 수비 블록과 호흡이 맞았던 해로 읽힌다.");
        else if (dCs <= -0.08) bits.push("클린시트 비율이 내려갔다. 라인 변화나 실점 클러스터가 있었던 시즌이다.");
      }
      if (t.apps >= 30) bits.push("풀시즌 골키퍼. 한 경기의 실수가 아니라 8개월의 안정이 평가 단위다.");
      if (t.apps > 0 && t.apps < 8) bits.push("샘플이 짧다. 컵대회·부상 대체 출전일 가능성이 크다.");
    } else {
      bits.push(
        `${t.a}골 ${t.b}도움` +
          (t.apps
            ? ` (경기당 득점 ${(t.a / t.apps).toFixed(2)}, 공격포인트 ${((t.a + t.b) / t.apps).toFixed(2)}).`
            : ".")
      );
      if (prevT && prevT.apps) {
        const inProgress = Number(year) === YEAR;
        const dApps = t.apps - prevT.apps;
        const dG = (t.apps ? t.a / t.apps : 0) - prevT.a / prevT.apps;
        if (!inProgress && dApps >= 6) bits.push("전년보다 출장이 늘며 역할이 커졌다.");
        else if (!inProgress && dApps <= -6) bits.push("전년보다 출장이 줄었다. 포지션 경쟁이나 전술 변화 신호다.");
        else if (inProgress && t.apps >= 18) bits.push("시즌이 아직 남았는데도 주전 샘플은 이미 찼다.");
        if (dG >= 0.12) bits.push("경기당 득점이 뚜렷이 올랐다. 마감 위치나 파트너가 맞았던 해다.");
        else if (dG <= -0.12) bits.push("경기당 득점이 떨어졌다. 찬스 질이 나빠졌거나 롤이 깊숙이 내려왔다.");
      }
      if (t.a >= 10) bits.push("두 자릿수 득점. 상대 수비 명단에 따로 적히는 시즌이다.");
      if (t.apps >= 20 && t.a === 0 && t.b === 0) {
        bits.push("출장은 있는데 공격 포인트가 없다. 연결·수비 가담이 본업이었거나 마감이 과제이던 해다.");
      }
    }
    if (prev && prev.team && row.team && prev.team !== row.team) {
      bits.push(`${prev.team}에서 ${euro(row.team)} 옮긴 첫 숫자다. 적응과 출장이 동시에 시험된다.`);
    }
    if (extra) bits.push(extra);
    else bits.push(`${name}의 이 해는 하이라이트 한 장이 아니라, 출장 ${t.apps}이 말해주는 역할의 해다.`);
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
    const name = p.name || "이 선수";
    const bits = [];
    bits.push(
      `${YEAR}시즌 공식 출장 ${n.apps}경기, 역할은 ‘${now.label}’이다. ` +
        `커리어 평균 역할은 ‘${past.label}’(시즌당 약 ${past.appsAvg}경기)였다.`
    );
    if (!now.season) {
      bits.push("올해 공식 시즌 행이 아직 없다. 대기·임대·미등록이거나 표가 비어 있다.");
      return { trend: "flat", text: bits.join(" "), now, spark: mergedByYear(p) };
    }
    if (gk) {
      const nowR = n.apps ? n.a / n.apps : 0;
      const carR = c.apps ? c.a / c.apps : 0;
      bits.push(
        `올해 경기당 실점 ${nowR.toFixed(2)}, 클린시트 ${n.b}회. 통산 경기당 실점은 ${carR.toFixed(2)}다.`
      );
      if (prevFull && prevFull.apps) {
        const lastR = prevFull.a / prevFull.apps;
        if (nowR < lastR - 0.12) {
          bits.push("최근 풀시즌보다 실점 페이스가 낮다. 수비 조직이 맞거나 본인이 각을 더 잘 지운다.");
        } else if (nowR > lastR + 0.12) {
          bits.push("최근 풀시즌보다 실점 페이스가 높다. 라인 높이·센터백 조합을 같이 봐야 한다.");
        } else {
          bits.push("실점 페이스는 최근 풀시즌과 크게 다르지 않다. 역할이 유지되는 구간에 가깝다.");
        }
      }
    } else {
      const nowR = n.apps ? n.a / n.apps : 0;
      const carR = c.apps ? c.a / c.apps : 0;
      bits.push(
        `올해 ${n.a}골 ${n.b}도움, 경기당 득점 ${nowR.toFixed(2)}. 통산 경기당 득점은 ${carR.toFixed(2)}다.`
      );
      if (prevFull && prevFull.apps) {
        const lastR = prevFull.a / prevFull.apps;
        if (nowR > lastR + 0.1) {
          bits.push("최근 풀시즌보다 골 페이스가 좋다. 롤이 골문에 더 가깝거나 파트너가 맞다.");
        } else if (nowR < lastR - 0.1) {
          bits.push("최근 풀시즌보다 골 페이스가 떨어졌다. 찬스 공유가 줄었거나 수비 가담이 늘었다.");
        } else {
          bits.push("득점 페이스는 최근 풀시즌과 비슷하다. 기복보다 ‘같은 선수’로 보는 편이 맞다.");
        }
      }
    }
    if (n.apps >= 18) bits.push(`${eunNeun(name)} 올해 이미 주전 샘플을 채웠다. 남은 경기는 페이스 유지가 과제다.`);
    else if (n.apps >= 8) {
      bits.push("출장이 애매한 구간이다. 남은 라운드에서 주전으로 굳힐지, 로테이션으로 남을지가 갈린다.");
    } else {
      bits.push("올해 출장이 적다. 흐름을 단정하기보다, 기회가 온 경기에서의 결정력을 보는 편이 맞다.");
    }

    let trend = "flat";
    if (prevFull && prevFull.apps && n.apps) {
      if (gk) {
        trend =
          n.a / n.apps < prevFull.a / prevFull.apps - 0.08
            ? "up"
            : n.a / n.apps > prevFull.a / prevFull.apps + 0.08
              ? "down"
              : "flat";
      } else {
        trend =
          n.a / n.apps > prevFull.a / prevFull.apps + 0.08
            ? "up"
            : n.a / n.apps < prevFull.a / prevFull.apps - 0.08
              ? "down"
              : "flat";
      }
    }
    return { trend, text: bits.join(" "), now, spark: mergedByYear(p) };
  }

  function roleEssay(p) {
    const past = careerRole(p);
    const now = yearRole(p, YEAR);
    const gk = isGk(p);
    const name = p.name || "이 선수";
    const team = p.team_name || "소속 팀";
    const bits = [];
    bits.push(
      `그동안의 기본 역할은 ‘${past.label}’이다. 공식 시즌을 평균 내면 한 해에 약 ${past.appsAvg}경기를 뛰었다. ` +
        `${YEAR}년 ${team}에서는 ‘${now.label}’(${now.apps}경기)로 읽힌다.`
    );
    if (past.key === now.key) {
      bits.push(
        "역할의 이름표는 같다. 팀이 바뀌어도, 시즌이 바뀌어도 감독이 맡기는 몫이 크게 흔들리지 않았다는 뜻이다."
      );
    } else if (now.key === "starter" && past.key !== "starter") {
      bits.push("올해는 한 단계 올라왔다. 백업·로테이션에서 주전 시간을 뺏고 있는 시즌이다.");
    } else if (past.key === "starter" && now.key !== "starter") {
      bits.push("커리어는 주전이었는데 올해 출장이 줄었다. 경쟁자, 전술, 컨디션, 포지션 변경 중 하나를 의심해야 한다.");
    } else {
      bits.push(`역할이 ‘${past.label}’에서 ‘${now.label}’로 이동 중이다. 시즌이 끝나기 전에 다시 흔들릴 수 있다.`);
    }
    if (gk) {
      bits.push(
        "골키퍼 역할은 골이 아니라 경기 수다. 한 번 장갑을 끼면 90분을 통째로 책임지므로, " +
          "출장 자체가 신뢰의 증명이다. 백업은 실력이 없어서가 아니라 실수할 자리가 없어서 안 나오는 경우가 많다."
      );
    } else {
      bits.push(
        "필드 선수는 출장과 공격 포인트를 같이 봐야 한다. 출장만 많고 골이 없으면 연결 롤, " +
          "출장은 적은데 골이 있으면 슈퍼서브 롤이다. 등번호는 힌트일 뿐 증거는 아니다."
      );
    }
    bits.push(
      `${eulReul(name)} 쓸 때 질문은 단순하다. ‘90분을 맡길 것인가, 특정 구간만 맡길 것인가.’ ` +
        `올해 숫자는 그 질문에 대한 ${team} 감독의 지금까지의 답이다.`
    );
    return bits.join(" ");
  }

  function compareRows(self, other) {
    const a = attributes(self);
    const b = attributes(other);
    const keys = new Map();
    a.list.forEach((x) => keys.set(x.key, x.label));
    b.list.forEach((x) => {
      if (!keys.has(x.key)) keys.set(x.key, x.label);
    });
    const rows = Array.from(keys.entries()).map(([key, label]) => {
      const mine = a.map[key];
      const theirs = b.map[key];
      return {
        key,
        label,
        mine: mine == null ? null : mine,
        theirs: theirs == null ? null : theirs,
        d: mine != null && theirs != null ? mine - theirs : null,
      };
    });
    rows.sort((x, y) => {
      const ad = Math.abs(y.d || 0) - Math.abs(x.d || 0);
      if (ad) return ad;
      return (y.mine || 0) - (x.mine || 0);
    });
    return { a, b, rows };
  }

  function rivalCopy(self, other) {
    const gk = isGk(self);
    const oGk = isGk(other);
    const sY = yearRole(self, YEAR).season || { apps: 0, a: 0, b: 0 };
    const oY = yearRole(other, YEAR).season || { apps: 0, a: 0, b: 0 };
    const name = other.name || "경쟁자";
    const me = self.name || "이 선수";
    const cmp = compareRows(self, other);
    const plus = cmp.rows.filter((d) => d.d != null && d.d >= 2).slice(0, 3);
    const minus = cmp.rows.filter((d) => d.d != null && d.d <= -2).slice(0, 3);
    const sameTeam = String(self.team_id || "") === String(other.team_id || "");
    const samePos = String(self.position || "").toUpperCase() === String(other.position || "").toUpperCase();
    const bits = [];
    if (sameTeam && samePos) bits.push(`${eunNeun(name)} 같은 팀, 같은 포지션 경쟁자다.`);
    else if (samePos) bits.push(`${eunNeun(name)} 다른 팀이지만 같은 포지션이다. 유형 비교에 가깝다.`);
    else bits.push(`${eunNeun(name)} 포지션이 다르다. 능력치 축이 일부만 겹친다.`);
    bits.push(
      `올해 출장 ${me} ${sY.apps} vs ${name} ${oY.apps}. 환산 CA ${cmp.a.ca} vs ${cmp.b.ca}.`
    );
    if (sY.apps > oY.apps + 5) bits.push(`출장만 보면 지금 사이클의 1순위는 ${me} 쪽이다.`);
    else if (oY.apps > sY.apps + 5) bits.push(`출장만 보면 지금 사이클의 1순위는 ${name} 쪽이다.`);
    else bits.push("출장이 비슷하면, 감독은 매치업 따라 둘을 섞고 있을 가능성이 크다.");
    if (plus.length) {
      bits.push(`${iGa(me)} 앞서는 항목은 ` + plus.map((d) => `${d.label}(${d.mine}대${d.theirs})`).join(", ") + "이다.");
    }
    if (minus.length) {
      bits.push(`${name}에게 밀리는 항목은 ` + minus.map((d) => `${d.label}(${d.mine}대${d.theirs})`).join(", ") + "이다.");
    }
    if (gk && oGk) {
      bits.push("키퍼 경쟁은 친다. 한 경기가 아니라 한 달이 단위고, 실수 하나가 시즌을 갈라놓는다.");
    } else if (samePos) {
      bits.push("필드 경쟁은 공존할 수 있다. 선발과 교체가 한 경기에 공존하면, 둘 다 팀의 무기다.");
    }
    if (self.height && other.height) {
      const dh = num(self.height) - num(other.height);
      if (Math.abs(dh) >= 6) {
        bits.push(
          `키 차이 ${Math.abs(dh)}cm. ` +
            (dh > 0
              ? `${iGa(me)} 제공권·공중볼에서 유리하고, ${iGa(name)} 지면 속도에서 만회하는 그림이 흔하다.`
              : `${iGa(name)} 제공권에서 유리하고, ${eunNeun(me)} 각과 타이밍으로 만회해야 한다.`)
        );
      }
    }
    return bits.join(" ");
  }

  function build(p) {
    const rows = seasonRows(p);
    const notes = rows.map((row, i) => seasonNote(p, row, i ? rows[i - 1] : null)).reverse();
    const attr = attributes(p);
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
      attributes: attr,
      form,
      role: {
        career: past,
        year: now,
        shift,
        text: roleEssay(p),
      },
      seasons: notes,
    };
  }

  return {
    YEAR,
    ATTRS,
    attributes,
    build,
    rivalCopy,
    compareRows,
    career,
    yearRole,
    posKey,
    isGk,
    triple,
    mergedByYear,
  };
})();
