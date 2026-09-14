/* Narrative engine: turns a club dossier into a readable season column.
 * Every sentence is derived from the JSON payload, so pressing "regenerate"
 * after new results produces a genuinely different column. */
(function () {
  "use strict";

  const RESULT_WORD = { W: "승", D: "무", L: "패" };

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback === undefined ? 0 : fallback);
  }

  function one(value) {
    return (Math.round(num(value) * 10) / 10).toFixed(1);
  }

  function two(value) {
    return (Math.round(num(value) * 100) / 100).toFixed(2);
  }

  function comma(value) {
    return num(value).toLocaleString("ko-KR");
  }

  function percent(part, whole) {
    const w = num(whole);
    if (w <= 0) return 0;
    return Math.round((num(part) / w) * 100);
  }

  function recordText(rec) {
    if (!rec) return "기록 없음";
    return `${num(rec.win)}승 ${num(rec.draw)}무 ${num(rec.loss)}패`;
  }

  function dateText(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    if (!m) return String(iso || "");
    return `${Number(m[2])}월 ${Number(m[3])}일`;
  }

  /* Fallback only: club ids are preferred for naming an opponent. */
  function shortName(full) {
    const text = String(full || "");
    if (/수원\s*FC/i.test(text)) return "수원FC";
    if (/서울\s*이랜드/.test(text)) return "서울E";
    return (
      text
        .replace(/\s*(FC|유나이티드|스틸러스|드래곤즈|아이파크|그리너스|시티|프론티어|프런티어|하나|현대|상무|HD|SK)\s*/g, " ")
        .trim() || text
    );
  }

  /* Korean particles depend on whether the last syllable has a final consonant. */
  function hasFinalConsonant(word) {
    const text = String(word || "").trim();
    if (!text) return false;
    const code = text.charCodeAt(text.length - 1);
    if (code >= 0xac00 && code <= 0xd7a3) return (code - 0xac00) % 28 !== 0;
    // Read aloud in Korean: 0 영, 1 일, 3 삼, 6 육, 7 칠, 8 팔 end on a consonant.
    if (/[0-9]$/.test(text)) return /[013678]$/.test(text);
    // Only L(엘) M(엠) N(엔) R(알) end on a consonant when spoken.
    if (/[A-Za-z]$/.test(text)) return /[lmnrLMNR]$/.test(text);
    return false;
  }

  function withParticle(word, withFinal, withoutFinal) {
    return `${word}${hasFinalConsonant(word) ? withFinal : withoutFinal}`;
  }

  const subject = (w) => withParticle(w, "이", "가");
  const topic = (w) => withParticle(w, "은", "는");
  const object = (w) => withParticle(w, "을", "를");

  /* Where this club sits in the league for a per-game metric. */
  function rankBy(table, valueOf, descending) {
    const rows = (table || [])
      .map((row) => ({ id: row.team_id, value: valueOf(row) }))
      .filter((row) => Number.isFinite(row.value));
    rows.sort((a, b) => (descending ? b.value - a.value : a.value - b.value));
    const map = {};
    rows.forEach((row, i) => {
      map[row.id] = i + 1;
    });
    return map;
  }

  function leagueMean(table, valueOf) {
    const values = (table || []).map(valueOf).filter((v) => Number.isFinite(v));
    if (!values.length) return 0;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function perGame(row, key) {
    const played = num(row.played);
    return played > 0 ? num(row[key]) / played : 0;
  }

  /* Ranking suffix in Korean: 1위, 최하위, 공동 N위 is intentionally avoided. */
  function placeWord(rank, total) {
    if (rank === 1) return "1위";
    if (rank === total) return "최하위";
    return `${rank}위`;
  }

  function streakSentence(streaks) {
    const type = String(streaks?.current_type || "");
    const len = num(streaks?.current_len);
    if (!type || len <= 0) return "";
    if (len === 1) {
      if (type === "W") return "직전 경기를 이기고 분위기를 돌렸습니다.";
      if (type === "D") return "직전 경기는 비겼습니다.";
      return "직전 경기를 내줬습니다.";
    }
    if (type === "W") return `${len}연승으로 달리는 중입니다.`;
    if (type === "D") return `${len}경기 연속 무승부라는, 이기지도 지지도 못하는 흐름에 갇혔습니다.`;
    return `${len}연패에 빠져 있습니다.`;
  }

  function formStrip(results) {
    return (results || []).map((r) => RESULT_WORD[r] || "?").join(" ");
  }

  /* ---------- section builders ---------- */

  function leadSection(team, ctx) {
    const t = team.table;
    const total = num(t.teams);
    const paragraphs = [];

    const ppgRank = ctx.ranks.ppg[team.team_id] || t.rank;
    const identity = ctx.mean.ppg > 0 && num(t.ppg) >= ctx.mean.ppg ? "평균 위" : "평균 아래";

    paragraphs.push(
      `${team.season}시즌 ${team.league_name} ${num(t.played)}경기를 치른 ${topic(team.full)} 승점 ${num(t.points)}점, ` +
        `${recordText(t)}로 ${placeWord(num(t.rank), total)}에 있습니다. ` +
        `경기당 승점 ${two(t.ppg)}점은 리그 평균 ${two(ctx.mean.ppg)}점보다 ${identity}이고, 이 부문 ${ppgRank}위입니다.`
    );

    const gapBits = [];
    if (t.above && Number.isFinite(t.gap_above)) {
      gapBits.push(`위로는 ${subject(t.above)} ${num(t.gap_above)}점 앞서 있습니다`);
    }
    if (t.below && Number.isFinite(t.gap_below)) {
      gapBits.push(
        num(t.gap_below) === 0
          ? `아래로는 ${subject(t.below)} 같은 승점으로 붙어 있습니다`
          : `아래로는 ${subject(t.below)} ${num(t.gap_below)}점 차로 쫓아옵니다`
      );
    }
    if (gapBits.length) paragraphs.push(`${gapBits.join(". ")}.`);
    paragraphs.push(team.context.detail);

    if (num(t.remaining) > 0) {
      paragraphs.push(
        `남은 경기는 ${num(t.remaining)}경기. 최대로 얻을 수 있는 승점이 ${num(t.remaining) * 3}점이니, ` +
          `지금의 ${num(t.points)}점이 어디까지 갈 수 있는지는 여기서 갈립니다.`
      );
    } else {
      paragraphs.push("정규 일정이 사실상 끝났습니다. 남은 것은 이 순위가 남기는 기록입니다.");
    }

    return { id: "lead", title: "지금 이 팀은 어디에 서 있나", paragraphs };
  }

  function identitySection(team, ctx) {
    const tags = team.context.tags || [];
    const paragraphs = [];
    const gfRank = ctx.ranks.gf[team.team_id];
    const gaRank = ctx.ranks.ga[team.team_id];
    const total = num(team.table.teams);

    paragraphs.push(
      `숫자로 본 팀의 얼굴은 이렇습니다. 경기당 ${two(team.scoring.gf_per_game)}골을 넣어 득점 ${gfRank}위, ` +
        `경기당 ${two(team.scoring.ga_per_game)}골을 내줘 실점 적은 순으로 ${gaRank}위. ` +
        `리그 평균은 득점 ${two(ctx.mean.gf)}골, 실점 ${two(ctx.mean.ga)}골입니다.`
    );

    if (gfRank <= 3 && gaRank <= 3) {
      paragraphs.push("공격과 수비가 동시에 리그 최상위권입니다. 이런 팀이 순위표 위쪽에 없으면 그게 더 이상한 일입니다.");
    } else if (gfRank <= 4 && gaRank >= total - 3) {
      paragraphs.push("넣는 건 리그에서 손꼽히는데 막는 게 안 됩니다. 이기는 경기도, 무너지는 경기도 모두 화끈한 유형입니다.");
    } else if (gaRank <= 4 && gfRank >= total - 3) {
      paragraphs.push("잘 막지만 못 넣습니다. 0-0과 0-1 사이에서 시즌이 흘러가는, 보는 사람이 가장 답답한 유형입니다.");
    } else if (gfRank >= total - 2 && gaRank >= total - 2) {
      paragraphs.push("공격도 수비도 리그 최하위권입니다. 특정 포지션의 문제가 아니라 팀 전체의 문제라는 뜻입니다.");
    }

    if (tags.length) {
      paragraphs.push(`이 팀을 한 단어씩으로 요약하면 ${tags.join(" · ")}입니다.`);
    }
    return { id: "identity", title: "숫자가 말하는 팀의 성격", paragraphs };
  }

  function attackSection(team, ctx) {
    const t = team.table;
    const s = team.scoring;
    const played = num(t.played);
    const paragraphs = [];
    const scorers = team.squad.top_scorers || [];
    const top = scorers[0];

    paragraphs.push(
      `${played}경기에서 ${num(t.gf)}골. 경기당 ${two(s.gf_per_game)}골입니다. ` +
        `그중 ${num(s.failed_to_score)}경기(${percent(s.failed_to_score, played)}%)에서는 한 골도 넣지 못했습니다.`
    );

    if (percent(s.failed_to_score, played) >= 35) {
      paragraphs.push("세 경기에 한 번 이상 무득점이라는 건, 이기고 지고의 문제 이전에 경기를 만들지 못하고 있다는 신호입니다.");
    } else if (percent(s.failed_to_score, played) <= 15) {
      paragraphs.push("무득점 경기가 이 정도로 적다는 건 어떤 상대를 만나도 득점 루트를 하나는 확보한다는 뜻입니다.");
    }

    if (top && num(top.goals) > 0) {
      const share = Math.round(num(team.squad.goal_share) * 100);
      paragraphs.push(
        `최다 득점은 ${top.name}${top.back_no ? `(${top.back_no}번)` : ""}의 ${num(top.goals)}골. ` +
          `팀 득점의 ${share}%입니다.` +
          (top.departed ? " 다만 이 선수는 시즌 도중 팀을 떠났습니다." : "") +
          (share >= 30
            ? " 한 명이 팀 공격의 3분의 1 가까이를 책임지고 있다는 건, 그 선수가 멈추면 팀도 멈춘다는 뜻입니다."
            : share <= 18
            ? " 특정 선수에게 몰리지 않고 여러 명이 나눠 넣고 있습니다. 상대가 한 명만 지워서는 막히지 않는 구조입니다."
            : "")
      );
    }

    const others = scorers.slice(1, 4).filter((p) => num(p.goals) > 0);
    if (others.length) {
      paragraphs.push(
        `그 뒤를 ${others
          .map((p) => `${p.name} ${num(p.goals)}골${p.departed ? "(이적)" : ""}`)
          .join(", ")}이 받치고 있습니다.`
      );
    }

    const gone = scorers.filter((p) => p.departed && num(p.goals) > 0);
    if (gone.length) {
      /* The particle follows the last player's name, not the closing bracket. */
      const tail = hasFinalConsonant(gone[gone.length - 1].name) ? "이" : "가";
      paragraphs.push(
        `한 가지 짚어둘 점은 ${gone
          .map((p) => `${p.name}(${num(p.goals)}골)`)
          .join(", ")}${tail} 시즌 도중 팀을 떠났다는 사실입니다. ` +
          "위 숫자에는 남아 있지만, 남은 일정에서는 쓸 수 없는 득점입니다."
      );
    }

    const assists = (team.squad.top_assists || []).filter((p) => num(p.assists) > 0).slice(0, 2);
    if (assists.length) {
      paragraphs.push(
        `도움은 ${assists.map((p) => `${p.name} ${num(p.assists)}개`).join(", ")}. 득점의 출발점이 어디인지 보여주는 이름들입니다.`
      );
    }

    if (s.biggest_win && num(s.biggest_win.gf) - num(s.biggest_win.ga) >= 2) {
      const w = s.biggest_win;
      paragraphs.push(
        `시즌 최고의 화력은 ${dateText(w.date)} ${ctx.nameOf(w)}전 ${num(w.gf)}-${num(w.ga)} 승리였습니다.`
      );
    }

    return { id: "attack", title: "공격 — 누가, 얼마나 넣고 있나", paragraphs };
  }

  function defenseSection(team, ctx) {
    const t = team.table;
    const s = team.scoring;
    const played = num(t.played);
    const paragraphs = [];

    paragraphs.push(
      `${num(t.ga)}실점, 경기당 ${two(s.ga_per_game)}골. 무실점 경기는 ${num(s.clean_sheets)}번으로 ` +
        `전체의 ${percent(s.clean_sheets, played)}%입니다.`
    );

    if (percent(s.clean_sheets, played) >= 35) {
      paragraphs.push("세 경기에 한 번 이상 상대 골문을 완전히 잠급니다. 한 골만 넣으면 이기는 경기를 스스로 만들어내는 팀입니다.");
    } else if (num(s.ga_per_game) >= 1.8) {
      paragraphs.push("경기당 두 골 가까이 내주면 공격이 아무리 좋아도 승점이 쌓이지 않습니다. 실점 관리가 시즌의 발목입니다.");
    }

    if (s.biggest_loss && num(s.biggest_loss.ga) - num(s.biggest_loss.gf) >= 3) {
      const l = s.biggest_loss;
      const where = l.venue === "A" ? "원정에서의" : "홈에서의";
      paragraphs.push(
        `가장 아팠던 날은 ${dateText(l.date)} ${ctx.nameOf(l)} ${where} ${num(l.gf)}-${num(l.ga)} 패배였습니다.`
      );
    }

    paragraphs.push(
      `양 팀이 모두 득점한 경기는 ${num(s.both_scored)}번(${percent(s.both_scored, played)}%), ` +
        `한 골 차로 갈린 경기는 ${num(s.one_goal_games)}번(${percent(s.one_goal_games, played)}%)입니다.` +
        (percent(s.one_goal_games, played) >= 45
          ? " 절반에 가까운 경기가 한 골 싸움이라는 건, 세트피스 하나·교체 하나가 순위를 바꾸고 있다는 뜻입니다."
          : "")
    );

    return { id: "defense", title: "수비 — 얼마나 버티고 있나", paragraphs };
  }

  function venueSection(team) {
    const home = team.splits.home;
    const away = team.splits.away;
    const paragraphs = [];
    const diff = num(home.ppg) - num(away.ppg);

    paragraphs.push(
      `홈 ${num(home.played)}경기 ${recordText(home)}로 경기당 ${two(home.ppg)}점, ` +
        `원정 ${num(away.played)}경기 ${recordText(away)}로 경기당 ${two(away.ppg)}점입니다.`
    );

    if (diff >= 0.8) {
      paragraphs.push(
        `홈에서만 경기당 ${two(diff)}점을 더 법니다. 홈 경기를 지키는 것만으로 시즌이 굴러가지만, ` +
          "뒤집어 말하면 원정에서 승점을 놓친 만큼 순위가 눌려 있다는 뜻이기도 합니다."
      );
    } else if (diff <= -0.4) {
      paragraphs.push(
        "원정에서 오히려 더 잘합니다. 내려서서 역습하는 경기가 편하고, 주도권을 쥐어야 하는 홈 경기에서 애를 먹는 유형입니다."
      );
    } else {
      paragraphs.push("홈과 원정의 차이가 거의 없습니다. 장소를 타지 않는, 기복이 적은 팀이라는 뜻입니다.");
    }

    if (num(home.gf) > 0 || num(away.gf) > 0) {
      paragraphs.push(
        `득점도 홈 ${num(home.gf)}골 · 원정 ${num(away.gf)}골, 실점은 홈 ${num(home.ga)}골 · 원정 ${num(away.ga)}골로 갈립니다.`
      );
    }
    return { id: "venue", title: "홈과 원정 — 두 개의 얼굴", paragraphs };
  }

  function arcSection(team) {
    const trend = team.trend || {};
    const first = trend.first_half || {};
    const second = trend.second_half || {};
    const streaks = team.form.streaks || {};
    const paragraphs = [];

    if (Number.isFinite(trend.best_rank) && Number.isFinite(trend.worst_rank)) {
      if (num(trend.best_rank) === num(trend.worst_rank)) {
        paragraphs.push(`시즌 내내 ${num(trend.best_rank)}위 자리를 지켰습니다. 흔들림이 거의 없었다는 뜻입니다.`);
      } else {
        paragraphs.push(
          `시즌 최고 순위는 ${num(trend.best_rank)}위, 최저는 ${num(trend.worst_rank)}위였습니다. ` +
            `지금은 ${num(team.table.rank)}위이니, 그 사이 어디쯤에서 시즌이 정리되고 있는 셈입니다.`
        );
      }
    }

    if (num(first.played) > 0 && num(second.played) > 0) {
      const delta = num(second.ppg) - num(first.ppg);
      let verdict = "전반기와 후반기의 흐름이 거의 같습니다.";
      if (delta >= 0.25) verdict = "후반기 들어 확실히 올라왔습니다. 시즌을 뒤에서부터 살려낸 팀입니다.";
      else if (delta <= -0.25) verdict = "후반기 들어 눈에 띄게 떨어졌습니다. 시즌 초의 팀과 지금의 팀이 다릅니다.";
      paragraphs.push(
        `전반기 ${num(first.played)}경기 경기당 ${two(first.ppg)}점, 후반기 ${num(second.played)}경기 경기당 ${two(second.ppg)}점. ${verdict}`
      );
    }

    const runBits = [];
    if (num(streaks.longest_win) >= 3) runBits.push(`최장 ${num(streaks.longest_win)}연승`);
    if (num(streaks.longest_unbeaten) >= 5) runBits.push(`최장 ${num(streaks.longest_unbeaten)}경기 무패`);
    if (num(streaks.longest_winless) >= 5) runBits.push(`최장 ${num(streaks.longest_winless)}경기 무승`);
    if (num(streaks.longest_loss) >= 3) runBits.push(`최장 ${num(streaks.longest_loss)}연패`);
    if (runBits.length) {
      paragraphs.push(`시즌을 관통한 구간 기록은 ${runBits.join(", ")}입니다.`);
    }
    if (num(streaks.longest_winless) >= 10) {
      paragraphs.push(
        `${num(streaks.longest_winless)}경기 동안 이기지 못한 구간이 있었다는 건 단순한 부진이 아닙니다. ` +
          "그 시기에 시즌의 방향이 결정됐다고 보는 게 맞습니다."
      );
    }
    return { id: "arc", title: "시즌의 궤적", paragraphs };
  }

  function formSection(team) {
    const form = team.form || {};
    const last5 = form.last5_record || {};
    const last10 = form.last10_record || {};
    const paragraphs = [];

    paragraphs.push(
      `최근 5경기는 ${formStrip(form.last5)} — ${recordText(last5)}로 승점 ${num(last5.points)}점, ` +
        `${num(last5.gf)}득점 ${num(last5.ga)}실점입니다.`
    );

    const recentPpg = num(last5.played) > 0 ? num(last5.points) / num(last5.played) : 0;
    const seasonPpg = num(team.table.ppg);
    const delta = recentPpg - seasonPpg;
    if (delta >= 0.4) {
      paragraphs.push("시즌 평균보다 확실히 좋은 흐름입니다. 지금이 이 팀의 가장 좋은 시기일 수 있습니다.");
    } else if (delta <= -0.4) {
      paragraphs.push("시즌 평균에 한참 못 미칩니다. 가장 중요한 시기에 가장 나쁜 폼을 만났습니다.");
    } else {
      paragraphs.push("시즌 평균과 크게 다르지 않은, 이 팀다운 흐름이 이어지고 있습니다.");
    }

    const streak = streakSentence(form.streaks);
    if (streak) paragraphs.push(streak);

    if (num(last10.played) >= 10) {
      paragraphs.push(
        `최근 10경기로 넓혀 봐도 ${recordText(last10)} 승점 ${num(last10.points)}점. 경기당 ${two(num(last10.points) / 10)}점 페이스입니다.`
      );
    }
    return { id: "form", title: "최근 흐름", paragraphs };
  }

  function crowdSection(team) {
    const att = team.attendance;
    if (!att || !num(att.avg)) return null;
    const paragraphs = [];
    paragraphs.push(
      `홈 ${num(att.games)}경기 평균 관중은 ${comma(att.avg)}명, 누적 ${comma(att.total)}명입니다.`
    );
    if (num(att.home_fans_avg) && num(att.away_fans_avg)) {
      paragraphs.push(
        `이 가운데 홈팬이 평균 ${comma(att.home_fans_avg)}명, 원정팬이 ${comma(att.away_fans_avg)}명입니다. ` +
          (num(att.away_fans_avg) >= 1500
            ? "원정석이 이 정도로 찬다는 건 이 팀의 홈경기가 리그의 흥행 카드라는 뜻이기도 합니다."
            : "관중석의 절대 다수가 홈팬이라는 뜻입니다.")
      );
    }
    return { id: "crowd", title: "관중석에서 본 시즌", paragraphs };
  }

  function squadSection(team) {
    const squad = team.squad || {};
    const paragraphs = [];
    const bits = [];
    if (num(squad.size)) bits.push(`등록 선수 ${num(squad.size)}명`);
    if (squad.avg_age) bits.push(`평균 연령 ${one(squad.avg_age)}세`);
    if (num(squad.foreign)) bits.push(`외국인 선수 ${num(squad.foreign)}명`);
    if (bits.length) paragraphs.push(`${bits.join(" · ")}으로 시즌을 치르고 있습니다.`);

    if (squad.avg_age) {
      const age = num(squad.avg_age);
      if (age <= 25.0) {
        paragraphs.push("리그에서도 손꼽히게 젊은 스쿼드입니다. 기복은 각오해야 하지만, 잘 풀리면 이 시즌이 팀의 출발점이 됩니다.");
      } else if (age >= 28.0) {
        paragraphs.push("경험이 많은 스쿼드입니다. 큰 경기에서 흔들리지 않는 대신, 일정이 몰릴 때 체력 관리가 변수입니다.");
      }
    }

    const workhorses = (squad.top_scorers || [])
      .filter((p) => num(p.apps) > 0 && !p.departed)
      .slice(0, 3);
    if (workhorses.length) {
      paragraphs.push(
        `공격 지표 상위에 있는 이름은 ${workhorses
          .map((p) => `${p.name}(${num(p.apps)}경기 ${num(p.goals)}골 ${num(p.assists)}도움)`)
          .join(", ")}입니다.`
      );
    }
    return paragraphs.length ? { id: "squad", title: "스쿼드", paragraphs } : null;
  }

  function outlookSection(team) {
    const t = team.table;
    const remaining = num(t.remaining);
    const paragraphs = [];

    if (remaining <= 0) {
      paragraphs.push("남은 일정이 없습니다. 이 순위가 곧 이 시즌의 결론입니다.");
      return { id: "outlook", title: "남은 시즌", paragraphs };
    }

    const maxPoints = num(t.points) + remaining * 3;
    paragraphs.push(
      `남은 ${remaining}경기를 모두 이기면 승점 ${maxPoints}점, 모두 비기면 ${num(t.points) + remaining}점입니다. ` +
        `현재 경기당 ${two(t.ppg)}점 페이스를 유지하면 ${Math.round(num(t.points) + remaining * num(t.ppg))}점 언저리에서 시즌을 마칩니다.`
    );

    if (team.league === "K1") {
      const gapLeader = num(t.gap_to_leader);
      if (num(t.rank) >= 11) {
        paragraphs.push(
          "이제부터는 순위표를 올려다볼 때가 아닙니다. 승강 플레이오프를 피하는 것, 그 한 가지가 남은 시즌의 전부입니다."
        );
      } else if (num(t.rank) > 6 && num(t.gap_to_cut) > 0) {
        paragraphs.push(
          `파이널A 진입선인 6위와는 ${num(t.gap_to_cut)}점 차입니다. 스플릿 전까지 남은 경기에서 이 격차를 지우지 못하면 ` +
            "시즌의 목표는 자연스럽게 아래쪽으로 옮겨갑니다."
        );
      } else if (num(t.rank) <= 6 && gapLeader > 0) {
        paragraphs.push(
          gapLeader <= remaining
            ? `선두와 ${gapLeader}점 차. 맞대결을 포함해 남은 경기에서 승점을 쌓으면 직접 뒤집을 수 있는 거리입니다.`
            : `선두와 ${gapLeader}점 차는 남은 ${remaining}경기로 따라잡기에는 먼 거리입니다. ` +
              "현실적인 목표는 우승이 아니라 이 자리를 지키는 쪽에 가깝습니다."
        );
      }
    } else {
      if (num(t.rank) === 1) {
        paragraphs.push("다이렉트 승격은 2위와의 간격을 유지하는 싸움입니다. 화려할 필요 없이, 지지 않는 경기를 반복하면 됩니다.");
      } else if (num(t.rank) <= 5) {
        paragraphs.push(
          "플레이오프 대진은 순위 한 칸으로 완전히 달라집니다. 남은 경기는 승격 경쟁이자 대진 확보 싸움입니다."
        );
      } else if (num(t.gap_to_cut) > 0) {
        paragraphs.push(
          `플레이오프 컷과 ${num(t.gap_to_cut)}점 차. 최소 ${Math.ceil(num(t.gap_to_cut) / 3)}승 이상을 앞선 팀보다 더 쌓아야 하는 상황입니다.`
        );
      }
    }

    return { id: "outlook", title: "남은 시즌, 무엇이 남았나", paragraphs };
  }

  function profileSection(team) {
    const p = team.profile || {};
    const paragraphs = [];
    if (p.manager) {
      paragraphs.push(
        `${p.manager} 감독 체제입니다.` + (p.manager_style ? ` ${p.manager_style}` : "")
      );
    }
    if (p.identity) paragraphs.push(p.identity);
    if (p.objective) paragraphs.push(p.objective);
    if (p.note) paragraphs.push(p.note);
    return paragraphs.length ? { id: "profile", title: "벤치와 방향성", paragraphs } : null;
  }

  function headlineFor(team) {
    const t = team.table;
    const band = team.context.band;
    const streaks = team.form.streaks || {};
    const name = team.name;

    if (num(streaks.current_len) >= 4 && streaks.current_type === "W") {
      return `${num(t.rank)}위 ${name}, ${num(streaks.current_len)}연승으로 계절을 바꾸다`;
    }
    if (num(streaks.current_len) >= 4 && streaks.current_type === "L") {
      return `${num(t.rank)}위 ${name}, 멈추지 않는 ${num(streaks.current_len)}연패`;
    }
    if (num(streaks.longest_winless) >= 12 && band === "강등권") {
      return `${name}, ${num(streaks.longest_winless)}경기의 긴 겨울`;
    }
    if (band === "우승 경쟁" && num(t.rank) === 1) {
      return `${name}, 승점 ${num(t.points)}점의 선두에서 내려다보는 풍경`;
    }
    if (band === "자동 승격권") {
      return `${name}, 승격이 목표가 아니라 일정이 된 시즌`;
    }
    if (band === "강등권") {
      return `${name}, 남은 ${num(t.remaining)}경기가 전부 결승전`;
    }
    return `${num(t.rank)}위 ${name} — ${band}의 한가운데서`;
  }

  function build(team, leagueTable) {
    if (!team || !team.table) return null;
    const table = leagueTable || [];
    const nameById = {};
    table.forEach((row) => {
      if (row && row.team_id) nameById[row.team_id] = row.name;
    });
    const ctx = {
      /* Club ids beat display strings: "수원 FC" and "수원 삼성" must stay distinct. */
      nameOf: (fixture) =>
        nameById[fixture?.opponent_id] || shortName(fixture?.opponent) || "상대",
      ranks: {
        ppg: rankBy(table, (r) => perGame(r, "points"), true),
        gf: rankBy(table, (r) => perGame(r, "gf"), true),
        ga: rankBy(table, (r) => perGame(r, "ga"), false),
      },
      mean: {
        ppg: leagueMean(table, (r) => perGame(r, "points")),
        gf: leagueMean(table, (r) => perGame(r, "gf")),
        ga: leagueMean(table, (r) => perGame(r, "ga")),
      },
    };

    const sections = [
      leadSection(team, ctx),
      profileSection(team),
      identitySection(team, ctx),
      attackSection(team, ctx),
      defenseSection(team, ctx),
      venueSection(team),
      arcSection(team),
      formSection(team),
      crowdSection(team),
      squadSection(team),
      outlookSection(team),
    ].filter(Boolean);

    return {
      headline: headlineFor(team),
      standfirst:
        `${team.season} ${team.league_name} ${num(team.table.played)}경기 기준 · ` +
        `승점 ${num(team.table.points)} · ${team.context.band}`,
      sections,
      generated_at: new Date().toISOString(),
    };
  }

  window.TeamColumn = { build };
})();
