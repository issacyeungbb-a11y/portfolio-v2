import { doc, onSnapshot, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

import type { AccountPrincipalEntry, AccountSource } from '../../types/portfolio';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAccountPrincipalsCollectionRef } from './sharedPortfolio';

const ACCOUNT_SOURCES: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];

function createMissingConfigError() {
  return new Error(
    `Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`,
  );
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

function normalizeAccountSource(value: unknown): AccountSource | null {
  if (value === 'Futu' || value === 'IB' || value === 'Crypto' || value === 'Other') {
    return value;
  }

  return null;
}

function normalizeAccountPrincipalEntry(
  accountSource: AccountSource,
  value: Record<string, unknown> | undefined,
): AccountPrincipalEntry {
  const principalAmount =
    typeof value?.principalAmount === 'number' && Number.isFinite(value.principalAmount)
      ? value.principalAmount
      : 0;
  const currency =
    typeof value?.currency === 'string' && value.currency.trim()
      ? value.currency.trim().toUpperCase()
      : 'HKD';

  return {
    accountSource,
    principalAmount,
    currency,
    updatedAt: formatTimestamp(value?.updatedAt),
  };
}

export function getAccountPrincipalsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/accountPrincipals`。';
    }

    return error.message;
  }

  return '讀取或儲存帳戶本金失敗，請稍後再試。';
}

export function subscribeToAccountPrincipals(
  onData: (entries: AccountPrincipalEntry[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const collectionRef = getSharedAccountPrincipalsCollectionRef();
  return onSnapshot(
    collectionRef,
    (snapshot) => {
      const entryMap = new Map<AccountSource, AccountPrincipalEntry>();

      ACCOUNT_SOURCES.forEach((source) => {
        entryMap.set(source, {
          accountSource: source,
          principalAmount: 0,
          currency: 'HKD',
        });
      });

      snapshot.docs.forEach((entry) => {
        const accountSource = normalizeAccountSource(entry.id);
        if (!accountSource) {
          return;
        }

        entryMap.set(
          accountSource,
          normalizeAccountPrincipalEntry(
            accountSource,
            entry.data() as Record<string, unknown>,
          ),
        );
      });

      onData(
        ACCOUNT_SOURCES.map((source) => entryMap.get(source)!).sort(
          (left, right) =>
            ACCOUNT_SOURCES.indexOf(left.accountSource) -
            ACCOUNT_SOURCES.indexOf(right.accountSource),
        ),
      );
    },
    onError,
  );
}

export async function saveAccountPrincipal(entry: AccountPrincipalEntry) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const parsedPrincipalAmount =
    typeof entry.principalAmount === 'number'
      ? entry.principalAmount
      : Number(entry.principalAmount);
  if (!Number.isFinite(parsedPrincipalAmount) || parsedPrincipalAmount < 0) {
    throw new Error('本金金額必須為零或以上的有效數字。');
  }

  const collectionRef = getSharedAccountPrincipalsCollectionRef();
  await setDoc(
    doc(collectionRef, entry.accountSource),
    {
      accountSource: entry.accountSource,
      principalAmount: parsedPrincipalAmount,
      currency: entry.currency.trim().toUpperCase() || 'HKD',
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
}
