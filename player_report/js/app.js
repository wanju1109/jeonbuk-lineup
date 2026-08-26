(() => {
  const DATA_VER = "10";
  const DATA_INDEX = `./data/index.json?v=${DATA_VER}`;
  const DATA_PLAYER = (id) => `./data/players/${encodeURIComponent(id)}.json?v=${DATA_VER}`;

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

  function writeHash() {
    const bits = [state.leagueId, state.teamId, state.playerId].filter(Boolean);
    if (state.playerId && state.compareId) bits.push("vs", state.compareId);
    const next = bits.length ? `#/${bits.join("/")}` : "";
    if (location.hash !== next) history.replaceState(null, "", next || location.pathname);
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
        return (
          `<button type="button" class="rival-card${active}" data-id="${escapeHtml(m.id)}">` +
          `<div class="shot">${imgHtml(urls, m.name, "face")}</div>` +
          `<div class="meta">` +
          `<span class="ca">${escapeHtml(rivalStatLine(full, PlayerEngine.isGk(p)))}</span>` +
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
      $("rivalText").textContent = PlayerEngine.rivalCopy(p, focus);
    } else if (state.rivals[0]) {
      $("rivalText").textContent = PlayerEngine.rivalCopy(p, state.rivals[0]);
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
      $("cmpTable").innerHTML = `<p class="empty-note">경쟁자 카드나 검색으로 비교 상대를 고르세요.</p>`;
      $("cmpText").textContent = "";
      return;
    }
    const cmp = PlayerEngine.compareRows(p, other);
    $("cmpTable").innerHTML =
      `<table class="cmp"><thead><tr>` +
      `<th>공식 기록</th>` +
      `<th><span class="lg-dot" style="background:#037340"></span>${escapeHtml(p.name)}</th>` +
      `<th><span class="lg-dot" style="background:#1764c0"></span>${escapeHtml(other.name)}</th>` +
      `<th>차이</th>` +
      `</tr></thead><tbody>` +
      cmp.rows
        .map((r) => {
          const d = r.d;
          const dCls = d == null ? "" : d > 0 ? "d-plus" : d < 0 ? "d-minus" : "";
          const dTxt = d == null ? "–" : (d > 0 ? "+" : "") + d;
          return (
            `<tr><td>${escapeHtml(r.label)}</td>` +
            `<td>${fmtNum(r.mine)}</td>` +
            `<td>${fmtNum(r.theirs)}</td>` +
            `<td class="${dCls}">${dTxt}</td></tr>`
          );
        })
        .join("") +
      `</tbody></table>`;
    $("cmpText").textContent = PlayerEngine.rivalCopy(p, other);
  }

  function renderAnalysis(p) {
    if (typeof PlayerEngine === "undefined") return;
    const analysis = PlayerEngine.build(p);
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
      `추정 능력치 없음 · ` +
      links.join(" · ");
    renderAnalysis(p);
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadRivals(p) {
    state.rivals = [];
    renderRivals(p);
    if (!state.compareId) {
      const mates = teammatesSamePos(p);
      if (mates[0]) state.compareId = mates[0].id;
    }
    if (state.compareId) await loadCompare(state.compareId);
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
    } catch (err) {
      setStatus("선수 데이터를 아직 수집하지 못했거나 파일을 찾지 못했습니다.");
      renderProfile(null);
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
    bind();
    try {
      const res = await fetch(DATA_INDEX);
      if (!res.ok) throw new Error("index " + res.status);
      state.index = await res.json();
      applyHash();
    } catch (err) {
      setStatus("선수 명단을 불러오지 못했습니다. 수집 스크립트를 먼저 실행하세요.");
    }
  }

  boot();
})();
