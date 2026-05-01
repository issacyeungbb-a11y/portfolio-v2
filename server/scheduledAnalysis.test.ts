import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnalysisRequestFromAssets,
  getPreviousMonthStartDate,
  normalizeSnapshotDocument,
  selectNearestSnapshotToDate,
} from './scheduledAnalysis.js';

test('getPreviousMonthStartDate uses previous month start in Hong Kong time', () => {
  const now = new Date('2026-05-01T08:43:00+08:00');
  assert.equal(getPreviousMonthStartDate(now), '2026-04-01');
});

test('selectNearestSnapshotToDate picks the nearest snapshot around previous month start', () => {
  const selected = selectNearestSnapshotToDate(
    [
      { date: '2026-04-30', totalValueHKD: 3000, holdings: [] },
      { date: '2026-03-31', totalValueHKD: 1000, holdings: [] },
      { date: '2026-04-02', totalValueHKD: 2000, holdings: [] },
    ],
    '2026-04-01',
  );

  assert.equal(selected?.date, '2026-04-02');
});

test('selectNearestSnapshotToDate does not fallback to latest snapshot when baseline is missing', () => {
  const selected = selectNearestSnapshotToDate(
    [
      { date: '2026-04-30', totalValueHKD: 3000, holdings: [] },
      { date: '2026-03-20', totalValueHKD: 1000, holdings: [] },
    ],
    '2026-04-01',
  );

  assert.equal(selected, null);
});

test('normalizeSnapshotDocument converts legacy marketValue to HKD using holding currency', () => {
  const snapshot = normalizeSnapshotDocument({
    date: '2026-04-01',
    holdings: [
      {
        assetId: 'metaplanet',
        symbol: '3350',
        name: 'Metaplanet',
        assetType: 'stock',
        currency: 'JPY',
        quantity: 100,
        currentPrice: 1800,
        marketValue: 180000,
      },
    ],
  });

  assert.equal(snapshot.holdings[0]?.marketValueHKD, 9360);
  assert.equal(snapshot.totalValueHKD, 9360);
});

test('buildAnalysisRequestFromAssets calculates JPY holdings in HKD for prompt consumers', () => {
  const request = buildAnalysisRequestFromAssets({
    assets: [
      {
        id: 'metaplanet',
        name: 'Metaplanet',
        symbol: '3350',
        assetType: 'stock',
        accountSource: 'IB',
        currency: 'JPY',
        quantity: 100,
        averageCost: 1500,
        currentPrice: 1800,
      },
    ],
    category: 'asset_analysis',
    analysisQuestion: 'test',
    analysisBackground: 'test',
    analysisModel: 'gemini-3.1-pro-preview',
  });

  assert.equal(request.holdings[0]?.marketValue, 180000);
  assert.equal(request.holdings[0]?.marketValueHKD, 9360);
  assert.equal(request.totalValueHKD, 9360);
});
