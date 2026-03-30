import {
  addDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';

import type { Holding, PortfolioAssetInput } from '../../types/portfolio';
import { convertCurrency } from '../../data/mockPortfolio';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { capturePortfolioSnapshot } from './portfolioSnapshots';
import { getSharedAssetsCollectionRef } from './sharedPortfolio';

function createMissingConfigError() {
  return new Error(
    `Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`,
  );
}

function normalizePortfolioAssetInput(payload: PortfolioAssetInput): PortfolioAssetInput {
  return {
    name: payload.name.trim(),
    symbol: payload.symbol.trim().toUpperCase(),
    assetType: payload.assetType,
    accountSource: payload.accountSource,
    currency: payload.currency.trim().toUpperCase(),
    quantity: Number(payload.quantity) || 0,
    averageCost: Number(payload.averageCost) || 0,
    currentPrice: Number(payload.currentPrice) || 0,
  };
}

export function buildHoldingFromInput(
  id: string,
  payload: PortfolioAssetInput,
): Holding {
  const normalized = normalizePortfolioAssetInput(payload);
  const marketValue = normalized.quantity * normalized.currentPrice;
  const costBasis = normalized.quantity * normalized.averageCost;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPct = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;

  return {
    id,
    ...normalized,
    marketValue,
    unrealizedPnl,
    unrealizedPct,
    allocation: 0,
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
      onData(holdings);
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

  await addDoc(getSharedAssetsCollectionRef(), {
    ...normalized,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await capturePortfolioSnapshot({
    netExternalFlowHKD: convertCurrency(
      createdHolding.quantity * createdHolding.averageCost,
      createdHolding.currency,
      'HKD',
    ),
    reason: 'asset_created',
  });
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
  }

  await batch.commit();

  const importedFlowHKD = payloads.reduce((sum, payload) => {
    const normalized = normalizePortfolioAssetInput(payload);
    return (
      sum +
      convertCurrency(
        normalized.quantity * normalized.averageCost,
        normalized.currency,
        'HKD',
      )
    );
  }, 0);

  await capturePortfolioSnapshot({
    netExternalFlowHKD: importedFlowHKD,
    reason: 'assets_imported',
  });
}
