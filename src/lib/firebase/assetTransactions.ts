import {
  addDoc,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import type {
  AccountSource,
  AssetTransactionEntry,
  AssetTransactionRecordType,
  AssetTransactionType,
  AssetType,
  Holding,
} from '../../types/portfolio';
import { convertCurrency } from '../../data/mockPortfolio';
import { buildHoldingFromInput } from './assets';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { capturePortfolioSnapshot } from './portfolioSnapshots';
import {
  getSharedAssetTransactionsCollectionRef,
  getSharedAssetsCollectionRef,
} from './sharedPortfolio';

type AssetTransactionInput = Omit<
  AssetTransactionEntry,
  'id' | 'createdAt' | 'updatedAt' | 'realizedPnlHKD' | 'quantityAfter' | 'averageCostAfter'
>;

interface LedgerTransaction extends AssetTransactionInput {
  id?: string;
  recordType: AssetTransactionRecordType;
  createdAt?: string;
  updatedAt?: string;
}

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

function sanitizeRecordType(value: unknown): AssetTransactionRecordType {
  if (value === 'asset_created') {
    return 'asset_created';
  }

  return value === 'seed' ? 'seed' : 'trade';
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
    settlementAccountSource:
      value.settlementAccountSource == null
        ? undefined
        : sanitizeAccountSource(value.settlementAccountSource),
    transactionType: sanitizeTransactionType(value.transactionType),
    quantity: sanitizeNumber(value.quantity),
    price: sanitizeNumber(value.price),
    fees: sanitizeNumber(value.fees),
    currency: sanitizeString(value.currency).toUpperCase() || 'HKD',
    date: sanitizeString(value.date) || new Date().toISOString().slice(0, 10),
    realizedPnlHKD: sanitizeNumber(value.realizedPnlHKD),
    recordType: sanitizeRecordType(value.recordType),
    quantityAfter: sanitizeNumber(value.quantityAfter),
    averageCostAfter: sanitizeNumber(value.averageCostAfter),
    note: sanitizeString(value.note) || undefined,
    createdAt: formatTimestamp(value.createdAt),
    updatedAt: formatTimestamp(value.updatedAt),
  };
}

function toLedgerTransaction(entry: AssetTransactionEntry): LedgerTransaction {
  return {
    assetId: entry.assetId,
    assetName: entry.assetName,
    symbol: entry.symbol,
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    settlementAccountSource: entry.settlementAccountSource,
    transactionType: entry.transactionType,
    quantity: entry.quantity,
    price: entry.price,
    fees: entry.fees,
    currency: entry.currency,
    date: entry.date,
    note: entry.note,
    recordType: entry.recordType ?? 'trade',
    id: entry.id,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function sortLedgerTransactions(entries: LedgerTransaction[]) {
  return [...entries].sort((left, right) => {
    const dateDiff = left.date.localeCompare(right.date);
    if (dateDiff !== 0) {
      return dateDiff;
    }

    const createdDiff = (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
    if (createdDiff !== 0) {
      return createdDiff;
    }

    return (left.id ?? '').localeCompare(right.id ?? '');
  });
}

function validateLedgerTransaction(entry: LedgerTransaction, quantityBefore: number) {
  if (entry.recordType === 'asset_created') {
    return;
  }

  if (entry.quantity <= 0 || entry.price <= 0) {
    throw new Error('交易數量同成交價都必須大過 0。');
  }

  if (entry.recordType !== 'seed' && entry.transactionType === 'sell' && entry.quantity > quantityBefore) {
    throw new Error(`${entry.symbol} 的賣出數量不可大過當時持倉。`);
  }
}

function buildSeedPayload(holding: Holding): LedgerTransaction | null {
  if (holding.quantity <= 0) {
    return null;
  }

  return {
    assetId: holding.id,
    assetName: holding.name,
    symbol: holding.symbol,
    assetType: holding.assetType,
    accountSource: holding.accountSource,
    transactionType: 'buy',
    quantity: holding.quantity,
    price: holding.averageCost,
    fees: 0,
    currency: holding.currency,
    date: new Date().toISOString().slice(0, 10),
    note: '歷史持倉基線',
    recordType: 'seed',
  };
}

function getTransactionSettlementAccountSource(entry: Pick<LedgerTransaction, 'settlementAccountSource' | 'accountSource'>) {
  return entry.settlementAccountSource ?? entry.accountSource;
}

function calculateCashDelta(entry: Pick<LedgerTransaction, 'recordType' | 'transactionType' | 'quantity' | 'price' | 'fees'>) {
  if (entry.recordType !== 'trade') {
    return 0;
  }

  const grossAmount = entry.quantity * entry.price;

  return entry.transactionType === 'buy'
    ? -(grossAmount + entry.fees)
    : grossAmount - entry.fees;
}

async function findCashHoldingForAccount(accountSource: AccountSource, currency: string) {
  const snapshot = await getDocs(query(getSharedAssetsCollectionRef(), orderBy('updatedAt', 'desc')));

  for (const entry of snapshot.docs) {
    const holding = buildHoldingFromInput(entry.id, entry.data() as unknown as Holding);
    if (
      holding.assetType === 'cash' &&
      holding.accountSource === accountSource &&
      holding.currency === currency &&
      !holding.archivedAt
    ) {
      return holding;
    }
  }

  return null;
}

async function adjustCashHoldingBalance(
  accountSource: AccountSource,
  currency: string,
  deltaAmount: number,
) {
  if (Math.abs(deltaAmount) < 1e-9) {
    return;
  }

  const normalizedCurrency = currency.trim().toUpperCase() || 'HKD';
  const existingCashHolding = await findCashHoldingForAccount(accountSource, normalizedCurrency);

  if (!existingCashHolding) {
    await addDoc(getSharedAssetsCollectionRef(), {
      name: `${accountSource} ${normalizedCurrency} 現金`,
      symbol: `CASH-${accountSource}-${normalizedCurrency}`,
      assetType: 'cash',
      accountSource,
      currency: normalizedCurrency,
      quantity: 1,
      averageCost: deltaAmount,
      currentPrice: deltaAmount,
      lastPriceUpdatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return;
  }

  const nextAmount = existingCashHolding.currentPrice + deltaAmount;

  await updateDoc(doc(getSharedAssetsCollectionRef(), existingCashHolding.id), {
    quantity: 1,
    averageCost: nextAmount,
    currentPrice: nextAmount,
    lastPriceUpdatedAt: serverTimestamp(),
    archivedAt: deleteField(),
    updatedAt: serverTimestamp(),
  });
}

async function applyCashSettlementDelta(entry: LedgerTransaction, multiplier: 1 | -1) {
  const deltaAmount = calculateCashDelta(entry) * multiplier;
  if (Math.abs(deltaAmount) < 1e-9) {
    return;
  }

  await adjustCashHoldingBalance(
    getTransactionSettlementAccountSource(entry),
    entry.currency,
    deltaAmount,
  );
}

async function listTransactionsForAsset(assetId: string) {
  const snapshot = await getDocs(query(getSharedAssetTransactionsCollectionRef(), orderBy('date', 'asc')));
  return sortLedgerTransactions(
    snapshot.docs
      .map((entry) => normalizeAssetTransaction(entry.id, entry.data() as Record<string, unknown>))
      .filter((entry) => entry.assetId === assetId)
      .map(toLedgerTransaction),
  );
}

async function ensureSeedTransactionForHolding(holding: Holding) {
  const existing = await listTransactionsForAsset(holding.id);
  if (existing.length > 0) {
    return existing;
  }

  const seedPayload = buildSeedPayload(holding);
  if (!seedPayload) {
    return existing;
  }

  await addDoc(getSharedAssetTransactionsCollectionRef(), {
    ...seedPayload,
    realizedPnlHKD: 0,
    quantityAfter: holding.quantity,
    averageCostAfter: holding.averageCost,
    note: seedPayload.note,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  return listTransactionsForAsset(holding.id);
}

async function rebuildAssetFromTransactions(assetId: string) {
  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);
  const assetSnapshot = await getDoc(assetRef);

  if (!assetSnapshot.exists()) {
    throw new Error('找不到對應資產，請先確認該資產仍然存在。');
  }

  const transactions = await listTransactionsForAsset(assetId);

  if (transactions.length === 0) {
    await updateDoc(assetRef, {
      quantity: 0,
      averageCost: 0,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await capturePortfolioSnapshot({
      reason: 'snapshot',
    });
    return;
  }

  const batch = writeBatch(getSharedAssetsCollectionRef().firestore);
  let quantity = 0;
  let averageCost = 0;
  let latestTradePrice = 0;

  for (const transaction of transactions) {
    validateLedgerTransaction(transaction, quantity);

    let nextQuantity = quantity;
    let nextAverageCost = averageCost;
    let realizedPnl = 0;

    if (transaction.recordType === 'asset_created') {
      nextQuantity = quantity;
      nextAverageCost = averageCost;
    } else if (transaction.recordType === 'seed') {
      nextQuantity = transaction.quantity;
      nextAverageCost =
        transaction.quantity === 0
          ? 0
          : ((transaction.quantity * transaction.price) + transaction.fees) / transaction.quantity;
    } else if (transaction.transactionType === 'buy') {
      nextQuantity = quantity + transaction.quantity;
      nextAverageCost =
        nextQuantity === 0
          ? 0
          : ((quantity * averageCost) + (transaction.quantity * transaction.price) + transaction.fees) /
            nextQuantity;
    } else {
      nextQuantity = Math.max(0, quantity - transaction.quantity);
      realizedPnl = (transaction.price - averageCost) * transaction.quantity - transaction.fees;
      nextAverageCost = nextQuantity === 0 ? 0 : averageCost;
    }

    latestTradePrice = transaction.price;
    quantity = nextQuantity;
    averageCost = nextAverageCost;

    if (transaction.id) {
      batch.update(doc(getSharedAssetTransactionsCollectionRef(), transaction.id), {
        realizedPnlHKD: convertCurrency(realizedPnl, transaction.currency, 'HKD'),
        quantityAfter: nextQuantity,
        averageCostAfter: nextAverageCost,
        updatedAt: serverTimestamp(),
      });
    }
  }

  batch.update(assetRef, {
    quantity,
    averageCost,
    currentPrice: latestTradePrice,
    lastPriceUpdatedAt: serverTimestamp(),
    archivedAt: quantity === 0 ? serverTimestamp() : deleteField(),
    updatedAt: serverTimestamp(),
  });

  await batch.commit();

  await capturePortfolioSnapshot({
    reason: 'snapshot',
  });
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

export async function createAssetTransaction(entry: AssetTransactionInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetRef = doc(getSharedAssetsCollectionRef(), entry.assetId);
  const assetSnapshot = await getDoc(assetRef);

  if (!assetSnapshot.exists()) {
    throw new Error('找不到對應資產，請先確認該資產仍然存在。');
  }

  const currentHolding = buildHoldingFromInput(
    assetSnapshot.id,
    assetSnapshot.data() as unknown as Holding,
  );

  await ensureSeedTransactionForHolding(currentHolding);

  await addDoc(getSharedAssetTransactionsCollectionRef(), {
    assetId: entry.assetId,
    assetName: entry.assetName.trim(),
    symbol: entry.symbol.trim().toUpperCase(),
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    settlementAccountSource: entry.settlementAccountSource ?? entry.accountSource,
    transactionType: entry.transactionType,
    recordType: 'trade',
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
    currency: entry.currency.trim().toUpperCase() || 'HKD',
    date: entry.date,
    realizedPnlHKD: 0,
    quantityAfter: 0,
    averageCostAfter: 0,
    note: entry.note?.trim() || '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await rebuildAssetFromTransactions(entry.assetId);
  await applyCashSettlementDelta(
    {
      ...entry,
      settlementAccountSource: entry.settlementAccountSource ?? entry.accountSource,
      recordType: 'trade',
    },
    1,
  );
}

export async function updateAssetTransaction(
  entryId: string,
  entry: AssetTransactionInput,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const transactionRef = doc(getSharedAssetTransactionsCollectionRef(), entryId);
  const transactionSnapshot = await getDoc(transactionRef);

  if (!transactionSnapshot.exists()) {
    throw new Error('找不到對應交易記錄。');
  }

  const existing = normalizeAssetTransaction(
    transactionSnapshot.id,
    transactionSnapshot.data() as Record<string, unknown>,
  );

  const previousLedgerEntry = toLedgerTransaction(existing);

  await updateDoc(transactionRef, {
    transactionType: entry.transactionType,
    settlementAccountSource: entry.settlementAccountSource ?? entry.accountSource,
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
    date: entry.date,
    note: entry.note?.trim() || '',
    updatedAt: serverTimestamp(),
  });

  await rebuildAssetFromTransactions(existing.assetId);
  await applyCashSettlementDelta(previousLedgerEntry, -1);
  await applyCashSettlementDelta(
    {
      ...entry,
      settlementAccountSource: entry.settlementAccountSource ?? entry.accountSource,
      recordType: existing.recordType ?? 'trade',
    },
    1,
  );
}

export async function deleteAssetTransaction(entryId: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const transactionRef = doc(getSharedAssetTransactionsCollectionRef(), entryId);
  const transactionSnapshot = await getDoc(transactionRef);

  if (!transactionSnapshot.exists()) {
    throw new Error('找不到對應交易記錄。');
  }

  const existing = normalizeAssetTransaction(
    transactionSnapshot.id,
    transactionSnapshot.data() as Record<string, unknown>,
  );

  const previousLedgerEntry = toLedgerTransaction(existing);

  await deleteDoc(transactionRef);
  await rebuildAssetFromTransactions(existing.assetId);
  await applyCashSettlementDelta(previousLedgerEntry, -1);
}
