import { createHash } from 'node:crypto';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const MONEY_TOLERANCE_HKD = 1;
const PERCENTAGE_TOLERANCE = 0.0001;

const PLATFORM_LABELS = new Map([
  ['Cryoto.com', 'Crypto.com'],
  ['kikitrade/ Cryoto.com', 'Kikitrade / Crypto.com'],
  ['coolWallet', 'CoolWallet'],
  ['keplr', 'Keplr'],
  ['Pionex', '派網 / Pionex'],
  ['Wld+Vespr', 'World App / Vespr'],
  ['hi-stake/ Wld/Vespr', 'hi-stake / World App / Vespr'],
]);

const ALLOCATION_KEYS = new Map([
  ['BTC佔比·', 'BTC'],
  ['BTC佔比', 'BTC'],
  ['ETH佔比', 'ETH'],
  ['ADA佔比', 'ADA'],
  ['USDT佔比', 'USDT'],
  ['其他佔比', 'OTHER'],
]);

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function roundForReport(value, digits = 6) {
  return Number(value.toFixed(digits));
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((item) => canonicalize(item));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalize(item)]),
    );
  }

  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function createChecksum(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function excelSerialToDate(serial) {
  if (!isFiniteNumber(serial)) {
    throw new Error(`Invalid spreadsheet serial date: ${String(serial)}`);
  }

  return new Date(EXCEL_EPOCH_MS + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

export function excelSerialToHongKongIso(serial) {
  if (!isFiniteNumber(serial)) {
    throw new Error(`Invalid spreadsheet serial timestamp: ${String(serial)}`);
  }

  const wholeDays = Math.floor(serial);
  const dayFraction = serial - wholeDays;
  const date = new Date(EXCEL_EPOCH_MS + wholeDays * DAY_MS);
  const hours = Math.floor(dayFraction * 24);
  const minutes = Math.floor((dayFraction * 24 - hours) * 60);
  const seconds = Math.round((((dayFraction * 24 - hours) * 60) - minutes) * 60);
  const dateKey = date.toISOString().slice(0, 10);

  return `${dateKey}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}+08:00`;
}

function normalizePlatformLabel(rawLabel) {
  return PLATFORM_LABELS.get(rawLabel) ?? rawLabel;
}

function normalizePlatformValues(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .filter(([, amount]) => isFiniteNumber(amount))
    .map(([rawLabel, amount]) => ({
      rawLabel,
      normalizedLabel: normalizePlatformLabel(rawLabel),
      valueUsd: amount,
    }))
    .sort((left, right) => right.valueUsd - left.valueUsd);
}

function normalizePrices(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .filter(([, price]) => isFiniteNumber(price))
    .map(([rawLabel, price]) => ({
      rawLabel,
      symbol: rawLabel.replace(/價$/, '').trim().toUpperCase(),
      priceUsd: price,
    }));
}

function parseQuantityLabel(rawLabel) {
  const parenthesized = rawLabel.match(/^([A-Za-z0-9]+)數量\((.+)\)$/);
  if (parenthesized) {
    return {
      symbol: parenthesized[1].toUpperCase(),
      platform: normalizePlatformLabel(parenthesized[2]),
    };
  }

  const total = rawLabel.match(/^持有([A-Za-z0-9]+)$/);
  if (total) {
    return {
      symbol: total[1].toUpperCase(),
      platform: null,
    };
  }

  return {
    symbol: rawLabel.toUpperCase(),
    platform: null,
  };
}

function normalizeQuantities(value) {
  if (!value || typeof value !== 'object') {
    return [];
  }

  return Object.entries(value)
    .filter(([, quantity]) => isFiniteNumber(quantity))
    .map(([rawLabel, quantity]) => ({
      rawLabel,
      ...parseQuantityLabel(rawLabel),
      quantity,
    }));
}

function normalizeAllocations(value) {
  if (!value || typeof value !== 'object') {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([rawLabel, allocation]) => ALLOCATION_KEYS.has(rawLabel) && isFiniteNumber(allocation))
      .map(([rawLabel, allocation]) => [ALLOCATION_KEYS.get(rawLabel), allocation]),
  );
}

function buildWarning(code, message, severity = 'warning') {
  return { code, message, severity };
}

function sourceValue(rawValues, ...keys) {
  for (const key of keys) {
    const value = rawValues[key];
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function buildRecordWarnings(record, snapshot) {
  const warnings = [];
  const rawValues = record.rawSourceValues;
  const allocationCount = Object.keys(snapshot.allocations).length;

  if (allocationCount < 5) {
    warnings.push(
      buildWarning(
        'ALLOCATIONS_PARTIAL',
        '原始月份未提供完整 BTC、ETH、ADA、USDT、其他五項分佈。',
      ),
    );
  }

  if (snapshot.historicalHoldings.length === 0 || snapshot.historicalQuantities.length === 0) {
    warnings.push(
      buildWarning(
        'HOLDINGS_PARTIAL',
        '原始月份只足以確認月結總值或平台摘要，沒有完整逐項持倉。',
      ),
    );
  }

  if (record.sourceSheet === '2022') {
    warnings.push(
      buildWarning(
        'SOURCE_DATE_TYPO_2002',
        '本金紀錄原始日期包含 29/3/2002；疑似 29/3/2022，原值已保留且未靜默修正。',
      ),
    );
  }

  const normalizedLabels = snapshot.historicalHoldings.filter(
    (holding) => holding.rawLabel !== holding.normalizedLabel,
  );
  if (normalizedLabels.length > 0) {
    warnings.push(
      buildWarning(
        'SOURCE_LABEL_NORMALIZED',
        `已另外保存標準化名稱：${normalizedLabels.map((item) => `${item.rawLabel} → ${item.normalizedLabel}`).join('、')}；原標籤不變。`,
        'info',
      ),
    );
  }

  const suspiciousEth = snapshot.prices.find(
    (entry) => entry.symbol === 'ETH' && entry.priceUsd === 18956,
  );
  if (suspiciousEth) {
    warnings.push(
      buildWarning(
        'SUSPICIOUS_ETH_PRICE',
        '原始 ETH 價格為 18,956 USD，與相鄰月份差距明顯；未自行更改。',
      ),
    );
  }

  if (record.sourceType === 'locked_month_log') {
    warnings.push(
      buildWarning(
        'LOCKED_MONTH_NO_HOLDING_BREAKDOWN',
        '鎖定月結只有標準化總值與分佈，沒有逐平台持倉明細。',
      ),
      buildWarning(
        'NIGHT_EXCLUDED_UNLOCKED',
        '2026_V2 的 NIGHT 13,232 屬未鎖定即時持倉，未加入 2026-07 歷史快照。',
        'info',
      ),
    );
  }

  if (
    snapshot.currentNetUsd + snapshot.cumulativeWithdrawnUsd !== snapshot.performanceTotalUsd &&
    Math.abs(
      snapshot.currentNetUsd +
        snapshot.cumulativeWithdrawnUsd -
        snapshot.performanceTotalUsd,
    ) > 0.01
  ) {
    warnings.push(
      buildWarning(
        'NET_VALUE_RECONCILIATION',
        '現有淨值加累計提取與投資計算總值不完全相符。',
        'error',
      ),
    );
  }

  if (Array.isArray(record.sourceNotes)) {
    for (const note of record.sourceNotes) {
      warnings.push(buildWarning('SOURCE_NOTE', note, 'info'));
    }
  }

  if (!isFiniteNumber(sourceValue(rawValues, 'bitcoin總值')) && snapshot.btcEquivalent != null) {
    warnings.push(
      buildWarning(
        'BTC_EQUIVALENT_DERIVED',
        'BTC 等值按原始投資計算總值 ÷ 原始 BTC 價格計算。',
        'info',
      ),
    );
  }

  return warnings;
}

function normalizeRecord(record, source) {
  const rawValues = record.rawSourceValues ?? {};
  const snapshotDate = excelSerialToDate(record.rawSnapshotDateSerial);
  const month = record.rawMonthSerial
    ? excelSerialToDate(record.rawMonthSerial).slice(0, 7)
    : snapshotDate.slice(0, 7);
  const performanceTotalUsd = sourceValue(rawValues, 'totel(USD)');
  const totalHkd = sourceValue(rawValues, 'totel(HKD)');
  const cumulativeWithdrawnUsd =
    sourceValue(
      rawValues,
      '已提取／消費(累計）',
      '已提取／消費（累計USD）',
    ) ?? 0;
  const currentNetUsd =
    sourceValue(rawValues, '現有totel(USD)') ??
    (isFiniteNumber(performanceTotalUsd) && isFiniteNumber(cumulativeWithdrawnUsd)
      ? performanceTotalUsd - cumulativeWithdrawnUsd
      : null);
  const principalHkd = sourceValue(rawValues, '本金');
  const returnHkd = sourceValue(rawValues, '總回報（HKD)', '總回報（HKD）');
  const returnPct = sourceValue(rawValues, '總回報率（%)', '總回報率');
  const monthOverMonthPct = sourceValue(rawValues, '上月同比');
  const prices = normalizePrices(rawValues.pricesUsd);
  const btcPrice = prices.find((entry) => entry.symbol === 'BTC')?.priceUsd ?? null;
  const rawBtcEquivalent = sourceValue(rawValues, 'bitcoin總值');
  const btcEquivalent =
    isFiniteNumber(rawBtcEquivalent)
      ? rawBtcEquivalent
      : isFiniteNumber(performanceTotalUsd) && isFiniteNumber(btcPrice) && btcPrice > 0
        ? performanceTotalUsd / btcPrice
        : null;
  const usdHkdRate =
    sourceValue(rawValues, 'USD/HKD匯率') ??
    (isFiniteNumber(totalHkd) && isFiniteNumber(performanceTotalUsd) && performanceTotalUsd !== 0
      ? totalHkd / performanceTotalUsd
      : null);

  if (
    !isFiniteNumber(performanceTotalUsd) ||
    !isFiniteNumber(totalHkd) ||
    !isFiniteNumber(currentNetUsd) ||
    !isFiniteNumber(cumulativeWithdrawnUsd) ||
    !isFiniteNumber(principalHkd) ||
    !isFiniteNumber(returnHkd) ||
    !isFiniteNumber(returnPct) ||
    !isFiniteNumber(usdHkdRate)
  ) {
    throw new Error(`Required numeric fields are incomplete for ${record.sourceSheet} ${month}.`);
  }

  const snapshotBase = {
    id: `monthly-${month}`,
    month,
    snapshotDate,
    snapshotTimestamp:
      record.sourceType === 'locked_month_log'
        ? excelSerialToHongKongIso(record.rawSnapshotDateSerial)
        : `${snapshotDate}T00:00:00+08:00`,
    locked: true,
    currentNetUsd,
    cumulativeWithdrawnUsd,
    performanceTotalUsd,
    totalHkd,
    btcEquivalent,
    principalHkd,
    returnHkd,
    returnPct,
    monthOverMonthPct: isFiniteNumber(monthOverMonthPct) ? monthOverMonthPct : null,
    usdHkdRate,
    allocations: normalizeAllocations(
      record.sourceType === 'locked_month_log'
        ? {
            BTC佔比: rawValues.BTC佔比,
            ETH佔比: rawValues.ETH佔比,
            ADA佔比: rawValues.ADA佔比,
            USDT佔比: rawValues.USDT佔比,
            其他佔比: rawValues.其他佔比,
          }
        : rawValues.allocations,
    ),
    historicalHoldings: normalizePlatformValues(rawValues.platformValuesUsd),
    historicalQuantities: normalizeQuantities(rawValues.quantities),
    prices,
    liabilities: [],
    sourceSpreadsheetId: record.sourceSpreadsheetId,
    sourceSpreadsheetTitle: source.sourceSpreadsheetTitle,
    sourceSheet: record.sourceSheet,
    sourceRange: record.sourceRange,
    sourceType: record.sourceType,
    importBatchId: source.importBatchId,
    rawSourceValues: rawValues,
  };
  const warnings = buildRecordWarnings(record, snapshotBase);
  const hasErrorWarning = warnings.some((warning) => warning.severity === 'error');
  const hasCompleteAllocation = Object.keys(snapshotBase.allocations).length === 5;
  const hasHoldingDetails =
    snapshotBase.historicalHoldings.length > 0 &&
    snapshotBase.historicalQuantities.length > 0;
  const dataQuality = hasErrorWarning
    ? 'attention'
    : hasCompleteAllocation && hasHoldingDetails
      ? 'verified'
      : 'partial';
  const snapshot = {
    ...snapshotBase,
    dataQuality,
    warnings,
  };

  return {
    ...snapshot,
    sourceChecksum: createChecksum(snapshot),
  };
}

export function buildCryptoMonthlySnapshots(source) {
  const snapshots = source.records
    .map((record) => normalizeRecord(record, source))
    .sort((left, right) => left.month.localeCompare(right.month));
  const seen = new Map();

  for (const snapshot of snapshots) {
    const existing = seen.get(snapshot.month);
    if (existing) {
      throw new Error(
        `Duplicate month ${snapshot.month}: ${existing.sourceSheet} and ${snapshot.sourceSheet}.`,
      );
    }
    seen.set(snapshot.month, snapshot);
  }

  return snapshots;
}

function validateNumericField(snapshot, report, config) {
  const actual = config.actual(snapshot);
  const expected = config.expected(snapshot);
  const difference = Math.abs(actual - expected);

  if (difference > config.tolerance) {
    report.errors.push({
      month: snapshot.month,
      code: config.code,
      message: config.message,
      actual: roundForReport(actual),
      expected: roundForReport(expected),
      difference: roundForReport(difference),
      tolerance: config.tolerance,
    });
  }
}

function listMissingMonths(firstMonth, lastMonth, existingMonths) {
  const missing = [];
  let [year, month] = firstMonth.split('-').map(Number);
  const [lastYear, lastMonthNumber] = lastMonth.split('-').map(Number);

  while (year < lastYear || (year === lastYear && month <= lastMonthNumber)) {
    const key = `${year}-${String(month).padStart(2, '0')}`;
    if (!existingMonths.has(key)) {
      missing.push(key);
    }
    month += 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
  }

  return missing;
}

export function validateCryptoMonthlySnapshots(snapshots) {
  const report = {
    valid: true,
    snapshotCount: snapshots.length,
    firstMonth: snapshots[0]?.month ?? null,
    lastMonth: snapshots.at(-1)?.month ?? null,
    errors: [],
    warnings: [],
    warningCount: 0,
    monthsByYear: {},
    missingMonthsWithinRange: [],
  };

  for (const snapshot of snapshots) {
    validateNumericField(snapshot, report, {
      code: 'TOTAL_HKD_MISMATCH',
      message: 'HKD 總值與 USD 總值 × 匯率超出 HK$1 容許範圍。',
      actual: (item) => item.totalHkd,
      expected: (item) => item.performanceTotalUsd * item.usdHkdRate,
      tolerance: MONEY_TOLERANCE_HKD,
    });
    validateNumericField(snapshot, report, {
      code: 'RETURN_HKD_MISMATCH',
      message: '總回報與總值減本金超出 HK$1 容許範圍。',
      actual: (item) => item.returnHkd,
      expected: (item) => item.totalHkd - item.principalHkd,
      tolerance: MONEY_TOLERANCE_HKD,
    });
    validateNumericField(snapshot, report, {
      code: 'RETURN_PCT_MISMATCH',
      message: '總回報率超出 0.01 個百分點容許範圍。',
      actual: (item) => item.returnPct,
      expected: (item) => item.returnHkd / item.principalHkd,
      tolerance: PERCENTAGE_TOLERANCE,
    });

    const allocationValues = Object.values(snapshot.allocations);
    if (allocationValues.length === 5) {
      const allocationTotal = allocationValues.reduce((sum, value) => sum + value, 0);
      if (Math.abs(allocationTotal - 1) > 0.0001) {
        report.errors.push({
          month: snapshot.month,
          code: 'ALLOCATION_TOTAL_MISMATCH',
          message: '五項資產分佈比例合計不是 100%。',
          actual: roundForReport(allocationTotal),
          expected: 1,
          difference: roundForReport(Math.abs(allocationTotal - 1)),
          tolerance: 0.0001,
        });
      }
    }

    const year = snapshot.month.slice(0, 4);
    report.monthsByYear[year] = (report.monthsByYear[year] ?? 0) + 1;
    report.warnings.push(
      ...snapshot.warnings.map((warning) => ({
        month: snapshot.month,
        ...warning,
      })),
    );
  }

  if (report.firstMonth && report.lastMonth) {
    report.missingMonthsWithinRange = listMissingMonths(
      report.firstMonth,
      report.lastMonth,
      new Set(snapshots.map((snapshot) => snapshot.month)),
    );
  }

  report.warningCount = report.warnings.filter(
    (warning) => warning.severity === 'warning' || warning.severity === 'error',
  ).length;
  report.valid = report.errors.length === 0;
  return report;
}

function comparableSnapshot(snapshot) {
  const {
    importedAt,
    updatedAt,
    ...sourceFields
  } = snapshot;
  return sourceFields;
}

export function compareExistingSnapshots(snapshots, existingById) {
  const creates = [];
  const skips = [];
  const conflicts = [];

  for (const snapshot of snapshots) {
    const existing = existingById.get(snapshot.id);
    if (!existing) {
      creates.push(snapshot);
      continue;
    }

    if (existing.sourceChecksum === snapshot.sourceChecksum) {
      skips.push(snapshot);
      continue;
    }

    const allKeys = new Set([
      ...Object.keys(comparableSnapshot(existing)),
      ...Object.keys(comparableSnapshot(snapshot)),
    ]);
    const differences = [...allKeys]
      .sort()
      .filter(
        (key) =>
          canonicalJson(comparableSnapshot(existing)[key]) !==
          canonicalJson(comparableSnapshot(snapshot)[key]),
      )
      .map((key) => ({
        field: key,
        existing: comparableSnapshot(existing)[key] ?? null,
        incoming: comparableSnapshot(snapshot)[key] ?? null,
      }));

    conflicts.push({
      id: snapshot.id,
      month: snapshot.month,
      differences,
    });
  }

  return { creates, skips, conflicts };
}

export const cryptoHistoryValidationTolerances = {
  moneyHkd: MONEY_TOLERANCE_HKD,
  percentage: PERCENTAGE_TOLERANCE,
};
