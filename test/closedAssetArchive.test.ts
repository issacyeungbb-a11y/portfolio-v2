import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClosedAssetArchiveEntries } from '../src/lib/portfolio/closedAssetArchive.ts';
import type { AssetTransactionEntry, Holding } from '../src/types/portfolio.ts';

function makeSell(overrides: Partial<AssetTransactionEntry> = {}): AssetTransactionEntry {
  return {
    id: 'sell-meituan',
    assetId: 'meituan-futu',
    assetName: '美團',
    symbol: '3690.HK',
    assetType: 'stock',
    accountSource: 'Futu',
    transactionType: 'sell',
    quantity: 100,
    price: 120,
    fees: 30,
    currency: 'HKD',
    date: '2026-08-06',
    realizedPnlHKD: 1000,
    recordType: 'trade',
    quantityAfter: 100,
    ...overrides,
  };
}

function makeHolding(overrides: Partial<Holding> = {}): Holding {
  return {
    id: 'meituan-futu',
    name: '美團',
    symbol: '3690.HK',
    assetType: 'stock',
    accountSource: 'Futu',
    currency: 'HKD',
    quantity: 0,
    averageCost: 0,
    currentPrice: 120,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    allocation: 0,
    archivedAt: '2026-08-06T10:00:00.000Z',
    ...overrides,
  };
}

test('includes an archived holding even when the latest transaction has a stale positive balance', () => {
  const entries = buildClosedAssetArchiveEntries([makeSell()], [makeHolding()]);

  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.assetName, '美團');
});

test('does not include an active holding when transaction balance is stale at zero', () => {
  const entries = buildClosedAssetArchiveEntries(
    [makeSell({ quantityAfter: 0 })],
    [makeHolding({ quantity: 100, archivedAt: undefined })],
  );

  assert.equal(entries.length, 0);
});

test('falls back to transaction balance when the holding document is unavailable', () => {
  const entries = buildClosedAssetArchiveEntries([makeSell({ quantityAfter: 0 })]);

  assert.equal(entries.length, 1);
});
