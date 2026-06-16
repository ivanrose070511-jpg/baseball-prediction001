import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const localOddsPath = path.join(root, "data", "odds.json");
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const PLAYSPORT_LEAGUES = [
  {
    league: "NPB 日本職棒",
    allianceId: 2,
    teams: {
      橫濱: "橫濱DeNA海灣之星",
      火腿: "日本火腿鬥士",
      巨人: "讀賣巨人",
      樂天: "樂天金鷲",
      廣島: "廣島鯉魚",
      西武: "西武獅",
      中日: "中日龍",
      羅德: "羅德海洋",
      養樂多: "養樂多燕子",
      歐力士: "歐力士猛牛",
      阪神: "阪神虎",
      軟銀: "軟銀鷹"
    }
  },
  {
    league: "CPBL 中華職棒",
    allianceId: 6,
    teams: {
      兄弟: "中信兄弟",
      味全: "味全龍",
      統一: "統一7-ELEVEn獅",
      富邦: "富邦悍將",
      樂天: "樂天桃猿",
      台鋼: "台鋼雄鷹"
    }
  },
  {
    league: "KBO 韓國職棒",
    allianceId: 9,
    teams: {
      韓華: "韓華鷹",
      斗山: "斗山熊",
      三星: "三星獅",
      樂天: "樂天巨人",
      起亞: "起亞虎",
      NC: "NC恐龍",
      SSG: "SSG登陸者",
      培證: "培證英雄",
      英雄: "培證英雄",
      KT: "KT巫師",
      LG: "LG雙子"
    }
  }
];

function dateKey(value) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[()（）@]/g, "");
}

function addDays(dateLike, days) {
  const date = new Date(dateLike);
  date.setDate(date.getDate() + days);
  return date;
}

function stripTags(value) {
  return String(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(div|td|tr|li|span|a|p|th|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "\n")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

function htmlToLines(html) {
  return stripTags(html)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function gameKey(game) {
  return [dateKey(game.startTime), normalize(game.league), normalize(game.awayTeam), normalize(game.homeTeam)].join("|");
}

function matchupKey(date, league, awayTeam, homeTeam) {
  return [date, normalize(league), [normalize(awayTeam), normalize(homeTeam)].sort().join("@")].join("|");
}

function gameMatchupKey(game) {
  return matchupKey(dateKey(game.startTime), game.league, game.awayTeam, game.homeTeam);
}

function parseOddsItem(item) {
  const key = item.key || [item.date, item.league, item.awayTeam, item.homeTeam].map(normalize).join("|");
  const [keyDate, keyLeague, keyAway, keyHome] = key.split("|");
  const itemDate = item.date || keyDate;
  const itemLeague = item.league || keyLeague;
  const itemAway = item.awayTeam || keyAway;
  const itemHome = item.homeTeam || keyHome;
  const totalLine = item.totalLine === null || item.totalLine === undefined ? null : Number(item.totalLine);
  const spreadLine = item.spreadLine === null || item.spreadLine === undefined ? null : Number(item.spreadLine);
  return {
    key,
    matchupKey: matchupKey(itemDate, itemLeague, itemAway, itemHome),
    awayTeam: itemAway,
    homeTeam: itemHome,
    source: item.source || "外部盤口",
    totalLine: Number.isFinite(totalLine) ? totalLine : null,
    spreadTeam: item.spreadTeam || "",
    spreadLine: Number.isFinite(spreadLine) ? Math.abs(spreadLine) : null,
    awayPitcher: item.awayPitcher || "",
    homePitcher: item.homePitcher || "",
    updatedAt: item.updatedAt || new Date().toISOString()
  };
}

async function readLocalOdds() {
  try {
    const text = await fs.readFile(localOddsPath, "utf8");
    const data = JSON.parse(text);
    return Array.isArray(data.odds) ? data.odds.map(parseOddsItem) : [];
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function readRemoteOdds() {
  const url = process.env.ODDS_FEED_URL;
  if (!url) return [];

  const headers = { "User-Agent": "Mozilla/5.0" };
  if (process.env.ODDS_API_KEY) headers.Authorization = `Bearer ${process.env.ODDS_API_KEY}`;

  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Odds feed HTTP ${response.status}`);
  const data = await response.json();
  const odds = Array.isArray(data) ? data : data.odds;
  return Array.isArray(odds) ? odds.map(parseOddsItem) : [];
}

function findTeam(line, teamMap) {
  const clean = line.replace(/^#+\s*/, "").trim();
  return teamMap[clean] || "";
}

function extractLineValue(value) {
  const match = String(value).match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function findPlaySportMarkets(lines) {
  const spreads = [];
  const totals = [];

  for (let index = 0; index < lines.length - 2; index += 1) {
    const side = lines[index];
    const line = lines[index + 1];
    const price = lines[index + 2];

    if (/^(客|主)$/.test(side) && /^[+-]\d+(?:\.\d+)?$/.test(line) && Math.abs(Number(line)) > 0 && /^,/.test(price)) {
      spreads.push({ side, line });
    }

    if (/^[大小]$/.test(side) && /^\d+(?:\.\d+)?$/.test(line) && Number(line) > 1 && /^,/.test(price)) {
      totals.push({ side, line });
    }
  }

  return { spreads, totals };
}

function findPitcherCandidate(lines) {
  return (
    lines.find(
      (line) =>
        !/^(客|主|大|小|V\.S\.|對戰資訊)$/.test(line) &&
        !/^[+-]?\d+(?:\.\d+)?$/.test(line) &&
        !/^,/.test(line) &&
        !/%$/.test(line) &&
        !/贏|輸|分|單|場|讓|暫無資料/.test(line)
    ) || ""
  );
}

function parsePlaySportPage(html, leagueConfig, date) {
  const lines = htmlToLines(html);
  const odds = [];

  for (let index = 0; index < lines.length; index += 1) {
    if (!/^(AM|PM)\s+\d{1,2}:\d{2}$/.test(lines[index])) continue;

    const window = lines.slice(index + 1, index + 36);
    const teamPositions = [];
    for (let cursor = 0; cursor < window.length; cursor += 1) {
      const team = findTeam(window[cursor], leagueConfig.teams);
      if (team) teamPositions.push({ team, cursor });
      if (teamPositions.length === 2) break;
    }
    if (teamPositions.length < 2) continue;

    const away = teamPositions[0].team;
    const home = teamPositions[1].team;
    const afterAway = window.slice(teamPositions[0].cursor + 1, teamPositions[1].cursor);
    const afterHome = window.slice(teamPositions[1].cursor + 1, teamPositions[1].cursor + 12);
    const awayPitcher = findPitcherCandidate(afterAway);
    const homePitcher = findPitcherCandidate(afterHome);
    const marketLines = [...afterAway, ...afterHome];
    const { spreads, totals } = findPlaySportMarkets(marketLines);
    const spread = spreads.find((item) => item.line.startsWith("+")) || spreads[0];
    const total = totals[0];
    if (!spread && !total) continue;

    const spreadSide = spread ? (spread.side === "客" ? away : home) : "";
    odds.push(
      parseOddsItem({
        date: dateKey(date),
        league: leagueConfig.league,
        awayTeam: away,
        homeTeam: home,
        source: "玩運彩",
        totalLine: extractLineValue(total?.line),
        spreadTeam: spreadSide,
        spreadLine: Math.abs(extractLineValue(spread?.line) || 0),
        awayPitcher,
        homePitcher,
        updatedAt: new Date().toISOString()
      })
    );
  }

  return odds;
}

async function readPlaySportOdds() {
  const requests = [];
  const today = new Date();

  for (const league of PLAYSPORT_LEAGUES) {
    for (const [gameday, date] of [
      ["", today],
      ["tomorrow", addDays(today, 1)]
    ]) {
      const url = `https://www.playsport.cc/predict/games?allianceid=${league.allianceId}${
        gameday ? `&gameday=${gameday}` : ""
      }`;
      requests.push(
        fetch(url, { headers: { "User-Agent": USER_AGENT } })
          .then(async (response) => {
            if (!response.ok) throw new Error(`玩運彩 HTTP ${response.status}: ${url}`);
            return parsePlaySportPage(await response.text(), league, date);
          })
          .catch((error) => {
            throw new Error(error.message);
          })
      );
    }
  }

  const results = await Promise.allSettled(requests);
  return {
    odds: results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])),
    errors: results
      .filter((result) => result.status === "rejected")
      .map((result) => result.reason?.message || String(result.reason))
  };
}

export async function fetchOdds() {
  const [localResult, remoteResult, playSportResult] = await Promise.allSettled([
    readLocalOdds(),
    readRemoteOdds(),
    readPlaySportOdds()
  ]);
  const odds = [];
  const errors = [];

  for (const result of [localResult, remoteResult]) {
    if (result.status === "fulfilled") odds.push(...result.value);
    else errors.push(result.reason?.message || String(result.reason));
  }
  if (playSportResult.status === "fulfilled") {
    odds.push(...playSportResult.value.odds);
    errors.push(...playSportResult.value.errors);
  } else {
    errors.push(playSportResult.reason?.message || String(playSportResult.reason));
  }

  return { odds, errors };
}

function pickTotal(game, totalLine) {
  if (totalLine === null || totalLine === undefined) return "未取得";
  if (!Number.isFinite(Number(totalLine))) return "未取得";
  if (!Number.isFinite(Number(game.modelTotal))) return "未取得";
  const modelTotal = Number(game.modelTotal);
  return modelTotal > Number(totalLine) ? "大分過盤" : "小分過盤";
}

function pickSpread(game, odds) {
  if (!odds.spreadTeam || !Number.isFinite(Number(odds.spreadLine))) return "未取得";
  const line = Number(odds.spreadLine);
  if (!Number.isFinite(Number(game.modelHomeEdge))) return "未取得";
  const homeEdge = Number(game.modelHomeEdge);
  const awayEdge = -homeEdge;
  const spreadTeamIsHome = odds.spreadTeam === game.homeTeam;
  const spreadTeamEdge = spreadTeamIsHome ? homeEdge : awayEdge;

  if (spreadTeamEdge + line > 0) {
    return `${odds.spreadTeam} 受讓 +${line.toFixed(1)} 過盤`;
  }

  const favorite = spreadTeamIsHome ? game.awayTeam : game.homeTeam;
  return `${favorite} 讓分 -${line.toFixed(1)} 過盤`;
}

export function applyOddsToPredictions(games, oddsList) {
  const oddsByKey = new Map(oddsList.map((odds) => [odds.key, odds]));
  const oddsByMatchup = new Map(oddsList.map((odds) => [odds.matchupKey, odds]));
  return games.map((game) => {
    const odds = oddsByKey.get(gameKey(game)) || oddsByMatchup.get(gameMatchupKey(game));
    if (!odds) {
      return {
        ...game,
        totalLine: null,
        totalPick: "未取得",
        spreadTeam: "",
        spreadLine: null,
        spreadPick: "未取得",
        oddsSource: "未取得盤口"
      };
    }

    return {
      ...game,
      totalLine: odds.totalLine,
      totalPick: pickTotal(game, odds.totalLine),
      spreadTeam: odds.spreadTeam,
      spreadLine: odds.spreadLine,
      spreadPick: pickSpread(game, odds),
      oddsSource: odds.source,
      awayPitcher: odds.awayTeam === game.awayTeam ? odds.awayPitcher : odds.homePitcher,
      homePitcher: odds.homeTeam === game.homeTeam ? odds.homePitcher : odds.awayPitcher,
      oddsUpdatedAt: odds.updatedAt,
      note: `${game.source || "官方賽程"} 抓取賽程；使用${odds.source}盤口判斷大小分與讓分過盤。`
    };
  });
}

if (process.argv[1] && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1])) {
  const result = await fetchOdds();
  console.log(JSON.stringify({ count: result.odds.length, errors: result.errors, odds: result.odds }, null, 2));
}
