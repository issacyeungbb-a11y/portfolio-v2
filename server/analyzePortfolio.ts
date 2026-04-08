import { GoogleGenAI } from '@google/genai';

import type { AnalysisCategory, AssetType } from '../src/types/portfolio';
import type {
  PortfolioAnalysisModel,
  PortfolioAnalysisProvider,
  PortfolioAnalysisRequest,
  PortfolioAnalysisResponse,
  PortfolioAnalysisResult,
} from '../src/types/portfolioAnalysis';

const ANALYZE_ROUTE = '/api/analyze' as const;
const DEFAULT_GEMINI_ANALYZE_MODEL = 'gemini-3.1-pro-preview' as const;
const DEFAULT_CLAUDE_ANALYZE_MODEL = 'claude-opus-4-6' as const;

const SUPPORTED_ANALYSIS_MODELS: Record<
  PortfolioAnalysisModel,
  { provider: PortfolioAnalysisProvider; label: string }
> = {
  'gemini-3.1-pro-preview': {
    provider: 'google',
    label: 'Google Gemini 3.1 Pro Preview',
  },
  'claude-opus-4-6': {
    provider: 'anthropic',
    label: 'Claude Opus 4.6',
  },
};

class AnalyzePortfolioError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'AnalyzePortfolioError';
    this.status = status;
  }
}

function getGeminiAnalyzeModel(requestedModel: PortfolioAnalysisModel) {
  return requestedModel === 'gemini-3.1-pro-preview'
    ? requestedModel
    : DEFAULT_GEMINI_ANALYZE_MODEL;
}

function getClaudeAnalyzeModel() {
  const model = process.env.CLAUDE_ANALYZE_MODEL?.trim() || DEFAULT_CLAUDE_ANALYZE_MODEL;
  return model === 'claude-opus-4-6' ? model : DEFAULT_CLAUDE_ANALYZE_MODEL;
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

function getAnthropicApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();

  if (!apiKey) {
    throw new AnalyzePortfolioError(
      '未設定 ANTHROPIC_API_KEY，暫時無法使用 Claude 分析投資組合。',
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

function sanitizeAnalysisModel(value: unknown): PortfolioAnalysisModel | null {
  if (value === 'gemini-3.1-pro-preview' || value === 'claude-opus-4-6') {
    return value;
  }

  return null;
}

function sanitizeAnalysisCategory(value: unknown): AnalysisCategory | null {
  if (value === 'asset_analysis' || value === 'general_question' || value === 'asset_report') {
    return value;
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

function normalizeAnalysisRequest(payload: unknown): PortfolioAnalysisRequest {
  if (typeof payload !== 'object' || payload === null) {
    throw new AnalyzePortfolioError('投資組合分析請求格式不正確。', 400);
  }

  const value = payload as Record<string, unknown>;
  const cacheKey = sanitizeString(value.cacheKey);
  const snapshotHash = sanitizeString(value.snapshotHash);
  const category = sanitizeAnalysisCategory(value.category);
  const analysisModel = sanitizeAnalysisModel(value.analysisModel);
  const analysisInstruction = sanitizeString(value.analysisInstruction) ?? '';
  const assetCount = sanitizeNumber(value.assetCount);
  const totalValueHKD = sanitizeNumber(value.totalValueHKD);
  const totalCostHKD = sanitizeNumber(value.totalCostHKD);

  if (!cacheKey) {
    throw new AnalyzePortfolioError('缺少分析快取識別碼，請重新整理後再試。', 400);
  }

  if (!snapshotHash) {
    throw new AnalyzePortfolioError('缺少投資組合快照識別碼，請重新整理後再試。', 400);
  }

  if (!analysisModel) {
    throw new AnalyzePortfolioError('分析模型設定不正確，請重新選擇後再試。', 400);
  }

  if (!category) {
    throw new AnalyzePortfolioError('分析類別設定不正確，請重新選擇後再試。', 400);
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
    cacheKey,
    snapshotHash,
    category,
    analysisModel,
    analysisInstruction,
    assetCount: assetCount ?? holdings.length,
    totalValueHKD: totalValueHKD ?? 0,
    totalCostHKD: totalCostHKD ?? 0,
    holdings,
    allocationsByType,
    allocationsByCurrency,
  };
}

function sanitizeAnalysisResult(rawPayload: unknown): PortfolioAnalysisResult {
  if (typeof rawPayload === 'string') {
    const answer = rawPayload.trim();
    if (!answer) {
      throw new AnalyzePortfolioError('模型未有回傳分析內容。', 502);
    }

    return { answer };
  }

  if (typeof rawPayload !== 'object' || rawPayload === null) {
    throw new AnalyzePortfolioError('模型回傳格式不正確。', 502);
  }

  const value = rawPayload as Record<string, unknown>;
  const answer = sanitizeString(value.answer);

  if (!answer) {
    throw new AnalyzePortfolioError('模型未有回傳分析內容。', 502);
  }

  return {
    answer,
  };
}

function getCategoryPromptPrefix(category: AnalysisCategory) {
  if (category === 'general_question') {
    return `
Category: 一般問題
- 將自己視為投資組合助手。
- 直接回答使用者問題。
- 若問題與資產直接相關，可引用持倉數據。
- 若問題較泛，仍以目前組合背景作答，但不要強行變成完整資產診斷。
    `.trim();
  }

  if (category === 'asset_report') {
    return `
Category: 資產報告
- 將回答寫成可閱讀的資產報告。
- 優先整理：整體概覽、重點持倉、主要風險、值得跟進項目。
- 語氣保持專業、清晰、可回顧。
    `.trim();
  }

  return `
Category: 分析資產
- 聚焦診斷目前投資組合。
- 先指出最值得留意的持倉、集中度、風險與配置問題。
- 若使用者要求建議，提供具體而克制的下一步方向。
  `.trim();
}

function buildPrompt(request: PortfolioAnalysisRequest) {
  return `
You are a portfolio analysis assistant.

Analyze ONLY the portfolio snapshot provided below.
Return ONLY the final answer text in Traditional Chinese. Do not use markdown code fences.

Rules:
- Write all output in Traditional Chinese.
- Base your reasoning only on the provided holdings, latest prices, asset categories, currencies, and average costs.
- Do not invent historical returns, dividends, macro news, or external facts that are not present in the input.
- If the data lacks price history or cash-flow history, mention that limitation briefly where relevant.
- Keep the tone practical, calm, and beginner-friendly.
- Prioritize the user's analysis instruction when deciding what to emphasize, but do not invent any external facts or unsupported claims.
- Answer the user's instruction directly. Do not force your response into sections unless the user's question naturally calls for it.
- If the user's instruction asks for a comparison, recommendation, or explanation, answer that request directly in flowing prose or a natural list.

${getCategoryPromptPrefix(request.category)}

User analysis instruction:
${request.analysisInstruction || '未提供額外指示，請做一般投資組合分析。'}

Portfolio snapshot:
${JSON.stringify(request, null, 2)}
  `.trim();
}

function getModelProvider(model: PortfolioAnalysisModel): PortfolioAnalysisProvider {
  return SUPPORTED_ANALYSIS_MODELS[model].provider;
}

async function analyzeWithGemini(
  prompt: string,
  model: Extract<PortfolioAnalysisModel, 'gemini-3.1-pro-preview'>,
) {
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.3,
    },
  });

  return response.text ?? '';
}

async function analyzeWithClaude(
  prompt: string,
  model: Extract<PortfolioAnalysisModel, 'claude-opus-4-6'>,
) {
  const apiKey = getAnthropicApiKey();
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1400,
      temperature: 0.3,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;

  if (!response.ok) {
    const errorMessage =
      typeof payload.error === 'object' &&
      payload.error !== null &&
      'message' in payload.error &&
      typeof payload.error.message === 'string'
        ? payload.error.message
        : 'Claude 分析請求失敗，請稍後再試。';

    throw new AnalyzePortfolioError(errorMessage, response.status);
  }

  const content = Array.isArray(payload.content) ? payload.content : [];
  const text = content
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return '';
      }

      const value = item as Record<string, unknown>;
      return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
    })
    .join('\n');

  return text;
}

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
  const prompt = buildPrompt(request);
  const provider = getModelProvider(request.analysisModel);
  const resolvedModel =
    request.analysisModel === 'claude-opus-4-6'
      ? getClaudeAnalyzeModel()
      : getGeminiAnalyzeModel(request.analysisModel);
  const raw =
    provider === 'anthropic'
      ? await analyzeWithClaude(prompt, resolvedModel as 'claude-opus-4-6')
      : await analyzeWithGemini(prompt, resolvedModel as 'gemini-3.1-pro-preview');
  const result = sanitizeAnalysisResult(raw);

  return {
    ok: true,
    route: ANALYZE_ROUTE,
    mode: 'live',
    cacheKey: request.cacheKey,
    category: request.category,
    provider,
    model: resolvedModel,
    snapshotHash: request.snapshotHash,
    analysisInstruction: request.analysisInstruction,
    generatedAt: new Date().toISOString(),
    ...result,
  };
}
