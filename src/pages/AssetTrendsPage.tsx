import { useState } from 'react';

import {
  convertCurrency,
  formatCurrencyRounded,
  formatPercent,
} from '../data/mockPortfolio';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAssetTransactions } from '../hooks/useAssetTransactions';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePortfolioSnapshots } from '../hooks/usePortfolioSnapshots';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import {
  calculateAssetChangeSummary,
  createCurrentPortfolioPoint,
} from '../lib/portfolio/assetChange';
import type {
  AccountCashFlowEntry,
  DisplayCurrency,
  PortfolioPerformancePoint,
} from '../types/portfolio';

type TrendRange = '1d' | '7d' | '30d';

const trendRanges: Array<{ value: TrendRange; label: string }> = [
  { value: '1d', label: '今日' },
  { value: '7d', label: '7日' },
  { value: '30d', label: '30日' },
];

function getSignedCashFlowAmount(entry: Pick<AccountCashFlowEntry, 'type' | 'amount'>) {
  if (entry.type === 'withdrawal') {
    return -Math.abs(entry.amount);
  }

  return entry.amount;
}

function parseDateKey(date: string) {
  return new Date(`${date}T00:00:00+08:00`);
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
  currentPoint: PortfolioPerformancePoint,
  cashFlows: AccountCashFlowEntry[],
) {
  const byDate = [...history, currentPoint]
    .sort((left, right) => left.date.localeCompare(right.date))
    .reduce<Map<string, PortfolioPerformancePoint>>((map, point) => {
      map.set(point.date, point);
      return map;
    }, new Map());
  const points = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const cashFlowByDate = cashFlows.reduce<Map<string, number>>((map, entry) => {
    const current = map.get(entry.date) ?? 0;
    map.set(entry.date, current + convertCurrency(getSignedCashFlowAmount(entry), entry.currency, 'HKD'));
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
    (sum, entry) => sum + convertCurrency(getSignedCashFlowAmount(entry), entry.currency, 'HKD'),
    0,
  );
}

export function AssetTrendsPage() {
  const { holdings: firestoreHoldings, status, error } = usePortfolioAssets();
  const { history, error: snapshotsError } = usePortfolioSnapshots();
  const { entries: cashFlows, error: cashFlowsError } = useAccountCashFlows();
  const { entries: assetTransactions, error: transactionsError } = useAssetTransactions();
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('HKD');
  const [selectedRange, setSelectedRange] = useState<TrendRange | null>(null);

  const holdings = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => convertCurrency(holding.quantity * holding.currentPrice, holding.currency, 'HKD'),
  );
  const currentPoint = createCurrentPortfolioPoint(holdings);
  const totalValue = convertCurrency(currentPoint.totalValue, 'HKD', displayCurrency);
  const currentUnrealizedPnlHKD = holdings.reduce(
    (sum, holding) =>
      sum +
      convertCurrency(
        holding.quantity * (holding.currentPrice - holding.averageCost),
        holding.currency,
        'HKD',
      ),
    0,
  );
  const realizedPnlTotalHKD = assetTransactions.reduce(
    (sum, entry) => sum + entry.realizedPnlHKD,
    0,
  );
  const netExternalFlowTotalHKD = sumSignedCashFlowsHKD(cashFlows);
  const monthStartDate = `${currentPoint.date.slice(0, 7)}-01`;
  const monthlySnapshot = history
    .filter((point) => point.date >= monthStartDate)
    .sort((left, right) => left.date.localeCompare(right.date))[0];
  const monthStartValueHKD = monthlySnapshot?.totalValue ?? currentPoint.totalValue;
  const monthFlowsHKD = cashFlows.reduce((sum, entry) => {
    if (!entry.date.startsWith(currentPoint.date.slice(0, 7))) {
      return sum;
    }

    return sum + convertCurrency(getSignedCashFlowAmount(entry), entry.currency, 'HKD');
  }, 0);
  const todaySummary = calculateAssetChangeSummary(history, currentPoint, cashFlows, '1d');
  const rangeSummary =
    selectedRange != null
      ? calculateAssetChangeSummary(history, currentPoint, cashFlows, selectedRange)
      : null;
  const realizedRangeHKD =
    selectedRange && rangeSummary
      ? assetTransactions
          .filter((entry) => entry.date > rangeSummary.startDate && entry.date <= rangeSummary.endDate)
          .reduce((sum, entry) => sum + entry.realizedPnlHKD, 0)
      : 0;
  const unrealizedRangeHKD = rangeSummary ? rangeSummary.marketChange - realizedRangeHKD : 0;
  const trendSeries = selectedRange ? buildTrendSeries(history, currentPoint, selectedRange) : [];
  const linePath = buildLinePath(
    trendSeries.map((point) => convertCurrency(point.totalValue, 'HKD', displayCurrency)),
    320,
    180,
  );
  const calendarEntries = buildCalendarEntries(history, currentPoint, cashFlows);
  const calendarMap = new Map(calendarEntries.map((entry) => [entry.date, entry]));
  const calendarGrid = buildCalendarGrid(currentPoint.date);
  const monthlyCalendarPnLHKD = calendarEntries
    .filter((entry) => entry.date.startsWith(currentPoint.date.slice(0, 7)))
    .reduce((sum, entry) => sum + entry.changeHKD, 0);

  return (
    <div className="page-stack">
      {error ? <p className="status-message status-message-error">{error}</p> : null}
      {snapshotsError ? <p className="status-message status-message-error">{snapshotsError}</p> : null}
      {cashFlowsError ? <p className="status-message status-message-error">{cashFlowsError}</p> : null}
      {transactionsError ? <p className="status-message status-message-error">{transactionsError}</p> : null}

      <section className="card trends-overview-card">
        <div className="trends-toolbar">
          <div>
            <p className="eyebrow">Asset Trends</p>
            <h2>資產總覽</h2>
          </div>
          <div className="currency-toggle" role="group" aria-label="選擇顯示貨幣">
            <button
              className={displayCurrency === 'HKD' ? 'currency-toggle-button active' : 'currency-toggle-button'}
              type="button"
              onClick={() => setDisplayCurrency('HKD')}
            >
              HKD
            </button>
            <button
              className={displayCurrency === 'USD' ? 'currency-toggle-button active' : 'currency-toggle-button'}
              type="button"
              onClick={() => setDisplayCurrency('USD')}
            >
              USD
            </button>
            <button
              className={displayCurrency === 'JPY' ? 'currency-toggle-button active' : 'currency-toggle-button'}
              type="button"
              onClick={() => setDisplayCurrency('JPY')}
            >
              JPY
            </button>
          </div>
        </div>

        <div className="trends-hero-stat">
          <span>總資產估值</span>
          <strong>{formatCurrencyRounded(totalValue, displayCurrency)}</strong>
          <p>
            今日收益{' '}
            <span className={todaySummary && todaySummary.totalChange >= 0 ? 'positive-text' : 'caution-text'}>
              {todaySummary
                ? `${todaySummary.totalChange >= 0 ? '+' : ''}${formatCurrencyRounded(
                    convertCurrency(todaySummary.totalChange, 'HKD', displayCurrency),
                    displayCurrency,
                  )} (${formatPercent(todaySummary.returnPct)})`
                : '未有足夠資料'}
            </span>
          </p>
        </div>

        <div className="trends-overview-grid">
          <div className="trends-overview-mini">
            <span>已實現盈虧</span>
            <strong className={realizedPnlTotalHKD >= 0 ? 'positive-text' : 'caution-text'}>
              {realizedPnlTotalHKD >= 0 ? '+' : ''}
              {formatCurrencyRounded(convertCurrency(realizedPnlTotalHKD, 'HKD', displayCurrency), displayCurrency)}
            </strong>
            <small>來自賣出交易</small>
          </div>
          <div className="trends-overview-mini">
            <span>未實現盈虧</span>
            <strong className={currentUnrealizedPnlHKD >= 0 ? 'positive-text' : 'caution-text'}>
              {currentUnrealizedPnlHKD >= 0 ? '+' : ''}
              {formatCurrencyRounded(
                convertCurrency(currentUnrealizedPnlHKD, 'HKD', displayCurrency),
                displayCurrency,
              )}
            </strong>
            <small>現有持倉浮動盈虧</small>
          </div>
          <div className="trends-overview-mini">
            <span>淨入金影響</span>
            <strong className={netExternalFlowTotalHKD >= 0 ? 'positive-text' : 'caution-text'}>
              {netExternalFlowTotalHKD >= 0 ? '+' : ''}
              {formatCurrencyRounded(
                convertCurrency(netExternalFlowTotalHKD, 'HKD', displayCurrency),
                displayCurrency,
              )}
            </strong>
            <small>全部資金流水累計</small>
          </div>
        </div>
      </section>

      <section className="card trends-chart-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Asset Trends</p>
            <h2>資產走勢</h2>
          </div>
          <span className="chip chip-soft">{currentPoint.date}</span>
        </div>

        <div className="trends-range-row" role="tablist" aria-label="資產走勢期間">
          {trendRanges.map((range) => (
            <button
              key={range.value}
              className={selectedRange === range.value ? 'filter-chip active' : 'filter-chip'}
              type="button"
              onClick={() => setSelectedRange((current) => (current === range.value ? null : range.value))}
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
                <span>已實現盈虧</span>
                <strong className={realizedRangeHKD >= 0 ? 'positive-text' : 'caution-text'}>
                  {realizedRangeHKD >= 0 ? '+' : ''}
                  {formatCurrencyRounded(convertCurrency(realizedRangeHKD, 'HKD', displayCurrency), displayCurrency)}
                </strong>
                <small>賣出交易</small>
              </div>
              <div className="trends-overview-mini">
                <span>未實現盈虧</span>
                <strong className={unrealizedRangeHKD >= 0 ? 'positive-text' : 'caution-text'}>
                  {unrealizedRangeHKD >= 0 ? '+' : ''}
                  {formatCurrencyRounded(convertCurrency(unrealizedRangeHKD, 'HKD', displayCurrency), displayCurrency)}
                </strong>
                <small>價格與持倉變動</small>
              </div>
              <div className="trends-overview-mini">
                <span>淨入金影響</span>
                <strong className={rangeSummary.netExternalFlow >= 0 ? 'positive-text' : 'caution-text'}>
                  {rangeSummary.netExternalFlow >= 0 ? '+' : ''}
                  {formatCurrencyRounded(
                    convertCurrency(rangeSummary.netExternalFlow, 'HKD', displayCurrency),
                    displayCurrency,
                  )}
                </strong>
                <small>入金 / 提款 / 調整</small>
              </div>
            </div>

            <div className="trends-chart-shell">
              {trendSeries.length > 1 ? (
                <svg viewBox="0 0 320 180" className="trends-line-chart" role="img" aria-label="資產走勢圖">
                  <path d={linePath} />
                </svg>
              ) : (
                <p className="status-message">未有足夠快照資料。</p>
              )}
            </div>
          </div>
        ) : (
          <p className="status-message">撳「今日 / 7日 / 30日」先展開對應變動。</p>
        )}
      </section>

      <section className="card trends-calendar-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Profit Calendar</p>
            <h2>收益日曆</h2>
          </div>
          <span className="chip chip-soft">{currentPoint.date.slice(0, 7)}</span>
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

        {status === 'loading' ? <p className="status-message">同步中。</p> : null}
      </section>
    </div>
  );
}
