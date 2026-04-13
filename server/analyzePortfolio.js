import { GoogleGenAI } from '@google/genai';
const ANALYZE_ROUTE = '/api/analyze';
const DEFAULT_GEMINI_ANALYZE_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_CLAUDE_ANALYZE_MODEL = 'claude-opus-4-6';
const SUPPORTED_ANALYSIS_MODELS = {
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
        : DEFAULT_GEMINI_ANALYZE_MODEL;
}
function getClaudeAnalyzeModel() {
    const model = process.env.CLAUDE_ANALYZE_MODEL?.trim() || DEFAULT_CLAUDE_ANALYZE_MODEL;
    return model === 'claude-opus-4-6' ? model : DEFAULT_CLAUDE_ANALYZE_MODEL;
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
    if (value === 'gemini-3.1-pro-preview' || value === 'claude-opus-4-6') {
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
        const costValue = sanitizeNumber(asset.costValue);
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
    };
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
    return {
        answer,
    };
}
function getCategoryPromptPrefix(category) {
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
export function buildPrompt(request) {
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

Saved category background:
${request.analysisBackground || '未設定額外背景。'}

Conversation context:
${request.conversationContext || '目前未有前文對話。'}

User question / task:
${request.analysisQuestion || '請根據目前投資組合做一般分析。'}

Portfolio snapshot:
${JSON.stringify(request, null, 2)}
  `.trim();
}
function getModelProvider(model) {
    return SUPPORTED_ANALYSIS_MODELS[model].provider;
}
async function analyzeWithGemini(prompt, model, maxTokens) {
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
async function analyzeWithClaude(prompt, model, maxTokens = 1400) {
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
            messages: [
                {
                    role: 'user',
                    content: prompt,
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
        return 4000;
    }
    if (category === 'asset_analysis') {
        return 3000;
    }
    return 1400;
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
export async function runPortfolioAnalysisRequest(request, options) {
    const prompt = buildPrompt(request);
    const provider = getModelProvider(request.analysisModel);
    const resolvedMaxTokens = options?.maxTokens ?? getDefaultAnalysisMaxTokens(request.category);
    const resolvedModel = request.analysisModel === 'claude-opus-4-6'
        ? getClaudeAnalyzeModel()
        : getGeminiAnalyzeModel(request.analysisModel);
    const raw = provider === 'anthropic'
        ? await analyzeWithClaude(prompt, resolvedModel, resolvedMaxTokens)
        : await analyzeWithGemini(prompt, resolvedModel, resolvedMaxTokens);
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
export async function analyzePortfolio(payload) {
    const request = normalizeAnalysisRequest(payload);
    return runPortfolioAnalysisRequest(request, { delivery: 'manual' });
}
