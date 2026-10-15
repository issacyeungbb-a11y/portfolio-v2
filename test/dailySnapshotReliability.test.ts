import assert from 'node:assert/strict';
import { after, afterEach, mock, test } from 'node:test';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { acquireDailyJobLock, markUpdateDone } from '../server/dailyJobs.js';
import { buildSnapshotReadinessSummary } from '../server/cronCaptureSnapshot.js';
import { isDailyJobComplete, resolveDailySnapshotOutcome, snapshotContinuity, snapshotRescueAssetIds } from '../server/dailySnapshotState.js';

// Real document references, with only the transaction transport replaced.
// No credentials or network calls are used by these tests.
const app = initializeApp({ projectId: 'snapshot-reliability-test' });
const db = getFirestore(app);
afterEach(() => mock.restoreAll());
after(() => deleteApp(app));

function fakeTransaction(job: Record<string, unknown> | null, snapshotExists: boolean) {
  const writes: Array<Record<string, unknown>> = [];
  const tx = {
    async get(ref: { path: string }) {
      return ref.path.includes('/portfolioSnapshots/')
        ? { exists: snapshotExists }
        : { exists: job !== null, data: () => job };
    },
    set(_ref: unknown, data: Record<string, unknown>) { writes.push(data); },
    update(_ref: unknown, data: Record<string, unknown>) { writes.push(data); },
  };
  mock.method(db, 'runTransaction', async (run: (transaction: unknown) => Promise<unknown>) => run(tx));
  return writes;
}

test('rescue acquires a completed/skipped job when the snapshot was never created', async () => {
  const writes = fakeTransaction({ status: 'completed', snapshotStatus: 'skipped' }, false);
  const result = await acquireDailyJobLock('2026-10-15', 'rescue');
  assert.equal(result.acquired, true);
  assert.equal(writes[0].status, 'running');
});

test('a completed flag cannot hide a deleted or missing snapshot', async () => {
  fakeTransaction({ status: 'completed', snapshotStatus: 'completed' }, false);
  assert.equal((await acquireDailyJobLock('2026-10-15', 'rescue')).acquired, true);
});

test('a persisted snapshot and completed job remain idempotent', async () => {
  const writes = fakeTransaction({ status: 'completed', snapshotStatus: 'completed' }, true);
  assert.deepEqual(await acquireDailyJobLock('2026-10-15', 'rescue'), { acquired: false, reason: 'already_completed' });
  assert.equal(writes.length, 0);
});

test('rescue cannot steal an active lock', async () => {
  const writes = fakeTransaction({ status: 'running', lockAcquiredAt: { toMillis: () => Date.now() } }, false);
  assert.deepEqual(await acquireDailyJobLock('2026-10-15', 'rescue'), { acquired: false, reason: 'locked' });
  assert.equal(writes.length, 0);
});

test('the completed price phase is retained so snapshot rescue can resume', async () => {
  const writes = fakeTransaction({ lockToken: 'owner' }, false);
  await markUpdateDone('2026-10-15', 'owner', {
    appliedCount: 48, pendingReviewCount: 0, coveragePct: 100, processCoveragePct: 100,
    fxUsingFallback: false, coinGeckoSyncStatus: 'ok', totalAssets: 48,
  });
  assert.equal(writes[0].priceUpdateCompleted, true);
  assert.equal(writes[0].status, 'update_done');
});

test('readiness skips are failures and stay eligible for rescue', () => {
  const outcome = resolveDailySnapshotOutcome({ ok: true, skipped: true, message: '資料未齊', snapshotSkipReason: 'readiness_not_met' }, false);
  assert.deepEqual(outcome, { ok: false, status: 'failed', error: '資料未齊' });
  assert.equal(isDailyJobComplete({ status: 'completed' }, false), false);
});

test('reporting success without a persisted snapshot is still a failure', () => {
  assert.equal(resolveDailySnapshotOutcome({ ok: true }, false).ok, false);
  assert.equal(resolveDailySnapshotOutcome({ failed: true, error: 'write failed' }, false).error, 'write failed');
});

test('existing snapshots and newly written snapshots both count as success', () => {
  assert.deepEqual(resolveDailySnapshotOutcome({ skipped: true }, true), { ok: true, status: 'skipped', error: null });
  assert.deepEqual(resolveDailySnapshotOutcome({ ok: true }, true), { ok: true, status: 'completed', error: null });
  assert.equal(isDailyJobComplete({ status: 'completed' }, true), true);
});

test('continuity detects missing calendar days rather than counting snapshot documents', () => {
  const result = snapshotContinuity(['2026-10-13', '2026-10-12', '2026-10-11', '2026-10-10', '2026-10-09', '2026-10-08', '2026-10-07'], '2026-10-15');
  assert.equal(result.latestSnapshotDate, '2026-10-13');
  assert.equal(result.daysSinceLastSnapshot, 2);
  assert.deepEqual(result.missingDatesLast7Days, ['2026-10-14', '2026-10-15']);
  assert.equal(result.todaySnapshotExists, false);
});

test('continuity handles month boundaries, duplicate dates and invalid/future dates', () => {
  const result = snapshotContinuity(['2026-09-30', '2026-09-30', '2026-10-03', '2026-02-30', 'invalid'], '2026-10-02');
  assert.equal(result.daysSinceLastSnapshot, 2);
  assert.equal(result.latestSnapshotDate, '2026-09-30');
  assert.ok(result.missingDatesLast7Days.includes('2026-10-01'));
  assert.equal(snapshotContinuity([], '2026-10-15').daysSinceLastSnapshot, null);
});

test('snapshot rescue retries stale and failed prices but keeps fresh prices, cash and manual coins independent', () => {
  assert.deepEqual(snapshotRescueAssetIds([
    { id: 'fresh', assetType: 'stock', lastPriceUpdatedAt: '2026-10-14T22:21:00Z' },
    { id: 'stale', assetType: 'stock', lastPriceUpdatedAt: '2026-10-14T12:00:00Z' },
    { id: 'failed', assetType: 'crypto', lastPriceUpdatedAt: '2026-10-15T01:00:00Z' },
    { id: 'missing', assetType: 'crypto' },
    { id: 'manual', assetType: 'crypto', managedManualPrice: true },
    { id: 'cash', assetType: 'cash' },
  ], '2026-10-15', ['failed']), ['stale', 'failed', 'missing']);
});

test('a fully fresh snapshot readiness summary contains no undefined Firestore values', () => {
  const summary = buildSnapshotReadinessSummary({
    totalAssets: 48, readyAssets: 48, staleAssets: [], fallbackAssetCount: 0,
    missingAssetCount: 0, coveragePct: 100, pendingReviewCount: 0,
    softPendingReviewCount: 0, hardPendingReviewCount: 0, isReady: true,
    canUseFallback: true, valueWeightedHighRisk: false, staleValuePct: 0,
    largestStaleAssetSymbol: undefined, largestStaleAssetPct: undefined,
    valueWeightedGuardUnavailable: false,
  } as Parameters<typeof buildSnapshotReadinessSummary>[0]);
  assert.ok(Object.values(summary).every(value => value !== undefined));
  assert.equal(summary.isReady, true);
  assert.equal(summary.coveragePct, 100);
});

test('database errors cannot masquerade as an active lock or successful status persistence', async () => {
  mock.method(db, 'runTransaction', async () => { throw new Error('Firestore unavailable'); });
  await assert.rejects(acquireDailyJobLock('2026-10-15', 'rescue'), /Firestore unavailable/);
  await assert.rejects(markUpdateDone('2026-10-15', 'owner', {
    appliedCount: 48, pendingReviewCount: 0, coveragePct: 100, processCoveragePct: 100,
    fxUsingFallback: false, coinGeckoSyncStatus: 'ok', totalAssets: 48,
  }), /Firestore unavailable/);
});
