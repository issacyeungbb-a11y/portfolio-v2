import assert from 'node:assert/strict';
import test from 'node:test';

import { cryptoHistorySource } from '../scripts/data/crypto-history-source-2026-07.mjs';
import {
  buildCryptoMonthlySnapshots,
  compareExistingSnapshots,
  excelSerialToDate,
  validateCryptoMonthlySnapshots,
} from '../scripts/lib/cryptoHistoryImport.mjs';

const snapshots = buildCryptoMonthlySnapshots(cryptoHistorySource);

test('imports every confirmed month from the first 2022 snapshot through locked July 2026', () => {
  assert.equal(snapshots.length, 53);
  assert.equal(snapshots[0].month, '2022-03');
  assert.equal(snapshots.at(-1).month, '2026-07');
  assert.deepEqual(
    Object.fromEntries(
      snapshots.reduce((entries, snapshot) => {
        const year = snapshot.month.slice(0, 4);
        entries.set(year, (entries.get(year) ?? 0) + 1);
        return entries;
      }, new Map()),
    ),
    { 2022: 10, 2023: 12, 2024: 12, 2025: 12, 2026: 7 },
  );
});

test('keeps month ordering deterministic and covers representative middle months', () => {
  assert.deepEqual(
    snapshots.map((snapshot) => snapshot.month),
    [...snapshots.map((snapshot) => snapshot.month)].sort(),
  );

  const expected = {
    '2022-08': 14332.87,
    '2023-07': 19464.37,
    '2024-06': 53652.88,
    '2025-06': 101831.11,
    '2026-06': 58683.77,
  };

  for (const [month, totalUsd] of Object.entries(expected)) {
    assert.equal(
      snapshots.find((snapshot) => snapshot.month === month)?.performanceTotalUsd,
      totalUsd,
    );
  }
});

test('uses the hidden locked month log for July 2026 and excludes unlocked NIGHT holdings', () => {
  const july = snapshots.find((snapshot) => snapshot.month === '2026-07');

  assert.ok(july);
  assert.equal(july.sourceSheet, '月結記錄');
  assert.equal(july.sourceType, 'locked_month_log');
  assert.equal(july.currentNetUsd, 54544.593203692704);
  assert.equal(july.cumulativeWithdrawnUsd, 1526.31);
  assert.equal(july.performanceTotalUsd, 56070.9032036927);
  assert.ok(july.warnings.some((warning) => warning.code === 'NIGHT_EXCLUDED_UNLOCKED'));
  assert.ok(!JSON.stringify(july.rawSourceValues).includes('13232'));
});

test('validates principal, return, return rate, totals and monthly continuity', () => {
  const report = validateCryptoMonthlySnapshots(snapshots);

  assert.equal(report.valid, true);
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.missingMonthsWithinRange, []);

  for (const snapshot of snapshots) {
    assert.ok(Math.abs(snapshot.totalHkd - snapshot.performanceTotalUsd * snapshot.usdHkdRate) <= 1);
    assert.ok(Math.abs(snapshot.returnHkd - (snapshot.totalHkd - snapshot.principalHkd)) <= 1);
    assert.ok(Math.abs(snapshot.returnPct - snapshot.returnHkd / snapshot.principalHkd) <= 0.0001);
  }
});

test('duplicate imports skip all unchanged monthly documents by checksum', () => {
  const existing = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]));
  const comparison = compareExistingSnapshots(snapshots, existing);

  assert.equal(comparison.creates.length, 0);
  assert.equal(comparison.skips.length, snapshots.length);
  assert.equal(comparison.conflicts.length, 0);
});

test('changed locked month is reported as a field-level conflict', () => {
  const july = snapshots.find((snapshot) => snapshot.month === '2026-07');
  assert.ok(july);
  const existing = new Map([
    [
      july.id,
      {
        ...july,
        totalHkd: july.totalHkd + 10,
        sourceChecksum: 'different-checksum',
      },
    ],
  ]);
  const comparison = compareExistingSnapshots([july], existing);

  assert.equal(comparison.conflicts.length, 1);
  assert.ok(
    comparison.conflicts[0].differences.some(
      (difference) => difference.field === 'totalHkd',
    ),
  );
});

test('missing detailed holdings remain partial instead of being invented', () => {
  const first = snapshots[0];
  const july = snapshots.at(-1);

  assert.equal(first.dataQuality, 'partial');
  assert.equal(july.dataQuality, 'partial');
  assert.deepEqual(july.historicalHoldings, []);
  assert.deepEqual(july.historicalQuantities, []);
});

test('preserves the suspicious 2002 source date as a visible warning', () => {
  const march2022 = snapshots.find((snapshot) => snapshot.month === '2022-03');

  assert.ok(march2022);
  assert.ok(
    march2022.warnings.some((warning) => warning.code === 'SOURCE_DATE_TYPO_2002'),
  );
  assert.ok(
    march2022.warnings.some((warning) => warning.message.includes('29/3/2002')),
  );
});

test('spreadsheet serial conversion matches locked and annual source dates', () => {
  assert.equal(excelSerialToDate(44631), '2022-03-11');
  assert.equal(excelSerialToDate(46188), '2026-06-15');
  assert.equal(excelSerialToDate(46204), '2026-07-01');
});
