(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    index: null,
    preview: null,
  };

  const URL_Q = { match: "q", edit: "x" };
  const EDIT_TOKEN = "jb7k";
  const MATCH_XOR = 0x5a3c;
  const CANONICAL =
    "https://wanju1109.github.io/jeonbuk-lineup/p_report/index.html";

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch])
    );
  }

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
    return id > 0 ? String(id) : "";
  }

  function queryParams() {
    return new URLSearchParams(window.location.search);
  }

  function queryGameId() {
    return decodeMatchRef(queryParams().get(URL_Q.match)) || "";
  }

  function isEditQuery() {
    const p = queryParams();
    return p.get(URL_Q.edit) === EDIT_TOKEN || p.get("edit") === "1";
  }

  function applyViewMode() {
    document.body.classList.toggle("edit-mode", isEditQuery());
  }

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

  function publicPreviewUrl(gameId) {
    const id = gameId || state.preview?.meta?.game_id || queryGameId();
    const ref = encodeMatchRef(id);
    const current = window.location.href.split("#")[0].split("?")[0];
    const base = /wanju1109\.github\.io/i.test(current) ? current : CANONICAL;
    if (!ref) return base;
    return `${base}?${URL_Q.match}=${encodeURIComponent(ref)}`;
  }

  function buildShareHtml(url, preview) {
    const meta = preview?.meta || {};
    const title =
      preview?.headline ||
      `${meta.round || ""}R ${meta.home?.name || ""} vs ${meta.away?.name || ""}`.trim();
    const safeTitle = escapeHtml(title);
    const safeUrl = escapeHtml(url);
    const thesis = escapeHtml(preview?.thesis || "킥오프 전 전북 경기 프리뷰");
    return [
      '<div style="display:block;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      '<table cellpadding="0" cellspacing="0" border="0" bgcolor="#0f2a1c" width="1100" style="width:100% !important;max-width:1100px;min-width:100%;border-collapse:collapse;background-color:#0f2a1c;color:#f5fff8;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">',
      '<tr><td bgcolor="#0f2a1c" style="padding:16px 18px;background-color:#0f2a1c;color:#f5fff8;">',
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.08em;color:#f0b429;background-color:#0f2a1c;">JEONBUK MATCH AI PREVIEW</p>',
      `<p style="margin:0 0 10px;font-size:18px;font-weight:700;line-height:1.35;color:#f5fff8;background-color:#0f2a1c;">${safeTitle}</p>`,
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#d7efe3;background-color:#0f2a1c;">${thesis}</p>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#f0b429;color:#0a2218;font-weight:700;text-decoration:none;">프리뷰 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function formatCountdown(iso) {
    if (!iso) return "킥오프 미정";
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t)) return "킥오프 미정";
    const diff = t - Date.now();
    if (diff <= 0) return "킥오프 임박 / 진행·종료 가능";
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    if (h >= 48) return `킥오프까지 약 ${Math.round(h / 24)}일 ${h % 24}시간`;
    return `킥오프까지 ${h}시간 ${m}분`;
  }

  function renderForm(list, box) {
    if (!box) return;
    if (!list?.length) {
      box.innerHTML = `<p class="style-meta">최근 경기 데이터가 아직 없습니다.</p>`;
      return;
    }
    box.innerHTML = list
      .map((r) => {
        const label = `${r.round != null ? r.round + "R " : ""}${r.opponent || "?"}`;
        return (
          `<div class="form-row">` +
          `<span class="form-result ${escapeHtml(r.result || "?")}">${escapeHtml(r.result || "?")}</span>` +
          `<span>${escapeHtml(label)} · ${escapeHtml(r.ha === "H" ? "홈" : "원정")}</span>` +
          `<strong>${escapeHtml(r.score || "-")}</strong>` +
          `</div>`
        );
      })
      .join("");
  }

  function renderPreview(preview) {
    state.preview = preview;
    const meta = preview.meta || {};
    $("homeName").textContent = meta.home?.name || "홈";
    $("awayName").textContent = meta.away?.name || "원정";
    $("scoreNum").textContent = "VS";
    $("metaLine").textContent = [
      meta.competition,
      meta.round != null ? `${meta.round}라운드` : "",
      meta.kickoff_label,
      meta.ha === "H" ? "전북 홈" : meta.ha === "A" ? "전북 원정" : "",
    ]
      .filter(Boolean)
      .join(" · ");
    $("thesisBox").textContent = preview.thesis || "";
    $("countdown").textContent = formatCountdown(meta.kickoff);

    const badges = [];
    if (meta.within_48h) badges.push({ text: "48시간 윈도우", cls: "live" });
    if (meta.published === false) badges.push({ text: "초안(미공개)", cls: "warn" });
    if (meta.hours_to_kickoff != null) {
      badges.push({ text: `D-${escapeHtml(String(meta.hours_to_kickoff))}h`, cls: "" });
    }
    $("badgeRow").innerHTML = badges
      .map((b) => `<span class="badge ${b.cls}">${escapeHtml(b.text)}</span>`)
      .join("");

    $("cardsBox").innerHTML = (preview.cards || [])
      .map((card) => {
        const items = (card.items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
        return (
          `<article class="preview-card ${escapeHtml(card.key || "")}">` +
          `<h3>${escapeHtml(card.label || "")}</h3>` +
          `<ul>${items}</ul>` +
          `</article>`
        );
      })
      .join("");

    const jb = preview.style?.jeonbuk || {};
    const opp = preview.style?.opponent || {};
    $("styleBox").innerHTML =
      styleCard(jb) + styleCard(opp);

    $("oppFormTitle").textContent = `${meta.opponent || "상대"} 최근`;
    renderForm(preview.form?.jeonbuk || [], $("jbForm"));
    renderForm(preview.form?.opponent || [], $("oppForm"));
    renderForm(
      (preview.h2h || []).map((r) => ({
        result: r.result,
        score: r.score,
        round: r.round,
        opponent: String(r.home || "").includes("전북") ? r.away : r.home,
        ha: String(r.home || "").includes("전북") ? "H" : "A",
      })),
      $("h2hBox")
    );

    document.title = preview.headline
      ? `${preview.headline} | JEONBUK MATCH AI PREVIEW`
      : "JEONBUK MATCH AI PREVIEW";

    setupShare(preview);
    setStatus("");
  }

  function styleCard(style) {
    const tags = (style.tags || [])
      .map((t) => `<span class="tag">${escapeHtml(t)}</span>`)
      .join("");
    return (
      `<article class="style-card">` +
      `<h3>${escapeHtml(style.name || "")}</h3>` +
      `<p class="style-meta">${escapeHtml(style.record || "")}</p>` +
      `<p class="style-meta">평균 xG ${escapeHtml(String(style.avg_xg ?? "-"))} · 평균 슈팅 ${escapeHtml(String(style.avg_shots ?? "-"))}</p>` +
      `<div class="tag-row">${tags}</div>` +
      `</article>`
    );
  }

  function setupShare(preview) {
    if (!document.body.classList.contains("edit-mode")) return;
    const url = publicPreviewUrl(preview?.meta?.game_id);
    const html = buildShareHtml(url, preview);
    if ($("reportUrl")) {
      $("reportUrl").textContent = url;
      $("reportUrl").href = url;
    }
    if ($("shareCode")) $("shareCode").textContent = html;
    if ($("sourceNote")) {
      $("sourceNote").textContent = preview?.note || "";
    }
  }

  async function loadIndex() {
    const res = await fetch(`./data/index.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`index.json HTTP ${res.status}`);
    const data = await res.json();
    state.index = data;
    fillSelect();
    return data;
  }

  function fillSelect() {
    const sel = $("previewSelect");
    if (!sel) return;
    const rows = state.index?.matches || [];
    sel.innerHTML = "";
    if (!rows.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = "예정 프리뷰 없음 · 수집 후 다시 열어 주세요";
      sel.appendChild(opt);
      if ($("matchHelp")) {
        $("matchHelp").textContent =
          state.index?.note ||
          "schedule 갱신 후 python p_report/scripts/build_preview.py 를 실행하세요.";
      }
      return;
    }
    rows.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = String(m.game_id);
      const flag = m.published ? "" : " · 초안";
      opt.textContent = `${m.round}R ${m.home} vs ${m.away}${flag}`;
      sel.appendChild(opt);
    });
    const wanted = queryGameId() || state.index.active_game_id || rows[0].game_id;
    if (wanted) sel.value = String(wanted);
    if ($("matchHelp")) {
      $("matchHelp").textContent = `프리뷰 ${rows.length}경기 · 48시간 윈도우 자동 게시`;
    }
  }

  async function loadPreview(gameId) {
    const id = gameId || $("previewSelect")?.value || state.index?.active_game_id;
    if (!id) {
      setStatus("불러올 프리뷰가 없습니다.", true);
      return;
    }
    setStatus("프리뷰를 불러오는 중…");
    const res = await fetch(`./data/${id}.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) {
      setStatus(
        `프리뷰 파일이 없습니다 (./data/${id}.json).\n` +
          `python p_report/scripts/build_preview.py 실행 후 다시 시도하세요.`,
        true
      );
      return;
    }
    const data = await res.json();
    renderPreview(data);
    syncUrl(id);
  }

  function syncUrl(gameId) {
    if (!gameId || !window.history?.replaceState) return;
    const ref = encodeMatchRef(gameId);
    if (!ref) return;
    const next = new URLSearchParams();
    next.set(URL_Q.match, ref);
    if (isEditQuery()) next.set(URL_Q.edit, EDIT_TOKEN);
    window.history.replaceState({}, "", `${location.pathname}?${next.toString()}`);
  }

  function bindUi() {
    $("fetchBtn")?.addEventListener("click", () => loadPreview($("previewSelect")?.value));
    $("previewSelect")?.addEventListener("change", () => {
      if ($("matchHelp")) {
        $("matchHelp").textContent = "프리뷰 불러오기를 누르면 내용이 바뀝니다.";
      }
    });
    $("copyShare")?.addEventListener("click", async () => {
      try {
        const text = $("shareCode")?.textContent || buildShareHtml(publicPreviewUrl(), state.preview);
        await navigator.clipboard.writeText(text);
        setStatus("프리뷰 링크 카드를 복사했습니다.");
      } catch (err) {
        setStatus("복사에 실패했습니다. 코드를 직접 드래그해 주세요.", true);
      }
    });
    $("copyUrl")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(publicPreviewUrl());
        setStatus("프리뷰 URL을 복사했습니다.");
      } catch (err) {
        setStatus("URL 복사에 실패했습니다.", true);
      }
    });
  }

  async function boot() {
    applyViewMode();
    bindUi();
    try {
      await loadIndex();
      const wanted = queryGameId() || state.index?.active_game_id;
      if (wanted) await loadPreview(wanted);
      else if ((state.index?.matches || []).length) {
        await loadPreview(state.index.matches[0].game_id);
      } else {
        setStatus(
          "아직 생성된 프리뷰가 없습니다.\n" +
            "1) c_report schedule 수집\n" +
            "2) python p_report/scripts/build_preview.py",
          true
        );
      }
    } catch (err) {
      console.error(err);
      setStatus("프리뷰 목록을 불러오지 못했습니다.\n" + String(err.message || err), true);
    }
  }

  boot();
})();
