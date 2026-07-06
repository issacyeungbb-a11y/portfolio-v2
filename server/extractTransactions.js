import { GoogleGenAI } from "@google/genai";
const EXTRACT_ROUTE = "/api/extract-transactions";
const DEFAULT_EXTRACT_MODEL = "gemini-2.5-flash-lite";
class ExtractTransactionsError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "ExtractTransactionsError";
    this.status = status;
  }
}
function getExtractModel() {
  return process.env.GEMINI_EXTRACT_MODEL?.trim() || DEFAULT_EXTRACT_MODEL;
}
function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new ExtractTransactionsError(
      "\u672A\u8A2D\u5B9A GEMINI_API_KEY \u6216 GOOGLE_API_KEY\uFF0C\u66AB\u6642\u7121\u6CD5\u89E3\u6790\u4EA4\u6613\u622A\u5716\u3002",
      500
    );
  }
  return apiKey;
}
function normalizeRequest(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new ExtractTransactionsError("\u4EA4\u6613\u622A\u5716\u89E3\u6790\u8ACB\u6C42\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002", 400);
  }
  const value = payload;
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  const mimeType = typeof value.mimeType === "string" ? value.mimeType.trim() : "";
  const imageBase64 = typeof value.imageBase64 === "string" ? value.imageBase64.trim() : "";
  if (!fileName || !mimeType || !imageBase64) {
    throw new ExtractTransactionsError("\u7F3A\u5C11\u5FC5\u8981\u7684\u622A\u5716\u8CC7\u6599\uFF0C\u8ACB\u91CD\u65B0\u4E0A\u50B3\u5716\u7247\u3002", 400);
  }
  return { fileName, mimeType, imageBase64 };
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
  if (normalized === "stock" || normalized === "stocks" || normalized === "equity" || normalized === "\u80A1\u7968") {
    return "stock";
  }
  if (normalized === "etf") {
    return "etf";
  }
  if (normalized === "bond" || normalized === "bonds" || normalized === "fixed income" || normalized === "\u50B5\u5238") {
    return "bond";
  }
  if (normalized === "crypto" || normalized === "cryptocurrency" || normalized === "coin" || normalized === "\u52A0\u5BC6\u8CA8\u5E63") {
    return "crypto";
  }
  if (normalized === "cash" || normalized === "\u73FE\u91D1") {
    return "cash";
  }
  return null;
}
function sanitizeTransactionType(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "buy" || normalized === "bought" || normalized === "\u8CB7\u5165" || normalized === "\u52A0\u5009") {
    return "buy";
  }
  if (normalized === "sell" || normalized === "sold" || normalized === "\u8CE3\u51FA" || normalized === "\u6E1B\u5009") {
    return "sell";
  }
  return null;
}
function stripJsonFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith("```")) {
    return trimmed;
  }
  return trimmed.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/, "").trim();
}
function parseGeminiJson(text) {
  try {
    return JSON.parse(stripJsonFence(text));
  } catch {
    throw new ExtractTransactionsError("Gemini \u672A\u56DE\u50B3\u53EF\u89E3\u6790\u7684\u4EA4\u6613 JSON\uFF0C\u8ACB\u63DB\u4E00\u5F35\u66F4\u6E05\u6670\u7684\u622A\u5716\u518D\u8A66\u3002", 502);
  }
}
function sanitizeTransactions(rawPayload) {
  if (typeof rawPayload !== "object" || rawPayload === null || !("transactions" in rawPayload) || !Array.isArray(rawPayload.transactions)) {
    throw new ExtractTransactionsError("Gemini \u56DE\u50B3\u683C\u5F0F\u4E0D\u6B63\u78BA\uFF0C\u672A\u627E\u5230 transactions \u9663\u5217\u3002", 502);
  }
  return rawPayload.transactions.map((entry) => {
    const value = typeof entry === "object" && entry !== null ? entry : {};
    return {
      name: sanitizeString(value.name),
      ticker: sanitizeString(value.ticker),
      type: sanitizeType(value.type),
      transactionType: sanitizeTransactionType(value.transactionType),
      quantity: sanitizeNumber(value.quantity),
      currency: sanitizeString(value.currency)?.toUpperCase() ?? null,
      price: sanitizeNumber(value.price),
      fees: sanitizeNumber(value.fees),
      date: sanitizeString(value.date),
      note: sanitizeString(value.note)
    };
  });
}
function buildPrompt(fileName) {
  return `
You are extracting investment transactions from a brokerage screenshot.

Return ONLY raw JSON. Do not use markdown fences. Do not add any explanation.

Use this exact shape:
{
  "transactions": [
    {
      "name": string | null,
      "ticker": string | null,
      "type": "stock" | "etf" | "bond" | "crypto" | "cash" | null,
      "transactionType": "buy" | "sell" | null,
      "quantity": number | null,
      "currency": string | null,
      "price": number | null,
      "fees": number | null,
      "date": string | null,
      "note": string | null
    }
  ]
}

Rules:
- Extract only transactions clearly visible in the screenshot.
- If a field is missing or uncertain, set it to null.
- "price" means trade price per unit, not total amount.
- "date" should be YYYY-MM-DD if visible and inferable.
- Keep numbers as JSON numbers.
- Do not include fields outside the fixed schema.

Screenshot filename: ${fileName}
  `.trim();
}
function getExtractTransactionsErrorResponse(error) {
  if (error instanceof ExtractTransactionsError) {
    return {
      status: error.status,
      body: { ok: false, route: EXTRACT_ROUTE, message: error.message }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: { ok: false, route: EXTRACT_ROUTE, message: error.message }
    };
  }
  return {
    status: 500,
    body: { ok: false, route: EXTRACT_ROUTE, message: "\u4EA4\u6613\u622A\u5716\u89E3\u6790\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002" }
  };
}
async function extractTransactionsFromScreenshot(payload) {
  const normalizedPayload = normalizeRequest(payload);
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const model = getExtractModel();
  const result = await ai.models.generateContent({
    model,
    contents: [
      { text: buildPrompt(normalizedPayload.fileName) },
      {
        inlineData: {
          mimeType: normalizedPayload.mimeType,
          data: normalizedPayload.imageBase64
        }
      }
    ],
    config: { temperature: 0.1 }
  });
  return {
    ok: true,
    route: EXTRACT_ROUTE,
    mode: "live",
    model,
    transactions: sanitizeTransactions(parseGeminiJson(result.text ?? ""))
  };
}
export {
  extractTransactionsFromScreenshot,
  getExtractTransactionsErrorResponse
};
