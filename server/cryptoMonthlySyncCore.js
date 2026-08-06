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
function readOptionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
function getShadowAssetLocalValue(asset) {
  return asset.assetType === "cash" ? asset.currentPrice : asset.quantity * asset.currentPrice;
}
function getShadowAssetUsdValue(asset, usdHkdRate) {
  const value = getShadowAssetLocalValue(asset);
  const currency = asset.currency.trim().toUpperCase();
  if (currency === "HKD") return value / usdHkdRate;
  if (currency === "USD" || currency === "USDT" || currency === "USDC") return value;
  return null;
}
function buildCryptoAssetShadowPreview(snapshot, detailValues, assets, sourceDetailRange) {
  const monthHeaderIndex = detailValues.findIndex((row) => String(row[0] ?? "").trim() === "\u8CC7\u7522");
  if (monthHeaderIndex < 0 || monthHeaderIndex + 1 >= detailValues.length) {
    throw new CryptoMonthlySyncValidationError("\u5F71\u5B50\u5C0D\u6578\u627E\u4E0D\u5230 2026_V2 \u7684\u6708\u7D50\u6301\u5009\u6A19\u984C\u3002");
  }
  const detailMonth = readMonth(detailValues[monthHeaderIndex][4], monthHeaderIndex + 38);
  const statusText = String(detailValues[0]?.[1] ?? "").trim();
  const detailRows = detailValues.slice(monthHeaderIndex + 2);
  const sourcePositions = [];
  for (const row of detailRows) {
    const label = String(row[0] ?? "").trim();
    if (!label || label === "totel(USD)") break;
    const value = readOptionalNumber(row[6]);
    const symbol = label.replace(/\s*負債\s*$/, "").trim().toUpperCase();
    if (!symbol) continue;
    sourcePositions.push({
      symbol,
      sourceLabel: label,
      sourceValueUsd: value ?? 0,
      sourceQuantity: readOptionalNumber(row[5]),
      sourcePriceUsd: readOptionalNumber(row[4]),
      isLiability: /負債/.test(label) || (value ?? 0) < 0
    });
  }
  if (sourcePositions.length === 0) {
    throw new CryptoMonthlySyncValidationError("\u5F71\u5B50\u5C0D\u6578\u627E\u4E0D\u5230\u4EFB\u4F55\u6708\u7D50\u6301\u5009\u660E\u7D30\u3002");
  }
  const cryptoAssets = assets.filter((asset) => asset.accountSource === "Crypto");
  const excludedFutuAssets = assets.filter(
    (asset) => asset.accountSource === "Futu" && asset.assetType === "crypto"
  );
  const unsupportedCryptoCurrencies = /* @__PURE__ */ new Set();
  const currentBySymbol = /* @__PURE__ */ new Map();
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
      quantity: existing.quantity + asset.quantity
    });
  }
  const sourceBySymbol = /* @__PURE__ */ new Map();
  for (const position of sourcePositions) {
    const entries = sourceBySymbol.get(position.symbol) ?? [];
    entries.push(position);
    sourceBySymbol.set(position.symbol, entries);
  }
  const symbols = [.../* @__PURE__ */ new Set([...sourceBySymbol.keys(), ...currentBySymbol.keys()])].sort();
  const positions = symbols.map((symbol) => {
    const sourceEntries = sourceBySymbol.get(symbol) ?? [];
    const sourceValueUsd = sourceEntries.reduce((sum, item) => sum + item.sourceValueUsd, 0);
    const current = currentBySymbol.get(symbol) ?? { valueUsd: 0, quantity: 0 };
    return {
      symbol,
      sourceLabel: sourceEntries.map((item) => item.sourceLabel).join(" + ") || symbol,
      sourceValueUsd,
      currentValueUsd: current.valueUsd,
      differenceUsd: sourceValueUsd - current.valueUsd,
      sourceQuantity: sourceEntries.length === 1 ? sourceEntries[0].sourceQuantity : null,
      currentQuantity: current.quantity,
      sourcePriceUsd: sourceEntries.length === 1 ? sourceEntries[0].sourcePriceUsd : null,
      isLiability: sourceEntries.some((item) => item.isLiability)
    };
  });
  const detailPositionSubtotalUsd = sourcePositions.reduce(
    (sum, position) => sum + position.sourceValueUsd,
    0
  );
  const currentAccountTotalUsd = [...currentBySymbol.values()].reduce(
    (sum, item) => sum + item.valueUsd,
    0
  );
  const excludedFutuValueUsd = excludedFutuAssets.reduce((sum, asset) => {
    return sum + (getShadowAssetUsdValue(asset, snapshot.usdHkdRate) ?? 0);
  }, 0);
  const detailToTargetDifferenceUsd = snapshot.performanceTotalUsd - detailPositionSubtotalUsd;
  const detailMatchesTarget = Math.abs(detailToTargetDifferenceUsd) <= MONEY_TOLERANCE_USD;
  const detailDifferenceMatchesWithdrawals = Math.abs(detailToTargetDifferenceUsd - snapshot.cumulativeWithdrawnUsd) <= MONEY_TOLERANCE_USD;
  const monthMatches = detailMonth === snapshot.month;
  const sourceLocked = statusText.includes(snapshot.month) && /已鎖定快照/.test(statusText);
  const fxMatches = Math.abs(snapshot.totalHkd - snapshot.performanceTotalUsd * snapshot.usdHkdRate) <= MONEY_TOLERANCE_HKD;
  const hasUnsupportedCurrency = unsupportedCryptoCurrencies.size > 0;
  const checks = [
    {
      code: "LOCKED_MONTH_MATCH",
      passed: monthMatches && sourceLocked,
      severity: monthMatches && sourceLocked ? "info" : "error",
      message: monthMatches && sourceLocked ? `${snapshot.month} \u6708\u7D50\u6301\u5009\u5340\u584A\u5DF2\u9396\u5B9A\uFF0C\u4E26\u8207 19 \u6B04\u6708\u7D50\u8A18\u9304\u4E00\u81F4\u3002` : `\u6708\u7D50\u6301\u5009\u5340\u584A\u6708\u4EFD\u6216\u9396\u5B9A\u72C0\u614B\u4E0D\u4E00\u81F4\uFF08\u660E\u7D30 ${detailMonth}\uFF09\u3002`
    },
    {
      code: "CRYPTO_ACCOUNT_ONLY",
      passed: true,
      severity: "info",
      message: `\u53EA\u8A08 accountSource=Crypto\uFF1B\u5DF2\u6392\u9664 ${excludedFutuAssets.length} \u9805 Futu Crypto\u3002`
    },
    {
      code: "WITHDRAWALS_SEPARATE",
      passed: true,
      severity: "info",
      message: `HK$${Math.round(snapshot.totalHkd).toLocaleString("en-US")} \u76F4\u63A5\u4F5C Crypto \u5E33\u6236\u76EE\u6A19\uFF1B\u63D0\u53D6\uFF0F\u6D88\u8CBB US$${snapshot.cumulativeWithdrawnUsd.toFixed(2)} \u7368\u7ACB\u986F\u793A\uFF0C\u6C92\u6709\u5F9E\u76EE\u6A19\u6263\u6E1B\u3002`
    },
    {
      code: "DETAIL_SUBTOTAL_RECONCILIATION",
      passed: detailMatchesTarget,
      severity: detailMatchesTarget ? "info" : "warning",
      message: detailMatchesTarget ? "\u9010\u9805\u6301\u5009\u660E\u7D30\u8207\u6708\u7D50\u7E3D\u503C\u4E00\u81F4\u3002" : `\u9010\u9805\u6301\u5009\u5408\u8A08\u8F03\u6708\u7D50\u7E3D\u503C\u5C11 US$${detailToTargetDifferenceUsd.toFixed(2)}${detailDifferenceMatchesWithdrawals ? "\uFF0C\u91D1\u984D\u525B\u597D\u7B49\u65BC\u7368\u7ACB\u63D0\u53D6\uFF0F\u6D88\u8CBB\u8A18\u9304\uFF1B\u6B63\u5F0F\u9010\u9805\u540C\u6B65\u524D\u4ECD\u9700\u78BA\u8A8D\u5DEE\u984D\u6B78\u5C6C\u3002" : "\uFF0C\u6B63\u5F0F\u9010\u9805\u540C\u6B65\u524D\u5FC5\u9808\u5148\u6838\u5C0D\u3002"}`
    },
    {
      code: "TOTAL_FX_RECONCILIATION",
      passed: fxMatches,
      severity: fxMatches ? "info" : "error",
      message: fxMatches ? "\u6708\u7D50 USD \u7E3D\u503C\u6309\u9396\u5B9A\u532F\u7387\u63DB\u7B97\u5F8C\u8207 HKD \u7E3D\u503C\u4E00\u81F4\u3002" : "\u6708\u7D50 USD/HKD \u7E3D\u503C\u672A\u80FD\u5C0D\u6578\u3002"
    },
    {
      code: "SUPPORTED_ACCOUNT_CURRENCIES",
      passed: !hasUnsupportedCurrency,
      severity: hasUnsupportedCurrency ? "error" : "info",
      message: hasUnsupportedCurrency ? `Crypto \u5E33\u6236\u5305\u542B\u672A\u652F\u63F4\u8CA8\u5E63\uFF1A${[...unsupportedCryptoCurrencies].join("\u3001")}\u3002` : "Crypto \u5E33\u6236\u8CA8\u5E63\u53EF\u7528\u6708\u7D50\u532F\u7387\u5B89\u5168\u6BD4\u8F03\u3002"
    },
    {
      code: "ZERO_WRITE_PREVIEW",
      passed: true,
      severity: "info",
      message: "\u4ECA\u6B21\u53EA\u5EFA\u7ACB\u9810\u89BD\uFF1BFirestore\u3001Google Sheet\u3001\u4EA4\u6613\u53CA\u6BCF\u65E5\u5FEB\u7167\u5BEB\u5165\u6B21\u6578\u5168\u90E8\u70BA 0\u3002"
    }
  ];
  const hasBlockingError = checks.some((check) => !check.passed && check.severity === "error");
  return {
    mode: "shadow_preview",
    status: hasBlockingError || !detailMatchesTarget ? "review_required" : "ready",
    month: snapshot.month,
    accountSource: "Crypto",
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
    checks
  };
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
    if (differingFields.length === 0) {
      plan.skips.push(snapshot);
      continue;
    }
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
function buildCryptoSyncValidationReport(snapshots, plan) {
  const createMonths = new Set(plan.creates.map((snapshot) => snapshot.month));
  const conflictByMonth = new Map(
    plan.conflicts.map((conflict) => [conflict.month, conflict])
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
        action: conflict ? "conflict" : createMonths.has(snapshot.month) ? "create" : "skip",
        sourceChecksum: snapshot.sourceChecksum,
        warningCodes: snapshot.warnings.map((warning) => warning.code),
        differingFields: conflict?.differingFields ?? []
      };
    })
  };
}
function getCryptoSyncSourceChecksum(snapshots) {
  return createCryptoSyncChecksum(
    snapshots.map((snapshot) => ({
      month: snapshot.month,
      sourceChecksum: snapshot.sourceChecksum
    }))
  );
}
function getCryptoHistoricalAuditMonths(snapshots, createdMonths, latestImportedMonth) {
  const months = new Set(createdMonths);
  for (const snapshot of snapshots) {
    if (!latestImportedMonth || snapshot.month > latestImportedMonth) {
      months.add(snapshot.month);
    }
  }
  return [...months].sort((left, right) => left.localeCompare(right));
}
export {
  CRYPTO_MONTH_LOG_HEADERS,
  CryptoMonthlySyncValidationError,
  buildCryptoAssetShadowPreview,
  buildCryptoSyncPlan,
  buildCryptoSyncValidationReport,
  createCryptoSyncChecksum,
  getCryptoHistoricalAuditMonths,
  getCryptoSyncSourceChecksum,
  parseCryptoMonthLogRows
};
