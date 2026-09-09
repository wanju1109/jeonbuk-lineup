(() => {
  const $ = (id) => document.getElementById(id);
  const state = {
    history: null,
    pack: null,
    filter: "ALL",
    seed: Date.now(),
  };

  function setStatus(msg, isError = false) {
    const el = $("status");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.className = "status" + (isError ? " error" : "");
    el.textContent = msg;
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  }

  async function loadJson(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
    return res.json();
  }

  function categories(records) {
    const set = new Set(records.map((r) => r.category).filter(Boolean));
    return ["ALL", ...[...set].sort()];
  }

  function renderFilters(records) {
    const box = $("filters");
    if (!box) return;
    const cats = categories(records);
    if (!cats.includes(state.filter)) state.filter = "ALL";
    box.innerHTML = cats
      .map((c) => {
        const label = c === "ALL" ? "전체" : c;
        const active = c === state.filter ? " active" : "";
        return `<button type="button" class="chip${active}" data-cat="${escapeHtml(c)}">${escapeHtml(label)}</button>`;
      })
      .join("");
    box.querySelectorAll(".chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.filter = btn.getAttribute("data-cat") || "ALL";
        renderFilters(records);
        renderCards();
      });
    });
  }

  function renderCards() {
    const box = $("grid");
    if (!box || !state.pack) return;
    const records = (state.pack.records || []).filter(
      (r) => state.filter === "ALL" || r.category === state.filter
    );
    if (!records.length) {
      box.innerHTML = `<article class="card"><p class="text">이 카테고리 기록이 없습니다. 새로고침을 눌러보세요.</p></article>`;
      return;
    }
    box.innerHTML = records
      .map((r, i) => {
        const delay = Math.min(i, 12) * 30;
        return (
          `<article class="card" style="animation-delay:${delay}ms">` +
          `<p class="card-cat">${escapeHtml(r.category || "")}</p>` +
          `<h3>${escapeHtml(r.title || "")}</h3>` +
          `<p class="text">${escapeHtml(r.text || "")}</p>` +
          (r.detail ? `<p class="detail">${escapeHtml(r.detail)}</p>` : "") +
          (r.as_of ? `<p class="asof">기준 ${escapeHtml(r.as_of)}</p>` : "") +
          `</article>`
        );
      })
      .join("");
  }

  function renderMeta() {
    const el = $("meta");
    if (!el || !state.pack) return;
    const h = state.history || {};
    el.textContent =
      `기록 ${state.pack.records_n || 0}개 · 경기 ${state.pack.history_matches || 0}경기 반영` +
      (h.from_year && h.to_year ? ` · ${h.from_year}–${h.to_year}` : "") +
      (state.pack.as_of ? ` · as of ${state.pack.as_of}` : "") +
      ` · seed ${state.seed}`;
  }

  function rebuild(seed) {
    if (!state.history || typeof FunRecordsEngine === "undefined") return;
    state.seed = seed ?? Date.now();
    state.pack = FunRecordsEngine.buildRecords(state.history, state.seed);
    renderMeta();
    renderFilters(state.pack.records || []);
    renderCards();
    setStatus(`새로고침 완료 — ${state.pack.records_n}개 기록을 다시 집계했습니다.`);
  }

  async function boot() {
    setStatus("기록 데이터 로딩 중…");
    try {
      const [history, records] = await Promise.all([
        loadJson("./data/history.json"),
        loadJson("./data/records.json").catch(() => null),
      ]);
      state.history = history;
      if (history?.matches?.length && typeof FunRecordsEngine !== "undefined") {
        rebuild(Date.now());
      } else if (records?.records?.length) {
        state.pack = records;
        renderMeta();
        renderFilters(records.records);
        renderCards();
        setStatus("사전 생성 기록을 표시합니다. 새로고침으로 재배치할 수 있습니다.");
      } else {
        setStatus("history.json이 없습니다. collect_history.py를 먼저 실행하세요.", true);
      }
    } catch (err) {
      setStatus(`로딩 실패: ${err.message || err}`, true);
    }
  }

  $("refreshBtn")?.addEventListener("click", () => {
    const btn = $("refreshBtn");
    if (btn) btn.disabled = true;
    try {
      rebuild(Date.now());
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  boot();
})();
