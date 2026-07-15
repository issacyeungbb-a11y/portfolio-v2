import { convertCurrency } from '../currency';
import {
  aggregateHoldingsForAllocation,
  getCashFlowSignedAmount,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
} from '../holdings';
import {
  calculateAssetChangeSummary,
  calculatePerformanceBetweenPoints,
} from './assetChange';
import {
  getTransactionPriceComparison,
  type TransactionPriceComparison,
} from './transactionPriceComparison';
import type {
  AccountCashFlowEntry,
  AccountPrincipalEntry,
  AccountSource,
  AnalysisSession,
  AssetChangeRange,
  AssetTransactionEntry,
  DisplayCurrency,
  Holding,
  PortfolioPerformancePoint,
} from '../../types/portfolio';
import type { QuarterlyReport } from '../firebase/quarterlyReports';

export const dashboardAccountSources: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];

export interface AccountPrincipalSummary {
  accountSource: AccountSource;
  baseline: AccountPrincipalEntry;
  recentCount: number;
  netFlowHKD: number;
  totalPrincipalHKD: number;
}

export interface TransactionContribution {
  entry: AssetTransactionEntry;
  comparison: TransactionPriceComparison;
}

export interface StoredAnalysisOverview {
  id: string;
  kind: 'monthly' | 'quarterly';
  title: string;
  generatedAt: string;
  status: 'ready' | 'fallback';
  highlights: string[];
}

export function getMonthlyAnalysisPeriodKey(session: AnalysisSession) {
  const idMatch = session.id.match(/^monthly-(\d{4})-(\d{1,2})(?:$|-)/i);
  const titleMatch = session.title.match(/(\d{4})\s*年\s*(\d{1,2})\s*月/);
  const factsMatch = session.reportFactsPayload?.periodEndDate.match(/^(\d{4})-(\d{1,2})/);
  const match = idMatch ?? titleMatch ?? factsMatch;

  if (!match) return '';

  const month = Number(match[2]);
  if (month < 1 || month > 12) return '';

  return `${match[1]}-${String(month).padStart(2, '0')}`;
}

export function sortMonthlyAnalysisSessions(sessions: AnalysisSession[]) {
  return [...sessions].sort((left, right) => {
    const periodComparison = getMonthlyAnalysisPeriodKey(right)
      .localeCompare(getMonthlyAnalysisPeriodKey(left));

    if (periodComparison !== 0) return periodComparison;

    return (right.updatedAt || right.createdAt || '')
      .localeCompare(left.updatedAt || left.createdAt || '');
  });
}

function getMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function toComparableTime(value?: string) {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function sumSignedCashFlowsHKD(
  entries: AccountCashFlowEntry[],
  predicate: (entry: AccountCashFlowEntry) => boolean = () => true,
) {
  return entries.reduce((sum, entry) => {
    if (!predicate(entry)) return sum;
    return sum + convertCurrency(getCashFlowSignedAmount(entry), entry.currency, 'HKD');
  }, 0);
}

export function buildAccountPrincipalOverview(
  principals: AccountPrincipalEntry[],
  cashFlows: AccountCashFlowEntry[],
  currentDateKey: string,
) {
  const accountSummaries = dashboardAccountSources.map((accountSource) => {
    const baseline = principals.find((entry) => entry.accountSource === accountSource) ?? {
      accountSource,
      principalAmount: 0,
      currency: 'HKD',
    };
    const relatedFlows = cashFlows.filter((entry) => entry.accountSource === accountSource);
    const netFlowHKD = sumSignedCashFlowsHKD(relatedFlows);
    const baselineHKD = convertCurrency(baseline.principalAmount, baseline.currency, 'HKD');

    return {
      accountSource,
      baseline,
      recentCount: relatedFlows.length,
      netFlowHKD,
      totalPrincipalHKD: baselineHKD + netFlowHKD,
    } satisfies AccountPrincipalSummary;
  });

  const monthKey = getMonthKey(currentDateKey);

  return {
    accountSummaries,
    baselinePrincipalHKD: principals.reduce(
      (sum, entry) => sum + convertCurrency(entry.principalAmount, entry.currency, 'HKD'),
      0,
    ),
    netExternalFlowHKD: sumSignedCashFlowsHKD(cashFlows),
    monthNetFlowHKD: sumSignedCashFlowsHKD(cashFlows, (entry) => entry.date.startsWith(monthKey)),
    totalPrincipalHKD: accountSummaries.reduce(
      (sum, summary) => sum + summary.totalPrincipalHKD,
      0,
    ),
    recentCashFlows: [...cashFlows]
      .sort((left, right) => right.date.localeCompare(left.date) || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .slice(0, 3),
  };
}

export function buildPerformanceOverview(params: {
  history: PortfolioPerformancePoint[];
  currentPoint: PortfolioPerformancePoint;
  cashFlows: AccountCashFlowEntry[];
  principals: AccountPrincipalEntry[];
  todaySnapshotExists: boolean;
}) {
  const { history, currentPoint, cashFlows, principals, todaySnapshotExists } = params;
  const funds = buildAccountPrincipalOverview(principals, cashFlows, currentPoint.date);
  const monthStartDate = `${getMonthKey(currentPoint.date)}-01`;
  const monthStartPoint = [...history]
    .filter((point) => point.date >= monthStartDate && point.date <= currentPoint.date)
    .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null;
  const monthly = monthStartPoint
    ? calculatePerformanceBetweenPoints(monthStartPoint, currentPoint, cashFlows)
    : null;
  const historicalReturnHKD = currentPoint.totalValue - funds.totalPrincipalHKD;
  const historicalReturnPct = funds.totalPrincipalHKD === 0
    ? 0
    : (historicalReturnHKD / Math.abs(funds.totalPrincipalHKD)) * 100;

  return {
    totalValueHKD: currentPoint.totalValue,
    totalPrincipalHKD: funds.totalPrincipalHKD,
    today: calculateAssetChangeSummary(
      history,
      currentPoint,
      cashFlows,
      '1d',
      todaySnapshotExists,
    ),
    monthly: monthly
      ? {
          startDate: monthStartPoint?.date ?? monthStartDate,
          ...monthly,
        }
      : null,
    historicalReturnHKD,
    historicalReturnPct,
  };
}

function parseDateKey(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

export function buildTrendSeries(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint,
  range: AssetChangeRange,
) {
  const dayCount = range === '1d' ? 1 : range === '7d' ? 7 : 30;
  const byDate = [...history, currentPoint]
    .sort((left, right) => left.date.localeCompare(right.date))
    .reduce<Map<string, PortfolioPerformancePoint>>((map, point) => {
      map.set(point.date, point);
      return map;
    }, new Map());
  const cutoff = new Date(
    parseDateKey(currentPoint.date).getTime() - (dayCount - 1) * 24 * 60 * 60 * 1000,
  );

  return [...byDate.values()].filter((point) => parseDateKey(point.date) >= cutoff);
}

export function buildCalendarEntries(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint | null,
  cashFlows: AccountCashFlowEntry[],
) {
  const byDate = [...history, ...(currentPoint ? [currentPoint] : [])]
    .sort((left, right) => left.date.localeCompare(right.date))
    .reduce<Map<string, PortfolioPerformancePoint>>((map, point) => {
      map.set(point.date, point);
      return map;
    }, new Map());
  const points = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));

  return points.map((point, index) => {
    const previous = points[index - 1];
    const performance = previous
      ? calculatePerformanceBetweenPoints(previous, point, cashFlows)
      : null;

    return {
      date: point.date,
      changeHKD: performance?.marketChange ?? 0,
      totalValueHKD: point.totalValue,
    };
  });
}

export function buildAssetOverview(holdings: Holding[]) {
  const totalValueHKD = getPortfolioTotalValue(holdings, 'HKD');
  const aggregated = aggregateHoldingsForAllocation(holdings)
    .sort(
      (left, right) =>
        getHoldingValueInCurrency(right, 'HKD') - getHoldingValueInCurrency(left, 'HKD'),
    );
  const topHoldingValueHKD = aggregated[0]
    ? getHoldingValueInCurrency(aggregated[0], 'HKD')
    : 0;
  const cashValueHKD = getPortfolioTotalValue(
    holdings.filter((holding) => holding.assetType === 'cash'),
    'HKD',
  );

  return {
    topHoldings: aggregated.slice(0, 5),
    concentrationPct: totalValueHKD === 0 ? 0 : (topHoldingValueHKD / totalValueHKD) * 100,
    unrealizedPnlHKD: holdings.reduce(
      (sum, holding) => sum + convertCurrency(holding.unrealizedPnl, holding.currency, 'HKD'),
      0,
    ),
    cashRatioPct: totalValueHKD === 0 ? 0 : (cashValueHKD / totalValueHKD) * 100,
  };
}

export function getVisibleTransactions(entries: AssetTransactionEntry[]) {
  return entries.filter(
    (entry) => !(entry.recordType === 'seed' && entry.note === '歷史持倉基線'),
  );
}

function normalizeAssetMatchValue(value?: string) {
  return (value ?? '').trim().toUpperCase();
}

function getHoldingMatchKeys(holding: Holding) {
  const baseKey = `${holding.accountSource}|${holding.assetType}`;
  const symbol = normalizeAssetMatchValue(holding.symbol);
  const name = normalizeAssetMatchValue(holding.name);
  return [
    symbol ? `${baseKey}|symbol|${symbol}` : null,
    name ? `${baseKey}|name|${name}` : null,
  ].filter((key): key is string => Boolean(key));
}

function getEntryMatchKeys(entry: AssetTransactionEntry) {
  const baseKey = `${entry.accountSource}|${entry.assetType}`;
  const symbol = normalizeAssetMatchValue(entry.symbol);
  const name = normalizeAssetMatchValue(entry.assetName);
  return [
    symbol ? `${baseKey}|symbol|${symbol}` : null,
    name ? `${baseKey}|name|${name}` : null,
  ].filter((key): key is string => Boolean(key));
}

export function buildTransactionComparisonMaps(
  entries: AssetTransactionEntry[],
  holdings: Holding[],
  displayCurrency: DisplayCurrency,
) {
  const holdingsById = new Map(holdings.map((holding) => [holding.id, holding]));
  const holdingsByMatchKey = new Map<string, Holding[]>();

  holdings.forEach((holding) => {
    getHoldingMatchKeys(holding).forEach((key) => {
      holdingsByMatchKey.set(key, [...(holdingsByMatchKey.get(key) ?? []), holding]);
    });
  });

  const holdingsByTransactionId = new Map(
    entries.map((entry) => {
      const holding = holdingsById.get(entry.assetId) ?? getEntryMatchKeys(entry)
        .flatMap((key) => holdingsByMatchKey.get(key) ?? [])
        .find((candidate) => candidate.accountSource === entry.accountSource);
      return [entry.id, holding] as const;
    }),
  );
  const comparisonsByTransactionId = new Map(
    entries.map((entry) => [
      entry.id,
      getTransactionPriceComparison(entry, holdingsByTransactionId.get(entry.id), displayCurrency),
    ] as const),
  );

  return { holdingsByTransactionId, comparisonsByTransactionId };
}

export function buildTransactionOverview(
  entries: AssetTransactionEntry[],
  comparisonsByTransactionId: Map<string, TransactionPriceComparison | null>,
  currentDateKey: string,
) {
  const visibleEntries = getVisibleTransactions(entries);
  const contributions = visibleEntries
    .map((entry) => {
      const comparison = comparisonsByTransactionId.get(entry.id);
      return comparison ? { entry, comparison } : null;
    })
    .filter((entry): entry is TransactionContribution => entry !== null);
  const positive = contributions.filter(({ comparison }) => comparison.comparisonDisplay > 0);
  const negative = contributions.filter(({ comparison }) => comparison.comparisonDisplay < 0);

  return {
    recentTransactions: [...visibleEntries]
      .sort((left, right) => right.date.localeCompare(left.date) || (right.updatedAt ?? '').localeCompare(left.updatedAt ?? ''))
      .slice(0, 3),
    monthTransactionCount: visibleEntries.filter((entry) => entry.date.startsWith(getMonthKey(currentDateKey))).length,
    realizedPnlHKD: visibleEntries.reduce((sum, entry) => sum + entry.realizedPnlHKD, 0),
    maxPositiveContribution: positive.length > 0
      ? positive.reduce((best, item) =>
          item.comparison.comparisonDisplay > best.comparison.comparisonDisplay ? item : best,
        )
      : null,
    maxNegativeContribution: negative.length > 0
      ? negative.reduce((worst, item) =>
          item.comparison.comparisonDisplay < worst.comparison.comparisonDisplay ? item : worst,
        )
      : null,
  };
}

function extractReportHighlights(content: string) {
  const cleaned = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/【[^】]+】/g, '\n')
    .replace(/^#{1,6}\s+/gm, '')
    .split(/\n+/)
    .map((line) => line.replace(/^[-*•\d.、)\s]+/, '').replace(/\*\*/g, '').trim())
    .filter((line) => line.length >= 8 && line.length <= 180);

  return [...new Set(cleaned)].slice(0, 3);
}

export function selectLatestStoredAnalysis(
  sessions: AnalysisSession[],
  reports: QuarterlyReport[],
): StoredAnalysisOverview | null {
  const monthly = sessions
    .filter((session) => session.category === 'asset_analysis' && session.result.trim())
    .map((session) => ({
      id: session.id,
      kind: 'monthly' as const,
      title: session.title || '每月資產分析',
      generatedAt: session.updatedAt || session.createdAt || '',
      status: 'ready' as const,
      content: session.result,
    }));
  const quarterly = reports
    .filter((report) => report.report.trim())
    .map((report) => ({
      id: report.id,
      kind: 'quarterly' as const,
      title: `${report.quarter} 季度投資報告`,
      generatedAt: report.generatedAt || report.updatedAt || report.createdAt || '',
      status: report.isTimeoutFallback ? 'fallback' as const : 'ready' as const,
      content: report.report,
    }));
  const latest = [...monthly, ...quarterly]
    .sort((left, right) => toComparableTime(right.generatedAt) - toComparableTime(left.generatedAt))[0];

  if (!latest) return null;

  return {
    id: latest.id,
    kind: latest.kind,
    title: latest.title,
    generatedAt: latest.generatedAt,
    status: latest.status,
    highlights: extractReportHighlights(latest.content),
  };
}
