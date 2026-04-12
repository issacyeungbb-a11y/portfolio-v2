import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AllocationCard } from '../components/portfolio/AllocationCard';
import { HoldingCard } from '../components/portfolio/HoldingCard';
import { InsightCard } from '../components/portfolio/InsightCard';
import { StatusMessages } from '../components/ui/StatusMessages';
import {
  buildAllocationSlices,
  convertCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalValue,
  formatCurrencyRounded,
  formatPercent,
} from '../data/mockPortfolio';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePortfolioSnapshots, useTodaySnapshotStatus } from '../hooks/usePortfolioSnapshots';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  buildDashboardInsights,
} from '../lib/portfolio/dashboardInsights';
import {
  calculateAssetChangeSummary,
  createCurrentPortfolioPoint,
} from '../lib/portfolio/assetChange';
import type {
  AllocationBucketKey,
  DisplayCurrency,
  Holding,
} from '../types/portfolio';

export function DashboardPage() {
  const { holdings: firestoreHoldings, status, error, isEmpty } = usePortfolioAssets();
  const { entries: accountCashFlows, error: accountCashFlowsError } = useAccountCashFlows();
  const { history: portfolioHistory, error: snapshotsError } = usePortfolioSnapshots();
  const { todaySnapshot, error: todaySnapshotError } = useTodaySnapshotStatus();
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('HKD');
  const [selectedAllocationKey, setSelectedAllocationKey] = useState<AllocationBucketKey>('stock');
  const syncedHoldings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );
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

  useEffect(() => {
    if (allocations.length === 0) {
      return;
    }

    const hasSelectedSlice = allocations.some((slice) => slice.key === selectedAllocationKey);
    if (!hasSelectedSlice) {
      setSelectedAllocationKey(allocations[0].key);
    }
  }, [allocations, selectedAllocationKey]);

  return (
    <div className="page-stack">
      <section className="hero-panel dashboard-hero-panel">
        <div className="dashboard-hero-actions">
          <div className="currency-toggle" role="group" aria-label="選擇顯示貨幣">
            <button
              className={displayCurrency === 'HKD' ? 'currency-toggle-button active' : 'currency-toggle-button'}
              type="button"
              onClick={() => setDisplayCurrency('HKD')}
            >
              HKD
            </button>
            <button
              className={displayCurrency === 'USD' ? 'currency-toggle-button active' : 'currency-toggle-button'}
              type="button"
              onClick={() => setDisplayCurrency('USD')}
            >
              USD
            </button>
          </div>
        </div>

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
        <p className="status-message">
          尚未加入資產。前往<Link className="text-link" to="/assets">資產頁面</Link>新增你嘅第一筆持倉。
        </p>
      ) : null}

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
