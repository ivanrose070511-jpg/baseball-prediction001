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
let activeView = "today";

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
  return Number.isFinite(Number(score)) ? `<span class="actual-score">實際 ${score}</span>` : "";
}

function formatTotal(game) {
  const line =
    game.totalLine !== null && game.totalLine !== undefined && Number.isFinite(Number(game.totalLine))
      ? ` ${Number(game.totalLine).toFixed(1)}`
      : "";
  return `${game.totalPick || "未取得"}${line}`;
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

function createPredictionCard(game, options = {}) {
  const showActual = Boolean(options.showActual);
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
    <div>
      <div class="confidence-row">
        <span>模型信心</span>
        <span>${game.confidence ?? 0}%</span>
      </div>
      <div class="bar" aria-hidden="true"><span style="width: ${game.confidence ?? 0}%"></span></div>
    </div>
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

function filtered(viewName) {
  const league = leagueFilter.value;
  const minimumConfidence = Number(confidenceFilter.value);
  return views[viewName].filter((game) => {
    const matchesLeague = league === "all" || game.league === league;
    const confidence = viewName === "future" ? 100 : Number(game.confidence || 0);
    return matchesLeague && confidence >= minimumConfidence;
  });
}

function updateInsights(items) {
  const predicted = items.filter((item) => Number.isFinite(Number(item.confidence)));
  const average =
    predicted.length === 0
      ? 0
      : Math.round(predicted.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / predicted.length);
  const highest = predicted.reduce(
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

function renderView(viewName) {
  const items = filtered(viewName);
  const grid = document.querySelector(`#${viewName}-grid`);
  const empty = document.querySelector(`#${viewName}-empty`);
  const status = document.querySelector(`#${viewName}-status`);
  const leagueText = leagueFilter.value === "all" ? "全部聯盟" : leagueFilter.value;

  if (viewName === "future") {
    grid.replaceChildren(...items.map(createScheduleRow));
  } else {
    grid.replaceChildren(...items.map((item) => createPredictionCard(item, { showActual: viewName === "past" })));
  }
  empty.hidden = items.length > 0;
  status.textContent = `${leagueText} · ${items.length} 場`;

  if (viewName === activeView) updateInsights(items);
}

function render() {
  confidenceOutput.textContent = `${confidenceFilter.value}%+`;
  renderView("today");
  renderView("past");
  renderView("future");
}

function switchView(viewName) {
  activeView = viewName;
  viewTabs.forEach((tab) => tab.classList.toggle("is-active", tab.dataset.view === viewName));
  document.querySelectorAll(".view-panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === viewName);
  });
  updateInsights(filtered(viewName));
}

function bootstrap() {
  document.querySelector("#hero-summary").textContent =
    data.summary || "每日依照韓職、日職、中職賽程與盤口產生大小分、讓分過盤預測。";
  document.querySelector("#last-updated").textContent = `更新時間 ${formatFullDateTime(data.generatedAt)}`;
  document.querySelector("#prediction-count").textContent = `${views.today.length} 場今日賽事`;
  document.querySelector("#today-count").textContent = views.today.length;
  document.querySelector("#league-count").textContent = new Set(allGames.map((item) => item.league)).size || 3;
  populateLeagues();
  renderLeagueBoard();
  render();
  switchView("today");
}

leagueFilter.addEventListener("change", render);
confidenceFilter.addEventListener("input", render);
resetButton.addEventListener("click", () => {
  leagueFilter.value = "all";
  confidenceFilter.value = 0;
  render();
});
viewTabs.forEach((tab) => tab.addEventListener("click", () => switchView(tab.dataset.view)));

bootstrap();
