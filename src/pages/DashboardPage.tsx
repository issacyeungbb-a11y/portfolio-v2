import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AllocationCard } from '../components/portfolio/AllocationCard';
import { HoldingCard } from '../components/portfolio/HoldingCard';
import { InsightCard } from '../components/portfolio/InsightCard';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  buildAllocationSlices,
  convertCurrency,
  getHoldingValueInCurrency,
  getPortfolioTotalCost,
  getPortfolioTotalValue,
  formatCurrency,
  formatCurrencyRounded,
} from '../data/mockPortfolio';
import { useAnalysisCache } from '../hooks/useAnalysisCache';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePortfolioSnapshots } from '../hooks/usePortfolioSnapshots';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  buildDashboardInsights,
} from '../lib/portfolio/dashboardInsights';
import {
  createPortfolioSnapshotHash,
  createPortfolioSnapshotSignature,
} from '../lib/portfolio/analysisSnapshot';
import type {
  AccountCashFlowEntry,
  AllocationBucketKey,
  DisplayCurrency,
  Holding,
} from '../types/portfolio';

function getCashFlowSignedAmount(entry: Pick<AccountCashFlowEntry, 'type' | 'amount'>) {
  if (entry.type === 'withdrawal') {
    return -Math.abs(entry.amount);
  }

  return entry.amount;
}

export function DashboardPage() {
  const { holdings: firestoreHoldings, status, error, isEmpty } = usePortfolioAssets();
  const {
    entries: accountPrincipals,
    error: accountPrincipalsError,
  } = useAccountPrincipals();
  const { entries: accountCashFlows, error: accountCashFlowsError } = useAccountCashFlows();
  const { history: portfolioHistory, error: snapshotsError } = usePortfolioSnapshots();
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('HKD');
  const [selectedAllocationKey, setSelectedAllocationKey] = useState<AllocationBucketKey>('stock');
  const [snapshotHash, setSnapshotHash] = useState<string | null>(null);
  const syncedHoldings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );
  const allocations = buildAllocationSlices(syncedHoldings);
  const totalValue = getPortfolioTotalValue(syncedHoldings, displayCurrency);
  const totalCost = getPortfolioTotalCost(syncedHoldings, displayCurrency);
  const totalPrincipal =
    accountPrincipals.reduce(
      (sum, entry) =>
        sum + convertCurrency(entry.principalAmount, entry.currency, displayCurrency),
      0,
    ) +
    accountCashFlows.reduce(
      (sum, entry) =>
        sum +
        convertCurrency(
          getCashFlowSignedAmount(entry),
          entry.currency,
          displayCurrency,
        ),
      0,
    );
  const principalPnl = totalValue - totalPrincipal;
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
  const syncHint =
    status === 'loading'
      ? '正在同步 Firestore 資產資料'
      : `已同步 ${syncedHoldings.length} 項資產，資料與資產管理頁一致`;
  const principalPnlTone =
    principalPnl > 0 ? 'positive' : principalPnl < 0 ? 'caution' : 'default';

  return (
    <div className="page-stack">
      <section className="hero-panel dashboard-hero-panel">
        <span className="chip chip-soft">{syncHint}</span>
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
      {accountPrincipalsError ? (
        <p className="status-message status-message-error">{accountPrincipalsError}</p>
      ) : null}
      {accountCashFlowsError ? (
        <p className="status-message status-message-error">{accountCashFlowsError}</p>
      ) : null}
      {isEmpty ? (
        <p className="status-message">未有資產。</p>
      ) : null}

      <section className="summary-cluster">
        <div className="summary-grid summary-grid-primary">
          <SummaryCard
            label={`總資產 ${displayCurrency}`}
            value={formatCurrencyRounded(totalValue, displayCurrency)}
            hint={syncHint}
          />
          <SummaryCard
            label="本金損益"
            value={formatCurrencyRounded(principalPnl, displayCurrency)}
            hint={`總本金 ${formatCurrency(totalPrincipal, displayCurrency)}`}
            tone={principalPnlTone}
          />
        </div>
        <div className="summary-grid summary-grid-secondary">
          <SummaryCard
            label={`總本金 ${displayCurrency}`}
            value={formatCurrencyRounded(totalPrincipal, displayCurrency)}
            hint={`持倉成本 ${formatCurrency(totalCost, displayCurrency)}`}
            tone={principalPnlTone}
          />
        </div>
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
            <p className="status-message">同步中。</p>
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
            <p className="status-message">未有分布資料。</p>
          </article>
        )}

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Asset Trends</p>
              <h2>資產走勢</h2>
            </div>
            <Link className="text-link" to="/trends">
              看詳情
            </Link>
          </div>

          <div className="stack-list">
            <p className="status-message">
              今日、7日同30日走勢，已移到資產走勢頁集中顯示。
            </p>
          </div>
        </article>

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
              <p className="status-message">同步中。</p>
            ) : topHoldings.length > 0 ? (
              topHoldings.map((holding) => (
                <HoldingCard
                  key={holding.id}
                  holding={holding}
                  displayCurrency={displayCurrency}
                />
              ))
            ) : (
              <p className="status-message">未有持倉資料。</p>
            )}
          </div>
        </article>
      </section>

      <section>
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
              <p className="status-message">未有可顯示內容。</p>
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
        </article>
      </section>
    </div>
  );
}
