import assert from 'node:assert/strict';
import test from 'node:test';

import { compareSnapshots, selectRecentDistinctMonthlySnapshots } from './snapshotComparison.js';

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
