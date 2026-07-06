import { readAdminPortfolioAssets } from "./portfolioSnapshotAdmin.js";
import { resolveCoinGeckoCoinId, readCoinGeckoCacheEntries, isFreshCoinGeckoCacheEntry } from "./updatePrices.js";
const SYNC_ROUTE = "/api/sync-coin-ids";
class CoinIdSyncError extends Error {
  status;
  constructor(message, status = 500) {
    super(message);
    this.name = "CoinIdSyncError";
    this.status = status;
  }
}
function normalizeTicker(value) {
  return value.trim().toUpperCase();
}
function normalizeTickers(value) {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((item) => typeof item === "string").map(normalizeTicker))];
}
async function readTargetTickers(payload) {
  if (typeof payload === "object" && payload !== null && "tickers" in payload && Array.isArray(payload.tickers)) {
    return normalizeTickers(payload.tickers);
  }
  const assets = await readAdminPortfolioAssets();
  return [
    ...new Set(
      assets.filter((asset) => asset.assetType === "crypto").map((asset) => normalizeTicker(asset.symbol)).filter(Boolean)
    )
  ];
}
async function runCoinGeckoCoinIdSync(payload, options) {
  const tickers = await readTargetTickers(payload);
  const startedAt = Date.now();
  const timeBudgetMs = options?.timeBudgetMs;
  if (tickers.length === 0) {
    return {
      ok: true,
      route: SYNC_ROUTE,
      message: "\u76EE\u524D\u6C92\u6709\u53EF\u540C\u6B65\u7684 crypto \u4EE3\u865F\u3002",
      totalCount: 0,
      resolvedCount: 0,
      pendingCount: 0,
      results: [],
      triggeredAt: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const cacheEntries = await readCoinGeckoCacheEntries(tickers);
  const sortedTickers = [...tickers].sort((a, b) => {
    const cacheA = cacheEntries.get(a);
    const cacheB = cacheEntries.get(b);
    const scoreA = !cacheA ? 0 : isFreshCoinGeckoCacheEntry(cacheA) ? 2 : 1;
    const scoreB = !cacheB ? 0 : isFreshCoinGeckoCacheEntry(cacheB) ? 2 : 1;
    return scoreA - scoreB;
  });
  const results = [];
  let skippedCount = 0;
  for (const ticker of sortedTickers) {
    if (typeof timeBudgetMs === "number" && timeBudgetMs > 0 && Date.now() - startedAt >= timeBudgetMs) {
      const processedCount = results.length;
      const remainingTickers = sortedTickers.slice(processedCount);
      skippedCount = remainingTickers.length;
      for (const skippedTicker of remainingTickers) {
        results.push({
          ticker: skippedTicker,
          status: "lookup_failed",
          error: "CoinGecko \u4EE3\u865F\u540C\u6B65\u56E0\u6642\u9593\u9650\u5236\u800C\u7565\u904E\u3002",
          coinId: null,
          coinSymbol: null,
          marketCapRank: null,
          updatedAt: null,
          expiresAt: null
        });
      }
      break;
    }
    try {
      const resolution = await resolveCoinGeckoCoinId(ticker);
      results.push({
        ticker,
        status: resolution.status,
        coinId: resolution.entry?.coinId ?? null,
        coinSymbol: resolution.entry?.coinSymbol ?? null,
        marketCapRank: resolution.entry?.marketCapRank ?? null,
        updatedAt: resolution.entry?.updatedAt ?? null,
        expiresAt: resolution.entry?.expiresAt ?? null
      });
    } catch (error) {
      results.push({
        ticker,
        status: "lookup_failed",
        error: error instanceof Error ? error.message : String(error),
        coinId: null,
        coinSymbol: null,
        marketCapRank: null,
        updatedAt: null,
        expiresAt: null
      });
    }
  }
  const resolvedCount = results.filter(
    (result) => result.status === "override" || result.status === "cache" || result.status === "search"
  ).length;
  const pendingCount = results.length - resolvedCount;
  return {
    ok: true,
    route: SYNC_ROUTE,
    message: skippedCount > 0 ? `\u5DF2\u540C\u6B65 ${resolvedCount} \u500B crypto \u4EE3\u865F\uFF1B\u56E0\u6642\u9593\u9650\u5236\u7565\u904E ${skippedCount} \u500B\u3002` : pendingCount > 0 ? `\u5DF2\u540C\u6B65 ${resolvedCount} \u500B crypto \u4EE3\u865F\uFF1B${pendingCount} \u500B\u672A\u80FD\u5B8C\u6210\u3002` : `\u5DF2\u540C\u6B65 ${resolvedCount} \u500B crypto \u4EE3\u865F\u3002`,
    totalCount: results.length,
    resolvedCount,
    pendingCount,
    results,
    triggeredAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
function getCoinGeckoCoinIdSyncErrorResponse(error) {
  if (error instanceof CoinIdSyncError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: SYNC_ROUTE,
        message: error.message
      }
    };
  }
  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: SYNC_ROUTE,
        message: error.message
      }
    };
  }
  return {
    status: 500,
    body: {
      ok: false,
      route: SYNC_ROUTE,
      message: "CoinGecko \u4EE3\u865F\u540C\u6B65\u5931\u6557\uFF0C\u8ACB\u7A0D\u5F8C\u518D\u8A66\u3002"
    }
  };
}
export {
  getCoinGeckoCoinIdSyncErrorResponse,
  runCoinGeckoCoinIdSync
};
