/* c_report app bootstrap */

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    index: null,
    data: null,
    currentFile: null,
    selectedGoalIdx: 0,
    selectedPlayerId: null,
    eventFilter: "PS",
    teamFilter: "home",
  };

  function setStatus(msg, isError = false) {
    const el = $("status");
    if (!el) return;
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.className = "status" + (isError ? " error" : "");
    el.textContent = msg;
  }

  function queryGameId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("game") || params.get("game_id") || "";
  }

  const MAX_ROUNDS = 38;

  async function loadIndex(bust = false) {
    const url = bust ? `./data/index.json?t=${Date.now()}` : "./data/index.json";
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.matches) || !data.matches.length) {
      throw new Error("아직 수집된 경기가 없습니다.");
    }
    state.index = data;
    fillYearRound();
  }

  function matchForRound(year, round) {
    if (!state.index) return null;
    return (
      state.index.matches.find(
        (m) => String(m.year) === String(year) && Number(m.round) === Number(round)
      ) || null
    );
  }

  function roundLabel(round, match) {
    if (!match) return `${round}R`;
    return `${round}R ${match.home} ${match.score || "vs"} ${match.away}`;
  }

  function fillYearRound() {
    const years = [...new Set(state.index.matches.map((m) => String(m.year)))].sort().reverse();
    const yearSel = $("yearSelect");
    const roundSel = $("roundSelect");
    if (!yearSel || !roundSel) return;

    const prevYear = yearSel.value;
    const prevRound = roundSel.value;
    const wantedGame = queryGameId();

    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    if (prevYear && years.includes(prevYear)) yearSel.value = prevYear;
    else if (years.length) yearSel.value = years[0];

    if (wantedGame) {
      const hit = state.index.matches.find((m) => String(m.game_id) === String(wantedGame));
      if (hit) {
        yearSel.value = String(hit.year);
        rebuildRounds(String(hit.round));
        return;
      }
    }

    rebuildRounds(prevRound);
  }

  function rebuildRounds(preferredRound) {
    const yearSel = $("yearSelect");
    const roundSel = $("roundSelect");
    if (!yearSel || !roundSel || !state.index) return;

    const year = yearSel.value;
    const ready = state.index.matches
      .filter((m) => String(m.year) === String(year))
      .map((m) => Number(m.round));
    const latestReady = ready.length ? Math.max(...ready) : 1;
    const keep =
      preferredRound != null && preferredRound !== "" ? preferredRound : latestReady;

    roundSel.innerHTML = "";
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      const match = matchForRound(year, r);
      const opt = document.createElement("option");
      opt.value = String(r);
      opt.textContent = roundLabel(r, match);
      opt.dataset.hasData = match ? "1" : "0";
      if (match) opt.dataset.file = match.file || `./data/${match.game_id}.json`;
      roundSel.appendChild(opt);
    }

    if (keep && Number(keep) >= 1 && Number(keep) <= MAX_ROUNDS) {
      roundSel.value = String(keep);
    } else {
      roundSel.value = String(latestReady);
    }

    updateMatchHelp();
  }

  function updateMatchHelp() {
    const help = $("matchHelp");
    if (!help || !state.index) return;
    const year = $("yearSelect")?.value || "";
    const round = $("roundSelect")?.value || "";
    const match = matchForRound(year, round);
    const readyCount = state.index.matches.filter((m) => String(m.year) === String(year)).length;
    if (match) {
      help.textContent =
        `${year}시즌 전북 데이터 ${readyCount}경기 · ${round}R 준비됨 → 데이터 가져오기를 누르세요.`;
    } else {
      help.textContent =
        `${round}R은 아직 없습니다. 경기가 끝난 뒤 수집되면 데이터 가져오기로 불러올 수 있습니다.`;
    }
  }

  async function fetchAndLoad() {
    const btn = $("fetchBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "가져오는 중…";
    }
    setStatus("경기 목록을 새로고침하고 데이터를 불러오는 중…");
    try {
      const year = $("yearSelect")?.value;
      const round = $("roundSelect")?.value;
      await loadIndex(true);
      if (year) $("yearSelect").value = year;
      rebuildRounds(round);

      const match = matchForRound($("yearSelect")?.value, $("roundSelect")?.value);
      if (!match) {
        setStatus(
          `${$("roundSelect")?.value || ""}R 전북 경기가 아직 없습니다. 종료 후 자동 수집되면 다시 눌러 주세요.`,
          true
        );
        return;
      }
      await loadMatch(match.file || `./data/${match.game_id}.json`);
      setStatus("");
    } catch (err) {
      console.error(err);
      setStatus(String(err.message || err), true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "데이터 가져오기";
      }
    }
  }

  async function loadMatch(filePath) {
    const year = $("yearSelect")?.value;
    const round = $("roundSelect")?.value;
    const match = matchForRound(year, round);
    const file =
      filePath ||
      match?.file ||
      (match ? `./data/${match.game_id}.json` : "") ||
      "./data/131.json";
    setStatus("CHALK BOARD 데이터를 불러오는 중…");
    try {
      const res = await fetch(file, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${file}`);
      const data = await res.json();
      if (!data?.events?.length) throw new Error("이벤트 데이터가 비어 있습니다.");
      state.data = data;
      state.currentFile = file;
      state.selectedGoalIdx = 0;
      state.selectedPlayerId = null;
      state.teamFilter = "home";
      state.eventFilter = "PS";
      document.querySelectorAll("[data-team]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-team") === "home");
      });
      document.querySelectorAll("[data-filter]").forEach((b) => {
        b.classList.toggle("active", b.getAttribute("data-filter") === "PS");
      });
      syncUrl(data.meta?.game_id);
      setStatus("");
      renderAll();
    } catch (err) {
      console.error(err);
      setStatus(
        "경기 데이터를 읽지 못했습니다.\n" + String(err.message || err),
        true
      );
    }
  }

  function syncUrl(gameId) {
    if (!gameId || window.history?.replaceState == null) return;
    const params = new URLSearchParams(window.location.search);
    const embed = params.get("embed");
    const edit = params.get("edit");
    const next = new URLSearchParams();
    next.set("game", String(gameId));
    if (embed === "1") next.set("embed", "1");
    if (edit === "1") next.set("edit", "1");
    const qs = next.toString();
    const path = window.location.pathname;
    window.history.replaceState({}, "", `${path}?${qs}`);
  }

  function applyViewMode() {
    const params = new URLSearchParams(window.location.search);
    document.body.classList.remove("embed-mode", "edit-mode", "viewer-mode");
    if (params.get("embed") === "1") {
      document.body.classList.add("embed-mode");
      return;
    }
    if (params.get("edit") === "1") {
      document.body.classList.add("edit-mode");
      return;
    }
    document.body.classList.add("viewer-mode");
  }

  function renderAll() {
    const { meta, events, players } = state.data;
    const pmap = Analyze.playerMap(players);
    const stats = Analyze.teamStats(events, meta.home.team_id, meta.away.team_id);
    const goalList = Analyze.goals(events);

    if ($("heroCopy")) {
      $("heroCopy").innerHTML =
        `${escapeHtml(meta.competition || "")} ${escapeHtml(String(meta.round || ""))}라운드 · ` +
        `${escapeHtml(meta.home.name)} vs ${escapeHtml(meta.away.name)}<br />` +
        "CHALK BOARD 이벤트로 골 장면, 히트맵, xG를 한 번에 읽는 전북 팬 매치 리포트.";
    }
    document.title = `전북 매치 리포트 | ${meta.home.name} vs ${meta.away.name}`;

    $("homeName").textContent = meta.home.name;
    $("awayName").textContent = meta.away.name;
    $("scoreNum").textContent = `${meta.score.home} : ${meta.score.away}`;
    $("metaLine").textContent = [
      meta.competition,
      `${meta.round}라운드`,
      meta.date,
      meta.kickoff ? `${meta.kickoff} 킥오프` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    if ($("matchFacts")) {
      $("matchFacts").innerHTML = buildMatchFacts(meta, state.index);
    }

    const h = stats[meta.home.team_id];
    const a = stats[meta.away.team_id];
    const periods = Analyze.periodStats(events, meta.home.team_id, meta.away.team_id);
    const flow = Analyze.flowAfterFirstGoal(events, meta.home.team_id, meta.away.team_id);
    const att = Analyze.attendanceCompare(meta, state.index);

    $("kpiGrid").innerHTML = [
      kpi("xG (골 기대값)", h.xg, a.xg, "기회가 얼마나 좋았는지"),
      kpi("슈팅", h.shots, a.shots, "골문을 향한 시도"),
      kpi(
        "전반 xG",
        periods[1][meta.home.team_id].xg,
        periods[1][meta.away.team_id].xg,
        "전반 기회"
      ),
      kpi(
        "후반 xG",
        periods[2][meta.home.team_id].xg,
        periods[2][meta.away.team_id].xg,
        "후반 기회"
      ),
    ].join("");

    $("statBars").innerHTML = [
      bar("슈팅", h.shots, a.shots),
      bar("유효슈팅", h.sot, a.sot),
      bar("xG", h.xg, a.xg),
      bar("패스", h.passes, a.passes),
      bar("패스성공", h.passOk, a.passOk),
      bar("태클", h.tackles, a.tackles),
      bar("드리블", h.dribbles, a.dribbles),
      bar("파울", h.fouls, a.fouls),
      bar("경고", h.yellows, a.yellows),
      bar("클리어", h.clearances, a.clearances),
      bar("차단/인터셉트", h.interceptions, a.interceptions),
      bar("공중볼 성공", h.aerialWon, a.aerialWon),
      bar("압박", h.presses, a.presses),
      bar("선방", h.saves, a.saves),
    ].join("");

    const story = [];
    if (h.xg > a.xg && meta.score.home < meta.score.away) {
      story.push({
        label: "핵심",
        text: `전북 xG ${h.xg} > 상대 ${a.xg}. 기회 품질은 앞섰지만 스코어는 ${meta.score.home}-${meta.score.away}. "만들었는데 못 넣었다"가 아니라, 상대는 넣었고 우리는 마무리가 아쉬웠다는 그림입니다.`,
      });
    } else {
      story.push({
        label: "핵심",
        text: `최종 스코어 ${meta.score.home}-${meta.score.away}. 슈팅 ${h.shots}-${a.shots}, xG ${h.xg}-${a.xg}. 전반 xG ${periods[1][meta.home.team_id].xg}-${periods[1][meta.away.team_id].xg}, 후반 ${periods[2][meta.home.team_id].xg}-${periods[2][meta.away.team_id].xg}.`,
      });
    }
    if (flow.hasFirstGoal) {
      const scorer = flow.scorerSide === "home" ? meta.home.name : meta.away.name;
      story.push({
        label: "흐름",
        text: `선제골 ${flow.clock} (${scorer}). 이후 xG ${flow.after[meta.home.team_id].xg}-${flow.after[meta.away.team_id].xg}, 슈팅 ${flow.after[meta.home.team_id].shots}-${flow.after[meta.away.team_id].shots}.`,
      });
    }
    if (att.available) {
      const sign = att.diff > 0 ? "+" : "";
      story.push({
        label: "관중",
        text: `이날 관중 ${att.attendance.toLocaleString("ko-KR")}명 · ${att.baselineLabel} ${att.baseline.toLocaleString("ko-KR")}명 대비 ${sign}${att.diff.toLocaleString("ko-KR")}명(${sign}${att.pct}%).`,
      });
    }
    story.push({
      label: "초보",
      text: "xG(예상 득점)는 슈팅 위치·상황을 점수로 환산한 값입니다. 0.05면 어려운 슈팅, 0.30이면 꽤 좋은 기회예요.",
    });
    story.push({
      label: "전문가",
      text: `${meta.home.name} 슈팅 ${h.shots} / ${meta.away.name} ${a.shots}. 패스량(${h.passes} vs ${a.passes}), 압박(${h.presses} vs ${a.presses}), 클리어(${h.clearances} vs ${a.clearances}).`,
    });
    $("storyBox").innerHTML = story
      .map(
        (s) =>
          `<div class="story-item"><div class="story-label">${escapeHtml(s.label)}</div><div>${escapeHtml(
            s.text
          )}</div></div>`
      )
      .join("");

    renderPeriodFlow(meta, events);
    renderLineup(meta, state.data.lineup);
    renderGoals(goalList, pmap, meta);
    renderPlayers(events, players, meta);
    renderShotMap();
    setupCommunityEmbed();
  }

  function publicReportUrl() {
    const canonicalBase = "https://wanju1109.github.io/jeonbuk-lineup/c_report/index.html";
    const gameId = state.data?.meta?.game_id || queryGameId() || "131";
    const current = window.location.href.split("#")[0].split("?")[0];
    const base = /wanju1109\.github\.io/i.test(current) ? current : canonicalBase;
    return `${base}?game=${encodeURIComponent(gameId)}`;
  }

  function embedSrcUrl() {
    return `${publicReportUrl()}&embed=1`.replace("?game=", "?game=").replace("&&", "&");
  }

  function buildEmbedHtml(src) {
    return [
      '<div style="width:100%;max-width:1100px;margin:0 auto;">',
      `<iframe src="${src}" title="전북 매치 리포트" width="100%" height="980" style="width:100%;height:980px;border:0;border-radius:12px;overflow:hidden;background:#f3f7f2;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
      "</div>",
    ].join("");
  }

  function buildShareHtml(url) {
    const meta = state.data?.meta;
    const title = meta
      ? `${meta.round}R ${meta.home?.name || "전북"} ${meta.score?.home ?? ""}:${meta.score?.away ?? ""} ${meta.away?.name || ""}`.trim()
      : "전북 매치 리포트";
    const safeTitle = escapeHtml(title);
    const safeUrl = escapeHtml(url);
    return [
      '<div style="max-width:560px;margin:12px 0;padding:16px 18px;border:1px solid #2f6b45;border-radius:12px;background:#0f2a1c;color:#f5fff8;font-family:Arial,sans-serif;">',
      `<div style="font-size:12px;letter-spacing:.06em;opacity:.75;margin-bottom:6px;">JEONBUK MATCH REPORT</div>`,
      `<div style="font-size:18px;font-weight:700;line-height:1.35;margin-bottom:10px;">${safeTitle}</div>`,
      `<div style="font-size:13px;line-height:1.55;opacity:.9;margin-bottom:14px;">골 장면 · 히트맵 · xG를 한 화면에서 볼 수 있습니다.</div>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#b7f24a;color:#0a2218;font-weight:700;text-decoration:none;">리포트 새 창에서 보기 →</a>`,
      "</div>",
    ].join("");
  }

  function setupCommunityEmbed() {
    if (document.body.classList.contains("embed-mode")) return;
    if (!document.body.classList.contains("edit-mode")) return;
    const reportUrl = publicReportUrl();
    const embedSrc = embedSrcUrl();
    const embedHtml = buildEmbedHtml(embedSrc);
    const shareHtml = buildShareHtml(reportUrl);

    if ($("reportUrl")) {
      $("reportUrl").textContent = reportUrl;
      $("reportUrl").href = reportUrl;
    }
    if ($("shareCode")) $("shareCode").textContent = shareHtml;
    if ($("embedCode")) $("embedCode").textContent = embedHtml;
    if ($("embedPreview")) {
      const gameId = state.data?.meta?.game_id || "131";
      const localEmbed = `./index.html?game=${encodeURIComponent(gameId)}&embed=1`;
      const nextSrc = /localhost|127\.0\.0\.1/i.test(window.location.hostname)
        ? localEmbed
        : embedSrc;
      if ($("embedPreview").getAttribute("src") !== nextSrc) {
        $("embedPreview").src = nextSrc;
      }
    }
  }

  function weatherIconSvg(weatherText) {
    const t = String(weatherText || "");
    if (/비|소나기|우천/.test(t)) {
      return `<svg class="weather-icon" viewBox="0 0 48 48" aria-hidden="true"><circle cx="18" cy="18" r="8" fill="#8ec5ff"/><path d="M14 28c-5 0-9 3.2-9 7.2S9 42 14 42h18c4.4 0 8-2.9 8-6.5S36.4 29 32 29c-.6-4.8-4.8-8.5-9.9-8.5-2.8 0-5.3 1.1-7.1 2.9" fill="#cfe7ff"/><path d="M16 34v8M24 33v9M32 34v8" stroke="#4d7fb8" stroke-width="3" stroke-linecap="round"/></svg>`;
    }
    if (/눈|설/.test(t)) {
      return `<svg class="weather-icon" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="5" fill="#d9ecff"/><path d="M24 10v28M10 24h28M14 14l20 20M34 14L14 34" stroke="#7eb6e8" stroke-width="3" stroke-linecap="round"/></svg>`;
    }
    if (/맑|쾌청|맑음/.test(t)) {
      return `<svg class="weather-icon" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="9" fill="#ffcc33"/><path d="M24 6v5M24 37v5M6 24h5M37 24h5M11 11l3.5 3.5M33.5 33.5L37 37M37 11l-3.5 3.5M14.5 33.5L11 37" stroke="#f0a800" stroke-width="3" stroke-linecap="round"/></svg>`;
    }
    if (/안개|박무/.test(t)) {
      return `<svg class="weather-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M8 18h32M6 24h36M10 30h28" stroke="#9aa7b2" stroke-width="4" stroke-linecap="round"/></svg>`;
    }
    // cloudy / default (흐림)
    return `<svg class="weather-icon" viewBox="0 0 48 48" aria-hidden="true"><path d="M16 34c-5.5 0-10-3.6-10-8s4.5-8 10-8c1.4-4.8 6-8.2 11.4-8.2 6.6 0 12 4.7 12.5 11.1C44 21.4 47 25 47 29.2 47 34 43 38 37.5 38H16z" fill="#9eb0bf"/></svg>`;
  }

  function buildMatchFacts(meta, index) {
    const groups = [];
    const makeFact = (label, valueHtml, rawCheck) => {
      const check = rawCheck !== undefined ? rawCheck : valueHtml;
      if (check === null || check === undefined || check === "") return "";
      return `<div class="fact"><span class="fact-label">${escapeHtml(label)}</span><span class="fact-value">${valueHtml}</span></div>`;
    };
    const pushGroup = (title, items) => {
      const html = items.filter(Boolean).join("");
      if (!html) return;
      groups.push(
        `<div class="fact-group"><div class="fact-group-title">${escapeHtml(title)}</div><div class="fact-group-body">${html}</div></div>`
      );
    };

    const weatherText = meta.weather || (meta.temperature_c != null ? `${meta.temperature_c}℃` : "");
    const weatherHtml = weatherText
      ? `<span class="fact-weather">${weatherIconSvg(weatherText)}<span>${escapeHtml(weatherText)}</span></span>`
      : "";

    pushGroup("경기 정보", [
      makeFact("경기장", escapeHtml(meta.venue || ""), meta.venue),
      makeFact("킥오프", escapeHtml(meta.kickoff || ""), meta.kickoff),
      makeFact("날씨", weatherHtml, weatherText),
      makeFact(
        "습도",
        escapeHtml(meta.humidity != null && meta.humidity !== "" ? `${meta.humidity}%` : ""),
        meta.humidity != null && meta.humidity !== "" ? meta.humidity : ""
      ),
    ]);

    const crowdItems = [];
    if (meta.attendance != null && meta.attendance !== "") {
      crowdItems.push(
        makeFact("관중", escapeHtml(`${Number(meta.attendance).toLocaleString("ko-KR")}명`), meta.attendance)
      );
    }
    const att = Analyze.attendanceCompare(meta, index || state.index);
    if (att.available) {
      const sign = att.diff > 0 ? "+" : "";
      crowdItems.push(
        makeFact(
          att.baselineLabel,
          escapeHtml(
            `${att.baseline.toLocaleString("ko-KR")}명 (${sign}${att.diff.toLocaleString("ko-KR")} / ${sign}${att.pct}%)`
          ),
          att.baseline
        )
      );
    }
    pushGroup("관중", crowdItems);

    const off = meta.officials || {};
    pushGroup("심판", [
      makeFact("주심", escapeHtml(meta.referee || ""), meta.referee),
      makeFact("부심1", escapeHtml(off.ar1 || ""), off.ar1),
      makeFact("부심2", escapeHtml(off.ar2 || ""), off.ar2),
      makeFact("대기심", escapeHtml(off.fourth || ""), off.fourth),
      makeFact("VAR", escapeHtml(off.var || ""), off.var),
      makeFact("AVAR", escapeHtml(off.avar || ""), off.avar),
    ]);

    pushGroup("감독", [
      makeFact(
        meta.home?.name ? `${meta.home.name} 감독` : "홈 감독",
        escapeHtml(meta.home?.manager || ""),
        meta.home?.manager
      ),
      makeFact(
        meta.away?.name ? `${meta.away.name} 감독` : "원정 감독",
        escapeHtml(meta.away?.manager || ""),
        meta.away?.manager
      ),
    ]);

    return groups.join("");
  }

  function renderPeriodFlow(meta, events) {
    const homeId = meta.home.team_id;
    const awayId = meta.away.team_id;
    const periods = Analyze.periodStats(events, homeId, awayId);
    const flow = Analyze.flowAfterFirstGoal(events, homeId, awayId);

    if ($("periodBox")) {
      $("periodBox").innerHTML = [1, 2]
        .map((p) => {
          const h = periods[p][homeId];
          const a = periods[p][awayId];
          const title = p === 1 ? "전반" : "후반";
          return `<div class="flow-card">
            <div class="flow-card-title">${title}</div>
            <div class="flow-metric"><span>xG</span><strong>${h.xg} : ${a.xg}</strong></div>
            <div class="flow-metric"><span>슈팅</span><strong>${h.shots} : ${a.shots}</strong></div>
            <div class="flow-metric"><span>유효</span><strong>${h.sot} : ${a.sot}</strong></div>
            <div class="flow-metric"><span>골</span><strong>${h.goals} : ${a.goals}</strong></div>
            <div class="flow-metric"><span>패스성공</span><strong>${h.passOk}/${h.passes} : ${a.passOk}/${a.passes}</strong></div>
          </div>`;
        })
        .join("");
    }

    if (!$("flowBox")) return;
    if (!flow.hasFirstGoal) {
      $("flowBox").innerHTML = `<p class="flow-note">${escapeHtml(flow.text)}</p>`;
      return;
    }
    const scorer =
      flow.scorerSide === "home" ? meta.home.name : meta.away.name;
    const pmap = Analyze.playerMap(state.data.players);
    const scorerName = Analyze.nameOf(pmap, flow.firstGoal.PLAYER_ID);
    const bh = flow.before[homeId];
    const ba = flow.before[awayId];
    const ah = flow.after[homeId];
    const aa = flow.after[awayId];
    $("flowBox").innerHTML = `
      <div class="flow-note">
        선제골: <strong>${escapeHtml(flow.clock)}</strong>
        ${escapeHtml(scorer)} · ${escapeHtml(scorerName)}
      </div>
      <div class="flow-grid">
        <div class="flow-card">
          <div class="flow-card-title">선제골 이전</div>
          <div class="flow-metric"><span>xG</span><strong>${bh.xg} : ${ba.xg}</strong></div>
          <div class="flow-metric"><span>슈팅</span><strong>${bh.shots} : ${ba.shots}</strong></div>
          <div class="flow-metric"><span>골</span><strong>${bh.goals} : ${ba.goals}</strong></div>
        </div>
        <div class="flow-card">
          <div class="flow-card-title">선제골 포함 이후</div>
          <div class="flow-metric"><span>xG</span><strong>${ah.xg} : ${aa.xg}</strong></div>
          <div class="flow-metric"><span>슈팅</span><strong>${ah.shots} : ${aa.shots}</strong></div>
          <div class="flow-metric"><span>골</span><strong>${ah.goals} : ${aa.goals}</strong></div>
        </div>
      </div>`;
  }

  function renderLineup(meta, lineup) {
    const sides = Analyze.lineupSides(lineup);
    if ($("homeLineupTitle")) $("homeLineupTitle").textContent = `${meta.home.name} 선발`;
    if ($("awayLineupTitle")) $("awayLineupTitle").textContent = `${meta.away.name} 선발`;

    const renderTeam = (rows) => {
      const starters = rows.filter((p) => p.starter);
      const bench = rows.filter((p) => !p.starter);
      const line = (p) => {
        const bits = [];
        if (p.captain) bits.push("C");
        if (p.yellow) bits.push(`경고${p.yellow}`);
        if (p.red) bits.push("퇴장");
        if (p.in_label) bits.push(`IN ${p.in_label}`);
        if (p.out_label) bits.push(`OUT ${p.out_label}`);
        if (p.minutes != null) bits.push(`${p.minutes}'`);
        return `<div class="lineup-row">
          <span class="ln-no">${escapeHtml(String(p.back_no ?? "-"))}</span>
          <span class="ln-pos">${escapeHtml(p.position || "")}</span>
          <span class="ln-name">${escapeHtml(p.name || "")}</span>
          <span class="ln-meta">${escapeHtml(bits.join(" · ") || "—")}</span>
        </div>`;
      };
      return (
        `<div class="lineup-starters">${starters.map((p) => line(p)).join("")}</div>` +
        (bench.length
          ? `<div class="lineup-bench-label">벤치 · 투입</div><div class="lineup-bench">${bench
              .map((p) => line(p))
              .join("")}</div>`
          : `<div class="lineup-bench-label">벤치 · 투입</div><div class="lineup-bench lineup-bench-empty">투입 선수 없음</div>`)
      );
    };

    if ($("homeLineup")) {
      $("homeLineup").innerHTML = sides.home.length
        ? renderTeam(sides.home)
        : `<div class="meta-line">라인업 데이터가 없습니다.</div>`;
    }
    if ($("awayLineup")) {
      $("awayLineup").innerHTML = sides.away.length
        ? renderTeam(sides.away)
        : `<div class="meta-line">라인업 데이터가 없습니다.</div>`;
    }
    if ($("subList")) {
      if (!sides.subs.length) {
        $("subList").innerHTML = `<div class="meta-line">교체 기록이 없거나 아직 수집되지 않았습니다.</div>`;
      } else {
        const fmtSwap = (s) => {
          if (!s) return "";
          const outP = s.player_out ? `#${s.player_out.back_no ?? "-"} ${s.player_out.name}` : "OUT ?";
          const inP = s.player_in ? `#${s.player_in.back_no ?? "-"} ${s.player_in.name}` : "IN ?";
          return `${outP} → ${inP}`;
        };
        const byTime = new Map();
        for (const s of sides.subs) {
          const key = s.time_label || `${s.period || "?"}-${s.minute ?? "?"}`;
          if (!byTime.has(key)) {
            byTime.set(key, {
              time: key,
              period: s.period,
              minute: s.minute,
              home: null,
              away: null,
            });
          }
          const slot = byTime.get(key);
          if (s.ha === "H" || s.team_id === meta.home.team_id) slot.home = s;
          else slot.away = s;
        }
        const slots = [...byTime.values()].sort((a, b) => {
          const pa = a.period || 9;
          const pb = b.period || 9;
          if (pa !== pb) return pa - pb;
          return (a.minute ?? 99) - (b.minute ?? 99);
        });
        $("subList").innerHTML = `<div class="sub-timeline">${slots
          .map((slot) => {
            const homeHtml = slot.home
              ? `<div class="sub-slot-side"><span class="sub-slot-team">${escapeHtml(
                  meta.home.name
                )}</span><span class="sub-slot-swap">${escapeHtml(fmtSwap(slot.home))}</span></div>`
              : `<div class="sub-slot-side is-empty">${escapeHtml(meta.home.name)} 교체 없음</div>`;
            const awayHtml = slot.away
              ? `<div class="sub-slot-side"><span class="sub-slot-team">${escapeHtml(
                  meta.away.name
                )}</span><span class="sub-slot-swap">${escapeHtml(fmtSwap(slot.away))}</span></div>`
              : `<div class="sub-slot-side is-empty">${escapeHtml(meta.away.name)} 교체 없음</div>`;
            return `<div class="sub-slot">
              <div class="sub-slot-time">${escapeHtml(slot.time)}</div>
              ${homeHtml}
              ${awayHtml}
            </div>`;
          })
          .join("")}</div>`;
      }
    }
  }

  function kpi(label, home, away, sub) {
    return `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(
      String(home)
    )} <span style="color:#5d7268;font-size:16px">:</span> ${escapeHtml(String(away))}</div><div class="sub">${escapeHtml(
      sub
    )}</div></div>`;
  }

  function bar(label, home, away) {
    const max = Math.max(Number(home) || 0, Number(away) || 0, 0.01);
    const hl = Math.round((Number(home) / max) * 100);
    const al = Math.round((Number(away) / max) * 100);
    return `<div class="bar-row">
      <div class="num-home">${escapeHtml(String(home))}</div>
      <div>
        <div class="metric">${escapeHtml(label)}</div>
        <div class="bar-track">
          <div class="bar-half left"><div class="bar-home" style="width:${hl}%"></div></div>
          <div class="bar-half right"><div class="bar-away" style="width:${al}%"></div></div>
        </div>
      </div>
      <div class="num-away">${escapeHtml(String(away))}</div>
    </div>`;
  }

  function renderGoals(goalList, pmap, meta) {
    const box = $("goalList");
    if (!goalList.length) {
      box.innerHTML = "<div class='meta'>골 이벤트가 없습니다.</div>";
      return;
    }
    if (state.selectedGoalIdx >= goalList.length) state.selectedGoalIdx = 0;

    box.innerHTML = goalList
      .map((g, i) => {
        const nm = Analyze.nameOf(pmap, g.PLAYER_ID);
        const team = g.TEAM_ID === meta.home.team_id ? meta.home.name : meta.away.name;
        const pk = g.TYPE_DETAIL_CD2 === "PK" ? " · PK" : "";
        return `<button class="goal-card ${i === state.selectedGoalIdx ? "active" : ""}" data-idx="${i}">
          <div class="top"><span>${escapeHtml(Analyze.formatClock(g))} ${escapeHtml(team)}</span><span>xG ${Number(
          g.EXPECTED_GOAL || 0
        ).toFixed(2)}</span></div>
          <div class="meta">${escapeHtml(nm)}${pk} · #${escapeHtml(String(g.back_no || ""))}</div>
        </button>`;
      })
      .join("");

    box.querySelectorAll(".goal-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedGoalIdx = Number(btn.getAttribute("data-idx"));
        renderGoals(goalList, pmap, meta);
      });
    });

    const goal = goalList[state.selectedGoalIdx];
    const seq = Analyze.sequenceBeforeGoal(state.data.events, goal, 28);
    const points = seq.map((e) => Pitch.normalizePoint(e, meta.home.team_id));

    $("goalSeq").innerHTML = seq
      .map((e, i) => {
        const label = Analyze.DETAIL[e.TYPE_DETAIL_CD] || e.TYPE_CD || "액션";
        const nm = Analyze.nameOf(pmap, e.PLAYER_ID);
        return `<div class="seq-step"><div class="n">${i + 1}</div><div class="body"><strong>${escapeHtml(
          nm
        )}</strong> · ${escapeHtml(label)}<br><span style="color:#5d7268;font-size:12px">${escapeHtml(
          Analyze.formatClock(e)
        )}</span></div></div>`;
      })
      .join("");

    Pitch.render($("goalCanvas"), {
      mode: "sequence",
      points,
      homeTeamId: meta.home.team_id,
    });
  }

  function renderPlayers(events, players, meta) {
    const posOrder = { GK: 0, DF: 1, MF: 2, FW: 3 };
    const ranked = Analyze.rankPlayers(events, players, meta.home.team_id)
      .filter((p) => {
        if (state.teamFilter === "home") return p.team_id === meta.home.team_id;
        if (state.teamFilter === "away") return p.team_id === meta.away.team_id;
        return true;
      })
      .sort((a, b) => {
        const pa = posOrder[String(a.pos || "").toUpperCase()] ?? 8;
        const pb = posOrder[String(b.pos || "").toUpperCase()] ?? 8;
        if (pa !== pb) return pa - pb;
        const na = Number(a.back_no);
        const nb = Number(b.back_no);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
        return String(a.name || "").localeCompare(String(b.name || ""), "ko");
      });

    if (!state.selectedPlayerId && ranked[0]) state.selectedPlayerId = ranked[0].player_id;

    $("playerList").innerHTML = ranked
      .map((p) => {
        return `<button class="player-btn ${String(p.player_id) === String(state.selectedPlayerId) ? "active" : ""}" data-id="${
          p.player_id
        }" type="button">
          <div class="top">
            <span>#${escapeHtml(String(p.back_no))} ${escapeHtml(p.name)}</span>
            <span class="player-stat">${p.touches}</span>
          </div>
          <div class="meta">${escapeHtml(p.pos || "-")} · ${p.passOk}/${p.passes} · 슈팅 ${p.shots}</div>
        </button>`;
      })
      .join("");

    $("playerList").querySelectorAll(".player-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedPlayerId = btn.getAttribute("data-id");
        renderPlayers(events, players, meta);
      });
    });

    const pev = Analyze.playerEvents(events, state.selectedPlayerId, state.eventFilter);
    const points = pev.map((e) => {
      const pt = Pitch.normalizePoint(e, meta.home.team_id);
      const action = Analyze.DETAIL[e.TYPE_DETAIL_CD] || e.TYPE_CD || "액션";
      pt.label = Analyze.formatClock(e);
      pt.detail = action;
      return pt;
    });
    Pitch.render($("playerCanvas"), {
      mode: "heat",
      points,
      homeTeamId: meta.home.team_id,
      heatColor: state.teamFilter === "away" ? "rgba(228,87,46,0.35)" : "rgba(214,245,106,0.35)",
      hover: true,
    });

    const p = ranked.find((x) => String(x.player_id) === String(state.selectedPlayerId));
    $("playerCaption").textContent = p
      ? `${p.name} · 이벤트 ${p.touches} · 포인트에 마우스를 올리면 시간 표시 · 필터 ${state.eventFilter}`
      : "선수를 선택하세요";

    // Update team button labels from meta
    const homeBtn = document.querySelector('[data-team="home"]');
    const awayBtn = document.querySelector('[data-team="away"]');
    if (homeBtn) homeBtn.textContent = meta.home.name || "홈";
    if (awayBtn) awayBtn.textContent = meta.away.name || "원정";
  }

  function renderShotMap() {
    const { meta, events } = state.data;
    const shots = events.filter((e) => e.TYPE_CD === "ST");
    Pitch.render($("shotCanvas"), {
      mode: "shots",
      shots,
      homeTeamId: meta.home.team_id,
    });
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])
    );
  }

  function bindUi() {
    document.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.eventFilter = btn.getAttribute("data-filter");
        if (state.data) renderPlayers(state.data.events, state.data.players, state.data.meta);
      });
    });

    document.querySelectorAll("[data-team]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-team]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.teamFilter = btn.getAttribute("data-team");
        state.selectedPlayerId = null;
        if (state.data) renderPlayers(state.data.events, state.data.players, state.data.meta);
      });
    });

    $("fetchBtn")?.addEventListener("click", fetchAndLoad);
    $("yearSelect")?.addEventListener("change", () => {
      rebuildRounds();
    });
    $("roundSelect")?.addEventListener("change", updateMatchHelp);

    const copyShareBtn = $("copyShare");
    if (copyShareBtn) {
      copyShareBtn.addEventListener("click", async () => {
        try {
          const text = $("shareCode")?.textContent || buildShareHtml(publicReportUrl());
          await navigator.clipboard.writeText(text);
          copyShareBtn.textContent = "링크 카드 복사됨";
          setTimeout(() => {
            copyShareBtn.textContent = "링크 카드 복사";
          }, 1400);
        } catch (err) {
          setStatus("클립보드 복사에 실패했습니다. 코드를 직접 드래그해 복사하세요.", true);
        }
      });
    }

    const copyEmbedBtn = $("copyEmbed");
    if (copyEmbedBtn) {
      copyEmbedBtn.addEventListener("click", async () => {
        try {
          const text = $("embedCode")?.textContent || buildEmbedHtml(embedSrcUrl());
          await navigator.clipboard.writeText(text);
          copyEmbedBtn.textContent = "iframe HTML 복사됨";
          setTimeout(() => {
            copyEmbedBtn.textContent = "iframe HTML 복사";
          }, 1400);
        } catch (err) {
          setStatus("클립보드 복사에 실패했습니다. 코드를 직접 드래그해 복사하세요.", true);
        }
      });
    }

    const copyUrlBtn = $("copyUrl");
    if (copyUrlBtn) {
      copyUrlBtn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(publicReportUrl());
          copyUrlBtn.textContent = "URL 복사됨";
          setTimeout(() => {
            copyUrlBtn.textContent = "URL만 복사";
          }, 1400);
        } catch (err) {
          setStatus("링크 복사에 실패했습니다.", true);
        }
      });
    }

    window.addEventListener("resize", () => {
      if (!state.data) return;
      try {
        renderAll();
      } catch (err) {
        console.error(err);
      }
    });
  }

  async function boot() {
    applyViewMode();
    bindUi();
    try {
      await loadIndex(false);
      const year = $("yearSelect")?.value;
      const round = $("roundSelect")?.value;
      const match = matchForRound(year, round);
      if (match) {
        await loadMatch(match.file || `./data/${match.game_id}.json`);
      } else if (document.body.classList.contains("edit-mode")) {
        setStatus("선택한 라운드 데이터가 아직 없습니다. 데이터 가져오기를 눌러 주세요.", true);
      } else {
        setStatus("이 경기 리포트 데이터가 아직 없습니다.", true);
      }
    } catch (err) {
      console.error(err);
      setStatus("경기 목록을 불러오지 못했습니다.\n" + String(err.message || err), true);
    }
  }

  boot();
})();
