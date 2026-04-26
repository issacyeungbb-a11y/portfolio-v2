import {
  deleteField,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  startAfter,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Transaction,
} from 'firebase/firestore';

import type {
  AccountSource,
  AssetTransactionEntry,
  AssetTransactionRecordType,
  AssetTransactionType,
  AssetType,
  Holding,
} from '../../types/portfolio';
import { buildHoldingFromInput } from './assets';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getSharedAssetTransactionsCollectionRef,
  getSharedAssetsCollectionRef,
} from './sharedPortfolio';
import { runLedgerRebuild } from '../portfolio/transactionRebuild';

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

export function calculateCashDelta(entry: Pick<LedgerTransaction, 'recordType' | 'transactionType' | 'quantity' | 'price' | 'fees'>) {
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

async function listTransactionsForAsset(assetId: string) {
  const snapshot = await getDocs(query(getSharedAssetTransactionsCollectionRef(), orderBy('date', 'asc')));
  return sortLedgerTransactions(
    snapshot.docs
      .map((entry) => normalizeAssetTransaction(entry.id, entry.data() as Record<string, unknown>))
      .filter((entry) => entry.assetId === assetId)
      .map(toLedgerTransaction),
  );
}

function applyRebuildToTransaction(
  transaction: Transaction,
  assetRef: ReturnType<typeof doc>,
  rebuild: ReturnType<typeof runLedgerRebuild>,
  remainingTxCount: number,
  skipIds: Set<string>,
) {
  const txCollection = getSharedAssetTransactionsCollectionRef();

  for (const result of rebuild.txResults) {
    if (result.id && !skipIds.has(result.id)) {
      transaction.update(doc(txCollection, result.id), {
        realizedPnlHKD: result.realizedPnlHKD,
        quantityAfter: result.quantityAfter,
        averageCostAfter: result.averageCostAfter,
        updatedAt: serverTimestamp(),
      });
    }
  }

  if (remainingTxCount === 0) {
    transaction.update(assetRef, {
      quantity: 0,
      averageCost: 0,
      archivedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    transaction.update(assetRef, {
      quantity: rebuild.finalQuantity,
      averageCost: rebuild.finalAverageCost,
      currentPrice: rebuild.finalLatestTradePrice,
      lastPriceUpdatedAt: serverTimestamp(),
      archivedAt: rebuild.finalQuantity === 0 ? serverTimestamp() : deleteField(),
      updatedAt: serverTimestamp(),
    });
  }
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
  options: {
    limitCount?: number;
  } = {},
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const collectionRef = getSharedAssetTransactionsCollectionRef();
  const limitCount = options.limitCount ?? 300;
  const transactionsQuery = query(collectionRef, orderBy('date', 'desc'), limit(limitCount));

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

export async function loadMoreTransactions(
  cursor: {
    date: string;
  },
  limitCount = 300,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const snapshot = await getDocs(
    query(
      getSharedAssetTransactionsCollectionRef(),
      orderBy('date', 'desc'),
      startAfter(cursor.date),
      limit(limitCount),
    ),
  );

  return snapshot.docs.map((entry) =>
    normalizeAssetTransaction(entry.id, entry.data() as Record<string, unknown>),
  );
}

export async function getRecentAssetTransactions(days = 30, limitCount = 300) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  const snapshot = await getDocs(
    query(getSharedAssetTransactionsCollectionRef(), orderBy('date', 'desc'), limit(limitCount)),
  );

  return snapshot.docs
    .map((entry) => normalizeAssetTransaction(entry.id, entry.data() as Record<string, unknown>))
    .filter((entry) => entry.recordType === 'trade' && entry.date >= cutoffDate);
}

export async function createAssetTransaction(entry: AssetTransactionInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetRef = doc(getSharedAssetsCollectionRef(), entry.assetId);

  // Preflight: check cash holding exists before entering the transaction (collection query)
  const settlementSource = entry.settlementAccountSource ?? entry.accountSource;
  const normalizedCurrency = entry.currency.trim().toUpperCase() || 'HKD';
  const cashDelta = calculateCashDelta({
    recordType: 'trade',
    transactionType: entry.transactionType,
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
  });

  let cashHolding: Holding | null = null;
  if (Math.abs(cashDelta) >= 1e-9) {
    cashHolding = await findCashHoldingForAccount(settlementSource, normalizedCurrency);
    if (!cashHolding) {
      throw new Error(
        `${settlementSource} ${normalizedCurrency} 現金帳戶未設定，請先喺資產頁建立對應現金資產，再寫入交易。`,
      );
    }
  }

  // Collection query: must be outside runTransaction
  const existingTxs = await listTransactionsForAsset(entry.assetId);
  const txCollection = getSharedAssetTransactionsCollectionRef();
  const db = txCollection.firestore;

  // Pre-generate refs before entering the transaction
  const newTxRef = doc(txCollection);
  const seedRef = existingTxs.length === 0 ? doc(txCollection) : null;
  const cashRef = cashHolding ? doc(getSharedAssetsCollectionRef(), cashHolding.id) : null;

  const normalizedEntry: LedgerTransaction = {
    assetId: entry.assetId,
    assetName: entry.assetName.trim(),
    symbol: entry.symbol.trim().toUpperCase(),
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    settlementAccountSource: settlementSource,
    transactionType: entry.transactionType,
    recordType: 'trade',
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
    currency: normalizedCurrency,
    date: entry.date,
    note: entry.note?.trim(),
    id: newTxRef.id,
  };

  await runTransaction(db, async (transaction) => {
    // All reads first (asset + cash reads inside transaction to prevent lost updates)
    const assetSnap = await transaction.get(assetRef);
    const cashSnap = cashRef ? await transaction.get(cashRef) : null;

    if (!assetSnap.exists()) {
      throw new Error('找不到對應資產，請先確認該資產仍然存在。');
    }
    if (cashRef && !cashSnap?.exists()) {
      throw new Error(
        `${settlementSource} ${normalizedCurrency} 現金帳戶未設定，請先喺資產頁建立對應現金資產，再寫入交易。`,
      );
    }

    // Build in-memory transaction list using fresh asset data from transaction read
    const freshHolding = buildHoldingFromInput(assetSnap.id, assetSnap.data() as unknown as Holding);
    let allTransactions: LedgerTransaction[] = [...existingTxs];

    if (existingTxs.length === 0 && seedRef) {
      const seedPayload = buildSeedPayload(freshHolding);
      if (seedPayload) {
        allTransactions = [{ ...seedPayload, id: seedRef.id }];
      }
    }

    allTransactions = sortLedgerTransactions([...allTransactions, normalizedEntry]);
    const rebuild = runLedgerRebuild(allTransactions);

    // Writes: seed first
    if (seedRef) {
      const seedPayload = buildSeedPayload(freshHolding);
      if (seedPayload) {
        const seedResult = rebuild.txResults.find((r) => r.id === seedRef.id);
        transaction.set(seedRef, {
          ...seedPayload,
          realizedPnlHKD: seedResult?.realizedPnlHKD ?? 0,
          quantityAfter: seedResult?.quantityAfter ?? 0,
          averageCostAfter: seedResult?.averageCostAfter ?? 0,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }

    const newTxResult = rebuild.txResults.find((r) => r.id === newTxRef.id);
    transaction.set(newTxRef, {
      assetId: normalizedEntry.assetId,
      assetName: normalizedEntry.assetName,
      symbol: normalizedEntry.symbol,
      assetType: normalizedEntry.assetType,
      accountSource: normalizedEntry.accountSource,
      settlementAccountSource: normalizedEntry.settlementAccountSource,
      transactionType: normalizedEntry.transactionType,
      recordType: normalizedEntry.recordType,
      quantity: normalizedEntry.quantity,
      price: normalizedEntry.price,
      fees: normalizedEntry.fees,
      currency: normalizedEntry.currency,
      date: normalizedEntry.date,
      note: normalizedEntry.note || '',
      realizedPnlHKD: newTxResult?.realizedPnlHKD ?? 0,
      quantityAfter: newTxResult?.quantityAfter ?? 0,
      averageCostAfter: newTxResult?.averageCostAfter ?? 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    const txSetIds = new Set([newTxRef.id, ...(seedRef ? [seedRef.id] : [])]);
    applyRebuildToTransaction(transaction, assetRef, rebuild, allTransactions.length, txSetIds);

    if (cashRef && cashSnap && Math.abs(cashDelta) >= 1e-9) {
      const freshBalance = sanitizeNumber((cashSnap.data() as Record<string, unknown>).currentPrice);
      const nextAmount = freshBalance + cashDelta;
      transaction.update(cashRef, {
        quantity: 1,
        averageCost: nextAmount,
        currentPrice: nextAmount,
        lastPriceUpdatedAt: serverTimestamp(),
        archivedAt: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function updateAssetTransaction(
  entryId: string,
  entry: AssetTransactionInput,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  // Pre-read tx outside transaction to get assetId for collection queries
  const txRef = doc(getSharedAssetTransactionsCollectionRef(), entryId);
  const txSnapshot = await getDoc(txRef);

  if (!txSnapshot.exists()) {
    throw new Error('找不到對應交易記錄。');
  }

  const existing = normalizeAssetTransaction(
    txSnapshot.id,
    txSnapshot.data() as Record<string, unknown>,
  );

  const previousEntry = toLedgerTransaction(existing);
  const existingRecordType = existing.recordType ?? 'trade';
  const assetRef = doc(getSharedAssetsCollectionRef(), existing.assetId);

  // Compute old reversal and new cash delta, merge by account+currency
  const oldSettlement = getTransactionSettlementAccountSource(previousEntry);
  const newSettlement = entry.settlementAccountSource ?? entry.accountSource;
  const newCurrency = entry.currency.trim().toUpperCase() || 'HKD';
  const oldCashReversal = calculateCashDelta(previousEntry) * -1;
  const newCashDelta = calculateCashDelta({
    recordType: existingRecordType,
    transactionType: entry.transactionType,
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
  });

  const cashUpdateMap = new Map<string, { accountSource: AccountSource; currency: string; delta: number }>();
  const mergeCashUpdate = (accountSource: AccountSource, currency: string, delta: number) => {
    if (Math.abs(delta) < 1e-9) return;
    const key = `${accountSource}:${currency}`;
    const prev = cashUpdateMap.get(key);
    if (prev) {
      prev.delta += delta;
    } else {
      cashUpdateMap.set(key, { accountSource, currency, delta });
    }
  };
  mergeCashUpdate(oldSettlement, previousEntry.currency, oldCashReversal);
  mergeCashUpdate(newSettlement, newCurrency, newCashDelta);

  // Preflight all required cash holdings (collection queries, must be outside runTransaction)
  const cashHoldings = new Map<string, Holding>();
  for (const [key, update] of cashUpdateMap) {
    if (Math.abs(update.delta) < 1e-9) continue;
    const holding = await findCashHoldingForAccount(update.accountSource, update.currency);
    if (!holding) {
      throw new Error(
        `${update.accountSource} ${update.currency} 現金帳戶未設定，請先喺資產頁建立對應現金資產，再寫入交易。`,
      );
    }
    cashHoldings.set(key, holding);
  }

  // Collection query: must be outside runTransaction
  const existingTxs = await listTransactionsForAsset(existing.assetId);

  const txCollection = getSharedAssetTransactionsCollectionRef();
  const db = txCollection.firestore;

  // Build cashRefMap from pre-fetched holdings
  const cashRefMap = new Map<string, ReturnType<typeof doc>>();
  for (const [key, holding] of cashHoldings) {
    cashRefMap.set(key, doc(getSharedAssetsCollectionRef(), holding.id));
  }

  const updatedEntry: LedgerTransaction = {
    ...previousEntry,
    transactionType: entry.transactionType,
    settlementAccountSource: newSettlement,
    quantity: Number(entry.quantity) || 0,
    price: Number(entry.price) || 0,
    fees: Number(entry.fees) || 0,
    currency: newCurrency,
    date: entry.date,
    note: entry.note?.trim(),
    id: entryId,
  };

  const allTransactions = sortLedgerTransactions(
    existingTxs.map((tx) => (tx.id === entryId ? updatedEntry : tx)),
  );
  const rebuild = runLedgerRebuild(allTransactions);

  await runTransaction(db, async (transaction) => {
    // All reads first: asset, tx (conflict detection), and all cash accounts
    const assetSnap = await transaction.get(assetRef);
    const txSnap = await transaction.get(txRef);

    const freshCashBalances = new Map<string, number>();
    for (const [key, cashRef] of cashRefMap) {
      const update = cashUpdateMap.get(key);
      if (!update || Math.abs(update.delta) < 1e-9) continue;
      const cashSnap = await transaction.get(cashRef);
      if (!cashSnap.exists()) {
        throw new Error(
          `${update.accountSource} ${update.currency} 現金帳戶未設定，無法完成現金變動。`,
        );
      }
      freshCashBalances.set(key, sanitizeNumber((cashSnap.data() as Record<string, unknown>).currentPrice));
    }

    if (!assetSnap.exists()) {
      throw new Error('找不到對應資產，請先確認該資產仍然存在。');
    }
    if (!txSnap.exists()) {
      throw new Error('找不到對應交易記錄。');
    }

    // Writes
    const editedResult = rebuild.txResults.find((r) => r.id === entryId);
    transaction.update(txRef, {
      transactionType: updatedEntry.transactionType,
      settlementAccountSource: updatedEntry.settlementAccountSource,
      quantity: updatedEntry.quantity,
      price: updatedEntry.price,
      fees: updatedEntry.fees,
      currency: updatedEntry.currency,
      date: updatedEntry.date,
      note: updatedEntry.note || '',
      realizedPnlHKD: editedResult?.realizedPnlHKD ?? 0,
      quantityAfter: editedResult?.quantityAfter ?? 0,
      averageCostAfter: editedResult?.averageCostAfter ?? 0,
      updatedAt: serverTimestamp(),
    });

    applyRebuildToTransaction(transaction, assetRef, rebuild, allTransactions.length, new Set([entryId]));

    for (const [key, update] of cashUpdateMap) {
      if (Math.abs(update.delta) < 1e-9) continue;
      const cashRef = cashRefMap.get(key);
      if (!cashRef) continue;
      const freshBalance = freshCashBalances.get(key) ?? 0;
      const nextAmount = freshBalance + update.delta;
      transaction.update(cashRef, {
        quantity: 1,
        averageCost: nextAmount,
        currentPrice: nextAmount,
        lastPriceUpdatedAt: serverTimestamp(),
        archivedAt: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}

export async function deleteAssetTransaction(entryId: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  // Pre-read tx outside transaction to get assetId for collection queries
  const txRef = doc(getSharedAssetTransactionsCollectionRef(), entryId);
  const txSnapshot = await getDoc(txRef);

  if (!txSnapshot.exists()) {
    throw new Error('找不到對應交易記錄。');
  }

  const existing = normalizeAssetTransaction(
    txSnapshot.id,
    txSnapshot.data() as Record<string, unknown>,
  );

  const previousEntry = toLedgerTransaction(existing);
  const assetRef = doc(getSharedAssetsCollectionRef(), existing.assetId);

  // Preflight cash check (collection query, must be outside runTransaction)
  const cashDeltaToReverse = calculateCashDelta(previousEntry) * -1;
  let cashHolding: Holding | null = null;
  if (Math.abs(cashDeltaToReverse) >= 1e-9) {
    const settlement = getTransactionSettlementAccountSource(previousEntry);
    cashHolding = await findCashHoldingForAccount(settlement, previousEntry.currency);
    if (!cashHolding) {
      throw new Error(
        `${settlement} ${previousEntry.currency} 現金帳戶未設定，無法還原現金變動。`,
      );
    }
  }

  // Collection query: must be outside runTransaction
  const existingTxs = await listTransactionsForAsset(existing.assetId);
  const remainingTxs = existingTxs.filter((tx) => tx.id !== entryId);
  const rebuild = runLedgerRebuild(remainingTxs);

  const txCollection = getSharedAssetTransactionsCollectionRef();
  const db = txCollection.firestore;
  const cashRef = cashHolding ? doc(getSharedAssetsCollectionRef(), cashHolding.id) : null;

  await runTransaction(db, async (transaction) => {
    // All reads first: asset, tx (verify still exists), cash
    const assetSnap = await transaction.get(assetRef);
    const txSnap = await transaction.get(txRef);
    const cashSnap = cashRef ? await transaction.get(cashRef) : null;

    if (!assetSnap.exists()) {
      throw new Error('找不到對應資產，請先確認該資產仍然存在。');
    }
    if (!txSnap.exists()) {
      throw new Error('找不到對應交易記錄。');
    }
    if (cashRef && !cashSnap?.exists()) {
      const settlement = getTransactionSettlementAccountSource(previousEntry);
      throw new Error(
        `${settlement} ${previousEntry.currency} 現金帳戶未設定，無法還原現金變動。`,
      );
    }

    // Writes
    transaction.delete(txRef);
    applyRebuildToTransaction(transaction, assetRef, rebuild, remainingTxs.length, new Set([entryId]));

    if (cashRef && cashSnap && Math.abs(cashDeltaToReverse) >= 1e-9) {
      const freshBalance = sanitizeNumber((cashSnap.data() as Record<string, unknown>).currentPrice);
      const nextAmount = freshBalance + cashDeltaToReverse;
      transaction.update(cashRef, {
        quantity: 1,
        averageCost: nextAmount,
        currentPrice: nextAmount,
        lastPriceUpdatedAt: serverTimestamp(),
        archivedAt: deleteField(),
        updatedAt: serverTimestamp(),
      });
    }
  });
}
