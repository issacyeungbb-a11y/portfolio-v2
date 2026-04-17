import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { captureAdminPortfolioSnapshot, readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { verifyCronRequest } from './cronAuth.js';
// SNAPSHOT_FALLBACK_WINDOW_MS 由 priceFreshness.js 集中管理（runtime）
// 此 TS 來源保留本地引用以供類型推導，數值需與 src/config/priceFreshness.ts 一致
import type { PendingPriceUpdateReview } from '../src/types/priceUpdates';
import type { FxRates } from '../src/types/fxRates';

const CRON_ROUTE = '/api/cron-capture-snapshot' as const;
const MANUAL_ROUTE = '/api/manual-capture-snapshot' as const;

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

/**
 * 快照降級時窗（TS 來源引用，runtime 使用 server/priceFreshness.js）。
 * 數值來源：src/config/priceFreshness.ts → SNAPSHOT_FALLBACK_WINDOW_MS（由 prebuild 同步）。
 */
const SNAPSHOT_FALLBACK_WINDOW_MS: Record<string, number> = {
  crypto: 72 * 60 * 60 * 1000,   // 72h
  stock:  96 * 60 * 60 * 1000,   // 4d (96h)
  etf:    96 * 60 * 60 * 1000,
  bond:   96 * 60 * 60 * 1000,
  cash:   Number.POSITIVE_INFINITY,
};

function isFallbackUsable(asset: Awaited<ReturnType<typeof readAdminPortfolioAssets>>[number], todayKey: string) {
  if (!asset.currentPrice || asset.currentPrice <= 0) {
    return false;
  }

  const lastUpdated = asset.lastPriceUpdatedAt ? new Date(asset.lastPriceUpdatedAt) : undefined;
  const updatedKey = getHongKongDateKeyFromTimestamp(lastUpdated);

  if (updatedKey === todayKey) {
    return true;
  }

  const windowHours = (SNAPSHOT_FALLBACK_WINDOW_MS[asset.assetType] ?? SNAPSHOT_FALLBACK_WINDOW_MS.stock) / (60 * 60 * 1000);
  const hoursSinceUpdate = getHoursSinceUpdate(asset.lastPriceUpdatedAt);
  return hoursSinceUpdate <= windowHours;
}

function sanitizeFailureCategory(value: unknown): PendingPriceUpdateReview['failureCategory'] {
  if (
    value === 'ticker_format' ||
    value === 'quote_time' ||
    value === 'source_missing' ||
    value === 'response_format' ||
    value === 'price_missing' ||
    value === 'confidence_low' ||
    value === 'diff_too_large' ||
    value === 'unknown'
  ) {
    return value;
  }

  return 'unknown';
}

function isSoftPendingCategory(category: PendingPriceUpdateReview['failureCategory']) {
  return (
    category === 'quote_time' ||
    category === 'source_missing' ||
    category === 'response_format' ||
    category === 'price_missing' ||
    category === 'confidence_low' ||
    category === 'diff_too_large'
  );
}

function parseReviewUpdatedAt(value: unknown) {
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }

  if (
    typeof value === 'object' &&
    value !== null &&
    'toDate' in value &&
    typeof (value as { toDate?: unknown }).toDate === 'function'
  ) {
    const parsed = (value as { toDate: () => Date }).toDate();
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

function createSnapshotStepTimings() {
  return {
    readinessMs: 0,
    snapshotWriteMs: 0,
  };
}

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
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
  const pendingReviews = reviewSnapshot.docs.map((document) => {
    const data = document.data() as Record<string, unknown>;

    return {
      assetId: document.id,
      failureCategory: sanitizeFailureCategory(data.failureCategory),
      updatedAt: parseReviewUpdatedAt(data.updatedAt),
    };
  });
  const fallbackAssetIds = new Set(fallbackAssets.map((asset) => asset.id));
  const hardPendingReviews = pendingReviews.filter((review) => {
    if (
      review.failureCategory === 'diff_too_large' &&
      review.updatedAt &&
      Date.now() - review.updatedAt.getTime() > 7 * 24 * 60 * 60 * 1000
    ) {
      return false;
    }

    if (!isSoftPendingCategory(review.failureCategory)) {
      return true;
    }

    return !fallbackAssetIds.has(review.assetId);
  });
  const softPendingReviews = pendingReviews.filter((review) => !hardPendingReviews.includes(review));
  const coveragePct =
    nonCashAssets.length === 0
      ? 100
      : Math.round(((nonCashAssets.length - missingAssets.length) / nonCashAssets.length) * 100);
  const canUseFallback =
    hardPendingReviews.length === 0 &&
    nonCashAssets.length > 0 &&
    (missingAssets.length <= 5 || coveragePct >= 80);

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
    softPendingReviewCount: softPendingReviews.length,
    hardPendingReviewCount: hardPendingReviews.length,
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

/**
 * P0-1: 接受 pre-fetched fxRates，讓 cron 主流程傳入已抓取的匯率，
 * 確保 snapshot 與價格更新階段使用相同匯率。
 */
export async function runScheduledDailySnapshot(fxRates?: FxRates) {
  return runDailySnapshotWorkflow('scheduled', fxRates);
}

/**
 * P0-5: 手動後補快照保護。
 * - 已有 strict snapshot → 跳過（唔覆蓋高品質數據）
 * - 已有 fallback snapshot / 冇 snapshot → 走正常 readiness check workflow
 *   若而家 coverage 足夠，可升級成 strict
 */
export async function runManualDailySnapshot() {
  const startedAt = Date.now();
  const snapshotId = buildDailySnapshotId();

  // Check existing snapshot quality before deciding how to proceed
  const db = getFirebaseAdminDb();
  const existingRef = db
    .collection('portfolio').doc('app')
    .collection('portfolioSnapshots').doc(snapshotId);
  const existing = await existingRef.get();
  const existingQuality = existing.exists
    ? (existing.data()?.snapshotQuality as string | undefined)
    : undefined;

  if (existingQuality === 'strict') {
    const payload = {
      ok: true,
      skipped: true,
      route: MANUAL_ROUTE,
      message: '今日已有 strict 品質快照，唔覆蓋。如需強制覆蓋，請先刪除現有快照。',
      snapshotId,
      reason: 'strict_already_exists',
      triggeredAt: new Date().toISOString(),
      durationMs: getDurationMs(startedAt),
    };
    console.info('[manual-capture-snapshot]', payload);
    return payload;
  }

  // No snapshot or fallback only → run normal readiness workflow (may upgrade to strict)
  return runDailySnapshotWorkflow('manual');
}

async function runDailySnapshotWorkflow(mode: 'scheduled' | 'manual', fxRates?: FxRates) {
  const startedAt = Date.now();
  const stepTimings = createSnapshotStepTimings();
  const readinessStartedAt = Date.now();
  const readiness = await verifyAssetsReadyForDailySnapshot();
  stepTimings.readinessMs = getDurationMs(readinessStartedAt);
  const snapshotReason = 'daily_snapshot';
  const fallbackReason = 'daily_snapshot_fallback';
  const route = mode === 'manual' ? MANUAL_ROUTE : CRON_ROUTE;

  if (readiness.isReady) {
    const snapshotId = buildDailySnapshotId();
    const snapshotWriteStartedAt = Date.now();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: snapshotReason,
      snapshotQuality: 'strict',
      coveragePct: 100,
      fallbackAssetCount: 0,
      fxRates,  // P0-1: pass through pre-fetched rates
    });
    stepTimings.snapshotWriteMs = getDurationMs(snapshotWriteStartedAt);
    const durationMs = getDurationMs(startedAt);

    if (result.skipped) {
      const payload = {
        ok: true,
        skipped: true,
        route,
        message:
          mode === 'manual'
            ? '今日快照已存在，唔會重複補生成。'
            : '今日快照已存在，已略過重複寫入。',
        snapshotId,
        reason: result.reason,
        triggeredAt: new Date().toISOString(),
        durationMs,
        stepTimings,
      };
      console.info('[cron-capture-snapshot]', payload);
      return payload;
    }

    const payload = {
      ok: true,
      route,
      message:
        mode === 'manual'
          ? `已補生成今日資產快照，覆蓋 ${result.assetCount} 項資產。`
          : `已建立每日資產快照，覆蓋 ${result.assetCount} 項資產。`,
      assetCount: result.assetCount,
      totalValueHKD: result.totalValueHKD,
      snapshotId,
      snapshotQuality: 'strict' as const,
      coveragePct: 100,
      triggeredAt: new Date().toISOString(),
      durationMs,
      stepTimings,
    };
    console.info('[cron-capture-snapshot]', payload);
    return payload;
  }

  if (readiness.canUseFallback) {
    const snapshotId = buildDailySnapshotId();
    const snapshotWriteStartedAt = Date.now();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: fallbackReason,
      snapshotQuality: 'fallback',
      coveragePct: readiness.coveragePct,
      fallbackAssetCount: readiness.missingAssetCount,
      fxRates,  // P0-1: pass through pre-fetched rates
    });
    stepTimings.snapshotWriteMs = getDurationMs(snapshotWriteStartedAt);
    const durationMs = getDurationMs(startedAt);

    if (result.skipped) {
      const payload = {
        ok: true,
        skipped: true,
        route,
        message:
          mode === 'manual'
            ? '今日快照已存在，唔會重複補生成。'
            : '今日快照已存在，已略過重複寫入。',
        snapshotId,
        reason: result.reason,
        triggeredAt: new Date().toISOString(),
        durationMs,
        stepTimings,
      };
      console.info('[cron-capture-snapshot]', payload);
      return payload;
    }

    const payload = {
      ok: true,
      route,
      message:
        mode === 'manual'
          ? `已補生成今日快照（降級）：覆蓋率 ${readiness.coveragePct}%，沿用 ${readiness.fallbackAssetCount} 項最近有效價格。`
          : `已建立降級每日快照：覆蓋率 ${readiness.coveragePct}%，沿用 ${readiness.fallbackAssetCount} 項最近有效價格。`,
      assetCount: result.assetCount,
      totalValueHKD: result.totalValueHKD,
      snapshotId,
      snapshotQuality: 'fallback' as const,
      coveragePct: readiness.coveragePct,
      fallbackAssetCount: readiness.fallbackAssetCount,
      fallbackAssetSymbols: readiness.fallbackAssets.map((asset) => asset.symbol).slice(0, 10),
      softPendingReviewCount: readiness.softPendingReviewCount,
      triggeredAt: new Date().toISOString(),
      durationMs,
      stepTimings,
    };
    console.info('[cron-capture-snapshot]', payload);
    return payload;
  }

  const durationMs = getDurationMs(startedAt);
  const payload = {
    ok: true,
    skipped: true,
    route,
    message:
      mode === 'manual'
        ? `仍未能補生成今日快照：價格更新未完成（${readiness.readyAssets}/${readiness.totalAssets} 已更新，待處理 ${readiness.pendingReviewCount} 項）。`
        : `已跳過每日資產快照：價格更新未完成（${readiness.readyAssets}/${readiness.totalAssets} 已更新，待處理 ${readiness.pendingReviewCount} 項）。`,
    snapshotId: null,
    assetCount: readiness.totalAssets,
    readyAssets: readiness.readyAssets,
    pendingReviewCount: readiness.pendingReviewCount,
    hardPendingReviewCount: readiness.hardPendingReviewCount,
    coveragePct: readiness.coveragePct,
    staleAssetSymbols: readiness.staleAssets.map((asset) => asset.symbol).slice(0, 10),
    triggeredAt: new Date().toISOString(),
    durationMs,
    stepTimings,
  };
  console.info('[cron-capture-snapshot]', payload);
  return payload;
}

export function getCronSnapshotErrorResponse(error: unknown, route: string = CRON_ROUTE) {
  if (error instanceof CronSnapshotError) {
    return {
      status: error.status,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  if (error instanceof Error) {
    return {
      status: 500,
      body: {
        ok: false,
        route,
        message: error.message,
      },
    };
  }

  return {
    status: 500,
    body: {
      ok: false,
      route,
      message: '每日資產快照失敗，請稍後再試。',
    },
  };
}
