import { useEffect, useMemo, useState } from 'react';

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
  mode: 'preview' | 'apply' | 'asset_apply';
  runId?: string;
  sourceReadOnly: boolean;
  sourceChecksum: string;
  checkedAt: string;
  detectedMonthCount: number;
  firstMonth: string | null;
  lastMonth: string | null;
  warningCount: number;
  warningSummary: Record<string, number>;
  auditCreateCount: number;
  auditMonths: string[];
  createCount: number;
  skipCount: number;
  conflictCount: number;
  creates: string[];
  skips: string[];
  conflicts: Array<{
    month: string;
    differingFields: string[];
  }>;
  validationReport: {
    validationPassed: boolean;
    expectedFieldCount: number;
    validatedMonthCount: number;
    validatedFields: string[];
    months: Array<{
      month: string;
      sourceRange: string;
      fieldCount: number;
      action: 'create' | 'skip' | 'conflict';
      sourceChecksum: string;
      warningCodes: string[];
      differingFields: string[];
    }>;
  };
  assetShadow?: {
    mode: 'shadow_preview';
    status: 'ready' | 'review_required';
    month: string;
    accountSource: 'Crypto';
    sourceReadOnly: true;
    firestoreWriteAllowed: false;
    writesPerformed: 0;
    shadowChecksum: string;
    accountTotalMatched: boolean;
    targetTotalUsd: number;
    targetTotalHkd: number;
    currentAccountTotalUsd: number;
    currentAccountTotalHkd: number;
    differenceUsd: number;
    differenceHkd: number;
    detailPositionSubtotalUsd: number;
    detailToTargetDifferenceUsd: number;
    separateWithdrawalsUsd: number;
    usdHkdRate: number;
    cryptoAssetCount: number;
    excludedFutuAssetCount: number;
    excludedFutuValueUsd: number;
    sourceDetailRange: string;
    positions: Array<{
      symbol: string;
      sourceLabel: string;
      sourceValueUsd: number;
      currentValueUsd: number;
      differenceUsd: number;
      sourceQuantity: number | null;
      currentQuantity: number;
      sourcePriceUsd: number | null;
      isLiability: boolean;
    }>;
    checks: Array<{
      code: string;
      passed: boolean;
      severity: 'info' | 'warning' | 'error';
      message: string;
    }>;
  };
  readback?: {
    verified: boolean;
    snapshotMonths: string[];
    auditMonths: string[];
    syncRunId: string;
    historicalImportId: string | null;
  };
  assetReadback?: {
    applied: boolean;
    skipped: boolean;
    verified: boolean;
    month: string;
    targetTotalHkd: number;
    readbackTotalHkd: number;
    differenceHkd: number;
    excludedFutuAssetCount: number;
    firestoreAssetWrites: number;
    firestoreOverrideWrites: number;
    auditId: string;
  } | null;
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
        includeAssetShadow: true,
      })) as CryptoSyncPreview;
      setSyncPreview(result);
      setSyncMessageTone(result.conflictCount > 0 ? 'warning' : 'success');
      setSyncMessage(
        result.conflictCount > 0
          ? '發現已鎖定月份差異，已停止；不會覆蓋現有資料。'
          : result.createCount > 0
            ? `已找到 ${result.createCount} 個新月份，請核對後確認寫入。`
            : result.auditCreateCount > 0
              ? `已找到 ${result.auditCreateCount} 個月份欠缺匯入審計，請確認補記。`
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

  useEffect(() => {
    if (history.status === 'ready') {
      void previewMonthlySync();
    }
  }, [history.status]);

  const applyMonthlySync = async () => {
    if (
      !syncPreview ||
      (syncPreview.createCount === 0 && syncPreview.auditCreateCount === 0) ||
      syncPreview.conflictCount > 0
    ) {
      return;
    }

    const confirmationMessage = syncPreview.createCount > 0
      ? `確認將 ${syncPreview.createCount} 個新月份寫入獨立 Crypto 歷史集合？現有鎖定月份不會被覆蓋。`
      : `確認補記 ${syncPreview.auditCreateCount} 個月份嘅匯入審計？現有鎖定月份不會被覆蓋。`;
    const confirmed = window.confirm(
      confirmationMessage,
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
      if (!result.readback?.verified) {
        throw new Error('Firestore 寫入完成，但伺服器回讀驗證未通過。');
      }
      if (!result.assetReadback?.verified) {
        throw new Error('Crypto 歷史已寫入，但 Crypto 帳戶自動同步回讀未通過。');
      }

      const websiteResponse = (await callPortfolioFunction('crypto-history')) as {
        snapshots?: CryptoMonthlySnapshot[];
        latestImport?: { importBatchId?: string } | null;
      };
      const websiteMonths = new Set(
        (websiteResponse.snapshots ?? []).map((snapshot) => snapshot.month),
      );
      const missingWebsiteMonths = result.readback.snapshotMonths.filter(
        (month) => !websiteMonths.has(month),
      );
      const historicalImportVerified = result.readback.historicalImportId == null ||
        websiteResponse.latestImport?.importBatchId === result.readback.historicalImportId;
      if (missingWebsiteMonths.length > 0 || !historicalImportVerified) {
        throw new Error(
          `Firestore 已寫入，但網站回讀核對失敗${
            missingWebsiteMonths.length > 0
              ? `：缺少 ${missingWebsiteMonths.join('、')}`
              : '：最新審計批次未更新'
          }。`,
        );
      }

      setSyncPreview(result);
      setSyncMessageTone('success');
      setSyncMessage(
        result.createCount > 0
          ? `同步完成，已新增 ${result.createCount} 個月份，Crypto 帳戶亦已自動對到 ${money(result.assetReadback.targetTotalHkd, 'HKD')}；Firestore、網站及審計回讀一致。`
          : `同步完成，已補記 ${result.auditCreateCount} 個月份嘅匯入審計，Crypto 帳戶亦已回讀一致。`,
      );
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
            hint="Crypto 帳戶目標總值；不扣提取／消費"
          />
          <KpiCard
            label="試算表逐項持倉 USD"
            value={money(activeSnapshot.currentNetUsd, 'USD')}
            hint="逐項正資產減負債，待影子對數"
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
            hint="獨立紀錄，不從總資產扣減"
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
            <small>頁面載入時自動唯讀檢查隱藏「月結記錄」；preview 不會寫入 Firestore。</small>
            <small>確認新月份寫入 Crypto 歷史後，Crypto 帳戶總值會自動跟隨；Futu 永遠排除。</small>
            {syncPreview ? <small>最近檢查：{formatDateTime(syncPreview.checkedAt)}</small> : null}
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
            {syncPreview &&
            (syncPreview.createCount > 0 || syncPreview.auditCreateCount > 0) &&
            syncPreview.conflictCount === 0 ? (
              <button
                type="button"
                className="button-primary button-sm"
                disabled={syncStatus !== 'idle'}
                onClick={() => void applyMonthlySync()}
              >
                {syncStatus === 'applying'
                  ? '同步中…'
                  : syncPreview.createCount > 0
                    ? `確認寫入 ${syncPreview.createCount} 個月份`
                    : `確認補記 ${syncPreview.auditCreateCount} 個月份審計`}
              </button>
            ) : null}
          </div>
        </div>

        {syncPreview ? (
          <>
            <dl className="crypto-sync-preview" aria-label="月結同步預覽">
              <div><dt>偵測月份</dt><dd>{syncPreview.detectedMonthCount}</dd></div>
              <div><dt>19 欄驗證</dt><dd>{syncPreview.validationReport.validationPassed ? '通過' : '停止'}</dd></div>
              <div><dt>準備新增</dt><dd>{syncPreview.createCount}</dd></div>
              <div><dt>相同略過</dt><dd>{syncPreview.skipCount}</dd></div>
              <div><dt>審計補記</dt><dd>{syncPreview.auditCreateCount}</dd></div>
              <div><dt>鎖定差異</dt><dd>{syncPreview.conflictCount}</dd></div>
            </dl>
            {syncPreview.assetShadow ? (
              <section className="crypto-shadow-preview" aria-label="Crypto 帳戶影子對數預覽">
                <div className="crypto-shadow-heading">
                  <div>
                    <p className="eyebrow">零寫入影子對數</p>
                    <h3>Crypto 帳戶 ↔ {syncPreview.assetShadow.month} 月結</h3>
                    <small>{syncPreview.assetShadow.sourceDetailRange}</small>
                  </div>
                  <div className="crypto-shadow-badges">
                    <StatusBadge label="Futu 已排除" tone="success" />
                    <StatusBadge label="Firestore 0 寫入" tone="success" />
                    {syncPreview.assetShadow.accountTotalMatched ? (
                      <StatusBadge label="帳戶總值已同步" tone="success" />
                    ) : null}
                    <StatusBadge
                      label={syncPreview.assetShadow.status === 'ready' ? '逐項可對數' : '逐項需要核對'}
                      tone={syncPreview.assetShadow.status === 'ready' ? 'success' : 'warning'}
                    />
                  </div>
                </div>

                <dl className="crypto-shadow-totals">
                  <div>
                    <dt>月結目標</dt>
                    <dd>{money(syncPreview.assetShadow.targetTotalHkd, 'HKD')}</dd>
                    <small>{money(syncPreview.assetShadow.targetTotalUsd, 'USD')}</small>
                  </div>
                  <div>
                    <dt>資產頁 Crypto 帳戶現值</dt>
                    <dd>{money(syncPreview.assetShadow.currentAccountTotalHkd, 'HKD')}</dd>
                    <small>{money(syncPreview.assetShadow.currentAccountTotalUsd, 'USD')}</small>
                  </div>
                  <div data-tone={syncPreview.assetShadow.differenceHkd >= 0 ? 'positive' : 'negative'}>
                    <dt>影子差額（目標－現值）</dt>
                    <dd>{money(syncPreview.assetShadow.differenceHkd, 'HKD')}</dd>
                    <small>{money(syncPreview.assetShadow.differenceUsd, 'USD')}</small>
                  </div>
                  <div>
                    <dt>排除 Futu Crypto</dt>
                    <dd>{syncPreview.assetShadow.excludedFutuAssetCount} 項</dd>
                    <small>{money(syncPreview.assetShadow.excludedFutuValueUsd, 'USD')}，不計入以上數字</small>
                  </div>
                </dl>

                <div className="crypto-shadow-equation">
                  <span>月結總資產 {money(syncPreview.assetShadow.targetTotalUsd, 'USD')}</span>
                  <strong>不扣減</strong>
                  <span>獨立提取／消費 {money(syncPreview.assetShadow.separateWithdrawalsUsd, 'USD')}</span>
                </div>

                {Math.abs(syncPreview.assetShadow.detailToTargetDifferenceUsd) > 0.01 ? (
                  <p className="compact-warning-note">
                    試算表逐項持倉只合計到 {money(syncPreview.assetShadow.detailPositionSubtotalUsd, 'USD')}，
                    較月結總資產少 {money(syncPreview.assetShadow.detailToTargetDifferenceUsd, 'USD')}。
                    今次照你嘅定義，以 {money(syncPreview.assetShadow.targetTotalHkd, 'HKD')} 作帳戶目標，
                    但正式逐項更新前唔會擅自將差額分配落任何幣種。
                  </p>
                ) : null}

                <div className="crypto-shadow-table-scroll">
                  <table className="crypto-shadow-table">
                    <thead>
                      <tr>
                        <th>幣種</th>
                        <th>月結逐項 USD</th>
                        <th>資產頁現值 USD</th>
                        <th>差額 USD</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncPreview.assetShadow.positions.map((position) => (
                        <tr key={position.symbol}>
                          <td>
                            <strong>{position.symbol}</strong>
                            {position.isLiability ? <small>已包括負債</small> : null}
                          </td>
                          <td>{money(position.sourceValueUsd, 'USD')}</td>
                          <td>{money(position.currentValueUsd, 'USD')}</td>
                          <td className={position.differenceUsd >= 0 ? 'positive-text' : 'caution-text'}>
                            {money(position.differenceUsd, 'USD')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="crypto-shadow-checks">
                  {syncPreview.assetShadow.checks.map((check) => (
                    <p key={check.code} data-severity={check.severity}>
                      <strong>{check.passed ? '✓' : '!'}</strong>
                      <span>{check.message}</span>
                    </p>
                  ))}
                </div>
              </section>
            ) : null}
            <div className="crypto-sync-month-list" aria-label="待確認月結預覽">
              {syncPreview.validationReport.months.map((month) => (
                <article key={month.month} data-action={month.action}>
                  <div>
                    <strong>{month.month}</strong>
                    <span>{month.sourceRange}</span>
                  </div>
                  <div>
                    <strong>{month.fieldCount}/{syncPreview.validationReport.expectedFieldCount} 欄</strong>
                    <span>
                      {month.action === 'create'
                        ? '待確認寫入'
                        : month.action === 'conflict'
                          ? '數值差異，已停止'
                          : '實際資料相同，安全略過'}
                    </span>
                  </div>
                  <small>checksum {month.sourceChecksum.slice(0, 12)}</small>
                  {month.differingFields.length > 0 ? (
                    <small>差異欄位：{month.differingFields.join('、')}</small>
                  ) : null}
                  {month.warningCodes.length > 0 ? (
                    <small>警告：{month.warningCodes.join('、')}</small>
                  ) : null}
                </article>
              ))}
            </div>
          </>
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
