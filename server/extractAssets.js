import { GoogleGenAI } from "@google/genai";
const EXTRACT_ROUTE = "/api/extract-assets";
const DEFAULT_EXTRACT_MODEL = "gemini-2.5-flash-lite";
class ExtractAssetsError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "ExtractAssetsError";
    this.status = status;
  }
}
function getExtractModel() {
  return process.env.GEMINI_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}
function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new ExtractAssetsError(
      "\u672A\u8A2D\u5B9A GEMINI_API_KEY \u6216 GOOGLE_API_KEY\uFF0C\u66AB\u6642\u7121\u6CD5\u89E3\u6790\u622A\u5716\u3002",
      500
    );
  }
  return apiKey;
}
function normalizeExtractAssetsRequest(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new ExtractAssetsError("\u622A\u5716\u89E3\u6790\u8ACB\u6C42\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002", 400);
  }
  const value = payload;
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim() : "";
  const imageBase64 = typeof value.imageBase64 === "string" ? value.imageBase64.trim() : "";
  if (!fileName || !mimeType || !imageBase64) {
    throw new ExtractAssetsError("\u7F3A\u5C11\u5FC5\u8981\u7684\u622A\u5716\u8CC7\u6599\uFF0C\u8ACB\u91CD\u65B0\u4E0A\u50B3\u5716\u7247\u3002", 400);
  }
  return {
    fileName,
    mimeType,
    imageBase64
  };
}
function sanitizeString(value) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}
function sanitizeNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/,/g, "").trim();
    if (!cleaned) {
      return null;
    }
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function sanitizeType(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "stock" || normalized === "stocks" || normalized === "equity") {
    return "stock";
  }
  if (normalized === "etf") {
    return "etf";
  }
  if (normalized === "bond" || normalized === "bonds" || normalized === "fixed income") {
    return "bond";
  }
  if (normalized === "crypto" || normalized === "cryptocurrency" || normalized === "coin") {
    return "crypto";
  }
  if (normalized === "cash") {
    return "cash";
  }
  return null;
}
function sanitizeCurrency(value) {
  const normalized = sanitizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}
function sanitizeExtractedAssets(rawPayload) {
  if (typeof rawPayload !== "object" || rawPayload === null || !("assets" in rawPayload) || !Array.isArray(rawPayload.assets)) {
    throw new ExtractAssetsError("Gemini \u56DE\u50B3\u683C\u5F0F\u4E0D\u6B63\u78BA\uFF0C\u672A\u627E\u5230 assets \u9663\u5217\u3002", 502);
  }
  return rawPayload.assets.map((asset) => {
    const value = typeof asset === "object" && asset !== null ? asset : {};
    return {
      name: sanitizeString(value.name),
      ticker: sanitizeString(value.ticker),
      type: sanitizeType(value.type),
      quantity: sanitizeNumber(value.quantity),
      currency: sanitizeCurrency(value.currency),
      costBasis: sanitizeNumber(value.costBasis),
      currentPrice: sanitizeNumber(value.currentPrice)
    };
  });
}
function stripJsonFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
}
function parseGeminiJson(text) {
  const normalized = stripJsonFence(text);
  try {
    return JSON.parse(normalized);
  } catch {
    throw new ExtractAssetsError("Gemini \u672A\u56DE\u50B3\u53EF\u89E3\u6790\u7684 JSON\uFF0C\u8ACB\u63DB\u4E00\u5F35\u66F4\u6E05\u6670\u7684\u622A\u5716\u518D\u8A66\u3002", 502);
  }
}
function buildExtractionPrompt(fileName) {
  return `
You are extracting portfolio holdings from a brokerage or wallet screenshot.

Return ONLY raw JSON. Do not use markdown fences. Do not add any explanation.

Use this exact shape:
{
  "assets": [
    {
      "name": string | null,
      "ticker": string | null,
      "type": "stock" | "etf" | "bond" | "crypto" | "cash" | null,
      "quantity": number | null,
      "currency": string | null,
      "costBasis": number | null,
      "currentPrice": number | null
    }
  ]
}

Rules:
- Extract only assets that are actually visible in the screenshot.
- If a field is not visible or uncertain, set it to null.
- "costBasis" means average cost per unit, not total cost.
- "currentPrice" means the current market price per unit if it is clearly visible.
- "currency" should be an uppercase currency code like HKD or USD when visible.
- "type" must be one of: stock, etf, bond, crypto, cash, or null.
- Keep numbers as JSON numbers, not strings.
- Do not include fields outside the fixed schema.

Screenshot filename: ${fileName}
  `.trim();
}
function getExtractAssetsErrorResponse(error) {
  if (error instanceof ExtractAssetsError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: EXTRACT_ROUTE,
        message: error.message
      }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: EXTRACT_ROUTE,
        message: error.message
      }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      route: EXTRACT_ROUTE,
      message: "\u622A\u5716\u89E3\u6790\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"
    }
  };
}
async function extractAssetsFromScreenshot(payload) {
  const normalizedPayload = normalizeExtractAssetsRequest(payload);
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const model = getExtractModel();
  const result = await ai.models.generateContent({
    model,
    contents: [
      {
        text: buildExtractionPrompt(normalizedPayload.fileName)
      },
      {
        inlineData: {
          mimeType: normalizedPayload.mimeType,
          data: normalizedPayload.imageBase64
        }
      }
    ],
    config: {
      temperature: 0.1
    }
  });
  const parsed = parseGeminiJson(result.text ?? "");
  const assets = sanitizeExtractedAssets(parsed);
  return {
    ok: true,
    route: EXTRACT_ROUTE,
    mode: "live",
    model,
    assets
  };
}
export {
  extractAssetsFromScreenshot,
  getExtractAssetsErrorResponse
};
