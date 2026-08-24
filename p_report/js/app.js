(() => {
  const $ = (id) => document.getElementById(id);

  const CANONICAL =
    "https://wanju1109.github.io/jeonbuk-lineup/p_report/index.html";
  const MAX_ROUNDS = 38;
  const SCHEDULE_URL = "../c_report/data/schedule.json";
  const JEONBUK = "전북";

  const state = {
    index: null,
    schedule: null,
    preview: null,
    otherPreview: null,
    countdownTimer: null,
    kickoffIso: "",
  };

  const URL_Q = { match: "q", edit: "x", embed: "f" };
  const EDIT_TOKEN = "jb7k";
  const EMBED_TOKEN = "y";
  const MATCH_XOR = 0x5a3c;

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

  function emblemUrl(teamId) {
    if (!teamId) return "";
    return `https://portal.kleague.com/images/portal/img-emble-${String(teamId).toLowerCase()}-sm.png`;
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

  function emblemImgHtml(teamId, teamName, size = 28) {
    if (!teamId) return "";
    const alt = escapeHtml(teamName ? `${teamName} 엠블럼` : "팀 엠블럼");
    const src = escapeHtml(emblemUrl(teamId));
    return `<img class="team-emblem inline-emblem" src="${src}" alt="${alt}" width="${size}" height="${size}" decoding="async" onerror="this.hidden=true" />`;
  }

  function isJeonbukMatch(metaOrRow) {
    const blob = `${metaOrRow?.home?.name || metaOrRow?.home || ""}${metaOrRow?.away?.name || metaOrRow?.away || ""}`;
    return blob.includes(JEONBUK);
  }

  function applyTeamColors(meta) {
    if (!meta || typeof TeamColors === "undefined") return;
    TeamColors.apply(meta.home, meta.away);
  }

  function publicPreviewUrl(gameId) {
    const id = gameId || state.preview?.meta?.game_id || queryGameId();
    const ref = encodeMatchRef(id);
    const current = window.location.href.split("#")[0].split("?")[0];
    const base = /wanju1109\.github\.io/i.test(current) ? current : CANONICAL;
    if (!ref) return base;
    return `${base}?${URL_Q.match}=${encodeURIComponent(ref)}`;
  }

  function embedSrcUrl() {
    const report = publicPreviewUrl();
    const join = report.includes("?") ? "&" : "?";
    return `${report}${join}${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
  }

  function buildEmbedHtml(src) {
    return [
      '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      `<iframe src="${escapeHtml(src)}" title="전북 매치 프리뷰" width="100%" height="920" style="width:100%;max-width:1100px;height:920px;border:0;border-radius:12px;overflow:hidden;background:#f3f7f2;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
      "</div>",
    ].join("");
  }

  function buildShareHtml(url, preview) {
    const meta = preview?.meta || {};
    const title =
      preview?.headline ||
      `${meta.round || ""}R ${meta.home?.name || ""} vs ${meta.away?.name || ""}`.trim();
    const safeTitle = escapeHtml(title);
    const safeUrl = escapeHtml(url);
    const thesis = escapeHtml(preview?.thesis || "킥오프 전 전북 경기 프리뷰");
    const homeEm = emblemImgHtml(meta.home?.team_id, meta.home?.name, 36);
    const awayEm = emblemImgHtml(meta.away?.team_id, meta.away?.name, 36);
    return [
      '<div style="display:block;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      '<table cellpadding="0" cellspacing="0" border="0" bgcolor="#0f2a1c" width="1100" style="width:100% !important;max-width:1100px;min-width:100%;border-collapse:collapse;background-color:#0f2a1c;color:#f5fff8;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">',
      '<tr><td bgcolor="#0f2a1c" style="padding:16px 18px;background-color:#0f2a1c;color:#f5fff8;">',
      '<p style="margin:0 0 14px;font-size:13px;line-height:1.7;color:#e8f6ee;background-color:#0f2a1c;">',
      "AI를 활용하여 작성한 PREVIEW 입니다.<br>",
      "칼럼/분석 탭을 누르면 미래의 분석관을 꿈꾸는 분들께서 작성한, 재미있고 상세한 분석 글들이 많이 있습니다.<br>",
      "AI는 잘못된 정보를 전달할 수 있습니다. 무조건적인 신뢰보다는 적당한 선에서 비판적인 시선으로 봐주세요.",
      "</p>",
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;color:#f0b429;background-color:#0f2a1c;">JEONBUK MATCH AI PREVIEW</p>',
      `<p style="margin:0 0 10px;font-size:18px;font-weight:700;line-height:1.35;color:#f5fff8;background-color:#0f2a1c;">${safeTitle}</p>`,
      `<p style="margin:0 0 12px;font-size:14px;line-height:1.5;color:#d7efe3;background-color:#0f2a1c;">${homeEm} VS ${awayEm}</p>`,
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#d7efe3;background-color:#0f2a1c;">${thesis}</p>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#f0b429;color:#0a2218;font-weight:700;text-decoration:none;">프리뷰 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function pad2(n) {
    return String(Math.max(0, n)).padStart(2, "0");
  }

  function stopCountdown() {
    if (state.countdownTimer) {
      clearInterval(state.countdownTimer);
      state.countdownTimer = null;
    }
  }

  function renderCountdown(iso) {
    state.kickoffIso = iso || "";
    stopCountdown();

    const tick = () => {
      const daysEl = $("cdDays");
      const hoursEl = $("cdHours");
      const minsEl = $("cdMins");
      const secsEl = $("cdSecs");
      const wrap = $("countdown");
      if (!daysEl || !hoursEl || !minsEl || !secsEl || !wrap) return;

      if (!state.kickoffIso) {
        daysEl.textContent = "-";
        hoursEl.textContent = "-";
        minsEl.textContent = "-";
        secsEl.textContent = "-";
        wrap.classList.remove("cd-live", "cd-done");
        return;
      }

      const t = new Date(state.kickoffIso).getTime();
      if (!Number.isFinite(t)) {
        daysEl.textContent = "?";
        hoursEl.textContent = "?";
        minsEl.textContent = "?";
        secsEl.textContent = "?";
        return;
      }

      const diff = t - Date.now();
      if (diff <= 0) {
        daysEl.textContent = "00";
        hoursEl.textContent = "00";
        minsEl.textContent = "00";
        secsEl.textContent = "00";
        wrap.classList.add("cd-done");
        wrap.classList.remove("cd-live");
        stopCountdown();
        return;
      }

      wrap.classList.add("cd-live");
      wrap.classList.remove("cd-done");
      const totalSec = Math.floor(diff / 1000);
      const days = Math.floor(totalSec / 86400);
      const hours = Math.floor((totalSec % 86400) / 3600);
      const mins = Math.floor((totalSec % 3600) / 60);
      const secs = totalSec % 60;
      daysEl.textContent = pad2(days);
      hoursEl.textContent = pad2(hours);
      minsEl.textContent = pad2(mins);
      secsEl.textContent = pad2(secs);
    };

    tick();
    state.countdownTimer = setInterval(tick, 1000);
  }

  function renderForm(list, box, detailed = false) {
    if (!box) return;
    if (!list?.length) {
      box.innerHTML = `<p class="style-meta">최근 경기 데이터가 아직 없습니다.</p>`;
      return;
    }
    box.innerHTML = list
      .map((r) => {
        const label = `${r.round != null ? r.round + "R " : ""}${r.opponent || "?"}`;
        const ha = r.ha === "H" ? "홈" : "원정";
        const stats = detailed
          ? `<span class="form-stats">xG ${escapeHtml(String(r.xg ?? "-"))} · ${escapeHtml(String(r.shots ?? "-"))}슈팅</span>`
          : "";
        return (
          `<div class="form-row">` +
          `<span class="form-result ${escapeHtml(r.result || "?")}">${escapeHtml(r.result || "?")}</span>` +
          `<span>${escapeHtml(label)} · ${escapeHtml(ha)}${stats}</span>` +
          `<strong>${escapeHtml(r.score || "-")}</strong>` +
          `</div>`
        );
      })
      .join("");
  }

  function renderMatchup(matchup, meta) {
    const box = $("matchupBox");
    const summary = $("matchupSummary");
    if (summary) summary.textContent = matchup?.summary || "";
    if (!box) return;
    const rows = matchup?.rows || [];
    const leftName = meta?.home?.name || "홈";
    const rightName = meta?.away?.name || "원정";
    if (!rows.length) {
      box.innerHTML = `<p class="style-meta">비교 데이터가 아직 없습니다.</p>`;
      return;
    }
    box.innerHTML =
      `<div class="stat-head">` +
      `<span></span><span>${escapeHtml(leftName)}</span><span>${escapeHtml(rightName)}</span>` +
      `</div>` +
      rows
        .map((row) => {
          const suf = row.suffix || "";
          const jbVal = row.jeonbuk ?? "-";
          const oppVal = row.opponent ?? "-";
          const jbCls = row.better === "jeonbuk" ? " stat-win" : "";
          const oppCls = row.better === "opponent" ? " stat-win" : "";
          return (
            `<div class="stat-row">` +
            `<span class="stat-label">${escapeHtml(row.label || "")}</span>` +
            `<span class="stat-val${jbCls}">${escapeHtml(String(jbVal))}${escapeHtml(suf)}</span>` +
            `<span class="stat-val${oppCls}">${escapeHtml(String(oppVal))}${escapeHtml(suf)}</span>` +
            `</div>`
          );
        })
        .join("");
  }

  function renderScout(scout) {
    const contrast = $("scoutContrast");
    const box = $("scoutBox");
    if (contrast) contrast.textContent = scout?.contrast || "";
    if (!box) return;
    const blocks = [
      { key: "edge", label: "유리한 점", items: scout?.edge },
      { key: "risk", label: "불리·조심", items: scout?.risk },
      { key: "target", label: "노릴 점", items: scout?.target },
      { key: "caution", label: "경계", items: scout?.caution },
    ];
    box.innerHTML = blocks
      .map((b) => {
        const items = (b.items || []).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
        return (
          `<article class="scout-card ${escapeHtml(b.key)}">` +
          `<h3>${escapeHtml(b.label)}</h3>` +
          `<ul>${items || "<li>데이터 축적 중</li>"}</ul>` +
          `</article>`
        );
      })
      .join("");
  }

  function renderBriefing(lines) {
    const box = $("briefingBox");
    if (!box) return;
    if (!lines?.length) {
      box.innerHTML = "";
      return;
    }
    box.innerHTML = lines.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  }

  function renderPreview(preview) {
    state.preview = preview;
    const meta = preview.meta || {};
    const isJb = meta.jeonbuk_match !== false && isJeonbukMatch(meta);
    applyTeamColors(meta);
    setEmblem($("homeEmblem"), meta.home?.team_id, meta.home?.name);
    setEmblem($("awayEmblem"), meta.away?.team_id, meta.away?.name);
    $("homeName").textContent = meta.home?.name || "홈";
    $("awayName").textContent = meta.away?.name || "원정";
    $("scoreNum").textContent = "VS";

    const venue = meta.venue || "";
    const att = meta.attendance_hint?.avg;
    $("metaLine").textContent = [
      meta.competition,
      meta.round != null ? `${meta.round}라운드` : "",
      meta.kickoff_label,
      venue,
      att ? `홈 평균 관중 ${Number(att).toLocaleString()}명` : "",
      isJb && meta.ha === "H" ? "전북 홈" : "",
      isJb && meta.ha === "A" ? "전북 원정" : "",
      !isJb ? "타팀 경기" : "",
    ]
      .filter(Boolean)
      .join(" · ");

    $("thesisBox").textContent = preview.thesis || "";
    renderBriefing(preview.briefing || []);
    renderCountdown(meta.kickoff);

    const badges = [];
    if (meta.within_48h) badges.push({ text: "48시간 윈도우", cls: "live" });
    if (meta.published === false) badges.push({ text: "초안(미공개)", cls: "warn" });
    if (meta.hours_to_kickoff != null && meta.hours_to_kickoff >= 0) {
      badges.push({ text: `약 ${Math.ceil(meta.hours_to_kickoff)}시간 후 킥오프`, cls: "" });
    }
    $("badgeRow").innerHTML = badges
      .map((b) => `<span class="badge ${b.cls}">${escapeHtml(b.text)}</span>`)
      .join("");

    renderMatchup(preview.matchup, meta);
    renderScout(preview.scout);

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
    $("styleBox").innerHTML = styleCard(jb) + styleCard(opp);

    if ($("jbFormTitle")) {
      $("jbFormTitle").textContent = isJb ? "전북 최근" : `${meta.home?.name || "홈"} 최근`;
    }
    $("oppFormTitle").textContent = isJb
      ? `${meta.opponent || "상대"} 최근`
      : `${meta.away?.name || "원정"} 최근`;
    renderForm(preview.form?.jeonbuk || [], $("jbForm"), true);
    renderForm(preview.form?.opponent || [], $("oppForm"), true);

    const h2hSum = preview.h2h_summary || {};
    if ($("h2hTitle")) {
      $("h2hTitle").textContent = isJb
        ? "(전북 기준)"
        : `(${meta.home?.name || "홈"} 기준)`;
    }
    if ($("h2hRecord")) {
      $("h2hRecord").textContent = h2hSum.games
        ? `${h2hSum.wins}승 ${h2hSum.draws}무 ${h2hSum.losses}패`
        : "";
    }
    renderForm(
      (preview.h2h || []).map((r) => ({
        result: r.result,
        score: r.score,
        round: r.round,
        opponent: r.home === meta.home?.name ? r.away : r.home,
        ha: r.home === meta.home?.name ? "H" : "A",
        xg: "",
        shots: "",
      })),
      $("h2hBox"),
      false
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
    const em = style.team_id
      ? `<img class="team-emblem style-emblem" src="${escapeHtml(emblemUrl(style.team_id))}" alt="${escapeHtml(style.name || "")} 엠블럼" width="36" height="36" decoding="async" onerror="this.hidden=true" />`
      : "";
    return (
      `<article class="style-card">` +
      `<div class="style-head">${em}<h3>${escapeHtml(style.name || "")}</h3></div>` +
      `<p class="style-meta">${escapeHtml(style.record || "")} · ${escapeHtml(String(style.goals_for ?? 0))}득 ${escapeHtml(String(style.goals_against ?? 0))}실</p>` +
      `<p class="style-meta">xG ${escapeHtml(String(style.avg_xg ?? "-"))} · xGA ${escapeHtml(String(style.avg_xga ?? "-"))} · 슈팅 ${escapeHtml(String(style.avg_shots ?? "-"))} · 유효슈팅 ${escapeHtml(String(style.avg_sot ?? "-"))}</p>` +
      `<p class="style-meta">패스 ${escapeHtml(String(style.avg_pass_pct ?? "-"))}% · 파이널서드 ${escapeHtml(String(style.avg_final_third_pct ?? "-"))}% · 터치 높이 ${escapeHtml(String(style.avg_x ?? "-"))} · 압박 ${escapeHtml(String(style.avg_presses ?? "-"))}회</p>` +
      `<div class="tag-row">${tags}</div>` +
      `</article>`
    );
  }

  function setupShare(preview) {
    if (!document.body.classList.contains("edit-mode")) return;
    const url = publicPreviewUrl(preview?.meta?.game_id);
    const embedSrc = embedSrcUrl();
    const html = buildShareHtml(url, preview);
    const embedHtml = buildEmbedHtml(embedSrc);

    if ($("reportUrl")) {
      $("reportUrl").textContent = url;
      $("reportUrl").href = url;
    }
    if ($("shareCode")) $("shareCode").textContent = html;
    if ($("embedCode")) $("embedCode").textContent = embedHtml;
    if ($("embedPreview")) {
      const gameId = preview?.meta?.game_id;
      const ref = encodeMatchRef(gameId);
      const localEmbed = `./index.html?${URL_Q.match}=${encodeURIComponent(ref)}&${URL_Q.embed}=${encodeURIComponent(EMBED_TOKEN)}`;
      const nextSrc = /localhost|127\.0\.0\.1/i.test(window.location.hostname)
        ? localEmbed
        : embedSrc;
      if ($("embedPreview").getAttribute("src") !== nextSrc) {
        $("embedPreview").src = nextSrc;
      }
    }
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

  async function loadSchedule() {
    try {
      const res = await fetch(`${SCHEDULE_URL}?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`schedule HTTP ${res.status}`);
      const data = await res.json();
      state.schedule = data && Array.isArray(data.matches) ? data : { matches: [] };
    } catch (err) {
      console.error(err);
      state.schedule = { matches: [] };
    }
  }

  function otherMatchesForRound(year, round) {
    return (state.schedule?.matches || []).filter((m) => {
      if (String(m.year) !== String(year)) return false;
      if (Number(m.round) !== Number(round)) return false;
      if (isJeonbukMatch(m)) return false;
      if (String(m.end_yn || "N").toUpperCase() === "Y") return false;
      return true;
    });
  }

  function fillOtherYearRound() {
    const yearSel = $("otherYearSelect");
    const roundSel = $("otherRoundSelect");
    if (!yearSel || !roundSel) return;

    const fromSchedule = (state.schedule?.matches || []).map((m) => String(m.year));
    const fromIndex = (state.index?.matches || []).map((m) => String(m.year));
    const years = [...new Set([...fromSchedule, ...fromIndex, String(new Date().getFullYear())])]
      .filter(Boolean)
      .sort()
      .reverse();

    const prevYear = yearSel.value;
    const prevRound = roundSel.value;
    yearSel.innerHTML = years.map((y) => `<option value="${y}">${y}</option>`).join("");
    if (prevYear && years.includes(prevYear)) yearSel.value = prevYear;
    else if (years.length) yearSel.value = years[0];

    rebuildOtherRounds(prevRound);
  }

  function rebuildOtherRounds(preferredRound) {
    const yearSel = $("otherYearSelect");
    const roundSel = $("otherRoundSelect");
    if (!yearSel || !roundSel) return;

    const year = yearSel.value;
    const scheduleRounds = (state.schedule?.matches || [])
      .filter((m) => String(m.year) === String(year) && !isJeonbukMatch(m))
      .map((m) => Number(m.round));
    const latest = Math.max(1, ...(scheduleRounds.length ? scheduleRounds : [1]));
    const keep =
      preferredRound != null && preferredRound !== "" ? preferredRound : String(latest);

    roundSel.innerHTML = "";
    for (let r = 1; r <= MAX_ROUNDS; r++) {
      const opt = document.createElement("option");
      opt.value = String(r);
      opt.textContent = `${r}R`;
      roundSel.appendChild(opt);
    }
    if (Number(keep) >= 1 && Number(keep) <= MAX_ROUNDS) roundSel.value = String(keep);
    else roundSel.value = String(latest);

    rebuildOtherMatches();
  }

  function rebuildOtherMatches() {
    const matchSel = $("otherMatchSelect");
    const help = $("otherMatchHelp");
    if (!matchSel) return;

    const year = $("otherYearSelect")?.value || "";
    const round = $("otherRoundSelect")?.value || "";
    const list = otherMatchesForRound(year, round);
    const prev = matchSel.value;

    matchSel.innerHTML = "";
    if (!list.length) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = state.schedule?.matches?.length
        ? "이 라운드에 전북전 제외 예정 경기 없음"
        : "일정 데이터 없음";
      matchSel.appendChild(opt);
      if (help) {
        help.textContent = state.schedule?.matches?.length
          ? `${year}시즌 ${round}R · 전북전을 뺀 미종료 경기가 없습니다.`
          : "schedule.json 수집 후 다시 열어 주세요.";
      }
      return;
    }

    list.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = String(m.game_id);
      opt.textContent = `${m.home || "?"} vs ${m.away || "?"}`;
      matchSel.appendChild(opt);
    });
    if (prev && list.some((m) => String(m.game_id) === String(prev))) {
      matchSel.value = prev;
    }
    if (help) {
      help.textContent = `${year}시즌 ${round}R · 전북전 제외 예정 ${list.length}경기`;
    }
  }

  function showOtherPreviewMessage(msg, isError = false) {
    const box = $("otherPreview");
    if (!box) return;
    box.classList.remove("hidden");
    box.innerHTML = `<p class="other-report-empty${isError ? " error" : ""}">${escapeHtml(msg)}</p>`;
  }

  function renderOtherPreview(preview) {
    const box = $("otherPreview");
    if (!box) return;
    state.otherPreview = preview;
    const meta = preview.meta || {};
    const gameId = String(meta.game_id || "");
    const publicUrl = publicPreviewUrl(gameId);
    const shareHtml = buildShareHtml(publicUrl, preview);
    const openHref = (() => {
      const ref = encodeMatchRef(gameId);
      if (!ref) return "";
      const params = new URLSearchParams();
      params.set(URL_Q.match, ref);
      if (isEditQuery()) params.set(URL_Q.edit, EDIT_TOKEN);
      return `./index.html?${params.toString()}`;
    })();

    const cardSnippets = (preview.cards || [])
      .slice(0, 2)
      .map((c) => {
        const first = (c.items || [])[0] || "";
        return first
          ? `<article><h4>${escapeHtml(c.label || "")}</h4><p>${escapeHtml(first)}</p></article>`
          : "";
      })
      .join("");

    box.classList.remove("hidden");
    box.innerHTML =
      `<article class="other-report-card" data-game-id="${escapeHtml(gameId)}">` +
      `<div class="other-report-head">` +
      `${emblemImgHtml(meta.home?.team_id, meta.home?.name, 40)}` +
      `<span class="team">${escapeHtml(meta.home?.name || "홈")}</span>` +
      `<span class="vs">VS</span>` +
      `<span class="team">${escapeHtml(meta.away?.name || "원정")}</span>` +
      `${emblemImgHtml(meta.away?.team_id, meta.away?.name, 40)}` +
      `</div>` +
      `<p class="other-report-meta">${escapeHtml(
        [meta.competition, meta.round != null ? `${meta.round}라운드` : "", meta.kickoff_label, meta.venue]
          .filter(Boolean)
          .join(" · ")
      )}</p>` +
      `<p class="other-report-thesis">${escapeHtml(preview.thesis || "")}</p>` +
      `<div class="other-report-cards">${cardSnippets}</div>` +
      `<div class="other-report-share">` +
      `<p class="other-report-share-label">커뮤니티 공유</p>` +
      `<p class="other-report-share-url"><a href="${escapeHtml(publicUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(publicUrl)}</a></p>` +
      `<div class="other-report-share-actions">` +
      `<button type="button" class="btn btn-primary" id="otherCopyShare">링크 카드 복사</button>` +
      `<button type="button" class="btn btn-ghost" id="otherCopyUrl">URL만 복사</button>` +
      (openHref
        ? `<a class="btn btn-ghost" href="${escapeHtml(openHref)}" target="_blank" rel="noopener noreferrer">전체 프리뷰 보기</a>`
        : "") +
      `</div>` +
      `<pre class="embed-code other-share-code" id="otherShareCode" hidden></pre>` +
      `</div>` +
      `</article>`;

    const shareCodeEl = $("otherShareCode");
    if (shareCodeEl) shareCodeEl.textContent = shareHtml;

    $("otherCopyShare")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(shareHtml);
        setStatus("타팀 프리뷰 링크 카드를 복사했습니다.");
      } catch (err) {
        setStatus("복사에 실패했습니다.", true);
        if (shareCodeEl) shareCodeEl.hidden = false;
      }
    });
    $("otherCopyUrl")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(publicUrl);
        setStatus("타팀 프리뷰 URL을 복사했습니다.");
      } catch (err) {
        setStatus("URL 복사에 실패했습니다.", true);
      }
    });
  }

  async function fetchOtherPreview() {
    const btn = $("otherFetchBtn");
    const gameId = $("otherMatchSelect")?.value || "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = "불러오는 중…";
    }
    try {
      await loadSchedule();
      fillOtherYearRound();
      const selected = $("otherMatchSelect")?.value || gameId;
      if (!selected) {
        showOtherPreviewMessage("경기를 먼저 선택해 주세요.", true);
        return;
      }
      const res = await fetch(`./data/${selected}.json?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) {
        showOtherPreviewMessage(
          `아직 이 경기 프리뷰 JSON이 없습니다.\n` +
            `python p_report/scripts/build_preview.py 실행 후 다시 눌러 주세요.\n` +
            `(game_id=${selected}, 라운드 ${$("otherRoundSelect")?.value || ""})`,
          true
        );
        return;
      }
      const data = await res.json();
      renderOtherPreview(data);
      setStatus("");
    } catch (err) {
      console.error(err);
      showOtherPreviewMessage(String(err.message || err), true);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "프리뷰 불러오기";
      }
    }
  }

  function bindOtherLeagueUi() {
    $("otherYearSelect")?.addEventListener("change", () => rebuildOtherRounds());
    $("otherRoundSelect")?.addEventListener("change", () => rebuildOtherMatches());
    $("otherFetchBtn")?.addEventListener("click", fetchOtherPreview);
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
    $("copyEmbed")?.addEventListener("click", async () => {
      try {
        const text = $("embedCode")?.textContent || buildEmbedHtml(embedSrcUrl());
        await navigator.clipboard.writeText(text);
        setStatus("iframe HTML을 복사했습니다.");
      } catch (err) {
        setStatus("복사에 실패했습니다.", true);
      }
    });
    window.addEventListener("beforeunload", stopCountdown);
  }

  async function boot() {
    applyViewMode();
    bindUi();
    bindOtherLeagueUi();
    try {
      await Promise.all([loadIndex(), loadSchedule()]);
      fillOtherYearRound();
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
      try {
        await loadSchedule();
        fillOtherYearRound();
      } catch (schedErr) {
        console.error(schedErr);
      }
    }
  }

  boot();
})();
