import { sendJson, type ApiRequest, type ApiResponse } from '../server/apiShared.js';
import { getFirebaseAdminDb } from '../server/firebaseAdmin.js';

const ROUTE = '/api/portfolio-public';

type PublicAssetRecord = {
  id: string;
  name: string;
  symbol: string;
  assetType: string;
  accountSource: string;
  currency: string;
  quantity: number;
  averageCost: number;
  currentPrice: number;
  marketValue: number;
  unrealizedPnl: number;
  unrealizedPct: number;
  priceAsOf: string;
  lastPriceUpdatedAt: string;
};

function getConfiguredAccessCode() {
  return (
    process.env.VITE_PORTFOLIO_ACCESS_CODE?.trim() ||
    process.env.PORTFOLIO_ACCESS_CODE?.trim() ||
    ''
  );
}

function getQueryCode(request: ApiRequest) {
  try {
    return new URL(request.url ?? ROUTE, 'http://localhost').searchParams.get('code')?.trim() ?? '';
  } catch {
    return '';
  }
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toStringValue(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function formatTimestamp(value: unknown) {
  if (typeof value === 'string') {
    return value;
  }

  if (
    value &&
    typeof value === 'object' &&
    'toDate' in value &&
    typeof value.toDate === 'function'
  ) {
    const date = value.toDate() as Date;
    return Number.isNaN(date.getTime()) ? '' : date.toISOString();
  }

  return '';
}

function isArchived(value: Record<string, unknown>) {
  return Boolean(value.archivedAt) || value.archived === true;
}

function buildPublicAsset(id: string, value: Record<string, unknown>): PublicAssetRecord {
  const assetType = toStringValue(value.assetType);
  const quantity = toNumber(value.quantity);
  const averageCost = toNumber(value.averageCost);
  const currentPrice = toNumber(value.currentPrice);
  const fallbackMarketValue = assetType === 'cash' ? currentPrice : quantity * currentPrice;
  const marketValue = value.marketValue == null ? fallbackMarketValue : toNumber(value.marketValue);
  const costBasis = assetType === 'cash' ? averageCost : quantity * averageCost;
  const fallbackUnrealizedPnl = marketValue - costBasis;
  const unrealizedPnl =
    value.unrealizedPnl == null ? fallbackUnrealizedPnl : toNumber(value.unrealizedPnl);
  const unrealizedPct =
    value.unrealizedPct == null
      ? costBasis === 0
        ? 0
        : (unrealizedPnl / costBasis) * 100
      : toNumber(value.unrealizedPct);

  return {
    id,
    name: toStringValue(value.name),
    symbol: toStringValue(value.symbol),
    assetType,
    accountSource: toStringValue(value.accountSource),
    currency: toStringValue(value.currency),
    quantity,
    averageCost,
    currentPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    priceAsOf: formatTimestamp(value.priceAsOf),
    lastPriceUpdatedAt: formatTimestamp(value.lastPriceUpdatedAt),
  };
}

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'GET') {
    sendJson(response, 405, {
      ok: false,
      message: 'Method not allowed',
    });
    return;
  }

  const configuredCode = getConfiguredAccessCode();
  const requestCode = getQueryCode(request);

  if (!configuredCode || requestCode !== configuredCode) {
    sendJson(response, 401, {
      ok: false,
      message: 'Unauthorized',
    });
    return;
  }

  try {
    const snapshot = await getFirebaseAdminDb()
      .collection('portfolio')
      .doc('app')
      .collection('assets')
      .get();
    const assets = snapshot.docs
      .map((document) => ({
        id: document.id,
        value: document.data() as Record<string, unknown>,
      }))
      .filter((entry) => !isArchived(entry.value))
      .map((entry) => buildPublicAsset(entry.id, entry.value));

    response.setHeader('Cache-Control', 'no-store');
    sendJson(response, 200, {
      ok: true,
      assets,
    });
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to load portfolio assets',
    });
  }
}
