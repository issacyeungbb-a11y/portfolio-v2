import { FieldValue } from 'firebase-admin/firestore';

import { generatePriceUpdates } from './updatePrices.js';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import type { PendingPriceUpdateReview, PriceUpdateRequest } from '../src/types/priceUpdates.js';
import type { AssetType, PortfolioAssetInput } from '../src/types/portfolio.js';

const CRON_ROUTE = '/api/cron-update-prices' as const;
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';

type AdminPortfolioAsset = PortfolioAssetInput & {
  priceAsOf?: string;
  lastPriceUpdatedAt?: string;
};

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

function normalizeAssetType(value: unknown): AssetType {
  if (value === 'stock' || value === 'etf' || value === 'bond' || value === 'crypto' || value === 'cash') {
    return value;
  }

  return 'stock';
}

function normalizeAssetInput(value: Record<string, unknown>): AdminPortfolioAsset {
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
    priceAsOf: typeof value.priceAsOf === 'string' ? value.priceAsOf : '',
    lastPriceUpdatedAt:
      typeof value.lastPriceUpdatedAt === 'string' ? value.lastPriceUpdatedAt : '',
  };
}

async function readAssetsForPriceUpdate() {
  const db = getFirebaseAdminDb();
  const assetsSnapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('assets')
    .get();

  return assetsSnapshot.docs
    .map((document) => ({
      id: document.id,
      ...normalizeAssetInput(document.data() as Record<string, unknown>),
    }))
    .filter((asset) => asset.assetType !== 'cash');
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

async function captureCronSnapshot(assetCount: number) {
  const db = getFirebaseAdminDb();
  const assetsSnapshot = await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('assets')
    .get();

  const totalValueHKD = assetsSnapshot.docs.reduce((sum, document) => {
    const value = document.data() as Record<string, unknown>;
    const quantity = typeof value.quantity === 'number' ? value.quantity : 0;
    const currentPrice = typeof value.currentPrice === 'number' ? value.currentPrice : 0;
    const currency = typeof value.currency === 'string' ? value.currency.toUpperCase() : 'HKD';
    const rate = currency === 'USD' ? 7.8 : 1;

    return sum + quantity * currentPrice * rate;
  }, 0);

  await db
    .collection(SHARED_PORTFOLIO_COLLECTION)
    .doc(SHARED_PORTFOLIO_DOC_ID)
    .collection('portfolioSnapshots')
    .add({
      capturedAt: FieldValue.serverTimestamp(),
      date: new Date().toISOString().slice(0, 10),
      totalValueHKD,
      netExternalFlowHKD: 0,
      assetCount,
      reason: 'price_update_confirmed',
      updatedAt: FieldValue.serverTimestamp(),
    });
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
      priceSource: 'ai_auto_applied_cron',
      priceAsOf: review.asOf,
      priceSourceName: review.sourceName,
      priceSourceUrl: review.sourceUrl,
      priceConfidence: review.confidence,
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
      confidence: review.confidence,
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

  if (validResults.length > 0) {
    await captureCronSnapshot(validResults.length);
  }

  return {
    appliedCount: validResults.length,
    pendingCount: invalidResults.length,
  };
}

export async function runScheduledPriceUpdate() {
  const assets = await readAssetsForPriceUpdate();

  if (assets.length === 0) {
    return {
      ok: true,
      route: CRON_ROUTE,
      message: '目前沒有可自動更新價格的資產。',
      assetCount: 0,
      appliedCount: 0,
      pendingCount: 0,
      triggeredAt: new Date().toISOString(),
    };
  }

  const response = await generatePriceUpdates(buildPriceUpdateRequest(assets));
  const outcome = await applyCronResults(response.results);

  return {
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
