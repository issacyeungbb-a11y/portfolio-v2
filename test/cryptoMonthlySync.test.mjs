import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CRYPTO_MONTH_LOG_HEADERS,
  buildCryptoSyncPlan,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows,
} from '../server/cryptoMonthlySyncCore.js';

const july2026 = [
  46204,
  46217.5387028588,
  56070.9032036927,
  431314.6400279741,
  0.8708555152314588,
  633767.51,
  -0.319443434347125,
  -202452.86997202592,
  -0.044524521794754524,
  0.7308583792848079,
  0.14442246926275895,
  0.08152129241878177,
  0.016408852944058774,
  0.02678900608959256,
  54544.593203692704,
  1526.31,
  7.6923076923,
  'CoinGecko + 手動 (PHOTON) - 既有資料基準',
  '由 seedCurrentMonthLog() 建立嘅基準記錄，用作 8 月同比基準',
];

const context = {
  spreadsheetId: '1CrXqZtK2Qy2rivBTN1BZTSbNpAY0Y5P6Rzsg8_OaaI4',
  spreadsheetTitle: 'crypto',
  sheetName: '月結記錄',
};

function parse(rows = [july2026]) {
  return parseCryptoMonthLogRows([[...CRYPTO_MONTH_LOG_HEADERS], ...rows], context);
}

test('parses the live locked July row without inventing holdings', () => {
  const snapshots = parse();
  const snapshot = snapshots[0];

  assert.equal(snapshots.length, 1);
  assert.equal(snapshot.id, 'monthly-2026-07');
  assert.equal(snapshot.snapshotTimestamp, '2026-07-14T12:55:44+08:00');
  assert.equal(snapshot.performanceTotalUsd, 56070.9032036927);
  assert.equal(snapshot.currentNetUsd, 54544.593203692704);
  assert.equal(snapshot.cumulativeWithdrawnUsd, 1526.31);
  assert.equal(snapshot.sourceSheet, '月結記錄');
  assert.equal(snapshot.sourceRange, 'A2:S2');
  assert.deepEqual(snapshot.historicalHoldings, []);
  assert.deepEqual(snapshot.prices, []);
  assert.ok(snapshot.warnings.some((warning) => warning.code === 'MANUAL_PRICE_SOURCE'));
  assert.ok(snapshot.warnings.some((warning) => warning.code === 'SOURCE_NOTE'));
});

test('builds idempotent create, skip and locked-conflict plans', () => {
  const [snapshot] = parse();
  const createPlan = buildCryptoSyncPlan([snapshot], new Map());
  assert.deepEqual(createPlan.creates.map((entry) => entry.month), ['2026-07']);

  const skipPlan = buildCryptoSyncPlan(
    [snapshot],
    new Map([[snapshot.id, { ...snapshot }]]),
  );
  assert.equal(skipPlan.skips.length, 1);
  assert.equal(skipPlan.conflicts.length, 0);

  const conflictPlan = buildCryptoSyncPlan(
    [snapshot],
    new Map([[
      snapshot.id,
      { ...snapshot, totalHkd: snapshot.totalHkd + 10, sourceChecksum: 'changed' },
    ]]),
  );
  assert.equal(conflictPlan.creates.length, 0);
  assert.equal(conflictPlan.conflicts.length, 1);
  assert.ok(conflictPlan.conflicts[0].differingFields.includes('totalHkd'));
});

test('requires an exact header and stops on duplicate locked months', () => {
  const wrongHeaders = [...CRYPTO_MONTH_LOG_HEADERS];
  wrongHeaders[2] = 'total(USD)';
  assert.throws(
    () => parseCryptoMonthLogRows([wrongHeaders, july2026], context),
    /欄位結構已改變/,
  );
  assert.throws(() => parse([july2026, july2026]), /重複月份 2026-07/);
});

test('rejects totals outside the original validation tolerances', () => {
  const invalid = [...july2026];
  invalid[3] = Number(invalid[3]) + 2;
  assert.throws(() => parse([invalid]), /HKD 總值超出 HK\$1/);
});

test('source checksum is deterministic and changes with sheet values', () => {
  const first = parse();
  const second = parse();
  assert.equal(getCryptoSyncSourceChecksum(first), getCryptoSyncSourceChecksum(second));

  const changed = [...july2026];
  changed[18] = '新備註';
  assert.notEqual(getCryptoSyncSourceChecksum(first), getCryptoSyncSourceChecksum(parse([changed])));
});
