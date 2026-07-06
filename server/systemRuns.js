import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
const SYSTEM_RUNS_COLLECTION = "portfolio";
const SYSTEM_RUNS_DOC = "app";
const SYSTEM_RUNS_SUBCOLLECTION = "systemRuns";
async function writeSystemRun(record) {
  try {
    const db = getFirebaseAdminDb();
    const runsRef = db.collection(SYSTEM_RUNS_COLLECTION).doc(SYSTEM_RUNS_DOC).collection(SYSTEM_RUNS_SUBCOLLECTION);
    await runsRef.add({
      ...record,
      createdAt: FieldValue.serverTimestamp()
    });
  } catch (error) {
    console.warn("[systemRuns] \u5BEB\u5165 systemRun \u5931\u6557\uFF08\u4E0D\u5F71\u97FF\u4E3B\u6D41\u7A0B\uFF09\u3002", error);
  }
}
async function readRecentSystemRuns(taskName, limitCount = 3) {
  try {
    const db = getFirebaseAdminDb();
    const runsRef = db.collection(SYSTEM_RUNS_COLLECTION).doc(SYSTEM_RUNS_DOC).collection(SYSTEM_RUNS_SUBCOLLECTION);
    const snapshot = await runsRef.orderBy("startedAt", "desc").limit(limitCount * 4).get();
    return snapshot.docs.filter((doc) => doc.data().taskName === taskName).slice(0, limitCount).map((doc) => {
      const data = doc.data();
      return {
        taskName: String(data.taskName ?? ""),
        trigger: data.trigger ?? "scheduled",
        startedAt: String(data.startedAt ?? ""),
        finishedAt: String(data.finishedAt ?? ""),
        durationMs: Number(data.durationMs ?? 0),
        assetCount: Number(data.assetCount ?? 0),
        appliedCount: Number(data.appliedCount ?? 0),
        pendingCount: Number(data.pendingCount ?? 0),
        coinGeckoSyncStatus: data.coinGeckoSyncStatus ?? "skipped",
        coveragePct: Number(data.coveragePct ?? 0),
        fxUsingFallback: Boolean(data.fxUsingFallback),
        isRescueRun: Boolean(data.isRescueRun),
        errorMessage: data.errorMessage ? String(data.errorMessage) : null,
        ok: Boolean(data.ok)
      };
    });
  } catch (error) {
    console.warn("[systemRuns] \u8B80\u53D6 systemRuns \u5931\u6557\u3002", error);
    return [];
  }
}
export {
  readRecentSystemRuns,
  writeSystemRun
};
