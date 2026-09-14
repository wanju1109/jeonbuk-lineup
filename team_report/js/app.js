/* K League club analysis page.
 * Reader mode: browse clubs and read the generated season column.
 * Author mode (?x=jb7k): share-link builder plus a regenerate button that
 * re-reads the dossiers and rewrites the column from the newest results. */
(function () {
  "use strict";

  const CANONICAL = "https://wanju1109.github.io/jeonbuk-lineup/team_report/";
  const URL_Q = { team: "q", edit: "x", embed: "f" };
  const EDIT_TOKEN = "jb7k";
  const EMBED_TOKEN = "y";
  const TEAM_XOR = 0x3b7d;
  const DEFAULT_TEAM = "K05";

  const state = {
    index: null,
    league: "K1",
    teamId: "",
    team: null,
    column: null,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  }

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  /* ---------- url scheme ---------- */

  /* Club ids are K01..K42, so the numeric tail is what gets obfuscated. */
  function encodeTeamRef(teamId) {
    const m = /^K(\d{1,2})$/i.exec(String(teamId || "").trim());
    if (!m) return "";
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return "";
    return (n ^ TEAM_XOR).toString(36);
  }

  function decodeTeamRef(ref) {
    if (ref == null || ref === "") return "";
    const raw = String(ref).trim().toLowerCase();
    if (!/^[0-9a-z]+$/.test(raw)) return "";
    const parsed = parseInt(raw, 36);
    if (!Number.isFinite(parsed)) return "";
    const n = parsed ^ TEAM_XOR;
    if (!Number.isFinite(n) || n <= 0 || n > 99) return "";
    return `K${String(n).padStart(2, "0")}`;
  }

  function queryParams() {
    return new URLSearchParams(window.location.search);
  }

  function isEditQuery() {
    const p = queryParams();
    return p.get(URL_Q.edit) === EDIT_TOKEN || p.get("edit") === "1";
  }

  function isEmbedQuery() {
    const p = queryParams();
    return p.get(URL_Q.embed) === EMBED_TOKEN || p.get("embed") === "1";
  }

  function applyViewMode() {
    document.body.classList.remove("edit-mode", "embed-mode");
    if (isEmbedQuery()) {
      document.body.classList.add("embed-mode");
      return;
    }
    if (isEditQuery()) document.body.classList.add("edit-mode");
  }

  function publicTeamUrl(teamId) {
    const ref = encodeTeamRef(teamId || state.teamId);
    const current = window.location.href.split("#")[0].split("?")[0];
    const base = /wanju1109\.github\.io/i.test(current) ? current : CANONICAL;
    if (!ref) return base;
    return `${base}?${URL_Q.team}=${encodeURIComponent(ref)}`;
  }

  function embedSrcUrl() {
    const url = publicTeamUrl();
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
  }

  function syncUrl() {
    const ref = encodeTeamRef(state.teamId);
    if (!ref) return;
    const next = new URLSearchParams();
    next.set(URL_Q.team, ref);
    if (isEditQuery()) next.set(URL_Q.edit, EDIT_TOKEN);
    if (isEmbedQuery()) next.set(URL_Q.embed, EMBED_TOKEN);
    window.history.replaceState({}, "", `${location.pathname}?${next.toString()}`);
  }

  /* ---------- status ---------- */

  function setStatus(message, isError) {
    const el = $("status");
    if (!el) return;
    if (!message) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.className = "status" + (isError ? " error" : "");
    el.textContent = message;
  }

  /* ---------- data ---------- */

  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return res.json();
  }

  function leagueById(id) {
    return (state.index?.leagues || []).find((l) => l.id === id) || null;
  }

  function leagueTable(id) {
    return leagueById(id)?.table || [];
  }

  function findTeamRow(teamId) {
    for (const league of state.index?.leagues || []) {
      const row = (league.table || []).find((t) => t.team_id === teamId);
      if (row) return { league: league.id, row };
    }
    return null;
  }

  /* ---------- rendering: chrome ---------- */

  function bandClass(band) {
    if (/우승|자동 승격|ACL/.test(band)) return "good";
    if (/강등|하위/.test(band)) return "bad";
    if (/플레이오프|추격/.test(band)) return "warn";
    return "";
  }

  function renderAsOf() {
    const el = $("asOf");
    if (!el || !state.index) return;
    const k1 = leagueById("K1");
    const k2 = leagueById("K2");
    const rounds = [
      k1 ? `K리그1 ${num(k1.played_rounds)}R` : "",
      k2 ? `K리그2 ${num(k2.played_rounds)}R` : "",
    ]
      .filter(Boolean)
      .join(" · ");
    el.textContent = `${state.index.season}시즌 · ${state.index.as_of} 경기까지 반영 · ${rounds}`;
  }

  function renderTabs() {
    document.querySelectorAll(".league-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-league") === state.league);
      btn.setAttribute("aria-selected", String(btn.getAttribute("data-league") === state.league));
    });
  }

  function renderChips() {
    const box = $("teamChips");
    if (!box) return;
    const rows = leagueTable(state.league);
    box.innerHTML = rows
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ko"))
      .map(
        (row) =>
          `<button class="team-chip${row.team_id === state.teamId ? " is-active" : ""}" type="button" data-team="${escapeHtml(
            row.team_id
          )}">` +
          (row.emblem
            ? `<img src="${escapeHtml(row.emblem)}" alt="" width="17" height="17" decoding="async" onerror="this.hidden=true" />`
            : "") +
          `${escapeHtml(row.name)}</button>`
      )
      .join("");
  }

  function formDots(results) {
    return `<span class="form-dots">${(results || [])
      .map((r) => `<span class="form-dot ${escapeHtml(r)}">${r === "W" ? "승" : r === "D" ? "무" : "패"}</span>`)
      .join("")}</span>`;
  }

  function renderStandings() {
    const body = $("standingsBody");
    if (!body) return;
    const rows = leagueTable(state.league);
    body.innerHTML = rows
      .map(
        (row) =>
          `<tr data-team="${escapeHtml(row.team_id)}"${row.team_id === state.teamId ? ' class="is-active"' : ""}>` +
          `<td class="cell-rank"><span class="rank-bar" style="background:${escapeHtml(row.color || "#0a3d2e")}"></span>${num(
            row.rank
          )}</td>` +
          `<td class="cell-team"><span>${
            row.emblem
              ? `<img src="${escapeHtml(row.emblem)}" alt="" width="20" height="20" decoding="async" onerror="this.hidden=true" />`
              : ""
          }${escapeHtml(row.name)}</span></td>` +
          `<td>${num(row.played)}</td><td>${num(row.win)}</td><td>${num(row.draw)}</td><td>${num(row.loss)}</td>` +
          `<td>${num(row.gf)}</td><td>${num(row.ga)}</td><td>${num(row.gd) > 0 ? "+" : ""}${num(row.gd)}</td>` +
          `<td class="cell-points">${num(row.points)}</td>` +
          `<td class="cell-form">${formDots(row.last5)}</td>` +
          `<td class="cell-band"><span class="band-pill ${bandClass(row.band)}">${escapeHtml(row.band || "")}</span></td>` +
          "</tr>"
      )
      .join("");
  }

  /* ---------- rendering: club column ---------- */

  function renderClubHead() {
    const box = $("clubHead");
    const team = state.team;
    const column = state.column;
    if (!box || !team || !column) return;
    box.innerHTML =
      (team.emblem
        ? `<img class="club-emblem" src="${escapeHtml(team.emblem)}" alt="" decoding="async" onerror="this.hidden=true" />`
        : "") +
      `<p class="club-eyebrow">${escapeHtml(team.league_name)} · ${escapeHtml(team.full)}</p>` +
      `<h2 class="club-headline">${escapeHtml(column.headline)}</h2>` +
      `<p class="club-standfirst">${escapeHtml(column.standfirst)}</p>` +
      ((team.context?.tags || []).length
        ? `<div class="club-tags">${team.context.tags
            .map((tag) => `<span class="club-tag">${escapeHtml(tag)}</span>`)
            .join("")}</div>`
        : "");
  }

  function metric(label, value, note) {
    return (
      `<dl class="metric"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}` +
      (note ? `<small>${escapeHtml(note)}</small>` : "") +
      "</dd></dl>"
    );
  }

  function renderMetrics() {
    const box = $("metricGrid");
    const team = state.team;
    if (!box || !team) return;
    const t = team.table;
    const home = team.splits.home;
    const away = team.splits.away;
    box.innerHTML = [
      metric("순위", `${num(t.rank)}위`, `${num(t.teams)}팀 중`),
      metric("승점", `${num(t.points)}`, `${num(t.win)}승 ${num(t.draw)}무 ${num(t.loss)}패`),
      metric("경기당 승점", num(t.ppg).toFixed(2), `${num(t.played)}경기`),
      metric("득실", `${num(t.gd) > 0 ? "+" : ""}${num(t.gd)}`, `${num(t.gf)}득점 ${num(t.ga)}실점`),
      metric("홈", num(home.ppg).toFixed(2), `${num(home.win)}승 ${num(home.draw)}무 ${num(home.loss)}패`),
      metric("원정", num(away.ppg).toFixed(2), `${num(away.win)}승 ${num(away.draw)}무 ${num(away.loss)}패`),
      metric("무실점", `${num(team.scoring.clean_sheets)}경기`, `무득점 ${num(team.scoring.failed_to_score)}경기`),
      metric("남은 경기", `${num(t.remaining)}경기`, `최대 승점 ${num(t.points) + num(t.remaining) * 3}`),
    ].join("");
  }

  function renderColumnBody() {
    const box = $("columnBody");
    const column = state.column;
    if (!box || !column) return;
    box.innerHTML = column.sections
      .map(
        (section) =>
          `<section class="column-section" id="sec-${escapeHtml(section.id)}">` +
          `<h3>${escapeHtml(section.title)}</h3>` +
          section.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
          "</section>"
      )
      .join("");
  }

  /* ---------- rendering: rank trend ---------- */

  function renderTrend() {
    const box = $("chartWrap");
    const team = state.team;
    if (!box || !team) return;
    const history = (team.trend?.history || []).filter((h) => Number.isFinite(h.rank));
    if (history.length < 2) {
      box.innerHTML = '<p class="chart-empty">순위 추이를 그리기에는 경기 수가 부족합니다.</p>';
      return;
    }

    const width = 900;
    const height = 260;
    const pad = { top: 18, right: 18, bottom: 30, left: 34 };
    const teams = num(team.table.teams, 12);
    const maxRound = history[history.length - 1].round;
    const minRound = history[0].round;
    const spanRound = Math.max(maxRound - minRound, 1);

    const x = (round) => pad.left + ((round - minRound) / spanRound) * (width - pad.left - pad.right);
    const y = (rank) => pad.top + ((rank - 1) / Math.max(teams - 1, 1)) * (height - pad.top - pad.bottom);

    const points = history.map((h) => `${x(h.round).toFixed(1)},${y(h.rank).toFixed(1)}`);
    const areaPath =
      `M ${x(minRound).toFixed(1)},${(height - pad.bottom).toFixed(1)} ` +
      `L ${points.join(" L ")} ` +
      `L ${x(maxRound).toFixed(1)},${(height - pad.bottom).toFixed(1)} Z`;

    const gridRanks = [1, Math.ceil(teams / 2), teams];
    const grid = gridRanks
      .map(
        (rank) =>
          `<line class="chart-grid" x1="${pad.left}" y1="${y(rank).toFixed(1)}" x2="${width - pad.right}" y2="${y(
            rank
          ).toFixed(1)}" />` +
          `<text class="chart-axis-text" x="6" y="${(y(rank) + 3.5).toFixed(1)}">${rank}위</text>`
      )
      .join("");

    const roundTicks = [];
    const step = Math.max(Math.round(spanRound / 6), 1);
    for (let r = minRound; r <= maxRound; r += step) {
      roundTicks.push(
        `<text class="chart-axis-text" x="${x(r).toFixed(1)}" y="${height - 10}" text-anchor="middle">${r}R</text>`
      );
    }

    const last = history[history.length - 1];
    box.innerHTML =
      `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(team.name)} 라운드별 순위 추이">` +
      grid +
      `<path class="chart-area" d="${areaPath}" />` +
      `<polyline class="chart-line" points="${points.join(" ")}" />` +
      `<circle class="chart-dot" cx="${x(last.round).toFixed(1)}" cy="${y(last.rank).toFixed(1)}" r="4.5" />` +
      roundTicks.join("") +
      "</svg>";
  }

  function renderMatches() {
    const box = $("matchList");
    const team = state.team;
    if (!box || !team) return;
    const fixtures = (team.fixtures || []).slice(-10).reverse();
    if (!fixtures.length) {
      box.innerHTML = '<li class="chart-empty">경기 기록이 없습니다.</li>';
      return;
    }
    box.innerHTML = fixtures
      .map(
        (f) =>
          "<li>" +
          `<span class="match-round">${num(f.round)}R</span>` +
          `<span class="match-venue">${f.venue === "H" ? "홈" : "원정"}</span>` +
          `<span class="match-opponent">${escapeHtml(f.opponent)}</span>` +
          `<span class="match-score">${num(f.gf)} : ${num(f.ga)}</span>` +
          `<span class="form-dot ${escapeHtml(f.result)}">${
            f.result === "W" ? "승" : f.result === "D" ? "무" : "패"
          }</span>` +
          "</li>"
      )
      .join("");
  }

  /* ---------- share builders ---------- */

  function buildEmbedHtml(src) {
    return [
      '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      `<iframe src="${escapeHtml(
        src
      )}" title="K리그 팀분석" width="100%" height="1200" style="width:100%;max-width:1100px;height:1200px;border:0;border-radius:12px;overflow:hidden;background:#f3f7f2;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
      "</div>",
    ].join("");
  }

  function buildShareHtml(url) {
    const team = state.team;
    const column = state.column;
    if (!team || !column) return "";
    const t = team.table;
    const safeUrl = escapeHtml(url);
    const title = escapeHtml(column.headline);
    const line = escapeHtml(
      `${team.league_name} ${num(t.rank)}위 · 승점 ${num(t.points)} · ${num(t.win)}승 ${num(t.draw)}무 ${num(
        t.loss
      )}패 · ${team.context.band}`
    );
    const lead = escapeHtml((column.sections[0]?.paragraphs || [])[0] || "");
    const emblem = team.emblem
      ? `<img src="${escapeHtml(team.emblem)}" alt="${escapeHtml(
          team.name
        )}" width="34" height="34" style="vertical-align:middle;margin-right:8px;" />`
      : "";
    return [
      '<div style="display:block;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      '<table cellpadding="0" cellspacing="0" border="0" bgcolor="#0f2a1c" width="1100" style="width:100% !important;max-width:1100px;min-width:100%;border-collapse:collapse;background-color:#0f2a1c;color:#f5fff8;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">',
      '<tr><td bgcolor="#0f2a1c" style="padding:16px 18px;background-color:#0f2a1c;color:#f5fff8;">',
      '<p style="margin:0 0 14px;font-size:13px;line-height:1.7;color:#e8f6ee;background-color:#0f2a1c;">',
      "AI를 활용하여 작성한 K리그 팀 분석입니다.<br>",
      "공식 기록(순위·득실·출전·득점)을 기반으로 자동 생성되며, 해석과 문장은 참고용입니다.<br>",
      "AI는 잘못된 정보를 전달할 수 있습니다. 무조건적인 신뢰보다는 적당한 선에서 비판적인 시선으로 봐주세요.",
      "</p>",
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;color:#b7f24a;background-color:#0f2a1c;">K LEAGUE CLUB ANALYSIS</p>',
      `<p style="margin:0 0 10px;font-size:18px;font-weight:700;line-height:1.35;color:#f5fff8;background-color:#0f2a1c;">${emblem}${title}</p>`,
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#d7efe3;background-color:#0f2a1c;">${line}</p>`,
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#d7efe3;background-color:#0f2a1c;">${lead}</p>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#b7f24a;color:#0a2218;font-weight:700;text-decoration:none;">팀 분석 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function setupCommunity() {
    if (document.body.classList.contains("embed-mode")) return;
    if (!document.body.classList.contains("edit-mode")) return;
    const team = state.team;
    if (!team) return;

    const url = publicTeamUrl();
    const embedSrc = embedSrcUrl();

    if ($("shareTargetMeta")) {
      $("shareTargetMeta").textContent = `${team.league_name} ${team.full} · ${num(
        team.table.rank
      )}위 · ${num(team.table.played)}경기 기준`;
    }
    if ($("shareCode")) $("shareCode").textContent = buildShareHtml(url);
    if ($("embedCode")) $("embedCode").textContent = buildEmbedHtml(embedSrc);
    if ($("reportUrl")) {
      $("reportUrl").textContent = url;
      $("reportUrl").href = url;
    }
    if ($("embedPreview")) {
      const ref = encodeTeamRef(state.teamId);
      const localSrc = `./index.html?${URL_Q.team}=${encodeURIComponent(ref)}&${URL_Q.embed}=${encodeURIComponent(
        EMBED_TOKEN
      )}`;
      const nextSrc = /localhost|127\.0\.0\.1/i.test(window.location.hostname) ? localSrc : embedSrc;
      if ($("embedPreview").getAttribute("src") !== nextSrc) $("embedPreview").src = nextSrc;
    }
  }

  async function copyText(text, okMessage) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(okMessage);
    } catch (err) {
      console.error(err);
      setStatus("클립보드 복사에 실패했습니다. 직접 선택해서 복사해 주세요.", true);
    }
  }

  /* ---------- orchestration ---------- */

  function renderAll() {
    if (state.team) {
      document.body.style.setProperty("--club", state.team.color || "#0a3d2e");
    }
    renderAsOf();
    renderTabs();
    renderChips();
    renderStandings();
    renderClubHead();
    renderMetrics();
    renderColumnBody();
    renderTrend();
    renderMatches();
    setupCommunity();
  }

  async function selectTeam(teamId, options) {
    const found = findTeamRow(teamId);
    if (!found) {
      setStatus(`${teamId} 구단 데이터를 찾지 못했습니다.`, true);
      return;
    }
    state.league = found.league;
    state.teamId = teamId;
    try {
      state.team = await fetchJson(`./data/teams/${teamId}.json`);
    } catch (err) {
      console.error(err);
      setStatus(`구단 데이터를 불러오지 못했습니다.\n${err.message || err}`, true);
      return;
    }
    state.column = window.TeamColumn.build(state.team, leagueTable(state.league));
    renderAll();
    syncUrl();
    if (!options || options.silent !== true) setStatus("");
    if (options && options.scroll) {
      $("column")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
    document.title = `${state.team.name} 팀분석 — K리그 팀분석`;
  }

  async function regenerate() {
    const btn = $("regenBtn");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "다시 쓰는 중…";
    }
    setStatus("최신 성적을 다시 읽고 칼럼을 새로 쓰는 중…");
    try {
      state.index = await fetchJson("./data/index.json");
      await selectTeam(state.teamId, { silent: true });
      setStatus(
        `${state.index.as_of} 경기까지의 성적으로 ${state.team.name} 칼럼을 새로 썼습니다. ` +
          `(${new Date().toLocaleTimeString("ko-KR")})`
      );
    } catch (err) {
      console.error(err);
      setStatus(`다시 쓰기에 실패했습니다.\n${err.message || err}`, true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "지금 성적으로 다시 쓰기";
      }
    }
  }

  function bindUi() {
    document.querySelectorAll(".league-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.league = btn.getAttribute("data-league") || "K1";
        renderTabs();
        renderChips();
        renderStandings();
      });
    });

    $("teamChips")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-team]");
      if (!btn) return;
      selectTeam(btn.getAttribute("data-team"), { scroll: true });
    });

    $("standingsBody")?.addEventListener("click", (event) => {
      const row = event.target.closest("[data-team]");
      if (!row) return;
      selectTeam(row.getAttribute("data-team"), { scroll: true });
    });

    $("regenBtn")?.addEventListener("click", regenerate);

    $("copyShare")?.addEventListener("click", () =>
      copyText(buildShareHtml(publicTeamUrl()), "에버그린 링크 카드 HTML을 복사했습니다.")
    );
    $("copyUrl")?.addEventListener("click", () => copyText(publicTeamUrl(), "공유 URL을 복사했습니다."));
    $("copyEmbed")?.addEventListener("click", () =>
      copyText(buildEmbedHtml(embedSrcUrl()), "iframe HTML을 복사했습니다.")
    );
  }

  async function boot() {
    applyViewMode();
    bindUi();
    setStatus("데이터를 불러오는 중…");
    try {
      state.index = await fetchJson("./data/index.json");
    } catch (err) {
      console.error(err);
      setStatus(`데이터를 불러오지 못했습니다.\n${err.message || err}`, true);
      return;
    }

    const requested = decodeTeamRef(queryParams().get(URL_Q.team));
    const fallback = findTeamRow(DEFAULT_TEAM)
      ? DEFAULT_TEAM
      : leagueTable("K1")[0]?.team_id || leagueTable("K2")[0]?.team_id || "";
    const target = requested && findTeamRow(requested) ? requested : fallback;
    if (!target) {
      setStatus("표시할 구단이 없습니다. 먼저 build_team_report.py 를 실행해 주세요.", true);
      return;
    }
    await selectTeam(target);
  }

  boot();
})();
