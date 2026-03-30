import { GoogleGenAI } from '@google/genai';

import type {
  PendingPriceUpdateReview,
  PriceUpdateModelResult,
  PriceUpdateRequest,
  PriceUpdateRequestAsset,
  PriceUpdateResponse,
} from '../src/types/priceUpdates';
import type { AssetType } from '../src/types/portfolio';

const UPDATE_PRICES_ROUTE = '/api/update-prices' as const;
const DEFAULT_PRICE_MODEL = 'gemini-2.5-flash-lite';
const DEFAULT_REVIEW_THRESHOLD = 0.15;

class UpdatePricesError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'UpdatePricesError';
    this.status = status;
  }
}

function getPriceUpdateModel() {
  return process.env.GEMINI_PRICE_UPDATE_MODEL?.trim() || DEFAULT_PRICE_MODEL;
}

function getReviewThreshold() {
  const raw = Number(process.env.PRICE_UPDATE_REVIEW_THRESHOLD_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REVIEW_THRESHOLD;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new UpdatePricesError(
      '未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法執行 AI 價格更新。',
      500,
    );
  }

  return apiKey;
}

function normalizeRequest(payload: unknown): PriceUpdateRequest {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('assets' in payload) ||
    !Array.isArray(payload.assets)
  ) {
    throw new UpdatePricesError('價格更新請求格式不正確。', 400);
  }

  const assets = payload.assets
    .map((asset) => normalizeRequestAsset(asset))
    .filter((asset): asset is PriceUpdateRequestAsset => asset !== null);

  if (assets.length === 0) {
    throw new UpdatePricesError('未提供可更新的資產。', 400);
  }

  return { assets };
}

function normalizeRequestAsset(asset: unknown): PriceUpdateRequestAsset | null {
  if (typeof asset !== 'object' || asset === null) {
    return null;
  }

  const value = asset as Record<string, unknown>;

  if (
    typeof value.assetId !== 'string' ||
    typeof value.assetName !== 'string' ||
    typeof value.ticker !== 'string' ||
    typeof value.assetType !== 'string' ||
    typeof value.currentPrice !== 'number' ||
    typeof value.currency !== 'string'
  ) {
    return null;
  }

  return {
    assetId: value.assetId,
    assetName: value.assetName,
    ticker: value.ticker,
    assetType: normalizeAssetType(value.assetType),
    currentPrice: value.currentPrice,
    currency: value.currency.trim().toUpperCase(),
  };
}

function normalizeAssetType(value: string): AssetType {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stock') return 'stock';
  if (normalized === 'etf') return 'etf';
  if (normalized === 'bond') return 'bond';
  if (normalized === 'crypto') return 'crypto';
  return 'cash';
}

function sanitizeString(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function sanitizeNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function sanitizeAssetType(value: unknown): AssetType | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'stock') return 'stock';
  if (normalized === 'etf') return 'etf';
  if (normalized === 'bond') return 'bond';
  if (normalized === 'crypto') return 'crypto';
  if (normalized === 'cash') return 'cash';
  return null;
}

function sanitizeConfidence(value: unknown) {
  const parsed = sanitizeNumber(value);
  if (parsed == null) {
    return null;
  }

  return Math.min(Math.max(parsed, 0), 1);
}

function stripJsonFence(text: string) {
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

function parseModelJson(text: string) {
  try {
    return JSON.parse(stripJsonFence(text)) as unknown;
  } catch {
    throw new UpdatePricesError('Gemini 未回傳可解析的 JSON，請稍後再試。', 502);
  }
}

function sanitizePriceUpdateResults(rawPayload: unknown) {
  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    !('results' in rawPayload) ||
    !Array.isArray(rawPayload.results)
  ) {
    throw new UpdatePricesError('Gemini 回傳格式不正確，未找到 results 陣列。', 502);
  }

  return rawPayload.results.map((item) => {
    const value =
      typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : {};

    return {
      assetName: sanitizeString(value.assetName),
      ticker: sanitizeString(value.ticker),
      assetType: sanitizeAssetType(value.assetType),
      price: sanitizeNumber(value.price),
      currency: sanitizeString(value.currency)?.toUpperCase() ?? null,
      asOf: sanitizeString(value.asOf),
      sourceName: sanitizeString(value.sourceName),
      sourceUrl: sanitizeString(value.sourceUrl),
      confidence: sanitizeConfidence(value.confidence),
      needsReview: Boolean(value.needsReview),
    };
  });
}

function buildPrompt(assets: PriceUpdateRequestAsset[]) {
  return `
You are an AI price update assistant.

Return ONLY raw JSON. Do not use markdown fences. Do not include any explanation.

Use this exact schema:
{
  "results": [
    {
      "assetName": string,
      "ticker": string,
      "assetType": "stock" | "etf" | "bond" | "crypto" | "cash",
      "price": number,
      "currency": string,
      "asOf": string,
      "sourceName": string,
      "sourceUrl": string,
      "confidence": number,
      "needsReview": boolean
    }
  ]
}

Rules:
- Return exactly one result for each input asset.
- Keep assetName, ticker, assetType, and currency aligned with the input asset unless a correction is clearly needed.
- price must be the latest market price per unit from the most recent trading session or live quote available.
- Never copy the input currentPrice unless you can verify that it is still the latest market price.
- asOf must be the actual quote timestamp or most recent trading-session timestamp in ISO-8601 format.
- sourceName should identify the source used.
- sourceUrl should be a direct source URL when possible.
- confidence must be between 0 and 1.
- needsReview should be true if the result is uncertain, stale, source is weak, or price may be unreliable.
- No extra fields.

Input assets:
${JSON.stringify(assets, null, 2)}
  `.trim();
}

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'assetName',
          'ticker',
          'assetType',
          'price',
          'currency',
          'asOf',
          'sourceName',
          'sourceUrl',
          'confidence',
          'needsReview',
        ],
        properties: {
          assetName: { type: 'string' },
          ticker: { type: 'string' },
          assetType: { type: 'string', enum: ['stock', 'etf', 'bond', 'crypto', 'cash'] },
          price: { type: 'number' },
          currency: { type: 'string' },
          asOf: { type: 'string' },
          sourceName: { type: 'string' },
          sourceUrl: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          needsReview: { type: 'boolean' },
        },
      },
    },
  },
} as const;

function parseAsOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getQuoteFreshnessWindowMs(assetType: AssetType) {
  if (assetType === 'crypto') {
    return 36 * 60 * 60 * 1000;
  }

  return 4 * 24 * 60 * 60 * 1000;
}

function isStaleQuote(asOf: string | null | undefined, assetType: AssetType) {
  const parsed = parseAsOf(asOf);

  if (!parsed) {
    return true;
  }

  return Date.now() - parsed.getTime() > getQuoteFreshnessWindowMs(assetType);
}

async function generatePriceResponseWithFallback(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
) {
  try {
    return await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema,
        tools: [{ googleSearch: {} }],
      },
    });
  } catch {
    return ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0.1,
        responseMimeType: 'application/json',
        responseJsonSchema,
      },
    });
  }
}

function buildReviewResults(
  requestedAssets: PriceUpdateRequestAsset[],
  modelResults: PriceUpdateModelResult[],
): PendingPriceUpdateReview[] {
  const threshold = getReviewThreshold();

  return requestedAssets.map((asset, index) => {
    const matched =
      modelResults.find(
        (item) =>
          item.ticker?.toUpperCase() === asset.ticker.toUpperCase() ||
          item.assetName?.toLowerCase() === asset.assetName.toLowerCase(),
      ) ?? modelResults[index];

    const nextPrice = matched?.price ?? null;
    const staleQuote = isStaleQuote(matched?.asOf, asset.assetType);
    const invalidReason =
      nextPrice == null || nextPrice <= 0
        ? 'AI 未取得有效最新價格'
        : staleQuote
          ? '報價過時，已拒絕使用'
          : '';
    const diffPct =
      nextPrice != null && asset.currentPrice > 0
        ? Math.abs(nextPrice - asset.currentPrice) / asset.currentPrice
        : 0;

    const forcedNeedsReview =
      nextPrice == null ||
      nextPrice <= 0 ||
      staleQuote ||
      diffPct >= threshold ||
      !matched?.sourceName ||
      !matched?.sourceUrl ||
      (matched?.confidence ?? 0) < 0.75;

    return {
      id: asset.assetId,
      assetId: asset.assetId,
      assetName: matched?.assetName ?? asset.assetName,
      ticker: matched?.ticker?.toUpperCase() ?? asset.ticker.toUpperCase(),
      assetType: matched?.assetType ?? asset.assetType,
      price: staleQuote ? null : nextPrice,
      currency: matched?.currency?.toUpperCase() ?? asset.currency,
      asOf: staleQuote ? '' : matched?.asOf ?? new Date().toISOString(),
      sourceName: staleQuote ? '報價過時，已拒絕使用' : matched?.sourceName ?? '',
      sourceUrl: matched?.sourceUrl ?? '',
      confidence: staleQuote ? 0 : matched?.confidence ?? 0,
      needsReview: Boolean(matched?.needsReview) || forcedNeedsReview,
      currentPrice: asset.currentPrice,
      diffPct,
      invalidReason,
      status: 'pending',
    };
  });
}

export function getUpdatePricesErrorResponse(error: unknown) {
  if (error instanceof UpdatePricesError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: UPDATE_PRICES_ROUTE,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: UPDATE_PRICES_ROUTE,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route: UPDATE_PRICES_ROUTE,
      message: 'AI 價格更新失敗，請稍後再試。',
    },
  };
}

export async function generatePriceUpdates(payload: unknown) {
  const request = normalizeRequest(payload);
  const apiKey = getGeminiApiKey();
  const model = getPriceUpdateModel();
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(request.assets);
  const response = await generatePriceResponseWithFallback(ai, model, prompt);
  const raw = parseModelJson(response.text ?? '');
  const sanitizedResults = sanitizePriceUpdateResults(raw);
  const results = buildReviewResults(request.assets, sanitizedResults);

  return {
    ok: true,
    route: UPDATE_PRICES_ROUTE,
    mode: 'live',
    model,
    results,
  };
}
