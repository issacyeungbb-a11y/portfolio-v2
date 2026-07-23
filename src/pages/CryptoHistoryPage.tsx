import { useMemo, useState } from 'react';

import { CryptoAllocationPanel } from '../components/crypto/CryptoAllocationPanel';
import { CryptoHistoryTrendChart } from '../components/crypto/CryptoHistoryTrendChart';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { StatusMessages } from '../components/ui/StatusMessages';
import { useCryptoHistory } from '../hooks/useCryptoHistory';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import {
  filterCryptoSnapshots,
  getCryptoHistoryYears,
  getCryptoSnapshotQualityLabel,
  getCryptoSnapshotQualityTone,
  getCryptoSourceLabel,
  type CryptoHistoryYearFilter,
} from '../lib/cryptoHistory';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import type { CryptoMonthlySnapshot } from '../types/cryptoHistory';

type TrendCurrency = 'HKD' | 'USD';

interface CryptoSyncPreview {
  ok: boolean;
  mode: 'preview' | 'apply';
  runId?: string;
  sourceReadOnly: boolean;
  sourceChecksum: string;
  detectedMonthCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  warningCount: number;
  warningSummary: Record<string, number>;
  createCount: number;
  skipCount: number;
  conflictCount: number;
  creates: string[];
  skips: string[];
  conflicts: Array<{
    month: string;
    differingFields: string[];
  }>;
}

function money(value: number, currency: TrendCurrency) {
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
    maximumFractionDigits: 2,
    signDisplay: 'exceptZero',
  }).format(value);
}

function number(value: number | null, maximumFractionDigits = 4) {
  if (value == null) return '—';
  return new Intl.NumberFormat('zh-HK', {
    maximumFractionDigits,
  }).format(value);
}

function formatDateTime(value: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-HK', {
    timeZone: 'Asia/Hong_Kong',
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function KpiCard({
  label,
  value,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  hint: string;
  tone?: 'neutral' | 'positive' | 'negative';
}) {
  return (
    <article className="summary-card crypto-kpi">
      <span className="summary-label">{label}</span>
      <strong data-tone={tone}>{value}</strong>
      <small>{hint}</small>
    </article>
  );
}

function SnapshotDetails({ snapshot }: { snapshot: CryptoMonthlySnapshot }) {
  const hasLiabilities = snapshot.liabilities.length > 0;

  return (
    <section className="card crypto-detail-card" id="crypto-month-detail">
      <div className="section-heading">
        <div>
          <p className="eyebrow">月份詳細資料</p>
          <h2>{snapshot.month}</h2>
        </div>
        <StatusBadge
          label={getCryptoSnapshotQualityLabel(snapshot.dataQuality)}
          tone={getCryptoSnapshotQualityTone(snapshot.dataQuality)}
        />
      </div>

      <div className="crypto-detail-grid">
        <div className="crypto-detail-block">
          <h3>平台及錢包</h3>
          {snapshot.historicalHoldings.length > 0 ? (
            <div className="crypto-detail-list">
              {snapshot.historicalHoldings.map((holding) => (
                <span key={holding.rawLabel}>
                  <span>
                    {holding.normalizedLabel}
                    {holding.rawLabel !== holding.normalizedLabel ? (
                      <small>原始：{holding.rawLabel}</small>
                    ) : null}
                  </span>
                  <strong>{money(holding.valueUsd, 'USD')}</strong>
                </span>
              ))}
            </div>
          ) : (
            <p className="status-message">原始月結沒有逐平台資料。</p>
          )}
        </div>

        <div className="crypto-detail-block">
          <h3>貨幣數量及價格</h3>
          {snapshot.historicalQuantities.length > 0 ? (
            <div className="crypto-detail-list">
              {snapshot.historicalQuantities.map((entry) => (
                <span key={entry.rawLabel}>
                  <span>
                    {entry.symbol}
                    {entry.platform ? <small>{entry.platform}</small> : null}
                  </span>
                  <strong>{number(entry.quantity, 8)}</strong>
                </span>
              ))}
            </div>
          ) : (
            <p className="status-message">原始月結沒有可確認的貨幣數量。</p>
          )}
          {snapshot.prices.length > 0 ? (
            <div className="crypto-price-chips">
              {snapshot.prices.map((entry) => (
                <span key={entry.rawLabel}>
                  {entry.symbol} <strong>{money(entry.priceUsd, 'USD')}</strong>
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <div className="crypto-detail-block">
          <h3>資產比例</h3>
          <CryptoAllocationPanel snapshot={snapshot} />
        </div>

        <div className="crypto-detail-block">
          <h3>負債</h3>
          {hasLiabilities ? (
            <div className="crypto-detail-list">
              {snapshot.liabilities.map((entry, index) => (
                <span key={`${entry.symbol ?? 'liability'}-${index}`}>
                  <span>{entry.symbol ?? '負債'}<small>{entry.platform ?? '未註明平台'}</small></span>
                  <strong>{number(entry.quantity ?? null, 8)}</strong>
                </span>
              ))}
            </div>
          ) : (
            <p className="status-message">
              原始月結沒有可獨立確認的負債明細；不會由平台總值自行推算。
            </p>
          )}
        </div>
      </div>

      <div className="crypto-source-panel">
        <div>
          <span>來源</span>
          <strong>{snapshot.sourceSheet}!{snapshot.sourceRange}</strong>
          <small>{getCryptoSourceLabel(snapshot.sourceType)} · 批次 {snapshot.importBatchId}</small>
        </div>
        <details>
          <summary>查看原始來源數值</summary>
          <pre>{JSON.stringify(snapshot.rawSourceValues, null, 2)}</pre>
        </details>
      </div>

      <div className="crypto-warning-list">
        <h3>資料警告</h3>
        {snapshot.warnings.length > 0 ? (
          snapshot.warnings.map((warning, index) => (
            <p key={`${warning.code}-${index}`} data-severity={warning.severity}>
              <strong>{warning.code}</strong>
              <span>{warning.message}</span>
            </p>
          ))
        ) : (
          <p className="compact-success-note">沒有資料警告。</p>
        )}
      </div>
    </section>
  );
}

export function CryptoHistoryPage() {
  const history = useCryptoHistory();
  const [year, setYear] = useState<CryptoHistoryYearFilter>('all');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [trendCurrency, setTrendCurrency] = useState<TrendCurrency>('HKD');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'previewing' | 'applying'>('idle');
  const [syncPreview, setSyncPreview] = useState<CryptoSyncPreview | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncMessageTone, setSyncMessageTone] = useState<'success' | 'warning'>('success');
  const years = useMemo(
    () => getCryptoHistoryYears(history.snapshots),
    [history.snapshots],
  );
  const filteredSnapshots = useMemo(
    () => filterCryptoSnapshots(history.snapshots, year),
    [history.snapshots, year],
  );
  const activeSnapshot =
    filteredSnapshots.find((snapshot) => snapshot.month === selectedMonth) ??
    filteredSnapshots[filteredSnapshots.length - 1] ??
    null;
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: 'Crypto 歷史',
      subtitle: '獨立查看 Google Sheet 鎖定月結，不計入現有投資組合快照。',
      primaryStatus:
        history.status === 'ready'
          ? { label: `${history.snapshots.length} 個月份`, tone: 'success' }
          : history.status === 'error'
            ? { label: '讀取失敗', tone: 'danger' }
            : { label: '載入中', tone: 'neutral' },
    }),
    [history.snapshots.length, history.status],
  );

  useTopBar(topBarConfig);

  const selectMonth = (month: string) => {
    setSelectedMonth(month);
    requestAnimationFrame(() => {
      document.getElementById('crypto-month-detail')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    });
  };

  const previewMonthlySync = async () => {
    setSyncStatus('previewing');
    setSyncMessage(null);
    try {
      const result = (await callPortfolioFunction('crypto-history-sync', {
        apply: false,
      })) as CryptoSyncPreview;
      setSyncPreview(result);
      setSyncMessageTone(result.conflictCount > 0 ? 'warning' : 'success');
      setSyncMessage(
        result.conflictCount > 0
          ? '發現已鎖定月份差異，已停止；不會覆蓋現有資料。'
          : result.createCount > 0
            ? `已找到 ${result.createCount} 個新月份，請核對後確認寫入。`
            : '月結記錄已同步，暫時沒有新月份需要寫入。',
      );
    } catch (error) {
      setSyncPreview(null);
      setSyncMessageTone('warning');
      setSyncMessage(error instanceof Error ? error.message : '未能檢查新月結。');
    } finally {
      setSyncStatus('idle');
    }
  };

  const applyMonthlySync = async () => {
    if (!syncPreview || syncPreview.createCount === 0 || syncPreview.conflictCount > 0) {
      return;
    }

    const confirmed = window.confirm(
      `確認將 ${syncPreview.createCount} 個新月份寫入獨立 Crypto 歷史集合？現有鎖定月份不會被覆蓋。`,
    );
    if (!confirmed) return;

    setSyncStatus('applying');
    setSyncMessage(null);
    try {
      const result = (await callPortfolioFunction('crypto-history-sync', {
        apply: true,
        confirmation: 'APPLY_CRYPTO_MONTHLY_SYNC',
        expectedSourceChecksum: syncPreview.sourceChecksum,
      })) as CryptoSyncPreview;
      setSyncPreview(result);
      setSyncMessageTone('success');
      setSyncMessage(`同步完成，已新增 ${result.createCount} 個月份。`);
      history.refresh();
    } catch (error) {
      setSyncMessageTone('warning');
      setSyncMessage(error instanceof Error ? error.message : '月結同步失敗。');
    } finally {
      setSyncStatus('idle');
    }
  };

  if (history.status === 'loading' && history.snapshots.length === 0) {
    return (
      <div className="page-stack crypto-history-page">
        <section className="card crypto-loading-card">
          <div className="skeleton skeleton-card" />
          <p>正在讀取獨立 Crypto 月結集合…</p>
        </section>
      </div>
    );
  }

  if (history.isEmpty) {
    return (
      <div className="page-stack crypto-history-page">
        <EmptyState
          title="尚未有 Crypto 歷史月結"
          reason="先執行 deterministic importer；頁面不會讀取 portfolioSnapshots 或即時持倉補數。"
        />
      </div>
    );
  }

  return (
    <div className="page-stack crypto-history-page">
      <StatusMessages errors={history.errors} />

      <section className="card crypto-history-toolbar">
        <div>
          <p className="eyebrow">只讀歷史</p>
          <p className="table-hint">
            來源 Google Sheet 維持唯讀；所有月份使用固定鍵及鎖定 checksum。
          </p>
        </div>
        <div className="crypto-filter-controls">
          <div className="crypto-year-selector" aria-label="年份篩選">
            {['all', ...years].map((option) => (
              <button
                key={option}
                type="button"
                className={year === option ? 'chip active' : 'chip'}
                aria-pressed={year === option}
                onClick={() => {
                  setYear(option);
                  setSelectedMonth(null);
                }}
              >
                {option === 'all' ? '全部' : option}
              </button>
            ))}
          </div>
          <label className="crypto-month-select">
            <span>月份</span>
            <select
              value={selectedMonth ?? ''}
              onChange={(event) => setSelectedMonth(event.target.value || null)}
            >
              <option value="">最新月份</option>
              {[...filteredSnapshots].reverse().map((snapshot) => (
                <option key={snapshot.id} value={snapshot.month}>
                  {snapshot.month}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      {activeSnapshot ? (
        <section className="crypto-kpi-grid" aria-label={`${activeSnapshot.month} 主要指標`}>
          <KpiCard
            label="月結總資產 HKD"
            value={money(activeSnapshot.totalHkd, 'HKD')}
            hint={activeSnapshot.month}
          />
          <KpiCard
            label="月結總資產 USD"
            value={money(activeSnapshot.performanceTotalUsd, 'USD')}
            hint="包括累計提取／消費"
          />
          <KpiCard
            label="現有資產淨值 USD"
            value={money(activeSnapshot.currentNetUsd, 'USD')}
            hint="正資產市值減負債"
          />
          <KpiCard
            label="本金 HKD"
            value={money(activeSnapshot.principalHkd, 'HKD')}
            hint="原始月結本金"
          />
          <KpiCard
            label="累計回報 HKD"
            value={money(activeSnapshot.returnHkd, 'HKD')}
            hint={`${percent(activeSnapshot.returnPct)} 回報率`}
            tone={activeSnapshot.returnHkd >= 0 ? 'positive' : 'negative'}
          />
          <KpiCard
            label="累計回報率"
            value={percent(activeSnapshot.returnPct)}
            hint={`上月變化 ${percent(activeSnapshot.monthOverMonthPct)}`}
            tone={activeSnapshot.returnPct >= 0 ? 'positive' : 'negative'}
          />
          <KpiCard
            label="累計提取／消費 USD"
            value={money(activeSnapshot.cumulativeWithdrawnUsd, 'USD')}
            hint="加入投資計算總值"
          />
          <KpiCard
            label="BTC 等值"
            value={number(activeSnapshot.btcEquivalent, 6)}
            hint={`匯率 ${number(activeSnapshot.usdHkdRate, 4)}`}
          />
        </section>
      ) : null}

      <section className="crypto-chart-grid">
        <article className="card crypto-chart-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">月度資產走勢</p>
              <h2>鎖定月結總值</h2>
            </div>
            <div className="crypto-currency-toggle" aria-label="走勢顯示貨幣">
              {(['HKD', 'USD'] as const).map((currency) => (
                <button
                  key={currency}
                  type="button"
                  className={trendCurrency === currency ? 'active' : ''}
                  aria-pressed={trendCurrency === currency}
                  onClick={() => setTrendCurrency(currency)}
                >
                  {currency}
                </button>
              ))}
            </div>
          </div>
          <CryptoHistoryTrendChart
            snapshots={filteredSnapshots}
            mode="asset"
            currency={trendCurrency}
            selectedMonth={activeSnapshot?.month}
            onSelectMonth={selectMonth}
          />
        </article>

        <article className="card crypto-chart-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">回報走勢</p>
              <h2>回報金額、回報率及上月變化</h2>
            </div>
          </div>
          <CryptoHistoryTrendChart
            snapshots={filteredSnapshots}
            mode="return"
            selectedMonth={activeSnapshot?.month}
            onSelectMonth={selectMonth}
          />
        </article>
      </section>

      {activeSnapshot ? (
        <section className="card crypto-allocation-card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">資產分佈</p>
              <h2>{activeSnapshot.month} 鎖定比例</h2>
            </div>
            <StatusBadge
              label={getCryptoSnapshotQualityLabel(activeSnapshot.dataQuality)}
              tone={getCryptoSnapshotQualityTone(activeSnapshot.dataQuality)}
            />
          </div>
          <CryptoAllocationPanel snapshot={activeSnapshot} />
        </section>
      ) : null}

      <section className="card crypto-records-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">月結紀錄表</p>
            <h2>{year === 'all' ? '全部月份' : `${year} 年`}</h2>
          </div>
          <span className="chip chip-soft">{filteredSnapshots.length} 筆</span>
        </div>
        <div className="crypto-records-scroll">
          <table className="crypto-records-table">
            <thead>
              <tr>
                <th>月份</th>
                <th>總值 HKD</th>
                <th>本金</th>
                <th>回報</th>
                <th>回報率</th>
                <th>上月變化</th>
                <th>資料品質</th>
                <th>來源</th>
              </tr>
            </thead>
            <tbody>
              {[...filteredSnapshots].reverse().map((snapshot) => (
                <tr
                  key={snapshot.id}
                  className={snapshot.id === activeSnapshot?.id ? 'active' : ''}
                >
                  <td>
                    <button type="button" onClick={() => selectMonth(snapshot.month)}>
                      {snapshot.month}
                    </button>
                  </td>
                  <td>{money(snapshot.totalHkd, 'HKD')}</td>
                  <td>{money(snapshot.principalHkd, 'HKD')}</td>
                  <td className={snapshot.returnHkd >= 0 ? 'positive-text' : 'caution-text'}>
                    {money(snapshot.returnHkd, 'HKD')}
                  </td>
                  <td>{percent(snapshot.returnPct)}</td>
                  <td>{percent(snapshot.monthOverMonthPct)}</td>
                  <td>
                    <StatusBadge
                      label={getCryptoSnapshotQualityLabel(snapshot.dataQuality)}
                      tone={getCryptoSnapshotQualityTone(snapshot.dataQuality)}
                    />
                  </td>
                  <td>{snapshot.sourceSheet}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {activeSnapshot ? <SnapshotDetails snapshot={activeSnapshot} /> : null}

      <section className="card crypto-import-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">匯入狀態</p>
            <h2>最近批次</h2>
          </div>
          <StatusBadge
            label={history.latestImport?.validationPassed ? '驗證通過' : '未有紀錄'}
            tone={history.latestImport?.validationPassed ? 'success' : 'neutral'}
          />
        </div>
        {history.latestImport ? (
          <dl className="crypto-import-grid">
            <div><dt>最近匯入</dt><dd>{formatDateTime(history.latestImport.importedAt)}</dd></div>
            <div><dt>匯入批次</dt><dd>{history.latestImport.importBatchId}</dd></div>
            <div><dt>成功月份</dt><dd>{history.latestImport.successMonthCount}</dd></div>
            <div><dt>警告數量</dt><dd>{history.latestImport.warningCount}</dd></div>
            <div><dt>新建月份</dt><dd>{history.latestImport.createdMonthCount}</dd></div>
            <div><dt>略過／重複</dt><dd>{history.latestImport.skippedDuplicateMonthCount}</dd></div>
          </dl>
        ) : (
          <p className="status-message">尚未讀到匯入批次紀錄。</p>
        )}

        <div className="crypto-sync-panel">
          <div>
            <span>Google Sheet 單向月結同步</span>
            <small>只讀隱藏「月結記錄」；preview 不會寫入 Firestore。</small>
          </div>
          <div className="crypto-sync-actions">
            <button
              type="button"
              className="button-secondary button-sm"
              disabled={syncStatus !== 'idle'}
              onClick={() => void previewMonthlySync()}
            >
              {syncStatus === 'previewing' ? '檢查中…' : '檢查新月結'}
            </button>
            {syncPreview && syncPreview.createCount > 0 && syncPreview.conflictCount === 0 ? (
              <button
                type="button"
                className="button-primary button-sm"
                disabled={syncStatus !== 'idle'}
                onClick={() => void applyMonthlySync()}
              >
                {syncStatus === 'applying'
                  ? '同步中…'
                  : `確認寫入 ${syncPreview.createCount} 個月份`}
              </button>
            ) : null}
          </div>
        </div>

        {syncPreview ? (
          <dl className="crypto-sync-preview" aria-label="月結同步預覽">
            <div><dt>偵測月份</dt><dd>{syncPreview.detectedMonthCount}</dd></div>
            <div><dt>準備新增</dt><dd>{syncPreview.createCount}</dd></div>
            <div><dt>相同略過</dt><dd>{syncPreview.skipCount}</dd></div>
            <div><dt>鎖定差異</dt><dd>{syncPreview.conflictCount}</dd></div>
          </dl>
        ) : null}

        {syncMessage ? (
          <p
            className={syncMessageTone === 'warning' ? 'compact-warning-note' : 'compact-success-note'}
            aria-live="polite"
          >
            {syncMessage}
          </p>
        ) : null}

        {history.latestSync ? (
          <p className="crypto-latest-sync">
            最近同步：{formatDateTime(history.latestSync.finishedAt)} · {history.latestSync.status}
            {' · '}新增 {history.latestSync.createCount}／略過 {history.latestSync.skipCount}
          </p>
        ) : null}
      </section>
    </div>
  );
}
