import { cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
const SHARED_PORTFOLIO_COLLECTION = 'portfolio';
const SHARED_PORTFOLIO_DOC_ID = 'app';
const SHARED_COIN_GECKO_OVERRIDE_COLLECTION = 'coinIdOverrides';
const ADMIN_ENV_KEYS = [
    'FIREBASE_ADMIN_PROJECT_ID',
    'FIREBASE_ADMIN_CLIENT_EMAIL',
    'FIREBASE_ADMIN_PRIVATE_KEY',
];
function normalizePrivateKey(value) {
    return value.replace(/\\n/g, '\n').trim();
}
function readServiceAccountFromJson() {
    const raw = process.env.FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON?.trim();
    if (!raw) {
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 不是有效的 JSON。');
    }
    if (typeof parsed !== 'object' || parsed === null) {
        throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 格式不正確。');
    }
    const value = parsed;
    const projectId = typeof value.project_id === 'string'
        ? value.project_id.trim()
        : typeof value.projectId === 'string'
            ? value.projectId.trim()
            : '';
    const clientEmail = typeof value.client_email === 'string'
        ? value.client_email.trim()
        : typeof value.clientEmail === 'string'
            ? value.clientEmail.trim()
            : '';
    const privateKey = typeof value.private_key === 'string'
        ? normalizePrivateKey(value.private_key)
        : typeof value.privateKey === 'string'
            ? normalizePrivateKey(value.privateKey)
            : '';
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error('FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON 缺少 project_id、client_email 或 private_key。');
    }
    return {
        projectId,
        clientEmail,
        privateKey,
    };
}
function readServiceAccountFromEnv() {
    const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID?.trim() ||
        process.env.VITE_FIREBASE_PROJECT_ID?.trim() ||
        '';
    const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL?.trim() || '';
    const privateKey = normalizePrivateKey(process.env.FIREBASE_ADMIN_PRIVATE_KEY ?? '');
    if (!projectId && !clientEmail && !privateKey) {
        return null;
    }
    if (!projectId || !clientEmail || !privateKey) {
        throw new Error(`Firebase Admin 設定不完整。請補上 ${ADMIN_ENV_KEYS.join('、')}，或改用 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON。`);
    }
    return {
        projectId,
        clientEmail,
        privateKey,
    };
}
function getFirebaseAdminServiceAccount() {
    return readServiceAccountFromJson() ?? readServiceAccountFromEnv();
}
export function getFirebaseAdminSetupErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return `未設定 Firebase Admin 憑證。請設定 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON，或 ${ADMIN_ENV_KEYS.join('、')}。`;
}
export function getFirebaseAdminApp() {
    if (getApps().length > 0) {
        return getApp();
    }
    const serviceAccount = getFirebaseAdminServiceAccount();
    if (!serviceAccount) {
        throw new Error(`未設定 Firebase Admin 憑證。請設定 FIREBASE_ADMIN_SERVICE_ACCOUNT_JSON，或 ${ADMIN_ENV_KEYS.join('、')}。`);
    }
    return initializeApp({
        credential: cert(serviceAccount),
        projectId: serviceAccount.projectId,
    });
}
export async function verifyFirebaseIdToken(idToken) {
    const auth = getAuth(getFirebaseAdminApp());
    return auth.verifyIdToken(idToken);
}
export function getFirebaseAdminDb() {
    return getFirestore(getFirebaseAdminApp());
}
export function getSharedPortfolioDocRef() {
    return getFirebaseAdminDb().collection(SHARED_PORTFOLIO_COLLECTION).doc(SHARED_PORTFOLIO_DOC_ID);
}
export function getSharedCoinGeckoCoinIdCacheCollectionRef() {
    return getSharedPortfolioDocRef().collection('coinIdCache');
}
export function getSharedCoinGeckoCoinIdCacheDocRef(ticker) {
    return getSharedCoinGeckoCoinIdCacheCollectionRef().doc(ticker.trim().toUpperCase());
}
export function getSharedCoinGeckoCoinIdCacheDocRefs(tickers) {
    return tickers.map((ticker) => getSharedCoinGeckoCoinIdCacheDocRef(ticker));
}
export function getSharedCoinGeckoCoinIdOverridesCollectionRef() {
    return getSharedPortfolioDocRef().collection(SHARED_COIN_GECKO_OVERRIDE_COLLECTION);
}
export function getSharedCoinGeckoCoinIdOverrideDocRef(ticker) {
    return getSharedCoinGeckoCoinIdOverridesCollectionRef().doc(ticker.trim().toUpperCase());
}
export function getSharedCoinGeckoCoinIdOverrideDocRefs(tickers) {
    return tickers.map((ticker) => getSharedCoinGeckoCoinIdOverrideDocRef(ticker));
}
