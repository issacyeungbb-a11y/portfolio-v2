import { convertCurrency } from '../../lib/currency';
import { getAllocationBucketMeta } from '../../lib/holdings';
import { MoneyValue, PercentValue } from '../ui/FinanceValue';
import type {
  ReportAllocationDeltaSummary,
  ReportAllocationSummary,
  DisplayCurrency,
} from '../../types/portfolio';

interface ReportAllocationSummaryCardProps {
  summary?: ReportAllocationSummary;
  emptyMessage?: string;
  className?: string;
  displayCurrency?: DisplayCurrency;
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

function polarToCartesian(cx: number, cy: number, radius: number, angleInDegrees: number) {
  const angleInRadians = ((angleInDegrees - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(angleInRadians),
    y: cy + radius * Math.sin(angleInRadians),
  };
}

function describeArc(cx: number, cy: number, radius: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, radius, endAngle);
  const end = polarToCartesian(cx, cy, radius, startAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return ['M', start.x, start.y, 'A', radius, radius, 0, largeArcFlag, 0, end.x, end.y].join(' ');
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
  displayCurrency = 'HKD',
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
  const chartSize = 220;
  const chartRadius = 88;
  let currentAngle = 0;
  const chartArcs = slices.map((slice) => {
    const startAngle = currentAngle;
    const sliceAngle = (slice.percentage / 100) * 360;
    currentAngle += sliceAngle;

    return {
      ...slice,
      arcPath: describeArc(chartSize / 2, chartSize / 2, chartRadius, startAngle, currentAngle),
    };
  });

  const totalValue = summary.totalValueHKD != null
    ? convertCurrency(summary.totalValueHKD, 'HKD', displayCurrency)
    : null;

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

      {totalValue != null ? (
        <p className="report-allocation-total">
          總值 <MoneyValue value={totalValue} currency={displayCurrency} />
        </p>
      ) : null}

      {slices.length > 0 ? (
        <div className="report-allocation-chart-shell">
          <div
            className="report-allocation-donut"
            role="img"
            aria-label={`資產分佈：${slices
              .map((slice) => `${slice.label} ${formatPercentage(slice.percentage)}`)
              .join('，')}`}
          >
            <svg viewBox={`0 0 ${chartSize} ${chartSize}`} aria-hidden="true">
              <circle
                className="report-allocation-donut-track"
                cx={chartSize / 2}
                cy={chartSize / 2}
                r={chartRadius}
              />
              {chartArcs.map((slice) => (
                <path
                  key={slice.key}
                  d={slice.arcPath}
                  className="report-allocation-donut-arc"
                  style={{ stroke: slice.color }}
                >
                  <title>{`${slice.label} ${formatPercentage(slice.percentage)}`}</title>
                </path>
              ))}
            </svg>
            <div className="report-allocation-donut-center">
              <span>最大配置</span>
              <strong>{slices[0]?.label ?? '未提供'}</strong>
              <small>{formatPercentage(slices[0]?.percentage ?? 0)}</small>
            </div>
          </div>

          <div className="report-allocation-chart-metrics" aria-label="資產分佈重點">
            {chartArcs.slice(0, 3).map((slice) => (
              <div key={slice.key} className="report-allocation-chart-metric">
                <span
                  className="allocation-dot"
                  style={{ backgroundColor: slice.color }}
                  aria-hidden="true"
                />
                <div>
                  <strong>{slice.label}</strong>
                  <p>
                    <MoneyValue
                      value={
                        displayCurrency === 'HKD'
                          ? slice.totalValueHKD
                          : convertCurrency(slice.totalValueHKD, 'HKD', displayCurrency)
                      }
                      currency={displayCurrency}
                    />{' '}
                    · <PercentValue value={slice.percentage} showSign={false} />
                  </p>
                </div>
              </div>
            ))}
          </div>
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
              <strong>
                <MoneyValue
                  value={
                    displayCurrency === 'HKD'
                      ? slice.totalValueHKD
                      : convertCurrency(slice.totalValueHKD, 'HKD', displayCurrency)
                  }
                  currency={displayCurrency}
                />
              </strong>
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
