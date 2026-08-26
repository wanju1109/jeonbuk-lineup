(() => {
  const DATA_INDEX = `./data/index.json?v=${Date.now()}`;
  const DATA_PLAYER = (id) => `./data/players/${encodeURIComponent(id)}.json?v=${Date.now()}`;

  const state = {
    index: null,
    leagueId: "1",
    teamId: "",
    pos: "ALL",
    q: "",
    playerId: "",
    player: null,
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
    return {
      leagueId: parts[0] || "",
      teamId: parts[1] || "",
      playerId: parts[2] || "",
    };
  }

  function writeHash() {
    const bits = [state.leagueId, state.teamId, state.playerId].filter(Boolean);
    const next = bits.length ? `#/${bits.join("/")}` : "";
    if (location.hash !== next) history.replaceState(null, "", next || location.pathname);
  }

  function currentLeague() {
    const leagues = state.index?.leagues || [];
    return leagues.find((l) => String(l.id) === String(state.leagueId)) || leagues[0] || null;
  }

  function currentTeam() {
    const lg = currentLeague();
    return (lg?.teams || []).find((t) => t.id === state.teamId) || null;
  }

  function applyClubColor(team) {
    const color = team?.color || "#037340";
    document.documentElement.style.setProperty("--club", color);
  }

  function photoUrls(p) {
    const photos = p?.photos || {};
    const urls = [photos.club, photos.kleague, photos.portal, p?.photo, p?.photo_fallback];
    return [...new Set(urls.filter(Boolean))];
  }

  function imgHtml(urls, alt, cls) {
    const list = (urls || []).filter(Boolean);
    if (!list.length) {
      return `<div class="${cls} empty"></div>`;
    }
    const src = escapeHtml(list[0]);
    const rest = list.slice(1).map(escapeHtml).join("|");
    return (
      `<img class="${cls}" src="${src}" alt="${escapeHtml(alt)}" loading="lazy" ` +
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

  function renderClubs() {
    const lg = currentLeague();
    const strip = $("clubStrip");
    if (!lg) {
      strip.innerHTML = "";
      return;
    }
    strip.innerHTML = (lg.teams || [])
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
        const urls = [p.photo, p.photo_fallback].filter(Boolean);
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

    const scout = p.scout || {};
    $("scoutProfile").textContent = scout.profile || "";
    $("scoutPlus").textContent = scout.strengths || "";
    $("scoutMinus").textContent = scout.weaknesses || "";
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
    box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function loadPlayer(id) {
    setStatus("선수 기록을 불러오는 중…");
    try {
      const res = await fetch(DATA_PLAYER(id), { cache: "no-cache" });
      if (!res.ok) throw new Error("player " + res.status);
      const p = await res.json();
      state.player = p;
      renderSquad();
      renderProfile(p);
      setStatus("");
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
        state.teamId = lg?.teams?.[0]?.id || "";
        state.playerId = "";
        state.player = null;
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
    if (h.playerId) state.playerId = h.playerId;
    if (!state.teamId) {
      const lg = currentLeague();
      state.teamId = lg?.teams?.[0]?.id || "";
    }
    renderAll();
    if (state.playerId) loadPlayer(state.playerId);
  }

  async function boot() {
    bind();
    try {
      const res = await fetch(DATA_INDEX, { cache: "no-cache" });
      if (!res.ok) throw new Error("index " + res.status);
      state.index = await res.json();
      applyHash();
    } catch (err) {
      setStatus("선수 명단을 불러오지 못했습니다. 수집 스크립트를 먼저 실행하세요.");
    }
  }

  boot();
})();
