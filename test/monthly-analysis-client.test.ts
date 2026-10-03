import assert from 'node:assert/strict';
import test from 'node:test';
import { findCompletedMonthlyJobSession, getMonthlyReportPeriod } from '../src/lib/portfolio/monthlyAnalysisJob.ts';

test('October generation selects the September report, including HK timezone and year rollover', () => {
  assert.deepEqual(getMonthlyReportPeriod(new Date('2026-09-30T16:01:00Z')), {
    key: '2026-09', docId: 'monthly-2026-09', title: '2026年9月每月資產分析',
  });
  assert.equal(getMonthlyReportPeriod(new Date('2026-01-01T01:00:00Z')).key, '2025-12');
});

test('Firestore completion uses the exact job marker, not an old same-month report', () => {
  const old = { id: 'old', result: '原有報告', generationJobId: 'another-job' } as any;
  const saved = { id: 'monthly-2026-09', result: '完整報告', generationJobId: 'active-job' } as any;
  assert.equal(findCompletedMonthlyJobSession([old], 'active-job'), null);
  assert.equal(findCompletedMonthlyJobSession([old, saved], 'active-job'), saved);
  assert.equal(findCompletedMonthlyJobSession([{ ...saved, result: '' }], 'active-job'), null);
});
