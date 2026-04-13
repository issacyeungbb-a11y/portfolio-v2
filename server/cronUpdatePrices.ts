import { FieldValue } from 'firebase-admin/firestore';

import { fetchLiveFxRates, generatePriceUpdates } from './updatePrices';
import { getFirebaseAdminDb } from './firebaseAdmin';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin';
import { runCoinGeckoCoinIdSync } from './syncCoinIds';
import type { FxRates } from '../src/types/fxRates';
import type { PendingPriceUpdateReview, PriceUpdateRequest } from '../src/types/priceUpdates';

const CRON_ROUTE = '/api/cron-update-prices' as const;
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const CRON_COIN_GECKO_SYNC_TIMEOUT_MS = 20_000;
const CRON_COIN_GECKO_SYNC_TIME_BUDGET_MS = 18_000;

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

async function applyCronResults(results: PendingPriceUpdateReview[]) {
  const db = getFirebaseAdminDb();
  const batch = db.batch();
  const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
  const validResults = results.filter(isValidReview);
  const invalidResults = results.filter((review) => !isValidReview(review));

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

    batch.set(
      reviewRef,
      {
        ...review,
        status: 'pending',
        updatedAt: FieldValue.serverTimestamp(),
        createdAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  }

  if (validResults.length > 0 || invalidResults.length > 0) {
    await batch.commit();
  }

  return {
    appliedCount: validResults.length,
    pendingCount: invalidResults.length,
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

export async function runScheduledPriceUpdate() {
  const startedAt = Date.now();
  const stepTimings = createStepTimings();
  const assetsStartedAt = Date.now();
  const assets = await readAssetsForPriceUpdate();
  stepTimings.readAssetsMs = getDurationMs(assetsStartedAt);
  const cryptoTickers = [...new Set(
    assets
      .filter((asset) => asset.assetType === 'crypto')
      .map((asset) => asset.symbol.trim().toUpperCase())
      .filter(Boolean),
  )];
  let coinGeckoSyncStatus: 'skipped' | 'ok' | 'timeout' | 'failed' = 'skipped';

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
  const fxRates = await fetchLiveFxRates();
  stepTimings.fxRatesMs = getDurationMs(fxStartedAt);

  const persistStartedAt = Date.now();
  await persistFxRates(fxRates);
  stepTimings.persistFxRatesMs = getDurationMs(persistStartedAt);

  if (assets.length === 0) {
    const durationMs = getDurationMs(startedAt);
    const response = {
      ok: true,
      route: CRON_ROUTE,
      message: '目前沒有可自動更新價格的資產。',
      assetCount: 0,
      appliedCount: 0,
      pendingCount: 0,
      triggeredAt: new Date().toISOString(),
      durationMs,
      coinGeckoSyncStatus,
      stepTimings,
    };
    console.info('[cron-update-prices]', response);
    return {
      ...response,
    };
  }

  const generateStartedAt = Date.now();
  const response = await generatePriceUpdates(buildPriceUpdateRequest(assets));
  stepTimings.generatePricesMs = getDurationMs(generateStartedAt);

  const writeStartedAt = Date.now();
  const outcome = await applyCronResults(response.results);
  stepTimings.writeResultsMs = getDurationMs(writeStartedAt);
  const durationMs = getDurationMs(startedAt);
  const payload = {
    ok: true,
    route: CRON_ROUTE,
    message:
      outcome.pendingCount > 0
        ? `已自動更新 ${outcome.appliedCount} 項資產；${outcome.pendingCount} 項需要人工檢查。`
        : `已自動更新 ${outcome.appliedCount} 項資產價格。`,
    assetCount: assets.length,
    appliedCount: outcome.appliedCount,
    pendingCount: outcome.pendingCount,
    triggeredAt: new Date().toISOString(),
    model: response.model,
    durationMs,
    coinGeckoSyncStatus,
    stepTimings,
  };
  console.info('[cron-update-prices]', payload);

  return {
    ...payload,
  };
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
