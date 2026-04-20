import YahooFinance from 'yahoo-finance2';
import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb, getSharedCoinGeckoCoinIdCacheDocRef, getSharedCoinGeckoCoinIdCacheDocRefs, getSharedCoinGeckoCoinIdOverrideDocRef, getSharedCoinGeckoCoinIdOverrideDocRefs, } from './firebaseAdmin.js';
import { QUOTE_FRESHNESS_WINDOW_MS } from './priceFreshness.js';
import { getAnomalyThreshold, detectHistoricalAnomaly } from './priceAnomalyDetection.js';
import { withRetry } from './retry.js';
const UPDATE_PRICES_ROUTE = '/api/update-prices';
const DEFAULT_STOCK_DIFF_THRESHOLD = 0.5;
const DEFAULT_CRYPTO_DIFF_THRESHOLD = 0.8;
const DEFAULT_FX_RATES = {
    USD: 7.8,
    JPY: 0.052,
    HKD: 1,
};
const YAHOO_SOURCE_NAME = 'Yahoo Finance';
const YAHOO_SOURCE_URL = 'https://finance.yahoo.com';
const COINGECKO_SOURCE_NAME = 'CoinGecko';
const COINGECKO_SOURCE_URL = 'https://www.coingecko.com';
const COINGECKO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COINGECKO_SEARCH_MIN_INTERVAL_MS = 2100;
const YAHOO_PRICE_TIMEOUT_MS = 12000;
const YAHOO_SINGLE_PRICE_TIMEOUT_MS = 8000;
const YAHOO_FX_TIMEOUT_MS = 12000;
const yahooFinanceClient = new YahooFinance();
const LEGACY_COIN_GECKO_ID_OVERRIDES = {
    ASTER: { coinId: 'aster-2' },
    ATONE: { coinId: 'atomone' },
    NIGHT: { coinId: 'midnight-3' },
};
function normalizeCoinGeckoOverrideEntry(ticker, value) {
    const coinId = readStringValue(value.coinId)?.trim();
    if (!coinId) {
        return null;
    }
    const coinSymbol = readStringValue(value.coinSymbol)?.trim() || ticker;
    const coinName = readStringValue(value.coinName)?.trim() || ticker;
    const marketCapRank = typeof value.marketCapRank === 'number' && Number.isFinite(value.marketCapRank)
        ? value.marketCapRank
        : null;
    return {
        ticker,
        coinId,
        coinSymbol,
        coinName,
        marketCapRank,
    };
}
function readStringValue(value) {
    return typeof value === 'string' ? value : null;
}
function readPositiveNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}
function readDateValue(value) {
    if (value instanceof Date && !Number.isNaN(value.getTime())) {
        return value.toISOString();
    }
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }
    return null;
}
function normalizeCoinGeckoTicker(ticker) {
    return ticker.trim().toUpperCase();
}
function createCacheEntryFromOverride(ticker, override) {
    return createCoinGeckoCacheEntry({
        ticker,
        coinId: override.coinId,
        coinSymbol: override.coinSymbol,
        coinName: override.coinName,
        marketCapRank: override.marketCapRank,
        source: 'override',
    });
}
function parseCoinGeckoCacheExpiry(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
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
    const coinId = readStringValue(value.coinId)?.trim();
    const coinSymbol = readStringValue(value.coinSymbol)?.trim();
    const coinName = readStringValue(value.coinName)?.trim();
    const source = value.source === 'override' || value.source === 'search' ? value.source : null;
    const updatedAt = readDateValue(value.updatedAt);
    const expiresAt = readDateValue(value.expiresAt);
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
export function isFreshCoinGeckoCacheEntry(entry) {
    const parsedExpiresAt = parseCoinGeckoCacheExpiry(entry.expiresAt);
    return parsedExpiresAt ? parsedExpiresAt.getTime() > Date.now() : false;
}
function isCacheOverride(entry) {
    return entry.source === 'override';
}
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
export async function readCoinGeckoCacheEntries(tickers) {
    if (tickers.length === 0) {
        return new Map();
    }
    const db = getFirebaseAdminDb();
    const docRefs = getSharedCoinGeckoCoinIdCacheDocRefs(tickers);
    const snapshots = await db.getAll(...docRefs);
    const cacheEntries = new Map();
    snapshots.forEach((snapshot, index) => {
        if (!snapshot.exists) {
            return;
        }
        const ticker = normalizeCoinGeckoTicker(tickers[index] ?? '');
        const cached = normalizeCoinGeckoCacheEntry(ticker, snapshot.data());
        if (cached) {
            cacheEntries.set(ticker, cached);
        }
    });
    return cacheEntries;
}
const coinGeckoCoinIdMemoryCache = new Map();
let lastCoinGeckoSearchAt = 0;
async function throttleCoinGeckoSearch() {
    const elapsed = Date.now() - lastCoinGeckoSearchAt;
    if (elapsed < COINGECKO_SEARCH_MIN_INTERVAL_MS) {
        await sleep(COINGECKO_SEARCH_MIN_INTERVAL_MS - elapsed);
    }
    lastCoinGeckoSearchAt = Date.now();
}
/** P0-4: Distributed CoinGecko throttle — persists last request time to Firestore. */
async function throttleCoinGeckoSearchDistributed() {
    try {
        const db = getFirebaseAdminDb();
        const ref = db.collection('portfolio').doc('app').collection('coinGeckoThrottle').doc('state');
        const doc = await ref.get();
        const remoteLast = doc.exists ? (doc.data()?.lastRequestAt?.toMillis?.() ?? 0) : 0;
        const lastAt = Math.max(lastCoinGeckoSearchAt, remoteLast + 500);
        const elapsed = Date.now() - lastAt;
        if (elapsed < COINGECKO_SEARCH_MIN_INTERVAL_MS) {
            await sleep(COINGECKO_SEARCH_MIN_INTERVAL_MS - elapsed);
        }
        lastCoinGeckoSearchAt = Date.now();
        // Write back without awaiting — best-effort persistence
        ref.set({ lastRequestAt: FieldValue.serverTimestamp() }, { merge: true }).catch((err) =>
            console.warn('[coingecko throttle] persist failed:', err instanceof Error ? err.message : String(err))
        );
    } catch (err) {
        console.warn('[coingecko throttle] fallback to in-memory:', err instanceof Error ? err.message : String(err));
        await throttleCoinGeckoSearch();
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
async function readCoinGeckoCacheEntry(ticker) {
    try {
        const docRef = getSharedCoinGeckoCoinIdCacheDocRef(ticker);
        const snapshot = await docRef.get();
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
const coinGeckoOverrideMemoryCache = new Map();
async function readCoinGeckoOverrideEntry(ticker) {
    const normalizedTicker = normalizeCoinGeckoTicker(ticker);
    const cached = coinGeckoOverrideMemoryCache.get(normalizedTicker);
    if (cached) {
        return cached;
    }
    try {
        const docRef = getSharedCoinGeckoCoinIdOverrideDocRef(normalizedTicker);
        const snapshot = await docRef.get();
        if (!snapshot.exists) {
            const legacy = LEGACY_COIN_GECKO_ID_OVERRIDES[normalizedTicker];
            if (!legacy) {
                return null;
            }
            return {
                ticker: normalizedTicker,
                coinId: legacy.coinId,
                coinSymbol: normalizedTicker,
                coinName: normalizedTicker,
                marketCapRank: null,
            };
        }
        const override = normalizeCoinGeckoOverrideEntry(normalizedTicker, snapshot.data());
        if (override) {
            coinGeckoOverrideMemoryCache.set(normalizedTicker, override);
        }
        return override;
    }
    catch (error) {
        console.warn(`Failed to read CoinGecko coin id override for ${normalizedTicker}.`, error);
        return LEGACY_COIN_GECKO_ID_OVERRIDES[normalizedTicker]
            ? {
                ticker: normalizedTicker,
                coinId: LEGACY_COIN_GECKO_ID_OVERRIDES[normalizedTicker].coinId,
                coinSymbol: normalizedTicker,
                coinName: normalizedTicker,
                marketCapRank: null,
            }
            : null;
    }
}
async function readCoinGeckoOverrideEntries(tickers) {
    if (tickers.length === 0) {
        return new Map();
    }
    const normalizedTickers = [...new Set(tickers.map(normalizeCoinGeckoTicker))];
    const overrideEntries = new Map();
    const missingTickers = [];
    for (const ticker of normalizedTickers) {
        const cached = coinGeckoOverrideMemoryCache.get(ticker);
        if (cached) {
            overrideEntries.set(ticker, cached);
            continue;
        }
        missingTickers.push(ticker);
    }
    if (missingTickers.length === 0) {
        return overrideEntries;
    }
    try {
        const db = getFirebaseAdminDb();
        const docRefs = getSharedCoinGeckoCoinIdOverrideDocRefs(missingTickers);
        const snapshots = await db.getAll(...docRefs);
        snapshots.forEach((snapshot, index) => {
            const ticker = missingTickers[index] ?? '';
            if (!ticker) {
                return;
            }
            if (!snapshot.exists) {
                const legacy = LEGACY_COIN_GECKO_ID_OVERRIDES[ticker];
                if (legacy) {
                    const fallback = {
                        ticker,
                        coinId: legacy.coinId,
                        coinSymbol: ticker,
                        coinName: ticker,
                        marketCapRank: null,
                    };
                    overrideEntries.set(ticker, fallback);
                }
                return;
            }
            const override = normalizeCoinGeckoOverrideEntry(ticker, snapshot.data());
            if (override) {
                coinGeckoOverrideMemoryCache.set(ticker, override);
                overrideEntries.set(ticker, override);
            }
        });
    }
    catch (error) {
        console.warn('Failed to read CoinGecko override entries.', error);
        for (const ticker of missingTickers) {
            const legacy = LEGACY_COIN_GECKO_ID_OVERRIDES[ticker];
            if (!legacy) {
                continue;
            }
            overrideEntries.set(ticker, {
                ticker,
                coinId: legacy.coinId,
                coinSymbol: ticker,
                coinName: ticker,
                marketCapRank: null,
            });
        }
    }
    return overrideEntries;
}
async function writeCoinGeckoCacheEntry(entry) {
    try {
        const docRef = getSharedCoinGeckoCoinIdCacheDocRef(entry.ticker);
        await docRef.set(serializeCoinGeckoCacheEntry(entry), { merge: true });
        coinGeckoCoinIdMemoryCache.set(entry.ticker, entry);
    }
    catch (error) {
        console.warn(`Failed to write CoinGecko coin id cache for ${entry.ticker}.`, error);
    }
}
function createCoinGeckoCacheEntry(params) {
    const now = new Date();
    return {
        ticker: normalizeCoinGeckoTicker(params.ticker),
        coinId: params.coinId,
        coinSymbol: params.coinSymbol,
        coinName: params.coinName,
        marketCapRank: params.marketCapRank,
        source: params.source,
        updatedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + COINGECKO_CACHE_TTL_MS).toISOString(),
    };
}
/**
 * CoinGecko API 配置。
 * COINGECKO_PLAN=demo（預設）→ api.coingecko.com + x-cg-demo-api-key
 * COINGECKO_PLAN=pro        → pro-api.coingecko.com + x-cg-pro-api-key
 */
function getCoinGeckoConfig() {
    const plan = (process.env.COINGECKO_PLAN?.trim().toLowerCase() || 'demo');
    const apiKey = process.env.COINGECKO_API_KEY?.trim();
    if (plan === 'pro') {
        if (!apiKey) {
            throw new Error('COINGECKO_PLAN=pro 但未設定 COINGECKO_API_KEY。請在環境變數中設定 Pro API Key。');
        }
        return { baseUrl: 'https://pro-api.coingecko.com/api/v3', headers: { 'x-cg-pro-api-key': apiKey } };
    }
    const headers = {};
    if (apiKey) {
        headers['x-cg-demo-api-key'] = apiKey;
    }
    return { baseUrl: 'https://api.coingecko.com/api/v3', headers };
}
async function fetchCoinGeckoSearchCoins(ticker) {
    const { baseUrl, headers } = getCoinGeckoConfig();
    const response = await fetch(`${baseUrl}/search?query=${encodeURIComponent(ticker)}`, {
        headers,
        signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
        throw new Error(`CoinGecko search HTTP ${response.status}`);
    }
    const payload = (await response.json());
    return Array.isArray(payload.coins) ? payload.coins : [];
}
async function fetchCoinGeckoCoinIdFromSearch(ticker) {
    await throttleCoinGeckoSearchDistributed();
    const coins = await fetchCoinGeckoSearchCoins(ticker);
    const bestCoin = pickBestCoinGeckoSearchCoin(coins, ticker);
    if (!bestCoin) {
        return null;
    }
    return createCoinGeckoCacheEntry({
        ticker,
        coinId: bestCoin.id,
        coinSymbol: bestCoin.symbol.toUpperCase(),
        coinName: bestCoin.name,
        marketCapRank: typeof bestCoin.market_cap_rank === 'number' ? bestCoin.market_cap_rank : null,
        source: 'search',
    });
}
export async function resolveCoinGeckoCoinId(ticker) {
    const normalizedTicker = normalizeCoinGeckoTicker(ticker);
    const override = await readCoinGeckoOverrideEntry(normalizedTicker);
    if (override) {
        const entry = createCacheEntryFromOverride(normalizedTicker, override);
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
class UpdatePricesError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.name = 'UpdatePricesError';
        this.status = status;
    }
}
function normalizeAssetType(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'stock')
        return 'stock';
    if (normalized === 'etf')
        return 'etf';
    if (normalized === 'bond')
        return 'bond';
    if (normalized === 'crypto')
        return 'crypto';
    return 'cash';
}
function normalizeRequestAsset(asset) {
    if (typeof asset !== 'object' || asset === null) {
        return null;
    }
    const value = asset;
    if (typeof value.assetId !== 'string' ||
        typeof value.assetName !== 'string' ||
        typeof value.ticker !== 'string' ||
        typeof value.assetType !== 'string' ||
        typeof value.currentPrice !== 'number' ||
        typeof value.currency !== 'string') {
        return null;
    }
    return {
        assetId: value.assetId,
        assetName: value.assetName,
        ticker: value.ticker.trim().toUpperCase(),
        assetType: normalizeAssetType(value.assetType),
        currentPrice: value.currentPrice,
        currency: value.currency.trim().toUpperCase(),
    };
}
function normalizeRequest(payload) {
    if (typeof payload !== 'object' ||
        payload === null ||
        !('assets' in payload) ||
        !Array.isArray(payload.assets)) {
        throw new UpdatePricesError('價格更新請求格式不正確。', 400);
    }
    const assets = payload.assets
        .map((asset) => normalizeRequestAsset(asset))
        .filter((asset) => asset !== null)
        .filter((asset) => asset.assetType !== 'cash');
    if (assets.length === 0) {
        throw new UpdatePricesError('未提供可更新的資產。', 400);
    }
    return { assets };
}
function getReviewThresholdForAsset(assetType) {
    return assetType === 'crypto'
        ? DEFAULT_CRYPTO_DIFF_THRESHOLD
        : DEFAULT_STOCK_DIFF_THRESHOLD;
}
function parseAsOf(value) {
    if (!value) {
        return null;
    }
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
// 報價接受時窗由 server/priceFreshness.js 集中管理，不要在此硬編碼。
export function getQuoteFreshnessWindowMs(assetType) {
    return QUOTE_FRESHNESS_WINDOW_MS[assetType] ?? QUOTE_FRESHNESS_WINDOW_MS.stock;
}
export function isStaleQuote(asOf, assetType) {
    const parsed = parseAsOf(asOf);
    if (!parsed) {
        return true;
    }
    return Date.now() - parsed.getTime() > getQuoteFreshnessWindowMs(assetType);
}
function buildInvalidReason(category) {
    if (category === 'ticker_format')
        return '代號格式可能有問題，未能準確對應市場報價';
    if (category === 'quote_time')
        return 'quote 時間過時，已拒絕使用';
    if (category === 'source_missing')
        return '來源不足，未提供可信來源名稱或網址';
    if (category === 'response_format')
        return 'API 回傳格式不正確，未能穩定解析';
    if (category === 'price_missing')
        return '未取得有效市場價格';
    if (category === 'diff_too_large')
        return '價格差距過大，需要人工檢查';
    return '價格更新失敗，請再檢查';
}
function createFailedMarketResult(asset, sourceName, sourceUrl = '', coinGeckoLookupStatus) {
    return {
        assetId: asset.assetId,
        assetName: asset.assetName,
        ticker: asset.ticker,
        assetType: asset.assetType,
        price: null,
        currency: asset.currency,
        asOf: null,
        sourceName,
        sourceUrl,
        marketState: null,
        coinGeckoLookupStatus,
    };
}
/** P0-4 / P2-7: fetch CoinGecko price payload with retry/backoff. */
async function fetchCoinGeckoPricePayload(coinIds) {
    const { baseUrl, headers } = getCoinGeckoConfig();
    const url = `${baseUrl}/simple/price?ids=${encodeURIComponent(coinIds.join(','))}&vs_currencies=usd&include_last_updated_at=true`;
    return withRetry(async () => {
        const response = await fetch(url, {
            headers,
            signal: AbortSignal.timeout(15000),
        });
        if (response.ok) {
            return await response.json();
        }
        throw Object.assign(new Error(`CoinGecko HTTP ${response.status}`), { httpStatus: response.status });
    }, {
        attempts: 3,
        maxDelayMs: 4000,
        label: 'fetchCoinGeckoPricePayload',
        retryable: (err) => {
            const s = err?.httpStatus;
            return s === 429 || (s != null && s >= 500);
        },
        retryDelayMs: (err, attemptIndex) => {
            const s = err?.httpStatus;
            const base = s === 429 ? 4000 : 1000;
            return Math.min(base * Math.pow(2, attemptIndex), 4000);
        },
    });
}
function buildCoinGeckoResultsForEntries(coinId, entry, entries) {
    return entries.map(({ asset, status }) => {
        if (!entry || entry.usd == null || entry.usd <= 0) {
            return createFailedMarketResult(asset, '', '', status);
        }
        return {
            assetId: asset.assetId,
            assetName: asset.assetName,
            ticker: asset.ticker,
            assetType: asset.assetType,
            price: entry.usd,
            currency: 'USD',
            asOf: entry.last_updated_at
                ? new Date(entry.last_updated_at * 1000).toISOString()
                : new Date().toISOString(),
            sourceName: COINGECKO_SOURCE_NAME,
            sourceUrl: `${COINGECKO_SOURCE_URL}/en/coins/${coinId}`,
            marketState: 'CRYPTO',
            coinGeckoLookupStatus: status,
        };
    });
}
function normalizeYahooTicker(asset) {
    if (asset.assetType === 'crypto') {
        return asset.ticker.toUpperCase();
    }
    const normalizedTicker = asset.ticker.trim().toUpperCase();
    if (normalizedTicker.endsWith('.HK')) {
        // 處理 "02800.HK" → "2800.HK"
        const numPart = normalizedTicker.slice(0, -3).replace(/^0+/, '');
        if (/^\d{1,5}$/.test(numPart)) {
            return `${numPart.padStart(4, '0')}.HK`;
        }
        return normalizedTicker;
    }
    if (asset.currency === 'HKD' && /^\d{1,5}$/.test(normalizedTicker)) {
        // 處理 "02800" → "2800.HK"
        const stripped = normalizedTicker.replace(/^0+/, '') || normalizedTicker;
        return `${stripped.padStart(4, '0')}.HK`;
    }
    return normalizedTicker;
}
export async function fetchLiveFxRates() {
    const result = await fetchLiveFxRatesWithStatus();
    return result.rates;
}
/** 與 fetchLiveFxRates 相同，但額外回傳是否使用備援匯率（P2-1）。 */
export async function fetchLiveFxRatesWithStatus() {
    try {
        const quotes = await yahooFinanceClient.quote(['USDHKD=X', 'USDJPY=X'], {
            fields: ['symbol', 'regularMarketPrice'],
            return: 'array',
        }, {
            fetchOptions: { signal: AbortSignal.timeout(YAHOO_FX_TIMEOUT_MS) },
        });
        const bySymbol = new Map(quotes.map((quote) => [readStringValue(quote.symbol) ?? '', quote]));
        const usdToHkd = readPositiveNumber(bySymbol.get('USDHKD=X')?.regularMarketPrice);
        const usdToJpy = readPositiveNumber(bySymbol.get('USDJPY=X')?.regularMarketPrice);
        if (!usdToHkd || !usdToJpy) {
            throw new Error('missing fx quote');
        }
        return {
            rates: { USD: usdToHkd, JPY: usdToHkd / usdToJpy, HKD: 1 },
            usingFallback: false,
        };
    }
    catch (error) {
        console.warn('Failed to fetch Yahoo Finance FX rates, using fallback rates.', error);
        return { rates: { ...DEFAULT_FX_RATES }, usingFallback: true };
    }
}
export { fetchLiveFxRates as fetchFxRates };
async function fetchYahooPrice(assets) {
    if (assets.length === 0) {
        return [];
    }
    const symbolToAsset = new Map();
    const symbols = assets.map((asset) => {
        const symbol = normalizeYahooTicker(asset);
        symbolToAsset.set(symbol, asset);
        return symbol;
    });
    try {
        const quotes = await yahooFinanceClient.quote(symbols, {
            fields: [
                'symbol',
                'currency',
                'marketState',
                'regularMarketPrice',
                'regularMarketTime',
            ],
            return: 'array',
        }, {
            fetchOptions: { signal: AbortSignal.timeout(YAHOO_PRICE_TIMEOUT_MS) },
        });
        const quoteBySymbol = new Map(quotes.map((quote) => [(readStringValue(quote.symbol) ?? '').toUpperCase(), quote]));
        return symbols.map((symbol) => {
            const asset = symbolToAsset.get(symbol);
            const quote = quoteBySymbol.get(symbol.toUpperCase());
            const price = readPositiveNumber(quote?.regularMarketPrice);
            if (!quote || price == null) {
                return createFailedMarketResult(asset, `${YAHOO_SOURCE_NAME} 未返回有效價格`, YAHOO_SOURCE_URL);
            }
            return {
                assetId: asset.assetId,
                assetName: asset.assetName,
                ticker: asset.ticker,
                assetType: asset.assetType,
                price,
                currency: (readStringValue(quote.currency) ?? asset.currency).toUpperCase(),
                asOf: readDateValue(quote.regularMarketTime),
                sourceName: YAHOO_SOURCE_NAME,
                sourceUrl: `${YAHOO_SOURCE_URL}/quote/${encodeURIComponent(symbol)}`,
                marketState: readStringValue(quote.marketState),
            };
        });
    }
    catch (error) {
        console.warn('Yahoo Finance batch quote failed, retrying one-by-one.', error);
        const retryResults = [];
        for (const symbol of symbols) {
            const asset = symbolToAsset.get(symbol);
            try {
                const retryQuotes = await yahooFinanceClient.quote([symbol], {
                    fields: ['symbol', 'currency', 'marketState', 'regularMarketPrice', 'regularMarketTime'],
                    return: 'array',
                }, { fetchOptions: { signal: AbortSignal.timeout(YAHOO_SINGLE_PRICE_TIMEOUT_MS) } });
                const quote = retryQuotes[0];
                const price = readPositiveNumber(quote?.regularMarketPrice);
                if (!quote || price == null) {
                    retryResults.push(createFailedMarketResult(asset, `${YAHOO_SOURCE_NAME} 未返回有效價格`, YAHOO_SOURCE_URL));
                    continue;
                }
                retryResults.push({
                    assetId: asset.assetId,
                    assetName: asset.assetName,
                    ticker: asset.ticker,
                    assetType: asset.assetType,
                    price,
                    currency: (readStringValue(quote.currency) ?? asset.currency).toUpperCase(),
                    asOf: readDateValue(quote.regularMarketTime),
                    sourceName: YAHOO_SOURCE_NAME,
                    sourceUrl: `${YAHOO_SOURCE_URL}/quote/${encodeURIComponent(symbol)}`,
                    marketState: readStringValue(quote.marketState),
                });
            }
            catch (retryError) {
                retryResults.push(createFailedMarketResult(asset, `${YAHOO_SOURCE_NAME} 查詢失敗`, YAHOO_SOURCE_URL));
            }
        }
        return retryResults;
    }
}
async function fetchCoinGeckoPrice(assets) {
    if (assets.length === 0) {
        return [];
    }
    const uniqueTickers = [...new Set(assets.map((asset) => normalizeCoinGeckoTicker(asset.ticker)))];
    const overrideEntries = await readCoinGeckoOverrideEntries(uniqueTickers);
    const cacheEntries = await readCoinGeckoCacheEntries(uniqueTickers);
    const resolvedResults = [];
    const unresolvedResults = [];
    const coinIdToAssets = new Map();
    for (const asset of assets) {
        const normalizedTicker = normalizeCoinGeckoTicker(asset.ticker);
        const override = overrideEntries.get(normalizedTicker);
        const cacheEntry = cacheEntries.get(normalizedTicker);
        const resolvedEntry = override
            ? createCacheEntryFromOverride(normalizedTicker, override)
            : cacheEntry;
        if (!resolvedEntry) {
            unresolvedResults.push(createFailedMarketResult(asset, '', '', 'missing'));
            continue;
        }
        const current = coinIdToAssets.get(resolvedEntry.coinId) ?? [];
        current.push({
            asset,
            status: resolvedEntry.source === 'override' ? 'override' : 'cache',
        });
        coinIdToAssets.set(resolvedEntry.coinId, current);
    }
    const ON_DEMAND_TIME_BUDGET_MS = 25000;
    const onDemandStartedAt = Date.now();
    const missingToResolve = unresolvedResults
        .filter((result) => result.coinGeckoLookupStatus === 'missing');
    for (const missingResult of missingToResolve) {
        if (Date.now() - onDemandStartedAt >= ON_DEMAND_TIME_BUDGET_MS) {
            console.warn(`On-demand CoinGecko resolve stopped: time budget exhausted (${ON_DEMAND_TIME_BUDGET_MS}ms).`);
            break;
        }
        const asset = assets.find((item) => item.assetId === missingResult.assetId);
        if (!asset)
            continue;
        try {
            const resolution = await resolveCoinGeckoCoinId(asset.ticker);
            if (resolution.entry) {
                const idx = unresolvedResults.indexOf(missingResult);
                if (idx >= 0)
                    unresolvedResults.splice(idx, 1);
                const current = coinIdToAssets.get(resolution.entry.coinId) ?? [];
                current.push({ asset, status: resolution.status });
                coinIdToAssets.set(resolution.entry.coinId, current);
            }
        }
        catch (resolveError) {
            console.warn(`On-demand CoinGecko resolve failed for ${asset.ticker}.`, resolveError);
        }
    }
    const resolvedCoinIds = Array.from(coinIdToAssets.keys());
    if (resolvedCoinIds.length > 0) {
        try {
            const payload = await fetchCoinGeckoPricePayload(resolvedCoinIds);
            for (const coinId of resolvedCoinIds) {
                resolvedResults.push(...buildCoinGeckoResultsForEntries(coinId, payload[coinId], coinIdToAssets.get(coinId) ?? []));
            }
        }
        catch (error) {
            console.warn('CoinGecko batch price lookup failed, retrying coin-by-coin.', error);
            for (const coinId of resolvedCoinIds) {
                const entries = coinIdToAssets.get(coinId) ?? [];
                try {
                    await sleep(1500); // P0-4: avoid rate-limit burst during coin-by-coin fallback
                    const payload = await fetchCoinGeckoPricePayload([coinId]);
                    resolvedResults.push(...buildCoinGeckoResultsForEntries(coinId, payload[coinId], entries));
                }
                catch (coinError) {
                    console.warn(`CoinGecko fallback lookup failed for ${coinId}.`, coinError);
                    resolvedResults.push(...entries.map(({ asset, status }) => createFailedMarketResult(asset, '', '', status === 'override' ? 'override' : 'lookup_failed')));
                }
            }
        }
    }
    return [...resolvedResults, ...unresolvedResults];
}
function detectFailureCategory(params) {
    const { asset, matched, nextPrice, staleQuote, diffPct, isValid, historicalAnomaly } = params;
    if (isValid) {
        return undefined;
    }
    if (nextPrice == null || nextPrice <= 0) {
        if (asset.assetType === 'crypto') {
            if (matched?.coinGeckoLookupStatus === 'missing' || matched?.coinGeckoLookupStatus === 'lookup_failed') {
                return 'source_missing';
            }
            if (matched?.sourceName?.includes('CoinGecko')) {
                return 'price_missing';
            }
        }
        return 'price_missing';
    }
    if (staleQuote) {
        return 'quote_time';
    }
    if (!(matched?.sourceName || matched?.sourceUrl)) {
        return 'source_missing';
    }
    if (historicalAnomaly) {
        return 'diff_too_large';
    }
    if (diffPct >= getReviewThresholdForAsset(asset.assetType)) {
        return 'diff_too_large';
    }
    return 'unknown';
}
async function buildReviewResults(requestedAssets, marketResults) {
    return Promise.all(requestedAssets.map(async (asset) => {
        const matched = marketResults.find((item) => item.assetId === asset.assetId) ??
            createFailedMarketResult(asset, '未取得回應');
        const nextPrice = matched.price ?? null;
        const effectiveAsOf = matched.asOf || (nextPrice != null && nextPrice > 0 ? new Date().toISOString() : null);
        const staleQuote = isStaleQuote(effectiveAsOf, asset.assetType);
        const diffPct = nextPrice != null && asset.currentPrice > 0
            ? Math.abs(nextPrice - asset.currentPrice) / asset.currentPrice
            : 0;
        let isValid = nextPrice != null &&
            nextPrice > 0 &&
            !staleQuote &&
            Boolean(matched.sourceName || matched.sourceUrl) &&
            diffPct < getReviewThresholdForAsset(asset.assetType);
        const historicalAnomaly = isValid && nextPrice != null
            ? await detectHistoricalAnomaly(asset.assetId, nextPrice)
            : null;
        if (historicalAnomaly?.isAnomaly) {
            isValid = false;
        }
        const failureCategory = detectFailureCategory({
            asset,
            matched,
            nextPrice,
            staleQuote,
            diffPct,
            isValid,
            historicalAnomaly: historicalAnomaly?.isAnomaly ?? false,
        });
        const invalidReason = historicalAnomaly?.isAnomaly && historicalAnomaly.reason
            ? historicalAnomaly.reason
            : failureCategory
                ? buildInvalidReason(failureCategory)
                : '';
        return {
            id: asset.assetId,
            assetId: asset.assetId,
            assetName: matched.assetName || asset.assetName,
            ticker: (matched.ticker || asset.ticker).toUpperCase(),
            assetType: matched.assetType || asset.assetType,
            price: isValid ? nextPrice : nextPrice,
            currency: (matched.currency || asset.currency).toUpperCase(),
            asOf: effectiveAsOf || '',
            sourceName: matched.sourceName || '',
            sourceUrl: matched.sourceUrl || '',
            isValid,
            currentPrice: asset.currentPrice,
            diffPct,
            failureCategory,
            invalidReason,
            status: isValid ? 'confirmed' : 'pending',
        };
    }));
}
export function getUpdatePricesErrorResponse(error) {
    if (error instanceof UpdatePricesError) {
        return {
            status: error.status,
            body: {
                ok: false,
                route: UPDATE_PRICES_ROUTE,
                message: error.message,
            },
        };
    }
    if (error instanceof Error) {
        return {
            status: 500,
            body: {
                ok: false,
                route: UPDATE_PRICES_ROUTE,
                message: error.message,
            },
        };
    }
    return {
        status: 500,
        body: {
            ok: false,
            route: UPDATE_PRICES_ROUTE,
            message: '價格更新失敗，請稍後再試。',
        },
    };
}
export async function generatePriceUpdates(payload) {
    const request = normalizeRequest(payload);
    // 注意：不在此處抓取匯率。由 cronUpdatePrices 統一抓取並持久化（P1-4 修正多餘請求）。
    const yahooAssets = request.assets.filter((asset) => asset.assetType === 'stock' ||
        asset.assetType === 'etf' ||
        asset.assetType === 'bond');
    const cryptoAssets = request.assets.filter((asset) => asset.assetType === 'crypto');
    const [yahooResults, cryptoResults] = await Promise.all([
        fetchYahooPrice(yahooAssets),
        fetchCoinGeckoPrice(cryptoAssets),
    ]);
    const results = await buildReviewResults(request.assets, [...yahooResults, ...cryptoResults]);
    return {
        ok: true,
        route: UPDATE_PRICES_ROUTE,
        mode: 'live',
        model: 'market-api',
        results,
    };
}
