/* c_report app bootstrap */

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    index: null,
    clubAttendance: null,
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

  /** K League portal public emblem (team_id e.g. K05). */
  function emblemUrl(teamId) {
    if (!teamId) return "";
    const id = String(teamId).toLowerCase();
    return `https://portal.kleague.com/images/portal/img-emble-${id}-sm.png`;
  }

  function setEmblem(imgEl, teamId, teamName) {
    if (!imgEl) return;
    if (!teamId) {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
      imgEl.alt = "";
      return;
    }
    imgEl.alt = teamName ? `${teamName} 엠블럼` : "팀 엠블럼";
    imgEl.onerror = () => {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
    };
    imgEl.hidden = false;
    imgEl.src = emblemUrl(teamId);
  }

  function emblemImgHtml(teamId, teamName) {
    if (!teamId) return "";
    const alt = escapeHtml(teamName ? `${teamName} 엠블럼` : "팀 엠블럼");
    const src = escapeHtml(emblemUrl(teamId));
    return `<img class="team-emblem" src="${src}" alt="${alt}" width="28" height="28" decoding="async" onerror="this.hidden=true" />`;
  }

  /*
   * Public share links must not advertise that a game id or an editor switch
   * lives in the query string. Keys and values below are deliberately opaque;
   * the numeric portal id is XOR-mixed into base36 so "?q=hql" reveals nothing
   * useful to a casual reader. Edit/embed tokens are not the literal "1".
   */
  const URL_Q = {
    match: "q",
    edit: "x",
    embed: "f",
  };
  const EDIT_TOKEN = "jb7k";
  const EMBED_TOKEN = "y";
  const MATCH_XOR = 0x5a3c;

  function encodeMatchRef(gameId) {
    const n = Number(gameId);
    if (!Number.isFinite(n) || n <= 0) return "";
    return (Math.trunc(n) ^ MATCH_XOR).toString(36);
  }

  function decodeMatchRef(ref) {
    if (ref == null || ref === "") return "";
    const raw = String(ref).trim().toLowerCase();
    if (!/^[0-9a-z]+$/.test(raw)) return "";
    const n = parseInt(raw, 36);
    if (!Number.isFinite(n)) return "";
    const id = n ^ MATCH_XOR;
    if (!Number.isFinite(id) || id <= 0) return "";
    return String(id);
  }

  function queryParams() {
    return new URLSearchParams(window.location.search);
  }

  function queryGameId() {
    const params = queryParams();
    const fromOpaque = decodeMatchRef(params.get(URL_Q.match));
    if (fromOpaque) return fromOpaque;
    /* Legacy bookmarks only — never written back into the address bar. */
    return params.get("game") || params.get("game_id") || "";
  }

  function isEditQuery(params) {
    const p = params || queryParams();
    return p.get(URL_Q.edit) === EDIT_TOKEN || p.get("edit") === "1";
  }

  function isEmbedQuery(params) {
    const p = params || queryParams();
    return p.get(URL_Q.embed) === EMBED_TOKEN || p.get("embed") === "1";
  }

  const MAX_ROUNDS = 38;

  async function loadClubAttendance(bust = false) {
    const url = bust ? `./data/club-attendance.json?t=${Date.now()}` : "./data/club-attendance.json";
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        state.clubAttendance = null;
        return;
      }
      const data = await res.json();
      if (!data || !Array.isArray(data.clubs)) {
        state.clubAttendance = null;
        return;
      }
      state.clubAttendance = data;
    } catch (err) {
      state.clubAttendance = null;
    }
  }

  async function loadIndex(bust = false) {
    const url = bust ? `./data/index.json?t=${Date.now()}` : "./data/index.json";
    const [res] = await Promise.all([
      fetch(url, { cache: "no-store" }),
      loadClubAttendance(bust),
    ]);
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
    const params = queryParams();
    const ref = encodeMatchRef(gameId);
    if (!ref) return;
    const next = new URLSearchParams();
    next.set(URL_Q.match, ref);
    if (isEmbedQuery(params)) next.set(URL_Q.embed, EMBED_TOKEN);
    if (isEditQuery(params)) next.set(URL_Q.edit, EDIT_TOKEN);
    const qs = next.toString();
    const path = window.location.pathname;
    window.history.replaceState({}, "", `${path}?${qs}`);
  }

  function applyViewMode() {
    const params = queryParams();
    document.body.classList.remove("embed-mode", "edit-mode", "viewer-mode");
    if (isEmbedQuery(params)) {
      document.body.classList.add("embed-mode");
      return;
    }
    if (isEditQuery(params)) {
      document.body.classList.add("edit-mode");
      return;
    }
    document.body.classList.add("viewer-mode");
  }

  /* Repaint the whole report in the two clubs' own colours. */
  function applyTeamColors(meta) {
    if (typeof TeamColors === "undefined") return null;
    try {
      state.palette = TeamColors.apply(meta?.home, meta?.away);
    } catch (err) {
      console.error(err);
      state.palette = null;
    }
    return state.palette;
  }

  function sideColor(side, key) {
    const p = state.palette?.[side === "away" ? "away" : "home"];
    if (!p) return side === "away" ? "#e4572e" : "#0f6b4c";
    return p[key] || p.base;
  }

  /*
   * Every shared pitch is normalised to "home attacks right", which is invisible
   * to the reader unless we say so on the canvas itself.
   */
  function pitchDirection(meta) {
    return {
      right: { label: `${meta?.home?.name || "홈"} 공격`, color: sideColor("home", "pitch") },
      left: { label: `${meta?.away?.name || "원정"} 공격`, color: sideColor("away", "pitch") },
    };
  }

  function renderAll() {
    const { meta, events, players } = state.data;
    applyTeamColors(meta);
    const pmap = Analyze.playerMap(players);
    const stats = Analyze.teamStats(events, meta.home.team_id, meta.away.team_id);
    const goalList = Analyze.goals(events);

    if ($("heroCopy")) {
      $("heroCopy").innerHTML =
        `${escapeHtml(meta.competition || "")} ${escapeHtml(String(meta.round || ""))}라운드 · ` +
        `${escapeHtml(meta.home.name)} vs ${escapeHtml(meta.away.name)}<br />` +
        "스코어만 보면 아쉽고, 숫자만 보면 어렵습니다. 골이 어떻게 나왔는지, 누가 어디서 뛰었는지를 이야기로 풀어 드립니다.";
    }
    document.title = `전북 매치 리포트 | ${meta.home.name} vs ${meta.away.name}`;

    $("homeName").textContent = meta.home.name;
    $("awayName").textContent = meta.away.name;
    setEmblem($("homeEmblem"), meta.home.team_id, meta.home.name);
    setEmblem($("awayEmblem"), meta.away.team_id, meta.away.name);
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
    const att = Analyze.attendanceCompare(meta, state.index, state.clubAttendance);

    const homeName = meta.home.name || "홈";
    const awayName = meta.away.name || "원정";
    if ($("statsSub")) {
      $("statsSub").textContent =
        `왼쪽이 ${homeName}, 오른쪽이 ${awayName}입니다. ` +
        `xG(같은 자리에서 100번 때리면 약 몇 골인가)가 높으면 더 좋은 기회를 만들었다는 뜻입니다.`;
    }
    if ($("statsMatchup")) {
      $("statsMatchup").innerHTML =
        `<span class="matchup-team home">${emblemImgHtml(meta.home.team_id, homeName)}` +
        `<strong>${escapeHtml(homeName)}</strong></span>` +
        `<span class="matchup-vs">VS</span>` +
        `<span class="matchup-team away"><strong>${escapeHtml(awayName)}</strong>` +
        `${emblemImgHtml(meta.away.team_id, awayName)}</span>`;
    }

    $("kpiGrid").innerHTML = [
      kpi("xG", h.xg, a.xg, "xG(같은 자리에서 100번 때리면 약 몇 골인가)"),
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
    const briefing = Analyze.buildTacticalBriefing(meta, events, players, state.data.lineup);
    if (briefing?.metrics?.state?.thesis) {
      story.push({
        label: "한줄",
        text: briefing.metrics.state.thesis,
      });
      story.push({
        label: "그림",
        text: briefing.metrics.state.structure,
      });
    } else if (h.xg > a.xg && meta.score.home < meta.score.away) {
      story.push({
        label: "한줄",
        text: `전북의 xG(골이 될 확률 합) ${h.xg}가 상대 ${a.xg}보다 높았습니다. 기회는 더 좋았지만 스코어는 ${meta.score.home}-${meta.score.away}입니다. 상대는 넣었고, 우리는 마무리가 아쉬웠습니다.`,
      });
    } else {
      story.push({
        label: "한줄",
        text: `최종 스코어 ${meta.score.home}-${meta.score.away}. 슈팅 ${h.shots}-${a.shots}, xG(골이 될 확률 합) ${h.xg}-${a.xg}. 전반 xG 합 ${periods[1][meta.home.team_id].xg}-${periods[1][meta.away.team_id].xg}, 후반 ${periods[2][meta.home.team_id].xg}-${periods[2][meta.away.team_id].xg}.`,
      });
    }
    if (flow.hasFirstGoal) {
      const scorer = flow.scorerSide === "home" ? meta.home.name : meta.away.name;
      story.push({
        label: "흐름",
        text: `선제골은 ${flow.clock}, ${scorer}입니다. 이후 xG(골이 될 확률 합)은 ${flow.after[meta.home.team_id].xg} 대 ${flow.after[meta.away.team_id].xg}, 슈팅은 ${flow.after[meta.home.team_id].shots} 대 ${flow.after[meta.away.team_id].shots}입니다.`,
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
        label: "읽는 법",
        text: "아래부터는 그날 경기를 처음부터 끝까지 이야기로 따라갑니다. 공을 어디에 뒀는지, 슈팅이 얼마나 좋은 자리였는지, 누가 경기를 이끌었는지를 쉬운 말로 풀어 드립니다. 숫자 옆에 ‘그래서 뭐가 달라졌는지’가 같이 나옵니다.",
      });
    $("storyBox").innerHTML = story
      .map(
        (s) =>
          `<div class="story-item"><div class="story-label">${escapeHtml(s.label)}</div><div>${escapeHtml(
            s.text
          )}</div></div>`
      )
      .join("");

    renderBriefing(briefing);
    renderPeriodFlow(meta, events);
    renderLineup(meta, state.data.lineup);
    renderGoals(goalList, pmap, meta);
    renderPlayers(events, players, meta);
    renderShotMap();
    renderDeepDive(meta, events, players, state.data.lineup);
    setupCommunityEmbed();
    if (typeof Outline !== "undefined") Outline.refresh();
  }

  function publicReportUrl() {
    const canonicalBase = "https://wanju1109.github.io/jeonbuk-lineup/c_report/index.html";
    const gameId = state.data?.meta?.game_id || queryGameId() || "131";
    const ref = encodeMatchRef(gameId);
    const current = window.location.href.split("#")[0].split("?")[0];
    const base = /wanju1109\.github\.io/i.test(current) ? current : canonicalBase;
    if (!ref) return base;
    return `${base}?${URL_Q.match}=${encodeURIComponent(ref)}`;
  }

  function embedSrcUrl() {
    const report = publicReportUrl();
    const join = report.includes("?") ? "&" : "?";
    return `${report}${join}${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
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
      '<div bgcolor="#ffffff" style="max-width:560px;margin:0;padding:14px 16px 8px;background:#ffffff;color:#1a1a1a;color-scheme:light;font-family:Arial,sans-serif;">',
      '<p style="margin:0 0 14px;font-size:14px;line-height:1.75;color:#1a1a1a;background:#ffffff;-webkit-text-fill-color:#1a1a1a;">',
      "AI를 활용하여 작성한 REPORT 입니다.<br>",
      "칼럼/분석 탭을 누르면 미래의 분석관을 꿈꾸는 분들께서 작성한, 재미있고 상세한 분석 글들이 많이 있습니다.<br>",
      "AI는 잘못된 정보를 전달할 수 있습니다. 무조건 적인 신뢰 보다는 적당한 선에서 비판적인 시선으로 봐주세요.",
      "</p>",
      '<div bgcolor="#0f2a1c" style="margin:0 0 8px;padding:16px 18px;border:1px solid #2f6b45;border-radius:12px;background:#0f2a1c;color:#f5fff8;color-scheme:dark;">',
      `<div style="font-size:12px;letter-spacing:.06em;opacity:.75;margin-bottom:6px;color:#f5fff8;-webkit-text-fill-color:#f5fff8;">JEONBUK MATCH AI REPORT</div>`,
      `<div style="font-size:18px;font-weight:700;line-height:1.35;margin-bottom:10px;color:#f5fff8;-webkit-text-fill-color:#f5fff8;">${safeTitle}</div>`,
      `<div style="font-size:13px;line-height:1.55;opacity:.9;margin-bottom:14px;color:#f5fff8;-webkit-text-fill-color:#f5fff8;">골 장면 · 히트맵 · xG를 한 화면에서 볼 수 있습니다.</div>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#b7f24a;color:#0a2218;-webkit-text-fill-color:#0a2218;font-weight:700;text-decoration:none;">리포트 새 창에서 보기 →</a>`,
      "</div>",
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
      const ref = encodeMatchRef(gameId);
      const localEmbed = `./index.html?${URL_Q.match}=${encodeURIComponent(ref)}&${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
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
    const att = Analyze.attendanceCompare(meta, index || state.index, state.clubAttendance);
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

  function flowMetricRows(homeName, awayName, rows) {
    const head = `<div class="flow-head">
      <span class="flow-label"></span>
      <span class="flow-home-h">${escapeHtml(homeName)}</span>
      <span class="flow-sep" aria-hidden="true"></span>
      <span class="flow-away-h">${escapeHtml(awayName)}</span>
    </div>`;
    const body = rows
      .map(
        ([label, homeVal, awayVal]) => `<div class="flow-metric">
      <span class="flow-label">${escapeHtml(label)}</span>
      <strong class="flow-home">${escapeHtml(String(homeVal))}</strong>
      <span class="flow-sep" aria-hidden="true"></span>
      <strong class="flow-away">${escapeHtml(String(awayVal))}</strong>
    </div>`
      )
      .join("");
    return head + body;
  }

  function renderBriefing(briefing) {
    const box = $("briefingBox");
    if (!box) return;
    if (!briefing?.chapters?.length) {
      box.innerHTML = `<div class="brief-card"><p class="meta-line">브리핑을 만들 수 있는 이벤트가 부족합니다.</p></div>`;
      return;
    }
    try {
      box.innerHTML = briefing.chapters
        .map((ch, i) => {
          const paras = (ch.paragraphs || [])
            .filter(Boolean)
            .map((p) => `<p>${escapeHtml(p)}</p>`)
            .join("");
          return (
            `<article class="brief-card" id="brief-${i + 1}" data-outline="${escapeHtml(
              ch.title || ""
            )}" data-kicker="${escapeHtml(ch.kicker || "")}">` +
            `<div class="brief-kicker">${escapeHtml(ch.kicker || "")}</div>` +
            `<h3 class="brief-title">${escapeHtml(ch.title || "")}</h3>` +
            `<div class="brief-body">${paras}</div>` +
            `</article>`
          );
        })
        .join("");
    } catch (err) {
      console.error(err);
      box.innerHTML = `<div class="brief-card"><p class="meta-line">브리핑 렌더링 중 오류가 발생했습니다.</p></div>`;
    }
  }

  function renderPeriodFlow(meta, events) {
    const homeId = meta.home.team_id;
    const awayId = meta.away.team_id;
    const periods = Analyze.periodStats(events, homeId, awayId);
    const flow = Analyze.flowAfterFirstGoal(events, homeId, awayId);
    const homeName = meta.home.name || "홈";
    const awayName = meta.away.name || "원정";

    if ($("periodBox")) {
      $("periodBox").innerHTML = [1, 2]
        .map((p) => {
          const h = periods[p][homeId];
          const a = periods[p][awayId];
          const title = p === 1 ? "전반" : "후반";
          return `<div class="flow-card">
            <div class="flow-card-title">${title}</div>
            ${flowMetricRows(homeName, awayName, [
              ["xG", h.xg, a.xg],
              ["슈팅", h.shots, a.shots],
              ["유효", h.sot, a.sot],
              ["골", h.goals, a.goals],
              ["패스성공", `${h.passOk}/${h.passes}`, `${a.passOk}/${a.passes}`],
            ])}
          </div>`;
        })
        .join("");
    }

    if (!$("flowBox")) return;
    if (!flow.hasFirstGoal) {
      $("flowBox").innerHTML = `<p class="flow-note">${escapeHtml(flow.text)}</p>`;
      return;
    }
    const scorer = flow.scorerSide === "home" ? homeName : awayName;
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
          ${flowMetricRows(homeName, awayName, [
            ["xG", bh.xg, ba.xg],
            ["슈팅", bh.shots, ba.shots],
            ["골", bh.goals, ba.goals],
          ])}
        </div>
        <div class="flow-card">
          <div class="flow-card-title">선제골 포함 이후</div>
          ${flowMetricRows(homeName, awayName, [
            ["xG", ah.xg, aa.xg],
            ["슈팅", ah.shots, aa.shots],
            ["골", ah.goals, aa.goals],
          ])}
        </div>
      </div>`;
  }

  function renderLineup(meta, lineup) {
    const sides = Analyze.lineupSides(lineup);
    if ($("homeLineupHead")) {
      $("homeLineupHead").innerHTML =
        `${emblemImgHtml(meta.home.team_id, meta.home.name)}` +
        `<h3 class="lineup-title" id="homeLineupTitle">${escapeHtml(meta.home.name)} 선발</h3>`;
    } else if ($("homeLineupTitle")) {
      $("homeLineupTitle").textContent = `${meta.home.name} 선발`;
    }
    if ($("awayLineupHead")) {
      $("awayLineupHead").innerHTML =
        `${emblemImgHtml(meta.away.team_id, meta.away.name)}` +
        `<h3 class="lineup-title" id="awayLineupTitle">${escapeHtml(meta.away.name)} 선발</h3>`;
    } else if ($("awayLineupTitle")) {
      $("awayLineupTitle").textContent = `${meta.away.name} 선발`;
    }

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
              home: [],
              away: [],
            });
          }
          const slot = byTime.get(key);
          if (s.ha === "H" || s.team_id === meta.home.team_id) slot.home.push(s);
          else slot.away.push(s);
        }
        const slots = [...byTime.values()].sort((a, b) => {
          const pa = a.period || 9;
          const pb = b.period || 9;
          if (pa !== pb) return pa - pb;
          return (a.minute ?? 99) - (b.minute ?? 99);
        });
        const sideBlock = (teamName, list, side) => {
          if (!list.length) {
            return `<div class="sub-slot-side is-empty" aria-hidden="true"></div>`;
          }
          return `<div class="sub-slot-side side-${side}">
            <span class="sub-slot-team">${escapeHtml(teamName)}</span>
            ${list
              .map((s) => `<span class="sub-slot-swap">${escapeHtml(fmtSwap(s))}</span>`)
              .join("")}
          </div>`;
        };
        $("subList").innerHTML = `<div class="sub-timeline">${slots
          .map((slot) => {
            return `<div class="sub-slot">
              <div class="sub-slot-time">${escapeHtml(slot.time)}</div>
              ${sideBlock(meta.home.name, slot.home, "home")}
              ${sideBlock(meta.away.name, slot.away, "away")}
            </div>`;
          })
          .join("")}</div>`;
      }
    }
  }

  function kpi(label, home, away, sub) {
    return `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">` +
      `<span class="kpi-home">${escapeHtml(String(home))}</span>` +
      `<span class="kpi-sep">:</span>` +
      `<span class="kpi-away">${escapeHtml(String(away))}</span>` +
      `</div><div class="sub">${escapeHtml(sub)}</div></div>`;
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
        const isHome = g.TEAM_ID === meta.home.team_id;
        const side = isHome ? "home" : "away";
        const team = isHome ? meta.home.name : meta.away.name;
        const pk = g.TYPE_DETAIL_CD2 === "PK" ? " · PK" : "";
        return `<button class="goal-card side-${side} ${
          i === state.selectedGoalIdx ? "active" : ""
        }" data-idx="${i}" type="button">
          <div class="top"><span class="goal-team">${escapeHtml(
            Analyze.formatClock(g)
          )} ${escapeHtml(team)}</span><span>xG ${Number(g.EXPECTED_GOAL || 0).toFixed(2)}</span></div>
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
    const goalSide = goal.TEAM_ID === meta.home.team_id ? "home" : "away";
    /* Drives the colour of the sequence numbers and pitch arrows below. */
    $("goals")?.setAttribute("data-side", goalSide);
    const seq = Analyze.sequenceBeforeGoal(state.data.events, goal, 28);
    const points = seq.map((e) => Pitch.normalizePoint(e, meta.home.team_id));

    $("goalSeq").innerHTML = seq
      .map((e, i) => {
        const label = Analyze.actionLabel(e);
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
      accent: sideColor(goalSide, "pitch"),
      direction: pitchDirection(meta),
    });
  }

  function renderPlayers(events, players, meta) {
    /* Drives the colour of the event chips, player cards and heat map. */
    $("players")?.setAttribute("data-side", state.teamFilter === "away" ? "away" : "home");
    const posOrder = { GK: 0, DF: 1, MF: 2, MD: 2, FW: 3, 대기: 4 };
    const posColumns = ["GK", "DF", "MF", "FW", "대기"];
    const ranked = Analyze.rankPlayers(events, players, meta.home.team_id)
      .filter((p) => {
        if (state.teamFilter === "home") return p.team_id === meta.home.team_id;
        if (state.teamFilter === "away") return p.team_id === meta.away.team_id;
        return true;
      })
      .sort((a, b) => {
        const pa = posOrder[String(a.pos || "").toUpperCase()] ?? 9;
        const pb = posOrder[String(b.pos || "").toUpperCase()] ?? 9;
        if (pa !== pb) return pa - pb;
        const na = Number(a.back_no);
        const nb = Number(b.back_no);
        if (!Number.isNaN(na) && !Number.isNaN(nb) && na !== nb) return na - nb;
        return String(a.name || "").localeCompare(String(b.name || ""), "ko");
      });

    if (!state.selectedPlayerId && ranked[0]) state.selectedPlayerId = ranked[0].player_id;

    const byPos = new Map();
    for (const label of posColumns) byPos.set(label, []);
    const extras = [];

    ranked.forEach((p) => {
      const raw = String(p.pos || "").trim();
      const key = raw === "MD" ? "MF" : raw.toUpperCase();
      if (byPos.has(key)) byPos.get(key).push(p);
      else extras.push(p);
    });

    const playerBtnHtml = (p) => {
      const active = String(p.player_id) === String(state.selectedPlayerId) ? " active" : "";
      return (
        `<button class="player-btn${active}" data-id="${p.player_id}" type="button">` +
        `<span class="player-name">#${escapeHtml(String(p.back_no))} ${escapeHtml(p.name)}</span>` +
        `</button>`
      );
    };

    const groups = [];
    for (const label of posColumns) {
      const list = byPos.get(label) || [];
      if (!list.length) continue;
      groups.push(
        `<div class="player-pos-group">` +
        `<div class="player-pos-label">${escapeHtml(label)}</div>` +
        `<div class="player-pos-grid">${list.map(playerBtnHtml).join("")}</div>` +
        `</div>`
      );
    }

    if (extras.length) {
      groups.push(
        `<div class="player-pos-group">` +
        `<div class="player-pos-label">기타</div>` +
        `<div class="player-pos-grid">${extras.map(playerBtnHtml).join("")}</div>` +
        `</div>`
      );
    }

    $("playerList").innerHTML = groups.join("");

    $("playerList").querySelectorAll(".player-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedPlayerId = btn.getAttribute("data-id");
        renderPlayers(events, players, meta);
      });
    });

    const pev = Analyze.playerEvents(events, state.selectedPlayerId, state.eventFilter);
    const points = pev.map((e) => {
      const pt = Pitch.normalizePoint(e, meta.home.team_id);
      const action = Analyze.actionLabel(e);
      pt.label = Analyze.formatClock(e);
      pt.detail = action;
      return pt;
    });
    Pitch.render($("playerCanvas"), {
      mode: "heat",
      points,
      homeTeamId: meta.home.team_id,
      heatColor: TeamColors.rgba(sideColor(state.teamFilter, "pitch"), 0.78),
      hover: true,
      theme: "board",
      direction: pitchDirection(meta),
    });

    const p = ranked.find((x) => String(x.player_id) === String(state.selectedPlayerId));
    $("playerCaption").textContent = p
      ? `${p.name} · 공을 만진 횟수 ${p.touches}회 · 점에 마우스를 올리면 시간이 보입니다`
      : "선수를 선택하세요";

    // Update team button labels from meta
    const homeBtn = document.querySelector('[data-team="home"]');
    const awayBtn = document.querySelector('[data-team="away"]');
    if (homeBtn) {
      homeBtn.innerHTML =
        `${emblemImgHtml(meta.home.team_id, meta.home.name)}` +
        `<span>${escapeHtml(meta.home.name || "홈")}</span>`;
    }
    if (awayBtn) {
      awayBtn.innerHTML =
        `${emblemImgHtml(meta.away.team_id, meta.away.name)}` +
        `<span>${escapeHtml(meta.away.name || "원정")}</span>`;
    }
  }

  function renderDeepDive(meta, events, players, lineup) {
    if (typeof DeepView === "undefined") return;
    try {
      const ctx = DeepView.render(meta, events, players, lineup, state.data?.pass_matrix);
      if (typeof ExpertView !== "undefined") ExpertView.render(ctx);
    } catch (err) {
      console.error(err);
      setStatus("심층 전술 분석을 만드는 중 문제가 발생했습니다.", true);
    }
  }

  function renderShotMap() {
    const { meta, events } = state.data;
    const shots = events.filter((e) => e.TYPE_CD === "ST");
    Pitch.render($("shotCanvas"), {
      mode: "shots",
      shots,
      homeTeamId: meta.home.team_id,
      homeColor: sideColor("home", "pitch"),
      awayColor: sideColor("away", "pitch"),
      direction: pitchDirection(meta),
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
    if (typeof Outline !== "undefined") Outline.refresh();
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
