import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLedgerRebuild, validateLedgerEntry } from '../src/lib/portfolio/transactionRebuild.ts';
import type { LedgerEntryForRebuild } from '../src/lib/portfolio/transactionRebuild.ts';

function buyEntry(overrides: Partial<LedgerEntryForRebuild> = {}): LedgerEntryForRebuild {
  return {
    id: 'tx-buy',
    transactionType: 'buy',
    recordType: 'trade',
    quantity: 100,
    price: 10,
    fees: 0,
    currency: 'HKD',
    date: '2024-01-01',
    ...overrides,
  };
}

function sellEntry(overrides: Partial<LedgerEntryForRebuild> = {}): LedgerEntryForRebuild {
  return {
    id: 'tx-sell',
    transactionType: 'sell',
    recordType: 'trade',
    quantity: 50,
    price: 12,
    fees: 0,
    currency: 'HKD',
    date: '2024-01-02',
    ...overrides,
  };
}

test('empty transactions: zero quantity and cost', () => {
  const result = runLedgerRebuild([]);
  assert.equal(result.finalQuantity, 0);
  assert.equal(result.finalAverageCost, 0);
  assert.equal(result.finalLatestTradePrice, 0);
  assert.equal(result.txResults.length, 0);
});

test('buy tx: correct quantity and average cost (no fees)', () => {
  const result = runLedgerRebuild([buyEntry()]);
  assert.equal(result.finalQuantity, 100);
  assert.equal(result.finalAverageCost, 10);
  assert.equal(result.txResults[0]?.quantityAfter, 100);
  assert.equal(result.txResults[0]?.averageCostAfter, 10);
  assert.equal(result.txResults[0]?.realizedPnlHKD, 0);
});

test('buy tx: average cost includes fees', () => {
  const result = runLedgerRebuild([buyEntry({ quantity: 100, price: 10, fees: 50 })]);
  // avgCost = (100*10 + 50) / 100 = 10.5
  assert.equal(result.finalAverageCost, 10.5);
});

test('sell tx: correct quantity and realizedPnl', () => {
  const result = runLedgerRebuild([buyEntry(), sellEntry()]);
  assert.equal(result.finalQuantity, 50);
  // realizedPnl = (12 - 10) * 50 - 0 = 100 HKD
  const sellResult = result.txResults.find((r) => r.id === 'tx-sell');
  assert.equal(sellResult?.quantityAfter, 50);
  assert.equal(sellResult?.realizedPnlHKD, 100);
});

test('sell tx: USD realizedPnl converted to HKD', () => {
  const result = runLedgerRebuild([
    buyEntry({ currency: 'USD' }),
    sellEntry({ currency: 'USD' }),
  ]);
  const sellResult = result.txResults.find((r) => r.id === 'tx-sell');
  // realizedPnl in USD = 100, convert to HKD at rate 7.8 = 780
  assert.ok(sellResult && sellResult.realizedPnlHKD > 100, 'USD pnl should be converted to HKD');
});

test('seed tx: sets quantity and average cost', () => {
  const seed: LedgerEntryForRebuild = {
    id: 'seed',
    transactionType: 'buy',
    recordType: 'seed',
    quantity: 200,
    price: 15,
    fees: 0,
    currency: 'HKD',
    date: '2023-01-01',
  };
  const result = runLedgerRebuild([seed]);
  assert.equal(result.finalQuantity, 200);
  assert.equal(result.finalAverageCost, 15);
});

test('seed tx: fees included in average cost', () => {
  const seed: LedgerEntryForRebuild = {
    id: 'seed',
    transactionType: 'buy',
    recordType: 'seed',
    quantity: 100,
    price: 10,
    fees: 50,
    currency: 'HKD',
    date: '2023-01-01',
  };
  const result = runLedgerRebuild([seed]);
  assert.equal(result.finalAverageCost, 10.5);
});

test('sell beyond holding: throws', () => {
  assert.throws(
    () =>
      runLedgerRebuild([
        buyEntry({ quantity: 10 }),
        sellEntry({ quantity: 20 }),
      ]),
    /賣出數量不可大過當時持倉/,
  );
});

test('validateLedgerEntry: asset_created record is a no-op', () => {
  // Should not throw for asset_created even with quantity 0
  assert.doesNotThrow(() =>
    validateLedgerEntry(
      { id: 'x', transactionType: 'buy', recordType: 'asset_created', quantity: 0, price: 0, fees: 0, currency: 'HKD', date: '2024-01-01' },
      0,
    ),
  );
});

test('validateLedgerEntry: zero quantity throws for trade', () => {
  assert.throws(
    () => validateLedgerEntry(buyEntry({ quantity: 0 }), 0),
    /數量/,
  );
});

test('multiple buys: correct VWAP average cost', () => {
  const result = runLedgerRebuild([
    buyEntry({ id: 'b1', quantity: 100, price: 10, fees: 0 }),
    buyEntry({ id: 'b2', quantity: 100, price: 20, fees: 0, date: '2024-01-02' }),
  ]);
  // avgCost = (100*10 + 100*20) / 200 = 15
  assert.equal(result.finalQuantity, 200);
  assert.equal(result.finalAverageCost, 15);
});

test('full sell: quantity and avgCost reset to 0', () => {
  const result = runLedgerRebuild([
    buyEntry({ quantity: 100 }),
    sellEntry({ quantity: 100 }),
  ]);
  assert.equal(result.finalQuantity, 0);
  assert.equal(result.finalAverageCost, 0);
});
