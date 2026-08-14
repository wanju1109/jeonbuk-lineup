/*
 * Rendering layer for the deep tactical section.
 *
 * Owns every DOM node under #deepdive: shape maps, momentum chart, zone
 * occupation grids, lane match-up table, player role cards and the long-form
 * chapters produced by Analyst.build().
 */

const DeepView = (() => {
  const FALLBACK = {
    home: { base: "#0f6b4c", pitch: "#d6f56a", rgb: "15, 107, 76", on: "#ffffff" },
    away: { base: "#e4572e", pitch: "#ffb08a", rgb: "228, 87, 46", on: "#ffffff" },
  };

  let currentCtx = null;
  let palette = FALLBACK;
  let roleSide = "home";
  let resizeBound = false;

  function pal(side) {
    return palette[side] || FALLBACK[side];
  }

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])
    );
  }

  function fmt(n, digits = 1) {
    if (n === null || n === undefined || Number.isNaN(Number(n))) return "-";
    return Number(n).toFixed(digits).replace(/\.0+$/, "");
  }

  /* ------------------------------------------------------------------ *
   * Shape maps
   * ------------------------------------------------------------------ */

  function shapeSubtitle(team, name) {
    const f = team.shape.formation;
    const parts = [];
    if (f.label) parts.push(`관측 형태 ${f.label}`);
    parts.push(`블록 높이 ${fmt(team.shape.blockHeight)}`);
    parts.push(`세로 ${fmt(team.shape.depthSpread)} · 가로 ${fmt(team.shape.widthSpread)}`);
    return `${name} · ${parts.join(" · ")}`;
  }

  function drawShape(canvasId, team, accent, teamName) {
    const canvas = $(canvasId);
    if (!canvas) return;
    const nodes = team.players && team.players.length ? team.players : team.shape.nodes;
    try {
      Pitch.render(canvas, {
        mode: "shape",
        nodes,
        edges: team.network.edges,
        accent,
        ink: "#0a2218",
        hover: true,
        /* Each shape map is drawn in that team's own attacking frame. */
        direction: { right: { label: `${teamName} 공격`, color: accent } },
      });
    } catch (err) {
      console.error("[DeepView] shape render failed:", err);
    }
  }

  function renderShapes(ctx) {
    if ($("ddHomeShapeTitle")) {
      $("ddHomeShapeTitle").textContent = shapeSubtitle(ctx.home, ctx.homeName);
    }
    if ($("ddAwayShapeTitle")) {
      $("ddAwayShapeTitle").textContent = shapeSubtitle(ctx.away, ctx.awayName);
    }
    drawShape("ddHomeShape", ctx.home, pal("home").pitch, ctx.homeName);
    drawShape("ddAwayShape", ctx.away, pal("away").pitch, ctx.awayName);

    const topPairText = (team, name) => {
      const p = team.network.topPair;
      if (!p || !p.a || !p.b) return `${name}: 연결 데이터 부족`;
      return `${name} 최다 연결 ${p.a.name} ↔ ${p.b.name} ${p.count}회`;
    };
    if ($("ddShapeNote")) {
      $("ddShapeNote").textContent =
        `원의 크기는 볼 관여량, 선의 굵기는 두 선수 사이 패스 연결 횟수입니다. ` +
        `${topPairText(ctx.home, ctx.homeName)} · ${topPairText(ctx.away, ctx.awayName)}.`;
    }
  }

  /* ------------------------------------------------------------------ *
   * Momentum chart (cumulative xG)
   * ------------------------------------------------------------------ */

  function drawMomentum(ctx) {
    const canvas = $("ddMomentum");
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 900;
    const cssH = Math.max(220, Math.round(cssW * 0.3));
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const padL = 44;
    const padR = 16;
    const padT = 18;
    const padB = 30;
    const plotW = cssW - padL - padR;
    const plotH = cssH - padT - padB;
    const maxMin = 95;
    const maxXg = Math.max(ctx.momentum.homeTotal, ctx.momentum.awayTotal, 0.5) * 1.12;

    const sx = (m) => padL + (Math.min(m, maxMin) / maxMin) * plotW;
    const sy = (v) => padT + plotH - (v / maxXg) * plotH;

    g.fillStyle = "rgba(255,255,255,0.55)";
    g.fillRect(padL, padT, plotW, plotH);

    /* Horizontal guides */
    g.strokeStyle = "rgba(16,35,28,0.10)";
    g.lineWidth = 1;
    g.fillStyle = "#5d7268";
    g.font = "600 10px IBM Plex Sans KR, sans-serif";
    g.textAlign = "right";
    g.textBaseline = "middle";
    const steps = 4;
    for (let i = 0; i <= steps; i += 1) {
      const v = (maxXg / steps) * i;
      const y = sy(v);
      g.beginPath();
      g.moveTo(padL, y);
      g.lineTo(padL + plotW, y);
      g.stroke();
      g.fillText(v.toFixed(1), padL - 6, y);
    }

    /* Half-time divider */
    g.strokeStyle = "rgba(16,35,28,0.28)";
    g.setLineDash([4, 4]);
    g.beginPath();
    g.moveTo(sx(45), padT);
    g.lineTo(sx(45), padT + plotH);
    g.stroke();
    g.setLineDash([]);

    g.textAlign = "center";
    g.textBaseline = "top";
    g.fillStyle = "#5d7268";
    for (const m of [0, 15, 30, 45, 60, 75, 90]) {
      g.fillText(`${m}'`, sx(m), padT + plotH + 6);
    }

    const series = [
      { key: "home", color: pal("home").base, name: ctx.homeName },
      { key: "away", color: pal("away").base, name: ctx.awayName },
    ];
    const pts = [{ minute: 0, home: 0, away: 0 }].concat(ctx.momentum.points);

    for (const s of series) {
      g.strokeStyle = s.color;
      g.lineWidth = 2.4;
      g.beginPath();
      let prevY = sy(0);
      g.moveTo(sx(0), prevY);
      for (const p of pts) {
        const x = sx(p.minute);
        g.lineTo(x, prevY);
        prevY = sy(p[s.key]);
        g.lineTo(x, prevY);
      }
      g.lineTo(sx(maxMin), prevY);
      g.stroke();
    }

    /* Goal markers */
    for (const goal of ctx.momentum.goals) {
      const x = sx(goal.minute);
      const color = pal(goal.side === "home" ? "home" : "away").base;
      g.strokeStyle = "rgba(16,35,28,0.25)";
      g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, padT);
      g.lineTo(x, padT + plotH);
      g.stroke();
      g.setLineDash([]);

      g.fillStyle = color;
      g.beginPath();
      g.arc(x, padT + 8, 5, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#fff";
      g.lineWidth = 1.5;
      g.stroke();
    }

    if ($("ddMomentumNote")) {
      $("ddMomentumNote").textContent =
        `누적 기대득점(xG) 곡선. 계단이 클수록 그 순간의 기회가 좋았다는 뜻입니다. ` +
        `점은 실제 득점 시점입니다. 최종 누적 ${ctx.homeName} ${fmt(ctx.momentum.homeTotal, 2)} · ${ctx.awayName} ${fmt(ctx.momentum.awayTotal, 2)}.`;
    }
    if ($("ddMomentumLegend")) {
      $("ddMomentumLegend").innerHTML =
        `<span class="dd-legend-item"><i style="background:${pal("home").base}"></i>${escapeHtml(ctx.homeName)}</span>` +
        `<span class="dd-legend-item"><i style="background:${pal("away").base}"></i>${escapeHtml(ctx.awayName)}</span>`;
    }
  }

  /* ------------------------------------------------------------------ *
   * Zone occupation grid
   * ------------------------------------------------------------------ */

  function zoneTable(team, name, side) {
    const accent = pal(side);
    const accentRgb = accent.rgb;
    const rows = team.zones.grid;
    const maxShare = Math.max(...rows.flat().map((c) => c.share), 1);
    /* Rows come defensive-third first; attacking third belongs on the right. */
    const lanes = rows[0].map((c) => c.lane);
    const cells = [];
    for (let li = 0; li < lanes.length; li += 1) {
      for (let ti = 0; ti < rows.length; ti += 1) {
        const cell = rows[ti][li];
        const intensity = cell.share / maxShare;
        const alpha = 0.08 + intensity * 0.82;
        /* Flip the label once the tint is dark enough to swallow dark text. */
        const ink = alpha >= 0.55 ? accent.on : "#123226";
        cells.push(
          `<div class="dd-zone-cell" style="background:rgba(${accentRgb},${alpha.toFixed(
            3
          )});color:${ink}" title="${escapeHtml(
            `${cell.lane.label} / ${cell.third.label}`
          )}">` +
            `<span class="dd-zone-val">${fmt(cell.share, 1)}%</span>` +
            `</div>`
        );
      }
    }
    return (
      `<div class="dd-zone-block">` +
      `<div class="dd-zone-head"><strong>${escapeHtml(name)}</strong><span>공격 방향 →</span></div>` +
      `<div class="dd-zone-body">` +
      `<div class="dd-zone-lanes">${lanes.map((l) => `<span>${escapeHtml(l.short)}</span>`).join("")}</div>` +
      `<div class="dd-zone-grid">${cells.join("")}</div>` +
      `</div>` +
      `<div class="dd-zone-foot"><span>수비</span><span>중원</span><span>공격</span></div>` +
      `</div>`
    );
  }

  function renderZones(ctx) {
    const box = $("ddZones");
    if (!box) return;
    box.innerHTML =
      zoneTable(ctx.home, ctx.homeName, "home") + zoneTable(ctx.away, ctx.awayName, "away");
  }

  /* ------------------------------------------------------------------ *
   * Chapters
   * ------------------------------------------------------------------ */

  function metricsHtml(metrics, homeName, awayName) {
    if (!metrics || !metrics.length) return "";
    const rows = metrics
      .map(
        (m) =>
          `<div class="dd-metric">` +
          `<div class="dd-metric-label">${escapeHtml(m.label)}</div>` +
          `<div class="dd-metric-values">` +
          `<span class="dd-metric-home">${escapeHtml(m.home)}</span>` +
          `<span class="dd-metric-sep">vs</span>` +
          `<span class="dd-metric-away">${escapeHtml(m.away)}</span>` +
          `</div>` +
          (m.hint ? `<div class="dd-metric-hint">${escapeHtml(m.hint)}</div>` : "") +
          `</div>`
      )
      .join("");
    return (
      `<div class="dd-metric-head"><span class="dd-tag home">${escapeHtml(homeName)}</span>` +
      `<span class="dd-tag away">${escapeHtml(awayName)}</span></div>` +
      `<div class="dd-metric-grid">${rows}</div>`
    );
  }

  function matchupTableHtml(table, homeName, awayName) {
    if (!table || !table.length) return "";
    const resistances = table.map((r) => r.awayResistance).filter((v) => v !== null && v !== undefined);
    const minRes = resistances.length ? Math.min(...resistances) : null;
    const maxRes = resistances.length ? Math.max(...resistances) : null;

    const body = table
      .map((r) => {
        let cls = "";
        if (r.awayResistance !== null && r.awayResistance !== undefined) {
          if (r.awayResistance === minRes) cls = " class=\"dd-open\"";
          else if (r.awayResistance === maxRes) cls = " class=\"dd-shut\"";
        }
        return (
          `<tr>` +
          `<th scope="row">${escapeHtml(r.lane)}</th>` +
          `<td>${r.homeAttack}<small> (${fmt(r.homeShare, 1)}%)</small></td>` +
          `<td>${r.awayDefend}</td>` +
          `<td${cls}>${r.awayResistance === null || r.awayResistance === undefined ? "-" : fmt(r.awayResistance, 2)}</td>` +
          `<td>${r.awayAttack}</td>` +
          `<td>${r.homeDefend}</td>` +
          `</tr>`
        );
      })
      .join("");
    return (
      `<div class="dd-table-wrap"><table class="dd-table">` +
      `<caption>통로별 최종 3선 진입과 그 통로를 막아선 수비 개입. 저항도는 진입 1회당 상대 수비 개입 횟수로, 낮을수록 상대가 그 길을 내줬다는 뜻입니다.</caption>` +
      `<thead><tr>` +
      `<th scope="col">통로</th>` +
      `<th scope="col">${escapeHtml(homeName)} 진입</th>` +
      `<th scope="col">${escapeHtml(awayName)} 수비</th>` +
      `<th scope="col">저항도</th>` +
      `<th scope="col">${escapeHtml(awayName)} 진입</th>` +
      `<th scope="col">${escapeHtml(homeName)} 수비</th>` +
      `</tr></thead><tbody>${body}</tbody></table></div>`
    );
  }

  function renderChapters(ctx, chapters) {
    const box = $("ddChapters");
    if (!box) return;
    if (!chapters || !chapters.length) {
      box.innerHTML = `<div class="dd-chapter"><p>분석 가능한 이벤트가 부족합니다.</p></div>`;
      return;
    }
    box.innerHTML = chapters
      .map((ch) => {
        const paras = ch.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
        return (
          `<article class="dd-chapter" id="dd-${escapeHtml(ch.id)}" data-outline="${escapeHtml(
            ch.title
          )}">` +
          `<div class="dd-chapter-head">` +
          `<div class="dd-kicker">${escapeHtml(ch.kicker)}</div>` +
          `<h3>${escapeHtml(ch.title)}</h3>` +
          (ch.lead ? `<p class="dd-lead">${escapeHtml(ch.lead)}</p>` : "") +
          `</div>` +
          metricsHtml(ch.metrics, ctx.homeName, ctx.awayName) +
          `<div class="dd-chapter-body">${paras}</div>` +
          matchupTableHtml(ch.table, ctx.homeName, ctx.awayName) +
          `</article>`
        );
      })
      .join("");
  }

  /* ------------------------------------------------------------------ *
   * Player role cards
   * ------------------------------------------------------------------ */

  function emblemHtml(teamId, teamName) {
    if (!teamId) return "";
    const src = `https://portal.kleague.com/images/portal/img-emble-${escapeHtml(
      String(teamId).toLowerCase()
    )}-sm.png`;
    return `<img class="team-emblem" src="${src}" alt="${escapeHtml(
      teamName || ""
    )} 엠블럼" width="22" height="22" decoding="async" onerror="this.hidden=true" />`;
  }

  const POS_ORDER = ["GK", "DF", "MF", "FW"];
  const POS_LABEL = { GK: "GK", DF: "DF", MF: "MD", FW: "FW" };

  function normPos(pos) {
    const p = String(pos || "").toUpperCase();
    if (p === "MD") return "MF";
    return p;
  }

  function backNoNum(p) {
    const n = Number(p.backNo);
    return Number.isFinite(n) ? n : 999;
  }

  function sortByBackNo(a, b) {
    const diff = backNoNum(a) - backNoNum(b);
    if (diff) return diff;
    return String(a.name || "").localeCompare(String(b.name || ""), "ko");
  }

  function roleGroupSortKey(players, pos) {
    const avgX = players.reduce((s, p) => s + (p.x || 50), 0) / players.length;
    const avgY = players.reduce((s, p) => s + (p.y || 50), 0) / players.length;
    if (pos === "FW") return -avgX * 100 + avgY;
    if (pos === "GK") return 0;
    return avgX * 100 + avgY;
  }

  function groupRoleCards(players, side) {
    const byPos = new Map();
    for (const p of players) {
      const pos = normPos(p.position);
      if (!byPos.has(pos)) byPos.set(pos, []);
      byPos.get(pos).push(p);
    }

    const sections = [];
    for (const pos of POS_ORDER) {
      const bucket = byPos.get(pos);
      if (!bucket?.length) continue;

      const byRole = new Map();
      for (const p of bucket) {
        const role = p.role || "기타";
        if (!byRole.has(role)) byRole.set(role, []);
        byRole.get(role).push(p);
      }

      const roleGroups = [...byRole.entries()]
        .map(([role, list]) => ({
          role,
          players: list.sort(sortByBackNo),
          sortKey: roleGroupSortKey(list, pos),
        }))
        .sort((a, b) => a.sortKey - b.sortKey || a.role.localeCompare(b.role, "ko"));

      const subHtml = roleGroups
        .map(
          ({ role, players: list }) =>
            `<div class="dd-role-subgroup">` +
            `<div class="dd-role-sub-label">${escapeHtml(role)}</div>` +
            `<div class="dd-role-sub-grid">${list.map((p) => roleCard(p, side)).join("")}</div>` +
            `</div>`
        )
        .join("");

      sections.push(
        `<section class="dd-role-pos-group">` +
        `<h4 class="dd-role-pos-label">${escapeHtml(POS_LABEL[pos] || pos)}</h4>` +
        subHtml +
        `</section>`
      );
    }

    for (const [pos, bucket] of byPos) {
      if (POS_ORDER.includes(pos)) continue;
      const subHtml = `<div class="dd-role-sub-grid">${bucket
        .sort(sortByBackNo)
        .map((p) => roleCard(p, side))
        .join("")}</div>`;
      sections.push(
        `<section class="dd-role-pos-group">` +
        `<h4 class="dd-role-pos-label">${escapeHtml(pos)}</h4>` +
        subHtml +
        `</section>`
      );
    }

    return sections.join("");
  }

  function roleCard(p, side) {
    const s = p.stat;
    const stats = [
      ["관여", `${s.touches}회`],
      ["패스", `${s.completed}/${s.passes}`],
      ["전진 패스", `${s.progressive}회`],
      ["키패스", `${s.keyPasses}회`],
      ["박스 터치", `${s.boxTouches}회`],
      ["수비 액션", `${s.defActions}회`],
    ];
    if (s.shots) stats.push(["슈팅", `${s.shots}회 · xG ${fmt(s.xg, 2)}`]);
    return (
      `<article class="dd-role dd-role-${side === "away" ? "away" : "home"}">` +
      `<div class="dd-role-top">` +
      `<span class="dd-role-no">${escapeHtml(String(p.backNo ?? "-"))}</span>` +
      `<div>` +
      `<div class="dd-role-name">${escapeHtml(p.name)}${p.captain ? " (C)" : ""}</div>` +
      `<div class="dd-role-label">${escapeHtml(p.role)}</div>` +
      `</div>` +
      `</div>` +
      `<div class="dd-role-pos">평균 위치 X ${fmt(p.x)} · Y ${fmt(p.y)}${
        p.outLabel ? ` · ${escapeHtml(p.outLabel)} 교체` : ""
      }</div>` +
      `<dl class="dd-role-stats">` +
      stats.map(([k, v]) => `<div><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`).join("") +
      `</dl>` +
      `</article>`
    );
  }

  function renderRoles(ctx) {
    const box = $("ddRoles");
    if (!box) return;
    const team = roleSide === "away" ? ctx.away : ctx.home;
    const list = team.players.filter((p) => p.stat.touches > 0);
    box.innerHTML = list.length
      ? groupRoleCards(list, roleSide)
      : `<p class="dd-empty">선발 라인업 데이터가 없어 역할 카드를 만들 수 없습니다.</p>`;
    box.setAttribute("data-side", roleSide);

    document.querySelectorAll("[data-dd-team]").forEach((btn) => {
      const on = btn.getAttribute("data-dd-team") === roleSide;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });

    const caption = $("ddRolesCaption");
    if (caption) {
      const name = roleSide === "away" ? ctx.awayName : ctx.homeName;
      caption.innerHTML = `<strong>${escapeHtml(name)}</strong> 선수 ${list.length}명을 보고 있습니다.`;
      caption.className = `dd-roles-caption dd-side-${roleSide}`;
    }
  }

  function bindRoleTabs(ctx) {
    document.querySelectorAll("[data-dd-team]").forEach((btn) => {
      if (btn._ddBound) return;
      btn._ddBound = true;
      btn.addEventListener("click", () => {
        roleSide = btn.getAttribute("data-dd-team") === "away" ? "away" : "home";
        if (currentCtx) renderRoles(currentCtx);
      });
    });
    const homeBtn = document.querySelector('[data-dd-team="home"]');
    const awayBtn = document.querySelector('[data-dd-team="away"]');
    if (homeBtn) {
      homeBtn.innerHTML =
        emblemHtml(ctx.meta?.home?.team_id, ctx.homeName) +
        `<span>${escapeHtml(ctx.homeName)}</span>`;
    }
    if (awayBtn) {
      awayBtn.innerHTML =
        emblemHtml(ctx.meta?.away?.team_id, ctx.awayName) +
        `<span>${escapeHtml(ctx.awayName)}</span>`;
    }
  }

  /* ------------------------------------------------------------------ *
   * Entry point
   * ------------------------------------------------------------------ */

  function redrawCanvases() {
    if (!currentCtx) return;
    drawShape("ddHomeShape", currentCtx.home, pal("home").pitch, currentCtx.homeName);
    drawShape("ddAwayShape", currentCtx.away, pal("away").pitch, currentCtx.awayName);
    drawMomentum(currentCtx);
  }

  function render(meta, events, players, lineup) {
    const section = $("deepdive");
    if (!section) return null;
    let ctx;
    let chapters;
    try {
      ctx = Tactics.analyze(meta, events, players, lineup);
      chapters = Analyst.build(ctx).chapters;
    } catch (err) {
      console.error("[DeepView] analysis failed:", err);
      const box = $("ddChapters");
      if (box) {
        box.innerHTML = `<div class="dd-chapter"><p>심층 전술 분석을 만드는 중 오류가 발생했습니다: ${escapeHtml(
          err.message
        )}</p></div>`;
      }
      return null;
    }

    currentCtx = ctx;
    palette =
      typeof TeamColors !== "undefined" ? TeamColors.resolve(meta?.home, meta?.away) : FALLBACK;
    try {
      renderShapes(ctx);
      drawMomentum(ctx);
      renderZones(ctx);
      renderChapters(ctx, chapters);
      bindRoleTabs(ctx);
      renderRoles(ctx);
    } catch (err) {
      console.error("[DeepView] render failed:", err);
    }

    if (!resizeBound) {
      resizeBound = true;
      let timer = null;
      window.addEventListener("resize", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(redrawCanvases, 180);
      });
    }

    return ctx;
  }

  return { render };
})();

window.DeepView = DeepView;
