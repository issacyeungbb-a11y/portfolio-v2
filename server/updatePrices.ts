import yahooFinance from 'yahoo-finance2';

import type {
  PendingPriceUpdateReview,
  PriceUpdateRequest,
  PriceUpdateRequestAsset,
  PriceUpdateResponse,
} from '../src/types/priceUpdates';
import type { AssetType } from '../src/types/portfolio';
import type { FxRates } from '../src/types/fxRates';

const UPDATE_PRICES_ROUTE = '/api/update-prices' as const;
const DEFAULT_STOCK_DIFF_THRESHOLD = 0.15;
const DEFAULT_CRYPTO_DIFF_THRESHOLD = 0.3;
const DEFAULT_FX_RATES = {
  USD: 7.8,
  JPY: 0.052,
  HKD: 1,
} as const;
const YAHOO_SOURCE_NAME = 'Yahoo Finance';
const YAHOO_SOURCE_URL = 'https://finance.yahoo.com';
const COINGECKO_SOURCE_NAME = 'CoinGecko';
const COINGECKO_SOURCE_URL = 'https://www.coingecko.com';
const yahooFinanceClient = yahooFinance as unknown as {
  quote: (
    symbols: string | string[],
    options?: Record<string, unknown>,
  ) => Promise<Array<Record<string, unknown>>>;
};

const COINGECKO_ID_MAP: Record<string, string> = {
  ADA: 'cardano',
  ASTER: 'aster',
  ATONE: 'atone',
  BNB: 'binancecoin',
  BTC: 'bitcoin',
  ETH: 'ethereum',
  KAS: 'kaspa',
  NIGHT: 'midnight',
  SOL: 'solana',
  SUI: 'sui',
};

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

function getReviewThresholdForAsset(assetType: AssetType) {
  return assetType === 'crypto'
    ? DEFAULT_CRYPTO_DIFF_THRESHOLD
    : DEFAULT_STOCK_DIFF_THRESHOLD;
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
  };
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
    const quotes = await yahooFinanceClient.quote(['USDHKD=X', 'USDJPY=X'], {
      fields: ['symbol', 'regularMarketPrice'],
      return: 'array',
    });
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
    const quotes = await yahooFinanceClient.quote(symbols, {
      fields: [
        'symbol',
        'currency',
        'marketState',
        'regularMarketPrice',
        'regularMarketTime',
      ],
      return: 'array',
    });

    const quoteBySymbol = new Map(
      quotes.map((quote) => [(readStringValue(quote.symbol) ?? '').toUpperCase(), quote] as const),
    );

    return symbols.map((symbol) => {
      const asset = symbolToAsset.get(symbol)!;
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
  } catch (error) {
    return assets.map((asset) =>
      createFailedMarketResult(asset, `${YAHOO_SOURCE_NAME} 查詢失敗`, YAHOO_SOURCE_URL),
    );
  }
}

async function fetchCoinGeckoPrice(
  assets: PriceUpdateRequestAsset[],
): Promise<MarketPriceResult[]> {
  if (assets.length === 0) {
    return [];
  }

  const idToAsset = new Map<string, PriceUpdateRequestAsset>();
  const unresolvedAssets: PriceUpdateRequestAsset[] = [];

  for (const asset of assets) {
    const id = COINGECKO_ID_MAP[asset.ticker.toUpperCase()];
    if (!id) {
      unresolvedAssets.push(asset);
      continue;
    }

    idToAsset.set(id, asset);
  }

  const resolvedIds = Array.from(idToAsset.keys());
  const headers: Record<string, string> = {};
  const apiKey = process.env.COINGECKO_API_KEY?.trim();
  if (apiKey) {
    headers['x-cg-demo-api-key'] = apiKey;
  }

  const resolvedResults: MarketPriceResult[] = [];

  if (resolvedIds.length > 0) {
    try {
      const response = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(
          resolvedIds.join(','),
        )}&vs_currencies=usd&include_last_updated_at=true`,
        {
          headers,
          signal: AbortSignal.timeout(15000),
        },
      );

      if (!response.ok) {
        throw new Error(`CoinGecko HTTP ${response.status}`);
      }

      const payload = (await response.json()) as Record<
        string,
        { usd?: number; last_updated_at?: number }
      >;

      for (const id of resolvedIds) {
        const asset = idToAsset.get(id)!;
        const entry = payload[id];

        if (!entry || entry.usd == null || entry.usd <= 0) {
          resolvedResults.push(
            createFailedMarketResult(asset, `${COINGECKO_SOURCE_NAME} 未返回有效價格`, COINGECKO_SOURCE_URL),
          );
          continue;
        }

        resolvedResults.push({
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
          sourceUrl: `${COINGECKO_SOURCE_URL}/en/coins/${id}`,
          marketState: 'CRYPTO',
        });
      }
    } catch (error) {
      resolvedResults.push(
        ...resolvedIds.map((id) =>
          createFailedMarketResult(
            idToAsset.get(id)!,
            `${COINGECKO_SOURCE_NAME} 查詢失敗`,
            COINGECKO_SOURCE_URL,
          ),
        ),
      );
    }
  }

  return [
    ...resolvedResults,
    ...unresolvedAssets.map((asset) =>
      createFailedMarketResult(asset, `${COINGECKO_SOURCE_NAME} 未設定對應 coin id`, COINGECKO_SOURCE_URL),
    ),
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
    return asset.assetType === 'crypto' &&
      !COINGECKO_ID_MAP[asset.ticker.toUpperCase()]
      ? 'source_missing'
      : 'price_missing';
  }

  if (staleQuote) {
    return 'quote_time';
  }

  if (!(matched?.sourceName || matched?.sourceUrl)) {
    return 'source_missing';
  }

  if (diffPct >= getReviewThresholdForAsset(asset.assetType)) {
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
    const staleQuote = isStaleQuote(matched.asOf, asset.assetType);
    const diffPct =
      nextPrice != null && asset.currentPrice > 0
        ? Math.abs(nextPrice - asset.currentPrice) / asset.currentPrice
        : 0;
    const isValid =
      nextPrice != null &&
      nextPrice > 0 &&
      !staleQuote &&
      Boolean(matched.sourceName || matched.sourceUrl) &&
      diffPct < getReviewThresholdForAsset(asset.assetType);
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
      asOf: matched.asOf || '',
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
