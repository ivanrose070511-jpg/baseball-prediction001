const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
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
    awayPitcher: game.awayPitcher || "未公開",
    homePitcher: game.homePitcher || "未公開",
    totalLine: game.totalLine,
    spreadTeam: game.spreadTeam,
    spreadLine: game.spreadLine,
    currentTotalPick: game.totalPick,
    currentSpreadPick: game.spreadPick,
    oddsSource: game.oddsSource,
    analysisItems: game.analysisItems || []
  };
}

function extractJson(content) {
  if (!content) throw new Error("OpenAI returned an empty response");
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
    temperature: 0.35,
    messages: [
      {
        role: "system",
        content:
          "你是謹慎的亞洲職棒盤口分析師。根據提供的官方賽程、公開盤口、先發投手與近況資料，產生預測比分與下注方向。不要保證獲利，不要編造未提供的盤口；盤口缺失時可預測比分，但下注建議應偏保守或觀望。所有輸出使用繁體中文。"
      },
      {
        role: "user",
        content: JSON.stringify({
          task:
            "請針對每場比賽輸出預測比分、大小分方向、讓分過盤方向、下注建議、信心分數與理由。若沒有大小分或讓分公開盤口，該盤口方向請填未取得或觀望。",
          games: games.map(compactGame)
        })
      }
    ],
    response_format: {
      type: "json_schema",
      json_schema: {
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

  const content = data.choices?.[0]?.message?.content;
  const parsed = extractJson(content);
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
