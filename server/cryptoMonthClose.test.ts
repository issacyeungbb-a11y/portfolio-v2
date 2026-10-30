import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { commitManualCryptoMonth } from './cryptoMonthClose.js';
import { aggregate } from './cryptoManagementCore.js';
import type { CryptoManagementState } from '../src/types/cryptoManagement.ts';

const at = '2026-10-30T14:00:00Z';
function fixture(now = at) {
  const position = (id: string, quantity: number, status: string) => ({ id, symbol: 'BTC', custodian: 'Wallet', quantity, status, network: '', collateralSymbol: '' });
  const state: CryptoManagementState = {
    version: 8, migratedAt: at, sourceChecksum: 'original',
    coins: ['BTC', 'USDT'].map(symbol => ({ symbol, name: symbol, priceSource: 'coingecko', priceSourceId: symbol, manualPriceUsd: null, manualPriceAt: null })),
    positions: [position('available', .1, '可用'), position('staked', .2, '鎖定(質押)'), { ...position('reward', .01, '質押所賺'), stakingPositionId: 'staked' }],
    liabilities: [{ ...position('debt', 2, '借貸負債'), symbol: 'USDT', custodian: 'Lender', collateralSymbol: 'BTC' }],
    funding: [{ id: 'deposit', date: '2026-01-01', source: '入金', type: 'deposit', hkd: 780, usd: 100 }, { id: 'withdraw', date: '2026-02-01', source: '提取', type: 'withdrawal', hkd: 0, usd: 10 }],
  };
  const db = new Map<string, any>([
    ['portfolio/app', { fxRates: { USD: 7.8, updatedAt: now } }],
    ['portfolio/app/cryptoManagement/current', state],
    // Deliberately wrong asset quantity: month close must use platform positions instead.
    ['portfolio/app/assets/btc', { accountSource: 'Crypto', assetType: 'crypto', symbol: 'BTC', quantity: 999, currentPrice: 100, priceAsOf: now, currency: 'USD' }],
    ['portfolio/app/assets/usdt', { accountSource: 'Crypto', assetType: 'crypto', symbol: 'USDT', quantity: 999, currentPrice: 1, priceAsOf: now, currency: 'USD' }],
    ['portfolio/app/assets/futu', { accountSource: 'Futu', assetType: 'crypto', symbol: 'BTC', quantity: 999, currentPrice: 1000, priceAsOf: now, currency: 'USD' }],
    ['portfolio/app/cryptoMonthlySnapshots/monthly-2026-09', { month: '2026-09', locked: true, currentNetUsd: 20 }],
  ]);
  function ref(path: string, beforeMonth?: string): any {
    return { path, id: path.split('/').at(-1), collection: (name: string) => ref(`${path}/${name}`), doc: (id: string) => ref(`${path}/${id}`),
      where: (_field: string, _operator: string, month: string) => ref(path, month), orderBy: () => ref(path, beforeMonth), limit: () => ref(path, beforeMonth), beforeMonth };
  }
  async function run(expectedVersion: unknown = 8) {
    const writes: Array<{ kind: string; path: string; data?: any }> = [];
    const tx = {
      get: async (r: any) => {
        if (r.path.endsWith('/assets') || r.beforeMonth) {
          const docs = [...db].filter(([p, d]) => p.startsWith(r.path + '/') && (!r.beforeMonth || d.month < r.beforeMonth))
            .sort((a, b) => String(b[1].month).localeCompare(String(a[1].month)))
            .map(([p, data]) => ({ id: p.split('/').at(-1), data: () => structuredClone(data) }));
          return { docs: r.beforeMonth ? docs.slice(0, 1) : docs };
        }
        return { exists: db.has(r.path), data: () => structuredClone(db.get(r.path)) };
      },
      create: (r: any, data: any) => { assert.ok(!db.has(r.path)); writes.push({ kind: 'create', path: r.path, data }); },
      set: (r: any, data: any) => writes.push({ kind: 'set', path: r.path, data }),
      delete: (r: any) => writes.push({ kind: 'delete', path: r.path }),
    };
    const result = await commitManualCryptoMonth(tx as any, ref('portfolio/app'), expectedVersion, new Date(now));
    for (const w of writes) { if (w.kind === 'delete') db.delete(w.path); else db.set(w.path, structuredClone(w.data)); }
    return result;
  }
  return { db, state, run };
}

test('manual close on any day records platform holdings, rewards, debt and actual date without changing live accounts', async () => {
  const f = fixture(); const before = structuredClone(f.db);
  assert.deepEqual(await f.run(), { status: 'created', month: '2026-10' });
  const saved = f.db.get('portfolio/app/cryptoMonthlySnapshots/monthly-2026-10');
  assert.equal(saved.snapshotDate, '2026-10-30'); assert.equal(saved.snapshotTimestamp, new Date(at).toISOString());
  assert.equal(saved.dataQuality, 'verified'); assert.deepEqual(saved.warnings, []);
  assert.equal(saved.currentNetUsd, 29); assert.equal(saved.totalHkd, 29 * 7.8);
  assert.equal(saved.principalHkd, 780); assert.equal(saved.cumulativeWithdrawnUsd, 10);
  assert.equal(saved.monthOverMonthPct, 29 / 20 - 1);
  assert.equal(aggregate(saved.historicalQuantities).BTC, .31);
  assert.deepEqual(saved.historicalHoldings, [{ rawLabel: 'Wallet', normalizedLabel: 'Wallet', valueUsd: 31 }]);
  assert.equal(saved.liabilities[0].platform, 'Lender');
  assert.deepEqual(saved.managementState.positions, f.state.positions);
  assert.equal(saved.rawSourceValues.closingMode, 'manual');
  for (const [path, value] of before) assert.deepEqual(f.db.get(path), value, path);
  const after = structuredClone(f.db);
  assert.deepEqual(await f.run(), { status: 'locked', month: '2026-10' });
  assert.deepEqual(f.db, after, 'retry must not overwrite snapshot or add another audit');
});

test('manual close chooses month and date in Hong Kong, including UTC month boundary', async () => {
  const f = fixture('2026-10-31T17:00:00Z');
  assert.deepEqual(await f.run(), { status: 'created', month: '2026-11' });
  assert.equal(f.db.get('portfolio/app/cryptoMonthlySnapshots/monthly-2026-11').snapshotDate, '2026-11-01');
});

test('concurrent platform changes refuse closing with no writes', async () => {
  const f = fixture(); const before = structuredClone(f.db);
  await assert.rejects(f.run(7), /平台持倉已更新/);
  assert.deepEqual(f.db, before);
});

test('missing or expired quotes and invalid FX save only a draft, then allow a manual retry', async () => {
  for (const kind of ['missing', 'stale', 'fx-stale', 'fx-invalid', 'fx-future']) {
    const f = fixture();
    const quote = f.db.get('portfolio/app/assets/btc');
    const fx = f.db.get('portfolio/app').fxRates;
    if (kind === 'missing') quote.currentPrice = 0;
    if (kind === 'stale') quote.priceAsOf = '2026-10-28T00:00:00Z';
    if (kind === 'fx-stale') fx.updatedAt = '2026-10-20T00:00:00Z';
    if (kind === 'fx-invalid') fx.updatedAt = 'invalid';
    if (kind === 'fx-future') fx.updatedAt = '2026-11-01T00:00:00Z';
    assert.equal((await f.run()).status, 'blocked');
    assert.ok(f.db.has('portfolio/app/cryptoMonthlyDrafts/2026-10'));
    assert.ok(!f.db.has('portfolio/app/cryptoMonthlySnapshots/monthly-2026-10'));
    assert.ok(![...f.db.keys()].some(p => p.includes('/cryptoManagementAudit/')));
    quote.currentPrice = 100; quote.priceAsOf = at; fx.updatedAt = at;
    assert.equal((await f.run()).status, 'created');
    assert.ok(!f.db.has('portfolio/app/cryptoMonthlyDrafts/2026-10'));
  }
});

test('daily and rescue workflows have no Crypto month-close hook and retain daily scheduling', async () => {
  const cron = await readFile(new URL('./cronDailyUpdate.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(cron, /closeCryptoMonth|commitManualCryptoMonth|cryptoMonthlyClose|action:\s*['"]close-month/);
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.crons, [{ path: '/api/cron-daily-update', schedule: '0 22 * * *' }, { path: '/api/cron-daily-rescue', schedule: '0 0 * * *' }]);
});
