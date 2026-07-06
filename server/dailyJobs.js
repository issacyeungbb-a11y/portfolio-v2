import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseAdminDb } from "./firebaseAdmin.js";
import { randomUUID } from "crypto";
const DAILY_JOBS_COLLECTION = "portfolio";
const DAILY_JOBS_DOC = "app";
const DAILY_JOBS_SUBCOLLECTION = "dailyJobs";
const LOCK_TTL_MS = 8 * 60 * 1e3;
function getDailyJobRef(dateKey) {
  return getFirebaseAdminDb().collection(DAILY_JOBS_COLLECTION).doc(DAILY_JOBS_DOC).collection(DAILY_JOBS_SUBCOLLECTION).doc(dateKey);
}
async function readDailyJob(dateKey) {
  const snap = await getDailyJobRef(dateKey).get();
  return snap.exists ? snap.data() : null;
}
async function acquireDailyJobLock(dateKey, trigger) {
  const db = getFirebaseAdminDb();
  const ref = getDailyJobRef(dateKey);
  const lockToken = randomUUID();
  try {
    return await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);
      if (!doc.exists) {
        tx.set(ref, {
          date: dateKey,
          status: "running",
          trigger,
          lockToken,
          lockAcquiredAt: FieldValue.serverTimestamp(),
          startedAt: FieldValue.serverTimestamp(),
          finishedAt: null,
          totalAssets: 0,
          processedAssets: [],
          failedAssets: [],
          appliedCount: 0,
          pendingReviewCount: 0,
          coveragePct: 0,
          processCoveragePct: 0,
          fxUsingFallback: false,
          coinGeckoSyncStatus: "skipped",
          snapshotStatus: "not_started",
          snapshotStartedAt: null,
          snapshotSkipReason: null,
          snapshotReadinessSummary: null,
          snapshotFinishedAt: null,
          snapshotError: null,
          lastError: null,
          nextRetryAt: null,
          rescueAttemptedAt: null,
          previousFailedAssets: []
        });
        return { acquired: true, lockToken, existingJob: null };
      }
      const data = doc.data();
      const snapshotDone = data.snapshotStatus === "completed" || data.snapshotStatus === "skipped";
      if (data.status === "completed" && snapshotDone) {
        return { acquired: false, reason: "already_completed" };
      }
      const lockAcquiredMs = data.lockAcquiredAt?.toMillis?.() ?? 0;
      if (data.status === "running" && Date.now() - lockAcquiredMs < LOCK_TTL_MS) {
        return { acquired: false, reason: "locked" };
      }
      tx.update(ref, { trigger, lockToken, lockAcquiredAt: FieldValue.serverTimestamp(), status: "running", lastError: null });
      return { acquired: true, lockToken, existingJob: data };
    });
  } catch (error) {
    console.warn("[dailyJobs] acquireDailyJobLock error:", error);
    return { acquired: false, reason: "locked" };
  }
}
async function updateDailyJob(dateKey, update) {
  try {
    await getDailyJobRef(dateKey).update(update);
  } catch (error) {
    console.warn("[dailyJobs] updateDailyJob error:", error);
  }
}
async function addProcessedAssets(dateKey, assetIds) {
  if (!assetIds.length) return;
  await updateDailyJob(dateKey, { processedAssets: FieldValue.arrayUnion(...assetIds) });
}
async function addFailedAssets(dateKey, assetIds, lastError) {
  if (!assetIds.length) return;
  await updateDailyJob(dateKey, {
    failedAssets: FieldValue.arrayUnion(...assetIds),
    lastError
  });
}
async function markUpdateDone(dateKey, lockToken, stats) {
  try {
    const db = getFirebaseAdminDb();
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(getDailyJobRef(dateKey));
      if (!doc.exists || doc.data().lockToken !== lockToken) return;
      tx.update(getDailyJobRef(dateKey), { status: "update_done", ...stats });
    });
  } catch (error) {
    console.warn("[dailyJobs] markUpdateDone error:", error);
  }
}
async function updateSnapshotStatus(dateKey, status, extra = {}) {
  await updateDailyJob(dateKey, { snapshotStatus: status, ...extra });
}
async function finalizeDailyJob(dateKey, lockToken, success, errorMessage) {
  try {
    const db = getFirebaseAdminDb();
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(getDailyJobRef(dateKey));
      if (!doc.exists || doc.data().lockToken !== lockToken) return;
      tx.update(getDailyJobRef(dateKey), {
        status: success ? "completed" : "failed",
        finishedAt: FieldValue.serverTimestamp(),
        lockToken: null,
        lockAcquiredAt: null,
        ...errorMessage != null ? { lastError: errorMessage } : {}
      });
    });
  } catch (error) {
    console.warn("[dailyJobs] finalizeDailyJob error:", error);
  }
}
async function readRecentDailyJobs(count = 7) {
  try {
    const snap = await getFirebaseAdminDb().collection(DAILY_JOBS_COLLECTION).doc(DAILY_JOBS_DOC).collection(DAILY_JOBS_SUBCOLLECTION).orderBy("startedAt", "desc").limit(count).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn("[dailyJobs] readRecentDailyJobs error:", error);
    return [];
  }
}
export {
  acquireDailyJobLock,
  addFailedAssets,
  addProcessedAssets,
  finalizeDailyJob,
  markUpdateDone,
  readDailyJob,
  readRecentDailyJobs,
  updateDailyJob,
  updateSnapshotStatus
};
