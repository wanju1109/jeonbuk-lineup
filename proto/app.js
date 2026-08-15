/* K League Proto interactive learner
 * Blind prediction → reveal actual → update weights on misses
 */
(function () {
  "use strict";

  const STORAGE_KEY = "kleague_proto_learn_v1";
  const REVEAL_KEY = "kleague_proto_revealed_v1";

  const data = window.PROTO_DATA;
  if (!data || !Array.isArray(data.matches)) {
    document.body.innerHTML = "<p style='padding:24px;color:#fff'>data.js 로드 실패. build_ui.py를 먼저 실행하세요.</p>";
    return;
  }

  const defaultWeights = Object.assign(
    {
      version: 1,
      home_adv_delta: 0,
      draw_floor_delta: 0,
      form_weight_delta: 0,
      ou_under_bias: 0,
      favorite_shrink: 0,
      samples: 0,
      misses: { wdl: 0, handicap_h1: 0, ou25: 0 },
      hits: { wdl: 0, handicap_h1: 0, ou25: 0 },
      history: [],
    },
    data.weights || {}
  );

  let weights = loadJSON(STORAGE_KEY, defaultWeights);
  let revealed = new Set(loadJSON(REVEAL_KEY, []));
  let filter = "all";
  let roundFilter = "all";

  const elList = document.getElementById("list");
  const elStats = document.getElementById("stats");
  const elMethod = document.getElementById("methodNote");
  const elRound = document.getElementById("roundSelect");

  elMethod.textContent =
    "생성: " +
    (data.generated_at || "-") +
    " · 예측은 킥오프 이전 데이터만 사용(결과 누수 없음). 학습 가중치는 이 브라우저(localStorage)에 저장되며, 내보내기로 weights.json에 옮겨 analyze.py에 재적용할 수 있습니다.";

  // Round options
  const rounds = Array.from(
    new Set(
      data.matches.map(function (m) {
        return String(m.league) + "-" + String(m.round);
      })
    )
  ).sort(function (a, b) {
    const pa = a.split("-");
    const pb = b.split("-");
    if (pa[0] !== pb[0]) return pa[0] < pb[0] ? -1 : 1;
    return Number(pa[1]) - Number(pb[1]);
  });
  elRound.innerHTML =
    '<option value="all">전체</option>' +
    rounds
      .map(function (r) {
        return '<option value="' + r + '">' + r + "</option>";
      })
      .join("");

  document.querySelectorAll(".toolbar .chip[data-filter]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".toolbar .chip[data-filter]").forEach(function (b) {
        b.classList.remove("active");
      });
      btn.classList.add("active");
      filter = btn.getAttribute("data-filter");
      render();
    });
  });

  elRound.addEventListener("change", function () {
    roundFilter = elRound.value;
    render();
  });

  document.getElementById("btnRevealRound").addEventListener("click", function () {
    visibleMatches().forEach(function (m) {
      if (!m.upcoming && m.actual_hidden) revealOne(m.id, false);
    });
    persist();
    render();
  });

  document.getElementById("btnHideAll").addEventListener("click", function () {
    revealed = new Set();
    persist();
    render();
  });

  document.getElementById("btnResetLearn").addEventListener("click", function () {
    if (!confirm("학습 가중치와 공개 상태를 초기화할까요?")) return;
    weights = JSON.parse(JSON.stringify(defaultWeights));
    weights.history = [];
    weights.samples = 0;
    weights.misses = { wdl: 0, handicap_h1: 0, ou25: 0 };
    weights.hits = { wdl: 0, handicap_h1: 0, ou25: 0 };
    revealed = new Set();
    persist();
    render();
  });

  document.getElementById("btnExportLearn").addEventListener("click", function () {
    const blob = new Blob([JSON.stringify(weights, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "weights.json";
    a.click();
    URL.revokeObjectURL(a.href);
  });

  document.getElementById("btnImportLearn").addEventListener("click", function () {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", function (ev) {
    const file = ev.target.files && ev.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function () {
      try {
        const parsed = JSON.parse(String(reader.result || "{}"));
        weights = Object.assign({}, defaultWeights, parsed);
        persist();
        render();
        alert("학습 가중치를 가져왔습니다.");
      } catch (e) {
        alert("JSON 파싱 실패: " + e.message);
      }
    };
    reader.readAsText(file);
    ev.target.value = "";
  });

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(weights));
    localStorage.setItem(REVEAL_KEY, JSON.stringify(Array.from(revealed)));
  }

  function adjustedPred(m) {
    // Apply learned deltas to displayed pick (does not change stored base pred permanently)
    const base = m.pred || {};
    const dist = Object.assign({ 승: 0.33, 무: 0.33, 패: 0.34 }, base.wdl_dist || {});
    let h = Number(dist["승"] || 0);
    let d = Number(dist["무"] || 0);
    let a = Number(dist["패"] || 0);

    // home bias
    h *= 1 + clamp(weights.home_adv_delta, -0.25, 0.25);
    // draw floor nudge
    d += clamp(weights.draw_floor_delta, -0.15, 0.2);
    // favorite shrink: pull top outcome toward mean when overconfident misses accumulate
    const shrink = clamp(weights.favorite_shrink, 0, 0.35);
    if (shrink > 0) {
      const mean = (h + d + a) / 3;
      h = h * (1 - shrink) + mean * shrink;
      d = d * (1 - shrink) + mean * shrink;
      a = a * (1 - shrink) + mean * shrink;
    }
    const s = h + d + a || 1;
    h /= s;
    d /= s;
    a /= s;

    const wdlPick = maxKey({ 승: h, 무: d, 패: a });
    let underP = base.ou25 === "언더" ? Number(base.ou_prob || 0.5) : 1 - Number(base.ou_prob || 0.5);
    underP += clamp(weights.ou_under_bias, -0.25, 0.25);
    underP = clamp(underP, 0.05, 0.95);
    const ouPick = underP >= 0.5 ? "언더" : "오버";

    return {
      wdl: wdlPick,
      wdl_prob: { 승: h, 무: d, 패: a }[wdlPick],
      handicap_h1: base.handicap_h1, // keep line pick; learning mainly on 1X2/OU for v1
      ou25: ouPick,
      ou_prob: ouPick === "언더" ? underP : 1 - underP,
      confidence_tier: base.confidence_tier,
      adjusted: true,
    };
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, Number(v) || 0));
  }

  function maxKey(obj) {
    let best = null;
    let bestV = -1;
    Object.keys(obj).forEach(function (k) {
      if (obj[k] > bestV) {
        bestV = obj[k];
        best = k;
      }
    });
    return best;
  }

  function learnFromReveal(m, pred, actual) {
    weights.samples += 1;
    const entry = {
      id: m.id,
      at: new Date().toISOString(),
      pred: { wdl: pred.wdl, handicap_h1: pred.handicap_h1, ou25: pred.ou25 },
      actual: actual,
      miss: {},
    };

    // WDL learning
    if (pred.wdl === actual.wdl) {
      weights.hits.wdl += 1;
      entry.miss.wdl = false;
    } else {
      weights.misses.wdl += 1;
      entry.miss.wdl = true;
      if (actual.wdl === "무") weights.draw_floor_delta += 0.012;
      if (pred.wdl === "승" && actual.wdl === "패") weights.home_adv_delta -= 0.01;
      if (pred.wdl === "패" && actual.wdl === "승") weights.home_adv_delta += 0.008;
      // overconfident favorite miss
      if (Number(pred.wdl_prob || 0) >= 0.45) weights.favorite_shrink += 0.008;
    }

    // Handicap
    if (pred.handicap_h1 === actual.handicap_h1) {
      weights.hits.handicap_h1 += 1;
      entry.miss.handicap_h1 = false;
    } else {
      weights.misses.handicap_h1 += 1;
      entry.miss.handicap_h1 = true;
    }

    // OU
    if (pred.ou25 === actual.ou25) {
      weights.hits.ou25 += 1;
      entry.miss.ou25 = false;
    } else {
      weights.misses.ou25 += 1;
      entry.miss.ou25 = true;
      if (actual.ou25 === "언더" && pred.ou25 === "오버") weights.ou_under_bias += 0.012;
      if (actual.ou25 === "오버" && pred.ou25 === "언더") weights.ou_under_bias -= 0.012;
    }

    // soft decay / clamp
    weights.home_adv_delta = clamp(weights.home_adv_delta, -0.2, 0.2);
    weights.draw_floor_delta = clamp(weights.draw_floor_delta, -0.1, 0.2);
    weights.ou_under_bias = clamp(weights.ou_under_bias, -0.2, 0.2);
    weights.favorite_shrink = clamp(weights.favorite_shrink, 0, 0.3);
    weights.history.push(entry);
    if (weights.history.length > 500) weights.history = weights.history.slice(-500);
  }

  function revealOne(id, doRender) {
    const m = data.matches.find(function (x) {
      return x.id === id;
    });
    if (!m || m.upcoming || !m.actual_hidden) return;
    if (revealed.has(id)) return;
    const pred = adjustedPred(m);
    learnFromReveal(m, pred, m.actual_hidden);
    revealed.add(id);
    if (doRender !== false) {
      persist();
      render();
    }
  }

  function visibleMatches() {
    return data.matches.filter(function (m) {
      if (roundFilter !== "all") {
        const key = String(m.league) + "-" + String(m.round);
        if (key !== roundFilter) return false;
      }
      if (filter === "K1" || filter === "K2") return m.league === filter;
      if (filter === "upcoming") return !!m.upcoming;
      if (filter === "blind") return !m.upcoming && !revealed.has(m.id);
      if (filter === "revealed") return revealed.has(m.id);
      return true;
    });
  }

  function rate(hit, miss) {
    const t = hit + miss;
    if (!t) return "-";
    return ((100 * hit) / t).toFixed(1) + "%";
  }

  function renderStats() {
    const blind = data.matches.filter(function (m) {
      return !m.upcoming && !revealed.has(m.id);
    }).length;
    const up = data.matches.filter(function (m) {
      return m.upcoming;
    }).length;
    elStats.innerHTML =
      '<div class="statbox"><b>미공개(블라인드)</b><strong>' +
      blind +
      "</strong></div>" +
      '<div class="statbox"><b>공개 학습 샘플</b><strong>' +
      weights.samples +
      "</strong></div>" +
      '<div class="statbox"><b>학습 후 승무패</b><strong>' +
      rate(weights.hits.wdl, weights.misses.wdl) +
      "</strong><span>" +
      weights.hits.wdl +
      "/" +
      (weights.hits.wdl + weights.misses.wdl) +
      "</span></div>" +
      '<div class="statbox"><b>학습 후 핸디</b><strong>' +
      rate(weights.hits.handicap_h1, weights.misses.handicap_h1) +
      "</strong></div>" +
      '<div class="statbox"><b>학습 후 U/O</b><strong>' +
      rate(weights.hits.ou25, weights.misses.ou25) +
      "</strong></div>" +
      '<div class="statbox"><b>예정 경기</b><strong>' +
      up +
      "</strong></div>" +
      '<div class="statbox"><b>가중치 homeΔ</b><strong>' +
      Number(weights.home_adv_delta).toFixed(3) +
      "</strong></div>" +
      '<div class="statbox"><b>가중치 drawΔ</b><strong>' +
      Number(weights.draw_floor_delta).toFixed(3) +
      "</strong></div>" +
      '<div class="statbox"><b>가중치 underΔ</b><strong>' +
      Number(weights.ou_under_bias).toFixed(3) +
      "</strong></div>";
  }

  function render() {
    renderStats();
    const rows = visibleMatches();
    if (!rows.length) {
      elList.innerHTML = '<p class="sub">표시할 경기가 없습니다.</p>';
      return;
    }
    elList.innerHTML = rows
      .map(function (m) {
        const isRev = revealed.has(m.id);
        const pred = adjustedPred(m);
        const actual = m.actual_hidden;
        let sideHtml = "";
        let compareHtml = "";
        let cls = "card";

        if (m.upcoming) {
          sideHtml =
            '<div class="score">예정</div><button class="action secondary" disabled>결과 대기</button>';
        } else if (!isRev) {
          sideHtml =
            '<div class="score">? - ?</div>' +
            '<button class="action" data-reveal="' +
            escapeAttr(m.id) +
            '">실제결과 반영</button>';
        } else {
          cls += " revealed";
          const score =
            String(actual.home_goals) + " - " + String(actual.away_goals);
          const hitW = pred.wdl === actual.wdl;
          const hitH = pred.handicap_h1 === actual.handicap_h1;
          const hitO = pred.ou25 === actual.ou25;
          if (hitW && hitH && hitO) cls += " hit";
          else if (!hitW) cls += " miss";
          sideHtml =
            '<div class="score show">' +
            score +
            "</div>" +
            '<button class="action secondary" disabled>반영됨</button>';
          compareHtml =
            '<div class="compare">' +
            "승무패 예측 " +
            pred.wdl +
            " / 실제 " +
            actual.wdl +
            ' → <span class="' +
            (hitW ? "ok" : "bad") +
            '">' +
            (hitW ? "적중" : "미적중") +
            "</span><br/>" +
            "핸디+1 예측 " +
            pred.handicap_h1 +
            " / 실제 " +
            actual.handicap_h1 +
            ' → <span class="' +
            (hitH ? "ok" : "bad") +
            '">' +
            (hitH ? "적중" : "미적중") +
            "</span><br/>" +
            "U/O 예측 " +
            pred.ou25 +
            " / 실제 " +
            actual.ou25 +
            ' → <span class="' +
            (hitO ? "ok" : "bad") +
            '">' +
            (hitO ? "적중" : "미적중") +
            "</span>" +
            "</div>";
        }

        const form = m.pre_form || {};
        return (
          '<article class="' +
          cls +
          '" data-id="' +
          escapeAttr(m.id) +
          '">' +
          "<div>" +
          '<div class="meta">' +
          escapeHtml(m.league) +
          " · " +
          escapeHtml(String(m.round)) +
          "R · " +
          escapeHtml(m.date || "") +
          " " +
          escapeHtml(m.time || "") +
          (m.upcoming ? " · 예정" : " · 블라인드 예측") +
          "</div>" +
          "<h3>" +
          escapeHtml(m.home) +
          ' <span class="vs">vs</span> ' +
          escapeHtml(m.away) +
          "</h3>" +
          '<div class="meta">직전폼 홈 ' +
          escapeHtml(form.home || "-") +
          " (" +
          escapeHtml(form.home_record || "-") +
          ") / 원정 " +
          escapeHtml(form.away || "-") +
          " (" +
          escapeHtml(form.away_record || "-") +
          ")</div>" +
          '<div class="picks">' +
          "<div><b>승무패(학습반영)</b><strong>" +
          escapeHtml(pred.wdl || "-") +
          "</strong></div>" +
          "<div><b>핸디 H+1.0</b><strong>" +
          escapeHtml(pred.handicap_h1 || "-") +
          "</strong></div>" +
          "<div><b>U/O 2.5(학습반영)</b><strong>" +
          escapeHtml(pred.ou25 || "-") +
          "</strong></div>" +
          "</div>" +
          '<p class="reason">' +
          escapeHtml(m.reason || "") +
          "</p>" +
          compareHtml +
          '<div class="learnbox">학습 상태: homeΔ=' +
          Number(weights.home_adv_delta).toFixed(3) +
          ", drawΔ=" +
          Number(weights.draw_floor_delta).toFixed(3) +
          ", underΔ=" +
          Number(weights.ou_under_bias).toFixed(3) +
          ", shrink=" +
          Number(weights.favorite_shrink).toFixed(3) +
          "</div>" +
          "</div>" +
          '<div class="side">' +
          sideHtml +
          "</div>" +
          "</article>"
        );
      })
      .join("");

    elList.querySelectorAll("[data-reveal]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        revealOne(btn.getAttribute("data-reveal"), true);
      });
    });
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  render();
})();
