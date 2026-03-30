import {
  convertCurrency,
  formatCurrency,
  formatDateLabel,
  formatPercent,
  getPerformanceRangeLabel,
} from '../../data/mockPortfolio';
import type {
  DisplayCurrency,
  PerformanceRange,
  PortfolioPerformanceSummary,
} from '../../types/portfolio';

interface PerformanceCardProps {
  displayCurrency: DisplayCurrency;
  selectedRange: PerformanceRange;
  summary: PortfolioPerformanceSummary | null;
  onSelectRange: (range: PerformanceRange) => void;
}

const ranges: PerformanceRange[] = ['7d', '30d', '6m', '1y'];

export function PerformanceCard({
  displayCurrency,
  selectedRange,
  summary,
  onSelectRange,
}: PerformanceCardProps) {
  if (!summary) {
    return (
      <article className="performance-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Portfolio Change</p>
            <h2>資產變動</h2>
          </div>
        </div>

        <div className="performance-range-row" role="tablist" aria-label="資產變動期間">
          {ranges.map((range) => (
            <button
              key={range}
              className={selectedRange === range ? 'performance-range active' : 'performance-range'}
              type="button"
              onClick={() => onSelectRange(range)}
            >
              {getPerformanceRangeLabel(range)}
            </button>
          ))}
        </div>

        <div className="performance-empty">
          <strong>暫未有足夠歷史資料</strong>
          <p>未能計算所選區間。</p>
        </div>
      </article>
    );
  }

  const tone = summary.changeAmount >= 0 ? 'positive' : 'caution';
  const changeAmount = convertCurrency(summary.changeAmount, 'HKD', displayCurrency);
  const netExternalFlow = convertCurrency(summary.netExternalFlow, 'HKD', displayCurrency);
  const flowLabel =
    summary.netExternalFlow === 0
      ? '無淨入金/提款'
      : summary.netExternalFlow > 0
        ? `淨入金 ${formatCurrency(netExternalFlow, displayCurrency)}`
        : `淨提款 ${formatCurrency(Math.abs(netExternalFlow), displayCurrency)}`;

  return (
    <article className="performance-card" data-tone={tone}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Portfolio Change</p>
          <h2>資產變動</h2>
        </div>
      </div>

      <div className="performance-range-row" role="tablist" aria-label="資產變動期間">
        {ranges.map((range) => (
          <button
            key={range}
            className={selectedRange === range ? 'performance-range active' : 'performance-range'}
            type="button"
            onClick={() => onSelectRange(range)}
          >
            {getPerformanceRangeLabel(range)}
          </button>
        ))}
      </div>

      <div className="performance-value">
        <strong>{formatCurrency(changeAmount, displayCurrency)}</strong>
        <span>{formatPercent(summary.returnPct)}</span>
      </div>

      <div className="performance-meta">
        <p>
          區間: {formatDateLabel(summary.startDate)} 至 {formatDateLabel(summary.endDate)}
        </p>
        <p>{flowLabel}</p>
      </div>
    </article>
  );
}
