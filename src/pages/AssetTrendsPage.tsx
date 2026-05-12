import { useEffect, useMemo, useState } from 'react';

import { CurrencyToggle } from '../components/ui/CurrencyToggle';
import {
  convertCurrency,
  formatCurrencyRounded,
  formatPercent,
  getCashFlowSignedAmount,
} from '../data/mockPortfolio';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePortfolioSnapshots, useTodaySnapshotStatus } from '../hooks/usePortfolioSnapshots';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  calculateAssetChangeSummary,
  createCurrentPortfolioPoint,
} from '../lib/portfolio/assetChange';
import type {
  AccountCashFlowEntry,
  PortfolioPerformancePoint,
} from '../types/portfolio';

type TrendRange = '1d' | '7d' | '30d';

const chartWidth = 320;
const chartHeight = 180;

const trendRanges: Array<{ value: TrendRange; label: string }> = [
  { value: '1d', label: '今日' },
  { value: '7d', label: '7日' },
  { value: '30d', label: '30日' },
];

function parseDateKey(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
}

function formatDateChip(dateKey: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(new Date(`${dateKey}T00:00:00+08:00`));
  } catch {
    return dateKey;
  }
}

function formatMonthChip(dateKey: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      year: 'numeric',
      month: 'long',
    }).format(new Date(`${dateKey}-01T00:00:00+08:00`));
  } catch {
    return dateKey;
  }
}

function getMonthKey(dateKey: string) {
  return dateKey.slice(0, 7);
}

function buildTrendSeries(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint,
  range: TrendRange,
) {
  const dayCount = range === '1d' ? 1 : range === '7d' ? 7 : 30;
  const allPoints = [...history, currentPoint]
    .sort((left, right) => left.date.localeCompare(right.date))
    .reduce<PortfolioPerformancePoint[]>((result, point) => {
      const existing = result.findIndex((entry) => entry.date === point.date);
      if (existing >= 0) {
        result[existing] = point;
      } else {
        result.push(point);
      }
      return result;
    }, []);
  const cutoff = new Date(parseDateKey(currentPoint.date).getTime() - (dayCount - 1) * 24 * 60 * 60 * 1000);

  return allPoints.filter((point) => parseDateKey(point.date) >= cutoff);
}

function buildLinePath(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return '';
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / range) * height;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function buildTrendPoints(values: number[], width: number, height: number) {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  return values.map((value, index) => ({
    x: values.length === 1 ? width / 2 : (index / (values.length - 1)) * width,
    y: height - ((value - min) / range) * height,
    value,
  }));
}

function buildValueTicks(values: number[]) {
  if (values.length === 0) {
    return [];
  }

  const min = Math.min(...values);
  const max = Math.max(...values);

  if (min === max) {
    return [max, max, max];
  }

  return [max, (max + min) / 2, min];
}

function buildDateTicks(series: PortfolioPerformancePoint[]) {
  if (series.length <= 1) {
    return series.map((point, index) => ({ index, label: point.date.slice(5) }));
  }

  const tickCount = Math.min(series.length, series.length >= 7 ? 4 : 3);
  const ticks = Array.from({ length: tickCount }, (_, tickIndex) => {
    const index = Math.round((tickIndex / (tickCount - 1)) * (series.length - 1));
    return { index, label: series[index].date.slice(5) };
  });

  return ticks.filter((tick, index, list) => list.findIndex((entry) => entry.index === tick.index) === index);
}

function buildCalendarEntries(
  history: PortfolioPerformancePoint[],
  currentPoint: PortfolioPerformancePoint | null,
  cashFlows: AccountCashFlowEntry[],
) {
  const byDate = [...history, ...(currentPoint ? [currentPoint] : [])]
    .sort((left, right) => left.date.localeCompare(right.date))
    .reduce<Map<string, PortfolioPerformancePoint>>((map, point) => {
      map.set(point.date, point);
      return map;
    }, new Map());
  const points = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const cashFlowByDate = cashFlows.reduce<Map<string, number>>((map, entry) => {
    const current = map.get(entry.date) ?? 0;
    map.set(entry.date, current + convertCurrency(getCashFlowSignedAmount(entry), entry.currency, 'HKD'));
    return map;
  }, new Map());

  return points.map((point, index) => {
    const previous = points[index - 1];
    const netFlow = cashFlowByDate.get(point.date) ?? 0;
    const changeHKD = previous ? point.totalValue - previous.totalValue - netFlow : 0;

    return {
      date: point.date,
      changeHKD,
      totalValueHKD: point.totalValue,
    };
  });
}

function buildCalendarGrid(dateKey: string) {
  const monthStart = parseDateKey(`${dateKey.slice(0, 7)}-01`);
  const firstWeekday = monthStart.getDay();
  const year = monthStart.getFullYear();
  const month = monthStart.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<{ day?: number; dateKey?: string }> = [];

  for (let index = 0; index < firstWeekday; index += 1) {
    cells.push({});
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const normalized = `${dateKey.slice(0, 7)}-${String(day).padStart(2, '0')}`;
    cells.push({ day, dateKey: normalized });
  }

  while (cells.length % 7 !== 0) {
    cells.push({});
  }

  return cells;
}

function formatCalendarChange(value: number) {
  if (value === 0) {
    return '0';
  }

  const sign = value > 0 ? '+' : '-';
  const absolute = Math.abs(value);

  if (absolute >= 10000) {
    return `${sign}${Math.round(absolute / 10000)}萬`;
  }

  return `${sign}${Math.round(absolute).toLocaleString('en-US')}`;
}

function sumSignedCashFlowsHKD(entries: AccountCashFlowEntry[]) {
  return entries.reduce(
    (sum, entry) => sum + convertCurrency(getCashFlowSignedAmount(entry), entry.currency, 'HKD'),
    0,
  );
}

function formatSnapshotHint(value?: string) {
  if (!value) {
    return '尚未有正式快照';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '尚未有正式快照';
  }

  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}

export function AssetTrendsPage() {
  const { holdings: firestoreHoldings, status, error } = usePortfolioAssets();
  const { history, error: snapshotsError } = usePortfolioSnapshots();
  const { todaySnapshot, error: todaySnapshotError } = useTodaySnapshotStatus();
  const { entries: cashFlows, error: cashFlowsError } = useAccountCashFlows();
  const { entries: principals, error: principalsError } = useAccountPrincipals();
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  const [selectedRange, setSelectedRange] = useState<TrendRange | null>('7d');
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState<string | null>(null);
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);

  const holdings = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => convertCurrency(holding.quantity * holding.currentPrice, holding.currency, 'HKD'),
  );
  const currentPoint = createCurrentPortfolioPoint(holdings);
  const todaySnapshotExists = todaySnapshot.exists;
  const totalValue = convertCurrency(currentPoint.totalValue, 'HKD', displayCurrency);
  const netExternalFlowTotalHKD = sumSignedCashFlowsHKD(cashFlows);
  const totalPrincipalHKD =
    principals.reduce(
      (sum, entry) => sum + convertCurrency(entry.principalAmount, entry.currency, 'HKD'),
      0,
    ) + netExternalFlowTotalHKD;
  const historicalReturnHKD = currentPoint.totalValue - totalPrincipalHKD;
  const historicalReturnPct =
    totalPrincipalHKD === 0 ? 0 : (historicalReturnHKD / Math.abs(totalPrincipalHKD)) * 100;
  const monthStartDate = `${currentPoint.date.slice(0, 7)}-01`;
  const monthlySnapshot = history
    .filter((point) => point.date >= monthStartDate)
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  const monthStartValueHKD = monthlySnapshot?.totalValue ?? currentPoint.totalValue;
  const monthFlowsHKD = cashFlows.reduce((sum, entry) => {
    if (!entry.date.startsWith(currentPoint.date.slice(0, 7))) {
      return sum;
    }

    return sum + convertCurrency(getCashFlowSignedAmount(entry), entry.currency, 'HKD');
  }, 0);
  const monthlyReturnHKD = currentPoint.totalValue - monthStartValueHKD - monthFlowsHKD;
  const monthlyReturnPct = monthStartValueHKD === 0 ? 0 : (monthlyReturnHKD / monthStartValueHKD) * 100;
  const todaySummary = calculateAssetChangeSummary(
    history,
    currentPoint,
    cashFlows,
    '1d',
    todaySnapshotExists,
  );
  const rangeSummary =
    selectedRange != null
      ? calculateAssetChangeSummary(
          history,
          currentPoint,
          cashFlows,
          selectedRange,
          todaySnapshotExists,
        )
      : null;
  const trendSeries = selectedRange ? buildTrendSeries(history, currentPoint, selectedRange) : [];
  const trendValues = trendSeries.map((point) => convertCurrency(point.totalValue, 'HKD', displayCurrency));
  const linePath = buildLinePath(
    trendValues,
    chartWidth,
    chartHeight,
  );
  const trendPoints = buildTrendPoints(trendValues, chartWidth, chartHeight);
  const yAxisTicks = buildValueTicks(trendValues);
  const xAxisTicks = buildDateTicks(trendSeries);
  const hoveredTrendPoint =
    hoveredTrendIndex == null || hoveredTrendIndex >= trendSeries.length
      ? null
      : {
          point: trendSeries[hoveredTrendIndex],
          value: trendValues[hoveredTrendIndex],
          change: trendValues[hoveredTrendIndex] - (trendValues[hoveredTrendIndex - 1] ?? trendValues[hoveredTrendIndex]),
        };
  const calendarEntries = buildCalendarEntries(history, todaySnapshotExists ? currentPoint : null, cashFlows);
  const calendarMap = new Map(calendarEntries.map((entry) => [entry.date, entry]));
  const calendarMonthOptions = [...new Set([
    getMonthKey(currentPoint.date),
    ...calendarEntries.map((entry) => getMonthKey(entry.date)),
  ])].sort((left, right) => right.localeCompare(left));
  const activeCalendarMonth =
    selectedCalendarMonth && calendarMonthOptions.includes(selectedCalendarMonth)
      ? selectedCalendarMonth
      : calendarMonthOptions[0] ?? getMonthKey(currentPoint.date);
  const calendarGrid = buildCalendarGrid(`${activeCalendarMonth}-01`);
  const monthlyCalendarPnLHKD = calendarEntries
    .filter((entry) => getMonthKey(entry.date) === activeCalendarMonth)
    .reduce((sum, entry) => sum + entry.changeHKD, 0);
  const selectedCalendarMonthStartValueHKD =
    calendarEntries.find((entry) => getMonthKey(entry.date) === activeCalendarMonth)?.totalValueHKD ??
    currentPoint.totalValue;
  const latestSnapshot = [...history]
    .filter((point) => Boolean(point.capturedAt))
    .sort((left, right) => (left.capturedAt ?? '').localeCompare(right.capturedAt ?? ''))
    .slice(-1)[0];
  const latestSnapshotLabel = formatSnapshotHint(latestSnapshot?.capturedAt);
  const todaySnapshotComplete = todaySnapshot.exists;
  const latestSnapshotIsFallback = todaySnapshot.exists && todaySnapshot.quality === 'fallback';
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '資產走勢',
      subtitle: '查看每日快照與資產變化。',
      primaryStatus: {
        label: todaySnapshotComplete ? '今日快照完整' : '今日快照未完成',
        tone: todaySnapshotComplete ? 'success' : 'warning',
      },
    }),
    [
      todaySnapshotComplete,
    ],
  );

  useTopBar(topBarConfig);

  useEffect(() => {
    if (!selectedCalendarMonth || !calendarMonthOptions.includes(selectedCalendarMonth)) {
      setSelectedCalendarMonth(activeCalendarMonth);
    }
  }, [activeCalendarMonth, calendarMonthOptions, selectedCalendarMonth]);

  return (
    <div className="page-stack">
      <div className="trends-alert-stack" aria-live="polite">
        {error ? <p className="trends-system-note error">{error}</p> : null}
        {snapshotsError ? <p className="trends-system-note error">{snapshotsError}</p> : null}
        {todaySnapshotError ? <p className="trends-system-note error">{todaySnapshotError}</p> : null}
        {cashFlowsError ? <p className="trends-system-note error">{cashFlowsError}</p> : null}
        {principalsError ? <p className="trends-system-note error">{principalsError}</p> : null}
      </div>

      <section className="card trends-overview-card">
        <div className="trends-toolbar">
          <div>
            <p className="table-hint">以同一個顯示幣別查看總值、收益與月曆變化。</p>
          </div>
          <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
        </div>

        <div className="trends-hero-stat">
          <span className="trends-stat-label">總資產估值</span>
          <strong>{formatCurrencyRounded(totalValue, displayCurrency)}</strong>
          <p className="trends-today-return">
            <span>今日收益</span>
            <strong className={todaySummary ? (todaySummary.totalChange >= 0 ? 'positive-text' : 'caution-text') : 'table-hint'}>
              {todaySummary
                ? `${todaySummary.totalChange >= 0 ? '+' : ''}${formatCurrencyRounded(
                    convertCurrency(todaySummary.totalChange, 'HKD', displayCurrency),
                    displayCurrency,
                  )} (${formatPercent(todaySummary.returnPct)})`
                : '今日快照待生成，收益暫不可用'}
            </strong>
          </p>
        </div>

        <div className="trends-overview-grid trends-kpi-grid">
          <div className="trends-overview-mini">
            <span>本月收益</span>
            <strong className={monthlyReturnHKD >= 0 ? 'positive-text' : 'caution-text'}>
              {monthlyReturnHKD >= 0 ? '+' : ''}
              {formatCurrencyRounded(convertCurrency(monthlyReturnHKD, 'HKD', displayCurrency), displayCurrency)}
            </strong>
            <small>{formatPercent(monthlyReturnPct)}</small>
          </div>
          <div className="trends-overview-mini">
            <span>歷史收益</span>
            <strong className={historicalReturnHKD >= 0 ? 'positive-text' : 'caution-text'}>
              {historicalReturnHKD >= 0 ? '+' : ''}
              {formatCurrencyRounded(
                convertCurrency(historicalReturnHKD, 'HKD', displayCurrency),
                displayCurrency,
              )}
            </strong>
            <small>{formatPercent(historicalReturnPct)}</small>
          </div>
          <div className="trends-overview-mini">
            <span>額外投入/提取</span>
            <strong className={netExternalFlowTotalHKD >= 0 ? 'positive-text' : 'caution-text'}>
              {netExternalFlowTotalHKD >= 0 ? '+' : ''}
              {formatCurrencyRounded(
                convertCurrency(netExternalFlowTotalHKD, 'HKD', displayCurrency),
                displayCurrency,
              )}
            </strong>
            <small>累計資金流</small>
          </div>
        </div>
        <div className="trends-snapshot-status">
          <span>最新快照</span>
          <strong>{latestSnapshotLabel}</strong>
          {latestSnapshotIsFallback ? <em>備援快照</em> : null}
          <small>資產走勢數據以該次快照為基準</small>
        </div>
      </section>

      <section className="card trends-chart-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">資產走勢</p>
            <h2>資產走勢</h2>
          </div>
          <span className="chip chip-soft">{formatDateChip(currentPoint.date)}</span>
        </div>

        <div className="trends-range-row" role="tablist" aria-label="資產走勢期間">
          {trendRanges.map((range) => (
            <button
              key={range.value}
              className={selectedRange === range.value ? 'filter-chip active' : 'filter-chip'}
              type="button"
              onClick={() => setSelectedRange(range.value)}
            >
              {range.label}
            </button>
          ))}
        </div>

        {selectedRange && rangeSummary ? (
          <div className="trends-reveal-panel">
            <div className="trends-performance-grid">
              <div className="trends-reveal-summary primary">
                <span>{trendRanges.find((entry) => entry.value === selectedRange)?.label}區間變動</span>
                <strong className={rangeSummary.totalChange >= 0 ? 'positive-text' : 'caution-text'}>
                  {rangeSummary.totalChange >= 0 ? '+' : ''}
                  {formatCurrencyRounded(
                    convertCurrency(rangeSummary.totalChange, 'HKD', displayCurrency),
                    displayCurrency,
                  )}
                </strong>
                <small>{formatPercent(rangeSummary.returnPct)}</small>
              </div>
              <div className="trends-overview-mini">
                <span>市場變動</span>
                <strong className={rangeSummary.marketChange >= 0 ? 'positive-text' : 'caution-text'}>
                  {rangeSummary.marketChange >= 0 ? '+' : ''}
                  {formatCurrencyRounded(
                    convertCurrency(rangeSummary.marketChange, 'HKD', displayCurrency),
                    displayCurrency,
                  )}
                </strong>
                <small>價格及持倉估值影響</small>
              </div>
              <div className="trends-overview-mini">
                <span>資金流影響</span>
                <strong className={rangeSummary.netExternalFlow >= 0 ? 'positive-text' : 'caution-text'}>
                  {rangeSummary.netExternalFlow >= 0 ? '+' : ''}
                  {formatCurrencyRounded(
                    convertCurrency(rangeSummary.netExternalFlow, 'HKD', displayCurrency),
                    displayCurrency,
                  )}
                </strong>
                <small>額外投入/提取</small>
              </div>
            </div>

            {trendSeries.length > 1 ? (
              <div className="trends-period-bridge">
                <span>期初估值</span>
                <strong>{formatCurrencyRounded(trendValues[0], displayCurrency)}</strong>
                <i aria-hidden="true">→</i>
                <span>期末估值</span>
                <strong>{formatCurrencyRounded(trendValues[trendValues.length - 1], displayCurrency)}</strong>
              </div>
            ) : null}

            <div className="trends-chart-shell">
              {trendSeries.length > 1 ? (
                <div className="trends-chart-annotated">
                  <div className="trends-chart-y-labels">
                    {yAxisTicks.map((value, index) => (
                      <span key={`${value}-${index}`}>{formatCurrencyRounded(value, displayCurrency)}</span>
                    ))}
                  </div>
                  <svg viewBox="0 0 320 180" className="trends-line-chart" role="img" aria-label="資產走勢圖">
                    {yAxisTicks.map((_, index) => {
                      const y = (index / (yAxisTicks.length - 1)) * chartHeight;
                      return <line key={index} className="trends-grid-line" x1="0" x2={chartWidth} y1={y} y2={y} />;
                    })}
                    <path d={linePath} />
                    {trendPoints.map((point, index) => (
                      <circle
                        key={trendSeries[index].date}
                        className="trends-hit-point"
                        cx={point.x}
                        cy={point.y}
                        r="9"
                        onMouseEnter={() => setHoveredTrendIndex(index)}
                        onMouseLeave={() => setHoveredTrendIndex(null)}
                        onFocus={() => setHoveredTrendIndex(index)}
                        onBlur={() => setHoveredTrendIndex(null)}
                        tabIndex={0}
                      >
                        <title>
                          {`${formatDateChip(trendSeries[index].date)}｜總資產 ${formatCurrencyRounded(
                            point.value,
                            displayCurrency,
                          )}｜當日變化 ${formatCurrencyRounded(
                            point.value - (trendValues[index - 1] ?? point.value),
                            displayCurrency,
                          )}`}
                        </title>
                      </circle>
                    ))}
                    {trendPoints.length > 0 ? (
                      <circle
                        className="trends-latest-point"
                        cx={trendPoints[trendPoints.length - 1].x}
                        cy={trendPoints[trendPoints.length - 1].y}
                        r="4.5"
                      />
                    ) : null}
                  </svg>
                  {hoveredTrendPoint ? (
                    <div className="trends-chart-tooltip">
                      <span>{formatDateChip(hoveredTrendPoint.point.date)}</span>
                      <strong>{formatCurrencyRounded(hoveredTrendPoint.value, displayCurrency)}</strong>
                      <small className={hoveredTrendPoint.change >= 0 ? 'positive-text' : 'caution-text'}>
                        當日變化 {hoveredTrendPoint.change >= 0 ? '+' : ''}
                        {formatCurrencyRounded(hoveredTrendPoint.change, displayCurrency)}
                      </small>
                    </div>
                  ) : null}
                  <div className="trends-chart-x-labels">
                    {xAxisTicks.map((tick) => (
                      <span key={`${tick.index}-${tick.label}`} style={{ left: `${(tick.index / (trendSeries.length - 1)) * 100}%` }}>
                        {tick.label}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="trends-system-note">未有足夠快照資料</p>
              )}
            </div>
          </div>
        ) : selectedRange === '1d' ? (
          <p className="trends-system-note warning">今日快照待生成，收益暫不可用</p>
        ) : null}
      </section>

      <section className="card trends-calendar-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">收益日曆</p>
            <h2>收益日曆</h2>
          </div>
          <label className="trends-calendar-month-select">
            <span className="visually-hidden">選擇收益日曆月份</span>
            <select
              value={activeCalendarMonth}
              onChange={(event) => setSelectedCalendarMonth(event.target.value)}
              aria-label="選擇收益日曆月份"
            >
              {calendarMonthOptions.map((monthKey) => (
                <option key={monthKey} value={monthKey}>
                  {formatMonthChip(monthKey)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="trends-calendar-summary">
          當月收益{' '}
          <span className={monthlyCalendarPnLHKD >= 0 ? 'positive-text' : 'caution-text'}>
            {monthlyCalendarPnLHKD >= 0 ? '+' : ''}
            {formatCurrencyRounded(
              convertCurrency(monthlyCalendarPnLHKD, 'HKD', displayCurrency),
              displayCurrency,
            )}{' '}
            ({formatPercent(
              selectedCalendarMonthStartValueHKD === 0
                ? 0
                : (monthlyCalendarPnLHKD / selectedCalendarMonthStartValueHKD) * 100,
            )})
          </span>
        </p>

        <div className="trends-calendar-weekdays">
          {['日', '一', '二', '三', '四', '五', '六'].map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="trends-calendar-grid">
          {calendarGrid.map((cell, index) => {
            if (!cell.dateKey || !cell.day) {
              return <div key={`blank-${index}`} className="trends-calendar-cell empty" />;
            }

            const entry = calendarMap.get(cell.dateKey);
            const change = entry ? convertCurrency(entry.changeHKD, 'HKD', displayCurrency) : 0;
            const tone = !entry || change === 0 ? 'neutral' : change > 0 ? 'positive' : 'caution';

            return (
              <div key={cell.dateKey} className={`trends-calendar-cell ${tone}`}>
                <strong>{cell.day}</strong>
                {entry ? <span>{formatCalendarChange(change)}</span> : <span className="trends-calendar-no-data">無資料</span>}
              </div>
            );
          })}
        </div>

        {status === 'loading' ? <p className="trends-system-note">同步中</p> : null}
      </section>
    </div>
  );
}
