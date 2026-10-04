import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cryptoAssetStatuses, cryptoAssetStatus, normalizeCryptoPlatform, normalizeCryptoState, summarizeCryptoCoins } from '../src/lib/cryptoClassification.ts';
import { cryptoPlatforms, saveCryptoPlatform } from '../src/lib/cryptoPlatforms.ts';
import { assertRecordedPositions } from '../server/cryptoMovementStore.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement.ts';
const fixture = (): CryptoManagementState => ({
  version: 8, migratedAt: '', sourceChecksum: '', platforms: ['CoolWallet', 'CoolWallet（賺幣）'],
  coins: ['BTC', 'USDT'].map(symbol => ({ symbol, name: symbol, priceSource: 'manual', priceSourceId: '', manualPriceUsd: 1, manualPriceAt: null })),
  positions: [
    { id: 'available', symbol: 'BTC', custodian: 'CoolWallet', quantity: .1, status: '可用', network: '', collateralSymbol: '' },
    { id: 'staked', symbol: 'BTC', custodian: 'CoolWallet（賺幣）', quantity: .2, status: '質押', network: '', collateralSymbol: '' },
    { id: 'collateral', symbol: 'BTC', custodian: 'Lender', quantity: .3, status: '抵押', network: '', collateralSymbol: '' },
    { id: 'rewards', symbol: 'BTC', custodian: 'CoolWallet', quantity: .01, status: '質押所賺', network: '', collateralSymbol: '' },
  ], liabilities: [{ id: 'debt', symbol: 'USDT', custodian: 'CoolWallet（賺幣）', quantity: 20, status: '借貸', network: '', collateralSymbol: 'BTC' }], funding: [],
});
test('four asset classes retain the distinction between staking principal, collateral and staking earnings', () => {
  assert.deepEqual(cryptoAssetStatuses, ['可用', '鎖定(質押)', '鎖定(抵押)', '質押所賺']);
  assert.equal(cryptoAssetStatus('質押'), '鎖定(質押)');
  assert.equal(cryptoAssetStatus('抵押'), '鎖定(抵押)');
  assert.equal(cryptoAssetStatus('非質押'), '可用');
  assert.equal(cryptoAssetStatus('質押收益'), '質押所賺');
  assert.equal(cryptoAssetStatus('鎖定（質押）'), '鎖定(質押)');
});
test('CoolWallet aliases form one platform while every holding identity, balance and liability is preserved', () => {
  const state = fixture(); const before = structuredClone(state); const normalized = normalizeCryptoState(state);
  assert.equal(normalizeCryptoPlatform(' CoolWallet (賺幣) '), 'CoolWallet');
  assert.deepEqual(cryptoPlatforms(normalized), ['CoolWallet', 'Lender']);
  assert.deepEqual(normalized.positions.map(p => [p.id, p.quantity]), state.positions.map(p => [p.id, p.quantity]));
  assert.equal(normalized.liabilities[0].quantity, 20); assert.equal(normalized.liabilities[0].status, '借貸');
  assert.equal(normalized.liabilities[0].collateralSymbol, 'BTC');
  assert.deepEqual(normalizeCryptoState(normalized), normalized);
  assert.deepEqual(state, before);
  assert.doesNotThrow(() => assertRecordedPositions(state, normalized));
  assert.throws(() => saveCryptoPlatform(normalized, 'CoolWallet（賺幣）'));
});
test('coin quantities aggregate all platforms and four statuses without duplicate alias counts or decimal drift', () => {
  const state = fixture(); const summary = summarizeCryptoCoins(state); const btc = summary[0];
  assert.equal(btc.quantity, .61); assert.equal(btc.platforms, 2);
  assert.deepEqual(btc.byStatus, { '可用': .1, '鎖定(質押)': .2, '鎖定(抵押)': .3, '質押所賺': .01 });
  assert.equal(summary[1].quantity, 0); // liabilities are not silently subtracted from held coin units
  assert.equal(summarizeCryptoCoins(normalizeCryptoState(state))[0].quantity, btc.quantity);
});
