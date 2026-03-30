import {
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
} from 'firebase/firestore';

import type { AssetPriceHistoryEntry, PendingPriceUpdateReview } from '../../types/priceUpdates';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAssetPriceHistoryCollectionRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value : '';
}

function sanitizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function formatRecordedAt(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  if (typeof value === 'string') {
    return value;
  }

  return '';
}

function normalizePriceHistoryEntry(
  assetId: string,
  entryId: string,
  value: Record<string, unknown>,
): AssetPriceHistoryEntry {
  return {
    id: entryId,
    assetId,
    assetName: sanitizeString(value.assetName),
    ticker: sanitizeString(value.ticker),
    assetType: (sanitizeString(value.assetType) || 'stock') as AssetPriceHistoryEntry['assetType'],
    price: sanitizeNumber(value.price),
    currency: sanitizeString(value.currency),
    asOf: sanitizeString(value.asOf),
    sourceName: sanitizeString(value.sourceName),
    sourceUrl: sanitizeString(value.sourceUrl),
    confidence: sanitizeNumber(value.confidence),
    recordedAt: formatRecordedAt(value.recordedAt),
  };
}

export function getPriceHistoryErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/assets/{assetId}/priceHistory`。';
    }

    return error.message;
  }

  return '讀取或寫入價格歷史失敗，請稍後再試。';
}

export async function recordAssetPriceHistory(review: PendingPriceUpdateReview) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const historyCollection = getSharedAssetPriceHistoryCollectionRef(review.assetId);
  const historyRef = doc(historyCollection);

  await setDoc(historyRef, {
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
    recordedAt: serverTimestamp(),
  });
}

export async function getRecentAssetPriceHistory(assetId: string, count = 30) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const historyCollection = getSharedAssetPriceHistoryCollectionRef(assetId);
  const historyQuery = query(historyCollection, orderBy('recordedAt', 'desc'), limit(count));
  const snapshot = await getDocs(historyQuery);

  return snapshot.docs.map((entry) =>
    normalizePriceHistoryEntry(assetId, entry.id, entry.data() as Record<string, unknown>),
  );
}

export function subscribeToAssetPriceHistory(
  assetId: string,
  onData: (entries: AssetPriceHistoryEntry[]) => void,
  onError: (error: unknown) => void,
  count = 30,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const historyCollection = getSharedAssetPriceHistoryCollectionRef(assetId);
  const historyQuery = query(historyCollection, orderBy('recordedAt', 'desc'), limit(count));

  return onSnapshot(
    historyQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((entry) =>
          normalizePriceHistoryEntry(assetId, entry.id, entry.data() as Record<string, unknown>),
        ),
      );
    },
    onError,
  );
}
