import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
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
export function getFirebaseUserBootstrapErrorMessage(error) {
    if (!hasFirebaseConfig) {
        return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
    }
    if (error &&
        typeof error === 'object' &&
        'message' in error &&
        typeof error.message === 'string' &&
        error.message === 'FIRESTORE_USER_BOOTSTRAP_TIMEOUT') {
        return '等待 Firestore 回應超時。請先確認已在 Firebase Console 建立 Cloud Firestore Database，並檢查 Firestore rules 是否容許匿名使用者讀寫自己的 users/{uid} 資料。';
    }
    if (error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string') {
        if (error.code.includes('permission-denied')) {
            return 'Firestore 權限被拒絕。請檢查 Firestore rules，確保匿名登入後可以讀寫自己的 users/{uid} 文件。';
        }
        if (error.code.includes('unavailable')) {
            return '目前無法連到 Firestore。請檢查網絡連線、瀏覽器擴充功能，並確認 Firebase 專案已啟用 Cloud Firestore。';
        }
    }
    if (error instanceof Error) {
        return error.message;
    }
    return '初始化 Firestore 使用者資料失敗，請稍後再試。';
}
export async function ensureUserDocument(uid) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const db = getRequiredFirebaseDb();
    const userRef = doc(db, 'users', uid);
    try {
        await updateDoc(userRef, {
            authType: 'anonymous',
            updatedAt: serverTimestamp(),
            lastSeenAt: serverTimestamp(),
        });
    }
    catch (error) {
        if (error &&
            typeof error === 'object' &&
            'code' in error &&
            typeof error.code === 'string' &&
            error.code.includes('not-found')) {
            await setDoc(userRef, {
                authType: 'anonymous',
                onboardingDone: false,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                lastSeenAt: serverTimestamp(),
            });
            return;
        }
        throw error;
    }
}
