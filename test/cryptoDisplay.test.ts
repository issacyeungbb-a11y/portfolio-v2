import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cryptoCoinValues, cryptoDisplayAmount, cryptoPositionValue, formatCryptoMoney } from '../src/lib/cryptoDisplay.ts';
import { valueCrypto } from '../server/cryptoManagementCore.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement.ts';

const now = Date.parse('2026-10-04T02:00:00Z');
const state: CryptoManagementState = {
  version: 1, migratedAt: '', sourceChecksum: '', funding: [], liabilities: [],
  coins: ['ETH', 'USDT'].map(symbol => ({ symbol, name: symbol, priceSource: 'coingecko', priceSourceId: symbol.toLowerCase(), manualPriceUsd: 999, manualPriceAt: new Date(now).toISOString() })),
  positions: [
    { id: 'stake', symbol: 'ETH', custodian: 'Wallet', quantity: 2, status: '鎖定(質押)', network: '', collateralSymbol: '' },
    { id: 'reward', symbol: 'ETH', custodian: 'Wallet', quantity: .1, status: '質押所賺', network: '', collateralSymbol: '', stakingPositionId: 'stake' },
    { id: 'other', symbol: 'ETH', custodian: 'Ledger', quantity: .4, status: '可用', network: '', collateralSymbol: '' },
    { id: 'cash', symbol: 'USDT', custodian: 'Exchange', quantity: 500, status: '可用', network: '', collateralSymbol: '' },
  ],
};
test('display uses daily asset prices and counts principal and reward once in coin allocation', () => {
  const v = valueCrypto(state, { ETH: { price: 1000, at: new Date(now).toISOString() }, USDT: { price: 1, at: new Date(now).toISOString() } }, now);
  const copy = structuredClone(state);
  const display = cryptoCoinValues(state, v);
  assert.equal(display.complete, true); assert.equal(display.totalUsd, 3000);
  assert.equal(display.coins[0].priceUsd, 1000); assert.equal(display.coins[0].valueUsd, 2500);
  assert.equal(display.coins[0].allocation, 2500 / 3000);
  assert.equal(display.coins[1].allocation, 500 / 3000);
  assert.deepEqual(state, copy);
});
test('missing or expired prices do not become zero-valued positive holdings or inflate allocations', () => {
  const v = valueCrypto(state, { ETH: { price: 1000, at: new Date(now).toISOString() } }, now);
  const display = cryptoCoinValues(state, v);
  assert.equal(display.complete, false); assert.equal(display.totalUsd, 2500);
  assert.equal(display.coins[1].valueUsd, null);
  assert.ok(display.coins.every(c => c.allocation === null));
  assert.equal(cryptoPositionValue(0, null), 0);
  assert.equal(cryptoPositionValue(.1, null), null);
});
test('HKD conversion uses persisted rate without inventing a missing rate and leaves USD usable', () => {
  assert.equal(cryptoDisplayAmount(100, 'HKD', 7.81), 781);
  assert.equal(cryptoDisplayAmount(.1, 'HKD', 7.81), .781);
  assert.equal(cryptoDisplayAmount(100, 'HKD', null), null);
  assert.equal(cryptoDisplayAmount(100, 'HKD', 0), null);
  assert.equal(cryptoDisplayAmount(100, 'USD', null), 100);
  assert.equal(cryptoDisplayAmount(null, 'USD', 7.81), null);
});
test('small coin prices stay visible and switching currency does not change allocation', () => {
  assert.ok(formatCryptoMoney(.0000000345, 'USD', true).includes('0.0000000345'));
  const v = valueCrypto(state, { ETH: { price: 1000, at: new Date(now).toISOString() }, USDT: { price: 1, at: new Date(now).toISOString() } }, now);
  const display = cryptoCoinValues(state, v);
  const hkdValues = display.coins.map(c => cryptoDisplayAmount(c.valueUsd, 'HKD', 7.81)!);
  assert.equal(hkdValues[0] / hkdValues.reduce((a, b) => a + b, 0), display.coins[0].allocation);
});
