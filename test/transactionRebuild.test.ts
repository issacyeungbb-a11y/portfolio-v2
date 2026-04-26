import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLedgerRebuild, validateLedgerEntry, computeValueWeightedRisk } from '../src/lib/portfolio/transactionRebuild.ts';
import type { LedgerEntryForRebuild, AssetValueWeight } from '../src/lib/portfolio/transactionRebuild.ts';

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

// --- computeValueWeightedRisk tests ---

const FX = { USD: 7.8, JPY: 0.052 };

function asset(symbol: string, quantity: number, currentPrice: number, currency = 'HKD'): AssetValueWeight {
  return { symbol, quantity, currentPrice, currency };
}

test('computeValueWeightedRisk: no assets → no risk', () => {
  const result = computeValueWeightedRisk([], [], FX);
  assert.equal(result.valueWeightedHighRisk, false);
  assert.equal(result.staleValuePct, 0);
});

test('computeValueWeightedRisk: single stale asset >15% → highRisk', () => {
  const all = [asset('AAPL', 100, 200), asset('MSFT', 10, 100)];
  // AAPL = 20000 HKD, MSFT = 1000 HKD, total = 21000
  // AAPL stale pct = 20000/21000 ≈ 95% → >15% → highRisk
  const result = computeValueWeightedRisk([asset('AAPL', 100, 200)], all, FX);
  assert.equal(result.valueWeightedHighRisk, true);
  assert.equal(result.largestStaleAssetSymbol, 'AAPL');
});

test('computeValueWeightedRisk: combined stale >20% → highRisk', () => {
  const all = [asset('A', 10, 100), asset('B', 10, 100), asset('C', 100, 100)];
  // A=1000, B=1000, C=10000 total=12000; stale A+B=2000 (16.7%) — but each <15%
  // combined staleValuePct = 17 → <20 won't trigger combined; need >20
  // Use A=10, B=10, C=4 (each price 100), total=2400, stale A+B=2000 → 83% → >20
  const allBig = [asset('A', 10, 100), asset('B', 10, 100), asset('C', 4, 100)];
  const result = computeValueWeightedRisk([asset('A', 10, 100), asset('B', 10, 100)], allBig, FX);
  assert.equal(result.valueWeightedHighRisk, true);
  assert.ok(result.staleValuePct > 20);
});

test('computeValueWeightedRisk: small stale → no risk', () => {
  const all = [asset('A', 1, 10), asset('B', 100, 100)];
  // A=10, B=10000, total=10010; stale A pct ≈ 0.1% → no risk
  const result = computeValueWeightedRisk([asset('A', 1, 10)], all, FX);
  assert.equal(result.valueWeightedHighRisk, false);
  assert.equal(result.staleValuePct < 15, true);
});

test('computeValueWeightedRisk: USD assets converted to HKD', () => {
  const all = [asset('AAPL', 1, 200, 'USD'), asset('LOCAL', 100, 100, 'HKD')];
  // AAPL = 200 * 7.8 = 1560 HKD, LOCAL = 10000 HKD, total = 11560
  // AAPL stale pct = 1560/11560 ≈ 13.5% → <15% → no single-asset risk
  const result = computeValueWeightedRisk([asset('AAPL', 1, 200, 'USD')], all, FX);
  assert.ok(result.largestStaleAssetSymbol === 'AAPL');
  assert.equal(result.valueWeightedHighRisk, false);
});

test('computeValueWeightedRisk: largestStaleAssetPct computed correctly', () => {
  const all = [asset('A', 10, 50), asset('B', 10, 50)];
  // A=500, B=500, total=1000, stale=[A] → 50%
  const result = computeValueWeightedRisk([asset('A', 10, 50)], all, FX);
  assert.equal(result.largestStaleAssetSymbol, 'A');
  assert.equal(result.largestStaleAssetPct, 50);
  assert.equal(result.valueWeightedHighRisk, true); // 50% > 15%
});
