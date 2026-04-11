import {
  addDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';

import type { AccountCashFlowEntry, AccountCashFlowType, AccountSource } from '../../types/portfolio';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAccountCashFlowsCollectionRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(
    `Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`,
  );
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

function sanitizeType(value: unknown): AccountCashFlowType {
  if (value === 'deposit' || value === 'withdrawal' || value === 'adjustment') {
    return value;
  }

  return 'deposit';
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function normalizeAccountCashFlow(
  id: string,
  value: Record<string, unknown>,
): AccountCashFlowEntry {
  return {
    id,
    accountSource: sanitizeAccountSource(value.accountSource),
    type: sanitizeType(value.type),
    amount: sanitizeNumber(value.amount),
    currency: sanitizeString(value.currency).toUpperCase() || 'HKD',
    date: sanitizeString(value.date) || new Date().toISOString().slice(0, 10),
    note: sanitizeString(value.note) || undefined,
    createdAt: formatTimestamp(value.createdAt),
    updatedAt: formatTimestamp(value.updatedAt),
  };
}

export function getAccountCashFlowsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/accountCashFlows`。';
    }

    return error.message;
  }

  return '讀取或儲存資金流水失敗，請稍後再試。';
}

export function subscribeToAccountCashFlows(
  onData: (entries: AccountCashFlowEntry[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const collectionRef = getSharedAccountCashFlowsCollectionRef();
  const cashFlowQuery = query(collectionRef, orderBy('date', 'desc'));

  return onSnapshot(
    cashFlowQuery,
    (snapshot) => {
      onData(
        snapshot.docs.map((entry) =>
          normalizeAccountCashFlow(entry.id, entry.data() as Record<string, unknown>),
        ),
      );
    },
    onError,
  );
}

export async function createAccountCashFlow(
  entry: Omit<AccountCashFlowEntry, 'id' | 'createdAt' | 'updatedAt'>,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const normalizedCurrency = entry.currency.trim().toUpperCase() || 'HKD';
  const normalizedAmount = Number(entry.amount) || 0;

  await addDoc(getSharedAccountCashFlowsCollectionRef(), {
    accountSource: entry.accountSource,
    type: entry.type,
    amount: normalizedAmount,
    currency: normalizedCurrency,
    date: entry.date,
    note: entry.note?.trim() || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
