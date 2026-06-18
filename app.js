const fallbackPredictions = {
  generatedAt: new Date().toISOString(),
  summary: "目前尚未讀取到每日資料。",
  views: {
    today: [],
    past: [],
    future: []
  },
  predictions: []
};

const data = window.SCORE_PREDICTIONS || fallbackPredictions;
const views = {
  today: Array.isArray(data.views?.today) ? data.views.today : Array.isArray(data.predictions) ? data.predictions : [],
  past: Array.isArray(data.views?.past) ? data.views.past : [],
  future: Array.isArray(data.views?.future) ? data.views.future : []
};
const allGames = [...views.today, ...views.past, ...views.future];

const leagueProfiles = {
  "KBO 韓國職棒": {
    region: "韓國",
    description: "韓職盤口判斷重點放在先發投手、牛棚消耗與近況長打。"
  },
  "NPB 日本職棒": {
    region: "日本",
    description: "日職常受先發壓制力與守備效率影響，大小分盤需要特別留意。"
  },
  "CPBL 中華職棒": {
    region: "台灣",
    description: "中職預測重點放在打線串聯、牛棚穩定度與主客場差異。"
  }
};

const leagueFilter = document.querySelector("#league-filter");
const confidenceFilter = document.querySelector("#confidence-filter");
const confidenceOutput = document.querySelector("#confidence-output");
const resetButton = document.querySelector("#reset-filters");
const leagueBoard = document.querySelector("#league-board");
const viewTabs = document.querySelectorAll(".view-tab");
const tabViews = ["today-schedule", "today", "past", "future"];
let activeView = "today-schedule";

const formatDateTime = (value) =>
  new Intl.DateTimeFormat("zh-TW", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const formatFullDateTime = (value) =>
  new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

function actualScore(game, side) {
  const score = side === "home" ? game.actualHomeScore : game.actualAwayScore;
  return Number.isFinite(Number(score)) ? `<span class="actual-score">比分 ${score}</span>` : "";
}

function formatTotal(game) {
  const line =
    game.totalLine !== null && game.totalLine !== undefined && Number.isFinite(Number(game.totalLine))
      ? ` ${Number(game.totalLine).toFixed(1)}`
      : "";
  return `${game.totalPick || "未取得"}${line}`;
}

function getAiConfidence(game) {
  const value = Number(game.aiConfidence);
  return Number.isFinite(value) ? value : null;
}

function renderAnalysisItems(game) {
  const items = Array.isArray(game.analysisItems) ? game.analysisItems.filter(Boolean) : [];
  if (items.length === 0) return "";
  return `
    <div class="analysis-block" aria-label="分析重點">
      <span>分析重點</span>
      <ul>
        ${items.map((item) => `<li>${item}</li>`).join("")}
      </ul>
    </div>
  `;
}

function renderAiPrediction(game) {
  const aiConfidence = getAiConfidence(game);
  const hasAiScore =
    Number.isFinite(Number(game.aiPredictedAwayScore)) && Number.isFinite(Number(game.aiPredictedHomeScore));
  if (game.aiPredictionSource === "未啟用 AI" || (!hasAiScore && aiConfidence === null)) return "";
  const score =
    hasAiScore
      ? `${game.awayTeam} ${game.aiPredictedAwayScore} : ${game.aiPredictedHomeScore} ${game.homeTeam}`
      : "未取得";
  const reasons = Array.isArray(game.aiRationale) ? game.aiRationale.filter(Boolean) : [];

  return `
    <div class="ai-block" aria-label="AI 智能預測">
      <div class="ai-block__top">
        <span>AI 智能預測</span>
        <strong>${aiConfidence ?? "--"}%</strong>
      </div>
      <div class="ai-picks">
        <div>
          <span>預測比分</span>
          <strong>${score}</strong>
        </div>
        <div>
          <span>建議下注</span>
          <strong>${game.aiBetRecommendation || "觀望"}</strong>
        </div>
        <div>
          <span>大小分</span>
          <strong>${game.aiTotalPick || game.totalPick || "未取得"}</strong>
        </div>
        <div>
          <span>讓分</span>
          <strong>${game.aiSpreadPick || game.spreadPick || "未取得"}</strong>
        </div>
      </div>
      ${
        reasons.length
          ? `<ul>${reasons.map((item) => `<li>${item}</li>`).join("")}</ul>`
          : ""
      }
      ${game.aiRiskNote ? `<p>${game.aiRiskNote}</p>` : ""}
    </div>
  `;
}

function availablePick(value) {
  return value && value !== "未取得" && !String(value).includes("未取得");
}

function formatConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) ? `${Math.round(confidence)}%` : "--";
}

function hasChatGptPrediction(game) {
  return game.aiPredictionSource && game.aiPredictionSource !== "未啟用 AI" && getAiConfidence(game) !== null;
}

function renderBetRecommendation(game) {
  if (hasChatGptPrediction(game)) {
    const aiPicks = [];
    if (availablePick(game.aiSpreadPick)) aiPicks.push(`讓分：${game.aiSpreadPick}`);
    if (availablePick(game.aiTotalPick)) aiPicks.push(`大小分：${game.aiTotalPick}`);
    const recommendation = game.aiBetRecommendation || aiPicks[0] || "觀望";

    return `
      <div class="bet-recommendation bet-recommendation--ai">
        <span>建議下注</span>
        <strong>${recommendation}</strong>
        <em>ChatGPT 信心 ${formatConfidence(game.aiConfidence)}</em>
        ${aiPicks.map((pick) => `<p>${pick}</p>`).join("")}
        <small>信心來源：ChatGPT 智能分析 (${game.aiPredictionSource})</small>
      </div>
    `;
  }

  const picks = [];
  if (availablePick(game.spreadPick)) {
    picks.push({
      label: "讓分",
      text: game.spreadPick,
      confidence: game.spreadConfidence
    });
  }
  if (availablePick(game.totalPick)) {
    const totalLine =
      game.totalLine !== null && game.totalLine !== undefined && Number.isFinite(Number(game.totalLine))
        ? ` ${Number(game.totalLine).toFixed(1)}`
        : "";
    picks.push({
      label: "大小分",
      text: `${game.totalPick}${totalLine}`,
      confidence: game.totalConfidence
    });
  }

  if (!picks.length) {
    return `
      <div class="bet-recommendation bet-recommendation--waiting">
        <span>建議下注</span>
        <strong>等待盤口</strong>
        <p>目前還沒抓到大小分或讓分，先不給過盤建議。</p>
      </div>
    `;
  }

  return `
    <div class="bet-recommendation">
      <span>建議下注</span>
      <strong>${picks[0].label}：${picks[0].text}</strong>
      <em>過盤信心 ${formatConfidence(picks[0].confidence)}</em>
      ${picks
        .slice(1)
        .map((pick) => `<p>${pick.label}：${pick.text} <b>信心 ${formatConfidence(pick.confidence)}</b></p>`)
        .join("")}
      ${game.confidenceSource ? `<small>信心來源：${game.confidenceSource}</small>` : ""}
    </div>
  `;
}

function resultClass(result) {
  if (result === "過盤") return "is-win";
  if (result === "未過") return "is-loss";
  if (result === "走水") return "is-push";
  return "";
}

function renderSettlement(game) {
  const rows = [];
  if (game.spreadResult) rows.push({ label: "讓分結果", value: game.spreadResult });
  if (game.totalResult) rows.push({ label: "大小分結果", value: game.totalResult });
  if (!rows.length) return "";

  return `
    <div class="settlement-block" aria-label="賽果核對">
      <span>賽果核對</span>
      ${rows
        .map(
          (row) => `
            <p>
              ${row.label}
              <strong class="${resultClass(row.value)}">${row.value}</strong>
            </p>
          `
        )
        .join("")}
    </div>
  `;
}

function renderDetailedAnalysis(game) {
  if (!game.detailedAnalysis) return "";
  return `
    <div class="detailed-analysis" aria-label="重點分析">
      <span>重點分析</span>
      <p>${game.detailedAnalysis}</p>
    </div>
  `;
}

function createPredictionCard(game, options = {}) {
  const hasFinalScore =
    game.status === "final" &&
    Number.isFinite(Number(game.actualAwayScore)) &&
    Number.isFinite(Number(game.actualHomeScore));
  const showActual = Boolean(options.showActual || hasFinalScore);
  const card = document.createElement("article");
  card.className = "prediction-card";
  card.innerHTML = `
    <div class="card-top">
      <span class="league">${game.league}</span>
      <span class="date-pill">${formatDateTime(game.startTime)} · ${game.venue || "球場未定"}</span>
    </div>
    <div class="teams">
      <div class="team-row">
        <span class="team-name">${game.awayTeam}${showActual ? actualScore(game, "away") : ""}</span>
        <span class="team-side">客</span>
      </div>
      <div class="team-row">
        <span class="team-name">${game.homeTeam}${showActual ? actualScore(game, "home") : ""}</span>
        <span class="team-side">主</span>
      </div>
    </div>
    ${renderBetRecommendation(game)}
    ${renderDetailedAnalysis(game)}
    <div class="market-grid" aria-label="預測項目">
      <div>
        <span>讓分過盤</span>
        <strong>${game.spreadPick || "未取得"}</strong>
      </div>
      <div>
        <span>大小分</span>
        <strong>${formatTotal(game)}</strong>
      </div>
      <div>
        <span>盤口來源</span>
        <strong>${game.oddsSource || "未取得盤口"}</strong>
      </div>
    </div>
    ${renderAiPrediction(game)}
    ${renderSettlement(game)}
    ${renderAnalysisItems(game)}
    <p class="note">${game.note || game.source || ""}</p>
  `;
  return card;
}

function createScheduleRow(game) {
  const row = document.createElement("article");
  row.className = "schedule-row";
  row.innerHTML = `
    <div>
      <strong>${game.awayTeam} @ ${game.homeTeam}</strong>
      <span>${game.league}</span>
    </div>
    <div>${formatDateTime(game.startTime)}</div>
    <div>${game.venue || "球場未定"}</div>
  `;
  return row;
}

function leagueRank(league) {
  const order = ["KBO 韓國職棒", "NPB 日本職棒", "CPBL 中華職棒"];
  const index = order.indexOf(league);
  return index === -1 ? order.length : index;
}

function groupByLeague(items) {
  return [...items]
    .sort((a, b) => leagueRank(a.league) - leagueRank(b.league) || new Date(a.startTime) - new Date(b.startTime))
    .reduce((groups, item) => {
      const league = item.league || "其他聯盟";
      if (!groups.has(league)) groups.set(league, []);
      groups.get(league).push(item);
      return groups;
    }, new Map());
}

function createTodayLeagueSection(league, items, options) {
  const section = document.createElement("section");
  section.className = "today-league-section";
  const content = document.createElement("div");
  content.className = options.contentClass;
  content.replaceChildren(...items.map(options.createItem));

  section.innerHTML = `
    <div class="today-league-section__heading">
      <strong>${league}</strong>
      <span>${items.length} ${options.unit}</span>
    </div>
  `;
  section.append(content);
  return section;
}

function renderTodayLeagueGroups(container, items, options) {
  const sections = [...groupByLeague(items)].map(([league, leagueItems]) =>
    createTodayLeagueSection(league, leagueItems, options)
  );
  container.replaceChildren(...sections);
}

function populateLeagues() {
  const leagues = [...new Set(allGames.map((item) => item.league).filter(Boolean))].sort();
  leagueFilter.replaceChildren(new Option("全部", "all"));
  for (const league of leagues) {
    leagueFilter.append(new Option(league, league));
  }
}

function renderLeagueBoard() {
  const leagues = [...new Set(allGames.map((item) => item.league).filter(Boolean))].sort();
  const cards = leagues.map((league) => {
    const profile = leagueProfiles[league] || {
      region: "亞洲",
      description: "每日依照賽程、盤口與近期狀態整理過盤方向。"
    };
    const todayCount = views.today.filter((game) => game.league === league).length;
    const futureCount = views.future.filter((game) => game.league === league).length;
    const card = document.createElement("article");
    card.className = "league-card";
    card.innerHTML = `
      <div class="league-card__meta">
        <span>${profile.region}</span>
        <span>今日 ${todayCount} 場</span>
        <span>未來 ${futureCount} 場</span>
      </div>
      <strong>${league}</strong>
      <p>${profile.description}</p>
    `;
    return card;
  });
  leagueBoard.replaceChildren(...cards);
}

function filtered(viewName, options = {}) {
  const { featuredOnly = false, ignoreConfidence = false } = options;
  const league = leagueFilter.value;
  const minimumConfidence = Number(confidenceFilter.value);
  return views[viewName].filter((game) => {
    const matchesLeague = league === "all" || game.league === league;
    if (!matchesLeague) return false;
    if (featuredOnly && !game.isFeatured) return false;
    if (ignoreConfidence) return true;
    const marketConfidence = Number(game.betConfidence ?? game.totalConfidence ?? game.spreadConfidence ?? 0);
    const confidence = viewName === "future" ? 100 : getAiConfidence(game) ?? marketConfidence;
    return matchesLeague && confidence >= minimumConfidence;
  });
}

function updateInsights(items) {
  const predicted = items.filter((item) => getAiConfidence(item) !== null);
  const average =
    predicted.length === 0
      ? 0
      : Math.round(predicted.reduce((sum, item) => sum + getAiConfidence(item), 0) / predicted.length);
  const highest = items.reduce(
    (best, item) => {
      if (!item.totalPick || item.totalPick === "未取得") return best;
      const next = { ...best, [item.totalPick]: (best[item.totalPick] || 0) + 1 };
      return next;
    },
    { 大分過盤: 0, 小分過盤: 0 }
  );
  const totalLean =
    highest.大分過盤 || highest.小分過盤
      ? `${highest.大分過盤 >= highest.小分過盤 ? "大分" : "小分"}較多`
      : "--";
  const leagueCounts = items.reduce((counts, item) => {
    counts[item.league] = (counts[item.league] || 0) + 1;
    return counts;
  }, {});
  const topLeague = Object.entries(leagueCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "--";

  document.querySelector("#average-confidence").textContent = predicted.length ? `${average}%` : "--%";
  document.querySelector("#highest-total").textContent = totalLean;
  document.querySelector("#top-league").textContent = topLeague;
}

function updateSettlementRecord() {
  const results = allGames.flatMap((game) => [game.spreadResult, game.totalResult]).filter(Boolean);
  const counts = results.reduce(
    (record, result) => {
      if (result === "過盤") record.win += 1;
      if (result === "未過") record.loss += 1;
      if (result === "走水") record.push += 1;
      return record;
    },
    { win: 0, loss: 0, push: 0 }
  );
  const values = document.querySelectorAll(".record-grid strong");
  if (values[0]) values[0].textContent = counts.win;
  if (values[1]) values[1].textContent = counts.loss;
  if (values[2]) values[2].textContent = counts.push;
}

function itemsForView(viewName) {
  if (viewName === "today-schedule") return filtered("today", { ignoreConfidence: true });
  if (viewName === "today") return filtered("today", { featuredOnly: true });
  return filtered(viewName);
}

function renderView(viewName) {
  const items = itemsForView(viewName);
  const grid = document.querySelector(`#${viewName}-grid`);
  const empty = document.querySelector(`#${viewName}-empty`);
  const status = document.querySelector(`#${viewName}-status`);
  const leagueText = leagueFilter.value === "all" ? "全部聯盟" : leagueFilter.value;

  if (viewName === "today-schedule") {
    renderTodayLeagueGroups(grid, items, {
      contentClass: "schedule-table",
      createItem: createScheduleRow,
      unit: "場比賽"
    });
    status.textContent = `${leagueText} · 今日賽程 ${items.length} 場`;
  } else if (viewName === "today") {
    renderTodayLeagueGroups(grid, items, {
      contentClass: "prediction-grid",
      createItem: (item) => createPredictionCard(item),
      unit: "場精選"
    });
    status.textContent = `${leagueText} · 今日精選 ${items.length} 場`;
  } else if (viewName === "future") {
    grid.replaceChildren(...items.map(createScheduleRow));
    status.textContent = `${leagueText} · ${items.length} 場`;
  } else {
    grid.replaceChildren(...items.map((item) => createPredictionCard(item, { showActual: viewName === "past" })));
    status.textContent = `${leagueText} · ${items.length} 場`;
  }
  empty.hidden = items.length > 0;

  if (viewName === activeView) updateInsights(items);
}

function render() {
  confidenceOutput.textContent = `${confidenceFilter.value}%+`;
  updateSettlementRecord();
  renderView("today-schedule");
  renderView("today");
  renderView("past");
  renderView("future");
}

function switchView(viewName) {
  if (!tabViews.includes(viewName)) return;
  activeView = viewName;
  viewTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewName));
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === viewName);
  });
  updateInsights(itemsForView(viewName));
}

function viewFromHash() {
  const hashView = window.location.hash.replace("#", "");
  return tabViews.includes(hashView) ? hashView : "today-schedule";
}

function bootstrap() {
  document.querySelector("#hero-summary").textContent =
    data.summary || "每日依照韓職、日職、中職賽程與盤口產生大小分、讓分過盤預測。";
  document.querySelector("#last-updated").textContent = `更新時間 ${formatFullDateTime(data.generatedAt)}`;
  document.querySelector("#prediction-count").textContent = `${
    views.today.filter((game) => game.isFeatured).length || views.today.length
  } 場精選預測`;
  document.querySelector("#today-count").textContent = views.today.length;
  document.querySelector("#league-count").textContent = new Set(allGames.map((item) => item.league)).size || 3;
  populateLeagues();
  renderLeagueBoard();
  render();
  switchView(viewFromHash());
}

leagueFilter.addEventListener("change", render);
confidenceFilter.addEventListener("input", render);
resetButton.addEventListener("click", () => {
  leagueFilter.value = "all";
  confidenceFilter.value = 0;
  render();
});
viewTabs.forEach((tab) =>
  tab.addEventListener("click", () => {
    switchView(tab.dataset.view);
    history.replaceState(null, "", `#${tab.dataset.view}`);
  })
);
window.addEventListener("hashchange", () => switchView(viewFromHash()));

bootstrap();
