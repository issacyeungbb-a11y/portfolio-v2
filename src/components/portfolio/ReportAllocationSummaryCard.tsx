import { formatCurrencyRounded } from '../../lib/currency';
import { getAllocationBucketMeta } from '../../lib/holdings';
import type {
  ReportAllocationDeltaSummary,
  ReportAllocationSummary,
} from '../../types/portfolio';

interface ReportAllocationSummaryCardProps {
  summary?: ReportAllocationSummary;
  emptyMessage?: string;
  className?: string;
}

const DEFAULT_EMPTY_MESSAGE = '此舊報告生成時未保存資產分佈快照，因此未能顯示圖像總覽。';

function formatDateLabel(value: string) {
  if (!value) {
    return '未提供日期';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatPercentage(value: number) {
  return `${value.toFixed(1)}%`;
}

function formatDelta(value: number) {
  if (Math.abs(value) < 0.05) {
    return '0.0pp';
  }

  return `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`;
}

function getDeltaForKey(
  deltas: ReportAllocationDeltaSummary[] | undefined,
  key: ReportAllocationDeltaSummary['key'],
) {
  return deltas?.find((delta) => delta.key === key)?.deltaPercentagePoints;
}

function getComparisonText(summary: ReportAllocationSummary) {
  if (summary.comparisonLabel && summary.deltas?.length) {
    return `${summary.comparisonLabel}變化`;
  }

  return '未有可比較的上期快照';
}

export function ReportAllocationSummaryCard({
  summary,
  emptyMessage = DEFAULT_EMPTY_MESSAGE,
  className = '',
}: ReportAllocationSummaryCardProps) {
  const cardClassName = ['report-allocation-summary-card', className]
    .filter(Boolean)
    .join(' ');

  if (!summary) {
    return (
      <article className={`${cardClassName} report-allocation-summary-card-muted`}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">Allocation</p>
            <h2>資產分佈總覽</h2>
          </div>
        </div>
        <p className="status-message">{emptyMessage}</p>
      </article>
    );
  }

  const slices = summary.slices.filter((slice) => slice.percentage > 0);

  return (
    <article className={cardClassName}>
      <div className="section-heading report-allocation-summary-heading">
        <div>
          <p className="eyebrow">Allocation</p>
          <h2>資產分佈總覽</h2>
          <p className="table-hint">
            截至 {formatDateLabel(summary.asOfDate)} · {getComparisonText(summary)}
          </p>
        </div>
        <span className="chip chip-strong">{summary.styleTag}</span>
      </div>

      {summary.totalValueHKD ? (
        <p className="report-allocation-total">
          總值 {formatCurrencyRounded(summary.totalValueHKD, 'HKD')}
        </p>
      ) : null}

      {slices.length > 0 ? (
        <div
          className="report-allocation-stacked-bar"
          role="img"
          aria-label={`資產分佈：${slices
            .map((slice) => `${slice.label} ${formatPercentage(slice.percentage)}`)
            .join('，')}`}
        >
          {slices.map((slice) => (
            <span
              key={slice.key}
              className="report-allocation-segment"
              style={{
                backgroundColor: slice.color,
                flexBasis: `${slice.percentage}%`,
              }}
              title={`${slice.label} ${formatPercentage(slice.percentage)}`}
            />
          ))}
        </div>
      ) : (
        <p className="status-message">未有有效資產分佈資料。</p>
      )}

      <div className="report-allocation-legend">
        {slices.map((slice) => {
          const delta = getDeltaForKey(summary.deltas, slice.key);
          return (
            <div key={slice.key} className="report-allocation-legend-row">
              <span
                className="allocation-dot"
                style={{ backgroundColor: slice.color }}
                aria-hidden="true"
              />
              <span>{slice.label}</span>
              <strong>{formatPercentage(slice.percentage)}</strong>
              {typeof delta === 'number' ? (
                <small className={delta >= 0 ? 'positive-text' : 'caution-text'}>
                  {formatDelta(delta)}
                </small>
              ) : null}
            </div>
          );
        })}
      </div>

      {summary.deltas?.length ? (
        <div className="report-allocation-delta-list" aria-label="上期變化">
          {summary.deltas.map((delta) => {
            const meta = getAllocationBucketMeta(delta.key);
            return (
              <span
                key={delta.key}
                className={delta.deltaPercentagePoints >= 0 ? 'positive-text' : 'caution-text'}
              >
                {meta.label} {formatDelta(delta.deltaPercentagePoints)}
              </span>
            );
          })}
        </div>
      ) : null}

      {summary.summarySentence ? (
        <p className="report-allocation-sentence">{summary.summarySentence}</p>
      ) : null}

      <div className="report-allocation-tags">
        {summary.warningTags.map((tag) => (
          <span key={tag} className="chip chip-soft">
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}
