import { createHash } from "node:crypto";
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 864e5;
const MONEY_TOLERANCE_HKD = 1;
const MONEY_TOLERANCE_USD = 0.01;
const PERCENTAGE_TOLERANCE = 1e-4;
const CRYPTO_MONTH_LOG_HEADERS = [
  "\u6708\u4EFD",
  "\u5FEB\u7167\u6642\u9593",
  "totel(USD)",
  "totel(HKD)",
  "bitcoin\u7E3D\u503C",
  "\u672C\u91D1",
  "\u7E3D\u56DE\u5831\u7387",
  "\u7E3D\u56DE\u5831\uFF08HKD\uFF09",
  "\u4E0A\u6708\u540C\u6BD4",
  "BTC\u4F54\u6BD4",
  "ETH\u4F54\u6BD4",
  "ADA\u4F54\u6BD4",
  "USDT\u4F54\u6BD4",
  "\u5176\u4ED6\u4F54\u6BD4",
  "\u73FE\u6709totel(USD)",
  "\u5DF2\u63D0\u53D6\uFF0F\u6D88\u8CBB\uFF08\u7D2F\u8A08USD\uFF09",
  "USD/HKD\u532F\u7387",
  "\u50F9\u683C\u4F86\u6E90",
  "\u4F8B\u5916\uFF0F\u5099\u8A3B"
];
class CryptoMonthlySyncValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "CryptoMonthlySyncValidationError";
  }
}
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}
function createCryptoSyncChecksum(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}
function excelSerialToIso(serial) {
  if (!Number.isFinite(serial)) {
    throw new CryptoMonthlySyncValidationError(`\u7121\u6548\u7684\u8A66\u7B97\u8868\u65E5\u671F\u5E8F\u865F\uFF1A${String(serial)}`);
  }
  const timestampMs = EXCEL_EPOCH_MS + serial * DAY_MS;
  return new Date(Math.round(timestampMs / 1e3) * 1e3).toISOString();
}
function readMonth(value, rowNumber) {
  if (typeof value === "number") {
    return excelSerialToIso(Math.floor(value)).slice(0, 7);
  }
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4})[-/]([01]?\d)(?:[-/]\d{1,2})?$/);
    if (match) {
      return `${match[1]}-${match[2].padStart(2, "0")}`;
    }
  }
  throw new CryptoMonthlySyncValidationError(`\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u6708\u4EFD\u7121\u6548\u3002`);
}
function readTimestamp(value, rowNumber) {
  if (typeof value === "number") {
    const localWallTime = excelSerialToIso(value).slice(0, 19);
    return `${localWallTime}+08:00`;
  }
  if (typeof value === "string" && !Number.isNaN(new Date(value).getTime())) {
    return new Date(value).toISOString();
  }
  throw new CryptoMonthlySyncValidationError(`\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u5FEB\u7167\u6642\u9593\u7121\u6548\u3002`);
}
function readNumber(value, label, rowNumber) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "").trim());
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new CryptoMonthlySyncValidationError(
    `\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u300C${label}\u300D\u4E0D\u662F\u6709\u6548\u6578\u5B57\u3002`
  );
}
function validateHeaders(row) {
  const actual = CRYPTO_MONTH_LOG_HEADERS.map((_, index) => String(row[index] ?? "").trim());
  const differences = CRYPTO_MONTH_LOG_HEADERS.flatMap(
    (expected, index) => actual[index] === expected ? [] : [`${String.fromCharCode(65 + index)}\u6B04\u9810\u671F\u300C${expected}\u300D\uFF0C\u5BE6\u969B\u300C${actual[index] || "\u7A7A\u767D"}\u300D`]
  );
  if (differences.length > 0) {
    throw new CryptoMonthlySyncValidationError(
      `\u300C\u6708\u7D50\u8A18\u9304\u300D\u6B04\u4F4D\u7D50\u69CB\u5DF2\u6539\u8B8A\uFF1A${differences.join("\uFF1B")}`
    );
  }
}
function buildWarnings(priceSource, note) {
  const warnings = [
    {
      code: "LOCKED_MONTH_NO_HOLDING_BREAKDOWN",
      message: "\u9396\u5B9A\u6708\u7D50\u53EA\u6709\u6A19\u6E96\u5316\u7E3D\u503C\u8207\u5206\u4F48\uFF0C\u6C92\u6709\u9010\u5E73\u53F0\u6301\u5009\u660E\u7D30\u3002",
      severity: "warning"
    }
  ];
  if (!priceSource) {
    warnings.push({
      code: "MISSING_PRICE_SOURCE",
      message: "\u6708\u7D50\u8A18\u9304\u6C92\u6709\u50F9\u683C\u4F86\u6E90\u8AAA\u660E\u3002",
      severity: "warning"
    });
  } else if (/手動|manual/i.test(priceSource)) {
    warnings.push({
      code: "MANUAL_PRICE_SOURCE",
      message: `\u50F9\u683C\u4F86\u6E90\u5305\u542B\u624B\u52D5\u50F9\u683C\uFF1A${priceSource}`,
      severity: "warning"
    });
  }
  if (note) {
    warnings.push({
      code: "SOURCE_NOTE",
      message: note,
      severity: "info"
    });
  }
  return warnings;
}
function validateSnapshot(snapshot, rowNumber) {
  if (Math.abs(snapshot.totalHkd - snapshot.performanceTotalUsd * snapshot.usdHkdRate) > MONEY_TOLERANCE_HKD) {
    throw new CryptoMonthlySyncValidationError(
      `\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684 HKD \u7E3D\u503C\u8D85\u51FA HK$1 \u9A57\u8B49\u5BB9\u8A31\u7BC4\u570D\u3002`
    );
  }
  if (Math.abs(snapshot.returnHkd - (snapshot.totalHkd - snapshot.principalHkd)) > MONEY_TOLERANCE_HKD) {
    throw new CryptoMonthlySyncValidationError(
      `\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u56DE\u5831\u91D1\u984D\u8D85\u51FA HK$1 \u9A57\u8B49\u5BB9\u8A31\u7BC4\u570D\u3002`
    );
  }
  const expectedReturnPct = snapshot.principalHkd === 0 ? 0 : snapshot.returnHkd / snapshot.principalHkd;
  if (Math.abs(snapshot.returnPct - expectedReturnPct) > PERCENTAGE_TOLERANCE) {
    throw new CryptoMonthlySyncValidationError(
      `\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u56DE\u5831\u7387\u8D85\u51FA 0.01 \u500B\u767E\u5206\u9EDE\u9A57\u8B49\u5BB9\u8A31\u7BC4\u570D\u3002`
    );
  }
  if (Math.abs(
    snapshot.currentNetUsd + snapshot.cumulativeWithdrawnUsd - snapshot.performanceTotalUsd
  ) > MONEY_TOLERANCE_USD) {
    throw new CryptoMonthlySyncValidationError(
      `\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u73FE\u6709\u6DE8\u503C\u8207\u7D2F\u8A08\u63D0\u53D6\u672A\u80FD\u5C0D\u4E0A\u7E3D\u503C\u3002`
    );
  }
  const allocationTotal = Object.values(snapshot.allocations).reduce(
    (sum, value) => sum + value,
    0
  );
  if (Math.abs(allocationTotal - 1) > PERCENTAGE_TOLERANCE) {
    throw new CryptoMonthlySyncValidationError(
      `\u6708\u7D50\u8A18\u9304\u7B2C ${rowNumber} \u884C\u7684\u8CC7\u7522\u6BD4\u4F8B\u7E3D\u548C\u4E0D\u662F 100%\u3002`
    );
  }
}
function buildSnapshot(row, rowNumber, context) {
  const rawSourceValues = Object.fromEntries(
    CRYPTO_MONTH_LOG_HEADERS.map((header, index) => [header, row[index] ?? null])
  );
  const month = readMonth(row[0], rowNumber);
  const snapshotTimestamp = readTimestamp(row[1], rowNumber);
  const priceSource = typeof row[17] === "string" ? row[17].trim() : "";
  const note = typeof row[18] === "string" ? row[18].trim() : "";
  const sourceChecksum = createCryptoSyncChecksum({
    spreadsheetId: context.spreadsheetId,
    sourceSheet: context.sheetName ?? "\u6708\u7D50\u8A18\u9304",
    sourceRange: `A${rowNumber}:S${rowNumber}`,
    rawSourceValues
  });
  const warnings = buildWarnings(priceSource, note);
  const snapshot = {
    id: `monthly-${month}`,
    month,
    snapshotDate: snapshotTimestamp.slice(0, 10),
    snapshotTimestamp,
    locked: true,
    performanceTotalUsd: readNumber(row[2], "totel(USD)", rowNumber),
    totalHkd: readNumber(row[3], "totel(HKD)", rowNumber),
    btcEquivalent: readNumber(row[4], "bitcoin\u7E3D\u503C", rowNumber),
    principalHkd: readNumber(row[5], "\u672C\u91D1", rowNumber),
    returnPct: readNumber(row[6], "\u7E3D\u56DE\u5831\u7387", rowNumber),
    returnHkd: readNumber(row[7], "\u7E3D\u56DE\u5831\uFF08HKD\uFF09", rowNumber),
    monthOverMonthPct: readNumber(row[8], "\u4E0A\u6708\u540C\u6BD4", rowNumber),
    allocations: {
      BTC: readNumber(row[9], "BTC\u4F54\u6BD4", rowNumber),
      ETH: readNumber(row[10], "ETH\u4F54\u6BD4", rowNumber),
      ADA: readNumber(row[11], "ADA\u4F54\u6BD4", rowNumber),
      USDT: readNumber(row[12], "USDT\u4F54\u6BD4", rowNumber),
      OTHER: readNumber(row[13], "\u5176\u4ED6\u4F54\u6BD4", rowNumber)
    },
    currentNetUsd: readNumber(row[14], "\u73FE\u6709totel(USD)", rowNumber),
    cumulativeWithdrawnUsd: readNumber(row[15], "\u5DF2\u63D0\u53D6\uFF0F\u6D88\u8CBB\uFF08\u7D2F\u8A08USD\uFF09", rowNumber),
    usdHkdRate: readNumber(row[16], "USD/HKD\u532F\u7387", rowNumber),
    historicalHoldings: [],
    historicalQuantities: [],
    prices: [],
    liabilities: [],
    sourceSpreadsheetId: context.spreadsheetId,
    sourceSpreadsheetTitle: context.spreadsheetTitle,
    sourceSheet: context.sheetName ?? "\u6708\u7D50\u8A18\u9304",
    sourceRange: `A${rowNumber}:S${rowNumber}`,
    sourceType: "locked_month_log",
    importBatchId: `crypto-sync-${month}-${sourceChecksum.slice(0, 12)}`,
    sourceChecksum,
    dataQuality: warnings.some((warning) => warning.severity === "error") ? "attention" : "partial",
    warnings,
    rawSourceValues
  };
  validateSnapshot(snapshot, rowNumber);
  return snapshot;
}
function parseCryptoMonthLogRows(values, context) {
  if (values.length === 0) {
    throw new CryptoMonthlySyncValidationError("\u300C\u6708\u7D50\u8A18\u9304\u300D\u6C92\u6709\u6A19\u984C\u5217\u3002");
  }
  validateHeaders(values[0]);
  const snapshots = values.slice(1).flatMap(
    (row, index) => row.some((value) => value !== null && value !== void 0 && value !== "") ? [buildSnapshot(row, index + 2, context)] : []
  ).sort((left, right) => left.month.localeCompare(right.month));
  const seenMonths = /* @__PURE__ */ new Set();
  for (const snapshot of snapshots) {
    if (seenMonths.has(snapshot.month)) {
      throw new CryptoMonthlySyncValidationError(
        `\u300C\u6708\u7D50\u8A18\u9304\u300D\u5305\u542B\u91CD\u8907\u6708\u4EFD ${snapshot.month}\uFF0C\u540C\u6B65\u5DF2\u505C\u6B62\u3002`
      );
    }
    seenMonths.add(snapshot.month);
  }
  return snapshots;
}
const COMPARISON_FIELDS = [
  "snapshotTimestamp",
  "currentNetUsd",
  "cumulativeWithdrawnUsd",
  "performanceTotalUsd",
  "totalHkd",
  "btcEquivalent",
  "principalHkd",
  "returnHkd",
  "returnPct",
  "monthOverMonthPct",
  "usdHkdRate",
  "allocations",
  "rawSourceValues"
];
function buildCryptoSyncPlan(snapshots, existingById) {
  const plan = { creates: [], skips: [], conflicts: [] };
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
      (field) => JSON.stringify(canonicalize(existing[field])) !== JSON.stringify(canonicalize(snapshot[field]))
    );
    plan.conflicts.push({
      id: snapshot.id,
      month: snapshot.month,
      existingChecksum: typeof existing.sourceChecksum === "string" ? existing.sourceChecksum : null,
      incomingChecksum: snapshot.sourceChecksum,
      differingFields
    });
  }
  return plan;
}
function getCryptoSyncSourceChecksum(snapshots) {
  return createCryptoSyncChecksum(
    snapshots.map((snapshot) => ({
      month: snapshot.month,
      sourceChecksum: snapshot.sourceChecksum
    }))
  );
}
export {
  CRYPTO_MONTH_LOG_HEADERS,
  CryptoMonthlySyncValidationError,
  buildCryptoSyncPlan,
  createCryptoSyncChecksum,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows
};
