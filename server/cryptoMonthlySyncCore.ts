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

export interface CryptoSyncValidationMonth {
  month: string;
  sourceRange: string;
  fieldCount: number;
  action: 'create' | 'skip' | 'conflict';
  sourceChecksum: string;
  warningCodes: string[];
  differingFields: string[];
}

export interface CryptoSyncValidationReport {
  validationPassed: boolean;
  expectedFieldCount: number;
  validatedMonthCount: number;
  validatedFields: string[];
  months: CryptoSyncValidationMonth[];
}

export interface CryptoSyncSourceContext {
  spreadsheetId: string;
  spreadsheetTitle: string;
  sheetName?: '月結記錄';
}

export interface CryptoShadowAssetInput {
  id: string;
  name: string;
  symbol: string;
  assetType: string;
  accountSource: string;
  currency: string;
  quantity: number;
  currentPrice: number;
}

export interface CryptoAssetShadowPosition {
  symbol: string;
  sourceLabel: string;
  sourceValueUsd: number;
  currentValueUsd: number;
  differenceUsd: number;
  sourceQuantity: number | null;
  currentQuantity: number;
  sourcePriceUsd: number | null;
  isLiability: boolean;
}

export interface CryptoAssetShadowPreview {
  mode: 'shadow_preview';
  status: 'ready' | 'review_required';
  month: string;
  accountSource: 'Crypto';
  sourceReadOnly: true;
  firestoreWriteAllowed: false;
  writesPerformed: 0;
  targetTotalUsd: number;
  targetTotalHkd: number;
  currentAccountTotalUsd: number;
  currentAccountTotalHkd: number;
  differenceUsd: number;
  differenceHkd: number;
  detailPositionSubtotalUsd: number;
  detailToTargetDifferenceUsd: number;
  separateWithdrawalsUsd: number;
  usdHkdRate: number;
  cryptoAssetCount: number;
  excludedFutuAssetCount: number;
  excludedFutuValueUsd: number;
  sourceDetailRange: string;
  positions: CryptoAssetShadowPosition[];
  checks: Array<{
    code: string;
    passed: boolean;
    severity: 'info' | 'warning' | 'error';
    message: string;
  }>;
}

export class CryptoMonthlySyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoMonthlySyncValidationError';
  }
}

function readOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/,/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function getShadowAssetLocalValue(asset: CryptoShadowAssetInput) {
  return asset.assetType === 'cash'
    ? asset.currentPrice
    : asset.quantity * asset.currentPrice;
}

function getShadowAssetUsdValue(asset: CryptoShadowAssetInput, usdHkdRate: number) {
  const value = getShadowAssetLocalValue(asset);
  const currency = asset.currency.trim().toUpperCase();
  if (currency === 'HKD') return value / usdHkdRate;
  if (currency === 'USD' || currency === 'USDT' || currency === 'USDC') return value;
  return null;
}

/**
 * Builds a zero-write comparison between the locked monthly source and the
 * Firestore Crypto account. Futu is deliberately measured only as an excluded
 * control group and never enters the Crypto account totals.
 */
export function buildCryptoAssetShadowPreview(
  snapshot: CryptoSyncSnapshot,
  detailValues: unknown[][],
  assets: CryptoShadowAssetInput[],
  sourceDetailRange: string,
): CryptoAssetShadowPreview {
  const monthHeaderIndex = detailValues.findIndex((row) => String(row[0] ?? '').trim() === '資產');
  if (monthHeaderIndex < 0 || monthHeaderIndex + 1 >= detailValues.length) {
    throw new CryptoMonthlySyncValidationError('影子對數找不到 2026_V2 的月結持倉標題。');
  }

  const detailMonth = readMonth(detailValues[monthHeaderIndex][4], monthHeaderIndex + 38);
  const statusText = String(detailValues[0]?.[1] ?? '').trim();
  const detailRows = detailValues.slice(monthHeaderIndex + 2);
  const sourcePositions: Array<{
    symbol: string;
    sourceLabel: string;
    sourceValueUsd: number;
    sourceQuantity: number | null;
    sourcePriceUsd: number | null;
    isLiability: boolean;
  }> = [];

  for (const row of detailRows) {
    const label = String(row[0] ?? '').trim();
    if (!label || label === 'totel(USD)') break;
    const value = readOptionalNumber(row[6]);
    const symbol = label.replace(/\s*負債\s*$/, '').trim().toUpperCase();
    if (!symbol) continue;
    sourcePositions.push({
      symbol,
      sourceLabel: label,
      sourceValueUsd: value ?? 0,
      sourceQuantity: readOptionalNumber(row[5]),
      sourcePriceUsd: readOptionalNumber(row[4]),
      isLiability: /負債/.test(label) || (value ?? 0) < 0,
    });
  }

  if (sourcePositions.length === 0) {
    throw new CryptoMonthlySyncValidationError('影子對數找不到任何月結持倉明細。');
  }

  const cryptoAssets = assets.filter((asset) => asset.accountSource === 'Crypto');
  const excludedFutuAssets = assets.filter(
    (asset) => asset.accountSource === 'Futu' && asset.assetType === 'crypto',
  );
  const unsupportedCryptoCurrencies = new Set<string>();
  const currentBySymbol = new Map<string, { valueUsd: number; quantity: number }>();

  for (const asset of cryptoAssets) {
    const valueUsd = getShadowAssetUsdValue(asset, snapshot.usdHkdRate);
    if (valueUsd == null) {
      unsupportedCryptoCurrencies.add(asset.currency);
      continue;
    }
    const symbol = asset.symbol.trim().toUpperCase() || asset.name.trim().toUpperCase();
    const existing = currentBySymbol.get(symbol) ?? { valueUsd: 0, quantity: 0 };
    currentBySymbol.set(symbol, {
      valueUsd: existing.valueUsd + valueUsd,
      quantity: existing.quantity + asset.quantity,
    });
  }

  const sourceBySymbol = new Map<string, typeof sourcePositions>();
  for (const position of sourcePositions) {
    const entries = sourceBySymbol.get(position.symbol) ?? [];
    entries.push(position);
    sourceBySymbol.set(position.symbol, entries);
  }
  const symbols = [...new Set([...sourceBySymbol.keys(), ...currentBySymbol.keys()])].sort();
  const positions = symbols.map((symbol) => {
    const sourceEntries = sourceBySymbol.get(symbol) ?? [];
    const sourceValueUsd = sourceEntries.reduce((sum, item) => sum + item.sourceValueUsd, 0);
    const current = currentBySymbol.get(symbol) ?? { valueUsd: 0, quantity: 0 };
    return {
      symbol,
      sourceLabel: sourceEntries.map((item) => item.sourceLabel).join(' + ') || symbol,
      sourceValueUsd,
      currentValueUsd: current.valueUsd,
      differenceUsd: sourceValueUsd - current.valueUsd,
      sourceQuantity: sourceEntries.length === 1 ? sourceEntries[0].sourceQuantity : null,
      currentQuantity: current.quantity,
      sourcePriceUsd: sourceEntries.length === 1 ? sourceEntries[0].sourcePriceUsd : null,
      isLiability: sourceEntries.some((item) => item.isLiability),
    };
  });
  const detailPositionSubtotalUsd = sourcePositions.reduce(
    (sum, position) => sum + position.sourceValueUsd,
    0,
  );
  const currentAccountTotalUsd = [...currentBySymbol.values()].reduce(
    (sum, item) => sum + item.valueUsd,
    0,
  );
  const excludedFutuValueUsd = excludedFutuAssets.reduce((sum, asset) => {
    return sum + (getShadowAssetUsdValue(asset, snapshot.usdHkdRate) ?? 0);
  }, 0);
  const detailToTargetDifferenceUsd = snapshot.performanceTotalUsd - detailPositionSubtotalUsd;
  const detailMatchesTarget = Math.abs(detailToTargetDifferenceUsd) <= MONEY_TOLERANCE_USD;
  const detailDifferenceMatchesWithdrawals =
    Math.abs(detailToTargetDifferenceUsd - snapshot.cumulativeWithdrawnUsd) <= MONEY_TOLERANCE_USD;
  const monthMatches = detailMonth === snapshot.month;
  const sourceLocked = statusText.includes(snapshot.month) && /已鎖定快照/.test(statusText);
  const fxMatches = Math.abs(snapshot.totalHkd - snapshot.performanceTotalUsd * snapshot.usdHkdRate) <= MONEY_TOLERANCE_HKD;
  const hasUnsupportedCurrency = unsupportedCryptoCurrencies.size > 0;

  const checks: CryptoAssetShadowPreview['checks'] = [
    {
      code: 'LOCKED_MONTH_MATCH',
      passed: monthMatches && sourceLocked,
      severity: monthMatches && sourceLocked ? 'info' : 'error',
      message: monthMatches && sourceLocked
        ? `${snapshot.month} 月結持倉區塊已鎖定，並與 19 欄月結記錄一致。`
        : `月結持倉區塊月份或鎖定狀態不一致（明細 ${detailMonth}）。`,
    },
    {
      code: 'CRYPTO_ACCOUNT_ONLY',
      passed: true,
      severity: 'info',
      message: `只計 accountSource=Crypto；已排除 ${excludedFutuAssets.length} 項 Futu Crypto。`,
    },
    {
      code: 'WITHDRAWALS_SEPARATE',
      passed: true,
      severity: 'info',
      message: `HK$${Math.round(snapshot.totalHkd).toLocaleString('en-US')} 直接作 Crypto 帳戶目標；提取／消費 US$${snapshot.cumulativeWithdrawnUsd.toFixed(2)} 獨立顯示，沒有從目標扣減。`,
    },
    {
      code: 'DETAIL_SUBTOTAL_RECONCILIATION',
      passed: detailMatchesTarget,
      severity: detailMatchesTarget ? 'info' : 'warning',
      message: detailMatchesTarget
        ? '逐項持倉明細與月結總值一致。'
        : `逐項持倉合計較月結總值少 US$${detailToTargetDifferenceUsd.toFixed(2)}${detailDifferenceMatchesWithdrawals ? '，金額剛好等於獨立提取／消費記錄；正式逐項同步前仍需確認差額歸屬。' : '，正式逐項同步前必須先核對。'}`,
    },
    {
      code: 'TOTAL_FX_RECONCILIATION',
      passed: fxMatches,
      severity: fxMatches ? 'info' : 'error',
      message: fxMatches ? '月結 USD 總值按鎖定匯率換算後與 HKD 總值一致。' : '月結 USD/HKD 總值未能對數。',
    },
    {
      code: 'SUPPORTED_ACCOUNT_CURRENCIES',
      passed: !hasUnsupportedCurrency,
      severity: hasUnsupportedCurrency ? 'error' : 'info',
      message: hasUnsupportedCurrency
        ? `Crypto 帳戶包含未支援貨幣：${[...unsupportedCryptoCurrencies].join('、')}。`
        : 'Crypto 帳戶貨幣可用月結匯率安全比較。',
    },
    {
      code: 'ZERO_WRITE_PREVIEW',
      passed: true,
      severity: 'info',
      message: '今次只建立預覽；Firestore、Google Sheet、交易及每日快照寫入次數全部為 0。',
    },
  ];
  const hasBlockingError = checks.some((check) => !check.passed && check.severity === 'error');

  return {
    mode: 'shadow_preview',
    status: hasBlockingError || !detailMatchesTarget ? 'review_required' : 'ready',
    month: snapshot.month,
    accountSource: 'Crypto',
    sourceReadOnly: true,
    firestoreWriteAllowed: false,
    writesPerformed: 0,
    targetTotalUsd: snapshot.performanceTotalUsd,
    targetTotalHkd: snapshot.totalHkd,
    currentAccountTotalUsd,
    currentAccountTotalHkd: currentAccountTotalUsd * snapshot.usdHkdRate,
    differenceUsd: snapshot.performanceTotalUsd - currentAccountTotalUsd,
    differenceHkd: snapshot.totalHkd - currentAccountTotalUsd * snapshot.usdHkdRate,
    detailPositionSubtotalUsd,
    detailToTargetDifferenceUsd,
    separateWithdrawalsUsd: snapshot.cumulativeWithdrawnUsd,
    usdHkdRate: snapshot.usdHkdRate,
    cryptoAssetCount: cryptoAssets.length,
    excludedFutuAssetCount: excludedFutuAssets.length,
    excludedFutuValueUsd,
    sourceDetailRange,
    positions,
    checks,
  };
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

    if (differingFields.length === 0) {
      plan.skips.push(snapshot);
      continue;
    }

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

export function buildCryptoSyncValidationReport(
  snapshots: CryptoSyncSnapshot[],
  plan: CryptoSyncPlan,
): CryptoSyncValidationReport {
  const createMonths = new Set(plan.creates.map((snapshot) => snapshot.month));
  const conflictByMonth = new Map(
    plan.conflicts.map((conflict) => [conflict.month, conflict]),
  );

  return {
    validationPassed: plan.conflicts.length === 0,
    expectedFieldCount: CRYPTO_MONTH_LOG_HEADERS.length,
    validatedMonthCount: snapshots.length,
    validatedFields: [...CRYPTO_MONTH_LOG_HEADERS],
    months: snapshots.map((snapshot) => {
      const conflict = conflictByMonth.get(snapshot.month);
      return {
        month: snapshot.month,
        sourceRange: snapshot.sourceRange,
        fieldCount: Object.keys(snapshot.rawSourceValues).length,
        action: conflict
          ? 'conflict'
          : createMonths.has(snapshot.month)
            ? 'create'
            : 'skip',
        sourceChecksum: snapshot.sourceChecksum,
        warningCodes: snapshot.warnings.map((warning) => warning.code),
        differingFields: conflict?.differingFields ?? [],
      };
    }),
  };
}

export function getCryptoSyncSourceChecksum(snapshots: CryptoSyncSnapshot[]) {
  return createCryptoSyncChecksum(
    snapshots.map((snapshot) => ({
      month: snapshot.month,
      sourceChecksum: snapshot.sourceChecksum,
    })),
  );
}

export function getCryptoHistoricalAuditMonths(
  snapshots: CryptoSyncSnapshot[],
  createdMonths: string[],
  latestImportedMonth: string | null,
) {
  const months = new Set(createdMonths);

  for (const snapshot of snapshots) {
    if (!latestImportedMonth || snapshot.month > latestImportedMonth) {
      months.add(snapshot.month);
    }
  }

  return [...months].sort((left, right) => left.localeCompare(right));
}
