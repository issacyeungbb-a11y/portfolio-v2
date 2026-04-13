import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';

const SYSTEM_RUNS_COLLECTION = 'portfolio';
const SYSTEM_RUNS_DOC = 'app';
const SYSTEM_RUNS_SUBCOLLECTION = 'systemRuns';

/**
 * 寫入一條系統執行記錄到 Firestore。
 * 集合路徑：portfolio/app/systemRuns/{auto-id}
 * 失敗不拋出，只 warn，避免影響主流程。
 */
export async function writeSystemRun(record) {
    try {
        const db = getFirebaseAdminDb();
        const runsRef = db
            .collection(SYSTEM_RUNS_COLLECTION)
            .doc(SYSTEM_RUNS_DOC)
            .collection(SYSTEM_RUNS_SUBCOLLECTION);
        await runsRef.add({
            ...record,
            createdAt: FieldValue.serverTimestamp(),
        });
    }
    catch (error) {
        console.warn('[systemRuns] 寫入 systemRun 失敗（不影響主流程）。', error);
    }
}

/**
 * 讀取最近 N 筆 systemRun 記錄。
 * 用於補救排程判斷上次執行狀態。
 */
export async function readRecentSystemRuns(taskName, limitCount = 3) {
    try {
        const db = getFirebaseAdminDb();
        const runsRef = db
            .collection(SYSTEM_RUNS_COLLECTION)
            .doc(SYSTEM_RUNS_DOC)
            .collection(SYSTEM_RUNS_SUBCOLLECTION);
        const snapshot = await runsRef
            .where('taskName', '==', taskName)
            .orderBy('startedAt', 'desc')
            .limit(limitCount)
            .get();
        return snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                taskName: String(data.taskName ?? ''),
                trigger: data.trigger ?? 'scheduled',
                startedAt: String(data.startedAt ?? ''),
                finishedAt: String(data.finishedAt ?? ''),
                durationMs: Number(data.durationMs ?? 0),
                assetCount: Number(data.assetCount ?? 0),
                appliedCount: Number(data.appliedCount ?? 0),
                pendingCount: Number(data.pendingCount ?? 0),
                coinGeckoSyncStatus: data.coinGeckoSyncStatus ?? 'skipped',
                coveragePct: Number(data.coveragePct ?? 0),
                fxUsingFallback: Boolean(data.fxUsingFallback),
                isRescueRun: Boolean(data.isRescueRun),
                errorMessage: data.errorMessage ? String(data.errorMessage) : null,
                ok: Boolean(data.ok),
            };
        });
    }
    catch (error) {
        console.warn('[systemRuns] 讀取 systemRuns 失敗。', error);
        return [];
    }
}
