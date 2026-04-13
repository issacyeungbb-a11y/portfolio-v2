import YahooFinance from 'yahoo-finance2';

import {
  getFirebaseAdminDb,
  getSharedCoinGeckoCoinIdCacheDocRef,
  getSharedCoinGeckoCoinIdCacheDocRefs,
} from './firebaseAdmin.js';
import type {
  PendingPriceUpdateReview,
  PriceUpdateRequest,
  PriceUpdateRequestAsset,
  PriceUpdateResponse,
} from '../src/types/priceUpdates';
import type { AssetType } from '../src/types/portfolio';
import type { FxRates } from '../src/types/fxRates';

const UPDATE_PRICES_ROUTE = '/api/update-prices' as const;
const DEFAULT_STOCK_DIFF_THRESHOLD = 0.5;
const DEFAULT_CRYPTO_DIFF_THRESHOLD = 0.8;
const DEFAULT_FX_RATES = {
  USD: 7.8,
  JPY: 0.052,
  HKD: 1,
} as const;
const YAHOO_SOURCE_NAME = 'Yahoo Finance';
const YAHOO_SOURCE_URL = 'https://finance.yahoo.com';
const COINGECKO_SOURCE_NAME = 'CoinGecko';
const COINGECKO_SOURCE_URL = 'https://www.coingecko.com';
const COINGECKO_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const COINGECKO_SEARCH_MIN_INTERVAL_MS = 2100;
const YAHOO_PRICE_TIMEOUT_MS = 12000;
const YAHOO_SINGLE_PRICE_TIMEOUT_MS = 8000;
const YAHOO_FX_TIMEOUT_MS = 12000;
const COINGECKO_ON_DEMAND_RESOLVE_LIMIT = 5;
const COINGECKO_ON_DEMAND_RESOLVE_TIMEOUT_MS = 3000;
const yahooFinanceClient = new YahooFinance();

const COINGECKO_ID_OVERRIDES: Record<string, { coinId: string }> = {
  ASTER: { coinId: 'aster-2' },
  ATONE: { coinId: 'atomone' },
  NIGHT: { coinId: 'night' },
};

interface CoinGeckoSearchCoin {
  id: string;
  symbol: string;
  name: string;
  market_cap_rank: number | null;
}

interface CoinGeckoCoinIdCacheEntry {
  ticker: string;
  coinId: string;
  coinSymbol: string;
  coinName: string;
  marketCapRank: number | null;
  source: 'override' | 'search';
  updatedAt: string;
  expiresAt: string;
}

interface MarketPriceResult {
  assetId: string;
  assetName: string;
  ticker: string;
  assetType: AssetType;
  price: number | null;
  currency: string | null;
  asOf: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  marketState?: string | null;
  coinGeckoLookupStatus?: 'override' | 'cache' | 'search' | 'fallback_cache' | 'missing' | 'lookup_failed';
}

function readStringValue(value: unknown) {
  return typeof value === 'string' ? value : null;
}

function readPositiveNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function readDateValue(value: unknown) {
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

function normalizeCoinGeckoTicker(ticker: string) {
  return ticker.trim().toUpperCase();
}

function parseCoinGeckoCacheExpiry(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function serializeCoinGeckoCacheEntry(entry: CoinGeckoCoinIdCacheEntry) {
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

function normalizeCoinGeckoCacheEntry(
  ticker: string,
  value: Record<string, unknown>,
): CoinGeckoCoinIdCacheEntry | null {
  const coinId = readStringValue(value.coinId)?.trim();
  const coinSymbol = readStringValue(value.coinSymbol)?.trim();
  const coinName = readStringValue(value.coinName)?.trim();
  const source = value.source === 'override' || value.source === 'search' ? value.source : null;
  const updatedAt = readDateValue(value.updatedAt);
  const expiresAt = readDateValue(value.expiresAt);
  const marketCapRank =
    typeof value.marketCapRank === 'number' && Number.isFinite(value.marketCapRank)
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

function isFreshCoinGeckoCacheEntry(entry: CoinGeckoCoinIdCacheEntry) {
  const parsedExpiresAt = parseCoinGeckoCacheExpiry(entry.expiresAt);
  return parsedExpiresAt ? parsedExpiresAt.getTime() > Date.now() : false;
}

export function isCoinGeckoCacheEntryFresh(entry: CoinGeckoCoinIdCacheEntry) {
  return isFreshCoinGeckoCacheEntry(entry);
}

function isCacheOverride(entry: CoinGeckoCoinIdCacheEntry) {
  return entry.source === 'override';
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readCoinGeckoCacheEntries(tickers: string[]) {
  if (tickers.length === 0) {
    return new Map<string, CoinGeckoCoinIdCacheEntry>();
  }

  const db = getFirebaseAdminDb();
  const docRefs = getSharedCoinGeckoCoinIdCacheDocRefs(tickers);
  const snapshots = await db.getAll(...docRefs);
  const cacheEntries = new Map<string, CoinGeckoCoinIdCacheEntry>();

  snapshots.forEach((snapshot, index) => {
    if (!snapshot.exists) {
      return;
    }

    const ticker = normalizeCoinGeckoTicker(tickers[index] ?? '');
    const cached = normalizeCoinGeckoCacheEntry(
      ticker,
      snapshot.data() as Record<string, unknown>,
    );

    if (cached) {
      cacheEntries.set(ticker, cached);
    }
  });

  return cacheEntries;
}

export async function readCoinGeckoCacheEntriesForTickers(tickers: string[]) {
  return readCoinGeckoCacheEntries(tickers);
}

const coinGeckoCoinIdMemoryCache = new Map<string, CoinGeckoCoinIdCacheEntry>();
let lastCoinGeckoSearchAt = 0;

async function throttleCoinGeckoSearch() {
  const elapsed = Date.now() - lastCoinGeckoSearchAt;

  if (elapsed < COINGECKO_SEARCH_MIN_INTERVAL_MS) {
    await sleep(COINGECKO_SEARCH_MIN_INTERVAL_MS - elapsed);
  }

  lastCoinGeckoSearchAt = Date.now();
}

function pickBestCoinGeckoSearchCoin(
  coins: CoinGeckoSearchCoin[],
  ticker: string,
): CoinGeckoSearchCoin | null {
  if (coins.length === 0) {
    return null;
  }

  const normalizedTicker = normalizeCoinGeckoTicker(ticker);
  const exactMatches = coins.filter(
    (coin) => normalizeCoinGeckoTicker(coin.symbol) === normalizedTicker,
  );
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

async function readCoinGeckoCacheEntry(ticker: string) {
  try {
    const docRef = getSharedCoinGeckoCoinIdCacheDocRef(ticker);
    const snapshot = await docRef.get();

    if (!snapshot.exists) {
      return null;
    }

    const cached = normalizeCoinGeckoCacheEntry(
      normalizeCoinGeckoTicker(ticker),
      snapshot.data() as Record<string, unknown>,
    );

    if (cached) {
      coinGeckoCoinIdMemoryCache.set(cached.ticker, cached);
    }

    return cached;
  } catch (error) {
    console.warn(`Failed to read CoinGecko coin id cache for ${ticker}.`, error);
    return null;
  }
}

async function writeCoinGeckoCacheEntry(entry: CoinGeckoCoinIdCacheEntry) {
  try {
    const docRef = getSharedCoinGeckoCoinIdCacheDocRef(entry.ticker);
    await docRef.set(serializeCoinGeckoCacheEntry(entry), { merge: true });
    coinGeckoCoinIdMemoryCache.set(entry.ticker, entry);
  } catch (error) {
    console.warn(`Failed to write CoinGecko coin id cache for ${entry.ticker}.`, error);
  }
}

function createCoinGeckoCacheEntry(params: {
  ticker: string;
  coinId: string;
  coinSymbol: string;
  coinName: string;
  marketCapRank: number | null;
  source: 'override' | 'search';
}) {
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

async function fetchCoinGeckoSearchCoins(ticker: string) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(ticker)}`,
    {
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko search HTTP ${response.status}`);
  }

  const payload = (await response.json()) as { coins?: CoinGeckoSearchCoin[] };
  return Array.isArray(payload.coins) ? payload.coins : [];
}

async function fetchCoinGeckoCoinIdFromSearch(ticker: string) {
  await throttleCoinGeckoSearch();
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

export async function resolveCoinGeckoCoinId(ticker: string) {
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
      status: 'override' as const,
    };
  }

  const memoryEntry = coinGeckoCoinIdMemoryCache.get(normalizedTicker);
  if (memoryEntry && isFreshCoinGeckoCacheEntry(memoryEntry)) {
    return {
      entry: memoryEntry,
      status: memoryEntry.source === 'override' ? ('override' as const) : ('cache' as const),
    };
  }

  const cacheEntry = memoryEntry ?? (await readCoinGeckoCacheEntry(normalizedTicker));
  if (cacheEntry && isFreshCoinGeckoCacheEntry(cacheEntry)) {
    coinGeckoCoinIdMemoryCache.set(normalizedTicker, cacheEntry);
    return {
      entry: cacheEntry,
      status: cacheEntry.source === 'override' ? ('override' as const) : ('cache' as const),
    };
  }

  try {
    const resolvedEntry = await fetchCoinGeckoCoinIdFromSearch(normalizedTicker);

    if (resolvedEntry) {
      await writeCoinGeckoCacheEntry(resolvedEntry);
      return {
        entry: resolvedEntry,
        status: 'search' as const,
      };
    }

    if (cacheEntry) {
      return {
        entry: cacheEntry,
        status: 'fallback_cache' as const,
      };
    }

    return {
      entry: null,
      status: 'missing' as const,
    };
  } catch (error) {
    console.warn(`Failed to resolve CoinGecko coin id for ${normalizedTicker}.`, error);

    if (cacheEntry) {
      return {
        entry: cacheEntry,
        status: 'fallback_cache' as const,
      };
    }

    return {
      entry: null,
      status: 'lookup_failed' as const,
    };
  }
}

class UpdatePricesError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'UpdatePricesError';
    this.status = status;
  }
}

function normalizeAssetType(value: string): AssetType {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'stock') return 'stock';
  if (normalized === 'etf') return 'etf';
  if (normalized === 'bond') return 'bond';
  if (normalized === 'crypto') return 'crypto';
  return 'cash';
}

function normalizeRequestAsset(asset: unknown): PriceUpdateRequestAsset | null {
  if (typeof asset !== 'object' || asset === null) {
    return null;
  }

  const value = asset as Record<string, unknown>;

  if (
    typeof value.assetId !== 'string' ||
    typeof value.assetName !== 'string' ||
    typeof value.ticker !== 'string' ||
    typeof value.assetType !== 'string' ||
    typeof value.currentPrice !== 'number' ||
    typeof value.currency !== 'string'
  ) {
    return null;
  }

  return {
    assetId: value.assetId,
    assetName: value.assetName,
    ticker: value.ticker.trim().toUpperCase(),
    assetType: normalizeAssetType(value.assetType),
    currentPrice: value.currentPrice,
    currency: value.currency.trim().toUpperCase(),
    lastPriceUpdatedAt: typeof value.lastPriceUpdatedAt === 'string' ? value.lastPriceUpdatedAt : undefined,
  };
}

function normalizeRequest(payload: unknown): PriceUpdateRequest {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    !('assets' in payload) ||
    !Array.isArray(payload.assets)
  ) {
    throw new UpdatePricesError('價格更新請求格式不正確。', 400);
  }

  const assets = payload.assets
    .map((asset) => normalizeRequestAsset(asset))
    .filter((asset): asset is PriceUpdateRequestAsset => asset !== null)
    .filter((asset) => asset.assetType !== 'cash');

  if (assets.length === 0) {
    throw new UpdatePricesError('未提供可更新的資產。', 400);
  }

  return { assets };
}

function getReviewThresholdForAsset(assetType: AssetType, lastUpdatedAt?: string) {
  const base =
    assetType === 'crypto'
      ? DEFAULT_CRYPTO_DIFF_THRESHOLD
      : DEFAULT_STOCK_DIFF_THRESHOLD;

  if (!lastUpdatedAt) {
    return base * 3;
  }

  const parsed = new Date(lastUpdatedAt);
  if (Number.isNaN(parsed.getTime())) {
    return base * 3;
  }

  const hoursSinceUpdate = (Date.now() - parsed.getTime()) / (1000 * 60 * 60);
  if (hoursSinceUpdate > 72) {
    return base * 2.5;
  }

  if (hoursSinceUpdate > 24) {
    return base * 1.5;
  }

  return base;
}

function parseAsOf(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function getQuoteFreshnessWindowMs(assetType: AssetType) {
  return assetType === 'crypto'
    ? 72 * 60 * 60 * 1000
    : 5 * 24 * 60 * 60 * 1000;
}

function isStaleQuote(asOf: string | null | undefined, assetType: AssetType) {
  const parsed = parseAsOf(asOf);

  if (!parsed) {
    return true;
  }

  return Date.now() - parsed.getTime() > getQuoteFreshnessWindowMs(assetType);
}

function buildInvalidReason(
  category: NonNullable<PendingPriceUpdateReview['failureCategory']>,
) {
  if (category === 'ticker_format') return '代號格式可能有問題，未能準確對應市場報價';
  if (category === 'quote_time') return 'quote 時間過時，已拒絕使用';
  if (category === 'source_missing') return '來源不足，未提供可信來源名稱或網址';
  if (category === 'response_format') return 'API 回傳格式不正確，未能穩定解析';
  if (category === 'price_missing') return '未取得有效市場價格';
  if (category === 'diff_too_large') return '價格差距過大，需要人工檢查';
  return '價格更新失敗，請再檢查';
}

function createFailedMarketResult(
  asset: PriceUpdateRequestAsset,
  sourceName: string,
  sourceUrl = '',
  coinGeckoLookupStatus?: MarketPriceResult['coinGeckoLookupStatus'],
): MarketPriceResult {
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

type CoinGeckoPricePayload = Record<string, { usd?: number; last_updated_at?: number }>;

function buildCoinGeckoResultsForEntries(
  coinId: string,
  entry: { usd?: number; last_updated_at?: number } | undefined,
  entries: Array<{
    asset: PriceUpdateRequestAsset;
    status: NonNullable<MarketPriceResult['coinGeckoLookupStatus']>;
  }>,
): MarketPriceResult[] {
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

async function fetchCoinGeckoPricePayload(
  coinIds: string[],
  headers: Record<string, string>,
) {
  const response = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
      coinIds.join(','),
    )}&vs_currencies=usd&include_last_updated_at=true`,
    {
      headers,
      signal: AbortSignal.timeout(15000),
    },
  );

  if (!response.ok) {
    throw new Error(`CoinGecko HTTP ${response.status}`);
  }

  return (await response.json()) as CoinGeckoPricePayload;
}

async function raceWithTimeout<T>(
  work: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
) {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function normalizeYahooTicker(asset: PriceUpdateRequestAsset) {
  if (asset.assetType === 'crypto') {
    return asset.ticker.toUpperCase();
  }

  const normalizedTicker = asset.ticker.trim().toUpperCase();
  if (normalizedTicker.endsWith('.HK')) {
    return normalizedTicker;
  }

  if (asset.currency === 'HKD' && /^\d{1,5}$/.test(normalizedTicker)) {
    return `${normalizedTicker.padStart(4, '0')}.HK`;
  }

  return normalizedTicker;
}

export async function fetchLiveFxRates(): Promise<FxRates> {
  try {
    const quotes = await yahooFinanceClient.quote(
      ['USDHKD=X', 'USDJPY=X'],
      {
        fields: ['symbol', 'regularMarketPrice'],
        return: 'array',
      },
      {
        fetchOptions: { signal: AbortSignal.timeout(YAHOO_FX_TIMEOUT_MS) },
      },
    );
    const bySymbol = new Map(
      quotes.map((quote) => [readStringValue(quote.symbol) ?? '', quote] as const),
    );
    const usdToHkd = readPositiveNumber(bySymbol.get('USDHKD=X')?.regularMarketPrice);
    const usdToJpy = readPositiveNumber(bySymbol.get('USDJPY=X')?.regularMarketPrice);

    if (!usdToHkd || !usdToJpy) {
      throw new Error('missing fx quote');
    }

    return {
      USD: usdToHkd,
      JPY: usdToHkd / usdToJpy,
      HKD: 1,
    };
  } catch (error) {
    console.warn('Failed to fetch Yahoo Finance FX rates, using fallback rates.', error);
    return { ...DEFAULT_FX_RATES };
  }
}

export { fetchLiveFxRates as fetchFxRates };

function buildYahooResultFromQuote(
  asset: PriceUpdateRequestAsset,
  symbol: string,
  quote: Record<string, unknown> | undefined,
): MarketPriceResult {
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
    asOf: readDateValue(quote.regularMarketTime) ?? new Date().toISOString(),
    sourceName: YAHOO_SOURCE_NAME,
    sourceUrl: `${YAHOO_SOURCE_URL}/quote/${encodeURIComponent(symbol)}`,
    marketState: readStringValue(quote.marketState),
  };
}

async function fetchYahooPrice(
  assets: PriceUpdateRequestAsset[],
): Promise<MarketPriceResult[]> {
  if (assets.length === 0) {
    return [];
  }

  const symbolToAsset = new Map<string, PriceUpdateRequestAsset>();
  const symbols = assets.map((asset) => {
    const symbol = normalizeYahooTicker(asset);
    symbolToAsset.set(symbol, asset);
    return symbol;
  });

  try {
    const quotes = await yahooFinanceClient.quote(
      symbols,
      {
        fields: [
          'symbol',
          'currency',
          'marketState',
          'regularMarketPrice',
          'regularMarketTime',
        ],
        return: 'array',
      },
      {
        fetchOptions: { signal: AbortSignal.timeout(YAHOO_PRICE_TIMEOUT_MS) },
      },
    );

    const quoteBySymbol = new Map(
      quotes.map((quote) => [(readStringValue(quote.symbol) ?? '').toUpperCase(), quote] as const),
    );

    return symbols.map((symbol) => {
      const asset = symbolToAsset.get(symbol)!;
      const quote = quoteBySymbol.get(symbol.toUpperCase());
      return buildYahooResultFromQuote(asset, symbol, quote as Record<string, unknown> | undefined);
    });
  } catch (error) {
    console.warn('Yahoo Finance batch quote failed, retrying one-by-one.', error);
    const results: MarketPriceResult[] = [];

    for (const symbol of symbols) {
      const asset = symbolToAsset.get(symbol)!;

      try {
        const quotes = await yahooFinanceClient.quote(
          [symbol],
          {
            fields: ['symbol', 'currency', 'marketState', 'regularMarketPrice', 'regularMarketTime'],
            return: 'array',
          },
          {
            fetchOptions: { signal: AbortSignal.timeout(YAHOO_SINGLE_PRICE_TIMEOUT_MS) },
          },
        );

        results.push(
          buildYahooResultFromQuote(
            asset,
            symbol,
            (Array.isArray(quotes) ? quotes[0] : undefined) as Record<string, unknown> | undefined,
          ),
        );
      } catch (retryError) {
        console.warn(`Yahoo Finance single quote fallback failed for ${symbol}.`, retryError);
        results.push(
          createFailedMarketResult(asset, `${YAHOO_SOURCE_NAME} 查詢失敗`, YAHOO_SOURCE_URL),
        );
      }
    }

    return results;
  }
}

async function fetchCoinGeckoPrice(
  assets: PriceUpdateRequestAsset[],
): Promise<MarketPriceResult[]> {
  if (assets.length === 0) {
    return [];
  }

  const headers: Record<string, string> = {};
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const uniqueTickers = [...new Set(assets.map((asset) => normalizeCoinGeckoTicker(asset.ticker)))];
  const cacheEntries = await readCoinGeckoCacheEntries(uniqueTickers);
  const resolvedResults: MarketPriceResult[] = [];
  const unresolvedResults: MarketPriceResult[] = [];
  const missingAssetsByTicker = new Map<string, PriceUpdateRequestAsset[]>();
  const coinIdToAssets = new Map<
    string,
    Array<{ asset: PriceUpdateRequestAsset; status: NonNullable<MarketPriceResult['coinGeckoLookupStatus']> }>
  >();

  for (const asset of assets) {
    const normalizedTicker = normalizeCoinGeckoTicker(asset.ticker);
    const override = COINGECKO_ID_OVERRIDES[normalizedTicker];
    const cacheEntry = cacheEntries.get(normalizedTicker);
    const resolvedEntry = override
      ? createCoinGeckoCacheEntry({
          ticker: normalizedTicker,
          coinId: override.coinId,
          coinSymbol: normalizedTicker,
          coinName: normalizedTicker,
          marketCapRank: null,
          source: 'override',
        })
      : cacheEntry;

    if (!resolvedEntry) {
      unresolvedResults.push(
        createFailedMarketResult(asset, '', '', 'missing'),
      );
      const currentMissing = missingAssetsByTicker.get(normalizedTicker) ?? [];
      currentMissing.push(asset);
      missingAssetsByTicker.set(normalizedTicker, currentMissing);
      continue;
    }

    const current = coinIdToAssets.get(resolvedEntry.coinId) ?? [];
    current.push({
      asset,
      status: resolvedEntry.source === 'override' ? 'override' : 'cache',
    });
    coinIdToAssets.set(resolvedEntry.coinId, current);
  }

  const resolvedOnDemandAssetIds = new Set<string>();
  const onDemandTickers = Array.from(missingAssetsByTicker.keys()).slice(0, COINGECKO_ON_DEMAND_RESOLVE_LIMIT);

  for (const ticker of onDemandTickers) {
    try {
      const resolution = await raceWithTimeout(
        resolveCoinGeckoCoinId(ticker),
        COINGECKO_ON_DEMAND_RESOLVE_TIMEOUT_MS,
        `CoinGecko on-demand resolve timeout for ${ticker}`,
      );

      if (!resolution.entry) {
        continue;
      }

      const assetsForTicker = missingAssetsByTicker.get(ticker) ?? [];
      const current = coinIdToAssets.get(resolution.entry.coinId) ?? [];

      for (const asset of assetsForTicker) {
        current.push({
          asset,
          status: resolution.status,
        });
        resolvedOnDemandAssetIds.add(asset.assetId);
      }

      coinIdToAssets.set(resolution.entry.coinId, current);
    } catch (error) {
      console.warn(`CoinGecko on-demand resolve failed for ${ticker}.`, error);
    }
  }

  const resolvedCoinIds = Array.from(coinIdToAssets.keys());

  if (resolvedCoinIds.length > 0) {
    try {
      const payload = await fetchCoinGeckoPricePayload(resolvedCoinIds, headers);

      for (const coinId of resolvedCoinIds) {
        resolvedResults.push(
          ...buildCoinGeckoResultsForEntries(
            coinId,
            payload[coinId],
            coinIdToAssets.get(coinId) ?? [],
          ),
        );
      }
    } catch (error) {
      console.warn('CoinGecko batch price lookup failed, retrying coin-by-coin.', error);

      for (const coinId of resolvedCoinIds) {
        const entries = coinIdToAssets.get(coinId) ?? [];

        try {
          const payload = await fetchCoinGeckoPricePayload([coinId], headers);
          resolvedResults.push(
            ...buildCoinGeckoResultsForEntries(coinId, payload[coinId], entries),
          );
        } catch (coinError) {
          console.warn(`CoinGecko fallback lookup failed for ${coinId}.`, coinError);
          resolvedResults.push(
            ...entries.map(({ asset, status }) =>
              createFailedMarketResult(
                asset,
                '',
                '',
                status === 'override' ? 'override' : 'lookup_failed',
              ),
            ),
          );
        }
      }
    }
  }

  return [
    ...resolvedResults,
    ...unresolvedResults.filter((result) => !resolvedOnDemandAssetIds.has(result.assetId)),
  ];
}

function detectFailureCategory(params: {
  asset: PriceUpdateRequestAsset;
  matched?: MarketPriceResult;
  nextPrice: number | null;
  staleQuote: boolean;
  diffPct: number;
  isValid: boolean;
}) {
  const { asset, matched, nextPrice, staleQuote, diffPct, isValid } = params;

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

  if (diffPct >= getReviewThresholdForAsset(asset.assetType, asset.lastPriceUpdatedAt)) {
    return 'diff_too_large';
  }

  return 'unknown';
}

function buildReviewResults(
  requestedAssets: PriceUpdateRequestAsset[],
  marketResults: MarketPriceResult[],
): PendingPriceUpdateReview[] {
  return requestedAssets.map((asset) => {
    const matched =
      marketResults.find((item) => item.assetId === asset.assetId) ??
      createFailedMarketResult(asset, '未取得回應');
    const nextPrice = matched.price ?? null;
    const effectiveAsOf =
      matched.asOf || (nextPrice != null && nextPrice > 0 ? new Date().toISOString() : null);
    const staleQuote = isStaleQuote(effectiveAsOf, asset.assetType);
    const diffPct =
      nextPrice != null && asset.currentPrice > 0
        ? Math.abs(nextPrice - asset.currentPrice) / asset.currentPrice
        : 0;
    const isValid =
      nextPrice != null &&
      nextPrice > 0 &&
      !staleQuote &&
      Boolean(matched.sourceName || matched.sourceUrl) &&
      diffPct < getReviewThresholdForAsset(asset.assetType, asset.lastPriceUpdatedAt);
    const failureCategory = detectFailureCategory({
      asset,
      matched,
      nextPrice,
      staleQuote,
      diffPct,
      isValid,
    });
    const invalidReason = failureCategory ? buildInvalidReason(failureCategory) : '';

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
  });
}

export function getUpdatePricesErrorResponse(error: unknown) {
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

export async function generatePriceUpdates(payload: unknown): Promise<PriceUpdateResponse> {
  const request = normalizeRequest(payload);
  await fetchLiveFxRates();

  const yahooAssets = request.assets.filter(
    (asset) =>
      asset.assetType === 'stock' ||
      asset.assetType === 'etf' ||
      asset.assetType === 'bond',
  );
  const cryptoAssets = request.assets.filter((asset) => asset.assetType === 'crypto');

  const [yahooResults, cryptoResults] = await Promise.all([
    fetchYahooPrice(yahooAssets),
    fetchCoinGeckoPrice(cryptoAssets),
  ]);

  return {
    ok: true,
    route: UPDATE_PRICES_ROUTE,
    mode: 'live',
    model: 'market-api',
    results: buildReviewResults(request.assets, [...yahooResults, ...cryptoResults]),
  };
}
