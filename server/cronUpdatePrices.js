import { FieldValue } from 'firebase-admin/firestore';
import { fetchLiveFxRates, generatePriceUpdates } from './updatePrices.js';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { readAdminPortfolioAssets } from './portfolioSnapshotAdmin.js';
import { runCoinGeckoCoinIdSync } from './syncCoinIds.js';
const CRON_ROUTE = '/api/cron-update-prices';
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
class CronPriceUpdateError extends Error {
    status;
    constructor(message, status = 500) {
        super(message);
        this.name = 'CronPriceUpdateError';
        this.status = status;
    }
}
function getCronSecret() {
    const value = process.env.CRON_SECRET?.trim();
    if (!value) {
        throw new CronPriceUpdateError('未設定 CRON_SECRET，暫時無法執行排程價格更新。', 500);
    }
    return value;
}
export function verifyCronRequest(authorizationHeader) {
    const cronSecret = getCronSecret();
    const expected = `Bearer ${cronSecret}`;
    if (authorizationHeader !== expected) {
        throw new CronPriceUpdateError('未授權的 cron 請求。', 401);
    }
}
async function readAssetsForPriceUpdate() {
    const assets = await readAdminPortfolioAssets();
    return assets.filter((asset) => asset.assetType !== 'cash');
}
function buildPriceUpdateRequest(assets) {
    return {
        assets: assets.map((asset) => ({
            assetId: asset.id,
            assetName: asset.name,
            ticker: asset.symbol,
            assetType: asset.assetType,
            currentPrice: asset.currentPrice,
            currency: asset.currency,
        })),
    };
}
function isValidReview(review) {
    return review.price != null && review.price > 0 && !review.invalidReason;
}
async function applyCronResults(results) {
    const db = getFirebaseAdminDb();
    const batch = db.batch();
    const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
    const validResults = results.filter(isValidReview);
    const invalidResults = results.filter((review) => !isValidReview(review));
    for (const review of validResults) {
        const assetRef = portfolioRef.collection('assets').doc(review.assetId);
        const reviewRef = portfolioRef.collection('priceUpdateReviews').doc(review.assetId);
        const historyRef = assetRef.collection('priceHistory').doc();
        batch.update(assetRef, {
            currentPrice: review.price,
            updatedAt: FieldValue.serverTimestamp(),
            lastPriceUpdatedAt: FieldValue.serverTimestamp(),
            priceSource: 'api_auto_cron',
            priceAsOf: review.asOf,
            priceSourceName: review.sourceName,
            priceSourceUrl: review.sourceUrl,
        });
        batch.set(reviewRef, {
            ...review,
            status: 'confirmed',
            confirmedAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
        }, { merge: true });
        batch.set(historyRef, {
            assetId: review.assetId,
            assetName: review.assetName,
            ticker: review.ticker,
            assetType: review.assetType,
            price: review.price,
            currency: review.currency,
            asOf: review.asOf,
            sourceName: review.sourceName,
            sourceUrl: review.sourceUrl,
            recordedAt: FieldValue.serverTimestamp(),
        });
    }
    for (const review of invalidResults) {
        const reviewRef = portfolioRef.collection('priceUpdateReviews').doc(review.assetId);
        batch.set(reviewRef, {
            ...review,
            status: 'pending',
            updatedAt: FieldValue.serverTimestamp(),
            createdAt: FieldValue.serverTimestamp(),
        }, { merge: true });
    }
    if (validResults.length > 0 || invalidResults.length > 0) {
        await batch.commit();
    }
    return {
        appliedCount: validResults.length,
        pendingCount: invalidResults.length,
    };
}
async function persistFxRates(fxRates) {
    const db = getFirebaseAdminDb();
    const portfolioRef = db.collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
    await portfolioRef.set({
        fxRates: {
            ...fxRates,
            updatedAt: new Date().toISOString(),
        },
    }, { merge: true });
}
export async function runScheduledPriceUpdate() {
    try {
        await runCoinGeckoCoinIdSync();
    }
    catch (error) {
        console.warn('CoinGecko coin id sync failed before price update.', error);
    }
    const assets = await readAssetsForPriceUpdate();
    const fxRates = await fetchLiveFxRates();
    await persistFxRates(fxRates);
    if (assets.length === 0) {
        return {
            ok: true,
            route: CRON_ROUTE,
            message: '目前沒有可自動更新價格的資產。',
            assetCount: 0,
            appliedCount: 0,
            pendingCount: 0,
            triggeredAt: new Date().toISOString(),
        };
    }
    const response = await generatePriceUpdates(buildPriceUpdateRequest(assets));
    const outcome = await applyCronResults(response.results);
    return {
        ok: true,
        route: CRON_ROUTE,
        message: outcome.pendingCount > 0
            ? `已自動更新 ${outcome.appliedCount} 項資產；${outcome.pendingCount} 項需要人工檢查。`
            : `已自動更新 ${outcome.appliedCount} 項資產價格。`,
        assetCount: assets.length,
        appliedCount: outcome.appliedCount,
        pendingCount: outcome.pendingCount,
        triggeredAt: new Date().toISOString(),
        model: response.model,
    };
}
export function getCronPriceUpdateErrorResponse(error) {
    if (error instanceof CronPriceUpdateError) {
        return {
            status: error.status,
            body: {
                ok: false,
                route: CRON_ROUTE,
                message: error.message,
            },
        };
    }
    if (error instanceof Error) {
        return {
            status: 500,
            body: {
                ok: false,
                route: CRON_ROUTE,
                message: error.message,
            },
        };
    }
    return {
        status: 500,
        body: {
            ok: false,
            route: CRON_ROUTE,
            message: '自動價格更新失敗，請稍後再試。',
        },
    };
}
