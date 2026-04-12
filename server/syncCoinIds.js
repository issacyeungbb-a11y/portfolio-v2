import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { resolveCoinGeckoCoinId } from './updatePrices.js';
const SYNC_ROUTE = '/api/sync-coin-ids';
class CoinIdSyncError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.name = 'CoinIdSyncError';
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
    return [...new Set(value.filter((item) => typeof item === 'string').map(normalizeTicker))];
}
async function readTargetTickers(payload) {
    if (typeof payload === 'object' &&
        payload !== null &&
        'tickers' in payload &&
        Array.isArray(payload.tickers)) {
        return normalizeTickers(payload.tickers);
    }
    const assets = await readAdminPortfolioAssets();
    return [
        ...new Set(assets
            .filter((asset) => asset.assetType === 'crypto')
            .map((asset) => normalizeTicker(asset.symbol))
            .filter(Boolean)),
    ];
}
export async function runCoinGeckoCoinIdSync(payload) {
    const tickers = await readTargetTickers(payload);
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
    const results = [];
    for (const ticker of tickers) {
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
        }
        catch (error) {
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
    const resolvedCount = results.filter((result) => result.status === 'override' || result.status === 'cache' || result.status === 'search').length;
    const pendingCount = results.length - resolvedCount;
    return {
        ok: true,
        route: SYNC_ROUTE,
        message: pendingCount > 0
            ? `已同步 ${resolvedCount} 個 crypto 代號；${pendingCount} 個未能完成。`
            : `已同步 ${resolvedCount} 個 crypto 代號。`,
        totalCount: results.length,
        resolvedCount,
        pendingCount,
        results,
        triggeredAt: new Date().toISOString(),
    };
}
export function getCoinGeckoCoinIdSyncErrorResponse(error) {
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
