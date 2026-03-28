import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { AllocationCard } from '../components/portfolio/AllocationCard';
import { HoldingCard } from '../components/portfolio/HoldingCard';
import { InsightCard } from '../components/portfolio/InsightCard';
import { PerformanceCard } from '../components/portfolio/PerformanceCard';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  buildAllocationSlices,
  getHoldingValueInCurrency,
  getPortfolioTotalCost,
  getPortfolioTotalValue,
  formatCurrency,
  mockPortfolio,
} from '../data/mockPortfolio';
import { useAnonymousAuth } from '../hooks/useAnonymousAuth';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import type {
  AllocationBucketKey,
  DisplayCurrency,
  Holding,
  PerformanceRange,
} from '../types/portfolio';

export function DashboardPage() {
  const { uid } = useAnonymousAuth();
  const { holdings: firestoreHoldings, status, error, isEmpty } = usePortfolioAssets(uid);
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('HKD');
  const [selectedRange, setSelectedRange] = useState<PerformanceRange>('30d');
  const [selectedAllocationKey, setSelectedAllocationKey] = useState<AllocationBucketKey>('stock');
  const syncedHoldings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );
  const allocations = buildAllocationSlices(syncedHoldings);
  const totalValue = getPortfolioTotalValue(syncedHoldings, displayCurrency);
  const totalCost = getPortfolioTotalCost(syncedHoldings, displayCurrency);
  const totalPnl = totalValue - totalCost;
  const topHoldings = [...syncedHoldings]
    .sort(
      (left, right) =>
        getHoldingValueInCurrency(right, displayCurrency) -
        getHoldingValueInCurrency(left, displayCurrency),
    )
    .slice(0, 3);

  useEffect(() => {
    if (allocations.length === 0) {
      return;
    }

    const hasSelectedSlice = allocations.some((slice) => slice.key === selectedAllocationKey);
    if (!hasSelectedSlice) {
      setSelectedAllocationKey(allocations[0].key);
    }
  }, [allocations, selectedAllocationKey]);

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
          <p className="eyebrow">Anonymous Portfolio</p>
          <h2>資產總覽</h2>
          <p className="hero-copy">
            呢一頁而家會直接使用同一套 Firestore 資產資料，所以總資產、分佈同重點持倉都會同資產管理頁一致。
          </p>
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
            預覽截圖匯入
          </Link>
        </div>
      </section>

      {error ? <p className="status-message status-message-error">{error}</p> : null}
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
          summary={null}
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
              <p className="eyebrow">AI Preview</p>
              <h2>分析摘要</h2>
            </div>
            <Link className="text-link" to="/analysis">
              進入分析頁
            </Link>
          </div>

          <div className="stack-list">
            {mockPortfolio.insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        </article>

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Next Steps</p>
              <h2>接下來要接的真功能</h2>
            </div>
          </div>

          <div className="roadmap-list">
            <div className="roadmap-item">
              <strong>1. 價格歷史與組合快照</strong>
              <p>總覽已經改用 Firestore 真實持倉，下一步要補 price history，先可以正確計 7日/30日/半年/1年變動。</p>
            </div>
            <div className="roadmap-item">
              <strong>2. Storage 截圖流程</strong>
              <p>上傳圖片、等待處理、人工確認，再存成持倉資料。</p>
            </div>
            <div className="roadmap-item">
              <strong>3. Vercel Functions + Gemini</strong>
              <p>把截圖解析、價格建議與 AI 分析都放到 server 端。</p>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
