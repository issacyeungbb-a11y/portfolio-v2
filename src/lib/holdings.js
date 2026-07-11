import { convertCurrency, normalizeCurrencyCode } from "./currency.js";
const allocationBucketMeta = {
  stock: { label: "\u80A1\u7968", color: "#0f766e" },
  etf: { label: "ETF", color: "#d97706" },
  bond: { label: "\u50B5\u5238", color: "#2563eb" },
  crypto: { label: "\u52A0\u5BC6\u8CA8\u5E63", color: "#7c3aed" },
  cash: { label: "\u73FE\u91D1", color: "#4b5563" }
};
const allocationBucketOrder = [
  "stock",
  "etf",
  "bond",
  "crypto",
  "cash"
];
function getAllocationBucketMeta(key) {
  return allocationBucketMeta[key];
}
function getCashFlowSignedAmount(entry) {
  return entry.type === "withdrawal" ? -Math.abs(entry.amount) : entry.amount;
}
function getHoldingValueInCurrency(holding, currency) {
  return convertCurrency(holding.marketValue, holding.currency, currency);
}
function getHoldingCostInCurrency(holding, currency) {
  if (holding.assetType === "cash") {
    return getHoldingValueInCurrency(holding, currency);
  }
  return convertCurrency(holding.quantity * holding.averageCost, holding.currency, currency);
}
function getPortfolioTotalValue(holdingsList, currency) {
  return holdingsList.reduce(
    (sum, holding) => sum + getHoldingValueInCurrency(holding, currency),
    0
  );
}
function getPortfolioTotalCost(holdingsList, currency) {
  return holdingsList.reduce(
    (sum, holding) => sum + getHoldingCostInCurrency(holding, currency),
    0
  );
}
function buildAllocationHoldingKey(holding) {
  return [
    holding.assetType,
    holding.symbol.trim().toUpperCase(),
    normalizeCurrencyCode(holding.currency)
  ].join("::");
}
function aggregateHoldingsForAllocation(holdingsList) {
  const grouped = /* @__PURE__ */ new Map();
  for (const holding of holdingsList) {
    const key = buildAllocationHoldingKey(holding);
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, {
        ...holding,
        accountSources: [holding.accountSource]
      });
      continue;
    }
    const marketValue = existing.marketValue + convertCurrency(holding.marketValue, holding.currency, existing.currency);
    const unrealizedPnl = existing.unrealizedPnl + convertCurrency(holding.unrealizedPnl, holding.currency, existing.currency);
    const quantity = existing.quantity + holding.quantity;
    const costBasis = marketValue - unrealizedPnl;
    grouped.set(key, {
      ...existing,
      id: `${existing.id}::aggregated`,
      quantity,
      marketValue,
      averageCost: quantity === 0 ? 0 : costBasis / quantity,
      currentPrice: quantity === 0 ? 0 : marketValue / quantity,
      unrealizedPnl,
      unrealizedPct: costBasis === 0 ? 0 : unrealizedPnl / costBasis * 100,
      allocation: existing.allocation + holding.allocation,
      accountSources: existing.accountSources.includes(holding.accountSource) ? existing.accountSources : [...existing.accountSources, holding.accountSource]
    });
  }
  return [...grouped.values()];
}
function buildAllocationSlices(holdingsList) {
  const totalHKD = getPortfolioTotalValue(holdingsList, "HKD");
  const grouped = /* @__PURE__ */ new Map();
  for (const holding of aggregateHoldingsForAllocation(holdingsList)) {
    const bucketKey = holding.assetType;
    const current = grouped.get(bucketKey) ?? [];
    grouped.set(bucketKey, [...current, holding]);
  }
  return [...grouped.entries()].map(([key, bucketHoldings]) => {
    const totalValueHKD = getPortfolioTotalValue(bucketHoldings, "HKD");
    const totalValueUSD = getPortfolioTotalValue(bucketHoldings, "USD");
    return {
      key,
      label: allocationBucketMeta[key].label,
      color: allocationBucketMeta[key].color,
      value: totalHKD === 0 ? 0 : totalValueHKD / totalHKD * 100,
      totalValueHKD,
      totalValueUSD,
      holdings: [...bucketHoldings].sort(
        (left, right) => getHoldingValueInCurrency(right, "HKD") - getHoldingValueInCurrency(left, "HKD")
      )
    };
  }).sort((left, right) => right.totalValueHKD - left.totalValueHKD);
}
function getAssetTypeLabel(assetType) {
  if (assetType === "stock") return "\u80A1\u7968";
  if (assetType === "etf") return "ETF";
  if (assetType === "bond") return "\u50B5\u5238";
  if (assetType === "crypto") return "\u52A0\u5BC6\u8CA8\u5E63";
  if (assetType === "cash") return "\u73FE\u91D1";
  return "\u5168\u90E8\u8CC7\u7522\u985E\u5225";
}
function getAccountSourceLabel(accountSource) {
  if (accountSource === "Futu") return "Futu";
  if (accountSource === "IB") return "IB";
  if (accountSource === "Crypto") return "Crypto";
  if (accountSource === "Other") return "\u5176\u4ED6";
  return "\u5168\u90E8\u5E33\u6236\u4F86\u6E90";
}
export {
  aggregateHoldingsForAllocation,
  allocationBucketMeta,
  allocationBucketOrder,
  buildAllocationSlices,
  getAccountSourceLabel,
  getAllocationBucketMeta,
  getAssetTypeLabel,
  getCashFlowSignedAmount,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalCost,
  getPortfolioTotalValue,
  normalizeCurrencyCode
};
