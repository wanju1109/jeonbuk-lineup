/*
 * Sticky table of contents for the report.
 *
 * The outline is built from the live DOM rather than a hard-coded list, because
 * the briefing and deep-dive chapters are generated per match and their count
 * and titles change with the data. Anything that wants to appear as a sub-item
 * only has to carry an id plus a data-outline attribute.
 */

const Outline = (() => {
  const LIST_ID = "sideNavList";
  const NAV_ID = "sideNav";

  let items = [];
  let activeId = "";
  let bound = false;
  let ticking = false;

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])
    );
  }

  function isVisible(el) {
    if (!el) return false;
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  }

  function labelOf(el) {
    const attr = el.getAttribute("data-outline");
    if (attr && attr.trim()) return attr.trim();
    const h = el.querySelector("h2, h3, h4");
    return h ? h.textContent.trim() : "";
  }

  function shorten(text, max) {
    const t = String(text || "").trim();
    if (t.length <= max) return t;
    return `${t.slice(0, max - 1)}…`;
  }

  function collect() {
    const out = [];
    document.querySelectorAll(".page-main > .section[id]").forEach((sec) => {
      if (!isVisible(sec)) return;
      const head = sec.querySelector(".section-head h2");
      const label = head ? head.textContent.trim() : sec.id;
      out.push({ id: sec.id, label, depth: 1 });

      sec.querySelectorAll("[data-outline][id]").forEach((sub) => {
        if (!isVisible(sub)) return;
        const text = labelOf(sub);
        if (!text) return;
        out.push({ id: sub.id, label: text, depth: 2, parent: sec.id });
      });
    });
    return out;
  }

  function render() {
    const list = $(LIST_ID);
    if (!list) return;

    items = collect();
    if (!items.length) {
      list.innerHTML = "";
      return;
    }

    list.innerHTML = items
      .map(
        (it) =>
          `<a class="nav-item nav-depth-${it.depth}" href="#${escapeHtml(it.id)}" ` +
          `data-nav-target="${escapeHtml(it.id)}" title="${escapeHtml(it.label)}">` +
          `${escapeHtml(shorten(it.label, it.depth === 1 ? 28 : 32))}</a>`
      )
      .join("");

    activeId = "";
    spy();
  }

  /* Nudge the rail's own scrollbar without dragging the page along. */
  function keepVisible(list, el) {
    const lr = list.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    if (er.top < lr.top + 4) list.scrollTop -= lr.top + 4 - er.top;
    else if (er.bottom > lr.bottom - 4) list.scrollTop += er.bottom - lr.bottom + 4;
  }

  function spy() {
    const list = $(LIST_ID);
    if (!list || !items.length) return;

    /* Treat the upper third of the viewport as "what the reader is on". */
    const line = window.scrollY + Math.min(240, window.innerHeight * 0.32);
    const doc = document.documentElement;
    const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 6;

    let found = items[0].id;
    for (const it of items) {
      const el = $(it.id);
      if (!el) continue;
      if (el.getBoundingClientRect().top + window.scrollY - 1 <= line) found = it.id;
    }
    if (atBottom) found = items[items.length - 1].id;
    if (found === activeId) return;
    activeId = found;

    const current = items.find((it) => it.id === found);
    const parentId = current && current.depth === 2 ? current.parent : found;

    list.querySelectorAll(".nav-item").forEach((a) => {
      const target = a.getAttribute("data-nav-target");
      a.classList.toggle("active", target === found);
      a.classList.toggle("in-range", target === parentId && target !== found);
      if (target === found) {
        a.setAttribute("aria-current", "true");
        keepVisible(list, a);
      } else {
        a.removeAttribute("aria-current");
      }
    });
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(() => {
      ticking = false;
      try {
        spy();
      } catch (err) {
        console.error("[Outline] scroll spy failed:", err);
      }
    });
  }

  function onClick(ev) {
    const link = ev.target.closest("[data-nav-target]");
    if (!link) return;
    const el = $(link.getAttribute("data-nav-target"));
    if (!el) return;
    ev.preventDefault();
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    /* replaceState keeps the query string and avoids one history entry per click. */
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", `${location.pathname}${location.search}#${el.id}`);
    }
  }

  function bind() {
    if (bound) return;
    bound = true;
    const nav = $(NAV_ID);
    if (nav) nav.addEventListener("click", onClick);
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
  }

  function refresh() {
    try {
      bind();
      render();
    } catch (err) {
      console.error("[Outline] build failed:", err);
    }
  }

  return { refresh, spy };
})();

window.Outline = Outline;
