import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';

const SYNC_ROUTE = '/api/sync-coin-ids';
const COINGECKO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COINGECKO_SEARCH_MIN_INTERVAL_MS = 2100;
const COINGECKO_ID_OVERRIDES = {
    ASTER: { coinId: 'aster-2' },
    ATONE: { coinId: 'atomone' },
    NIGHT: { coinId: 'night' },
};
const coinGeckoCoinIdMemoryCache = new Map();
let lastCoinGeckoSearchAt = 0;
function normalizeCoinGeckoTicker(ticker) {
    return ticker.trim().toUpperCase();
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function throttleCoinGeckoSearch() {
    const elapsed = Date.now() - lastCoinGeckoSearchAt;
    if (elapsed < COINGECKO_SEARCH_MIN_INTERVAL_MS) {
        await sleep(COINGECKO_SEARCH_MIN_INTERVAL_MS - elapsed);
    }
    lastCoinGeckoSearchAt = Date.now();
}
function parseCoinGeckoCacheExpiry(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
function isFreshCoinGeckoCacheEntry(entry) {
    const parsedExpiresAt = parseCoinGeckoCacheExpiry(entry.expiresAt);
    return parsedExpiresAt ? parsedExpiresAt.getTime() > Date.now() : false;
}
function serializeCoinGeckoCacheEntry(entry) {
    return {
        ticker: entry.ticker,
        coinId: entry.coinId,
        coinSymbol: entry.coinSymbol,
        coinName: entry.coinName,
        marketCapRank: entry.marketCapRank,
        source: entry.source,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt,
    };
}
function normalizeCoinGeckoCacheEntry(ticker, value) {
    const coinId = typeof value.coinId === 'string' ? value.coinId.trim() : '';
    const coinSymbol = typeof value.coinSymbol === 'string' ? value.coinSymbol.trim() : '';
    const coinName = typeof value.coinName === 'string' ? value.coinName.trim() : '';
    const source = value.source === 'override' || value.source === 'search' ? value.source : null;
    const updatedAtValue = value.updatedAt;
    const expiresAtValue = value.expiresAt;
    const updatedAt = typeof updatedAtValue === 'string' && !Number.isNaN(new Date(updatedAtValue).getTime())
        ? new Date(updatedAtValue).toISOString()
        : null;
    const expiresAt = typeof expiresAtValue === 'string' && !Number.isNaN(new Date(expiresAtValue).getTime())
        ? new Date(expiresAtValue).toISOString()
        : null;
    const marketCapRank = typeof value.marketCapRank === 'number' && Number.isFinite(value.marketCapRank)
        ? value.marketCapRank
        : null;
    if (!coinId || !coinSymbol || !coinName || !source || !updatedAt || !expiresAt) {
        return null;
    }
    return {
        ticker,
        coinId,
        coinSymbol,
        coinName,
        marketCapRank,
        source,
        updatedAt,
        expiresAt,
    };
}
function createCoinGeckoCacheEntry(params) {
    const now = new Date();
    return {
        ticker: normalizeCoinGeckoTicker(params.ticker),
        coinId: params.coinId,
        coinSymbol: params.coinSymbol,
        coinName: params.coinName,
        marketCapRank: typeof params.marketCapRank === 'number' && Number.isFinite(params.marketCapRank)
            ? params.marketCapRank
            : null,
        source: params.source,
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + COINGECKO_CACHE_TTL_MS).toISOString(),
    };
}
function getCoinGeckoCacheDocRef(db, ticker) {
    return db
        .collection('portfolio')
        .doc('app')
        .collection('coinIdCache')
        .doc(normalizeCoinGeckoTicker(ticker));
}
async function readCoinGeckoCacheEntry(ticker) {
    try {
        const db = getFirebaseAdminDb();
        const snapshot = await getCoinGeckoCacheDocRef(db, ticker).get();
        if (!snapshot.exists) {
            return null;
        }
        const cached = normalizeCoinGeckoCacheEntry(normalizeCoinGeckoTicker(ticker), snapshot.data());
        if (cached) {
            coinGeckoCoinIdMemoryCache.set(cached.ticker, cached);
        }
        return cached;
    }
    catch (error) {
        console.warn(`Failed to read CoinGecko coin id cache for ${ticker}.`, error);
        return null;
    }
}
async function writeCoinGeckoCacheEntry(entry) {
    try {
        const db = getFirebaseAdminDb();
        await getCoinGeckoCacheDocRef(db, entry.ticker).set(serializeCoinGeckoCacheEntry(entry), {
            merge: true,
        });
        coinGeckoCoinIdMemoryCache.set(entry.ticker, entry);
    }
    catch (error) {
        console.warn(`Failed to write CoinGecko coin id cache for ${entry.ticker}.`, error);
    }
}
function pickBestCoinGeckoSearchCoin(coins, ticker) {
    if (coins.length === 0) {
        return null;
    }
    const normalizedTicker = normalizeCoinGeckoTicker(ticker);
    const exactMatches = coins.filter((coin) => normalizeCoinGeckoTicker(coin.symbol) === normalizedTicker);
    const candidates = exactMatches.length > 0 ? exactMatches : coins;
    return [...candidates].sort((left, right) => {
        const leftRank = typeof left.market_cap_rank === 'number' ? left.market_cap_rank : Number.POSITIVE_INFINITY;
        const rightRank = typeof right.market_cap_rank === 'number' ? right.market_cap_rank : Number.POSITIVE_INFINITY;
        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }
        const leftSymbolMatch = normalizeCoinGeckoTicker(left.symbol) === normalizedTicker ? 0 : 1;
        const rightSymbolMatch = normalizeCoinGeckoTicker(right.symbol) === normalizedTicker ? 0 : 1;
        if (leftSymbolMatch !== rightSymbolMatch) {
            return leftSymbolMatch - rightSymbolMatch;
        }
        return left.id.localeCompare(right.id);
    })[0] ?? null;
}
async function fetchCoinGeckoSearchCoins(ticker) {
    const response = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`, {
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        throw new Error(`CoinGecko search HTTP ${response.status}`);
    }
    const payload = await response.json();
    return Array.isArray(payload.coins) ? payload.coins : [];
}
async function fetchCoinGeckoCoinIdFromSearch(ticker) {
    await throttleCoinGeckoSearch();
    const coins = await fetchCoinGeckoSearchCoins(ticker);
    const bestCoin = pickBestCoinGeckoSearchCoin(coins, ticker);
    if (!bestCoin) {
        return null;
    }
    return createCoinGeckoCacheEntry({
        ticker,
        coinId: bestCoin.id,
        coinSymbol: String(bestCoin.symbol ?? '').toUpperCase(),
        coinName: String(bestCoin.name ?? ''),
        marketCapRank: typeof bestCoin.market_cap_rank === 'number' ? bestCoin.market_cap_rank : null,
        source: 'search',
    });
}
export async function resolveCoinGeckoCoinId(ticker) {
    const normalizedTicker = normalizeCoinGeckoTicker(ticker);
    const override = COINGECKO_ID_OVERRIDES[normalizedTicker];
    if (override) {
        const entry = createCoinGeckoCacheEntry({
            ticker: normalizedTicker,
            coinId: override.coinId,
            coinSymbol: normalizedTicker,
            coinName: normalizedTicker,
            marketCapRank: null,
            source: 'override',
        });
        await writeCoinGeckoCacheEntry(entry);
        return {
            entry,
            status: 'override',
        };
    }
    const memoryEntry = coinGeckoCoinIdMemoryCache.get(normalizedTicker);
    if (memoryEntry && isFreshCoinGeckoCacheEntry(memoryEntry)) {
        return {
            entry: memoryEntry,
            status: memoryEntry.source === 'override' ? 'override' : 'cache',
        };
    }
    const cacheEntry = memoryEntry ?? (await readCoinGeckoCacheEntry(normalizedTicker));
    if (cacheEntry && isFreshCoinGeckoCacheEntry(cacheEntry)) {
        coinGeckoCoinIdMemoryCache.set(normalizedTicker, cacheEntry);
        return {
            entry: cacheEntry,
            status: cacheEntry.source === 'override' ? 'override' : 'cache',
        };
    }
    try {
        const resolvedEntry = await fetchCoinGeckoCoinIdFromSearch(normalizedTicker);
        if (resolvedEntry) {
            await writeCoinGeckoCacheEntry(resolvedEntry);
            return {
                entry: resolvedEntry,
                status: 'search',
            };
        }
        if (cacheEntry) {
            return {
                entry: cacheEntry,
                status: 'fallback_cache',
            };
        }
        return {
            entry: null,
            status: 'missing',
        };
    }
    catch (error) {
        console.warn(`Failed to resolve CoinGecko coin id for ${normalizedTicker}.`, error);
        if (cacheEntry) {
            return {
                entry: cacheEntry,
                status: 'fallback_cache',
            };
        }
        return {
            entry: null,
            status: 'lookup_failed',
        };
    }
}
async function readTargetTickers(payload) {
    if (payload &&
        typeof payload === 'object' &&
        'tickers' in payload &&
        Array.isArray(payload.tickers)) {
        return [...new Set(payload.tickers.filter((item) => typeof item === 'string').map((item) => normalizeCoinGeckoTicker(item)))];
    }
    const assets = await readAdminPortfolioAssets();
    return [...new Set(assets
            .filter((asset) => asset.assetType === 'crypto')
            .map((asset) => normalizeCoinGeckoTicker(asset.symbol))
            .filter(Boolean))];
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
