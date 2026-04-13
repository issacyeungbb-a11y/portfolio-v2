import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin';
import { resolveCoinGeckoCoinId } from './updatePrices';

const SYNC_ROUTE = '/api/sync-coin-ids' as const;

type CoinIdSyncStatus = 'override' | 'cache' | 'search' | 'fallback_cache' | 'missing' | 'lookup_failed';

interface CoinIdSyncResultItem {
  ticker: string;
  status: CoinIdSyncStatus;
  coinId: string | null;
  coinSymbol: string | null;
  marketCapRank: number | null;
  updatedAt: string | null;
  expiresAt: string | null;
  error?: string;
}

interface CoinIdSyncOptions {
  timeBudgetMs?: number;
}

class CoinIdSyncError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'CoinIdSyncError';
    this.status = status;
  }
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase();
}

function normalizeTickers(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(normalizeTicker))];
}

async function readTargetTickers(payload?: unknown) {
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'tickers' in payload &&
    Array.isArray((payload as Record<string, unknown>).tickers)
  ) {
    return normalizeTickers((payload as Record<string, unknown>).tickers);
  }

  const assets = await readAdminPortfolioAssets();
  return [
    ...new Set(
      assets
        .filter((asset) => asset.assetType === 'crypto')
        .map((asset) => normalizeTicker(asset.symbol))
        .filter(Boolean),
    ),
  ];
}

export async function runCoinGeckoCoinIdSync(payload?: unknown, options?: CoinIdSyncOptions) {
  const tickers = await readTargetTickers(payload);
  const startedAt = Date.now();
  const timeBudgetMs = options?.timeBudgetMs;

  if (tickers.length === 0) {
    return {
      ok: true,
      route: SYNC_ROUTE,
      message: '目前沒有可同步的 crypto 代號。',
      totalCount: 0,
      resolvedCount: 0,
      pendingCount: 0,
      results: [],
      triggeredAt: new Date().toISOString(),
    };
  }

  const results: CoinIdSyncResultItem[] = [];
  let skippedCount = 0;

  for (const ticker of tickers) {
    if (typeof timeBudgetMs === 'number' && timeBudgetMs > 0 && Date.now() - startedAt >= timeBudgetMs) {
      const processedCount = results.length;
      const remainingTickers = tickers.slice(processedCount);
      skippedCount = remainingTickers.length;

      for (const skippedTicker of remainingTickers) {
        results.push({
          ticker: skippedTicker,
          status: 'lookup_failed',
          error: 'CoinGecko 代號同步因時間限制而略過。',
          coinId: null,
          coinSymbol: null,
          marketCapRank: null,
          updatedAt: null,
          expiresAt: null,
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
        expiresAt: resolution.entry?.expiresAt ?? null,
      });
    } catch (error) {
      results.push({
        ticker,
        status: 'lookup_failed',
        error: error instanceof Error ? error.message : String(error),
        coinId: null,
        coinSymbol: null,
        marketCapRank: null,
        updatedAt: null,
        expiresAt: null,
      });
    }
  }

  const resolvedCount = results.filter(
    (result) => result.status === 'override' || result.status === 'cache' || result.status === 'search',
  ).length;
  const pendingCount = results.length - resolvedCount;

  return {
    ok: true,
    route: SYNC_ROUTE,
    message:
      skippedCount > 0
        ? `已同步 ${resolvedCount} 個 crypto 代號；因時間限制略過 ${skippedCount} 個。`
        : pendingCount > 0
          ? `已同步 ${resolvedCount} 個 crypto 代號；${pendingCount} 個未能完成。`
          : `已同步 ${resolvedCount} 個 crypto 代號。`,
    totalCount: results.length,
    resolvedCount,
    pendingCount,
    results,
    triggeredAt: new Date().toISOString(),
  };
}

export function getCoinGeckoCoinIdSyncErrorResponse(error: unknown) {
  if (error instanceof CoinIdSyncError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: SYNC_ROUTE,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: SYNC_ROUTE,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route: SYNC_ROUTE,
      message: 'CoinGecko 代號同步失敗，請稍後再試。',
    },
  };
}
