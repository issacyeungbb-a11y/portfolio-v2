import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
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
export type TodaySnapshotStatus =
  | {
      exists: true;
      quality: 'strict' | 'fallback';
      capturedAt: string;
    }
  | {
      exists: false;
    };

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
  if (value === 'daily_snapshot' || value === 'daily_snapshot_fallback') {
    return value;
  }

  return 'daily_snapshot';
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

function buildTodaySnapshotId(date = new Date()) {
  return `daily-${getHongKongDateKey(date)}`;
}

function validateDailySnapshotId(snapshotId: string) {
  if (!snapshotId) {
    throw new Error('snapshotId is required，必須使用 daily-YYYY-MM-DD 格式');
  }

  if (!/^daily-\d{4}-\d{2}-\d{2}$/.test(snapshotId)) {
    throw new Error('snapshotId is required，必須使用 daily-YYYY-MM-DD 格式');
  }
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
  snapshotId: string;
}) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const snapshotId = params.snapshotId?.trim();
  validateDailySnapshotId(snapshotId);

  const snapshotsCollection = getPortfolioSnapshotsCollectionRef();
  const snapshotRef = doc(snapshotsCollection, snapshotId);
  const existingSnapshot = await getDoc(snapshotRef);

  if (existingSnapshot.exists()) {
    return {
      skipped: true as const,
      reason: 'already_exists' as const,
    };
  }

  const holdings = params.holdings ?? (await readCurrentPortfolioHoldings());

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
    reason: params.reason ?? 'daily_snapshot',
    updatedAt: serverTimestamp(),
  });

  return {
    skipped: false as const,
  };
}

export async function getTodaySnapshotStatus(): Promise<TodaySnapshotStatus> {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const snapshotRef = doc(getPortfolioSnapshotsCollectionRef(), buildTodaySnapshotId());
  const snapshot = await getDoc(snapshotRef);

  if (!snapshot.exists()) {
    return { exists: false };
  }

  const data = snapshot.data() as Record<string, unknown>;

  return {
    exists: true,
    quality: data.snapshotQuality === 'fallback' ? 'fallback' : 'strict',
    capturedAt: formatSnapshotTimestamp(data.capturedAt),
  };
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

export async function getRecentPortfolioSnapshots(count = 2) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const snapshot = await getDocs(
    query(getPortfolioSnapshotsCollectionRef(), orderBy('capturedAt', 'desc'), limit(count)),
  );

  return snapshot.docs.map((entry) =>
    normalizePortfolioSnapshot(entry.id, entry.data() as Record<string, unknown>),
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
