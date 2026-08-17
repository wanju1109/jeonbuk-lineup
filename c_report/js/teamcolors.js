/*
 * Club colour palette.
 *
 * Every base colour below was sampled from that club's own emblem on the
 * K LEAGUE portal (dominant saturated pixel cluster), so the report matches
 * the colours fans already associate with each badge instead of a generic
 * home/away scheme. Where a badge is mostly a dark shield, the identity colour
 * is used rather than the literal dominant pixel — 제주 reads as orange and
 * 안양 as purple on the portal even though navy covers more area.
 *
 * Derived variants are computed at runtime rather than stored:
 *   base  - darkened until it is legible as text on the light page background
 *   pitch - lightened until it is legible on the green pitch canvas
 *   on    - black or white, whichever is readable on top of `base`
 */

const TeamColors = (() => {
  const BRAND = {
    K01: { name: "울산", color: "#014291" },
    K03: { name: "포항", color: "#E4453A" },
    K04: { name: "제주", color: "#ED7402" },
    K05: { name: "전북", color: "#037340" },
    K09: { name: "서울", color: "#D9000F" },
    K10: { name: "대전", color: "#092E6E" },
    K18: { name: "인천", color: "#0A70BF" },
    K21: { name: "강원", color: "#01605C" },
    K22: { name: "광주", color: "#C70026" },
    K26: { name: "부천", color: "#BA1E1B" },
    K27: { name: "안양", color: "#521E89" },
    K35: { name: "김천", color: "#002749" },
  };

  const LIGHT_BG = { r: 250, g: 252, b: 250 };
  const PITCH_BG = { r: 27, g: 122, b: 76 };

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function parseHex(hex) {
    const s = String(hex || "").trim().replace("#", "");
    const full =
      s.length === 3
        ? s
            .split("")
            .map((c) => c + c)
            .join("")
        : s;
    if (!/^[0-9a-fA-F]{6}$/.test(full)) return { r: 0, g: 0, b: 0 };
    return {
      r: parseInt(full.slice(0, 2), 16),
      g: parseInt(full.slice(2, 4), 16),
      b: parseInt(full.slice(4, 6), 16),
    };
  }

  function toHex(rgb) {
    const part = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0");
    return `#${part(rgb.r)}${part(rgb.g)}${part(rgb.b)}`;
  }

  function mix(a, b, t) {
    const x = typeof a === "string" ? parseHex(a) : a;
    const y = typeof b === "string" ? parseHex(b) : b;
    return {
      r: x.r + (y.r - x.r) * t,
      g: x.g + (y.g - x.g) * t,
      b: x.b + (y.b - x.b) * t,
    };
  }

  function luminance(color) {
    const rgb = typeof color === "string" ? parseHex(color) : color;
    const ch = (v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * ch(rgb.r) + 0.7152 * ch(rgb.g) + 0.0722 * ch(rgb.b);
  }

  function contrast(a, b) {
    const la = luminance(a);
    const lb = luminance(b);
    const hi = Math.max(la, lb);
    const lo = Math.min(la, lb);
    return (hi + 0.05) / (lo + 0.05);
  }

  function hueOf(color) {
    const rgb = typeof color === "string" ? parseHex(color) : color;
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return 0;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    return h < 0 ? h + 360 : h;
  }

  function hueGap(a, b) {
    const d = Math.abs(hueOf(a) - hueOf(b)) % 360;
    return d > 180 ? 360 - d : d;
  }

  /* Darken toward black until the colour holds up as text on the page. */
  function readable(hex, minContrast = 3.4) {
    let current = parseHex(hex);
    for (let i = 0; i < 24 && contrast(current, LIGHT_BG) < minContrast; i += 1) {
      current = mix(current, { r: 0, g: 0, b: 0 }, 0.08);
    }
    return toHex(current);
  }

  function toHsl(color) {
    const rgb = typeof color === "string" ? parseHex(color) : color;
    const r = rgb.r / 255;
    const g = rgb.g / 255;
    const b = rgb.b / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    return { h: hueOf(rgb), s, l };
  }

  function fromHsl(h, s, l) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = (((h % 360) + 360) % 360) / 60;
    const x = c * (1 - Math.abs((hp % 2) - 1));
    let rgb;
    if (hp < 1) rgb = [c, x, 0];
    else if (hp < 2) rgb = [x, c, 0];
    else if (hp < 3) rgb = [0, c, x];
    else if (hp < 4) rgb = [0, x, c];
    else if (hp < 5) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    const m = l - c / 2;
    return { r: (rgb[0] + m) * 255, g: (rgb[1] + m) * 255, b: (rgb[2] + m) * 255 };
  }

  /*
   * Pitch variant: raise lightness until the colour separates from the green
   * turf, but hold saturation up so the club hue still reads. Mixing toward
   * white instead would wash every club into the same pastel grey.
   */
  function forPitch(hex, minContrast = 2.4) {
    const hsl = toHsl(hex);
    const sat = Math.max(hsl.s, 0.66);
    let l = Math.max(hsl.l, 0.58);
    let out = fromHsl(hsl.h, sat, l);
    /* Cap the lift: red hues would otherwise wash out to pink before they
       ever reach the same contrast a blue hits early. */
    while (l < 0.76 && contrast(out, PITCH_BG) < minContrast) {
      l += 0.02;
      out = fromHsl(hsl.h, sat, l);
    }
    return toHex(out);
  }

  function onColor(hex) {
    return contrast(hex, { r: 255, g: 255, b: 255 }) >= 3.6 ? "#ffffff" : "#10231c";
  }

  function rgbString(hex) {
    const c = parseHex(hex);
    return `${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}`;
  }

  function rgba(hex, alpha) {
    return `rgba(${rgbString(hex)}, ${alpha})`;
  }

  /* Stable colour for a club that is not in the table yet. */
  function fallback(teamId, teamName) {
    const seed = String(teamId || teamName || "team");
    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    const hue = hash % 360;
    const c = 0.42;
    const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
    const m = 0.22;
    let rgb;
    if (hue < 60) rgb = [c, x, 0];
    else if (hue < 120) rgb = [x, c, 0];
    else if (hue < 180) rgb = [0, c, x];
    else if (hue < 240) rgb = [0, x, c];
    else if (hue < 300) rgb = [x, 0, c];
    else rgb = [c, 0, x];
    return toHex({
      r: (rgb[0] + m) * 255,
      g: (rgb[1] + m) * 255,
      b: (rgb[2] + m) * 255,
    });
  }

  function brandOf(team) {
    if (!team) return fallback("", "");
    const byId = BRAND[String(team.team_id || "").toUpperCase()];
    if (byId) return byId.color;
    const name = String(team.name || "").trim();
    const byName = Object.values(BRAND).find((b) => b.name === name);
    if (byName) return byName.color;
    return fallback(team.team_id, name);
  }

  /*
   * Two clubs can share a hue family (전북 green vs 강원 teal, for example).
   * Nudging the away hue apart keeps both colours dark and saturated, whereas
   * pulling them apart by lightness would either wash the away club out or
   * break its legibility as text.
   */
  const MIN_HUE_GAP = 48;

  function separate(homeHex, awayHex) {
    if (hueGap(homeHex, awayHex) >= MIN_HUE_GAP) return awayHex;
    const hsl = toHsl(awayHex);
    if (hsl.s < 0.15) return awayHex;
    const homeHue = hueOf(homeHex);
    const signed = (((hsl.h - homeHue + 540) % 360) - 180) || 1;
    const dir = signed >= 0 ? 1 : -1;
    return toHex(fromHsl(homeHue + dir * MIN_HUE_GAP, hsl.s, hsl.l));
  }

  function paletteFor(brandHex) {
    const base = readable(brandHex);
    return {
      brand: brandHex,
      base,
      on: onColor(base),
      pitch: forPitch(brandHex),
      rgb: rgbString(base),
      soft: rgba(base, 0.14),
    };
  }

  function resolve(homeTeam, awayTeam) {
    const homeBrand = brandOf(homeTeam);
    const awayBrand = separate(homeBrand, brandOf(awayTeam));
    return {
      home: paletteFor(homeBrand),
      away: paletteFor(awayBrand),
    };
  }

  /* Publish the palette as CSS custom properties so existing var(--home) /
   * var(--away) rules pick up the club colours without further edits. */
  function apply(homeTeam, awayTeam, target) {
    const palette = resolve(homeTeam, awayTeam);
    const root = (target || document.documentElement).style;
    for (const side of ["home", "away"]) {
      const p = palette[side];
      root.setProperty(`--${side}`, p.base);
      root.setProperty(`--${side}-on`, p.on);
      root.setProperty(`--${side}-rgb`, p.rgb);
      root.setProperty(`--${side}-soft`, p.soft);
      root.setProperty(`--${side}-pitch`, p.pitch);
    }
    return palette;
  }

  return {
    BRAND,
    apply,
    resolve,
    paletteFor,
    brandOf,
    rgba,
    rgbString,
    readable,
    forPitch,
    onColor,
    contrast,
  };
})();

window.TeamColors = TeamColors;
