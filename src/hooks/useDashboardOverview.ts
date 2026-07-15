import { useMemo } from 'react';

import { getHoldingValueInCurrency } from '../lib/holdings';
import { getHongKongDateKey } from '../lib/dates';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import { calculateAssetChangeSummary, createCurrentPortfolioPoint } from '../lib/portfolio/assetChange';
import { buildDashboardInsights } from '../lib/portfolio/dashboardInsights';
import {
  buildAccountPrincipalOverview,
  buildAssetOverview,
  buildPerformanceOverview,
  buildTransactionComparisonMaps,
  buildTransactionOverview,
  selectLatestStoredAnalysis,
} from '../lib/portfolio/overviewSelectors';
import { hasValidHoldingPrice } from '../lib/portfolio/priceValidity';
import type { DisplayCurrency, Holding } from '../types/portfolio';
import { useAccountCashFlows } from './useAccountCashFlows';
import { useAccountPrincipals } from './useAccountPrincipals';
import { useAnalysisSessions } from './useAnalysisSessions';
import { useAssetTransactions } from './useAssetTransactions';
import { useAllPortfolioAssets, usePortfolioAssets } from './usePortfolioAssets';
import { usePortfolioSnapshots, useTodaySnapshotStatus } from './usePortfolioSnapshots';
import { usePriceUpdateReviews } from './usePriceUpdateReviews';
import { useQuarterlyReports } from './useQuarterlyReports';

function getLatestTimestamp(values: Array<string | undefined>) {
  return values
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function useDashboardOverview(displayCurrency: DisplayCurrency) {
  const assets = usePortfolioAssets();
  const allAssets = useAllPortfolioAssets();
  const principals = useAccountPrincipals();
  const cashFlows = useAccountCashFlows();
  const snapshots = usePortfolioSnapshots({ limitCount: 365 });
  const todaySnapshotState = useTodaySnapshotStatus();
  const transactions = useAssetTransactions({ limitCount: 300 });
  const priceReviews = usePriceUpdateReviews();
  const analysisSessions = useAnalysisSessions();
  const quarterlyReports = useQuarterlyReports();

  const overview = useMemo(() => {
    const holdings: Holding[] = recalculateHoldingAllocations(
      assets.holdings,
      (holding) => getHoldingValueInCurrency(holding, 'HKD'),
    );
    const currentPoint = createCurrentPortfolioPoint(holdings);
    const currentDateKey = currentPoint.date || getHongKongDateKey();
    const transactionComparisonMaps = buildTransactionComparisonMaps(
      transactions.entries,
      allAssets.holdings,
      displayCurrency,
    );
    const pendingPriceCount = holdings.filter(
      (holding) => holding.assetType !== 'cash' && !hasValidHoldingPrice(holding),
    ).length;
    const pendingReviewCount = priceReviews.reviews.length;
    const todaySnapshotExists = todaySnapshotState.todaySnapshot.exists;
    const fundsOverview = buildAccountPrincipalOverview(
      principals.entries,
      cashFlows.entries,
      currentDateKey,
    );
    const latestAnalysis = selectLatestStoredAnalysis(
      analysisSessions.entries,
      quarterlyReports.entries,
    );
    const latestUpdatedAt = getLatestTimestamp([
      ...holdings.flatMap((holding) => [holding.lastPriceUpdatedAt, holding.priceAsOf]),
      ...snapshots.history.map((point) => point.capturedAt),
      ...principals.entries.map((entry) => entry.updatedAt),
      ...cashFlows.entries.flatMap((entry) => [entry.updatedAt, entry.createdAt]),
      ...transactions.entries.flatMap((entry) => [entry.updatedAt, entry.createdAt]),
      latestAnalysis?.generatedAt,
    ]);
    const pendingTaskCount = pendingPriceCount + pendingReviewCount + (todaySnapshotExists ? 0 : 1);
    const sourceStatuses = [
      assets.status,
      allAssets.status,
      principals.status,
      cashFlows.status,
      snapshots.status,
      todaySnapshotState.status,
      transactions.status,
      priceReviews.status,
      analysisSessions.status,
      quarterlyReports.status,
    ];
    const errors = [
      assets.error,
      allAssets.error,
      principals.error,
      cashFlows.error,
      snapshots.error,
      todaySnapshotState.error,
      transactions.error,
      priceReviews.error,
      analysisSessions.error,
      quarterlyReports.error,
    ];
    const hasError = errors.some(Boolean);
    const isLoading = sourceStatuses.some((status) => status === 'loading');

    return {
      holdings,
      currentPoint,
      history: snapshots.history,
      cashFlows: cashFlows.entries,
      assets: buildAssetOverview(holdings),
      funds: fundsOverview,
      performance: buildPerformanceOverview({
        history: snapshots.history,
        currentPoint,
        cashFlows: cashFlows.entries,
        principals: principals.entries,
        todaySnapshotExists,
      }),
      transactions: buildTransactionOverview(
        transactions.entries,
        transactionComparisonMaps.comparisonsByTransactionId,
        currentDateKey,
      ),
      insights: buildDashboardInsights(holdings),
      latestAnalysis,
      pendingPriceCount,
      pendingReviewCount,
      todaySnapshotExists,
      todaySnapshotQuality: todaySnapshotState.todaySnapshot.exists
        ? todaySnapshotState.todaySnapshot.quality
        : undefined,
      pendingTaskCount,
      latestUpdatedAt,
      dataStatus: isLoading
        ? { label: '同步中', tone: 'neutral' as const }
        : hasError
          ? { label: '部分資料未同步', tone: 'danger' as const }
          : pendingTaskCount > 0
            ? { label: `待處理 ${pendingTaskCount} 項`, tone: 'warning' as const }
            : { label: '資料已更新', tone: 'success' as const },
      errors,
      status: isLoading ? 'loading' as const : hasError ? 'error' as const : 'ready' as const,
      isEmpty: assets.isEmpty,
      rangeSummaries: {
        '7d': calculateAssetChangeSummary(
          snapshots.history,
          currentPoint,
          cashFlows.entries,
          '7d',
          todaySnapshotExists,
        ),
        '30d': calculateAssetChangeSummary(
          snapshots.history,
          currentPoint,
          cashFlows.entries,
          '30d',
          todaySnapshotExists,
        ),
      },
    };
  }, [
    allAssets.error,
    allAssets.holdings,
    allAssets.status,
    analysisSessions.entries,
    analysisSessions.error,
    analysisSessions.status,
    assets.error,
    assets.holdings,
    assets.isEmpty,
    assets.status,
    cashFlows.entries,
    cashFlows.error,
    cashFlows.status,
    displayCurrency,
    priceReviews.error,
    priceReviews.reviews.length,
    priceReviews.status,
    principals.entries,
    principals.error,
    principals.status,
    quarterlyReports.entries,
    quarterlyReports.error,
    quarterlyReports.status,
    snapshots.error,
    snapshots.history,
    snapshots.status,
    todaySnapshotState.error,
    todaySnapshotState.status,
    todaySnapshotState.todaySnapshot.exists,
    todaySnapshotState.todaySnapshot,
    transactions.entries,
    transactions.error,
    transactions.status,
  ]);

  return overview;
}
