import {
  convertCurrency,
  formatDateLabel,
  formatPercent,
  getHoldingValueInCurrency,
  getPerformanceRangeLabel,
} from '../../data/mockPortfolio';
import type {
  AccountCashFlowEntry,
  AssetChangeRange,
  DisplayCurrency,
  Holding,
  PortfolioPerformancePoint,
  SnapshotHoldingPoint,
} from '../../types/portfolio';

const DAY_MS = 24 * 60 * 60 * 1000;
const assetChangeRangeLabels: Record<AssetChangeRange, string> = {
  '1d': '今日',
  '7d': '7日',
  '30d': '30日',
};

export interface AssetChangeSummary {
  range: AssetChangeRange;
  label: string;
  startDate: string;
  endDate: string;
  startValue: number;
  endValue: number;
  netExternalFlow: number;
  marketChange: number;
  totalChange: number;
  returnPct: number;
}

export interface AssetMover {
  assetId: string;
  name: string;
  symbol: string;
  changeAmount: number;
  previousValue: number;
  currentValue: number;
  changePct: number | null;
}

function getSignedCashFlowAmount(entry: Pick<AccountCashFlowEntry, 'type' | 'amount'>) {
  if (entry.type === 'withdrawal') {
    return -Math.abs(entry.amount);
  }

  return entry.amount;
}

function parseSnapshotTime(point: Pick<PortfolioPerformancePoint, 'capturedAt' | 'date'>) {
  return new Date(point.capturedAt ?? `${point.date}T00:00:00.000Z`);
}

function formatSnapshotHoldingFromHolding(holding: Holding): SnapshotHoldingPoint {
  return {
    assetId: holding.id,
    name: holding.name,
    symbol: holding.symbol,
    assetType: holding.assetType,
    accountSource: holding.accountSource,
    currency: holding.currency,
    quantity: holding.quantity,
    currentPrice: holding.currentPrice,
    averageCost: holding.averageCost,
    marketValueHKD: getHoldingValueInCurrency(holding, 'HKD'),
  };
}

export function createCurrentPortfolioPoint(holdings: Holding[]): PortfolioPerformancePoint {
  const capturedAt = new Date().toISOString();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());

  return {
    id: 'current-live',
    date,
    capturedAt,
    totalValue: holdings.reduce((sum, holding) => sum + getHoldingValueInCurrency(holding, 'HKD'), 0),
    netExternalFlow: 0,
    assetCount: holdings.length,
    holdings: holdings.map(formatSnapshotHoldingFromHolding),
    reason: 'snapshot',
  };
}

function getRangeDayCount(range: AssetChangeRange) {
  if (range === '1d') return 1;
  if (range === '7d') return 7;
  return 30;
}

export function findAssetChangeComparisonPoint(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint,
  range: AssetChangeRange,
) {
  const currentDate = parseSnapshotTime(currentPoint);
  const targetMs = currentDate.getTime() - getRangeDayCount(range) * DAY_MS;
  const sorted = [...history].sort(
    (left, right) => parseSnapshotTime(left).getTime() - parseSnapshotTime(right).getTime(),
  );

  let selected = sorted[0] ?? null;

  for (const point of sorted) {
    if (parseSnapshotTime(point).getTime() <= targetMs) {
      selected = point;
    }
  }

  return selected ?? null;
}

function getNetExternalFlowForRange(
  cashFlows: AccountCashFlowEntry[],
  startPoint: PortfolioPerformancePoint,
  endPoint: PortfolioPerformancePoint,
) {
  const startMs = parseSnapshotTime(startPoint).getTime();
  const endMs = parseSnapshotTime(endPoint).getTime();

  return cashFlows.reduce((sum, entry) => {
    const entryMs = new Date(`${entry.date}T00:00:00.000Z`).getTime();

    if (entryMs <= startMs || entryMs > endMs) {
      return sum;
    }

    return sum + convertCurrency(getSignedCashFlowAmount(entry), entry.currency, 'HKD');
  }, 0);
}

export function calculateAssetChangeSummary(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint,
  cashFlows: AccountCashFlowEntry[],
  range: AssetChangeRange,
  todaySnapshotExists = true,
): AssetChangeSummary | null {
  if (range === '1d' && !todaySnapshotExists) {
    return null;
  }

  const startPoint = findAssetChangeComparisonPoint(history, currentPoint, range);

  if (!startPoint) {
    return null;
  }

  const netExternalFlow = getNetExternalFlowForRange(cashFlows, startPoint, currentPoint);
  const totalChange = currentPoint.totalValue - startPoint.totalValue;
  const marketChange = totalChange - netExternalFlow;
  const returnPct = startPoint.totalValue === 0 ? 0 : (marketChange / startPoint.totalValue) * 100;

  return {
    range,
    label: assetChangeRangeLabels[range],
    startDate: startPoint.date,
    endDate: currentPoint.date,
    startValue: startPoint.totalValue,
    endValue: currentPoint.totalValue,
    netExternalFlow,
    marketChange,
    totalChange,
    returnPct,
  };
}

export function buildAssetChangeOverview(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint,
  cashFlows: AccountCashFlowEntry[],
  todaySnapshotExists = true,
) {
  return (['1d', '7d', '30d'] as AssetChangeRange[])
    .map((range) =>
      calculateAssetChangeSummary(
        history,
        currentPoint,
        cashFlows,
        range,
        todaySnapshotExists,
      ),
    )
    .filter((summary): summary is AssetChangeSummary => summary !== null);
}

function buildHoldingsMap(holdings: SnapshotHoldingPoint[] | undefined) {
  const map = new Map<string, SnapshotHoldingPoint>();

  for (const holding of holdings ?? []) {
    map.set(holding.assetId, holding);
  }

  return map;
}

export function buildAssetMovers(
  currentPoint: PortfolioPerformancePoint,
  comparisonPoint: PortfolioPerformancePoint | null,
) {
  if (!comparisonPoint) {
    return {
      gainers: [] as AssetMover[],
      losers: [] as AssetMover[],
    };
  }

  const currentMap = buildHoldingsMap(currentPoint.holdings);
  const previousMap = buildHoldingsMap(comparisonPoint.holdings);
  const assetIds = new Set([...currentMap.keys(), ...previousMap.keys()]);
  const movers: AssetMover[] = [];

  for (const assetId of assetIds) {
    const current = currentMap.get(assetId);
    const previous = previousMap.get(assetId);
    const currentValue = current?.marketValueHKD ?? 0;
    const previousValue = previous?.marketValueHKD ?? 0;
    const changeAmount = currentValue - previousValue;

    if (changeAmount === 0) {
      continue;
    }

    const base = current ?? previous;
    if (!base) {
      continue;
    }

    movers.push({
      assetId,
      name: base.name,
      symbol: base.symbol,
      changeAmount,
      previousValue,
      currentValue,
      changePct: previousValue > 0 ? (changeAmount / previousValue) * 100 : null,
    });
  }

  const sorted = movers.sort((left, right) => right.changeAmount - left.changeAmount);

  return {
    gainers: sorted.filter((item) => item.changeAmount > 0).slice(0, 3),
    losers: [...sorted].reverse().filter((item) => item.changeAmount < 0).slice(0, 3),
  };
}

export function formatAssetChangeValue(
  amountHKD: number,
  displayCurrency: DisplayCurrency,
) {
  return convertCurrency(amountHKD, 'HKD', displayCurrency);
}

export function formatAssetChangeRangeLabel(range: AssetChangeRange) {
  return assetChangeRangeLabels[range];
}

export function formatAssetMoverChangePct(value: number | null) {
  if (value == null) {
    return '新加入';
  }

  return formatPercent(value);
}

export function formatAssetChangePeriod(summary: AssetChangeSummary) {
  return `${formatDateLabel(summary.startDate)} 至 ${formatDateLabel(summary.endDate)}`;
}

export function formatLegacyPerformanceLabel(range: '7d' | '30d' | '6m' | '1y') {
  return getPerformanceRangeLabel(range);
}
