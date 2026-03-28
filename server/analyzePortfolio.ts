import { GoogleGenAI } from '@google/genai';

import type { AssetType } from '../src/types/portfolio';
import type {
  PortfolioAnalysisRequest,
  PortfolioAnalysisResponse,
  PortfolioAnalysisResult,
} from '../src/types/portfolioAnalysis';

const ANALYZE_ROUTE = '/api/analyze' as const;
const DEFAULT_ANALYZE_MODEL = 'gemini-2.5-pro';

class AnalyzePortfolioError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AnalyzePortfolioError';
    this.status = status;
  }
}

function getAnalyzeModel() {
  return process.env.GEMINI_ANALYZE_MODEL?.trim() || DEFAULT_ANALYZE_MODEL;
}

function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();

  if (!apiKey) {
    throw new AnalyzePortfolioError(
      '未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法分析投資組合。',
      500,
    );
  }

  return apiKey;
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

function sanitizeStringList(value: unknown, minimumItems: number) {
  if (!Array.isArray(value)) {
    return null;
  }

  const items = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);

  return items.length >= minimumItems ? items : null;
}

function normalizeAnalysisRequest(payload: unknown): PortfolioAnalysisRequest {
  if (typeof payload !== 'object' || payload === null) {
    throw new AnalyzePortfolioError('投資組合分析請求格式不正確。', 400);
  }

  const value = payload as Record<string, unknown>;
  const snapshotHash = sanitizeString(value.snapshotHash);
  const assetCount = sanitizeNumber(value.assetCount);
  const totalValueHKD = sanitizeNumber(value.totalValueHKD);
  const totalCostHKD = sanitizeNumber(value.totalCostHKD);

  if (!snapshotHash) {
    throw new AnalyzePortfolioError('缺少投資組合快照識別碼，請重新整理後再試。', 400);
  }

  if (!Array.isArray(value.holdings) || value.holdings.length === 0) {
    throw new AnalyzePortfolioError('目前沒有可分析的資產。', 400);
  }

  const holdings = value.holdings
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const asset = item as Record<string, unknown>;
      const id = sanitizeString(asset.id);
      const name = sanitizeString(asset.name);
      const ticker = sanitizeString(asset.ticker);
      const assetType = sanitizeAssetType(asset.assetType);
      const accountSource = sanitizeString(asset.accountSource);
      const currency = sanitizeString(asset.currency);
      const quantity = sanitizeNumber(asset.quantity);
      const averageCost = sanitizeNumber(asset.averageCost);
      const currentPrice = sanitizeNumber(asset.currentPrice);
      const marketValue = sanitizeNumber(asset.marketValue);
      const costValue = sanitizeNumber(asset.costValue);

      if (
        !id ||
        !name ||
        !ticker ||
        !assetType ||
        !accountSource ||
        !currency ||
        quantity == null ||
        averageCost == null ||
        currentPrice == null ||
        marketValue == null ||
        costValue == null
      ) {
        return null;
      }

      return {
        id,
        name,
        ticker,
        assetType,
        accountSource,
        currency: currency.toUpperCase(),
        quantity,
        averageCost,
        currentPrice,
        marketValue,
        costValue,
      };
    })
    .filter((item): item is PortfolioAnalysisRequest['holdings'][number] => item !== null);

  if (holdings.length === 0) {
    throw new AnalyzePortfolioError('目前沒有完整的資產資料可分析。', 400);
  }

  const allocationsByType = Array.isArray(value.allocationsByType)
    ? value.allocationsByType
        .map((item) => {
          if (typeof item !== 'object' || item === null) {
            return null;
          }

          const allocation = item as Record<string, unknown>;
          const assetType = sanitizeAssetType(allocation.assetType);
          const percentage = sanitizeNumber(allocation.percentage);
          const bucketTotal = sanitizeNumber(allocation.totalValueHKD);

          if (!assetType || percentage == null || bucketTotal == null) {
            return null;
          }

          return {
            assetType,
            percentage,
            totalValueHKD: bucketTotal,
          };
        })
        .filter(
          (
            item,
          ): item is PortfolioAnalysisRequest['allocationsByType'][number] => item !== null,
        )
    : [];

  const allocationsByCurrency = Array.isArray(value.allocationsByCurrency)
    ? value.allocationsByCurrency
        .map((item) => {
          if (typeof item !== 'object' || item === null) {
            return null;
          }

          const allocation = item as Record<string, unknown>;
          const currency = sanitizeString(allocation.currency);
          const percentage = sanitizeNumber(allocation.percentage);
          const bucketTotal = sanitizeNumber(allocation.totalValueHKD);

          if (!currency || percentage == null || bucketTotal == null) {
            return null;
          }

          return {
            currency: currency.toUpperCase(),
            percentage,
            totalValueHKD: bucketTotal,
          };
        })
        .filter(
          (
            item,
          ): item is PortfolioAnalysisRequest['allocationsByCurrency'][number] => item !== null,
        )
    : [];

  return {
    snapshotHash,
    assetCount: assetCount ?? holdings.length,
    totalValueHKD: totalValueHKD ?? 0,
    totalCostHKD: totalCostHKD ?? 0,
    holdings,
    allocationsByType,
    allocationsByCurrency,
  };
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
    throw new AnalyzePortfolioError('Gemini 未回傳可解析的分析 JSON，請稍後再試。', 502);
  }
}

function sanitizeAnalysisResult(rawPayload: unknown): PortfolioAnalysisResult {
  if (typeof rawPayload !== 'object' || rawPayload === null) {
    throw new AnalyzePortfolioError('Gemini 回傳格式不正確。', 502);
  }

  const value = rawPayload as Record<string, unknown>;
  const summary = sanitizeString(value.summary);
  const topRisks = sanitizeStringList(value.topRisks, 1);
  const allocationInsights = sanitizeStringList(value.allocationInsights, 1);
  const currencyExposure = sanitizeStringList(value.currencyExposure, 1);
  const nextQuestions = sanitizeStringList(value.nextQuestions, 1);

  if (!summary || !topRisks || !allocationInsights || !currencyExposure || !nextQuestions) {
    throw new AnalyzePortfolioError('Gemini 回傳欄位不完整，請稍後再試。', 502);
  }

  return {
    summary,
    topRisks,
    allocationInsights,
    currencyExposure,
    nextQuestions,
  };
}

function buildPrompt(request: PortfolioAnalysisRequest) {
  return `
You are a portfolio analysis assistant.

Analyze ONLY the portfolio snapshot provided below.
Return ONLY raw JSON. Do not use markdown fences. Do not add any explanation outside JSON.

Use this exact schema:
{
  "summary": string,
  "topRisks": string[],
  "allocationInsights": string[],
  "currencyExposure": string[],
  "nextQuestions": string[]
}

Rules:
- Write all output in Traditional Chinese.
- Base your reasoning only on the provided holdings, latest prices, asset categories, currencies, and average costs.
- Do not invent historical returns, dividends, macro news, or external facts that are not present in the input.
- summary should be 2 to 4 sentences and should explicitly mention the biggest allocation or concentration pattern.
- topRisks should contain 3 to 5 short bullets about concentration, diversification gaps, liquidity, or data limitations.
- allocationInsights should contain 3 to 5 concrete observations tied to the actual asset type weights or cost structure.
- currencyExposure should contain 2 to 4 short bullets about HKD/USD or other visible currency concentration.
- nextQuestions should contain 3 to 5 short, actionable follow-up questions the user may want to ask next.
- If the data lacks price history or cash-flow history, mention that limitation briefly where relevant.
- Keep the tone practical, calm, and beginner-friendly.

Portfolio snapshot:
${JSON.stringify(request, null, 2)}
  `.trim();
}

const responseJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'summary',
    'topRisks',
    'allocationInsights',
    'currencyExposure',
    'nextQuestions',
  ],
  properties: {
    summary: { type: 'string' },
    topRisks: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
    allocationInsights: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
    currencyExposure: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
    nextQuestions: {
      type: 'array',
      minItems: 1,
      items: { type: 'string' },
    },
  },
} as const;

export function getAnalyzePortfolioErrorResponse(error: unknown) {
  if (error instanceof AnalyzePortfolioError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: ANALYZE_ROUTE,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: ANALYZE_ROUTE,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route: ANALYZE_ROUTE,
      message: '投資組合分析失敗，請稍後再試。',
    },
  };
}

export async function analyzePortfolio(
  payload: unknown,
): Promise<PortfolioAnalysisResponse> {
  const request = normalizeAnalysisRequest(payload);
  const apiKey = getGeminiApiKey();
  const model = getAnalyzeModel();
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildPrompt(request);
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.3,
      responseMimeType: 'application/json',
      responseJsonSchema,
    },
  });
  const raw = parseModelJson(response.text ?? '');
  const result = sanitizeAnalysisResult(raw);

  return {
    ok: true,
    route: ANALYZE_ROUTE,
    mode: 'live',
    model,
    snapshotHash: request.snapshotHash,
    generatedAt: new Date().toISOString(),
    ...result,
  };
}
