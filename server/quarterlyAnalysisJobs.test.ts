import assert from 'node:assert/strict';
import test from 'node:test';
import type { Firestore } from 'firebase-admin/firestore';
import { getQuarterlyAnalysisJob, QUARTERLY_JOB_LEASE_MS, runQuarterlyAnalysisJob, startQuarterlyAnalysisJob } from './quarterlyAnalysisJobs.js';
import type { QuarterlyAnalysisJob } from '../src/types/quarterlyAnalysisJob.ts';

const firstId = '00000000-0000-4000-8000-000000000001';
const secondId = '00000000-0000-4000-8000-000000000002';
const startedAt = Date.parse('2026-10-03T11:00:00Z');

function fakeFirestore(failStatusWrites = false) {
  const data = new Map<string, Record<string, unknown>>();
  const reference = (path: string): any => ({
    path, id: path.split('/').at(-1),
    collection: (name: string) => ({ doc: (id: string) => reference(`${path}/${name}/${id}`) }),
    get: async () => ({ exists: data.has(path), id: path.split('/').at(-1), data: () => data.get(path) }),
    set: async (value: Record<string, unknown>, options?: { merge: boolean }) => {
      if (failStatusWrites && options?.merge) throw new Error('Firestore unavailable');
      data.set(path, { ...(options?.merge ? data.get(path) : {}), ...value });
    },
  });
  let queue = Promise.resolve();
  const db = {
    collection: (name: string) => ({ doc: (id: string) => reference(`${name}/${id}`) }),
    runTransaction: (callback: (transaction: any) => Promise<unknown>) => {
      const result = queue.then(async () => {
        const writes: Array<() => void> = [];
        const result = await callback({
          get: (ref: any) => ref.get(),
          set: (ref: any, value: Record<string, unknown>) => { writes.push(() => data.set(ref.path, value)); },
        });
        writes.forEach((write) => write());
        return result;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  } as unknown as Firestore;
  return { db, data };
}

test('concurrent clicks and a retried POST run only one quarterly model job', async () => {
  const { db } = fakeFirestore();
  const dependencies = { db, now: () => startedAt };
  const [first, second] = await Promise.all([
    startQuarterlyAnalysisJob(firstId, dependencies), startQuarterlyAnalysisJob(secondId, dependencies),
  ]);
  assert.equal(first.shouldRun, true);
  assert.equal(second.shouldRun, false);
  assert.equal(second.job.id, first.job.id);
  const retry = await startQuarterlyAnalysisJob(firstId, dependencies);
  assert.equal(retry.shouldRun, false);
  assert.equal(retry.job.id, firstId);
  assert.equal((await getQuarterlyAnalysisJob(undefined, dependencies))?.id, firstId);
});

test('expired job without a matching saved report fails and permits a new job', async () => {
  const { db, data } = fakeFirestore();
  await startQuarterlyAnalysisJob(firstId, { db, now: () => startedAt });
  data.set('portfolio/app/quarterlyReports/quarterly-2026年Q3', { generationJobId: secondId, report: '另一份報告' });
  const now = () => startedAt + QUARTERLY_JOB_LEASE_MS;
  assert.equal((await getQuarterlyAnalysisJob(firstId, { db, now }))?.status, 'failed');
  assert.equal((await startQuarterlyAnalysisJob(secondId, { db, now })).shouldRun, true);
});

test('saved report recovers success if the worker loses its final status write', async () => {
  const { db, data } = fakeFirestore();
  await startQuarterlyAnalysisJob(firstId, { db, now: () => startedAt });
  data.set('portfolio/app/quarterlyReports/quarterly-2026年Q3', { generationJobId: firstId, report: '已完成季報', isTimeoutFallback: false });
  const result = await getQuarterlyAnalysisJob(firstId, { db, now: () => startedAt + QUARTERLY_JOB_LEASE_MS });
  assert.equal(result?.status, 'succeeded');
  assert.equal(result?.reportDocId, 'quarterly-2026年Q3');
});

test('worker persists completion and POST retries after completion do not regenerate', async () => {
  const { db } = fakeFirestore();
  const dependencies = { db, now: () => startedAt };
  const { job } = await startQuarterlyAnalysisJob(firstId, dependencies);
  let calls = 0;
  await runQuarterlyAnalysisJob(job, { ...dependencies, runAnalysis: (async (options: { generationJobId: string; overwriteExisting: boolean; expectedQuarter: string }) => {
    calls += 1;
    assert.equal(options.generationJobId, firstId);
    assert.equal(options.overwriteExisting, true);
    assert.equal(options.expectedQuarter, '2026年Q3');
    return { reportDocId: 'quarterly-2026年Q3', isTimeoutFallback: false, message: '完成' };
  }) as any });
  const retry = await startQuarterlyAnalysisJob(firstId, dependencies);
  assert.equal(retry.shouldRun, false);
  assert.equal(retry.job.status, 'succeeded');
  assert.equal(calls, 1);
});

test('worker failure reports the actual error and leaves the previous report intact', async () => {
  const { db, data } = fakeFirestore();
  const original = { report: '原有季報' };
  data.set('portfolio/app/quarterlyReports/quarterly-2026年Q3', original);
  const { job } = await startQuarterlyAnalysisJob(firstId, { db, now: () => startedAt });
  await runQuarterlyAnalysisJob(job, { db, runAnalysis: async () => { throw new Error('模型未完成回應'); } });
  const result = await getQuarterlyAnalysisJob(firstId, { db });
  assert.equal(result?.status, 'failed');
  assert.equal(result?.message, '模型未完成回應');
  assert.deepEqual(data.get('portfolio/app/quarterlyReports/quarterly-2026年Q3'), original);
});

test('a lost completion-status write does not falsely mark a saved report failed', async () => {
  const { db, data } = fakeFirestore(true);
  const { job } = await startQuarterlyAnalysisJob(firstId, { db, now: () => startedAt });
  await runQuarterlyAnalysisJob(job, { db, runAnalysis: (async () => {
    data.set('portfolio/app/quarterlyReports/quarterly-2026年Q3', { generationJobId: firstId, report: '完整季報' });
    return { reportDocId: 'quarterly-2026年Q3', message: '完成' };
  }) as any });
  assert.equal(data.get(`portfolio/app/quarterlyAnalysisJobs/${firstId}`)?.status, 'running');
  const recovered = await getQuarterlyAnalysisJob(firstId, { db, now: () => startedAt + QUARTERLY_JOB_LEASE_MS });
  assert.equal(recovered?.status, 'succeeded');
});


test('a new request may regenerate an already completed quarter even in a non-opening month', async () => {
  const { db } = fakeFirestore();
  const dependencies = { db, now: () => Date.parse('2026-11-10T11:00:00Z') };
  const { job } = await startQuarterlyAnalysisJob(firstId, dependencies);
  await runQuarterlyAnalysisJob(job, { ...dependencies, runAnalysis: (async () => ({ reportDocId: 'quarterly-2026年Q3', message: '完成' })) as any });
  const next = await startQuarterlyAnalysisJob(secondId, dependencies);
  assert.equal(next.shouldRun, true);
  assert.equal(next.job.quarter, '2026年Q3');
});
