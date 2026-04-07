import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { captureAdminPortfolioSnapshot, readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { verifyCronRequest } from './cronUpdatePrices.js';

const CRON_ROUTE = '/api/cron-capture-snapshot' as const;

class CronSnapshotError extends Error {
  status: number;

  constructor(message: string, status = 500) {
    super(message);
    this.name = 'CronSnapshotError';
    this.status = status;
  }
}

function buildDailySnapshotId(date = new Date()) {
  const hkDate = getHongKongDateKey(date);

  return `daily-${hkDate}`;
}

function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getHongKongDateKeyFromTimestamp(value?: unknown) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return '';
  }

  return getHongKongDateKey(value);
}

async function verifyAssetsReadyForDailySnapshot() {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection('portfolio').doc('app');
  const assets = await readAdminPortfolioAssets();
  const reviewSnapshot = await portfolioRef.collection('priceUpdateReviews').where('status', '==', 'pending').get();
  const todayKey = getHongKongDateKey();
  const nonCashAssets = assets.filter((asset) => asset.assetType !== 'cash');
  const staleAssets = nonCashAssets.filter((asset) => {
    const lastUpdated = asset.lastPriceUpdatedAt ? new Date(asset.lastPriceUpdatedAt) : undefined;
    const updatedKey = getHongKongDateKeyFromTimestamp(lastUpdated);

    return !asset.currentPrice || updatedKey !== todayKey;
  });

  return {
    todayKey,
    totalAssets: nonCashAssets.length,
    readyAssets: nonCashAssets.length - staleAssets.length,
    pendingReviewCount: reviewSnapshot.size,
    staleAssets,
    isReady: staleAssets.length === 0 && reviewSnapshot.empty,
  };
}

export function verifySnapshotCronRequest(authorizationHeader?: string) {
  try {
    verifyCronRequest(authorizationHeader);
  } catch (error) {
    if (error instanceof Error) {
      throw new CronSnapshotError(error.message, (error as { status?: number }).status ?? 401);
    }

    throw error;
  }
}

export async function runScheduledDailySnapshot() {
  const readiness = await verifyAssetsReadyForDailySnapshot();

  if (!readiness.isReady) {
    return {
      ok: true,
      skipped: true,
      route: CRON_ROUTE,
      message: `已跳過每日資產快照：價格更新未完成（${readiness.readyAssets}/${readiness.totalAssets} 已更新，待處理 ${readiness.pendingReviewCount} 項）。`,
      snapshotId: null,
      assetCount: readiness.totalAssets,
      readyAssets: readiness.readyAssets,
      pendingReviewCount: readiness.pendingReviewCount,
      staleAssetSymbols: readiness.staleAssets.map((asset) => asset.symbol).slice(0, 10),
      triggeredAt: new Date().toISOString(),
    };
  }

  const snapshotId = buildDailySnapshotId();
  const result = await captureAdminPortfolioSnapshot({
    snapshotId,
    reason: 'daily_snapshot',
  });

  return {
    ok: true,
    route: CRON_ROUTE,
    message: `已建立每日資產快照，覆蓋 ${result.assetCount} 項資產。`,
    assetCount: result.assetCount,
    totalValueHKD: result.totalValueHKD,
    snapshotId,
    triggeredAt: new Date().toISOString(),
  };
}

export function getCronSnapshotErrorResponse(error: unknown) {
  if (error instanceof CronSnapshotError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route: CRON_ROUTE,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route: CRON_ROUTE,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route: CRON_ROUTE,
      message: '每日資產快照失敗，請稍後再試。',
    },
  };
}
