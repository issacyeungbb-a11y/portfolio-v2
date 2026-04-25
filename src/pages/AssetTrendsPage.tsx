import { useMemo, useState } from 'react';

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
    const inTenThousands = absolute / 10000;
    const rounded =
      inTenThousands >= 100 ? Math.round(inTenThousands).toString() : inTenThousands.toFixed(1).replace(/\.0$/, '');
    return `${sign}${rounded}萬`;
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
  const linePath = buildLinePath(
    trendSeries.map((point) => convertCurrency(point.totalValue, 'HKD', displayCurrency)),
    320,
    180,
  );
  const calendarEntries = buildCalendarEntries(history, todaySnapshotExists ? currentPoint : null, cashFlows);
  const calendarMap = new Map(calendarEntries.map((entry) => [entry.date, entry]));
  const calendarGrid = buildCalendarGrid(currentPoint.date);
  const monthlyCalendarPnLHKD = calendarEntries
    .filter((entry) => entry.date.startsWith(currentPoint.date.slice(0, 7)))
    .reduce((sum, entry) => sum + entry.changeHKD, 0);
  const latestSnapshot = [...history]
    .filter((point) => Boolean(point.capturedAt))
    .sort((left, right) => (left.capturedAt ?? '').localeCompare(right.capturedAt ?? ''))
    .slice(-1)[0];
  const latestSnapshotLabel = formatSnapshotHint(latestSnapshot?.capturedAt);
  const todaySnapshotLabel = !todaySnapshot.exists
    ? todaySnapshotError
      ? '今日快照 風險'
      : '今日快照 待補'
    : todaySnapshot.quality === 'fallback'
      ? '今日快照 部分完成'
      : '今日快照 完整';
  const todaySnapshotTone = !todaySnapshot.exists
    ? todaySnapshotError
      ? 'danger'
      : 'warning'
    : todaySnapshot.quality === 'fallback'
      ? 'warning'
      : 'success';
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '資產走勢',
      subtitle: '查看資產總值、收益走勢與月曆變化。',
      metaItems: [
        { label: '基準貨幣', value: 'HKD' },
        { label: '顯示貨幣', value: displayCurrency },
        { label: '最新快照', value: latestSnapshotLabel },
        { label: '總資產', value: formatCurrencyRounded(totalValue, displayCurrency) },
      ],
      statusItems: [
        {
          label: status === 'error' ? '同步失敗' : status === 'loading' ? '同步中' : '已同步',
          tone: status === 'error' ? 'danger' : status === 'loading' ? 'warning' : 'success',
        },
        {
          label: todaySnapshotLabel,
          tone: todaySnapshotTone,
        },
        {
          label: `本月收益 ${formatPercent(monthlyReturnPct)}`,
          tone: monthlyReturnHKD >= 0 ? 'success' : 'warning',
          title: '按顯示幣別計算',
        },
      ],
      actions: <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />,
    }),
    [
      displayCurrency,
      latestSnapshotLabel,
      monthlyReturnHKD,
      monthlyReturnPct,
      setDisplayCurrency,
      status,
      todaySnapshotLabel,
      todaySnapshotTone,
      todaySnapshotError,
      totalValue,
    ],
  );

  useTopBar(topBarConfig);

  return (
    <div className="page-stack">
      {error ? <p className="status-message status-message-error">{error}</p> : null}
      {snapshotsError ? <p className="status-message status-message-error">{snapshotsError}</p> : null}
      {todaySnapshotError ? <p className="status-message status-message-error">{todaySnapshotError}</p> : null}
      {cashFlowsError ? <p className="status-message status-message-error">{cashFlowsError}</p> : null}
      {principalsError ? <p className="status-message status-message-error">{principalsError}</p> : null}

      <section className="card trends-overview-card">
        <div className="trends-toolbar">
          <div>
            <p className="eyebrow">資產走勢</p>
            <h2>資產總覽</h2>
            <p className="table-hint">以同一個顯示幣別查看總值、收益與月曆變化。</p>
          </div>
        </div>

        <div className="trends-hero-stat">
          <span>總資產估值</span>
          <strong>{formatCurrencyRounded(totalValue, displayCurrency)}</strong>
          <p>
            今日收益{' '}
            <span className={todaySummary ? (todaySummary.totalChange >= 0 ? 'positive-text' : 'caution-text') : 'table-hint'}>
              {todaySummary
                ? `${todaySummary.totalChange >= 0 ? '+' : ''}${formatCurrencyRounded(
                    convertCurrency(todaySummary.totalChange, 'HKD', displayCurrency),
                    displayCurrency,
                  )} (${formatPercent(todaySummary.returnPct)})`
                : '今日快照待生成，收益暫不可用'}
            </span>
          </p>
        </div>

        <div className="trends-overview-grid">
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
        </div>
        <p className="trends-calendar-summary">
          額外投入/提取{' '}
          <span className={netExternalFlowTotalHKD >= 0 ? 'positive-text' : 'caution-text'}>
            {netExternalFlowTotalHKD >= 0 ? '+' : ''}
            {formatCurrencyRounded(
              convertCurrency(netExternalFlowTotalHKD, 'HKD', displayCurrency),
              displayCurrency,
            )}
          </span>
        </p>
        <p className="trends-snapshot-hint">
          最新快照：{latestSnapshotLabel}。資產走勢數據以該次快照為基準。
        </p>
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
            <div className="trends-reveal-summary">
              <span>{trendRanges.find((entry) => entry.value === selectedRange)?.label}變動</span>
              <strong className={rangeSummary.totalChange >= 0 ? 'positive-text' : 'caution-text'}>
                {rangeSummary.totalChange >= 0 ? '+' : ''}
                {formatCurrencyRounded(
                  convertCurrency(rangeSummary.totalChange, 'HKD', displayCurrency),
                  displayCurrency,
                )}
              </strong>
              <small>{formatPercent(rangeSummary.returnPct)}</small>
            </div>

            <div className="trends-overview-grid">
              <div className="trends-overview-mini">
                <span>市場變動</span>
                <strong className={rangeSummary.marketChange >= 0 ? 'positive-text' : 'caution-text'}>
                  {rangeSummary.marketChange >= 0 ? '+' : ''}
                  {formatCurrencyRounded(
                    convertCurrency(rangeSummary.marketChange, 'HKD', displayCurrency),
                    displayCurrency,
                  )}
                </strong>
                <small>
                  額外投入/提取{' '}
                  {`${rangeSummary.netExternalFlow >= 0 ? '+' : ''}${formatCurrencyRounded(
                    convertCurrency(rangeSummary.netExternalFlow, 'HKD', displayCurrency),
                    displayCurrency,
                  )}`}
                </small>
              </div>
            </div>

            <div className="trends-chart-shell">
              {trendSeries.length > 1 ? (
                <div className="trends-chart-annotated">
                  <div className="trends-chart-y-labels">
                    <span>{formatCurrencyRounded(convertCurrency(Math.max(...trendSeries.map((point) => point.totalValue)), 'HKD', displayCurrency), displayCurrency)}</span>
                    <span>{formatCurrencyRounded(convertCurrency(Math.min(...trendSeries.map((point) => point.totalValue)), 'HKD', displayCurrency), displayCurrency)}</span>
                  </div>
                  <svg viewBox="0 0 320 180" className="trends-line-chart" role="img" aria-label="資產走勢圖">
                    <path d={linePath} />
                  </svg>
                  <div className="trends-chart-x-labels">
                    <span>{trendSeries[0].date.slice(5)}</span>
                    <span>{trendSeries[trendSeries.length - 1].date.slice(5)}</span>
                  </div>
                </div>
              ) : (
                <p className="status-message">未有足夠快照資料</p>
              )}
            </div>
          </div>
        ) : selectedRange === '1d' ? (
          <p className="status-message">今日快照待生成，收益暫不可用</p>
        ) : null}
      </section>

      <section className="card trends-calendar-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">收益日曆</p>
            <h2>收益日曆</h2>
          </div>
          <span className="chip chip-soft">{formatMonthChip(currentPoint.date.slice(0, 7))}</span>
        </div>

        <p className="trends-calendar-summary">
          當月收益{' '}
          <span className={monthlyCalendarPnLHKD >= 0 ? 'positive-text' : 'caution-text'}>
            {monthlyCalendarPnLHKD >= 0 ? '+' : ''}
            {formatCurrencyRounded(
              convertCurrency(monthlyCalendarPnLHKD, 'HKD', displayCurrency),
              displayCurrency,
            )}{' '}
            ({formatPercent(monthStartValueHKD === 0 ? 0 : (monthlyCalendarPnLHKD / monthStartValueHKD) * 100)})
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
                {entry ? <span>{formatCalendarChange(change)}</span> : null}
              </div>
            );
          })}
        </div>

        {status === 'loading' ? <p className="status-message">同步中</p> : null}
      </section>
    </div>
  );
}
