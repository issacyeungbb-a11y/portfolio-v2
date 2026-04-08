import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import {
  buildHoldingFromInput,
  getFirebaseAssetsErrorMessage,
} from './assets';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getRequiredFirebaseDb,
  getSharedAssetsCollectionRef,
  SHARED_PORTFOLIO_COLLECTION,
  SHARED_PORTFOLIO_DOC_ID,
} from './sharedPortfolio';
import { getPortfolioTotalValue } from '../../data/mockPortfolio';
import type {
  Holding,
  PortfolioPerformancePoint,
  PortfolioAssetInput,
  SnapshotHoldingPoint,
} from '../../types/portfolio';

type SnapshotReason = NonNullable<PortfolioPerformancePoint['reason']>;

function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function formatSnapshotDate(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    return value.length >= 10 ? value.slice(0, 10) : value;
  }

  return new Date().toISOString().slice(0, 10);
}

function formatSnapshotTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === 'string' && value) {
    return value;
  }

  return '';
}

function sanitizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sanitizeReason(value: unknown): SnapshotReason {
  if (
    value === 'asset_created' ||
    value === 'assets_imported' ||
    value === 'price_update_confirmed' ||
    value === 'snapshot' ||
    value === 'daily_snapshot' ||
    value === 'daily_snapshot_fallback' ||
    value === 'cash_flow_recorded'
  ) {
    return value;
  }

  return 'snapshot';
}

function normalizeSnapshotHolding(value: unknown): SnapshotHoldingPoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }

  const entry = value as Record<string, unknown>;

  return {
    assetId: typeof entry.assetId === 'string' ? entry.assetId : '',
    name: typeof entry.name === 'string' ? entry.name : '',
    symbol: typeof entry.symbol === 'string' ? entry.symbol : '',
    assetType:
      entry.assetType === 'stock' ||
      entry.assetType === 'etf' ||
      entry.assetType === 'bond' ||
      entry.assetType === 'crypto' ||
      entry.assetType === 'cash'
        ? entry.assetType
        : 'stock',
    accountSource:
      entry.accountSource === 'Futu' ||
      entry.accountSource === 'IB' ||
      entry.accountSource === 'Crypto' ||
      entry.accountSource === 'Other'
        ? entry.accountSource
        : 'Other',
    currency: typeof entry.currency === 'string' ? entry.currency : 'HKD',
    quantity: sanitizeNumber(entry.quantity),
    currentPrice: sanitizeNumber(entry.currentPrice),
    averageCost: sanitizeNumber(entry.averageCost),
    marketValueHKD: sanitizeNumber(entry.marketValueHKD),
  };
}

function normalizePortfolioSnapshot(
  id: string,
  value: Record<string, unknown>,
): PortfolioPerformancePoint {
  return {
    id,
    date: formatSnapshotDate(value.capturedAt ?? value.date),
    capturedAt: formatSnapshotTimestamp(value.capturedAt),
    totalValue: sanitizeNumber(value.totalValueHKD ?? value.totalValue),
    netExternalFlow: sanitizeNumber(value.netExternalFlowHKD ?? value.netExternalFlow),
    assetCount: sanitizeNumber(value.assetCount),
    holdings: Array.isArray(value.holdings)
      ? value.holdings
          .map((entry) => normalizeSnapshotHolding(entry))
          .filter((entry): entry is SnapshotHoldingPoint => entry !== null)
      : [],
    reason: sanitizeReason(value.reason),
    snapshotQuality: value.snapshotQuality === 'fallback' ? 'fallback' : 'strict',
    coveragePct: sanitizeNumber(value.coveragePct),
    fallbackAssetCount: sanitizeNumber(value.fallbackAssetCount),
  };
}

function getPortfolioSnapshotsCollectionRef() {
  const db = getRequiredFirebaseDb();
  return collection(
    db,
    SHARED_PORTFOLIO_COLLECTION,
    SHARED_PORTFOLIO_DOC_ID,
    'portfolioSnapshots',
  );
}

async function readCurrentPortfolioHoldings() {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const snapshot = await getDocs(getSharedAssetsCollectionRef());

  return snapshot.docs.map((entry) =>
    buildHoldingFromInput(entry.id, entry.data() as PortfolioAssetInput),
  );
}

export async function capturePortfolioSnapshot(params: {
  holdings?: Holding[];
  netExternalFlowHKD?: number;
  reason?: SnapshotReason;
  snapshotId?: string;
}) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const holdings = params.holdings ?? (await readCurrentPortfolioHoldings());
  const snapshotsCollection = getPortfolioSnapshotsCollectionRef();
  const snapshotRef = params.snapshotId
    ? doc(snapshotsCollection, params.snapshotId)
    : doc(snapshotsCollection);

  await setDoc(snapshotRef, {
    capturedAt: serverTimestamp(),
    date: getHongKongDateKey(),
    totalValueHKD: getPortfolioTotalValue(holdings, 'HKD'),
    netExternalFlowHKD: params.netExternalFlowHKD ?? 0,
    assetCount: holdings.length,
    holdings: holdings.map((holding) => ({
      assetId: holding.id,
      name: holding.name,
      symbol: holding.symbol,
      assetType: holding.assetType,
      accountSource: holding.accountSource,
      currency: holding.currency,
      quantity: holding.quantity,
      currentPrice: holding.currentPrice,
      averageCost: holding.averageCost,
      marketValueHKD: getPortfolioTotalValue([holding], 'HKD'),
    })),
    reason: params.reason ?? 'snapshot',
    updatedAt: serverTimestamp(),
  });
}

export function subscribeToPortfolioSnapshots(
  onData: (history: PortfolioPerformancePoint[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const snapshotsRef = getPortfolioSnapshotsCollectionRef();
  const snapshotsQuery = query(snapshotsRef, orderBy('capturedAt', 'asc'));

  return onSnapshot(
    snapshotsQuery,
    (snapshot) => {
      const history = snapshot.docs.map((entry) =>
        normalizePortfolioSnapshot(entry.id, entry.data() as Record<string, unknown>),
      );

      onData(history);
    },
    onError,
  );
}

export function getPortfolioSnapshotsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/portfolioSnapshots`。';
    }

    return error.message;
  }

  return getFirebaseAssetsErrorMessage(error);
}
