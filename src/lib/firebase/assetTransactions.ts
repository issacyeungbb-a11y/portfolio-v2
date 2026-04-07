import {
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import type {
  AccountSource,
  AssetTransactionEntry,
  AssetTransactionType,
  AssetType,
} from '../../types/portfolio';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAssetTransactionsCollectionRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}

function sanitizeNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function sanitizeString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function sanitizeAccountSource(value: unknown): AccountSource {
  if (value === 'Futu' || value === 'IB' || value === 'Crypto' || value === 'Other') {
    return value;
  }

  return 'Other';
}

function sanitizeAssetType(value: unknown): AssetType {
  if (value === 'stock' || value === 'etf' || value === 'bond' || value === 'crypto' || value === 'cash') {
    return value;
  }

  return 'stock';
}

function sanitizeTransactionType(value: unknown): AssetTransactionType {
  if (value === 'buy' || value === 'sell') {
    return value;
  }

  return 'buy';
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function normalizeAssetTransaction(
  id: string,
  value: Record<string, unknown>,
): AssetTransactionEntry {
  return {
    id,
    assetId: sanitizeString(value.assetId),
    assetName: sanitizeString(value.assetName),
    symbol: sanitizeString(value.symbol).toUpperCase(),
    assetType: sanitizeAssetType(value.assetType),
    accountSource: sanitizeAccountSource(value.accountSource),
    transactionType: sanitizeTransactionType(value.transactionType),
    quantity: sanitizeNumber(value.quantity),
    price: sanitizeNumber(value.price),
    fees: sanitizeNumber(value.fees),
    currency: sanitizeString(value.currency).toUpperCase() || 'HKD',
    date: sanitizeString(value.date) || new Date().toISOString().slice(0, 10),
    note: sanitizeString(value.note) || undefined,
    createdAt: formatTimestamp(value.createdAt),
    updatedAt: formatTimestamp(value.updatedAt),
  };
}

export function getAssetTransactionsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/assetTransactions`。';
    }

    return error.message;
  }

  return '讀取或儲存交易記錄失敗，請稍後再試。';
}

export function subscribeToAssetTransactions(
  onData: (entries: AssetTransactionEntry[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const collectionRef = getSharedAssetTransactionsCollectionRef();
  const transactionsQuery = query(collectionRef, orderBy('date', 'desc'));

  return onSnapshot(
    transactionsQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((entry) =>
          normalizeAssetTransaction(entry.id, entry.data() as Record<string, unknown>),
        ),
      );
    },
    onError,
  );
}

export async function createAssetTransaction(
  entry: Omit<AssetTransactionEntry, 'id' | 'createdAt' | 'updatedAt'>,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  await addDoc(getSharedAssetTransactionsCollectionRef(), {
    assetId: entry.assetId,
    assetName: entry.assetName.trim(),
    symbol: entry.symbol.trim().toUpperCase(),
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    transactionType: entry.transactionType,
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
    currency: entry.currency.trim().toUpperCase() || 'HKD',
    date: entry.date,
    note: entry.note?.trim() || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
