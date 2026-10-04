import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addCryptoQuantity, cryptoMovementLabels, planCryptoMovement, cryptoMovementDefaultDestination, cryptoMovementDefaultNote } from '../src/lib/cryptoMovements.ts';
import { assertRecordedPositions, commitCryptoMovement, CryptoMovementConflict } from '../server/cryptoMovementStore.js';
import { saveCryptoPlatform } from '../src/lib/cryptoPlatforms.ts';
import { validateState } from '../server/cryptoManagementCore.js';
import type { CryptoManagementState, CryptoMovementInput, CryptoPosition } from '../src/types/cryptoManagement.ts';
const TODAY = '2026-10-03';
const row = (id: string, symbol: string, custodian: string, quantity: number, status = '可用'): CryptoPosition => ({ id, symbol, custodian, quantity, status, network: '', collateralSymbol: '' });
function fixture(): CryptoManagementState {
  return { version: 4, migratedAt: '', sourceChecksum: '', platforms: ['Wallet', 'Exchange'], coins: ['BTC', 'USDT'].map(symbol => ({ symbol, name: symbol, priceSource: 'manual', priceSourceId: '', manualPriceUsd: 1, manualPriceAt: '2026-10-03T00:00:00Z' })), positions: [row('btc_wallet', 'BTC', 'Wallet', 2), row('btc_staked', 'BTC', 'Wallet', 3, '鎖定(質押)'), row('btc_exchange', 'BTC', 'Exchange', 1), row('usdt', 'USDT', 'Exchange', 1000)], liabilities: [], funding: [] };
}
const input = (overrides: Partial<CryptoMovementInput> = {}): CryptoMovementInput => ({ type: 'transfer', date: TODAY, symbol: 'BTC', quantity: .2, sourcePositionId: 'btc_wallet', destinationPositionId: 'btc_exchange', note: '實際平台往來', ...overrides });
const plan = (state: CryptoManagementState, movement: CryptoMovementInput) => planCryptoMovement(state, movement, 'new_position', TODAY);

test('only actual trade, transfer and staking types are accepted', () => {
  assert.equal(Object.keys(cryptoMovementLabels).length, 11);
  assert.throws(() => plan(fixture(), input({ type: 'adjustment' } as unknown as Partial<CryptoMovementInput>)));
  assert.throws(() => plan(fixture(), input({ type: '__proto__' } as unknown as Partial<CryptoMovementInput>)));
});
test('internal transfer balances both sides and preserves the input state', () => {
  const state = fixture(); const original = structuredClone(state); const result = plan(state, input());
  assert.deepEqual(result.legs.map(l => [l.before, l.delta, l.after]), [[2, -.2, 1.8], [1, .2, 1.2]]);
  assert.equal(result.legs.reduce((n, l) => n + l.delta, 0), 0);
  assert.deepEqual(state, original); assert.doesNotThrow(() => validateState(result.state));
});
test('staking moves balances; unstaking restores available assets without changing total coins', () => {
  const staked = plan(fixture(), input({ type: 'stake', destinationPositionId: 'btc_staked', quantity: .5 }));
  assert.equal(staked.state.positions[0].quantity, 1.5); assert.equal(staked.state.positions[1].quantity, 3.5);
  const unstaked = plan(staked.state, input({ type: 'unstake', sourcePositionId: 'btc_staked', destinationPositionId: 'btc_wallet', quantity: .5 }));
  assert.deepEqual(unstaked.state.positions, fixture().positions);
  assert.throws(() => plan(fixture(), input({ type: 'transfer', destinationPositionId: 'btc_staked' })));
  assert.throws(() => plan(fixture(), input({ type: 'stake', sourcePositionId: 'btc_staked', destinationPositionId: 'btc_wallet' })));
  assert.throws(() => plan(fixture(), input({ type: 'unstake', sourcePositionId: 'btc_wallet', destinationPositionId: 'btc_exchange' })));
});
test('staking rewards can compound or be paid to available assets, while recording their staking origin', () => {
  for (const destinationPositionId of ['btc_staked', 'btc_wallet']) {
    const result = plan(fixture(), input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId, quantity: .01 }));
    assert.equal(result.legs.length, 1); assert.equal(result.legs[0].delta, .01);
    assert.equal(result.input.sourcePositionId, 'btc_staked'); assert.match(result.sourceLabel, /質押/);
    assert.equal(result.state.positions[1].quantity, destinationPositionId === 'btc_staked' ? 3.01 : 3);
  }
  assert.throws(() => plan(fixture(), input({ type: 'staking_reward' })));
});
test('staking earnings remain separate from locked principal and can transfer to available holdings', () => {
  const earned = plan(fixture(), input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId: '', quantity: .1, destination: { custodian: 'Wallet', status: '質押所賺', network: '' } }));
  assert.equal(earned.state.positions.find(p => p.id === 'btc_staked')?.quantity, 3);
  assert.equal(earned.legs.length, 1); assert.equal(earned.legs[0].status, '質押所賺');
  const released = plan(earned.state, input({ type: 'transfer', sourcePositionId: earned.legs[0].positionId, destinationPositionId: 'btc_wallet', quantity: .1 }));
  assert.equal(released.state.positions[0].quantity, 2.1);
  assert.equal(released.state.positions.find(p => p.status === '質押所賺')?.quantity, 0);
});
test('collateral locking and unlocking conserve quantities and locked collateral cannot be sold or spent', () => {
  const locked = plan(fixture(), input({ type: 'collateral_lock', quantity: .5, destinationPositionId: '', destination: { custodian: 'Wallet', status: '鎖定(抵押)', network: '' } }));
  assert.equal(locked.state.positions[0].quantity, 1.5); assert.equal(locked.legs[1].after, .5);
  assert.deepEqual(locked.state.liabilities, fixture().liabilities);
  const id = locked.legs[1].positionId;
  const unlocked = plan(locked.state, input({ type: 'collateral_unlock', sourcePositionId: id, destinationPositionId: 'btc_wallet', quantity: .5 }));
  assert.equal(unlocked.state.positions[0].quantity, 2);
  assert.throws(() => plan(locked.state, input({ type: 'sell', sourcePositionId: id, unitPrice: 1 })));
  assert.throws(() => plan(locked.state, input({ type: 'stake', sourcePositionId: id, destinationPositionId: 'btc_staked' })));
  assert.throws(() => plan(locked.state, input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId: id })));
  assert.throws(() => plan(locked.state, input({ type: 'buy', symbol: 'USDT', destinationPositionId: 'usdt', unitPrice: 1, quoteCurrency: 'BTC', settlementPositionId: id })));
});
test('trades debit and credit settlement balances including fees', () => {
  const bought = plan(fixture(), input({ type: 'buy', quantity: .1, destinationPositionId: 'btc_exchange', unitPrice: 100, fees: 2, quoteCurrency: 'USDT', settlementPositionId: 'usdt' }));
  assert.equal(bought.totalAmount, 12); assert.equal(bought.state.positions[2].quantity, 1.1); assert.equal(bought.state.positions[3].quantity, 988);
  assert.match(bought.sourceLabel, /Exchange · USDT/);
  const sold = plan(bought.state, input({ type: 'sell', quantity: .1, sourcePositionId: 'btc_exchange', unitPrice: 100, fees: 2, quoteCurrency: 'USDT', settlementPositionId: 'usdt' }));
  assert.equal(sold.totalAmount, 8); assert.equal(sold.state.positions[2].quantity, 1); assert.equal(sold.state.positions[3].quantity, 996);
  assert.match(sold.destinationLabel, /Exchange · USDT/);
  assert.throws(() => plan(fixture(), input({ type: 'sell', sourcePositionId: 'btc_staked', unitPrice: 100 })));
  assert.throws(() => plan(fixture(), input({ type: 'sell', unitPrice: 1, fees: 10 })));
  assert.throws(() => plan(fixture(), input({ type: 'buy', unitPrice: 100, quoteCurrency: 'USDT' })));
  assert.throws(() => plan(fixture(), input({ type: 'buy', quantity: 20, unitPrice: 100, quoteCurrency: 'USDT', settlementPositionId: 'usdt' })));
});
test('external transfers require a counterparty and record exactly one changing balance', () => {
  const inbound = plan(fixture(), input({ type: 'transfer_in', counterparty: 'Hardware wallet', destinationPositionId: '', destination: { custodian: 'New wallet', status: '可用', network: 'Bitcoin' } }));
  assert.equal(inbound.legs.length, 1); assert.equal(inbound.legs[0].before, 0); assert.equal(inbound.legs[0].after, .2);
  assert.ok(inbound.state.platforms?.includes('New wallet'));
  const outbound = plan(fixture(), input({ type: 'transfer_out', counterparty: 'Hardware wallet' }));
  assert.equal(outbound.legs.length, 1); assert.equal(outbound.legs[0].after, 1.8);
  assert.throws(() => plan(fixture(), input({ type: 'transfer_out' })));
});
test('new staking holdings distinguish internal staking from external assets and merge repeated arrivals', () => {
  const destination = { custodian: 'New staking platform', status: '鎖定(質押)' as const, network: 'Bitcoin' };
  const internal = plan(fixture(), input({ type: 'stake', quantity: .5, destinationPositionId: '', destination }));
  assert.equal(internal.state.positions[0].quantity, 1.5);
  assert.equal(internal.state.positions.reduce((sum, p) => sum + (p.symbol === 'BTC' ? p.quantity : 0), 0), 6);
  const external = plan(fixture(), input({ type: 'transfer_in', quantity: .5, destinationPositionId: '', destination, counterparty: 'Original external wallet' }));
  assert.equal(external.state.positions[0].quantity, 2);
  assert.equal(external.legs[0].status, '鎖定(質押)');
  const again = plan(external.state, input({ type: 'transfer_in', quantity: .25, destinationPositionId: '', destination, counterparty: 'Original external wallet' }));
  assert.equal(again.state.positions.length, external.state.positions.length);
  assert.equal(again.state.positions.find(p => p.custodian === destination.custodian)?.quantity, .75);
});
test('staking assets can be added on an existing platform without replacing its available assets or creating another platform', () => {
  const state = fixture();
  const destination = { custodian: 'Exchange', status: '鎖定(質押)' as const, network: '' };
  const first = plan(state, input({ type: 'transfer_in', quantity: .5, destinationPositionId: '', destination, counterparty: 'External staking wallet' }));
  assert.deepEqual(first.state.platforms, state.platforms);
  assert.equal(first.state.positions.find(p => p.id === 'btc_exchange')?.quantity, 1);
  assert.equal(first.state.positions.find(p => p.custodian === 'Exchange' && p.status === '鎖定(質押)')?.quantity, .5);
  const second = plan(first.state, input({ type: 'stake', quantity: .25, destinationPositionId: '', destination }));
  assert.deepEqual(second.state.platforms, state.platforms);
  assert.equal(second.state.positions.length, first.state.positions.length);
  assert.equal(second.state.positions.find(p => p.custodian === 'Exchange' && p.status === '鎖定(質押)')?.quantity, .75);
  assert.equal(second.state.positions.find(p => p.id === 'btc_wallet')?.quantity, 1.75);
});
test('invalid dates, missing identities, self transfers, negative, excessive and nonnumeric quantities are rejected', () => {
  for (const overrides of [{ date: '2026-02-31' }, { date: '2026-10-04' }, { sourcePositionId: 'missing' }, { destinationPositionId: 'missing' }, { destinationPositionId: 'usdt' }, { destinationPositionId: 'btc_wallet' }, { quantity: -1 }, { quantity: 0 }, { quantity: 3 }, { quantity: NaN }, { quantity: Infinity }, { note: '' }, { symbol: 'UNKNOWN' }, { quantity: '1' }]) {
    assert.throws(() => plan(fixture(), input(overrides as Partial<CryptoMovementInput>)));
  }
});
test('small rewards and full-balance moves do not leave floating point drift', () => {
  assert.equal(addCryptoQuantity(.1, .2), .3); assert.equal(addCryptoQuantity(.3, -.1), .2);
  assert.equal(addCryptoQuantity(1e-320, 1e-320), 2e-320);
  const state = fixture(); state.positions[0].quantity = .3;
  let result = plan(state, input({ quantity: .1 })); result = plan(result.state, input({ quantity: .2 }));
  assert.equal(result.state.positions[0].quantity, 0);
  const trade = plan(fixture(), input({ type: 'buy', quantity: .1, unitPrice: .2, quoteCurrency: 'USD' }));
  assert.equal(trade.totalAmount, .02);
  const large = fixture(); large.positions[0].quantity = 1e15;
  assert.throws(() => plan(large, input({ quantity: 1e-10 })), /精度/);
});
test('generic saves cannot bypass the movement ledger; platform renaming still works', () => {
  const state = fixture();
  for (const mutate of [(s: CryptoManagementState) => s.positions[0].quantity++, (s: CryptoManagementState) => s.positions.pop(), (s: CryptoManagementState) => s.positions[0].status = '鎖定(質押)', (s: CryptoManagementState) => s.positions[0].custodian = 'Exchange']) {
    const next = structuredClone(state); mutate(next); assert.throws(() => assertRecordedPositions(state, next));
  }
  assert.doesNotThrow(() => assertRecordedPositions(state, { ...state, positions: [...state.positions].reverse() }));
  const renamed = saveCryptoPlatform(state, 'Ledger wallet', 'Wallet');
  assert.doesNotThrow(() => assertRecordedPositions(state, renamed, { previousName: 'Wallet', name: 'Ledger wallet' }));
});

function fakeStore() {
  const refs = { meta: { id: 'current', path: 'meta' }, movement: { id: 'operation_123', path: 'movement' }, audit: { id: 'operation_123', path: 'audit' }, opening: { id: 'current', path: 'opening' }, assets: { path: 'assets' } };
  const db = new Map<string, unknown>([['meta', fixture()], ['locked-month', { locked: true, totalHkd: 100 }]]);
  async function run(payload: Record<string, unknown>, failSync = false) {
    const writes = new Map<string, unknown>(); let writeStarted = false;
    const tx = {
      get: async (ref: { path: string }) => { assert.equal(writeStarted, false, 'all reads precede writes'); return ref.path === 'assets' ? { docs: [] } : { exists: db.has(ref.path), data: () => structuredClone(db.get(ref.path)) }; },
      set: (ref: { path: string }, value: unknown) => { writeStarted = true; writes.set(ref.path, structuredClone(value)); },
      create: (ref: { path: string }, value: unknown) => { assert.equal(db.has(ref.path), false); writeStarted = true; writes.set(ref.path, structuredClone(value)); },
    };
    await commitCryptoMovement(tx as unknown as FirebaseFirestore.Transaction, refs as unknown as Parameters<typeof commitCryptoMovement>[1], payload, () => { if (failSync) throw new Error('asset sync failed'); }, new Date('2026-10-03T00:00:00Z'));
    writes.forEach((value, key) => db.set(key, value)); return writes.size;
  }
  return { db, run };
}
test('one atomic commit persists opening, movement and audit; duplicate submissions are idempotent', async () => {
  const store = fakeStore(); const payload = { action: 'record-movement', expectedVersion: 4, operationId: 'operation_123', movement: input() };
  assert.equal(await store.run(payload), 4);
  const after = structuredClone(store.db);
  assert.equal(await store.run(payload), 0); assert.deepEqual(store.db, after);
  assert.equal((store.db.get('meta') as CryptoManagementState).version, 5);
  assert.deepEqual(store.db.get('locked-month'), { locked: true, totalHkd: 100 });
  assert.deepEqual((store.db.get('opening') as { positions: CryptoPosition[] }).positions, fixture().positions);
  await assert.rejects(store.run({ ...payload, movement: input({ quantity: .5 }) }), CryptoMovementConflict);
});
test('stale versions or failed asset synchronization leave every durable document unchanged', async () => {
  const store = fakeStore(); const before = structuredClone(store.db);
  await assert.rejects(store.run({ expectedVersion: 3, operationId: 'operation_123', movement: input() }), CryptoMovementConflict);
  assert.deepEqual(store.db, before);
  await assert.rejects(store.run({ expectedVersion: 4, operationId: 'operation_123', movement: input() }, true), /asset sync failed/);
  assert.deepEqual(store.db, before);
});


test('movement form defaults choose another platform for transfers and the matching same-platform status for locks', () => {
  const state = fixture(); const source = state.positions[0];
  const transfer = cryptoMovementDefaultDestination(state, 'transfer', 'BTC', source);
  assert.equal(transfer.destinationPositionId, 'btc_exchange');
  assert.equal(cryptoMovementDefaultDestination(state, 'buy', 'BTC', source).destinationPositionId, 'btc_wallet');
  assert.equal(cryptoMovementDefaultDestination(state, 'transfer_in', 'BTC', source).destinationPositionId, 'btc_wallet');
  assert.doesNotThrow(() => plan(state, input({ ...transfer, destinationPositionId: transfer.destinationPositionId })));
  assert.equal(cryptoMovementDefaultDestination(state, 'stake', 'BTC', source).destinationPositionId, 'btc_staked');
  assert.equal(cryptoMovementDefaultDestination(state, 'unstake', 'BTC', state.positions[1]).destinationPositionId, 'btc_wallet');
  const lock = cryptoMovementDefaultDestination(state, 'collateral_lock', 'BTC', source);
  assert.equal(lock.destinationPositionId, ''); assert.equal(lock.custodian, 'Wallet'); assert.equal(lock.status, '鎖定(抵押)');
  const locked = plan(state, input({ type: 'collateral_lock', destinationPositionId: '', destination: lock }));
  assert.equal(cryptoMovementDefaultDestination(locked.state, 'collateral_unlock', 'BTC', locked.state.positions.at(-1)).destinationPositionId, 'btc_wallet');
  const isolated = { ...state, positions: [source] };
  const missing = cryptoMovementDefaultDestination(isolated, 'transfer', 'BTC', source);
  assert.equal(missing.destinationPositionId, ''); assert.equal(missing.custodian, '');
});
test('blank optional form notes generate a meaningful durable operation description', async () => {
  const state = fixture(); const movement = input(); const note = cryptoMovementDefaultNote(movement, state);
  assert.match(note, /資產轉移 0.2 BTC/); assert.match(note, /Wallet/); assert.match(note, /Exchange/);
  const store = fakeStore();
  await store.run({ action: 'record-movement', expectedVersion: 4, operationId: 'operation_123', movement: { ...movement, note } });
  assert.equal((store.db.get('movement') as { note: string }).note, note);
  assert.equal((store.db.get('audit') as { reason: string }).reason, note);
  assert.deepEqual(store.db.get('locked-month'), { locked: true, totalHkd: 100 });
});
test('reward destination defaults keep earnings separate even when the principal can compound', () => {
  const state = fixture(); const destination = cryptoMovementDefaultDestination(state, 'staking_reward', 'BTC', state.positions[1]);
  assert.equal(destination.destinationPositionId, ''); assert.equal(destination.status, '質押所賺'); assert.equal(destination.custodian, 'Wallet');
  const result = plan(state, input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId: '', destination }));
  assert.equal(result.state.positions[1].quantity, 3); assert.equal(result.legs[0].status, '質押所賺');
});


test('simple staking reward actions inherit their parent platform and preserve principal', () => {
  const state = fixture();
  const earned = plan(state, input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId: undefined, quantity: .3 }));
  const reward = earned.state.positions.find(p => p.status === '質押所賺')!;
  assert.equal(reward.stakingPositionId, 'btc_staked'); assert.equal(reward.custodian, 'Wallet'); assert.equal(reward.quantity, .3);
  assert.equal(earned.state.positions[1].quantity, 3); assert.equal(earned.input.stakingPositionId, 'btc_staked');
  const released = plan(earned.state, input({ type: 'staking_reward_release', sourcePositionId: 'btc_staked', destinationPositionId: undefined, quantity: .1 }));
  assert.equal(released.state.positions[0].quantity, 2.1);
  assert.equal(released.state.positions[1].quantity, 3);
  assert.equal(released.state.positions.find(p => p.id === reward.id)?.quantity, .2);
  assert.equal(released.legs.length, 2); assert.equal(released.input.stakingPositionId, 'btc_staked');
  assert.throws(() => plan(earned.state, input({ type: 'staking_reward_release', sourcePositionId: 'btc_staked', quantity: .4 })), /不可超過/);
  assert.throws(() => plan(state, input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId: '', destination: { custodian: 'Exchange', status: '質押所賺', network: '' } })), /對應質押/);
});
test('identical platform and coin staking parents keep their reward balances separate', () => {
  const state = fixture(); state.positions.push(row('second_stake', 'BTC', 'Wallet', 1, '鎖定(質押)'));
  const first = plan(state, input({ type: 'staking_reward', sourcePositionId: 'btc_staked', destinationPositionId: undefined, quantity: .1 }));
  assert.equal(cryptoMovementDefaultDestination(first.state, 'staking_reward', 'BTC', state.positions[1]).destinationPositionId, 'new_position');
  assert.equal(cryptoMovementDefaultDestination(first.state, 'staking_reward', 'BTC', state.positions.at(-1)).destinationPositionId, '');
  const second = planCryptoMovement(first.state, input({ type: 'staking_reward', sourcePositionId: 'second_stake', destinationPositionId: undefined, quantity: .2 }), 'second_reward', TODAY);
  assert.equal(second.state.positions.filter(p => p.status === '質押所賺').length, 2);
  const released = plan(second.state, input({ type: 'staking_reward_release', sourcePositionId: 'second_stake', quantity: .15 }));
  assert.equal(released.state.positions.find(p => p.stakingPositionId === 'btc_staked')?.quantity, .1);
  assert.equal(released.state.positions.find(p => p.stakingPositionId === 'second_stake')?.quantity, .05);
  assert.equal(released.state.positions.find(p => p.id === 'second_stake')?.quantity, 1);
});
test('release consumes multiple legacy reward rows once and remains possible after all principal was unstaked', () => {
  const state = fixture(); state.positions[1].quantity = 0;
  state.positions.push({ ...row('earn1', 'BTC', 'Wallet', .1, '質押所賺'), stakingPositionId: 'btc_staked' }, { ...row('earn2', 'BTC', 'Wallet', .2, '質押所賺'), stakingPositionId: 'btc_staked' });
  const released = plan(state, input({ type: 'staking_reward_release', sourcePositionId: 'btc_staked', quantity: .25 }));
  assert.equal(released.legs.length, 3); assert.equal(released.state.positions[0].quantity, 2.25);
  assert.equal(released.state.positions.find(p => p.id === 'earn1')?.quantity, 0);
  assert.equal(released.state.positions.find(p => p.id === 'earn2')?.quantity, .05);
  assert.equal(released.state.positions[1].quantity, 0); assert.doesNotThrow(() => validateState(released.state));
});
test('reward parent and release legs persist atomically with idempotent retries', async () => {
  const store = fakeStore(); const state = fixture();
  state.positions.push({ ...row('earn1', 'BTC', 'Wallet', .2, '質押所賺'), stakingPositionId: 'btc_staked' }); store.db.set('meta', state);
  const payload = { action: 'record-movement', expectedVersion: 4, operationId: 'operation_123', movement: input({ type: 'staking_reward_release', sourcePositionId: 'btc_staked', quantity: .1 }) };
  assert.equal(await store.run(payload), 4); const after = structuredClone(store.db);
  assert.equal(await store.run(payload), 0); assert.deepEqual(store.db, after);
  assert.equal((store.db.get('movement') as { stakingPositionId: string }).stakingPositionId, 'btc_staked');
  assert.deepEqual(store.db.get('locked-month'), { locked: true, totalHkd: 100 });
});
