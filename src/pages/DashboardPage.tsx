import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AllocationCard } from '../components/portfolio/AllocationCard';
import { HoldingCard } from '../components/portfolio/HoldingCard';
import { InsightCard } from '../components/portfolio/InsightCard';
import { PerformanceCard } from '../components/portfolio/PerformanceCard';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  buildAllocationSlices,
  calculatePortfolioPerformance,
  getHoldingValueInCurrency,
  getPortfolioTotalCost,
  getPortfolioTotalValue,
  formatCurrency,
} from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePortfolioSnapshots } from '../hooks/usePortfolioSnapshots';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  buildDashboardInsights,
  buildDashboardStatusItems,
} from '../lib/portfolio/dashboardInsights';
import {
  createPortfolioSnapshotHash,
  createPortfolioSnapshotSignature,
} from '../lib/portfolio/analysisSnapshot';
import type {
  AllocationBucketKey,
  DisplayCurrency,
  Holding,
  PerformanceRange,
} from '../types/portfolio';

export function DashboardPage() {
  const { holdings: firestoreHoldings, status, error, isEmpty } = usePortfolioAssets();
  const { history: portfolioHistory, error: snapshotsError } = usePortfolioSnapshots();
  const { reviews } = usePriceUpdateReviews();
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('HKD');
  const [selectedRange, setSelectedRange] = useState<PerformanceRange>('30d');
  const [selectedAllocationKey, setSelectedAllocationKey] = useState<AllocationBucketKey>('stock');
  const [snapshotHash, setSnapshotHash] = useState<string | null>(null);
  const syncedHoldings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );
  const allocations = buildAllocationSlices(syncedHoldings);
  const totalValue = getPortfolioTotalValue(syncedHoldings, displayCurrency);
  const totalCost = getPortfolioTotalCost(syncedHoldings, displayCurrency);
  const totalPnl = totalValue - totalCost;
  const snapshotSignature =
    syncedHoldings.length > 0 ? createPortfolioSnapshotSignature(syncedHoldings) : '';
  const topHoldings = [...syncedHoldings]
    .sort(
      (left, right) =>
        getHoldingValueInCurrency(right, displayCurrency) -
        getHoldingValueInCurrency(left, displayCurrency),
    )
    .slice(0, 3);
  const dashboardInsights = buildDashboardInsights(syncedHoldings);

  useEffect(() => {
    if (allocations.length === 0) {
      return;
    }

    const hasSelectedSlice = allocations.some((slice) => slice.key === selectedAllocationKey);
    if (!hasSelectedSlice) {
      setSelectedAllocationKey(allocations[0].key);
    }
  }, [allocations, selectedAllocationKey]);

  useEffect(() => {
    if (!snapshotSignature) {
      setSnapshotHash(null);
      return;
    }

    let isActive = true;

    createPortfolioSnapshotHash(snapshotSignature)
      .then((hash) => {
        if (isActive) {
          setSnapshotHash(hash);
        }
      })
      .catch(() => {
        if (isActive) {
          setSnapshotHash(null);
        }
      });

    return () => {
      isActive = false;
    };
  }, [snapshotSignature]);

  const { hasCachedAnalysis } = useAnalysisCache(snapshotHash);
  const dashboardStatusItems = buildDashboardStatusItems({
    holdings: syncedHoldings,
    assetsStatus: status,
    hasAnalysisCache: hasCachedAnalysis,
    pendingPriceReviewCount: reviews.length,
  });
  const performanceSummary =
    portfolioHistory.length > 1
      ? calculatePortfolioPerformance(portfolioHistory, selectedRange)
      : null;

  const syncHint =
    status === 'loading'
      ? '正在同步 Firestore 資產資料'
      : `已同步 ${syncedHoldings.length} 項資產，資料與資產管理頁一致`;
  const totalPnlTone =
    totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'caution' : 'default';

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <p className="eyebrow">Shared Portfolio</p>
          <h2>資產總覽</h2>
        </div>
        <div className="button-row">
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
          <Link className="button button-primary" to="/assets">
            檢視全部資產
          </Link>
          <Link className="button button-secondary" to="/import">
            截圖匯入
          </Link>
        </div>
      </section>

      {error ? <p className="status-message status-message-error">{error}</p> : null}
      {snapshotsError ? (
        <p className="status-message status-message-error">{snapshotsError}</p>
      ) : null}
      {isEmpty ? (
        <p className="status-message">
          你而家仲未有已儲存資產，所以總覽會先顯示空狀態。可以去資產管理頁新增第一筆資產。
        </p>
      ) : null}

      <section className="summary-grid">
        <SummaryCard
          label={`總資產 ${displayCurrency}`}
          value={formatCurrency(totalValue, displayCurrency)}
          hint={syncHint}
        />
        <SummaryCard
          label="累積損益"
          value={formatCurrency(totalPnl, displayCurrency)}
          hint={`投入成本 ${formatCurrency(totalCost, displayCurrency)}`}
          tone={totalPnlTone}
        />
        <PerformanceCard
          displayCurrency={displayCurrency}
          selectedRange={selectedRange}
          summary={performanceSummary}
          onSelectRange={setSelectedRange}
        />
      </section>

      <section className="content-grid">
        {status === 'loading' ? (
          <article className="card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Allocation</p>
                <h2>資產分布</h2>
              </div>
            </div>
            <p className="status-message">正在同步 Firestore 資產資料，之後會顯示最新分布。</p>
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
                <p className="eyebrow">Allocation</p>
                <h2>資產分布</h2>
              </div>
            </div>
            <p className="status-message">
              未有可顯示的資產分布。當你喺資產管理頁加入資產後，呢度會按相同類別即時分組顯示。
            </p>
          </article>
        )}

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Holdings</p>
              <h2>重點持倉</h2>
            </div>
            <Link className="text-link" to="/assets">
              看全部
            </Link>
          </div>

          <div className="stack-list">
            {status === 'loading' ? (
              <p className="status-message">正在同步持倉資料，完成後會顯示最新重點持倉。</p>
            ) : topHoldings.length > 0 ? (
              topHoldings.map((holding) => (
                <HoldingCard
                  key={holding.id}
                  holding={holding}
                  displayCurrency={displayCurrency}
                />
              ))
            ) : (
              <p className="status-message">
                未有持倉資料。新增資產後，呢度會顯示市值最高的幾項資產。
              </p>
            )}
          </div>
        </article>
      </section>

      <section className="content-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Portfolio Signals</p>
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
              <p className="status-message">
                當你加入第一批共享資產後，呢度會根據實際持倉集中度、幣別分布同現金比例生成觀察。
              </p>
            )}
          </div>
        </article>

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">System Status</p>
              <h2>目前系統狀態</h2>
            </div>
          </div>

          <div className="roadmap-list">
            {dashboardStatusItems.map((item, index) => (
              <div key={item.id} className="roadmap-item">
                <strong>
                  {index + 1}. {item.title}
                </strong>
                <p>{item.summary}</p>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
