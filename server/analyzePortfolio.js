import { GoogleGenAI } from '@google/genai';
import { CLAUDE_ANALYZE_MODEL, GEMINI_ANALYZE_MODEL, MODEL_REGISTRY, getSearchModelCandidates, isValidAnalysisModel, resolveModelProvider, } from './analysisModels.js';
import { classifyIntent, intentNeedsExternalSearch } from './analysisIntent.js';
import { convertToHKDValue, formatCurrencyRounded } from '../src/lib/currency.js';
const ANALYZE_ROUTE = '/api/analyze';
const EXTERNAL_EVIDENCE_CACHE = new Map();
class AnalyzePortfolioError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.name = 'AnalyzePortfolioError';
        this.status = status;
    }
}
function getGeminiAnalyzeModel(requestedModel) {
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
        throw new AnalyzePortfolioError('未設定 GEMINI_API_KEY 或 GOOGLE_API_KEY，暫時無法分析投資組合。', 500);
    }
    return apiKey;
}
function getAnthropicApiKey() {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
        throw new AnalyzePortfolioError('未設定 ANTHROPIC_API_KEY，暫時無法使用 Claude 分析投資組合。', 500);
    }
    return apiKey;
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
        const parsed = Number(value.replace(/,/g, '').trim());
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function sanitizeAnalysisModel(value) {
    if (isValidAnalysisModel(value)) {
        return value;
    }
    return null;
}
function sanitizeAnalysisCategory(value) {
    if (value === 'asset_analysis' || value === 'general_question' || value === 'asset_report') {
        return value;
    }
    return null;
}
function sanitizeEnrichmentStatus(value) {
    if (value === 'ok' || value === 'partial' || value === 'failed') {
        return value;
    }
    return null;
}
function sanitizeAssetType(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const normalized = value.trim().toLowerCase();
    if (normalized === 'stock')
        return 'stock';
    if (normalized === 'etf')
        return 'etf';
    if (normalized === 'bond')
        return 'bond';
    if (normalized === 'crypto')
        return 'crypto';
    if (normalized === 'cash')
        return 'cash';
    return null;
}
function sanitizeTransactionType(value) {
    if (value === 'buy' || value === 'sell') {
        return value;
    }
    return null;
}
function normalizeRecentTransactions(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const groups = value
        .map((item) => {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const entry = item;
        const assetId = sanitizeString(entry.assetId);
        const assetName = sanitizeString(entry.assetName);
        const ticker = sanitizeString(entry.ticker);
        const transactions = Array.isArray(entry.transactions)
            ? entry.transactions
                .map((tx) => {
                if (typeof tx !== 'object' || tx === null) {
                    return null;
                }
                const valueTx = tx;
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
                .filter((entryTx) => entryTx !== null)
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
        .filter((item) => item !== null);
    return groups.length > 0 ? groups : undefined;
}
function normalizePriceHistory(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const groups = value
        .map((item) => {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const entry = item;
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
                const valuePoint = point;
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
                .filter((point) => point !== null)
            : [];
        if (!assetId ||
            !assetName ||
            !ticker ||
            !currency ||
            currentPrice == null ||
            change30dPct == null ||
            points.length === 0) {
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
        .filter((item) => item !== null);
    return groups.length > 0 ? groups : undefined;
}
function normalizeRecentSnapshots(value) {
    if (!Array.isArray(value)) {
        return undefined;
    }
    const snapshots = value
        .map((item) => {
        if (typeof item !== 'object' || item === null) {
            return null;
        }
        const entry = item;
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
                const valueHolding = holding;
                const assetId = sanitizeString(valueHolding.assetId);
                const ticker = sanitizeString(valueHolding.ticker);
                const assetName = sanitizeString(valueHolding.assetName);
                const currentPrice = sanitizeNumber(valueHolding.currentPrice);
                const marketValueHKD = sanitizeNumber(valueHolding.marketValueHKD);
                const quantity = sanitizeNumber(valueHolding.quantity);
                if (!assetId ||
                    !ticker ||
                    !assetName ||
                    currentPrice == null ||
                    marketValueHKD == null ||
                    quantity == null) {
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
                .filter((holding) => holding !== null)
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
        .filter((item) => item !== null);
    return snapshots.length > 0 ? snapshots : undefined;
}
export function normalizeAnalysisRequest(payload) {
    if (typeof payload !== 'object' || payload === null) {
        throw new AnalyzePortfolioError('投資組合分析請求格式不正確。', 400);
    }
    const value = payload;
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
        const asset = item;
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
        const marketValueHKD = sanitizeNumber(asset.marketValueHKD);
        const costValue = sanitizeNumber(asset.costValue);
        const costValueHKD = sanitizeNumber(asset.costValueHKD);
        if (!id ||
            !name ||
            !ticker ||
            !assetType ||
            !accountSource ||
            !currency ||
            quantity == null ||
            averageCost == null ||
            currentPrice == null ||
            marketValue == null ||
            costValue == null) {
            return null;
        }
        const resolvedMarketValueHKD = marketValueHKD ?? convertToHKDValue(marketValue, currency);
        const resolvedCostValueHKD = costValueHKD ?? convertToHKDValue(costValue, currency);
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
            marketValueHKD: resolvedMarketValueHKD,
            costValue,
            costValueHKD: resolvedCostValueHKD,
        };
    })
        .filter((item) => item !== null);
    if (holdings.length === 0) {
        throw new AnalyzePortfolioError('目前沒有完整的資產資料可分析。', 400);
    }
    const allocationsByType = Array.isArray(value.allocationsByType)
        ? value.allocationsByType
            .map((item) => {
            if (typeof item !== 'object' || item === null) {
                return null;
            }
            const allocation = item;
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
            .filter((item) => item !== null)
        : [];
    const allocationsByCurrency = Array.isArray(value.allocationsByCurrency)
        ? value.allocationsByCurrency
            .map((item) => {
            if (typeof item !== 'object' || item === null) {
                return null;
            }
            const allocation = item;
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
            .filter((item) => item !== null)
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
function parseStructuredGeneralAnswer(raw) {
    // Try JSON extraction (may be wrapped in markdown code fences)
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    const candidate = jsonMatch ? jsonMatch[1] : raw;
    try {
        const parsed = JSON.parse(candidate.trim());
        const answer = sanitizeString(parsed.answer);
        if (!answer)
            throw new Error('missing answer');
        return {
            answer,
            usedPortfolioFacts: Array.isArray(parsed.usedPortfolioFacts)
                ? parsed.usedPortfolioFacts
                    .filter((v) => typeof v === 'string')
                    .slice(0, 10)
                : [],
            uncertainty: Array.isArray(parsed.uncertainty)
                ? parsed.uncertainty
                    .filter((v) => typeof v === 'string')
                    .slice(0, 5)
                : [],
            suggestedActions: Array.isArray(parsed.suggestedActions)
                ? parsed.suggestedActions
                    .filter((v) => typeof v === 'string')
                    .slice(0, 5)
                : [],
        };
    }
    catch {
        // Fallback: treat entire response as plain-text answer
        const answer = raw.trim();
        if (!answer)
            throw new AnalyzePortfolioError('模型未有回傳分析內容。', 502);
        return { answer, usedPortfolioFacts: [], uncertainty: [], suggestedActions: [] };
    }
}
function sanitizeAnalysisResult(rawPayload) {
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
    const value = rawPayload;
    const answer = sanitizeString(value.answer);
    if (!answer) {
        throw new AnalyzePortfolioError('模型未有回傳分析內容。', 502);
    }
    return { answer };
}
// ---------------------------------------------------------------------------
// Category prompt prefixes
// ---------------------------------------------------------------------------
function getCategoryPromptPrefix(category) {
    if (category === 'general_question') {
        return `
Category: 一般問題
你是專業投資研究與投資組合分析助手。你必須根據使用者目前持倉、資產分類、幣別、成本、市值、30日價格走勢、最近交易、snapshots，以及系統提供的外部 evidence pack，直接回答使用者當次投資問題。

回答規則：
1. 先給一句話結論。
2. 再根據問題類型選擇分析架構。
3. 如果問題涉及持倉，必須引用具體持倉、幣別、成本、市值、集中度或 30日走勢。
4. 如果問題涉及財報，必須拆解收入、利潤、現金流、資本開支、分部業務、一次性因素及市場含義。
5. 如果問題涉及宏觀，必須拆解利率、通脹、美元、債息、政策及對不同資產類別的影響。
6. 如果問題涉及策略，必須給出分段操作思路，而不是絕對買賣指令。
7. 不要保證回報，不要用空泛句子。
8. 不要只說「資料不足，建議查閱」；如果資料不足，要說明缺口，並基於現有資料作出有限度分析。
9. 所有答案必須使用繁體中文，語氣專業、直接、清晰。
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
- If structured external evidence or an earnings evidence pack is included, cite only those facts and figures; do not invent missing earnings numbers.
- If external search is unavailable or not performed, say so briefly and fall back to the portfolio data already provided.
- Keep the tone practical, calm, and beginner-friendly.
- Prioritize the user's analysis instruction when deciding what to emphasize, but do not invent any external facts or unsupported claims.
- Answer the user's instruction directly. Do not force your response into sections unless the user's question naturally calls for it.
  `.trim();
}
function getIntentPromptRules(intent) {
    if (intent === 'portfolio_only') {
        return `
Intent: portfolio_only
- 短答，不超過 400 字。
- 不使用外部資料；只根據持倉、成本、市值、比例、30日走勢、交易與 snapshots 回答。
    `.trim();
    }
    if (intent === 'earnings_analysis') {
        return `
Intent: earnings_analysis
- 目標 1200 至 2500 字，必須有表格，必須有投資含義。
- 回答必須使用以下結構：
1. 一句話結論：直接判斷財報屬於強、普通、偏弱，還是表面強但質素需打折。
2. 核心數字表：收入、收入增長、經營利潤、經營利潤率、淨利潤、EPS、營運現金流、自由現金流、資本開支、主要業務分部。
3. 收入質素：核心業務、一次性項目、最重要分部。
4. 利潤質素：經營利潤、淨利潤一次性因素、不要只看 EPS。
5. 現金流與資本開支：營運現金流、自由現金流、capex、AI／數據中心投資。
6. 業務分部分析：成熟現金牛與第二增長曲線。
7. 市場反應：股價升跌原因、市場焦點、估值是否已反映。
8. 對使用者持倉的含義：如持有相關股票，引用市值、佔比、30日升跌或成本，提供觀察、分段加倉、止盈、風險控制或觀望框架。
9. 需要監察的指標：列出 3 至 5 個具體指標。
10. 總結：長線投資價值、最大風險、判斷改變條件。
    `.trim();
    }
    if (intent === 'macro_analysis') {
        return `
Intent: macro_analysis
- 目標 800 至 1800 字。
- 拆解利率、通脹、美元、債息、政策，並結合使用者持倉配置分析股票、ETF、債券、現金、加密貨幣的不同影響。
    `.trim();
    }
    if (intent === 'strategy_analysis') {
        return `
Intent: strategy_analysis
- 目標 800 至 1800 字，必須有風險控制。
- 用分段操作思路、觀察條件與再平衡框架，不給絕對買賣指令。
    `.trim();
    }
    if (intent === 'company_research' || intent === 'market_research' || intent === 'deep_analysis') {
        return `
Intent: company_research
- 目標 800 至 1800 字。
- 分析商業模式、競爭力、估值含義、產品／行業地位、管理層訊號與對使用者持倉的影響。
    `.trim();
    }
    return '';
}
// ---------------------------------------------------------------------------
// Token-budget-aware holdings formatter
// ---------------------------------------------------------------------------
function formatMoney(value) {
    return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}
function formatHoldingValuePair(localValue, currency, hkdValue) {
    return `${formatCurrencyRounded(localValue, currency)} / 約 ${formatCurrencyRounded(hkdValue, 'HKD')}`;
}
function formatHoldingsSection(request) {
    const sorted = [...request.holdings].sort((a, b) => b.marketValueHKD - a.marketValueHKD);
    const top10 = sorted.slice(0, 10);
    const rest = sorted.slice(10);
    const topLines = top10.map((holding, index) => `${index + 1}. ${holding.ticker}｜${holding.name}｜${holding.assetType}｜` +
        `qty ${formatMoney(holding.quantity)}｜價 ${formatMoney(holding.currentPrice)} ${holding.currency}｜` +
        `市值 ${formatHoldingValuePair(holding.marketValue, holding.currency, holding.marketValueHKD)}｜` +
        `成本 ${formatHoldingValuePair(holding.costValue, holding.currency, holding.costValueHKD)}`);
    const restLines = rest.length > 0
        ? [
            `其他 ${rest.length} 項（總市值 約 ${formatCurrencyRounded(rest.reduce((sum, holding) => sum + holding.marketValueHKD, 0), 'HKD')}）：` +
                rest.map((h) => `${h.ticker}(${h.assetType})`).join('、'),
        ]
        : [];
    return ['【持倉概覽】', ...topLines, ...restLines].join('\n');
}
function formatRecentTransactionsSection(request) {
    if (!request.recentTransactions || request.recentTransactions.length === 0) {
        return '【最近交易（過去 30 日）】\n未有可用交易記錄。';
    }
    const lines = request.recentTransactions
        .slice()
        .sort((left, right) => left.ticker.localeCompare(right.ticker))
        .map((group) => `- ${group.ticker} ${group.assetName}：` +
        group.transactions
            .map((tx) => `${tx.date} ${tx.type} ${formatMoney(tx.quantity)} @ ${formatMoney(tx.price)}`)
            .join('； '));
    return ['【最近交易（過去 30 日）】', ...lines].join('\n');
}
function formatPriceHistorySection(request) {
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
function formatRecentSnapshotsSection(request) {
    if (!request.recentSnapshots || request.recentSnapshots.length === 0) {
        return '【最近 2 個 snapshot】\n未有可用 snapshot。';
    }
    const lines = request.recentSnapshots
        .slice()
        .sort((left, right) => left.date.localeCompare(right.date))
        .map((snapshot) => {
        const holdings = snapshot.holdings
            .map((holding) => `${holding.ticker} ${formatCurrencyRounded(holding.marketValueHKD, 'HKD')}`)
            .join('； ');
        return `- ${snapshot.date}｜總值 ${formatMoney(snapshot.totalValueHKD)} HKD｜淨流入 ${formatMoney(snapshot.netExternalFlowHKD)} HKD｜持倉 ${holdings}`;
    });
    return ['【最近 2 個 snapshot】', ...lines].join('\n');
}
function buildRichContextSection(request) {
    return [
        formatHoldingsSection(request),
        formatRecentTransactionsSection(request),
        formatPriceHistorySection(request),
        formatRecentSnapshotsSection(request),
    ].join('\n\n');
}
// Truncate conversation context to last ~1500 chars to control token budget
function truncateConversationContext(context, maxChars = 1500) {
    if (!context || context.length <= maxChars)
        return context;
    const truncated = context.slice(-maxChars);
    // Try to start at a clean turn boundary
    const turnBoundary = truncated.indexOf('第 ');
    return turnBoundary > 0 ? `[早期對話已壓縮]\n${truncated.slice(turnBoundary)}` : `[早期對話已壓縮]\n${truncated}`;
}
// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------
function buildAnalysisSystemPrompt(request, options) {
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
Analyze the portfolio snapshot and the supplied external search summary only.
${jsonInstruction}

Rules:
${getAnalysisRules()}

${getCategoryPromptPrefix(request.category)}

${getIntentPromptRules(options?.intent)}
  `.trim();
}
function buildAnalysisUserPrompt(request, externalSearchSummary = '', externalEvidence) {
    const richContextSection = request.holdings.length > 0 ? buildRichContextSection(request) : '';
    const externalSearchSection = request.category === 'general_question' && externalSearchSummary.trim()
        ? `
Latest external information summary (retrieved from Google Search):
${externalSearchSummary.trim()}
      `.trim()
        : '';
    const externalEvidenceSection = request.category === 'general_question' && externalEvidence && externalEvidence.sources.length > 0
        ? `
Structured external evidence pack:
${JSON.stringify({
            status: externalEvidence.status,
            retrievedAt: externalEvidence.retrievedAt,
            sources: externalEvidence.sources,
            earningsEvidencePack: externalEvidence.earningsEvidencePack,
        }, null, 2)}
      `.trim()
        : '';
    const conversationContext = truncateConversationContext(request.conversationContext || '');
    return `
Saved category background:
${request.analysisBackground || '未設定額外背景。'}

Conversation context:
${conversationContext || '目前未有前文對話。'}

${externalSearchSection ? `${externalSearchSection}\n\n` : ''}
${externalEvidenceSection ? `${externalEvidenceSection}\n\n` : ''}
User question / task:
${request.analysisQuestion || '請根據目前投資組合做一般分析。'}

Portfolio snapshot summary:
${request.holdings
        .slice()
        .sort((left, right) => right.marketValueHKD - left.marketValueHKD)
        .map((holding) => `- ${holding.ticker}｜${holding.name}｜${holding.assetType}｜qty ${formatMoney(holding.quantity)}｜` +
        `價 ${formatMoney(holding.currentPrice)} ${holding.currency}｜` +
        `市值 ${formatHoldingValuePair(holding.marketValue, holding.currency, holding.marketValueHKD)}｜` +
        `成本 ${formatHoldingValuePair(holding.costValue, holding.currency, holding.costValueHKD)}`)
        .join('\n')}

${richContextSection ? `${richContextSection}\n` : ''}
  `.trim();
}
export function buildPrompt(request, externalSearchSummary = '') {
    return `${buildAnalysisSystemPrompt(request)}\n\n${buildAnalysisUserPrompt(request, externalSearchSummary)}`;
}
function getExternalSourceLimit(intent) {
    if (intent === 'earnings_analysis')
        return 6;
    if (intent === 'macro_analysis')
        return 5;
    return 4;
}
function getExternalEvidenceCacheTtlMs(intent) {
    if (intent === 'macro_analysis')
        return 6 * 60 * 60 * 1000;
    if (intent === 'earnings_analysis')
        return 24 * 60 * 60 * 1000;
    return 6 * 60 * 60 * 1000;
}
function extractMentionedTickers(request) {
    const question = request.analysisQuestion || '';
    const mentioned = request.holdings
        .filter((holding) => {
        const ticker = holding.ticker.trim();
        if (!ticker)
            return false;
        return new RegExp(`(^|[^A-Z0-9.])${ticker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9.]|$)`, 'i').test(question);
    })
        .map((holding) => holding.ticker);
    if (mentioned.length > 0)
        return [...new Set(mentioned)];
    const companyAliases = [
        [/google|alphabet/i, 'GOOG'],
        [/apple/i, 'AAPL'],
        [/nvidia/i, 'NVDA'],
        [/tesla/i, 'TSLA'],
        [/microsoft/i, 'MSFT'],
        [/amazon/i, 'AMZN'],
        [/meta/i, 'META'],
    ];
    const inferred = companyAliases
        .filter(([pattern]) => pattern.test(question))
        .map(([, ticker]) => ticker)
        .filter((ticker) => request.holdings.some((holding) => holding.ticker.toUpperCase() === ticker));
    return inferred.length > 0 ? [...new Set(inferred)] : [];
}
function getDominantTopic(request, intent) {
    const tickers = extractMentionedTickers(request);
    if (tickers.length > 0)
        return tickers.join(',');
    if (intent === 'macro_analysis') {
        const question = (request.analysisQuestion || '').toLowerCase();
        if (/減息|利率|聯儲局|fed|fomc/.test(question))
            return 'rates';
        if (/通脹|cpi/.test(question))
            return 'inflation';
        if (/美元|dxy/.test(question))
            return 'usd';
        return question.slice(0, 80) || 'macro';
    }
    return (request.analysisQuestion || '').toLowerCase().slice(0, 80) || intent;
}
function buildExternalEvidenceCacheKey(request, intent) {
    return [intent, getDominantTopic(request, intent)].join(':').toLowerCase();
}
export function clearExternalEvidenceCacheForTest() {
    EXTERNAL_EVIDENCE_CACHE.clear();
}
export function seedExternalEvidenceCacheForTest(request, intent, value, ttlMs = 60 * 60 * 1000) {
    EXTERNAL_EVIDENCE_CACHE.set(buildExternalEvidenceCacheKey(request, intent), {
        expiresAt: Date.now() + ttlMs,
        value,
    });
}
function shouldReuseConversationEvidence(request) {
    const question = request.analysisQuestion || '';
    return Boolean(request.conversationContext?.trim()) && !/最新|今日|昨天|尋日|剛剛|current|latest|recent/i.test(question);
}
function sanitizeStringArray(value, maxItems = 8) {
    return Array.isArray(value)
        ? value
            .filter((item) => typeof item === 'string' && item.trim().length > 0)
            .map((item) => item.trim())
            .slice(0, maxItems)
        : [];
}
function sanitizeEvidenceSourceType(value) {
    if (value === 'official_report' ||
        value === 'sec_filing' ||
        value === 'earnings_call' ||
        value === 'news' ||
        value === 'macro_data' ||
        value === 'company_ir' ||
        value === 'market_data' ||
        value === 'other') {
        return value;
    }
    return 'other';
}
function normalizeExternalEvidenceSource(value, retrievedAt) {
    if (typeof value !== 'object' || value === null)
        return null;
    const record = value;
    const sourceUrl = sanitizeString(record.sourceUrl) || sanitizeString(record.url);
    const sourceTitle = sanitizeString(record.sourceTitle) || sanitizeString(record.title) || sourceUrl;
    if (!sourceTitle || !sourceUrl)
        return null;
    return {
        sourceTitle,
        sourceUrl,
        publishedDate: sanitizeString(record.publishedDate) ?? undefined,
        retrievedAt: sanitizeString(record.retrievedAt) ?? retrievedAt,
        sourceType: sanitizeEvidenceSourceType(record.sourceType),
        keyFacts: sanitizeStringArray(record.keyFacts, 6),
        keyFigures: sanitizeStringArray(record.keyFigures, 8),
        uncertainty: sanitizeStringArray(record.uncertainty, 5),
    };
}
function evidenceSourcesToLegacySources(sources, query, relatedTickers) {
    return sources.map((source) => ({
        title: source.sourceTitle,
        url: source.sourceUrl,
        publisher: undefined,
        publishedAt: source.publishedDate,
        retrievedAt: source.retrievedAt,
        snippet: [...source.keyFigures, ...source.keyFacts].slice(0, 3).join('； '),
        query,
        relatedTickers,
    }));
}
function getStringOrNull(record, key) {
    return sanitizeString(record[key]) ?? null;
}
function normalizeEarningsEvidencePack(value, externalSources) {
    if (typeof value !== 'object' || value === null)
        return undefined;
    const record = value;
    const sources = Array.isArray(record.sources) && record.sources.length > 0
        ? record.sources
            .map((source) => normalizeExternalEvidenceSource(source, new Date().toISOString()))
            .filter((source) => source !== null)
        : externalSources;
    return {
        companyName: getStringOrNull(record, 'companyName'),
        ticker: getStringOrNull(record, 'ticker'),
        reportingPeriod: getStringOrNull(record, 'reportingPeriod'),
        reportDate: getStringOrNull(record, 'reportDate'),
        revenue: getStringOrNull(record, 'revenue'),
        revenueGrowth: getStringOrNull(record, 'revenueGrowth'),
        operatingIncome: getStringOrNull(record, 'operatingIncome'),
        operatingMargin: getStringOrNull(record, 'operatingMargin'),
        netIncome: getStringOrNull(record, 'netIncome'),
        EPS: getStringOrNull(record, 'EPS'),
        operatingCashFlow: getStringOrNull(record, 'operatingCashFlow'),
        freeCashFlow: getStringOrNull(record, 'freeCashFlow'),
        capitalExpenditure: getStringOrNull(record, 'capitalExpenditure'),
        segmentRevenue: sanitizeStringArray(record.segmentRevenue, 8),
        segmentOperatingIncome: sanitizeStringArray(record.segmentOperatingIncome, 8),
        managementCommentary: sanitizeStringArray(record.managementCommentary, 8),
        marketReaction: sanitizeStringArray(record.marketReaction, 6),
        oneOffItems: sanitizeStringArray(record.oneOffItems, 6),
        mainRisks: sanitizeStringArray(record.mainRisks, 6),
        sources,
        uncertainty: sanitizeStringArray(record.uncertainty, 8),
    };
}
function getEarningsSourcePriority(sourceType) {
    switch (sourceType) {
        case 'official_report':
            return 0;
        case 'sec_filing':
            return 1;
        case 'company_ir':
            return 2;
        case 'earnings_call':
            return 3;
        case 'news':
            return 4;
        default:
            return 5;
    }
}
function sortEarningsSourcesByPriority(sources) {
    return [...sources].sort((left, right) => getEarningsSourcePriority(left.sourceType) - getEarningsSourcePriority(right.sourceType));
}
function getPreferredEarningsSources(sources) {
    const sorted = sortEarningsSourcesByPriority(sources);
    const official = sorted.filter((source) => ['official_report', 'sec_filing', 'company_ir', 'earnings_call'].includes(source.sourceType));
    return official.length > 0 ? official : sorted;
}
function findEarningsFigure(sources, patterns) {
    return getPreferredEarningsSources(sources)
        .flatMap((source) => source.keyFigures)
        .find((figure) => patterns.some((pattern) => pattern.test(figure))) ?? null;
}
function findEarningsFacts(sources, patterns, maxItems = 8) {
    return getPreferredEarningsSources(sources)
        .flatMap((source) => source.keyFacts)
        .filter((fact) => patterns.some((pattern) => pattern.test(fact)))
        .slice(0, maxItems);
}
function addMissingEarningsFieldUncertainty(uncertainty, fieldName, value, label) {
    const isMissing = Array.isArray(value) ? value.length === 0 : !value;
    if (isMissing) {
        uncertainty.push(`未能從已取得資料確認 ${label}（${String(fieldName)}）。`);
    }
}
function completeEarningsEvidencePack(basePack, externalSources) {
    const sortedSources = sortEarningsSourcesByPriority(basePack.sources.length > 0 ? basePack.sources : externalSources);
    const uncertainty = [...basePack.uncertainty, ...sortedSources.flatMap((source) => source.uncertainty)];
    const pick = (current, patterns) => current ?? findEarningsFigure(sortedSources, patterns);
    const segmentRevenue = basePack.segmentRevenue.length > 0
        ? basePack.segmentRevenue
        : getPreferredEarningsSources(sortedSources)
            .flatMap((source) => source.keyFigures)
            .filter((figure) => /cloud|advertising|youtube|search|segment|分部|廣告|搜尋/i.test(figure))
            .slice(0, 8);
    const segmentOperatingIncome = basePack.segmentOperatingIncome.length > 0
        ? basePack.segmentOperatingIncome
        : getPreferredEarningsSources(sortedSources)
            .flatMap((source) => source.keyFigures)
            .filter((figure) => /segment.*operating|operating.*segment|分部.*利潤|cloud.*income|operating income.*cloud/i.test(figure))
            .slice(0, 8);
    const completed = {
        ...basePack,
        reportingPeriod: pick(basePack.reportingPeriod, [/quarter|季度|年度|year|Q[1-4]|FY/i]),
        reportDate: basePack.reportDate ?? sortedSources.find((source) => source.publishedDate)?.publishedDate ?? null,
        revenue: pick(basePack.revenue, [/revenue|收入|營收/i]),
        revenueGrowth: pick(basePack.revenueGrowth, [/revenue.*growth|收入.*增|營收.*增|同比|YoY|year-over-year/i]),
        operatingIncome: pick(basePack.operatingIncome, [/operating income|經營利潤|營業利潤/i]),
        operatingMargin: pick(basePack.operatingMargin, [/operating margin|經營利潤率|營業利潤率|margin/i]),
        netIncome: pick(basePack.netIncome, [/net income|淨利潤|純利/i]),
        EPS: pick(basePack.EPS, [/EPS|diluted.*share|每股/i]),
        operatingCashFlow: pick(basePack.operatingCashFlow, [/operating cash flow|net cash.*operating|營運現金流/i]),
        freeCashFlow: pick(basePack.freeCashFlow, [/free cash flow|自由現金流|FCF/i]),
        capitalExpenditure: pick(basePack.capitalExpenditure, [/capex|capital expenditure|capital expenditures|資本開支/i]),
        segmentRevenue,
        segmentOperatingIncome,
        managementCommentary: basePack.managementCommentary.length > 0
            ? basePack.managementCommentary
            : findEarningsFacts(sortedSources, [/management|CEO|CFO|管理層|指引|guidance|comment/i], 8),
        marketReaction: basePack.marketReaction.length > 0
            ? basePack.marketReaction
            : findEarningsFacts(sortedSources, [/stock|share|market|股價|市場|reaction/i], 6),
        oneOffItems: basePack.oneOffItems.length > 0
            ? basePack.oneOffItems
            : findEarningsFacts(sortedSources, [/one-off|一次性|non-recurring|restructuring|impairment|減值|會計/i], 6),
        mainRisks: basePack.mainRisks.length > 0
            ? basePack.mainRisks
            : sortedSources.flatMap((source) => source.uncertainty).slice(0, 6),
        sources: sortedSources,
        uncertainty,
    };
    addMissingEarningsFieldUncertainty(uncertainty, 'companyName', completed.companyName, '公司名稱');
    addMissingEarningsFieldUncertainty(uncertainty, 'ticker', completed.ticker, 'ticker');
    addMissingEarningsFieldUncertainty(uncertainty, 'reportingPeriod', completed.reportingPeriod, '報告期');
    addMissingEarningsFieldUncertainty(uncertainty, 'reportDate', completed.reportDate, '財報日期');
    addMissingEarningsFieldUncertainty(uncertainty, 'revenue', completed.revenue, '收入');
    addMissingEarningsFieldUncertainty(uncertainty, 'revenueGrowth', completed.revenueGrowth, '收入增長');
    addMissingEarningsFieldUncertainty(uncertainty, 'operatingIncome', completed.operatingIncome, '經營利潤');
    addMissingEarningsFieldUncertainty(uncertainty, 'operatingMargin', completed.operatingMargin, '經營利潤率');
    addMissingEarningsFieldUncertainty(uncertainty, 'netIncome', completed.netIncome, '淨利潤');
    addMissingEarningsFieldUncertainty(uncertainty, 'EPS', completed.EPS, 'EPS');
    addMissingEarningsFieldUncertainty(uncertainty, 'operatingCashFlow', completed.operatingCashFlow, '營運現金流');
    addMissingEarningsFieldUncertainty(uncertainty, 'freeCashFlow', completed.freeCashFlow, '自由現金流');
    addMissingEarningsFieldUncertainty(uncertainty, 'capitalExpenditure', completed.capitalExpenditure, '資本開支');
    addMissingEarningsFieldUncertainty(uncertainty, 'segmentRevenue', completed.segmentRevenue, '分部收入');
    addMissingEarningsFieldUncertainty(uncertainty, 'segmentOperatingIncome', completed.segmentOperatingIncome, '分部經營利潤');
    addMissingEarningsFieldUncertainty(uncertainty, 'oneOffItems', completed.oneOffItems, '一次性因素');
    completed.uncertainty = [...new Set(uncertainty)].slice(0, 16);
    return completed;
}
function mergeEarningsEvidencePacks(parsedPack, deterministicPack) {
    if (!parsedPack)
        return deterministicPack;
    return completeEarningsEvidencePack({
        ...deterministicPack,
        ...parsedPack,
        companyName: parsedPack.companyName ?? deterministicPack.companyName,
        ticker: parsedPack.ticker ?? deterministicPack.ticker,
        reportingPeriod: parsedPack.reportingPeriod ?? deterministicPack.reportingPeriod,
        reportDate: parsedPack.reportDate ?? deterministicPack.reportDate,
        revenue: parsedPack.revenue ?? deterministicPack.revenue,
        revenueGrowth: parsedPack.revenueGrowth ?? deterministicPack.revenueGrowth,
        operatingIncome: parsedPack.operatingIncome ?? deterministicPack.operatingIncome,
        operatingMargin: parsedPack.operatingMargin ?? deterministicPack.operatingMargin,
        netIncome: parsedPack.netIncome ?? deterministicPack.netIncome,
        EPS: parsedPack.EPS ?? deterministicPack.EPS,
        operatingCashFlow: parsedPack.operatingCashFlow ?? deterministicPack.operatingCashFlow,
        freeCashFlow: parsedPack.freeCashFlow ?? deterministicPack.freeCashFlow,
        capitalExpenditure: parsedPack.capitalExpenditure ?? deterministicPack.capitalExpenditure,
        segmentRevenue: parsedPack.segmentRevenue.length > 0 ? parsedPack.segmentRevenue : deterministicPack.segmentRevenue,
        segmentOperatingIncome: parsedPack.segmentOperatingIncome.length > 0
            ? parsedPack.segmentOperatingIncome
            : deterministicPack.segmentOperatingIncome,
        managementCommentary: parsedPack.managementCommentary.length > 0
            ? parsedPack.managementCommentary
            : deterministicPack.managementCommentary,
        marketReaction: parsedPack.marketReaction.length > 0 ? parsedPack.marketReaction : deterministicPack.marketReaction,
        oneOffItems: parsedPack.oneOffItems.length > 0 ? parsedPack.oneOffItems : deterministicPack.oneOffItems,
        mainRisks: parsedPack.mainRisks.length > 0 ? parsedPack.mainRisks : deterministicPack.mainRisks,
        sources: parsedPack.sources.length > 0 ? parsedPack.sources : deterministicPack.sources,
        uncertainty: [...deterministicPack.uncertainty, ...parsedPack.uncertainty],
    }, parsedPack.sources.length > 0 ? parsedPack.sources : deterministicPack.sources);
}
function ensureEarningsEvidencePack(searchResult, request, buildPack) {
    const deterministicPack = buildPack(request.analysisQuestion || '', searchResult.externalEvidence, request);
    return {
        ...searchResult,
        earningsEvidencePack: mergeEarningsEvidencePacks(searchResult.earningsEvidencePack, deterministicPack),
    };
}
export function buildEarningsEvidencePack(question, externalSources, portfolioSnapshot) {
    const tickers = extractMentionedTickers({ ...portfolioSnapshot, analysisQuestion: question });
    const ticker = tickers[0] ?? null;
    const holding = ticker
        ? portfolioSnapshot.holdings.find((item) => item.ticker.toUpperCase() === ticker.toUpperCase())
        : undefined;
    const sortedSources = sortEarningsSourcesByPriority(externalSources);
    const preferredSources = getPreferredEarningsSources(sortedSources);
    const combinedFigures = preferredSources.flatMap((source) => source.keyFigures);
    const findFigure = (patterns) => combinedFigures.find((figure) => patterns.some((pattern) => pattern.test(figure))) ?? null;
    return completeEarningsEvidencePack({
        companyName: holding?.name ?? null,
        ticker,
        reportingPeriod: findFigure([/quarter|季度|年度|year|Q[1-4]/i]),
        reportDate: sortedSources.find((source) => source.publishedDate)?.publishedDate ?? null,
        revenue: findFigure([/revenue|收入|營收/i]),
        revenueGrowth: findFigure([/revenue.*growth|收入.*增|營收.*增|同比|YoY/i]),
        operatingIncome: findFigure([/operating income|經營利潤|營業利潤/i]),
        operatingMargin: findFigure([/operating margin|經營利潤率|營業利潤率|margin/i]),
        netIncome: findFigure([/net income|淨利潤|純利/i]),
        EPS: findFigure([/EPS|每股/i]),
        operatingCashFlow: findFigure([/operating cash flow|營運現金流/i]),
        freeCashFlow: findFigure([/free cash flow|自由現金流|FCF/i]),
        capitalExpenditure: findFigure([/capex|capital expenditure|資本開支/i]),
        segmentRevenue: combinedFigures.filter((figure) => /cloud|advertising|youtube|search|分部/i.test(figure)).slice(0, 8),
        segmentOperatingIncome: combinedFigures.filter((figure) => /segment.*operating|分部.*利潤|cloud.*income/i.test(figure)).slice(0, 8),
        managementCommentary: preferredSources.flatMap((source) => source.keyFacts).filter((fact) => /management|CEO|CFO|管理層|指引|guidance/i.test(fact)).slice(0, 8),
        marketReaction: sortedSources.flatMap((source) => source.keyFacts).filter((fact) => /stock|share|market|股價|市場/i.test(fact)).slice(0, 6),
        oneOffItems: preferredSources.flatMap((source) => source.keyFacts).filter((fact) => /one-off|一次性|non-recurring|restructuring|減值|會計/i.test(fact)).slice(0, 6),
        mainRisks: sortedSources.flatMap((source) => source.uncertainty).slice(0, 6),
        sources: sortedSources,
        uncertainty: [
            ...sortedSources.flatMap((source) => source.uncertainty),
            ...[
                findFigure([/operating cash flow|營運現金流/i]) ? null : '未能從已取得資料確認營運現金流。',
                findFigure([/free cash flow|自由現金流|FCF/i]) ? null : '未能從已取得資料確認自由現金流。',
                findFigure([/capex|capital expenditure|資本開支/i]) ? null : '未能從已取得資料確認資本開支。',
            ].filter((item) => Boolean(item)),
        ].slice(0, 10),
    }, sortedSources);
}
function extractGroundingSources(response, query, relatedTickers, retrievedAt) {
    try {
        const candidates = response?.candidates;
        if (!Array.isArray(candidates) || candidates.length === 0)
            return [];
        const meta = candidates[0]?.groundingMetadata;
        if (!meta)
            return [];
        const chunks = meta.groundingChunks;
        if (!Array.isArray(chunks))
            return [];
        return chunks
            .slice(0, 10)
            .map((chunk) => {
            const web = chunk?.web;
            if (!web)
                return null;
            const url = typeof web.uri === 'string' ? web.uri : '';
            const title = typeof web.title === 'string' ? web.title : url;
            if (!url)
                return null;
            return {
                title,
                url,
                retrievedAt,
                snippet: '',
                query,
                relatedTickers,
            };
        })
            .filter((s) => s !== null);
    }
    catch {
        return [];
    }
}
function buildGeneralQuestionSearchPrompt(request, intent) {
    const searchTargets = [...request.holdings]
        .filter((holding) => holding.assetType !== 'cash')
        .sort((left, right) => right.marketValueHKD - left.marketValueHKD)
        .slice(0, 10);
    const tickers = searchTargets.map((holding) => `${holding.ticker} (${holding.name})`).join('、') || '目前無主要持倉';
    const question = request.analysisQuestion.trim() || '目前投資組合有咩最新外部資訊值得留意？';
    const conversationContext = truncateConversationContext(request.conversationContext || '', 500);
    const retrievedDate = new Date().toISOString().slice(0, 10);
    const sourceLimit = getExternalSourceLimit(intent);
    const officialSourceRule = intent === 'earnings_analysis'
        ? [
            '財報問題來源優先次序：公司 investor relations、SEC 10-Q/10-K、earnings release、earnings call transcript；其次才使用 Reuters、CNBC、Bloomberg 等市場新聞。',
            '如果官方來源不足，必須在 uncertainty 明確標記缺口，但仍要根據已取得資料作有限度分析。',
        ]
        : [];
    return [
        '請使用 Google Search 建立可交給專業投資分析模型使用的 structured evidence pack。不要直接給買賣建議，不要輸出完整網頁原文。',
        `檢索日期：${retrievedDate}`,
        `問題類型：${intent}`,
        `最多使用 ${sourceLimit} 個來源，每個來源只保留 keyFacts、keyFigures、sourceUrl。`,
        ...officialSourceRule,
        '研究範圍要同時覆蓋：',
        '1. 使用者問題直接提及的公司、ETF、資產類別、國家/地區、行業或宏觀主題。',
        '2. 若問題涉及財報/業績，整理最新季度/年度收入、盈利、指引、管理層重點、估值或市場反應。',
        '3. 若問題涉及宏觀，整理利率、通脹、美元、債息、政策、風險偏好、主要市場表現與資金流向。',
        '4. 若問題涉及持倉，整理與主要持倉最相關的近期外部資訊，並標明哪些 ticker 可能受影響。',
        '5. 若資料有衝突或不完整，請標明不確定之處；不要用舊資料扮最新。',
        `使用者問題：${question}`,
        `對話上下文：${conversationContext || '目前未有前文對話。'}`,
        `主要持倉：${tickers}`,
        '請只輸出 valid JSON，不要 markdown code fence。格式：',
        `{
  "summary": "繁體中文摘要，最多 500 字",
  "sources": [
    {
      "sourceTitle": "來源標題",
      "sourceUrl": "https://...",
      "publishedDate": "YYYY-MM-DD 或 null",
      "retrievedAt": "${new Date().toISOString()}",
      "sourceType": "official_report|sec_filing|earnings_call|news|macro_data|company_ir|market_data|other",
      "keyFacts": ["每項不超過 35 字"],
      "keyFigures": ["只列可在來源中確認的數字"],
      "uncertainty": ["資料缺口或衝突"]
    }
  ],
  "earningsEvidencePack": ${intent === 'earnings_analysis'
            ? `{
    "companyName": null,
    "ticker": null,
    "reportingPeriod": null,
    "reportDate": null,
    "revenue": null,
    "revenueGrowth": null,
    "operatingIncome": null,
    "operatingMargin": null,
    "netIncome": null,
    "EPS": null,
    "operatingCashFlow": null,
    "freeCashFlow": null,
    "capitalExpenditure": null,
    "segmentRevenue": [],
    "segmentOperatingIncome": [],
    "managementCommentary": [],
    "marketReaction": [],
    "oneOffItems": [],
    "mainRisks": [],
    "sources": [],
    "uncertainty": []
  }`
            : 'null'}
}`,
    ].join('\n');
}
function parseExternalEvidencePayload(raw, retrievedAt) {
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
    const candidate = jsonMatch ? jsonMatch[1] : raw;
    try {
        const parsed = JSON.parse(candidate.trim());
        const externalEvidence = Array.isArray(parsed.sources)
            ? parsed.sources
                .map((source) => normalizeExternalEvidenceSource(source, retrievedAt))
                .filter((source) => source !== null)
            : [];
        const earningsEvidencePack = normalizeEarningsEvidencePack(parsed.earningsEvidencePack, externalEvidence);
        const uncertaintyCount = externalEvidence.reduce((count, source) => count + source.uncertainty.length, 0);
        return {
            summary: sanitizeString(parsed.summary) ?? raw,
            externalEvidence,
            earningsEvidencePack,
            status: externalEvidence.length === 0 ? 'partial' : uncertaintyCount > 0 ? 'partial' : 'ok',
        };
    }
    catch {
        return {
            summary: raw,
            externalEvidence: [],
            status: 'partial',
        };
    }
}
function mergeExternalEvidenceSources(parsedSources, groundingSources, retrievedAt, sourceLimit) {
    const merged = [...parsedSources];
    for (const source of groundingSources) {
        if (merged.some((item) => item.sourceUrl === source.url))
            continue;
        merged.push({
            sourceTitle: source.title,
            sourceUrl: source.url,
            publishedDate: source.publishedAt,
            retrievedAt,
            sourceType: 'other',
            keyFacts: source.snippet ? [source.snippet] : [],
            keyFigures: [],
            uncertainty: ['此來源由 grounding metadata 提供，未能抽取完整關鍵數字。'],
        });
    }
    return merged.slice(0, sourceLimit);
}
async function generateGeneralQuestionSearchSummary(request, intent) {
    const retrievedAt = new Date().toISOString();
    const searchTargets = [...request.holdings]
        .filter((h) => h.assetType !== 'cash')
        .sort((a, b) => b.marketValueHKD - a.marketValueHKD)
        .slice(0, 10);
    const relatedTickers = searchTargets.map((h) => h.ticker);
    const query = request.analysisQuestion.trim() || '投資組合外部資訊';
    const cacheKey = buildExternalEvidenceCacheKey(request, intent);
    const cached = EXTERNAL_EVIDENCE_CACHE.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() && shouldReuseConversationEvidence(request)) {
        return { ...cached.value, fromCache: true };
    }
    try {
        const ai = new GoogleGenAI({ apiKey: getGeminiApiKey() });
        const prompt = buildGeneralQuestionSearchPrompt(request, intent);
        const candidates = getSearchModelCandidates();
        let lastError = null;
        for (const model of candidates) {
            try {
                const response = await ai.models.generateContent({
                    model,
                    contents: prompt,
                    config: {
                        maxOutputTokens: 3000,
                        tools: [{ googleSearch: {} }],
                    },
                });
                const rawSummary = response.text?.trim();
                if (rawSummary) {
                    const parsed = parseExternalEvidencePayload(rawSummary, retrievedAt);
                    const groundedSources = extractGroundingSources(response, query, relatedTickers, retrievedAt);
                    const evidenceSources = mergeExternalEvidenceSources(parsed.externalEvidence, groundedSources, retrievedAt, getExternalSourceLimit(intent));
                    const deterministicPack = intent === 'earnings_analysis'
                        ? buildEarningsEvidencePack(request.analysisQuestion || '', evidenceSources, request)
                        : undefined;
                    const earningsEvidencePack = intent === 'earnings_analysis' && deterministicPack
                        ? mergeEarningsEvidencePacks(parsed.earningsEvidencePack, deterministicPack)
                        : undefined;
                    const status = evidenceSources.length > 0 ? parsed.status : 'partial';
                    const result = {
                        summary: parsed.summary || rawSummary,
                        sources: evidenceSourcesToLegacySources(evidenceSources, query, relatedTickers),
                        externalEvidence: evidenceSources,
                        earningsEvidencePack,
                        status,
                        retrievedAt,
                    };
                    EXTERNAL_EVIDENCE_CACHE.set(cacheKey, {
                        expiresAt: Date.now() + getExternalEvidenceCacheTtlMs(intent),
                        value: result,
                    });
                    return result;
                }
                console.warn(`[analyzePortfolio] Gemini grounding returned empty summary for model ${model}; trying fallback.`);
            }
            catch (error) {
                console.warn(`[analyzePortfolio] Gemini grounding fallback from model ${model}: ${error instanceof Error ? error.message : 'unknown_error'}`);
                lastError = error;
            }
        }
        const fallbackMessage = lastError instanceof Error ? lastError.message : 'grounding_failed';
        return {
            summary: `未能取得最新外部資料摘要；請以組合資料為主回答，並註明外部搜尋暫時失敗（${fallbackMessage}）。`,
            sources: [],
            externalEvidence: [],
            status: 'failed',
            retrievedAt,
        };
    }
    catch (error) {
        const fallbackMessage = error instanceof Error ? error.message : 'grounding_unavailable';
        console.warn('[analyzePortfolio] external search unavailable:', fallbackMessage);
        return {
            summary: `未能取得最新外部資料摘要；請以組合資料為主回答，並註明外部搜尋暫時失敗（${fallbackMessage}）。`,
            sources: [],
            externalEvidence: [],
            status: 'failed',
            retrievedAt,
        };
    }
}
// ---------------------------------------------------------------------------
// MacroContext builder
// ---------------------------------------------------------------------------
function buildMacroContext(searchResult) {
    return {
        retrievedAt: searchResult.retrievedAt,
        summary: searchResult.summary,
        sources: searchResult.sources,
    };
}
// ---------------------------------------------------------------------------
// Model callers
// ---------------------------------------------------------------------------
function getModelProvider(model) {
    return resolveModelProvider(model);
}
async function analyzeWithGemini(prompt, model, maxTokens, jsonMode = false) {
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
async function analyzeWithClaude(systemPrompt, userPrompt, model, maxTokens = 1800) {
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
    const payload = (await response.json());
    if (!response.ok) {
        const errorMessage = typeof payload.error === 'object' &&
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
        const value = item;
        return value.type === 'text' && typeof value.text === 'string' ? value.text : '';
    })
        .join('\n');
    return text;
}
function getDefaultAnalysisMaxTokens(category) {
    if (category === 'asset_report') {
        return 5000;
    }
    if (category === 'asset_analysis') {
        return 3500;
    }
    return 1800;
}
function getGeneralQuestionMaxTokens(intent) {
    if (intent === 'portfolio_only')
        return 900;
    if (intent === 'earnings_analysis')
        return 4200;
    if (intent === 'company_research' ||
        intent === 'macro_analysis' ||
        intent === 'strategy_analysis' ||
        intent === 'market_research' ||
        intent === 'deep_analysis') {
        return 3200;
    }
    return 1800;
}
export function qualityCheckGeneralAnswer(args) {
    const { answer, intent, question, request, externalEvidence = [] } = args;
    const failures = [];
    const normalized = answer.trim();
    if (!normalized)
        failures.push('答案為空。');
    const firstLine = normalized.split('\n').find((line) => line.trim().length > 0) ?? '';
    if (firstLine.length < 8 || firstLine.length > 160)
        failures.push('缺少清晰一句話結論。');
    if (/資料不完整|資料不足|建議查閱完整財報|自行查閱/.test(normalized) && normalized.length < 500) {
        failures.push('回答過度依賴資料不足聲明，未基於已取得資料分析。');
    }
    if (/立即全倉|必定|保證|一定會|無風險/.test(normalized)) {
        failures.push('包含絕對買賣或保證式表述。');
    }
    if (question && !normalized.includes(question.slice(0, 2)) && normalized.length < 200) {
        failures.push('未充分回答使用者原問題。');
    }
    if (intent === 'earnings_analysis') {
        const required = [
            [/收入|營收|revenue/i, '缺少收入分析。'],
            [/利潤|淨利|經營利潤|EPS|margin/i, '缺少利潤分析。'],
            [/現金流|自由現金流|cash flow|FCF/i, '缺少現金流分析。'],
            [/資本開支|capex|數據中心|AI/i, '缺少資本開支分析。'],
            [/分部|Cloud|Search|YouTube|Advertising|廣告/i, '缺少業務分部分析。'],
            [/一次性|one-off|會計|non-recurring|未能.*確認/i, '缺少一次性因素或資料缺口說明。'],
            [/持倉|市值|佔比|成本|30日|投資含義/i, '缺少投資含義或持倉連結。'],
            [/監察|指標|留意/i, '缺少具體監察指標。'],
        ];
        for (const [pattern, message] of required) {
            if (!pattern.test(normalized))
                failures.push(message);
        }
        if (!/\|.+\|/.test(normalized))
            failures.push('財報回答缺少核心數字表。');
    }
    const mentionedTickers = extractMentionedTickers(request);
    const hasRelevantHolding = mentionedTickers.length > 0;
    if (hasRelevantHolding && !/(持倉|市值|佔比|成本|30日|quantity|qty)/i.test(normalized)) {
        failures.push('使用者持有相關資產，但答案未引用持倉資料。');
    }
    if (externalEvidence.some((source) => source.uncertainty.length > 0) && !/未能|不足|不確定|缺口/.test(normalized)) {
        failures.push('外部 evidence 有不確定事項，但答案未說明資料缺口。');
    }
    return { ok: failures.length === 0, failures };
}
function buildRewriteUserPrompt(originalUserPrompt, answer, failures) {
    return `
以下是上一版回答，質檢未通過。請使用同一批資料重寫一次，只輸出同樣 JSON 格式，不要新增來源外的事實。

質檢失敗原因：
${failures.map((failure) => `- ${failure}`).join('\n')}

上一版回答：
${answer}

原始使用者 prompt：
${originalUserPrompt}
  `.trim();
}
export function getAnalyzePortfolioErrorResponse(error) {
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
export async function runPortfolioAnalysisRequest(request, options) {
    const isGeneralQuestion = request.category === 'general_question';
    // Intent classification (general_question only)
    const intent = isGeneralQuestion
        ? classifyIntent(request.analysisQuestion || '')
        : undefined;
    // Conditional external search
    let searchResult = null;
    let macroCtx;
    if (isGeneralQuestion && intent && intentNeedsExternalSearch(intent)) {
        searchResult = options?.testHooks?.generateExternalSearchSummary
            ? await options.testHooks.generateExternalSearchSummary(request, intent)
            : await generateGeneralQuestionSearchSummary(request, intent);
        if (intent === 'earnings_analysis') {
            searchResult = ensureEarningsEvidencePack(searchResult, request, options?.testHooks?.buildEarningsEvidencePack ?? buildEarningsEvidencePack);
        }
        macroCtx = buildMacroContext(searchResult);
    }
    const externalSearchSummary = searchResult?.summary ?? '';
    const systemPrompt = buildAnalysisSystemPrompt(request, { isGeneralQuestion, intent });
    const userPrompt = buildAnalysisUserPrompt(request, externalSearchSummary, searchResult
        ? {
            sources: searchResult.externalEvidence,
            earningsEvidencePack: searchResult.earningsEvidencePack,
            status: searchResult.status,
            retrievedAt: searchResult.retrievedAt,
        }
        : undefined);
    const provider = getModelProvider(request.analysisModel);
    const resolvedMaxTokens = options?.maxTokens ??
        (isGeneralQuestion
            ? getGeneralQuestionMaxTokens(intent)
            : getDefaultAnalysisMaxTokens(request.category));
    const resolvedModel = request.analysisModel === 'claude-opus-4-7'
        ? getClaudeAnalyzeModel()
        : getGeminiAnalyzeModel(request.analysisModel);
    let raw = provider === 'anthropic'
        ? await (options?.testHooks?.analyzeWithClaude ?? analyzeWithClaude)(systemPrompt, userPrompt, resolvedModel, resolvedMaxTokens)
        : await (options?.testHooks?.analyzeWithGemini ?? analyzeWithGemini)(`${systemPrompt}\n\n${userPrompt}`, resolvedModel, resolvedMaxTokens, isGeneralQuestion);
    // Parse structured response for general_question; plain text for others
    let result;
    if (isGeneralQuestion) {
        let parsed = parseStructuredGeneralAnswer(raw);
        const checkGeneralAnswer = options?.testHooks?.qualityCheckGeneralAnswer ?? qualityCheckGeneralAnswer;
        let finalQualityFailures = [];
        const quality = checkGeneralAnswer({
            answer: parsed.answer,
            intent,
            question: request.analysisQuestion || '',
            request,
            externalEvidence: searchResult?.externalEvidence,
        });
        if (!quality.ok) {
            const rewritePrompt = buildRewriteUserPrompt(userPrompt, parsed.answer, quality.failures);
            raw =
                provider === 'anthropic'
                    ? await (options?.testHooks?.analyzeWithClaude ?? analyzeWithClaude)(systemPrompt, rewritePrompt, resolvedModel, resolvedMaxTokens)
                    : await (options?.testHooks?.analyzeWithGemini ?? analyzeWithGemini)(`${systemPrompt}\n\n${rewritePrompt}`, resolvedModel, resolvedMaxTokens, true);
            parsed = parseStructuredGeneralAnswer(raw);
            const rewriteQuality = checkGeneralAnswer({
                answer: parsed.answer,
                intent,
                question: request.analysisQuestion || '',
                request,
                externalEvidence: searchResult?.externalEvidence,
            });
            finalQualityFailures = rewriteQuality.ok
                ? []
                : rewriteQuality.failures.map((failure) => `重寫後仍需留意：${failure}`);
        }
        result = {
            answer: parsed.answer,
            usedPortfolioFacts: parsed.usedPortfolioFacts,
            uncertainty: [
                ...parsed.uncertainty,
                ...finalQualityFailures,
                ...(searchResult?.externalEvidence.flatMap((source) => source.uncertainty) ?? []),
                ...(searchResult?.earningsEvidencePack?.uncertainty ?? []),
            ].slice(0, 8),
            suggestedActions: parsed.suggestedActions,
            usedExternalSources: searchResult?.externalEvidence
                .slice(0, getExternalSourceLimit(intent ?? 'company_research'))
                .map((s) => `${s.sourceTitle} — ${s.sourceUrl}`) ?? [],
            usedExternalSourcesDetailed: searchResult?.externalEvidence ?? [],
        };
    }
    else {
        result = sanitizeAnalysisResult(raw);
    }
    // Data freshness metadata
    const dataFreshness = isGeneralQuestion
        ? {
            hasExternalSearch: Boolean(searchResult),
            externalSearchAt: searchResult?.retrievedAt,
            externalSearchStatus: searchResult
                ? searchResult.fromCache
                    ? 'cached'
                    : searchResult.status
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
        externalEvidence: searchResult?.externalEvidence,
        earningsEvidencePack: searchResult?.earningsEvidencePack,
        ...result,
    };
}
export async function analyzePortfolio(payload) {
    const request = normalizeAnalysisRequest(payload);
    return runPortfolioAnalysisRequest(request, { delivery: 'manual' });
}
