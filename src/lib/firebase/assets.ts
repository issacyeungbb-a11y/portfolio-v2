import {
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import type { Holding, PortfolioAssetInput } from '../../types/portfolio';
import { getEffectiveHoldingPrice } from '../portfolio/priceValidity';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import {
  getSharedAssetTransactionsCollectionRef,
  getSharedAssetsCollectionRef,
} from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(
    `Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`,
  );
}

function normalizePortfolioAssetInput(payload: PortfolioAssetInput): PortfolioAssetInput {
  const normalizedCurrency = payload.currency.trim().toUpperCase();
  const normalizedQuantity = Number(payload.quantity) || 0;
  const normalizedAverageCost = Number(payload.averageCost) || 0;
  const normalizedCurrentPrice = Number(payload.currentPrice) || 0;

  if (payload.assetType === 'cash') {
    const cashAmount =
      normalizedCurrentPrice ||
      normalizedAverageCost ||
      normalizedQuantity ||
      0;

    return {
      name: payload.name.trim(),
      symbol: payload.symbol.trim().toUpperCase(),
      assetType: payload.assetType,
      accountSource: payload.accountSource,
      currency: normalizedCurrency,
      quantity: 1,
      averageCost: cashAmount,
      currentPrice: cashAmount,
    };
  }

  return {
    name: payload.name.trim(),
    symbol: payload.symbol.trim().toUpperCase(),
    assetType: payload.assetType,
    accountSource: payload.accountSource,
    currency: normalizedCurrency,
    quantity: normalizedQuantity,
    averageCost: normalizedAverageCost,
    currentPrice: normalizedCurrentPrice,
  };
}

function formatTimestamp(value: unknown) {
  if (value instanceof Timestamp) {
    return value.toDate().toISOString();
  }

  return typeof value === 'string' ? value : '';
}

export function buildHoldingFromInput(
  id: string,
  payload: PortfolioAssetInput & {
    priceAsOf?: unknown;
    lastPriceUpdatedAt?: unknown;
    archivedAt?: unknown;
  },
): Holding {
  const normalized = normalizePortfolioAssetInput(payload);
  const effectiveCurrentPrice = getEffectiveHoldingPrice({
    id,
    ...normalized,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    allocation: 0,
    priceAsOf: formatTimestamp(payload.priceAsOf),
    lastPriceUpdatedAt: formatTimestamp(payload.lastPriceUpdatedAt),
  });
  const marketValue =
    normalized.assetType === 'cash'
      ? effectiveCurrentPrice
      : normalized.quantity * effectiveCurrentPrice;
  const costBasis =
    normalized.assetType === 'cash'
      ? normalized.averageCost
      : normalized.quantity * normalized.averageCost;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPct = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;

  return {
    id,
    ...normalized,
    currentPrice: effectiveCurrentPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    allocation: 0,
    priceAsOf: formatTimestamp(payload.priceAsOf),
    lastPriceUpdatedAt: formatTimestamp(payload.lastPriceUpdatedAt),
    archivedAt: formatTimestamp(payload.archivedAt),
  };
}

export function recalculateHoldingAllocations(
  holdings: Holding[],
  getHoldingValue: (holding: Holding) => number = (holding) => holding.marketValue,
) {
  const totalValue = holdings.reduce((sum, holding) => sum + getHoldingValue(holding), 0);

  return holdings.map((holding) => ({
    ...holding,
    allocation: totalValue === 0 ? 0 : (getHoldingValue(holding) / totalValue) * 100,
  }));
}

export function getFirebaseAssetsErrorMessage(error?: unknown) {
  if (!hasFirebaseConfig) {
    return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
  }

  if (error instanceof Error) {
    if (error.message.includes('permission-denied')) {
      return 'Firestore 權限被拒絕，請確認 rules 已容許共享投資組合讀寫 `portfolio/app/assets`。';
    }

    return error.message;
  }

  return '讀取或寫入資產資料失敗，請稍後再試。';
}

export function subscribeToPortfolioAssets(
  onData: (holdings: Holding[]) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetsRef = getSharedAssetsCollectionRef();
  const assetsQuery = query(assetsRef, orderBy('updatedAt', 'desc'));

  return onSnapshot(
    assetsQuery,
    (snapshot) => {
      const holdings = snapshot.docs.map((document) =>
        buildHoldingFromInput(document.id, document.data() as PortfolioAssetInput),
      );
      onData(holdings.filter((holding) => !holding.archivedAt));
    },
    onError,
  );
}

export async function createPortfolioAsset(payload: PortfolioAssetInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const normalized = normalizePortfolioAssetInput(payload);
  const createdHolding = buildHoldingFromInput('pending', normalized);
  const createdDoc = await addDoc(getSharedAssetsCollectionRef(), {
    ...normalized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  if (createdHolding.quantity > 0) {
    await addDoc(getSharedAssetTransactionsCollectionRef(), {
      assetId: createdDoc.id,
      assetName: normalized.name,
      symbol: normalized.symbol,
      assetType: normalized.assetType,
      accountSource: normalized.accountSource,
      transactionType: 'buy',
      recordType: 'seed',
      quantity: normalized.quantity,
      price: normalized.averageCost,
      fees: 0,
      currency: normalized.currency,
      date: new Date().toISOString().slice(0, 10),
      realizedPnlHKD: 0,
      quantityAfter: normalized.quantity,
      averageCostAfter: normalized.averageCost,
      note: '新增資產',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    await addDoc(getSharedAssetTransactionsCollectionRef(), {
      assetId: createdDoc.id,
      assetName: normalized.name,
      symbol: normalized.symbol,
      assetType: normalized.assetType,
      accountSource: normalized.accountSource,
      transactionType: 'buy',
      recordType: 'asset_created',
      quantity: 0,
      price: 0,
      fees: 0,
      currency: normalized.currency,
      date: new Date().toISOString().slice(0, 10),
      realizedPnlHKD: 0,
      quantityAfter: 0,
      averageCostAfter: 0,
      note: '新增資產',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  return createdDoc.id;
}

export async function createPortfolioAssets(payloads: PortfolioAssetInput[]) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetsCollection = getSharedAssetsCollectionRef();
  const batch = writeBatch(assetsCollection.firestore);

  for (const payload of payloads) {
    const normalized = normalizePortfolioAssetInput(payload);
    const assetRef = doc(assetsCollection);

    batch.set(assetRef, {
      ...normalized,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (normalized.quantity > 0) {
      const transactionRef = doc(getSharedAssetTransactionsCollectionRef());
      batch.set(transactionRef, {
        assetId: assetRef.id,
        assetName: normalized.name,
        symbol: normalized.symbol,
        assetType: normalized.assetType,
        accountSource: normalized.accountSource,
        transactionType: 'buy',
        recordType: 'seed',
        quantity: normalized.quantity,
        price: normalized.averageCost,
        fees: 0,
        currency: normalized.currency,
        date: new Date().toISOString().slice(0, 10),
        realizedPnlHKD: 0,
        quantityAfter: normalized.quantity,
        averageCostAfter: normalized.averageCost,
        note: '新增資產',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const transactionRef = doc(getSharedAssetTransactionsCollectionRef());
      batch.set(transactionRef, {
        assetId: assetRef.id,
        assetName: normalized.name,
        symbol: normalized.symbol,
        assetType: normalized.assetType,
        accountSource: normalized.accountSource,
        transactionType: 'buy',
        recordType: 'asset_created',
        quantity: 0,
        price: 0,
        fees: 0,
        currency: normalized.currency,
        date: new Date().toISOString().slice(0, 10),
        realizedPnlHKD: 0,
        quantityAfter: 0,
        averageCostAfter: 0,
        note: '新增資產',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  await batch.commit();
}

export async function updatePortfolioAsset(assetId: string, payload: PortfolioAssetInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const normalized = normalizePortfolioAssetInput(payload);
  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);

  await updateDoc(assetRef, {
    ...normalized,
    updatedAt: serverTimestamp(),
  });

}

export async function deletePortfolioAsset(assetId: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);
  await deleteDoc(assetRef);

}
