(() => {
  const DATA_VER = "21";
  const DATA_INDEX = `./data/index.json?v=${DATA_VER}`;
  const DATA_EVENTS = `./data/events_2026.json?v=${DATA_VER}`;
  const DATA_PLAYER = (id) => `./data/players/${encodeURIComponent(id)}.json?v=${DATA_VER}`;
  const CANONICAL = "https://wanju1109.github.io/jeonbuk-lineup/player_report/";
  const EDIT_TOKEN = "jb7k";
  const SELF_COLOR = "#037340";
  const SELF_FILL = "rgba(3,115,64,0.22)";
  const OTHER_COLOR = "#c2410c";
  const OTHER_FILL = "rgba(194,65,12,0.20)";

  const state = {
    index: null,
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

  function writeHash() {
    const next = routeHash();
    if (location.hash === next) return;
    const path = location.pathname + location.search;
    try {
      history.replaceState(null, "", path + next);
    } catch (err) {
      location.hash = next.replace(/^#/, "");
    }
  }

  function isEditQuery() {
    try {
      const p = new URLSearchParams(location.search || "");
      return p.get("x") === EDIT_TOKEN || p.get("edit") === "1";
    } catch (err) {
      return false;
    }
  }

  function applyViewMode() {
    document.body.classList.toggle("edit-mode", isEditQuery());
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

  function publicShareUrl() {
    const current = pageBaseNoQuery();
    const base = /wanju1109\.github\.io/i.test(current) ? current : CANONICAL;
    return `${normalizeBase(base)}${routeHash()}`;
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

  function buildShareHtml(url) {
    const copy = shareCopy();
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
      `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:10px 14px;border-radius:8px;background-color:#b7f24a;color:#0a2218;font-weight:700;text-decoration:none;">프로필 새 창에서 보기 →</a>`,
      "</td></tr></table></div>",
    ].join("");
  }

  function buildEmbedHtml(src) {
    return [
      '<div style="width:100%;max-width:1100px;margin:0 auto;box-sizing:border-box;">',
      `<iframe src="${escapeHtml(src)}" title="K리그 선수 프로필" width="100%" height="920" style="width:100%;max-width:1100px;height:920px;border:0;border-radius:12px;overflow:hidden;background:#f3f7f2;display:block;" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe>`,
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

  function setupCommunityEmbed() {
    if (!isEditQuery()) return;
    const reportUrl = publicShareUrl();
    const previewUrl = previewShareUrl();
    const shareHtml = buildShareHtml(reportUrl);
    const embedHtml = buildEmbedHtml(reportUrl);
    const copy = shareCopy();
    if ($("shareTargetMeta")) $("shareTargetMeta").textContent = copy.meta;
    if ($("shareCode")) $("shareCode").textContent = shareHtml;
    if ($("embedCode")) $("embedCode").textContent = embedHtml;
    if ($("reportUrl")) {
      $("reportUrl").textContent = reportUrl;
      $("reportUrl").href = reportUrl;
    }
    const frame = $("embedPreview");
    if (frame && frame.getAttribute("src") !== previewUrl) {
      frame.src = previewUrl;
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

  function fmtNum(n) {
    if (n == null || n === "") return "–";
    return String(n);
  }

  function vClass(n) {
    if (n >= 80) return "v-top";
    if (n >= 65) return "v-hi";
    if (n >= 45) return "v-ok";
    if (n >= 25) return "v-mid";
    return "v-low";
  }

  function score100(n) {
    if (n == null || n === "") return "–";
    return `${n} / 100`;
  }

  function polar(cx, cy, r, i, n) {
    const ang = -Math.PI / 2 + (i / n) * 2 * Math.PI;
    return [cx + r * Math.cos(ang), cy + r * Math.sin(ang)];
  }

  function radarSvg(seriesList, labels, size) {
    const n = labels.length;
    size = size || 440;
    const cx = size / 2;
    const cy = size / 2;
    const r = size * 0.34;
    const font = n >= 8 ? 11 : size >= 520 ? 14 : 13;
    const labOff = n >= 8 ? Math.max(34, size * 0.08) : Math.max(30, size * 0.07);
    const dot = n >= 8 ? 3 : 4;
    if (!n) return "";
    const rings = [0.25, 0.5, 0.75, 1]
      .map((t) => {
        const pts = Array.from({ length: n }, (_, i) => polar(cx, cy, r * t, i, n).join(",")).join(" ");
        return `<polygon points="${pts}" fill="none" stroke="#c5d6ca" stroke-width="1" />`;
      })
      .join("");
    const spokes = Array.from({ length: n }, (_, i) => {
      const [x, y] = polar(cx, cy, r, i, n);
      return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="#c5d6ca" stroke-width="1" />`;
    }).join("");
    const labs = labels
      .map((lab, i) => {
        const [x, y] = polar(cx, cy, r + labOff, i, n);
        return `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="middle" font-size="${font}" fill="#4a5d54">${escapeHtml(lab)}</text>`;
      })
      .join("");
    const polys = seriesList
      .map((s) => {
        const pts = (s.values || [])
          .map((v, i) => polar(cx, cy, r * (Math.max(0, Math.min(100, v || 0)) / 100), i, n).join(","))
          .join(" ");
        const width = s.width || 2.6;
        const dash = s.dash ? ` stroke-dasharray="${escapeHtml(s.dash)}"` : "";
        return (
          `<polygon points="${pts}" fill="${s.fill}" stroke="${s.stroke}" stroke-width="${width}"${dash} />` +
          (s.values || [])
            .map((v, i) => {
              const [x, y] = polar(cx, cy, r * (Math.max(0, Math.min(100, v || 0)) / 100), i, n);
              return `<circle cx="${x}" cy="${y}" r="${dot}" fill="${s.stroke}" />`;
            })
            .join("")
        );
      })
      .join("");
    return `<svg viewBox="0 0 ${size} ${size}" role="img">${rings}${spokes}${polys}${labs}</svg>`;
  }

  function radarPanel(title, seriesList, labels, size) {
    if (!labels || !labels.length) return "";
    return (
      `<div class="fm-radar">` +
      `<p class="radar-cap">${escapeHtml(title)}</p>` +
      radarSvg(seriesList, labels, size) +
      `</div>`
    );
  }

  function cmpSeries(mine, theirs) {
    return [
      { values: mine, fill: SELF_FILL, stroke: SELF_COLOR, width: 2.6 },
      { values: theirs, fill: OTHER_FILL, stroke: OTHER_COLOR, width: 2.6, dash: "7 5" },
    ];
  }

  function radarLegend(items) {
    return (
      `<div class="radar-legend">` +
      (items || [])
        .map(
          (it) =>
            `<span class="lg-item">` +
            `<i style="background:${escapeHtml(it.color)}"></i>` +
            `${escapeHtml(it.label)}</span>`
        )
        .join("") +
      `</div>`
    );
  }

  function tendHtml(score, name) {
    const left = Math.max(4, Math.min(96, score.needle));
    const note = score.tendNote
      ? score.tendNote
      : score.gk
        ? "키퍼 수비 성향은 클린율·경기당 실점."
        : "야수 수비 성향은 태클 표가 없어 출장 신뢰에서 공격 산출을 뺀 값.";
    return (
      `<div class="tend-labels">` +
      `<span>공격</span>` +
      `<strong>${escapeHtml(name || "")} · ${escapeHtml(score.tendLabel)}</strong>` +
      `<span>수비</span>` +
      `</div>` +
      `<div class="tend-track" role="img" aria-label="${escapeHtml(score.tendLabel)}">` +
      `<i class="tend-needle" style="left:${left}%"></i>` +
      `</div>` +
      `<p class="tend-note">${escapeHtml(note)} 공격 ${score.attack} · 수비 ${score.defend}</p>`
    );
  }

  function cmpTendHtml(selfName, a, otherName, b) {
    return (
      `<div class="tend-dual">` +
      tendHtml(a, selfName) +
      tendHtml(b, otherName) +
      `</div>`
    );
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

  function renderScore(p, analysis) {
    const sc = analysis.score;
    if (!sc) return;
    $("scoreNote").textContent = sc.formula;
    $("scoreHead").innerHTML =
      `<div class="fm-cap"><span>올해 기여점</span><strong>${sc.total}</strong><em>100점 만점</em></div>` +
      `<div class="fm-cap"><span>공격 성향</span><strong>${sc.attack}</strong><em>경기당 골+도움</em></div>` +
      `<div class="fm-cap"><span>수비 성향</span><strong>${sc.defend}</strong><em>${escapeHtml(sc.tendLabel)}</em></div>`;
    $("tendBox").innerHTML = tendHtml(sc, p.name);
    const det = PlayerEngine.detailRadar(sc);
    const pair = $("scoreRadars");
    const overview =
      radarPanel(
        "요약",
        [{ values: sc.axes.map((a) => a.value), fill: SELF_FILL, stroke: SELF_COLOR }],
        sc.axes.map((a) => a.label),
        420
      );
    const detail = det.labels.length
      ? radarPanel(
          "상세",
          [{ values: det.values, fill: SELF_FILL, stroke: SELF_COLOR }],
          det.labels,
          420
        )
      : "";
    if (pair) {
      pair.classList.toggle("one", !detail);
      pair.innerHTML =
        overview +
        detail +
        radarLegend([{ color: SELF_COLOR, label: `${p.name || "이 선수"} · 초록 · 100점` }]);
    }
    $("scoreBars").innerHTML = sc.axes
      .map((a) => {
        const cls = vClass(a.value);
        const shown = a.raw ? escapeHtml(a.raw) : score100(a.value);
        return (
          `<div class="fm-row">` +
          `<span class="lab">${escapeHtml(a.label)}</span>` +
          `<div class="bar"><i class="${cls}" style="width:${a.value}%"></i></div>` +
          `<span class="num ${cls}">${shown}</span>` +
          `</div>`
        );
      })
      .join("");
    const rates = sc.rates || [];
    const rateGrid = $("rateGrid");
    const rateNote = $("rateNote");
    if (!rates.length) {
      if (rateNote) {
        rateNote.textContent = "칠판 3경기 미만이면 패스 성공률·슈팅 정확도를 계산하지 않습니다. K리그2는 칠판 표본이 없습니다.";
      }
      if (rateGrid) rateGrid.innerHTML = "";
    } else {
      if (rateNote) {
        rateNote.textContent = sc.gk
          ? "패스 성공률 = 성공/시도. 선방률 = 선방/(선방+실점). Bepro11 부가기록."
          : "패스 성공률 = 성공/시도. 슈팅 정확도 = 유효슈팅/슈팅. Bepro11 부가기록.";
      }
      if (rateGrid) {
        const shown = rates.filter((r) => r.pct != null);
        const groups = [];
        shown.forEach((r) => {
          const title = r.group || "기타";
          let g = groups.find((x) => x.title === title);
          if (!g) {
            g = { title, items: [] };
            groups.push(g);
          }
          g.items.push(r);
        });
        rateGrid.innerHTML = groups
          .map((g) => {
            const cards = g.items
              .map((r) => {
                const cls = vClass(r.pct);
                return (
                  `<div class="rate-card">` +
                  `<span>${escapeHtml(r.label)}</span>` +
                  `<strong class="${cls}">${escapeHtml(r.text)}</strong>` +
                  `<em>${escapeHtml(r.raw)}${r.hint ? ` · ${r.hint}` : ""}</em>` +
                  `</div>`
                );
              })
              .join("");
            return `<div class="rate-group"><h5>${escapeHtml(g.title)}</h5><div class="rate-grid">${cards}</div></div>`;
          })
          .join("");
      }
    }
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
      ? `${team.full || team.name} ${p.position || ""} 경쟁자. 카드를 누르면 아래에서 공식 기록을 비교합니다.`
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

  function renderComparePicker(p) {
    const mates = teammatesSamePos(p);
    const flat = allPlayersFlat();
    const options = flat
      .filter((x) => String(x.id) !== String(p.id))
      .slice(0, 1200)
      .map((x) => `<option value="${escapeHtml(x.name)} (${escapeHtml(x.teamName)} ${escapeHtml(x.position || "")})" data-id="${escapeHtml(x.id)}"></option>`)
      .join("");
    const mateOpts = mates
      .map((m) => {
        const sel = String(m.id) === String(state.compareId) ? " selected" : "";
        return `<option value="${escapeHtml(m.id)}"${sel}>${escapeHtml(m.name)} · ${m.back_no != null ? "No." + m.back_no : ""}</option>`;
      })
      .join("");
    $("cmpPicker").innerHTML =
      `<label for="cmpMate">같은 포지션</label>` +
      `<select id="cmpMate"><option value="">선택</option>${mateOpts}</select>` +
      `<label for="cmpSearch">다른 선수</label>` +
      `<input id="cmpSearch" list="cmpAll" placeholder="이름 검색 후 엔터" />` +
      `<datalist id="cmpAll">${options}</datalist>`;
    $("cmpMate").addEventListener("change", (e) => {
      const id = e.target.value;
      if (!id) return;
      state.compareId = id;
      writeHash();
      loadCompare(id);
    });
    $("cmpSearch").addEventListener("change", (e) => {
      const q = String(e.target.value || "").trim();
      if (!q) return;
      const hit =
        flat.find((x) => `${x.name} (${x.teamName} ${x.position || ""})` === q) ||
        flat.find((x) => x.name === q && String(x.id) !== String(p.id));
      if (!hit) return;
      state.compareId = hit.id;
      writeHash();
      loadCompare(hit.id);
    });
  }

  function renderCompare(p) {
    renderComparePicker(p);
    const other = state.comparePlayer;
    if (!other) {
      $("cmpRadars").innerHTML = "";
      $("cmpTend").innerHTML = "";
      $("cmpTable").innerHTML = `<p class="empty-note">경쟁자 카드나 검색으로 비교 상대를 고르세요.</p>`;
      $("cmpText").textContent = "";
      return;
    }
    const view = PlayerEngine.compareView(p, other, state.events);
    const detA = view.detailA || { labels: [], values: [] };
    const detB = view.detailB || { labels: [], values: [] };
    const detLabels = detA.labels.length ? detA.labels : detB.labels;
    const legend = radarLegend([
      { color: SELF_COLOR, label: `${p.name} · 초록` },
      { color: OTHER_COLOR, label: `${other.name} · 주황` },
    ]);
    $("cmpRadars").classList.toggle("one", !detLabels.length);
    $("cmpRadars").innerHTML =
      radarPanel("요약", cmpSeries(view.radarMine, view.radarTheirs), view.radarLabels, 420) +
      (detLabels.length
        ? radarPanel(
            "상세",
            cmpSeries(
              detA.values.length ? detA.values : detLabels.map(() => 0),
              detB.values.length ? detB.values : detLabels.map(() => 0)
            ),
            detLabels,
            420
          )
        : "") +
      legend;
    $("cmpTend").innerHTML = cmpTendHtml(p.name, view.a, other.name, view.b);
    const cmpWinner = (r) => {
      if (r.mine == null || r.theirs == null || !Number.isFinite(Number(r.mine)) || !Number.isFinite(Number(r.theirs))) {
        return "";
      }
      if (Number(r.mine) === Number(r.theirs)) return "";
      const low = r.better === "low";
      const mineWins = low ? Number(r.mine) < Number(r.theirs) : Number(r.mine) > Number(r.theirs);
      return mineWins ? "mine" : "theirs";
    };
    const cmpCell = (r, side) => {
      const n = side === "mine" ? r.mine : r.theirs;
      const unit100 = r.scale === 100;
      const unitPct = r.scale === "pct";
      const txt = unit100 ? score100(n) : unitPct ? (n == null ? "–" : `${n}%`) : fmtNum(n);
      const win = cmpWinner(r) === side;
      const inner = win ? `<span class="win-mark">${txt}</span>` : txt;
      return `<td class="${win ? "win" : ""}">${inner}</td>`;
    };
    const cmpRowHtml = (r) => {
      const d = r.d;
      const dCls = d == null ? "" : d > 0 ? "d-plus" : d < 0 ? "d-minus" : "";
      const dTxt = d == null ? "–" : (d > 0 ? "+" : "") + d;
      const unit100 = r.scale === 100;
      const unitPct = r.scale === "pct";
      const suffix = unit100 ? " (100점)" : unitPct ? " (%)" : "";
      return (
        `<tr><td>${escapeHtml(r.label)}${suffix}</td>` +
        cmpCell(r, "mine") +
        cmpCell(r, "theirs") +
        `<td class="${dCls}">${dTxt}${unitPct && d != null ? "p" : ""}</td></tr>`
      );
    };
    const body = (view.sections || [])
      .filter((sec) => sec.rows && sec.rows.length)
      .map((sec) => {
        return (
          `<tr class="cmp-sec"><th colspan="4">${escapeHtml(sec.title)}</th></tr>` +
          sec.rows.map(cmpRowHtml).join("")
        );
      })
      .join("");
    $("cmpTable").innerHTML =
      `<table class="cmp"><thead><tr>` +
      `<th>항목</th>` +
      `<th><span class="lg-dot" style="background:${SELF_COLOR}"></span>${escapeHtml(p.name)}</th>` +
      `<th><span class="lg-dot" style="background:${OTHER_COLOR}"></span>${escapeHtml(other.name)}</th>` +
      `<th>차이</th>` +
      `</tr></thead><tbody>` +
      body +
      `</tbody></table>`;
    $("cmpText").textContent = PlayerEngine.rivalCopy(p, other, state.events);
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
    renderScore(p, analysis);
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
      `기여점은 공식 골+도움 + 칠판 부가기록 · ` +
      links.join(" · ");
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
        writeHash();
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
    $("evergreenJump")?.addEventListener("click", (e) => {
      e.preventDefault();
      $("community")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    $("copyShare")?.addEventListener("click", async () => {
      try {
        const text = $("shareCode")?.textContent || buildShareHtml(publicShareUrl());
        await copyText(text);
        setStatus("에버그린용 프로필 링크 카드를 복사했습니다. HTML 모드에 붙여넣으세요.");
      } catch (err) {
        setStatus("복사에 실패했습니다. 코드를 직접 드래그해 주세요.");
      }
    });
    $("copyUrl")?.addEventListener("click", async () => {
      try {
        await copyText(publicShareUrl());
        setStatus("프로필 URL을 복사했습니다. (작성자 키 없음)");
      } catch (err) {
        setStatus("URL 복사에 실패했습니다.");
      }
    });
    $("copyEmbed")?.addEventListener("click", async () => {
      try {
        const text = $("embedCode")?.textContent || buildEmbedHtml(publicShareUrl());
        await copyText(text);
        setStatus("iframe HTML을 복사했습니다.");
      } catch (err) {
        setStatus("복사에 실패했습니다.");
      }
    });
    window.addEventListener("hashchange", () => {
      applyHash();
    });
  }

  function applyHash() {
    const h = parseHash();
    if (h.leagueId) state.leagueId = h.leagueId;
    if (h.teamId) state.teamId = h.teamId;
    state.playerId = h.playerId || "";
    state.compareId = h.compareId || "";
    if (!state.playerId) {
      state.player = null;
      state.comparePlayer = null;
      state.rivals = [];
    }
    if (!state.teamId) {
      const lg = currentLeague();
      state.teamId = defaultTeamId(lg);
    }
    renderAll();
    if (state.playerId) loadPlayer(state.playerId);
  }

  async function boot() {
    applyViewMode();
    bind();
    try {
      const res = await fetch(DATA_INDEX);
      if (!res.ok) throw new Error("index " + res.status);
      state.index = await res.json();
      try {
        const evRes = await fetch(DATA_EVENTS);
        if (evRes.ok) state.events = await evRes.json();
      } catch (evErr) {
        state.events = null;
      }
      applyHash();
    } catch (err) {
      setStatus("선수 명단을 불러오지 못했습니다. 수집 스크립트를 먼저 실행하세요.");
    }
  }

  boot();
})();
