import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import type { PendingPriceUpdateReview } from '../../types/priceUpdates';
import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys } from './client';

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
      return 'Firestore 權限被拒絕，請確認 rules 已容許匿名使用者讀寫自己的價格待確認結果。';
    }

    return error.message;
  }

  return '處理價格待確認結果失敗，請稍後再試。';
}

export function subscribeToPriceUpdateReviews(
  uid: string,
  onData: (reviews: PendingPriceUpdateReview[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const db = getRequiredFirebaseDb();
  const reviewsRef = collection(db, 'users', uid, 'priceUpdateReviews');

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
  uid: string,
  reviews: PendingPriceUpdateReview[],
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const db = getRequiredFirebaseDb();
  const batch = writeBatch(db);

  for (const review of reviews) {
    const reviewRef = doc(db, 'users', uid, 'priceUpdateReviews', review.assetId);
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

export async function confirmPriceUpdateReview(uid: string, review: PendingPriceUpdateReview) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const db = getRequiredFirebaseDb();
  const batch = writeBatch(db);
  const assetRef = doc(db, 'users', uid, 'assets', review.assetId);
  const reviewRef = doc(db, 'users', uid, 'priceUpdateReviews', review.assetId);

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
}

export async function dismissPriceUpdateReview(uid: string, assetId: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const db = getRequiredFirebaseDb();
  const reviewRef = doc(db, 'users', uid, 'priceUpdateReviews', assetId);

  await updateDoc(reviewRef, {
    status: 'dismissed',
    updatedAt: serverTimestamp(),
  });
}
