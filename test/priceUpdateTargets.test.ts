import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildArchivedAssetRepairPayloadFromTransaction,
  buildAllAssetPriceUpdatePlan,
  buildTransactionAssetPriceUpdatePlan,
  getRepairableMissingAssetEntries,
} from '../src/lib/portfolio/priceUpdateTargets.ts';
import { getTransactionPriceComparison } from '../src/lib/portfolio/transactionPriceComparison.ts';
import type { AssetTransactionEntry, Holding } from '../src/types/portfolio.ts';

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'asset-1',
    name: 'Test Asset',
    symbol: 'TEST',
    assetType: 'stock',
    accountSource: 'IB',
    currency: 'USD',
    quantity: 10,
    averageCost: 100,
    currentPrice: 120,
    marketValue: 1200,
    unrealizedPnl: 200,
    unrealizedPct: 20,
    allocation: 0,
    ...overrides,
  };
}

function makeTransaction(overrides: Partial<AssetTransactionEntry> = {}): AssetTransactionEntry {
  return {
    id: 'tx-1',
    assetId: 'asset-1',
    assetName: 'Test Asset',
    symbol: 'TEST',
    assetType: 'stock',
    accountSource: 'IB',
    transactionType: 'buy',
    quantity: 2,
    price: 100,
    fees: 1,
    currency: 'USD',
    date: '2026-01-01',
    realizedPnlHKD: 0,
    recordType: 'trade',
    quantityAfter: 2,
    averageCostAfter: 100.5,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

test('all asset update plan includes closed archived assets without making them active', () => {
  const active = makeHolding({ id: 'active', quantity: 5, archivedAt: '' });
  const closed = makeHolding({
    id: 'closed',
    quantity: 0,
    archivedAt: '2026-01-10T00:00:00.000Z',
    currentPrice: 150,
  });
  const plan = buildAllAssetPriceUpdatePlan([active, closed]);

  assert.deepEqual(plan.targetHoldings.map((holding) => holding.id), ['active', 'closed']);
  assert.equal(plan.diagnostics.currentAssetCount, 1);
  assert.equal(plan.diagnostics.historicalAssetUpdateCount, 1);

  const activeOnly = [active, closed].filter(
    (holding) => !holding.archivedAt && holding.assetType !== 'cash' && holding.quantity > 0,
  );
  assert.deepEqual(activeOnly.map((holding) => holding.id), ['active']);
});

test('transaction update plan ignores filters by using all visible entries and dedupes assetId', () => {
  const holdings = [
    makeHolding({ id: 'asset-1', symbol: 'AAA' }),
    makeHolding({ id: 'asset-2', symbol: 'BBB', quantity: 0, archivedAt: '2026-01-10T00:00:00.000Z' }),
  ];
  const visibleEntries = [
    makeTransaction({ id: 'buy-1', assetId: 'asset-1', symbol: 'AAA', transactionType: 'buy' }),
    makeTransaction({ id: 'sell-1', assetId: 'asset-2', symbol: 'BBB', transactionType: 'sell' }),
    makeTransaction({ id: 'sell-2', assetId: 'asset-2', symbol: 'BBB', transactionType: 'sell' }),
  ];
  const filteredEntries = visibleEntries.filter((entry) => entry.transactionType === 'buy');

  assert.equal(buildTransactionAssetPriceUpdatePlan(filteredEntries, holdings).targetHoldings.length, 1);

  const plan = buildTransactionAssetPriceUpdatePlan(visibleEntries, holdings);
  assert.deepEqual(plan.targetHoldings.map((holding) => holding.id).sort(), ['asset-1', 'asset-2']);
  assert.equal(plan.diagnostics.historicalAssetCount, 2);
  assert.equal(plan.diagnostics.matchedAssetCount, 2);
  assert.equal(plan.diagnostics.historicalAssetUpdateCount, 1);
});

test('transaction update plan reports missing asset documents instead of skipping silently', () => {
  const plan = buildTransactionAssetPriceUpdatePlan(
    [makeTransaction({ assetId: 'missing-asset', symbol: 'MISS', assetName: 'Missing Asset' })],
    [],
  );

  assert.equal(plan.diagnostics.historicalAssetCount, 1);
  assert.equal(plan.diagnostics.matchedAssetCount, 0);
  assert.equal(plan.diagnostics.unmatchedAssetCount, 1);
  assert.deepEqual(plan.diagnostics.unmatchedAssets[0], {
    assetId: 'missing-asset',
    symbol: 'MISS',
    assetName: 'Missing Asset',
    reason: 'assets 文件不存在，但交易顯示仍有持倉',
  });
});

test('quantityAfter zero missing asset document can be repaired as an archived zero-quantity asset', () => {
  const transaction = makeTransaction({
    assetId: 'old-asset',
    assetName: 'Old Asset',
    symbol: 'OLD',
    assetType: 'etf',
    accountSource: 'Futu',
    currency: 'USD',
    price: 88,
    quantityAfter: 0,
  });
  const plan = buildTransactionAssetPriceUpdatePlan([transaction], []);
  const payload = buildArchivedAssetRepairPayloadFromTransaction(transaction);

  assert.equal(plan.diagnostics.repairableMissingAssetCount, 1);
  assert.equal(plan.diagnostics.blockedMissingAssetCount, 0);
  assert.deepEqual(getRepairableMissingAssetEntries([transaction], new Set()).map((entry) => entry.assetId), ['old-asset']);
  assert.equal(payload.quantity, 0);
  assert.equal(payload.averageCost, 0);
  assert.equal(payload.currentPrice, 88);
});

test('quantityAfter positive missing asset document is blocked from automatic archive repair', () => {
  const transaction = makeTransaction({
    assetId: 'still-held',
    assetName: 'Still Held',
    symbol: 'HOLD',
    price: 77,
    quantityAfter: 3,
  });
  const plan = buildTransactionAssetPriceUpdatePlan([transaction], []);

  assert.equal(plan.targetHoldings.length, 0);
  assert.equal(plan.diagnostics.repairableMissingAssetCount, 0);
  assert.equal(plan.diagnostics.blockedMissingAssetCount, 1);
  assert.equal(plan.diagnostics.blockedMissingAssets[0]?.reason, 'assets 文件不存在，但交易顯示仍有持倉');
  assert.deepEqual(getRepairableMissingAssetEntries([transaction], new Set()), []);
});

test('missing asset without assetId or complete data is diagnosed separately', () => {
  const plan = buildTransactionAssetPriceUpdatePlan(
    [
      makeTransaction({ assetId: '', symbol: 'NOID', quantityAfter: 0 }),
      makeTransaction({ assetId: 'incomplete', symbol: '', assetName: '', quantityAfter: 0 }),
    ],
    [],
  );

  assert.equal(plan.diagnostics.unmatchedAssetCount, 2);
  assert.ok(plan.diagnostics.unmatchedAssets.some((asset) => asset.reason === 'assetId 缺失'));
  assert.ok(plan.diagnostics.unmatchedAssets.some((asset) => asset.reason === '資料不完整'));
});

test('update button can be enabled when every missing asset has no target holding but can be repaired', () => {
  const transaction = makeTransaction({
    assetId: 'repair-only',
    assetName: 'Repair Only',
    symbol: 'FIX',
    quantityAfter: 0,
  });
  const plan = buildTransactionAssetPriceUpdatePlan([transaction], []);
  const canRunUpdate =
    plan.targetHoldings.length > 0 ||
    plan.diagnostics.repairableMissingAssetCount > 0;

  assert.equal(plan.targetHoldings.length, 0);
  assert.equal(plan.diagnostics.repairableMissingAssetCount, 1);
  assert.equal(canRunUpdate, true);
});

test('repaired archived holding stays out of active holdings and total value', () => {
  const active = makeHolding({ id: 'active', quantity: 2, currentPrice: 100, marketValue: 200 });
  const repaired = makeHolding({
    id: 'repaired',
    quantity: 0,
    currentPrice: 88,
    marketValue: 0,
    archivedAt: '2026-01-10T00:00:00.000Z',
  });
  const activeHoldings = [active, repaired].filter(
    (holding) => !holding.archivedAt && holding.assetType !== 'cash' && holding.quantity > 0,
  );

  assert.deepEqual(activeHoldings.map((holding) => holding.id), ['active']);
  assert.equal(activeHoldings.reduce((sum, holding) => sum + holding.marketValue, 0), 200);
});

test('repaired archived holding lets transaction page use the latest repaired price', () => {
  const transaction = makeTransaction({
    assetId: 'repaired',
    quantity: 1,
    price: 60,
    fees: 0,
    quantityAfter: 0,
  });
  const repairedHolding = makeHolding({
    id: 'repaired',
    quantity: 0,
    currentPrice: 88,
    archivedAt: '2026-01-10T00:00:00.000Z',
  });
  const plan = buildTransactionAssetPriceUpdatePlan([transaction], [repairedHolding]);
  const comparison = getTransactionPriceComparison(transaction, plan.targetHoldings[0], 'USD');

  assert.equal(plan.targetHoldings[0]?.id, 'repaired');
  assert.equal(comparison?.currentPrice, 88);
  assert.equal(comparison?.currentValueDisplay, 88);
});

test('transaction price comparison uses updated current price for buy and sell records', () => {
  const holding = makeHolding({ currentPrice: 150 });
  const buyComparison = getTransactionPriceComparison(
    makeTransaction({ transactionType: 'buy', quantity: 2, price: 100, fees: 1 }),
    holding,
    'USD',
  );
  const sellComparison = getTransactionPriceComparison(
    makeTransaction({ transactionType: 'sell', quantity: 2, price: 140, fees: 1 }),
    holding,
    'USD',
  );

  assert.equal(buyComparison?.currentPrice, 150);
  assert.equal(buyComparison?.currentValueDisplay, 300);
  assert.equal(buyComparison?.comparisonDisplay, 99);
  assert.equal(sellComparison?.currentPrice, 150);
  assert.equal(sellComparison?.currentValueDisplay, 300);
  assert.equal(sellComparison?.comparisonDisplay, -21);
});
