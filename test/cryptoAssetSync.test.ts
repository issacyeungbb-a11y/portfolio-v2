import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aggregate } from '../server/cryptoManagementCore.js';
import { planCryptoAssetSync, canonicalCryptoAsset, cryptoAssetQuotes, commitCryptoAssetReconciliation, CryptoAssetSyncConflict } from '../server/cryptoAssetSync.js';
import { commitCryptoMovement } from '../server/cryptoMovementStore.js';
import { cryptoManagementErrorResponse, CryptoManagementError, validateCryptoInput } from '../server/cryptoManagementErrors.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement.ts';
const at = '2026-10-12T01:00:00Z';
const position = (id: string, quantity: number, status = '可用') => ({ id, symbol: 'BTC', custodian: 'Wallet', quantity, status, network: '', collateralSymbol: '' });
function state(): CryptoManagementState { return { version: 7, migratedAt: '', sourceChecksum: '', coins: [{ symbol: 'BTC', name: 'Bitcoin', priceSource: 'coingecko', priceSourceId: 'bitcoin', manualPriceUsd: null, manualPriceAt: null }], positions: [position('available', .1), position('stake', .2, '鎖定(質押)')], liabilities: [], funding: [] }; }
const asset = (id = 'legacy_btc', extra: Record<string, unknown> = {}) => ({ id, data: { name: 'Bitcoin', accountSource: 'Crypto', assetType: 'crypto', symbol: 'BTC', currency: 'USD', quantity: .30000000000000004, currentPrice: 99, averageCost: 42, priceAsOf: at, lastPriceUpdatedAt: at, priceSourceUrl: 'https://price.example/bitcoin', managedCrypto: true, ...extra } });
function store(source = state(), rows = [asset()]) {
  const db = new Map<string, any>([['meta', structuredClone(source)], ['locked-month', { locked: true, totalHkd: 100 }], ['history-trade', { assetId: 'legacy_btc', quantity: 1 }], ...rows.map(row => [`assets/${row.id}`, structuredClone(row.data)] as [string, any])]);
  const ref = (path: string) => ({ path, id: path.split('/').at(-1) });
  const refs = { meta: ref('meta'), audit: ref('audit'), assets: { path: 'assets', doc: (id: string) => ref('assets/' + id) } } as any;
  const payload = () => ({ action: 'reconcile-assets', expectedVersion: source.version, expectedAssetsChecksum: planCryptoAssetSync(source, [...db].filter(([p]) => p.startsWith('assets/')).map(([p, data]) => ({ id: p.slice(7), data })), { quantityOnly: true, at }).status.checksum, operationId: 'sync_operation_123' });
  async function run(input = payload(), movement = false, breakSync = false) {
    const writes: Array<[string, any, boolean]> = [];
    const tx = { get: async (r: any) => r.path === 'assets' ? { docs: [...db].filter(([p]) => p.startsWith('assets/')).map(([p, d]) => ({ id: p.slice(7), data: () => structuredClone(d) })) } : { exists: db.has(r.path), data: () => structuredClone(db.get(r.path)) }, set: (r: any, value: any, options: any) => writes.push([r.path, structuredClone(value), Boolean(options?.merge)]), create: (r: any, value: any) => { assert.ok(!db.has(r.path)); writes.push([r.path, structuredClone(value), false]); } } as any;
    if (movement) await commitCryptoMovement(tx, { ...refs, movement: ref('movement'), opening: ref('opening') }, input, (next, stored) => { if (breakSync) throw Error('database sync unavailable'); for (const w of planCryptoAssetSync(next, stored.docs.map(d => ({ id: d.id, data: d.data() })), { at }).writes) tx.set(refs.assets.doc(w.id), w.patch, { merge: true }); }, new Date(at));
    else await commitCryptoAssetReconciliation(tx, refs, input, at);
    for (const [p, value, merge] of writes) db.set(p, merge ? { ...db.get(p), ...value } : value);
    return writes.length;
  }
  return { db, payload, run };
}
test('decimal quantities aggregate exactly across all states without floating-point tails', () => {
  assert.equal(aggregate(state().positions).BTC, .3);
  const s = state(); s.positions = [position('one', 1e15), position('two', 1)];
  assert.throws(() => aggregate(s.positions), /合計數量超出上限/);
});
test('quantity reconciliation preserves prices, costs, source metadata, holdings and history', async () => {
  const s = store(); const original = structuredClone(s.db); const payload = s.payload();
  assert.equal(await s.run(payload), 2);
  const a = s.db.get('assets/legacy_btc');
  assert.equal(a.quantity, .3); assert.equal(a.managedCryptoVersion, 7);
  for (const key of ['currentPrice', 'averageCost', 'priceAsOf', 'lastPriceUpdatedAt', 'priceSourceUrl']) assert.equal(a[key], original.get('assets/legacy_btc')[key]);
  for (const key of ['meta', 'locked-month', 'history-trade']) assert.deepEqual(s.db.get(key), original.get(key));
  const after = structuredClone(s.db); assert.equal(await s.run(payload), 0); assert.deepEqual(s.db, after);
  assert.equal(s.db.get('audit').action, 'reconcile-assets');
  const plan = planCryptoAssetSync(state(), [{ id: 'legacy_btc', data: a }], { quantityOnly: true, at });
  assert.equal(plan.status.status, 'synced'); assert.equal(plan.writes.length, 0);
});
test('duplicate Crypto rows are archived while the canonical ID and other accounts survive', () => {
  const rows = [asset('legacy_btc'), asset('duplicate', { managedCrypto: false, quantity: 9 }), asset('futu', { accountSource: 'Futu', quantity: 20 })];
  const plan = planCryptoAssetSync(state(), rows, { quantityOnly: true, at });
  assert.equal(canonicalCryptoAsset(rows, 'BTC')?.id, 'legacy_btc');
  assert.equal(plan.writes.find(w => w.id === 'legacy_btc')?.patch.quantity, .3);
  assert.equal(plan.writes.find(w => w.id === 'duplicate')?.patch.archivedAt, at);
  assert.ok(!plan.writes.some(w => w.id === 'futu'));
  assert.equal(cryptoAssetQuotes(rows).BTC.price, 99);
});
test('quotes and canonical selection are deterministic even when duplicate rows arrive in another order', () => {
  const rows = [asset('older', { priceAsOf: '2026-10-11T01:00:00Z' }), asset('newer', { currentPrice: 120 })];
  assert.equal(canonicalCryptoAsset(rows, 'BTC')?.id, 'newer');
  assert.deepEqual(cryptoAssetQuotes(rows), cryptoAssetQuotes([...rows].reverse()));
  const first = planCryptoAssetSync(state(), rows, { at });
  const reversed = planCryptoAssetSync(state(), [...rows].reverse().map(row => ({ id: row.id, data: Object.fromEntries(Object.entries(row.data).reverse()) })), { at });
  assert.equal(first.status.checksum, reversed.status.checksum);
});
test('zero balances archive without deleting history; missing assets are linked without inventing a market price', () => {
  const s = state(); s.positions = [];
  const plan = planCryptoAssetSync(s, [asset()], { at });
  assert.equal(plan.writes[0].patch.quantity, 0); assert.equal(plan.writes[0].patch.archivedAt, at);
  const created = planCryptoAssetSync(state(), [], { at });
  assert.equal(created.writes[0].id, 'crypto_BTC'); assert.equal(created.writes[0].patch.currentPrice, 0); assert.equal(created.writes[0].patch.priceAsOf, null);
});
test('source changes invalidate the previous provider price; ordinary quantity changes preserve it', () => {
  const s = state(); const ordinary = planCryptoAssetSync(s, [asset()], { previous: s, at });
  assert.ok(!Object.hasOwn(ordinary.writes[0].patch, 'currentPrice'));
  const changed = structuredClone(s); changed.coins[0].priceSourceId = 'different-token';
  const plan = planCryptoAssetSync(changed, [asset()], { previous: s, at });
  assert.equal(plan.writes[0].patch.currentPrice, 0); assert.equal(plan.writes[0].patch.priceAsOf, null);
});
test('currency and document collisions stop reconciliation without touching either account', async () => {
  for (const rows of [[asset('legacy_btc', { currency: 'JPY' })], [asset('crypto_BTC', { accountSource: 'Futu' })]]) {
    const s = store(state(), rows); const before = structuredClone(s.db);
    await assert.rejects(s.run(), /資產資料需核對/); assert.deepEqual(s.db, before);
  }
});
test('concurrent holdings or prices and reused IDs reject instead of overwriting', async () => {
  const s = store(); const input = s.payload(); const before = structuredClone(s.db);
  await assert.rejects(s.run({ ...input, expectedVersion: 6 }), CryptoAssetSyncConflict); assert.deepEqual(s.db, before);
  s.db.get('assets/legacy_btc').currentPrice = 101; const newer = structuredClone(s.db);
  await assert.rejects(s.run(input), /資產或價格已更新/); assert.deepEqual(s.db, newer);
  await s.run(); const saved = structuredClone(s.db);
  await assert.rejects(s.run({ ...s.payload(), operationId: input.operationId }), /操作 ID 已用於另一筆同步/); assert.deepEqual(s.db, saved);
});
test('a movement updates the platform and canonical asset together and cannot duplicate on retry', async () => {
  const s = store(); const payload = { action: 'record-movement', expectedVersion: 7, operationId: 'movement_123', movement: { type: 'staking_reward', symbol: 'BTC', sourcePositionId: 'stake', quantity: .05, date: '2026-10-12', note: '質押收益' } };
  await s.run(payload, true);
  assert.equal(aggregate(s.db.get('meta').positions).BTC, .35);
  assert.equal(s.db.get('assets/legacy_btc').quantity, .35); assert.equal(s.db.get('assets/legacy_btc').managedCryptoVersion, 8);
  assert.equal(s.db.get('assets/legacy_btc').currentPrice, 99); assert.ok(s.db.has('movement'));
  const after = structuredClone(s.db); assert.equal(await s.run(payload, true), 0); assert.deepEqual(s.db, after);
});
test('failed synchronization cannot leave a changed platform with an unchanged asset', async () => {
  const s = store(); const before = structuredClone(s.db);
  await assert.rejects(s.run({ action: 'record-movement', expectedVersion: 7, operationId: 'movement_123', movement: { type: 'staking_reward', symbol: 'BTC', sourcePositionId: 'stake', quantity: .05, date: '2026-10-12', note: '質押收益' } }, true, true));
  assert.deepEqual(s.db, before);
});
test('known input errors stay editable; uncertain backend failures return 500 and preserve retry identity', () => {
  const invalid = (() => { try { validateCryptoInput(() => { throw Error('數量不足'); }); } catch (e) { return e; } })();
  assert.equal(cryptoManagementErrorResponse(invalid).status, 400);
  assert.equal(cryptoManagementErrorResponse(new CryptoManagementError('版本已改變', 409)).status, 409);
  const failure = cryptoManagementErrorResponse(new Error('private database transport detail'));
  assert.equal(failure.status, 500); assert.match(failure.body.message, /原筆操作重試/); assert.ok(!failure.body.message.includes('private'));
});
