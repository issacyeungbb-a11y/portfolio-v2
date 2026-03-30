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
import type { Holding, PortfolioPerformancePoint, PortfolioAssetInput } from '../../types/portfolio';

type SnapshotReason = NonNullable<PortfolioPerformancePoint['reason']>;

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function formatSnapshotDate(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString().slice(0, 10);
  }

  if (typeof value === 'string') {
    return value;
  }

  return new Date().toISOString().slice(0, 10);
}

function sanitizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sanitizeReason(value: unknown): SnapshotReason {
  if (
    value === 'asset_created' ||
    value === 'assets_imported' ||
    value === 'price_update_confirmed' ||
    value === 'snapshot'
  ) {
    return value;
  }

  return 'snapshot';
}

function normalizePortfolioSnapshot(
  id: string,
  value: Record<string, unknown>,
): PortfolioPerformancePoint {
  return {
    id,
    date: formatSnapshotDate(value.capturedAt ?? value.date),
    totalValue: sanitizeNumber(value.totalValueHKD ?? value.totalValue),
    netExternalFlow: sanitizeNumber(value.netExternalFlowHKD ?? value.netExternalFlow),
    assetCount: sanitizeNumber(value.assetCount),
    reason: sanitizeReason(value.reason),
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
}) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const holdings = params.holdings ?? (await readCurrentPortfolioHoldings());
  const snapshotsCollection = getPortfolioSnapshotsCollectionRef();
  const snapshotRef = doc(snapshotsCollection);

  await setDoc(snapshotRef, {
    capturedAt: serverTimestamp(),
    date: new Date().toISOString().slice(0, 10),
    totalValueHKD: getPortfolioTotalValue(holdings, 'HKD'),
    netExternalFlowHKD: params.netExternalFlowHKD ?? 0,
    assetCount: holdings.length,
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
