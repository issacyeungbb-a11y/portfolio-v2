import { doc, onSnapshot, serverTimestamp, setDoc, } from 'firebase/firestore';
import { firebaseDb, hasFirebaseConfig, missingFirebaseEnvKeys } from './client';
function createMissingConfigError() {
    return new Error(`Missing Firebase env vars: ${missingFirebaseEnvKeys.join(', ')}`);
}
function getRequiredFirebaseDb() {
    if (!firebaseDb) {
        throw createMissingConfigError();
    }
    return firebaseDb;
}
function normalizeCachedAnalysis(snapshotHash, value) {
    return {
        snapshotHash,
        model: typeof value.model === 'string' ? value.model : '',
        generatedAt: typeof value.generatedAt === 'string' ? value.generatedAt : '',
        assetCount: typeof value.assetCount === 'number' ? value.assetCount : 0,
        summary: typeof value.summary === 'string' ? value.summary : '',
        topRisks: Array.isArray(value.topRisks) ? value.topRisks.filter((item) => typeof item === 'string') : [],
        allocationInsights: Array.isArray(value.allocationInsights)
            ? value.allocationInsights.filter((item) => typeof item === 'string')
            : [],
        currencyExposure: Array.isArray(value.currencyExposure)
            ? value.currencyExposure.filter((item) => typeof item === 'string')
            : [],
        nextQuestions: Array.isArray(value.nextQuestions)
            ? value.nextQuestions.filter((item) => typeof item === 'string')
            : [],
    };
}
export function getAnalysisCacheErrorMessage(error) {
    if (!hasFirebaseConfig) {
        return `Firebase 尚未設定完成，請先填入 .env.local 或 .env 內的設定值：${missingFirebaseEnvKeys.join(', ')}`;
    }
    if (error instanceof Error) {
        if (error.message.includes('permission-denied')) {
            return 'Firestore 權限被拒絕，請確認 rules 已容許匿名使用者讀寫自己的分析快取。';
        }
        return error.message;
    }
    return '讀取或寫入分析快取失敗，請稍後再試。';
}
export function subscribeToAnalysisCache(uid, snapshotHash, onData, onError) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const db = getRequiredFirebaseDb();
    const cacheRef = doc(db, 'users', uid, 'analysisCache', snapshotHash);
    return onSnapshot(cacheRef, (snapshot) => {
        if (!snapshot.exists()) {
            onData(null);
            return;
        }
        onData(normalizeCachedAnalysis(snapshot.id, snapshot.data()));
    }, onError);
}
export async function saveAnalysisCache(uid, analysis) {
    if (!hasFirebaseConfig) {
        throw createMissingConfigError();
    }
    const db = getRequiredFirebaseDb();
    const cacheRef = doc(db, 'users', uid, 'analysisCache', analysis.snapshotHash);
    await setDoc(cacheRef, {
        ...analysis,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}
