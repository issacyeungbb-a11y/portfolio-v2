import { convertCurrency } from "../currency.js";
import {
  allocationBucketOrder,
  getAllocationBucketMeta
} from "../holdings.js";
function isAllocationBucketKey(value) {
  return value === "stock" || value === "etf" || value === "bond" || value === "crypto" || value === "cash";
}
function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function normalizeDateKey(value) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString().slice(0, 10);
}
function getInputValueHKD(holding) {
  const explicitHKD = toFiniteNumber(holding.marketValueHKD);
  if (explicitHKD > 0) {
    return explicitHKD;
  }
  const totalValueHKD = toFiniteNumber(holding.totalValueHKD);
  if (totalValueHKD > 0) {
    return totalValueHKD;
  }
  const currency = holding.currency?.trim() || "HKD";
  const marketValue = toFiniteNumber(holding.marketValue);
  if (marketValue > 0) {
    return convertCurrency(marketValue, currency, "HKD");
  }
  const quantity = toFiniteNumber(holding.quantity);
  const currentPrice = toFiniteNumber(holding.currentPrice);
  return convertCurrency(quantity * currentPrice, currency, "HKD");
}
function getSlicePercentage(slices, key) {
  return slices.find((slice) => slice.key === key)?.percentage ?? 0;
}
function buildReportAllocationSlices(holdings) {
  const buckets = /* @__PURE__ */ new Map();
  for (const holding of holdings) {
    if (!isAllocationBucketKey(holding.assetType)) {
      continue;
    }
    const valueHKD = getInputValueHKD(holding);
    if (valueHKD <= 0) {
      continue;
    }
    buckets.set(holding.assetType, (buckets.get(holding.assetType) ?? 0) + valueHKD);
  }
  const totalValueHKD = [...buckets.values()].reduce((sum, value) => sum + value, 0);
  return allocationBucketOrder.map((key) => {
    const totalValueHKDForBucket = buckets.get(key) ?? 0;
    const meta = getAllocationBucketMeta(key);
    return {
      key,
      label: meta.label,
      color: meta.color,
      percentage: totalValueHKD === 0 ? 0 : totalValueHKDForBucket / totalValueHKD * 100,
      totalValueHKD: totalValueHKDForBucket,
      totalValueUSD: convertCurrency(totalValueHKDForBucket, "HKD", "USD")
    };
  }).filter((slice) => slice.totalValueHKD > 0).sort((left, right) => right.totalValueHKD - left.totalValueHKD);
}
function buildAllocationDeltas(currentSlices, previousSlices) {
  const keys = allocationBucketOrder.filter(
    (key) => currentSlices.some((slice) => slice.key === key) || previousSlices.some((slice) => slice.key === key)
  );
  return keys.map((key) => ({
    key,
    deltaPercentagePoints: getSlicePercentage(currentSlices, key) - getSlicePercentage(previousSlices, key)
  }));
}
function deriveAllocationStyleTag(slices) {
  const sorted = [...slices].sort((left, right) => right.percentage - left.percentage);
  const largest = sorted[0]?.percentage ?? 0;
  const secondLargest = sorted[1]?.percentage ?? 0;
  const stockAndEtf = getSlicePercentage(slices, "stock") + getSlicePercentage(slices, "etf");
  const cash = getSlicePercentage(slices, "cash");
  const bondAndCash = getSlicePercentage(slices, "bond") + cash;
  const crypto = getSlicePercentage(slices, "crypto");
  if (largest > 55 || largest - secondLargest > 20) {
    return "\u9AD8\u96C6\u4E2D\u578B";
  }
  if (cash >= 35 || bondAndCash >= 45) {
    return "\u9632\u5B88\u578B";
  }
  if (stockAndEtf >= 75 && cash < 15 || crypto > 20) {
    return "\u9032\u653B\u578B";
  }
  if (largest <= 50 && cash >= 5 && cash <= 35 && crypto <= 20) {
    return "\u5E73\u8861\u578B";
  }
  if (cash < 5 || stockAndEtf > 65) {
    return "\u9032\u653B\u578B";
  }
  return "\u5E73\u8861\u578B";
}
function deriveAllocationWarningTags(slices) {
  const sorted = [...slices].sort((left, right) => right.percentage - left.percentage);
  const largest = sorted[0]?.percentage ?? 0;
  const stockAndEtf = getSlicePercentage(slices, "stock") + getSlicePercentage(slices, "etf");
  const cash = getSlicePercentage(slices, "cash");
  const crypto = getSlicePercentage(slices, "crypto");
  const tags = [];
  if (largest > 50) tags.push("\u55AE\u4E00\u985E\u5225\u96C6\u4E2D");
  if (cash < 5) tags.push("\u73FE\u91D1\u504F\u4F4E");
  if (cash > 35) tags.push("\u73FE\u91D1\u504F\u9AD8");
  if (crypto > 20) tags.push("\u52A0\u5BC6\u8CC7\u7522\u504F\u9AD8");
  if (stockAndEtf > 80) tags.push("\u80A1\u7968\u504F\u9AD8");
  if (tags.length < 2 && largest <= 50) {
    tags.push("\u985E\u5225\u8F03\u5206\u6563");
  }
  if (tags.length < 2 && cash >= 5 && cash <= 35) {
    tags.push("\u73FE\u91D1\u7DE9\u885D\u9069\u4E2D");
  }
  if (tags.length < 2 && crypto <= 20) {
    tags.push("\u52A0\u5BC6\u8CC7\u7522\u53EF\u63A7");
  }
  if (tags.length < 2 && stockAndEtf <= 80) {
    tags.push("\u80A1\u7968\u66DD\u96AA\u53EF\u63A7");
  }
  return tags.slice(0, 4);
}
function getStylePhrase(styleTag) {
  if (styleTag === "\u9032\u653B\u578B") return "\u504F\u9032\u653B\u914D\u7F6E";
  if (styleTag === "\u9632\u5B88\u578B") return "\u504F\u9632\u5B88\u914D\u7F6E";
  if (styleTag === "\u9AD8\u96C6\u4E2D\u578B") return "\u9AD8\u96C6\u4E2D\u914D\u7F6E";
  return "\u76F8\u5C0D\u5E73\u8861\u914D\u7F6E";
}
function buildSummarySentence(slices, styleTag, warningTags, deltas) {
  const dominantSlice = slices[0];
  const leadingPhrase = dominantSlice ? `\u76EE\u524D\u7D44\u5408\u4EE5${dominantSlice.label}\u70BA\u4E3B` : "\u76EE\u524D\u7D44\u5408\u672A\u6709\u6709\u6548\u8CC7\u7522\u5206\u4F48";
  const warningPhrase = warningTags.find((tag) => tag.includes("\u73FE\u91D1")) ?? warningTags.find((tag) => tag.includes("\u96C6\u4E2D")) ?? warningTags[0] ?? "\u672A\u898B\u660E\u986F\u5206\u4F48\u544A\u8B66";
  const notableDelta = deltas?.filter((delta) => Math.abs(delta.deltaPercentagePoints) >= 3).sort(
    (left, right) => Math.abs(right.deltaPercentagePoints) - Math.abs(left.deltaPercentagePoints)
  )[0];
  if (notableDelta) {
    const meta = getAllocationBucketMeta(notableDelta.key);
    const direction = notableDelta.deltaPercentagePoints > 0 ? "\u4E0A\u5347" : "\u4E0B\u964D";
    return `${leadingPhrase}\uFF0C${warningPhrase}\uFF0C\u6574\u9AD4\u5C6C${getStylePhrase(styleTag)}\uFF1B\u8F03\u4E0A\u671F${meta.label}${direction}${Math.round(Math.abs(notableDelta.deltaPercentagePoints))}pp\u3002`;
  }
  return `${leadingPhrase}\uFF0C${warningPhrase}\uFF0C\u6574\u9AD4\u5C6C${getStylePhrase(styleTag)}\u3002`;
}
function buildReportAllocationSummaryFromHoldings(params) {
  const slices = buildReportAllocationSlices(params.holdings);
  const previousSlices = params.comparisonHoldings && params.comparisonHoldings.length > 0 ? buildReportAllocationSlices(params.comparisonHoldings) : [];
  const deltas = previousSlices.length > 0 ? buildAllocationDeltas(slices, previousSlices) : void 0;
  const styleTag = deriveAllocationStyleTag(slices);
  const warningTags = deriveAllocationWarningTags(slices);
  const dominantBucketKey = slices[0]?.key;
  const totalValueHKD = slices.reduce((sum, slice) => sum + slice.totalValueHKD, 0);
  const summary = {
    asOfDate: normalizeDateKey(params.asOfDate),
    basis: params.basis,
    styleTag,
    warningTags,
    slices,
    totalValueHKD,
    summarySentence: buildSummarySentence(slices, styleTag, warningTags, deltas)
  };
  if (dominantBucketKey) {
    summary.dominantBucketKey = dominantBucketKey;
  }
  if (deltas?.length) {
    summary.deltas = deltas;
  }
  if (deltas?.length && params.comparisonLabel) {
    summary.comparisonLabel = params.comparisonLabel;
  }
  return summary;
}
function normalizeSliceSummary(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value;
  if (!isAllocationBucketKey(raw.key)) {
    return null;
  }
  const meta = getAllocationBucketMeta(raw.key);
  return {
    key: raw.key,
    label: typeof raw.label === "string" && raw.label.trim() ? raw.label.trim() : meta.label,
    color: typeof raw.color === "string" && raw.color.trim() ? raw.color.trim() : meta.color,
    percentage: toFiniteNumber(raw.percentage),
    totalValueHKD: toFiniteNumber(raw.totalValueHKD),
    totalValueUSD: toFiniteNumber(raw.totalValueUSD)
  };
}
function normalizeDeltaSummary(value) {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const raw = value;
  if (!isAllocationBucketKey(raw.key)) {
    return null;
  }
  return {
    key: raw.key,
    deltaPercentagePoints: toFiniteNumber(raw.deltaPercentagePoints)
  };
}
function isReportAllocationStyleTag(value) {
  return value === "\u5E73\u8861\u578B" || value === "\u9032\u653B\u578B" || value === "\u9632\u5B88\u578B" || value === "\u9AD8\u96C6\u4E2D\u578B";
}
function isReportAllocationBasis(value) {
  return value === "monthly" || value === "quarterly";
}
function normalizeReportAllocationSummary(value) {
  if (typeof value !== "object" || value === null) {
    return void 0;
  }
  const raw = value;
  const slices = Array.isArray(raw.slices) ? raw.slices.map(normalizeSliceSummary).filter((slice) => slice !== null) : [];
  if (!isReportAllocationBasis(raw.basis) || !isReportAllocationStyleTag(raw.styleTag)) {
    return void 0;
  }
  const deltas = Array.isArray(raw.deltas) ? raw.deltas.map(normalizeDeltaSummary).filter((delta) => delta !== null) : void 0;
  return {
    asOfDate: typeof raw.asOfDate === "string" ? normalizeDateKey(raw.asOfDate) : "",
    basis: raw.basis,
    comparisonLabel: typeof raw.comparisonLabel === "string" && raw.comparisonLabel.trim() ? raw.comparisonLabel.trim() : void 0,
    styleTag: raw.styleTag,
    warningTags: Array.isArray(raw.warningTags) ? raw.warningTags.filter((tag) => typeof tag === "string" && tag.trim().length > 0).slice(0, 4) : [],
    dominantBucketKey: isAllocationBucketKey(raw.dominantBucketKey) ? raw.dominantBucketKey : slices[0]?.key,
    slices,
    deltas: deltas && deltas.length > 0 ? deltas : void 0,
    totalValueHKD: toFiniteNumber(raw.totalValueHKD),
    summarySentence: typeof raw.summarySentence === "string" && raw.summarySentence.trim() ? raw.summarySentence.trim() : void 0
  };
}
export {
  buildAllocationDeltas,
  buildReportAllocationSummaryFromHoldings,
  deriveAllocationStyleTag,
  deriveAllocationWarningTags,
  normalizeReportAllocationSummary
};
