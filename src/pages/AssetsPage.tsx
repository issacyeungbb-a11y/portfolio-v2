import { useState } from 'react';

import {
  AssetInputForm,
} from '../components/assets/AssetInputForm';
import { PriceUpdateReviewPanel } from '../components/assets/PriceUpdateReviewPanel';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import { hasValidHoldingPrice } from '../lib/portfolio/priceValidity';
import { HoldingsTable } from '../components/portfolio/HoldingsTable';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  formatCurrency,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
} from '../data/mockPortfolio';
import type {
  AccountSource,
  AssetType,
  DisplayCurrency,
  Holding,
  PortfolioAssetInput,
} from '../types/portfolio';
import type { PendingPriceUpdateReview, PriceUpdateRequest, PriceUpdateResponse } from '../types/priceUpdates';

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

export function AssetsPage() {
  const {
    holdings: firestoreHoldings,
    status,
    error,
    isEmpty,
    addAsset,
    editAsset,
  } = usePortfolioAssets();
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
  const [displayCurrency, setDisplayCurrency] = useState<DisplayCurrency>('HKD');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [isEditingAsset, setIsEditingAsset] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isUpdatingAllPrices, setIsUpdatingAllPrices] = useState(false);
  const [isBulkUpdateConfirmOpen, setIsBulkUpdateConfirmOpen] = useState(false);
  const [updatingAssetIds, setUpdatingAssetIds] = useState<string[]>([]);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);
  const [priceUpdateSuccess, setPriceUpdateSuccess] = useState<string | null>(null);
  const [confirmingAssetIds, setConfirmingAssetIds] = useState<string[]>([]);
  const [dismissingAssetIds, setDismissingAssetIds] = useState<string[]>([]);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );

  const filteredHoldings = holdings.filter((holding) => {
    const matchesAssetType = assetFilter === 'all' || holding.assetType === assetFilter;
    const matchesAccount = accountFilter === 'all' || holding.accountSource === accountFilter;

    return matchesAssetType && matchesAccount;
  });

  const accountCount = new Set(holdings.map((holding) => holding.accountSource)).size;
  const nonCashHoldings = holdings.filter((holding) => holding.assetType !== 'cash');
  const pricedHoldingsCount = nonCashHoldings.filter((holding) => hasValidHoldingPrice(holding)).length;
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
  const filteredPnl = filteredValue - filteredCost;
  const staleRatio =
    nonCashHoldings.length === 0 ? 0 : Math.round((pendingPriceCount / nonCashHoldings.length) * 100);
  const latestUpdateLabel = formatLatestPriceUpdate(latestValidPriceUpdate);

  async function handleAddHolding(payload: PortfolioAssetInput) {
    setIsSavingAsset(true);
    setSaveError(null);

    try {
      await addAsset(payload);
      setAssetFilter('all');
      setAccountFilter('all');
      setIsFormOpen(false);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '儲存資產失敗，請稍後再試。';
      setSaveError(message);
      throw submissionError instanceof Error
        ? submissionError
        : new Error(message);
    } finally {
      setIsSavingAsset(false);
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
      throw submissionError instanceof Error
        ? submissionError
        : new Error(message);
    } finally {
      setIsEditingAsset(false);
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
      const response = (await callPortfolioFunction(
        'update-prices',
        buildPriceUpdateRequest(targetHoldings),
      )) as PriceUpdateResponse;
      const validResults = response.results.filter(
        (review) => review.price != null && review.price > 0 && !review.invalidReason,
      );
      const invalidResults = response.results.filter(
        (review) => review.price == null || review.price <= 0 || Boolean(review.invalidReason),
      );

      if (validResults.length > 0) {
        await applyReviews(validResults);
      }

      await saveReviews(invalidResults);

      if (validResults.length > 0 && invalidResults.length > 0) {
        setPriceUpdateSuccess(
          `已自動更新 ${validResults.length} 項資產；${invalidResults.length} 項未能自動更新，請再檢查。`,
        );
      } else if (validResults.length > 0) {
        setPriceUpdateSuccess(`已自動更新 ${validResults.length} 項資產價格。`);
      } else if (invalidResults.length > 0) {
        setPriceUpdateSuccess(`未能自動更新，現有 ${invalidResults.length} 項需要檢查。`);
      } else {
        setPriceUpdateSuccess('今次沒有可套用的價格更新。');
      }
    } catch (error) {
      setPriceUpdateError(
        error instanceof Error ? error.message : 'AI 價格更新失敗，請稍後再試。',
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
    await handleRunPriceUpdates(holdings);
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
      setReviewActionSuccess('已略過這次 AI 價格更新。');
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
      <section className="hero-panel">
        <div className="assets-hero-header">
          <div>
            <p className="eyebrow">Assets</p>
            <div className="assets-title-row">
              <h2>手動管理資產</h2>
              <div className="assets-price-status" aria-label="價格更新狀態">
                <span className="assets-price-status-label">更新價格</span>
                <span className="assets-price-status-item">最近 {latestUpdateLabel}</span>
                <span className="assets-price-status-item">
                  已同步 {pricedHoldingsCount}/{nonCashHoldings.length || 0}
                </span>
                <span className="assets-price-status-item">待更新 {pendingPriceCount}</span>
                {hasPendingReviews ? (
                  <span className="assets-price-status-item">待處理 {reviews.length}</span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
        <div className="button-row">
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
          </div>
          <button
            className="button button-primary"
            type="button"
            onClick={() => {
              setSaveError(null);
              setIsFormOpen((current) => !current);
            }}
          >
            {isFormOpen ? '收起輸入表單' : '新增資產'}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setIsBulkUpdateConfirmOpen(true)}
            disabled={isUpdatingAllPrices || holdings.length === 0}
          >
            {isUpdatingAllPrices ? '更新全部資產中...' : '更新全部資產'}
          </button>
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
              會為目前全部 {holdings.length} 項資產檢查最新價格；有效結果會直接寫入，未能確認嘅項目先會保留畀你再檢查。
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

      <section className="summary-grid">
        <SummaryCard
          label="顯示結果"
          value={`${filteredHoldings.length} 項`}
          hint={
            status === 'loading'
              ? '正在從 Firestore 同步資產資料'
              : `篩選後總值 ${formatCurrency(filteredValue, displayCurrency)}`
          }
        />
        <SummaryCard
          label={`資產類別總值 ${displayCurrency}`}
          value={formatCurrency(assetTypeValue, displayCurrency)}
          hint={`目前選擇：${getAssetTypeLabel(assetFilter)}`}
        />
        <SummaryCard
          label={`篩選損益 ${displayCurrency}`}
          value={formatCurrency(filteredPnl, displayCurrency)}
          hint={
            hasPendingReviews
              ? `待處理 ${reviews.length} 項，價格覆蓋率 ${100 - staleRatio}%`
              : pendingPriceCount > 0
                ? `待更新 ${pendingPriceCount} 項，價格覆蓋率 ${100 - staleRatio}%`
                : `共 ${accountCount} 類帳戶來源`
          }
          tone={filteredPnl > 0 ? 'positive' : filteredPnl < 0 ? 'caution' : 'default'}
        />
      </section>

      {isFormOpen ? (
        <AssetInputForm
          onSubmit={handleAddHolding}
          onCancel={() => setIsFormOpen(false)}
          isSubmitting={isSavingAsset}
          error={saveError}
        />
      ) : null}

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
              onSubmit={handleEditHolding}
              onCancel={() => {
                setSaveError(null);
                setEditingHolding(null);
              }}
              isSubmitting={isEditingAsset}
              error={saveError}
            />
          </div>
        </div>
      ) : null}

      {priceUpdateError ? (
        <p className="status-message status-message-error">{priceUpdateError}</p>
      ) : null}
      {priceUpdateSuccess ? (
        <p className="status-message status-message-success">{priceUpdateSuccess}</p>
      ) : null}
      {reviewsError ? (
        <p className="status-message status-message-error">{reviewsError}</p>
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
          資產類別總值: {getAssetTypeLabel(assetFilter)} ·{' '}
          {formatCurrency(assetTypeValue, displayCurrency)}
        </p>

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
          帳戶來源總值: {getAccountSourceLabel(accountFilter)} ·{' '}
          {formatCurrency(accountValue, displayCurrency)}
        </p>

        <HoldingsTable
          holdings={filteredHoldings}
          displayCurrency={displayCurrency}
          onEdit={(holding) => {
            setSaveError(null);
            setEditingHolding(holding);
          }}
          onUpdatePrice={(holding) => handleRunPriceUpdates([holding])}
          updatingAssetIds={updatingAssetIds}
        />
      </section>
    </div>
  );
}
