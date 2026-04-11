import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { fetchFxRates } from './updatePrices.js';
import type { AssetType, PortfolioAssetInput } from '../src/types/portfolio.js';

const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';

type AdminPortfolioAsset = PortfolioAssetInput & {
  lastPriceUpdatedAt?: string;
  archivedAt?: string;
};

function normalizeAssetType(value: unknown): AssetType {
  if (value === 'stock' || value === 'etf' || value === 'bond' || value === 'crypto' || value === 'cash') {
    return value;
  }

  return 'stock';
}

function convertToHKD(amount: number, currency: string, fxRates: { USD: number; JPY: number; HKD: number }) {
  const normalized = currency.trim().toUpperCase();

  if (normalized === 'USD') {
    return amount * fxRates.USD;
  }

  if (normalized === 'JPY') {
    return amount * fxRates.JPY;
  }

  return amount;
}

function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function validateDailySnapshotId(snapshotId: string) {
  if (!snapshotId) {
    throw new Error('snapshotId is required，必須使用 daily-YYYY-MM-DD 格式');
  }

  if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(snapshotId)) {
    throw new Error('snapshotId is required，必須使用 daily-YYYY-MM-DD 格式');
  }
}

function normalizeAssetInput(value: Record<string, unknown>): AdminPortfolioAsset {
  const lastPriceUpdatedAt =
    value.lastPriceUpdatedAt instanceof Timestamp
      ? value.lastPriceUpdatedAt.toDate().toISOString()
      : typeof value.lastPriceUpdatedAt === 'string'
        ? value.lastPriceUpdatedAt
        : undefined;
  const archivedAt =
    value.archivedAt instanceof Timestamp
      ? value.archivedAt.toDate().toISOString()
      : typeof value.archivedAt === 'string'
        ? value.archivedAt
        : undefined;

  return {
    name: typeof value.name === 'string' ? value.name : '',
    symbol: typeof value.symbol === 'string' ? value.symbol : '',
    assetType: normalizeAssetType(value.assetType),
    accountSource:
      value.accountSource === 'Futu' ||
      value.accountSource === 'IB' ||
      value.accountSource === 'Crypto' ||
      value.accountSource === 'Other'
        ? value.accountSource
        : 'Other',
    currency: typeof value.currency === 'string' ? value.currency : 'USD',
    quantity: typeof value.quantity === 'number' ? value.quantity : 0,
    averageCost: typeof value.averageCost === 'number' ? value.averageCost : 0,
    currentPrice: typeof value.currentPrice === 'number' ? value.currentPrice : 0,
    lastPriceUpdatedAt,
    archivedAt,
  };
}

export async function readAdminPortfolioAssets() {
  const db = getFirebaseAdminDb();
  const snapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('assets')
    .get();

  return snapshot.docs.map((document) => ({
    id: document.id,
    ...normalizeAssetInput(document.data() as Record<string, unknown>),
  })).filter((asset) => !asset.archivedAt);
}

export async function captureAdminPortfolioSnapshot(params: {
  netExternalFlowHKD?: number;
  reason?: string;
  snapshotId: string;
  snapshotQuality?: 'strict' | 'fallback';
  coveragePct?: number;
  fallbackAssetCount?: number;
}) {
  const db = getFirebaseAdminDb();
  const snapshotId = params.snapshotId?.trim();

  validateDailySnapshotId(snapshotId);

  const snapshotRef = db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('portfolioSnapshots')
    .doc(snapshotId);
  const existingSnapshot = await snapshotRef.get();

  if (existingSnapshot.exists) {
    return {
      skipped: true as const,
      reason: 'already_exists' as const,
    };
  }

  const holdings = await readAdminPortfolioAssets();
  const fxRates = await fetchFxRates();

  const holdingsPayload = holdings.map((holding) => ({
    assetId: holding.id,
    name: holding.name,
    symbol: holding.symbol,
    assetType: holding.assetType,
    accountSource: holding.accountSource,
    currency: holding.currency,
    quantity: holding.quantity,
    currentPrice: holding.currentPrice,
    averageCost: holding.averageCost,
    marketValueHKD: convertToHKD(
      holding.quantity * holding.currentPrice,
      holding.currency,
      fxRates,
    ),
  }));

  const totalValueHKD = holdingsPayload.reduce((sum, holding) => sum + holding.marketValueHKD, 0);

  await snapshotRef.set({
    capturedAt: FieldValue.serverTimestamp(),
    date: getHongKongDateKey(),
    totalValueHKD,
    netExternalFlowHKD: params.netExternalFlowHKD ?? 0,
    assetCount: holdings.length,
    holdings: holdingsPayload,
    reason: params.reason ?? 'daily_snapshot',
    snapshotQuality: params.snapshotQuality ?? 'strict',
    coveragePct: typeof params.coveragePct === 'number' ? params.coveragePct : 100,
    fallbackAssetCount: typeof params.fallbackAssetCount === 'number' ? params.fallbackAssetCount : 0,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    assetCount: holdings.length,
    totalValueHKD,
  };
}
