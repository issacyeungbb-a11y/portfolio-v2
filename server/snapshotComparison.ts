import type { AssetType } from '../src/types/portfolio';

export interface SnapshotComparisonHolding {
  assetId: string;
  ticker: string;
  name: string;
  assetType: AssetType | string;
  accountSource?: string;
  currency: string;
  quantity: number;
  currentPrice: number;
  marketValueHKD: number;
}

export interface SnapshotComparisonSource {
  id?: string;
  date: string;
  totalValueHKD: number;
  netExternalFlowHKD?: number;
  snapshotQuality?: 'strict' | 'fallback';
  coveragePct?: number;
  fallbackAssetCount?: number;
  missingAssetCount?: number;
  fxSource?: 'cron_pipeline' | 'persisted' | 'live' | 'unknown';
  fxRatesUsed?: {
    USD?: number;
    JPY?: number;
    HKD?: number;
  };
  holdings: SnapshotComparisonHolding[];
}

export interface SnapshotFlowSummary {
  isComplete: boolean;
  expectedSnapshotDays: number;
  availableSnapshotDays: number;
  netExternalFlowCoveragePct: number;
  netExternalFlowHKD?: number;
  periodStartDate: string;
  periodEndDate: string;
  missingDates: string[];
}

export interface SnapshotComparison {
  periodLabel: string;
  currentDate: string;
  previousDate: string;
  totalValue: {
    current: number;
    previous: number;
    changeHKD: number;
    changePercent: number;
    netExternalFlowHKD?: number;
    netExternalFlowCoveragePct?: number;
    investmentGainHKD?: number;
    investmentGainPercent?: number;
    cashFlowDataComplete: boolean;
    cashFlowWarningMessage?: string;
  };
  assetTypeChanges: Array<{
    assetType: string;
    currentPercent: number;
    previousPercent: number;
    deltaPercent: number;
  }>;
  currencyChanges: Array<{
    currency: string;
    currentPercent: number;
    previousPercent: number;
    deltaPercent: number;
  }>;
  holdingChanges: Array<{
    ticker: string;
    name: string;
    status: 'new' | 'closed' | 'increased' | 'decreased' | 'unchanged';
    currentValue: number;
    previousValue: number;
    quantityChange: number;
    priceChangePercent: number;
    contributionToPortfolioChange: number;
    priceEffectHKD: number;
    flowEffectHKD: number;
  }>;
  topMovers: {
    gainers: Array<{ ticker: string; changePercent: number; contributionHKD: number }>;
    losers: Array<{ ticker: string; changePercent: number; contributionHKD: number }>;
  };
  newHoldings: Array<{ ticker: string; valueHKD: number }>;
}

function toFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function trimString(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeDateKey(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  throw new Error(`[snapshotComparison] 無法解析日期：${value}`);
}

export function getMonthKey(value: string) {
  const normalized = normalizeDateKey(value);
  return normalized.slice(0, 7);
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function listDateKeysBetween(startDateExclusive: string, endDateInclusive: string) {
  const keys: string[] = [];
  const cursor = new Date(`${normalizeDateKey(startDateExclusive)}T00:00:00Z`);
  const end = new Date(`${normalizeDateKey(endDateInclusive)}T00:00:00Z`);

  cursor.setUTCDate(cursor.getUTCDate() + 1);

  while (cursor <= end) {
    keys.push(formatDateKey(cursor));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return keys;
}

export function summarizePeriodExternalFlow(
  previousDate: string,
  currentDate: string,
  snapshots: SnapshotComparisonSource[],
): SnapshotFlowSummary {
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
      missingDates: [],
    };
  }

  const snapshotsByDate = new Map(
    snapshots.map((snapshot) => [normalizeDateKey(snapshot.date), snapshot]),
  );
  const availableDates = expectedDates.filter((date) => snapshotsByDate.has(date));
  const missingDates = expectedDates.filter((date) => !snapshotsByDate.has(date));
  const netExternalFlowCoveragePct =
    expectedDates.length > 0 ? Math.floor((availableDates.length / expectedDates.length) * 100) : 100;

  if (netExternalFlowCoveragePct < 80) {
    return {
      isComplete: false,
      expectedSnapshotDays: expectedDates.length,
      availableSnapshotDays: availableDates.length,
      netExternalFlowCoveragePct,
      periodStartDate: normalizeDateKey(previousDate),
      periodEndDate: normalizeDateKey(currentDate),
      missingDates,
    };
  }

  return {
    isComplete: netExternalFlowCoveragePct === 100,
    expectedSnapshotDays: expectedDates.length,
    availableSnapshotDays: availableDates.length,
    netExternalFlowCoveragePct,
    netExternalFlowHKD: availableDates.reduce(
      (sum, date) => sum + toFiniteNumber(snapshotsByDate.get(date)?.netExternalFlowHKD),
      0,
    ),
    periodStartDate: normalizeDateKey(previousDate),
    periodEndDate: normalizeDateKey(currentDate),
    missingDates,
  };
}

function getHoldingKey(holding: SnapshotComparisonHolding) {
  return holding.assetId || `${holding.ticker}|${holding.currency}`;
}

function getHoldingValue(holding: SnapshotComparisonHolding) {
  return toFiniteNumber(holding.marketValueHKD);
}

function getHoldingQuantity(holding: SnapshotComparisonHolding) {
  return toFiniteNumber(holding.quantity);
}

function getHoldingPrice(holding: SnapshotComparisonHolding) {
  return toFiniteNumber(holding.currentPrice);
}

function getAllocationBuckets(
  source: SnapshotComparisonSource,
  keySelector: (holding: SnapshotComparisonHolding) => string,
) {
  const buckets = new Map<string, number>();

  for (const holding of source.holdings) {
    const key = keySelector(holding);
    buckets.set(key, (buckets.get(key) ?? 0) + getHoldingValue(holding));
  }

  return buckets;
}

function formatPeriodLabel(currentDate: string, previousDate: string) {
  const current = normalizeDateKey(currentDate).slice(0, 7);
  const previous = normalizeDateKey(previousDate).slice(0, 7);
  return `${current} vs ${previous}`;
}

function buildHoldingChange(
  current: SnapshotComparisonHolding | null,
  previous: SnapshotComparisonHolding | null,
) {
  const currentValue = current ? getHoldingValue(current) : 0;
  const previousValue = previous ? getHoldingValue(previous) : 0;
  const quantityChange = (current ? getHoldingQuantity(current) : 0) - (previous ? getHoldingQuantity(previous) : 0);
  const priceChangePercent =
    current && previous && getHoldingPrice(previous) > 0
      ? ((getHoldingPrice(current) - getHoldingPrice(previous)) / getHoldingPrice(previous)) * 100
      : 0;
  const contributionToPortfolioChange = currentValue - previousValue;
  const priceEffectHKD = previousValue * (priceChangePercent / 100);
  const flowEffectHKD = contributionToPortfolioChange - priceEffectHKD;

  let status: SnapshotComparison['holdingChanges'][number]['status'] = 'unchanged';

  if (current && !previous) {
    status = 'new';
  } else if (!current && previous) {
    status = 'closed';
  } else if (quantityChange > 1e-8) {
    status = 'increased';
  } else if (quantityChange < -1e-8) {
    status = 'decreased';
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
    flowEffectHKD,
  };
}

function buildDistributionChanges(
  current: SnapshotComparisonSource,
  previous: SnapshotComparisonSource,
  keySelector: (holding: SnapshotComparisonHolding) => string,
) {
  const currentBuckets = getAllocationBuckets(current, keySelector);
  const previousBuckets = getAllocationBuckets(previous, keySelector);
  const keys = [...new Set([...currentBuckets.keys(), ...previousBuckets.keys()])];

  return keys
    .map((key) => {
      const currentValue = currentBuckets.get(key) ?? 0;
      const previousValue = previousBuckets.get(key) ?? 0;
      const currentPercent = current.totalValueHKD > 0 ? (currentValue / current.totalValueHKD) * 100 : 0;
      const previousPercent = previous.totalValueHKD > 0 ? (previousValue / previous.totalValueHKD) * 100 : 0;

      return {
        key,
        currentPercent,
        previousPercent,
        deltaPercent: currentPercent - previousPercent,
      };
    })
    .sort((left, right) => Math.abs(right.deltaPercent) - Math.abs(left.deltaPercent));
}

export function compareSnapshots(
  current: SnapshotComparisonSource,
  previous: SnapshotComparisonSource,
  options?: {
    periodSnapshots?: SnapshotComparisonSource[];
  },
): SnapshotComparison {
  const currentHoldings = new Map(
    current.holdings.map((holding) => [getHoldingKey(holding), holding]),
  );
  const previousHoldings = new Map(
    previous.holdings.map((holding) => [getHoldingKey(holding), holding]),
  );
  const keys = [...new Set([...currentHoldings.keys(), ...previousHoldings.keys()])];

  const holdingChanges = keys
    .map((key) => buildHoldingChange(currentHoldings.get(key) ?? null, previousHoldings.get(key) ?? null))
    .sort((left, right) => Math.abs(right.contributionToPortfolioChange) - Math.abs(left.contributionToPortfolioChange));

  const gainers = holdingChanges
    .filter((item) => item.status !== 'new' && item.priceEffectHKD > 0)
    .slice()
    .sort((left, right) => right.priceEffectHKD - left.priceEffectHKD)
    .slice(0, 3)
    .map((item) => ({
      ticker: item.ticker,
      changePercent: item.priceChangePercent,
      contributionHKD: item.priceEffectHKD,
    }));

  const losers = holdingChanges
    .filter((item) => item.status !== 'new' && item.priceEffectHKD < 0)
    .slice()
    .sort((left, right) => left.priceEffectHKD - right.priceEffectHKD)
    .slice(0, 3)
    .map((item) => ({
      ticker: item.ticker,
      changePercent: item.priceChangePercent,
      contributionHKD: item.priceEffectHKD,
    }));
  const newHoldings = holdingChanges
    .filter((item) => item.status === 'new' && item.currentValue > 0)
    .sort((left, right) => right.currentValue - left.currentValue)
    .slice(0, 8)
    .map((item) => ({
      ticker: item.ticker,
      valueHKD: item.currentValue,
    }));

  const totalValueChangeHKD = current.totalValueHKD - previous.totalValueHKD;
  const totalValueChangePercent =
    previous.totalValueHKD !== 0 ? (totalValueChangeHKD / previous.totalValueHKD) * 100 : 0;
  const flowSummary = options?.periodSnapshots
    ? summarizePeriodExternalFlow(previous.date, current.date, options.periodSnapshots)
    : null;
  const netExternalFlowCoveragePct = flowSummary?.netExternalFlowCoveragePct;
  const hasSufficientFlowCoverage =
    typeof netExternalFlowCoveragePct === 'number' &&
    netExternalFlowCoveragePct >= 80 &&
    typeof flowSummary?.netExternalFlowHKD === 'number';
  const cashFlowWarningMessage =
    typeof netExternalFlowCoveragePct === 'number' && netExternalFlowCoveragePct >= 80 && netExternalFlowCoveragePct < 100
      ? `資金流資料未完全覆蓋（${netExternalFlowCoveragePct}%）`
      : typeof netExternalFlowCoveragePct === 'number' && netExternalFlowCoveragePct < 80
        ? `資金流覆蓋不足（${netExternalFlowCoveragePct}%），暫不計扣除資金流後表現。`
        : undefined;
  const investmentGainHKD =
    hasSufficientFlowCoverage
      ? totalValueChangeHKD - flowSummary.netExternalFlowHKD
      : undefined;
  const investmentGainPercent =
    typeof investmentGainHKD === 'number' && previous.totalValueHKD > 0
      ? (investmentGainHKD / previous.totalValueHKD) * 100
      : undefined;

  const assetTypeChanges = buildDistributionChanges(current, previous, (holding) =>
    String(holding.assetType || 'unknown'),
  ).map((entry) => ({
    assetType: entry.key,
    currentPercent: entry.currentPercent,
    previousPercent: entry.previousPercent,
    deltaPercent: entry.deltaPercent,
  }));

  const currencyChanges = buildDistributionChanges(current, previous, (holding) =>
    String(holding.currency || 'unknown').toUpperCase(),
  ).map((entry) => ({
    currency: entry.key,
    currentPercent: entry.currentPercent,
    previousPercent: entry.previousPercent,
    deltaPercent: entry.deltaPercent,
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
      netExternalFlowHKD: hasSufficientFlowCoverage ? flowSummary?.netExternalFlowHKD : undefined,
      netExternalFlowCoveragePct,
      investmentGainHKD,
      investmentGainPercent,
      cashFlowDataComplete: flowSummary?.isComplete ?? false,
      cashFlowWarningMessage,
    },
    assetTypeChanges,
    currencyChanges,
    holdingChanges,
    topMovers: {
      gainers,
      losers,
    },
    newHoldings,
  };
}

export function selectRecentDistinctMonthlySnapshots<T extends SnapshotComparisonSource>(
  snapshots: T[],
  count = 3,
) {
  const result: T[] = [];
  const seen = new Set<string>();

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

function formatUtcDateKey(year: number, month: number, day: number) {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

function getQuarterMonthEnds(quarterEndDate: string) {
  const normalized = normalizeDateKey(quarterEndDate);
  const year = Number(normalized.slice(0, 4));
  const endMonth = Number(normalized.slice(5, 7));
  const startMonth = endMonth - 2;

  return [startMonth, startMonth + 1, startMonth + 2].map((month) => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return formatUtcDateKey(year, month, lastDay);
  });
}

export function selectQuarterMonthEndSnapshots<T extends SnapshotComparisonSource>(
  snapshots: T[],
  quarterEndDate: string,
  baselineDate: string,
) {
  const normalizedSnapshots = [...snapshots].sort((left, right) => left.date.localeCompare(right.date));
  const selectOnOrBefore = (targetDate: string) =>
    normalizedSnapshots
      .filter((snapshot) => normalizeDateKey(snapshot.date) <= normalizeDateKey(targetDate))
      .sort((left, right) => right.date.localeCompare(left.date))[0] ?? null;

  const points = [
    { label: baselineDate.slice(0, 7), targetDate: normalizeDateKey(baselineDate), snapshot: selectOnOrBefore(baselineDate) },
    ...getQuarterMonthEnds(quarterEndDate).map((targetDate) => ({
      label: targetDate.slice(0, 7),
      targetDate,
      snapshot: selectOnOrBefore(targetDate),
    })),
  ];

  return {
    points,
    missingLabels: points.filter((point) => !point.snapshot).map((point) => point.label),
  };
}

function formatMoney(value: number) {
  return Number.isFinite(value) ? value.toFixed(2) : '0.00';
}

function formatPercent(value: number) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : '0.0%';
}

function formatSignedPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${formatPercent(value)}`;
}

function formatHoldingStatus(status: SnapshotComparison['holdingChanges'][number]['status']) {
  if (status === 'new') return '新增';
  if (status === 'closed') return '清倉';
  if (status === 'increased') return '加倉';
  if (status === 'decreased') return '減倉';
  return '不變';
}

export function formatSnapshotComparisonForPrompt(comparison: SnapshotComparison) {
  const holdingLines = comparison.holdingChanges
    .filter((change) => change.status !== 'unchanged' || Math.abs(change.contributionToPortfolioChange) > 0.01)
    .slice(0, 12)
    .map(
      (change) =>
        `- ${change.ticker} ${formatHoldingStatus(change.status)}：` +
        `現值 ${formatMoney(change.currentValue)} HKD，前值 ${formatMoney(change.previousValue)} HKD，` +
        `倉位變化 ${formatMoney(change.quantityChange)}，價格變化 ${formatSignedPercent(change.priceChangePercent)}，` +
        `價格效應 ${formatMoney(change.priceEffectHKD)} HKD，買賣效應 ${formatMoney(change.flowEffectHKD)} HKD，` +
        `組合貢獻 ${formatSignedPercent((change.contributionToPortfolioChange / (comparison.totalValue.previous || 1)) * 100)} / ${formatMoney(change.contributionToPortfolioChange)} HKD`,
    );

  const positiveMovers = comparison.topMovers.gainers
    .map(
      (item) =>
        `- ${item.ticker}：${formatSignedPercent(item.changePercent)}，貢獻 ${formatMoney(item.contributionHKD)} HKD`,
    )
    .join('\n');

  const negativeMovers = comparison.topMovers.losers
    .map(
      (item) =>
        `- ${item.ticker}：${formatSignedPercent(item.changePercent)}，拖累 ${formatMoney(item.contributionHKD)} HKD`,
    )
    .join('\n');

  return [
    `【期間】${comparison.periodLabel}`,
    `【總資產變化】現值 ${formatMoney(comparison.totalValue.current)} HKD｜前值 ${formatMoney(comparison.totalValue.previous)} HKD｜變化 ${formatMoney(comparison.totalValue.changeHKD)} HKD｜${formatSignedPercent(comparison.totalValue.changePercent)}`,
    typeof comparison.totalValue.netExternalFlowCoveragePct === 'number' &&
    comparison.totalValue.netExternalFlowCoveragePct < 80
      ? '【扣除資金流後】資金流覆蓋不足，暫不計扣除資金流後表現。'
      : typeof comparison.totalValue.netExternalFlowHKD === 'number' &&
          typeof comparison.totalValue.investmentGainHKD === 'number' &&
          typeof comparison.totalValue.investmentGainPercent === 'number'
        ? comparison.totalValue.cashFlowDataComplete
          ? `【扣除資金流後】淨入金／出金 ${formatMoney(comparison.totalValue.netExternalFlowHKD)} HKD｜投資表現 ${formatMoney(comparison.totalValue.investmentGainHKD)} HKD｜${formatSignedPercent(comparison.totalValue.investmentGainPercent)}`
          : `【扣除資金流後】資金流資料未完全覆蓋｜淨入金／出金 ${formatMoney(comparison.totalValue.netExternalFlowHKD)} HKD｜投資表現 ${formatMoney(comparison.totalValue.investmentGainHKD)} HKD｜${formatSignedPercent(comparison.totalValue.investmentGainPercent)}`
        : '【扣除資金流後】未能完整扣除入金／出金，以下只反映總資產變化。',
    `【資產類別變化】`,
    ...comparison.assetTypeChanges.map(
      (entry) =>
        `- ${entry.assetType}：${formatPercent(entry.previousPercent)} → ${formatPercent(entry.currentPercent)}（${formatSignedPercent(entry.deltaPercent)}）`,
    ),
    `【幣別曝險變化】`,
    ...comparison.currencyChanges.map(
      (entry) =>
        `- ${entry.currency}：${formatPercent(entry.previousPercent)} → ${formatPercent(entry.currentPercent)}（${formatSignedPercent(entry.deltaPercent)}）`,
    ),
    `【持倉變動】`,
    ...holdingLines,
    `【最大貢獻者】`,
    positiveMovers || '- 無正貢獻持倉',
    `【最大拖累者】`,
    negativeMovers || '- 無負貢獻持倉',
    `【期內新增持倉】`,
    comparison.newHoldings.map((item) => `- ${item.ticker}：${formatMoney(item.valueHKD)} HKD`).join('\n') || '- 無新增持倉',
  ]
    .filter(Boolean)
    .join('\n');
}
