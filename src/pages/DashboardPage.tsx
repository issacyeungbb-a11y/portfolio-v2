import { useMemo } from 'react';
import { Link } from 'react-router-dom';

import { DashboardTrendCard } from '../components/dashboard/DashboardTrendCard';
import { InsightCard } from '../components/portfolio/InsightCard';
import { CurrencyToggle } from '../components/ui/CurrencyToggle';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { StatusMessages } from '../components/ui/StatusMessages';
import { useDashboardOverview } from '../hooks/useDashboardOverview';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { convertCurrency, formatCurrencyRounded, formatPercent } from '../lib/currency';
import { getCashFlowSignedAmount, getHoldingValueInCurrency } from '../lib/holdings';

function formatDate(value?: string | null) {
  if (!value) return '未有更新時間';

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function formatTradeDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium' })
      .format(new Date(`${value}T00:00:00+08:00`));
  } catch {
    return value;
  }
}

export function DashboardPage() {
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  const overview = useDashboardOverview(displayCurrency);
  const money = (valueHKD: number) => formatCurrencyRounded(
    convertCurrency(valueHKD, 'HKD', displayCurrency),
    displayCurrency,
  );
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '投資總覽',
      subtitle: '跨頁摘要、資料狀態與常用操作。',
      primaryStatus: overview.dataStatus,
    }),
    [overview.dataStatus],
  );

  useTopBar(topBarConfig);

  const priorityTasks = [
    overview.pendingPriceCount > 0
      ? {
          id: 'prices',
          label: `${overview.pendingPriceCount} 項價格待更新`,
          action: '更新價格',
          to: '/assets#price-actions',
        }
      : null,
    overview.pendingReviewCount > 0
      ? {
          id: 'reviews',
          label: `${overview.pendingReviewCount} 項價格待覆核`,
          action: '查看覆核',
          to: '/assets#price-reviews',
        }
      : null,
    !overview.todaySnapshotExists
      ? {
          id: 'snapshot',
          label: '今日快照尚未完成',
          action: '後補快照',
          to: '/assets#snapshot-actions',
        }
      : null,
  ].filter((task): task is NonNullable<typeof task> => task !== null).slice(0, 3);

  const todayMarketChange = overview.performance.today?.marketChange ?? null;
  const monthlyMarketChange = overview.performance.monthly?.marketChange ?? null;

  return (
    <div className="page-stack dashboard-page">
      <section className="card dashboard-command-bar">
        <div>
          <p className="eyebrow">操作中心</p>
          <p className="table-hint">所有金額以 {displayCurrency} 顯示；讀取現有 Firestore 資料，不會自動生成分析。</p>
        </div>
        <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
      </section>

      <section className="dashboard-kpi-grid" aria-label="投資總覽主要指標">
        <article className="summary-card dashboard-kpi dashboard-kpi-total">
          <span className="summary-label">總資產</span>
          <strong>{money(overview.performance.totalValueHKD)}</strong>
          <small>{overview.holdings.length} 項持倉</small>
        </article>
        <article className="summary-card dashboard-kpi">
          <span className="summary-label">今日收益</span>
          <strong className={(todayMarketChange ?? 0) >= 0 ? 'positive-text' : 'caution-text'}>
            {todayMarketChange == null ? '待快照' : money(todayMarketChange)}
          </strong>
          <small>{overview.performance.today ? formatPercent(overview.performance.today.returnPct) : '未計外部資金流'}</small>
        </article>
        <article className="summary-card dashboard-kpi">
          <span className="summary-label">本月收益</span>
          <strong className={(monthlyMarketChange ?? 0) >= 0 ? 'positive-text' : 'caution-text'}>
            {monthlyMarketChange == null ? '待快照' : money(monthlyMarketChange)}
          </strong>
          <small>{overview.performance.monthly ? formatPercent(overview.performance.monthly.returnPct) : '未有月初快照'}</small>
        </article>
        <article className="summary-card dashboard-kpi">
          <span className="summary-label">歷史收益</span>
          <strong className={overview.performance.historicalReturnHKD >= 0 ? 'positive-text' : 'caution-text'}>
            {money(overview.performance.historicalReturnHKD)}
          </strong>
          <small>{formatPercent(overview.performance.historicalReturnPct)}</small>
        </article>
        <article className="summary-card dashboard-kpi">
          <span className="summary-label">累計本金</span>
          <strong>{money(overview.performance.totalPrincipalHKD)}</strong>
          <small>基線加資金流水</small>
        </article>
        <article className="summary-card dashboard-kpi">
          <span className="summary-label">資料更新狀態</span>
          <StatusBadge label={overview.dataStatus.label} tone={overview.dataStatus.tone} />
          <small>{formatDate(overview.latestUpdatedAt)}</small>
        </article>
      </section>

      <StatusMessages errors={overview.errors} />
      {overview.isEmpty ? (
        <EmptyState
          title="尚未加入資產"
          reason="加入第一筆持倉後，總覽會自動整理資產、收益、資金與交易摘要。"
          primaryAction={<Link className="button button-primary" to="/assets">前往資產頁</Link>}
        />
      ) : null}

      <section className="dashboard-control-grid">
        <DashboardTrendCard
          history={overview.history}
          currentPoint={overview.currentPoint}
          displayCurrency={displayCurrency}
          summaries={overview.rangeSummaries}
        />

        <article className="card dashboard-priority-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">優先處理</p>
              <h2>待處理事項</h2>
            </div>
            <span className="chip chip-soft">最多 3 項</span>
          </div>
          {priorityTasks.length > 0 ? (
            <div className="dashboard-priority-list">
              {priorityTasks.map((task) => (
                <div key={task.id} className="dashboard-priority-row">
                  <span>{task.label}</span>
                  <Link className="text-link" to={task.to}>{task.action}</Link>
                </div>
              ))}
            </div>
          ) : (
            <p className="compact-success-note">資料正常，暫無優先事項。</p>
          )}
        </article>
      </section>

      <nav className="card dashboard-quick-actions" aria-label="快速入口">
        <Link className="button button-primary" to="/assets#price-actions">更新價格</Link>
        <Link className="button button-secondary" to="/transactions#new-transaction">新增交易</Link>
        <Link className="button button-secondary" to="/funds#cash-flow-form">新增資金流水</Link>
        <Link className="button button-secondary" to="/analysis#stored-reports">查看報告</Link>
      </nav>

      <section className="dashboard-domain-grid">
        <article className="card dashboard-domain-card">
          <div className="section-heading">
            <div><p className="eyebrow">資產</p><h2>持倉摘要</h2></div>
            <Link className="text-link" to="/assets">全部資產</Link>
          </div>
          <div className="dashboard-mini-metrics">
            <span>集中度 <strong>{formatPercent(overview.assets.concentrationPct)}</strong></span>
            <span>未實現盈虧 <strong className={overview.assets.unrealizedPnlHKD >= 0 ? 'positive-text' : 'caution-text'}>{money(overview.assets.unrealizedPnlHKD)}</strong></span>
            <span>現金比例 <strong>{formatPercent(overview.assets.cashRatioPct)}</strong></span>
          </div>
          <div className="dashboard-compact-list">
            {overview.assets.topHoldings.map((holding, index) => (
              <div key={holding.id} className="dashboard-compact-row">
                <span><b>{index + 1}</b>{holding.symbol}<small>{holding.accountSources.join('、')}</small></span>
                <strong>{formatCurrencyRounded(getHoldingValueInCurrency(holding, displayCurrency), displayCurrency)}</strong>
              </div>
            ))}
            {overview.assets.topHoldings.length === 0 ? <p className="status-message">尚未有持倉。</p> : null}
          </div>
        </article>

        <article className="card dashboard-domain-card">
          <div className="section-heading">
            <div><p className="eyebrow">資金</p><h2>本金與流水</h2></div>
            <Link className="text-link" to="/funds">資金頁</Link>
          </div>
          <div className="dashboard-mini-metrics">
            <span>累計本金 <strong>{money(overview.funds.totalPrincipalHKD)}</strong></span>
            <span>本月淨入金／提款 <strong className={overview.funds.monthNetFlowHKD >= 0 ? 'positive-text' : 'caution-text'}>{money(overview.funds.monthNetFlowHKD)}</strong></span>
          </div>
          <div className="dashboard-compact-list">
            {overview.funds.recentCashFlows.map((entry) => {
              const signedAmountHKD = convertCurrency(getCashFlowSignedAmount(entry), entry.currency, 'HKD');
              return (
                <div key={entry.id} className="dashboard-compact-row">
                  <span>{entry.type === 'withdrawal' ? '提款' : entry.type === 'deposit' ? '入金' : '調整'}<small>{entry.accountSource} · {entry.date}</small></span>
                  <strong className={signedAmountHKD >= 0 ? 'positive-text' : 'caution-text'}>{money(signedAmountHKD)}</strong>
                </div>
              );
            })}
            {overview.funds.recentCashFlows.length === 0 ? <p className="status-message">尚未有資金流水。</p> : null}
          </div>
        </article>

        <article className="card dashboard-domain-card">
          <div className="section-heading">
            <div><p className="eyebrow">交易</p><h2>交易摘要</h2></div>
            <Link className="text-link" to="/transactions">交易頁</Link>
          </div>
          <div className="dashboard-mini-metrics">
            <span>本月交易 <strong>{overview.transactions.monthTransactionCount} 筆</strong></span>
            <span>已實現盈虧 <strong className={overview.transactions.realizedPnlHKD >= 0 ? 'positive-text' : 'caution-text'}>{money(overview.transactions.realizedPnlHKD)}</strong></span>
          </div>
          <div className="dashboard-contribution-grid">
            <span>最大正面貢獻<strong className="positive-text">{overview.transactions.maxPositiveContribution ? `${overview.transactions.maxPositiveContribution.entry.symbol} · ${formatCurrencyRounded(overview.transactions.maxPositiveContribution.comparison.comparisonDisplay, displayCurrency)}` : '—'}</strong></span>
            <span>最大負面貢獻<strong className="caution-text">{overview.transactions.maxNegativeContribution ? `${overview.transactions.maxNegativeContribution.entry.symbol} · ${formatCurrencyRounded(overview.transactions.maxNegativeContribution.comparison.comparisonDisplay, displayCurrency)}` : '—'}</strong></span>
          </div>
          <div className="dashboard-compact-list">
            {overview.transactions.recentTransactions.map((entry) => (
              <div key={entry.id} className="dashboard-compact-row">
                <span>{entry.symbol} · {entry.transactionType === 'buy' ? '買入' : '賣出'}<small>{entry.accountSource} · {formatTradeDate(entry.date)}</small></span>
                <strong>{entry.quantity.toLocaleString('zh-HK')}</strong>
              </div>
            ))}
            {overview.transactions.recentTransactions.length === 0 ? <p className="status-message">尚未有交易。</p> : null}
          </div>
        </article>

        <article className="card dashboard-domain-card" id="latest-analysis-summary">
          <div className="section-heading">
            <div><p className="eyebrow">分析</p><h2>最新分析摘要</h2></div>
            <Link className="text-link" to="/analysis#stored-reports">查看報告</Link>
          </div>
          {overview.latestAnalysis ? (
            <>
              <div className="dashboard-analysis-meta">
                <StatusBadge
                  label={overview.latestAnalysis.status === 'fallback' ? '簡化報告' : '已生成'}
                  tone={overview.latestAnalysis.status === 'fallback' ? 'warning' : 'success'}
                />
                <span>{overview.latestAnalysis.title}</span>
                <small>{formatDate(overview.latestAnalysis.generatedAt)}</small>
              </div>
              {overview.latestAnalysis.highlights.length > 0 ? (
                <ol className="dashboard-highlight-list">
                  {overview.latestAnalysis.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}
                </ol>
              ) : (
                <p className="status-message">報告已儲存，但未能抽取簡短重點；可進入報告查看完整內容。</p>
              )}
            </>
          ) : (
            <p className="status-message">Firestore 尚未有已儲存月報或季報。</p>
          )}
        </article>
      </section>

      <section className="card dashboard-risk-card">
        <div className="section-heading">
          <div><p className="eyebrow">監察</p><h2>風險指標</h2></div>
          <Link className="text-link" to="/analysis">分析與報告</Link>
        </div>
        <div className="dashboard-risk-grid">
          {overview.insights.length > 0
            ? overview.insights.map((insight) => <InsightCard key={insight.id} insight={insight} />)
            : <p className="status-message">尚未有足夠資料建立風險指標。</p>}
        </div>
      </section>
    </div>
  );
}
