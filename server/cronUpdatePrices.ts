import { FieldValue } from 'firebase-admin/firestore';

import { fetchLiveFxRatesWithStatus, generatePriceUpdates } from './updatePrices.js';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { runCoinGeckoCoinIdSync } from './syncCoinIds.js';
import { writeSystemRun, readRecentSystemRuns } from './systemRuns.js';
import type { FxRates } from '../src/types/fxRates';
import type { PendingPriceUpdateReview, PriceUpdateRequest } from '../src/types/priceUpdates';

const CRON_ROUTE = '/api/cron-update-prices' as const;
const RESCUE_ROUTE = '/api/cron-update-prices-rescue' as const;
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const CRON_COIN_GECKO_SYNC_TIMEOUT_MS = 20_000;
const CRON_COIN_GECKO_SYNC_TIME_BUDGET_MS = 18_000;
const SYSTEM_RUN_TASK_NAME = 'cron-update-prices';

/**
 * 補救排程跳過門檻：今日排程已成功且 pendingCount < 此值，視為不需要補救。
 */
const RESCUE_SKIP_IF_PENDING_BELOW = 3;

/**
 * 防重疊緩衝：若上次執行距今 < 這個時長（ms），可能正在執行中，跳過補救。
 * 設定為 5 分鐘（遠小於主排程與補救排程的間隔，只用於防止並發，不再依賴精準分鐘差）。
 */
const RESCUE_OVERLAP_BUFFER_MS = 5 * 60 * 1000;

class CronPriceUpdateError extends Error {
  status: number;

  constructor(message: string, status = 500) {
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

export function verifyCronRequest(authorizationHeader?: string) {
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

function buildPriceUpdateRequest(assets: Awaited<ReturnType<typeof readAssetsForPriceUpdate>>): PriceUpdateRequest {
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

function isValidReview(review: PendingPriceUpdateReview) {
  return review.price != null && review.price > 0 && !review.invalidReason;
}

/**
 * 寫入 cron 結果到 Firestore。
 *
 * P1-3 修正：pending review 的首次出現時間保留在 firstSeenAt。
 * 策略：先批次讀取現有 pending review 文件，若已存在則不覆寫 firstSeenAt。
 */
async function applyCronResults(results: PendingPriceUpdateReview[]) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const validResults = results.filter(isValidReview);
  const invalidResults = results.filter((review) => !isValidReview(review));

  // P1-3: 讀取現有 pending review，判斷是否已有 firstSeenAt
  const existingHasFirstSeen = new Map<string, boolean>();
  if (invalidResults.length > 0) {
    const existingDocs = await Promise.all(
      invalidResults.map((r) =>
        portfolioRef.collection('priceUpdateReviews').doc(r.assetId).get(),
      ),
    );
    existingDocs.forEach((snap, i) => {
      existingHasFirstSeen.set(
        invalidResults[i].assetId,
        snap.exists && snap.data()?.firstSeenAt != null,
      );
    });
  }

  const batch = db.batch();
  const nonCashAssetCount = results.length;

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

    batch.set(
      reviewRef,
      {
        ...review,
        status: 'confirmed',
        confirmedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );

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

    batch.set(
      reviewRef,
      {
        ...review,
        status: 'pending',
        // lastSeenAt：每次都更新
        lastSeenAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        // firstSeenAt：只在首次出現時設定，不覆寫已有值
        ...(hasFirstSeen ? {} : { firstSeenAt: FieldValue.serverTimestamp() }),
      },
      { merge: true },
    );
  }

  if (validResults.length > 0 || invalidResults.length > 0) {
    await batch.commit();
  }

  const coveragePct =
    nonCashAssetCount === 0
      ? 100
      : Math.round((validResults.length / nonCashAssetCount) * 100);

  return {
    appliedCount: validResults.length,
    pendingCount: invalidResults.length,
    coveragePct,
  };
}

async function persistFxRates(fxRates: FxRates) {
  const db = getFirebaseAdminDb();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);

  await portfolioRef.set(
    {
      fxRates: {
        ...fxRates,
        updatedAt: new Date().toISOString(),
      },
    },
    { merge: true },
  );
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

function getDurationMs(startedAt: number) {
  return Date.now() - startedAt;
}

async function raceWithTimeout<T>(work: Promise<T>, timeoutMs: number, timeoutMessage: string) {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  try {
    return await Promise.race([
      work,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

async function runPriceUpdateCore(trigger: 'scheduled' | 'rescue' | 'manual') {
  const startedAt = Date.now();
  const startedAtISO = new Date(startedAt).toISOString();
  const stepTimings = createStepTimings();
  const route = trigger === 'rescue' ? RESCUE_ROUTE : CRON_ROUTE;
  const isRescueRun = trigger === 'rescue';

  // Track partial state so failed systemRun can include what was known at time of error
  let assetCount = 0;
  let coinGeckoSyncStatus: 'skipped' | 'ok' | 'timeout' | 'failed' = 'skipped';
  let fxUsingFallback = false;
  let coveragePct = 0;

  try {
    const assetsStartedAt = Date.now();
    const assets = await readAssetsForPriceUpdate();
    stepTimings.readAssetsMs = getDurationMs(assetsStartedAt);
    assetCount = assets.length;

    const cryptoTickers = [...new Set(
      assets
        .filter((asset) => asset.assetType === 'crypto')
        .map((asset) => asset.symbol.trim().toUpperCase())
        .filter(Boolean),
    )];

    if (cryptoTickers.length > 0) {
      const syncStartedAt = Date.now();
      try {
        await raceWithTimeout(
          runCoinGeckoCoinIdSync({ tickers: cryptoTickers }, {
            timeBudgetMs: CRON_COIN_GECKO_SYNC_TIME_BUDGET_MS,
          }),
          CRON_COIN_GECKO_SYNC_TIMEOUT_MS,
          'CoinGecko sync timeout',
        );
        coinGeckoSyncStatus = 'ok';
      } catch (error) {
        coinGeckoSyncStatus =
          error instanceof Error && error.message.includes('timeout') ? 'timeout' : 'failed';
        console.warn('CoinGecko coin id sync failed before price update.', error);
      } finally {
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

      return payload;
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
      message:
        outcome.pendingCount > 0
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

    return payload;
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
 * P0-3: 補救排程邏輯。
 *
 * 呼叫時機：每日 06:30 HKT（UTC 22:30 前一天）。
 *
 * 跳過條件（狀態判斷，不依賴平台分鐘級排程精準度）：
 *   1. 今日（HKT）已有一次成功執行（ok=true AND pendingCount < 門檻）→ 跳過
 *   2. 上次執行距今 < 5 分鐘（防並發重疊）→ 跳過
 *
 * 否則：重新執行完整價格更新流程，trigger 標記為 'rescue'。
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
      `[cron-update-prices-rescue] 執行補救排程。上次結果：ok=${lastRun.ok}, ranToday=${ranToday}, pending=${lastRun.pendingCount}, elapsed=${Math.round(elapsed / 60000)}min`,
    );
  } else {
    console.info('[cron-update-prices-rescue] 未找到上次執行記錄，執行補救排程。');
  }

  return runPriceUpdateCore('rescue');
}

export function getCronPriceUpdateErrorResponse(error: unknown) {
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
