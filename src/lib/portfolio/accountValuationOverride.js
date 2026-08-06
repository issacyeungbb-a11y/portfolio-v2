const MONEY_TOLERANCE_USD = 0.01;
function localValue(asset) {
  return asset.assetType === "cash" ? asset.currentPrice : asset.quantity * asset.currentPrice;
}
function toUsd(asset, usdHkdRate) {
  const currency = asset.currency.trim().toUpperCase();
  const value = localValue(asset);
  if (currency === "HKD") return value / usdHkdRate;
  if (currency === "USD" || currency === "USDT" || currency === "USDC") return value;
  return null;
}
function normalizeAccountValuationOverride(value) {
  if (!value || value.accountSource !== "Crypto" || value.active !== true || typeof value.month !== "string" || !/^\d{4}-\d{2}$/.test(value.month) || typeof value.targetTotalUsd !== "number" || !Number.isFinite(value.targetTotalUsd) || value.targetTotalUsd <= 0 || typeof value.targetTotalHkd !== "number" || !Number.isFinite(value.targetTotalHkd) || value.targetTotalHkd <= 0 || typeof value.usdHkdRate !== "number" || !Number.isFinite(value.usdHkdRate) || value.usdHkdRate <= 0 || typeof value.sourceSnapshotId !== "string" || typeof value.sourceChecksum !== "string" || typeof value.shadowChecksum !== "string" || value.applicationMode !== "proportional_account_overlay") {
    return null;
  }
  if (Math.abs(value.targetTotalUsd * value.usdHkdRate - value.targetTotalHkd) > 1) {
    return null;
  }
  return value;
}
function applyAccountValuationOverride(assets, override) {
  if (!override) {
    return {
      assets,
      applied: false,
      accountSource: "",
      assetCount: 0,
      baseTotalUsd: 0,
      targetTotalUsd: 0,
      scaleFactor: 1
    };
  }
  const accountAssets = assets.filter(
    (asset) => asset.accountSource === override.accountSource
  );
  const unsupportedCurrencies = accountAssets.filter((asset) => toUsd(asset, override.usdHkdRate) == null).map((asset) => asset.currency);
  if (unsupportedCurrencies.length > 0) {
    throw new Error(
      `Crypto \u6708\u7D50\u4F30\u503C\u8986\u84CB\u9047\u5230\u672A\u652F\u63F4\u8CA8\u5E63\uFF1A${[...new Set(unsupportedCurrencies)].join("\u3001")}`
    );
  }
  const baseTotalUsd = accountAssets.reduce(
    (sum, asset) => sum + (toUsd(asset, override.usdHkdRate) ?? 0),
    0
  );
  if (!(baseTotalUsd > MONEY_TOLERANCE_USD)) {
    throw new Error("Crypto \u5E33\u6236\u73FE\u503C\u70BA 0\uFF0C\u7121\u6CD5\u5B89\u5168\u5957\u7528\u6708\u7D50\u4F30\u503C\u8986\u84CB\u3002");
  }
  const scaleFactor = override.targetTotalUsd / baseTotalUsd;
  const scaledAssets = assets.map(
    (asset) => asset.accountSource === override.accountSource ? {
      ...asset,
      currentPrice: asset.currentPrice * scaleFactor,
      valuationOverrideMonth: override.month,
      valuationUsdHkdRate: override.usdHkdRate
    } : asset
  );
  return {
    assets: scaledAssets,
    applied: true,
    accountSource: override.accountSource,
    assetCount: accountAssets.length,
    baseTotalUsd,
    targetTotalUsd: override.targetTotalUsd,
    scaleFactor
  };
}
export {
  applyAccountValuationOverride,
  normalizeAccountValuationOverride
};
