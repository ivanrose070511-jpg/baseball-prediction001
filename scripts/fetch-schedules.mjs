import path from "node:path";
import { fileURLToPath } from "node:url";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const NPB_TEAMS = new Set([
  "巨人",
  "阪神",
  "中日",
  "広島",
  "ヤクルト",
  "DeNA",
  "ソフトバンク",
  "日本ハム",
  "オリックス",
  "楽天",
  "西武",
  "ロッテ"
]);

const KBO_TEAM_NAMES = {
  한화: "韓華鷹",
  두산: "斗山熊",
  삼성: "三星獅",
  롯데: "樂天巨人",
  KIA: "起亞虎",
  NC: "NC恐龍",
  SSG: "SSG登陸者",
  키움: "培證英雄",
  KT: "KT巫師",
  LG: "LG雙子"
};

const NPB_TEAM_NAMES = {
  巨人: "讀賣巨人",
  阪神: "阪神虎",
  中日: "中日龍",
  広島: "廣島鯉魚",
  ヤクルト: "養樂多燕子",
  DeNA: "橫濱DeNA海灣之星",
  ソフトバンク: "軟銀鷹",
  日本ハム: "日本火腿鬥士",
  オリックス: "歐力士猛牛",
  楽天: "樂天金鷲",
  西武: "西武獅",
  ロッテ: "羅德海洋"
};

const HTML_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " "
};

function decodeHtml(value) {
  return String(value)
    .replace(/&([a-zA-Z0-9#]+);/g, (_, entity) => HTML_ENTITIES[entity] || "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return decodeHtml(String(value).replace(/<[^>]*>/g, " "));
}

function htmlToLines(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|td|tr|li|span|a|p|th|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "\n")
    .split(/\n+/)
    .map(decodeHtml)
    .filter(Boolean);
}

function formatDateParts(dateLike) {
  const date = typeof dateLike === "string" ? new Date(`${dateLike}T12:00:00+08:00`) : dateLike;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  })
    .formatToParts(date)
    .reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
  return {
    year: parts.year,
    month: parts.month,
    day: parts.day,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`
  };
}

function toStartTime(dateKey, time, offset) {
  const cleanTime = /^\d{1,2}:\d{2}$/.test(time || "") ? time : "18:00";
  return `${dateKey}T${cleanTime.padStart(5, "0")}:00${offset}`;
}

function seededScore(game, min, max, side) {
  const seed = `${game.league}|${game.awayTeam}|${game.homeTeam}|${game.startTime}|${side}`;
  let value = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    value ^= seed.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return min + (Math.abs(value) % (max - min + 1));
}

function normalizeGame(game) {
  return {
    id: game.id,
    sport: "Baseball",
    league: game.league,
    startTime: game.startTime,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    venue: game.venue || "",
    status: game.status || "scheduled",
    actualAwayScore: game.actualAwayScore,
    actualHomeScore: game.actualHomeScore,
    source: game.source,
    sourceUrl: game.sourceUrl
  };
}

export function getTaipeiDateKey(dateLike = new Date()) {
  return formatDateParts(dateLike).dateKey;
}

export function addDays(dateLike, days) {
  const date = typeof dateLike === "string" ? new Date(`${dateLike}T12:00:00+08:00`) : new Date(dateLike);
  date.setDate(date.getDate() + days);
  return date;
}

export async function fetchKboSchedule(dateLike = new Date(), options = {}) {
  const { includeCompleted = false } = options;
  const { year, month, day, dateKey } = formatDateParts(dateLike);
  const body = new URLSearchParams({
    leId: "1",
    srIdList: "0,9,6",
    seasonId: year,
    gameMonth: month,
    teamId: ""
  });
  const response = await fetch("https://www.koreabaseball.com/ws/Schedule.asmx/GetScheduleList", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.koreabaseball.com/Schedule/Schedule.aspx",
      "User-Agent": USER_AGENT
    },
    body
  });
  if (!response.ok) throw new Error(`KBO schedule HTTP ${response.status}`);
  const data = await response.json();
  const games = [];
  let currentDay = "";

  for (const item of data.rows || []) {
    const cells = item.row || [];
    const dayCell = cells.find((cell) => cell.Class === "day");
    if (dayCell) currentDay = stripTags(dayCell.Text);
    if (!currentDay.includes(`${month}.${day}`)) continue;

    const timeCell = cells.find((cell) => cell.Class === "time");
    const playCell = cells.find((cell) => cell.Class === "play");
    if (!playCell) continue;

    const teams = [...String(playCell.Text).matchAll(/<span[^>]*>(.*?)<\/span>/g)]
      .map((match) => stripTags(match[1]))
      .filter((value) => value && value !== "vs" && !/^\d+$/.test(value));
    if (teams.length < 2) continue;
    const scores = [...String(playCell.Text).matchAll(/<span[^>]*>\s*(\d+)\s*<\/span>/g)].map((match) =>
      Number(match[1])
    );
    const isCompleted = scores.length >= 2;
    if (isCompleted && !includeCompleted) continue;

    const venue = stripTags(cells.at(-2)?.Text || "");
    games.push(
      normalizeGame({
        id: `${dateKey}-kbo-${games.length + 1}`,
        league: "KBO 韓國職棒",
        startTime: toStartTime(dateKey, stripTags(timeCell?.Text || ""), "+09:00"),
        awayTeam: KBO_TEAM_NAMES[teams[0]] || teams[0],
        homeTeam: KBO_TEAM_NAMES[teams.at(-1)] || teams.at(-1),
        venue,
        status: isCompleted ? "final" : "scheduled",
        actualAwayScore: isCompleted ? scores[0] : undefined,
        actualHomeScore: isCompleted ? scores[1] : undefined,
        source: "KBO 官方賽程",
        sourceUrl: "https://www.koreabaseball.com/Schedule/Schedule.aspx"
      })
    );
  }

  return games;
}

export async function fetchNpbSchedule(dateLike = new Date(), options = {}) {
  const { includeCompleted = false } = options;
  const { year, month, day, dateKey } = formatDateParts(dateLike);
  const url = `https://npb.jp/games/${year}/schedule_${month}_detail.html`;
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) throw new Error(`NPB schedule HTTP ${response.status}`);
  const html = await response.text();

  const games = [];
  const dateId = `date${month}${day}`;
  const rows = [...html.matchAll(new RegExp(`<tr id="${dateId}"[\\s\\S]*?<\\/tr>`, "g"))].map((match) => match[0]);

  for (const row of rows) {
    const awayRaw = stripTags(row.match(/<div class="team1">([\s\S]*?)<\/div>/)?.[1] || "");
    const homeRaw = stripTags(row.match(/<div class="team2">([\s\S]*?)<\/div>/)?.[1] || "");
    if (!awayRaw || !homeRaw) continue;

    const awayScoreText = stripTags(row.match(/<div class="score1">([\s\S]*?)<\/div>/)?.[1] || "");
    const homeScoreText = stripTags(row.match(/<div class="score2">([\s\S]*?)<\/div>/)?.[1] || "");
    const actualAwayScore = /^\d+$/.test(awayScoreText) ? Number(awayScoreText) : undefined;
    const actualHomeScore = /^\d+$/.test(homeScoreText) ? Number(homeScoreText) : undefined;
    const isCompleted = actualAwayScore !== undefined && actualHomeScore !== undefined;
    if (isCompleted && !includeCompleted) continue;

    const time = stripTags(row.match(/<div class="time">([\s\S]*?)<\/div>/)?.[1] || "");
    const venue = stripTags(row.match(/<div class="place">([\s\S]*?)<\/div>/)?.[1] || "");

    games.push(
      normalizeGame({
        id: `${dateKey}-npb-${games.length + 1}`,
        league: "NPB 日本職棒",
        startTime: toStartTime(dateKey, time, "+09:00"),
        awayTeam: NPB_TEAM_NAMES[awayRaw] || awayRaw,
        homeTeam: NPB_TEAM_NAMES[homeRaw] || homeRaw,
        venue,
        status: isCompleted ? "final" : "scheduled",
        actualAwayScore,
        actualHomeScore,
        source: "NPB.jp 官方賽程",
        sourceUrl: url
      })
    );
  }

  return games;
}

export async function fetchCpblSchedule(dateLike = new Date(), options = {}) {
  const { includeCompleted = false } = options;
  const { year, dateKey } = formatDateParts(dateLike);
  const pageResponse = await fetch("https://www.cpbl.com.tw/schedule", {
    headers: { "User-Agent": USER_AGENT }
  });
  if (!pageResponse.ok) throw new Error(`CPBL schedule page HTTP ${pageResponse.status}`);
  const html = await pageResponse.text();
  const token =
    html.match(/RequestVerificationToken:\s*'([^']+)'/)?.[1] ||
    html.match(/name="__RequestVerificationToken"\s+type="hidden"\s+value="([^"]+)"/)?.[1];
  if (!token) throw new Error("CPBL verification token not found");

  const body = new URLSearchParams({
    calendar: `${year}/01/01`,
    location: "",
    kindCode: "A"
  });
  const response = await fetch("https://www.cpbl.com.tw/schedule/getgamedatas", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://www.cpbl.com.tw/schedule",
      RequestVerificationToken: token,
      "User-Agent": USER_AGENT
    },
    body
  });
  if (!response.ok) throw new Error(`CPBL schedule HTTP ${response.status}`);
  const data = await response.json();
  if (!data.Success) throw new Error("CPBL schedule response was not successful");

  return JSON.parse(data.GameDatas || "[]")
    .filter((game) => String(game.GameDate || game.PreExeDate || "").startsWith(dateKey))
    .filter((game) => includeCompleted || game.GameResult === "")
    .map((game, index) =>
      normalizeGame({
        id: `${dateKey}-cpbl-${index + 1}`,
        league: "CPBL 中華職棒",
        startTime: `${String(game.PreExeDate || game.GameDateTimeS).replace(".000", "")}+08:00`,
        awayTeam: game.VisitingTeamName,
        homeTeam: game.HomeTeamName,
        venue: game.FieldAbbe,
        status: game.GameResult === "0" ? "final" : game.GameResult === "" ? "scheduled" : "postponed",
        actualAwayScore: game.GameResult === "0" ? Number(game.VisitingScore) : undefined,
        actualHomeScore: game.GameResult === "0" ? Number(game.HomeScore) : undefined,
        source: "CPBL 官方賽程",
        sourceUrl: "https://www.cpbl.com.tw/schedule"
      })
    );
}

export async function fetchOfficialSchedules(dateLike = new Date(), options = {}) {
  const sources = [
    ["KBO", fetchKboSchedule],
    ["NPB", fetchNpbSchedule],
    ["CPBL", fetchCpblSchedule]
  ];
  const results = await Promise.allSettled(sources.map(([, fetcher]) => fetcher(dateLike, options)));
  const games = results.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const errors = results
    .map((result, index) =>
      result.status === "rejected" ? `${sources[index][0]}: ${result.reason?.message || result.reason}` : null
    )
    .filter(Boolean);

  return {
    games,
    errors,
    successfulSources: results.filter((result) => result.status === "fulfilled").length
  };
}

export function addPredictionFields(game) {
  const range =
    game.league.includes("NPB") ? [1, 7] : game.league.includes("KBO") ? [2, 9] : [2, 8];
  const awayEstimate = seededScore(game, range[0], range[1], "away");
  const homeEstimate = seededScore(game, range[0], range[1], "home");

  return {
    ...game,
    modelTotal: awayEstimate + homeEstimate,
    modelHomeEdge: homeEstimate - awayEstimate,
    totalLine: null,
    totalPick: "未取得",
    spreadTeam: "",
    spreadLine: null,
    spreadPick: "未取得",
    oddsSource: "未取得盤口",
    confidence: 58 + seededScore(game, 0, 17, "confidence"),
    factors: ["官方賽程", "大小分", "讓分盤"],
    note: `${game.source} 抓取賽程；模型只判斷大小分與讓分過盤方向。`
  };
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const dateArg = process.argv.find((arg) => arg.startsWith("--date="))?.slice("--date=".length);
  const { games, errors, successfulSources } = await fetchOfficialSchedules(dateArg || new Date());
  console.log(
    JSON.stringify(
      {
        successfulSources,
        gameCount: games.length,
        errors,
        games
      },
      null,
      2
    )
  );
}
