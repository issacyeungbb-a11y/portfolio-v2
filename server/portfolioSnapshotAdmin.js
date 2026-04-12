import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';

const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';

function normalizeAssetType(value) {
  if (value === 'stock' || value === 'etf' || value === 'bond' || value === 'crypto' || value === 'cash') {
    return value;
  }

  return 'stock';
}

function convertToHKD(amount, currency) {
  const normalized = typeof currency === 'string' ? currency.trim().toUpperCase() : 'HKD';

  if (normalized === 'USD') {
    return amount * 7.8;
  }

  if (normalized === 'JPY') {
    return amount * 0.052;
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

function validateDailySnapshotId(snapshotId) {
  if (!snapshotId) {
    throw new Error('snapshotId is required，必須使用 daily-YYYY-MM-DD 格式');
  }

  if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(snapshotId)) {
    throw new Error('snapshotId is required，必須使用 daily-YYYY-MM-DD 格式');
  }
}

function normalizeAssetInput(value) {
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
    ...normalizeAssetInput(document.data()),
  }));
}

export async function captureAdminPortfolioSnapshot(params = {}) {
  const db = getFirebaseAdminDb();
  const snapshotId = typeof params.snapshotId === 'string' ? params.snapshotId.trim() : '';
  validateDailySnapshotId(snapshotId);

  const snapshotRef = db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('portfolioSnapshots')
    .doc(snapshotId);

  const existingSnapshot = await snapshotRef.get();
  if (existingSnapshot.exists) {
    return {
      skipped: true,
      reason: 'already_exists',
    };
  }

  const holdings = await readAdminPortfolioAssets();

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
    marketValueHKD: convertToHKD(holding.quantity * holding.currentPrice, holding.currency),
  }));

  const totalValueHKD = holdingsPayload.reduce((sum, holding) => sum + holding.marketValueHKD, 0);

  await snapshotRef.set({
    capturedAt: FieldValue.serverTimestamp(),
    date: getHongKongDateKey(),
    totalValueHKD,
    netExternalFlowHKD: typeof params.netExternalFlowHKD === 'number' ? params.netExternalFlowHKD : 0,
    assetCount: holdings.length,
    holdings: holdingsPayload,
    reason: typeof params.reason === 'string' ? params.reason : 'snapshot',
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    assetCount: holdings.length,
    totalValueHKD,
  };
}
