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
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
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

function formatPercent(value: number) {
  return `${(value * 100).toLocaleString('zh-HK', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

interface TransactionPriceComparison {
  entry: AssetTransactionEntry;
  kind: 'buy' | 'sell';
  label: '買入至今' | '賣後比較';
  currentPrice: number;
  currentValueDisplay: number;
  basisDisplay: number;
  comparisonDisplay: number;
  returnRate?: number;
}

function getTransactionPriceComparison(
  entry: AssetTransactionEntry,
  holding: Holding | undefined,
  displayCurrency: DisplayCurrency,
): TransactionPriceComparison | null {
  if ((entry.recordType ?? 'trade') !== 'trade' || entry.assetType === 'cash') {
    return null;
  }

  if (!holding || !Number.isFinite(holding.currentPrice) || holding.currentPrice <= 0) {
    return null;
  }

  const currentValueDisplay = convertCurrency(
    entry.quantity * holding.currentPrice,
    holding.currency,
    displayCurrency,
  );

  if (entry.transactionType === 'buy') {
    const costDisplay = convertCurrency(
      entry.quantity * entry.price + entry.fees,
      entry.currency,
      displayCurrency,
    );
    const comparisonDisplay = currentValueDisplay - costDisplay;

    return {
      entry,
      kind: 'buy',
      label: '買入至今',
      currentPrice: holding.currentPrice,
      currentValueDisplay,
      basisDisplay: costDisplay,
      comparisonDisplay,
      returnRate: costDisplay > 0 ? comparisonDisplay / costDisplay : undefined,
    };
  }

  const proceedsDisplay = convertCurrency(
    entry.quantity * entry.price - entry.fees,
    entry.currency,
    displayCurrency,
  );

  return {
    entry,
    kind: 'sell',
    label: '賣後比較',
    currentPrice: holding.currentPrice,
    currentValueDisplay,
    basisDisplay: proceedsDisplay,
    comparisonDisplay: proceedsDisplay - currentValueDisplay,
  };
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
  const comparisonsByTransactionId = useMemo(
    () =>
      new Map(
        filteredEntries.map((entry) => [
          entry.id,
          getTransactionPriceComparison(entry, holdingsById.get(entry.assetId), displayCurrency),
        ]),
      ),
    [displayCurrency, filteredEntries, holdingsById],
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
    const involvedAssetIds = new Set(
      filteredEntries
        .filter((entry) => (entry.recordType ?? 'trade') === 'trade' && entry.assetType !== 'cash')
        .map((entry) => entry.assetId),
    );

    return holdings.filter((holding) => holding.assetType !== 'cash' && involvedAssetIds.has(holding.id));
  }, [filteredEntries, holdings]);
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
    await runPriceUpdates(transactionPriceUpdateHoldings);
  }

  return (
    <div className="page-stack">
      {error ? <p className="status-message status-message-error">{error}</p> : null}
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
            onClick={() => void handleUpdateTransactionPriceComparisons()}
            disabled={isUpdatingTransactionPrices || transactionPriceUpdateHoldings.length === 0}
          >
            {isUpdatingTransactionPrices ? '更新中...' : '更新交易現價比較'}
          </button>
        </div>
        <div className="summary-grid">
          <article className="summary-card">
            <p className="summary-label">記錄總數</p>
            <strong className="summary-value">{filteredEntries.length}</strong>
            <p className="summary-hint">
              {hasActiveFilters ? `已篩選自 ${visibleEntries.length} 筆記錄` : '包括建倉記錄與買入 / 賣出交易'}
            </p>
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
          <article className="summary-card">
            <p className="summary-label">買入至今合計</p>
            <strong
              className="summary-value"
              data-tone={buyComparisonTotal >= 0 ? 'positive' : 'caution'}
            >
              {formatCurrencyRounded(buyComparisonTotal, displayCurrency)}
            </strong>
            <p className="summary-hint">
              {buyComparisons.length} 筆有現價買入交易
            </p>
          </article>
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
    </div>
  );
}
