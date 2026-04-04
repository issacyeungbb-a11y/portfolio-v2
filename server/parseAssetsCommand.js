import { GoogleGenAI } from '@google/genai';

const PARSE_ROUTE = '/api/parse-assets-command';
const DEFAULT_PARSE_MODEL = 'gemini-2.5-flash-lite';

class ParseAssetsCommandError extends Error {
  constructor(message, status = 500) {
    super(message);
    this.name = 'ParseAssetsCommandError';
    this.status = status;
  }
}

function getParseModel() {
  return process.env.GEMINI_EXTRACT_MODEL?.trim() || DEFAULT_PARSE_MODEL;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new ParseAssetsCommandError(
      '未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法解析文字指令。',
      500,
    );
  }

  return apiKey;
}

function normalizeParseAssetsCommandRequest(payload) {
  if (typeof payload !== 'object' || payload === null) {
    throw new ParseAssetsCommandError('文字匯入請求格式不正確。', 400);
  }

  const value = payload;
  const text = typeof value.text === 'string' ? value.text.trim() : '';

  if (!text) {
    throw new ParseAssetsCommandError('請先輸入文字或語音內容，再開始解析。', 400);
  }

  return { text };
}

function sanitizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const cleaned = value.replace(/,/g, '').trim();
    if (!cleaned) {
      return null;
    }

    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function sanitizeType(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === 'stock' || normalized === 'stocks' || normalized === 'equity' || normalized === '股票') {
    return 'stock';
  }

  if (normalized === 'etf') {
    return 'etf';
  }

  if (normalized === 'bond' || normalized === 'bonds' || normalized === 'fixed income' || normalized === '債券') {
    return 'bond';
  }

  if (
    normalized === 'crypto' ||
    normalized === 'cryptocurrency' ||
    normalized === 'coin' ||
    normalized === '加密貨幣'
  ) {
    return 'crypto';
  }

  if (normalized === 'cash' || normalized === '現金') {
    return 'cash';
  }

  return null;
}

function sanitizeCurrency(value) {
  const normalized = sanitizeString(value);
  return normalized ? normalized.toUpperCase() : null;
}

function stripJsonFence(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

function parseGeminiJson(text) {
  const normalized = stripJsonFence(text);

  try {
    return JSON.parse(normalized);
  } catch {
    throw new ParseAssetsCommandError('AI 未回傳可解析的 JSON，請重新描述一次。', 502);
  }
}

function sanitizeExtractedAssets(rawPayload) {
  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    !('assets' in rawPayload) ||
    !Array.isArray(rawPayload.assets)
  ) {
    throw new ParseAssetsCommandError('AI 回傳格式不正確，未找到 assets 陣列。', 502);
  }

  return rawPayload.assets.map((asset) => {
    const value =
      typeof asset === 'object' && asset !== null
        ? asset
        : {};

    return {
      name: sanitizeString(value.name),
      ticker: sanitizeString(value.ticker),
      type: sanitizeType(value.type),
      quantity: sanitizeNumber(value.quantity),
      currency: sanitizeCurrency(value.currency),
      costBasis: sanitizeNumber(value.costBasis),
      currentPrice: sanitizeNumber(value.currentPrice),
    };
  });
}

function buildParsePrompt(text) {
  return `
You are converting a user's natural-language portfolio instruction into structured asset records.

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
- Parse only the assets explicitly mentioned by the user.
- The user may write in Traditional Chinese, Cantonese, or English.
- "costBasis" means average cost per unit, not total cost.
- "currentPrice" means current market price per unit if the user explicitly mentions it.
- If a field is missing or uncertain, set it to null.
- Keep numbers as JSON numbers, not strings.
- "currency" should be an uppercase currency code like HKD, USD, JPY.
- Do not include fields outside the fixed schema.
- If the text sounds like voice transcription, infer punctuation and asset boundaries conservatively.

User instruction:
${text}
  `.trim();
}

export function getParseAssetsCommandErrorResponse(error) {
  if (error instanceof ParseAssetsCommandError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: PARSE_ROUTE,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: PARSE_ROUTE,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route: PARSE_ROUTE,
      message: '文字匯入失敗，請稍後再試。',
    },
  };
}

export async function parseAssetsFromCommand(payload) {
  const normalizedPayload = normalizeParseAssetsCommandRequest(payload);

  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const model = getParseModel();
  const result = await ai.models.generateContent({
    model,
    contents: buildParsePrompt(normalizedPayload.text),
    config: {
      temperature: 0.1,
    },
  });

  const parsed = parseGeminiJson(result.text ?? '');
  const assets = sanitizeExtractedAssets(parsed);

  return {
    ok: true,
    route: PARSE_ROUTE,
    mode: 'live',
    model,
    assets,
  };
}
