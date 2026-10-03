import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate, monthlyMetrics, parseCryptoSheet, validateState, valueCrypto } from './cryptoManagementCore.js';
import { buildAccountPrincipalOverview } from '../src/lib/portfolio/overviewSelectors.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement.ts';

function fixture(): CryptoManagementState {
  return { version: 1, migratedAt: '', sourceChecksum: '', coins: [
    { symbol: 'BTC', name: 'Bitcoin', priceSource: 'coingecko', priceSourceId: 'bitcoin', manualPriceUsd: null, manualPriceAt: null },
    { symbol: 'USDT', name: 'Tether', priceSource: 'coingecko', priceSourceId: 'tether', manualPriceUsd: null, manualPriceAt: null },
    { symbol: 'PHOTON', name: 'Photon', priceSource: 'manual', priceSourceId: '', manualPriceUsd: null, manualPriceAt: null },
  ], positions: [
    { id: 'one', symbol: 'BTC', custodian: 'Wallet', quantity: .4, status: '可用', network: '', collateralSymbol: '' },
    { id: 'two', symbol: 'BTC', custodian: 'Lender', quantity: .6, status: '鎖定（抵押）', network: '', collateralSymbol: '' },
    { id: 'three', symbol: 'PHOTON', custodian: 'Wallet', quantity: 8, status: '可用', network: '', collateralSymbol: '' },
  ], liabilities: [{ id: 'debt', symbol: 'USDT', custodian: 'Lender', quantity: 20, status: '借貸負債', network: '', collateralSymbol: 'BTC' }], funding: [
    { id: 'deposit', date: '2026-01-01', source: '入金', type: 'deposit', hkd: 780, usd: 100 },
    { id: 'withdraw', date: '2026-02-01', source: '消費', type: 'withdrawal', hkd: 78, usd: 10 },
  ] };
}
test('cross-platform and collateral holdings count once, debt and withdrawals stay distinct', () => {
  const state = fixture(); const at = new Date().toISOString();
  const result = valueCrypto(state, { BTC: { price: 100, at }, USDT: { price: 1, at } });
  assert.equal(result.quantities.BTC, 1); assert.equal(result.grossUsd, 100); assert.equal(result.debtUsd, 20);
  assert.equal(result.netUsd, 80); assert.equal(result.principalHkd, 780); assert.equal(result.withdrawnUsd, 10);
  assert.deepEqual(result.warnings, ['PHOTON 價格待補或已過期']);
});
test('missing manual price must not use a coincidentally matching market ticker', () => {
  const state = fixture(); const result = valueCrypto(state, { PHOTON: { price: 99, at: new Date().toISOString() } });
  assert.equal(result.prices.PHOTON, null); assert.equal(result.grossUsd, 0);
});
test('stale, future and invalid quotes block formal closing; zero balance coins need no price', () => {
  const state = fixture(); const now = Date.parse('2026-10-01T00:00:00Z');
  assert.equal(valueCrypto(state, { BTC: { price: 100, at: '2026-09-20T00:00:00Z' } }, now).prices.BTC, null);
  assert.equal(valueCrypto(state, { BTC: { price: 100, at: '2026-10-02T00:00:00Z' } }, now).prices.BTC, null);
  state.positions = []; state.liabilities = [];
  assert.deepEqual(valueCrypto(state, {}, now).warnings, []);
});
test('malformed dates, negative quantities, unknown coins and duplicated IDs rejected', () => {
  let state = fixture(); state.positions[0].quantity = -1; assert.throws(() => validateState(state));
  state = fixture(); state.positions[0].symbol = 'UNKNOWN'; assert.throws(() => validateState(state));
  state = fixture(); state.funding[0].date = '2026-02-31'; assert.throws(() => validateState(state));
  state = fixture(); state.liabilities[0].id = 'one'; assert.throws(() => validateState(state));
});
test('source schema drift stops migration; precision retained', () => {
  assert.throws(() => parseCryptoSheet([]));
  assert.equal(aggregate([{ id: 'tiny', symbol: 'BTC', custodian: 'Wallet', quantity: 0.000000013, status: '可用', network: '', collateralSymbol: '' }]).BTC, .000000013);
});
test('monthly close uses actual net assets without re-adding withdrawals and refuses incomplete valuation', () => {
  const state = fixture(); state.positions = state.positions.filter(p => p.symbol !== 'PHOTON');
  const at = new Date().toISOString(); const valuation = valueCrypto(state, { BTC: { price: 100, at }, USDT: { price: 1, at } });
  const metrics = monthlyMetrics(valuation, 7.8, 80);
  assert.equal(metrics.performanceTotalUsd, 80); assert.equal(metrics.totalHkd, 624); assert.equal(metrics.monthOverMonthPct, 0);
  assert.equal(metrics.cumulativeWithdrawnUsd, 10);
  assert.throws(() => monthlyMetrics({ ...valuation, warnings: ['缺價'] }, 7.8, 80));
});
test('canonical Crypto principal is already cumulative; other account cash flows continue normally', () => {
  const overview = buildAccountPrincipalOverview([{ accountSource: 'Crypto', currency: 'HKD', principalAmount: 1200.25, managedCrypto: true }, { accountSource: 'Futu', currency: 'HKD', principalAmount: 1000 }], [{ id: 'old', accountSource: 'Crypto', currency: 'HKD', amount: 10000, date: '2026-06-05', type: 'deposit' }, { id: 'futu', accountSource: 'Futu', currency: 'HKD', amount: 100, date: '2026-06-05', type: 'deposit' }], '2026-10-03');
  assert.equal(overview.accountSummaries.find(a => a.accountSource === 'Crypto')?.totalPrincipalHKD, 1200.25);
  assert.equal(overview.accountSummaries.find(a => a.accountSource === 'Futu')?.totalPrincipalHKD, 1100);
});
