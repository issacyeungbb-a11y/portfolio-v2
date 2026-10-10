import { randomUUID } from 'node:crypto';
import type { Firestore } from 'firebase-admin/firestore';
import { getFirebaseAdminDb } from './firebaseAdmin.js';
import { getPreviousCompletedQuarterLabel, runManualQuarterlyAssetReport } from './scheduledAnalysis.js';
import type { QuarterlyAnalysisJob } from '../src/types/quarterlyAnalysisJob';

// The function has a five-minute deadline. A lost worker becomes retryable after
// that deadline plus a short allowance for Firestore writes.
export const QUARTERLY_JOB_LEASE_MS = 330_000;

interface JobDependencies {
  db?: Firestore;
  now?: () => number;
}

function refs(db: Firestore) {
  const portfolio = db.collection('portfolio').doc('app');
  return {
    jobs: portfolio.collection('quarterlyAnalysisJobs'),
    locks: portfolio.collection('quarterlyAnalysisJobLocks'),
    reports: portfolio.collection('quarterlyReports'),
  };
}

export function isQuarterlyJobId(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function startQuarterlyAnalysisJob(
  requestedId: string = randomUUID(),
  dependencies: JobDependencies = {},
) {
  if (!isQuarterlyJobId(requestedId)) throw new Error('季報工作編號無效。');
  const db = dependencies.db ?? getFirebaseAdminDb();
  const now = (dependencies.now ?? Date.now)();
  const quarter = getPreviousCompletedQuarterLabel(new Date(now));
  const { jobs, locks } = refs(db);
  const jobRef = jobs.doc(requestedId);
  const lockRef = locks.doc(quarter);

  return db.runTransaction(async (transaction) => {
    const [requested, lock] = await Promise.all([transaction.get(jobRef), transaction.get(lockRef)]);
    // Retrying a POST after losing its response must not regenerate the report.
    if (requested.exists) {
      return { job: requested.data() as QuarterlyAnalysisJob, shouldRun: false };
    }
    const activeId = lock.data()?.jobId;
    if (typeof activeId === 'string') {
      const active = await transaction.get(jobs.doc(activeId));
      const job = active.data() as QuarterlyAnalysisJob | undefined;
      if (job?.status === 'running' && now - job.startedAt < QUARTERLY_JOB_LEASE_MS) {
        return { job, shouldRun: false };
      }
    }

    const job: QuarterlyAnalysisJob = { id: requestedId, quarter, status: 'running', startedAt: now };
    transaction.set(jobRef, job);
    transaction.set(lockRef, { jobId: job.id });
    return { job, shouldRun: true };
  });
}

export async function getQuarterlyAnalysisJob(
  jobId?: string,
  dependencies: JobDependencies = {},
): Promise<QuarterlyAnalysisJob | null> {
  const db = dependencies.db ?? getFirebaseAdminDb();
  const now = (dependencies.now ?? Date.now)();
  const { jobs, locks, reports } = refs(db);
  if (!jobId) {
    const lock = await locks.doc(getPreviousCompletedQuarterLabel(new Date(now))).get();
    jobId = lock.data()?.jobId;
    if (!jobId) return null;
  }
  if (!isQuarterlyJobId(jobId)) throw new Error('季報工作編號無效。');
  const jobRef = jobs.doc(jobId);
  const snapshot = await jobRef.get();
  if (!snapshot.exists) return null;
  const job = snapshot.data() as QuarterlyAnalysisJob;
  if (job.status !== 'running' || now - job.startedAt < QUARTERLY_JOB_LEASE_MS) return job;

  // The worker may have saved the report just before losing its final status
  // write. Only the exact job marker proves that this attempt finished.
  const reportDocId = `quarterly-${job.quarter}`;
  const saved = await reports.doc(reportDocId).get();
  const hasSavedReport = saved.data()?.generationJobId === job.id &&
    typeof saved.data()?.report === 'string' && saved.data()!.report.trim().length > 0;
  const finished: QuarterlyAnalysisJob = hasSavedReport
    ? { ...job, status: 'succeeded', finishedAt: now, reportDocId: saved.id,
        isTimeoutFallback: saved.data()?.isTimeoutFallback === true,
        message: '季報已完成並儲存。' }
    : { ...job, status: 'failed', finishedAt: now,
        message: '季報背景工作逾時，未確認有新報告儲存。請重新生成。' };
  // Do not replace a completion written while we were checking the session.
  return db.runTransaction(async (transaction) => {
    const latest = await transaction.get(jobRef);
    const current = latest.data() as QuarterlyAnalysisJob;
    if (current.status !== 'running') return current;
    transaction.set(jobRef, finished);
    return finished;
  });
}

export async function runQuarterlyAnalysisJob(
  job: QuarterlyAnalysisJob,
  dependencies: JobDependencies & { runAnalysis?: typeof runManualQuarterlyAssetReport } = {},
) {
  const db = dependencies.db ?? getFirebaseAdminDb();
  const jobRef = refs(db).jobs.doc(job.id);
  const now = dependencies.now ?? Date.now;
  let result: Awaited<ReturnType<typeof runManualQuarterlyAssetReport>>;
  try {
    result = await (dependencies.runAnalysis ?? runManualQuarterlyAssetReport)({ overwriteExisting: true, generationJobId: job.id, expectedQuarter: job.quarter });
  } catch (error) {
    console.error('[quarterlyAnalysisJob] failed', { jobId: job.id, error: error instanceof Error ? error.message : 'unknown_error' });
    await jobRef.set({ status: 'failed', finishedAt: now(),
      message: error instanceof Error ? error.message : '季報生成失敗，請稍後再試。' }, { merge: true });
    return;
  }
  try {
    await jobRef.set({ status: 'succeeded', finishedAt: now(), reportDocId: result.reportDocId,
      isTimeoutFallback: result.isTimeoutFallback === true, message: result.message }, { merge: true });
    console.info('[quarterlyAnalysisJob] completed', { jobId: job.id, reportDocId: result.reportDocId });
  } catch (error) {
    // The report is already saved. Leave this job recoverable rather than
    // claiming the generation failed because its final status write was lost.
    console.error('[quarterlyAnalysisJob] completion status write failed', {
      jobId: job.id, error: error instanceof Error ? error.message : 'unknown_error',
    });
  }
}
