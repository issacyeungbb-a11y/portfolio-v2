function toFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
function trimString(value) {
  return typeof value === "string" ? value.trim() : "";
}
function normalizeDateKey(value) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  throw new Error(`[snapshotComparison] \u7121\u6CD5\u89E3\u6790\u65E5\u671F\uFF1A${value}`);
}
function getMonthKey(value) {
  const normalized = normalizeDateKey(value);
  return normalized.slice(0, 7);
}
function formatDateKey(date) {
  return date.toISOString().slice(0, 10);
}
function listDateKeysBetween(startDateExclusive, endDateInclusive) {
  const keys = [];
  const cursor = /* @__PURE__ */ new Date(`${normalizeDateKey(startDateExclusive)}T00:00:00Z`);
  const end = /* @__PURE__ */ new Date(`${normalizeDateKey(endDateInclusive)}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  while (cursor <= end) {
    keys.push(formatDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return keys;
}
function summarizePeriodExternalFlow(previousDate, currentDate, snapshots) {
  const expectedDates = listDateKeysBetween(previousDate, currentDate);
  if (expectedDates.length === 0) {
    return {
      isComplete: true,
      expectedSnapshotDays: 0,
      availableSnapshotDays: 0,
      netExternalFlowCoveragePct: 100,
      netExternalFlowHKD: 0,
      periodStartDate: normalizeDateKey(previousDate),
      periodEndDate: normalizeDateKey(currentDate),
      missingDates: []
    };
  }
  const snapshotsByDate = new Map(
    snapshots.map((snapshot) => [normalizeDateKey(snapshot.date), snapshot])
  );
  const availableDates = expectedDates.filter((date) => snapshotsByDate.has(date));
  const missingDates = expectedDates.filter((date) => !snapshotsByDate.has(date));
  const netExternalFlowCoveragePct = expectedDates.length > 0 ? Math.floor(availableDates.length / expectedDates.length * 100) : 100;
  if (netExternalFlowCoveragePct < 80) {
    return {
      isComplete: false,
      expectedSnapshotDays: expectedDates.length,
      availableSnapshotDays: availableDates.length,
      netExternalFlowCoveragePct,
      periodStartDate: normalizeDateKey(previousDate),
      periodEndDate: normalizeDateKey(currentDate),
      missingDates
    };
  }
  return {
    isComplete: netExternalFlowCoveragePct === 100,
    expectedSnapshotDays: expectedDates.length,
    availableSnapshotDays: availableDates.length,
    netExternalFlowCoveragePct,
    netExternalFlowHKD: availableDates.reduce(
      (sum, date) => sum + toFiniteNumber(snapshotsByDate.get(date)?.netExternalFlowHKD),
      0
    ),
    periodStartDate: normalizeDateKey(previousDate),
    periodEndDate: normalizeDateKey(currentDate),
    missingDates
  };
}
function getHoldingKey(holding) {
  return holding.assetId || `${holding.ticker}|${holding.currency}`;
}
function getHoldingValue(holding) {
  return toFiniteNumber(holding.marketValueHKD);
}
function getHoldingQuantity(holding) {
  return toFiniteNumber(holding.quantity);
}
function getHoldingPrice(holding) {
  return toFiniteNumber(holding.currentPrice);
}
function getAllocationBuckets(source, keySelector) {
  const buckets = /* @__PURE__ */ new Map();
  for (const holding of source.holdings) {
    const key = keySelector(holding);
    buckets.set(key, (buckets.get(key) ?? 0) + getHoldingValue(holding));
  }
  return buckets;
}
function formatPeriodLabel(currentDate, previousDate) {
  const current = normalizeDateKey(currentDate).slice(0, 7);
  const previous = normalizeDateKey(previousDate).slice(0, 7);
  return `${current} vs ${previous}`;
}
function buildHoldingChange(current, previous) {
  const currentValue = current ? getHoldingValue(current) : 0;
  const previousValue = previous ? getHoldingValue(previous) : 0;
  const quantityChange = (current ? getHoldingQuantity(current) : 0) - (previous ? getHoldingQuantity(previous) : 0);
  const priceChangePercent = current && previous && getHoldingPrice(previous) > 0 ? (getHoldingPrice(current) - getHoldingPrice(previous)) / getHoldingPrice(previous) * 100 : 0;
  const contributionToPortfolioChange = currentValue - previousValue;
  const priceEffectHKD = previousValue * (priceChangePercent / 100);
  const flowEffectHKD = contributionToPortfolioChange - priceEffectHKD;
  let status = "unchanged";
  if (current && !previous) {
    status = "new";
  } else if (!current && previous) {
    status = "closed";
  } else if (quantityChange > 1e-8) {
    status = "increased";
  } else if (quantityChange < -1e-8) {
    status = "decreased";
  }
  return {
    ticker: trimString(current?.ticker ?? previous?.ticker),
    name: trimString(current?.name ?? previous?.name),
    status,
    currentValue,
    previousValue,
    quantityChange,
    priceChangePercent,
    contributionToPortfolioChange,
    priceEffectHKD,
    flowEffectHKD
  };
}
function buildDistributionChanges(current, previous, keySelector) {
  const currentBuckets = getAllocationBuckets(current, keySelector);
  const previousBuckets = getAllocationBuckets(previous, keySelector);
  const keys = [.../* @__PURE__ */ new Set([...currentBuckets.keys(), ...previousBuckets.keys()])];
  return keys.map((key) => {
    const currentValue = currentBuckets.get(key) ?? 0;
    const previousValue = previousBuckets.get(key) ?? 0;
    const currentPercent = current.totalValueHKD > 0 ? currentValue / current.totalValueHKD * 100 : 0;
    const previousPercent = previous.totalValueHKD > 0 ? previousValue / previous.totalValueHKD * 100 : 0;
    return {
      key,
      currentPercent,
      previousPercent,
      deltaPercent: currentPercent - previousPercent
    };
  }).sort((left, right) => Math.abs(right.deltaPercent) - Math.abs(left.deltaPercent));
}
function compareSnapshots(current, previous, options) {
  const currentHoldings = new Map(
    current.holdings.map((holding) => [getHoldingKey(holding), holding])
  );
  const previousHoldings = new Map(
    previous.holdings.map((holding) => [getHoldingKey(holding), holding])
  );
  const keys = [.../* @__PURE__ */ new Set([...currentHoldings.keys(), ...previousHoldings.keys()])];
  const holdingChanges = keys.map((key) => buildHoldingChange(currentHoldings.get(key) ?? null, previousHoldings.get(key) ?? null)).sort((left, right) => Math.abs(right.contributionToPortfolioChange) - Math.abs(left.contributionToPortfolioChange));
  const gainers = holdingChanges.filter((item) => item.status !== "new" && item.priceEffectHKD > 0).slice().sort((left, right) => right.priceEffectHKD - left.priceEffectHKD).slice(0, 3).map((item) => ({
    ticker: item.ticker,
    changePercent: item.priceChangePercent,
    contributionHKD: item.priceEffectHKD
  }));
  const losers = holdingChanges.filter((item) => item.status !== "new" && item.priceEffectHKD < 0).slice().sort((left, right) => left.priceEffectHKD - right.priceEffectHKD).slice(0, 3).map((item) => ({
    ticker: item.ticker,
    changePercent: item.priceChangePercent,
    contributionHKD: item.priceEffectHKD
  }));
  const newHoldings = holdingChanges.filter((item) => item.status === "new" && item.currentValue > 0).sort((left, right) => right.currentValue - left.currentValue).slice(0, 8).map((item) => ({
    ticker: item.ticker,
    valueHKD: item.currentValue
  }));
  const totalValueChangeHKD = current.totalValueHKD - previous.totalValueHKD;
  const totalValueChangePercent = previous.totalValueHKD !== 0 ? totalValueChangeHKD / previous.totalValueHKD * 100 : 0;
  const flowSummary = options?.periodSnapshots ? summarizePeriodExternalFlow(previous.date, current.date, options.periodSnapshots) : null;
  const netExternalFlowCoveragePct = flowSummary?.netExternalFlowCoveragePct;
  const hasSufficientFlowCoverage = typeof netExternalFlowCoveragePct === "number" && netExternalFlowCoveragePct >= 80 && typeof flowSummary?.netExternalFlowHKD === "number";
  const cashFlowWarningMessage = typeof netExternalFlowCoveragePct === "number" && netExternalFlowCoveragePct >= 80 && netExternalFlowCoveragePct < 100 ? `\u8CC7\u91D1\u6D41\u8CC7\u6599\u672A\u5B8C\u5168\u8986\u84CB\uFF08${netExternalFlowCoveragePct}%\uFF09` : typeof netExternalFlowCoveragePct === "number" && netExternalFlowCoveragePct < 80 ? `\u8CC7\u91D1\u6D41\u8986\u84CB\u4E0D\u8DB3\uFF08${netExternalFlowCoveragePct}%\uFF09\uFF0C\u66AB\u4E0D\u8A08\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8868\u73FE\u3002` : void 0;
  const investmentGainHKD = hasSufficientFlowCoverage ? totalValueChangeHKD - flowSummary.netExternalFlowHKD : void 0;
  const investmentGainPercent = typeof investmentGainHKD === "number" && previous.totalValueHKD > 0 ? investmentGainHKD / previous.totalValueHKD * 100 : void 0;
  const assetTypeChanges = buildDistributionChanges(
    current,
    previous,
    (holding) => String(holding.assetType || "unknown")
  ).map((entry) => ({
    assetType: entry.key,
    currentPercent: entry.currentPercent,
    previousPercent: entry.previousPercent,
    deltaPercent: entry.deltaPercent
  }));
  const currencyChanges = buildDistributionChanges(
    current,
    previous,
    (holding) => String(holding.currency || "unknown").toUpperCase()
  ).map((entry) => ({
    currency: entry.key,
    currentPercent: entry.currentPercent,
    previousPercent: entry.previousPercent,
    deltaPercent: entry.deltaPercent
  }));
  return {
    periodLabel: formatPeriodLabel(current.date, previous.date),
    currentDate: normalizeDateKey(current.date),
    previousDate: normalizeDateKey(previous.date),
    totalValue: {
      current: current.totalValueHKD,
      previous: previous.totalValueHKD,
      changeHKD: totalValueChangeHKD,
      changePercent: totalValueChangePercent,
      netExternalFlowHKD: hasSufficientFlowCoverage ? flowSummary?.netExternalFlowHKD : void 0,
      netExternalFlowCoveragePct,
      investmentGainHKD,
      investmentGainPercent,
      cashFlowDataComplete: flowSummary?.isComplete ?? false,
      cashFlowWarningMessage
    },
    assetTypeChanges,
    currencyChanges,
    holdingChanges,
    topMovers: {
      gainers,
      losers
    },
    newHoldings
  };
}
function selectRecentDistinctMonthlySnapshots(snapshots, count = 3) {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  for (const snapshot of [...snapshots].sort((left, right) => right.date.localeCompare(left.date))) {
    const monthKey = getMonthKey(snapshot.date);
    if (seen.has(monthKey)) {
      continue;
    }
    seen.add(monthKey);
    result.push(snapshot);
    if (result.length >= count) {
      break;
    }
  }
  return result;
}
function formatUtcDateKey(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0")
  ].join("-");
}
function getQuarterMonthEnds(quarterEndDate) {
  const normalized = normalizeDateKey(quarterEndDate);
  const year = Number(normalized.slice(0, 4));
  const endMonth = Number(normalized.slice(5, 7));
  const startMonth = endMonth - 2;
  return [startMonth, startMonth + 1, startMonth + 2].map((month) => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return formatUtcDateKey(year, month, lastDay);
  });
}
function selectQuarterMonthEndSnapshots(snapshots, quarterEndDate, baselineDate) {
  const normalizedSnapshots = [...snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const selectOnOrBefore = (targetDate) => normalizedSnapshots.filter((snapshot) => normalizeDateKey(snapshot.date) <= normalizeDateKey(targetDate)).sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;
  const points = [
    { label: baselineDate.slice(0, 7), targetDate: normalizeDateKey(baselineDate), snapshot: selectOnOrBefore(baselineDate) },
    ...getQuarterMonthEnds(quarterEndDate).map((targetDate) => ({
      label: targetDate.slice(0, 7),
      targetDate,
      snapshot: selectOnOrBefore(targetDate)
    }))
  ];
  return {
    points,
    missingLabels: points.filter((point) => !point.snapshot).map((point) => point.label)
  };
}
function formatMoney(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "0.0%";
}
function formatSignedPercent(value) {
  return `${value >= 0 ? "+" : ""}${formatPercent(value)}`;
}
function formatHoldingStatus(status) {
  if (status === "new") return "\u65B0\u589E";
  if (status === "closed") return "\u6E05\u5009";
  if (status === "increased") return "\u52A0\u5009";
  if (status === "decreased") return "\u6E1B\u5009";
  return "\u4E0D\u8B8A";
}
function formatSnapshotComparisonForPrompt(comparison) {
  const holdingLines = comparison.holdingChanges.filter((change) => change.status !== "unchanged" || Math.abs(change.contributionToPortfolioChange) > 0.01).slice(0, 12).map(
    (change) => `- ${change.ticker} ${formatHoldingStatus(change.status)}\uFF1A\u73FE\u503C ${formatMoney(change.currentValue)} HKD\uFF0C\u524D\u503C ${formatMoney(change.previousValue)} HKD\uFF0C\u5009\u4F4D\u8B8A\u5316 ${formatMoney(change.quantityChange)}\uFF0C\u50F9\u683C\u8B8A\u5316 ${formatSignedPercent(change.priceChangePercent)}\uFF0C\u50F9\u683C\u6548\u61C9 ${formatMoney(change.priceEffectHKD)} HKD\uFF0C\u8CB7\u8CE3\u6548\u61C9 ${formatMoney(change.flowEffectHKD)} HKD\uFF0C\u7D44\u5408\u8CA2\u737B ${formatSignedPercent(change.contributionToPortfolioChange / (comparison.totalValue.previous || 1) * 100)} / ${formatMoney(change.contributionToPortfolioChange)} HKD`
  );
  const positiveMovers = comparison.topMovers.gainers.map(
    (item) => `- ${item.ticker}\uFF1A${formatSignedPercent(item.changePercent)}\uFF0C\u8CA2\u737B ${formatMoney(item.contributionHKD)} HKD`
  ).join("\n");
  const negativeMovers = comparison.topMovers.losers.map(
    (item) => `- ${item.ticker}\uFF1A${formatSignedPercent(item.changePercent)}\uFF0C\u62D6\u7D2F ${formatMoney(item.contributionHKD)} HKD`
  ).join("\n");
  return [
    `\u3010\u671F\u9593\u3011${comparison.periodLabel}`,
    `\u3010\u7E3D\u8CC7\u7522\u8B8A\u5316\u3011\u73FE\u503C ${formatMoney(comparison.totalValue.current)} HKD\uFF5C\u524D\u503C ${formatMoney(comparison.totalValue.previous)} HKD\uFF5C\u8B8A\u5316 ${formatMoney(comparison.totalValue.changeHKD)} HKD\uFF5C${formatSignedPercent(comparison.totalValue.changePercent)}`,
    typeof comparison.totalValue.netExternalFlowCoveragePct === "number" && comparison.totalValue.netExternalFlowCoveragePct < 80 ? "\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u3011\u8CC7\u91D1\u6D41\u8986\u84CB\u4E0D\u8DB3\uFF0C\u66AB\u4E0D\u8A08\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u8868\u73FE\u3002" : typeof comparison.totalValue.netExternalFlowHKD === "number" && typeof comparison.totalValue.investmentGainHKD === "number" && typeof comparison.totalValue.investmentGainPercent === "number" ? comparison.totalValue.cashFlowDataComplete ? `\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u3011\u6DE8\u5165\u91D1\uFF0F\u51FA\u91D1 ${formatMoney(comparison.totalValue.netExternalFlowHKD)} HKD\uFF5C\u6295\u8CC7\u8868\u73FE ${formatMoney(comparison.totalValue.investmentGainHKD)} HKD\uFF5C${formatSignedPercent(comparison.totalValue.investmentGainPercent)}` : `\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u3011\u8CC7\u91D1\u6D41\u8CC7\u6599\u672A\u5B8C\u5168\u8986\u84CB\uFF5C\u6DE8\u5165\u91D1\uFF0F\u51FA\u91D1 ${formatMoney(comparison.totalValue.netExternalFlowHKD)} HKD\uFF5C\u6295\u8CC7\u8868\u73FE ${formatMoney(comparison.totalValue.investmentGainHKD)} HKD\uFF5C${formatSignedPercent(comparison.totalValue.investmentGainPercent)}` : "\u3010\u6263\u9664\u8CC7\u91D1\u6D41\u5F8C\u3011\u672A\u80FD\u5B8C\u6574\u6263\u9664\u5165\u91D1\uFF0F\u51FA\u91D1\uFF0C\u4EE5\u4E0B\u53EA\u53CD\u6620\u7E3D\u8CC7\u7522\u8B8A\u5316\u3002",
    `\u3010\u8CC7\u7522\u985E\u5225\u8B8A\u5316\u3011`,
    ...comparison.assetTypeChanges.map(
      (entry) => `- ${entry.assetType}\uFF1A${formatPercent(entry.previousPercent)} \u2192 ${formatPercent(entry.currentPercent)}\uFF08${formatSignedPercent(entry.deltaPercent)}\uFF09`
    ),
    `\u3010\u5E63\u5225\u66DD\u96AA\u8B8A\u5316\u3011`,
    ...comparison.currencyChanges.map(
      (entry) => `- ${entry.currency}\uFF1A${formatPercent(entry.previousPercent)} \u2192 ${formatPercent(entry.currentPercent)}\uFF08${formatSignedPercent(entry.deltaPercent)}\uFF09`
    ),
    `\u3010\u6301\u5009\u8B8A\u52D5\u3011`,
    ...holdingLines,
    `\u3010\u6700\u5927\u8CA2\u737B\u8005\u3011`,
    positiveMovers || "- \u7121\u6B63\u8CA2\u737B\u6301\u5009",
    `\u3010\u6700\u5927\u62D6\u7D2F\u8005\u3011`,
    negativeMovers || "- \u7121\u8CA0\u8CA2\u737B\u6301\u5009",
    `\u3010\u671F\u5167\u65B0\u589E\u6301\u5009\u3011`,
    comparison.newHoldings.map((item) => `- ${item.ticker}\uFF1A${formatMoney(item.valueHKD)} HKD`).join("\n") || "- \u7121\u65B0\u589E\u6301\u5009"
  ].filter(Boolean).join("\n");
}
export {
  compareSnapshots,
  formatSnapshotComparisonForPrompt,
  getMonthKey,
  normalizeDateKey,
  selectQuarterMonthEndSnapshots,
  selectRecentDistinctMonthlySnapshots,
  summarizePeriodExternalFlow
};
