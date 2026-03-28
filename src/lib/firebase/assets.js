import { addDoc, collection, doc, onSnapshot, orderBy, query, serverTimestamp, writeBatch, } from 'firebase/firestore';
import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys, } from './client';
function createMissingConfigError() {
    return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}
function getRequiredFirebaseDb() {
    if (!firebaseDb) {
        throw createMissingConfigError();
    }
    return firebaseDb;
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
export function buildHoldingFromInput(id, payload) {
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
            return 'Firestore 權限被拒絕，請確認 rules 已容許匿名使用者讀寫自己的 users/{uid}/assets。';
        }
        return error.message;
    }
    return '讀取或寫入資產資料失敗，請稍後再試。';
}
export function subscribeToPortfolioAssets(uid, onData, onError) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const db = getRequiredFirebaseDb();
    const assetsRef = collection(db, 'users', uid, 'assets');
    const assetsQuery = query(assetsRef, orderBy('updatedAt', 'desc'));
    return onSnapshot(assetsQuery, (snapshot) => {
        const holdings = snapshot.docs.map((document) => buildHoldingFromInput(document.id, document.data()));
        onData(holdings);
    }, onError);
}
export async function createPortfolioAsset(uid, payload) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const db = getRequiredFirebaseDb();
    const normalized = normalizePortfolioAssetInput(payload);
    await addDoc(collection(db, 'users', uid, 'assets'), {
        ...normalized,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
    });
}
export async function createPortfolioAssets(uid, payloads) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const db = getRequiredFirebaseDb();
    const batch = writeBatch(db);
    const assetsCollection = collection(db, 'users', uid, 'assets');
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
