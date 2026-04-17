import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { randomUUID } from 'crypto';

const DAILY_JOBS_COLLECTION = 'portfolio';
const DAILY_JOBS_DOC = 'app';
const DAILY_JOBS_SUBCOLLECTION = 'dailyJobs';
const LOCK_TTL_MS = 8 * 60 * 1000;

function getDailyJobRef(dateKey) {
  return getFirebaseAdminDb()
    .collection(DAILY_JOBS_COLLECTION)
    .doc(DAILY_JOBS_DOC)
    .collection(DAILY_JOBS_SUBCOLLECTION)
    .doc(dateKey);
}

/** Read today's job. Returns null if not yet created. */
export async function readDailyJob(dateKey) {
  const snap = await getDailyJobRef(dateKey).get();
  return snap.exists ? snap.data() : null;
}

/**
 * Try to acquire a lock on today's job.
 * Returns { acquired: true, lockToken, existingJob }
 *      or { acquired: false, reason: 'already_completed' | 'locked' }
 */
export async function acquireDailyJobLock(dateKey, trigger) {
  const db = getFirebaseAdminDb();
  const ref = getDailyJobRef(dateKey);
  const lockToken = randomUUID();

  try {
    return await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);

      if (!doc.exists) {
        tx.set(ref, {
          date: dateKey,
          status: 'running',
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
          fxUsingFallback: false,
          coinGeckoSyncStatus: 'skipped',
          snapshotStatus: 'not_started',
          snapshotStartedAt: null,
          snapshotFinishedAt: null,
          snapshotError: null,
          lastError: null,
          nextRetryAt: null,
          rescueAttemptedAt: null,
          previousFailedAssets: [],
        });
        return { acquired: true, lockToken, existingJob: null };
      }

      const data = doc.data();

      const snapshotDone = data.snapshotStatus === 'completed' || data.snapshotStatus === 'skipped';
      if (data.status === 'completed' && snapshotDone) {
        return { acquired: false, reason: 'already_completed' };
      }

      const lockAcquiredMs = data.lockAcquiredAt?.toMillis?.() ?? 0;
      const lockAge = Date.now() - lockAcquiredMs;
      if (data.status === 'running' && lockAge < LOCK_TTL_MS) {
        return { acquired: false, reason: 'locked' };
      }

      // Stale lock or failed job — take over, preserve data for resume
      tx.update(ref, {
        trigger,
        lockToken,
        lockAcquiredAt: FieldValue.serverTimestamp(),
        status: 'running',
        lastError: null,
      });
      return { acquired: true, lockToken, existingJob: data };
    });
  } catch (error) {
    console.warn('[dailyJobs] acquireDailyJobLock error:', error);
    return { acquired: false, reason: 'locked' };
  }
}

/** Generic update. Accepts FieldValue sentinels. */
export async function updateDailyJob(dateKey, update) {
  try {
    await getDailyJobRef(dateKey).update(update);
  } catch (error) {
    console.warn('[dailyJobs] updateDailyJob error:', error);
  }
}

/** Append processed asset IDs after a successful batch. */
export async function addProcessedAssets(dateKey, assetIds) {
  if (!assetIds.length) return;
  await updateDailyJob(dateKey, {
    processedAssets: FieldValue.arrayUnion(...assetIds),
  });
}

/** Append failed asset IDs after a batch error. */
export async function addFailedAssets(dateKey, assetIds, lastError) {
  if (!assetIds.length) return;
  await updateDailyJob(dateKey, {
    failedAssets: FieldValue.arrayUnion(...assetIds),
    lastError,
  });
}

/** Mark the update phase as done (status → 'update_done'). */
export async function markUpdateDone(dateKey, lockToken, stats) {
  try {
    const db = getFirebaseAdminDb();
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(getDailyJobRef(dateKey));
      if (!doc.exists || doc.data().lockToken !== lockToken) return;
      tx.update(getDailyJobRef(dateKey), {
        status: 'update_done',
        appliedCount: stats.appliedCount,
        pendingReviewCount: stats.pendingReviewCount,
        coveragePct: stats.coveragePct,
        fxUsingFallback: stats.fxUsingFallback,
        coinGeckoSyncStatus: stats.coinGeckoSyncStatus,
        totalAssets: stats.totalAssets,
      });
    });
  } catch (error) {
    console.warn('[dailyJobs] markUpdateDone error:', error);
  }
}

/** Update snapshot phase status. */
export async function updateSnapshotStatus(dateKey, status, extra = {}) {
  await updateDailyJob(dateKey, { snapshotStatus: status, ...extra });
}

/** Finalize job (completed or failed) and release lock. */
export async function finalizeDailyJob(dateKey, lockToken, success, errorMessage) {
  try {
    const db = getFirebaseAdminDb();
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(getDailyJobRef(dateKey));
      if (!doc.exists || doc.data().lockToken !== lockToken) return;
      tx.update(getDailyJobRef(dateKey), {
        status: success ? 'completed' : 'failed',
        finishedAt: FieldValue.serverTimestamp(),
        lockToken: null,
        lockAcquiredAt: null,
        ...(errorMessage != null ? { lastError: errorMessage } : {}),
      });
    });
  } catch (error) {
    console.warn('[dailyJobs] finalizeDailyJob error:', error);
  }
}

/** Read recent dailyJob documents (newest first). */
export async function readRecentDailyJobs(count = 7) {
  try {
    const snap = await getFirebaseAdminDb()
      .collection(DAILY_JOBS_COLLECTION)
      .doc(DAILY_JOBS_DOC)
      .collection(DAILY_JOBS_SUBCOLLECTION)
      .orderBy('startedAt', 'desc')
      .limit(count)
      .get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (error) {
    console.warn('[dailyJobs] readRecentDailyJobs error:', error);
    return [];
  }
}
