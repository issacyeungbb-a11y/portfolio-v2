import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyAccountValuationOverride,
  normalizeAccountValuationOverride,
} from '../src/lib/portfolio/accountValuationOverride.js';
import {
  aggregateHoldingsForAllocation,
  getHoldingValueInCurrency,
} from '../src/lib/holdings.js';

const override = {
  accountSource: 'Crypto',
  active: true,
  month: '2026-08',
  targetTotalUsd: 57286.385876818,
  targetTotalHkd: 440664.50674431317,
  usdHkdRate: 7.6923076923,
  sourceSnapshotId: 'monthly-2026-08',
  sourceChecksum: 'source-checksum',
  shadowChecksum: 'shadow-checksum',
  applicationMode: 'proportional_account_overlay',
};

test('applies one Crypto account total while preserving quantities and excluding Futu', () => {
  const assets = [
    {
      id: 'crypto-btc',
      accountSource: 'Crypto',
      assetType: 'crypto',
      currency: 'USD',
      quantity: 0.5,
      currentPrice: 60000,
    },
    {
      id: 'crypto-cash',
      accountSource: 'Crypto',
      assetType: 'cash',
      currency: 'USD',
      quantity: 1,
      currentPrice: 1000,
    },
    {
      id: 'futu-btc',
      accountSource: 'Futu',
      assetType: 'crypto',
      currency: 'USD',
      quantity: 1,
      currentPrice: 20000,
    },
  ];

  const result = applyAccountValuationOverride(assets, override);
  const cryptoTotal = result.assets
    .filter((asset) => asset.accountSource === 'Crypto')
    .reduce(
      (sum, asset) =>
        sum + (asset.assetType === 'cash' ? asset.currentPrice : asset.quantity * asset.currentPrice),
      0,
    );

  assert.equal(result.applied, true);
  assert.equal(result.assetCount, 2);
  assert.ok(Math.abs(cryptoTotal - override.targetTotalUsd) < 0.000001);
  assert.equal(result.assets[0].quantity, assets[0].quantity);
  assert.equal(result.assets[1].quantity, assets[1].quantity);
  assert.equal(result.assets[2].currentPrice, assets[2].currentPrice);
  assert.equal(result.assets[2].quantity, assets[2].quantity);
  assert.equal(result.assets[0].valuationUsdHkdRate, override.usdHkdRate);
  assert.equal(result.assets[0].valuationOverrideMonth, override.month);
});

test('rejects invalid or internally inconsistent valuation overrides', () => {
  assert.equal(normalizeAccountValuationOverride(override), override);
  assert.equal(normalizeAccountValuationOverride({ ...override, active: false }), null);
  assert.equal(normalizeAccountValuationOverride({ ...override, targetTotalHkd: 1 }), null);
});

test('does not change any asset when no override is active', () => {
  const assets = [{
    id: 'crypto-btc',
    accountSource: 'Crypto',
    assetType: 'crypto',
    currency: 'USD',
    quantity: 1,
    currentPrice: 100,
  }];
  const result = applyAccountValuationOverride(assets, null);

  assert.equal(result.applied, false);
  assert.equal(result.assets, assets);
});

test('uses the locked monthly FX rate for Crypto without applying it to Futu', () => {
  const crypto = {
    id: 'crypto-btc', name: 'Bitcoin', symbol: 'BTC', assetType: 'crypto',
    accountSource: 'Crypto', currency: 'USD', quantity: 1, averageCost: 10,
    currentPrice: 100, marketValue: 100, unrealizedPnl: 90, unrealizedPct: 900,
    allocation: 0, valuationOverrideMonth: '2026-08', valuationUsdHkdRate: 7.6923076923,
  };
  const futu = {
    ...crypto,
    id: 'futu-btc', accountSource: 'Futu', currentPrice: 50, marketValue: 50,
    unrealizedPnl: 40, unrealizedPct: 400, valuationOverrideMonth: undefined,
    valuationUsdHkdRate: undefined,
  };

  assert.ok(Math.abs(getHoldingValueInCurrency(crypto, 'HKD') - 769.23076923) < 0.000001);
  assert.equal(getHoldingValueInCurrency(futu, 'HKD'), 390);

  const [aggregate] = aggregateHoldingsForAllocation([crypto, futu]);
  assert.equal(aggregate.currency, 'HKD');
  assert.ok(Math.abs(aggregate.marketValue - 1159.23076923) < 0.000001);
  assert.equal(aggregate.valuationUsdHkdRate, undefined);
});
