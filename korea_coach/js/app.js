/* Korean manager dossiers.
 * Author mode (?x=jb7k) shows the Evergreen share builder.
 * Shared links open the main page. Readers pick coaches from the tabs.
 * Deep links ?q= / ?q=&v= still work as bookmarks. */
(function () {
  "use strict";

  const CANONICAL = "https://wanju1109.github.io/jeonbuk-lineup/korea_coach/";
  const URL_Q = { coach: "q", versus: "v", edit: "x", embed: "f" };
  const EDIT_TOKEN = "jb7k";
  const EMBED_TOKEN = "y";
  const COACH_XOR = 0x4a21;
  const DEFAULT_ID = "c01";
  const LEAGUE_ORDER = ["K1", "K2", "ETC"];
  const LEAGUE_LABEL = { K1: "K리그1", K2: "K리그2", ETC: "기타" };

  const state = {
    index: null,
    view: "profile",
    league: "K1",
    coachId: "",
    coach: null,
    compareA: "",
    compareB: "",
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

  function encodeRef(id) {
    const m = /^c(\d{1,2})$/i.exec(String(id || "").trim());
    if (!m) return "";
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n <= 0) return "";
    return (n ^ COACH_XOR).toString(36);
  }

  function decodeRef(ref) {
    if (ref == null || ref === "") return "";
    const raw = String(ref).trim().toLowerCase();
    if (!/^[0-9a-z]+$/.test(raw)) return "";
    const n = parseInt(raw, 36) ^ COACH_XOR;
    if (!Number.isFinite(n) || n <= 0 || n > 99) return "";
    return `c${String(n).padStart(2, "0")}`;
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
    document.body.classList.remove("edit-mode", "embed-mode", "compare-mode");
    if (isEmbedQuery()) document.body.classList.add("embed-mode");
    else if (isEditQuery()) document.body.classList.add("edit-mode");
    if (state.view === "compare") document.body.classList.add("compare-mode");
  }

  function allCoaches() {
    return state.index?.coaches || [];
  }

  function pageBaseNoQuery() {
    return String(window.location.href.split("#")[0].split("?")[0] || "");
  }

  function normalizeBase(base) {
    let b = String(base || "").trim();
    if (!b) return CANONICAL;
    if (!/\.html$/i.test(b) && !/\/$/.test(b)) b += "/";
    return b;
  }

  function publicHomeUrl() {
    const current = pageBaseNoQuery();
    const base = /wanju1109\.github\.io/i.test(current) ? current : CANONICAL;
    return normalizeBase(base);
  }

  function publicEmbedUrl() {
    const home = publicHomeUrl();
    const join = home.includes("?") ? "&" : "?";
    return `${home}${join}${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
  }

  function syncUrl() {
    const next = new URLSearchParams();
    if (state.view === "compare") {
      const a = encodeRef(state.compareA);
      const b = encodeRef(state.compareB);
      if (!a || !b) return;
      next.set(URL_Q.coach, a);
      next.set(URL_Q.versus, b);
    } else {
      const ref = encodeRef(state.coachId);
      if (!ref) return;
      next.set(URL_Q.coach, ref);
    }
    if (isEditQuery()) next.set(URL_Q.edit, EDIT_TOKEN);
    if (isEmbedQuery()) next.set(URL_Q.embed, EMBED_TOKEN);
    window.history.replaceState({}, "", `${location.pathname}?${next.toString()}`);
  }

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

  async function fetchJson(path) {
    const res = await fetch(`${path}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`${path} HTTP ${res.status}`);
    return res.json();
  }

  function sortByName(list) {
    return list.slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  }

  function choseong(name) {
    const ch = String(name || "").charAt(0);
    const code = ch.charCodeAt(0) - 0xac00;
    if (code < 0 || code > 11171) return "#";
    const raw = ["ㄱ", "ㄲ", "ㄴ", "ㄷ", "ㄸ", "ㄹ", "ㅁ", "ㅂ", "ㅃ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅉ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ"][
      Math.floor(code / 588)
    ];
    return { ㄲ: "ㄱ", ㄸ: "ㄷ", ㅃ: "ㅂ", ㅆ: "ㅅ", ㅉ: "ㅈ" }[raw] || raw;
  }

  const CHOSEONG_ORDER = ["ㄱ", "ㄴ", "ㄷ", "ㄹ", "ㅁ", "ㅂ", "ㅅ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ", "#"];

  function groupedByChoseong(list) {
    const groups = {};
    sortByName(list).forEach((c) => {
      const key = choseong(c.name);
      (groups[key] || (groups[key] = [])).push(c);
    });
    return CHOSEONG_ORDER.filter((key) => groups[key]).map((key) => ({ key, coaches: groups[key] }));
  }

  function coachesInLeague(league) {
    return sortByName(allCoaches().filter((c) => c.league === league));
  }

  function findCoach(id) {
    return allCoaches().find((c) => c.id === id) || null;
  }

  function otherCoach(id) {
    const list = allCoaches();
    if (list.length < 2) return null;
    return list.find((c) => c.id !== id) || null;
  }

  function chipHtml(c) {
    const active = c.id === state.coachId ? " is-active" : "";
    const face = c.photo
      ? `<img src="${escapeHtml(c.photo)}" alt="" width="28" height="28" />`
      : `<span class="chip-fallback" style="--club:${escapeHtml(c.color || "#333")}">${escapeHtml(
          (c.name || "?").slice(0, 1)
        )}</span>`;
    return `<button class="coach-chip${active}" type="button" data-coach="${escapeHtml(c.id)}">${face}${escapeHtml(
      c.name
    )}${
      c.rating != null && Number.isFinite(Number(c.rating))
        ? `<span class="chip-score">${escapeHtml(Number(c.rating).toFixed(1))}</span>`
        : ""
    }</button>`;
  }

  function renderChips() {
    const box = $("coachChips");
    if (!box) return;
    const list = coachesInLeague(state.league);
    if (state.league === "ETC") {
      box.innerHTML = groupedByChoseong(list)
        .map(
          (group) =>
            `<div class="chip-group"><p class="chip-index">${escapeHtml(group.key)}</p>` +
            `<div class="chip-row">${group.coaches.map(chipHtml).join("")}</div></div>`
        )
        .join("");
      return;
    }
    box.innerHTML = list.map(chipHtml).join("");
  }

  function renderPortrait() {
    const box = $("portraitCard");
    const c = state.coach;
    if (!box || !c) return;
    document.body.style.setProperty("--club", c.color || "#1b2430");
    const photo = c.photo
      ? `<img class="portrait-photo" src="${escapeHtml(c.photo)}" alt="${escapeHtml(c.name)}" />`
      : `<div class="portrait-fallback" style="--club:${escapeHtml(c.color || "#1b2430")}">${escapeHtml(
          (c.name || "?").slice(0, 1)
        )}</div>`;
    box.innerHTML =
      photo +
      `<div class="portrait-meta">` +
      `<p class="club-line">${escapeHtml(c.league_name)} · ${escapeHtml(c.club)} · ${escapeHtml(c.born || "")}</p>` +
      `<h2>${escapeHtml(c.name)}</h2>` +
      (c.nickname ? `<p class="club-line">${escapeHtml(c.nickname)}</p>` : "") +
      `<p class="headline">${escapeHtml(c.headline || "")}</p>` +
      `<p class="standfirst">${escapeHtml(c.standfirst || "")}</p>` +
      (c.photo_credit ? `<p class="photo-credit">${escapeHtml(c.photo_credit)}</p>` : "") +
      `</div>`;
  }

  function clamp(n, lo, hi) {
    const v = Number(n);
    if (!Number.isFinite(v)) return lo;
    return Math.min(hi, Math.max(lo, Math.round(v)));
  }

  function tone20(value) {
    if (value >= 15) return "is-high";
    if (value >= 12) return "is-mid";
    return "is-low";
  }

  function abilityOf(c, label) {
    const row = (c.abilities || []).find((item) => item.label === label);
    return clamp(row ? row.value : 1, 1, 20);
  }

  function tendencyOf(c) {
    if (c.tendency) return c.tendency;
    const att = abilityOf(c, "공격");
    const def = abilityOf(c, "수비");
    if (att - def >= 3) return "공격형";
    if (def - att >= 3) return "수비형";
    return "밸런스";
  }

  function isAxisLabel(label) {
    return label === "공격" || label === "수비";
  }

  function performanceHtml(c) {
    const p = c.performance;
    if (!p || p.status !== "scored") return `<p>${escapeHtml(p?.reason || "평가 자료 없음")}</p><p class="help">자료가 없다는 뜻이며 0점이나 낮은 능력 평가가 아닙니다.</p>`;
    const i = p.inputs;
    const rows = p.components.map(x => `<tr><th>${escapeHtml(x.label)}</th><td>${x.score.toFixed(1)}</td><td>${Math.round(x.weight*100)}%</td><td>${x.contribution.toFixed(2)}</td></tr>`).join("");
    return `<p class="help">${p.season}년 현 소속팀 재임 리그 경기 · ${escapeHtml(p.start)}~${escapeHtml(p.through)} · ${p.n}경기</p>` +
      `<div class="score-table-wrap"><table class="score-table"><thead><tr><th>평가 항목</th><th>항목 점수</th><th>비중</th><th>반영점</th></tr></thead><tbody>${rows}</tbody></table></div>` +
      `<p>승점 ${i.points} / ${p.n}경기 = 경기당 ${i.ppg.toFixed(2)}점 · 최근 ${i.recent_n}경기 ${i.recent_points}점</p>` +
      `<p>비교 기준: ${escapeHtml(i.comparison)}${i.previous_ppg == null ? "" : ` (${i.previous_n}경기, 경기당 ${i.previous_ppg.toFixed(2)}점)`}</p>` +
      `<p class="help">같은 리그 내 상대 성과입니다. 이름값·과거 우승·주관적 전술 점수는 합산하지 않습니다. 팀 예산·부상·일정 난도까지 보정한 감독 개인 능력 점수는 아닙니다.</p>`;
  }

  function renderScout() {
    const box = $("scoutCard");
    const c = state.coach;
    if (!box || !c) return;
    const score = c.rating == null ? null : Math.min(100, Math.max(0, Number(c.rating)));
    const att = abilityOf(c, "공격");
    const def = abilityOf(c, "수비");
    const tactics = c.tactics || {};
    const pills = [
      ["성향", tendencyOf(c)],
      ["전술 유형", tactics.kind],
      ["경기 스타일", tactics.style],
      ["선호 포메이션", tactics.shape],
      ["보조 포메이션", tactics.alt],
    ]
      .filter((row) => row[1])
      .map(
        ([label, value]) =>
          `<div class="tactic-pill"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`
      )
      .join("");
    const axis =
      `<div class="axis-board">` +
      `<div class="axis-col is-att"><span>공격</span><b>${att}</b>` +
      `<div class="ability-track"><div class="ability-fill is-high" style="width:${(att / 20) * 100}%"></div></div></div>` +
      `<div class="axis-mid">${escapeHtml(tendencyOf(c))}</div>` +
      `<div class="axis-col is-def"><span>수비</span><b>${def}</b>` +
      `<div class="ability-track"><div class="ability-fill is-mid" style="width:${(def / 20) * 100}%"></div></div></div>` +
      `</div>`;
    const attrs = (c.abilities || [])
      .filter((row) => !isAxisLabel(row.label))
      .map((row) => {
        const value = clamp(row.value, 1, 20);
        const tone = tone20(value);
        return (
          `<div class="ability-row"><label>${escapeHtml(row.label || "")}</label>` +
          `<b class="${tone}">${value}</b>` +
          `<div class="ability-track"><div class="ability-fill ${tone}" style="width:${(value / 20) * 100}%"></div></div></div>`
        );
      })
      .join("");
    box.innerHTML =
      `<div class="scout-gauge">` +
      `<svg class="gauge" viewBox="0 0 168 168" role="img" aria-label="리그 성과 ${score == null ? '평가 보류' : score + '점'}">` +
      `<circle class="gauge-ring gauge-track" cx="84" cy="84" r="70"></circle>` +
      `<circle class="gauge-ring gauge-value" cx="84" cy="84" r="70" pathLength="100" ` +
      `stroke-dasharray="${score || 0} 100"></circle>` +
      `<text class="gauge-score" x="84" y="86" text-anchor="middle">${score == null ? "—" : score.toFixed(1)}</text>` +
      `<text class="gauge-label" x="84" y="110" text-anchor="middle">리그 성과</text>` +
      `<text class="gauge-max" x="84" y="126" text-anchor="middle">100점</text>` +
      `</svg>` +
      (c.rating_note ? `<p class="scout-note">${escapeHtml(c.rating_note)}</p>` : "") +
      `</div>` +
      `<div class="scout-body">${performanceHtml(c)}<details class="editorial-notes"><summary>전술 성향·능력치 · 편집 메모</summary><div class="tactic-pills">${pills}</div>${axis}<div class="ability-grid">${attrs}</div>` +
      `<p class="ability-caption">전술·능력치는 기존 편집 해석이며 성과 점수 계산에 사용하지 않습니다.</p></details></div>`;
  }

  function renderTraits() {
    const box = $("traitGrid");
    const c = state.coach;
    if (!box || !c) return;
    const good = (c.strengths || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    const bad = (c.weaknesses || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    box.innerHTML =
      `<div class="trait-box"><h3>장점</h3><ul>${good || "<li>기록 없음</li>"}</ul></div>` +
      `<div class="trait-box weak"><h3>허점</h3><ul>${bad || "<li>기록 없음</li>"}</ul></div>`;
  }

  function renderColumn() {
    const box = $("columnBody");
    const c = state.coach;
    if (!box || !c) return;
    box.innerHTML = (c.sections || [])
      .map(
        (section) =>
          `<section class="column-section"><h3>${escapeHtml(section.title)}</h3>` +
          (section.paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
          "</section>"
      )
      .join("");
  }

  function renderTimeline() {
    const box = $("timelineList");
    const c = state.coach;
    if (!box || !c) return;
    box.innerHTML = (c.timeline || [])
      .map(
        (row) =>
          `<li><span class="year">${escapeHtml(row.year)}</span><div><strong>${escapeHtml(
            row.title
          )}</strong><span>${escapeHtml(row.text || "")}</span></div></li>`
      )
      .join("");
  }

  function faceHtml(c, imgClass, fallbackClass) {
    if (c.photo) {
      return `<img class="${imgClass}" src="${escapeHtml(c.photo)}" alt="${escapeHtml(c.name)}" />`;
    }
    return `<div class="${fallbackClass}" style="--club:${escapeHtml(c.color || "#1b2430")}">${escapeHtml(
      (c.name || "?").slice(0, 1)
    )}</div>`;
  }

  function fillCompareSelects() {
    const a = $("compareA");
    const b = $("compareB");
    if (!a || !b) return;
    const option = (c) =>
      `<option value="${escapeHtml(c.id)}">${escapeHtml(c.name)} · ${escapeHtml(c.club)}</option>`;
    const groups = LEAGUE_ORDER.map((league) => {
      if (league === "ETC") {
        return groupedByChoseong(coachesInLeague("ETC"))
          .map(
            (group) =>
              `<optgroup label="기타 · ${escapeHtml(group.key)}">${group.coaches.map(option).join("")}</optgroup>`
          )
          .join("");
      }
      return `<optgroup label="${escapeHtml(LEAGUE_LABEL[league] || league)}">${coachesInLeague(league)
        .map(option)
        .join("")}</optgroup>`;
    }).join("");
    a.innerHTML = groups;
    b.innerHTML = groups;
    a.value = state.compareA;
    b.value = state.compareB;
  }

  function abilityMap(c) {
    const map = {};
    (c.abilities || []).forEach((row) => {
      map[row.label] = clamp(row.value, 1, 20);
    });
    return map;
  }

  function renderCompare() {
    const box = $("compareBody");
    const a = findCoach(state.compareA);
    const b = findCoach(state.compareB);
    if (!box) return;
    if (!a || !b) {
      box.innerHTML = "<p class=\"help\">비교할 감독을 두 명 고르세요.</p>";
      return;
    }
    const scoreA = a.rating == null ? "—" : a.rating.toFixed(1);
    const scoreB = b.rating == null ? "—" : b.rating.toFixed(1);
    const card = (c, score) =>
      `<article class="compare-card">` +
      `<header>${faceHtml(c, "", "compare-fallback")}<div>` +
      `<h3>${escapeHtml(c.name)}</h3>` +
      `<p class="club-line">${escapeHtml(c.league_name)} · ${escapeHtml(c.club)}</p>` +
      `<p class="club-line">${escapeHtml(c.tactics?.kind || "")} · ${escapeHtml(c.tactics?.shape || "")}</p>` +
      `</div><div class="compare-score">${score}</div></header>` +
      performanceHtml(c) +
      `</article>`;
    const traitCol = (c) =>
      `<div><h4>${escapeHtml(c.name)}</h4>` +
      `<p><strong>장점</strong> ${(c.strengths || []).map((t) => escapeHtml(t)).join(" · ") || "기록 없음"}</p>` +
      `<p><strong>허점</strong> ${(c.weaknesses || []).map((t) => escapeHtml(t)).join(" · ") || "기록 없음"}</p>` +
      `</div>`;
    box.innerHTML =
      `<div class="compare-grid">${card(a, scoreA)}${card(b, scoreB)}</div>` +
      `<p class="help">${a.league !== b.league ? "서로 다른 리그의 상대 성과이므로 점수만으로 절대 우열을 판단하지 마세요." : "동일 리그 기준. 재임 기간과 표본 수를 함께 확인하세요."}</p>` +
      `<div class="compare-traits">${traitCol(a)}${traitCol(b)}</div>`;
  }

  function buildEmbedHtml(src) {
    return [
      '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      `<iframe src="${escapeHtml(
        src
      )}" title="한국 감독" width="100%" height="1200" style="width:100%;max-width:1100px;height:1200px;border:0;border-radius:12px;overflow:hidden;background:#f4efe6;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
      "</div>",
    ].join("");
  }

  function buildShareHtml(url) {
    const safeUrl = escapeHtml(url || publicHomeUrl());
    return [
      '<div style="display:block;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      '<table cellpadding="0" cellspacing="0" border="0" bgcolor="#1b2430" width="1100" style="width:100% !important;max-width:1100px;border-collapse:collapse;background-color:#1b2430;color:#f7f1e4;font-family:Arial,Helvetica,sans-serif;">',
      '<tr><td bgcolor="#1b2430" style="padding:16px 18px;background-color:#1b2430;color:#f7f1e4;">',
      '<p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:#ddd4c4;">AI를 활용해 정리한 한국 감독 페이지입니다. 공개 기록·보도를 바탕으로 했으며 해석은 참고용입니다.</p>',
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:#d4a017;">KOREAN MANAGERS</p>',
      '<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f7f1e4;">한국 감독</p>',
      '<p style="margin:0 0 14px;font-size:14px;line-height:1.5;color:#ddd4c4;">K리그1 · K리그2 · 기타에서 감독을 고르면 연대기, 성과 근거, 두 사람 비교를 볼 수 있습니다.</p>',
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#d4a017;color:#1b1404;font-weight:700;text-decoration:none;">한국 감독 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function setupShare() {
    if (!document.body.classList.contains("edit-mode") || isEmbedQuery()) return;
    const url = publicHomeUrl();
    const embedSrc = publicEmbedUrl();
    if ($("shareTargetMeta")) {
      $("shareTargetMeta").textContent = "공유 대상: 한국 감독 메인 · 받은 사람이 탭에서 감독을 고릅니다.";
    }
    if ($("shareCode")) $("shareCode").textContent = buildShareHtml(url);
    if ($("embedCode")) $("embedCode").textContent = buildEmbedHtml(embedSrc);
    if ($("reportUrl")) {
      $("reportUrl").textContent = url;
      $("reportUrl").href = url;
    }
    const frame = $("embedPreview");
    if (frame) {
      const localSrc = `./?${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
      const nextSrc = /localhost|127\.0\.0\.1/i.test(window.location.hostname) ? localSrc : embedSrc;
      if (frame.getAttribute("src") !== nextSrc) frame.src = nextSrc;
    }
  }

  function syncTabs() {
    document.querySelectorAll(".league-tab").forEach((btn) => {
      const isCompare = btn.getAttribute("data-view") === "compare";
      if (state.view === "compare") {
        btn.classList.toggle("is-active", isCompare);
      } else {
        btn.classList.toggle("is-active", !isCompare && btn.getAttribute("data-league") === state.league);
      }
    });
  }

  function renderAll() {
    const k1 = coachesInLeague("K1").length;
    const k2 = coachesInLeague("K2").length;
    const etc = coachesInLeague("ETC").length;
    if ($("asOf") && state.index) {
      $("asOf").textContent = `${state.index.season}시즌 · ${k1 + k2 + etc}명 (K1 ${k1} · K2 ${k2} · 기타 ${etc})`;
    }
    applyViewMode();
    syncTabs();
    renderChips();
    if (state.view === "compare") {
      fillCompareSelects();
      renderCompare();
    } else {
      renderPortrait();
      renderScout();
      renderTraits();
      renderColumn();
      renderTimeline();
    }
    setupShare();
  }

  function enterCompare(leftId, rightId) {
    const left = findCoach(leftId) || findCoach(state.coachId) || findCoach(DEFAULT_ID);
    if (!left) {
      setStatus("비교할 감독을 찾지 못했습니다.", true);
      return;
    }
    let right = findCoach(rightId);
    if (!right || right.id === left.id) right = otherCoach(left.id);
    if (!right) {
      setStatus("비교할 상대가 부족합니다.", true);
      return;
    }
    state.view = "compare";
    state.compareA = left.id;
    state.compareB = right.id;
    state.coachId = left.id;
    state.coach = left;
    renderAll();
    syncUrl();
    document.title = `${left.name} vs ${right.name} — 한국 감독 비교`;
    $("compareBoard")?.scrollIntoView({ behavior: "smooth", block: "start" });
    setStatus("");
  }

  async function selectCoach(id, options) {
    const row = findCoach(id);
    if (!row) {
      setStatus("감독 데이터를 찾지 못했습니다.", true);
      return;
    }
    state.view = "profile";
    state.league = row.league;
    state.coachId = id;
    state.coach = row;
    renderAll();
    syncUrl();
    document.title = `${row.name} — 한국 감독`;
    if (options && options.scroll) $("profile")?.scrollIntoView({ behavior: "smooth", block: "start" });
    if (!options || !options.silent) setStatus("");
  }

  async function copyText(text, ok) {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setStatus(ok);
    } catch (err) {
      console.error(err);
      setStatus("복사에 실패했습니다. 직접 선택해 주세요.", true);
    }
  }

  function bindUi() {
    document.querySelectorAll(".league-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.getAttribute("data-view") === "compare") {
          enterCompare(state.coachId, state.compareB && state.compareB !== state.coachId ? state.compareB : "");
          return;
        }
        const row = findCoach(state.coachId) || findCoach(DEFAULT_ID);
        state.view = "profile";
        state.league = btn.getAttribute("data-league") || "K1";
        if (row) {
          state.coachId = row.id;
          state.coach = row;
        }
        renderAll();
        syncUrl();
        if (row) document.title = `${row.name} — 한국 감독`;
      });
    });
    $("coachChips")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-coach]");
      if (btn) selectCoach(btn.getAttribute("data-coach"), { scroll: true });
    });
    $("compareA")?.addEventListener("change", () => {
      if ($("compareA").value === state.compareB) {
        const swap = state.compareA;
        state.compareA = $("compareA").value;
        state.compareB = swap;
      } else {
        state.compareA = $("compareA").value;
      }
      state.coachId = state.compareA;
      state.coach = findCoach(state.compareA);
      renderAll();
      syncUrl();
      const a = findCoach(state.compareA);
      const b = findCoach(state.compareB);
      if (a && b) document.title = `${a.name} vs ${b.name} — 한국 감독 비교`;
    });
    $("compareB")?.addEventListener("change", () => {
      if ($("compareB").value === state.compareA) {
        const swap = state.compareB;
        state.compareB = $("compareB").value;
        state.compareA = swap;
      } else {
        state.compareB = $("compareB").value;
      }
      renderAll();
      syncUrl();
      const a = findCoach(state.compareA);
      const b = findCoach(state.compareB);
      if (a && b) document.title = `${a.name} vs ${b.name} — 한국 감독 비교`;
    });
    $("compareSwap")?.addEventListener("click", () => {
      const tmp = state.compareA;
      state.compareA = state.compareB;
      state.compareB = tmp;
      state.coachId = state.compareA;
      state.coach = findCoach(state.compareA);
      renderAll();
      syncUrl();
      const a = findCoach(state.compareA);
      const b = findCoach(state.compareB);
      if (a && b) document.title = `${a.name} vs ${b.name} — 한국 감독 비교`;
    });
    $("copyShare")?.addEventListener("click", () =>
      copyText(buildShareHtml(publicHomeUrl()), "에버그린 링크 카드 HTML을 복사했습니다.")
    );
    $("copyUrl")?.addEventListener("click", () => copyText(publicHomeUrl(), "공유 URL을 복사했습니다."));
    $("copyEmbed")?.addEventListener("click", () =>
      copyText(
        $("embedCode")?.textContent || buildEmbedHtml(publicEmbedUrl()),
        "iframe HTML을 복사했습니다. 운영진이 wanju1109.github.io/ 를 허용해야 글 안에 보입니다."
      )
    );
  }

  async function boot() {
    applyViewMode();
    bindUi();
    setStatus("데이터를 불러오는 중…");
    try {
      state.index = await fetchJson("./data/coaches.json");
    } catch (err) {
      console.error(err);
      setStatus(`데이터를 불러오지 못했습니다.\n${err.message || err}`, true);
      return;
    }
    const params = queryParams();
    const requested = decodeRef(params.get(URL_Q.coach));
    const versus = decodeRef(params.get(URL_Q.versus));
    const exists = findCoach(requested);
    const target = exists ? requested : DEFAULT_ID;
    if (versus && findCoach(versus) && exists) {
      enterCompare(requested, versus);
      return;
    }
    await selectCoach(target);
  }

  boot();
})();
