import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  addDays,
  addPredictionFields,
  fetchOfficialSchedules,
  getTaipeiDateKey
} from "./fetch-schedules.mjs";
import { applyOddsToPredictions, fetchOdds } from "./fetch-odds.mjs";
import { applyAiPredictions } from "./ai-predict.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const poolPath = path.join(root, "data", "team-pool.json");
const outputPath = path.join(root, "data", "predictions.js");
const leagueBySource = {
  KBO: "KBO 韓國職棒",
  NPB: "NPB 日本職棒",
  CPBL: "CPBL 中華職棒"
};

const now = new Date();
const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
const targetDate = dateArg ? new Date(`${dateArg}T12:00:00+08:00`) : now;
let dateKey = getTaipeiDateKey(targetDate);

function hash(input) {
  let value = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function pickMany(items, random, count) {
  return [...items].sort(() => random() - 0.5).slice(0, count);
}

function scoreFor(range, random) {
  const [min, max] = range;
  return Math.round(min + random() * (max - min));
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

async function readExistingPayload() {
  try {
    const text = await fs.readFile(outputPath, "utf8");
    const json = text.match(/window\.SCORE_PREDICTIONS\s*=\s*([\s\S]*);\s*$/)?.[1];
    return json ? JSON.parse(json) : null;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function getFailedLeagues(...results) {
  const failed = new Set();
  for (const result of results) {
    for (const error of result.errors || []) {
      const source = String(error).split(":")[0];
      if (leagueBySource[source]) failed.add(leagueBySource[source]);
    }
  }
  return failed;
}

function mergeLeagueFallback(current, previous, failedLeagues) {
  if (!previous || failedLeagues.size === 0) return current;
  const currentLeagues = new Set(current.map((game) => game.league));
  const fallback = previous.filter((game) => failedLeagues.has(game.league) && !currentLeagues.has(game.league));
  return [...current, ...fallback];
}

function buildPrediction(sportConfig, gameIndex, random) {
  const [awayTeam, homeTeam] = pickMany(sportConfig.teams, random, 2);
  const awayEstimate = scoreFor(sportConfig.scoreRange, random);
  const homeEstimate = scoreFor(sportConfig.scoreRange, random);

  const startHour = 18 + gameIndex;
  const startTime = new Date(now);
  startTime.setHours(startHour, gameIndex % 2 === 0 ? 5 : 35, 0, 0);

  const factors = pickMany(sportConfig.factors, random, 3);

  return {
    id: `${dateKey}-${slugify(sportConfig.league)}-${gameIndex + 1}`,
    sport: sportConfig.sport,
    league: sportConfig.league,
    startTime: startTime.toISOString(),
    awayTeam,
    homeTeam,
    modelTotal: awayEstimate + homeEstimate,
    modelHomeEdge: homeEstimate - awayEstimate,
    totalLine: null,
    totalPick: "未取得",
    spreadTeam: "",
    spreadLine: null,
    spreadPick: "未取得",
    oddsSource: "未取得盤口",
    venue: "Daily forecast board",
    factors,
    note: "離線模型依隊伍池、賽事類型與日期種子產生盤口方向；接上真實賽程後可由每日任務覆寫。"
  };
}

function emptyTeamStats() {
  return { games: 0, wins: 0, losses: 0, runsFor: 0, runsAgainst: 0 };
}

function addTeamResult(stats, team, runsFor, runsAgainst) {
  if (!team || !Number.isFinite(runsFor) || !Number.isFinite(runsAgainst)) return;
  const entry = stats.get(team) || emptyTeamStats();
  entry.games += 1;
  entry.runsFor += runsFor;
  entry.runsAgainst += runsAgainst;
  if (runsFor > runsAgainst) entry.wins += 1;
  if (runsFor < runsAgainst) entry.losses += 1;
  stats.set(team, entry);
}

function buildRecentStats(games) {
  const stats = new Map();
  for (const game of games) {
    const awayScore = Number(game.actualAwayScore);
    const homeScore = Number(game.actualHomeScore);
    if (game.status !== "final" || !Number.isFinite(awayScore) || !Number.isFinite(homeScore)) continue;
    addTeamResult(stats, game.awayTeam, awayScore, homeScore);
    addTeamResult(stats, game.homeTeam, homeScore, awayScore);
  }
  return stats;
}

function formatTeamForm(team, stats) {
  const entry = stats.get(team);
  if (!entry || entry.games === 0) return `${team} 近7日無完整賽果`;
  const forAvg = (entry.runsFor / entry.games).toFixed(1);
  const againstAvg = (entry.runsAgainst / entry.games).toFixed(1);
  return `${team} 近7日 ${entry.wins}勝${entry.losses}敗，場均得${forAvg}、失${againstAvg}`;
}

function totalLean(game) {
  if (!Number.isFinite(Number(game.totalLine)) || !Number.isFinite(Number(game.modelTotal))) return "";
  return Number(game.modelTotal) > Number(game.totalLine) ? "大分" : "小分";
}

function attachAnalysis(games, recentStats) {
  return games.map((game) => {
    const pitcherText =
      game.awayPitcher || game.homePitcher
        ? `先發投手：${game.awayPitcher || "未公開"} vs ${game.homePitcher || "未公開"}`
        : "先發投手：公開來源未取得";
    const totalText =
      game.totalLine !== null && game.totalLine !== undefined && Number.isFinite(Number(game.totalLine))
      ? `大小分盤 ${Number(game.totalLine).toFixed(1)}，傾向${totalLean(game) || game.totalPick || "未取得"}`
      : "大小分盤：未取得公開盤口";
    const spreadText = game.spreadPick === "未取得" ? "讓分盤：未取得公開盤口" : `讓分盤：${game.spreadPick}`;
    const formText = `${formatTeamForm(game.awayTeam, recentStats)}；${formatTeamForm(game.homeTeam, recentStats)}`;

    return {
      ...game,
      analysisItems: [pitcherText, formText, totalText, spreadText],
      note: `${game.source || "官方賽程"} 抓取賽程；每日固定分析先發投手、近7日攻守狀態、大小分與讓分盤。`
    };
  });
}

function hasPick(value) {
  return value && value !== "未取得" && !String(value).includes("未取得");
}

function storedPredictionMap(payload) {
  const map = new Map();
  const views = payload?.views || {};
  for (const game of [...(views.today || []), ...(views.past || [])]) {
    if (game?.id) map.set(game.id, game);
  }
  return map;
}

function copyFields(target, source, fields) {
  const next = { ...target };
  for (const field of fields) {
    if (source[field] !== undefined && source[field] !== null && source[field] !== "") next[field] = source[field];
  }
  return next;
}

function preserveStoredPredictions(games, existingPayload) {
  const storedById = storedPredictionMap(existingPayload);
  return games.map((game) => {
    const stored = storedById.get(game.id);
    if (!stored) return game;

    let next = { ...game };
    if (!hasPick(next.totalPick) && hasPick(stored.totalPick)) {
      next = copyFields(next, stored, ["totalLine", "totalPick", "totalConfidence"]);
    }
    if (!hasPick(next.spreadPick) && hasPick(stored.spreadPick)) {
      next = copyFields(next, stored, [
        "spreadTeam",
        "spreadLine",
        "spreadPick",
        "spreadConfidence",
        "betConfidence",
        "confidenceSource"
      ]);
    }
    if (!next.oddsUpdatedAt && stored.oddsUpdatedAt) next.oddsUpdatedAt = stored.oddsUpdatedAt;
    if ((!next.awayPitcher || next.awayPitcher === "未取得") && stored.awayPitcher) next.awayPitcher = stored.awayPitcher;
    if ((!next.homePitcher || next.homePitcher === "未取得") && stored.homePitcher) next.homePitcher = stored.homePitcher;
    if (!hasPick(next.aiBetRecommendation) && hasPick(stored.aiBetRecommendation)) {
      next = copyFields(next, stored, [
        "aiPredictionSource",
        "aiPredictedAwayScore",
        "aiPredictedHomeScore",
        "aiTotalPick",
        "aiSpreadPick",
        "aiBetRecommendation",
        "aiConfidence",
        "aiRationale",
        "aiRiskNote"
      ]);
    }
    return next;
  });
}

function gameHasFinalScore(game) {
  return (
    game.status === "final" &&
    Number.isFinite(Number(game.actualAwayScore)) &&
    Number.isFinite(Number(game.actualHomeScore))
  );
}

function evaluateTotalPick(game) {
  if (!gameHasFinalScore(game) || !Number.isFinite(Number(game.totalLine)) || !hasPick(game.totalPick)) return "";
  const actualTotal = Number(game.actualAwayScore) + Number(game.actualHomeScore);
  const line = Number(game.totalLine);
  if (actualTotal === line) return "走水";
  const actualPick = actualTotal > line ? "大分過盤" : "小分過盤";
  return game.totalPick === actualPick ? "過盤" : "未過";
}

function evaluateSpreadPick(game) {
  if (!gameHasFinalScore(game) || !Number.isFinite(Number(game.spreadLine)) || !hasPick(game.spreadPick)) return "";
  const line = Number(game.spreadLine);
  const pickText = String(game.spreadPick);
  const isUnderdogPick = pickText.includes("受讓");
  const isFavoritePick = pickText.includes("讓分");
  if (!isUnderdogPick && !isFavoritePick) return "";

  const pickTeam = pickText.split(isUnderdogPick ? "受讓" : "讓分")[0].trim();
  const isHomePick = pickTeam === game.homeTeam;
  const isAwayPick = pickTeam === game.awayTeam;
  if (!isHomePick && !isAwayPick) return "";

  const pickScore = Number(isHomePick ? game.actualHomeScore : game.actualAwayScore);
  const opponentScore = Number(isHomePick ? game.actualAwayScore : game.actualHomeScore);
  const adjustedScore = pickScore + (isUnderdogPick ? line : -line);
  if (adjustedScore === opponentScore) return "走水";
  return adjustedScore > opponentScore ? "過盤" : "未過";
}

function attachSettlements(games) {
  return games.map((game) => {
    const totalResult = evaluateTotalPick(game);
    const spreadResult = evaluateSpreadPick(game);
    return {
      ...game,
      totalResult,
      spreadResult,
      settledAt: totalResult || spreadResult ? new Date().toISOString() : game.settledAt
    };
  });
}

async function fetchMany(dayOffsets, options) {
  const results = [];
  const errors = [];
  let successfulSources = 0;

  for (const offset of dayOffsets) {
    const date = addDays(targetDate, offset);
    const result = await fetchOfficialSchedules(date, options);
    successfulSources += result.successfulSources;
    errors.push(...result.errors);
    results.push(...result.games);
  }

  return { games: results, errors, successfulSources };
}

let todayResult = { games: [], errors: [], successfulSources: 0 };
let pastResult = { games: [], errors: [], successfulSources: 0 };
let futureResult = { games: [], errors: [], successfulSources: 0 };
const existingPayload = await readExistingPayload();

try {
  todayResult = await fetchMany([0], { includeCompleted: true });
  pastResult = await fetchMany([-7, -6, -5, -4, -3, -2, -1], { includeCompleted: true });
  futureResult = await fetchMany([1, 2, 3, 4, 5, 6, 7], { includeCompleted: false });
} catch (error) {
  todayResult.errors.push(error.message);
}

let todayPredictions = todayResult.games.map(addPredictionFields);
let pastPredictions = pastResult.games
  .filter((game) => game.status === "final" || game.status === "postponed")
  .map(addPredictionFields)
  .sort((a, b) => new Date(b.startTime) - new Date(a.startTime));
let futureSchedules = futureResult.games.sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
const failedLeagues = getFailedLeagues(todayResult, pastResult, futureResult);
todayPredictions = mergeLeagueFallback(todayPredictions, existingPayload?.views?.today || [], failedLeagues);
pastPredictions = mergeLeagueFallback(pastPredictions, existingPayload?.views?.past || [], failedLeagues).sort(
  (a, b) => new Date(b.startTime) - new Date(a.startTime)
);
futureSchedules = mergeLeagueFallback(futureSchedules, existingPayload?.views?.future || [], failedLeagues).sort(
  (a, b) => new Date(a.startTime) - new Date(b.startTime)
);
const oddsResult = await fetchOdds();
const recentStats = buildRecentStats(pastResult.games);
todayPredictions = applyOddsToPredictions(todayPredictions, oddsResult.odds);
pastPredictions = applyOddsToPredictions(pastPredictions, oddsResult.odds);
todayPredictions = preserveStoredPredictions(todayPredictions, existingPayload);
pastPredictions = preserveStoredPredictions(pastPredictions, existingPayload);
todayPredictions = attachAnalysis(todayPredictions, recentStats);
pastPredictions = attachAnalysis(pastPredictions, recentStats);
todayPredictions = attachSettlements(todayPredictions);
pastPredictions = attachSettlements(pastPredictions);
const aiResult = await applyAiPredictions(todayPredictions);
todayPredictions = aiResult.games;
let predictions = todayPredictions;
let summary = `已抓取官方賽程：今日 ${todayPredictions.length} 場、過去 ${pastPredictions.length} 場、未來 ${futureSchedules.length} 場。`;
if (failedLeagues.size > 0) {
  summary += ` ${[...failedLeagues].join("、")} 本次抓取失敗，已保留上一版資料。`;
}

const totalSuccessfulSources =
  todayResult.successfulSources + pastResult.successfulSources + futureResult.successfulSources;

if (totalSuccessfulSources === 0) {
  const pool = JSON.parse(await fs.readFile(poolPath, "utf8"));
  const random = seededRandom(hash(dateKey));
  predictions = pool.sports.flatMap((sportConfig) =>
    [0, 1].map((_, gameIndex) => buildPrediction(sportConfig, gameIndex, random))
  );
  predictions = applyOddsToPredictions(predictions, oddsResult.odds);
  predictions = attachAnalysis(predictions, recentStats);
  const fallbackAiResult = await applyAiPredictions(predictions);
  predictions = fallbackAiResult.games;
  aiResult.meta = fallbackAiResult.meta;
  todayPredictions = predictions;
  pastPredictions = [];
  futureSchedules = [];
  summary = `官方賽程抓取失敗，已改用示範隊伍池產生 ${predictions.length} 場 ${dateKey} 的盤口預測。`;
}

if (
  process.env.REQUIRE_OPENAI === "true" &&
  todayPredictions.length > 0 &&
  (!aiResult.meta.enabled || aiResult.meta.count === 0)
) {
  throw new Error(`ChatGPT analysis required but not available: ${aiResult.meta.error || "no AI predictions"}`);
}

const payload = {
  generatedAt: now.toISOString(),
  summary,
  scheduleSources: {
    successfulSources: totalSuccessfulSources,
    errors: [...todayResult.errors, ...pastResult.errors, ...futureResult.errors]
  },
  oddsSources: {
    count: oddsResult.odds.length,
    errors: oddsResult.errors
  },
  aiSources: aiResult.meta,
  views: {
    today: todayPredictions,
    past: pastPredictions,
    future: futureSchedules
  },
  predictions
};

const file = `window.SCORE_PREDICTIONS = ${JSON.stringify(payload, null, 2)};\n`;
await fs.writeFile(outputPath, file, "utf8");
console.log(`Updated ${path.relative(root, outputPath)} with ${predictions.length} predictions.`);
