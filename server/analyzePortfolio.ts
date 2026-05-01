import { GoogleGenAI } from '@google/genai';

import type { AnalysisCategory, AssetType } from '../src/types/portfolio';
import type {
  ExternalSource,
  GeneralQuestionDataFreshness,
  MacroContext,
  PortfolioAnalysisModel,
  PortfolioAnalysisProvider,
  PortfolioAnalysisRequest,
  PortfolioAnalysisResponse,
  PortfolioAnalysisResult,
} from '../src/types/portfolioAnalysis';
import {
  CLAUDE_ANALYZE_MODEL,
  GEMINI_ANALYZE_MODEL,
  MODEL_REGISTRY,
  getSearchModelCandidates,
  isValidAnalysisModel,
  resolveModelProvider,
} from './analysisModels';
import { type AnalysisIntent, classifyIntent, intentNeedsExternalSearch } from './analysisIntent';

const ANALYZE_ROUTE = '/api/analyze' as const;

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
    : GEMINI_ANALYZE_MODEL;
}

function getClaudeAnalyzeModel() {
  const model = process.env.CLAUDE_ANALYZE_MODEL?.trim() || CLAUDE_ANALYZE_MODEL;
  return model === 'claude-opus-4-7' ? model : CLAUDE_ANALYZE_MODEL;
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
  if (isValidAnalysisModel(value)) {
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

function sanitizeEnrichmentStatus(value: unknown): 'ok' | 'partial' | 'failed' | null {
  if (value === 'ok' || value === 'partial' || value === 'failed') {
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
  const enrichmentStatus = sanitizeEnrichmentStatus(value.enrichmentStatus) ?? 'ok';
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
    enrichmentStatus,
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

// ---------------------------------------------------------------------------
// Structured answer parsing for general_question
// ---------------------------------------------------------------------------

interface StructuredGeneralAnswer {
  answer: string;
  usedPortfolioFacts: string[];
  uncertainty: string[];
  suggestedActions: string[];
}

function parseStructuredGeneralAnswer(raw: string): StructuredGeneralAnswer {
  // Try JSON extraction (may be wrapped in markdown code fences)
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const candidate = jsonMatch ? jsonMatch[1] : raw;

  try {
    const parsed = JSON.parse(candidate.trim()) as Record<string, unknown>;
    const answer = sanitizeString(parsed.answer);
    if (!answer) throw new Error('missing answer');
    return {
      answer,
      usedPortfolioFacts: Array.isArray(parsed.usedPortfolioFacts)
        ? (parsed.usedPortfolioFacts as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .slice(0, 10)
        : [],
      uncertainty: Array.isArray(parsed.uncertainty)
        ? (parsed.uncertainty as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .slice(0, 5)
        : [],
      suggestedActions: Array.isArray(parsed.suggestedActions)
        ? (parsed.suggestedActions as unknown[])
            .filter((v): v is string => typeof v === 'string')
            .slice(0, 5)
        : [],
    };
  } catch {
    // Fallback: treat entire response as plain-text answer
    const answer = raw.trim();
    if (!answer) throw new AnalyzePortfolioError('模型未有回傳分析內容。', 502);
    return { answer, usedPortfolioFacts: [], uncertainty: [], suggestedActions: [] };
  }
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

  return { answer };
}

// ---------------------------------------------------------------------------
// Category prompt prefixes
// ---------------------------------------------------------------------------

function getCategoryPromptPrefix(category: AnalysisCategory) {
  if (category === 'general_question') {
    return `
Category: 一般問題
你是投資組合對話助手。你的任務是根據使用者目前持倉、資產分類、幣別、成本、市值、30日價格走勢、最近交易、最近 snapshots，以及系統提供的外部／宏觀資料，直接回答使用者當次問題。

回答規則：
1. 先用一句話給結論。
2. 再清楚分開「組合內可核對數據」與「外部／宏觀資料」。
3. 如果問題涉及持倉，必須引用具體持倉、幣別、成本、市值、集中度或 30日走勢。
4. 如果問題涉及宏觀、新聞、利率、政策、財報或市場估值，只可使用系統提供的外部資料；不足就直說。
5. 如果外部搜尋失敗或未進行，要明確說明本次回答只基於目前組合資料。
6. 如果問題屬於判斷或比較題，請先給結論，再給理由，最後補實際建議。
7. 不要保證回報，不要給絕對買賣指令。
8. 除非使用者要求長文，否則保持精煉、清楚、可操作。
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
- If structured comparison, trend, or market summary data is included in the user prompt, treat it as provided evidence and 引用其中數字。
- If a latest external search summary is included, treat it as current evidence for recent news, company updates, macro context, or other time-sensitive facts.
- If external search is unavailable or not performed, say so briefly and fall back to the portfolio data already provided.
- Keep the tone practical, calm, and beginner-friendly.
- Prioritize the user's analysis instruction when deciding what to emphasize, but do not invent any external facts or unsupported claims.
- Answer the user's instruction directly. Do not force your response into sections unless the user's question naturally calls for it.
  `.trim();
}

// ---------------------------------------------------------------------------
// Token-budget-aware holdings formatter
// ---------------------------------------------------------------------------

function formatMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatHoldingsSection(request: PortfolioAnalysisRequest) {
  const sorted = [...request.holdings].sort((a, b) => b.marketValue - a.marketValue);
  const top10 = sorted.slice(0, 10);
  const rest = sorted.slice(10);

  const topLines = top10.map(
    (holding, index) =>
      `${index + 1}. ${holding.ticker}｜${holding.name}｜${holding.assetType}｜` +
      `qty ${formatMoney(holding.quantity)}｜價 ${formatMoney(holding.currentPrice)} ${holding.currency}｜` +
      `市值 ${formatMoney(holding.marketValue)}｜成本 ${formatMoney(holding.costValue)}`,
  );

  const restLines =
    rest.length > 0
      ? [
          `其他 ${rest.length} 項（總市值 ${formatMoney(rest.reduce((s, h) => s + h.marketValue, 0))}）：` +
            rest.map((h) => `${h.ticker}(${h.assetType})`).join('、'),
        ]
      : [];

  return ['【持倉概覽】', ...topLines, ...restLines].join('\n');
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

function buildRichContextSection(request: PortfolioAnalysisRequest) {
  return [
    formatHoldingsSection(request),
    formatRecentTransactionsSection(request),
    formatPriceHistorySection(request),
    formatRecentSnapshotsSection(request),
  ].join('\n\n');
}

// Truncate conversation context to last ~1500 chars to control token budget
function truncateConversationContext(context: string, maxChars = 1500): string {
  if (!context || context.length <= maxChars) return context;
  const truncated = context.slice(-maxChars);
  // Try to start at a clean turn boundary
  const turnBoundary = truncated.indexOf('第 ');
  return turnBoundary > 0 ? `[早期對話已壓縮]\n${truncated.slice(turnBoundary)}` : `[早期對話已壓縮]\n${truncated}`;
}

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildAnalysisSystemPrompt(
  request: PortfolioAnalysisRequest,
  options?: { isGeneralQuestion?: boolean; intent?: AnalysisIntent },
) {
  const isGeneralQuestion = options?.isGeneralQuestion ?? request.category === 'general_question';
  const jsonInstruction = isGeneralQuestion
    ? `
Output format: You MUST respond with a valid JSON object (no markdown fences) with exactly these fields:
{
  "answer": "main answer in Traditional Chinese",
  "usedPortfolioFacts": ["fact from portfolio data used in answer", ...],
  "uncertainty": ["uncertainty or data gap", ...],
  "suggestedActions": ["concrete follow-up action", ...]
}
Keep usedPortfolioFacts, uncertainty, suggestedActions as short, 1-line strings. Max 8 items each.
    `.trim()
    : 'Return ONLY the final answer text in Traditional Chinese. Do not use markdown code fences.';

  return `
You are a portfolio analysis assistant.
Analyze ONLY the portfolio snapshot provided below.
${jsonInstruction}

Rules:
${getAnalysisRules()}

${getCategoryPromptPrefix(request.category)}
  `.trim();
}

function buildAnalysisUserPrompt(
  request: PortfolioAnalysisRequest,
  externalSearchSummary = '',
) {
  const richContextSection = request.holdings.length > 0 ? buildRichContextSection(request) : '';
  const externalSearchSection =
    request.category === 'general_question' && externalSearchSummary.trim()
      ? `
Latest external information summary (retrieved from Google Search):
${externalSearchSummary.trim()}
      `.trim()
      : '';
  const conversationContext = truncateConversationContext(request.conversationContext || '');

  return `
Saved category background:
${request.analysisBackground || '未設定額外背景。'}

Conversation context:
${conversationContext || '目前未有前文對話。'}

${externalSearchSection ? `${externalSearchSection}\n\n` : ''}
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

${richContextSection ? `${richContextSection}\n` : ''}
  `.trim();
}

export function buildPrompt(
  request: PortfolioAnalysisRequest,
  externalSearchSummary = '',
) {
  return `${buildAnalysisSystemPrompt(request)}\n\n${buildAnalysisUserPrompt(request, externalSearchSummary)}`;
}

// ---------------------------------------------------------------------------
// External search (grounded Gemini)
// ---------------------------------------------------------------------------

interface ExternalSearchResult {
  summary: string;
  sources: ExternalSource[];
  status: 'ok' | 'partial' | 'failed';
  retrievedAt: string;
}

function extractGroundingSources(
  response: unknown,
  query: string,
  relatedTickers: string[],
  retrievedAt: string,
): ExternalSource[] {
  try {
    const candidates = (response as Record<string, unknown>)?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const meta = (candidates[0] as Record<string, unknown>)?.groundingMetadata as Record<string, unknown> | undefined;
    if (!meta) return [];

    const chunks = meta.groundingChunks;
    if (!Array.isArray(chunks)) return [];

    return (chunks as unknown[])
      .slice(0, 10)
      .map((chunk) => {
        const web = (chunk as Record<string, unknown>)?.web as Record<string, unknown> | undefined;
        if (!web) return null;
        const url = typeof web.uri === 'string' ? web.uri : '';
        const title = typeof web.title === 'string' ? web.title : url;
        if (!url) return null;
        return {
          title,
          url,
          retrievedAt,
          snippet: '',
          query,
          relatedTickers,
        } satisfies ExternalSource;
      })
      .filter((s): s is ExternalSource => s !== null);
  } catch {
    return [];
  }
}

function buildGeneralQuestionSearchPrompt(request: PortfolioAnalysisRequest) {
  const searchTargets = [...request.holdings]
    .filter((holding) => holding.assetType !== 'cash')
    .sort((left, right) => right.marketValue - left.marketValue)
    .slice(0, 10);
  const tickers =
    searchTargets.map((holding) => `${holding.ticker} (${holding.name})`).join('、') || '目前無主要持倉';
  const question = request.analysisQuestion.trim() || '目前投資組合有咩最新外部資訊值得留意？';
  const conversationContext = truncateConversationContext(request.conversationContext || '', 500);

  return [
    '請使用 Google Search 幫我整理與投資組合相關的最新外部資訊，只輸出可直接提供給另一個 AI 的摘要文字，不要作投資分析或建議。',
    '重點整理：',
    '1. 與以下問題最相關的最新新聞、公告、政策、財報或市場背景',
    '2. 若涉及持倉，整理與主要持倉最相關的近期外部資訊',
    '3. 若有時間敏感資料，請盡量標明日期或時間範圍',
    `使用者問題：${question}`,
    `對話上下文：${conversationContext || '目前未有前文對話。'}`,
    `主要持倉：${tickers}`,
    '請用繁體中文，寫成簡潔、可引用的外部資料摘要。',
  ].join('\n');
}

async function generateGeneralQuestionSearchSummary(
  request: PortfolioAnalysisRequest,
): Promise<ExternalSearchResult> {
  const retrievedAt = new Date().toISOString();
  const searchTargets = [...request.holdings]
    .filter((h) => h.assetType !== 'cash')
    .sort((a, b) => b.marketValue - a.marketValue)
    .slice(0, 10);
  const relatedTickers = searchTargets.map((h) => h.ticker);
  const query = request.analysisQuestion.trim() || '投資組合外部資訊';

  try {
    const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
    const prompt = buildGeneralQuestionSearchPrompt(request);
    const candidates = getSearchModelCandidates();
    let lastError: unknown = null;

    for (const model of candidates) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
          config: {
            maxOutputTokens: 1500,
            tools: [{ googleSearch: {} }],
          },
        });

        const summary = response.text?.trim();
        if (summary) {
          const sources = extractGroundingSources(response, query, relatedTickers, retrievedAt);
          return { summary, sources, status: 'ok', retrievedAt };
        }

        console.warn(
          `[analyzePortfolio] Gemini grounding returned empty summary for model ${model}; trying fallback.`,
        );
      } catch (error) {
        console.warn(
          `[analyzePortfolio] Gemini grounding fallback from model ${model}: ${
            error instanceof Error ? error.message : 'unknown_error'
          }`,
        );
        lastError = error;
      }
    }

    const fallbackMessage = lastError instanceof Error ? lastError.message : 'grounding_failed';
    return {
      summary: `未能取得最新外部資料摘要；請以組合資料為主回答，並註明外部搜尋暫時失敗（${fallbackMessage}）。`,
      sources: [],
      status: 'failed',
      retrievedAt,
    };
  } catch (error) {
    const fallbackMessage = error instanceof Error ? error.message : 'grounding_unavailable';
    console.warn('[analyzePortfolio] external search unavailable:', fallbackMessage);
    return {
      summary: `未能取得最新外部資料摘要；請以組合資料為主回答，並註明外部搜尋暫時失敗（${fallbackMessage}）。`,
      sources: [],
      status: 'failed',
      retrievedAt,
    };
  }
}

// ---------------------------------------------------------------------------
// MacroContext builder
// ---------------------------------------------------------------------------

function buildMacroContext(searchResult: ExternalSearchResult): MacroContext {
  return {
    retrievedAt: searchResult.retrievedAt,
    summary: searchResult.summary,
    sources: searchResult.sources,
  };
}

// ---------------------------------------------------------------------------
// Model callers
// ---------------------------------------------------------------------------

function getModelProvider(model: PortfolioAnalysisModel): PortfolioAnalysisProvider {
  return resolveModelProvider(model);
}

async function analyzeWithGemini(
  prompt: string,
  model: Extract<PortfolioAnalysisModel, 'gemini-3.1-pro-preview'>,
  maxTokens?: number,
  jsonMode = false,
) {
  const apiKey = getGeminiApiKey();
  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model,
    contents: prompt,
    config: {
      ...(typeof maxTokens === 'number' ? { maxOutputTokens: maxTokens } : {}),
      ...(jsonMode ? { responseMimeType: 'application/json' } : {}),
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

// ---------------------------------------------------------------------------
// Main analysis runner
// ---------------------------------------------------------------------------

export async function runPortfolioAnalysisRequest(
  request: PortfolioAnalysisRequest,
  options?: { delivery?: 'manual' | 'scheduled'; maxTokens?: number },
): Promise<PortfolioAnalysisResponse> {
  const isGeneralQuestion = request.category === 'general_question';

  // Intent classification (general_question only)
  const intent: AnalysisIntent | undefined = isGeneralQuestion
    ? classifyIntent(request.analysisQuestion || '')
    : undefined;

  // Conditional external search
  let searchResult: ExternalSearchResult | null = null;
  let macroCtx: MacroContext | undefined;
  if (isGeneralQuestion && intent && intentNeedsExternalSearch(intent)) {
    searchResult = await generateGeneralQuestionSearchSummary(request);
    macroCtx = buildMacroContext(searchResult);
  }

  const externalSearchSummary = searchResult?.summary ?? '';
  const systemPrompt = buildAnalysisSystemPrompt(request, { isGeneralQuestion, intent });
  const userPrompt = buildAnalysisUserPrompt(request, externalSearchSummary);
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
          isGeneralQuestion,
        );

  // Parse structured response for general_question; plain text for others
  let result: PortfolioAnalysisResult;
  if (isGeneralQuestion) {
    const parsed = parseStructuredGeneralAnswer(raw);
    result = {
      answer: parsed.answer,
      usedPortfolioFacts: parsed.usedPortfolioFacts,
      uncertainty: parsed.uncertainty,
      suggestedActions: parsed.suggestedActions,
      usedExternalSources:
        searchResult?.sources.slice(0, 5).map((s) => `${s.title} — ${s.url}`) ?? [],
    };
  } else {
    result = sanitizeAnalysisResult(raw);
  }

  // Data freshness metadata
  const dataFreshness: GeneralQuestionDataFreshness | undefined = isGeneralQuestion
    ? {
        hasExternalSearch: Boolean(searchResult),
        externalSearchAt: searchResult?.retrievedAt,
        externalSearchStatus: searchResult
          ? searchResult.status
          : 'not_needed',
      }
    : undefined;

  const modelRegistry = MODEL_REGISTRY;
  void modelRegistry; // used for type checking via isValidAnalysisModel at request normalization

  return {
    ok: true,
    route: ANALYZE_ROUTE,
    mode: 'live',
    cacheKey: request.cacheKey,
    category: request.category,
    provider,
    model: resolvedModel,
    snapshotHash: request.snapshotHash,
    enrichmentStatus: request.enrichmentStatus ?? 'ok',
    analysisQuestion: request.analysisQuestion ?? '',
    analysisBackground: request.analysisBackground ?? '',
    delivery: options?.delivery ?? 'manual',
    generatedAt: new Date().toISOString(),
    intent,
    dataFreshness,
    macroContext: macroCtx,
    ...result,
  };
}

export async function analyzePortfolio(
  payload: unknown,
): Promise<PortfolioAnalysisResponse> {
  const request = normalizeAnalysisRequest(payload);
  return runPortfolioAnalysisRequest(request, { delivery: 'manual' });
}
