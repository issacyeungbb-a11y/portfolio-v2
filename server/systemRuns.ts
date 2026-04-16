import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';

const SYSTEM_RUNS_COLLECTION = 'portfolio';
const SYSTEM_RUNS_DOC = 'app';
const SYSTEM_RUNS_SUBCOLLECTION = 'systemRuns';

/** 觸發來源 */
export type SystemRunTrigger = 'scheduled' | 'rescue' | 'manual';

/** 每次自動更新任務的執行記錄 */
export interface SystemRunRecord {
  taskName: string;
  trigger: SystemRunTrigger;
  startedAt: string;       // ISO string
  finishedAt: string;      // ISO string
  durationMs: number;
  assetCount: number;
  appliedCount: number;
  pendingCount: number;
  coinGeckoSyncStatus: 'skipped' | 'ok' | 'timeout' | 'failed';
  coveragePct: number;
  fxUsingFallback: boolean;
  isRescueRun: boolean;
  errorMessage: string | null;
  ok: boolean;
}

/**
 * 寫入一條系統執行記錄到 Firestore。
 * 集合路徑：portfolio/app/systemRuns/{auto-id}
 * 失敗不拋出，只 warn，避免影響主流程。
 */
export async function writeSystemRun(record: SystemRunRecord): Promise<void> {
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
  } catch (error) {
    console.warn('[systemRuns] 寫入 systemRun 失敗（不影響主流程）。', error);
  }
}

/**
 * 讀取最近 N 筆 systemRun 記錄。
 * 用於補救排程判斷上次執行狀態。
 */
export async function readRecentSystemRuns(
  taskName: string,
  limitCount = 3,
): Promise<SystemRunRecord[]> {
  try {
    const db = getFirebaseAdminDb();
    const runsRef = db
      .collection(SYSTEM_RUNS_COLLECTION)
      .doc(SYSTEM_RUNS_DOC)
      .collection(SYSTEM_RUNS_SUBCOLLECTION);

    // 不加 where('taskName') 過濾：避免需要 composite index（taskName + startedAt）。
    // 改為讀取最近 limitCount * 4 筆後 client-side 過濾，確保取到足夠筆數。
    const snapshot = await runsRef
      .orderBy('startedAt', 'desc')
      .limit(limitCount * 4)
      .get();

    return snapshot.docs.filter((doc) => doc.data().taskName === taskName).slice(0, limitCount).map((doc) => {
      const data = doc.data() as Record<string, unknown>;
      return {
        taskName: String(data.taskName ?? ''),
        trigger: (data.trigger as SystemRunTrigger) ?? 'scheduled',
        startedAt: String(data.startedAt ?? ''),
        finishedAt: String(data.finishedAt ?? ''),
        durationMs: Number(data.durationMs ?? 0),
        assetCount: Number(data.assetCount ?? 0),
        appliedCount: Number(data.appliedCount ?? 0),
        pendingCount: Number(data.pendingCount ?? 0),
        coinGeckoSyncStatus: (data.coinGeckoSyncStatus as SystemRunRecord['coinGeckoSyncStatus']) ?? 'skipped',
        coveragePct: Number(data.coveragePct ?? 0),
        fxUsingFallback: Boolean(data.fxUsingFallback),
        isRescueRun: Boolean(data.isRescueRun),
        errorMessage: data.errorMessage ? String(data.errorMessage) : null,
        ok: Boolean(data.ok),
      };
    });
  } catch (error) {
    console.warn('[systemRuns] 讀取 systemRuns 失敗。', error);
    return [];
  }
}
