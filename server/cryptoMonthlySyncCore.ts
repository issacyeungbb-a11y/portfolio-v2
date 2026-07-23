import { createHash } from 'node:crypto';

const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86_400_000;
const MONEY_TOLERANCE_HKD = 1;
const MONEY_TOLERANCE_USD = 0.01;
const PERCENTAGE_TOLERANCE = 0.0001;

export const CRYPTO_MONTH_LOG_HEADERS = [
  '月份',
  '快照時間',
  'totel(USD)',
  'totel(HKD)',
  'bitcoin總值',
  '本金',
  '總回報率',
  '總回報（HKD）',
  '上月同比',
  'BTC佔比',
  'ETH佔比',
  'ADA佔比',
  'USDT佔比',
  '其他佔比',
  '現有totel(USD)',
  '已提取／消費（累計USD）',
  'USD/HKD匯率',
  '價格來源',
  '例外／備註',
] as const;

export interface CryptoSyncWarning {
  code: string;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface CryptoSyncSnapshot {
  id: string;
  month: string;
  snapshotDate: string;
  snapshotTimestamp: string;
  locked: true;
  currentNetUsd: number;
  cumulativeWithdrawnUsd: number;
  performanceTotalUsd: number;
  totalHkd: number;
  btcEquivalent: number;
  principalHkd: number;
  returnHkd: number;
  returnPct: number;
  monthOverMonthPct: number;
  usdHkdRate: number;
  allocations: {
    BTC: number;
    ETH: number;
    ADA: number;
    USDT: number;
    OTHER: number;
  };
  historicalHoldings: [];
  historicalQuantities: [];
  prices: [];
  liabilities: [];
  sourceSpreadsheetId: string;
  sourceSpreadsheetTitle: string;
  sourceSheet: '月結記錄';
  sourceRange: string;
  sourceType: 'locked_month_log';
  importBatchId: string;
  sourceChecksum: string;
  dataQuality: 'partial' | 'attention';
  warnings: CryptoSyncWarning[];
  rawSourceValues: Record<string, unknown>;
}

export interface CryptoSyncConflict {
  id: string;
  month: string;
  existingChecksum: string | null;
  incomingChecksum: string;
  differingFields: string[];
}

export interface CryptoSyncPlan {
  creates: CryptoSyncSnapshot[];
  skips: CryptoSyncSnapshot[];
  conflicts: CryptoSyncConflict[];
}

export interface CryptoSyncSourceContext {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName?: '月結記錄';
}

export class CryptoMonthlySyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoMonthlySyncValidationError';
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }

  return value;
}

export function createCryptoSyncChecksum(value: unknown) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function excelSerialToIso(serial: number) {
  if (!Number.isFinite(serial)) {
    throw new CryptoMonthlySyncValidationError(`無效的試算表日期序號：${String(serial)}`);
  }

  const timestampMs = EXCEL_EPOCH_MS + serial * DAY_MS;
  return new Date(Math.round(timestampMs / 1000) * 1000).toISOString();
}

function readMonth(value: unknown, rowNumber: number) {
  if (typeof value === 'number') {
    return excelSerialToIso(Math.floor(value)).slice(0, 7);
  }

  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})[-/]([01]?\d)(?:[-/]\d{1,2})?$/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, '0')}`;
    }
  }

  throw new CryptoMonthlySyncValidationError(`月結記錄第 ${rowNumber} 行的月份無效。`);
}

function readTimestamp(value: unknown, rowNumber: number) {
  if (typeof value === 'number') {
    const localWallTime = excelSerialToIso(value).slice(0, 19);
    return `${localWallTime}+08:00`;
  }

  if (typeof value === 'string' && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }

  throw new CryptoMonthlySyncValidationError(`月結記錄第 ${rowNumber} 行的快照時間無效。`);
}

function readNumber(value: unknown, label: string, rowNumber: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, '').trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  throw new CryptoMonthlySyncValidationError(
    `月結記錄第 ${rowNumber} 行的「${label}」不是有效數字。`,
  );
}

function validateHeaders(row: unknown[]) {
  const actual = CRYPTO_MONTH_LOG_HEADERS.map((_, index) => String(row[index] ?? '').trim());
  const differences = CRYPTO_MONTH_LOG_HEADERS.flatMap((expected, index) =>
    actual[index] === expected
      ? []
      : [`${String.fromCharCode(65 + index)}欄預期「${expected}」，實際「${actual[index] || '空白'}」`],
  );

  if (differences.length > 0) {
    throw new CryptoMonthlySyncValidationError(
      `「月結記錄」欄位結構已改變：${differences.join('；')}`,
    );
  }
}

function buildWarnings(priceSource: string, note: string): CryptoSyncWarning[] {
  const warnings: CryptoSyncWarning[] = [
    {
      code: 'LOCKED_MONTH_NO_HOLDING_BREAKDOWN',
      message: '鎖定月結只有標準化總值與分佈，沒有逐平台持倉明細。',
      severity: 'warning',
    },
  ];

  if (!priceSource) {
    warnings.push({
      code: 'MISSING_PRICE_SOURCE',
      message: '月結記錄沒有價格來源說明。',
      severity: 'warning',
    });
  } else if (/手動|manual/i.test(priceSource)) {
    warnings.push({
      code: 'MANUAL_PRICE_SOURCE',
      message: `價格來源包含手動價格：${priceSource}`,
      severity: 'warning',
    });
  }

  if (note) {
    warnings.push({
      code: 'SOURCE_NOTE',
      message: note,
      severity: 'info',
    });
  }

  return warnings;
}

function validateSnapshot(snapshot: CryptoSyncSnapshot, rowNumber: number) {
  if (
    Math.abs(snapshot.totalHkd - snapshot.performanceTotalUsd * snapshot.usdHkdRate) >
    MONEY_TOLERANCE_HKD
  ) {
    throw new CryptoMonthlySyncValidationError(
      `月結記錄第 ${rowNumber} 行的 HKD 總值超出 HK$1 驗證容許範圍。`,
    );
  }

  if (Math.abs(snapshot.returnHkd - (snapshot.totalHkd - snapshot.principalHkd)) > MONEY_TOLERANCE_HKD) {
    throw new CryptoMonthlySyncValidationError(
      `月結記錄第 ${rowNumber} 行的回報金額超出 HK$1 驗證容許範圍。`,
    );
  }

  const expectedReturnPct = snapshot.principalHkd === 0
    ? 0
    : snapshot.returnHkd / snapshot.principalHkd;
  if (Math.abs(snapshot.returnPct - expectedReturnPct) > PERCENTAGE_TOLERANCE) {
    throw new CryptoMonthlySyncValidationError(
      `月結記錄第 ${rowNumber} 行的回報率超出 0.01 個百分點驗證容許範圍。`,
    );
  }

  if (
    Math.abs(
      snapshot.currentNetUsd +
        snapshot.cumulativeWithdrawnUsd -
        snapshot.performanceTotalUsd,
    ) > MONEY_TOLERANCE_USD
  ) {
    throw new CryptoMonthlySyncValidationError(
      `月結記錄第 ${rowNumber} 行的現有淨值與累計提取未能對上總值。`,
    );
  }

  const allocationTotal = Object.values(snapshot.allocations).reduce(
    (sum, value) => sum + value,
    0,
  );
  if (Math.abs(allocationTotal - 1) > PERCENTAGE_TOLERANCE) {
    throw new CryptoMonthlySyncValidationError(
      `月結記錄第 ${rowNumber} 行的資產比例總和不是 100%。`,
    );
  }
}

function buildSnapshot(
  row: unknown[],
  rowNumber: number,
  context: CryptoSyncSourceContext,
): CryptoSyncSnapshot {
  const rawSourceValues = Object.fromEntries(
    CRYPTO_MONTH_LOG_HEADERS.map((header, index) => [header, row[index] ?? null]),
  );
  const month = readMonth(row[0], rowNumber);
  const snapshotTimestamp = readTimestamp(row[1], rowNumber);
  const priceSource = typeof row[17] === 'string' ? row[17].trim() : '';
  const note = typeof row[18] === 'string' ? row[18].trim() : '';
  const sourceChecksum = createCryptoSyncChecksum({
    spreadsheetId: context.spreadsheetId,
    sourceSheet: context.sheetName ?? '月結記錄',
    sourceRange: `A${rowNumber}:S${rowNumber}`,
    rawSourceValues,
  });
  const warnings = buildWarnings(priceSource, note);
  const snapshot: CryptoSyncSnapshot = {
    id: `monthly-${month}`,
    month,
    snapshotDate: snapshotTimestamp.slice(0, 10),
    snapshotTimestamp,
    locked: true,
    performanceTotalUsd: readNumber(row[2], 'totel(USD)', rowNumber),
    totalHkd: readNumber(row[3], 'totel(HKD)', rowNumber),
    btcEquivalent: readNumber(row[4], 'bitcoin總值', rowNumber),
    principalHkd: readNumber(row[5], '本金', rowNumber),
    returnPct: readNumber(row[6], '總回報率', rowNumber),
    returnHkd: readNumber(row[7], '總回報（HKD）', rowNumber),
    monthOverMonthPct: readNumber(row[8], '上月同比', rowNumber),
    allocations: {
      BTC: readNumber(row[9], 'BTC佔比', rowNumber),
      ETH: readNumber(row[10], 'ETH佔比', rowNumber),
      ADA: readNumber(row[11], 'ADA佔比', rowNumber),
      USDT: readNumber(row[12], 'USDT佔比', rowNumber),
      OTHER: readNumber(row[13], '其他佔比', rowNumber),
    },
    currentNetUsd: readNumber(row[14], '現有totel(USD)', rowNumber),
    cumulativeWithdrawnUsd: readNumber(row[15], '已提取／消費（累計USD）', rowNumber),
    usdHkdRate: readNumber(row[16], 'USD/HKD匯率', rowNumber),
    historicalHoldings: [],
    historicalQuantities: [],
    prices: [],
    liabilities: [],
    sourceSpreadsheetId: context.spreadsheetId,
    sourceSpreadsheetTitle: context.spreadsheetTitle,
    sourceSheet: context.sheetName ?? '月結記錄',
    sourceRange: `A${rowNumber}:S${rowNumber}`,
    sourceType: 'locked_month_log',
    importBatchId: `crypto-sync-${month}-${sourceChecksum.slice(0, 12)}`,
    sourceChecksum,
    dataQuality: warnings.some((warning) => warning.severity === 'error')
      ? 'attention'
      : 'partial',
    warnings,
    rawSourceValues,
  };

  validateSnapshot(snapshot, rowNumber);
  return snapshot;
}

export function parseCryptoMonthLogRows(
  values: unknown[][],
  context: CryptoSyncSourceContext,
) {
  if (values.length === 0) {
    throw new CryptoMonthlySyncValidationError('「月結記錄」沒有標題列。');
  }

  validateHeaders(values[0]);
  const snapshots = values
    .slice(1)
    .flatMap((row, index) =>
      row.some((value) => value !== null && value !== undefined && value !== '')
        ? [buildSnapshot(row, index + 2, context)]
        : [],
    )
    .sort((left, right) => left.month.localeCompare(right.month));
  const seenMonths = new Set<string>();

  for (const snapshot of snapshots) {
    if (seenMonths.has(snapshot.month)) {
      throw new CryptoMonthlySyncValidationError(
        `「月結記錄」包含重複月份 ${snapshot.month}，同步已停止。`,
      );
    }
    seenMonths.add(snapshot.month);
  }

  return snapshots;
}

const COMPARISON_FIELDS = [
  'snapshotTimestamp',
  'currentNetUsd',
  'cumulativeWithdrawnUsd',
  'performanceTotalUsd',
  'totalHkd',
  'btcEquivalent',
  'principalHkd',
  'returnHkd',
  'returnPct',
  'monthOverMonthPct',
  'usdHkdRate',
  'allocations',
  'rawSourceValues',
] as const;

export function buildCryptoSyncPlan(
  snapshots: CryptoSyncSnapshot[],
  existingById: Map<string, Record<string, unknown>>,
): CryptoSyncPlan {
  const plan: CryptoSyncPlan = { creates: [], skips: [], conflicts: [] };

  for (const snapshot of snapshots) {
    const existing = existingById.get(snapshot.id);
    if (!existing) {
      plan.creates.push(snapshot);
      continue;
    }

    if (existing.sourceChecksum === snapshot.sourceChecksum) {
      plan.skips.push(snapshot);
      continue;
    }

    const differingFields = COMPARISON_FIELDS.filter(
      (field) =>
        JSON.stringify(canonicalize(existing[field])) !==
        JSON.stringify(canonicalize(snapshot[field])),
    );
    plan.conflicts.push({
      id: snapshot.id,
      month: snapshot.month,
      existingChecksum:
        typeof existing.sourceChecksum === 'string' ? existing.sourceChecksum : null,
      incomingChecksum: snapshot.sourceChecksum,
      differingFields,
    });
  }

  return plan;
}

export function getCryptoSyncSourceChecksum(snapshots: CryptoSyncSnapshot[]) {
  return createCryptoSyncChecksum(
    snapshots.map((snapshot) => ({
      month: snapshot.month,
      sourceChecksum: snapshot.sourceChecksum,
    })),
  );
}
