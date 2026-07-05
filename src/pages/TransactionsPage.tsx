import { useMemo, useState } from 'react';

import { AssetTransactionForm } from '../components/assets/AssetTransactionForm';
import { TransactionInputPanel } from '../components/transactions/TransactionInputPanel';
import { EmptyState } from '../components/ui/EmptyState';
import { PageSection } from '../components/ui/DesignSystem';
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../data/mockPortfolio';
import { useAssetTransactions } from '../hooks/useAssetTransactions';
import { useManualPriceUpdater } from '../hooks/useManualPriceUpdater';
import { useAllPortfolioAssets, usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { repairMissingArchivedAssetsFromTransactions } from '../lib/firebase/assetTransactions';
import { buildTransactionAssetPriceUpdatePlan } from '../lib/portfolio/priceUpdateTargets';
import {
  getTransactionPriceComparison,
  type TransactionPriceComparison,
} from '../lib/portfolio/transactionPriceComparison';
import type {
  AccountSource,
  AssetTransactionEntry,
  AssetTransactionType,
  DisplayCurrency,
  Holding,
} from '../types/portfolio';

// 交易一律以結算貨幣（美金）儲存，交易歷史固定用美金顯示，不跟隨總覽的顯示幣別。
const TRANSACTION_DISPLAY_CURRENCY: DisplayCurrency = 'USD';

const transactionAccountFilterOptions: Array<{ value: AccountSource | 'all'; label: string }> = [
  { value: 'all', label: '全部帳戶' },
  { value: 'Futu', label: 'Futu' },
  { value: 'IB', label: 'IB' },
  { value: 'Crypto', label: 'Crypto' },
  { value: 'Other', label: '其他' },
];

const transactionTypeFilterOptions: Array<{ value: AssetTransactionType | 'all'; label: string }> = [
  { value: 'all', label: '全部交易' },
  { value: 'buy', label: '買入' },
  { value: 'sell', label: '賣出' },
];

function formatTradeDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function buildHoldingFallback(entry: AssetTransactionEntry): Holding {
  return {
    id: entry.assetId,
    name: entry.assetName,
    symbol: entry.symbol,
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    currency: entry.currency,
    quantity: entry.quantityAfter ?? 0,
    averageCost: entry.averageCostAfter ?? entry.price,
    currentPrice: entry.price,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    allocation: 0,
  };
}

function normalizeAssetMatchValue(value: string | undefined) {
  return (value ?? '').trim().toUpperCase();
}

function getHoldingMatchKeys(holding: Holding) {
  const baseKey = `${holding.accountSource}|${holding.assetType}`;
  const symbol = normalizeAssetMatchValue(holding.symbol);
  const name = normalizeAssetMatchValue(holding.name);

  return [
    symbol ? `${baseKey}|symbol|${symbol}` : null,
    name ? `${baseKey}|name|${name}` : null,
  ].filter((key): key is string => Boolean(key));
}

function getEntryMatchKeys(entry: AssetTransactionEntry) {
  const baseKey = `${entry.accountSource}|${entry.assetType}`;
  const symbol = normalizeAssetMatchValue(entry.symbol);
  const name = normalizeAssetMatchValue(entry.assetName);

  return [
    symbol ? `${baseKey}|symbol|${symbol}` : null,
    name ? `${baseKey}|name|${name}` : null,
  ].filter((key): key is string => Boolean(key));
}

function formatPercent(value: number) {
  return `${(value * 100).toLocaleString('zh-HK', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

function getContributionLabel(comparison: TransactionPriceComparison | null) {
  if (!comparison) {
    return '未有現價';
  }

  const direction =
    comparison.kind === 'sell'
      ? comparison.comparisonDisplay >= 0
        ? '賣得好'
        : '賣早咗'
      : comparison.comparisonDisplay >= 0
        ? '賺'
        : '蝕';

  return `${comparison.entry.symbol} · ${comparison.label} · ${direction}`;
}

export function TransactionsPage() {
  const { holdings } = usePortfolioAssets();
  const {
    holdings: allHoldings,
    error: allHoldingsError,
  } = useAllPortfolioAssets();
  const {
    entries,
    status,
    error,
    editTransaction,
    removeTransaction,
  } = useAssetTransactions();
  const {
    error: priceReviewsError,
    saveReviews,
    applyReviews,
  } = usePriceUpdateReviews();
  const [editingEntry, setEditingEntry] = useState<AssetTransactionEntry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isTransactionInputOpen, setIsTransactionInputOpen] = useState(false);
  const [isPriceUpdateConfirmOpen, setIsPriceUpdateConfirmOpen] = useState(false);
  const [accountFilter, setAccountFilter] = useState<AccountSource | 'all'>('all');
  const [transactionTypeFilter, setTransactionTypeFilter] = useState<AssetTransactionType | 'all'>('all');
  const [dateFromFilter, setDateFromFilter] = useState('');
  const [dateToFilter, setDateToFilter] = useState('');
  const displayCurrency = TRANSACTION_DISPLAY_CURRENCY;
  const {
    isUpdating: isUpdatingTransactionPrices,
    priceUpdateError,
    priceUpdateSuccess,
    runPriceUpdates,
  } = useManualPriceUpdater({
    applyReviews,
    saveReviews,
    emptyTargetMessage: '目前交易紀錄未有可更新現價的非現金資產。',
  });

  const visibleEntries = entries.filter(
    (entry) => !(entry.recordType === 'seed' && entry.note === '歷史持倉基線'),
  );
  const filteredEntries = visibleEntries.filter((entry) => {
    const settlementAccount = entry.settlementAccountSource ?? entry.accountSource;
    const matchesAccount =
      accountFilter === 'all' ||
      entry.accountSource === accountFilter ||
      settlementAccount === accountFilter;
    const matchesTransactionType =
      transactionTypeFilter === 'all' || entry.transactionType === transactionTypeFilter;
    const matchesDateFrom = !dateFromFilter || entry.date >= dateFromFilter;
    const matchesDateTo = !dateToFilter || entry.date <= dateToFilter;

    return matchesAccount && matchesTransactionType && matchesDateFrom && matchesDateTo;
  });
  const hasActiveFilters =
    accountFilter !== 'all' ||
    transactionTypeFilter !== 'all' ||
    Boolean(dateFromFilter) ||
    Boolean(dateToFilter);
  const holdingsById = useMemo(
    () => new Map(holdings.map((holding) => [holding.id, holding])),
    [holdings],
  );
  const comparisonHoldingsById = useMemo(
    () => new Map(allHoldings.map((holding) => [holding.id, holding])),
    [allHoldings],
  );
  const comparisonHoldingsByTransactionId = useMemo(() => {
    const holdingsByMatchKey = new Map<string, Holding[]>();

    allHoldings.forEach((holding) => {
      getHoldingMatchKeys(holding).forEach((key) => {
        const current = holdingsByMatchKey.get(key) ?? [];
        holdingsByMatchKey.set(key, [...current, holding]);
      });
    });

    return new Map(
      visibleEntries.map((entry) => {
        const directMatch = comparisonHoldingsById.get(entry.assetId);

        if (directMatch) {
          return [entry.id, directMatch];
        }

        const fallbackMatch =
          getEntryMatchKeys(entry)
            .flatMap((key) => holdingsByMatchKey.get(key) ?? [])
            .find((holding) => holding.accountSource === entry.accountSource);

        return [entry.id, fallbackMatch];
      }),
    );
  }, [allHoldings, comparisonHoldingsById, visibleEntries]);
  const comparisonsByTransactionId = useMemo(
    () =>
      new Map(
        filteredEntries.map((entry) => [
          entry.id,
          getTransactionPriceComparison(
            entry,
            comparisonHoldingsByTransactionId.get(entry.id),
            displayCurrency,
          ),
        ]),
      ),
    [comparisonHoldingsByTransactionId, displayCurrency, filteredEntries],
  );
  const validComparisons = useMemo(
    () =>
      [...comparisonsByTransactionId.values()].filter(
        (comparison): comparison is TransactionPriceComparison => comparison != null,
      ),
    [comparisonsByTransactionId],
  );
  const buyComparisons = validComparisons.filter((comparison) => comparison.kind === 'buy');
  const sellComparisons = validComparisons.filter((comparison) => comparison.kind === 'sell');
  const buyComparisonTotal = buyComparisons.reduce(
    (sum, comparison) => sum + comparison.comparisonDisplay,
    0,
  );
  const sellComparisonTotal = sellComparisons.reduce(
    (sum, comparison) => sum + comparison.comparisonDisplay,
    0,
  );
  const buyComparisonBasisTotal = buyComparisons.reduce(
    (sum, comparison) => sum + comparison.basisDisplay,
    0,
  );
  const buyWeightedReturn =
    buyComparisonBasisTotal > 0 ? buyComparisonTotal / buyComparisonBasisTotal : null;
  const positiveComparisons = validComparisons.filter(
    (comparison) => comparison.comparisonDisplay > 0,
  );
  const negativeComparisons = validComparisons.filter(
    (comparison) => comparison.comparisonDisplay < 0,
  );
  const maxPositiveComparison =
    positiveComparisons.length > 0
      ? positiveComparisons.reduce((best, comparison) =>
          comparison.comparisonDisplay > best.comparisonDisplay ? comparison : best,
        )
      : null;
  const maxNegativeComparison =
    negativeComparisons.length > 0
      ? negativeComparisons.reduce((worst, comparison) =>
          comparison.comparisonDisplay < worst.comparisonDisplay ? comparison : worst,
        )
      : null;
  const transactionPriceUpdateHoldings = useMemo(() => {
    return buildTransactionAssetPriceUpdatePlan(visibleEntries, allHoldings);
  }, [allHoldings, visibleEntries]);
  const transactionPriceUpdateDiagnostics = transactionPriceUpdateHoldings.diagnostics;
  const canRunTransactionPriceUpdate =
    transactionPriceUpdateHoldings.targetHoldings.length > 0 ||
    transactionPriceUpdateDiagnostics.repairableMissingAssetCount > 0;
  const latestTradeDate =
    [...filteredEntries]
      .map((entry) => entry.date)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const latestTradeLabel = latestTradeDate ? formatTradeDate(latestTradeDate) : '未有記錄';
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '交易記錄',
      subtitle: '檢視買賣、轉帳與截圖匯入紀錄。',
      primaryStatus: {
        label: filteredEntries.length > 0 ? `最近交易 ${latestTradeLabel}` : '尚未有交易',
        tone: filteredEntries.length > 0 ? 'success' : 'neutral',
      },
      actions: (
        <button
          className="button button-primary"
          type="button"
          onClick={() => setIsTransactionInputOpen((current) => !current)}
        >
          {isTransactionInputOpen ? '收起輸入' : '新增交易'}
        </button>
      ),
    }),
    [
      isTransactionInputOpen,
      latestTradeLabel,
      filteredEntries.length,
    ],
  );

  useTopBar(topBarConfig);

  async function handleEditTransaction(
    payload: Omit<AssetTransactionEntry, 'id' | 'createdAt' | 'updatedAt' | 'realizedPnlHKD'>,
  ) {
    if (!editingEntry) {
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      await editTransaction(editingEntry.id, payload);
      setActionSuccess(`${editingEntry.symbol} 交易已更新。`);
      setEditingEntry(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '更新交易失敗，請稍後再試。';
      setActionError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteTransaction() {
    if (!editingEntry) {
      return;
    }

    setIsDeleting(true);
    setActionError(null);

    try {
      await removeTransaction(editingEntry.id);
      setActionSuccess(`${editingEntry.symbol} 交易已刪除。`);
      setEditingEntry(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '刪除交易失敗，請稍後再試。';
      setActionError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleUpdateTransactionPriceComparisons() {
    setActionError(null);
    setActionSuccess(null);

    try {
      const repairResult = await repairMissingArchivedAssetsFromTransactions(
        visibleEntries,
        new Set(allHoldings.map((holding) => holding.id)),
      );
      const nextPlan = buildTransactionAssetPriceUpdatePlan(
        visibleEntries,
        [...allHoldings, ...repairResult.repairedHoldings],
      );
      await runPriceUpdates(nextPlan.targetHoldings);
      if (repairResult.repairedCount > 0) {
        setActionSuccess(
          `已修復 ${repairResult.repairedCount} 個缺失歷史資產文件，並加入今次價格更新。`,
        );
      }
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : '修復歷史資產文件失敗，請稍後再試。',
      );
    }
  }

  return (
    <div className="page-stack">
      {error ? <p className="status-message status-message-error">{error}</p> : null}
      {allHoldingsError ? <p className="status-message status-message-error">{allHoldingsError}</p> : null}
      {priceReviewsError ? <p className="status-message status-message-error">{priceReviewsError}</p> : null}
      {priceUpdateError ? <p className="status-message status-message-error">{priceUpdateError}</p> : null}
      {actionError ? <p className="status-message status-message-error">{actionError}</p> : null}
      {priceUpdateSuccess ? <p className="status-message status-message-success">{priceUpdateSuccess}</p> : null}
      {actionSuccess ? <p className="status-message status-message-success">{actionSuccess}</p> : null}

      <PageSection
        title="交易摘要"
        subtitle="交易、手續費、已實現盈虧與現價比較一律以美金（USD）列示。"
      >
        <div className="section-toolbar">
          <p className="table-hint">
            現價比較只會即時計算，不會寫入 transaction document。
          </p>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setIsPriceUpdateConfirmOpen(true)}
            disabled={isUpdatingTransactionPrices || !canRunTransactionPriceUpdate}
          >
            {isUpdatingTransactionPrices ? '更新中...' : '更新現時及歷史資產價格'}
          </button>
        </div>
        <p className="table-hint">
          歷史資產 {transactionPriceUpdateDiagnostics.historicalAssetCount} 項 · 成功配對 {transactionPriceUpdateDiagnostics.matchedAssetCount} 項 · 未能配對 {transactionPriceUpdateDiagnostics.unmatchedAssetCount} 項
          {' · '}預計更新現時 {transactionPriceUpdateDiagnostics.currentAssetCount} 項 / 歷史 {transactionPriceUpdateDiagnostics.historicalAssetUpdateCount} 項
        </p>
        {transactionPriceUpdateDiagnostics.unmatchedAssets.length > 0 ? (
          <p className="status-message status-message-warning">
            未能配對：
            {' '}
            {transactionPriceUpdateDiagnostics.unmatchedAssets
              .slice(0, 8)
              .map((asset) => `${asset.symbol || asset.assetName || asset.assetId}（${asset.reason}）`)
              .join('、')}
            {transactionPriceUpdateDiagnostics.unmatchedAssets.length > 8 ? ' 等' : ''}
          </p>
        ) : null}
        <div className="transaction-summary-overview">
          <article className="summary-card">
            <p className="summary-label">記錄總數</p>
            <strong className="summary-value">{filteredEntries.length}</strong>
            <p className="summary-hint">
              {hasActiveFilters ? `已篩選自 ${visibleEntries.length} 筆記錄` : '包括建倉記錄與買入 / 賣出交易'}
            </p>
          </article>
        </div>
        <div className="transaction-summary-split">
          <section className="transaction-summary-panel transaction-summary-panel-buy">
            <div className="section-heading">
              <div>
                <p className="eyebrow">BUY</p>
                <h3>買入交易</h3>
              </div>
              <span className="chip chip-soft">{buyComparisons.length} 筆有現價</span>
            </div>
            <div className="summary-grid">
              <article className="summary-card">
                <p className="summary-label">買入至今合計</p>
                <strong
                  className="summary-value"
                  data-tone={buyComparisonTotal >= 0 ? 'positive' : 'caution'}
                >
                  {formatCurrencyRounded(buyComparisonTotal, displayCurrency)}
                </strong>
                <p className="summary-hint">
                  現時價值 - 成交成本
                </p>
              </article>
              <article className="summary-card">
                <p className="summary-label">買入交易加權平均回報</p>
                <strong
                  className="summary-value"
                  data-tone={(buyWeightedReturn ?? 0) >= 0 ? 'positive' : 'caution'}
                >
                  {buyWeightedReturn == null ? '未有現價' : formatPercent(buyWeightedReturn)}
                </strong>
                <p className="summary-hint">按成交成本加權</p>
              </article>
              <article className="summary-card">
                <p className="summary-label">最大正面貢獻交易</p>
                <strong
                  className="summary-value"
                  data-tone={(maxPositiveComparison?.comparisonDisplay ?? 0) >= 0 ? 'positive' : 'default'}
                >
                  {maxPositiveComparison
                    ? formatCurrencyRounded(maxPositiveComparison.comparisonDisplay, displayCurrency)
                    : '未有現價'}
                </strong>
                <p className="summary-hint">
                  {maxPositiveComparison
                    ? getContributionLabel(maxPositiveComparison)
                    : validComparisons.length > 0
                      ? '未有正面貢獻'
                      : '未有現價'}
                </p>
              </article>
              <article className="summary-card">
                <p className="summary-label">最大負面拖累交易</p>
                <strong
                  className="summary-value"
                  data-tone={(maxNegativeComparison?.comparisonDisplay ?? 0) < 0 ? 'caution' : 'default'}
                >
                  {maxNegativeComparison
                    ? formatCurrencyRounded(maxNegativeComparison.comparisonDisplay, displayCurrency)
                    : '未有現價'}
                </strong>
                <p className="summary-hint">
                  {maxNegativeComparison
                    ? getContributionLabel(maxNegativeComparison)
                    : validComparisons.length > 0
                      ? '未有負面拖累'
                      : '未有現價'}
                </p>
              </article>
            </div>
          </section>
          <section className="transaction-summary-panel transaction-summary-panel-sell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">SELL</p>
                <h3>賣出交易</h3>
              </div>
              <span className="chip chip-soft">{sellComparisons.length} 筆有現價</span>
            </div>
            <div className="summary-grid">
              <article className="summary-card">
                <p className="summary-label">賣後比較合計</p>
                <strong
                  className="summary-value"
                  data-tone={sellComparisonTotal >= 0 ? 'positive' : 'caution'}
                >
                  {formatCurrencyRounded(sellComparisonTotal, displayCurrency)}
                </strong>
                <p className="summary-hint">正數代表賣得好，負數代表賣早咗</p>
              </article>
              <article className="summary-card">
                <p className="summary-label">已實現盈虧</p>
                <strong className="summary-value">
                  {formatCurrencyRounded(
                    convertCurrency(
                      filteredEntries.reduce((sum, entry) => sum + entry.realizedPnlHKD, 0),
                      'HKD',
                      displayCurrency,
                    ),
                    displayCurrency,
                  )}
                </strong>
                <p className="summary-hint">賣出交易扣除手續費後累計</p>
              </article>
            </div>
          </section>
        </div>
      </PageSection>

      {isTransactionInputOpen ? (
        <TransactionInputPanel onClose={() => setIsTransactionInputOpen(false)} />
      ) : null}

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>交易記錄</h2>
          </div>
          <span className={status === 'loading' ? 'chip chip-soft' : 'chip chip-strong'}>
            {status === 'loading' ? '同步中' : `${filteredEntries.length} 筆`}
          </span>
        </div>

        <div className="assets-filter-panel">
          <div className="assets-filter-block">
            <span className="assets-filter-label">帳戶</span>
            <div className="filter-row">
              {transactionAccountFilterOptions.map((option) => (
                <button
                  key={option.value}
                  className={accountFilter === option.value ? 'filter-chip active' : 'filter-chip'}
                  type="button"
                  onClick={() => setAccountFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="filter-total">
              {getAccountSourceLabel(accountFilter)} · {filteredEntries.length} 筆
            </p>
          </div>

          <div className="assets-filter-block">
            <span className="assets-filter-label">交易類型</span>
            <div className="filter-row">
              {transactionTypeFilterOptions.map((option) => (
                <button
                  key={option.value}
                  className={transactionTypeFilter === option.value ? 'filter-chip active' : 'filter-chip'}
                  type="button"
                  onClick={() => setTransactionTypeFilter(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <p className="filter-total">
              {transactionTypeFilter === 'all'
                ? '全部買入 / 賣出'
                : transactionTypeFilter === 'buy'
                  ? '只顯示買入'
                  : '只顯示賣出'}
              {' · '}
              {filteredEntries.length} 筆
            </p>
          </div>

          <div className="assets-filter-block">
            <span className="assets-filter-label">交易日期</span>
            <div className="asset-form-grid">
              <label className="form-field">
                <span>由</span>
                <input
                  type="date"
                  value={dateFromFilter}
                  onChange={(event) => setDateFromFilter(event.target.value)}
                />
              </label>
              <label className="form-field">
                <span>至</span>
                <input
                  type="date"
                  value={dateToFilter}
                  onChange={(event) => setDateToFilter(event.target.value)}
                />
              </label>
            </div>
            {hasActiveFilters ? (
              <button
                className="button button-secondary"
                type="button"
                onClick={() => {
                  setAccountFilter('all');
                  setTransactionTypeFilter('all');
                  setDateFromFilter('');
                  setDateToFilter('');
                }}
              >
                清除篩選
              </button>
            ) : null}
          </div>
        </div>

        <div className="settings-list">
          {filteredEntries.length > 0 ? (
            filteredEntries.map((entry) => {
              const priceComparison = comparisonsByTransactionId.get(entry.id) ?? null;
              const currentPriceHolding = comparisonHoldingsByTransactionId.get(entry.id);
              const currentPriceDisplay =
                currentPriceHolding &&
                Number.isFinite(currentPriceHolding.currentPrice) &&
                currentPriceHolding.currentPrice > 0
                  ? formatCurrency(
                      convertCurrency(
                        currentPriceHolding.currentPrice,
                        currentPriceHolding.currency,
                        displayCurrency,
                      ),
                      displayCurrency,
                    )
                  : null;
              const shouldShowPriceComparison =
                (entry.recordType ?? 'trade') === 'trade' && entry.assetType !== 'cash';
              const grossAmount = entry.quantity * entry.price;
              const grossAmountDisplay = convertCurrency(grossAmount, entry.currency, displayCurrency);
              const feesDisplay = convertCurrency(entry.fees, entry.currency, displayCurrency);
              const realizedPnlDisplay = convertCurrency(entry.realizedPnlHKD, 'HKD', displayCurrency);
              const averageCostDisplay = convertCurrency(
                entry.averageCostAfter ?? 0,
                entry.currency,
                displayCurrency,
              );
              const backingHolding = holdingsById.get(entry.assetId) ?? buildHoldingFallback(entry);
              const typeLabel =
                entry.recordType === 'asset_created'
                  ? '新增資產'
                  : entry.recordType === 'seed'
                    ? '新增資產'
                    : entry.transactionType === 'buy'
                      ? '買入'
                      : '賣出';
              return (
                <div key={entry.id} className="setting-row setting-row-wide">
                  <div>
                    <strong>
                      {entry.symbol} · {typeLabel}
                    </strong>
                    <p>
                      {entry.assetName} · {getAssetTypeLabel(entry.assetType)} · {getAccountSourceLabel(entry.accountSource)}
                    </p>
                    <p>
                      {formatTradeDate(entry.date)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                    <p className="table-hint">
                      結算 {getAccountSourceLabel(entry.settlementAccountSource ?? entry.accountSource)} ·
                      {' '}
                      持倉 {entry.quantityAfter ?? 0} · 均成本 {formatCurrency(averageCostDisplay, displayCurrency)}
                    </p>
                  </div>
                  <div className="table-metric">
                    <strong className="table-metric-primary">
                      {entry.quantity} @ {formatCurrency(convertCurrency(entry.price, entry.currency, displayCurrency), displayCurrency)}
                    </strong>
                    <span className="table-metric-secondary">
                      總額 {formatCurrency(grossAmountDisplay, displayCurrency)} · 手續費 {formatCurrency(feesDisplay, displayCurrency)}
                    </span>
                    <span className="table-metric-secondary">
                      現價 {entry.assetType === 'cash' ? '不適用' : currentPriceDisplay ?? '未有現價'}
                    </span>
                    <span className="table-metric-secondary">
                      已實現 {formatCurrency(realizedPnlDisplay, displayCurrency)}
                    </span>
                    {shouldShowPriceComparison ? (
                      priceComparison ? (
                        <span className="table-metric-secondary transaction-price-comparison">
                          <span>{priceComparison.label}</span>
                          {' '}
                          <strong data-tone={priceComparison.comparisonDisplay >= 0 ? 'positive' : 'caution'}>
                            {formatCurrency(priceComparison.comparisonDisplay, displayCurrency)}
                          </strong>
                          {priceComparison.kind === 'buy' && priceComparison.returnRate != null ? (
                            <>
                              {' · '}
                              {formatPercent(priceComparison.returnRate)}
                            </>
                          ) : null}
                          {' · '}
                          現值 {formatCurrency(priceComparison.currentValueDisplay, displayCurrency)}
                        </span>
                      ) : (
                        <span className="table-metric-secondary transaction-price-comparison">
                          現價比較：未有現價
                        </span>
                      )
                    ) : null}
                    <div className="table-action-stack">
                      <button
                        className="button button-secondary table-action-button"
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setActionSuccess(null);
                          setEditingEntry(entry);
                        }}
                      >
                        編輯
                      </button>
                    </div>
                  </div>
                  {editingEntry?.id === entry.id ? (
                    <div className="transaction-inline-form">
                      <AssetTransactionForm
                        holding={backingHolding}
                        initialValue={entry}
                        title={`編輯 ${entry.symbol} 交易`}
                        submitLabel="儲存修改"
                        deleteLabel="刪除交易"
                        onSubmit={handleEditTransaction}
                        onDelete={handleDeleteTransaction}
                        onCancel={() => {
                          setActionError(null);
                          setEditingEntry(null);
                        }}
                        isSubmitting={isSaving}
                        isDeleting={isDeleting}
                        error={actionError}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <EmptyState
              title="尚未有交易記錄"
              reason={hasActiveFilters ? '目前篩選條件下未有交易，可以放寬帳戶或日期範圍。' : '可以新增第一筆交易，或者用 AI 文字快速整理多筆交易。'}
              primaryAction={
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setIsTransactionInputOpen(true)}
                >
                  輸入交易
                </button>
              }
            />
          )}
        </div>
      </section>

      {isPriceUpdateConfirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="transaction-price-update-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">確認</p>
                <h2 id="transaction-price-update-title">確認更新現時及歷史資產價格？</h2>
              </div>
            </div>
            <p className="status-message">
              將修復 {transactionPriceUpdateDiagnostics.repairableMissingAssetCount} 個歷史資產文件，並更新現時 {transactionPriceUpdateDiagnostics.currentAssetCount} 項及歷史 {transactionPriceUpdateDiagnostics.historicalAssetUpdateCount + transactionPriceUpdateDiagnostics.repairableMissingAssetCount} 項資產價格。
            </p>
            {transactionPriceUpdateDiagnostics.blockedMissingAssets.length > 0 ? (
              <p className="status-message status-message-warning">
                以下資產因仍有持倉而被阻止：
                {' '}
                {transactionPriceUpdateDiagnostics.blockedMissingAssets
                  .map((asset) => `${asset.symbol || asset.assetName || asset.assetId}（${asset.reason}）`)
                  .join('、')}
              </p>
            ) : null}
            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={() => {
                  setIsPriceUpdateConfirmOpen(false);
                  void handleUpdateTransactionPriceComparisons();
                }}
              >
                確認更新
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsPriceUpdateConfirmOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
