/* 전주성 조간 뷰어: issues/{no}.json 을 읽어 신문 면을 그린다.
   PC(>760px)는 면 탭으로 한 면씩, 모바일은 모든 면을 이어 붙여 읽는다. */
(function () {
  "use strict";
  const NS = "http://www.w3.org/2000/svg";
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  const WD = "일월화수목금토";

  let ISSUE = null, LIB = {};
  // ?embed=1: 에버그린 게시글 iframe용. 탭 없이 모든 면을 이어 붙이고, 높이를 잴 수 있게 다 그린 뒤 data-ready를 단다.
  const EMBED = new URLSearchParams(location.search).get("embed") === "1";
  if (EMBED) document.documentElement.classList.add("embed");

  /* ---------- 이미지 ---------- */
  function asset(key) {
    if (!key) return null;
    return (ISSUE.assets && ISSUE.assets[key]) || LIB[key] || null;
  }
  function imgTag(a, extra) {
    return `<img src="${esc(a.src)}" alt="${esc(a.alt || "")}" loading="${EMBED ? "eager" : "lazy"}" ${extra || ""}>`;
  }
  function credit(a, caption) {
    const parts = [caption, a && a.credit].filter(Boolean).map(esc);
    return parts.length ? `<p class="cap">${parts.join(" · ")}</p>` : "";
  }

  /* ---------- SVG 도우미 ---------- */
  function el(tag, attrs, parent, text) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (text != null) e.textContent = text;
    if (parent) parent.appendChild(e);
    return e;
  }
  function svg(host, w, h, label) {
    const s = el("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", role: "img", "aria-label": label });
    host.appendChild(s);
    return s;
  }
  const col = (ha) => (ha === "H" ? "var(--green)" : "var(--away)");

  /* ---------- 차트 ---------- */
  const CHARTS = {
    standings(host) {
      const t = (ISSUE.data && ISSUE.data.standings) || [];
      if (!t.length) return false;
      const hi = new Set(["전북"].concat(ISSUE.data.next ? [ISSUE.data.next.opp_short] : []));
      const W = 640, rowH = 28, top = 6, left = 78, right = 44, H = top + t.length * rowH + 24;
      const s = svg(host, W, H, "K리그1 순위");
      const max = Math.ceil((Math.max(...t.map((r) => r.pts)) + 4) / 10) * 10, x = (v) => left + ((W - left - right) * v) / max;
      for (let v = 0; v <= max; v += 10) {
        el("line", { x1: x(v), x2: x(v), y1: top, y2: H - 22, stroke: "var(--rule)" }, s);
        el("text", { x: x(v), y: H - 6, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, s, v);
      }
      const left_games = ISSUE.data.games_left_to_split || 0;
      t.forEach((r, i) => {
        const y = top + i * rowH, me = r.short === "전북", h = hi.has(r.short);
        if (left_games) el("rect", { x: x(0), y: y + 5, width: x(r.pts + 3 * left_games) - x(0), height: rowH - 10, fill: "var(--rule)" }, s);
        el("rect", { x: x(0), y: y + 5, width: x(r.pts) - x(0), height: rowH - 10, fill: me ? "var(--green)" : h ? "var(--away)" : "var(--muted)", opacity: h ? 1 : 0.5 }, s);
        el("text", { x: left - 8, y: y + rowH / 2 + 5, "text-anchor": "end", "font-size": 14, "font-weight": h ? 700 : 400, fill: "var(--ink)" }, s, `${r.rank}. ${r.short}`);
        el("text", { x: x(r.pts + 3 * left_games) + 6, y: y + rowH / 2 + 5, "font-size": 13, "font-weight": 600, fill: "var(--ink)", "font-family": "var(--f-data)" }, s, r.pts);
        if (r.rank === 6) el("line", { x1: 4, x2: W - 4, y1: y + rowH, y2: y + rowH, stroke: "var(--green)", "stroke-width": 2, "stroke-dasharray": "6 5" }, s);
      });
      return true;
    },
    goal_timeline(host) {
      const m = ISSUE.data && ISSUE.data.last;
      if (!m || !m.shots) return false;
      const W = 560, H = 220, L = 24, R = 16, mid = 110, x = (v) => L + ((W - L - R) * Math.min(v, 96)) / 96;
      const s = svg(host, W, H, "득점 타임라인과 15분 구간별 슈팅");
      const binOf = (p, mm) => (p === 1 ? Math.min(2, Math.floor(mm / 15)) : Math.min(5, 3 + Math.floor(Math.max(0, mm - 45) / 15)));
      const cnt = { H: [0, 0, 0, 0, 0, 0], A: [0, 0, 0, 0, 0, 0] };
      m.shots.forEach((r) => cnt[r[0]][binOf(r[1], r[2])]++);
      [[0, 15], [15, 30], [30, 45], [45, 60], [60, 75], [75, 90]].forEach(([a, b], i) => {
        const bx = x(a) + 4, bw = x(b) - x(a) - 8;
        el("rect", { x: bx, y: mid - cnt.H[i] * 13, width: bw, height: cnt.H[i] * 13, fill: "var(--green)", opacity: 0.28 }, s);
        el("rect", { x: bx, y: mid, width: bw, height: cnt.A[i] * 13, fill: "var(--away)", opacity: 0.28 }, s);
        if (cnt.H[i]) el("text", { x: bx + bw / 2, y: mid - cnt.H[i] * 13 - 4, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, s, cnt.H[i]);
        if (cnt.A[i]) el("text", { x: bx + bw / 2, y: mid + cnt.A[i] * 13 + 13, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, s, cnt.A[i]);
      });
      el("line", { x1: L, x2: W - R, y1: mid, y2: mid, stroke: "var(--ink)", "stroke-width": 2 }, s);
      el("line", { x1: x(45), x2: x(45), y1: 16, y2: H - 20, stroke: "var(--rule)", "stroke-dasharray": "3 3" }, s);
      [0, 15, 30, 45, 60, 75, 90].forEach((v) => el("text", { x: x(v), y: H - 4, "text-anchor": "middle", "font-size": 11, fill: "var(--muted)" }, s, v + "'"));
      (m.goals || []).forEach((g) => {
        const up = g.side === "H", gx = x(g.minute), gy = up ? mid - 76 : mid + 76;
        el("line", { x1: gx, x2: gx, y1: mid, y2: gy, stroke: col(g.side), "stroke-width": 1.5 }, s);
        el("circle", { cx: gx, cy: gy, r: 7, fill: col(g.side) }, s);
        el("text", { x: gx, y: up ? gy - 12 : gy + 21, "text-anchor": gx > W - 80 ? "end" : gx < 60 ? "start" : "middle", "font-size": 12, "font-weight": 700, fill: "var(--ink)" }, s, g.player + (g.pk ? " PK" : "") + (g.og ? " (자책)" : ""));
      });
      host.insertAdjacentHTML("beforeend", `<p class="cap">위쪽 초록은 ${esc(m.home)}, 아래쪽 주황은 ${esc(m.away)}. 막대는 15분 구간별 슈팅 수.</p>`);
      return true;
    },
    shotmap(host) {
      const m = ISSUE.data && ISSUE.data.last;
      if (!m || !m.shots) return false;
      const W = 640, H = 330, s = svg(host, W, H, "양 팀 슈팅 위치");
      const panel = (ox, label, ha) => {
        const pw = 300, ph = 280, oy = 34, X = (v) => ox + ((v - 50) / 50) * pw, Y = (v) => oy + (v / 100) * ph;
        el("text", { x: ox, y: 20, "font-size": 15, "font-weight": 700, fill: col(ha) }, s, label);
        const g = { stroke: "var(--muted)", "stroke-opacity": 0.6, "stroke-width": 1.5, fill: "none" };
        el("rect", { x: ox, y: oy, width: pw, height: ph, fill: "var(--paper)", stroke: "var(--rule)" }, s);
        el("rect", { x: X(84.3), y: Y(20.4), width: X(100) - X(84.3), height: Y(79.6) - Y(20.4), ...g }, s);
        el("rect", { x: X(94.8), y: Y(36.8), width: X(100) - X(94.8), height: Y(63.2) - Y(36.8), ...g }, s);
        el("line", { x1: X(100), x2: X(100), y1: Y(44.6), y2: Y(55.4), stroke: "var(--ink)", "stroke-width": 4 }, s);
        el("circle", { cx: X(89.5), cy: Y(50), r: 2, fill: "var(--muted)" }, s);
        const mine = m.shots.filter((r) => r[0] === ha);
        mine.forEach((r) => {
          const cx = X(Math.max(50, r[4])), cy = Y(r[5]), t = r[3], c = col(ha);
          if (t === "GL") el("circle", { cx, cy, r: 11, fill: c, stroke: "var(--sheet)", "stroke-width": 2 }, s);
          else if (t === "AST") el("circle", { cx, cy, r: 6.5, fill: c }, s);
          else if (t === "MST") el("circle", { cx, cy, r: 6, fill: "var(--sheet)", stroke: c, "stroke-width": 2.2 }, s);
          else { const d = 5; el("path", { d: `M${cx - d} ${cy - d}L${cx + d} ${cy + d}M${cx + d} ${cy - d}L${cx - d} ${cy + d}`, stroke: c, "stroke-width": 2.5 }, s); }
        });
        el("text", { x: ox + pw, y: 20, "text-anchor": "end", "font-size": 12, fill: "var(--muted)" }, s, `슈팅 ${mine.length} · 유효 ${mine.filter((r) => r[3] === "GL" || r[3] === "AST").length}`);
      };
      panel(10, m.home, "H");
      panel(330, m.away, "A");
      host.insertAdjacentHTML("beforeend", `<div class="legend"><span><i style="background:var(--green)"></i>${esc(m.home)}</span><span><i style="background:var(--away)"></i>${esc(m.away)}</span><span>큰 원 골 · 채운 원 유효 · 빈 원 빗나감 · × 막힘</span></div>`);
      return true;
    },
    compare(host) {
      const m = ISSUE.data && ISSUE.data.last;
      if (!m || !m.compare) return false;
      let h = `<div class="vs"><div class="row" style="font-weight:700;font-size:13px"><span>${esc(m.home)}</span><span></span><span style="text-align:right">${esc(m.away)}</span></div>`;
      m.compare.forEach(([l, a, b, fmt]) => {
        const t = a + b || 1, f = (v) => (fmt === "%" ? v.toFixed(1) + "%" : v);
        h += `<div class="lab">${esc(l)}</div><div class="row"><span class="v">${f(a)}</span><div class="bar"><i class="h" style="width:${(a / t) * 100}%"></i><i class="a" style="width:${(b / t) * 100}%"></i></div><span class="v r">${f(b)}</span></div>`;
      });
      host.insertAdjacentHTML("beforeend", h + `</div><p class="cap">K리그 데이터포털 부가기록.</p>`);
      return true;
    },
    form(host) {
      const f = ISSUE.data && ISSUE.data.form;
      if (!f || !f.length) return false;
      host.insertAdjacentHTML("beforeend", `<div class="form">${f.map((r) => `<span class="${esc(r.r)}" title="${esc(r.label)}">${{ W: "승", D: "무", L: "패" }[r.r] || ""}</span>`).join("")}</div><p class="cap">왼쪽이 오래된 경기. ${esc(ISSUE.data.form_note || "")}</p>`);
      return true;
    },
    scoreboard(host) {
      const m = ISSUE.data && ISSUE.data.last;
      if (!m) return false;
      const sc = (side) => (m.goals || []).filter((g) => g.side === side).map((g) => `${esc(g.player)} ${esc(g.label)}${g.pk ? " PK" : ""}${g.og ? " (자책)" : ""}`).join("<br>");
      host.insertAdjacentHTML("beforeend", `<div class="score"><div class="t">${esc(m.home)}<small>${sc("H")}</small></div><div class="n num">${m.score[0]}<i>:</i>${m.score[1]}</div><div class="t r">${esc(m.away)}<small>${sc("A")}</small></div></div>
        <div class="meta">${[m.comp, m.date_label, m.venue, m.attendance ? `관중 ${Number(m.attendance).toLocaleString("ko-KR")}명` : "", m.weather].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>`);
      return true;
    },
    next(host) {
      const n = ISSUE.data && ISSUE.data.next;
      if (!n) return false;
      host.insertAdjacentHTML("beforeend", `<div class="score" style="background:var(--ink)"><div class="t">${esc(n.home)}<small>${esc(n.home_note || "")}</small></div><div class="n" style="font-size:clamp(30px,5vw,44px)">VS</div><div class="t r">${esc(n.away)}<small>${esc(n.away_note || "")}</small></div></div>
        <div class="meta">${[n.comp, n.when_label, n.venue].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join("")}</div>`);
      return true;
    },
  };
  function bars(host, items, title) {
    const rows = (items || []).filter((i) => typeof i.value === "number");
    if (!rows.length) return;
    const max = Math.max(...rows.map((r) => r.value)) || 1, W = 520, L = 140, R = 80, H = 14 + rows.length * 44;
    const s = svg(host, W, H, title || "막대 그래프"), x = (v) => L + ((W - L - R) * v) / max;
    rows.forEach((r, i) => {
      const y = 10 + i * 44;
      el("text", { x: L - 10, y: y + 19, "text-anchor": "end", "font-size": 14, fill: "var(--ink)" }, s, r.label || "");
      el("rect", { x: L, y, width: Math.max(2, x(r.value) - L), height: 28, fill: r.state === "hot" ? "var(--warn)" : r.state === "green" ? "var(--green)" : "var(--muted)", opacity: r.state ? 1 : 0.6 }, s);
      el("text", { x: x(r.value) + 8, y: y + 19, "font-size": 14, "font-weight": 700, fill: "var(--ink)" }, s, r.text || r.value);
    });
  }

  /* ---------- 블록 ---------- */
  const TAGCLS = { 공식: "", 보도: "warn", 설: "away", 바람: "mute" };
  const paras = (b, cols) => {
    const ps = (b.paragraphs || []).map((p) => `<p>${esc(p)}</p>`).join("");
    return ps && cols ? `<div class="cols">${ps}</div>` : ps;
  };
  const headBits = (b, big) =>
    (b.kicker ? `<div class="kicker${b.variant === "green" ? " g" : ""}">${esc(b.kicker)}</div>` : "") +
    (b.title ? (big ? `<h2 class="head${b.variant === "lead" ? "" : " s"}">${esc(b.title)}</h2>` : `<h3>${esc(b.title)}</h3>`) : "") +
    (b.dek ? `<p class="dek">${esc(b.dek)}</p>` : "") +
    (b.byline ? `<div class="by"><b>${esc(b.byline)}</b></div>` : "");
  const srcLink = (i) => (i.source_name ? ` <span class="src">— ${safeUrl(i.source_url) ? `<a href="${esc(i.source_url)}" target="_blank" rel="noopener">${esc(i.source_name)}</a>` : esc(i.source_name)}</span>` : "");

  const BLOCKS = {
    hero(b) {
      const a = asset(b.image);
      if (!a) return BLOCKS.article(b);
      return `<figure class="hero">${imgTag(a)}<div class="over">${b.kicker ? `<div class="kicker">${esc(b.kicker)}</div>` : ""}<h2>${esc(b.title)}</h2>${b.dek ? `<p>${esc(b.dek)}</p>` : ""}</div></figure>${credit(a, b.caption)}`;
    },
    article(b) {
      const a = asset(b.image);
      const big = b.variant === "lead" || b.variant === "big" || (b.span || 12) >= 7;
      const pic = a ? `<figure class="photo">${imgTag(a)}</figure>${credit(a, b.caption)}` : "";
      return headBits(b, big) + pic + paras(b, (b.span || 12) >= 7 && (b.paragraphs || []).length >= 3);
    },
    photo(b) {
      const a = asset(b.image);
      return a ? `<figure class="photo">${imgTag(a)}</figure>${credit(a, b.caption)}` : "";
    },
    cutout(b) {
      const a = asset(b.image);
      if (!a) return "";
      const lines = (b.paragraphs || []).map(esc).join("<br>");
      return `<div class="cut"><span class="no">${esc(a.back_no || "")}</span><div class="tx"><b>${esc(b.big || "")}</b><span>${lines}</span></div>${imgTag(a)}</div>${credit(a, b.caption)}`;
    },
    figs(b) {
      return headBits(b) + `<div class="figs">${(b.items || []).map((i) => `<div><b class="num">${esc(i.value)}</b><span>${esc(i.label || i.text)}</span></div>`).join("")}</div>`;
    },
    list(b) {
      return headBits(b, true) + `<ul class="list">${(b.items || []).map((i) => `<li>${i.tag ? `<span class="tag ${TAGCLS[i.tag] || ""}">${esc(i.tag)}</span>` : ""}<b>${esc(i.title)}</b>${esc(i.text)}${srcLink(i)}</li>`).join("")}</ul>`;
    },
    timeline(b) {
      return headBits(b, true) + `<ol class="tl">${(b.items || []).map((i) => `<li class="${i.state === "hot" ? "hot" : ""}"><time>${esc(i.date)}</time><b>${esc(i.title)}</b>${esc(i.text)}${srcLink(i)}</li>`).join("")}</ol>`;
    },
    signal(b) {
      const ic = { yes: ["y", "✓"], no: ["n", "✕"], maybe: ["m", "?"] };
      return headBits(b) + `<ul class="sig">${(b.items || []).map((i) => { const [c, s] = ic[i.state] || ic.maybe; return `<li><i class="${c}">${s}</i><span><b>${esc(i.title)}</b> · ${esc(i.text)}</span></li>`; }).join("")}</ul>${b.big ? `<p class="cap">조간 판정: <b>${esc(b.big)}</b></p>` : ""}`;
    },
    talk(b) {
      return headBits(b) + `<div class="talk">${(b.items || []).map((i, k) => `<div class="${i.state === "r" || k % 2 ? "r" : ""}">${esc(i.text)}<small>${esc(i.label || "")}</small></div>`).join("")}</div>`;
    },
    quiz(b) {
      return `<div class="quiz">${headBits(b)}${(b.items || []).map((i) => `<details><summary>${esc(i.title)}</summary><p>${esc(i.text)}</p></details>`).join("")}</div>`;
    },
    table(b) {
      return headBits(b) + `<table class="tbl table2"><tbody>${(b.items || []).map((i) => `<tr><td>${esc(i.label)}</td><td>${esc(i.value != null ? i.value : i.text)}</td></tr>`).join("")}</tbody></table>`;
    },
    quote(b) {
      return `<blockquote class="quote">${esc(b.title)}</blockquote>${b.byline ? `<div class="by">${esc(b.byline)}</div>` : ""}`;
    },
    box(b) {
      return `<div class="box ${b.variant === "dark" ? "dark" : b.variant === "lime" ? "lime" : ""}">${headBits(b)}${paras(b)}${(b.items || []).length ? `<ul class="list">${b.items.map((i) => `<li><b>${esc(i.title)}</b>${esc(i.text)}${srcLink(i)}</li>`).join("")}</ul>` : ""}</div>`;
    },
    index() {
      return `<h4>오늘의 지면</h4><ul class="idx">${ISSUE.pages.slice(1).map((p, k) => `<li><span>${k + 2}면</span><button data-go="${k + 1}">${esc(p.teaser || p.tab)}</button></li>`).join("")}</ul>`;
    },
    chart(b) { return headBits(b) + `<div data-chart="${esc(b.chart)}"></div>`; },
    bars(b) { return headBits(b) + `<div data-bars></div>${b.caption ? `<p class="cap">${esc(b.caption)}</p>` : ""}`; },
  };

  function renderBlock(b) {
    const span = [12, 8, 7, 6, 5, 4].includes(b.span) ? b.span : 12;
    const fn = BLOCKS[b.type] || BLOCKS.article;
    const div = document.createElement("div");
    div.className = `c${span}${b.rule_top ? " rule-top" : ""}`;
    div.innerHTML = fn(b);
    div.querySelectorAll("[data-chart]").forEach((h) => { const f = CHARTS[h.dataset.chart]; if (!f || !f(h)) h.remove(); });
    div.querySelectorAll("[data-bars]").forEach((h) => bars(h, b.items, b.title));
    if (b.type === "hero") div.style.marginTop = "-4px";
    return div;
  }

  /* ---------- 면 ---------- */
  function render() {
    const d = new Date(ISSUE.date + "T00:00:00+09:00");
    const dateLabel = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 ${WD[d.getDay()]}요일`;
    document.title = `전주성 조간 제${ISSUE.no}호`;
    $("#dl-no").textContent = `제${ISSUE.no}호`;
    $("#dl-date").textContent = dateLabel;
    if (ISSUE.edition_note) $("#ear-r").innerHTML = `<span class="proto">${esc(ISSUE.edition_note)}</span><br>매일 07:00 발행`;
    $("#strip").innerHTML = (ISSUE.strip || []).map((s) => `<span>${esc(s)}</span>`).join("");
    const tabs = $("#tabs"), paper = $("#paper");
    tabs.innerHTML = ""; paper.innerHTML = "";
    ISSUE.pages.forEach((p, i) => {
      const t = document.createElement("button");
      t.role = "tab"; t.id = "t" + (i + 1); t.setAttribute("aria-controls", "p" + (i + 1));
      t.textContent = i === 0 ? "1면" : `${i + 1}면 ${p.tab}`;
      tabs.appendChild(t);
      const sec = document.createElement("section");
      sec.className = "sheet"; sec.id = "p" + (i + 1); sec.setAttribute("role", "tabpanel"); sec.setAttribute("aria-labelledby", t.id);
      sec.innerHTML = `<div class="folio"><span><b>${i + 1}면</b> ${esc(p.tab)}</span><span>${esc(p.folio || `전주성 조간 제${ISSUE.no}호 · ${ISSUE.date.replace(/-/g, ".")}`)}</span></div>`;
      const grid = document.createElement("div");
      grid.className = "grid";
      (p.blocks || []).forEach((b) => { try { grid.appendChild(renderBlock(b)); } catch (e) { console.error(e, b); } });
      sec.appendChild(grid);
      paper.appendChild(sec);
    });
    const all = document.createElement("button");
    all.className = "all"; all.textContent = "한 번에 보기"; all.setAttribute("aria-pressed", "false");
    tabs.appendChild(all);
    wireTabs(all);
  }

  function wireTabs(all) {
    const tabs = [...document.querySelectorAll("[role=tab]")], panels = [...document.querySelectorAll("[role=tabpanel]")];
    const mq = matchMedia("(max-width:760px)");
    let cur = 0;
    function show(i, focus) {
      cur = i;
      tabs.forEach((t, j) => { t.setAttribute("aria-selected", j === i); t.tabIndex = j === i ? 0 : -1; });
      if (mq.matches || EMBED) return;
      all.setAttribute("aria-pressed", "false");
      panels.forEach((p, j) => (p.hidden = j !== i));
      if (focus) tabs[i].focus();
      try { history.replaceState(null, "", location.search + "#p" + (i + 1)); } catch (e) {}
    }
    function go(i) { show(i); if (mq.matches || EMBED) panels[i].scrollIntoView({ behavior: "smooth" }); else window.scrollTo({ top: 0 }); }
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => go(i));
      t.addEventListener("keydown", (e) => { if (e.key === "ArrowRight") show((i + 1) % tabs.length, true); if (e.key === "ArrowLeft") show((i - 1 + tabs.length) % tabs.length, true); });
    });
    document.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(+b.dataset.go)));
    all.addEventListener("click", () => { const on = all.getAttribute("aria-pressed") !== "true"; all.setAttribute("aria-pressed", on); panels.forEach((p, j) => (p.hidden = !on && j !== cur)); });
    function layout() { if (mq.matches || EMBED) panels.forEach((p) => (p.hidden = false)); else show(cur); }
    mq.addEventListener("change", layout);
    addEventListener("hashchange", () => { const h = /^#p(\d+)$/.exec(location.hash); if (h && +h[1] <= panels.length && +h[1] - 1 !== cur) go(+h[1] - 1); });
    const m = /^#p(\d+)$/.exec(location.hash);
    if (m && +m[1] <= panels.length) cur = +m[1] - 1;
    layout();
    if (m && mq.matches) panels[cur].scrollIntoView();
  }

  function markReady() {
    const imgs = [...document.images].filter((i) => !i.complete);
    Promise.all(imgs.map((i) => new Promise((r) => { i.onload = i.onerror = r; })))
      .then(() => (document.fonts ? document.fonts.ready : null))
      .then(() => requestAnimationFrame(() => { document.documentElement.dataset.ready = "1"; }));
  }

  /* ---------- 불러오기 ---------- */
  async function getJSON(u) { const r = await fetch(u, { cache: "no-cache" }); if (!r.ok) throw new Error(u + " " + r.status); return r.json(); }
  async function boot() {
    try {
      const [idx, lib] = await Promise.all([getJSON("issues/index.json"), getJSON("img/library.json").catch(() => ({ images: {} }))]);
      LIB = lib.images || {};
      const want = new URLSearchParams(location.search).get("no");
      const list = idx.issues || [];
      const pick = want != null ? list.find((i) => String(i.no) === want) : list.filter((i) => i.no > 0).slice(-1)[0] || list.slice(-1)[0];
      if (!pick) throw new Error("발행된 호가 없습니다");
      ISSUE = await getJSON(`issues/${pick.no}.json`);
      render();
      if (EMBED) markReady();
      $("#archive").innerHTML = "지난 호: " + list.slice(-14).reverse().map((i) => `<a href="?no=${i.no}">제${i.no}호 ${esc(i.date.slice(5).replace("-", "/"))}</a>`).join("");
    } catch (e) {
      $("#paper").innerHTML = `<p class="err">신문을 불러오지 못했습니다. (${esc(e.message)})</p>`;
    }
  }
  boot();
})();
