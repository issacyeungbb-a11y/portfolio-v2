import {
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  query,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import type { PendingPriceUpdateReview } from '../../types/priceUpdates';
import { recordAssetPriceHistory } from './priceHistory';
import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getSharedAssetsCollectionRef,
  getSharedPriceReviewsCollectionRef,
} from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

/** Strip undefined values before writing to Firestore (undefined is not a valid Firestore value). */
function omitUndefined<T extends object>(obj: T): { [K in keyof T]: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined),
  ) as { [K in keyof T]: Exclude<T[K], undefined> };
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

function sanitizeOptionalNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
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

function normalizePendingReview(assetId: string, value: Record<string, unknown>): PendingPriceUpdateReview {
  return {
    id: assetId,
    assetId,
    assetName: sanitizeString(value.assetName),
    ticker: sanitizeString(value.ticker),
    assetType: (sanitizeString(value.assetType) || 'stock') as PendingPriceUpdateReview['assetType'],
    accountSource: sanitizeString(value.accountSource) as PendingPriceUpdateReview['accountSource'],
    price: sanitizeNumber(value.price),
    currency: sanitizeString(value.currency),
    assetCurrency: sanitizeOptionalString(value.assetCurrency) || undefined,
    comparisonCurrentPrice: sanitizeOptionalNumber(value.comparisonCurrentPrice),
    comparisonCurrency: sanitizeOptionalString(value.comparisonCurrency) || undefined,
    marketCurrency: sanitizeOptionalString(value.marketCurrency) || undefined,
    currencyMismatch: value.currencyMismatch === true,
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
  const pendingReviewsQuery = query(reviewsRef, where('status', '==', 'pending'));

  return onSnapshot(
    pendingReviewsQuery,
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

  // P1-3: 讀取現有文件以判斷 firstSeenAt 是否已存在
  const existingDocs = await Promise.all(
    reviews.map((r) => getDoc(doc(reviewsCollection, r.assetId))),
  );
  const existingHasFirstSeen = new Map<string, boolean>(
    reviews.map((r, i) => [
      r.assetId,
      existingDocs[i]?.exists() && existingDocs[i]?.data()?.firstSeenAt != null,
    ]),
  );

  for (const review of reviews) {
    const reviewRef = doc(reviewsCollection, review.assetId);
    const hasFirstSeen = existingHasFirstSeen.get(review.assetId) ?? false;
    batch.set(
      reviewRef,
      {
        ...omitUndefined(review),
        status: 'pending',
        lastSeenAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        // firstSeenAt 只在首次出現時設定，不覆寫已有值
        ...(hasFirstSeen ? {} : { firstSeenAt: serverTimestamp() }),
      },
      { merge: true },
    );
  }

  await batch.commit();
}

export async function applyPriceUpdateReviews(
  reviews: PendingPriceUpdateReview[],
  options?: {
    priceSource?: 'api_auto' | 'api_review_confirmed' | 'manual';
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
      currency: review.currency,
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
        ...omitUndefined(review),
        status,
        confirmedAt: status === 'confirmed' ? serverTimestamp() : null,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  }

  await batch.commit();

  await Promise.all(appliedReviews.map((review) => recordAssetPriceHistory(review)));
}

export async function confirmPriceUpdateReview(review: PendingPriceUpdateReview) {
  await applyPriceUpdateReviews([review], {
    priceSource: 'api_review_confirmed',
    status: 'confirmed',
  });
}

export async function manualOverridePriceReview(
  review: PendingPriceUpdateReview,
  manualPrice: number,
) {
  const overriddenReview: PendingPriceUpdateReview = {
    ...review,
    price: manualPrice,
    isValid: true,
    invalidReason: undefined,
    failureCategory: undefined,
    asOf: new Date().toISOString(),
    sourceName: 'manual',
    sourceUrl: '',
  };

  await applyPriceUpdateReviews([overriddenReview], {
    priceSource: 'manual',
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
