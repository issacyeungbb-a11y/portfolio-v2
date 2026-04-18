import type { AssetType } from '../src/types/portfolio';

export interface SnapshotComparisonHolding {
  assetId: string;
  ticker: string;
  name: string;
  assetType: AssetType | string;
  currency: string;
  quantity: number;
  currentPrice: number;
  marketValueHKD: number;
}

export interface SnapshotComparisonSource {
  date: string;
  totalValueHKD: number;
  holdings: SnapshotComparisonHolding[];
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
  }>;
  topMovers: {
    gainers: Array<{ ticker: string; changePercent: number; contributionHKD: number }>;
    losers: Array<{ ticker: string; changePercent: number; contributionHKD: number }>;
  };
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
    .filter((item) => item.contributionToPortfolioChange > 0)
    .slice()
    .sort((left, right) => right.contributionToPortfolioChange - left.contributionToPortfolioChange)
    .slice(0, 3)
    .map((item) => ({
      ticker: item.ticker,
      changePercent:
        item.previousValue > 0
          ? (item.contributionToPortfolioChange / item.previousValue) * 100
          : item.currentValue > 0
            ? 100
            : 0,
      contributionHKD: item.contributionToPortfolioChange,
    }));

  const losers = holdingChanges
    .filter((item) => item.contributionToPortfolioChange < 0)
    .slice()
    .sort((left, right) => left.contributionToPortfolioChange - right.contributionToPortfolioChange)
    .slice(0, 3)
    .map((item) => ({
      ticker: item.ticker,
      changePercent:
        item.previousValue > 0
          ? (item.contributionToPortfolioChange / item.previousValue) * 100
          : item.currentValue > 0
            ? 100
            : -100,
      contributionHKD: item.contributionToPortfolioChange,
    }));

  const totalValueChangeHKD = current.totalValueHKD - previous.totalValueHKD;
  const totalValueChangePercent =
    previous.totalValueHKD !== 0 ? (totalValueChangeHKD / previous.totalValueHKD) * 100 : 0;

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
    },
    assetTypeChanges,
    currencyChanges,
    holdingChanges,
    topMovers: {
      gainers,
      losers,
    },
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
  ]
    .filter(Boolean)
    .join('\n');
}
