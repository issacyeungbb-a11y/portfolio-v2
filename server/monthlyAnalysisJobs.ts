import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { getCoveredMonthKey, runManualMonthlyAssetAnalysis } from './scheduledAnalysis.js';
import type { MonthlyAnalysisJob } from '../src/types/monthlyAnalysisJob';

// The function has a five-minute deadline. A lost worker becomes retryable after
// that deadline plus a short allowance for Firestore writes.
export const MONTHLY_JOB_LEASE_MS = 330_000;

interface JobDependencies {
  db?: Firestore;
  now?: () => number;
}

function refs(db: Firestore) {
  const portfolio = db.collection('portfolio').doc('app');
  return {
    jobs: portfolio.collection('monthlyAnalysisJobs'),
    locks: portfolio.collection('monthlyAnalysisJobLocks'),
    sessions: portfolio.collection('analysisSessions'),
  };
}

export function isMonthlyJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function startMonthlyAnalysisJob(
  requestedId: string = randomUUID(),
  dependencies: JobDependencies = {},
) {
  if (!isMonthlyJobId(requestedId)) throw new Error('月報工作編號無效。');
  const db = dependencies.db ?? getFirebaseAdminDb();
  const now = (dependencies.now ?? Date.now)();
  const coveredMonthKey = getCoveredMonthKey(new Date(now));
  const { jobs, locks } = refs(db);
  const jobRef = jobs.doc(requestedId);
  const lockRef = locks.doc(coveredMonthKey);

  return db.runTransaction(async (transaction) => {
    const [requested, lock] = await Promise.all([transaction.get(jobRef), transaction.get(lockRef)]);
    // Retrying a POST after losing its response must not regenerate the report.
    if (requested.exists) {
      return { job: requested.data() as MonthlyAnalysisJob, shouldRun: false };
    }
    const activeId = lock.data()?.jobId;
    if (typeof activeId === 'string') {
      const active = await transaction.get(jobs.doc(activeId));
      const job = active.data() as MonthlyAnalysisJob | undefined;
      if (job?.status === 'running' && now - job.startedAt < MONTHLY_JOB_LEASE_MS) {
        return { job, shouldRun: false };
      }
    }

    const job: MonthlyAnalysisJob = { id: requestedId, coveredMonthKey, status: 'running', startedAt: now };
    transaction.set(jobRef, job);
    transaction.set(lockRef, { jobId: job.id });
    return { job, shouldRun: true };
  });
}

export async function getMonthlyAnalysisJob(
  jobId?: string,
  dependencies: JobDependencies = {},
): Promise<MonthlyAnalysisJob | null> {
  const db = dependencies.db ?? getFirebaseAdminDb();
  const now = (dependencies.now ?? Date.now)();
  const { jobs, locks, sessions } = refs(db);
  if (!jobId) {
    const lock = await locks.doc(getCoveredMonthKey(new Date(now))).get();
    jobId = lock.data()?.jobId;
    if (!jobId) return null;
  }
  if (!isMonthlyJobId(jobId)) throw new Error('月報工作編號無效。');
  const jobRef = jobs.doc(jobId);
  const snapshot = await jobRef.get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as MonthlyAnalysisJob;
  if (job.status !== 'running' || now - job.startedAt < MONTHLY_JOB_LEASE_MS) return job;

  // The worker may have saved the report just before losing its final status
  // write. Only the exact job marker proves that this attempt finished.
  const baseId = `monthly-${job.coveredMonthKey}`;
  const candidates = await Promise.all([sessions.doc(baseId).get(), sessions.doc(`${baseId}-v2`).get()]);
  const saved = candidates.find((doc) => doc.data()?.generationJobId === job.id &&
    typeof doc.data()?.result === 'string' && doc.data()!.result.trim().length > 0);
  const finished: MonthlyAnalysisJob = saved
    ? { ...job, status: 'succeeded', finishedAt: now, sessionDocId: saved.id,
        isTimeoutFallback: saved.data()?.isTimeoutFallback === true,
        message: '月報已完成並儲存。' }
    : { ...job, status: 'failed', finishedAt: now,
        message: '月報背景工作逾時，未確認有新報告儲存。請重新生成。' };
  // Do not replace a completion written while we were checking the session.
  return db.runTransaction(async (transaction) => {
    const latest = await transaction.get(jobRef);
    const current = latest.data() as MonthlyAnalysisJob;
    if (current.status !== 'running') return current;
    transaction.set(jobRef, finished);
    return finished;
  });
}

export async function runMonthlyAnalysisJob(
  job: MonthlyAnalysisJob,
  dependencies: JobDependencies & { runAnalysis?: typeof runManualMonthlyAssetAnalysis } = {},
) {
  const db = dependencies.db ?? getFirebaseAdminDb();
  const jobRef = refs(db).jobs.doc(job.id);
  const now = dependencies.now ?? Date.now;
  let result: Awaited<ReturnType<typeof runManualMonthlyAssetAnalysis>>;
  try {
    result = await (dependencies.runAnalysis ?? runManualMonthlyAssetAnalysis)(job.id);
  } catch (error) {
    console.error('[monthlyAnalysisJob] failed', { jobId: job.id, error: error instanceof Error ? error.message : 'unknown_error' });
    await jobRef.set({ status: 'failed', finishedAt: now(),
      message: error instanceof Error ? error.message : '月報生成失敗，請稍後再試。' }, { merge: true });
    return;
  }
  try {
    await jobRef.set({ status: 'succeeded', finishedAt: now(), sessionDocId: result.sessionDocId,
      isTimeoutFallback: result.isTimeoutFallback === true, message: result.message }, { merge: true });
    console.info('[monthlyAnalysisJob] completed', { jobId: job.id, sessionDocId: result.sessionDocId });
  } catch (error) {
    // The report is already saved. Leave this job recoverable rather than
    // claiming the generation failed because its final status write was lost.
    console.error('[monthlyAnalysisJob] completion status write failed', {
      jobId: job.id, error: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}
