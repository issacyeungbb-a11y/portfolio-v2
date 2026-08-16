const DEFAULT_DAYS = 30;
const MAX_DAYS = 365;
const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';

type UnknownRecord = Record<string, unknown>;

export type PublicTransactionQuery = {
  days: number;
  startDate: string;
  endDate: string;
  symbol: string;
};

export type PublicTransactionRecord = {
  id: string;
  assetId: string;
  assetName: string;
  symbol: string;
  assetType: string;
  accountSource: string;
  settlementAccountSource: string;
  transactionType: 'buy' | 'sell';
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  date: string;
  realizedPnlHKD: number;
  quantityAfter: number;
  averageCostAfter: number;
  note: string;
  recordType: 'trade';
  createdAt: string;
  updatedAt: string;
  positionStatus: 'open' | 'closed';
  currentAsset?: {
    currentPrice: number;
    currentQuantity: number;
    currentAverageCost: number;
    marketValue: number;
    unrealizedPnl: number;
    unrealizedPct: number;
    priceAsOf: string;
  };
  performanceSinceTradePct?: number;
  sellTimingPct?: number;
};

function toFiniteNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function toIsoString(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value && typeof value === 'object' && 'toDate' in value) {
    const toDate = (value as { toDate?: unknown }).toDate;
    if (typeof toDate === 'function') {
      const date = toDate.call(value) as unknown;
      return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
    }
  }

  return '';
}

function isValidDateKey(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function addUtcDays(dateKey: string, dayDelta: number) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + dayDelta);
  return date.toISOString().slice(0, 10);
}

export function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: HONG_KONG_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function parsePublicTransactionQuery(
  requestUrl: string,
  now = new Date(),
): PublicTransactionQuery {
  const url = new URL(requestUrl, 'http://localhost');
  const requestedDays = Math.trunc(Number(url.searchParams.get('days')));
  const days = Number.isFinite(requestedDays) && requestedDays > 0
    ? Math.min(requestedDays, MAX_DAYS)
    : DEFAULT_DAYS;
  const today = getHongKongDateKey(now);
  const requestedFrom = url.searchParams.get('from')?.trim() ?? '';
  const requestedTo = url.searchParams.get('to')?.trim() ?? '';
  const hasExplicitRange = isValidDateKey(requestedFrom) && isValidDateKey(requestedTo);
  const rangeStart = hasExplicitRange ? requestedFrom : addUtcDays(today, -days);
  const rangeEnd = hasExplicitRange ? requestedTo : today;

  return {
    days,
    startDate: rangeStart <= rangeEnd ? rangeStart : rangeEnd,
    endDate: rangeStart <= rangeEnd ? rangeEnd : rangeStart,
    symbol: (url.searchParams.get('symbol')?.trim() ?? '').toUpperCase(),
  };
}

function buildCurrentAsset(value: UnknownRecord) {
  const assetType = toStringValue(value.assetType);
  const currentPrice = toFiniteNumber(value.currentPrice);
  const currentQuantity = toFiniteNumber(value.quantity);
  const currentAverageCost = toFiniteNumber(value.averageCost);
  const fallbackMarketValue = assetType === 'cash'
    ? currentPrice
    : currentQuantity * currentPrice;
  const marketValue = value.marketValue == null
    ? fallbackMarketValue
    : toFiniteNumber(value.marketValue);
  const costBasis = assetType === 'cash'
    ? currentAverageCost
    : currentQuantity * currentAverageCost;
  const unrealizedPnl = value.unrealizedPnl == null
    ? marketValue - costBasis
    : toFiniteNumber(value.unrealizedPnl);
  const unrealizedPct = value.unrealizedPct == null
    ? (costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100)
    : toFiniteNumber(value.unrealizedPct);

  return {
    currentPrice,
    currentQuantity,
    currentAverageCost,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    priceAsOf: toIsoString(value.priceAsOf) || toIsoString(value.lastPriceUpdatedAt),
  };
}

function isClosedAsset(value: UnknownRecord | undefined) {
  if (!value) {
    return true;
  }

  return Boolean(value.archivedAt) || value.archived === true || toFiniteNumber(value.quantity) <= 0;
}

export function buildPublicTransactions(
  transactionDocuments: Array<{ id: string; data: UnknownRecord }>,
  assetDocuments: Array<{ id: string; data: UnknownRecord }>,
  query: PublicTransactionQuery,
) {
  const assetsById = new Map(assetDocuments.map((entry) => [entry.id, entry.data]));

  return transactionDocuments
    .filter(({ data }) => data.recordType === 'trade')
    .filter(({ data }) => data.transactionType === 'buy' || data.transactionType === 'sell')
    .filter(({ data }) => {
      const date = toStringValue(data.date);
      return date >= query.startDate && date <= query.endDate;
    })
    .filter(({ data }) => !query.symbol || toStringValue(data.symbol).toUpperCase() === query.symbol)
    .map<PublicTransactionRecord>(({ id, data }) => {
      const assetId = toStringValue(data.assetId);
      const transactionType = data.transactionType as 'buy' | 'sell';
      const price = toFiniteNumber(data.price);
      const asset = assetsById.get(assetId);
      const currentAsset = asset ? buildCurrentAsset(asset) : undefined;
      const timingPct = price > 0 && currentAsset
        ? ((currentAsset.currentPrice - price) / price) * 100
        : undefined;

      return {
        id,
        assetId,
        assetName: toStringValue(data.assetName),
        symbol: toStringValue(data.symbol),
        assetType: toStringValue(data.assetType),
        accountSource: toStringValue(data.accountSource),
        settlementAccountSource: toStringValue(data.settlementAccountSource),
        transactionType,
        quantity: toFiniteNumber(data.quantity),
        price,
        fees: toFiniteNumber(data.fees),
        currency: toStringValue(data.currency),
        date: toStringValue(data.date),
        realizedPnlHKD: toFiniteNumber(data.realizedPnlHKD),
        quantityAfter: toFiniteNumber(data.quantityAfter),
        averageCostAfter: toFiniteNumber(data.averageCostAfter),
        note: toStringValue(data.note),
        recordType: 'trade',
        createdAt: toIsoString(data.createdAt),
        updatedAt: toIsoString(data.updatedAt),
        positionStatus: isClosedAsset(asset) ? 'closed' : 'open',
        ...(currentAsset ? { currentAsset } : {}),
        ...(timingPct == null
          ? {}
          : transactionType === 'buy'
            ? { performanceSinceTradePct: timingPct }
            : { sellTimingPct: -timingPct }),
      };
    })
    .sort((left, right) => right.date.localeCompare(left.date) || right.id.localeCompare(left.id));
}

export async function readPublicPortfolioTransactions(query: PublicTransactionQuery) {
  const { getSharedPortfolioDocRef } = await import('./firebaseAdmin.js');
  const portfolioRef = getSharedPortfolioDocRef();
  const transactionQuery = portfolioRef
    .collection('assetTransactions')
    .where('date', '>=', query.startDate)
    .where('date', '<=', query.endDate)
    .orderBy('date', 'desc');
  const [transactionSnapshot, assetSnapshot] = await Promise.all([
    transactionQuery.get(),
    portfolioRef.collection('assets').get(),
  ]);
  const transactions = buildPublicTransactions(
    transactionSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
    assetSnapshot.docs.map((document) => ({ id: document.id, data: document.data() })),
    query,
  );
  const assetsTraded = [...new Set(transactions.map((transaction) => transaction.symbol).filter(Boolean))];

  return {
    days: query.days,
    startDate: query.startDate,
    endDate: query.endDate,
    transactionCount: transactions.length,
    summary: {
      totalTransactions: transactions.length,
      buyTransactions: transactions.filter((transaction) => transaction.transactionType === 'buy').length,
      sellTransactions: transactions.filter((transaction) => transaction.transactionType === 'sell').length,
      uniqueAssets: new Set(transactions.map((transaction) => transaction.assetId || `${transaction.accountSource}:${transaction.symbol}`)).size,
    },
    assetsTraded,
    transactions,
  };
}
