import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { buildNiceScale, pickLabelIndices } from '../../lib/chartScale';

export type ChartTone = 'gain' | 'loss' | 'neutral';

export interface ChartSeries {
  id: string;
  label: string;
  values: Array<number | null>;
  variant: 'primary' | 'reference';
}

interface ChartFrameProps {
  labels: string[];
  tooltipTitles?: string[];
  formatValue: (value: number) => string;
  formatAxis?: (value: number) => string;
  renderTooltip?: (index: number) => ReactNode;
  activeIndex?: number | null;
  onSelect?: (index: number) => void;
  height?: number;
  ariaLabel: string;
}

interface FinanceLineChartProps extends ChartFrameProps {
  series: ChartSeries[];
  /** breaks[i] 為 true 時唔會連接 i-1 → i（例如月份缺漏或計算口徑轉變）。 */
  breaks?: boolean[];
  tone?: ChartTone;
  baseline?: number | null;
  /** 由第一點至 untilIndex 加灰色底，標示唔計收益嘅期間（例如建立資料期間）。 */
  shade?: { untilIndex: number; label: string } | null;
}

interface FinanceBarChartProps extends ChartFrameProps {
  values: Array<number | null>;
}

const padding = { top: 14, right: 14, bottom: 30 };
const compactFormatter = new Intl.NumberFormat('zh-HK', { notation: 'compact', maximumFractionDigits: 1 });
const defaultAxisFormat = (value: number) => compactFormatter.format(value);

function useMeasuredWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(240, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

function buildChartGeometry(count: number, values: number[], width: number, height: number, includeZero: boolean, formatAxis: (value: number) => string) {
  const scale = buildNiceScale(values, { includeZero, tickCount: height < 220 ? 3 : 4 });
  const axisWidth = Math.max(...scale.ticks.map((tick) => formatAxis(tick).length)) * 7 + 14;
  const left = Math.max(40, axisWidth);
  const plotWidth = Math.max(1, width - left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const x = (index: number) => left + (count <= 1 ? plotWidth / 2 : (index / (count - 1)) * plotWidth);
  const y = (value: number) => padding.top + ((scale.max - value) / (scale.max - scale.min || 1)) * plotHeight;
  const labelIndices = pickLabelIndices(count, Math.max(2, Math.floor(plotWidth / 86)));

  return { scale, left, plotWidth, plotHeight, x, y, labelIndices };
}

type Geometry = ReturnType<typeof buildChartGeometry>;

function Axes({ geometry, labels, width, height, formatAxis }: { geometry: Geometry; labels: string[]; width: number; height: number; formatAxis: (value: number) => string }) {
  const { scale, left, x, y, labelIndices } = geometry;
  const last = labels.length - 1;

  return (
    <g aria-hidden="true">
      {scale.ticks.map((tick) => (
        <g key={tick}>
          <line className={tick === 0 && scale.min < 0 ? 'fin-chart-zero' : 'fin-chart-grid'} x1={left} x2={width - padding.right} y1={y(tick)} y2={y(tick)} />
          <text className="fin-chart-axis" x={left - 8} y={y(tick) + 4} textAnchor="end">{formatAxis(tick)}</text>
        </g>
      ))}
      {labelIndices.map((index) => (
        <text
          key={index}
          className="fin-chart-axis"
          x={x(index)}
          y={height - 9}
          textAnchor={labels.length > 1 && index === 0 ? 'start' : index === last && labels.length > 1 ? 'end' : 'middle'}
        >
          {labels[index]}
        </text>
      ))}
    </g>
  );
}

function useHover(count: number, geometry: Geometry, onSelect?: (index: number) => void) {
  const [hovered, setHovered] = useState<number | null>(null);

  const indexAt = (event: { clientX: number; currentTarget: Element }) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - bounds.left) / Math.max(1, bounds.width);
    return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
  };

  const overlay = (
    <rect
      className="fin-chart-overlay"
      x={geometry.left}
      y={padding.top}
      width={geometry.plotWidth}
      height={geometry.plotHeight}
      onPointerMove={(event) => setHovered(indexAt(event))}
      onPointerDown={(event) => setHovered(indexAt(event))}
      onPointerLeave={() => setHovered(null)}
      onClick={(event) => onSelect?.(indexAt(event))}
    />
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (count === 0) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setHovered((current) => {
        const start = current ?? count - 1;
        return Math.min(count - 1, Math.max(0, start + (event.key === 'ArrowLeft' ? -1 : 1)));
      });
    } else if ((event.key === 'Enter' || event.key === ' ') && hovered != null) {
      event.preventDefault();
      onSelect?.(hovered);
    } else if (event.key === 'Escape') {
      setHovered(null);
    }
  };

  return { hovered, setHovered, overlay, onKeyDown };
}

function Tooltip({ index, x, width, title, children }: { index: number; x: number; width: number; title?: string; children: ReactNode }) {
  const alignRight = x > width * 0.62;

  return (
    <div
      className="fin-chart-tooltip"
      data-index={index}
      style={alignRight ? { right: `${width - x + 12}px` } : { left: `${x + 12}px` }}
    >
      {title ? <span className="fin-chart-tooltip-title">{title}</span> : null}
      {children}
    </div>
  );
}

function segmentPaths(values: Array<number | null>, breaks: boolean[] | undefined, x: (index: number) => number, y: (value: number) => number) {
  const segments: Array<Array<[number, number]>> = [];
  let current: Array<[number, number]> = [];

  values.forEach((value, index) => {
    if (value == null || !Number.isFinite(value) || breaks?.[index]) {
      if (current.length) segments.push(current);
      current = [];
    }
    if (value != null && Number.isFinite(value)) {
      current.push([x(index), y(value)]);
    }
  });

  if (current.length) segments.push(current);
  return segments;
}

export function FinanceLineChart({
  labels,
  tooltipTitles,
  series,
  breaks,
  tone = 'neutral',
  baseline = null,
  shade = null,
  formatValue,
  formatAxis = defaultAxisFormat,
  renderTooltip,
  activeIndex = null,
  onSelect,
  height = 260,
  ariaLabel,
}: FinanceLineChartProps) {
  const gradientId = useId().replace(/:/g, '');
  const [ref, width] = useMeasuredWidth();
  const count = labels.length;
  const allValues = series.flatMap((entry) => entry.values).filter((value): value is number => value != null && Number.isFinite(value));
  const geometry = buildChartGeometry(count, baseline != null ? [...allValues, baseline] : allValues, width, height, false, formatAxis);
  const { x, y } = geometry;
  const { hovered, overlay, onKeyDown } = useHover(count, geometry, onSelect);
  const focusIndex = hovered ?? activeIndex;
  const primary = series.find((entry) => entry.variant === 'primary') ?? series[0];
  const plotBottom = padding.top + geometry.plotHeight;
  const lastPrimaryIndex = primary ? primary.values.reduce<number>((found, value, index) => (value != null && Number.isFinite(value) ? index : found), -1) : -1;

  if (count === 0 || allValues.length === 0) {
    return <div ref={ref} className="fin-chart-empty">所選期間未有足夠資料</div>;
  }

  return (
    <div ref={ref} className="fin-chart" data-tone={tone} tabIndex={0} aria-label={ariaLabel} onKeyDown={onKeyDown}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" className="fin-chart-area-start" />
            <stop offset="100%" className="fin-chart-area-end" />
          </linearGradient>
        </defs>
        {shade && shade.untilIndex > 0 && count > 1 ? (
          <g className="fin-chart-shade">
            <rect x={geometry.left} y={padding.top} width={Math.max(0, x(Math.min(shade.untilIndex, count - 1)) - geometry.left)} height={geometry.plotHeight} />
            {x(Math.min(shade.untilIndex, count - 1)) - geometry.left > 70 ? (
              <text x={geometry.left + 6} y={padding.top + 14}>{shade.label}</text>
            ) : null}
          </g>
        ) : null}
        <Axes geometry={geometry} labels={labels} width={width} height={height} formatAxis={formatAxis} />
        {baseline != null ? (
          <line className="fin-chart-baseline" x1={geometry.left} x2={width - padding.right} y1={y(baseline)} y2={y(baseline)} />
        ) : null}
        {primary
          ? segmentPaths(primary.values, breaks, x, y).map((segment, index) =>
              segment.length > 1 ? (
                <path
                  key={`area-${index}`}
                  className="fin-chart-area"
                  fill={`url(#${gradientId})`}
                  d={`M${segment[0][0]},${plotBottom} ${segment.map(([px, py]) => `L${px},${py}`).join(' ')} L${segment[segment.length - 1][0]},${plotBottom} Z`}
                />
              ) : null,
            )
          : null}
        {series.map((entry) =>
          segmentPaths(entry.values, breaks, x, y).map((segment, index) => (
            <path
              key={`${entry.id}-${index}`}
              className={entry.variant === 'primary' ? 'fin-chart-line' : 'fin-chart-reference'}
              d={segment.map(([px, py], pointIndex) => `${pointIndex === 0 ? 'M' : 'L'}${px},${py}`).join(' ')}
            />
          )),
        )}
        {focusIndex != null ? (
          <line className="fin-chart-crosshair" x1={x(focusIndex)} x2={x(focusIndex)} y1={padding.top} y2={plotBottom} />
        ) : null}
        {focusIndex != null
          ? series.map((entry) => {
              const value = entry.values[focusIndex];
              return value != null && Number.isFinite(value) ? (
                <circle key={entry.id} className={entry.variant === 'primary' ? 'fin-chart-dot' : 'fin-chart-dot reference'} cx={x(focusIndex)} cy={y(value)} r={4.5} />
              ) : null;
            })
          : null}
        {focusIndex == null && primary && lastPrimaryIndex >= 0 ? (
          <circle className="fin-chart-dot" cx={x(lastPrimaryIndex)} cy={y(primary.values[lastPrimaryIndex] as number)} r={4.5} />
        ) : null}
        {overlay}
      </svg>
      {hovered != null ? (
        <Tooltip index={hovered} x={x(hovered)} width={width} title={tooltipTitles?.[hovered] ?? labels[hovered]}>
          {renderTooltip
            ? renderTooltip(hovered)
            : series.map((entry) => {
                const value = entry.values[hovered];
                return (
                  <span key={entry.id} className="fin-chart-tooltip-row">
                    <i data-variant={entry.variant} aria-hidden="true" />
                    {entry.label}
                    <strong>{value == null ? '—' : formatValue(value)}</strong>
                  </span>
                );
              })}
        </Tooltip>
      ) : null}
    </div>
  );
}

export function FinanceBarChart({
  labels,
  tooltipTitles,
  values,
  formatValue,
  formatAxis = defaultAxisFormat,
  renderTooltip,
  activeIndex = null,
  onSelect,
  height = 200,
  ariaLabel,
}: FinanceBarChartProps) {
  const [ref, width] = useMeasuredWidth();
  const count = labels.length;
  const finite = values.filter((value): value is number => value != null && Number.isFinite(value));
  const geometry = buildChartGeometry(count, finite, width, height, true, formatAxis);
  const { x, y } = geometry;
  const { hovered, overlay, onKeyDown } = useHover(count, geometry, onSelect);
  const focusIndex = hovered ?? activeIndex;
  const slot = geometry.plotWidth / Math.max(1, count);
  const barWidth = Math.max(2, Math.min(18, slot * 0.62));

  if (count === 0 || finite.length === 0) {
    return <div ref={ref} className="fin-chart-empty">所選期間未有可比較數值</div>;
  }

  return (
    <div ref={ref} className="fin-chart" tabIndex={0} aria-label={ariaLabel} onKeyDown={onKeyDown}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        <Axes geometry={geometry} labels={labels} width={width} height={height} formatAxis={formatAxis} />
        {values.map((value, index) =>
          value == null || !Number.isFinite(value) ? null : (
            <rect
              key={index}
              className="fin-chart-bar"
              data-tone={value < 0 ? 'loss' : 'gain'}
              data-active={focusIndex === index || undefined}
              data-dimmed={hovered != null && hovered !== index ? true : undefined}
              x={x(index) - barWidth / 2}
              y={Math.min(y(value), y(0))}
              width={barWidth}
              height={Math.max(1, Math.abs(y(value) - y(0)))}
              rx={Math.min(3, barWidth / 3)}
            />
          ),
        )}
        {overlay}
      </svg>
      {hovered != null ? (
        <Tooltip index={hovered} x={x(hovered)} width={width} title={tooltipTitles?.[hovered] ?? labels[hovered]}>
          {renderTooltip ? renderTooltip(hovered) : <strong>{values[hovered] == null ? '未有資料' : formatValue(values[hovered] as number)}</strong>}
        </Tooltip>
      ) : null}
    </div>
  );
}
