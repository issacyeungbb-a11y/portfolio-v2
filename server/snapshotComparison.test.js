import assert from 'node:assert/strict';
import test from 'node:test';

import {
  compareSnapshots,
  formatSnapshotComparisonForPrompt,
  getMonthKey,
  normalizeDateKey,
  selectRecentDistinctMonthlySnapshots,
  summarizePeriodExternalFlow,
} from './snapshotComparison.js';

const previousSnapshot = {
  date: '2026-02-28',
  totalValueHKD: 1000,
  holdings: [
    {
      assetId: 'aapl',
      ticker: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      quantity: 10,
      currentPrice: 100,
      marketValueHKD: 500,
    },
    {
      assetId: 'voo',
      ticker: 'VOO',
      name: 'Vanguard S&P 500',
      assetType: 'etf',
      currency: 'USD',
      quantity: 2,
      currentPrice: 200,
      marketValueHKD: 400,
    },
    {
      assetId: 'cash',
      ticker: 'CASH',
      name: 'Cash',
      assetType: 'cash',
      currency: 'HKD',
      quantity: 1,
      currentPrice: 100,
      marketValueHKD: 100,
    },
  ],
};

const currentSnapshot = {
  date: '2026-03-31',
  totalValueHKD: 1300,
  holdings: [
    {
      assetId: 'aapl',
      ticker: 'AAPL',
      name: 'Apple',
      assetType: 'stock',
      currency: 'USD',
      quantity: 12,
      currentPrice: 120,
      marketValueHKD: 720,
    },
    {
      assetId: 'nvda',
      ticker: 'NVDA',
      name: 'NVIDIA',
      assetType: 'stock',
      currency: 'USD',
      quantity: 5,
      currentPrice: 80,
      marketValueHKD: 400,
    },
    {
      assetId: 'cash',
      ticker: 'CASH',
      name: 'Cash',
      assetType: 'cash',
      currency: 'HKD',
      quantity: 1,
      currentPrice: 180,
      marketValueHKD: 180,
    },
  ],
};

test('compareSnapshots tracks new, closed and increased holdings', () => {
  const comparison = compareSnapshots(currentSnapshot, previousSnapshot);

  assert.equal(comparison.periodLabel, '2026-03 vs 2026-02');
  assert.equal(comparison.totalValue.changeHKD, 300);
  assert.equal(comparison.totalValue.changePercent, 30);

  const aapl = comparison.holdingChanges.find((entry) => entry.ticker === 'AAPL');
  const voo = comparison.holdingChanges.find((entry) => entry.ticker === 'VOO');
  const nvda = comparison.holdingChanges.find((entry) => entry.ticker === 'NVDA');

  assert.ok(aapl);
  assert.equal(aapl?.status, 'increased');
  assert.equal(aapl?.quantityChange, 2);
  assert.equal(aapl?.priceChangePercent, 20);
  assert.equal(aapl?.contributionToPortfolioChange, 220);

  assert.ok(voo);
  assert.equal(voo?.status, 'closed');
  assert.equal(voo?.contributionToPortfolioChange, -400);

  assert.ok(nvda);
  assert.equal(nvda?.status, 'new');
  assert.equal(nvda?.contributionToPortfolioChange, 400);
});

test('compareSnapshots calculates allocation changes and movers', () => {
  const comparison = compareSnapshots(currentSnapshot, previousSnapshot);

  const stockChange = comparison.assetTypeChanges.find((entry) => entry.assetType === 'stock');
  const cashChange = comparison.currencyChanges.find((entry) => entry.currency === 'HKD');

  assert.ok(stockChange);
  assert.ok(cashChange);
  assert.ok(comparison.topMovers.gainers.some((entry) => entry.ticker === 'NVDA'));
  assert.ok(comparison.topMovers.losers.some((entry) => entry.ticker === 'VOO'));
});

test('selectRecentDistinctMonthlySnapshots keeps the latest snapshot for each month', () => {
  const snapshots = [
    { date: '2026-03-31', totalValueHKD: 1, holdings: [] },
    { date: '2026-03-15', totalValueHKD: 2, holdings: [] },
    { date: '2026-02-28', totalValueHKD: 3, holdings: [] },
    { date: '2026-02-10', totalValueHKD: 4, holdings: [] },
    { date: '2026-01-31', totalValueHKD: 5, holdings: [] },
  ];

  const selected = selectRecentDistinctMonthlySnapshots(snapshots, 3);

  assert.deepEqual(selected.map((entry) => entry.date), ['2026-03-31', '2026-02-28', '2026-01-31']);
});

test('normalizeDateKey accepts non-YYYY-MM-DD input and rejects invalid dates', () => {
  assert.equal(normalizeDateKey('2026-03-31T00:00:00.000Z'), '2026-03-31');
  assert.equal(getMonthKey('2026-03-31T00:00:00.000Z'), '2026-03');
  assert.throws(() => normalizeDateKey('not-a-real-date'), /無法解析日期/);
});

test('compareSnapshots matches holdings without assetId by ticker and currency', () => {
  const previous = {
    date: '2026-02-28',
    totalValueHKD: 500,
    holdings: [
      {
        assetId: '',
        ticker: 'ETH',
        name: 'Ethereum Old Name',
        assetType: 'crypto',
        currency: 'USD',
        quantity: 1,
        currentPrice: 100,
        marketValueHKD: 500,
      },
    ],
  };

  const current = {
    date: '2026-03-31',
    totalValueHKD: 700,
    holdings: [
      {
        assetId: '',
        ticker: 'ETH',
        name: 'Ethereum New Name',
        assetType: 'crypto',
        currency: 'USD',
        quantity: 1,
        currentPrice: 140,
        marketValueHKD: 700,
      },
    ],
  };

  const comparison = compareSnapshots(current, previous);
  assert.equal(comparison.holdingChanges.length, 1);
  assert.equal(comparison.holdingChanges[0]?.status, 'unchanged');
  assert.equal(comparison.holdingChanges[0]?.name, 'Ethereum New Name');
});

test('compareSnapshots calculates cash-flow adjusted return when period snapshots are complete', () => {
  const comparison = compareSnapshots(
    {
      ...currentSnapshot,
      date: '2026-03-03',
      totalValueHKD: 120000,
    },
    {
      ...previousSnapshot,
      date: '2026-03-01',
      totalValueHKD: 100000,
    },
    {
      periodSnapshots: [
        { date: '2026-03-02', totalValueHKD: 110000, netExternalFlowHKD: 15000, holdings: [] },
        { date: '2026-03-03', totalValueHKD: 120000, netExternalFlowHKD: 0, holdings: [] },
      ],
    },
  );

  assert.equal(comparison.totalValue.netExternalFlowHKD, 15000);
  assert.equal(comparison.totalValue.investmentGainHKD, 5000);
  assert.equal(comparison.totalValue.investmentGainPercent, 5);
  assert.equal(comparison.totalValue.cashFlowDataComplete, true);
  assert.equal(comparison.totalValue.netExternalFlowCoveragePct, 100);
  assert.equal(comparison.totalValue.cashFlowWarningMessage, undefined);
});

test('compareSnapshots handles withdrawal-adjusted gain correctly', () => {
  const comparison = compareSnapshots(
    {
      ...currentSnapshot,
      date: '2026-03-03',
      totalValueHKD: 90000,
    },
    {
      ...previousSnapshot,
      date: '2026-03-01',
      totalValueHKD: 100000,
    },
    {
      periodSnapshots: [
        { date: '2026-03-02', totalValueHKD: 95000, netExternalFlowHKD: -20000, holdings: [] },
        { date: '2026-03-03', totalValueHKD: 90000, netExternalFlowHKD: 0, holdings: [] },
      ],
    },
  );

  assert.equal(comparison.totalValue.netExternalFlowHKD, -20000);
  assert.equal(comparison.totalValue.investmentGainHKD, 10000);
});

test('summarizePeriodExternalFlow marks missing snapshot dates as incomplete', () => {
  const flow = summarizePeriodExternalFlow('2026-03-01', '2026-03-03', [
    { date: '2026-03-03', totalValueHKD: 1, netExternalFlowHKD: 0, holdings: [] },
  ]);

  assert.equal(flow.isComplete, false);
  assert.equal(flow.expectedSnapshotDays, 2);
  assert.equal(flow.availableSnapshotDays, 1);
  assert.equal(flow.netExternalFlowCoveragePct, 50);
  assert.deepEqual(flow.missingDates, ['2026-03-02']);
});

test('compareSnapshots keeps adjusted return when cash-flow coverage is between 80% and 99%', () => {
  const comparison = compareSnapshots(
    {
      ...currentSnapshot,
      date: '2026-03-06',
      totalValueHKD: 120000,
    },
    {
      ...previousSnapshot,
      date: '2026-03-01',
      totalValueHKD: 100000,
    },
    {
      periodSnapshots: [
        { date: '2026-03-02', totalValueHKD: 101000, netExternalFlowHKD: 5000, holdings: [] },
        { date: '2026-03-03', totalValueHKD: 106000, netExternalFlowHKD: 3000, holdings: [] },
        { date: '2026-03-04', totalValueHKD: 110000, netExternalFlowHKD: 2000, holdings: [] },
        { date: '2026-03-06', totalValueHKD: 120000, netExternalFlowHKD: 0, holdings: [] },
      ],
    },
  );

  assert.equal(comparison.totalValue.netExternalFlowCoveragePct, 80);
  assert.equal(comparison.totalValue.cashFlowDataComplete, false);
  assert.equal(comparison.totalValue.netExternalFlowHKD, 10000);
  assert.equal(comparison.totalValue.investmentGainHKD, 10000);
  assert.equal(comparison.totalValue.investmentGainPercent, 10);
  assert.match(comparison.totalValue.cashFlowWarningMessage ?? '', /資金流資料未完全覆蓋/);
  assert.match(formatSnapshotComparisonForPrompt(comparison), /資金流資料未完全覆蓋/);
});

test('compareSnapshots suppresses adjusted return when cash-flow coverage is below 80%', () => {
  const comparison = compareSnapshots(
    {
      ...currentSnapshot,
      date: '2026-03-06',
      totalValueHKD: 120000,
    },
    {
      ...previousSnapshot,
      date: '2026-03-01',
      totalValueHKD: 100000,
    },
    {
      periodSnapshots: [
        { date: '2026-03-02', totalValueHKD: 101000, netExternalFlowHKD: 5000, holdings: [] },
        { date: '2026-03-06', totalValueHKD: 120000, netExternalFlowHKD: 0, holdings: [] },
      ],
    },
  );

  assert.equal(comparison.totalValue.netExternalFlowCoveragePct, 40);
  assert.equal(comparison.totalValue.cashFlowDataComplete, false);
  assert.equal(comparison.totalValue.netExternalFlowHKD, undefined);
  assert.equal(comparison.totalValue.investmentGainHKD, undefined);
  assert.match(comparison.totalValue.cashFlowWarningMessage ?? '', /資金流覆蓋不足/);
  assert.match(formatSnapshotComparisonForPrompt(comparison), /資金流覆蓋不足，暫不計扣除資金流後表現/);
});
