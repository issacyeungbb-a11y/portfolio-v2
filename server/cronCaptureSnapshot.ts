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

function getHoursSinceUpdate(value?: string) {
  if (!value) {
    return Number.POSITIVE_INFINITY;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
}

function isFallbackUsable(asset: Awaited<ReturnType<typeof readAdminPortfolioAssets>>[number], todayKey: string) {
  if (!asset.currentPrice || asset.currentPrice <= 0) {
    return false;
  }

  const lastUpdated = asset.lastPriceUpdatedAt ? new Date(asset.lastPriceUpdatedAt) : undefined;
  const updatedKey = getHongKongDateKeyFromTimestamp(lastUpdated);

  if (updatedKey === todayKey) {
    return true;
  }

  const hoursSinceUpdate = getHoursSinceUpdate(asset.lastPriceUpdatedAt);

  if (asset.assetType === 'crypto') {
    return hoursSinceUpdate <= 36;
  }

  return hoursSinceUpdate <= 48;
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
  const fallbackAssets = staleAssets.filter((asset) => isFallbackUsable(asset, todayKey));
  const missingAssets = staleAssets.filter((asset) => !isFallbackUsable(asset, todayKey));
  const coveragePct =
    nonCashAssets.length === 0
      ? 100
      : Math.round(((nonCashAssets.length - missingAssets.length) / nonCashAssets.length) * 100);
  const canUseFallback =
    reviewSnapshot.size === 0 &&
    nonCashAssets.length > 0 &&
    (missingAssets.length <= 2 || coveragePct >= 95);

  return {
    todayKey,
    totalAssets: nonCashAssets.length,
    readyAssets: nonCashAssets.length - staleAssets.length,
    fallbackAssets,
    fallbackAssetCount: fallbackAssets.length,
    missingAssets,
    missingAssetCount: missingAssets.length,
    coveragePct,
    pendingReviewCount: reviewSnapshot.size,
    staleAssets,
    isReady: staleAssets.length === 0 && reviewSnapshot.empty,
    canUseFallback,
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

  if (readiness.isReady) {
    const snapshotId = buildDailySnapshotId();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: 'daily_snapshot',
      snapshotQuality: 'strict',
      coveragePct: 100,
      fallbackAssetCount: 0,
    });

    return {
      ok: true,
      route: CRON_ROUTE,
      message: `已建立每日資產快照，覆蓋 ${result.assetCount} 項資產。`,
      assetCount: result.assetCount,
      totalValueHKD: result.totalValueHKD,
      snapshotId,
      snapshotQuality: 'strict' as const,
      coveragePct: 100,
      triggeredAt: new Date().toISOString(),
    };
  }

  if (readiness.canUseFallback) {
    const snapshotId = buildDailySnapshotId();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: 'daily_snapshot_fallback',
      snapshotQuality: 'fallback',
      coveragePct: readiness.coveragePct,
      fallbackAssetCount: readiness.missingAssetCount,
    });

    return {
      ok: true,
      route: CRON_ROUTE,
      message: `已建立降級每日快照：覆蓋率 ${readiness.coveragePct}%，沿用 ${readiness.missingAssetCount} 項最近有效價格。`,
      assetCount: result.assetCount,
      totalValueHKD: result.totalValueHKD,
      snapshotId,
      snapshotQuality: 'fallback' as const,
      coveragePct: readiness.coveragePct,
      fallbackAssetCount: readiness.missingAssetCount,
      fallbackAssetSymbols: readiness.missingAssets.map((asset) => asset.symbol).slice(0, 10),
      triggeredAt: new Date().toISOString(),
    };
  }

  return {
    ok: true,
    skipped: true,
    route: CRON_ROUTE,
    message: `已跳過每日資產快照：價格更新未完成（${readiness.readyAssets}/${readiness.totalAssets} 已更新，待處理 ${readiness.pendingReviewCount} 項）。`,
    snapshotId: null,
    assetCount: readiness.totalAssets,
    readyAssets: readiness.readyAssets,
    pendingReviewCount: readiness.pendingReviewCount,
    coveragePct: readiness.coveragePct,
    staleAssetSymbols: readiness.staleAssets.map((asset) => asset.symbol).slice(0, 10),
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
