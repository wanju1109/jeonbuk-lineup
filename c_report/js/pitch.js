/* Pitch drawing + heatmap helpers for CHALK BOARD coordinates (0-100). */

const Pitch = (() => {
  function normalizePoint(event, homeTeamId) {
    const x0 = Number(event.START_POINT_X);
    const y0 = Number(event.START_POINT_Y);
    const x1 = Number(event.END_POINT_X);
    const y1 = Number(event.END_POINT_Y);
    const period = Number(event.PERIOD_ID || 1);
    const isHome = event.TEAM_ID === homeTeamId;

    /*
     * Raw pitch: period 1 home attacks high-X, period 2 sides flip.
     * Normalize so home always attacks to the right.
     */
    const flip = period === 2;
    const mapX = (x) => (flip ? 100 - x : x);
    const mapY = (y) => (flip ? 100 - y : y);

    return {
      x: mapX(x0),
      y: mapY(y0),
      ex: Number.isFinite(x1) ? mapX(x1) : null,
      ey: Number.isFinite(y1) ? mapY(y1) : null,
      isHome,
      period,
      event,
    };
  }

  function drawField(ctx, w, h, theme) {
    ctx.clearRect(0, 0, w, h);
    if (theme === "board") {
      /* Dark board: heat blobs need a near-black ground, not turf green. */
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#161a18");
      g.addColorStop(1, "#0b0e0c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = 0.04;
      for (let i = 0; i < 12; i += 1) {
        ctx.fillStyle = i % 2 ? "#fff" : "#000";
        ctx.fillRect((w / 12) * i, 0, w / 12, h);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
    } else {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "#1b945c");
      g.addColorStop(1, "#0f5f3c");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      ctx.save();
      ctx.globalAlpha = 0.08;
      for (let i = 0; i < 12; i += 1) {
        ctx.fillStyle = i % 2 ? "#fff" : "#000";
        ctx.fillRect((w / 12) * i, 0, w / 12, h);
      }
      ctx.restore();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
    }

    ctx.lineWidth = Math.max(2, w * 0.004);
    const pad = w * 0.03;
    const pw = w - pad * 2;
    const ph = h - pad * 2;

    ctx.strokeRect(pad, pad, pw, ph);
    ctx.beginPath();
    ctx.moveTo(w / 2, pad);
    ctx.lineTo(w / 2, h - pad);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(w / 2, h / 2, Math.min(pw, ph) * 0.12, 0, Math.PI * 2);
    ctx.stroke();

    const boxW = pw * 0.165;
    const boxH = ph * 0.52;
    const sixW = pw * 0.06;
    const sixH = ph * 0.28;
    ctx.strokeRect(pad, h / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(w - pad - boxW, h / 2 - boxH / 2, boxW, boxH);
    ctx.strokeRect(pad, h / 2 - sixH / 2, sixW, sixH);
    ctx.strokeRect(w - pad - sixW, h / 2 - sixH / 2, sixW, sixH);

    return { pad, pw, ph };
  }

  function toCanvas(nx, ny, geom, w, h) {
    const x = geom.pad + (nx / 100) * geom.pw;
    const y = geom.pad + (ny / 100) * geom.ph;
    return { x, y };
  }

  function drawHeat(ctx, points, geom, w, h, color) {
    const r = Math.max(22, w * 0.055);
    const core = Math.max(2.6, w * 0.005);
    for (const p of points) {
      const c = toCanvas(p.x, p.y, geom, w, h);
      const grd = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, r);
      grd.addColorStop(0, color);
      grd.addColorStop(0.38, color);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.arc(c.x, c.y, core, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawArrows(ctx, segments, geom, w, h, stroke, fill) {
    ctx.lineWidth = Math.max(1.5, w * 0.003);
    for (const s of segments) {
      if (s.ex == null || s.ey == null) continue;
      const a = toCanvas(s.x, s.y, geom, w, h);
      const b = toCanvas(s.ex, s.ey, geom, w, h);
      ctx.strokeStyle = stroke;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();

      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(a.x, a.y, Math.max(3, w * 0.006), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  /* sign: 1 points right, -1 points left. */
  function drawArrowGlyph(ctx, x, cy, len, sign, color) {
    const head = len * 0.5;
    const tipX = sign > 0 ? x + len : x;
    const tailX = sign > 0 ? x : x + len;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.4, len * 0.14);
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(tailX, cy);
    ctx.lineTo(tipX - sign * head * 0.6, cy);
    ctx.stroke();

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tipX, cy);
    ctx.lineTo(tipX - sign * head, cy - head * 0.6);
    ctx.lineTo(tipX - sign * head, cy + head * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  function drawChevron(ctx, cx, cy, sign, size, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + sign * size, cy);
    ctx.lineTo(cx - sign * size * 0.55, cy - size * 0.78);
    ctx.lineTo(cx - sign * size * 0.18, cy);
    ctx.lineTo(cx - sign * size * 0.55, cy + size * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  /* Three stacked chevrons near the attacking goal, readable over the turf. */
  function drawEndChevrons(ctx, x, cy, sign, size, color) {
    drawChevron(ctx, x - sign * size * 2.05, cy, sign, size, color, 0.22);
    drawChevron(ctx, x - sign * size * 1.05, cy, sign, size, color, 0.34);
    drawChevron(ctx, x, cy, sign, size, color, 0.5);
  }

  /*
   * Attack-direction marks. Coordinates are normalised so the home side always
   * plays towards +x; these arrows make that orientation obvious on every pitch.
   */
  function drawDirection(ctx, geom, w, h, direction) {
    if (!direction) return;
    const cy = geom.pad + geom.ph * 0.5;
    const size = Math.max(11, w * 0.022);
    const rightColor = (direction.right && direction.right.color) || "rgba(255,255,255,0.92)";
    const leftColor = (direction.left && direction.left.color) || "rgba(255,255,255,0.92)";

    if (direction.right) {
      drawEndChevrons(ctx, w - geom.pad - geom.pw * 0.045, cy, 1, size, rightColor);
    }
    if (direction.left) {
      drawEndChevrons(ctx, geom.pad + geom.pw * 0.045, cy, -1, size, leftColor);
    }

    const fs = Math.max(11, w * 0.018);
    const padX = fs * 0.8;
    const padY = fs * 0.48;
    const arrow = fs * 1.45;
    const gap = fs * 0.45;
    const boxH = fs + padY * 2;
    const by = h - geom.pad - boxH / 2 - fs * 0.28;

    const badge = (entry, dir) => {
      if (!entry || !entry.label) return;
      ctx.font = `700 ${fs}px IBM Plex Sans KR, sans-serif`;
      const textW = ctx.measureText(entry.label).width;
      const boxW = padX * 2 + textW + gap + arrow;
      const x = dir === "right" ? w - geom.pad - fs * 0.45 - boxW : geom.pad + fs * 0.45;

      ctx.fillStyle = "rgba(5, 22, 16, 0.62)";
      roundRect(ctx, x, by - boxH / 2, boxW, boxH, boxH / 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.28)";
      ctx.lineWidth = 1;
      roundRect(ctx, x, by - boxH / 2, boxW, boxH, boxH / 2);
      ctx.stroke();

      const color = entry.color || "rgba(255,255,255,0.95)";
      ctx.fillStyle = color;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      if (dir === "right") {
        ctx.fillText(entry.label, x + padX, by);
        drawArrowGlyph(ctx, x + padX + textW + gap, by, arrow, 1, color);
      } else {
        drawArrowGlyph(ctx, x + padX, by, arrow, -1, color);
        ctx.fillText(entry.label, x + padX + arrow + gap, by);
      }
    };

    badge(direction.left, "left");
    badge(direction.right, "right");
  }

  function drawShots(ctx, shots, geom, w, h, homeTeamId, colors) {
    const homeFill = (colors && colors.home) || "#d6f56a";
    const awayFill = (colors && colors.away) || "#e4572e";
    for (const s of shots) {
      const p = normalizePoint(s, homeTeamId);
      const c = toCanvas(p.x, p.y, geom, w, h);
      const isGoal = s.TYPE_DETAIL_CD === "GL";
      const xg = Number(s.EXPECTED_GOAL || 0);
      const r = Math.max(5, 5 + xg * 18);
      ctx.beginPath();
      ctx.fillStyle = isGoal ? "#f2c14e" : p.isHome ? homeFill : awayFill;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  /*
   * Average-position map with inferred pass combinations.
   * Nodes arrive in the team's own attacking frame (always attacking +x),
   * so this canvas can be drawn identically for either side.
   */
  function drawNetwork(ctx, nodes, edges, geom, w, h, opts) {
    const active = (nodes || []).filter((n) => n.touches > 0);
    if (!active.length) return [];
    const byId = new Map(active.map((n) => [n.playerId, n]));
    const maxTouch = Math.max(...active.map((n) => n.touches), 1);
    const maxEdge = Math.max(...(edges || []).map((e) => e.count), 1);
    const accent = opts.accent || "#d6f56a";
    const ink = opts.ink || "#0a2218";

    for (const edge of edges || []) {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) continue;
      const pa = toCanvas(a.x, a.y, geom, w, h);
      const pb = toCanvas(b.x, b.y, geom, w, h);
      const weight = edge.count / maxEdge;
      ctx.strokeStyle = `rgba(255,255,255,${0.18 + weight * 0.55})`;
      ctx.lineWidth = Math.max(1, w * 0.0016 + weight * w * 0.0055);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }

    const hits = [];
    const baseFont = Math.max(9, w * 0.016);
    for (const n of active) {
      const c = toCanvas(n.x, n.y, geom, w, h);
      const r = Math.max(w * 0.013, w * 0.013 + (n.touches / maxTouch) * w * 0.017);

      ctx.beginPath();
      ctx.fillStyle = accent;
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = Math.max(1.5, w * 0.0026);
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = ink;
      ctx.font = `700 ${baseFont}px IBM Plex Sans KR, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String(n.backNo ?? ""), c.x, c.y);

      ctx.fillStyle = "rgba(255,255,255,0.92)";
      ctx.font = `600 ${Math.max(8, w * 0.0135)}px IBM Plex Sans KR, sans-serif`;
      ctx.textBaseline = "top";
      ctx.fillText(String(n.name || ""), c.x, c.y + r + 3);

      hits.push({
        x: c.x,
        y: c.y,
        label: `#${n.backNo ?? "-"} ${n.name || ""}`,
        detail: `${n.role || n.position || ""} · 관여 ${n.touches}회 · 평균 X ${n.x} / Y ${n.y}`,
      });
    }
    return hits;
  }

  function buildHits(points, geom, w, h) {
    return (points || []).map((p) => {
      const c = toCanvas(p.x, p.y, geom, w, h);
      return {
        x: c.x,
        y: c.y,
        label: p.label || "",
        detail: p.detail || "",
      };
    });
  }

  function ensureTooltip(wrap) {
    let tip = wrap.querySelector(".pitch-tooltip");
    if (!tip) {
      tip = document.createElement("div");
      tip.className = "pitch-tooltip";
      tip.hidden = true;
      wrap.appendChild(tip);
    }
    return tip;
  }

  function bindHover(canvas, hits) {
    const wrap = canvas.parentElement;
    if (!wrap) return;
    wrap.style.position = wrap.style.position || "relative";
    const tip = ensureTooltip(wrap);
    const radius = Math.max(14, (canvas.clientWidth || 720) * 0.025);

    const onMove = (ev) => {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left;
      const y = ev.clientY - rect.top;
      let best = null;
      let bestDist = radius;
      for (const hit of hits || []) {
        const dx = hit.x - x;
        const dy = hit.y - y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d <= bestDist) {
          bestDist = d;
          best = hit;
        }
      }
      if (!best) {
        tip.hidden = true;
        canvas.style.cursor = "default";
        return;
      }
      tip.hidden = false;
      tip.innerHTML = `<strong>${best.label}</strong>${best.detail ? `<span>${best.detail}</span>` : ""}`;
      const left = Math.min(rect.width - 12, Math.max(12, best.x));
      const top = Math.max(12, best.y - 18);
      tip.style.left = `${left}px`;
      tip.style.top = `${top}px`;
      canvas.style.cursor = "pointer";
    };

    const onLeave = () => {
      tip.hidden = true;
      canvas.style.cursor = "default";
    };

    if (canvas._pitchHoverMove) {
      canvas.removeEventListener("mousemove", canvas._pitchHoverMove);
      canvas.removeEventListener("mouseleave", canvas._pitchHoverLeave);
    }
    canvas._pitchHoverMove = onMove;
    canvas._pitchHoverLeave = onLeave;
    canvas.addEventListener("mousemove", onMove);
    canvas.addEventListener("mouseleave", onLeave);
  }

  function render(canvas, opts) {
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 720;
    const cssH = Math.round(cssW * 0.66);
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const theme = opts.theme || (opts.mode === "heat" ? "board" : "turf");
    const geom = drawField(ctx, cssW, cssH, theme);
    const homeTeamId = opts.homeTeamId;
    let hits = [];

    if (opts.mode === "heat" && opts.points?.length) {
      drawHeat(ctx, opts.points, geom, cssW, cssH, opts.heatColor || "rgba(214,245,106,0.35)");
      drawArrows(
        ctx,
        opts.points.filter((p) => p.ex != null),
        geom,
        cssW,
        cssH,
        "rgba(255,255,255,0.55)",
        "#fff"
      );
      hits = buildHits(opts.points, geom, cssW, cssH);
      if (opts.hover) bindHover(canvas, hits);
    }

    if (opts.mode === "shots" && opts.shots?.length) {
      drawShots(ctx, opts.shots, geom, cssW, cssH, homeTeamId, {
        home: opts.homeColor,
        away: opts.awayColor,
      });
    }

    if (opts.mode === "shape" && opts.nodes?.length) {
      hits = drawNetwork(ctx, opts.nodes, opts.edges, geom, cssW, cssH, {
        accent: opts.accent,
        ink: opts.ink,
      });
      if (opts.hover) bindHover(canvas, hits);
    }

    if (opts.mode === "sequence" && opts.points?.length) {
      const accent = opts.accent || "#d6f56a";
      drawArrows(ctx, opts.points, geom, cssW, cssH, accent, "#fff");
      opts.points.forEach((p, i) => {
        const c = toCanvas(p.x, p.y, geom, cssW, cssH);
        ctx.fillStyle = "#10231c";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = accent;
        ctx.font = `700 ${Math.max(10, cssW * 0.018)}px IBM Plex Sans KR`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), c.x, c.y);
      });
      hits = buildHits(opts.points, geom, cssW, cssH);
      if (opts.hover) bindHover(canvas, hits);
    }

    drawDirection(
      ctx,
      geom,
      cssW,
      cssH,
      opts.direction || { right: { label: "공격", color: "rgba(255,255,255,0.92)" } }
    );

    return { width: cssW, height: cssH, hits };
  }

  return { normalizePoint, render };
})();

window.Pitch = Pitch;
