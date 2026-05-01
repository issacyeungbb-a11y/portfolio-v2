import { FieldValue, Timestamp } from 'firebase-admin/firestore';

import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { fetchLiveFxRates } from './updatePrices.js';
import { withRetry } from './retry.js';
import { convertToHKDValue } from '../src/lib/currency.js';
import type { FxRates } from '../src/types/fxRates';
import type { AssetType, PortfolioAssetInput } from '../src/types/portfolio';

const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';

type AdminPortfolioAsset = PortfolioAssetInput & {
  priceAsOf?: string;
  lastPriceUpdatedAt?: string;
  archivedAt?: string;
};

function normalizeAssetType(value: unknown): AssetType {
  if (value === 'stock' || value === 'etf' || value === 'bond' || value === 'crypto' || value === 'cash') {
    return value;
  }

  return 'stock';
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
  const priceAsOf =
    value.priceAsOf instanceof Timestamp
      ? value.priceAsOf.toDate().toISOString()
      : typeof value.priceAsOf === 'string'
        ? value.priceAsOf
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
    priceAsOf,
    lastPriceUpdatedAt,
    archivedAt,
  };
}

/**
 * 讀取已持久化到 Firestore 的匯率（由 cron 主流程寫入）。
 * 優先讓 snapshot 使用與主流程相同的匯率，避免兩者不一致。
 */
export async function readPersistedFxRates(maxAgeMs = 24 * 60 * 60 * 1000): Promise<FxRates | null> {
  try {
    const db = getFirebaseAdminDb();
    const docSnap = await db
      .collection(SHARED_PORTFOLIO_COLLECTION)
      .doc(SHARED_PORTFOLIO_DOC_ID)
      .get();
    const data = docSnap.data()?.fxRates as Record<string, unknown> | undefined;
    if (!data) return null;
    const updatedAtRaw = data.updatedAt;
    const updatedAt =
      typeof updatedAtRaw === 'string'
        ? new Date(updatedAtRaw)
        : updatedAtRaw instanceof Timestamp
          ? updatedAtRaw.toDate()
          : null;
    if (!updatedAt || Number.isNaN(updatedAt.getTime()) || Date.now() - updatedAt.getTime() > maxAgeMs) {
      return null;
    }
    const USD = typeof data.USD === 'number' && data.USD > 0 ? data.USD : null;
    const JPY = typeof data.JPY === 'number' && data.JPY > 0 ? data.JPY : null;
    const HKD = typeof data.HKD === 'number' && data.HKD > 0 ? data.HKD : 1;
    if (!USD || !JPY) return null;
    return { USD, JPY, HKD };
  } catch {
    return null;
  }
}

/**
 * P0-3: 加入 withRetry 保護，Firestore transient error 最多重試 3 次。
 */
export async function readAdminPortfolioAssets() {
  return withRetry(
    async () => {
      const db = getFirebaseAdminDb();
      const snapshot = await db
        .collection(SHARED_PORTFOLIO_COLLECTION)
        .doc(SHARED_PORTFOLIO_DOC_ID)
        .collection('assets')
        .get();

      return snapshot.docs
        .map((document) => ({
          id: document.id,
          ...normalizeAssetInput(document.data() as Record<string, unknown>),
        }))
        .filter((asset) => !asset.archivedAt);
    },
    { attempts: 3, label: 'readAdminPortfolioAssets' },
  );
}

/**
 * P0-1: 新增 fxRates 參數，允許主流程傳入 pre-fetched 匯率，避免 snapshot 獨立再抓。
 * P0-2: 新增 fxRatesUsed / fxSource 欄位到 snapshot 文件，提升可追溯性。
 *
 * 匯率解析優先順序：
 *   1. params.fxRates（主流程傳入）— 'cron_pipeline'
 *   2. readPersistedFxRates()（Firestore 持久化值）— 'persisted'
 *   3. fetchLiveFxRates()（live fetch）— 'live'
 */
export async function captureAdminPortfolioSnapshot(params: {
  netExternalFlowHKD?: number;
  reason?: string;
  snapshotId: string;
  snapshotQuality?: 'strict' | 'fallback';
  coveragePct?: number;
  fallbackAssetCount?: number;
  missingAssetCount?: number;
  force?: boolean;
  fxRates?: FxRates;  // P0-1: pre-fetched rates from cron pipeline
  holdings?: Array<AdminPortfolioAsset & { id: string }>;
}) {
  const db = getFirebaseAdminDb();
  const snapshotId = params.snapshotId?.trim();

  validateDailySnapshotId(snapshotId);

  const snapshotRef = db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('portfolioSnapshots')
    .doc(snapshotId);

  if (!params.force) {
    const existingSnapshot = await snapshotRef.get();

    if (existingSnapshot.exists) {
      return {
        skipped: true as const,
        reason: 'already_exists' as const,
      };
    }
  }

  // P0-1: 匯率解析（三級 fallback）
  let fxSource: 'cron_pipeline' | 'persisted' | 'live';
  let fxRates: FxRates;

  if (params.fxRates) {
    fxRates = params.fxRates;
    fxSource = 'cron_pipeline';
  } else {
    const persisted = await readPersistedFxRates();
    if (persisted) {
      fxRates = persisted;
      fxSource = 'persisted';
    } else {
      fxRates = await withRetry(() => fetchLiveFxRates(), {
        attempts: 3,
        label: 'fetchLiveFxRates-snapshot',
      });
      fxSource = 'live';
    }
  }

  const holdings = params.holdings ?? await readAdminPortfolioAssets();

  const holdingsPayload = holdings.map((holding) => ({
    assetId: holding.id,
    name: holding.name,
    symbol: holding.symbol,
    assetType: holding.assetType,
    accountSource: holding.accountSource,
    currency: holding.currency,
    quantity: holding.quantity,
    currentPrice: holding.currentPrice,
    priceAsOf: holding.lastPriceUpdatedAt ?? null,  // P2-6: 追溯價格時間
    averageCost: holding.averageCost,
    marketValueHKD: convertToHKDValue(
      holding.quantity * holding.currentPrice,
      holding.currency,
      fxRates as unknown as Record<string, number>,
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
    missingAssetCount: typeof params.missingAssetCount === 'number' ? params.missingAssetCount : 0,
    // P0-2: 記錄當次 snapshot 使用的匯率，提升可追溯性
    fxRatesUsed: {
      USD: fxRates.USD,
      JPY: fxRates.JPY,
      HKD: fxRates.HKD ?? 1,
    },
    fxSource,
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    assetCount: holdings.length,
    totalValueHKD,
  };
}
