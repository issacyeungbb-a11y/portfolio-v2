import { useMemo, useState } from 'react';

import { convertCurrency, formatCurrencyRounded, formatPercent } from '../../lib/currency';
import { buildTrendSeries } from '../../lib/portfolio/overviewSelectors';
import type { AssetChangeSummary } from '../../lib/portfolio/assetChange';
import type { DisplayCurrency, PortfolioPerformancePoint } from '../../types/portfolio';

type DashboardTrendRange = '7d' | '30d';

interface DashboardTrendCardProps {
  history: PortfolioPerformancePoint[];
  currentPoint: PortfolioPerformancePoint;
  displayCurrency: DisplayCurrency;
  summaries: Record<DashboardTrendRange, AssetChangeSummary | null>;
}

const chartWidth = 520;
const chartHeight = 136;

function buildLinePath(values: number[]) {
  if (values.length === 0) return '';
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const valueRange = maximum - minimum || 1;

  return values.map((value, index) => {
    const x = values.length === 1 ? chartWidth / 2 : (index / (values.length - 1)) * chartWidth;
    const y = chartHeight - ((value - minimum) / valueRange) * chartHeight;
    return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
  }).join(' ');
}

export function DashboardTrendCard({
  history,
  currentPoint,
  displayCurrency,
  summaries,
}: DashboardTrendCardProps) {
  const [range, setRange] = useState<DashboardTrendRange>('30d');
  const series = useMemo(
    () => buildTrendSeries(history, currentPoint, range),
    [currentPoint, history, range],
  );
  const values = series.map((point) => convertCurrency(point.totalValue, 'HKD', displayCurrency));
  const linePath = buildLinePath(values);
  const summary = summaries[range];

  return (
    <article className="card dashboard-trend-card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">資產走勢</p>
          <h2>最近 {range === '7d' ? '7' : '30'} 日</h2>
        </div>
        <div className="dashboard-range-switch" role="group" aria-label="選擇資產走勢期間">
          {(['7d', '30d'] as DashboardTrendRange[]).map((option) => (
            <button
              key={option}
              className={range === option ? 'filter-chip active' : 'filter-chip'}
              type="button"
              aria-pressed={range === option}
              onClick={() => setRange(option)}
            >
              {option === '7d' ? '7 日' : '30 日'}
            </button>
          ))}
        </div>
      </div>

      {series.length > 1 ? (
        <div className="dashboard-mini-chart">
          <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`最近 ${range === '7d' ? 7 : 30} 日總資產走勢`}>
            <defs>
              <linearGradient id="dashboard-trend-fill" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="currentColor" stopOpacity="0.2" />
                <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path className="dashboard-mini-chart-area" d={`${linePath} L ${chartWidth} ${chartHeight} L 0 ${chartHeight} Z`} />
            <path className="dashboard-mini-chart-line" d={linePath} />
          </svg>
          <div className="dashboard-chart-dates">
            <span>{series[0]?.date.slice(5)}</span>
            <span>{series[series.length - 1]?.date.slice(5)}</span>
          </div>
        </div>
      ) : (
        <p className="status-message">未有足夠快照資料建立走勢。</p>
      )}

      <div className="dashboard-trend-breakdown">
        <div>
          <span>市場變動</span>
          <strong className={(summary?.marketChange ?? 0) >= 0 ? 'positive-text' : 'caution-text'}>
            {summary
              ? formatCurrencyRounded(
                  convertCurrency(summary.marketChange, 'HKD', displayCurrency),
                  displayCurrency,
                )
              : '—'}
          </strong>
          <small>{summary ? formatPercent(summary.returnPct) : '等待足夠快照'}</small>
        </div>
        <div>
          <span>外部資金流</span>
          <strong className={(summary?.netExternalFlow ?? 0) >= 0 ? 'positive-text' : 'caution-text'}>
            {summary
              ? formatCurrencyRounded(
                  convertCurrency(summary.netExternalFlow, 'HKD', displayCurrency),
                  displayCurrency,
                )
              : '—'}
          </strong>
          <small>不計作投資收益</small>
        </div>
      </div>
    </article>
  );
}
