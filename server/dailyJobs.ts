import { FieldValue } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { randomUUID } from 'crypto';

const DAILY_JOBS_COLLECTION = 'portfolio';
const DAILY_JOBS_DOC = 'app';
const DAILY_JOBS_SUBCOLLECTION = 'dailyJobs';
const LOCK_TTL_MS = 8 * 60 * 1000;

export type DailyJobStatus = 'pending' | 'running' | 'update_done' | 'completed' | 'failed';
export type SnapshotStatus = 'not_started' | 'running' | 'completed' | 'failed' | 'skipped';
export type DailyJobTrigger = 'scheduled' | 'rescue' | 'manual';
export type CoinGeckoSyncStatus = 'ok' | 'timeout' | 'failed' | 'skipped';

export interface SnapshotReadinessSummary {
  totalAssets: number;
  nonCashAssets: number;
  readyAssets: number;
  staleAssetCount: number;
  fallbackAssetCount: number;
  missingAssetCount: number;
  coveragePct: number;
  pendingReviewCount: number;
  softPendingReviewCount: number;
  hardPendingReviewCount: number;
  hardPendingTolerance: number;
  isReady: boolean;
  canUseFallback: boolean;
  valueWeightedHighRisk: boolean;
  staleValuePct: number;
  largestStaleAssetSymbol?: string;
  largestStaleAssetPct?: number;
  valueWeightedGuardUnavailable?: boolean;
}

export interface DailyJobDocument {
  date: string;
  status: DailyJobStatus;
  trigger: DailyJobTrigger;
  lockToken: string | null;
  lockAcquiredAt: unknown | null; // Firestore Timestamp
  startedAt: unknown; // Firestore Timestamp
  finishedAt: unknown | null;
  totalAssets: number;
  processedAssets: string[];
  failedAssets: string[];
  appliedCount: number;
  pendingReviewCount: number;
  coveragePct: number;
  processCoveragePct: number;
  fxUsingFallback: boolean;
  coinGeckoSyncStatus: CoinGeckoSyncStatus;
  snapshotStatus: SnapshotStatus;
  snapshotSkipReason: string | null;
  snapshotReadinessSummary: SnapshotReadinessSummary | null;
  snapshotStartedAt: unknown | null;
  snapshotFinishedAt: unknown | null;
  snapshotError: string | null;
  lastError: string | null;
  rescueAttemptedAt?: unknown | null;
  previousFailedAssets?: string[];
  nextRetryAt: unknown | null;
}

export interface UpdateDoneStats {
  appliedCount: number;
  pendingReviewCount: number;
  coveragePct: number;
  processCoveragePct: number;
  fxUsingFallback: boolean;
  coinGeckoSyncStatus: CoinGeckoSyncStatus;
  totalAssets: number;
}

export type LockAcquireResult =
  | { acquired: true; lockToken: string; existingJob: DailyJobDocument | null }
  | { acquired: false; reason: 'already_completed' | 'locked' };

function getDailyJobRef(dateKey: string) {
  return getFirebaseAdminDb()
    .collection(DAILY_JOBS_COLLECTION)
    .doc(DAILY_JOBS_DOC)
    .collection(DAILY_JOBS_SUBCOLLECTION)
    .doc(dateKey);
}

export async function readDailyJob(dateKey: string): Promise<DailyJobDocument | null> {
  const snap = await getDailyJobRef(dateKey).get();
  return snap.exists ? (snap.data() as DailyJobDocument) : null;
}

export async function acquireDailyJobLock(
  dateKey: string,
  trigger: DailyJobTrigger,
): Promise<LockAcquireResult> {
  const db = getFirebaseAdminDb();
  const ref = getDailyJobRef(dateKey);
  const lockToken = randomUUID();

  try {
    return (await db.runTransaction(async (tx) => {
      const doc = await tx.get(ref);

      if (!doc.exists) {
        tx.set(ref, {
          date: dateKey, status: 'running', trigger, lockToken,
          lockAcquiredAt: FieldValue.serverTimestamp(),
          startedAt: FieldValue.serverTimestamp(),
          finishedAt: null, totalAssets: 0, processedAssets: [], failedAssets: [],
          appliedCount: 0, pendingReviewCount: 0, coveragePct: 0, processCoveragePct: 0,
          fxUsingFallback: false, coinGeckoSyncStatus: 'skipped',
          snapshotStatus: 'not_started', snapshotStartedAt: null,
          snapshotSkipReason: null, snapshotReadinessSummary: null,
          snapshotFinishedAt: null, snapshotError: null, lastError: null, nextRetryAt: null,
          rescueAttemptedAt: null, previousFailedAssets: [],
        });
        return { acquired: true, lockToken, existingJob: null } as LockAcquireResult;
      }

      const data = doc.data() as DailyJobDocument;
      const snapshotDone = data.snapshotStatus === 'completed' || data.snapshotStatus === 'skipped';
      if (data.status === 'completed' && snapshotDone) {
        return { acquired: false, reason: 'already_completed' } as LockAcquireResult;
      }

      const lockAcquiredMs = (data.lockAcquiredAt as { toMillis?: () => number } | null)?.toMillis?.() ?? 0;
      if (data.status === 'running' && Date.now() - lockAcquiredMs < LOCK_TTL_MS) {
        return { acquired: false, reason: 'locked' } as LockAcquireResult;
      }

      tx.update(ref, { trigger, lockToken, lockAcquiredAt: FieldValue.serverTimestamp(), status: 'running', lastError: null });
      return { acquired: true, lockToken, existingJob: data } as LockAcquireResult;
    })) as LockAcquireResult;
  } catch (error) {
    console.warn('[dailyJobs] acquireDailyJobLock error:', error);
    return { acquired: false, reason: 'locked' };
  }
}

export async function updateDailyJob(dateKey: string, update: Record<string, unknown>): Promise<void> {
  try {
    await getDailyJobRef(dateKey).update(update);
  } catch (error) {
    console.warn('[dailyJobs] updateDailyJob error:', error);
  }
}

export async function addProcessedAssets(dateKey: string, assetIds: string[]): Promise<void> {
  if (!assetIds.length) return;
  await updateDailyJob(dateKey, { processedAssets: FieldValue.arrayUnion(...assetIds) });
}

export async function addFailedAssets(dateKey: string, assetIds: string[], lastError: string): Promise<void> {
  if (!assetIds.length) return;
  await updateDailyJob(dateKey, {
    failedAssets: FieldValue.arrayUnion(...assetIds),
    lastError,
  });
}

export async function markUpdateDone(dateKey: string, lockToken: string, stats: UpdateDoneStats): Promise<void> {
  try {
    const db = getFirebaseAdminDb();
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(getDailyJobRef(dateKey));
      if (!doc.exists || (doc.data() as DailyJobDocument).lockToken !== lockToken) return;
      tx.update(getDailyJobRef(dateKey), { status: 'update_done', ...stats });
    });
  } catch (error) {
    console.warn('[dailyJobs] markUpdateDone error:', error);
  }
}

export async function updateSnapshotStatus(
  dateKey: string,
  status: SnapshotStatus,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await updateDailyJob(dateKey, { snapshotStatus: status, ...extra });
}

export async function finalizeDailyJob(
  dateKey: string,
  lockToken: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  try {
    const db = getFirebaseAdminDb();
    await db.runTransaction(async (tx) => {
      const doc = await tx.get(getDailyJobRef(dateKey));
      if (!doc.exists || (doc.data() as DailyJobDocument).lockToken !== lockToken) return;
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

export async function readRecentDailyJobs(count = 7): Promise<Array<DailyJobDocument & { id: string }>> {
  try {
    const snap = await getFirebaseAdminDb()
      .collection(DAILY_JOBS_COLLECTION).doc(DAILY_JOBS_DOC)
      .collection(DAILY_JOBS_SUBCOLLECTION)
      .orderBy('startedAt', 'desc').limit(count).get();
    return snap.docs.map((d) => ({ id: d.id, ...(d.data() as DailyJobDocument) }));
  } catch (error) {
    console.warn('[dailyJobs] readRecentDailyJobs error:', error);
    return [];
  }
}
