import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateHoldingsForAllocation,
  buildAccountAllocationSlices,
  buildAllocationSlices,
} from '../src/lib/holdings.js';

function createHolding(overrides) {
  const marketValue = overrides.quantity * overrides.currentPrice;
  const costBasis = overrides.quantity * overrides.averageCost;

  return {
    id: overrides.id,
    name: 'Vanguard Value ETF',
    symbol: 'VTV',
    assetType: 'etf',
    currency: 'USD',
    allocation: overrides.allocation,
    marketValue,
    unrealizedPnl: marketValue - costBasis,
    unrealizedPct: costBasis === 0 ? 0 : ((marketValue - costBasis) / costBasis) * 100,
    ...overrides,
  };
}

test('allocation detail combines the same asset held in multiple accounts', () => {
  const holdings = [
    createHolding({
      id: 'vtv-futu',
      accountSource: 'Futu',
      quantity: 10,
      averageCost: 150,
      currentPrice: 175,
      allocation: 20,
    }),
    createHolding({
      id: 'vtv-ib',
      accountSource: 'IB',
      quantity: 5,
      averageCost: 160,
      currentPrice: 175,
      allocation: 10,
    }),
  ];

  const [combined] = aggregateHoldingsForAllocation(holdings);

  assert.equal(combined.symbol, 'VTV');
  assert.equal(combined.quantity, 15);
  assert.equal(combined.marketValue, 2625);
  assert.equal(combined.allocation, 30);
  assert.deepEqual(combined.accountSources, ['Futu', 'IB']);

  const [etfSlice] = buildAllocationSlices(holdings);
  assert.equal(etfSlice.holdings.length, 1);
  assert.deepEqual(etfSlice.holdings[0].accountSources, ['Futu', 'IB']);
});

test('allocation detail keeps different symbols as separate assets', () => {
  const holdings = [
    createHolding({
      id: 'vtv-futu',
      accountSource: 'Futu',
      quantity: 10,
      averageCost: 150,
      currentPrice: 175,
      allocation: 20,
    }),
    createHolding({
      id: 'voo-ib',
      name: 'Vanguard S&P 500 ETF',
      symbol: 'VOO',
      accountSource: 'IB',
      quantity: 5,
      averageCost: 500,
      currentPrice: 550,
      allocation: 30,
    }),
  ];

  assert.equal(aggregateHoldingsForAllocation(holdings).length, 2);
});

test('account allocation keeps each account visible and calculates portfolio share', () => {
  const holdings = [
    createHolding({
      id: 'vtv-futu',
      accountSource: 'Futu',
      quantity: 10,
      averageCost: 150,
      currentPrice: 175,
      allocation: 50,
    }),
    createHolding({
      id: 'vtv-ib',
      accountSource: 'IB',
      quantity: 5,
      averageCost: 160,
      currentPrice: 175,
      allocation: 25,
    }),
  ];

  const slices = buildAccountAllocationSlices(holdings);

  assert.deepEqual(slices.map((slice) => slice.key), ['Futu', 'IB']);
  assert.equal(slices[0].value, 2 / 3 * 100);
  assert.equal(slices[1].value, 1 / 3 * 100);
  assert.deepEqual(slices[0].holdings[0].accountSources, ['Futu']);
  assert.ok(Math.abs(slices.reduce((sum, slice) => sum + slice.value, 0) - 100) < 1e-9);
});
