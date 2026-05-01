import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildReportDataQualitySummary,
  buildReportFactsPayload,
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

test('buildReportFactsPayload includes netExternalFlowCoveragePct and cashFlowWarningMessage', () => {
  const payload = buildReportFactsPayload({
    reportType: 'monthly',
    generatedAt: '2026-05-01T00:15:00.000Z',
    periodStartDate: '2026-04-01',
    periodEndDate: '2026-05-01',
    baselineSnapshot: { id: 'baseline-1', date: '2026-04-01', totalValueHKD: 100000, holdings: [] } as never,
    currentSnapshot: { date: '2026-05-01', totalValueHKD: 120000, holdings: [] },
    totalCostHKD: 100000,
    allocationSummary: {
      asOfDate: '2026-05-01',
      basis: 'snapshot',
      styleTag: 'balanced',
      warningTags: [],
      slices: [],
    } as never,
    allocationsByCurrency: [],
    model: 'claude-opus-4-7',
    provider: 'anthropic',
    snapshotHash: 'snapshot-hash',
    dataQualitySummary: {
      status: 'partial',
      staleAssetCount: 1,
      warningMessages: ['有 1 項資產價格超過 24 小時未更新。'],
    },
    topHoldingsByHKD: [],
    comparison: {
      totalValue: {
        current: 120000,
        previous: 100000,
        changeHKD: 20000,
        changePercent: 20,
        netExternalFlowHKD: 10000,
        netExternalFlowCoveragePct: 80,
        investmentGainHKD: 10000,
        investmentGainPercent: 10,
        cashFlowDataComplete: false,
        cashFlowWarningMessage: '資金流資料未完全覆蓋（80%）',
      },
    } as never,
  });

  assert.equal(payload.netExternalFlowCoveragePct, 80);
  assert.equal(payload.cashFlowWarningMessage, '資金流資料未完全覆蓋（80%）');
});

test('buildReportDataQualitySummary marks fallback assets as partial', () => {
  const summary = buildReportDataQualitySummary({
    assets: [],
    snapshotMeta: {
      coveragePct: 100,
      fallbackAssetCount: 2,
      missingAssetCount: 0,
      fxSource: 'persisted',
    } as never,
  });

  assert.equal(summary.status, 'partial');
});

test('buildReportDataQualitySummary marks missing assets as warning', () => {
  const summary = buildReportDataQualitySummary({
    assets: [],
    snapshotMeta: {
      coveragePct: 100,
      fallbackAssetCount: 0,
      missingAssetCount: 1,
      fxSource: 'persisted',
    } as never,
  });

  assert.equal(summary.status, 'warning');
});

test('buildReportDataQualitySummary includes stale price warning messages', () => {
  const summary = buildReportDataQualitySummary({
    assets: [
      {
        lastPriceUpdatedAt: '2026-04-28T00:00:00.000Z',
      } as never,
    ],
    snapshotMeta: {
      coveragePct: 100,
      fallbackAssetCount: 0,
      missingAssetCount: 0,
      fxSource: 'persisted',
    } as never,
    now: new Date('2026-05-01T00:00:00.000Z'),
  });

  assert.match(summary.warningMessages.join('\n'), /超過 24 小時未更新/);
});
