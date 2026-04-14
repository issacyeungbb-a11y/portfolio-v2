import { FieldValue } from 'firebase-admin/firestore';
import { fetchLiveFxRatesWithStatus, generatePriceUpdates } from './updatePrices.js';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { runCoinGeckoCoinIdSync } from './syncCoinIds.js';
import { writeSystemRun, readRecentSystemRuns } from './systemRuns.js';

const CRON_ROUTE = '/api/cron-update-prices';
const RESCUE_ROUTE = '/api/cron-update-prices-rescue';
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const CRON_COIN_GECKO_SYNC_TIMEOUT_MS = 20000;
const CRON_COIN_GECKO_SYNC_TIME_BUDGET_MS = 18000;
const SYSTEM_RUN_TASK_NAME = 'cron-update-prices';

// 補救排程跳過門檻：今日已成功且 pendingCount < 此值，跳過補救
const RESCUE_SKIP_IF_PENDING_BELOW = 3;
// 防並發緩衝：上次執行距今 < 5 分鐘，可能仍在執行中
const RESCUE_OVERLAP_BUFFER_MS = 5 * 60 * 1000;

/** Strip undefined values before writing to Firestore (undefined is not a valid Firestore value). */
function omitUndefined(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

class CronPriceUpdateError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.name = 'CronPriceUpdateError';
        this.status = status;
    }
}
function getCronSecret() {
    const value = process.env.CRON_SECRET?.trim();
    if (!value) {
        throw new CronPriceUpdateError('未設定 CRON_SECRET，暫時無法執行排程價格更新。', 500);
    }
    return value;
}
export function verifyCronRequest(authorizationHeader) {
    const cronSecret = getCronSecret();
    const expected = `Bearer ${cronSecret}`;
    if (authorizationHeader !== expected) {
        throw new CronPriceUpdateError('未授權的 cron 請求。', 401);
    }
}
async function readAssetsForPriceUpdate() {
    const assets = await readAdminPortfolioAssets();
    return assets.filter((asset) => asset.assetType !== 'cash');
}
function buildPriceUpdateRequest(assets) {
    return {
        assets: assets.map((asset) => ({
            assetId: asset.id,
            assetName: asset.name,
            ticker: asset.symbol,
            assetType: asset.assetType,
            currentPrice: asset.currentPrice,
            currency: asset.currency,
        })),
    };
}
function isValidReview(review) {
    return review.price != null && review.price > 0 && !review.invalidReason;
}
function getDurationMs(startedAt) {
    return Date.now() - startedAt;
}
function createStepTimings() {
    return {
        readAssetsMs: 0,
        coinGeckoSyncMs: 0,
        fxRatesMs: 0,
        persistFxRatesMs: 0,
        generatePricesMs: 0,
        writeResultsMs: 0,
    };
}
function raceWithTimeout(promise, timeoutMs, timeoutMessage) {
    let timeoutHandle = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]).finally(() => {
        if (timeoutHandle) {
            clearTimeout(timeoutHandle);
        }
    });
}

/**
 * P1-3: 寫入結果，保留 pending review 的 firstSeenAt。
 * 策略：先讀取現有文件，若已有 firstSeenAt 則不覆寫。
 */
async function applyCronResults(results) {
    const db = getFirebaseAdminDb();
    const batch = db.batch();
    const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
    const validResults = results.filter(isValidReview);
    const invalidResults = results.filter((review) => !isValidReview(review));

    // 讀取現有 pending review 文件，判斷 firstSeenAt 是否已存在
    const existingHasFirstSeen = new Map();
    if (invalidResults.length > 0) {
        const existingDocs = await Promise.all(
            invalidResults.map((r) =>
                portfolioRef.collection('priceUpdateReviews').doc(r.assetId).get()
            )
        );
        existingDocs.forEach((snap, i) => {
            existingHasFirstSeen.set(
                invalidResults[i].assetId,
                snap.exists && snap.data()?.firstSeenAt != null
            );
        });
    }

    for (const review of validResults) {
        const assetRef = portfolioRef.collection('assets').doc(review.assetId);
        const reviewRef = portfolioRef.collection('priceUpdateReviews').doc(review.assetId);
        const historyRef = assetRef.collection('priceHistory').doc();
        batch.update(assetRef, {
            currentPrice: review.price,
            updatedAt: FieldValue.serverTimestamp(),
            lastPriceUpdatedAt: FieldValue.serverTimestamp(),
            priceSource: 'api_auto_cron',
            priceAsOf: review.asOf,
            priceSourceName: review.sourceName,
            priceSourceUrl: review.sourceUrl,
        });
        batch.set(reviewRef, {
            ...omitUndefined(review),
            status: 'confirmed',
            confirmedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(historyRef, {
            assetId: review.assetId,
            assetName: review.assetName,
            ticker: review.ticker,
            assetType: review.assetType,
            price: review.price,
            currency: review.currency,
            asOf: review.asOf,
            sourceName: review.sourceName,
            sourceUrl: review.sourceUrl,
            recordedAt: FieldValue.serverTimestamp(),
        });
    }

    for (const review of invalidResults) {
        const reviewRef = portfolioRef.collection('priceUpdateReviews').doc(review.assetId);
        const hasFirstSeen = existingHasFirstSeen.get(review.assetId) ?? false;
        batch.set(reviewRef, {
            ...omitUndefined(review),
            status: 'pending',
            lastSeenAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
            // firstSeenAt 只在首次出現時設定
            ...(hasFirstSeen ? {} : { firstSeenAt: FieldValue.serverTimestamp() }),
        }, { merge: true });
    }

    if (validResults.length > 0 || invalidResults.length > 0) {
        await batch.commit();
    }

    const nonCashAssetCount = results.length;
    const coveragePct = nonCashAssetCount === 0
        ? 100
        : Math.round((validResults.length / nonCashAssetCount) * 100);

    return {
        appliedCount: validResults.length,
        pendingCount: invalidResults.length,
        coveragePct,
    };
}

async function persistFxRates(fxRates) {
    const db = getFirebaseAdminDb();
    const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
    await portfolioRef.set({
        fxRates: {
            ...fxRates,
            updatedAt: new Date().toISOString(),
        },
    }, { merge: true });
}

async function runPriceUpdateCore(trigger) {
    const startedAt = Date.now();
    const startedAtISO = new Date(startedAt).toISOString();
    const stepTimings = createStepTimings();
    const route = trigger === 'rescue' ? RESCUE_ROUTE : CRON_ROUTE;
    const isRescueRun = trigger === 'rescue';

    // Track partial state so a failed systemRun can include what was known at error time
    let assetCount = 0;
    let coinGeckoSyncStatus = 'skipped';
    let fxUsingFallback = false;
    let coveragePct = 0;

    try {
    const assetsStartedAt = Date.now();
    const assets = await readAssetsForPriceUpdate();
    stepTimings.readAssetsMs = getDurationMs(assetsStartedAt);
    assetCount = assets.length;

    const cryptoTickers = [...new Set(assets
        .filter((asset) => asset.assetType === 'crypto')
        .map((asset) => asset.symbol.trim().toUpperCase())
        .filter(Boolean))];

    if (cryptoTickers.length > 0) {
        const syncStartedAt = Date.now();
        try {
            await raceWithTimeout(runCoinGeckoCoinIdSync({ tickers: cryptoTickers }, {
                timeBudgetMs: CRON_COIN_GECKO_SYNC_TIME_BUDGET_MS,
            }), CRON_COIN_GECKO_SYNC_TIMEOUT_MS, 'CoinGecko sync timeout');
            coinGeckoSyncStatus = 'ok';
        }
        catch (error) {
            coinGeckoSyncStatus =
                error instanceof Error && error.message.includes('timeout') ? 'timeout' : 'failed';
            console.warn('CoinGecko coin id sync failed before price update.', error);
        }
        finally {
            stepTimings.coinGeckoSyncMs = getDurationMs(syncStartedAt);
        }
    }

    const fxStartedAt = Date.now();
    const fxResult = await fetchLiveFxRatesWithStatus();
    fxUsingFallback = fxResult.usingFallback;
    stepTimings.fxRatesMs = getDurationMs(fxStartedAt);

    const persistStartedAt = Date.now();
    await persistFxRates(fxResult.rates);
    stepTimings.persistFxRatesMs = getDurationMs(persistStartedAt);

    if (fxUsingFallback) {
        console.warn('[cron-update-prices] 使用備援匯率（Yahoo Finance FX 抓取失敗）。');
    }

    if (assets.length === 0) {
        coveragePct = 100;
        const durationMs = getDurationMs(startedAt);
        const payload = {
            ok: true,
            route,
            message: '目前沒有可自動更新價格的資產。',
            assetCount: 0,
            appliedCount: 0,
            pendingCount: 0,
            coveragePct,
            fxUsingFallback,
            triggeredAt: startedAtISO,
            durationMs,
            coinGeckoSyncStatus,
            isRescueRun,
            stepTimings,
        };
        console.info('[cron-update-prices]', payload);
        await writeSystemRun({
            taskName: SYSTEM_RUN_TASK_NAME,
            trigger,
            startedAt: startedAtISO,
            finishedAt: new Date().toISOString(),
            durationMs,
            assetCount: 0,
            appliedCount: 0,
            pendingCount: 0,
            coinGeckoSyncStatus,
            coveragePct,
            fxUsingFallback,
            isRescueRun,
            errorMessage: null,
            ok: true,
        });
        return { ...payload };
    }

    const generateStartedAt = Date.now();
    const response = await generatePriceUpdates(buildPriceUpdateRequest(assets));
    stepTimings.generatePricesMs = getDurationMs(generateStartedAt);

    const writeStartedAt = Date.now();
    const outcome = await applyCronResults(response.results);
    stepTimings.writeResultsMs = getDurationMs(writeStartedAt);
    coveragePct = outcome.coveragePct;
    const durationMs = getDurationMs(startedAt);

    const payload = {
        ok: true,
        route,
        message: outcome.pendingCount > 0
            ? `已自動更新 ${outcome.appliedCount} 項資產；${outcome.pendingCount} 項需要人工檢查。`
            : `已自動更新 ${outcome.appliedCount} 項資產價格。`,
        assetCount: assets.length,
        appliedCount: outcome.appliedCount,
        pendingCount: outcome.pendingCount,
        coveragePct,
        fxUsingFallback,
        triggeredAt: startedAtISO,
        model: response.model,
        durationMs,
        coinGeckoSyncStatus,
        isRescueRun,
        stepTimings,
    };
    console.info('[cron-update-prices]', payload);

    await writeSystemRun({
        taskName: SYSTEM_RUN_TASK_NAME,
        trigger,
        startedAt: startedAtISO,
        finishedAt: new Date().toISOString(),
        durationMs,
        assetCount: assets.length,
        appliedCount: outcome.appliedCount,
        pendingCount: outcome.pendingCount,
        coinGeckoSyncStatus,
        coveragePct,
        fxUsingFallback,
        isRescueRun,
        errorMessage: null,
        ok: true,
    });

    return { ...payload };

    } catch (error) {
        // Always record a failed systemRun with whatever partial state was captured,
        // then re-throw so the API handler returns the original error response.
        const durationMs = getDurationMs(startedAt);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error('[cron-update-prices] runPriceUpdateCore failed:', errorMessage);

        await writeSystemRun({
            taskName: SYSTEM_RUN_TASK_NAME,
            trigger,
            startedAt: startedAtISO,
            finishedAt: new Date().toISOString(),
            durationMs,
            assetCount,
            appliedCount: 0,
            pendingCount: 0,
            coinGeckoSyncStatus,
            coveragePct,
            fxUsingFallback,
            isRescueRun,
            errorMessage,
            ok: false,
        });

        throw error;
    }
}

export async function runScheduledPriceUpdate() {
    return runPriceUpdateCore('scheduled');
}

function getHongKongDateKey(date = new Date()) {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Hong_Kong',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(date);
}

/**
 * P0-3: 補救排程。
 * 跳過條件（狀態判斷，不依賴平台分鐘級排程精準度）：
 *   1. 今日（HKT）已有一次成功執行（ok=true AND pendingCount < 門檻）→ 跳過
 *   2. 上次執行距今 < 5 分鐘（防並發重疊）→ 跳過
 */
export async function runRescuePriceUpdate() {
    const recentRuns = await readRecentSystemRuns(SYSTEM_RUN_TASK_NAME, 1);
    const lastRun = recentRuns[0];

    if (lastRun) {
        const lastRunAt = new Date(lastRun.startedAt).getTime();
        const elapsed = Date.now() - (Number.isNaN(lastRunAt) ? 0 : lastRunAt);

        // 防並發：上次執行可能仍在進行中
        if (elapsed < RESCUE_OVERLAP_BUFFER_MS) {
            const skipPayload = {
                ok: true,
                route: RESCUE_ROUTE,
                skipped: true,
                message: `補救排程跳過：上次執行於 ${Math.round(elapsed / 60000)} 分鐘前，可能仍在進行中。`,
                triggeredAt: new Date().toISOString(),
            };
            console.info('[cron-update-prices-rescue]', skipPayload);
            return skipPayload;
        }

        // 今日已成功完成 → 不需要補救
        const todayKey = getHongKongDateKey();
        const lastRunDateKey = getHongKongDateKey(new Date(lastRun.startedAt));
        const ranToday = lastRunDateKey === todayKey;
        const wasSuccessful = lastRun.ok && lastRun.pendingCount < RESCUE_SKIP_IF_PENDING_BELOW;

        if (ranToday && wasSuccessful) {
            const skipPayload = {
                ok: true,
                route: RESCUE_ROUTE,
                skipped: true,
                message: `補救排程跳過：今日排程已成功完成（pendingCount=${lastRun.pendingCount}，coveragePct=${lastRun.coveragePct}%）。`,
                triggeredAt: new Date().toISOString(),
            };
            console.info('[cron-update-prices-rescue]', skipPayload);
            return skipPayload;
        }

        console.info(
            `[cron-update-prices-rescue] 執行補救排程。上次結果：ok=${lastRun.ok}, ranToday=${ranToday}, pending=${lastRun.pendingCount}, elapsed=${Math.round(elapsed / 60000)}min`
        );
    } else {
        console.info('[cron-update-prices-rescue] 未找到上次執行記錄，執行補救排程。');
    }

    return runPriceUpdateCore('rescue');
}

export function getCronPriceUpdateErrorResponse(error) {
    if (error instanceof CronPriceUpdateError) {
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
            message: '自動價格更新失敗，請稍後再試。',
        },
    };
}
