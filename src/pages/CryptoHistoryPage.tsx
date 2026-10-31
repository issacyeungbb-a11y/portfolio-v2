import { useEffect, useMemo, useState } from 'react';

import { FinanceBarChart, FinanceLineChart } from '../components/charts/FinanceChart';
import { CryptoManagementPanel } from '../components/crypto/CryptoManagementPanel';
import { EmptyState } from '../components/ui/EmptyState';
import { StatusBadge } from '../components/ui/StatusBadge';
import { StatusMessages } from '../components/ui/StatusMessages';
import { useCryptoHistory } from '../hooks/useCryptoHistory';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import {
  getCryptoHistoryYears,
  getCryptoSnapshotQualityLabel,
  getCryptoSnapshotQualityTone,
  getCryptoSourceLabel,
  sortCryptoSnapshots,
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


type ChartMode = 'asset' | 'return';
type PeriodFilter = 'all' | 'last12' | string;

const ARCHIVE_PAGE_SIZE = 12;

const allocationConfig = [
  { key: 'BTC', label: 'BTC', color: 'var(--crypto-btc)' },
  { key: 'ETH', label: 'ETH', color: 'var(--crypto-eth)' },
  { key: 'ADA', label: 'ADA', color: 'var(--crypto-ada)' },
  { key: 'USDT', label: 'USDT', color: 'var(--crypto-usdt)' },
  { key: 'OTHER', label: '其他', color: 'var(--crypto-other)' },
] as const;

function money(value: number, currency: TrendCurrency) {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency,
    maximumFractionDigits: currency === 'USD' ? 2 : 0,
  }).format(value);
}

function signedMoney(value: number, currency: TrendCurrency) {
  const formatted = money(Math.abs(value), currency);
  if (value === 0) return formatted;
  return `${value > 0 ? '+' : '-'}${formatted}`;
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

function share(value: number) {
  return new Intl.NumberFormat('zh-HK', { style: 'percent', maximumFractionDigits: 1 }).format(value);
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

function formatMonthLabel(month: string) {
  return `${month.slice(0, 4)}年${Number(month.slice(5, 7))}月`;
}

function toneClass(value: number | null) {
  if (value == null || value === 0) return '';
  return value > 0 ? 'gain-text' : 'loss-text';
}

const monthIndex = (month: string) => {
  const [year, value] = month.split('-').map(Number);
  return year * 12 + value;
};

const basisLabel = (snapshot: CryptoMonthlySnapshot) =>
  snapshot.sourceType === 'system_management' ? '平台持倉淨值口徑' : '原表口徑';

function MonthDetail({ snapshot }: { snapshot: CryptoMonthlySnapshot }) {
  const isSystem = snapshot.sourceType === 'system_management';
  const holdings = [...snapshot.historicalHoldings].sort((left, right) => right.valueUsd - left.valueUsd);
  const holdingsTotal = holdings.reduce((sum, holding) => sum + Math.max(0, holding.valueUsd), 0);
  const priceBySymbol = new Map(snapshot.prices.map((entry) => [entry.symbol, entry.priceUsd]));
  const allocations = allocationConfig.map((item) => ({ ...item, value: snapshot.allocations[item.key] }));
  const knownAllocations = allocations.filter((item): item is typeof item & { value: number } => typeof item.value === 'number');
  const allocationComplete = knownAllocations.length === allocationConfig.length;
  const largestAllocation = [...knownAllocations].sort((left, right) => right.value - left.value)[0];
  let covered = 0;
  const gradientStops = knownAllocations.flatMap((item) => {
    const start = covered;
    covered = Math.min(1, covered + Math.max(0, item.value));
    return covered > start ? [`${item.color} ${start * 100}% ${covered * 100}%`] : [];
  });
  if (covered < 1) gradientStops.push(`var(--surface-muted) ${covered * 100}% 100%`);
  const warningCodes = [...new Set(snapshot.warnings.map((warning) => warning.code))];

  return (
    <section className="card monthly-detail-card" id="crypto-month-detail">
      <div className="monthly-section-head">
        <div>
          <h2>{formatMonthLabel(snapshot.month)} 明細</h2>
          <p className="cm-caption">
            {isSystem ? '以當時平台持倉扣除負債計算，提取另外列示。' : '保留原表計算方式，與平台持倉淨值口徑分開比較。'}
            {isSystem && snapshot.rawSourceValues.closingMode === 'manual' ? '按當時平台持倉手動建立。' : ''}
          </p>
        </div>
      </div>

      <dl className="monthly-facts">
        <div><dt>月結總值 USD</dt><dd>{money(snapshot.performanceTotalUsd, 'USD')}</dd></div>
        <div><dt>{isSystem ? '月結淨資產 USD' : '原表逐項持倉 USD'}</dt><dd>{money(snapshot.currentNetUsd, 'USD')}</dd></div>
        <div><dt>累計提取／消費 USD</dt><dd>{money(snapshot.cumulativeWithdrawnUsd, 'USD')}</dd></div>
        <div><dt>BTC 等值</dt><dd>{number(snapshot.btcEquivalent, 6)}</dd></div>
        <div><dt>USD/HKD 匯率</dt><dd>{number(snapshot.usdHkdRate, 4)}</dd></div>
        <div><dt>原紀錄累計回報率</dt><dd className={toneClass(snapshot.returnPct)}>{percent(snapshot.returnPct)}</dd></div>
      </dl>

      <div className="monthly-detail-grid">
        <article className="monthly-panel">
          <h3>平台及錢包</h3>
          {holdings.length > 0 ? (
            <ul className="monthly-bars">
              {holdings.map((holding) => {
                const ratio = holdingsTotal > 0 ? Math.max(0, holding.valueUsd) / holdingsTotal : 0;
                return (
                  <li key={holding.rawLabel}>
                    <div className="monthly-bar-label">
                      <span>
                        {holding.normalizedLabel}
                        {holding.rawLabel !== holding.normalizedLabel ? <small>原始：{holding.rawLabel}</small> : null}
                      </span>
                      <strong>{money(holding.valueUsd, 'USD')}</strong>
                    </div>
                    <div className="monthly-bar-track" aria-hidden="true"><i style={{ width: `${ratio * 100}%` }} /></div>
                    <small>{share(ratio)}</small>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="cm-caption">原始月結沒有逐平台資料。</p>
          )}
        </article>

        <article className="monthly-panel">
          <h3>幣種分佈</h3>
          <div className="monthly-allocation">
            <div
              className="monthly-donut"
              role="img"
              aria-label={`${snapshot.month} 幣種分佈：${knownAllocations.map((item) => `${item.label} ${share(item.value)}`).join('、') || '沒有可用比例'}`}
              style={{ background: `conic-gradient(${gradientStops.join(', ')})` }}
            >
              {largestAllocation ? (
                <span>
                  <strong>{share(largestAllocation.value)}</strong>
                  <small>{largestAllocation.label}</small>
                </span>
              ) : null}
            </div>
            <ul className="monthly-legend">
              {allocations.map((item) => (
                <li key={item.key}>
                  <i style={{ background: item.color }} aria-hidden="true" />
                  <span>{item.label}</span>
                  <strong>{typeof item.value === 'number' ? share(item.value) : '—'}</strong>
                </li>
              ))}
            </ul>
          </div>
          {!allocationComplete ? (
            <p className="cm-caption">部分資料：原始月結沒有完整五項分佈，空白項目不作推算。</p>
          ) : null}
        </article>

        <article className="monthly-panel">
          <h3>貨幣數量及價格</h3>
          {snapshot.historicalQuantities.length > 0 ? (
            <ul className="monthly-rows">
              {snapshot.historicalQuantities.map((entry) => (
                <li key={entry.rawLabel}>
                  <span>
                    <strong>{entry.symbol}</strong>
                    {entry.platform ? <small>{[entry.platform, entry.status].filter(Boolean).join(' · ')}</small> : null}
                  </span>
                  <span className="monthly-row-value">
                    <strong>{number(entry.quantity, 8)}</strong>
                    {priceBySymbol.has(entry.symbol) ? <small>單價 {money(priceBySymbol.get(entry.symbol) as number, 'USD')}</small> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cm-caption">原始月結沒有可確認的貨幣數量。</p>
          )}
        </article>

        <article className="monthly-panel">
          <h3>負債</h3>
          {snapshot.liabilities.length > 0 ? (
            <ul className="monthly-rows">
              {snapshot.liabilities.map((entry, index) => (
                <li key={`${entry.symbol ?? 'liability'}-${index}`}>
                  <span>
                    <strong>{entry.symbol ?? '負債'}</strong>
                    <small>{entry.platform ?? '未註明平台'}</small>
                  </span>
                  <span className="monthly-row-value loss-text"><strong>{number(entry.quantity ?? null, 8)}</strong></span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cm-caption">
              {isSystem ? '月結時沒有借貸負債。' : '原始月結沒有可獨立確認的負債明細；不會由平台總值自行推算。'}
            </p>
          )}
        </article>
      </div>

      {snapshot.warnings.length > 0 ? (
        <div className="monthly-notes">
          {snapshot.warnings.map((warning, index) => (
            <p key={`${warning.code}-${index}`} data-severity={warning.severity}>{warning.message}</p>
          ))}
        </div>
      ) : null}

      <details className="monthly-audit">
        <summary>審計資料：來源、批次及原始數值</summary>
        <dl>
          <div>
            <dt>來源</dt>
            <dd>{isSystem ? '平台持倉、借貸及資金紀錄' : `${snapshot.sourceSheet}!${snapshot.sourceRange}`}</dd>
          </div>
          <div><dt>來源類型</dt><dd>{getCryptoSourceLabel(snapshot.sourceType)}</dd></div>
          {snapshot.importBatchId ? <div><dt>匯入批次</dt><dd>{snapshot.importBatchId}</dd></div> : null}
          <div><dt>計算口徑</dt><dd>{basisLabel(snapshot)}</dd></div>
          {warningCodes.length > 0 ? <div><dt>警告代碼</dt><dd>{warningCodes.join('、')}</dd></div> : null}
        </dl>
        <pre>{JSON.stringify(snapshot.rawSourceValues, null, 2)}</pre>
      </details>
    </section>
  );
}

export function CryptoHistoryPage() {
  return <CryptoManagementPanel history={<CryptoMonthlyHistory managed />} />;
}

function CryptoMonthlyHistory({ managed = false }: { managed?: boolean }) {
  const history = useCryptoHistory();
  const [period, setPeriod] = useState<PeriodFilter>('all');
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [archiveSearch, setArchiveSearch] = useState('');
  const [archivePage, setArchivePage] = useState(0);
  const [trendCurrency, setTrendCurrency] = useState<TrendCurrency>('HKD');
  const [chartMode, setChartMode] = useState<ChartMode>('asset');
  const [syncStatus, setSyncStatus] = useState<'idle' | 'previewing' | 'applying'>('idle');
  const [syncPreview, setSyncPreview] = useState<CryptoSyncPreview | null>(null);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncMessageTone, setSyncMessageTone] = useState<'success' | 'warning'>('success');
  const snapshots = useMemo(() => sortCryptoSnapshots(history.snapshots), [history.snapshots]);
  const years = useMemo(() => getCryptoHistoryYears(snapshots), [snapshots]);
  const periodSnapshots = useMemo(() => {
    if (period === 'all') return snapshots;
    if (period === 'last12') {
      const latest = snapshots[snapshots.length - 1];
      if (!latest) return [];
      const cutoff = monthIndex(latest.month) - 12;
      return snapshots.filter((snapshot) => monthIndex(snapshot.month) > cutoff);
    }
    return snapshots.filter((snapshot) => snapshot.month.startsWith(`${period}-`));
  }, [period, snapshots]);
  const periodOptions: Array<[PeriodFilter, string]> = [
    ['all', '全部'],
    ['last12', '近12個月'],
    ...[...years].reverse().map((year): [PeriodFilter, string] => [year, `${year}年`]),
  ];
  const activeSnapshot = snapshots.find((snapshot) => snapshot.month === selectedMonth) ?? snapshots[snapshots.length - 1] ?? null;
  const activeIndex = activeSnapshot ? snapshots.indexOf(activeSnapshot) : -1;
  const chartActiveIndex = activeSnapshot ? periodSnapshots.findIndex((snapshot) => snapshot.id === activeSnapshot.id) : -1;
  const chartLabels = periodSnapshots.map((snapshot) => snapshot.month);
  const chartTitles = periodSnapshots.map((snapshot) => `${formatMonthLabel(snapshot.month)} · ${basisLabel(snapshot)}`);
  const chartBreaks = periodSnapshots.map((snapshot, index) => {
    const previous = periodSnapshots[index - 1];
    return Boolean(previous) && (monthIndex(previous.month) + 1 !== monthIndex(snapshot.month) || basisLabel(previous) !== basisLabel(snapshot));
  });
  const totalValues = periodSnapshots.map((snapshot) => (trendCurrency === 'HKD' ? snapshot.totalHkd : snapshot.performanceTotalUsd));
  const principalValues = periodSnapshots.map((snapshot) =>
    trendCurrency === 'HKD' ? snapshot.principalHkd : snapshot.usdHkdRate > 0 ? snapshot.principalHkd / snapshot.usdHkdRate : null,
  );
  const returnValues = periodSnapshots.map((snapshot) => snapshot.returnHkd);
  const latestReturn = returnValues[returnValues.length - 1] ?? 0;
  const archiveRows = [...periodSnapshots].reverse().filter((snapshot) => snapshot.month.includes(archiveSearch.trim()));
  const pageCount = Math.max(1, Math.ceil(archiveRows.length / ARCHIVE_PAGE_SIZE));
  const currentPage = Math.min(archivePage, pageCount - 1);
  const exportHistory = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), snapshots: history.snapshots, latestImport: history.latestImport, latestSync: history.latestSync }, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'crypto-monthly-history.json'; a.click(); URL.revokeObjectURL(url);
  };
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: managed ? '持倉管理中心' : '加密資產月結',
      subtitle: managed ? '月結歷史：持倉在管理中心維護，以下保留各月份鎖定結果。' : 'Google Sheet 月結紀錄，不計入投資組合。',
      primaryStatus:
        history.status === 'ready'
          ? { label: `${history.snapshots.length} 個月份`, tone: 'success' }
          : history.status === 'error'
            ? { label: '讀取失敗', tone: 'danger' }
            : { label: '載入中', tone: 'neutral' },
    }),
    [history.snapshots.length, history.status, managed],
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
    if (history.status === 'ready' && !managed) {
      void previewMonthlySync();
    }
  }, [history.status, managed]);

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

  const applyCryptoAccountShadow = async () => {
    if (!syncPreview?.assetShadow || syncPreview.assetShadow.accountTotalMatched) return;

    setSyncStatus('applying');
    setSyncMessage(null);
    try {
      const result = (await callPortfolioFunction('crypto-history-sync', {
        applyAssetShadow: true,
        assetConfirmation: 'APPLY_CRYPTO_ACCOUNT_SHADOW',
        expectedSourceChecksum: syncPreview.sourceChecksum,
        expectedAssetShadowChecksum: syncPreview.assetShadow.shadowChecksum,
      })) as CryptoSyncPreview;
      if (!result.assetReadback?.verified) {
        throw new Error('Crypto 帳戶寫入後回讀驗證未通過。');
      }

      const refreshed = (await callPortfolioFunction('crypto-history-sync', {
        apply: false,
        includeAssetShadow: true,
      })) as CryptoSyncPreview;
      if (!refreshed.assetShadow?.accountTotalMatched) {
        throw new Error('Crypto 帳戶同步完成，但網站重新對數未能確認總值一致。');
      }
      setSyncPreview(refreshed);
      setSyncMessageTone('success');
      setSyncMessage(
        `Crypto 帳戶已正式同步到 ${money(result.assetReadback.targetTotalHkd, 'HKD')}；Futu、交易、持倉數量及歷史快照沒有改動。`,
      );
    } catch (error) {
      setSyncMessageTone('warning');
      setSyncMessage(error instanceof Error ? error.message : 'Crypto 帳戶正式同步失敗。');
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

      {activeSnapshot ? (
        <section className="card monthly-statement" aria-label={`${activeSnapshot.month} 月結概要`}>
          <div className="monthly-statement-head">
            <div>
              <span className="cm-eyebrow">月結報表</span>
              <h2>{formatMonthLabel(activeSnapshot.month)}</h2>
              <div className="monthly-badges">
                <StatusBadge label={activeSnapshot.locked ? '已鎖定' : '未鎖定'} tone={activeSnapshot.locked ? 'success' : 'warning'} />
                <StatusBadge
                  label={getCryptoSnapshotQualityLabel(activeSnapshot.dataQuality)}
                  tone={getCryptoSnapshotQualityTone(activeSnapshot.dataQuality)}
                />
                <span>{basisLabel(activeSnapshot)}</span>
                <span>結算日期 {activeSnapshot.snapshotDate || '未有資料'}</span>
              </div>
            </div>
            <div className="monthly-statement-actions">
              <div className="monthly-month-nav">
                <button
                  type="button"
                  aria-label="上一個月結"
                  disabled={activeIndex <= 0}
                  onClick={() => setSelectedMonth(snapshots[activeIndex - 1].month)}
                >
                  ‹
                </button>
                <select
                  aria-label="選擇月結月份"
                  value={activeSnapshot.month}
                  onChange={(event) => setSelectedMonth(event.target.value)}
                >
                  {[...snapshots].reverse().map((snapshot) => (
                    <option key={snapshot.id} value={snapshot.month}>{formatMonthLabel(snapshot.month)}</option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-label="下一個月結"
                  disabled={activeIndex >= snapshots.length - 1}
                  onClick={() => setSelectedMonth(snapshots[activeIndex + 1].month)}
                >
                  ›
                </button>
              </div>
              <button type="button" className="button button-secondary" onClick={exportHistory}>匯出全部月結</button>
            </div>
          </div>

          <dl className="monthly-kpis">
            <div>
              <dt>月結總資產 HKD</dt>
              <dd><strong>{money(activeSnapshot.totalHkd, 'HKD')}</strong><small>{money(activeSnapshot.performanceTotalUsd, 'USD')}</small></dd>
            </div>
            <div>
              <dt>累計本金 HKD</dt>
              <dd><strong>{money(activeSnapshot.principalHkd, 'HKD')}</strong><small>月結時本金</small></dd>
            </div>
            <div>
              <dt>累計回報 HKD</dt>
              <dd>
                <strong className={toneClass(activeSnapshot.returnHkd)}>{signedMoney(activeSnapshot.returnHkd, 'HKD')}</strong>
                <small className={toneClass(activeSnapshot.returnPct)}>{percent(activeSnapshot.returnPct)} 回報率</small>
              </dd>
            </div>
            <div>
              <dt>月度資產變化</dt>
              <dd>
                <strong>{percent(activeSnapshot.monthOverMonthPct)}</strong>
                <small>較上月 · 包含入金及提取，並非投資回報</small>
              </dd>
            </div>
          </dl>

          <p className="cm-caption">
            {snapshots[0]?.month} 至 {snapshots[snapshots.length - 1]?.month} · 共 {snapshots.length} 個月份 · 原始紀錄完整保留
          </p>
        </section>
      ) : null}

      <section className="card monthly-trend-card">
        <div className="monthly-section-head">
          <div>
            <h2>月結走勢</h2>
            <p className="cm-caption">點選圖表月份查看當月明細；缺漏月份及計算口徑轉變不連線。</p>
          </div>
          <div className="monthly-chart-controls">
            <div className="crypto-currency-toggle" role="group" aria-label="走勢內容">
              {([['asset', '總值與本金'], ['return', '累計回報']] as const).map(([mode, label]) => (
                <button key={mode} type="button" className={chartMode === mode ? 'active' : ''} aria-pressed={chartMode === mode} onClick={() => setChartMode(mode)}>
                  {label}
                </button>
              ))}
            </div>
            {chartMode === 'asset' ? (
              <div className="crypto-currency-toggle" role="group" aria-label="走勢顯示貨幣">
                {(['HKD', 'USD'] as const).map((currency) => (
                  <button key={currency} type="button" className={trendCurrency === currency ? 'active' : ''} aria-pressed={trendCurrency === currency} onClick={() => setTrendCurrency(currency)}>
                    {currency}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="monthly-period" role="group" aria-label="走勢期間">
          {periodOptions.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={period === value ? 'active' : ''}
              aria-pressed={period === value}
              onClick={() => {
                setPeriod(value);
                setArchivePage(0);
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {chartMode === 'asset' ? (
          <>
            <div className="monthly-chart-legend" aria-hidden="true">
              <span><i className="solid" />月結總值</span>
              <span><i className="dashed" />累計本金{trendCurrency === 'USD' ? '（按各月匯率換算）' : ''}</span>
            </div>
            <FinanceLineChart
              labels={chartLabels}
              tooltipTitles={chartTitles}
              breaks={chartBreaks}
              series={[
                { id: 'total', label: '月結總值', values: totalValues, variant: 'primary' },
                { id: 'principal', label: '累計本金', values: principalValues, variant: 'reference' },
              ]}
              formatValue={(value) => money(value, trendCurrency)}
              activeIndex={chartActiveIndex >= 0 ? chartActiveIndex : null}
              onSelect={(index) => selectMonth(periodSnapshots[index].month)}
              ariaLabel={`月結總值與累計本金 ${trendCurrency}`}
              renderTooltip={(index) => {
                const snapshot = periodSnapshots[index];
                const principal = principalValues[index];
                return (
                  <>
                    <strong>{money(totalValues[index] ?? 0, trendCurrency)}</strong>
                    <span>累計本金 {principal == null ? '—' : money(principal, trendCurrency)}</span>
                    <span className={toneClass(snapshot.returnHkd)}>累計回報 {signedMoney(snapshot.returnHkd, 'HKD')}（{percent(snapshot.returnPct)}）</span>
                  </>
                );
              }}
            />
          </>
        ) : (
          <FinanceLineChart
            labels={chartLabels}
            tooltipTitles={chartTitles}
            breaks={chartBreaks}
            series={[{ id: 'return', label: '累計回報 HKD', values: returnValues, variant: 'primary' }]}
            tone={latestReturn >= 0 ? 'gain' : 'loss'}
            baseline={0}
            formatValue={(value) => signedMoney(value, 'HKD')}
            activeIndex={chartActiveIndex >= 0 ? chartActiveIndex : null}
            onSelect={(index) => selectMonth(periodSnapshots[index].month)}
            ariaLabel="累計回報 HKD"
            renderTooltip={(index) => {
              const snapshot = periodSnapshots[index];
              return (
                <>
                  <strong className={toneClass(snapshot.returnHkd)}>{signedMoney(snapshot.returnHkd, 'HKD')}</strong>
                  <span className={toneClass(snapshot.returnPct)}>回報率 {percent(snapshot.returnPct)}</span>
                  <span>本金 {money(snapshot.principalHkd, 'HKD')}</span>
                </>
              );
            }}
          />
        )}

        <div className="monthly-subchart">
          <h3>月度資產變化</h3>
          <p className="cm-caption">較上月 · USD 比較口徑 · 包含入金、提取及估值變動，並非扣除資金流後的投資回報</p>
          <FinanceBarChart
            labels={chartLabels}
            tooltipTitles={chartTitles}
            values={periodSnapshots.map((snapshot) => snapshot.monthOverMonthPct)}
            formatValue={(value) => percent(value)}
            formatAxis={(value) => `${Math.round(value * 100)}%`}
            activeIndex={chartActiveIndex >= 0 ? chartActiveIndex : null}
            onSelect={(index) => selectMonth(periodSnapshots[index].month)}
            height={180}
            ariaLabel="月度資產變化百分比"
            renderTooltip={(index) => {
              const value = periodSnapshots[index].monthOverMonthPct;
              return (
                <>
                  <strong className={toneClass(value)}>{value == null ? '未有上月比較' : percent(value)}</strong>
                  <span>包含資金變化</span>
                </>
              );
            }}
          />
        </div>
      </section>

      {activeSnapshot ? <MonthDetail snapshot={activeSnapshot} /> : null}

      <section className="card monthly-archive">
        <div className="monthly-section-head">
          <div>
            <h2>歷史月結</h2>
            <p className="cm-caption">{periodOptions.find(([value]) => value === period)?.[1]} · {periodSnapshots.length} 個月份 · 點選月份查看明細</p>
          </div>
          <label className="monthly-search">
            <span className="visually-hidden">搜尋月份</span>
            <input type="search" placeholder="搜尋月份，例如 2025-10" value={archiveSearch} onChange={(event) => { setArchiveSearch(event.target.value); setArchivePage(0); }} />
          </label>
        </div>
        <div className="monthly-table-scroll">
          <table className="monthly-table">
            <thead>
              <tr>
                <th>月份</th>
                <th>月結總資產 HKD</th>
                <th>本金 HKD</th>
                <th>累計回報 HKD</th>
                <th>回報率</th>
                <th>月度資產變化</th>
                <th>資料品質</th>
              </tr>
            </thead>
            <tbody>
              {archiveRows.slice(currentPage * ARCHIVE_PAGE_SIZE, currentPage * ARCHIVE_PAGE_SIZE + ARCHIVE_PAGE_SIZE).map((snapshot) => (
                <tr key={snapshot.id} className={snapshot.id === activeSnapshot?.id ? 'active' : ''}>
                  <th scope="row">
                    <button type="button" onClick={() => selectMonth(snapshot.month)} aria-label={`查看 ${snapshot.month} 明細`}>
                      {snapshot.month}
                    </button>
                  </th>
                  <td>{money(snapshot.totalHkd, 'HKD')}</td>
                  <td>{money(snapshot.principalHkd, 'HKD')}</td>
                  <td className={toneClass(snapshot.returnHkd)}>{signedMoney(snapshot.returnHkd, 'HKD')}</td>
                  <td className={toneClass(snapshot.returnPct)}>{percent(snapshot.returnPct)}</td>
                  <td>{percent(snapshot.monthOverMonthPct)}</td>
                  <td>
                    <StatusBadge
                      label={getCryptoSnapshotQualityLabel(snapshot.dataQuality)}
                      tone={getCryptoSnapshotQualityTone(snapshot.dataQuality)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {archiveRows.length === 0 && <p className="cm-caption">沒有符合的月份。</p>}
        {pageCount > 1 ? (
          <div className="monthly-pagination">
            <button type="button" className="button button-secondary" disabled={currentPage === 0} onClick={() => setArchivePage(currentPage - 1)}>上一頁</button>
            <span>第 {currentPage + 1} / {pageCount} 頁 · {archiveRows.length} 筆</span>
            <button type="button" className="button button-secondary" disabled={currentPage >= pageCount - 1} onClick={() => setArchivePage(currentPage + 1)}>下一頁</button>
          </div>
        ) : null}
      </section>

      {!managed && <section className="card crypto-import-card">
        <div className="section-heading">
          <div>
            <h2>最近匯入</h2>
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
          <p className="status-message">未有匯入紀錄。</p>
        )}

        <div className="crypto-sync-panel">
          <div>
            <span>Google Sheet 單向月結同步</span>
            <small>只讀取 Google Sheet，確認前唔會寫入資料；Crypto 帳戶總值會跟隨更新（不包括 Futu）。</small>
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

                {!syncPreview.assetShadow.accountTotalMatched ? (
                  <div className="crypto-shadow-apply-row">
                    <p>
                      只更新 Crypto 帳戶月結總值覆蓋；不改持倉數量、交易、Futu 或歷史快照。
                    </p>
                    <button
                      type="button"
                      className="button-primary button-sm"
                      disabled={syncStatus !== 'idle'}
                      onClick={() => void applyCryptoAccountShadow()}
                    >
                      {syncStatus === 'applying' ? '同步中…' : '確認正式同步 Crypto 帳戶'}
                    </button>
                  </div>
                ) : null}

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
      </section>}
    </div>
  );
}
