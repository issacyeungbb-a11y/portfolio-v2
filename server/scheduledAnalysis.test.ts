import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnalysisSessionWritePayload,
  buildQuarterlyReportWritePayload,
  buildReportDataQualitySummary,
  buildReportFactsPayload,
  buildAnalysisRequestFromAssets,
  buildMonthlyAnalysisQuestion,
  getSearchSummaryPrompt,
  getPreviousMonthStartDate,
  normalizeSnapshotDocument,
  sanitizeForFirestore,
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

test('sanitizeForFirestore removes undefined recursively from report facts payload', () => {
  const payload = buildReportFactsPayload({
    reportType: 'monthly',
    generatedAt: '2026-05-01T00:15:00.000Z',
    periodStartDate: '2026-04-01',
    periodEndDate: '2026-05-01',
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
      coveragePct: undefined,
      fallbackAssetCount: undefined,
      missingAssetCount: undefined,
      oldestPriceAsOf: undefined,
      warningMessages: ['有 1 項資產價格超過 24 小時未更新。'],
    },
    topHoldingsByHKD: [
      {
        assetId: 'metaplanet',
        ticker: '3350',
        name: 'Metaplanet',
        assetType: 'stock',
        currency: 'JPY',
        quantity: 500,
        currentPrice: 326,
        marketValue: undefined,
        marketValueHKD: 8476,
        costValue: 10608,
      } as never,
    ],
  });

  const sanitized = sanitizeForFirestore(payload) as Record<string, unknown>;
  const dataQualitySummary = sanitized.dataQualitySummary as Record<string, unknown>;
  const firstHolding = (sanitized.topHoldingsByHKD as Array<Record<string, unknown>>)[0];

  assert.ok(!('netExternalFlowHKD' in sanitized));
  assert.ok(!('netExternalFlowCoveragePct' in sanitized));
  assert.ok(!('investmentGainHKD' in sanitized));
  assert.ok(!('investmentGainPercent' in sanitized));
  assert.ok(!('cashFlowWarningMessage' in sanitized));
  assert.ok(!('fxRatesUsed' in sanitized));
  assert.ok(!('coveragePct' in dataQualitySummary));
  assert.ok(!('fallbackAssetCount' in dataQualitySummary));
  assert.ok(!('missingAssetCount' in dataQualitySummary));
  assert.ok(!('oldestPriceAsOf' in dataQualitySummary));
  assert.ok(!('marketValueLocal' in firstHolding));
});

test('buildAnalysisSessionWritePayload sanitizes reportFactsPayload before write', () => {
  const writePayload = buildAnalysisSessionWritePayload({
    response: {
      category: 'asset_analysis',
      analysisQuestion: 'question',
      answer: 'answer',
      model: 'claude-opus-4-7',
      provider: 'anthropic',
      snapshotHash: 'snapshot-hash',
      cacheKey: 'cache-key',
      analysisBackground: 'background',
      generatedAt: '2026-05-01T00:15:00.000Z',
      assetCount: 1,
    } as never,
    title: '2026年5每月資產分析',
    reportFactsPayload: {
      generatedAt: '2026-05-01T00:15:00.000Z',
      reportType: 'monthly',
      periodStartDate: '2026-04-01',
      periodEndDate: '2026-05-01',
      currentSnapshotDate: '2026-05-01',
      totalValueHKD: 120000,
      totalCostHKD: 100000,
      netExternalFlowHKD: undefined,
      dataQualitySummary: {
        status: 'partial',
        staleAssetCount: 1,
        missingAssetCount: undefined,
        warningMessages: ['warn'],
      },
      topHoldingsByHKD: [
        {
          ticker: '3350',
          name: 'Metaplanet',
          currency: 'JPY',
          marketValueHKD: 8476,
          marketValueLocal: undefined,
        },
      ],
      allocationByType: [],
      allocationByCurrency: [],
      model: 'claude-opus-4-7',
      provider: 'anthropic',
      snapshotHash: 'snapshot-hash',
      promptVersion: 'v1',
    },
  });

  const reportFactsPayload = writePayload.reportFactsPayload as unknown as Record<string, unknown>;
  const dataQualitySummary = reportFactsPayload.dataQualitySummary as Record<string, unknown>;
  const firstHolding = (reportFactsPayload.topHoldingsByHKD as Array<Record<string, unknown>>)[0];

  assert.ok(reportFactsPayload);
  assert.ok(!('netExternalFlowHKD' in reportFactsPayload));
  assert.ok(!('missingAssetCount' in dataQualitySummary));
  assert.ok(!('marketValueLocal' in firstHolding));
});

test('buildQuarterlyReportWritePayload sanitizes reportFactsPayload before write', () => {
  const writePayload = buildQuarterlyReportWritePayload({
    quarter: '2026年Q2',
    generatedAt: '2026-05-01T00:15:00.000Z',
    report: 'report',
    currentSnapshotHash: 'snapshot-hash',
    searchSummary: 'summary',
    model: 'claude-opus-4-7',
    provider: 'anthropic',
    reportFactsPayload: {
      generatedAt: '2026-05-01T00:15:00.000Z',
      reportType: 'quarterly',
      periodStartDate: '2026-01-01',
      periodEndDate: '2026-05-01',
      currentSnapshotDate: '2026-05-01',
      totalValueHKD: 120000,
      totalCostHKD: 100000,
      cashFlowWarningMessage: undefined,
      dataQualitySummary: {
        status: 'warning',
        staleAssetCount: 2,
        fallbackAssetCount: undefined,
        warningMessages: ['warn'],
      },
      topHoldingsByHKD: [
        {
          ticker: '3350',
          name: 'Metaplanet',
          currency: 'JPY',
          marketValueHKD: 8476,
          marketValueLocal: undefined,
        },
      ],
      allocationByType: [],
      allocationByCurrency: [],
      model: 'claude-opus-4-7',
      provider: 'anthropic',
      snapshotHash: 'snapshot-hash',
      promptVersion: 'v1',
    },
  });

  const reportFactsPayload = writePayload.reportFactsPayload as unknown as Record<string, unknown>;
  const dataQualitySummary = reportFactsPayload.dataQualitySummary as Record<string, unknown>;
  const firstHolding = (reportFactsPayload.topHoldingsByHKD as Array<Record<string, unknown>>)[0];

  assert.ok(!('cashFlowWarningMessage' in reportFactsPayload));
  assert.ok(!('fallbackAssetCount' in dataQualitySummary));
  assert.ok(!('marketValueLocal' in firstHolding));
});

test('monthly grounded search prompt keeps structured macro-only summary requirements', () => {
  const prompt = getSearchSummaryPrompt({
    mode: 'monthly',
    assets: [
      {
        id: 'vt',
        symbol: 'VT',
        name: 'Vanguard Total World Stock ETF',
        assetType: 'etf',
        accountSource: 'IB',
        currency: 'USD',
        quantity: 10,
        averageCost: 100,
        currentPrice: 110,
      } as never,
      {
        id: 'btc',
        symbol: 'BTC',
        name: 'Bitcoin',
        assetType: 'crypto',
        accountSource: 'Wallet',
        currency: 'USD',
        quantity: 1,
        averageCost: 50000,
        currentPrice: 60000,
      } as never,
    ],
  });

  assert.match(prompt, /過去一個月市場主線/);
  assert.match(prompt, /股票 \/ ETF 影響/);
  assert.match(prompt, /加密貨幣影響/);
  assert.match(prompt, /現金 \/ 債券 \/ 利率影響/);
  assert.match(prompt, /匯率與 JPY \/ USD \/ HKD 影響/);
  assert.match(prompt, /下月值得觀察的 3-5 個外部因素/);
  assert.match(prompt, /不要做投資分析、買賣建議或價格預測/);
  assert.match(prompt, /800-1200 中文字以內/);
});

test('monthly analysis prompt preserves five sections and adds macro, data quality, and conditional guidance constraints', () => {
  const prompt = buildMonthlyAnalysisQuestion({
    comparison: null,
    allocationSummary: {
      asOfDate: '2026-05-01',
      basis: 'monthly',
      styleTag: 'balanced',
      warningTags: ['currency_watch'],
      slices: [
        {
          key: 'equity',
          label: '股票',
          percentage: 60,
          totalValueHKD: 60000,
        },
      ],
      deltas: [
        {
          key: 'equity',
          deltaPercentagePoints: 2,
        },
      ],
      summarySentence: '股票比重略升。',
      comparisonLabel: '較上月月初基準',
    } as never,
    dataQualitySummary: {
      status: 'partial',
      staleAssetCount: 1,
      warningMessages: ['有 1 項資產價格超過 24 小時未更新。'],
    },
  });

  assert.match(prompt, /【本月一句總結】/);
  assert.match(prompt, /【本月資產變化摘要】/);
  assert.match(prompt, /【組合健康檢查】/);
  assert.match(prompt, /【三個重點觀察】/);
  assert.match(prompt, /【下月行動建議】/);
  assert.match(prompt, /宏觀背景同我實際資產分佈、資產變化互相對照/);
  assert.match(prompt, /cash-flow adjusted return/);
  assert.match(prompt, /risk-on \/ risk-off/);
  assert.match(prompt, /「宏觀背景 → 對我資產的影響 → 投資含義」/);
  assert.match(prompt, /必須跟進 \/ 可以考慮 \/ 暫時不建議/);
  assert.match(prompt, /寫明觸發條件/);
  assert.match(prompt, /staleAssetCount > 0/);
  assert.match(prompt, /dataQualitySummary.status 係 partial 或 warning/);
  assert.match(prompt, /資金流覆蓋率唔係 100%/);
});
