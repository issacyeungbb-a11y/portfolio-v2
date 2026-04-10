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
const DEFAULT_CRYPTO_REVIEW_THRESHOLD = 0.3;
const PRICE_UPDATE_BATCH_SIZE = 4;
const DEFAULT_MIN_AUTO_APPLY_CONFIDENCE = 0.6;

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

function getCryptoReviewThreshold() {
  const raw = Number(process.env.PRICE_UPDATE_CRYPTO_THRESHOLD_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_CRYPTO_REVIEW_THRESHOLD;
}

function getReviewThresholdForAsset(assetType: AssetType) {
  if (assetType === 'crypto') {
    return getCryptoReviewThreshold();
  }

  return getReviewThreshold();
}

function getMinAutoApplyConfidence() {
  const raw = Number(process.env.PRICE_UPDATE_MIN_CONFIDENCE);
  return Number.isFinite(raw) && raw > 0 ? Math.min(raw, 1) : DEFAULT_MIN_AUTO_APPLY_CONFIDENCE;
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
    .filter((asset): asset is PriceUpdateRequestAsset => asset !== null)
    .filter((asset) => asset.assetType !== 'cash');

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

function isLikelyHongKongTicker(ticker: string, currency: string) {
  const normalizedTicker = ticker.trim().toUpperCase();
  const normalizedCurrency = currency.trim().toUpperCase();

  return (
    normalizedCurrency === 'HKD' &&
    (/^\d{4,5}$/.test(normalizedTicker) || /^\d{4,5}\.HK$/.test(normalizedTicker))
  );
}

function buildHongKongTickerVariants(ticker: string) {
  const normalizedTicker = ticker.trim().toUpperCase().replace(/\.HK$/, '');
  const paddedTicker = normalizedTicker.padStart(4, '0');

  return Array.from(
    new Set([
      normalizedTicker,
      paddedTicker,
      `${paddedTicker}.HK`,
      `${normalizedTicker}.HK`,
      `HKG:${paddedTicker}`,
      `HKEX ${paddedTicker}`,
    ]),
  );
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

function extractFirstJsonCandidate(text: string) {
  const trimmed = stripJsonFence(text);

  const objectStart = trimmed.indexOf('{');
  const arrayStart = trimmed.indexOf('[');
  const startCandidates = [objectStart, arrayStart].filter((value) => value >= 0);

  if (startCandidates.length === 0) {
    return trimmed;
  }

  const start = Math.min(...startCandidates);
  const opening = trimmed[start];
  const closing = opening === '[' ? ']' : '}';
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }

      if (character === '\\') {
        escaped = true;
        continue;
      }

      if (character === '"') {
        inString = false;
      }

      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === opening) {
      depth += 1;
      continue;
    }

    if (character === closing) {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return trimmed.slice(start);
}

function parseModelJson(text: string) {
  try {
    return JSON.parse(extractFirstJsonCandidate(text)) as unknown;
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

function sanitizeSinglePriceUpdateResult(rawPayload: unknown) {
  if (
    typeof rawPayload !== 'object' ||
    rawPayload === null ||
    !('result' in rawPayload) ||
    typeof rawPayload.result !== 'object' ||
    rawPayload.result === null
  ) {
    throw new UpdatePricesError('Gemini 回傳格式不正確，未找到 result 物件。', 502);
  }

  const value = rawPayload.result as Record<string, unknown>;

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
  } satisfies PriceUpdateModelResult;
}

function createFailedModelResult(
  asset: PriceUpdateRequestAsset,
  reason: string,
): PriceUpdateModelResult {
  return {
    assetName: asset.assetName,
    ticker: asset.ticker,
    assetType: asset.assetType,
    price: 0,
    currency: asset.currency,
    asOf: '',
    sourceName: reason,
    sourceUrl: '',
    confidence: 0,
    needsReview: true,
  };
}

function detectFailureCategory(params: {
  asset: PriceUpdateRequestAsset;
  matched?: PriceUpdateModelResult;
  nextPrice: number | null;
  staleQuote: boolean;
  diffPct: number;
}) {
  const { asset, matched, nextPrice, staleQuote, diffPct } = params;
  const minimumConfidence = getMinAutoApplyConfidence();
  const reviewThreshold = getReviewThresholdForAsset(asset.assetType);
  const sourceText = `${matched?.sourceName ?? ''} ${matched?.sourceUrl ?? ''}`.toLowerCase();

  if (sourceText.includes('格式不正確') || sourceText.includes('補查失敗')) {
    return 'response_format' as const;
  }

  if (nextPrice == null || nextPrice <= 0) {
    if (isLikelyHongKongTicker(asset.ticker, asset.currency)) {
      return 'ticker_format' as const;
    }

    return 'price_missing' as const;
  }

  if (staleQuote) {
    return 'quote_time' as const;
  }

  if (!(matched?.sourceName || matched?.sourceUrl)) {
    return 'source_missing' as const;
  }

  if ((matched?.confidence ?? 0) < minimumConfidence) {
    return 'confidence_low' as const;
  }

  if (diffPct >= reviewThreshold) {
    return 'diff_too_large' as const;
  }

  return 'unknown' as const;
}

function buildInvalidReason(
  category: NonNullable<PendingPriceUpdateReview['failureCategory']>,
) {
  if (category === 'ticker_format') return '代號格式可能有問題，AI 未能準確對應市場報價';
  if (category === 'quote_time') return 'quote 時間過時，已拒絕使用';
  if (category === 'source_missing') return '來源不足，未提供可信來源名稱或網址';
  if (category === 'response_format') return '模型回覆格式不正確，未能穩定解析';
  if (category === 'price_missing') return 'AI 未取得有效最新價格';
  if (category === 'confidence_low') return '可信度不足，暫不自動套用';
  if (category === 'diff_too_large') return '價格差距過大，需要人工檢查';
  return '未能自動更新，請再檢查';
}

function tryParseSingleModelResult(
  asset: PriceUpdateRequestAsset,
  rawText: string,
  reason: string,
) {
  try {
    return sanitizeSinglePriceUpdateResult(parseModelJson(rawText));
  } catch {
    return createFailedModelResult(asset, reason);
  }
}

function buildAssetSearchHints(asset: PriceUpdateRequestAsset) {
  const hints = [
    `${asset.ticker} latest price`,
    `${asset.assetName} latest price`,
  ];

  if (asset.ticker.endsWith('.HK') || isLikelyHongKongTicker(asset.ticker, asset.currency)) {
    const hongKongTickerVariants = buildHongKongTickerVariants(asset.ticker);
    for (const variant of hongKongTickerVariants) {
      hints.push(`${variant} HKEX latest price`);
      hints.push(`${variant} Google Finance`);
      hints.push(`${variant} Yahoo Finance`);
    }
    hints.push(`${asset.ticker} HKEX latest price`);
  } else if (asset.currency === 'USD') {
    hints.push(`${asset.ticker} NASDAQ latest price`);
    hints.push(`${asset.ticker} NYSE latest price`);
  }

  if (asset.assetType === 'etf') {
    hints.push(`${asset.ticker} ETF latest market price`);
  }

  if (asset.assetType === 'bond') {
    hints.push(`${asset.ticker} bond ETF latest market price`);
  }

  if (asset.assetType === 'crypto') {
    hints.push(`${asset.ticker} crypto USD latest price`);
    hints.push(`${asset.ticker} USD CoinGecko price`);
    hints.push(`${asset.ticker} USD CoinMarketCap latest`);
    hints.push(`${asset.ticker} USD Binance spot price today`);
  }

  return hints;
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

function buildSingleAssetPrompt(
  asset: PriceUpdateRequestAsset,
  mode: 'primary' | 'retry',
) {
  const extraRetryRules =
    mode === 'retry'
      ? `
- Retry mode: search more aggressively and prefer the official exchange, Google Finance, Yahoo Finance market pages, or issuer/market pages.
- Do not return a result unless you found a fresh quote timestamp or clearly current market page.
- If you still cannot verify a fresh quote, return price as 0, confidence as 0, needsReview as true, and explain failure in sourceName.
`
      : '';

  return `
You are an AI price update assistant for a single asset.

Return ONLY raw JSON. Do not use markdown fences. Do not include any explanation.

Use this exact schema:
{
  "result": {
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
}

Rules:
- Find the latest market price for this asset.
- Use the most recent trading session or live quote available.
- Never copy the input currentPrice unless you verified it from an external source.
- asOf must be the actual quote timestamp or latest trading-session timestamp in ISO-8601 format.
- sourceName should clearly name the source used.
- sourceUrl should be a direct source URL when possible.
- confidence must be between 0 and 1.
- needsReview should be true if there is any uncertainty.
${extraRetryRules}

Asset:
${JSON.stringify(asset, null, 2)}

Suggested searches:
${JSON.stringify(buildAssetSearchHints(asset), null, 2)}
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

const singleResultJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['result'],
  properties: {
    result: {
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
} as const;

function parseAsOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const directParsed = new Date(value);
  if (!Number.isNaN(directParsed.getTime())) {
    return directParsed;
  }

  const normalized = value
    .trim()
    .replace(/\bHKT\b/gi, '+08:00')
    .replace(/\bHKT CLOSE\b/gi, '16:00:00+08:00')
    .replace(/\bCLOSE\b/gi, '16:00:00')
    .replace(/\//g, '-');

  const normalizedParsed = new Date(normalized);
  if (!Number.isNaN(normalizedParsed.getTime())) {
    return normalizedParsed;
  }

  const dateOnlyMatch = normalized.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (dateOnlyMatch) {
    const assumedClose = new Date(`${dateOnlyMatch[1]}T16:00:00+08:00`);
    return Number.isNaN(assumedClose.getTime()) ? null : assumedClose;
  }

  return null;
}

function getQuoteFreshnessWindowMs(assetType: AssetType) {
  if (assetType === 'crypto') {
    return 72 * 60 * 60 * 1000;
  }

  return 2 * 24 * 60 * 60 * 1000;
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

async function generateSingleAssetPriceResponse(
  ai: GoogleGenAI,
  model: string,
  prompt: string,
) {
  try {
    return await ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0,
        tools: [{ googleSearch: {} }],
      },
    });
  } catch {
    return ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: singleResultJsonSchema,
      },
    });
  }
}

function isUsableModelResult(asset: PriceUpdateRequestAsset, result: PriceUpdateModelResult) {
  const minimumConfidence = getMinAutoApplyConfidence();
  const hasUsableSource = Boolean(result.sourceName || result.sourceUrl);

  return (
    result.price != null &&
    result.price > 0 &&
    hasUsableSource &&
    (result.confidence ?? 0) >= minimumConfidence &&
    !isStaleQuote(result.asOf, asset.assetType)
  );
}

async function generateBestPriceForAsset(
  ai: GoogleGenAI,
  model: string,
  asset: PriceUpdateRequestAsset,
) {
  const primaryPrompt = buildSingleAssetPrompt(asset, 'primary');
  const primaryResponse = await generateSingleAssetPriceResponse(ai, model, primaryPrompt);
  const primaryResult = tryParseSingleModelResult(
    asset,
    primaryResponse.text ?? '',
    'Gemini primary 回覆格式不正確',
  );

  if (isUsableModelResult(asset, primaryResult)) {
    return primaryResult;
  }

  const retryPrompt = buildSingleAssetPrompt(asset, 'retry');
  const retryResponse = await generateSingleAssetPriceResponse(ai, model, retryPrompt);
  const retryResult = tryParseSingleModelResult(
    asset,
    retryResponse.text ?? '',
    'Gemini retry 回覆格式不正確',
  );

  if (isUsableModelResult(asset, retryResult)) {
    return retryResult;
  }

  return (retryResult.confidence ?? 0) >= (primaryResult.confidence ?? 0)
    ? retryResult
    : primaryResult;
}

function buildReviewResults(
  requestedAssets: PriceUpdateRequestAsset[],
  modelResults: PriceUpdateModelResult[],
): PendingPriceUpdateReview[] {
  const minimumConfidence = getMinAutoApplyConfidence();

  return requestedAssets.map((asset, index) => {
    const threshold = getReviewThresholdForAsset(asset.assetType);
    const matched =
      modelResults.find(
        (item) =>
          item.ticker?.toUpperCase() === asset.ticker.toUpperCase() ||
          item.assetName?.toLowerCase() === asset.assetName.toLowerCase(),
      ) ?? modelResults[index];

    const nextPrice = matched?.price ?? null;
    const staleQuote = isStaleQuote(matched?.asOf, asset.assetType);
    const diffPct =
      nextPrice != null && asset.currentPrice > 0
        ? Math.abs(nextPrice - asset.currentPrice) / asset.currentPrice
        : 0;

    const forcedNeedsReview =
      nextPrice == null ||
      nextPrice <= 0 ||
      staleQuote ||
      diffPct >= threshold ||
      !(matched?.sourceName || matched?.sourceUrl) ||
      (matched?.confidence ?? 0) < minimumConfidence;
    const failureCategory = forcedNeedsReview
      ? detectFailureCategory({
          asset,
          matched,
          nextPrice,
          staleQuote,
          diffPct,
        })
      : undefined;
    const invalidReason = failureCategory ? buildInvalidReason(failureCategory) : '';

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
      failureCategory,
      invalidReason,
      status: 'pending',
    };
  });
}

async function generatePriceUpdatesForBatch(
  ai: GoogleGenAI,
  model: string,
  assets: PriceUpdateRequestAsset[],
) {
  const prompt = buildPrompt(assets);
  let sanitizedResults: PriceUpdateModelResult[];

  try {
    const response = await generatePriceResponseWithFallback(ai, model, prompt);
    const raw = parseModelJson(response.text ?? '');
    sanitizedResults = sanitizePriceUpdateResults(raw);
  } catch {
    sanitizedResults = [];
  }

  const missingOrWeakAssets = assets.filter((asset) => {
    const matched = sanitizedResults.find(
      (item) =>
        item.ticker?.toUpperCase() === asset.ticker.toUpperCase() ||
        item.assetName?.toLowerCase() === asset.assetName.toLowerCase(),
    );

    return !matched || !isUsableModelResult(asset, matched);
  });

  if (missingOrWeakAssets.length > 0) {
    const focusedResults = await Promise.all(
      missingOrWeakAssets.map(async (asset) => {
        try {
          return await generateBestPriceForAsset(ai, model, asset);
        } catch {
          return createFailedModelResult(asset, 'Gemini 單項補查失敗');
        }
      }),
    );

    sanitizedResults = [
      ...sanitizedResults.filter((item) =>
        !missingOrWeakAssets.some(
          (asset) =>
            item.ticker?.toUpperCase() === asset.ticker.toUpperCase() ||
            item.assetName?.toLowerCase() === asset.assetName.toLowerCase(),
        ),
      ),
      ...focusedResults,
    ];
  }

  return buildReviewResults(assets, sanitizedResults);
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
  const results: PendingPriceUpdateReview[] = [];

  for (let index = 0; index < request.assets.length; index += PRICE_UPDATE_BATCH_SIZE) {
    const assetBatch = request.assets.slice(index, index + PRICE_UPDATE_BATCH_SIZE);
    let batchResults: PendingPriceUpdateReview[];

    try {
      batchResults = await generatePriceUpdatesForBatch(ai, model, assetBatch);
    } catch {
      batchResults = buildReviewResults(
        assetBatch,
        assetBatch.map((asset) => createFailedModelResult(asset, 'Gemini 批次回覆格式不正確')),
      );
    }

    results.push(...batchResults);
  }

  return {
    ok: true,
    route: UPDATE_PRICES_ROUTE,
    mode: 'live',
    model,
    results,
  };
}
