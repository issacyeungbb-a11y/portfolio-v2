import { memo, useMemo, useState } from 'react';

import type { CryptoMonthlySnapshot } from '../../types/cryptoHistory';

type TrendMode = 'asset' | 'return';
type TrendCurrency = 'HKD' | 'USD';

interface CryptoHistoryTrendChartProps {
  snapshots: CryptoMonthlySnapshot[];
  mode: TrendMode;
  currency?: TrendCurrency;
  selectedMonth?: string | null;
  onSelectMonth: (month: string) => void;
}

const CHART_WIDTH = 960;
const CHART_HEIGHT = 260;
const CHART_PADDING_X = 30;
const CHART_PADDING_Y = 24;

function compactMoney(value: number, currency: TrendCurrency) {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency,
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function fullMoney(value: number, currency: TrendCurrency) {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(value);
}

function percent(value: number | null) {
  if (value == null) return '—';
  return new Intl.NumberFormat('zh-HK', {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero',
  }).format(value);
}

function buildTrendData(
  snapshots: CryptoMonthlySnapshot[],
  mode: TrendMode,
  currency: TrendCurrency,
) {
  const values = snapshots.map((snapshot) =>
    mode === 'return'
      ? snapshot.returnHkd
      : currency === 'HKD'
        ? snapshot.totalHkd
        : snapshot.performanceTotalUsd,
  );
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const range = rawMax - rawMin || Math.max(Math.abs(rawMax), 1);
  const min = rawMin - range * 0.08;
  const max = rawMax + range * 0.08;
  const drawableWidth = CHART_WIDTH - CHART_PADDING_X * 2;
  const drawableHeight = CHART_HEIGHT - CHART_PADDING_Y * 2;
  const points = snapshots.map((snapshot, index) => {
    const value = values[index];
    const x =
      CHART_PADDING_X +
      (snapshots.length === 1
        ? drawableWidth / 2
        : (index / (snapshots.length - 1)) * drawableWidth);
    const y =
      CHART_PADDING_Y +
      (1 - (value - min) / (max - min || 1)) * drawableHeight;
    return { snapshot, value, x, y };
  });
  const path = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');
  const zeroY =
    min <= 0 && max >= 0
      ? CHART_PADDING_Y + (1 - (0 - min) / (max - min)) * drawableHeight
      : null;

  return { min, max, points, path, zeroY };
}

export const CryptoHistoryTrendChart = memo(function CryptoHistoryTrendChart({
  snapshots,
  mode,
  currency = 'HKD',
  selectedMonth,
  onSelectMonth,
}: CryptoHistoryTrendChartProps) {
  const [hoveredMonth, setHoveredMonth] = useState<string | null>(null);
  const trend = useMemo(
    () => buildTrendData(snapshots, mode, currency),
    [snapshots, mode, currency],
  );
  const latestSnapshot = snapshots[snapshots.length - 1];
  const activeMonth =
    hoveredMonth ??
    (selectedMonth && snapshots.some((snapshot) => snapshot.month === selectedMonth)
      ? selectedMonth
      : latestSnapshot?.month);
  const activePoint = trend.points.find(
    (point) => point.snapshot.month === activeMonth,
  );
  const chartCurrency = mode === 'return' ? 'HKD' : currency;

  if (snapshots.length === 0) {
    return <p className="status-message">所選範圍未有月結走勢。</p>;
  }

  return (
    <div className="crypto-trend-chart">
      <div className="crypto-chart-summary" aria-live="polite">
        <div>
          <span>{activePoint?.snapshot.month ?? '—'}</span>
          <strong>{activePoint ? fullMoney(activePoint.value, chartCurrency) : '—'}</strong>
        </div>
        {mode === 'return' && activePoint ? (
          <div className="crypto-return-meta">
            <span>回報率 {percent(activePoint.snapshot.returnPct)}</span>
            <span>上月變化 {percent(activePoint.snapshot.monthOverMonthPct)}</span>
          </div>
        ) : activePoint ? (
          <span className="table-hint">
            淨值 {fullMoney(activePoint.snapshot.currentNetUsd, 'USD')}
          </span>
        ) : null}
      </div>

      <div
        className="crypto-chart-stage"
        onMouseLeave={() => setHoveredMonth(null)}
      >
        <svg
          viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
          role="img"
          aria-label={
            mode === 'return'
              ? 'Crypto 月度回報金額走勢'
              : `Crypto 月結總資產 ${currency} 走勢`
          }
          preserveAspectRatio="none"
        >
          {[0, 0.5, 1].map((ratio) => {
            const y =
              CHART_PADDING_Y +
              ratio * (CHART_HEIGHT - CHART_PADDING_Y * 2);
            return (
              <line
                key={ratio}
                className="crypto-chart-grid-line"
                x1={CHART_PADDING_X}
                x2={CHART_WIDTH - CHART_PADDING_X}
                y1={y}
                y2={y}
              />
            );
          })}
          {trend.zeroY != null ? (
            <line
              className="crypto-chart-zero-line"
              x1={CHART_PADDING_X}
              x2={CHART_WIDTH - CHART_PADDING_X}
              y1={trend.zeroY}
              y2={trend.zeroY}
            />
          ) : null}
          <path
            className="crypto-chart-area"
            d={`${trend.path} L ${
              trend.points[trend.points.length - 1]?.x ?? 0
            } ${CHART_HEIGHT - CHART_PADDING_Y} L ${
              trend.points[0]?.x ?? 0
            } ${CHART_HEIGHT - CHART_PADDING_Y} Z`}
          />
          <path className="crypto-chart-line" d={trend.path} />
        </svg>

        <div className="crypto-chart-points" aria-label="可選月份">
          {trend.points.map((point) => (
            <button
              key={point.snapshot.id}
              type="button"
              className={
                point.snapshot.month === activeMonth
                  ? 'crypto-chart-point active'
                  : 'crypto-chart-point'
              }
              style={{
                left: `${(point.x / CHART_WIDTH) * 100}%`,
                top: `${(point.y / CHART_HEIGHT) * 100}%`,
              }}
              aria-label={`${point.snapshot.month}，${fullMoney(point.value, chartCurrency)}`}
              onMouseEnter={() => setHoveredMonth(point.snapshot.month)}
              onFocus={() => setHoveredMonth(point.snapshot.month)}
              onBlur={() => setHoveredMonth(null)}
              onClick={() => onSelectMonth(point.snapshot.month)}
            />
          ))}
        </div>
      </div>

      <div className="crypto-chart-axis" aria-hidden="true">
        <span>{compactMoney(trend.max, chartCurrency)}</span>
        <span>{snapshots[0]?.month}</span>
        <span>{latestSnapshot?.month}</span>
        <span>{compactMoney(trend.min, chartCurrency)}</span>
      </div>
    </div>
  );
});
