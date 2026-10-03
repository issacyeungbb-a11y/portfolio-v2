import {
  addDoc,
  doc,
  getDocsFromServer,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import type { Holding, PortfolioAssetInput } from '../../types/portfolio';
import { getHongKongDateKey } from '../dates';
import { getEffectiveHoldingPrice } from '../portfolio/priceValidity';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { callPortfolioFunction } from '../api/vercelFunctions';
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
    const cashAmount = payload.managedCryptoLiability ? normalizedCurrentPrice :
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

  // Defensive: handle a serialized Firestore timestamp ({seconds, nanoseconds})
  // in case a snapshot ever yields a plain object instead of a Timestamp
  // instance — otherwise archivedAt would read as empty and closed positions
  // would leak back into the active asset list.
  if (
    value &&
    typeof value === 'object' &&
    typeof (value as { seconds?: unknown }).seconds === 'number'
  ) {
    return new Date((value as { seconds: number }).seconds * 1000).toISOString();
  }

  return typeof value === 'string' ? value : '';
}

// A non-cash holding that has been fully sold (or otherwise has no positive
// quantity) is a closed position and should not appear in the active list.
function isClosedNonCashPosition(holding: Holding) {
  return holding.assetType !== 'cash' && !(holding.quantity > 0);
}

function normalizeTickerList(values: string[]) {
  return [...new Set(values.map((value) => value.trim().toUpperCase()).filter(Boolean))];
}

function queueCoinGeckoSync(tickers: string[]) {
  const cryptoTickers = normalizeTickerList(tickers);

  if (cryptoTickers.length === 0) {
    return;
  }

  void callPortfolioFunction('update-prices', { syncTickers: cryptoTickers }).catch((error) => {
    console.warn('背景 CoinGecko 代號同步失敗。', error);
  });
}

export function buildHoldingFromInput(
  id: string,
  payload: PortfolioAssetInput & {
    priceAsOf?: unknown;
    lastPriceUpdatedAt?: unknown;
    archivedAt?: unknown;
  },
  options: { useRawCurrentPrice?: boolean } = {},
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
    managedCryptoLiability: payload.managedCryptoLiability,
  });
  const currentPrice = options.useRawCurrentPrice
    ? normalized.currentPrice
    : effectiveCurrentPrice;
  const marketValue =
    normalized.assetType === 'cash'
      ? currentPrice
      : normalized.quantity * currentPrice;
  const costBasis =
    normalized.assetType === 'cash'
      ? normalized.averageCost
      : normalized.quantity * normalized.averageCost;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPct = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;

  return {
    id,
    ...normalized,
    managedCrypto: payload.managedCrypto,
    managedCryptoLiability: payload.managedCryptoLiability,
    managedManualPrice: payload.managedManualPrice,
    currentPrice,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    allocation: 0,
    priceAsOf: formatTimestamp(payload.priceAsOf),
    lastPriceUpdatedAt: formatTimestamp(payload.lastPriceUpdatedAt),
    archivedAt: formatTimestamp(payload.archivedAt),
    valuationOverrideMonth:
      typeof payload.valuationOverrideMonth === 'string'
        ? payload.valuationOverrideMonth
        : undefined,
    valuationUsdHkdRate:
      typeof payload.valuationUsdHkdRate === 'number' && payload.valuationUsdHkdRate > 0
        ? payload.valuationUsdHkdRate
        : undefined,
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

interface PortfolioAssetSnapshotMetadata {
  fromCache: boolean;
}

type RawPortfolioAssetRecord = PortfolioAssetInput & {
  id: string;
  priceAsOf?: unknown;
  lastPriceUpdatedAt?: unknown;
  archivedAt?: unknown;
};

function getPortfolioAssetsQuery() {
  const assetsRef = getSharedAssetsCollectionRef();
  return query(assetsRef, orderBy('updatedAt', 'desc'));
}

function mapLiveAssetRecords(rawAssets: RawPortfolioAssetRecord[], includeClosed: boolean) {
  // Live portfolio screens must show each asset's persisted market quote.
  // Monthly Crypto account overrides belong to history/reconciliation only;
  // applying one here fabricates proportional BTC/ETH "prices" to match a
  // locked month-end account total.
  const holdings = rawAssets.map((asset) =>
    buildHoldingFromInput(asset.id, asset, {
      useRawCurrentPrice: includeClosed,
    }),
  );

  return includeClosed
    ? holdings
    : holdings.filter(
        (holding) => !holding.archivedAt && !isClosedNonCashPosition(holding),
      );
}

async function getPortfolioAssetsFromServerInternal(includeClosed: boolean) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetsSnapshot = await getDocsFromServer(getPortfolioAssetsQuery());
  const rawAssets = assetsSnapshot.docs.map((document) => ({
    id: document.id,
    ...(document.data() as PortfolioAssetInput),
  }));

  return mapLiveAssetRecords(rawAssets, includeClosed);
}

export function getPortfolioAssetsFromServer() {
  return getPortfolioAssetsFromServerInternal(false);
}

export function getAllPortfolioAssetsFromServer() {
  return getPortfolioAssetsFromServerInternal(true);
}

export function subscribeToPortfolioAssets(
  onData: (holdings: Holding[], metadata?: PortfolioAssetSnapshotMetadata) => void,
  onError: (error: unknown) => void,
) {
  return subscribeToLiveAssets(false, onData, onError);
}

export function subscribeToAllPortfolioAssets(
  onData: (holdings: Holding[], metadata?: PortfolioAssetSnapshotMetadata) => void,
  onError: (error: unknown) => void,
) {
  return subscribeToLiveAssets(true, onData, onError);
}

function subscribeToLiveAssets(
  includeClosed: boolean,
  onData: (holdings: Holding[], metadata?: PortfolioAssetSnapshotMetadata) => void,
  onError: (error: unknown) => void,
) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  return onSnapshot(
    getPortfolioAssetsQuery(),
    (snapshot) => {
      const rawAssets = snapshot.docs.map((document) => ({
        id: document.id,
        ...(document.data() as PortfolioAssetInput),
      }));
      onData(mapLiveAssetRecords(rawAssets, includeClosed), {
        fromCache: snapshot.metadata.fromCache,
      });
    },
    onError,
  );
}

export async function createPortfolioAsset(payload: PortfolioAssetInput) {
  if (payload.accountSource === 'Crypto' && (await callPortfolioFunction('crypto-management', { action: 'read' }) as { state: unknown }).state) throw new Error('Crypto 請於「持倉管理中心」新增持倉。');
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const normalized = normalizePortfolioAssetInput(payload);
  const createdHolding = buildHoldingFromInput('pending', normalized);
  const assetsCollection = getSharedAssetsCollectionRef();
  const assetRef = doc(assetsCollection);
  const txRef = doc(getSharedAssetTransactionsCollectionRef());
  const batch = writeBatch(assetsCollection.firestore);

  batch.set(assetRef, {
    ...normalized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (createdHolding.quantity > 0) {
    batch.set(txRef, {
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
      date: getHongKongDateKey(),
      realizedPnlHKD: 0,
      quantityAfter: normalized.quantity,
      averageCostAfter: normalized.averageCost,
      note: '新增資產',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } else {
    batch.set(txRef, {
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
      date: getHongKongDateKey(),
      realizedPnlHKD: 0,
      quantityAfter: 0,
      averageCostAfter: 0,
      note: '新增資產',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  await batch.commit();

  if (normalized.assetType === 'crypto') {
    queueCoinGeckoSync([normalized.symbol]);
  }

  return assetRef.id;
}

export async function createPortfolioAssets(payloads: PortfolioAssetInput[]) {
  if (payloads.some(p => p.accountSource === 'Crypto') && (await callPortfolioFunction('crypto-management', { action: 'read' }) as { state: unknown }).state) throw new Error('Crypto 請於「持倉管理中心」新增持倉。');
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
        date: getHongKongDateKey(),
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
        date: getHongKongDateKey(),
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

  queueCoinGeckoSync(
    payloads
      .filter((payload) => payload.assetType === 'crypto')
      .map((payload) => payload.symbol),
  );
}

export async function updatePortfolioAsset(assetId: string, payload: PortfolioAssetInput) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const normalized = normalizePortfolioAssetInput(payload);
  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);

  if ((await getDoc(assetRef)).data()?.managedCrypto) throw new Error('Crypto 數量請於「持倉管理中心」修改。');
  await updateDoc(assetRef, {
    ...normalized,
    updatedAt: serverTimestamp(),
  });

  if (normalized.assetType === 'crypto') {
    queueCoinGeckoSync([normalized.symbol]);
  }

}

export async function deletePortfolioAsset(assetId: string) {
  if (!hasFirebaseConfig) {
    throw createMissingConfigError();
  }

  const assetRef = doc(getSharedAssetsCollectionRef(), assetId);
  if ((await getDoc(assetRef)).data()?.managedCrypto) throw new Error('Crypto 持倉請於「持倉管理中心」移除。');
  await updateDoc(assetRef, {
    archivedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}
