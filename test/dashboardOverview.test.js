import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAccountPrincipalOverview,
  buildCalendarEntries,
  buildPerformanceOverview,
  buildPeriodTrend,
  buildTransactionComparisonMaps,
  findDataCompleteStartDate,
  buildTransactionOverview,
  getAvailableTrendPeriods,
  getMonthlyAnalysisPeriodKey,
  markOnboardingCalendarEntries,
  selectLatestStoredAnalysis,
  sortMonthlyAnalysisSessions,
  summarizeCalendarMonth,
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

test('monthly return starts from the previous month close so day one is included', () => {
  const history = [point('2026-06-30', 1000), point('2026-07-01', 990), point('2026-07-02', 1005)];
  const currentPoint = point('2026-07-03', 1010);
  const overview = buildPerformanceOverview({
    history,
    currentPoint,
    cashFlows: [],
    principals: [],
    todaySnapshotExists: true,
  });
  const calendar = summarizeCalendarMonth(buildCalendarEntries(history, currentPoint, []), '2026-07');

  assert.equal(overview.monthly?.startDate, '2026-06-30');
  assert.equal(overview.monthly?.marketChange, 10);
  assert.equal(calendar.pnlHKD, overview.monthly?.marketChange);
  assert.equal(calendar.baseValueHKD, 1000);
  assert.equal(calendar.returnPct, overview.monthly?.returnPct);
  assert.equal(calendar.worst?.date, '2026-07-01');
  assert.equal(calendar.best?.date, '2026-07-02');
});

test('trend periods only appear when snapshot history covers them', () => {
  const history = [point('2026-05-20', 900), point('2026-06-30', 1000), point('2026-07-10', 1050)];
  const currentPoint = point('2026-07-24', 1100);

  assert.deepEqual(getAvailableTrendPeriods(history, currentPoint), ['1w', '1m', 'all']);
  assert.deepEqual(
    getAvailableTrendPeriods([point('2025-12-31', 800), ...history], currentPoint),
    ['1w', '1m', '3m', '6m', 'ytd', 'all'],
  );
  assert.deepEqual(getAvailableTrendPeriods([], currentPoint), []);
});

test('period trend uses the close before the period as its opening value', () => {
  const history = [point('2025-12-31', 800), point('2026-01-02', 820), point('2026-07-10', 1050)];
  const currentPoint = point('2026-07-24', 1100);
  const ytd = buildPeriodTrend(history, currentPoint, [cashFlow({ amount: 100 })], 'ytd');
  const month = buildPeriodTrend(history, currentPoint, [], '1m');

  assert.equal(ytd?.startDate, '2025-12-31');
  assert.equal(ytd?.startValue, 800);
  assert.equal(ytd?.netExternalFlow, 100);
  assert.equal(ytd?.marketChange, 200);
  assert.deepEqual(ytd?.series.map((entry) => entry.date), ['2025-12-31', '2026-01-02', '2026-07-10', '2026-07-24']);
  assert.equal(month?.startDate, '2026-01-02');
  assert.deepEqual(month?.series.map((entry) => entry.date), ['2026-01-02', '2026-07-10', '2026-07-24']);
});

function onboardingHistory() {
  // 3/30 只輸入咗部分平台，4/1 先輸入齊；之後係正常市場變動，6/30 有一日 +20% 但已過咗建立期。
  return [
    point('2026-03-30', 550_000),
    point('2026-03-31', 600_000),
    point('2026-04-01', 1_600_000),
    point('2026-04-02', 1_620_000),
    point('2026-05-15', 1_700_000),
    point('2026-06-29', 1_750_000),
    point('2026-06-30', 2_100_000),
    point('2026-07-15', 2_050_000),
  ];
}

test('onboarding jumps in the first 60 days mark where complete data starts', () => {
  assert.equal(findDataCompleteStartDate(onboardingHistory(), []), '2026-04-01');
  assert.equal(findDataCompleteStartDate([point('2026-03-30', 1000), point('2026-03-31', 1010)], []), null);
  // 細額平台後輸入（未過 15%）都會由「新資產出現」規則捉到。
  const withHoldings = (date, total, assets) => ({
    ...point(date, total),
    holdings: assets.map(([assetId, marketValueHKD]) => ({ assetId, marketValueHKD })),
  });
  assert.equal(
    findDataCompleteStartDate([
      withHoldings('2026-03-30', 900, [['futu', 900]]),
      withHoldings('2026-03-31', 1000, [['futu', 905], ['ib', 95]]),
      withHoldings('2026-04-01', 1010, [['futu', 910], ['ib', 100]]),
    ], []),
    '2026-03-31',
  );
  // 用入金買入嘅新資產唔當係建立資料。
  assert.equal(
    findDataCompleteStartDate([
      withHoldings('2026-03-30', 900, [['futu', 900]]),
      withHoldings('2026-03-31', 1000, [['futu', 905], ['ib', 95]]),
    ], [cashFlow({ amount: 95, date: '2026-03-31' })]),
    null,
  );
  // 有入金紀錄嘅升幅唔當係建立資料。
  assert.equal(
    findDataCompleteStartDate([point('2026-03-30', 1000), point('2026-03-31', 1600)], [cashFlow({ amount: 600, date: '2026-03-31' })]),
    null,
  );
});

test('onboarding period never becomes an opening value and leaves later periods unchanged', () => {
  const history = onboardingHistory();
  const currentPoint = point('2026-07-24', 2_060_000);
  const dataStart = findDataCompleteStartDate(history, []);
  const withGuard = buildPeriodTrend(history, currentPoint, [], '1m', dataStart);
  const withoutGuard = buildPeriodTrend(history, currentPoint, [], '1m');

  assert.deepEqual(withGuard, withoutGuard);
  assert.deepEqual(getAvailableTrendPeriods(history, currentPoint, dataStart), ['1w', '1m', '3m', 'all']);
  assert.ok(!getAvailableTrendPeriods(history, currentPoint, dataStart).includes('6m'));

  const all = buildPeriodTrend(history, currentPoint, [], 'all', dataStart);
  assert.equal(all?.series[0].date, '2026-03-30');
});

test('calendar skips onboarding days and uses the first complete close as base', () => {
  const history = onboardingHistory();
  const entries = markOnboardingCalendarEntries(buildCalendarEntries(history, null, []), '2026-04-01');
  const april = summarizeCalendarMonth(entries, '2026-04');
  const march = summarizeCalendarMonth(entries, '2026-03');

  assert.equal(entries.find((entry) => entry.date === '2026-04-01')?.onboarding, true);
  assert.equal(entries.find((entry) => entry.date === '2026-04-01')?.changeHKD, 0);
  assert.equal(april.pnlHKD, 20_000);
  assert.equal(april.baseValueHKD, 1_600_000);
  assert.equal(march.pnlHKD, 0);
  assert.equal(summarizeCalendarMonth(entries, '2026-06').pnlHKD, 400_000);
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
