import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planCryptoFundingChanges } from '../src/lib/cryptoFunding.ts';
import { validateState, principal } from '../server/cryptoManagementCore.js';
import { commitCryptoManagementSave } from '../server/cryptoManagementSave.js';
import { CryptoMovementConflict } from '../server/cryptoMovementStore.js';
import type { CryptoFunding, CryptoManagementState, CryptoMovementEntry } from '../src/types/cryptoManagement.ts';

const now = new Date('2026-11-13T04:00:00Z');
function fixture(): CryptoManagementState {
  return {
    version: 4, migratedAt: 'original', sourceChecksum: 'original', platforms: ['Exchange', 'Wallet'],
    coins: ['USDT', 'BTC'].map(symbol => ({ symbol, name: symbol, priceSource: 'manual', priceSourceId: '', manualPriceUsd: 1, manualPriceAt: now.toISOString() })),
    positions: [
      { id: 'usdt', symbol: 'USDT', custodian: 'Exchange', quantity: 1000, status: '可用', network: '', collateralSymbol: '' },
      { id: 'wallet', symbol: 'USDT', custodian: 'Wallet', quantity: 50, status: '可用', network: '', collateralSymbol: '' },
      { id: 'locked', symbol: 'BTC', custodian: 'Wallet', quantity: 2, status: '鎖定(質押)', network: '', collateralSymbol: '' },
    ], liabilities: [], funding: [],
  };
}
const funding = (overrides: Partial<CryptoFunding> = {}): CryptoFunding => ({ id: 'new_funding', date: '2026-11-13', type: 'deposit', source: '銀行轉帳', hkd: 780, usd: 100, positionId: 'usdt', quantity: 99, ...overrides });
function plan(previous: CryptoManagementState, rows: CryptoFunding[]) {
  return planCryptoFundingChanges(previous, { ...structuredClone(previous), version: previous.version + 1, funding: rows }, '核對資金去向', now);
}

test('deposit applies actual received quantity once, independent of the fiat principal', () => {
  const previous = fixture(); const result = plan(previous, [funding()]);
  assert.equal(result.state.positions[0].quantity, 1099);
  assert.equal(principal(result.state.funding), 780);
  assert.equal(result.entries[0].type, 'transfer_in');
  assert.equal(result.entries[0].fundingId, 'new_funding');
  assert.deepEqual(result.entries[0].legs.map(l => [l.before, l.delta, l.after]), [[1000, 99, 1099]]);
  assert.equal(previous.positions[0].quantity, 1000);
  assert.doesNotThrow(() => validateState(result.state));
  assert.equal(plan(result.state, result.state.funding).entries.length, 0);
});
test('withdrawal debits available quantity, adds withdrawn cash, and does not increase principal', () => {
  const result = plan(fixture(), [funding({ type: 'withdrawal', quantity: 20 })]);
  assert.equal(result.state.positions[0].quantity, 980); assert.equal(principal(result.state.funding), 0);
  assert.equal(result.entries[0].type, 'transfer_out');
  assert.throws(() => plan(fixture(), [funding({ type: 'withdrawal', quantity: 1001 })]), /不足/);
});
test('edits apply only the difference, support changed destinations and retain the historical ledger', () => {
  const first = plan(fixture(), [funding()]);
  const edited = plan(first.state, [funding({ quantity: 100 })]);
  assert.equal(edited.state.positions[0].quantity, 1100); assert.equal(edited.entries[0].quantity, 1);
  const moved = plan(edited.state, [funding({ quantity: 100, positionId: 'wallet' })]);
  assert.equal(moved.state.positions[0].quantity, 1000); assert.equal(moved.state.positions[1].quantity, 150);
  assert.deepEqual(moved.entries.map(e => e.type), ['transfer_out', 'transfer_in']);
  assert.equal(plan(moved.state, [funding({ quantity: 100, positionId: 'wallet', source: '更正說明' })]).entries.length, 0);
  const deleted = plan(moved.state, []);
  assert.deepEqual(deleted.state.positions, fixture().positions); assert.match(deleted.entries[0].note, /移除/);
});
test('spent deposits allow metadata edits and net increases but reject unfunded reversals', () => {
  const first = plan(fixture(), [funding()]).state;
  first.positions[0].quantity = 0;
  assert.equal(plan(first, [funding({ source: '更新備註' })]).entries.length, 0);
  assert.equal(plan(first, [funding({ quantity: 100 })]).state.positions[0].quantity, 1);
  assert.throws(() => plan(first, []), /不足/);
  assert.throws(() => plan(first, [funding({ positionId: 'wallet' })]), /不足/);
});
test('removing a withdrawal restores liquidity and changing deposit to withdrawal applies both effects', () => {
  const first = plan(fixture(), [funding({ type: 'withdrawal' })]).state;
  assert.equal(plan(first, []).state.positions[0].quantity, 1000);
  const deposit = plan(fixture(), [funding()]).state;
  assert.equal(plan(deposit, [funding({ type: 'withdrawal' })]).state.positions[0].quantity, 901);
});
test('new destination creates an available balance or merges the exact platform, coin and network', () => {
  const row = funding({ positionId: undefined, destination: { custodian: 'New Wallet', symbol: 'USDT', network: 'Ethereum' } });
  const first = plan(fixture(), [row]); const target = first.state.positions.at(-1)!;
  assert.equal(target.quantity, 99); assert.equal(target.status, '可用'); assert.equal(target.network, 'Ethereum');
  assert.equal(first.state.funding[0].positionId, target.id); assert.equal(first.state.funding[0].destination, undefined);
  assert.ok(first.state.platforms?.includes('New Wallet')); assert.doesNotThrow(() => validateState(first.state));
  const second = plan(first.state, [...first.state.funding, { ...row, id: 'another_funding' }]);
  assert.equal(second.state.positions.length, first.state.positions.length); assert.equal(second.state.positions.at(-1)?.quantity, 198);
  assert.throws(() => plan(fixture(), [{ ...row, type: 'withdrawal' }]), /已有/);
});
test('legacy funding is never replayed; metadata edits and removal preserve existing holdings', () => {
  const previous = fixture(); const row = funding({ id: 'funding_1', positionId: undefined, quantity: undefined }); previous.funding = [row];
  const edited = plan(previous, [{ ...row, source: '歷史說明更正' }]);
  assert.deepEqual(edited.state.positions, previous.positions); assert.equal(edited.entries.length, 0);
  assert.equal(plan(previous, []).entries.length, 0);
  assert.throws(() => plan(previous, [{ ...row, usd: 200 }]), /必須選擇/);
  assert.equal(plan(previous, [{ ...row, positionId: 'usdt', quantity: 99 }]).state.positions[0].quantity, 1099);
});
test('principal-only adjustments do not create liquidity or movement entries', () => {
  const result = plan(fixture(), [funding({ type: 'adjustment', positionId: undefined, quantity: undefined })]);
  assert.deepEqual(result.state.positions, fixture().positions); assert.equal(result.entries.length, 0);
  assert.throws(() => plan(fixture(), [funding({ type: 'adjustment' })]), /本金調整/);
});
test('invalid or incomplete destinations, amounts, dates and locked balances fail before persistence', () => {
  for (const overrides of [{ positionId: '' }, { positionId: 'missing' }, { positionId: 'locked' }, { quantity: 0 }, { quantity: -1 }, { quantity: NaN }, { quantity: Infinity }, { quantity: 1e16 }, { hkd: 0 }, { usd: 0 }, { date: '2026-02-31' }, { date: '2026-11-14' }]) {
    assert.throws(() => plan(fixture(), [funding(overrides)]));
  }
  for (const overrides of [{ quantity: undefined }, { positionId: undefined }, { type: 'adjustment' as const }]) {
    assert.throws(() => validateState({ ...fixture(), funding: [funding(overrides)] }));
  }
});
test('decimal differences and full withdrawals do not leave rounding residue', () => {
  const previous = fixture(); previous.positions[0].quantity = .1;
  const first = plan(previous, [funding({ quantity: .2 })]).state;
  assert.equal(first.positions[0].quantity, .3);
  const second = plan(first, [...first.funding, funding({ id: 'withdrawal', type: 'withdrawal', quantity: .3 })]).state;
  assert.equal(second.positions[0].quantity, 0);
});

function fakeStore() {
  const doc = (path: string): any => ({ path, collection: (name: string) => ({ path: `${path}/${name}`, doc: (id: string) => doc(`${path}/${name}/${id}`) }) });
  const ref = doc('portfolio');
  const db = new Map<string, any>([['portfolio/cryptoManagement/current', fixture()], ['locked-month', { locked: true, totalHkd: 100 }]]);
  async function run(payload: Record<string, unknown>, failSync = false) {
    const writes = new Map<string, any>(); const deletes = new Set<string>(); let started = false;
    const tx = {
      get: async (r: any) => { assert.equal(started, false, 'all reads precede writes'); return r.path === 'portfolio/assets' ? { docs: [] } : { exists: db.has(r.path), data: () => structuredClone(db.get(r.path)) }; },
      set: (r: any, value: any) => { started = true; writes.set(r.path, value); },
      create: (r: any, value: any) => { assert.equal(db.has(r.path), false); started = true; writes.set(r.path, value); },
      delete: (r: any) => { started = true; deletes.add(r.path); },
    };
    await commitCryptoManagementSave(tx as any, ref, payload, next => {
      tx.set(doc('synced-assets'), next.positions.map(p => ({ id: p.id, quantity: p.quantity })));
      if (failSync) throw new Error('sync failed');
    }, now);
    writes.forEach((value, key) => db.set(key, value)); deletes.forEach(key => db.delete(key));
  }
  const save = (state: CryptoManagementState, operationId = 'operation_123') => ({ action: 'save', state, operationId, expectedVersion: state.version, reason: '核對資金去向' });
  return { db, run, save, state: () => structuredClone(db.get('portfolio/cryptoManagement/current')) as CryptoManagementState };
}
test('one transaction writes positions, assets, cash flow, ledger and opening; retries do not duplicate', async () => {
  const store = fakeStore(); const next = store.state(); next.funding.push(funding()); const payload = store.save(next);
  await store.run(payload);
  assert.equal(store.state().positions[0].quantity, 1099); assert.equal(store.state().version, 5);
  assert.equal(store.db.get('portfolio/accountCashFlows/crypto_funding_new_funding').amount, 780);
  assert.equal(store.db.get('synced-assets')[0].quantity, 1099);
  assert.deepEqual(store.db.get('portfolio/cryptoMovementOpening/current').positions, fixture().positions);
  const size = store.db.size; await store.run(payload); assert.equal(store.db.size, size); assert.equal(store.state().version, 5);
  await assert.rejects(store.run({ ...payload, reason: '另一筆操作' }), CryptoMovementConflict);
  assert.deepEqual(store.db.get('locked-month'), { locked: true, totalHkd: 100 });
  const edited = store.state(); edited.funding[0].quantity = 100; await store.run(store.save(edited, 'operation_456'));
  assert.equal(store.state().positions[0].quantity, 1100);
  const entries = [...store.db.entries()].filter(([key]) => key.startsWith('portfolio/cryptoMovements/')).map(([, entry]) => entry as CryptoMovementEntry);
  assert.deepEqual(entries.map(e => e.quantity), [99, 1]);
  const removed = store.state(); removed.funding = []; await store.run(store.save(removed, 'operation_789'));
  assert.equal(store.state().positions[0].quantity, 1000);
  assert.equal(store.db.has('portfolio/accountCashFlows/crypto_funding_new_funding'), false);
});
test('stale versions, forged position edits, invalid balances and failed sync leave every document intact', async () => {
  const store = fakeStore(); const before = [...store.db.entries()]; const next = store.state(); next.funding.push(funding());
  await assert.rejects(store.run({ ...store.save(next), expectedVersion: 3 }), CryptoMovementConflict);
  await assert.rejects(store.run(store.save(next), true), /sync failed/);
  next.positions[0].quantity += 100;
  await assert.rejects(store.run(store.save(next)), /變動記錄/);
  next.positions[0].quantity -= 100; next.funding[0] = funding({ type: 'withdrawal', quantity: 2000 });
  await assert.rejects(store.run(store.save(next)), /不足/);
  assert.deepEqual([...store.db.entries()], before);
});
