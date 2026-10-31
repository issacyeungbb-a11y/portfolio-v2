import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { FinanceLineChart } from '../components/charts/FinanceChart';
import { CurrencyToggle } from '../components/ui/CurrencyToggle';
import {
  convertCurrency,
  formatCurrencyRounded,
  formatPercent,
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
import {
  buildAccountPrincipalOverview,
  buildCalendarEntries,
  buildPerformanceOverview,
  buildPeriodTrend,
  getAvailableTrendPeriods,
  summarizeCalendarMonth,
  trendPeriodOptions,
  type TrendPeriod,
} from '../lib/portfolio/overviewSelectors';

const weekdayLabels = ['日', '一', '二', '三', '四', '五', '六'];

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

function getToneClass(value: number) {
  if (value > 0) return 'gain-text';
  if (value < 0) return 'loss-text';
  return '';
}

function formatSignedMoney(value: number, currency: string) {
  const absolute = formatCurrencyRounded(Math.abs(value), currency);
  if (Math.round(value) === 0) return absolute;
  return `${value > 0 ? '+' : '-'}${absolute}`;
}

function buildCalendarGrid(dateKey: string) {
  // 直接用日期字串計，唔經瀏覽器時區，否則喺香港以外時區會計錯星期同日數。
  const year = Number(dateKey.slice(0, 4));
  const month = Number(dateKey.slice(5, 7)) - 1;
  const firstWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
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
  const rounded = Math.round(value);
  if (rounded === 0) {
    return '0';
  }

  const sign = rounded > 0 ? '+' : '-';
  const absolute = Math.abs(rounded);

  if (absolute >= 10000) {
    return `${sign}${(absolute / 10000).toFixed(absolute >= 1_000_000 ? 0 : 1)}萬`;
  }

  return `${sign}${absolute.toLocaleString('en-US')}`;
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

function formatAxisDate(dateKey: string, longSpan: boolean) {
  return longSpan ? `${dateKey.slice(0, 4)}/${dateKey.slice(5, 7)}` : `${dateKey.slice(5, 7)}/${dateKey.slice(8, 10)}`;
}

export function AssetTrendsPage() {
  const { holdings: firestoreHoldings, status, error } = usePortfolioAssets();
  const { history, error: snapshotsError } = usePortfolioSnapshots();
  const { todaySnapshot, error: todaySnapshotError } = useTodaySnapshotStatus();
  const { entries: cashFlows, error: cashFlowsError } = useAccountCashFlows();
  const { entries: principals, error: principalsError } = useAccountPrincipals();
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  const [selectedPeriod, setSelectedPeriod] = useState<TrendPeriod>('1m');
  const [selectedCalendarMonth, setSelectedCalendarMonth] = useState<string | null>(null);

  const holdings = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => convertCurrency(holding.quantity * holding.currentPrice, holding.currency, 'HKD'),
  );
  const currentPoint = createCurrentPortfolioPoint(holdings);
  const todaySnapshotExists = todaySnapshot.exists;
  const toDisplay = (valueHKD: number) => convertCurrency(valueHKD, 'HKD', displayCurrency);
  const money = (valueHKD: number) => formatCurrencyRounded(toDisplay(valueHKD), displayCurrency);
  const signedMoney = (valueHKD: number) => formatSignedMoney(toDisplay(valueHKD), displayCurrency);
  const fundsOverview = buildAccountPrincipalOverview(principals, cashFlows, currentPoint.date);
  const performanceOverview = buildPerformanceOverview({
    history,
    currentPoint,
    cashFlows,
    principals,
    todaySnapshotExists,
  });
  const netExternalFlowTotalHKD = fundsOverview.netExternalFlowHKD;
  const historicalReturnHKD = performanceOverview.historicalReturnHKD;
  const historicalReturnPct = performanceOverview.historicalReturnPct;
  const monthly = performanceOverview.monthly;
  const todaySummary = calculateAssetChangeSummary(
    history,
    currentPoint,
    cashFlows,
    '1d',
    todaySnapshotExists,
  );

  const availablePeriods = getAvailableTrendPeriods(history, currentPoint);
  const activePeriod: TrendPeriod | null = availablePeriods.includes(selectedPeriod)
    ? selectedPeriod
    : availablePeriods.includes('all')
      ? 'all'
      : null;
  const periodTrend = activePeriod ? buildPeriodTrend(history, currentPoint, cashFlows, activePeriod) : null;
  const trendSeries = periodTrend?.series ?? [];
  const trendValues = trendSeries.map((point) => toDisplay(point.totalValue));
  const longSpan = trendSeries.length > 1 &&
    Number(trendSeries[trendSeries.length - 1].date.slice(0, 4)) * 12 + Number(trendSeries[trendSeries.length - 1].date.slice(5, 7)) -
      (Number(trendSeries[0].date.slice(0, 4)) * 12 + Number(trendSeries[0].date.slice(5, 7))) > 9;
  const periodTone = !periodTrend || Math.round(periodTrend.marketChange) === 0
    ? 'neutral'
    : periodTrend.marketChange > 0 ? 'gain' : 'loss';

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
  const activeCalendarMonthIndex = calendarMonthOptions.indexOf(activeCalendarMonth);
  const calendarGrid = buildCalendarGrid(`${activeCalendarMonth}-01`);
  const calendarSummary = summarizeCalendarMonth(calendarEntries, activeCalendarMonth);
  const calendarMaxAbsHKD = Math.max(
    1,
    ...calendarEntries
      .filter((entry) => getMonthKey(entry.date) === activeCalendarMonth)
      .map((entry) => Math.abs(entry.changeHKD)),
  );

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
    <div className="page-stack trends-page">
      <div className="trends-alert-stack" aria-live="polite">
        {error ? <p className="trends-system-note error">{error}</p> : null}
        {snapshotsError ? <p className="trends-system-note error">{snapshotsError}</p> : null}
        {todaySnapshotError ? <p className="trends-system-note error">{todaySnapshotError}</p> : null}
        {cashFlowsError ? <p className="trends-system-note error">{cashFlowsError}</p> : null}
        {principalsError ? <p className="trends-system-note error">{principalsError}</p> : null}
      </div>

      <section className="card trends-summary-card" aria-label="資產總覽">
        <div className="trends-summary-head">
          <div className="trends-summary-total">
            <span className="trends-eyebrow">總資產估值</span>
            <strong>{money(currentPoint.totalValue)}</strong>
            {todaySummary ? (
              <span className={`trends-change-pill ${getToneClass(todaySummary.marketChange)}`}>
                今日 {signedMoney(todaySummary.marketChange)}
                <em>{formatPercent(todaySummary.returnPct)}</em>
              </span>
            ) : (
              <span className="trends-change-pill">今日快照待生成，收益暫不可用</span>
            )}
          </div>
          <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
        </div>

        <dl className="trends-metric-strip">
          <div>
            <dt>本月收益</dt>
            {monthly ? (
              <dd>
                <strong className={getToneClass(monthly.marketChange)}>{signedMoney(monthly.marketChange)}</strong>
                <small>{formatPercent(monthly.returnPct)} · 由 {formatDateChip(monthly.startDate)} 收市起計</small>
              </dd>
            ) : (
              <dd><strong>—</strong><small>未有月初快照</small></dd>
            )}
          </div>
          <div>
            <dt>累計收益</dt>
            <dd>
              <strong className={getToneClass(historicalReturnHKD)}>{signedMoney(historicalReturnHKD)}</strong>
              <small>{formatPercent(historicalReturnPct)} · 總值減累計本金</small>
            </dd>
          </div>
          <div>
            <dt>累計淨投入</dt>
            <dd>
              <strong className="flow-text">{signedMoney(netExternalFlowTotalHKD)}</strong>
              <small>入金減提取 · 不計作收益</small>
            </dd>
          </div>
        </dl>

        <p className="trends-snapshot-line">
          最新快照 {latestSnapshotLabel}
          {latestSnapshotIsFallback ? <em>備援快照</em> : null}
        </p>
      </section>

      <section className="card trends-chart-card">
        <div className="trends-chart-head">
          <div>
            <h2>期間表現</h2>
            {periodTrend ? (
              <p className="trends-caption">
                {formatDateChip(periodTrend.startDate)} 收市 至 {formatDateChip(periodTrend.endDate)}
              </p>
            ) : null}
          </div>
          {availablePeriods.length > 0 ? (
            <div className="trends-period-switch" role="group" aria-label="資產走勢期間">
              {trendPeriodOptions
                .filter((option) => availablePeriods.includes(option.value))
                .map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    className={activePeriod === option.value ? 'active' : ''}
                    aria-pressed={activePeriod === option.value}
                    onClick={() => setSelectedPeriod(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
            </div>
          ) : null}
        </div>

        {periodTrend ? (
          <>
            <div className="trends-period-headline">
              <div>
                <span>區間收益（已扣除資金流）</span>
                <strong className={getToneClass(periodTrend.marketChange)}>{signedMoney(periodTrend.marketChange)}</strong>
                <em className={getToneClass(periodTrend.marketChange)}>{formatPercent(periodTrend.returnPct)}</em>
              </div>
            </div>

            <FinanceLineChart
              labels={trendSeries.map((point) => formatAxisDate(point.date, longSpan))}
              tooltipTitles={trendSeries.map((point) => formatDateChip(point.date))}
              series={[{ id: 'total', label: '總資產', values: trendValues, variant: 'primary' }]}
              tone={periodTone}
              baseline={trendValues[0] ?? null}
              formatValue={(value) => formatCurrencyRounded(value, displayCurrency)}
              ariaLabel={`資產走勢圖，${trendPeriodOptions.find((option) => option.value === activePeriod)?.label ?? ''}`}
              renderTooltip={(index) => {
                const value = trendValues[index];
                const fromStart = value - trendValues[0];
                const fromPrevious = index > 0 ? value - trendValues[index - 1] : 0;
                return (
                  <>
                    <strong>{formatCurrencyRounded(value, displayCurrency)}</strong>
                    <span className={getToneClass(fromPrevious)}>較上一日 {formatSignedMoney(fromPrevious, displayCurrency)}</span>
                    <span className={getToneClass(fromStart)}>較期初 {formatSignedMoney(fromStart, displayCurrency)}</span>
                  </>
                );
              }}
            />

            <dl className="trends-bridge" aria-label="期初至期末拆解">
              <div>
                <dt>期初估值</dt>
                <dd>{money(periodTrend.startValue)}</dd>
              </div>
              <span aria-hidden="true">＋</span>
              <div>
                <dt>市場變動</dt>
                <dd className={getToneClass(periodTrend.marketChange)}>{signedMoney(periodTrend.marketChange)}</dd>
              </div>
              <span aria-hidden="true">＋</span>
              <div>
                <dt>資金流</dt>
                <dd className="flow-text">{signedMoney(periodTrend.netExternalFlow)}</dd>
              </div>
              <span aria-hidden="true">＝</span>
              <div>
                <dt>期末估值</dt>
                <dd>{money(periodTrend.endValue)}</dd>
              </div>
            </dl>
            <p className="trends-caption">虛線為期初估值；線色按區間收益（綠升紅跌）。資金流即入金及提取，不計作收益。</p>
          </>
        ) : (
          <p className="trends-system-note">未有足夠快照資料，最少需要兩日快照先可以顯示走勢。</p>
        )}
      </section>

      <section className="card trends-calendar-card">
        <div className="trends-chart-head">
          <div>
            <h2>收益日曆</h2>
            <p className="trends-caption">每日市場變動，已扣除當日入金及提取</p>
          </div>
          <div className="trends-month-nav">
            <button
              type="button"
              aria-label="上一個月"
              disabled={activeCalendarMonthIndex >= calendarMonthOptions.length - 1}
              onClick={() => setSelectedCalendarMonth(calendarMonthOptions[activeCalendarMonthIndex + 1])}
            >
              ‹
            </button>
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
            <button
              type="button"
              aria-label="下一個月"
              disabled={activeCalendarMonthIndex <= 0}
              onClick={() => setSelectedCalendarMonth(calendarMonthOptions[activeCalendarMonthIndex - 1])}
            >
              ›
            </button>
          </div>
        </div>

        <dl className="trends-calendar-stats">
          <div>
            <dt>當月收益</dt>
            <dd className={getToneClass(calendarSummary.pnlHKD)}>
              {signedMoney(calendarSummary.pnlHKD)} <small>{formatPercent(calendarSummary.returnPct)}</small>
            </dd>
          </div>
          <div>
            <dt>升／跌日數</dt>
            <dd>
              <span className="gain-text">{calendarSummary.gainDays}</span>
              {' ／ '}
              <span className="loss-text">{calendarSummary.lossDays}</span>
            </dd>
          </div>
          <div>
            <dt>最佳一日</dt>
            <dd className={calendarSummary.best ? 'gain-text' : ''}>
              {calendarSummary.best ? `${Number(calendarSummary.best.date.slice(8))}日 ${signedMoney(calendarSummary.best.changeHKD)}` : '—'}
            </dd>
          </div>
          <div>
            <dt>最差一日</dt>
            <dd className={calendarSummary.worst ? 'loss-text' : ''}>
              {calendarSummary.worst ? `${Number(calendarSummary.worst.date.slice(8))}日 ${signedMoney(calendarSummary.worst.changeHKD)}` : '—'}
            </dd>
          </div>
        </dl>

        <div className="trends-calendar-weekdays" aria-hidden="true">
          {weekdayLabels.map((label) => (
            <span key={label}>{label}</span>
          ))}
        </div>

        <div className="trends-calendar-grid">
          {calendarGrid.map((cell, index) => {
            if (!cell.dateKey || !cell.day) {
              return <div key={`blank-${index}`} className="trends-calendar-cell empty" aria-hidden="true" />;
            }

            const entry = calendarMap.get(cell.dateKey);
            const isFuture = cell.dateKey > currentPoint.date;
            const change = entry ? toDisplay(entry.changeHKD) : 0;
            const tone = !entry || Math.round(change) === 0 ? 'flat' : change > 0 ? 'gain' : 'loss';
            const heat = entry ? Math.min(1, Math.abs(entry.changeHKD) / calendarMaxAbsHKD) : 0;

            return (
              <div
                key={cell.dateKey}
                className={`trends-calendar-cell ${tone}${isFuture ? ' future' : ''}${cell.dateKey === currentPoint.date ? ' today' : ''}`}
                style={{ '--heat': heat.toFixed(2) } as CSSProperties}
                title={entry ? `${formatDateChip(cell.dateKey)}：${formatSignedMoney(change, displayCurrency)}` : undefined}
              >
                <strong>{cell.day}</strong>
                {entry ? <span>{formatCalendarChange(change)}</span> : !isFuture ? <span className="trends-calendar-no-data">—</span> : null}
              </div>
            );
          })}
        </div>

        <div className="trends-heat-legend" aria-hidden="true">
          <span>跌</span>
          <i style={{ '--heat': '1' } as CSSProperties} className="loss" />
          <i style={{ '--heat': '0.4' } as CSSProperties} className="loss" />
          <i className="flat" />
          <i style={{ '--heat': '0.4' } as CSSProperties} className="gain" />
          <i style={{ '--heat': '1' } as CSSProperties} className="gain" />
          <span>升</span>
          <small>顏色深淺按當月最大單日變動比例</small>
        </div>

        {status === 'loading' ? <p className="trends-system-note">同步中</p> : null}
      </section>
    </div>
  );
}
