import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { captureAdminPortfolioSnapshot, readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { verifyCronRequest } from './cronAuth.js';
import { SNAPSHOT_FALLBACK_WINDOW_MS } from './priceFreshness.js';
import { updateSnapshotStatus } from './dailyJobs.js';
import type { PendingPriceUpdateReview } from '../src/types/priceUpdates';
import type { FxRates } from '../src/types/fxRates';
import type { SnapshotReadinessSummary } from './dailyJobs.js';

// The standalone /api/cron-capture-snapshot endpoint was removed in P2-5.
// Scheduled snapshots are now triggered internally by /api/cron-daily-update.
const CRON_ROUTE = '/api/cron-daily-update' as const;
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

function buildSnapshotReadinessSummary(
  readiness: Awaited<ReturnType<typeof verifyAssetsReadyForDailySnapshot>>,
): SnapshotReadinessSummary {
  const hardPendingTolerance = Math.max(2, Math.floor(readiness.totalAssets * 0.05));

  return {
    totalAssets: readiness.totalAssets,
    nonCashAssets: readiness.totalAssets,
    readyAssets: readiness.readyAssets,
    staleAssetCount: readiness.staleAssets.length,
    fallbackAssetCount: readiness.fallbackAssetCount,
    missingAssetCount: readiness.missingAssetCount,
    coveragePct: readiness.coveragePct,
    pendingReviewCount: readiness.pendingReviewCount,
    softPendingReviewCount: readiness.softPendingReviewCount,
    hardPendingReviewCount: readiness.hardPendingReviewCount,
    hardPendingTolerance,
    isReady: readiness.isReady,
    canUseFallback: readiness.canUseFallback,
  };
}

function getSnapshotSkipReason(
  readiness: Awaited<ReturnType<typeof verifyAssetsReadyForDailySnapshot>>,
  captureSkipped: boolean,
  existingSnapshotAlreadyDone = false,
) {
  if (existingSnapshotAlreadyDone) {
    return 'snapshot_already_done';
  }

  if (captureSkipped) {
    return 'snapshot_already_exists';
  }

  if (!readiness.isReady) {
    return readiness.canUseFallback ? 'readiness_not_met' : 'fallback_not_allowed';
  }

  return null;
}

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

async function verifyAssetsReadyForDailySnapshot(
  preloadedAssets?: Awaited<ReturnType<typeof readAdminPortfolioAssets>>,
  fxRates?: FxRates,
) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection('portfolio').doc('app');
  const assets = preloadedAssets ?? await readAdminPortfolioAssets();
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
  // P1 修補：唔再因為 1-2 隻 hard pending 就封鎖全日快照。
  // 容許少量 hard pending（max(2, 5% of assets)），前提係 coverage >= 80%。
  // Fallback snapshot 會標記 quality='fallback'，UI 知道有資產沿用舊價。
  const hardPendingTolerance = Math.max(2, Math.floor(nonCashAssets.length * 0.05));

  // P1-2: Value-weighted guard — if any single stale asset >15% of total HKD value,
  // or combined stale+missing >20%, block silent fallback regardless of coverage pct.
  let valueWeightedHighRisk = false;
  let staleValuePct = 0;
  if (fxRates && nonCashAssets.length > 0) {
    const toHKD = (amount: number, currency: string) => {
      const cur = currency.trim().toUpperCase();
      if (cur === 'HKD') return amount;
      if (cur === 'USD') return amount * fxRates.USD;
      if (cur === 'JPY') return amount * fxRates.JPY;
      return amount;
    };
    const totalHKD = nonCashAssets.reduce(
      (sum, a) => sum + toHKD(a.quantity * a.currentPrice, a.currency),
      0,
    );
    if (totalHKD > 0) {
      const staleHKD = staleAssets.reduce(
        (sum, a) => sum + toHKD(a.quantity * a.currentPrice, a.currency),
        0,
      );
      staleValuePct = Math.round((staleHKD / totalHKD) * 100);
      if (staleValuePct > 20) {
        valueWeightedHighRisk = true;
      } else {
        for (const asset of staleAssets) {
          const assetHKD = toHKD(asset.quantity * asset.currentPrice, asset.currency);
          if (totalHKD > 0 && assetHKD / totalHKD > 0.15) {
            valueWeightedHighRisk = true;
            break;
          }
        }
      }
    }
  }

  const canUseFallback =
    !valueWeightedHighRisk &&
    nonCashAssets.length > 0 &&
    coveragePct >= 80 &&
    hardPendingReviews.length <= hardPendingTolerance &&
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
    valueWeightedHighRisk,
    staleValuePct,
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
export async function runScheduledDailySnapshot(fxRates?: FxRates, preloadedAssets?: Awaited<ReturnType<typeof readAdminPortfolioAssets>>) {
  return runDailySnapshotWorkflow('scheduled', fxRates, preloadedAssets);
}

/**
 * P0-5: 手動後補快照保護。
 * - 已有 strict snapshot → 跳過（唔覆蓋高品質數據）
 * - 已有 fallback snapshot / 冇 snapshot → 走正常 readiness check workflow
 *   若而家 coverage 足夠，可升級成 strict
 */
export async function runManualDailySnapshot(options: { force?: boolean } = {}) {
  const startedAt = Date.now();
  const snapshotId = buildDailySnapshotId();
  const force = options.force === true;

  // Check existing snapshot quality before deciding how to proceed
  const db = getFirebaseAdminDb();
  const existingRef = db
    .collection('portfolio').doc('app')
    .collection('portfolioSnapshots').doc(snapshotId);
  const existing = await existingRef.get();
  const existingQuality = existing.exists
    ? (existing.data()?.snapshotQuality as string | undefined)
    : undefined;

  if (existingQuality === 'strict' && !force) {
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
  return runDailySnapshotWorkflow('manual', undefined, undefined, force);
}

async function runDailySnapshotWorkflow(
  mode: 'scheduled' | 'manual',
  fxRates?: FxRates,
  preloadedAssets?: Awaited<ReturnType<typeof readAdminPortfolioAssets>>,
  force = false,
) {
  const startedAt = Date.now();
  const stepTimings = createSnapshotStepTimings();
  const readinessStartedAt = Date.now();
  const readiness = await verifyAssetsReadyForDailySnapshot(preloadedAssets, fxRates);
  const readinessSummary = buildSnapshotReadinessSummary(readiness);
  stepTimings.readinessMs = getDurationMs(readinessStartedAt);
  const snapshotReason = mode === 'manual' ? 'snapshot' : 'daily_snapshot';
  const fallbackReason = mode === 'manual' ? 'snapshot' : 'daily_snapshot_fallback';
  const route = mode === 'manual' ? MANUAL_ROUTE : CRON_ROUTE;
  // Log prefix reflects the real entrypoint so logs are easy to trace
  const logLabel = mode === 'manual' ? '[manual-capture-snapshot]' : '[cron-daily-update/snapshot]';

  if (readiness.isReady) {
    const snapshotId = buildDailySnapshotId();
    const snapshotWriteStartedAt = Date.now();
    const result = await captureAdminPortfolioSnapshot({
      snapshotId,
      reason: snapshotReason,
      snapshotQuality: 'strict',
      coveragePct: 100,
      fallbackAssetCount: 0,
      missingAssetCount: 0,
      fxRates,
      holdings: preloadedAssets,
      force,
    });
    stepTimings.snapshotWriteMs = getDurationMs(snapshotWriteStartedAt);
    const durationMs = getDurationMs(startedAt);

    if (result.skipped) {
      await updateSnapshotStatus(readiness.todayKey, 'skipped', {
        snapshotSkipReason: 'snapshot_already_exists',
        snapshotReadinessSummary: readinessSummary,
      });
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
        snapshotSkipReason: 'snapshot_already_exists',
        snapshotReadinessSummary: readinessSummary,
        triggeredAt: new Date().toISOString(),
        durationMs,
        stepTimings,
      };
      console.info(logLabel, payload);
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
      snapshotSkipReason: null,
      snapshotReadinessSummary: readinessSummary,
      triggeredAt: new Date().toISOString(),
      durationMs,
      stepTimings,
    };
    console.info(logLabel, payload);
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
      fallbackAssetCount: readiness.fallbackAssetCount,
      missingAssetCount: readiness.missingAssetCount,
      fxRates,
      holdings: preloadedAssets,
      force,
    });
    stepTimings.snapshotWriteMs = getDurationMs(snapshotWriteStartedAt);
    const durationMs = getDurationMs(startedAt);

    if (result.skipped) {
      await updateSnapshotStatus(readiness.todayKey, 'skipped', {
        snapshotSkipReason: 'snapshot_already_exists',
        snapshotReadinessSummary: readinessSummary,
      });
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
        snapshotSkipReason: 'snapshot_already_exists',
        snapshotReadinessSummary: readinessSummary,
        triggeredAt: new Date().toISOString(),
        durationMs,
        stepTimings,
      };
      console.info(logLabel, payload);
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
      snapshotSkipReason: null,
      snapshotReadinessSummary: readinessSummary,
      triggeredAt: new Date().toISOString(),
      durationMs,
      stepTimings,
    };
    console.info(logLabel, payload);
    return payload;
  }

  const durationMs = getDurationMs(startedAt);
  const snapshotSkipReason = getSnapshotSkipReason(readiness, false);
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
    snapshotSkipReason,
    snapshotReadinessSummary: readinessSummary,
    triggeredAt: new Date().toISOString(),
    durationMs,
    stepTimings,
  };
  console.info(logLabel, payload);
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
