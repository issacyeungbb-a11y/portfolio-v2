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
          <p>
            目前總覽已改用真實持倉，但未有 `priceHistory` 或每日快照，所以未能正確計算
            7日、30日、半年同 1 年變動。
          </p>
          <p>下一步接入價格歷史後，呢張卡就會用同一套 Firestore 資料準確計算。</p>
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
        <p>算法: 期末總值 - 期初總值 - 期間淨入金，再用時間加權基礎資金計回報率。</p>
      </div>
    </article>
  );
}
