/* Korean K League manager dossiers.
 * Author mode (?x=jb7k) shows the Evergreen share builder.
 * Shared links (?q=) are read-only. */
(function () {
  "use strict";

  const CANONICAL = "https://wanju1109.github.io/jeonbuk-lineup/korea_coach/";
  const URL_Q = { coach: "q", edit: "x", embed: "f" };
  const EDIT_TOKEN = "jb7k";
  const EMBED_TOKEN = "y";
  const COACH_XOR = 0x4a21;
  const DEFAULT_ID = "c01";

  const state = { index: null, league: "K1", coachId: "", coach: null };

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
    document.body.classList.remove("edit-mode", "embed-mode");
    if (isEmbedQuery()) {
      document.body.classList.add("embed-mode");
      return;
    }
    if (isEditQuery()) document.body.classList.add("edit-mode");
  }

  function publicUrl(coachId) {
    const ref = encodeRef(coachId || state.coachId);
    const current = window.location.href.split("#")[0].split("?")[0];
    const base = /wanju1109\.github\.io/i.test(current) ? current : CANONICAL;
    if (!ref) return base;
    return `${base}?${URL_Q.coach}=${encodeURIComponent(ref)}`;
  }

  function syncUrl() {
    const ref = encodeRef(state.coachId);
    if (!ref) return;
    const next = new URLSearchParams();
    next.set(URL_Q.coach, ref);
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

  function coachesInLeague(league) {
    return (state.index?.coaches || []).filter((c) => c.league === league);
  }

  function findCoach(id) {
    return (state.index?.coaches || []).find((c) => c.id === id) || null;
  }

  function renderChips() {
    const box = $("coachChips");
    if (!box) return;
    box.innerHTML = coachesInLeague(state.league)
      .map((c) => {
        const active = c.id === state.coachId ? " is-active" : "";
        const face = c.photo
          ? `<img src="${escapeHtml(c.photo)}" alt="" width="28" height="28" />`
          : `<span class="chip-fallback" style="--club:${escapeHtml(c.color || "#333")}">${escapeHtml(
              (c.name || "?").slice(0, 1)
            )}</span>`;
        return `<button class="coach-chip${active}" type="button" data-coach="${escapeHtml(c.id)}">${face}${escapeHtml(
          c.name
        )}${
          Number.isFinite(Number(c.rating))
            ? `<span class="chip-score">${escapeHtml(String(Math.round(Number(c.rating))))}</span>`
            : ""
        }</button>`;
      })
      .join("");
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

  function renderScout() {
    const box = $("scoutCard");
    const c = state.coach;
    if (!box || !c) return;
    const score = clamp(c.rating, 0, 100);
    const tactics = c.tactics || {};
    const pills = [
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
    const attrs = (c.abilities || [])
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
      `<svg class="gauge" viewBox="0 0 168 168" role="img" aria-label="추천도 ${score}점">` +
      `<circle class="gauge-ring gauge-track" cx="84" cy="84" r="70"></circle>` +
      `<circle class="gauge-ring gauge-value" cx="84" cy="84" r="70" pathLength="100" ` +
      `stroke-dasharray="${score} 100"></circle>` +
      `<text class="gauge-score" x="84" y="86" text-anchor="middle">${score}</text>` +
      `<text class="gauge-label" x="84" y="110" text-anchor="middle">추천도</text>` +
      `<text class="gauge-max" x="84" y="126" text-anchor="middle">100점</text>` +
      `</svg>` +
      (c.rating_note ? `<p class="scout-note">${escapeHtml(c.rating_note)}</p>` : "") +
      `</div>` +
      `<div class="scout-body"><div class="tactic-pills">${pills}</div><div class="ability-grid">${attrs}</div>` +
      `<p class="ability-caption">능력치 20점 만점 · 추천도 100점 만점 · 편집부 해석</p></div>`;
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

  function buildShareHtml(url) {
    const c = state.coach;
    if (!c) return "";
    const safeUrl = escapeHtml(url);
    const photo = c.photo
      ? `<img src="${escapeHtml(new URL(c.photo, CANONICAL).href)}" alt="${escapeHtml(
          c.name
        )}" width="72" height="90" style="float:left;margin:0 12px 8px 0;border-radius:8px;object-fit:cover;" />`
      : "";
    return [
      '<div style="display:block;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      '<table cellpadding="0" cellspacing="0" border="0" bgcolor="#1b2430" width="1100" style="width:100% !important;max-width:1100px;border-collapse:collapse;background-color:#1b2430;color:#f7f1e4;font-family:Arial,Helvetica,sans-serif;">',
      '<tr><td bgcolor="#1b2430" style="padding:16px 18px;background-color:#1b2430;color:#f7f1e4;">',
      '<p style="margin:0 0 12px;font-size:13px;line-height:1.7;color:#ddd4c4;">AI를 활용해 정리한 K리그 한국 감독 노트입니다. 공개 기록·보도를 바탕으로 했으며 해석은 참고용입니다.</p>',
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:#d4a017;">KOREAN K LEAGUE MANAGERS</p>',
      photo,
      `<p style="margin:0 0 8px;font-size:20px;font-weight:700;color:#f7f1e4;">${escapeHtml(c.name)} · ${escapeHtml(
        c.club
      )}${Number.isFinite(Number(c.rating)) ? ` · 추천도 ${escapeHtml(String(Math.round(Number(c.rating))))}` : ""}</p>`,
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#ddd4c4;">${escapeHtml(c.headline || "")}</p>`,
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#ddd4c4;">${escapeHtml(
        (c.sections?.[0]?.paragraphs || [])[0] || c.standfirst || ""
      )}</p>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#d4a017;color:#1b1404;font-weight:700;text-decoration:none;">감독 노트 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function setupShare() {
    if (!document.body.classList.contains("edit-mode") || isEmbedQuery()) return;
    const c = state.coach;
    if (!c) return;
    const url = publicUrl();
    if ($("shareTargetMeta")) $("shareTargetMeta").textContent = `${c.league_name} ${c.club} · ${c.name}`;
    if ($("shareCode")) $("shareCode").textContent = buildShareHtml(url);
    if ($("reportUrl")) {
      $("reportUrl").textContent = url;
      $("reportUrl").href = url;
    }
  }

  function renderAll() {
    const k1 = coachesInLeague("K1").length;
    const k2 = coachesInLeague("K2").length;
    if ($("asOf") && state.index) {
      $("asOf").textContent = `${state.index.season}시즌 · 한국인 감독 ${k1 + k2}명 (K1 ${k1} · K2 ${k2})`;
    }
    document.querySelectorAll(".league-tab").forEach((btn) => {
      btn.classList.toggle("is-active", btn.getAttribute("data-league") === state.league);
    });
    renderChips();
    renderPortrait();
    renderScout();
    renderTraits();
    renderColumn();
    renderTimeline();
    setupShare();
  }

  async function selectCoach(id, options) {
    const row = findCoach(id);
    if (!row) {
      setStatus("감독 데이터를 찾지 못했습니다.", true);
      return;
    }
    state.league = row.league;
    state.coachId = id;
    state.coach = row;
    renderAll();
    syncUrl();
    document.title = `${row.name} — K리그 한국 감독`;
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
        state.league = btn.getAttribute("data-league") || "K1";
        renderChips();
        document.querySelectorAll(".league-tab").forEach((b) => {
          b.classList.toggle("is-active", b.getAttribute("data-league") === state.league);
        });
      });
    });
    $("coachChips")?.addEventListener("click", (event) => {
      const btn = event.target.closest("[data-coach]");
      if (btn) selectCoach(btn.getAttribute("data-coach"), { scroll: true });
    });
    $("copyShare")?.addEventListener("click", () =>
      copyText(buildShareHtml(publicUrl()), "에버그린 링크 카드 HTML을 복사했습니다.")
    );
    $("copyUrl")?.addEventListener("click", () => copyText(publicUrl(), "공유 URL을 복사했습니다."));
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
    const requested = decodeRef(queryParams().get(URL_Q.coach));
    const exists = findCoach(requested);
    const target = exists ? requested : DEFAULT_ID;
    await selectCoach(target);
  }

  boot();
})();
