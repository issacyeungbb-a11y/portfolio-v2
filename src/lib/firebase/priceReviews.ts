import {
  doc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import type { PendingPriceUpdateReview } from '../../types/priceUpdates';
import { capturePortfolioSnapshot } from './portfolioSnapshots';
import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getSharedAssetsCollectionRef,
  getSharedPriceReviewsCollectionRef,
} from './sharedPortfolio';

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

function sanitizeBoolean(value: unknown) {
  return typeof value === 'boolean' ? value : false;
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
    confidence: sanitizeNumber(value.confidence),
    needsReview: sanitizeBoolean(value.needsReview),
    currentPrice: sanitizeNumber(value.currentPrice),
    diffPct: sanitizeNumber(value.diffPct),
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

export async function confirmPriceUpdateReview(review: PendingPriceUpdateReview) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetsCollection = getSharedAssetsCollectionRef();
  const reviewsCollection = getSharedPriceReviewsCollectionRef();
  const batch = writeBatch(assetsCollection.firestore);
  const assetRef = doc(assetsCollection, review.assetId);
  const reviewRef = doc(reviewsCollection, review.assetId);

  batch.update(assetRef, {
    currentPrice: review.price,
    updatedAt: serverTimestamp(),
    lastPriceUpdatedAt: serverTimestamp(),
    priceSource: 'ai_review_confirmed',
    priceAsOf: review.asOf,
    priceSourceName: review.sourceName,
    priceSourceUrl: review.sourceUrl,
    priceConfidence: review.confidence,
  });

  batch.update(reviewRef, {
    status: 'confirmed',
    confirmedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await capturePortfolioSnapshot({
    reason: 'price_update_confirmed',
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
