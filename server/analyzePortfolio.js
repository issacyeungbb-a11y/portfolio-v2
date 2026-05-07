import {
  CLAUDE_ANALYZE_MODEL,
  GEMINI_ANALYZE_MODEL,
  MODEL_REGISTRY,
  getSearchModelCandidates,
  isValidAnalysisModel,
  resolveModelProvider
} from "./analysisModels.js";
import { classifyIntent, intentNeedsExternalSearch } from "./analysisIntent.js";
import { convertToHKDValue, formatCurrencyRounded } from "../src/lib/currency.js";
const ANALYZE_ROUTE = "/api/analyze";
const EXTERNAL_EVIDENCE_CACHE = /* @__PURE__ */ new Map();
class AnalyzePortfolioError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "AnalyzePortfolioError";
    this.status = status;
  }
}
function getGeminiAnalyzeModel(requestedModel) {
  return requestedModel === "gemini-3.1-pro-preview" ? requestedModel : GEMINI_ANALYZE_MODEL;
}
function getClaudeAnalyzeModel() {
  const model = process.env.CLAUDE_ANALYZE_MODEL?.trim() || CLAUDE_ANALYZE_MODEL;
  return model === "claude-opus-4-7" ? model : CLAUDE_ANALYZE_MODEL;
}
function getGeminiApiKey() {
  const apiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
  if (!apiKey) {
    throw new AnalyzePortfolioError(
      "\u672A\u8A2D\u5B9A GEMINI_API_KEY \u6216 GOOGLE_API_KEY\uFF0C\u66AB\u6642\u7121\u6CD5\u5206\u6790\u6295\u8CC7\u7D44\u5408\u3002",
      500
    );
  }
  return apiKey;
}
function getAnthropicApiKey() {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new AnalyzePortfolioError(
      "\u672A\u8A2D\u5B9A ANTHROPIC_API_KEY\uFF0C\u66AB\u6642\u7121\u6CD5\u4F7F\u7528 Claude \u5206\u6790\u6295\u8CC7\u7D44\u5408\u3002",
      500
    );
  }
  return apiKey;
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
    const parsed = Number(value.replace(/,/g, "").trim());
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
  if (value === "asset_analysis" || value === "general_question" || value === "asset_report") {
    return value;
  }
  return null;
}
function sanitizeEnrichmentStatus(value) {
  if (value === "ok" || value === "partial" || value === "failed") {
    return value;
  }
  return null;
}
function sanitizeAssetType(value) {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "stock") return "stock";
  if (normalized === "etf") return "etf";
  if (normalized === "bond") return "bond";
  if (normalized === "crypto") return "crypto";
  if (normalized === "cash") return "cash";
  return null;
}
function sanitizeTransactionType(value) {
  if (value === "buy" || value === "sell") {
    return value;
  }
  return null;
}
function normalizeRecentTransactions(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const groups = value.map((item) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const entry = item;
    const assetId = sanitizeString(entry.assetId);
    const assetName = sanitizeString(entry.assetName);
    const ticker = sanitizeString(entry.ticker);
    const transactions = Array.isArray(entry.transactions) ? entry.transactions.map((tx) => {
      if (typeof tx !== "object" || tx === null) {
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
        price
      };
    }).filter(
      (entryTx) => entryTx !== null
    ) : [];
    if (!assetId || !assetName || !ticker || transactions.length === 0) {
      return null;
    }
    return {
      assetId,
      assetName,
      ticker,
      transactions
    };
  }).filter(
    (item) => item !== null
  );
  return groups.length > 0 ? groups : void 0;
}
function normalizePriceHistory(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const groups = value.map((item) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const entry = item;
    const assetId = sanitizeString(entry.assetId);
    const assetName = sanitizeString(entry.assetName);
    const ticker = sanitizeString(entry.ticker);
    const currency = sanitizeString(entry.currency);
    const currentPrice = sanitizeNumber(entry.currentPrice);
    const change30dPct = sanitizeNumber(entry.change30dPct);
    const points = Array.isArray(entry.points) ? entry.points.map((point) => {
      if (typeof point !== "object" || point === null) {
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
        price
      };
    }).filter(
      (point) => point !== null
    ) : [];
    if (!assetId || !assetName || !ticker || !currency || currentPrice == null || change30dPct == null || points.length === 0) {
      return null;
    }
    return {
      assetId,
      assetName,
      ticker,
      currency,
      currentPrice,
      change30dPct,
      points
    };
  }).filter(
    (item) => item !== null
  );
  return groups.length > 0 ? groups : void 0;
}
function normalizeRecentSnapshots(value) {
  if (!Array.isArray(value)) {
    return void 0;
  }
  const snapshots = value.map((item) => {
    if (typeof item !== "object" || item === null) {
      return null;
    }
    const entry = item;
    const date = sanitizeString(entry.date);
    const capturedAt = sanitizeString(entry.capturedAt) ?? void 0;
    const totalValueHKD = sanitizeNumber(entry.totalValueHKD);
    const netExternalFlowHKD = sanitizeNumber(entry.netExternalFlowHKD);
    const assetCount = sanitizeNumber(entry.assetCount);
    const holdings = Array.isArray(entry.holdings) ? entry.holdings.map((holding) => {
      if (typeof holding !== "object" || holding === null) {
        return null;
      }
      const valueHolding = holding;
      const assetId = sanitizeString(valueHolding.assetId);
      const ticker = sanitizeString(valueHolding.ticker);
      const assetName = sanitizeString(valueHolding.assetName);
      const currentPrice = sanitizeNumber(valueHolding.currentPrice);
      const marketValueHKD = sanitizeNumber(valueHolding.marketValueHKD);
      const quantity = sanitizeNumber(valueHolding.quantity);
      if (!assetId || !ticker || !assetName || currentPrice == null || marketValueHKD == null || quantity == null) {
        return null;
      }
      return {
        assetId,
        ticker,
        assetName,
        currentPrice,
        marketValueHKD,
        quantity
      };
    }).filter(
      (holding) => holding !== null
    ) : [];
    if (!date || totalValueHKD == null || netExternalFlowHKD == null || assetCount == null) {
      return null;
    }
    return {
      date,
      capturedAt,
      totalValueHKD,
      netExternalFlowHKD,
      assetCount,
      holdings
    };
  }).filter((item) => item !== null);
  return snapshots.length > 0 ? snapshots : void 0;
}
function normalizeAnalysisRequest(payload) {
  if (typeof payload !== "object" || payload === null) {
    throw new AnalyzePortfolioError("\u6295\u8CC7\u7D44\u5408\u5206\u6790\u8ACB\u6C42\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002", 400);
  }
  const value = payload;
  const cacheKey = sanitizeString(value.cacheKey);
  const snapshotHash = sanitizeString(value.snapshotHash);
  const category = sanitizeAnalysisCategory(value.category);
  const analysisModel = sanitizeAnalysisModel(value.analysisModel);
  const analysisQuestion = sanitizeString(value.analysisQuestion) ?? "";
  const analysisBackground = sanitizeString(value.analysisBackground) ?? "";
  const conversationContext = sanitizeString(value.conversationContext) ?? "";
  const enrichmentStatus = sanitizeEnrichmentStatus(value.enrichmentStatus) ?? "ok";
  const assetCount = sanitizeNumber(value.assetCount);
  const totalValueHKD = sanitizeNumber(value.totalValueHKD);
  const totalCostHKD = sanitizeNumber(value.totalCostHKD);
  if (!cacheKey) {
    throw new AnalyzePortfolioError("\u7F3A\u5C11\u5206\u6790\u5FEB\u53D6\u8B58\u5225\u78BC\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66\u3002", 400);
  }
  if (!snapshotHash) {
    throw new AnalyzePortfolioError("\u7F3A\u5C11\u6295\u8CC7\u7D44\u5408\u5FEB\u7167\u8B58\u5225\u78BC\uFF0C\u8ACB\u91CD\u65B0\u6574\u7406\u5F8C\u518D\u8A66\u3002", 400);
  }
  if (!analysisModel) {
    throw new AnalyzePortfolioError("\u5206\u6790\u6A21\u578B\u8A2D\u5B9A\u4E0D\u6B63\u78BA\uFF0C\u8ACB\u91CD\u65B0\u9078\u64C7\u5F8C\u518D\u8A66\u3002", 400);
  }
  if (!category) {
    throw new AnalyzePortfolioError("\u5206\u6790\u985E\u5225\u8A2D\u5B9A\u4E0D\u6B63\u78BA\uFF0C\u8ACB\u91CD\u65B0\u9078\u64C7\u5F8C\u518D\u8A66\u3002", 400);
  }
  if (!Array.isArray(value.holdings) || value.holdings.length === 0) {
    throw new AnalyzePortfolioError("\u76EE\u524D\u6C92\u6709\u53EF\u5206\u6790\u7684\u8CC7\u7522\u3002", 400);
  }
  const holdings = value.holdings.map((item) => {
    if (typeof item !== "object" || item === null) {
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
    if (!id || !name || !ticker || !assetType || !accountSource || !currency || quantity == null || averageCost == null || currentPrice == null || marketValue == null || costValue == null) {
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
      costValueHKD: resolvedCostValueHKD
    };
  }).filter((item) => item !== null);
  if (holdings.length === 0) {
    throw new AnalyzePortfolioError("\u76EE\u524D\u6C92\u6709\u5B8C\u6574\u7684\u8CC7\u7522\u8CC7\u6599\u53EF\u5206\u6790\u3002", 400);
  }
  const allocationsByType = Array.isArray(value.allocationsByType) ? value.allocationsByType.map((item) => {
    if (typeof item !== "object" || item === null) {
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
      totalValueHKD: bucketTotal
    };
  }).filter(
    (item) => item !== null
  ) : [];
  const allocationsByCurrency = Array.isArray(value.allocationsByCurrency) ? value.allocationsByCurrency.map((item) => {
    if (typeof item !== "object" || item === null) {
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
      totalValueHKD: bucketTotal
    };
  }).filter(
    (item) => item !== null
  ) : [];
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
    recentSnapshots
  };
}
function parseStructuredGeneralAnswer(raw) {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const candidate = jsonMatch ? jsonMatch[1] : raw;
  try {
    const parsed = JSON.parse(candidate.trim());
    const answer = sanitizeString(parsed.answer);
    if (!answer) throw new Error("missing answer");
    return {
      answer,
      usedPortfolioFacts: Array.isArray(parsed.usedPortfolioFacts) ? parsed.usedPortfolioFacts.filter((v) => typeof v === "string").slice(0, 10) : [],
      uncertainty: Array.isArray(parsed.uncertainty) ? parsed.uncertainty.filter((v) => typeof v === "string").slice(0, 5) : [],
      suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions.filter((v) => typeof v === "string").slice(0, 5) : []
    };
  } catch {
    const answer = raw.trim();
    if (!answer) throw new AnalyzePortfolioError("\u6A21\u578B\u672A\u6709\u56DE\u50B3\u5206\u6790\u5167\u5BB9\u3002", 502);
    return { answer, usedPortfolioFacts: [], uncertainty: [], suggestedActions: [] };
  }
}
function sanitizeAnalysisResult(rawPayload) {
  if (typeof rawPayload === "string") {
    const answer2 = rawPayload.trim();
    if (!answer2) {
      throw new AnalyzePortfolioError("\u6A21\u578B\u672A\u6709\u56DE\u50B3\u5206\u6790\u5167\u5BB9\u3002", 502);
    }
    return { answer: answer2 };
  }
  if (typeof rawPayload !== "object" || rawPayload === null) {
    throw new AnalyzePortfolioError("\u6A21\u578B\u56DE\u50B3\u683C\u5F0F\u4E0D\u6B63\u78BA\u3002", 502);
  }
  const value = rawPayload;
  const answer = sanitizeString(value.answer);
  if (!answer) {
    throw new AnalyzePortfolioError("\u6A21\u578B\u672A\u6709\u56DE\u50B3\u5206\u6790\u5167\u5BB9\u3002", 502);
  }
  return { answer };
}
function getCategoryPromptPrefix(category) {
  if (category === "general_question") {
    return `
Category: \u4E00\u822C\u554F\u984C
\u4F60\u662F\u5C08\u696D\u6295\u8CC7\u7814\u7A76\u8207\u6295\u8CC7\u7D44\u5408\u5206\u6790\u52A9\u624B\u3002\u4F60\u5FC5\u9808\u6839\u64DA\u4F7F\u7528\u8005\u76EE\u524D\u6301\u5009\u3001\u8CC7\u7522\u5206\u985E\u3001\u5E63\u5225\u3001\u6210\u672C\u3001\u5E02\u503C\u300130\u65E5\u50F9\u683C\u8D70\u52E2\u3001\u6700\u8FD1\u4EA4\u6613\u3001snapshots\uFF0C\u4EE5\u53CA\u7CFB\u7D71\u63D0\u4F9B\u7684\u5916\u90E8 evidence pack\uFF0C\u76F4\u63A5\u56DE\u7B54\u4F7F\u7528\u8005\u7576\u6B21\u6295\u8CC7\u554F\u984C\u3002

\u56DE\u7B54\u898F\u5247\uFF1A
1. \u5148\u7D66\u4E00\u53E5\u8A71\u7D50\u8AD6\u3002
2. \u518D\u6839\u64DA\u554F\u984C\u985E\u578B\u9078\u64C7\u5206\u6790\u67B6\u69CB\u3002
3. \u5982\u679C\u554F\u984C\u6D89\u53CA\u6301\u5009\uFF0C\u5FC5\u9808\u5F15\u7528\u5177\u9AD4\u6301\u5009\u3001\u5E63\u5225\u3001\u6210\u672C\u3001\u5E02\u503C\u3001\u96C6\u4E2D\u5EA6\u6216 30\u65E5\u8D70\u52E2\u3002
4. \u5982\u679C\u554F\u984C\u6D89\u53CA\u8CA1\u5831\uFF0C\u5FC5\u9808\u62C6\u89E3\u6536\u5165\u3001\u5229\u6F64\u3001\u73FE\u91D1\u6D41\u3001\u8CC7\u672C\u958B\u652F\u3001\u5206\u90E8\u696D\u52D9\u3001\u4E00\u6B21\u6027\u56E0\u7D20\u53CA\u5E02\u5834\u542B\u7FA9\u3002
5. \u5982\u679C\u554F\u984C\u6D89\u53CA\u5B8F\u89C0\uFF0C\u5FC5\u9808\u62C6\u89E3\u5229\u7387\u3001\u901A\u8139\u3001\u7F8E\u5143\u3001\u50B5\u606F\u3001\u653F\u7B56\u53CA\u5C0D\u4E0D\u540C\u8CC7\u7522\u985E\u5225\u7684\u5F71\u97FF\u3002
6. \u5982\u679C\u554F\u984C\u6D89\u53CA\u7B56\u7565\uFF0C\u5FC5\u9808\u7D66\u51FA\u5206\u6BB5\u64CD\u4F5C\u601D\u8DEF\uFF0C\u800C\u4E0D\u662F\u7D55\u5C0D\u8CB7\u8CE3\u6307\u4EE4\u3002
7. \u4E0D\u8981\u4FDD\u8B49\u56DE\u5831\uFF0C\u4E0D\u8981\u7528\u7A7A\u6CDB\u53E5\u5B50\u3002
8. \u4E0D\u8981\u53EA\u8AAA\u300C\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u5EFA\u8B70\u67E5\u95B1\u300D\uFF1B\u5982\u679C\u8CC7\u6599\u4E0D\u8DB3\uFF0C\u8981\u8AAA\u660E\u7F3A\u53E3\uFF0C\u4E26\u57FA\u65BC\u73FE\u6709\u8CC7\u6599\u4F5C\u51FA\u6709\u9650\u5EA6\u5206\u6790\u3002
9. \u6240\u6709\u7B54\u6848\u5FC5\u9808\u4F7F\u7528\u7E41\u9AD4\u4E2D\u6587\uFF0C\u8A9E\u6C23\u5C08\u696D\u3001\u76F4\u63A5\u3001\u6E05\u6670\u3002
    `.trim();
  }
  if (category === "asset_report") {
    return `
Category: \u8CC7\u7522\u5831\u544A
- \u5C07\u56DE\u7B54\u5BEB\u6210\u53EF\u95B1\u8B80\u7684\u8CC7\u7522\u5831\u544A\u3002
- \u512A\u5148\u6574\u7406\uFF1A\u6574\u9AD4\u6982\u89BD\u3001\u91CD\u9EDE\u6301\u5009\u3001\u4E3B\u8981\u98A8\u96AA\u3001\u503C\u5F97\u8DDF\u9032\u9805\u76EE\u3002
- \u8A9E\u6C23\u4FDD\u6301\u5C08\u696D\u3001\u6E05\u6670\u3001\u53EF\u56DE\u9867\u3002
- \u7528\u6A19\u984C\u5206\u6BB5\uFF0C\u6BCF\u6BB5\u4E0D\u8D85\u904E 150 \u5B57\uFF0C\u65B9\u4FBF\u65E5\u5F8C\u7FFB\u67E5\u3002
    `.trim();
  }
  return `
Category: \u5206\u6790\u8CC7\u7522
- \u805A\u7126\u8A3A\u65B7\u76EE\u524D\u6295\u8CC7\u7D44\u5408\u3002
- \u5148\u6307\u51FA\u6700\u503C\u5F97\u7559\u610F\u7684\u6301\u5009\u3001\u96C6\u4E2D\u5EA6\u3001\u98A8\u96AA\u8207\u914D\u7F6E\u554F\u984C\u3002
- \u82E5\u4F7F\u7528\u8005\u8981\u6C42\u5EFA\u8B70\uFF0C\u63D0\u4F9B\u5177\u9AD4\u800C\u514B\u5236\u7684\u4E0B\u4E00\u6B65\u65B9\u5411\u3002
  `.trim();
}
function getAnalysisRules() {
  return `
- Write all output in Traditional Chinese.
- Base your reasoning only on the provided holdings, latest prices, asset categories, currencies, and average costs.
- Do not invent historical returns, dividends, macro news, or external facts that are not present in the input.
- If the data lacks price history or cash-flow history, mention that limitation briefly where relevant.
- If structured comparison, trend, or market summary data is included in the user prompt, treat it as provided evidence and \u5F15\u7528\u5176\u4E2D\u6578\u5B57\u3002
- If a latest external search summary is included, treat it as current evidence for recent news, company updates, macro context, or other time-sensitive facts.
- If structured external evidence or an earnings evidence pack is included, cite only those facts and figures; do not invent missing earnings numbers.
- If external search is unavailable or not performed, say so briefly and fall back to the portfolio data already provided.
- Keep the tone practical, calm, and beginner-friendly.
- Prioritize the user's analysis instruction when deciding what to emphasize, but do not invent any external facts or unsupported claims.
- Answer the user's instruction directly. Do not force your response into sections unless the user's question naturally calls for it.
  `.trim();
}
function getIntentPromptRules(intent) {
  if (intent === "portfolio_only") {
    return `
Intent: portfolio_only
- \u77ED\u7B54\uFF0C\u4E0D\u8D85\u904E 400 \u5B57\u3002
- \u4E0D\u4F7F\u7528\u5916\u90E8\u8CC7\u6599\uFF1B\u53EA\u6839\u64DA\u6301\u5009\u3001\u6210\u672C\u3001\u5E02\u503C\u3001\u6BD4\u4F8B\u300130\u65E5\u8D70\u52E2\u3001\u4EA4\u6613\u8207 snapshots \u56DE\u7B54\u3002
    `.trim();
  }
  if (intent === "earnings_analysis") {
    return `
Intent: earnings_analysis
- \u76EE\u6A19 1200 \u81F3 2500 \u5B57\uFF0C\u5FC5\u9808\u6709\u8868\u683C\uFF0C\u5FC5\u9808\u6709\u6295\u8CC7\u542B\u7FA9\u3002
- \u56DE\u7B54\u5FC5\u9808\u4F7F\u7528\u4EE5\u4E0B\u7D50\u69CB\uFF1A
1. \u4E00\u53E5\u8A71\u7D50\u8AD6\uFF1A\u76F4\u63A5\u5224\u65B7\u8CA1\u5831\u5C6C\u65BC\u5F37\u3001\u666E\u901A\u3001\u504F\u5F31\uFF0C\u9084\u662F\u8868\u9762\u5F37\u4F46\u8CEA\u7D20\u9700\u6253\u6298\u3002
2. \u6838\u5FC3\u6578\u5B57\u8868\uFF1A\u6536\u5165\u3001\u6536\u5165\u589E\u9577\u3001\u7D93\u71DF\u5229\u6F64\u3001\u7D93\u71DF\u5229\u6F64\u7387\u3001\u6DE8\u5229\u6F64\u3001EPS\u3001\u71DF\u904B\u73FE\u91D1\u6D41\u3001\u81EA\u7531\u73FE\u91D1\u6D41\u3001\u8CC7\u672C\u958B\u652F\u3001\u4E3B\u8981\u696D\u52D9\u5206\u90E8\u3002
3. \u6536\u5165\u8CEA\u7D20\uFF1A\u6838\u5FC3\u696D\u52D9\u3001\u4E00\u6B21\u6027\u9805\u76EE\u3001\u6700\u91CD\u8981\u5206\u90E8\u3002
4. \u5229\u6F64\u8CEA\u7D20\uFF1A\u7D93\u71DF\u5229\u6F64\u3001\u6DE8\u5229\u6F64\u4E00\u6B21\u6027\u56E0\u7D20\u3001\u4E0D\u8981\u53EA\u770B EPS\u3002
5. \u73FE\u91D1\u6D41\u8207\u8CC7\u672C\u958B\u652F\uFF1A\u71DF\u904B\u73FE\u91D1\u6D41\u3001\u81EA\u7531\u73FE\u91D1\u6D41\u3001capex\u3001AI\uFF0F\u6578\u64DA\u4E2D\u5FC3\u6295\u8CC7\u3002
6. \u696D\u52D9\u5206\u90E8\u5206\u6790\uFF1A\u6210\u719F\u73FE\u91D1\u725B\u8207\u7B2C\u4E8C\u589E\u9577\u66F2\u7DDA\u3002
7. \u5E02\u5834\u53CD\u61C9\uFF1A\u80A1\u50F9\u5347\u8DCC\u539F\u56E0\u3001\u5E02\u5834\u7126\u9EDE\u3001\u4F30\u503C\u662F\u5426\u5DF2\u53CD\u6620\u3002
8. \u5C0D\u4F7F\u7528\u8005\u6301\u5009\u7684\u542B\u7FA9\uFF1A\u5982\u6301\u6709\u76F8\u95DC\u80A1\u7968\uFF0C\u5F15\u7528\u5E02\u503C\u3001\u4F54\u6BD4\u300130\u65E5\u5347\u8DCC\u6216\u6210\u672C\uFF0C\u63D0\u4F9B\u89C0\u5BDF\u3001\u5206\u6BB5\u52A0\u5009\u3001\u6B62\u76C8\u3001\u98A8\u96AA\u63A7\u5236\u6216\u89C0\u671B\u6846\u67B6\u3002
9. \u9700\u8981\u76E3\u5BDF\u7684\u6307\u6A19\uFF1A\u5217\u51FA 3 \u81F3 5 \u500B\u5177\u9AD4\u6307\u6A19\u3002
10. \u7E3D\u7D50\uFF1A\u9577\u7DDA\u6295\u8CC7\u50F9\u503C\u3001\u6700\u5927\u98A8\u96AA\u3001\u5224\u65B7\u6539\u8B8A\u689D\u4EF6\u3002
    `.trim();
  }
  if (intent === "macro_analysis") {
    return `
Intent: macro_analysis
- \u76EE\u6A19 800 \u81F3 1800 \u5B57\u3002
- \u62C6\u89E3\u5229\u7387\u3001\u901A\u8139\u3001\u7F8E\u5143\u3001\u50B5\u606F\u3001\u653F\u7B56\uFF0C\u4E26\u7D50\u5408\u4F7F\u7528\u8005\u6301\u5009\u914D\u7F6E\u5206\u6790\u80A1\u7968\u3001ETF\u3001\u50B5\u5238\u3001\u73FE\u91D1\u3001\u52A0\u5BC6\u8CA8\u5E63\u7684\u4E0D\u540C\u5F71\u97FF\u3002
    `.trim();
  }
  if (intent === "strategy_analysis") {
    return `
Intent: strategy_analysis
- \u76EE\u6A19 800 \u81F3 1800 \u5B57\uFF0C\u5FC5\u9808\u6709\u98A8\u96AA\u63A7\u5236\u3002
- \u7528\u5206\u6BB5\u64CD\u4F5C\u601D\u8DEF\u3001\u89C0\u5BDF\u689D\u4EF6\u8207\u518D\u5E73\u8861\u6846\u67B6\uFF0C\u4E0D\u7D66\u7D55\u5C0D\u8CB7\u8CE3\u6307\u4EE4\u3002
    `.trim();
  }
  if (intent === "company_research" || intent === "market_research" || intent === "deep_analysis") {
    return `
Intent: company_research
- \u76EE\u6A19 800 \u81F3 1800 \u5B57\u3002
- \u5206\u6790\u5546\u696D\u6A21\u5F0F\u3001\u7AF6\u722D\u529B\u3001\u4F30\u503C\u542B\u7FA9\u3001\u7522\u54C1\uFF0F\u884C\u696D\u5730\u4F4D\u3001\u7BA1\u7406\u5C64\u8A0A\u865F\u8207\u5C0D\u4F7F\u7528\u8005\u6301\u5009\u7684\u5F71\u97FF\u3002
    `.trim();
  }
  return "";
}
function formatMoney(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
function formatHoldingValuePair(localValue, currency, hkdValue) {
  return `${formatCurrencyRounded(localValue, currency)} / \u7D04 ${formatCurrencyRounded(hkdValue, "HKD")}`;
}
function formatHoldingsSection(request) {
  const sorted = [...request.holdings].sort((a, b) => b.marketValueHKD - a.marketValueHKD);
  const top10 = sorted.slice(0, 10);
  const rest = sorted.slice(10);
  const topLines = top10.map(
    (holding, index) => `${index + 1}. ${holding.ticker}\uFF5C${holding.name}\uFF5C${holding.assetType}\uFF5Cqty ${formatMoney(holding.quantity)}\uFF5C\u50F9 ${formatMoney(holding.currentPrice)} ${holding.currency}\uFF5C\u5E02\u503C ${formatHoldingValuePair(holding.marketValue, holding.currency, holding.marketValueHKD)}\uFF5C\u6210\u672C ${formatHoldingValuePair(holding.costValue, holding.currency, holding.costValueHKD)}`
  );
  const restLines = rest.length > 0 ? [
    `\u5176\u4ED6 ${rest.length} \u9805\uFF08\u7E3D\u5E02\u503C \u7D04 ${formatCurrencyRounded(
      rest.reduce((sum, holding) => sum + holding.marketValueHKD, 0),
      "HKD"
    )}\uFF09\uFF1A` + rest.map((h) => `${h.ticker}(${h.assetType})`).join("\u3001")
  ] : [];
  return ["\u3010\u6301\u5009\u6982\u89BD\u3011", ...topLines, ...restLines].join("\n");
}
function formatRecentTransactionsSection(request) {
  if (!request.recentTransactions || request.recentTransactions.length === 0) {
    return "\u3010\u6700\u8FD1\u4EA4\u6613\uFF08\u904E\u53BB 30 \u65E5\uFF09\u3011\n\u672A\u6709\u53EF\u7528\u4EA4\u6613\u8A18\u9304\u3002";
  }
  const lines = request.recentTransactions.slice().sort((left, right) => left.ticker.localeCompare(right.ticker)).map(
    (group) => `- ${group.ticker} ${group.assetName}\uFF1A` + group.transactions.map((tx) => `${tx.date} ${tx.type} ${formatMoney(tx.quantity)} @ ${formatMoney(tx.price)}`).join("\uFF1B ")
  );
  return ["\u3010\u6700\u8FD1\u4EA4\u6613\uFF08\u904E\u53BB 30 \u65E5\uFF09\u3011", ...lines].join("\n");
}
function formatPriceHistorySection(request) {
  if (!request.priceHistory || request.priceHistory.length === 0) {
    return "\u3010\u50F9\u683C\u8D70\u52E2\u6458\u8981\u3011\n\u672A\u6709\u53EF\u7528\u50F9\u683C\u6B77\u53F2\u3002";
  }
  const lines = request.priceHistory.slice().sort((left, right) => right.change30dPct - left.change30dPct).map((group) => {
    const pricePoints = group.points.map((point) => `${point.date} ${formatMoney(point.price)}`).join("\uFF1B ");
    return `- ${group.ticker} ${group.assetName}\uFF1A30\u65E5 ${group.change30dPct.toFixed(1)}%\uFF08${pricePoints}\uFF09`;
  });
  return ["\u3010\u50F9\u683C\u8D70\u52E2\u6458\u8981\uFF08\u53EA\u5217 top 10 \u5E02\u503C\u6301\u5009\uFF09\u3011", ...lines].join("\n");
}
function formatRecentSnapshotsSection(request) {
  if (!request.recentSnapshots || request.recentSnapshots.length === 0) {
    return "\u3010\u6700\u8FD1 2 \u500B snapshot\u3011\n\u672A\u6709\u53EF\u7528 snapshot\u3002";
  }
  const lines = request.recentSnapshots.slice().sort((left, right) => left.date.localeCompare(right.date)).map((snapshot) => {
    const holdings = snapshot.holdings.map((holding) => `${holding.ticker} ${formatCurrencyRounded(holding.marketValueHKD, "HKD")}`).join("\uFF1B ");
    return `- ${snapshot.date}\uFF5C\u7E3D\u503C ${formatMoney(snapshot.totalValueHKD)} HKD\uFF5C\u6DE8\u6D41\u5165 ${formatMoney(snapshot.netExternalFlowHKD)} HKD\uFF5C\u6301\u5009 ${holdings}`;
  });
  return ["\u3010\u6700\u8FD1 2 \u500B snapshot\u3011", ...lines].join("\n");
}
function buildRichContextSection(request) {
  return [
    formatHoldingsSection(request),
    formatRecentTransactionsSection(request),
    formatPriceHistorySection(request),
    formatRecentSnapshotsSection(request)
  ].join("\n\n");
}
function truncateConversationContext(context, maxChars = 1500) {
  if (!context || context.length <= maxChars) return context;
  const truncated = context.slice(-maxChars);
  const turnBoundary = truncated.indexOf("\u7B2C ");
  return turnBoundary > 0 ? `[\u65E9\u671F\u5C0D\u8A71\u5DF2\u58D3\u7E2E]
${truncated.slice(turnBoundary)}` : `[\u65E9\u671F\u5C0D\u8A71\u5DF2\u58D3\u7E2E]
${truncated}`;
}
function buildAnalysisSystemPrompt(request, options) {
  const isGeneralQuestion = options?.isGeneralQuestion ?? request.category === "general_question";
  const jsonInstruction = isGeneralQuestion ? `
Output format: You MUST respond with a valid JSON object (no markdown fences) with exactly these fields:
{
  "answer": "main answer in Traditional Chinese",
  "usedPortfolioFacts": ["fact from portfolio data used in answer", ...],
  "uncertainty": ["uncertainty or data gap", ...],
  "suggestedActions": ["concrete follow-up action", ...]
}
Keep usedPortfolioFacts, uncertainty, suggestedActions as short, 1-line strings. Max 8 items each.
    `.trim() : "Return ONLY the final answer text in Traditional Chinese. Do not use markdown code fences.";
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
function buildAnalysisUserPrompt(request, externalSearchSummary = "", externalEvidence) {
  const richContextSection = request.holdings.length > 0 ? buildRichContextSection(request) : "";
  const externalSearchSection = request.category === "general_question" && externalSearchSummary.trim() ? `
Latest external information summary (retrieved from Google Search):
${externalSearchSummary.trim()}
      `.trim() : "";
  const externalEvidenceSection = request.category === "general_question" && externalEvidence && externalEvidence.sources.length > 0 ? `
Structured external evidence pack:
${JSON.stringify(
    {
      status: externalEvidence.status,
      retrievedAt: externalEvidence.retrievedAt,
      sources: externalEvidence.sources,
      earningsEvidencePack: externalEvidence.earningsEvidencePack
    },
    null,
    2
  )}
      `.trim() : "";
  const conversationContext = truncateConversationContext(request.conversationContext || "");
  return `
Saved category background:
${request.analysisBackground || "\u672A\u8A2D\u5B9A\u984D\u5916\u80CC\u666F\u3002"}

Conversation context:
${conversationContext || "\u76EE\u524D\u672A\u6709\u524D\u6587\u5C0D\u8A71\u3002"}

${externalSearchSection ? `${externalSearchSection}

` : ""}
${externalEvidenceSection ? `${externalEvidenceSection}

` : ""}
User question / task:
${request.analysisQuestion || "\u8ACB\u6839\u64DA\u76EE\u524D\u6295\u8CC7\u7D44\u5408\u505A\u4E00\u822C\u5206\u6790\u3002"}

Portfolio snapshot summary:
${request.holdings.slice().sort((left, right) => right.marketValueHKD - left.marketValueHKD).map(
    (holding) => `- ${holding.ticker}\uFF5C${holding.name}\uFF5C${holding.assetType}\uFF5Cqty ${formatMoney(holding.quantity)}\uFF5C\u50F9 ${formatMoney(holding.currentPrice)} ${holding.currency}\uFF5C\u5E02\u503C ${formatHoldingValuePair(holding.marketValue, holding.currency, holding.marketValueHKD)}\uFF5C\u6210\u672C ${formatHoldingValuePair(holding.costValue, holding.currency, holding.costValueHKD)}`
  ).join("\n")}

${richContextSection ? `${richContextSection}
` : ""}
  `.trim();
}
function buildPrompt(request, externalSearchSummary = "") {
  return `${buildAnalysisSystemPrompt(request)}

${buildAnalysisUserPrompt(request, externalSearchSummary)}`;
}
function getExternalSourceLimit(intent) {
  if (intent === "earnings_analysis") return 6;
  if (intent === "macro_analysis") return 5;
  return 4;
}
function getExternalEvidenceCacheTtlMs(intent) {
  if (intent === "macro_analysis") return 6 * 60 * 60 * 1e3;
  if (intent === "earnings_analysis") return 24 * 60 * 60 * 1e3;
  return 6 * 60 * 60 * 1e3;
}
function extractMentionedTickers(request) {
  const question = request.analysisQuestion || "";
  const mentioned = request.holdings.filter((holding) => {
    const ticker = holding.ticker.trim();
    if (!ticker) return false;
    return new RegExp(`(^|[^A-Z0-9.])${ticker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Z0-9.]|$)`, "i").test(question);
  }).map((holding) => holding.ticker);
  if (mentioned.length > 0) return [...new Set(mentioned)];
  const companyAliases = [
    [/google|alphabet/i, "GOOG"],
    [/apple/i, "AAPL"],
    [/nvidia/i, "NVDA"],
    [/tesla/i, "TSLA"],
    [/microsoft/i, "MSFT"],
    [/amazon/i, "AMZN"],
    [/meta/i, "META"]
  ];
  const inferred = companyAliases.filter(([pattern]) => pattern.test(question)).map(([, ticker]) => ticker).filter((ticker) => request.holdings.some((holding) => holding.ticker.toUpperCase() === ticker));
  return inferred.length > 0 ? [...new Set(inferred)] : [];
}
function getDominantTopic(request, intent) {
  const tickers = extractMentionedTickers(request);
  if (tickers.length > 0) return tickers.join(",");
  if (intent === "macro_analysis") {
    const question = (request.analysisQuestion || "").toLowerCase();
    if (/減息|利率|聯儲局|fed|fomc/.test(question)) return "rates";
    if (/通脹|cpi/.test(question)) return "inflation";
    if (/美元|dxy/.test(question)) return "usd";
    return question.slice(0, 80) || "macro";
  }
  return (request.analysisQuestion || "").toLowerCase().slice(0, 80) || intent;
}
function buildExternalEvidenceCacheKey(request, intent) {
  return [intent, getDominantTopic(request, intent)].join(":").toLowerCase();
}
function clearExternalEvidenceCacheForTest() {
  EXTERNAL_EVIDENCE_CACHE.clear();
}
function seedExternalEvidenceCacheForTest(request, intent, value, ttlMs = 60 * 60 * 1e3) {
  EXTERNAL_EVIDENCE_CACHE.set(buildExternalEvidenceCacheKey(request, intent), {
    expiresAt: Date.now() + ttlMs,
    value
  });
}
function shouldReuseConversationEvidence(request) {
  const question = request.analysisQuestion || "";
  return Boolean(request.conversationContext?.trim()) && !/最新|今日|昨天|尋日|剛剛|current|latest|recent/i.test(question);
}
function sanitizeStringArray(value, maxItems = 8) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, maxItems) : [];
}
function sanitizeEvidenceSourceType(value) {
  if (value === "official_report" || value === "sec_filing" || value === "earnings_call" || value === "news" || value === "macro_data" || value === "company_ir" || value === "market_data" || value === "other") {
    return value;
  }
  return "other";
}
function normalizeExternalEvidenceSource(value, retrievedAt) {
  if (typeof value !== "object" || value === null) return null;
  const record = value;
  const sourceUrl = sanitizeString(record.sourceUrl) || sanitizeString(record.url);
  const sourceTitle = sanitizeString(record.sourceTitle) || sanitizeString(record.title) || sourceUrl;
  if (!sourceTitle || !sourceUrl) return null;
  return {
    sourceTitle,
    sourceUrl,
    publishedDate: sanitizeString(record.publishedDate) ?? void 0,
    retrievedAt: sanitizeString(record.retrievedAt) ?? retrievedAt,
    sourceType: sanitizeEvidenceSourceType(record.sourceType),
    keyFacts: sanitizeStringArray(record.keyFacts, 6),
    keyFigures: sanitizeStringArray(record.keyFigures, 8),
    uncertainty: sanitizeStringArray(record.uncertainty, 5)
  };
}
function evidenceSourcesToLegacySources(sources, query, relatedTickers) {
  return sources.map((source) => ({
    title: source.sourceTitle,
    url: source.sourceUrl,
    publisher: void 0,
    publishedAt: source.publishedDate,
    retrievedAt: source.retrievedAt,
    snippet: [...source.keyFigures, ...source.keyFacts].slice(0, 3).join("\uFF1B "),
    query,
    relatedTickers
  }));
}
function getStringOrNull(record, key) {
  return sanitizeString(record[key]) ?? null;
}
function normalizeEarningsEvidencePack(value, externalSources) {
  if (typeof value !== "object" || value === null) return void 0;
  const record = value;
  const sources = Array.isArray(record.sources) && record.sources.length > 0 ? record.sources.map((source) => normalizeExternalEvidenceSource(source, (/* @__PURE__ */ new Date()).toISOString())).filter((source) => source !== null) : externalSources;
  return {
    companyName: getStringOrNull(record, "companyName"),
    ticker: getStringOrNull(record, "ticker"),
    reportingPeriod: getStringOrNull(record, "reportingPeriod"),
    reportDate: getStringOrNull(record, "reportDate"),
    revenue: getStringOrNull(record, "revenue"),
    revenueGrowth: getStringOrNull(record, "revenueGrowth"),
    operatingIncome: getStringOrNull(record, "operatingIncome"),
    operatingMargin: getStringOrNull(record, "operatingMargin"),
    netIncome: getStringOrNull(record, "netIncome"),
    EPS: getStringOrNull(record, "EPS"),
    operatingCashFlow: getStringOrNull(record, "operatingCashFlow"),
    freeCashFlow: getStringOrNull(record, "freeCashFlow"),
    capitalExpenditure: getStringOrNull(record, "capitalExpenditure"),
    segmentRevenue: sanitizeStringArray(record.segmentRevenue, 8),
    segmentOperatingIncome: sanitizeStringArray(record.segmentOperatingIncome, 8),
    managementCommentary: sanitizeStringArray(record.managementCommentary, 8),
    marketReaction: sanitizeStringArray(record.marketReaction, 6),
    oneOffItems: sanitizeStringArray(record.oneOffItems, 6),
    mainRisks: sanitizeStringArray(record.mainRisks, 6),
    sources,
    uncertainty: sanitizeStringArray(record.uncertainty, 8)
  };
}
function getEarningsSourcePriority(sourceType) {
  switch (sourceType) {
    case "official_report":
      return 0;
    case "sec_filing":
      return 1;
    case "company_ir":
      return 2;
    case "earnings_call":
      return 3;
    case "news":
      return 4;
    default:
      return 5;
  }
}
function sortEarningsSourcesByPriority(sources) {
  return [...sources].sort(
    (left, right) => getEarningsSourcePriority(left.sourceType) - getEarningsSourcePriority(right.sourceType)
  );
}
function getPreferredEarningsSources(sources) {
  const sorted = sortEarningsSourcesByPriority(sources);
  const official = sorted.filter(
    (source) => ["official_report", "sec_filing", "company_ir", "earnings_call"].includes(source.sourceType)
  );
  return official.length > 0 ? official : sorted;
}
function findEarningsFigure(sources, patterns) {
  return getPreferredEarningsSources(sources).flatMap((source) => source.keyFigures).find((figure) => patterns.some((pattern) => pattern.test(figure))) ?? null;
}
function findEarningsFacts(sources, patterns, maxItems = 8) {
  return getPreferredEarningsSources(sources).flatMap((source) => source.keyFacts).filter((fact) => patterns.some((pattern) => pattern.test(fact))).slice(0, maxItems);
}
function addMissingEarningsFieldUncertainty(uncertainty, fieldName, value, label) {
  const isMissing = Array.isArray(value) ? value.length === 0 : !value;
  if (isMissing) {
    uncertainty.push(`\u672A\u80FD\u5F9E\u5DF2\u53D6\u5F97\u8CC7\u6599\u78BA\u8A8D ${label}\uFF08${String(fieldName)}\uFF09\u3002`);
  }
}
function completeEarningsEvidencePack(basePack, externalSources) {
  const sortedSources = sortEarningsSourcesByPriority(
    basePack.sources.length > 0 ? basePack.sources : externalSources
  );
  const uncertainty = [...basePack.uncertainty, ...sortedSources.flatMap((source) => source.uncertainty)];
  const pick = (current, patterns) => current ?? findEarningsFigure(sortedSources, patterns);
  const segmentRevenue = basePack.segmentRevenue.length > 0 ? basePack.segmentRevenue : getPreferredEarningsSources(sortedSources).flatMap((source) => source.keyFigures).filter((figure) => /cloud|advertising|youtube|search|segment|分部|廣告|搜尋/i.test(figure)).slice(0, 8);
  const segmentOperatingIncome = basePack.segmentOperatingIncome.length > 0 ? basePack.segmentOperatingIncome : getPreferredEarningsSources(sortedSources).flatMap((source) => source.keyFigures).filter((figure) => /segment.*operating|operating.*segment|分部.*利潤|cloud.*income|operating income.*cloud/i.test(figure)).slice(0, 8);
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
    managementCommentary: basePack.managementCommentary.length > 0 ? basePack.managementCommentary : findEarningsFacts(sortedSources, [/management|CEO|CFO|管理層|指引|guidance|comment/i], 8),
    marketReaction: basePack.marketReaction.length > 0 ? basePack.marketReaction : findEarningsFacts(sortedSources, [/stock|share|market|股價|市場|reaction/i], 6),
    oneOffItems: basePack.oneOffItems.length > 0 ? basePack.oneOffItems : findEarningsFacts(sortedSources, [/one-off|一次性|non-recurring|restructuring|impairment|減值|會計/i], 6),
    mainRisks: basePack.mainRisks.length > 0 ? basePack.mainRisks : sortedSources.flatMap((source) => source.uncertainty).slice(0, 6),
    sources: sortedSources,
    uncertainty
  };
  addMissingEarningsFieldUncertainty(uncertainty, "companyName", completed.companyName, "\u516C\u53F8\u540D\u7A31");
  addMissingEarningsFieldUncertainty(uncertainty, "ticker", completed.ticker, "ticker");
  addMissingEarningsFieldUncertainty(uncertainty, "reportingPeriod", completed.reportingPeriod, "\u5831\u544A\u671F");
  addMissingEarningsFieldUncertainty(uncertainty, "reportDate", completed.reportDate, "\u8CA1\u5831\u65E5\u671F");
  addMissingEarningsFieldUncertainty(uncertainty, "revenue", completed.revenue, "\u6536\u5165");
  addMissingEarningsFieldUncertainty(uncertainty, "revenueGrowth", completed.revenueGrowth, "\u6536\u5165\u589E\u9577");
  addMissingEarningsFieldUncertainty(uncertainty, "operatingIncome", completed.operatingIncome, "\u7D93\u71DF\u5229\u6F64");
  addMissingEarningsFieldUncertainty(uncertainty, "operatingMargin", completed.operatingMargin, "\u7D93\u71DF\u5229\u6F64\u7387");
  addMissingEarningsFieldUncertainty(uncertainty, "netIncome", completed.netIncome, "\u6DE8\u5229\u6F64");
  addMissingEarningsFieldUncertainty(uncertainty, "EPS", completed.EPS, "EPS");
  addMissingEarningsFieldUncertainty(uncertainty, "operatingCashFlow", completed.operatingCashFlow, "\u71DF\u904B\u73FE\u91D1\u6D41");
  addMissingEarningsFieldUncertainty(uncertainty, "freeCashFlow", completed.freeCashFlow, "\u81EA\u7531\u73FE\u91D1\u6D41");
  addMissingEarningsFieldUncertainty(uncertainty, "capitalExpenditure", completed.capitalExpenditure, "\u8CC7\u672C\u958B\u652F");
  addMissingEarningsFieldUncertainty(uncertainty, "segmentRevenue", completed.segmentRevenue, "\u5206\u90E8\u6536\u5165");
  addMissingEarningsFieldUncertainty(uncertainty, "segmentOperatingIncome", completed.segmentOperatingIncome, "\u5206\u90E8\u7D93\u71DF\u5229\u6F64");
  addMissingEarningsFieldUncertainty(uncertainty, "oneOffItems", completed.oneOffItems, "\u4E00\u6B21\u6027\u56E0\u7D20");
  completed.uncertainty = [...new Set(uncertainty)].slice(0, 16);
  return completed;
}
function mergeEarningsEvidencePacks(parsedPack, deterministicPack) {
  if (!parsedPack) return deterministicPack;
  return completeEarningsEvidencePack(
    {
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
      segmentOperatingIncome: parsedPack.segmentOperatingIncome.length > 0 ? parsedPack.segmentOperatingIncome : deterministicPack.segmentOperatingIncome,
      managementCommentary: parsedPack.managementCommentary.length > 0 ? parsedPack.managementCommentary : deterministicPack.managementCommentary,
      marketReaction: parsedPack.marketReaction.length > 0 ? parsedPack.marketReaction : deterministicPack.marketReaction,
      oneOffItems: parsedPack.oneOffItems.length > 0 ? parsedPack.oneOffItems : deterministicPack.oneOffItems,
      mainRisks: parsedPack.mainRisks.length > 0 ? parsedPack.mainRisks : deterministicPack.mainRisks,
      sources: parsedPack.sources.length > 0 ? parsedPack.sources : deterministicPack.sources,
      uncertainty: [...deterministicPack.uncertainty, ...parsedPack.uncertainty]
    },
    parsedPack.sources.length > 0 ? parsedPack.sources : deterministicPack.sources
  );
}
function ensureEarningsEvidencePack(searchResult, request, buildPack) {
  const deterministicPack = buildPack(
    request.analysisQuestion || "",
    searchResult.externalEvidence,
    request
  );
  return {
    ...searchResult,
    earningsEvidencePack: mergeEarningsEvidencePacks(searchResult.earningsEvidencePack, deterministicPack)
  };
}
function buildEarningsEvidencePack(question, externalSources, portfolioSnapshot) {
  const tickers = extractMentionedTickers({ ...portfolioSnapshot, analysisQuestion: question });
  const ticker = tickers[0] ?? null;
  const holding = ticker ? portfolioSnapshot.holdings.find((item) => item.ticker.toUpperCase() === ticker.toUpperCase()) : void 0;
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
        findFigure([/operating cash flow|營運現金流/i]) ? null : "\u672A\u80FD\u5F9E\u5DF2\u53D6\u5F97\u8CC7\u6599\u78BA\u8A8D\u71DF\u904B\u73FE\u91D1\u6D41\u3002",
        findFigure([/free cash flow|自由現金流|FCF/i]) ? null : "\u672A\u80FD\u5F9E\u5DF2\u53D6\u5F97\u8CC7\u6599\u78BA\u8A8D\u81EA\u7531\u73FE\u91D1\u6D41\u3002",
        findFigure([/capex|capital expenditure|資本開支/i]) ? null : "\u672A\u80FD\u5F9E\u5DF2\u53D6\u5F97\u8CC7\u6599\u78BA\u8A8D\u8CC7\u672C\u958B\u652F\u3002"
      ].filter((item) => Boolean(item))
    ].slice(0, 10)
  }, sortedSources);
}
function extractGroundingSources(response, query, relatedTickers, retrievedAt) {
  try {
    const candidates = response?.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return [];
    const meta = candidates[0]?.groundingMetadata;
    if (!meta) return [];
    const chunks = meta.groundingChunks;
    if (!Array.isArray(chunks)) return [];
    return chunks.slice(0, 10).map((chunk) => {
      const web = chunk?.web;
      if (!web) return null;
      const url = typeof web.uri === "string" ? web.uri : "";
      const title = typeof web.title === "string" ? web.title : url;
      if (!url) return null;
      return {
        title,
        url,
        retrievedAt,
        snippet: "",
        query,
        relatedTickers
      };
    }).filter((s) => s !== null);
  } catch {
    return [];
  }
}
function getGeminiResponseText(response) {
  if (typeof response?.text === "string") {
    return response.text.trim();
  }
  const candidates = response?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "";
  const content = candidates[0]?.content;
  const parts = content?.parts;
  if (!Array.isArray(parts)) return "";
  return parts.map((part) => {
    if (typeof part !== "object" || part === null) return "";
    const text = part.text;
    return typeof text === "string" ? text : "";
  }).join("\n").trim();
}
async function generateGeminiContentViaRest(args) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    args.model
  )}:generateContent?key=${encodeURIComponent(args.apiKey)}`;
  const generationConfig = {};
  if (typeof args.maxOutputTokens === "number") {
    generationConfig.maxOutputTokens = args.maxOutputTokens;
  }
  if (args.jsonMode) {
    generationConfig.responseMimeType = "application/json";
  }
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: args.prompt }] }],
      ...Object.keys(generationConfig).length > 0 ? { generationConfig } : {},
      ...args.googleSearch ? { tools: [{ googleSearch: {} }] } : {}
    }),
    signal: AbortSignal.timeout(args.googleSearch ? 45e3 : 6e4)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error?.message === "string" ? payload.error.message : `Gemini REST request failed with status ${response.status}`;
    throw new AnalyzePortfolioError(message, response.status);
  }
  return payload;
}
function buildGeneralQuestionSearchPrompt(request, intent) {
  const searchTargets = [...request.holdings].filter((holding) => holding.assetType !== "cash").sort((left, right) => right.marketValueHKD - left.marketValueHKD).slice(0, 10);
  const tickers = searchTargets.map((holding) => `${holding.ticker} (${holding.name})`).join("\u3001") || "\u76EE\u524D\u7121\u4E3B\u8981\u6301\u5009";
  const question = request.analysisQuestion.trim() || "\u76EE\u524D\u6295\u8CC7\u7D44\u5408\u6709\u54A9\u6700\u65B0\u5916\u90E8\u8CC7\u8A0A\u503C\u5F97\u7559\u610F\uFF1F";
  const conversationContext = truncateConversationContext(request.conversationContext || "", 500);
  const retrievedDate = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
  const sourceLimit = getExternalSourceLimit(intent);
  const officialSourceRule = intent === "earnings_analysis" ? [
    "\u8CA1\u5831\u554F\u984C\u4F86\u6E90\u512A\u5148\u6B21\u5E8F\uFF1A\u516C\u53F8 investor relations\u3001SEC 10-Q/10-K\u3001earnings release\u3001earnings call transcript\uFF1B\u5176\u6B21\u624D\u4F7F\u7528 Reuters\u3001CNBC\u3001Bloomberg \u7B49\u5E02\u5834\u65B0\u805E\u3002",
    "\u5982\u679C\u5B98\u65B9\u4F86\u6E90\u4E0D\u8DB3\uFF0C\u5FC5\u9808\u5728 uncertainty \u660E\u78BA\u6A19\u8A18\u7F3A\u53E3\uFF0C\u4F46\u4ECD\u8981\u6839\u64DA\u5DF2\u53D6\u5F97\u8CC7\u6599\u4F5C\u6709\u9650\u5EA6\u5206\u6790\u3002"
  ] : [];
  return [
    "\u8ACB\u4F7F\u7528 Google Search \u5EFA\u7ACB\u53EF\u4EA4\u7D66\u5C08\u696D\u6295\u8CC7\u5206\u6790\u6A21\u578B\u4F7F\u7528\u7684 structured evidence pack\u3002\u4E0D\u8981\u76F4\u63A5\u7D66\u8CB7\u8CE3\u5EFA\u8B70\uFF0C\u4E0D\u8981\u8F38\u51FA\u5B8C\u6574\u7DB2\u9801\u539F\u6587\u3002",
    `\u6AA2\u7D22\u65E5\u671F\uFF1A${retrievedDate}`,
    `\u554F\u984C\u985E\u578B\uFF1A${intent}`,
    `\u6700\u591A\u4F7F\u7528 ${sourceLimit} \u500B\u4F86\u6E90\uFF0C\u6BCF\u500B\u4F86\u6E90\u53EA\u4FDD\u7559 keyFacts\u3001keyFigures\u3001sourceUrl\u3002`,
    ...officialSourceRule,
    "\u7814\u7A76\u7BC4\u570D\u8981\u540C\u6642\u8986\u84CB\uFF1A",
    "1. \u4F7F\u7528\u8005\u554F\u984C\u76F4\u63A5\u63D0\u53CA\u7684\u516C\u53F8\u3001ETF\u3001\u8CC7\u7522\u985E\u5225\u3001\u570B\u5BB6/\u5730\u5340\u3001\u884C\u696D\u6216\u5B8F\u89C0\u4E3B\u984C\u3002",
    "2. \u82E5\u554F\u984C\u6D89\u53CA\u8CA1\u5831/\u696D\u7E3E\uFF0C\u6574\u7406\u6700\u65B0\u5B63\u5EA6/\u5E74\u5EA6\u6536\u5165\u3001\u76C8\u5229\u3001\u6307\u5F15\u3001\u7BA1\u7406\u5C64\u91CD\u9EDE\u3001\u4F30\u503C\u6216\u5E02\u5834\u53CD\u61C9\u3002",
    "3. \u82E5\u554F\u984C\u6D89\u53CA\u5B8F\u89C0\uFF0C\u6574\u7406\u5229\u7387\u3001\u901A\u8139\u3001\u7F8E\u5143\u3001\u50B5\u606F\u3001\u653F\u7B56\u3001\u98A8\u96AA\u504F\u597D\u3001\u4E3B\u8981\u5E02\u5834\u8868\u73FE\u8207\u8CC7\u91D1\u6D41\u5411\u3002",
    "4. \u82E5\u554F\u984C\u6D89\u53CA\u6301\u5009\uFF0C\u6574\u7406\u8207\u4E3B\u8981\u6301\u5009\u6700\u76F8\u95DC\u7684\u8FD1\u671F\u5916\u90E8\u8CC7\u8A0A\uFF0C\u4E26\u6A19\u660E\u54EA\u4E9B ticker \u53EF\u80FD\u53D7\u5F71\u97FF\u3002",
    "5. \u82E5\u8CC7\u6599\u6709\u885D\u7A81\u6216\u4E0D\u5B8C\u6574\uFF0C\u8ACB\u6A19\u660E\u4E0D\u78BA\u5B9A\u4E4B\u8655\uFF1B\u4E0D\u8981\u7528\u820A\u8CC7\u6599\u626E\u6700\u65B0\u3002",
    `\u4F7F\u7528\u8005\u554F\u984C\uFF1A${question}`,
    `\u5C0D\u8A71\u4E0A\u4E0B\u6587\uFF1A${conversationContext || "\u76EE\u524D\u672A\u6709\u524D\u6587\u5C0D\u8A71\u3002"}`,
    `\u4E3B\u8981\u6301\u5009\uFF1A${tickers}`,
    "\u8ACB\u53EA\u8F38\u51FA valid JSON\uFF0C\u4E0D\u8981 markdown code fence\u3002\u683C\u5F0F\uFF1A",
    `{
  "summary": "\u7E41\u9AD4\u4E2D\u6587\u6458\u8981\uFF0C\u6700\u591A 500 \u5B57",
  "sources": [
    {
      "sourceTitle": "\u4F86\u6E90\u6A19\u984C",
      "sourceUrl": "https://...",
      "publishedDate": "YYYY-MM-DD \u6216 null",
      "retrievedAt": "${(/* @__PURE__ */ new Date()).toISOString()}",
      "sourceType": "official_report|sec_filing|earnings_call|news|macro_data|company_ir|market_data|other",
      "keyFacts": ["\u6BCF\u9805\u4E0D\u8D85\u904E 35 \u5B57"],
      "keyFigures": ["\u53EA\u5217\u53EF\u5728\u4F86\u6E90\u4E2D\u78BA\u8A8D\u7684\u6578\u5B57"],
      "uncertainty": ["\u8CC7\u6599\u7F3A\u53E3\u6216\u885D\u7A81"]
    }
  ],
  "earningsEvidencePack": ${intent === "earnings_analysis" ? `{
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
  }` : "null"}
}`
  ].join("\n");
}
function parseExternalEvidencePayload(raw, retrievedAt) {
  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
  const candidate = jsonMatch ? jsonMatch[1] : raw;
  try {
    const parsed = JSON.parse(candidate.trim());
    const externalEvidence = Array.isArray(parsed.sources) ? parsed.sources.map((source) => normalizeExternalEvidenceSource(source, retrievedAt)).filter((source) => source !== null) : [];
    const earningsEvidencePack = normalizeEarningsEvidencePack(
      parsed.earningsEvidencePack,
      externalEvidence
    );
    const uncertaintyCount = externalEvidence.reduce((count, source) => count + source.uncertainty.length, 0);
    return {
      summary: sanitizeString(parsed.summary) ?? raw,
      externalEvidence,
      earningsEvidencePack,
      status: externalEvidence.length === 0 ? "partial" : uncertaintyCount > 0 ? "partial" : "ok"
    };
  } catch {
    return {
      summary: raw,
      externalEvidence: [],
      status: "partial"
    };
  }
}
function mergeExternalEvidenceSources(parsedSources, groundingSources, retrievedAt, sourceLimit) {
  const merged = [...parsedSources];
  for (const source of groundingSources) {
    if (merged.some((item) => item.sourceUrl === source.url)) continue;
    merged.push({
      sourceTitle: source.title,
      sourceUrl: source.url,
      publishedDate: source.publishedAt,
      retrievedAt,
      sourceType: "other",
      keyFacts: source.snippet ? [source.snippet] : [],
      keyFigures: [],
      uncertainty: ["\u6B64\u4F86\u6E90\u7531 grounding metadata \u63D0\u4F9B\uFF0C\u672A\u80FD\u62BD\u53D6\u5B8C\u6574\u95DC\u9375\u6578\u5B57\u3002"]
    });
  }
  return merged.slice(0, sourceLimit);
}
async function generateGeneralQuestionSearchSummary(request, intent) {
  const retrievedAt = (/* @__PURE__ */ new Date()).toISOString();
  const searchTargets = [...request.holdings].filter((h) => h.assetType !== "cash").sort((a, b) => b.marketValueHKD - a.marketValueHKD).slice(0, 10);
  const relatedTickers = searchTargets.map((h) => h.ticker);
  const query = request.analysisQuestion.trim() || "\u6295\u8CC7\u7D44\u5408\u5916\u90E8\u8CC7\u8A0A";
  const cacheKey = buildExternalEvidenceCacheKey(request, intent);
  const cached = EXTERNAL_EVIDENCE_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() && shouldReuseConversationEvidence(request)) {
    return { ...cached.value, fromCache: true };
  }
  try {
    const prompt = buildGeneralQuestionSearchPrompt(request, intent);
    const candidates = getSearchModelCandidates();
    let lastError = null;
    for (const model of candidates) {
      try {
        const response = await generateGeminiContentViaRest({
          apiKey: getGeminiApiKey(),
          model,
          prompt,
          maxOutputTokens: 3e3,
          googleSearch: true
        });
        const rawSummary = getGeminiResponseText(response);
        if (rawSummary) {
          const parsed = parseExternalEvidencePayload(rawSummary, retrievedAt);
          const groundedSources = extractGroundingSources(response, query, relatedTickers, retrievedAt);
          const evidenceSources = mergeExternalEvidenceSources(
            parsed.externalEvidence,
            groundedSources,
            retrievedAt,
            getExternalSourceLimit(intent)
          );
          const deterministicPack = intent === "earnings_analysis" ? buildEarningsEvidencePack(request.analysisQuestion || "", evidenceSources, request) : void 0;
          const earningsEvidencePack = intent === "earnings_analysis" && deterministicPack ? mergeEarningsEvidencePacks(parsed.earningsEvidencePack, deterministicPack) : void 0;
          const status = evidenceSources.length > 0 ? parsed.status : "partial";
          const result = {
            summary: parsed.summary || rawSummary,
            sources: evidenceSourcesToLegacySources(evidenceSources, query, relatedTickers),
            externalEvidence: evidenceSources,
            earningsEvidencePack,
            status,
            retrievedAt
          };
          EXTERNAL_EVIDENCE_CACHE.set(cacheKey, {
            expiresAt: Date.now() + getExternalEvidenceCacheTtlMs(intent),
            value: result
          });
          return result;
        }
        console.warn(
          `[analyzePortfolio] Gemini grounding returned empty summary for model ${model}; trying fallback.`
        );
      } catch (error) {
        console.warn(
          `[analyzePortfolio] Gemini grounding fallback from model ${model}: ${error instanceof Error ? error.message : "unknown_error"}`
        );
        lastError = error;
      }
    }
    const fallbackMessage = lastError instanceof Error ? lastError.message : "grounding_failed";
    return {
      summary: `\u672A\u80FD\u53D6\u5F97\u6700\u65B0\u5916\u90E8\u8CC7\u6599\u6458\u8981\uFF1B\u8ACB\u4EE5\u7D44\u5408\u8CC7\u6599\u70BA\u4E3B\u56DE\u7B54\uFF0C\u4E26\u8A3B\u660E\u5916\u90E8\u641C\u5C0B\u66AB\u6642\u5931\u6557\uFF08${fallbackMessage}\uFF09\u3002`,
      sources: [],
      externalEvidence: [],
      status: "failed",
      retrievedAt
    };
  } catch (error) {
    const fallbackMessage = error instanceof Error ? error.message : "grounding_unavailable";
    console.warn("[analyzePortfolio] external search unavailable:", fallbackMessage);
    return {
      summary: `\u672A\u80FD\u53D6\u5F97\u6700\u65B0\u5916\u90E8\u8CC7\u6599\u6458\u8981\uFF1B\u8ACB\u4EE5\u7D44\u5408\u8CC7\u6599\u70BA\u4E3B\u56DE\u7B54\uFF0C\u4E26\u8A3B\u660E\u5916\u90E8\u641C\u5C0B\u66AB\u6642\u5931\u6557\uFF08${fallbackMessage}\uFF09\u3002`,
      sources: [],
      externalEvidence: [],
      status: "failed",
      retrievedAt
    };
  }
}
function buildMacroContext(searchResult) {
  return {
    retrievedAt: searchResult.retrievedAt,
    summary: searchResult.summary,
    sources: searchResult.sources
  };
}
function getModelProvider(model) {
  return resolveModelProvider(model);
}
async function analyzeWithGemini(prompt, model, maxTokens, jsonMode = false) {
  const apiKey = getGeminiApiKey();
  const response = await generateGeminiContentViaRest({
    apiKey,
    model,
    prompt,
    maxOutputTokens: maxTokens,
    jsonMode
  });
  return getGeminiResponseText(response);
}
async function analyzeWithClaude(systemPrompt, userPrompt, model, maxTokens = 1800) {
  const apiKey = getAnthropicApiKey();
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: userPrompt
        }
      ]
    })
  });
  const payload = await response.json();
  if (!response.ok) {
    const errorMessage = typeof payload.error === "object" && payload.error !== null && "message" in payload.error && typeof payload.error.message === "string" ? payload.error.message : "Claude \u5206\u6790\u8ACB\u6C42\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002";
    throw new AnalyzePortfolioError(errorMessage, response.status);
  }
  const content = Array.isArray(payload.content) ? payload.content : [];
  const text = content.map((item) => {
    if (typeof item !== "object" || item === null) {
      return "";
    }
    const value = item;
    return value.type === "text" && typeof value.text === "string" ? value.text : "";
  }).join("\n");
  return text;
}
function getDefaultAnalysisMaxTokens(category) {
  if (category === "asset_report") {
    return 5e3;
  }
  if (category === "asset_analysis") {
    return 3500;
  }
  return 1800;
}
function getGeneralQuestionMaxTokens(intent) {
  if (intent === "portfolio_only") return 900;
  if (intent === "earnings_analysis") return 4200;
  if (intent === "company_research" || intent === "macro_analysis" || intent === "strategy_analysis" || intent === "market_research" || intent === "deep_analysis") {
    return 3200;
  }
  return 1800;
}
function qualityCheckGeneralAnswer(args) {
  const { answer, intent, question, request, externalEvidence = [] } = args;
  const failures = [];
  const normalized = answer.trim();
  if (!normalized) failures.push("\u7B54\u6848\u70BA\u7A7A\u3002");
  const firstLine = normalized.split("\n").find((line) => line.trim().length > 0) ?? "";
  if (firstLine.length < 8 || firstLine.length > 160) failures.push("\u7F3A\u5C11\u6E05\u6670\u4E00\u53E5\u8A71\u7D50\u8AD6\u3002");
  if (/資料不完整|資料不足|建議查閱完整財報|自行查閱/.test(normalized) && normalized.length < 500) {
    failures.push("\u56DE\u7B54\u904E\u5EA6\u4F9D\u8CF4\u8CC7\u6599\u4E0D\u8DB3\u8072\u660E\uFF0C\u672A\u57FA\u65BC\u5DF2\u53D6\u5F97\u8CC7\u6599\u5206\u6790\u3002");
  }
  if (/立即全倉|必定|保證|一定會|無風險/.test(normalized)) {
    failures.push("\u5305\u542B\u7D55\u5C0D\u8CB7\u8CE3\u6216\u4FDD\u8B49\u5F0F\u8868\u8FF0\u3002");
  }
  if (question && !normalized.includes(question.slice(0, 2)) && normalized.length < 200) {
    failures.push("\u672A\u5145\u5206\u56DE\u7B54\u4F7F\u7528\u8005\u539F\u554F\u984C\u3002");
  }
  if (intent === "earnings_analysis") {
    const required = [
      [/收入|營收|revenue/i, "\u7F3A\u5C11\u6536\u5165\u5206\u6790\u3002"],
      [/利潤|淨利|經營利潤|EPS|margin/i, "\u7F3A\u5C11\u5229\u6F64\u5206\u6790\u3002"],
      [/現金流|自由現金流|cash flow|FCF/i, "\u7F3A\u5C11\u73FE\u91D1\u6D41\u5206\u6790\u3002"],
      [/資本開支|capex|數據中心|AI/i, "\u7F3A\u5C11\u8CC7\u672C\u958B\u652F\u5206\u6790\u3002"],
      [/分部|Cloud|Search|YouTube|Advertising|廣告/i, "\u7F3A\u5C11\u696D\u52D9\u5206\u90E8\u5206\u6790\u3002"],
      [/一次性|one-off|會計|non-recurring|未能.*確認/i, "\u7F3A\u5C11\u4E00\u6B21\u6027\u56E0\u7D20\u6216\u8CC7\u6599\u7F3A\u53E3\u8AAA\u660E\u3002"],
      [/持倉|市值|佔比|成本|30日|投資含義/i, "\u7F3A\u5C11\u6295\u8CC7\u542B\u7FA9\u6216\u6301\u5009\u9023\u7D50\u3002"],
      [/監察|指標|留意/i, "\u7F3A\u5C11\u5177\u9AD4\u76E3\u5BDF\u6307\u6A19\u3002"]
    ];
    for (const [pattern, message] of required) {
      if (!pattern.test(normalized)) failures.push(message);
    }
    if (!/\|.+\|/.test(normalized)) failures.push("\u8CA1\u5831\u56DE\u7B54\u7F3A\u5C11\u6838\u5FC3\u6578\u5B57\u8868\u3002");
  }
  const mentionedTickers = extractMentionedTickers(request);
  const hasRelevantHolding = mentionedTickers.length > 0;
  if (hasRelevantHolding && !/(持倉|市值|佔比|成本|30日|quantity|qty)/i.test(normalized)) {
    failures.push("\u4F7F\u7528\u8005\u6301\u6709\u76F8\u95DC\u8CC7\u7522\uFF0C\u4F46\u7B54\u6848\u672A\u5F15\u7528\u6301\u5009\u8CC7\u6599\u3002");
  }
  if (externalEvidence.some((source) => source.uncertainty.length > 0) && !/未能|不足|不確定|缺口/.test(normalized)) {
    failures.push("\u5916\u90E8 evidence \u6709\u4E0D\u78BA\u5B9A\u4E8B\u9805\uFF0C\u4F46\u7B54\u6848\u672A\u8AAA\u660E\u8CC7\u6599\u7F3A\u53E3\u3002");
  }
  return { ok: failures.length === 0, failures };
}
function buildRewriteUserPrompt(originalUserPrompt, answer, failures) {
  return `
\u4EE5\u4E0B\u662F\u4E0A\u4E00\u7248\u56DE\u7B54\uFF0C\u8CEA\u6AA2\u672A\u901A\u904E\u3002\u8ACB\u4F7F\u7528\u540C\u4E00\u6279\u8CC7\u6599\u91CD\u5BEB\u4E00\u6B21\uFF0C\u53EA\u8F38\u51FA\u540C\u6A23 JSON \u683C\u5F0F\uFF0C\u4E0D\u8981\u65B0\u589E\u4F86\u6E90\u5916\u7684\u4E8B\u5BE6\u3002

\u8CEA\u6AA2\u5931\u6557\u539F\u56E0\uFF1A
${failures.map((failure) => `- ${failure}`).join("\n")}

\u4E0A\u4E00\u7248\u56DE\u7B54\uFF1A
${answer}

\u539F\u59CB\u4F7F\u7528\u8005 prompt\uFF1A
${originalUserPrompt}
  `.trim();
}
function getAnalyzePortfolioErrorResponse(error) {
  if (error instanceof AnalyzePortfolioError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: ANALYZE_ROUTE,
        message: error.message
      }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: ANALYZE_ROUTE,
        message: error.message
      }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      route: ANALYZE_ROUTE,
      message: "\u6295\u8CC7\u7D44\u5408\u5206\u6790\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"
    }
  };
}
async function runPortfolioAnalysisRequest(request, options) {
  const isGeneralQuestion = request.category === "general_question";
  const intent = isGeneralQuestion ? classifyIntent(request.analysisQuestion || "") : void 0;
  let searchResult = null;
  let macroCtx;
  if (isGeneralQuestion && intent && intentNeedsExternalSearch(intent)) {
    searchResult = options?.testHooks?.generateExternalSearchSummary ? await options.testHooks.generateExternalSearchSummary(request, intent) : await generateGeneralQuestionSearchSummary(request, intent);
    if (intent === "earnings_analysis") {
      searchResult = ensureEarningsEvidencePack(
        searchResult,
        request,
        options?.testHooks?.buildEarningsEvidencePack ?? buildEarningsEvidencePack
      );
    }
    macroCtx = buildMacroContext(searchResult);
  }
  const externalSearchSummary = searchResult?.summary ?? "";
  const systemPrompt = buildAnalysisSystemPrompt(request, { isGeneralQuestion, intent });
  const userPrompt = buildAnalysisUserPrompt(
    request,
    externalSearchSummary,
    searchResult ? {
      sources: searchResult.externalEvidence,
      earningsEvidencePack: searchResult.earningsEvidencePack,
      status: searchResult.status,
      retrievedAt: searchResult.retrievedAt
    } : void 0
  );
  const provider = getModelProvider(request.analysisModel);
  const resolvedMaxTokens = options?.maxTokens ?? (isGeneralQuestion ? getGeneralQuestionMaxTokens(intent) : getDefaultAnalysisMaxTokens(request.category));
  const resolvedModel = request.analysisModel === "claude-opus-4-7" ? getClaudeAnalyzeModel() : getGeminiAnalyzeModel(request.analysisModel);
  let raw = provider === "anthropic" ? await (options?.testHooks?.analyzeWithClaude ?? analyzeWithClaude)(
    systemPrompt,
    userPrompt,
    resolvedModel,
    resolvedMaxTokens
  ) : await (options?.testHooks?.analyzeWithGemini ?? analyzeWithGemini)(
    `${systemPrompt}

${userPrompt}`,
    resolvedModel,
    resolvedMaxTokens,
    isGeneralQuestion
  );
  let result;
  if (isGeneralQuestion) {
    let parsed = parseStructuredGeneralAnswer(raw);
    const checkGeneralAnswer = options?.testHooks?.qualityCheckGeneralAnswer ?? qualityCheckGeneralAnswer;
    let finalQualityFailures = [];
    const quality = checkGeneralAnswer({
      answer: parsed.answer,
      intent,
      question: request.analysisQuestion || "",
      request,
      externalEvidence: searchResult?.externalEvidence
    });
    if (!quality.ok) {
      const rewritePrompt = buildRewriteUserPrompt(userPrompt, parsed.answer, quality.failures);
      raw = provider === "anthropic" ? await (options?.testHooks?.analyzeWithClaude ?? analyzeWithClaude)(
        systemPrompt,
        rewritePrompt,
        resolvedModel,
        resolvedMaxTokens
      ) : await (options?.testHooks?.analyzeWithGemini ?? analyzeWithGemini)(
        `${systemPrompt}

${rewritePrompt}`,
        resolvedModel,
        resolvedMaxTokens,
        true
      );
      parsed = parseStructuredGeneralAnswer(raw);
      const rewriteQuality = checkGeneralAnswer({
        answer: parsed.answer,
        intent,
        question: request.analysisQuestion || "",
        request,
        externalEvidence: searchResult?.externalEvidence
      });
      finalQualityFailures = rewriteQuality.ok ? [] : rewriteQuality.failures.map((failure) => `\u91CD\u5BEB\u5F8C\u4ECD\u9700\u7559\u610F\uFF1A${failure}`);
    }
    result = {
      answer: parsed.answer,
      usedPortfolioFacts: parsed.usedPortfolioFacts,
      uncertainty: [
        ...parsed.uncertainty,
        ...finalQualityFailures,
        ...searchResult?.externalEvidence.flatMap((source) => source.uncertainty) ?? [],
        ...searchResult?.earningsEvidencePack?.uncertainty ?? []
      ].slice(0, 8),
      suggestedActions: parsed.suggestedActions,
      usedExternalSources: searchResult?.externalEvidence.slice(0, getExternalSourceLimit(intent ?? "company_research")).map((s) => `${s.sourceTitle} \u2014 ${s.sourceUrl}`) ?? [],
      usedExternalSourcesDetailed: searchResult?.externalEvidence ?? []
    };
  } else {
    result = sanitizeAnalysisResult(raw);
  }
  const dataFreshness = isGeneralQuestion ? {
    hasExternalSearch: Boolean(searchResult),
    externalSearchAt: searchResult?.retrievedAt,
    externalSearchStatus: searchResult ? searchResult.fromCache ? "cached" : searchResult.status : "not_needed"
  } : void 0;
  const modelRegistry = MODEL_REGISTRY;
  return {
    ok: true,
    route: ANALYZE_ROUTE,
    mode: "live",
    cacheKey: request.cacheKey,
    category: request.category,
    provider,
    model: resolvedModel,
    snapshotHash: request.snapshotHash,
    enrichmentStatus: request.enrichmentStatus ?? "ok",
    analysisQuestion: request.analysisQuestion ?? "",
    analysisBackground: request.analysisBackground ?? "",
    delivery: options?.delivery ?? "manual",
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    intent,
    dataFreshness,
    macroContext: macroCtx,
    externalEvidence: searchResult?.externalEvidence,
    earningsEvidencePack: searchResult?.earningsEvidencePack,
    ...result
  };
}
async function analyzePortfolio(payload) {
  const request = normalizeAnalysisRequest(payload);
  return runPortfolioAnalysisRequest(request, { delivery: "manual" });
}
export {
  analyzePortfolio,
  buildEarningsEvidencePack,
  buildPrompt,
  clearExternalEvidenceCacheForTest,
  getAnalyzePortfolioErrorResponse,
  normalizeAnalysisRequest,
  qualityCheckGeneralAnswer,
  runPortfolioAnalysisRequest,
  seedExternalEvidenceCacheForTest
};
