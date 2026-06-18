const OPENAI_URL = "https://api.openai.com/v1/responses";
const DEFAULT_MODEL = "gpt-4o-mini";

const predictionSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    predictions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          predictedAwayScore: { type: "integer", minimum: 0, maximum: 30 },
          predictedHomeScore: { type: "integer", minimum: 0, maximum: 30 },
          totalPick: { type: "string", enum: ["大分過盤", "小分過盤", "未取得"] },
          spreadPick: { type: "string" },
          betRecommendation: { type: "string" },
          confidence: { type: "integer", minimum: 0, maximum: 100 },
          rationale: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          detailedAnalysis: { type: "string", minLength: 80, maxLength: 420 },
          riskNote: { type: "string" }
        },
        required: [
          "id",
          "predictedAwayScore",
          "predictedHomeScore",
          "totalPick",
          "spreadPick",
          "betRecommendation",
          "confidence",
          "rationale",
          "detailedAnalysis",
          "riskNote"
        ]
      }
    }
  },
  required: ["predictions"]
};

function compactGame(game) {
  return {
    id: game.id,
    league: game.league,
    startTime: game.startTime,
    awayTeam: game.awayTeam,
    homeTeam: game.homeTeam,
    venue: game.venue,
    awayPitcher: game.awayPitcher || "未取得",
    homePitcher: game.homePitcher || "未取得",
    totalLine: game.totalLine,
    spreadTeam: game.spreadTeam,
    spreadLine: game.spreadLine,
    currentTotalPick: game.totalPick,
    currentSpreadPick: game.spreadPick,
    oddsSource: game.oddsSource,
    analysisItems: game.analysisItems || []
  };
}

function extractResponseText(data) {
  if (typeof data.output_text === "string" && data.output_text.trim()) return data.output_text;

  const output = Array.isArray(data.output) ? data.output : [];
  for (const item of output) {
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (typeof part.text === "string" && part.text.trim()) return part.text;
    }
  }

  throw new Error("OpenAI returned an empty response");
}

function extractJson(content) {
  return JSON.parse(content);
}

async function requestAiPredictions(games) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return { enabled: false, predictions: [], error: "OPENAI_API_KEY not set" };
  }

  if (games.length === 0) {
    return { enabled: true, predictions: [], error: "" };
  }

  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const body = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text:
              "You are a cautious Asian professional baseball betting analyst. Use only the provided official schedule, public betting lines, probable pitchers, recent form notes, and market context. Do not guarantee profit. Do not invent missing odds, pitchers, scores, injuries, or data. If a market line is missing, mark that market as unavailable or recommend waiting. Return every explanation in Traditional Chinese."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: JSON.stringify({
              task:
                "For each game, produce a predicted score, over/under pick, run-line pick, single betting recommendation, confidence score, rationale, a detailedAnalysis paragraph, and risk note. The detailedAnalysis must be 180-260 Traditional Chinese characters, written like a betting analysis article, and mention matchup context, pitcher or recent form when available, market line meaning, and why the final pick is preferred. If totalLine or spreadLine is missing, use 未取得 for that market and keep the recommendation conservative.",
              games: games.map(compactGame)
            })
          }
        ]
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "baseball_betting_predictions",
        strict: true,
        schema: predictionSchema
      }
    }
  };

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || `OpenAI API HTTP ${response.status}`);
  }

  const parsed = extractJson(extractResponseText(data));
  return { enabled: true, predictions: parsed.predictions || [], error: "" };
}

function mergeAiPrediction(game, prediction) {
  if (!prediction) {
    return {
      ...game,
      aiPredictionSource: "未啟用 AI",
      aiBetRecommendation: "未取得",
      aiRationale: []
    };
  }

  return {
    ...game,
    aiPredictionSource: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    aiPredictedAwayScore: prediction.predictedAwayScore,
    aiPredictedHomeScore: prediction.predictedHomeScore,
    aiTotalPick: prediction.totalPick,
    aiSpreadPick: prediction.spreadPick,
    aiBetRecommendation: prediction.betRecommendation,
    aiConfidence: prediction.confidence,
    aiRationale: prediction.rationale,
    aiDetailedAnalysis: prediction.detailedAnalysis,
    aiRiskNote: prediction.riskNote
  };
}

export async function applyAiPredictions(games) {
  try {
    const result = await requestAiPredictions(games);
    const byId = new Map(result.predictions.map((prediction) => [prediction.id, prediction]));
    return {
      games: games.map((game) => mergeAiPrediction(game, byId.get(game.id))),
      meta: {
        enabled: result.enabled,
        model: result.enabled ? process.env.OPENAI_MODEL || DEFAULT_MODEL : "",
        error: result.error || "",
        count: result.predictions.length
      }
    };
  } catch (error) {
    return {
      games: games.map((game) => mergeAiPrediction(game, null)),
      meta: {
        enabled: true,
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        error: error.message,
        count: 0
      }
    };
  }
}
