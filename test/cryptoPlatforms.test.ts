import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cryptoPlatforms, filterCryptoPositions, saveCryptoPlatform } from '../src/lib/cryptoPlatforms.ts';
import { validateState, valueCrypto } from '../server/cryptoManagementCore.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement.ts';

function fixture(): CryptoManagementState {
  return { version: 4, migratedAt: '', sourceChecksum: '', coins: [
    { symbol: 'BTC', name: 'Bitcoin', priceSource: 'coingecko', priceSourceId: 'bitcoin', manualPriceUsd: null, manualPriceAt: null },
    { symbol: 'USDT', name: 'Tether', priceSource: 'coingecko', priceSourceId: 'tether', manualPriceUsd: null, manualPriceAt: null },
  ], positions: [
    { id: 'btc_wallet', symbol: 'BTC', custodian: 'Wallet', quantity: .4, status: '可用', network: 'Bitcoin', collateralSymbol: '' },
    { id: 'btc_lender', symbol: 'BTC', custodian: 'Lender', quantity: .6, status: '抵押', network: '', collateralSymbol: '' },
    { id: 'usdt_wallet', symbol: 'USDT', custodian: 'Wallet', quantity: 100, status: '可用', network: '', collateralSymbol: '' },
  ], liabilities: [{ id: 'debt', symbol: 'USDT', custodian: 'Lender', quantity: 20, status: '借貸', network: '', collateralSymbol: 'BTC' }], funding: [] };
}

test('legacy platforms are recovered from holdings and debts; empty new platforms persist', () => {
  const state = fixture();
  state.liabilities[0].custodian = 'Debt only';
  const next = saveCryptoPlatform(state, '  New wallet  ');
  validateState(next);
  assert.deepEqual(cryptoPlatforms(next), ['Debt only', 'Lender', 'New wallet', 'Wallet']);
  assert.deepEqual(next.positions, state.positions);
  assert.equal(state.platforms, undefined);
  assert.ok(cryptoPlatforms(JSON.parse(JSON.stringify(next))).includes('New wallet'));
});

test('renaming a platform updates holdings and debts without changing valuation or collateral', () => {
  const state = fixture(); const at = new Date().toISOString();
  const quotes = { BTC: { price: 100, at }, USDT: { price: 1, at } };
  const next = saveCryptoPlatform(state, 'New lender', 'Lender');
  validateState(next);
  assert.equal(next.positions[1].custodian, 'New lender');
  assert.equal(next.liabilities[0].custodian, 'New lender');
  assert.equal(next.liabilities[0].collateralSymbol, 'BTC');
  assert.deepEqual(valueCrypto(next, quotes), valueCrypto(state, quotes));
  assert.equal(state.positions[1].custodian, 'Lender');
  assert.ok(!cryptoPlatforms(next).includes('Lender'));
});

test('platforms reject duplicates, invalid names and missing rename targets', () => {
  const state = fixture();
  assert.throws(() => saveCryptoPlatform(state, ' Wallet '));
  assert.throws(() => saveCryptoPlatform(state, 'Wallet', 'Lender'));
  assert.throws(() => saveCryptoPlatform(state, ''));
  assert.throws(() => saveCryptoPlatform(state, 'a'.repeat(161)));
  assert.throws(() => saveCryptoPlatform(state, 'New', 'Missing'));
  assert.doesNotThrow(() => validateState(saveCryptoPlatform(state, 'Wallet', 'Wallet')));
  for (const platforms of [['A', ' A '], [''], Array.from({ length: 101 }, (_, i) => `P${i}`)]) {
    assert.throws(() => validateState({ ...fixture(), platforms }));
  }
  assert.throws(() => validateState({ ...fixture(), platforms: 'Wallet' } as unknown as CryptoManagementState));
});

test('platform and coin filters select matching holdings, support search and keep the source intact', () => {
  const state = fixture(); const before = structuredClone(state);
  assert.deepEqual(filterCryptoPositions(state.positions, 'platform', 'Wallet', '').map(r => r.id), ['btc_wallet', 'usdt_wallet']);
  assert.deepEqual(filterCryptoPositions(state.positions, 'coin', 'BTC', '').map(r => r.id), ['btc_wallet', 'btc_lender']);
  assert.deepEqual(filterCryptoPositions(state.positions, 'coin', 'BTC', ' lender ').map(r => r.id), ['btc_lender']);
  assert.deepEqual(filterCryptoPositions(state.positions, 'platform', 'Wallet', 'bitcoin').map(r => r.id), ['btc_wallet']);
  assert.equal(filterCryptoPositions(state.positions, 'platform', '', '').length, 3);
  assert.equal(filterCryptoPositions(state.positions, 'coin', 'BTC', 'missing').length, 0);
  assert.deepEqual(state, before);
});
