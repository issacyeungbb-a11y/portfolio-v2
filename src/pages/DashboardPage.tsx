import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';

import { AllocationCard } from '../components/portfolio/AllocationCard';
import { HoldingCard } from '../components/portfolio/HoldingCard';
import { InsightCard } from '../components/portfolio/InsightCard';
import { CurrencyToggle } from '../components/ui/CurrencyToggle';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { StatusMessages } from '../components/ui/StatusMessages';
import { ActionPanel } from '../components/ui/DesignSystem';
import {
  buildAllocationSlices,
  convertCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
  formatCurrencyRounded,
  formatPercent,
} from '../data/mockPortfolio';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePortfolioSnapshots, useTodaySnapshotStatus } from '../hooks/usePortfolioSnapshots';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  buildDashboardInsights,
} from '../lib/portfolio/dashboardInsights';
import {
  calculateAssetChangeSummary,
  createCurrentPortfolioPoint,
} from '../lib/portfolio/assetChange';
import { hasValidHoldingPrice } from '../lib/portfolio/priceValidity';
import type {
  AllocationBucketKey,
  DisplayCurrency,
  Holding,
} from '../types/portfolio';

export function DashboardPage() {
  const { holdings: firestoreHoldings, status, error, isEmpty } = usePortfolioAssets();
  const { entries: accountCashFlows, error: accountCashFlowsError } = useAccountCashFlows();
  const { history: portfolioHistory, error: snapshotsError } = usePortfolioSnapshots();
  const { todaySnapshot, status: todaySnapshotStatus, error: todaySnapshotError } = useTodaySnapshotStatus();
  const { reviews } = usePriceUpdateReviews();
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  const [selectedAllocationKey, setSelectedAllocationKey] = useState<AllocationBucketKey>('stock');
  const syncedHoldings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );
  const pendingPriceCount = syncedHoldings.filter(
    (holding) => holding.assetType !== 'cash' && !hasValidHoldingPrice(holding),
  ).length;
  const pendingReviewCount = reviews.length;
  const allocations = buildAllocationSlices(syncedHoldings);
  const totalValue = getPortfolioTotalValue(syncedHoldings, displayCurrency);
  const topHoldings = [...syncedHoldings]
    .sort(
      (left, right) =>
        getHoldingValueInCurrency(right, displayCurrency) -
        getHoldingValueInCurrency(left, displayCurrency),
    )
    .slice(0, 3);
  const dashboardInsights = buildDashboardInsights(syncedHoldings);
  const currentPoint = createCurrentPortfolioPoint(syncedHoldings);
  const todaySnapshotExists = todaySnapshot.exists;
  const todaySummary = calculateAssetChangeSummary(
    portfolioHistory,
    currentPoint,
    accountCashFlows,
    '1d',
    todaySnapshotExists,
  );
  const todayChangeAmount = todaySummary
    ? convertCurrency(todaySummary.totalChange, 'HKD', displayCurrency)
    : 0;
  const todaySnapshotLabel = !todaySnapshot.exists
    ? todaySnapshotError
      ? '今日快照 風險'
      : '今日快照 待補'
    : todaySnapshot.quality === 'fallback'
      ? '今日快照 部分完成'
      : '今日快照 完整';
  const todaySnapshotTone = !todaySnapshot.exists
    ? todaySnapshotError
      ? 'danger'
      : 'warning'
    : todaySnapshot.quality === 'fallback'
      ? 'warning'
      : 'success';
  const latestPriceUpdate =
    [...syncedHoldings]
      .map((holding) => holding.lastPriceUpdatedAt || '')
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const latestPriceUpdateLabel = latestPriceUpdate
    ? new Intl.DateTimeFormat('zh-HK', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(new Date(latestPriceUpdate))
    : '未更新';
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '投資總覽',
      subtitle: '追蹤組合價值、今日收益與需要優先處理的事項。',
      metaItems: [
        { label: '基準貨幣', value: 'HKD', compact: true },
        { label: '顯示貨幣', value: displayCurrency, compact: true },
        { label: '總資產', value: formatCurrencyRounded(totalValue, displayCurrency) },
        { label: '最近更新', value: latestPriceUpdateLabel },
      ],
      statusItems: [
        {
          label: status === 'error' ? '連接失敗' : status === 'loading' ? '同步中' : '已連接',
          tone: status === 'error' ? 'danger' : status === 'loading' ? 'warning' : 'success',
        },
        {
          label: todaySnapshotLabel,
          tone: todaySnapshotTone,
        },
        {
          label: `待更新 ${pendingPriceCount}`,
          tone: pendingPriceCount > 0 ? 'warning' : 'success',
        },
        {
          label: `待覆核 ${pendingReviewCount}`,
          tone: pendingReviewCount > 0 ? 'warning' : 'success',
        },
      ],
      actions: <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />,
    }),
    [
      displayCurrency,
      latestPriceUpdateLabel,
      pendingPriceCount,
      pendingReviewCount,
      setDisplayCurrency,
      status,
      todaySnapshotLabel,
      todaySnapshotTone,
      todaySnapshotError,
      totalValue,
    ],
  );

  useTopBar(topBarConfig);

  useEffect(() => {
    if (allocations.length === 0) {
      return;
    }

    const hasSelectedSlice = allocations.some((slice) => slice.key === selectedAllocationKey);
    if (!hasSelectedSlice) {
      setSelectedAllocationKey(allocations[0].key);
    }
  }, [allocations, selectedAllocationKey]);

  const dashboardTasks = [
    pendingPriceCount > 0
      ? {
          title: '價格待更新',
          reason: `共有 ${pendingPriceCount} 項非現金資產需要重新整理價格。`,
          tone: 'warning' as const,
          action: (
            <Link className="button button-secondary" to="/assets">
              前往資產頁
            </Link>
          ),
        }
      : null,
    !todaySnapshot.exists
      ? {
          title: '今日快照未完成',
          reason:
            todaySnapshotStatus === 'loading'
              ? '今日快照狀態仍在讀取中。'
              : '今日快照尚未生成，建議前往資產頁後補。',
          tone: 'warning' as const,
          action: (
            <Link className="button button-secondary" to="/assets">
              查看快照
            </Link>
          ),
        }
      : null,
    pendingReviewCount > 0
      ? {
          title: '待人工覆核',
          reason: `共有 ${pendingReviewCount} 項價格結果仍然需要確認。`,
          tone: 'warning' as const,
          action: (
            <Link className="button button-secondary" to="/assets">
              查看覆核
            </Link>
          ),
        }
      : null,
  ].filter(Boolean) as Array<{
    title: string;
    reason: string;
    tone: 'warning';
    action: JSX.Element;
  }>;

  return (
    <div className="page-stack">
      <section className="hero-panel dashboard-hero-panel">
        <div className="dashboard-overview-hero">
          <span className="dashboard-overview-label">總資產估值</span>
          <strong>{formatCurrencyRounded(totalValue, displayCurrency)}</strong>
          <Link className="dashboard-trend-link" to="/trends">
            <span>今日收益</span>
            {todaySummary ? (
              <span className={todayChangeAmount >= 0 ? 'positive-text' : 'caution-text'}>
                {todayChangeAmount >= 0 ? '+' : ''}
                {formatCurrencyRounded(todayChangeAmount, displayCurrency)}{' '}
                ({formatPercent(todaySummary.returnPct)})
              </span>
            ) : (
              <span className="table-hint">收益待更新</span>
            )}
            <span aria-hidden="true">›</span>
          </Link>
        </div>
      </section>

      <StatusMessages
        errors={[error, snapshotsError, accountCashFlowsError, todaySnapshotError]}
      />
      {isEmpty ? (
        <EmptyState
          title="尚未加入資產"
          reason="請先前往資產頁新增第一筆持倉，之後才會顯示總覽與今日收益。"
          primaryAction={
            <Link className="button button-primary" to="/assets">
              前往資產頁
            </Link>
          }
        />
      ) : null}

      <ActionPanel
        className="dashboard-task-card"
        eyebrow="今日處理"
        title="今日要處理事項"
        description="先處理價格、快照與覆核，再查看組合表現會更穩妥。"
      >
        {dashboardTasks.length > 0 ? (
          <div className="dashboard-task-list">
            {dashboardTasks.map((task) => (
              <article key={task.title} className="dashboard-task-item">
                <div className="dashboard-task-copy">
                  <StatusBadge label="注意" tone={task.tone} />
                  <strong>{task.title}</strong>
                  <p>{task.reason}</p>
                </div>
                {task.action}
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title="目前沒有需要處理的資料異常"
            reason="價格更新、今日快照同人工覆核都已經回到正常狀態。"
            primaryAction={
              <Link className="button button-secondary" to="/assets">
                查看資產
              </Link>
            }
          />
        )}
      </ActionPanel>

      <section className="content-grid">
        {status === 'loading' ? (
          <article className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">分布</p>
                <h2>資產分布</h2>
              </div>
            </div>
            <div className="skeleton skeleton-card" />
          </article>
        ) : allocations.length > 0 ? (
          <AllocationCard
            title="資產分布"
            slices={allocations}
            selectedKey={selectedAllocationKey}
            displayCurrency={displayCurrency}
            onSelect={setSelectedAllocationKey}
          />
        ) : (
          <article className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">分布</p>
                <h2>資產分布</h2>
              </div>
            </div>
            <p className="status-message">尚未有分布資料</p>
          </article>
        )}

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">持倉</p>
              <h2>重點持倉</h2>
            </div>
            <Link className="text-link" to="/assets">
              看全部
            </Link>
          </div>

          <div className="stack-list">
            {status === 'loading' ? (
              <>
                <div className="skeleton skeleton-row" />
                <div className="skeleton skeleton-row" />
                <div className="skeleton skeleton-row" />
              </>
            ) : topHoldings.length > 0 ? (
              topHoldings.map((holding) => (
                <HoldingCard
                  key={holding.id}
                  holding={holding}
                  displayCurrency={displayCurrency}
                />
              ))
            ) : (
              <p className="status-message">尚未有持倉資料</p>
            )}
          </div>
        </article>
      </section>

      <section>
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">觀察</p>
              <h2>組合觀察</h2>
            </div>
            <Link className="text-link" to="/analysis">
              進入分析頁
            </Link>
          </div>

          <div className="stack-list">
            {dashboardInsights.length > 0 ? (
              dashboardInsights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))
            ) : (
              <p className="status-message">尚未有觀察內容</p>
            )}
          </div>
        </article>
      </section>
    </div>
  );
}
