(() => {
  const DATA_VER = "28";
  const DATA_INDEX = `./data/index.json?v=${DATA_VER}`;
  const DATA_PLAYER = (id) => `./data/players/${encodeURIComponent(id)}.json?v=${DATA_VER}`;
  const DATA_FM_ATTRIBUTES = "./data/fm_attributes.json?v=2";
  const CANONICAL = "https://wanju1109.github.io/jeonbuk-lineup/player_report/";
  const EDIT_TOKEN = "jb7k";
  const EMBED_TOKEN = "y";

  const state = {
    index: null,
    fmAttributes: null,
    leagueId: "1",
    teamId: "",
    pos: "ALL",
    q: "",
    playerId: "",
    player: null,
    compareId: "",
    comparePlayer: null,
    rivals: [],
    events: null,
    cache: new Map(),
  };

  const $ = (id) => document.getElementById(id);

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function dash(v) {
    if (v === null || v === undefined || v === "") return "–";
    return String(v);
  }

  function setStatus(msg) {
    const el = $("status");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.textContent = msg;
  }

  function parseHash() {
    const raw = (location.hash || "").replace(/^#\/?/, "");
    const parts = raw.split("/").filter(Boolean);
    const vsAt = parts.indexOf("vs");
    return {
      leagueId: parts[0] || "",
      teamId: parts[1] || "",
      playerId: parts[2] && parts[2] !== "vs" ? parts[2] : "",
      compareId: vsAt >= 0 ? parts[vsAt + 1] || "" : "",
    };
  }

  function routeHash() {
    const bits = [state.leagueId, state.teamId, state.playerId].filter(Boolean);
    if (state.playerId && state.compareId) bits.push("vs", state.compareId);
    return bits.length ? `#/${bits.join("/")}` : "";
  }

  function urlWithHash(hash) {
    return location.pathname + location.search + (hash || "");
  }

  function writeHash(mode) {
    const next = routeHash();
    if (location.hash === next) return;
    const url = urlWithHash(next);
    try {
      if (mode === "replace") history.replaceState(null, "", url);
      else history.pushState(null, "", url);
    } catch (err) {
      appliedUrl = url;
      location.hash = next.replace(/^#/, "");
      return;
    }
    appliedUrl = url;
  }

  let appliedUrl = "";

  function isEditQuery() {
    try {
      const p = new URLSearchParams(location.search || "");
      return p.get("x") === EDIT_TOKEN || p.get("edit") === "1";
    } catch (err) {
      return false;
    }
  }

  function isEmbedQuery() {
    try {
      const p = new URLSearchParams(location.search || "");
      return p.get("f") === EMBED_TOKEN || p.get("embed") === "1";
    } catch (err) {
      return false;
    }
  }

  function isFramed() {
    try {
      return window.self !== window.top;
    } catch (err) {
      return true;
    }
  }

  function applyViewMode() {
    document.body.classList.toggle("edit-mode", isEditQuery());
    document.body.classList.toggle("embed-mode", isEmbedQuery());
    document.body.classList.toggle("in-frame", isFramed());
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
    return `${home}${join}f=${encodeURIComponent(EMBED_TOKEN)}`;
  }

  function publicShareUrl() {
    return `${publicHomeUrl()}${routeHash()}`;
  }

  function homeShareCopy() {
    return {
      title: "K리그 선수 프로필",
      sub: "구단을 고르고 선수를 누르면 공식 출장·득점·도움과 칠판 기록을 한 장에 모읍니다.",
      meta: "공유 대상: 선수 프로필 메인",
    };
  }

  function previewShareUrl() {
    const current = pageBaseNoQuery();
    if (/localhost|127\.0\.0\.1/i.test(window.location.hostname)) {
      return `${normalizeBase(current)}${routeHash()}`;
    }
    return publicShareUrl();
  }

  function yearLine(p) {
    if (!p || typeof PlayerEngine === "undefined") return "";
    try {
      const y = PlayerEngine.yearLine(p);
      if (!y) return "";
      if (PlayerEngine.isGk(p)) {
        return `올해 ${y.apps}경기 · 실점 ${y.a} · 클린 ${y.b}`;
      }
      return `올해 ${y.apps}경기 · ${y.a}골 ${y.b}도움`;
    } catch (err) {
      return "";
    }
  }

  function shareCopy() {
    const p = state.player;
    const team = currentTeam();
    const teamName = p?.team_full || p?.team_name || team?.full || team?.name || "";
    if (!p) {
      return {
        title: teamName ? `${teamName} 선수 프로필` : "K리그 선수 프로필",
        sub: "구단을 고르고 선수를 누르면 공식 출장·득점·도움을 한 장에 모읍니다.",
        meta: teamName ? `현재: ${teamName} 선수단` : "아직 고른 선수가 없습니다. 위에서 구단·선수를 누르면 링크가 만들어집니다.",
      };
    }
    const other = state.comparePlayer && String(state.compareId) === String(state.comparePlayer.id)
      ? state.comparePlayer
      : null;
    const pos = p.position || "";
    const no = p.back_no != null ? `No.${p.back_no}` : "";
    const bits = [pos, no].filter(Boolean).join(" ");
    let title;
    if (other) {
      title = `${p.name} vs ${other.name}${teamName ? " · " + teamName : ""}`;
    } else {
      title = `${teamName} ${p.name}${bits ? " · " + bits : ""}`.trim();
    }
    let sub = yearLine(p) || "공식 출장 · 득점 · 도움과 칠판 패스·슈팅 기록.";
    if (other) sub += ` · ${p.name} vs ${other.name} 기록 비교`;
    return {
      title,
      sub,
      meta: other
        ? `현재: ${p.name} vs ${other.name}${teamName ? " · " + teamName : ""}`
        : `현재: ${teamName} ${p.name}${bits ? " · " + bits : ""}`.trim(),
    };
  }

  function buildShareHtml(url, copyOverride) {
    const copy = copyOverride || shareCopy();
    const safeTitle = escapeHtml(copy.title);
    const safeSub = escapeHtml(copy.sub);
    const safeUrl = escapeHtml(url);
    return [
      '<div style="display:block;width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      '<table cellpadding="0" cellspacing="0" border="0" bgcolor="#0f2a1c" width="1100" style="width:100% !important;max-width:1100px;min-width:100%;border-collapse:collapse;background-color:#0f2a1c;color:#f5fff8;font-family:Arial,Helvetica,sans-serif;box-sizing:border-box;">',
      '<tr><td bgcolor="#0f2a1c" style="padding:16px 18px;background-color:#0f2a1c;color:#f5fff8;">',
      '<p style="margin:0 0 14px;font-size:13px;line-height:1.7;color:#e8f6ee;background-color:#0f2a1c;">',
      "AI를 활용하여 작성한 REPORT 입니다.<br>",
      "칼럼/분석 탭을 누르면 미래의 분석관을 꿈꾸는 분들께서 작성한, 재미있고 상세한 분석 글들이 많이 있습니다.<br>",
      "AI는 잘못된 정보를 전달할 수 있습니다. 무조건적인 신뢰보다는 적당한 선에서 비판적인 시선으로 봐주세요.",
      "</p>",
      '<p style="margin:0 0 6px;font-size:12px;letter-spacing:.06em;color:#f0b429;background-color:#0f2a1c;">K LEAGUE PLAYER REPORT</p>',
      `<p style="margin:0 0 10px;font-size:18px;font-weight:700;line-height:1.35;color:#f5fff8;background-color:#0f2a1c;">${safeTitle}</p>`,
      `<p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#d7efe3;background-color:#0f2a1c;">${safeSub}</p>`,
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#b7f24a;color:#0a2218;font-weight:700;text-decoration:none;">선수 프로필 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function buildEmbedHtml(src) {
    return [
      '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      `<iframe src="${escapeHtml(src)}" title="K리그 선수 프로필" width="100%" height="920" style="width:100%;max-width:1100px;height:920px;border:0;border-radius:12px;overflow:hidden;background:#f3f7f2;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
      '<p style="margin:10px 0 0;text-align:right;">',
      `<a href="${escapeHtml(publicHomeUrl())}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:9px 14px;border-radius:8px;background-color:#0f2a1c;color:#f5fff8;font-size:13px;font-weight:700;text-decoration:none;">선수 프로필 새 창에서 크게 보기 →</a>`,
      "</p>",
      "</div>",
    ].join("");
  }

  async function copyText(text) {
    const value = String(text || "");
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (err) {
        // Fall through to execCommand for locked iframes / older browsers.
      }
    }
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch (err) {
      ok = false;
    }
    document.body.removeChild(ta);
    if (!ok) throw new Error("copy failed");
  }

  // 게시물 안(iframe)에서 뜨는 "새 창에서 크게 보기" 링크를 지금 화면(선수·비교)으로 맞춘다.
  function syncPopOut() {
    const link = $("popOut");
    if (link) link.href = previewShareUrl();
  }

  function setupCommunityEmbed() {
    syncPopOut();
    if (isEmbedQuery()) return;
    if (!isEditQuery()) return;
    const reportUrl = publicHomeUrl();
    const embedSrc = publicEmbedUrl();
    const shareHtml = buildShareHtml(reportUrl, homeShareCopy());
    const embedHtml = buildEmbedHtml(embedSrc);
    if ($("shareTargetMeta")) $("shareTargetMeta").textContent = homeShareCopy().meta;
    if ($("shareCode")) $("shareCode").textContent = shareHtml;
    if ($("embedCode")) $("embedCode").textContent = embedHtml;
    if ($("reportUrl")) {
      $("reportUrl").textContent = reportUrl;
      $("reportUrl").href = reportUrl;
    }
    const frame = $("embedPreview");
    const previewSrc = /localhost|127\.0\.0\.1/i.test(window.location.hostname)
      ? `${normalizeBase(pageBaseNoQuery())}?f=${encodeURIComponent(EMBED_TOKEN)}`
      : embedSrc;
    if (frame && frame.getAttribute("src") !== previewSrc) {
      frame.src = previewSrc;
    }
  }

  function currentLeague() {
    const leagues = state.index?.leagues || [];
    return leagues.find((l) => String(l.id) === String(state.leagueId)) || leagues[0] || null;
  }

  function isJeonbuk(t) {
    return String(t?.id || "").toUpperCase() === "K05" || String(t?.name || "") === "전북";
  }

  function sortedTeams(teams) {
    return (teams || []).slice().sort((a, b) => {
      const aj = isJeonbuk(a) ? 0 : 1;
      const bj = isJeonbuk(b) ? 0 : 1;
      if (aj !== bj) return aj - bj;
      return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });
  }

  function defaultTeamId(lg) {
    return sortedTeams(lg?.teams || [])[0]?.id || "";
  }

  function currentTeam() {
    const lg = currentLeague();
    return (lg?.teams || []).find((t) => t.id === state.teamId) || null;
  }

  function applyClubColor(team) {
    const color = team?.color || "#037340";
    document.documentElement.style.setProperty("--club", color);
  }

  function isPhotoUrl(url) {
    const u = String(url || "").trim();
    if (!u) return false;
    if (/^https?:\/\/d2tfp74nsbbrkr\.cloudfront\.net\/?$/i.test(u)) return false;
    return true;
  }

  function photoUrls(p) {
    const photos = p?.photos || {};
    const urls = [photos.club, photos.kleague, photos.portal, p?.photo, p?.photo_fallback];
    return [...new Set(urls.filter(isPhotoUrl))];
  }

  function imgHtml(urls, alt, cls) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) {
      return `<div class="${cls} empty"></div>`;
    }
    const src = escapeHtml(list[0]);
    const rest = list.slice(1).map(escapeHtml).join("|");
    return (
      `<img class="${cls}" src="${src}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" ` +
      `data-fallbacks="${escapeHtml(rest)}" onerror="window.__photoFallback(this)" />`
    );
  }

  window.__photoFallback = function photoFallback(img) {
    const rest = (img.getAttribute("data-fallbacks") || "").split("|").filter(Boolean);
    if (!rest.length) {
      img.onerror = null;
      img.removeAttribute("src");
      img.style.display = "none";
      return;
    }
    img.setAttribute("data-fallbacks", rest.slice(1).join("|"));
    img.src = rest[0];
  };

  function allPlayersFlat() {
    const out = [];
    (state.index?.leagues || []).forEach((lg) => {
      (lg.teams || []).forEach((t) => {
        (t.players || []).forEach((p) => {
          out.push({
            id: p.id,
            name: p.name,
            back_no: p.back_no,
            position: p.position,
            photo: p.photo,
            photo_fallback: p.photo_fallback,
            teamId: t.id,
            teamName: t.name,
            leagueId: lg.id,
          });
        });
      });
    });
    return out;
  }

  function teammatesSamePos(p) {
    const team = currentTeam();
    const pos = String(p?.position || "").toUpperCase();
    return (team?.players || []).filter(
      (x) => String(x.id) !== String(p.id) && String(x.position || "").toUpperCase() === pos
    );
  }

  async function fetchPlayer(id) {
    if (!id) return null;
    if (state.cache.has(id)) return state.cache.get(id);
    const res = await fetch(DATA_PLAYER(id));
    if (!res.ok) throw new Error("player " + res.status);
    const p = await res.json();
    state.cache.set(id, p);
    return p;
  }

  function renderClubs() {
    const lg = currentLeague();
    const strip = $("clubStrip");
    if (!lg) {
      strip.innerHTML = "";
      return;
    }
    strip.innerHTML = sortedTeams(lg.teams)
      .map((t) => {
        const active = t.id === state.teamId ? " active" : "";
        return (
          `<button type="button" class="club-btn${active}" data-team="${escapeHtml(t.id)}">` +
          `<img src="${escapeHtml(t.emblem)}" alt="" width="40" height="40" onerror="this.hidden=true" />` +
          `<span>${escapeHtml(t.name)}</span>` +
          `</button>`
        );
      })
      .join("");
    strip.querySelectorAll(".club-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.teamId = btn.getAttribute("data-team") || "";
        state.playerId = "";
        state.player = null;
        state.compareId = "";
        state.comparePlayer = null;
        state.rivals = [];
        writeHash();
        renderAll();
      });
    });
  }

  function filteredPlayers(team) {
    const q = state.q.trim();
    return (team?.players || []).filter((p) => {
      if (state.pos !== "ALL" && String(p.position || "").toUpperCase() !== state.pos) return false;
      if (!q) return true;
      const hay = `${p.name || ""} ${p.back_no || ""} ${p.position || ""}`;
      return hay.includes(q);
    });
  }

  function renderSquad() {
    const team = currentTeam();
    applyClubColor(team);
    $("squadKicker").textContent = currentLeague()?.name || "선수단";
    $("squadTitle").textContent = team ? `${team.full || team.name} 프로선수단` : "구단을 선택하세요";
    const grid = $("squadGrid");
    if (!team) {
      grid.innerHTML = "";
      $("profile").classList.add("hidden");
      return;
    }
    const list = filteredPlayers(team);
    grid.innerHTML = list
      .map((p) => {
        const active = String(p.id) === String(state.playerId) ? " active" : "";
        const urls = [p.photo, p.photo_fallback].filter(isPhotoUrl);
        return (
          `<button type="button" class="player-card${active}" data-id="${escapeHtml(p.id)}">` +
          `<div class="shot">${imgHtml(urls, p.name, "face")}</div>` +
          `<div class="meta">` +
          `<span class="no">${p.back_no != null ? "No." + escapeHtml(p.back_no) : ""}</span>` +
          `<span class="nm">${escapeHtml(p.name)}</span>` +
          `<span class="ps">${escapeHtml(p.position || "")}</span>` +
          `</div></button>`
        );
      })
      .join("");
    grid.querySelectorAll(".player-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        if (!id) return;
        state.playerId = id;
        state.compareId = "";
        state.comparePlayer = null;
        writeHash();
        loadPlayer(id);
      });
    });
  }

  function metricHeaders(isGk) {
    return isGk ? ["출장", "실점", "클린"] : ["출장", "득점", "도움"];
  }

  function tripleCells(block, isGk) {
    const b = block || {};
    if (isGk) return [dash(b.apps), dash(b.goals_conceded), dash(b.clean_sheets)];
    return [dash(b.apps), dash(b.goals), dash(b.assists)];
  }

  function recordTable(rows, isGk, withSeason) {
    const mh = metricHeaders(isGk);
    const groups = ["K리그1", "K리그2", "PO", "리그컵", "슈퍼컵", "통산"];
    let head =
      `<table class="rec"><thead><tr>` +
      (withSeason ? `<th rowspan="2">시즌</th>` : "") +
      `<th rowspan="2">팀</th>` +
      groups.map((g) => `<th colspan="3">${escapeHtml(g)}</th>`).join("") +
      `</tr><tr>`;
    groups.forEach(() => {
      mh.forEach((h) => {
        head += `<th>${h}</th>`;
      });
    });
    head += `</tr></thead><tbody>`;
    const body = (rows || [])
      .map((r) => {
        const cells = [
          ...(withSeason ? [dash(r.season)] : []),
          dash(r.team),
          ...tripleCells(r.k1, isGk),
          ...tripleCells(r.k2, isGk),
          ...tripleCells(r.po, isGk),
          ...tripleCells(r.cup, isGk),
          ...tripleCells(r.super_cup, isGk),
          ...tripleCells(r.total, isGk),
        ];
        return `<tr>${cells.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`;
      })
      .join("");
    return head + body + `</tbody></table>`;
  }

  function sparkSvg(spark, gk) {
    const rows = spark || [];
    if (!rows.length) return `<p class="empty-note">시즌 흐름을 그릴 공식 행이 없습니다.</p>`;
    const w = 640;
    const h = 148;
    const padL = 36;
    const padR = 16;
    const padT = 18;
    const padB = 28;
    const iw = w - padL - padR;
    const ih = h - padT - padB;
    const maxApps = Math.max(8, ...rows.map((r) => r.apps || 0));
    const maxSec = Math.max(1, ...rows.map((r) => (gk ? r.b : r.a + r.b) || 0));
    function x(i) {
      return padL + (rows.length === 1 ? iw / 2 : (i / (rows.length - 1)) * iw);
    }
    function yApps(v) {
      return padT + ih - (v / maxApps) * ih;
    }
    function ySec(v) {
      return padT + ih - (v / maxSec) * ih;
    }
    const appsLine = rows.map((r, i) => `${x(i)},${yApps(r.apps || 0)}`).join(" ");
    const secLine = rows
      .map((r, i) => `${x(i)},${ySec(gk ? r.b || 0 : (r.a || 0) + (r.b || 0))}`)
      .join(" ");
    const ticks = rows
      .map((r, i) => {
        return (
          `<text class="axis" x="${x(i)}" y="${h - 8}" text-anchor="middle">${escapeHtml(String(r.season).slice(2))}</text>` +
          `<circle cx="${x(i)}" cy="${yApps(r.apps || 0)}" r="3.5" fill="#037340" />`
        );
      })
      .join("");
    const legend = gk ? "초록 출장 · 라임 클린시트" : "초록 출장 · 라임 공격포인트";
    return (
      `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(legend)}">` +
      `<text class="axis" x="${padL}" y="12">${escapeHtml(legend)}</text>` +
      `<polyline fill="none" stroke="#037340" stroke-width="2.4" points="${appsLine}" />` +
      `<polyline fill="none" stroke="#8fb52a" stroke-width="2" points="${secLine}" />` +
      ticks +
      `</svg>`
    );
  }

  function renderRole(analysis) {
    const past = analysis.role.career;
    const now = analysis.role.year;
    const shift = analysis.role.shift;
    const trendCls = shift === "상승" ? "up" : shift === "하락" ? "down" : "flat";
    $("roleCards").innerHTML =
      `<div class="role-card"><span>그동안</span><strong>${escapeHtml(past.label)}</strong><em>시즌당 ${dash(past.appsAvg)}경기</em></div>` +
      `<div class="role-card"><span>올해</span><strong>${escapeHtml(now.label)}</strong><em>${dash(now.apps)}경기</em></div>` +
      `<div class="role-card"><span>변화</span><strong><span class="trend ${trendCls}">${escapeHtml(shift)}</span></strong><em>출장 구간</em></div>`;
    $("roleText").textContent = analysis.role.text || "";
  }

  function renderForm(p, analysis) {
    const gk = PlayerEngine.isGk(p);
    $("formChart").innerHTML = sparkSvg(analysis.form.spark, gk);
    const badge =
      analysis.form.trend === "up"
        ? `<span class="trend up">상승</span> `
        : analysis.form.trend === "down"
          ? `<span class="trend down">하락</span> `
          : `<span class="trend flat">유지</span> `;
    $("formText").innerHTML = badge + escapeHtml(analysis.form.text || "");
  }

  const FM_GROUPS = [
    ["기술", {
      corners: "코너킥", crossing: "크로스", dribbling: "드리블", finishing: "골 결정력",
      first_touch: "퍼스트 터치", free_kick_taking: "프리킥", heading: "헤더",
      long_shots: "중거리 슛", long_throws: "장거리 스로인", marking: "대인 마크",
      passing: "패스", penalty_taking: "페널티킥", tackling: "태클", technique: "개인기",
    }],
    ["정신", {
      aggression: "적극성", anticipation: "예측력", bravery: "용감함", composure: "침착성",
      concentration: "집중력", decisions: "판단력", determination: "승부욕",
      flair: "천재성", leadership: "리더십", off_the_ball: "오프 더 볼",
      positioning: "위치 선정", teamwork: "팀워크", vision: "시야", work_rate: "활동량",
    }],
    ["신체", {
      acceleration: "가속도", agility: "민첩성", balance: "균형 감각",
      jumping_reach: "점프 거리", natural_fitness: "타고난 체력", pace: "주력",
      stamina: "지구력", strength: "몸싸움",
    }],
    ["골키퍼", {
      aerial_reach: "공중 장악력", command_of_area: "수비 범위", communication: "수비 조율",
      eccentricity: "기행", handling: "볼 핸들링", kicking: "골킥", one_on_ones: "일대일 방어",
      reflexes: "반사 신경", rushing_out: "돌진", punching: "펀칭", throwing: "스로잉",
    }],
    ["숨은 능력치", {
      consistency: "꾸준함", dirtiness: "더티 플레이", important_matches: "중요 경기",
      injury_proneness: "부상 빈도", versatility: "다재다능",
    }],
    ["포지션 · 양발", {
      left_foot: "왼발", right_foot: "오른발", natural_positions: "주 포지션",
      accomplished_positions: "소화 가능 포지션", positions_stc: "ST (C)",
      positions_aml: "AM (L)", positions_amc: "AM (C)", positions_amr: "AM (R)",
      positions_ml: "M (L)", positions_mc: "M (C)", positions_mr: "M (R)",
      positions_wbl: "WB (L)", positions_dm: "DM", positions_wbr: "WB (R)",
      positions_dl: "D (L)", positions_dc: "D (C)", positions_dr: "D (R)",
      positions_sw: "SW", positions_gk: "GK",
    }],
    ["성격 · 선호 플레이", {
      personality_adaptability: "적응력", personality_ambition: "야망",
      personality_loyalty: "충성심", personality_pressure: "압박 대처",
      personality_professionalism: "프로 의식", personality_sportsmanship: "스포츠맨십",
      personality_temperament: "기질", personality_controversy: "논쟁성", traits: "선호 플레이",
    }],
    ["현재·잠재 능력 · 계약 · 평판", {
      ability_current: "현재 능력", ability_potential: "잠재 능력", transfer_value: "이적 가치",
      contract_wage: "주급", contract_end: "계약 만료", reputation_current: "현재 평판",
      reputation_home: "국내 평판", reputation_world: "세계 평판",
    }],
  ];

  const FM_LOWER_BETTER = ["injury_proneness", "dirtiness", "personality_controversy"];
  const FM_SET_PIECES = ["corners", "free_kick_taking", "long_throws", "penalty_taking"];
  // 골키퍼의 강점·약점을 고를 때는 의미가 적은 항목을 뺀다.
  const FM_GK_SKIP = ["eccentricity", "off_the_ball", "flair", "vision", "aggression", "work_rate"];
  const FM_TRAITS = {
    runs_with_ball_often: "공을 자주 몰고 전진",
    shoots_from_distance: "중거리 슛 시도",
    tries_long_range_passes: "롱패스 시도",
    dictates_tempo: "템포 조율",
    knocks_ball_past_opponent: "공을 치고 달리기",
    gets_forward_whenever_possible: "기회마다 전진",
    tries_killer_balls_often: "킬패스 자주 시도",
    moves_into_channels: "채널로 침투",
    comes_deep_to_get_ball: "내려와서 공 받기",
    avoids_using_weaker_foot: "약한 발 사용 회피",
    runs_with_ball_through_centre: "중앙으로 드리블",
    runs_with_ball_down_left: "왼쪽으로 드리블",
    runs_with_ball_down_right: "오른쪽으로 드리블",
    likes_to_try_to_beat_offside_trap: "오프사이드 라인 침투",
    dives_into_tackles: "태클을 깊게 시도",
    crosses_early: "얼리 크로스",
  };

  // 세부 능력치를 8개 영역 평균으로 묶은 요약(팔각형)에 쓰는 축.
  const FM_OCTAGON = [
    ["수비", ["marking", "tackling", "positioning"]],
    ["피지컬", ["agility", "balance", "stamina", "strength"]],
    ["스피드", ["acceleration", "pace"]],
    ["시야", ["passing", "flair", "vision"]],
    ["공격", ["finishing", "composure", "off_the_ball"]],
    ["기술", ["dribbling", "first_touch", "technique"]],
    ["공중볼", ["heading", "jumping_reach"]],
    ["정신력", ["anticipation", "bravery", "concentration", "decisions", "determination", "teamwork"]],
  ];
  const FM_OCTAGON_GK = [
    ["선방", ["reflexes", "one_on_ones"]],
    ["핸들링", ["handling"]],
    ["공중볼", ["aerial_reach", "command_of_area"]],
    ["수비 조율", ["communication"]],
    ["배급", ["kicking", "throwing"]],
    ["스피드", ["acceleration", "pace", "rushing_out"]],
    ["피지컬", ["agility", "balance", "strength", "jumping_reach"]],
    ["정신력", ["anticipation", "composure", "concentration", "decisions", "positioning"]],
  ];

  function fmValue(value, key) {
    if (key === "traits") {
      const list = String(value || "").split(";").map((t) => t.trim())
        .filter((t) => t && t !== "unknown")
        .map((t) => FM_TRAITS[t] || t.replace(/_/g, " "));
      return escapeHtml(list.length ? list.join(" · ") : "–");
    }
    if (key === "natural_positions" || key === "accomplished_positions") {
      const list = String(value || "").split(";").map((t) => t.trim()).filter(Boolean);
      return escapeHtml(list.length ? list.join(" · ") : "–");
    }
    return escapeHtml(typeof value === "number" ? value.toLocaleString("ko-KR") : dash(value));
  }

  function fmScale(key) {
    if (key === "ability_current" || key === "ability_potential") return 200;
    if (key.startsWith("reputation_")) return 10000;
    if (["transfer_value", "contract_wage", "contract_end", "traits",
      "natural_positions", "accomplished_positions"].includes(key)) return null;
    return 20;
  }

  function fmPercent(value, scale) {
    return typeof value === "number" && scale ? Math.max(0, Math.min(100, value / scale * 100)) : 0;
  }

  // 1(약함)~4(뛰어남). 낮을수록 좋은 항목은 뒤집어서 매긴다.
  function fmTier(key, value) {
    const scale = fmScale(key);
    if (!scale || typeof value !== "number") return 0;
    let v = value / scale * 20;
    if (FM_LOWER_BETTER.includes(key)) v = 21 - v;
    return v >= 16 ? 4 : v >= 11 ? 3 : v >= 6 ? 2 : 1;
  }

  function fmFieldLabel(key, label) {
    return escapeHtml(label) + (FM_LOWER_BETTER.includes(key) ? " <small>낮을수록 좋음</small>" : "");
  }

  // sets: [{ fm, cls }] — 한 명이면 숫자 하나, 두 명이면 자리마다 두 선수 숫자를 나란히 보여 준다.
  function fmPitch(sets) {
    const spots = [
      ["stc", 50, 9], ["aml", 16, 26], ["amc", 50, 26], ["amr", 84, 26],
      ["ml", 16, 43], ["mc", 50, 43], ["mr", 84, 43],
      ["wbl", 16, 59], ["dm", 50, 59], ["wbr", 84, 59],
      ["dl", 16, 74], ["dc", 50, 74], ["dr", 84, 74],
      ["sw", 50, 85], ["gk", 50, 95],
    ];
    return `<div class="fm-pitch-wrap"><div class="fm-pitch${sets.length > 1 ? " dual" : ""}">` +
      spots.map(([pos, x, y]) => {
        const badges = sets.map(({ fm, cls }) => {
          const value = fm?.["positions_" + pos];
          const level = value >= 15 ? "natural" : value >= 10 ? "capable" : "limited";
          return `<strong class="${cls} ${level}">${fmValue(value)}</strong>`;
        }).join("");
        return `<div class="fm-position" style="left:${x}%;top:${y}%">` +
          `<div class="pv">${badges}</div><span>${pos.toUpperCase()}</span></div>`;
      }).join("") +
      '</div><p class="table-note">포지션 숙련도 · 20점 만점 · 진한 색 15 이상, 연한 색 10 이상</p></div>';
  }

  function fmIsGkView(p, other) {
    return p.position === "GK" && (!other || other.position === "GK");
  }

  // 화면 배치. core(핵심 능력치)와 extra(포지션·성격·그 밖의 정보)는 각각 세 칸이고,
  // 칸마다 묶음을 위에서 아래로 쌓는다. 접는 묶음 없이 전부 펼쳐 보여 준다.
  function fmSections(p, other) {
    const gk = fmIsGkView(p, other);
    const sec = (index) => {
      const [title, fields] = FM_GROUPS[index];
      const keep = (test) => Object.fromEntries(Object.entries(fields).filter(([key]) => test(key)));
      if (index === 5) return { title, pitch: true, fields: keep((key) => !key.startsWith("positions_")) };
      // 현재·잠재 능력은 맨 위 요약에 있으므로 여기서는 계약·평판만 둔다.
      if (index === 7) return { title: "계약 · 평판", fields: keep((key) => !key.startsWith("ability_")) };
      return { title, fields };
    };
    return {
      core: [[sec(gk ? 3 : 0)], [sec(1)], [sec(2), sec(4)]],
      extra: [[sec(5)], [sec(6), sec(7)], [sec(gk ? 0 : 3)]],
    };
  }

  function fmTiers(sections, card) {
    const cols = (columns) => columns
      .map((column) => `<div class="fm-col">${column.map(card).join("")}</div>`).join("");
    return `<h4 class="fm-tier">핵심 능력치</h4><div class="fm-cols">${cols(sections.core)}</div>` +
      `<h4 class="fm-tier">포지션 · 성격 · 그 밖의 정보</h4><div class="fm-cols">${cols(sections.extra)}</div>`;
  }

  function fmAxisScore(fm, keys) {
    const vals = keys.map((key) => fm?.[key]).filter((v) => typeof v === "number");
    return vals.length ? vals.reduce((sum, v) => sum + v, 0) / vals.length : null;
  }

  function fmRadar(axes, sets) {
    const cx = 180;
    const cy = 142;
    const R = 96;
    const n = axes.length;
    const point = (i, r) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      return [cx + Math.cos(ang) * r, cy + Math.sin(ang) * r];
    };
    const ring = (r) => axes.map((_, i) => point(i, r).map((v) => v.toFixed(1)).join(",")).join(" ");
    const grid = [5, 10, 15, 20]
      .map((v) => `<polygon class="rg${v === 20 ? " outer" : ""}" points="${ring(R * v / 20)}" />`).join("");
    const spokes = axes.map((_, i) => {
      const [x, y] = point(i, R);
      return `<line class="rg" x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" />`;
    }).join("");
    const shapes = sets.map(({ fm, cls }) => {
      if (!fm) return "";
      const pts = axes
        .map(([, keys], i) => point(i, R * (fmAxisScore(fm, keys) || 0) / 20).map((v) => v.toFixed(1)).join(","))
        .join(" ");
      return `<polygon class="rp ${cls}" points="${pts}" />`;
    }).join("");
    const labels = axes.map(([name, keys], i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const [x, y] = point(i, R + 13);
      const anchor = Math.abs(x - cx) < 6 ? "middle" : x > cx ? "start" : "end";
      const top = y - 2 + Math.sin(ang) * 8;
      const scores = sets.map(({ fm, cls }) => {
        const score = fmAxisScore(fm, keys);
        return `<tspan class="rv ${cls}">${score == null ? "–" : score.toFixed(1)}</tspan>`;
      }).join('<tspan class="rv sep"> · </tspan>');
      return `<text x="${x.toFixed(1)}" y="${top.toFixed(1)}" text-anchor="${anchor}">${escapeHtml(name)}` +
        `<tspan x="${x.toFixed(1)}" dy="13">${scores}</tspan></text>`;
    }).join("");
    const alt = axes.map(([name, keys]) =>
      name + " " + sets.map(({ fm }) => {
        const score = fmAxisScore(fm, keys);
        return score == null ? "–" : score.toFixed(1);
      }).join(" 대 ")).join(", ");
    return `<svg class="fm-radar-svg" viewBox="0 0 360 290" role="img" aria-label="${escapeHtml(alt)}">` +
      `${grid}${spokes}${shapes}${labels}</svg>`;
  }

  // 강점·약점을 고를 때 쓰는 후보: 필드는 기술·정신·신체, 골키퍼는 골키퍼·정신·신체.
  function fmRanked(fm, gk) {
    const out = [];
    (gk ? [3, 1, 2] : [0, 1, 2]).forEach((index) => {
      Object.entries(FM_GROUPS[index][1]).forEach(([key, label]) => {
        if ((gk && FM_GK_SKIP.includes(key)) || typeof fm[key] !== "number") return;
        out.push({ key, label, value: fm[key] });
      });
    });
    return out;
  }

  function fmChips(items) {
    return items.map((x) =>
      `<span class="fm-chip t${fmTier(x.key, x.value)}">${escapeHtml(x.label)} <b>${fmValue(x.value)}</b></span>`
    ).join("");
  }

  function fmSummary(p, fm) {
    const gk = fmIsGkView(p);
    const ranked = fmRanked(fm, gk);
    const best = ranked.slice().sort((a, b) => b.value - a.value).slice(0, 5);
    const worst = ranked.filter((x) => !FM_SET_PIECES.includes(x.key))
      .sort((a, b) => a.value - b.value).slice(0, 3);
    const fact = (label, html) => `<div class="fm-fact"><span>${label}</span><strong>${html}</strong></div>`;
    return `<div class="fm-summary">` +
      `<div class="fm-radar-box">${fmRadar(gk ? FM_OCTAGON_GK : FM_OCTAGON, [{ fm, cls: "mine" }])}` +
      `<p class="table-note">세부 능력치를 8개 영역 평균으로 묶은 요약 · 20점 만점</p></div>` +
      `<div class="fm-sum-side">` +
      `<div class="fm-ability"><div class="fm-abil-nums">` +
      `<div><span>현재 능력</span><strong>${fmValue(fm.ability_current)}</strong></div>` +
      `<div><span>잠재 능력</span><strong>${fmValue(fm.ability_potential)}</strong></div></div>` +
      `<div class="fm-ability-bar" aria-hidden="true"><i class="pa" style="width:${fmPercent(fm.ability_potential, 200)}%"></i>` +
      `<i class="ca" style="width:${fmPercent(fm.ability_current, 200)}%"></i></div>` +
      `<p class="table-note">진한 막대 현재 · 연한 막대 잠재 · 200점 만점</p></div>` +
      `<div class="fm-facts">` +
      fact("주 포지션", fmValue(fm.natural_positions, "natural_positions")) +
      fact("소화 가능", fmValue(fm.accomplished_positions, "accomplished_positions")) +
      fact("왼발 / 오른발", `${fmValue(fm.left_foot)} / ${fmValue(fm.right_foot)}`) +
      `</div>` +
      `<div class="fm-edge"><h4>강점</h4><div class="fm-chips">${fmChips(best)}</div></div>` +
      `<div class="fm-edge"><h4>약점 <small>세트피스 제외</small></h4><div class="fm-chips">${fmChips(worst)}</div></div>` +
      `<button type="button" class="fm-jump" id="fmJump">다른 선수와 비교하기 ↓</button>` +
      `</div></div>`;
  }

  function fmAttrRow(fm, key, label) {
    const value = fm[key];
    const scale = fmScale(key);
    if (!scale) {
      return `<div class="fa-row is-text"><span class="fa-label">${fmFieldLabel(key, label)}</span>` +
        `<span class="fa-text">${fmValue(value, key)}</span></div>`;
    }
    return `<div class="fa-row t${fmTier(key, value)}${scale > 20 ? " big" : ""}">` +
      `<span class="fa-label">${fmFieldLabel(key, label)}</span>` +
      `<span class="fa-bar" aria-hidden="true"><i style="width:${fmPercent(value, scale)}%"></i></span>` +
      `<strong class="fa-num">${fmValue(value)}</strong></div>`;
  }

  const FM_TIER_LEGEND =
    '<div class="fm-tier-legend"><span><i class="t4"></i>16 이상 뛰어남</span><span><i class="t3"></i>11–15 좋음</span>' +
    '<span><i class="t2"></i>6–10 보통</span><span><i class="t1"></i>5 이하 약함</span></div>';

  function renderFmAttributes(p) {
    const fm = state.fmAttributes?.[p.id];
    $("fmNote").textContent = fm
      ? "출처 FM 세이브 · 세부 능력치와 포지션 숙련도는 20점 만점"
      : state.fmAttributes
        ? "FM 세이브에서 이 선수의 능력치를 확인하지 못했습니다."
        : "FM 능력치 데이터를 불러오지 못했습니다.";
    if (!fm) {
      $("fmGroups").innerHTML = "";
      return;
    }
    const card = (section) =>
      `<section class="fm-card"><h4>${escapeHtml(section.title)}</h4><div class="fa-list">` +
      (section.pitch ? fmPitch([{ fm, cls: "mine" }]) : "") +
      Object.entries(section.fields).map(([key, label]) => fmAttrRow(fm, key, label)).join("") +
      `</div></section>`;
    $("fmGroups").innerHTML = fmSummary(p, fm) + FM_TIER_LEGEND + fmTiers(fmSections(p), card);
    $("fmJump")?.addEventListener("click", () => {
      $("compareBlock")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }

  function renderYears(p, analysis) {
    const gk = PlayerEngine.isGk(p);
    const rows = analysis.seasons || [];
    if (!rows.length) {
      $("yearTimeline").innerHTML = `<p class="empty-note">연도별 공식 시즌 행이 없습니다.</p>`;
      return;
    }
    $("yearTimeline").innerHTML = rows
      .map((r) => {
        const extra = gk ? `실점 ${r.a} · 클린 ${r.b}` : `${r.a}골 ${r.b}도움`;
        return (
          `<article class="year-item">` +
          `<div class="yh"><b>${escapeHtml(r.season)}</b>` +
          `<span class="yr">${escapeHtml(r.team)} · ${escapeHtml(r.role)} · 출장 ${r.apps} · ${escapeHtml(extra)}</span></div>` +
          `<p>${escapeHtml(r.text)}</p>` +
          `</article>`
        );
      })
      .join("");
  }

  function rivalStatLine(full, isGk) {
    if (!full) return "올해 –";
    const y = PlayerEngine.yearLine(full);
    if (isGk) return `올해 ${y.apps}경기 · 실점 ${y.a} · 클린 ${y.b}`;
    return `올해 ${y.apps}경기 · ${y.a}골 ${y.b}도움`;
  }

  function renderRivals(p) {
    const mates = teammatesSamePos(p);
    const team = currentTeam();
    $("rivalNote").textContent = team
      ? `${team.full || team.name} ${p.position || ""} 경쟁자. 카드를 누르면 아래에서 FM 능력치를 비교합니다.`
      : "";
    if (!mates.length) {
      $("rivalGrid").innerHTML = `<p class="empty-note">같은 포지션 팀 동료가 명단에 없습니다.</p>`;
      $("rivalText").textContent = "";
      return;
    }
    $("rivalGrid").innerHTML = mates
      .map((m) => {
        const full = state.rivals.find((r) => String(r.id) === String(m.id));
        const active = String(m.id) === String(state.compareId) ? " active" : "";
        const urls = [m.photo, m.photo_fallback].filter(isPhotoUrl);
        const extra = full
          ? `${escapeHtml(rivalStatLine(full, PlayerEngine.isGk(p)))} · 기여 ${PlayerEngine.scoreCard(full, state.events).total}`
          : "올해 –";
        return (
          `<button type="button" class="rival-card${active}" data-id="${escapeHtml(m.id)}">` +
          `<div class="shot">${imgHtml(urls, m.name, "face")}</div>` +
          `<div class="meta">` +
          `<span class="ca">${extra}</span>` +
          `<span class="nm">${escapeHtml(m.name)}</span>` +
          `<span class="ps">${m.back_no != null ? "No." + escapeHtml(m.back_no) : ""} · ${escapeHtml(m.position || "")}</span>` +
          `</div></button>`
        );
      })
      .join("");
    $("rivalGrid")
      .querySelectorAll(".rival-card")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const id = btn.getAttribute("data-id");
          if (!id) return;
          state.compareId = id;
          writeHash();
          loadCompare(id);
        });
      });
    const focus = state.comparePlayer;
    if (focus && String(focus.team_id) === String(p.team_id)) {
      $("rivalText").textContent = PlayerEngine.rivalCopy(p, focus, state.events);
    } else if (state.rivals[0]) {
      $("rivalText").textContent = PlayerEngine.rivalCopy(p, state.rivals[0], state.events);
    } else {
      $("rivalText").textContent = "";
    }
  }

  function chooseCompare(id) {
    if (!id) return;
    state.compareId = id;
    writeHash();
    loadCompare(id);
  }

  function renderComparePicker(p) {
    const mates = teammatesSamePos(p);
    const flat = allPlayersFlat().filter((x) => String(x.id) !== String(p.id));
    const mateOpts = mates
      .map((m) => {
        const sel = String(m.id) === String(state.compareId) ? " selected" : "";
        return `<option value="${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)} · ${m.back_no != null ? "No." + m.back_no : ""}</option>`;
      })
      .join("");
    $("cmpPicker").innerHTML =
      `<label for="cmpMate">같은 포지션 동료</label>` +
      `<select id="cmpMate"><option value="">선택</option>${mateOpts}</select>` +
      `<label for="cmpSearch">다른 선수 찾기</label>` +
      `<div class="cmp-search"><input id="cmpSearch" type="search" placeholder="이름을 입력하세요" autocomplete="off" />` +
      `<div class="cmp-results" id="cmpResults" hidden></div></div>`;
    $("cmpMate").addEventListener("change", (e) => chooseCompare(e.target.value));

    const input = $("cmpSearch");
    const results = $("cmpResults");
    const search = () => {
      const q = String(input.value || "").trim();
      if (!q) {
        results.hidden = true;
        results.innerHTML = "";
        return [];
      }
      const hits = flat.filter((x) => String(x.name || "").includes(q)).slice(0, 12);
      results.innerHTML = hits.length
        ? hits.map((x) =>
            `<button type="button" data-id="${escapeHtml(x.id)}"><strong>${escapeHtml(x.name)}</strong>` +
            `<span>${escapeHtml(x.teamName)} · ${escapeHtml(x.position || "")}` +
            `${x.back_no != null ? " · No." + escapeHtml(x.back_no) : ""}</span></button>`
          ).join("")
        : "<p>일치하는 선수가 없습니다.</p>";
      results.hidden = false;
      return hits;
    };
    input.addEventListener("input", search);
    input.addEventListener("focus", search);
    input.addEventListener("keydown", (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") {
        results.hidden = true;
        return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault();
      const hits = search();
      if (hits[0]) chooseCompare(hits[0].id);
    });
    input.addEventListener("blur", () => {
      setTimeout(() => { results.hidden = true; }, 150);
    });
    // 목록을 누르는 동안 입력창이 포커스를 잃어 목록이 먼저 닫히지 않게 한다.
    results.addEventListener("mousedown", (e) => e.preventDefault());
    results.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-id]");
      if (btn) chooseCompare(btn.getAttribute("data-id"));
    });
  }

  let cmpMinDiff = 0;

  function cmpWinner(key, a, b) {
    if (typeof a !== "number" || typeof b !== "number" || a === b) return "";
    return (FM_LOWER_BETTER.includes(key) ? a < b : a > b) ? "a" : "b";
  }

  // 좌우 대칭 한 줄: [내 값][내 막대] 항목 [상대 막대][상대 값]
  function cmpRow(key, label, mine, theirs) {
    const a = mine?.[key];
    const b = theirs?.[key];
    const scale = fmScale(key);
    if (!scale) {
      return `<div class="cmp-row is-text"><span class="cv a">${fmValue(a, key)}</span>` +
        `<span class="cl">${fmFieldLabel(key, label)}</span><span class="cv b">${fmValue(b, key)}</span></div>`;
    }
    const both = typeof a === "number" && typeof b === "number";
    const win = cmpWinner(key, a, b);
    const diff = both ? Math.abs(a - b) : 0;
    const mark = win && scale <= 200 ? `<em class="cd ${win}">+${diff}</em>` : "";
    const state20 = both ? ` data-diff="${Math.round(diff / scale * 20)}"` : "";
    // 평판(10,000점 척도)은 좁은 칸에서 막대가 너무 짧아지므로 숫자만 나란히 둔다.
    if (scale > 200) {
      return `<div class="cmp-row no-bar${win ? " win-" + win : ""}"${state20}>` +
        `<strong class="cv a">${fmValue(a)}</strong><span class="cl">${fmFieldLabel(key, label)}</span>` +
        `<strong class="cv b">${fmValue(b)}</strong></div>`;
    }
    return `<div class="cmp-row${win ? " win-" + win : ""}${scale > 20 ? " big" : ""}"${state20}>` +
      `<strong class="cv a">${fmValue(a)}</strong>` +
      `<span class="cb a" aria-hidden="true"><i style="width:${fmPercent(a, scale)}%"></i></span>` +
      `<span class="cl">${fmFieldLabel(key, label)}${mark}</span>` +
      `<span class="cb b" aria-hidden="true"><i style="width:${fmPercent(b, scale)}%"></i></span>` +
      `<strong class="cv b">${fmValue(b)}</strong></div>`;
  }

  function cmpTally(fields, mine, theirs) {
    const tally = { a: 0, b: 0, tie: 0 };
    Object.keys(fields).forEach((key) => {
      const a = mine?.[key];
      const b = theirs?.[key];
      if (!fmScale(key) || typeof a !== "number" || typeof b !== "number") return;
      tally[cmpWinner(key, a, b) || "tie"] += 1;
    });
    return tally;
  }

  function cmpTallyHtml(tally) {
    return `<span class="cmp-tally"><b class="a">${tally.a}</b><i>:</i><b class="b">${tally.b}</b></span>`;
  }

  function cmpScoreRow(title, tally, cls) {
    const seg = (name, n) => (n ? `<i class="${name}" style="flex:${n}"></i>` : "");
    return `<div class="cmp-score-row${cls ? " " + cls : ""}"><span>${escapeHtml(title)}</span>` +
      `<b class="a">${tally.a}</b><span class="cmp-split" aria-hidden="true">` +
      `${seg("a", tally.a)}${seg("t", tally.tie)}${seg("b", tally.b)}</span><b class="b">${tally.b}</b></div>`;
  }

  function cmpSide(pl, side) {
    const meta = [pl.team_name || pl.team_full, pl.position, pl.back_no != null ? "No." + pl.back_no : ""]
      .filter(Boolean).join(" · ");
    return `<div class="cmp-side ${side}"><div class="cmp-face">${imgHtml(photoUrls(pl), pl.name, "face")}</div>` +
      `<div class="cmp-who"><strong>${escapeHtml(pl.name)}</strong><span>${escapeHtml(meta)}</span></div></div>`;
  }

  function applyCmpFilter() {
    const box = $("cmpTable");
    box.querySelectorAll(".cmp-filter .chip").forEach((btn) => {
      btn.classList.toggle("active", Number(btn.getAttribute("data-min")) === cmpMinDiff);
    });
    // 걸러 볼 때는 숫자 차이가 기준에 못 미치는 줄과 글자뿐인 줄(계약 만료 등)을 숨긴다.
    box.querySelectorAll(".cmp-cards .cmp-row").forEach((row) => {
      const diff = row.getAttribute("data-diff");
      row.hidden = cmpMinDiff > 0 && (diff == null || Number(diff) < cmpMinDiff);
    });
    box.querySelectorAll(".cmp-card").forEach((card) => {
      const none = card.querySelector(".cmp-none");
      if (none) none.hidden = cmpMinDiff === 0 || !!card.querySelector(".cmp-row:not([hidden])");
    });
  }

  function renderCompare(p) {
    renderComparePicker(p);
    const other = state.comparePlayer;
    if (!other) {
      $("cmpTable").innerHTML = '<p class="empty-note">비교할 선수를 고르세요.</p>';
      return;
    }
    const mine = state.fmAttributes?.[p.id];
    const theirs = state.fmAttributes?.[other.id];
    if (!mine && !theirs) {
      $("cmpTable").innerHTML = '<p class="empty-note">두 선수의 FM 능력치를 확인하지 못했습니다.</p>';
      return;
    }
    const sections = fmSections(p, other);
    const names = `<div class="cmp-cols"><span class="a">${escapeHtml(p.name)}</span>` +
      `<span class="b">${escapeHtml(other.name)}</span></div>`;

    // 요약 집계는 핵심 세 묶음(각 칸의 첫 묶음)만 센다.
    const total = { a: 0, b: 0, tie: 0 };
    const diffs = [];
    const scoreRows = sections.core.map((column) => column[0]).map(({ title, fields }) => {
      const tally = cmpTally(fields, mine, theirs);
      total.a += tally.a;
      total.b += tally.b;
      total.tie += tally.tie;
      Object.entries(fields).forEach(([key, label]) => {
        const win = cmpWinner(key, mine?.[key], theirs?.[key]);
        if (win) diffs.push({ label, win, diff: Math.abs(mine[key] - theirs[key]) });
      });
      return cmpScoreRow(title, tally);
    }).join("");
    const edge = (win, name) => {
      const list = diffs.filter((d) => d.win === win).sort((x, y) => y.diff - x.diff).slice(0, 4);
      return `<div class="cmp-edge ${win}"><h4>${escapeHtml(name)} 우세 <small>차이 큰 순</small></h4><div class="fm-chips">` +
        (list.length
          ? list.map((d) => `<span class="fm-chip">${escapeHtml(d.label)} <b>+${d.diff}</b></span>`).join("")
          : '<span class="fm-chip none">없음</span>') +
        `</div></div>`;
    };

    const head = `<div class="cmp-head">${cmpSide(p, "mine")}<span class="cmp-vs">VS</span>${cmpSide(other, "theirs")}</div>`;
    const missing = !mine || !theirs
      ? `<p class="table-note">${escapeHtml(!mine ? p.name : other.name)}의 FM 능력치는 확인되지 않았습니다.</p>` : "";
    const summary = `<div class="cmp-summary">` +
      `<div class="fm-radar-box">${fmRadar(fmIsGkView(p, other) ? FM_OCTAGON_GK : FM_OCTAGON,
        [{ fm: mine, cls: "mine" }, { fm: theirs, cls: "theirs" }])}` +
      `<p class="table-note">8개 영역 평균 · 20점 만점</p></div>` +
      `<div class="cmp-sum-side">` +
      `<div class="cmp-abil">${names}${cmpRow("ability_current", "현재 능력", mine, theirs)}` +
      `${cmpRow("ability_potential", "잠재 능력", mine, theirs)}</div>` +
      (mine && theirs
        ? `<div class="cmp-score"><h4>누가 더 높은 항목이 많은가 <small>회색은 동일</small></h4>` +
          `${scoreRows}${cmpScoreRow("합계", total, "total")}</div>` +
          `<div class="cmp-edges">${edge("a", p.name)}${edge("b", other.name)}</div>`
        : "") +
      `</div></div>`;
    const filter = `<div class="cmp-filter" role="group" aria-label="표시할 항목"><span>표시</span>` +
      [[0, "전체"], [2, "차이 2 이상"], [4, "차이 4 이상"]].map(([min, text]) =>
        `<button type="button" class="chip" data-min="${min}">${text}</button>`).join("") +
      `</div>`;
    const card = (section) => {
      const tally = cmpTally(section.fields, mine, theirs);
      return `<section class="fm-card cmp-card"><h4>${escapeHtml(section.title)}` +
        `${tally.a + tally.b + tally.tie ? cmpTallyHtml(tally) : ""}</h4><div class="fa-list">${names}` +
        (section.pitch ? fmPitch([{ fm: mine, cls: "mine" }, { fm: theirs, cls: "theirs" }]) : "") +
        Object.entries(section.fields).map(([key, label]) => cmpRow(key, label, mine, theirs)).join("") +
        (section.pitch ? "" : '<p class="cmp-none" hidden>이만큼 차이 나는 항목이 없습니다.</p>') +
        `</div></section>`;
    };
    $("cmpTable").innerHTML = head + missing + summary + filter +
      `<div class="cmp-cards">${fmTiers(sections, card)}</div>`;
    $("cmpTable").querySelectorAll(".cmp-filter .chip").forEach((btn) => {
      btn.addEventListener("click", () => {
        cmpMinDiff = Number(btn.getAttribute("data-min")) || 0;
        applyCmpFilter();
      });
    });
    applyCmpFilter();
  }

  function renderAnalysis(p) {
    if (typeof PlayerEngine === "undefined") return;
    const analysis = PlayerEngine.build(p, state.events);
    const now = analysis.role.year;
    const extraFacts = [["올해 출장 구간", `${now.label} · ${dash(now.apps)}경기`]];
    const factsEl = $("facts");
    extraFacts.forEach(([k, v]) => {
      const div = document.createElement("div");
      div.className = "fact";
      div.innerHTML = `<span>${escapeHtml(k)}</span><strong>${escapeHtml(dash(v))}</strong>`;
      factsEl.appendChild(div);
    });
    const tags = document.querySelector("#dossierHero .tags");
    if (tags) {
      tags.insertAdjacentHTML(
        "beforeend",
        `<span class="tag">${escapeHtml(now.label)}</span>`
      );
    }
    $("scoutProfile").textContent = analysis.profile || "";
    renderRole(analysis);
    renderForm(p, analysis);
    renderYears(p, analysis);
    renderRivals(p);
    renderCompare(p);
  }

  function renderProfile(p) {
    const box = $("profile");
    if (!p) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    const team = currentTeam();
    const isGk = String(p.position || "").toUpperCase() === "GK";
    const urls = photoUrls(p);
    $("dossierHero").innerHTML =
      `<div class="hero-photo">${imgHtml(urls, p.name, "portrait")}</div>` +
      `<div class="hero-id">` +
      `<div class="clubline">` +
      (team?.emblem
        ? `<img src="${escapeHtml(team.emblem)}" alt="" width="36" height="36" onerror="this.hidden=true" />`
        : "") +
      `<span>${escapeHtml(p.team_full || p.team_name || team?.full || "")}</span>` +
      `</div>` +
      `<h2>${escapeHtml(p.name || "")}</h2>` +
      `<div class="en">${escapeHtml(p.name_en || "")}</div>` +
      `<div class="tags">` +
      `<span class="tag">${p.back_no != null ? "No." + escapeHtml(p.back_no) : "No.–"}</span>` +
      `<span class="tag">${escapeHtml(p.position || "")}</span>` +
      `<span class="tag">${escapeHtml(p.nation || "")}</span>` +
      (p.age != null ? `<span class="tag">${escapeHtml(p.age)}세</span>` : "") +
      `</div></div>`;

    const tot = p.summary?.total || {};
    const facts = [
      ["생년월일", p.birth],
      ["키 / 몸무게", p.height || p.weight ? `${dash(p.height)}cm / ${dash(p.weight)}kg` : ""],
      ["통산 출장", tot.apps],
      isGk
        ? ["실점 / 클린시트", `${dash(tot.goals_conceded)} / ${dash(tot.clean_sheets)}`]
        : ["득점 / 도움", `${dash(tot.goals)} / ${dash(tot.assists)}`],
    ];
    $("facts").innerHTML = facts
      .map(
        ([k, v]) =>
          `<div class="fact"><span>${escapeHtml(k)}</span><strong>${escapeHtml(dash(v))}</strong></div>`
      )
      .join("");

    $("tableNote").textContent = isGk
      ? "골키퍼 공식 표: 출장 · 실점 · 클린시트. 출처 K리그 선수 상세."
      : "필드 선수 공식 표: 출장 · 득점 · 도움. 출처 K리그 선수 상세.";
    $("seasonTable").innerHTML = recordTable(p.seasons || [], isGk, true);
    $("teamTable").innerHTML = recordTable(p.teams || [], isGk, false);
    const links = [];
    if (p.kleague_url) links.push(`<a href="${escapeHtml(p.kleague_url)}" target="_blank" rel="noopener">K리그 공식 프로필</a>`);
    if (p.photos?.club_page) {
      links.push(`<a href="${escapeHtml(p.photos.club_page)}" target="_blank" rel="noopener">구단 선수 페이지</a>`);
    } else if (p.club_home) {
      links.push(`<a href="${escapeHtml(p.club_home)}" target="_blank" rel="noopener">구단 홈페이지</a>`);
    }
    $("sourceLine").innerHTML =
      `기록 ${escapeHtml(p.source || "K리그")} · 수집 ${escapeHtml((p.fetched_at || "").slice(0, 10))} · ` +
      links.join(" · ");
    renderFmAttributes(p);
    renderAnalysis(p);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadRivals(p) {
    state.rivals = [];
    renderRivals(p);
    if (!state.compareId) {
      const mates = teammatesSamePos(p);
      if (mates[0]) {
        state.compareId = mates[0].id;
        writeHash("replace");
      }
    }
    if (state.compareId) await loadCompare(state.compareId);
    setupCommunityEmbed();
  }

  async function loadCompare(id) {
    if (!id || !state.player) return;
    try {
      const other = await fetchPlayer(id);
      if (String(state.compareId) !== String(id)) return;
      state.comparePlayer = other;
      if (!state.rivals.some((r) => String(r.id) === String(other.id))) {
        state.rivals.push(other);
      }
      renderCompare(state.player);
      renderRivals(state.player);
      setupCommunityEmbed();
    } catch (err) {
      $("cmpTable").innerHTML = `<p class="empty-note">비교 상대 데이터를 찾지 못했습니다.</p>`;
    }
  }

  async function loadPlayer(id) {
    setStatus("선수 기록을 불러오는 중…");
    try {
      const p = await fetchPlayer(id);
      state.player = p;
      renderSquad();
      renderProfile(p);
      setStatus("");
      loadRivals(p);
      setupCommunityEmbed();
    } catch (err) {
      setStatus("선수 데이터를 아직 수집하지 못했거나 파일을 찾지 못했습니다.");
      renderProfile(null);
      setupCommunityEmbed();
    }
  }

  function renderAll() {
    document.querySelectorAll(".seg-btn").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-league") === String(state.leagueId));
    });
    document.querySelectorAll("#posFilter .chip").forEach((b) => {
      b.classList.toggle("active", b.getAttribute("data-pos") === state.pos);
    });
    renderClubs();
    renderSquad();
    if (state.playerId && state.player && String(state.player.id) === String(state.playerId)) {
      renderProfile(state.player);
    } else if (!state.playerId) {
      renderProfile(null);
    }
    setupCommunityEmbed();
  }

  function bind() {
    document.querySelectorAll(".seg-btn").forEach((b) => {
      b.addEventListener("click", () => {
        state.leagueId = b.getAttribute("data-league") || "1";
        const lg = currentLeague();
        state.teamId = defaultTeamId(lg);
        state.playerId = "";
        state.player = null;
        state.compareId = "";
        state.comparePlayer = null;
        state.rivals = [];
        writeHash();
        renderAll();
      });
    });
    document.querySelectorAll("#posFilter .chip").forEach((b) => {
      b.addEventListener("click", () => {
        state.pos = b.getAttribute("data-pos") || "ALL";
        renderSquad();
      });
    });
    $("searchInput").addEventListener("input", (e) => {
      state.q = e.target.value || "";
      renderSquad();
    });
    $("shareHomeCard")?.addEventListener("click", async () => {
      try {
        await copyText(buildShareHtml(publicHomeUrl(), homeShareCopy()));
        setStatus("메인 화면 에버그린 링크 카드를 복사했습니다. HTML 모드에 붙여넣으세요.");
      } catch (err) {
        setStatus("복사에 실패했습니다.");
      }
    });
    $("shareHomeUrl")?.addEventListener("click", async () => {
      try {
        await copyText(publicHomeUrl());
        setStatus("메인 화면 URL을 복사했습니다.");
      } catch (err) {
        setStatus("URL 복사에 실패했습니다.");
      }
    });
    $("shareHomeEmbed")?.addEventListener("click", async () => {
      try {
        await copyText(buildEmbedHtml(publicEmbedUrl()));
        setStatus("iframe HTML을 복사했습니다. 운영진이 wanju1109.github.io/ 를 허용해야 글 안에 보입니다.");
      } catch (err) {
        setStatus("복사에 실패했습니다.");
      }
    });
    $("popOut")?.addEventListener("click", syncPopOut);
    $("evergreenJump")?.addEventListener("click", (e) => {
      e.preventDefault();
      $("community")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("copyShare")?.addEventListener("click", async () => {
      try {
        const text = $("shareCode")?.textContent || buildShareHtml(publicHomeUrl(), homeShareCopy());
        await copyText(text);
        setStatus("에버그린용 프로필 링크 카드를 복사했습니다. HTML 모드에 붙여넣으세요.");
      } catch (err) {
        setStatus("복사에 실패했습니다. 코드를 직접 드래그해 주세요.");
      }
    });
    $("copyUrl")?.addEventListener("click", async () => {
      try {
        await copyText(publicHomeUrl());
        setStatus("프로필 URL을 복사했습니다. (작성자 키 없음)");
      } catch (err) {
        setStatus("URL 복사에 실패했습니다.");
      }
    });
    $("copyEmbed")?.addEventListener("click", async () => {
      try {
        const text = $("embedCode")?.textContent || buildEmbedHtml(publicEmbedUrl());
        await copyText(text);
        setStatus("iframe HTML을 복사했습니다.");
      } catch (err) {
        setStatus("복사에 실패했습니다.");
      }
    });
    window.addEventListener("popstate", () => {
      applyHash();
    });
    window.addEventListener("hashchange", () => {
      applyHash();
    });
  }

  function applyHash() {
    const key = urlWithHash(location.hash || "");
    if (key === appliedUrl) return;
    appliedUrl = key;
    const h = parseHash();
    const prevPlayer = state.playerId;
    if (h.leagueId) state.leagueId = h.leagueId;
    if (h.teamId) state.teamId = h.teamId;
    state.playerId = h.playerId || "";
    state.compareId = h.compareId || "";
    if (!state.playerId) {
      state.player = null;
      state.comparePlayer = null;
      state.rivals = [];
    } else if (!state.compareId) {
      state.comparePlayer = null;
    }
    if (!state.teamId) {
      const lg = currentLeague();
      state.teamId = defaultTeamId(lg);
    }
    renderAll();
    if (state.playerId) loadPlayer(state.playerId);
    else if (prevPlayer) $("squadSection")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function boot() {
    applyViewMode();
    bind();
    try {
      const fmRequest = fetch(DATA_FM_ATTRIBUTES)
        .then((res) => res.ok ? res.json() : null)
        .catch(() => null);
      const res = await fetch(DATA_INDEX);
      if (!res.ok) throw new Error("index " + res.status);
      state.index = await res.json();
      const year = String(state.index.year || "").trim();
      if (year && typeof PlayerEngine !== "undefined" && PlayerEngine.setSeasonYear) {
        PlayerEngine.setSeasonYear(year);
      }
      const evYear = year || (typeof PlayerEngine !== "undefined" ? String(PlayerEngine.YEAR) : "");
      if (evYear) {
        try {
          const evRes = await fetch(`./data/events_${evYear}.json?v=${DATA_VER}`);
          if (evRes.ok) state.events = await evRes.json();
        } catch (evErr) {
          state.events = null;
        }
      }
      state.fmAttributes = await fmRequest;
      applyHash();
    } catch (err) {
      setStatus("선수 명단을 불러오지 못했습니다. 수집 스크립트를 먼저 실행하세요.");
    }
  }

  boot();
})();
