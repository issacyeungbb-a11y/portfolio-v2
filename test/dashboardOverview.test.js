import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAccountPrincipalOverview,
  buildCalendarEntries,
  buildPerformanceOverview,
  buildTransactionComparisonMaps,
  buildTransactionOverview,
  getMonthlyAnalysisPeriodKey,
  selectLatestStoredAnalysis,
  sortMonthlyAnalysisSessions,
} from '../src/lib/portfolio/overviewSelectors.js';

function point(date, totalValue) {
  return {
    id: date,
    date,
    capturedAt: `${date}T12:00:00.000Z`,
    totalValue,
    netExternalFlow: 0,
  };
}

function cashFlow(overrides = {}) {
  return {
    id: 'flow-1',
    accountSource: 'Futu',
    type: 'deposit',
    amount: 100,
    currency: 'HKD',
    date: '2026-07-02',
    ...overrides,
  };
}

function holding(overrides = {}) {
  return {
    id: 'asset-1',
    name: 'Example ETF',
    symbol: 'ETF',
    assetType: 'etf',
    accountSource: 'Futu',
    currency: 'HKD',
    quantity: 10,
    averageCost: 100,
    currentPrice: 112,
    marketValue: 1120,
    unrealizedPnl: 120,
    unrealizedPct: 12,
    allocation: 100,
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return {
    id: 'tx-1',
    assetId: 'asset-1',
    assetName: 'Example ETF',
    symbol: 'ETF',
    assetType: 'etf',
    accountSource: 'Futu',
    transactionType: 'buy',
    quantity: 2,
    price: 100,
    fees: 0,
    currency: 'HKD',
    date: '2026-07-02',
    realizedPnlHKD: 0,
    recordType: 'trade',
    ...overrides,
  };
}

test('external deposit is excluded from monthly and historical investment gains', () => {
  const history = [point('2026-07-01', 1000)];
  const currentPoint = point('2026-07-03', 1120);
  const flows = [cashFlow()];
  const overview = buildPerformanceOverview({
    history,
    currentPoint,
    cashFlows: flows,
    principals: [{ accountSource: 'Futu', principalAmount: 1000, currency: 'HKD' }],
    todaySnapshotExists: true,
  });

  assert.equal(overview.monthly?.totalChange, 120);
  assert.equal(overview.monthly?.netExternalFlow, 100);
  assert.equal(overview.monthly?.marketChange, 20);
  assert.equal(overview.historicalReturnHKD, 20);
  assert.equal(overview.totalPrincipalHKD, 1100);
});

test('withdrawal reduces cumulative principal without becoming a negative investment return', () => {
  const overview = buildPerformanceOverview({
    history: [point('2026-07-01', 1000)],
    currentPoint: point('2026-07-03', 920),
    cashFlows: [cashFlow({ type: 'withdrawal', amount: 100 })],
    principals: [{ accountSource: 'Futu', principalAmount: 1000, currency: 'HKD' }],
    todaySnapshotExists: true,
  });

  assert.equal(overview.monthly?.netExternalFlow, -100);
  assert.equal(overview.monthly?.marketChange, 20);
  assert.equal(overview.historicalReturnHKD, 20);
  assert.equal(overview.totalPrincipalHKD, 900);
});

test('daily calendar market change also excludes same-period cash flow', () => {
  const entries = buildCalendarEntries(
    [point('2026-07-01', 1000), point('2026-07-02', 1110)],
    null,
    [cashFlow()],
  );

  assert.equal(entries[1]?.changeHKD, 10);
});

test('principal overview uses one shared signed cash-flow calculation', () => {
  const overview = buildAccountPrincipalOverview(
    [{ accountSource: 'Futu', principalAmount: 1000, currency: 'HKD' }],
    [cashFlow(), cashFlow({ id: 'flow-2', type: 'withdrawal', amount: 40 })],
    '2026-07-15',
  );

  assert.equal(overview.netExternalFlowHKD, 60);
  assert.equal(overview.monthNetFlowHKD, 60);
  assert.equal(overview.totalPrincipalHKD, 1060);
  assert.equal(overview.accountSummaries.find((item) => item.accountSource === 'Futu')?.recentCount, 2);
});

test('transaction overview shares current-price contribution and monthly count selectors', () => {
  const entries = [
    transaction(),
    transaction({ id: 'tx-2', transactionType: 'sell', price: 100, quantity: 1, realizedPnlHKD: 20 }),
  ];
  const maps = buildTransactionComparisonMaps(entries, [holding()], 'HKD');
  const overview = buildTransactionOverview(entries, maps.comparisonsByTransactionId, '2026-07-15');

  assert.equal(overview.monthTransactionCount, 2);
  assert.equal(overview.realizedPnlHKD, 20);
  assert.equal(overview.maxPositiveContribution?.entry.id, 'tx-1');
  assert.equal(overview.maxNegativeContribution?.entry.id, 'tx-2');
});

test('latest analysis summary reads stored report content only', () => {
  const latest = selectLatestStoredAnalysis([
    {
      id: 'monthly-2026-07',
      category: 'asset_analysis',
      title: '2026年7月每月資產分析',
      question: '',
      result: '【管理層摘要】\n- 組合本月市場收益保持正數。\n- 現金比例足以應付短期部署。\n- 最大持倉集中度需要繼續監察。',
      model: 'stored-model',
      updatedAt: '2026-07-10T00:00:00.000Z',
    },
  ], []);

  assert.equal(latest?.kind, 'monthly');
  assert.equal(latest?.highlights.length, 3);
  assert.match(latest?.highlights[0] ?? '', /市場收益/);
});

test('monthly reports sort by covered month before Firestore update time', () => {
  const june = {
    id: 'monthly-2026-06',
    category: 'asset_analysis',
    title: '2026年6月每月資產分析',
    question: '',
    result: '六月內容',
    model: 'stored-model',
    updatedAt: '2026-07-02T00:00:00.000Z',
  };
  const may = {
    ...june,
    id: 'legacy-may',
    title: '2026年5月每月資產分析',
    result: '五月內容',
    updatedAt: '2026-07-14T00:00:00.000Z',
  };

  assert.equal(getMonthlyAnalysisPeriodKey(june), '2026-06');
  assert.deepEqual(sortMonthlyAnalysisSessions([may, june]).map((session) => session.id), [
    'monthly-2026-06',
    'legacy-may',
  ]);
});

test('dashboard latest analysis follows covered period instead of generation time', () => {
  const baseSession = {
    category: 'asset_analysis',
    question: '',
    model: 'stored-model',
  };
  const latest = selectLatestStoredAnalysis([
    {
      ...baseSession,
      id: 'monthly-2026-05',
      title: '2026年5月每月資產分析',
      result: '五月報告內容較新生成，但所屬月份較舊。',
      updatedAt: '2026-07-10T14:02:00.000Z',
    },
    {
      ...baseSession,
      id: 'monthly-2026-06',
      title: '2026年6月每月資產分析',
      result: '六月報告內容應顯示於總覽。',
      updatedAt: '2026-07-04T12:16:00.000Z',
    },
  ], []);

  assert.equal(latest?.id, 'monthly-2026-06');
  assert.equal(latest?.title, '2026年6月每月資產分析');
});
