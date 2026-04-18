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
const DEFAULT_CLAUDE_ANALYZE_MODEL = 'claude-opus-4-7' as const;

const SUPPORTED_ANALYSIS_MODELS: Record<
  PortfolioAnalysisModel,
  { provider: PortfolioAnalysisProvider; label: string }
> = {
  'gemini-3.1-pro-preview': {
    provider: 'google',
    label: 'Google Gemini 3.1 Pro Preview',
  },
  'claude-opus-4-7': {
    provider: 'anthropic',
    label: 'Claude Opus 4.7',
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
  return model === 'claude-opus-4-7' ? model : DEFAULT_CLAUDE_ANALYZE_MODEL;
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
  if (value === 'gemini-3.1-pro-preview' || value === 'claude-opus-4-7') {
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

function sanitizeTransactionType(value: unknown) {
  if (value === 'buy' || value === 'sell') {
    return value;
  }

  return null;
}

function normalizeRecentTransactions(value: unknown): PortfolioAnalysisRequest['recentTransactions'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const entry = item as Record<string, unknown>;
      const assetId = sanitizeString(entry.assetId);
      const assetName = sanitizeString(entry.assetName);
      const ticker = sanitizeString(entry.ticker);
      const transactions = Array.isArray(entry.transactions)
        ? entry.transactions
            .map((tx) => {
              if (typeof tx !== 'object' || tx === null) {
                return null;
              }

              const valueTx = tx as Record<string, unknown>;
              const date = sanitizeString(valueTx.date);
              const type = sanitizeTransactionType(valueTx.type);
              const quantity = sanitizeNumber(valueTx.quantity);
              const price = sanitizeNumber(valueTx.price);

              if (!date || !type || quantity == null || price == null) {
                return null;
              }

              return {
                date,
                type,
                quantity,
                price,
              };
            })
            .filter(
              (
                entryTx,
              ): entryTx is NonNullable<PortfolioAnalysisRequest['recentTransactions']>[number]['transactions'][number] =>
                entryTx !== null,
            )
        : [];

      if (!assetId || !assetName || !ticker || transactions.length === 0) {
        return null;
      }

      return {
        assetId,
        assetName,
        ticker,
        transactions,
      };
    })
    .filter(
      (item): item is NonNullable<PortfolioAnalysisRequest['recentTransactions']>[number] =>
        item !== null,
    );

  return groups.length > 0 ? groups : undefined;
}

function normalizePriceHistory(value: unknown): PortfolioAnalysisRequest['priceHistory'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const groups = value
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const entry = item as Record<string, unknown>;
      const assetId = sanitizeString(entry.assetId);
      const assetName = sanitizeString(entry.assetName);
      const ticker = sanitizeString(entry.ticker);
      const currency = sanitizeString(entry.currency);
      const currentPrice = sanitizeNumber(entry.currentPrice);
      const change30dPct = sanitizeNumber(entry.change30dPct);
      const points = Array.isArray(entry.points)
        ? entry.points
            .map((point) => {
              if (typeof point !== 'object' || point === null) {
                return null;
              }

              const valuePoint = point as Record<string, unknown>;
              const date = sanitizeString(valuePoint.date);
              const price = sanitizeNumber(valuePoint.price);

              if (!date || price == null) {
                return null;
              }

              return {
                date,
                price,
              };
            })
            .filter(
              (
                point,
              ): point is NonNullable<PortfolioAnalysisRequest['priceHistory']>[number]['points'][number] =>
                point !== null,
            )
        : [];

      if (
        !assetId ||
        !assetName ||
        !ticker ||
        !currency ||
        currentPrice == null ||
        change30dPct == null ||
        points.length === 0
      ) {
        return null;
      }

      return {
        assetId,
        assetName,
        ticker,
        currency,
        currentPrice,
        change30dPct,
        points,
      };
    })
    .filter(
      (item): item is NonNullable<PortfolioAnalysisRequest['priceHistory']>[number] =>
        item !== null,
    );

  return groups.length > 0 ? groups : undefined;
}

function normalizeRecentSnapshots(value: unknown): PortfolioAnalysisRequest['recentSnapshots'] {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const snapshots = value
    .map((item) => {
      if (typeof item !== 'object' || item === null) {
        return null;
      }

      const entry = item as Record<string, unknown>;
      const date = sanitizeString(entry.date);
      const capturedAt = sanitizeString(entry.capturedAt) ?? undefined;
      const totalValueHKD = sanitizeNumber(entry.totalValueHKD);
      const netExternalFlowHKD = sanitizeNumber(entry.netExternalFlowHKD);
      const assetCount = sanitizeNumber(entry.assetCount);
      const holdings = Array.isArray(entry.holdings)
        ? entry.holdings
            .map((holding) => {
              if (typeof holding !== 'object' || holding === null) {
                return null;
              }

              const valueHolding = holding as Record<string, unknown>;
              const assetId = sanitizeString(valueHolding.assetId);
              const ticker = sanitizeString(valueHolding.ticker);
              const assetName = sanitizeString(valueHolding.assetName);
              const currentPrice = sanitizeNumber(valueHolding.currentPrice);
              const marketValueHKD = sanitizeNumber(valueHolding.marketValueHKD);
              const quantity = sanitizeNumber(valueHolding.quantity);

              if (
                !assetId ||
                !ticker ||
                !assetName ||
                currentPrice == null ||
                marketValueHKD == null ||
                quantity == null
              ) {
                return null;
              }

              return {
                assetId,
                ticker,
                assetName,
                currentPrice,
                marketValueHKD,
                quantity,
              };
            })
            .filter(
              (holding): holding is NonNullable<
                NonNullable<PortfolioAnalysisRequest['recentSnapshots']>[number]['holdings']
              >[number] => holding !== null,
            )
        : [];

      if (!date || totalValueHKD == null || netExternalFlowHKD == null || assetCount == null) {
        return null;
      }

      return {
        date,
        capturedAt,
        totalValueHKD,
        netExternalFlowHKD,
        assetCount,
        holdings,
      };
    })
    .filter((item) => item !== null) as PortfolioAnalysisRequest['recentSnapshots'];

  return snapshots.length > 0 ? snapshots : undefined;
}

export function normalizeAnalysisRequest(payload: unknown): PortfolioAnalysisRequest {
  if (typeof payload !== 'object' || payload === null) {
    throw new AnalyzePortfolioError('投資組合分析請求格式不正確。', 400);
  }

  const value = payload as Record<string, unknown>;
  const cacheKey = sanitizeString(value.cacheKey);
  const snapshotHash = sanitizeString(value.snapshotHash);
  const category = sanitizeAnalysisCategory(value.category);
  const analysisModel = sanitizeAnalysisModel(value.analysisModel);
  const analysisQuestion = sanitizeString(value.analysisQuestion) ?? '';
  const analysisBackground = sanitizeString(value.analysisBackground) ?? '';
  const conversationContext = sanitizeString(value.conversationContext) ?? '';
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

  const recentTransactions = normalizeRecentTransactions(value.recentTransactions);
  const priceHistory = normalizePriceHistory(value.priceHistory);
  const recentSnapshots = normalizeRecentSnapshots(value.recentSnapshots);

  return {
    cacheKey,
    snapshotHash,
    category,
    analysisModel,
    analysisQuestion,
    analysisBackground,
    conversationContext,
    assetCount: assetCount ?? holdings.length,
    totalValueHKD: totalValueHKD ?? 0,
    totalCostHKD: totalCostHKD ?? 0,
    holdings,
    allocationsByType,
    allocationsByCurrency,
    recentTransactions,
    priceHistory,
    recentSnapshots,
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
- 用標題分段，每段不超過 150 字，方便日後翻查。
    `.trim();
  }

  return `
Category: 分析資產
- 聚焦診斷目前投資組合。
- 先指出最值得留意的持倉、集中度、風險與配置問題。
- 若使用者要求建議，提供具體而克制的下一步方向。
  `.trim();
}

function getAnalysisRules() {
  return `
- Write all output in Traditional Chinese.
- Base your reasoning only on the provided holdings, latest prices, asset categories, currencies, and average costs.
- Do not invent historical returns, dividends, macro news, or external facts that are not present in the input.
- If the data lacks price history or cash-flow history, mention that limitation briefly where relevant.
- Keep the tone practical, calm, and beginner-friendly.
- Prioritize the user's analysis instruction when deciding what to emphasize, but do not invent any external facts or unsupported claims.
- Answer the user's instruction directly. Do not force your response into sections unless the user's question naturally calls for it.
- If the user's instruction asks for a comparison, recommendation, or explanation, answer that request directly in flowing prose or a natural list.
  `.trim();
}

function buildAnalysisSystemPrompt(request: PortfolioAnalysisRequest) {
  return `
You are a portfolio analysis assistant.
Analyze ONLY the portfolio snapshot provided below.
Return ONLY the final answer text in Traditional Chinese. Do not use markdown code fences.

Rules:
${getAnalysisRules()}

${getCategoryPromptPrefix(request.category)}
  `.trim();
}

function formatMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatHoldingsSection(request: PortfolioAnalysisRequest) {
  const lines = request.holdings
    .slice()
    .sort((left, right) => right.marketValue - left.marketValue)
    .map(
      (holding, index) =>
        `${index + 1}. ${holding.ticker}｜${holding.name}｜${holding.assetType}｜` +
        `qty ${formatMoney(holding.quantity)}｜價 ${formatMoney(holding.currentPrice)} ${holding.currency}｜` +
        `市值 ${formatMoney(holding.marketValue)}｜成本 ${formatMoney(holding.costValue)}`,
    );

  return ['【持倉概覽】', ...lines].join('\n');
}

function formatRecentTransactionsSection(request: PortfolioAnalysisRequest) {
  if (!request.recentTransactions || request.recentTransactions.length === 0) {
    return '【最近交易（過去 30 日）】\n未有可用交易記錄。';
  }

  const lines = request.recentTransactions
    .slice()
    .sort((left, right) => left.ticker.localeCompare(right.ticker))
    .map(
      (group) =>
        `- ${group.ticker} ${group.assetName}：` +
        group.transactions
          .map((tx) => `${tx.date} ${tx.type} ${formatMoney(tx.quantity)} @ ${formatMoney(tx.price)}`)
          .join('； '),
    );

  return ['【最近交易（過去 30 日）】', ...lines].join('\n');
}

function formatPriceHistorySection(request: PortfolioAnalysisRequest) {
  if (!request.priceHistory || request.priceHistory.length === 0) {
    return '【價格走勢摘要】\n未有可用價格歷史。';
  }

  const lines = request.priceHistory
    .slice()
    .sort((left, right) => right.change30dPct - left.change30dPct)
    .map((group) => {
      const pricePoints = group.points
        .map((point) => `${point.date} ${formatMoney(point.price)}`)
        .join('； ');

      return `- ${group.ticker} ${group.assetName}：30日 ${group.change30dPct.toFixed(1)}%（${pricePoints}）`;
    });

  return ['【價格走勢摘要（只列 top 10 市值持倉）】', ...lines].join('\n');
}

function formatRecentSnapshotsSection(request: PortfolioAnalysisRequest) {
  if (!request.recentSnapshots || request.recentSnapshots.length === 0) {
    return '【最近 2 個 snapshot】\n未有可用 snapshot。';
  }

  const lines = request.recentSnapshots
    .slice()
    .sort((left, right) => left.date.localeCompare(right.date))
    .map((snapshot) => {
      const holdings = snapshot.holdings
        .map((holding) => `${holding.ticker} ${formatMoney(holding.marketValueHKD)}`)
        .join('； ');

      return `- ${snapshot.date}｜總值 ${formatMoney(snapshot.totalValueHKD)} HKD｜淨流入 ${formatMoney(snapshot.netExternalFlowHKD)} HKD｜持倉 ${holdings}`;
    });

  return ['【最近 2 個 snapshot】', ...lines].join('\n');
}

function buildGeneralQuestionContext(request: PortfolioAnalysisRequest) {
  return [
    formatHoldingsSection(request),
    formatRecentTransactionsSection(request),
    formatPriceHistorySection(request),
    formatRecentSnapshotsSection(request),
  ].join('\n\n');
}

function buildAnalysisUserPrompt(request: PortfolioAnalysisRequest) {
  const generalQuestionContext =
    request.category === 'general_question' ? buildGeneralQuestionContext(request) : '';

  return `
Saved category background:
${request.analysisBackground || '未設定額外背景。'}

Conversation context:
${request.conversationContext || '目前未有前文對話。'}

User question / task:
${request.analysisQuestion || '請根據目前投資組合做一般分析。'}

Portfolio snapshot summary:
${request.holdings
  .slice()
  .sort((left, right) => right.marketValue - left.marketValue)
  .map(
    (holding) =>
      `- ${holding.ticker}｜${holding.name}｜${holding.assetType}｜qty ${formatMoney(holding.quantity)}｜` +
      `價 ${formatMoney(holding.currentPrice)} ${holding.currency}｜市值 ${formatMoney(holding.marketValue)}｜成本 ${formatMoney(holding.costValue)}`,
  )
  .join('\n')}

${generalQuestionContext ? `${generalQuestionContext}\n` : ''}
  `.trim();
}

export function buildPrompt(request: PortfolioAnalysisRequest) {
  return `${buildAnalysisSystemPrompt(request)}\n\n${buildAnalysisUserPrompt(request)}`;
}

function getModelProvider(model: PortfolioAnalysisModel): PortfolioAnalysisProvider {
  return SUPPORTED_ANALYSIS_MODELS[model].provider;
}

async function analyzeWithGemini(
  prompt: string,
  model: Extract<PortfolioAnalysisModel, 'gemini-3.1-pro-preview'>,
  maxTokens?: number,
) {
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      temperature: 0.3,
      ...(typeof maxTokens === 'number' ? { maxOutputTokens: maxTokens } : {}),
    },
  });

  return response.text ?? '';
}

async function analyzeWithClaude(
  systemPrompt: string,
  userPrompt: string,
  model: Extract<PortfolioAnalysisModel, 'claude-opus-4-7'>,
  maxTokens = 1800,
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
      max_tokens: maxTokens,
      temperature: 0.3,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
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

function getDefaultAnalysisMaxTokens(category: AnalysisCategory) {
  if (category === 'asset_report') {
    return 5000;
  }

  if (category === 'asset_analysis') {
    return 3500;
  }

  return 1800;
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

export async function runPortfolioAnalysisRequest(
  request: PortfolioAnalysisRequest,
  options?: { delivery?: 'manual' | 'scheduled'; maxTokens?: number },
): Promise<PortfolioAnalysisResponse> {
  const systemPrompt = buildAnalysisSystemPrompt(request);
  const userPrompt = buildAnalysisUserPrompt(request);
  const provider = getModelProvider(request.analysisModel);
  const resolvedMaxTokens = options?.maxTokens ?? getDefaultAnalysisMaxTokens(request.category);
  const resolvedModel =
    request.analysisModel === 'claude-opus-4-7'
      ? getClaudeAnalyzeModel()
      : getGeminiAnalyzeModel(request.analysisModel);
  const raw =
    provider === 'anthropic'
      ? await analyzeWithClaude(
          systemPrompt,
          userPrompt,
          resolvedModel as 'claude-opus-4-7',
          resolvedMaxTokens,
        )
      : await analyzeWithGemini(
          `${systemPrompt}\n\n${userPrompt}`,
          resolvedModel as 'gemini-3.1-pro-preview',
          resolvedMaxTokens,
        );
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
    analysisQuestion: request.analysisQuestion ?? '',
    analysisBackground: request.analysisBackground ?? '',
    delivery: options?.delivery ?? 'manual',
    generatedAt: new Date().toISOString(),
    ...result,
  };
}

export async function analyzePortfolio(
  payload: unknown,
): Promise<PortfolioAnalysisResponse> {
  const request = normalizeAnalysisRequest(payload);
  return runPortfolioAnalysisRequest(request, { delivery: 'manual' });
}
