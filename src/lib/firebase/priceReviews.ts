import {
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import type { PendingPriceUpdateReview } from '../../types/priceUpdates';
import { buildHoldingFromInput } from './assets';
import { recordAssetPriceHistory } from './priceHistory';
import { capturePortfolioSnapshot } from './portfolioSnapshots';
import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getSharedAssetsCollectionRef,
  getSharedPriceReviewsCollectionRef,
} from './sharedPortfolio';
import { hasValidHoldingPrice } from '../portfolio/priceValidity';
import type { PortfolioAssetInput } from '../../types/portfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function getRequiredFirebaseDb() {
  if (!firebaseDb) {
    throw createMissingConfigError();
  }

  return firebaseDb;
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function sanitizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sanitizeOptionalString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function sanitizeFailureCategory(value: unknown): PendingPriceUpdateReview['failureCategory'] {
  if (
    value === 'ticker_format' ||
    value === 'quote_time' ||
    value === 'source_missing' ||
    value === 'response_format' ||
    value === 'price_missing' ||
    value === 'diff_too_large' ||
    value === 'unknown'
  ) {
    return value;
  }

  return undefined;
}

function hasValidSuggestedPrice(review: PendingPriceUpdateReview) {
  return review.price != null && review.price > 0 && !review.invalidReason;
}

function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

async function captureSnapshotIfPortfolioFullyUpdated() {
  const assetsSnapshot = await getDocs(getSharedAssetsCollectionRef());
  const reviewsSnapshot = await getDocs(getSharedPriceReviewsCollectionRef());
  const holdings = assetsSnapshot.docs
    .map((entry) => buildHoldingFromInput(entry.id, entry.data() as PortfolioAssetInput))
    .filter((holding) => !holding.archivedAt);
  const pendingReviews = reviewsSnapshot.docs
    .map((entry) => entry.data() as Record<string, unknown>)
    .filter((entry) => entry.status === 'pending');
  const todayKey = getHongKongDateKey();
  const nonCashHoldings = holdings.filter((holding) => holding.assetType !== 'cash');
  const isFullyUpdated = nonCashHoldings.every((holding) => {
    if (!hasValidHoldingPrice(holding) || !holding.lastPriceUpdatedAt) {
      return false;
    }

    return getHongKongDateKey(new Date(holding.lastPriceUpdatedAt)) === todayKey;
  });

  if (!isFullyUpdated || pendingReviews.length > 0) {
    return false;
  }

  await capturePortfolioSnapshot({
    holdings,
    reason: 'price_update_confirmed',
  });

  return true;
}

function normalizePendingReview(assetId: string, value: Record<string, unknown>): PendingPriceUpdateReview {
  return {
    id: assetId,
    assetId,
    assetName: sanitizeString(value.assetName),
    ticker: sanitizeString(value.ticker),
    assetType: (sanitizeString(value.assetType) || 'stock') as PendingPriceUpdateReview['assetType'],
    price: sanitizeNumber(value.price),
    currency: sanitizeString(value.currency),
    asOf: sanitizeString(value.asOf),
    sourceName: sanitizeString(value.sourceName),
    sourceUrl: sanitizeString(value.sourceUrl),
    isValid: value.isValid === true,
    currentPrice: sanitizeNumber(value.currentPrice),
    diffPct: sanitizeNumber(value.diffPct),
    failureCategory: sanitizeFailureCategory(value.failureCategory),
    invalidReason: sanitizeOptionalString(value.invalidReason),
    status:
      value.status === 'confirmed' || value.status === 'dismissed'
        ? value.status
        : 'pending',
  };
}

export function getPriceReviewsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/priceUpdateReviews`。';
    }

    return error.message;
  }

  return '處理價格待確認結果失敗，請稍後再試。';
}

export function subscribeToPriceUpdateReviews(
  onData: (reviews: PendingPriceUpdateReview[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  getRequiredFirebaseDb();
  const reviewsRef = getSharedPriceReviewsCollectionRef();

  return onSnapshot(
    reviewsRef,
    (snapshot) => {
      const reviews = snapshot.docs
        .map((document) =>
          normalizePendingReview(document.id, document.data() as Record<string, unknown>),
        )
        .filter((review) => review.status === 'pending')
        .sort((left, right) => right.diffPct - left.diffPct);

      onData(reviews);
    },
    onError,
  );
}

export async function savePendingPriceUpdateReviews(
  reviews: PendingPriceUpdateReview[],
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  if (reviews.length === 0) {
    return;
  }

  const reviewsCollection = getSharedPriceReviewsCollectionRef();
  const batch = writeBatch(reviewsCollection.firestore);

  for (const review of reviews) {
    const reviewRef = doc(reviewsCollection, review.assetId);
    batch.set(
      reviewRef,
      {
        ...review,
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit();
}

export async function applyPriceUpdateReviews(
  reviews: PendingPriceUpdateReview[],
  options?: {
    priceSource?: 'api_auto' | 'api_review_confirmed';
    status?: 'confirmed' | 'pending';
  },
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetsCollection = getSharedAssetsCollectionRef();
  const reviewsCollection = getSharedPriceReviewsCollectionRef();
  const batch = writeBatch(assetsCollection.firestore);
  const appliedReviews = reviews.filter(hasValidSuggestedPrice);
  const status = options?.status ?? 'confirmed';
  const priceSource = options?.priceSource ?? 'api_auto';

  if (appliedReviews.length === 0) {
    return;
  }

  for (const review of appliedReviews) {
    const assetRef = doc(assetsCollection, review.assetId);
    const reviewRef = doc(reviewsCollection, review.assetId);

    batch.update(assetRef, {
      currentPrice: review.price,
      updatedAt: serverTimestamp(),
      lastPriceUpdatedAt: serverTimestamp(),
      priceSource,
      priceAsOf: review.asOf,
      priceSourceName: review.sourceName,
      priceSourceUrl: review.sourceUrl,
    });

    batch.set(
      reviewRef,
      {
        ...review,
        status,
        confirmedAt: status === 'confirmed' ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit();

  await Promise.all(appliedReviews.map((review) => recordAssetPriceHistory(review)));

  await captureSnapshotIfPortfolioFullyUpdated();
}

export async function confirmPriceUpdateReview(review: PendingPriceUpdateReview) {
  await applyPriceUpdateReviews([review], {
    priceSource: 'api_review_confirmed',
    status: 'confirmed',
  });
}

export async function dismissPriceUpdateReview(assetId: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const reviewsCollection = getSharedPriceReviewsCollectionRef();
  const reviewRef = doc(reviewsCollection, assetId);

  await updateDoc(reviewRef, {
    status: 'dismissed',
    updatedAt: serverTimestamp(),
  });
}
