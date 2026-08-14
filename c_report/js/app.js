/* c_report app bootstrap */

(() => {
  const $ = (id) => document.getElementById(id);

  const state = {
    data: null,
    selectedGoalIdx: 0,
    selectedPlayerId: null,
    eventFilter: "PS",
    teamFilter: "home",
  };

  function setStatus(msg, isError = false) {
    const el = $("status");
    if (!msg) {
      el.classList.add("hidden");
      el.textContent = "";
      return;
    }
    el.classList.remove("hidden");
    el.className = "status" + (isError ? " error" : "");
    el.textContent = msg;
  }

  async function loadMatch() {
    setStatus("CHALK BOARD 데이터를 불러오는 중…");
    try {
      const res = await fetch("./data/131.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.events?.length) throw new Error("이벤트 데이터가 비어 있습니다.");
      state.data = data;
      setStatus("");
      renderAll();
    } catch (err) {
      console.error(err);
      setStatus(
        "경기 데이터를 읽지 못했습니다. GitHub Pages에서 c_report/data/131.json 경로를 확인하세요.\n" +
          String(err.message || err),
        true
      );
    }
  }

  function renderAll() {
    const { meta, events, players } = state.data;
    const pmap = Analyze.playerMap(players);
    const stats = Analyze.teamStats(events, meta.home.team_id, meta.away.team_id);
    const goalList = Analyze.goals(events);

    $("homeName").textContent = meta.home.name;
    $("awayName").textContent = meta.away.name;
    $("scoreNum").textContent = `${meta.score.home} : ${meta.score.away}`;
    $("metaLine").textContent = [
      meta.competition,
      `${meta.round}라운드`,
      meta.date,
      meta.venue,
      meta.attendance ? `관중 ${meta.attendance.toLocaleString()}` : "",
      meta.weather || "",
      meta.referee ? `주심 ${meta.referee}` : "",
    ]
      .filter(Boolean)
      .join(" · ");

    const h = stats[meta.home.team_id];
    const a = stats[meta.away.team_id];

    $("kpiGrid").innerHTML = [
      kpi("xG (골 기대값)", h.xg, a.xg, "기회가 얼마나 좋았는지"),
      kpi("슈팅", h.shots, a.shots, "골문을 향한 시도"),
      kpi("패스 성공", `${h.passOk}/${h.passes}`, `${a.passOk}/${a.passes}`, "연결의 안정성"),
      kpi("태클", h.tackles, a.tackles, "수비 개입"),
    ].join("");

    $("statBars").innerHTML = [
      bar("슈팅", h.shots, a.shots),
      bar("xG", h.xg, a.xg),
      bar("패스", h.passes, a.passes),
      bar("패스성공", h.passOk, a.passOk),
      bar("드리블", h.dribbles, a.dribbles),
      bar("파울", h.fouls, a.fouls),
      bar("선방", h.saves, a.saves),
    ].join("");

    const story = [];
    if (h.xg > a.xg && meta.score.home < meta.score.away) {
      story.push({
        label: "핵심",
        text: `전북 xG ${h.xg} > 제주 ${a.xg}. 기회 품질은 앞섰지만 스코어는 ${meta.score.home}-${meta.score.away}. "만들었는데 못 넣었다"가 아니라, 상대는 넣었고 우리는 마무리가 아쉬웠다는 그림입니다.`,
      });
    }
    story.push({
      label: "초보",
      text: "xG(예상 득점)는 슈팅 위치·상황을 점수로 환산한 값입니다. 0.05면 어려운 슈팅, 0.30이면 꽤 좋은 기회예요.",
    });
    story.push({
      label: "전문가",
      text: `전북 슈팅 ${h.shots} / 제주 ${a.shots}. 점유·패스량(${h.passes} vs ${a.passes})은 전북이 앞섰고, 제주는 결정력(특히 PK 포함 마무리)로 승부를 갈랐습니다.`,
    });
    $("storyBox").innerHTML = story
      .map(
        (s) =>
          `<div class="story-item"><div class="story-label">${escapeHtml(s.label)}</div><div>${escapeHtml(
            s.text
          )}</div></div>`
      )
      .join("");

    renderGoals(goalList, pmap, meta);
    renderPlayers(events, players, meta);
    renderShotMap();
    const pageUrl =
      window.location.href.split("#")[0] ||
      "https://wanju1109.github.io/jeonbuk-lineup/c_report/";
    $("reportUrl").textContent = pageUrl;
    $("reportUrl").href = pageUrl;
    $("communityText").textContent = Analyze.buildFullReportText(
      meta,
      stats,
      goalList,
      pmap,
      events,
      players,
      pageUrl
    );
  }

  function kpi(label, home, away, sub) {
    return `<div class="kpi"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(
      String(home)
    )} <span style="color:#5d7268;font-size:16px">:</span> ${escapeHtml(String(away))}</div><div class="sub">${escapeHtml(
      sub
    )}</div></div>`;
  }

  function bar(label, home, away) {
    const max = Math.max(Number(home) || 0, Number(away) || 0, 0.01);
    const hl = Math.round((Number(home) / max) * 100);
    const al = Math.round((Number(away) / max) * 100);
    return `<div class="bar-row">
      <div class="num-home">${escapeHtml(String(home))}</div>
      <div>
        <div class="metric">${escapeHtml(label)}</div>
        <div class="bar-track">
          <div class="bar-half left"><div class="bar-home" style="width:${hl}%"></div></div>
          <div class="bar-half right"><div class="bar-away" style="width:${al}%"></div></div>
        </div>
      </div>
      <div class="num-away">${escapeHtml(String(away))}</div>
    </div>`;
  }

  function renderGoals(goalList, pmap, meta) {
    const box = $("goalList");
    if (!goalList.length) {
      box.innerHTML = "<div class='meta'>골 이벤트가 없습니다.</div>";
      return;
    }
    if (state.selectedGoalIdx >= goalList.length) state.selectedGoalIdx = 0;

    box.innerHTML = goalList
      .map((g, i) => {
        const nm = Analyze.nameOf(pmap, g.PLAYER_ID);
        const team = g.TEAM_ID === meta.home.team_id ? meta.home.name : meta.away.name;
        const pk = g.TYPE_DETAIL_CD2 === "PK" ? " · PK" : "";
        return `<button class="goal-card ${i === state.selectedGoalIdx ? "active" : ""}" data-idx="${i}">
          <div class="top"><span>${escapeHtml(Analyze.formatClock(g))} ${escapeHtml(team)}</span><span>xG ${Number(
          g.EXPECTED_GOAL || 0
        ).toFixed(2)}</span></div>
          <div class="meta">${escapeHtml(nm)}${pk} · #${escapeHtml(String(g.back_no || ""))}</div>
        </button>`;
      })
      .join("");

    box.querySelectorAll(".goal-card").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedGoalIdx = Number(btn.getAttribute("data-idx"));
        renderGoals(goalList, pmap, meta);
      });
    });

    const goal = goalList[state.selectedGoalIdx];
    const seq = Analyze.sequenceBeforeGoal(state.data.events, goal, 28);
    const points = seq.map((e) => Pitch.normalizePoint(e, meta.home.team_id));

    $("goalSeq").innerHTML = seq
      .map((e, i) => {
        const label = Analyze.DETAIL[e.TYPE_DETAIL_CD] || e.TYPE_CD || "액션";
        const nm = Analyze.nameOf(pmap, e.PLAYER_ID);
        return `<div class="seq-step"><div class="n">${i + 1}</div><div class="body"><strong>${escapeHtml(
          nm
        )}</strong> · ${escapeHtml(label)}<br><span style="color:#5d7268;font-size:12px">${escapeHtml(
          Analyze.formatClock(e)
        )}</span></div></div>`;
      })
      .join("");

    Pitch.render($("goalCanvas"), {
      mode: "sequence",
      points,
      homeTeamId: meta.home.team_id,
    });
  }

  function renderPlayers(events, players, meta) {
    const ranked = Analyze.rankPlayers(events, players, meta.home.team_id).filter((p) => {
      if (state.teamFilter === "home") return p.team_id === meta.home.team_id;
      if (state.teamFilter === "away") return p.team_id === meta.away.team_id;
      return true;
    });

    if (!state.selectedPlayerId && ranked[0]) state.selectedPlayerId = ranked[0].player_id;

    $("playerList").innerHTML = ranked
      .slice(0, 24)
      .map((p) => {
        return `<button class="player-btn ${String(p.player_id) === String(state.selectedPlayerId) ? "active" : ""}" data-id="${
          p.player_id
        }">
          <div class="top"><span>#${escapeHtml(String(p.back_no))} ${escapeHtml(p.name)}</span><span>${p.touches}</span></div>
          <div class="meta">${escapeHtml(p.pos || "")} · 패스 ${p.passOk}/${p.passes} · 슈팅 ${p.shots}</div>
        </button>`;
      })
      .join("");

    $("playerList").querySelectorAll(".player-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.selectedPlayerId = btn.getAttribute("data-id");
        renderPlayers(events, players, meta);
      });
    });

    const pev = Analyze.playerEvents(events, state.selectedPlayerId, state.eventFilter);
    const points = pev.map((e) => Pitch.normalizePoint(e, meta.home.team_id));
    Pitch.render($("playerCanvas"), {
      mode: "heat",
      points,
      homeTeamId: meta.home.team_id,
      heatColor: state.teamFilter === "away" ? "rgba(228,87,46,0.35)" : "rgba(214,245,106,0.35)",
    });

    const p = ranked.find((x) => String(x.player_id) === String(state.selectedPlayerId));
    $("playerCaption").textContent = p
      ? `${p.name} · 선택 이벤트 ${pev.length}개 · 필터 ${state.eventFilter}`
      : "선수를 선택하세요";
  }

  function renderShotMap() {
    const { meta, events } = state.data;
    const shots = events.filter((e) => e.TYPE_CD === "ST");
    Pitch.render($("shotCanvas"), {
      mode: "shots",
      shots,
      homeTeamId: meta.home.team_id,
    });
  }

  function escapeHtml(v) {
    return String(v ?? "").replace(/[&<>"']/g, (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[s])
    );
  }

  function bindUi() {
    document.querySelectorAll("[data-filter]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-filter]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.eventFilter = btn.getAttribute("data-filter");
        if (state.data) renderPlayers(state.data.events, state.data.players, state.data.meta);
      });
    });

    document.querySelectorAll("[data-team]").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("[data-team]").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.teamFilter = btn.getAttribute("data-team");
        state.selectedPlayerId = null;
        if (state.data) renderPlayers(state.data.events, state.data.players, state.data.meta);
      });
    });

    $("copyCommunity").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText($("communityText").textContent);
        $("copyCommunity").textContent = "전체 리포트 복사됨";
        setTimeout(() => {
          $("copyCommunity").textContent = "전체 리포트 복사";
        }, 1400);
      } catch (err) {
        setStatus("클립보드 복사에 실패했습니다. 텍스트를 직접 드래그해 복사하세요.", true);
      }
    });

    $("copyUrl").addEventListener("click", async () => {
      try {
        const url = $("reportUrl").href || window.location.href.split("#")[0];
        await navigator.clipboard.writeText(url);
        $("copyUrl").textContent = "링크 복사됨";
        setTimeout(() => {
          $("copyUrl").textContent = "리포트 링크만 복사";
        }, 1400);
      } catch (err) {
        setStatus("링크 복사에 실패했습니다.", true);
      }
    });

    window.addEventListener("resize", () => {
      if (!state.data) return;
      try {
        renderAll();
      } catch (err) {
        console.error(err);
      }
    });
  }

  bindUi();
  loadMatch();
})();
