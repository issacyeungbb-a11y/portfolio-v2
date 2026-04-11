import { addDoc, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch, } from 'firebase/firestore';
import { convertCurrency } from '../../data/mockPortfolio';
import { getEffectiveHoldingPrice } from '../portfolio/priceValidity';
import { hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
import { getSharedAssetsCollectionRef } from './sharedPortfolio';
function createMissingConfigError() {
    return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}
function normalizePortfolioAssetInput(payload) {
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
function formatTimestamp(value) {
    if (value?.toDate instanceof Function) {
        return value.toDate().toISOString();
    }
    return typeof value === 'string' ? value : '';
}
export function buildHoldingFromInput(id, payload) {
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
    const marketValue = normalized.quantity * effectiveCurrentPrice;
    const costBasis = normalized.quantity * normalized.averageCost;
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
    };
}
export function recalculateHoldingAllocations(holdings, getHoldingValue = (holding) => holding.marketValue) {
    const totalValue = holdings.reduce((sum, holding) => sum + getHoldingValue(holding), 0);
    return holdings.map((holding) => ({
        ...holding,
        allocation: totalValue === 0 ? 0 : (getHoldingValue(holding) / totalValue) * 100,
    }));
}
export function getFirebaseAssetsErrorMessage(error) {
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
export function subscribeToPortfolioAssets(onData, onError) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const assetsRef = getSharedAssetsCollectionRef();
    const assetsQuery = query(assetsRef, orderBy('updatedAt', 'desc'));
    return onSnapshot(assetsQuery, (snapshot) => {
        const holdings = snapshot.docs.map((document) => buildHoldingFromInput(document.id, document.data()));
        onData(holdings);
    }, onError);
}
export async function createPortfolioAsset(payload) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const normalized = normalizePortfolioAssetInput(payload);
    await addDoc(getSharedAssetsCollectionRef(), {
        ...normalized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}
export async function createPortfolioAssets(payloads) {
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
}
export async function updatePortfolioAsset(assetId, payload) {
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
export async function deletePortfolioAsset(assetId) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const assetRef = doc(getSharedAssetsCollectionRef(), assetId);
    await deleteDoc(assetRef);
}
