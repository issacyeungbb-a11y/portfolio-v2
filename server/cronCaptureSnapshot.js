import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { captureAdminPortfolioSnapshot, readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { verifyCronRequest } from './cronAuth.js';
import { SNAPSHOT_FALLBACK_WINDOW_MS } from './priceFreshness.js';
import { updateSnapshotStatus } from './dailyJobs.js';
const CRON_ROUTE = '/api/cron-daily-update';
const MANUAL_ROUTE = '/api/manual-capture-snapshot';
class CronSnapshotError extends Error {
    constructor(message, status = 500) {
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
function getHongKongDateKeyFromTimestamp(value) {
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
        return '';
    }
    return getHongKongDateKey(value);
}
function getHoursSinceUpdate(value) {
    if (!value) {
        return Number.POSITIVE_INFINITY;
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return Number.POSITIVE_INFINITY;
    }
    return Math.max(0, (Date.now() - date.getTime()) / (1000 * 60 * 60));
}
function buildSnapshotReadinessSummary(readiness) {
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
function getSnapshotSkipReason(readiness, captureSkipped, existingSnapshotAlreadyDone = false) {
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
function isFallbackUsable(asset, todayKey) {
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
function sanitizeFailureCategory(value) {
    if (value === 'ticker_format' ||
        value === 'quote_time' ||
        value === 'source_missing' ||
        value === 'response_format' ||
        value === 'price_missing' ||
        value === 'confidence_low' ||
        value === 'diff_too_large' ||
        value === 'unknown') {
        return value;
    }
    return 'unknown';
}
function isSoftPendingCategory(category) {
    return (category === 'quote_time' ||
        category === 'source_missing' ||
        category === 'response_format' ||
        category === 'price_missing' ||
        category === 'confidence_low' ||
        category === 'diff_too_large');
}
function parseReviewUpdatedAt(value) {
    if (typeof value === 'string') {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value;
    }
    if (typeof value === 'object' &&
        value !== null &&
        'toDate' in value &&
        typeof value.toDate === 'function') {
        const parsed = value.toDate();
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}
async function verifyAssetsReadyForDailySnapshot(preloadedAssets) {
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
        const data = document.data();
        return {
            assetId: document.id,
            failureCategory: sanitizeFailureCategory(data.failureCategory),
            updatedAt: parseReviewUpdatedAt(data.updatedAt),
        };
    });
    const fallbackAssetIds = new Set(fallbackAssets.map((asset) => asset.id));
    const hardPendingReviews = pendingReviews.filter((review) => {
        if (review.failureCategory === 'diff_too_large' &&
            review.updatedAt &&
            Date.now() - review.updatedAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
            return false;
        }
        if (!isSoftPendingCategory(review.failureCategory)) {
            return true;
        }
        return !fallbackAssetIds.has(review.assetId);
    });
    const softPendingReviews = pendingReviews.filter((review) => !hardPendingReviews.includes(review));
    const coveragePct = nonCashAssets.length === 0
        ? 100
        : Math.round(((nonCashAssets.length - missingAssets.length) / nonCashAssets.length) * 100);
    // P1 修補：唔再因為 1-2 隻 hard pending 就封鎖全日快照。
    // 容許少量 hard pending（max(2, 5% of assets)），前提係 coverage >= 80%。
    // Fallback snapshot 會標記 quality='fallback'，UI 知道有資產沿用舊價。
    const hardPendingTolerance = Math.max(2, Math.floor(nonCashAssets.length * 0.05));
    const canUseFallback = nonCashAssets.length > 0 &&
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
    };
}
export function verifySnapshotCronRequest(authorizationHeader) {
    try {
        verifyCronRequest(authorizationHeader);
    }
    catch (error) {
        if (error instanceof Error) {
            throw new CronSnapshotError(error.message, error.status ?? 401);
        }
        throw error;
    }
}
export async function runScheduledDailySnapshot(fxRates, preloadedAssets) {
    return runDailySnapshotWorkflow('scheduled', fxRates, preloadedAssets);
}
export async function runManualDailySnapshot(options = {}) {
    const startedAt = Date.now();
    const snapshotId = buildDailySnapshotId();
    const force = options.force === true;

    // P0-5: 檢查現有快照品質，避免低品質覆蓋高品質
    const db = getFirebaseAdminDb();
    const existingRef = db
        .collection('portfolio').doc('app')
        .collection('portfolioSnapshots').doc(snapshotId);
    const existing = await existingRef.get();
    const existingQuality = existing.exists ? existing.data()?.snapshotQuality : undefined;

    if (existingQuality === 'strict' && !force) {
        const payload = {
            ok: true,
            skipped: true,
            route: MANUAL_ROUTE,
            message: '今日已有 strict 品質快照，唔覆蓋。如需強制覆蓋，請先刪除現有快照。',
            snapshotId,
            reason: 'strict_already_exists',
            triggeredAt: new Date().toISOString(),
            durationMs: Date.now() - startedAt,
        };
        console.info('[manual-capture-snapshot]', payload);
        return payload;
    }

    // 冇快照或 fallback → 走正常 readiness workflow（可升級成 strict）
    return runDailySnapshotWorkflow('manual', undefined, undefined, force);
}
async function runDailySnapshotWorkflow(mode, fxRates, preloadedAssets, force = false) {
    const readiness = await verifyAssetsReadyForDailySnapshot(preloadedAssets);
    const readinessSummary = buildSnapshotReadinessSummary(readiness);
    const snapshotReason = mode === 'manual' ? 'snapshot' : 'daily_snapshot';
    const fallbackReason = mode === 'manual' ? 'snapshot' : 'daily_snapshot_fallback';
    const route = mode === 'manual' ? MANUAL_ROUTE : CRON_ROUTE;
    if (readiness.isReady) {
        const snapshotId = buildDailySnapshotId();
        const result = await captureAdminPortfolioSnapshot({
            snapshotId,
            fxRates,
            reason: snapshotReason,
            snapshotQuality: 'strict',
            coveragePct: 100,
            fallbackAssetCount: 0,
            holdings: preloadedAssets,
            force,
        });
        if (result.skipped) {
            await updateSnapshotStatus(readiness.todayKey, 'skipped', {
                snapshotSkipReason: 'snapshot_already_exists',
                snapshotReadinessSummary: readinessSummary,
            });
            return {
                ok: true,
                skipped: true,
                route,
                message: mode === 'manual'
                    ? '今日快照已存在，唔會重複補生成。'
                : '今日快照已存在，已略過重複寫入。',
                snapshotId,
                reason: result.reason,
                snapshotSkipReason: 'snapshot_already_exists',
                snapshotReadinessSummary: readinessSummary,
                triggeredAt: new Date().toISOString(),
            };
        }
        return {
            ok: true,
            route,
            message: mode === 'manual'
                ? `已補生成今日資產快照，覆蓋 ${result.assetCount} 項資產。`
                : `已建立每日資產快照，覆蓋 ${result.assetCount} 項資產。`,
            assetCount: result.assetCount,
            totalValueHKD: result.totalValueHKD,
            snapshotId,
            snapshotQuality: 'strict',
            coveragePct: 100,
            snapshotSkipReason: null,
            snapshotReadinessSummary: readinessSummary,
            triggeredAt: new Date().toISOString(),
        };
    }
    if (readiness.canUseFallback) {
        const snapshotId = buildDailySnapshotId();
        const result = await captureAdminPortfolioSnapshot({
            snapshotId,
            reason: fallbackReason,
            snapshotQuality: 'fallback',
            coveragePct: readiness.coveragePct,
            fallbackAssetCount: readiness.missingAssetCount,
            fxRates,
            holdings: preloadedAssets,
            force,
        });
        if (result.skipped) {
            await updateSnapshotStatus(readiness.todayKey, 'skipped', {
                snapshotSkipReason: 'snapshot_already_exists',
                snapshotReadinessSummary: readinessSummary,
            });
            return {
                ok: true,
                skipped: true,
                route,
                message: mode === 'manual'
                    ? '今日快照已存在，唔會重複補生成。'
                    : '今日快照已存在，已略過重複寫入。',
                snapshotId,
                reason: result.reason,
                snapshotSkipReason: 'snapshot_already_exists',
                snapshotReadinessSummary: readinessSummary,
                triggeredAt: new Date().toISOString(),
            };
        }
        return {
            ok: true,
            route,
            message: mode === 'manual'
                ? `已補生成今日快照（降級）：覆蓋率 ${readiness.coveragePct}%，沿用 ${readiness.fallbackAssetCount} 項最近有效價格。`
                : `已建立降級每日快照：覆蓋率 ${readiness.coveragePct}%，沿用 ${readiness.fallbackAssetCount} 項最近有效價格。`,
            assetCount: result.assetCount,
            totalValueHKD: result.totalValueHKD,
            snapshotId,
            snapshotQuality: 'fallback',
            coveragePct: readiness.coveragePct,
            fallbackAssetCount: readiness.fallbackAssetCount,
            fallbackAssetSymbols: readiness.fallbackAssets.map((asset) => asset.symbol).slice(0, 10),
            softPendingReviewCount: readiness.softPendingReviewCount,
            snapshotSkipReason: null,
            snapshotReadinessSummary: readinessSummary,
            triggeredAt: new Date().toISOString(),
        };
    }
    const snapshotSkipReason = getSnapshotSkipReason(readiness, false);
    await updateSnapshotStatus(readiness.todayKey, 'skipped', {
        snapshotSkipReason,
        snapshotReadinessSummary: readinessSummary,
    });
    return {
        ok: true,
        skipped: true,
        route,
        message: mode === 'manual'
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
    };
}
export function getCronSnapshotErrorResponse(error, route = CRON_ROUTE) {
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
