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
    };
  }

  function drawField(ctx, w, h) {
    ctx.clearRect(0, 0, w, h);
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, "#1b945c");
    g.addColorStop(1, "#0f5f3c");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Stripe atmosphere
    ctx.save();
    ctx.globalAlpha = 0.08;
    for (let i = 0; i < 12; i += 1) {
      ctx.fillStyle = i % 2 ? "#fff" : "#000";
      ctx.fillRect((w / 12) * i, 0, w / 12, h);
    }
    ctx.restore();

    ctx.strokeStyle = "rgba(255,255,255,0.7)";
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
    // nx: 0-100 along attack axis (home right), ny: 0-100 touchline
    const x = geom.pad + (nx / 100) * geom.pw;
    const y = geom.pad + (ny / 100) * geom.ph;
    return { x, y };
  }

  function drawHeat(ctx, points, geom, w, h, color) {
    for (const p of points) {
      const c = toCanvas(p.x, p.y, geom, w, h);
      const grd = ctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, Math.max(18, w * 0.045));
      grd.addColorStop(0, color);
      grd.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(18, w * 0.045), 0, Math.PI * 2);
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

  function drawShots(ctx, shots, geom, w, h, homeTeamId) {
    for (const s of shots) {
      const p = normalizePoint(s, homeTeamId);
      const c = toCanvas(p.x, p.y, geom, w, h);
      const isGoal = s.TYPE_DETAIL_CD === "GL";
      const xg = Number(s.EXPECTED_GOAL || 0);
      const r = Math.max(5, 5 + xg * 18);
      ctx.beginPath();
      ctx.fillStyle = isGoal ? "#f2c14e" : p.isHome ? "rgba(214,245,106,0.9)" : "rgba(228,87,46,0.9)";
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.lineWidth = 1;
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
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

    const geom = drawField(ctx, cssW, cssH);
    const homeTeamId = opts.homeTeamId;

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
    }

    if (opts.mode === "shots" && opts.shots?.length) {
      drawShots(ctx, opts.shots, geom, cssW, cssH, homeTeamId);
    }

    if (opts.mode === "sequence" && opts.points?.length) {
      drawArrows(ctx, opts.points, geom, cssW, cssH, "#d6f56a", "#fff");
      opts.points.forEach((p, i) => {
        const c = toCanvas(p.x, p.y, geom, cssW, cssH);
        ctx.fillStyle = "#10231c";
        ctx.beginPath();
        ctx.arc(c.x, c.y, 10, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#d6f56a";
        ctx.font = `700 ${Math.max(10, cssW * 0.018)}px IBM Plex Sans KR`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String(i + 1), c.x, c.y);
      });
    }

    return { width: cssW, height: cssH };
  }

  return { normalizePoint, render };
})();

window.Pitch = Pitch;
