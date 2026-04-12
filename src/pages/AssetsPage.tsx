import { useState } from 'react';

import { AssetInputForm } from '../components/assets/AssetInputForm';
import { AssetTransactionForm } from '../components/assets/AssetTransactionForm';
import { PriceUpdateReviewPanel } from '../components/assets/PriceUpdateReviewPanel';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAssetTransactions } from '../hooks/useAssetTransactions';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { useTodaySnapshotStatus } from '../hooks/usePortfolioSnapshots';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { callPortfolioFunction, triggerManualSnapshot } from '../lib/api/vercelFunctions';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import { hasValidHoldingPrice } from '../lib/portfolio/priceValidity';
import { HoldingsTable } from '../components/portfolio/HoldingsTable';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
  getCashFlowSignedAmount,
} from '../data/mockPortfolio';
import type {
  AccountCashFlowEntry,
  AccountSource,
  AssetType,
  DisplayCurrency,
  Holding,
  PortfolioAssetInput,
} from '../types/portfolio';
import type { PendingPriceUpdateReview, PriceUpdateRequest, PriceUpdateResponse } from '../types/priceUpdates';

const MANUAL_PRICE_UPDATE_BATCH_SIZE = 3;

const assetFilterOptions: Array<{ value: AssetType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'stock', label: '股票' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: '債券' },
  { value: 'crypto', label: '加密貨幣' },
  { value: 'cash', label: '現金' },
];

const accountFilterOptions: Array<{ value: AccountSource | 'all'; label: string }> = [
  { value: 'all', label: '全部帳戶' },
  { value: 'Futu', label: 'Futu' },
  { value: 'IB', label: 'IB' },
  { value: 'Crypto', label: 'Crypto' },
  { value: 'Other', label: '其他' },
];

function formatLatestPriceUpdate(value: string | null) {
  if (!value) {
    return '未更新';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatSnapshotCapturedAt(value?: string) {
  if (!value) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function hasPassedHongKongSnapshotDeadline(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const currentMinutes = hour * 60 + minute;

  return currentMinutes >= 23 * 60 + 30;
}

export function AssetsPage() {
  const {
    holdings: firestoreHoldings,
    status,
    error,
    isEmpty,
    editAsset,
    removeAsset,
  } = usePortfolioAssets();
  const { entries: accountPrincipals, error: accountPrincipalsError } = useAccountPrincipals();
  const { entries: accountCashFlows, error: accountCashFlowsError } = useAccountCashFlows();
  const { addTransaction, error: transactionsError } = useAssetTransactions();
  const {
    todaySnapshot,
    status: todaySnapshotStatus,
    error: todaySnapshotError,
    refresh: refreshTodaySnapshot,
  } = useTodaySnapshotStatus();
  const {
    reviews,
    error: reviewsError,
    hasPendingReviews,
    saveReviews,
    applyReviews,
    confirmReview,
    dismissReview,
  } = usePriceUpdateReviews();
  const [assetFilter, setAssetFilter] = useState<AssetType | 'all'>('all');
  const [accountFilter, setAccountFilter] = useState<AccountSource | 'all'>('all');
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('USD');
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [tradingHolding, setTradingHolding] = useState<Holding | null>(null);
  const [isEditingAsset, setIsEditingAsset] = useState(false);
  const [isSavingTransaction, setIsSavingTransaction] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [transactionError, setTransactionError] = useState<string | null>(null);
  const [transactionSuccess, setTransactionSuccess] = useState<string | null>(null);
  const [isUpdatingAllPrices, setIsUpdatingAllPrices] = useState(false);
  const [isBulkUpdateConfirmOpen, setIsBulkUpdateConfirmOpen] = useState(false);
  const [updatingAssetIds, setUpdatingAssetIds] = useState<string[]>([]);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);
  const [priceUpdateSuccess, setPriceUpdateSuccess] = useState<string | null>(null);
  const [confirmingAssetIds, setConfirmingAssetIds] = useState<string[]>([]);
  const [dismissingAssetIds, setDismissingAssetIds] = useState<string[]>([]);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);
  const [isGeneratingManualSnapshot, setIsGeneratingManualSnapshot] = useState(false);
  const [manualSnapshotError, setManualSnapshotError] = useState<string | null>(null);
  const [manualSnapshotSuccess, setManualSnapshotSuccess] = useState<string | null>(null);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );

  const filteredHoldings = holdings.filter((holding) => {
    const matchesAssetType = assetFilter === 'all' || holding.assetType === assetFilter;
    const matchesAccount = accountFilter === 'all' || holding.accountSource === accountFilter;

    return matchesAssetType && matchesAccount;
  });

  const nonCashHoldings = holdings.filter((holding) => holding.assetType !== 'cash');
  const todayKey = getHongKongDateKey();
  const todayUpdatedCount = nonCashHoldings.filter((holding) => {
    if (!hasValidHoldingPrice(holding) || !holding.lastPriceUpdatedAt) {
      return false;
    }

    return getHongKongDateKey(new Date(holding.lastPriceUpdatedAt)) === todayKey;
  }).length;
  const pendingPriceCount = holdings.filter(
    (holding) => holding.assetType !== 'cash' && !hasValidHoldingPrice(holding),
  ).length;
  const latestValidPriceUpdate =
    holdings
      .map((holding) => holding.lastPriceUpdatedAt || '')
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const filteredValue = filteredHoldings.reduce(
    (sum, holding) => sum + getHoldingValueInCurrency(holding, displayCurrency),
    0,
  );
  const assetTypeValue = holdings
    .filter((holding) => assetFilter === 'all' || holding.assetType === assetFilter)
    .reduce(
      (sum, holding) => sum + getHoldingValueInCurrency(holding, displayCurrency),
      0,
    );
  const accountValue = holdings
    .filter((holding) => accountFilter === 'all' || holding.accountSource === accountFilter)
    .reduce(
      (sum, holding) => sum + getHoldingValueInCurrency(holding, displayCurrency),
      0,
    );
  const filteredCost = filteredHoldings.reduce(
    (sum, holding) => sum + getHoldingCostInCurrency(holding, displayCurrency),
    0,
  );
  const principalEntries =
    accountFilter === 'all'
      ? accountPrincipals
      : accountPrincipals.filter((entry) => entry.accountSource === accountFilter);
  const cashFlowEntries =
    accountFilter === 'all'
      ? accountCashFlows
      : accountCashFlows.filter((entry) => entry.accountSource === accountFilter);
  const filteredPrincipal =
    principalEntries.reduce(
      (sum, entry) =>
        sum + convertCurrency(entry.principalAmount, entry.currency, displayCurrency),
      0,
    ) +
    cashFlowEntries.reduce(
      (sum, entry) =>
        sum +
        convertCurrency(
          getCashFlowSignedAmount(entry),
          entry.currency,
          displayCurrency,
        ),
      0,
    );
  const filteredPnl = filteredValue - filteredPrincipal;
  const latestUpdateLabel = formatLatestPriceUpdate(latestValidPriceUpdate);
  const syncedCoveragePct =
    nonCashHoldings.length === 0
      ? 0
      : Math.round((todayUpdatedCount / nonCashHoldings.length) * 100);
  const coverageLabel =
    nonCashHoldings.length === 0 ? '未有可更新資產' : `${syncedCoveragePct}% 今日已同步`;
  const activeFilterLabel = `${getAssetTypeLabel(assetFilter)} · ${getAccountSourceLabel(accountFilter)}`;
  const snapshotStatusLabel =
    nonCashHoldings.length === 0
      ? '未有非現金資產，毋須快照檢查'
      : todaySnapshot.exists
        ? todaySnapshot.quality === 'fallback'
          ? `今日快照已完成（部分資產沿用昨日價格）${todaySnapshot.capturedAt ? ` · ${formatSnapshotCapturedAt(todaySnapshot.capturedAt)}` : ''}`
          : `今日快照已完成 · 正式快照${todaySnapshot.capturedAt ? ` · ${formatSnapshotCapturedAt(todaySnapshot.capturedAt)}` : ''}`
        : '今日快照將於 07:00 自動生成';
  const shouldShowMissingSnapshotNotice =
    todaySnapshotStatus === 'ready' &&
    nonCashHoldings.length > 0 &&
    !todaySnapshot.exists &&
    hasPassedHongKongSnapshotDeadline();

  async function handleTriggerManualSnapshot() {
    setManualSnapshotError(null);
    setManualSnapshotSuccess(null);
    setIsGeneratingManualSnapshot(true);

    try {
      const result = (await triggerManualSnapshot()) as {
        ok?: boolean;
        skipped?: boolean;
        message?: string;
      };

      if (result.skipped) {
        setManualSnapshotError(result.message ?? '今日快照仍未能補生成。');
        return;
      }

      setManualSnapshotSuccess(result.message ?? '已補生成今日快照。');
      await refreshTodaySnapshot();
    } catch (error) {
      setManualSnapshotError(
        error instanceof Error ? error.message : '補生成今日快照失敗，請稍後再試。',
      );
    } finally {
      setIsGeneratingManualSnapshot(false);
    }
  }

  async function handleEditHolding(payload: PortfolioAssetInput) {
    if (!editingHolding) {
      return;
    }

    setIsEditingAsset(true);
    setSaveError(null);

    try {
      await editAsset(editingHolding.id, payload);
      setEditingHolding(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '更新資產失敗，請稍後再試。';
      setSaveError(message);
    } finally {
      setIsEditingAsset(false);
    }
  }

  async function handleDeleteHolding() {
    if (!editingHolding) {
      return;
    }

    setIsDeletingAsset(true);
    setSaveError(null);

    try {
      await removeAsset(editingHolding.id);
      setIsDeleteConfirmOpen(false);
      setEditingHolding(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '刪除資產失敗，請稍後再試。';
      setSaveError(message);
    } finally {
      setIsDeletingAsset(false);
    }
  }

  async function handleCreateTransaction(
    payload: Parameters<typeof addTransaction>[0],
  ) {
    setIsSavingTransaction(true);
    setTransactionError(null);

    try {
      await addTransaction(payload);
      setTradingHolding(null);
      setTransactionSuccess(`${payload.symbol} 交易已儲存。`);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '儲存交易失敗，請稍後再試。';
      setTransactionError(message);
    } finally {
      setIsSavingTransaction(false);
    }
  }

  function buildPriceUpdateRequest(targetHoldings: Holding[]): PriceUpdateRequest {
    return {
      assets: targetHoldings.map((holding) => ({
        assetId: holding.id,
        assetName: holding.name,
        ticker: holding.symbol,
        assetType: holding.assetType,
        currentPrice: holding.currentPrice,
        currency: holding.currency,
      })),
    };
  }

  function chunkHoldingsForManualUpdate(targetHoldings: Holding[]) {
    const chunks: Holding[][] = [];

    for (let index = 0; index < targetHoldings.length; index += MANUAL_PRICE_UPDATE_BATCH_SIZE) {
      chunks.push(targetHoldings.slice(index, index + MANUAL_PRICE_UPDATE_BATCH_SIZE));
    }

    return chunks;
  }

  async function handleRunPriceUpdates(targetHoldings: Holding[]) {
    if (targetHoldings.length === 0) {
      setPriceUpdateError('目前沒有可更新的資產。');
      return;
    }

    const targetIds = targetHoldings.map((holding) => holding.id);
    const isBulkUpdate = targetHoldings.length > 1;

    setPriceUpdateError(null);
    setPriceUpdateSuccess(null);
    setReviewActionError(null);
    setReviewActionSuccess(null);

    if (isBulkUpdate) {
      setIsUpdatingAllPrices(true);
    } else {
      setUpdatingAssetIds((current) => [...new Set([...current, ...targetIds])]);
    }

    try {
      const chunks = chunkHoldingsForManualUpdate(targetHoldings);
      const responses: PriceUpdateResponse[] = [];

      for (const chunk of chunks) {
        const response = (await callPortfolioFunction(
          'update-prices',
          buildPriceUpdateRequest(chunk),
        )) as PriceUpdateResponse;
        responses.push(response);
      }

      const mergedResults = responses.flatMap((response) => response.results);
      const validResults = mergedResults.filter(
        (review) => review.price != null && review.price > 0 && !review.invalidReason,
      );
      const invalidResults = mergedResults.filter(
        (review) => review.price == null || review.price <= 0 || Boolean(review.invalidReason),
      );

      if (validResults.length > 0) {
        await applyReviews(validResults);
      }

      await saveReviews(invalidResults);

      if (validResults.length > 0 && invalidResults.length > 0) {
        setPriceUpdateSuccess(
          `已自動更新 ${validResults.length} 項資產；${invalidResults.length} 項需要人工確認。`,
        );
      } else if (validResults.length > 0) {
        setPriceUpdateSuccess(`已自動更新 ${validResults.length} 項資產價格。`);
      } else if (invalidResults.length > 0) {
        setPriceUpdateSuccess(`現有 ${invalidResults.length} 項需要人工確認。`);
      } else {
        setPriceUpdateSuccess('今次沒有可套用的價格更新。');
      }
    } catch (error) {
      setPriceUpdateError(
        error instanceof Error ? error.message : '價格更新失敗，請稍後再試。',
      );
    } finally {
      if (isBulkUpdate) {
        setIsUpdatingAllPrices(false);
      }
      setUpdatingAssetIds((current) => current.filter((id) => !targetIds.includes(id)));
    }
  }

  async function handleConfirmBulkPriceUpdate() {
    setIsBulkUpdateConfirmOpen(false);
    await handleRunPriceUpdates(nonCashHoldings);
  }

  async function handleConfirmReview(review: PendingPriceUpdateReview) {
    setReviewActionError(null);
    setReviewActionSuccess(null);
    setConfirmingAssetIds((current) => [...current, review.assetId]);

    try {
      await confirmReview(review);
      setReviewActionSuccess(`已確認 ${review.ticker} 的新價格，正式資產價格已更新。`);
    } catch (error) {
      setReviewActionError(
        error instanceof Error ? error.message : '確認價格更新失敗，請稍後再試。',
      );
    } finally {
      setConfirmingAssetIds((current) => current.filter((id) => id !== review.assetId));
    }
  }

  async function handleDismissReview(assetId: string) {
    setReviewActionError(null);
    setReviewActionSuccess(null);
    setDismissingAssetIds((current) => [...current, assetId]);

    try {
      await dismissReview(assetId);
      setReviewActionSuccess('已略過這次價格更新。');
    } catch (error) {
      setReviewActionError(
        error instanceof Error ? error.message : '略過價格更新失敗，請稍後再試。',
      );
    } finally {
      setDismissingAssetIds((current) => current.filter((id) => id !== assetId));
    }
  }

  return (
    <div className="page-stack">
      <section className="hero-panel assets-toolbar assets-toolbar-hero">
        <div className="assets-toolbar-top">
          <span className="assets-toolbar-subtle">
            {filteredHoldings.length} 項 · {activeFilterLabel}
          </span>
        </div>
        <div className="assets-price-status" aria-label="價格更新狀態">
          <span className="assets-price-status-label">更新價格</span>
          <span className="assets-price-status-item">最近 {latestUpdateLabel}</span>
          <span className="assets-price-status-item">{coverageLabel}</span>
          <span className="assets-price-status-item">待更新 {pendingPriceCount}</span>
          {hasPendingReviews ? (
            <span className="assets-price-status-item">待處理 {reviews.length}</span>
          ) : null}
        </div>
        <div className="assets-toolbar-actions">
          <div className="currency-toggle" role="group" aria-label="選擇顯示貨幣">
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
            <button
              className={displayCurrency === 'HKD' ? 'currency-toggle-button active' : 'currency-toggle-button'}
              type="button"
              onClick={() => setDisplayCurrency('HKD')}
            >
              HKD
            </button>
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => setIsBulkUpdateConfirmOpen(true)}
            disabled={isUpdatingAllPrices || nonCashHoldings.length === 0}
          >
            {isUpdatingAllPrices ? '更新全部資產中...' : '更新全部資產'}
          </button>
        </div>
        <div className="assets-toolbar-footnote" aria-label="更新提示">
          <span>{coverageLabel}</span>
          <span>·</span>
          <span>{snapshotStatusLabel}</span>
        </div>
      </section>

      {isBulkUpdateConfirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-price-update-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Confirm</p>
                <h2 id="bulk-price-update-title">確認更新全部資產？</h2>
              </div>
            </div>
            <p className="status-message">
              會為目前全部 {nonCashHoldings.length} 項非現金資產檢查最新價格；有效結果會直接寫入，未能確認嘅項目先會保留畀你再檢查。
            </p>
            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={handleConfirmBulkPriceUpdate}
              >
                確認更新
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsBulkUpdateConfirmOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="summary-cluster">
        <div className="summary-grid summary-grid-primary">
          <SummaryCard
            label={`總資產 ${displayCurrency}`}
            value={formatCurrencyRounded(filteredValue, displayCurrency)}
            hint={`${filteredHoldings.length} 項 · ${activeFilterLabel}`}
          />
          <SummaryCard
            label={`本金損益 ${displayCurrency}`}
            value={formatCurrencyRounded(filteredPnl, displayCurrency)}
            hint={`本金 ${formatCurrency(filteredPrincipal, displayCurrency)}`}
            tone={filteredPnl > 0 ? 'positive' : filteredPnl < 0 ? 'caution' : 'default'}
          />
        </div>
        <div className="summary-grid summary-grid-secondary">
          <SummaryCard
            label="更新狀態"
            value={coverageLabel}
            hint={
              hasPendingReviews
                ? `待處理 ${reviews.length} 項`
                : pendingPriceCount > 0
                  ? `待更新 ${pendingPriceCount} 項`
                  : `成本 ${formatCurrency(filteredCost, displayCurrency)}`
            }
            tone={pendingPriceCount > 0 || hasPendingReviews ? 'caution' : 'positive'}
          />
        </div>
      </section>

      {editingHolding ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <AssetInputForm
              initialValue={{
                name: editingHolding.name,
                symbol: editingHolding.symbol,
                assetType: editingHolding.assetType,
                accountSource: editingHolding.accountSource,
                currency: editingHolding.currency,
                quantity: editingHolding.quantity,
                averageCost: editingHolding.averageCost,
                currentPrice: editingHolding.currentPrice,
              }}
              title={`編輯 ${editingHolding.symbol}`}
              submitLabel="儲存變更"
              cancelLabel="關閉"
              deleteLabel="刪除資產"
              onSubmit={handleEditHolding}
              onDelete={() => setIsDeleteConfirmOpen(true)}
              onCancel={() => {
                setSaveError(null);
                setIsDeleteConfirmOpen(false);
                setEditingHolding(null);
              }}
              isSubmitting={isEditingAsset}
              isDeleting={isDeletingAsset}
              error={saveError}
            />
          </div>
        </div>
      ) : null}

      {tradingHolding ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <AssetTransactionForm
              holding={tradingHolding}
              onSubmit={handleCreateTransaction}
              onCancel={() => {
                setTransactionError(null);
                setTradingHolding(null);
              }}
              isSubmitting={isSavingTransaction}
              error={transactionError}
            />
          </div>
        </div>
      ) : null}

      {isDeleteConfirmOpen && editingHolding ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-asset-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">Warning</p>
                <h2 id="delete-asset-title">是否刪除資產？</h2>
              </div>
            </div>
            <p className="status-message status-message-error">
              會刪除 {editingHolding.name} ({editingHolding.symbol})。
            </p>
            <div className="button-row">
              <button
                className="button button-secondary button-danger-text"
                type="button"
                onClick={handleDeleteHolding}
                disabled={isDeletingAsset}
              >
                {isDeletingAsset ? '刪除中...' : '確認刪除'}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={isDeletingAsset}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {priceUpdateError ? (
        <p className="status-message status-message-error">{priceUpdateError}</p>
      ) : null}
      {accountPrincipalsError ? (
        <p className="status-message status-message-error">{accountPrincipalsError}</p>
      ) : null}
      {accountCashFlowsError ? (
        <p className="status-message status-message-error">{accountCashFlowsError}</p>
      ) : null}
      {priceUpdateSuccess ? (
        <p className="status-message status-message-success">{priceUpdateSuccess}</p>
      ) : null}
      {transactionSuccess ? (
        <p className="status-message status-message-success">{transactionSuccess}</p>
      ) : null}
      {reviewsError ? (
        <p className="status-message status-message-error">{reviewsError}</p>
      ) : null}
      {todaySnapshotError ? (
        <p className="status-message status-message-error">{todaySnapshotError}</p>
      ) : null}
      {transactionsError && !transactionError ? (
        <p className="status-message status-message-error">{transactionsError}</p>
      ) : null}
      {shouldShowMissingSnapshotNotice ? (
        <div className="status-message status-message-error">
          <p>今日快照未能自動生成，建議手動補生成以確保走勢數據完整。</p>
          <div className="button-row">
            <button
              className="button button-secondary"
              type="button"
              onClick={handleTriggerManualSnapshot}
              disabled={isGeneratingManualSnapshot}
            >
              {isGeneratingManualSnapshot ? '生成中...' : '補生成今日快照'}
            </button>
          </div>
        </div>
      ) : null}
      {manualSnapshotError ? (
        <p className="status-message status-message-error">{manualSnapshotError}</p>
      ) : null}
      {manualSnapshotSuccess ? (
        <p className="status-message status-message-success">{manualSnapshotSuccess}</p>
      ) : null}

      <PriceUpdateReviewPanel
        reviews={reviews}
        onConfirm={handleConfirmReview}
        onDismiss={handleDismissReview}
        confirmingAssetIds={confirmingAssetIds}
        dismissingAssetIds={dismissingAssetIds}
        actionError={reviewActionError}
        actionSuccess={reviewActionSuccess}
      />

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Holdings List</p>
            <h2>全部持倉</h2>
          </div>
          <span className={status === 'error' ? 'chip chip-strong' : 'chip chip-soft'}>
            {status === 'loading'
              ? 'Firestore 同步中'
              : status === 'error'
                ? 'Firestore 讀取失敗'
                : 'Firestore 已連接'}
          </span>
        </div>

        {error ? <p className="status-message status-message-error">{error}</p> : null}
        {isEmpty ? (
          <p className="status-message">未有資產。</p>
        ) : null}

        <div className="assets-filter-toggle-row">
          <button
            className={isFilterPanelOpen ? 'filter-chip active' : 'filter-chip'}
            type="button"
            onClick={() => setIsFilterPanelOpen((current) => !current)}
          >
            {isFilterPanelOpen ? '收起篩選' : '展開篩選'}
          </button>
          <p className="filter-total">
            {getAssetTypeLabel(assetFilter)} · {getAccountSourceLabel(accountFilter)}
          </p>
        </div>

        {isFilterPanelOpen ? (
          <div className="assets-filter-panel">
            <div className="assets-filter-block">
              <span className="assets-filter-label">資產類別</span>
              <div className="filter-row">
                {assetFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={assetFilter === option.value ? 'filter-chip active' : 'filter-chip'}
                    type="button"
                    onClick={() => setAssetFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="filter-total">
                {getAssetTypeLabel(assetFilter)} · {formatCurrencyRounded(assetTypeValue, displayCurrency)}
              </p>
            </div>

            <div className="assets-filter-block">
              <span className="assets-filter-label">帳戶來源</span>
              <div className="filter-row">
                {accountFilterOptions.map((option) => (
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
                {getAccountSourceLabel(accountFilter)} · {formatCurrencyRounded(accountValue, displayCurrency)}
              </p>
            </div>
          </div>
        ) : null}

        <HoldingsTable
          holdings={filteredHoldings}
          displayCurrency={displayCurrency}
          onEdit={(holding) => {
            setSaveError(null);
            setEditingHolding(holding);
          }}
          onTrade={(holding) => {
            setTransactionSuccess(null);
            setTransactionError(null);
            setTradingHolding(holding);
          }}
          onUpdatePrice={(holding) => handleRunPriceUpdates([holding])}
          updatingAssetIds={updatingAssetIds}
        />
      </section>
    </div>
  );
}
