import { useState } from 'react';

import {
  AssetInputForm,
} from '../components/assets/AssetInputForm';
import { PriceUpdateReviewPanel } from '../components/assets/PriceUpdateReviewPanel';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { callPortfolioFunction } from '../lib/api/vercelFunctions';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import { HoldingsTable } from '../components/portfolio/HoldingsTable';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import {
  formatCurrency,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingValueInCurrency,
  mockPortfolio,
} from '../data/mockPortfolio';
import type {
  AccountSource,
  AssetType,
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

export function AssetsPage() {
  const {
    holdings: firestoreHoldings,
    status,
    error,
    isEmpty,
    addAsset,
  } = usePortfolioAssets();
  const {
    reviews,
    error: reviewsError,
    hasPendingReviews,
    saveReviews,
    confirmReview,
    dismissReview,
  } = usePriceUpdateReviews();
  const [assetFilter, setAssetFilter] = useState<AssetType | 'all'>('all');
  const [accountFilter, setAccountFilter] = useState<AccountSource | 'all'>('all');
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSavingAsset, setIsSavingAsset] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isUpdatingAllPrices, setIsUpdatingAllPrices] = useState(false);
  const [updatingAssetIds, setUpdatingAssetIds] = useState<string[]>([]);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);
  const [priceUpdateSuccess, setPriceUpdateSuccess] = useState<string | null>(null);
  const [confirmingAssetIds, setConfirmingAssetIds] = useState<string[]>([]);
  const [dismissingAssetIds, setDismissingAssetIds] = useState<string[]>([]);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
  );

  const filteredHoldings = holdings.filter((holding) => {
    const matchesAssetType = assetFilter === 'all' || holding.assetType === assetFilter;
    const matchesAccount = accountFilter === 'all' || holding.accountSource === accountFilter;

    return matchesAssetType && matchesAccount;
  });

  const accountCount = new Set(holdings.map((holding) => holding.accountSource)).size;
  const filteredValue = filteredHoldings.reduce(
    (sum, holding) => sum + getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
    0,
  );
  const assetTypeValue = holdings
    .filter((holding) => assetFilter === 'all' || holding.assetType === assetFilter)
    .reduce(
      (sum, holding) => sum + getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
      0,
    );
  const accountValue = holdings
    .filter((holding) => accountFilter === 'all' || holding.accountSource === accountFilter)
    .reduce(
      (sum, holding) => sum + getHoldingValueInCurrency(holding, mockPortfolio.baseCurrency),
      0,
    );

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

      await saveReviews(response.results);
      setPriceUpdateSuccess(`已產生 ${response.results.length} 項待確認價格更新，請先檢查再確認。`);
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
        <div>
          <p className="eyebrow">Assets</p>
          <h2>手動管理資產</h2>
        </div>
        <div className="button-row">
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
            onClick={() => handleRunPriceUpdates(holdings)}
            disabled={isUpdatingAllPrices || holdings.length === 0}
          >
            {isUpdatingAllPrices ? '更新全部資產中...' : '更新全部資產'}
          </button>
        </div>
      </section>

      <section className="summary-grid">
        <SummaryCard
          label="顯示結果"
          value={`${filteredHoldings.length} 項`}
          hint={
            status === 'loading'
              ? '正在從 Firestore 同步資產資料'
              : `篩選後總值 ${formatCurrency(filteredValue, mockPortfolio.baseCurrency)}`
          }
        />
        <SummaryCard
          label="資產類別總值"
          value={formatCurrency(assetTypeValue, mockPortfolio.baseCurrency)}
          hint={`目前選擇：${getAssetTypeLabel(assetFilter)}`}
        />
        <SummaryCard
          label="帳戶來源總值"
          value={formatCurrency(accountValue, mockPortfolio.baseCurrency)}
          hint={
            hasPendingReviews
              ? `目前有 ${reviews.length} 項待確認價格更新，共 ${accountCount} 類帳戶來源`
              : `目前選擇：${getAccountSourceLabel(accountFilter)}，共 ${accountCount} 類帳戶來源`
          }
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
            <p className="table-hint">
              改為 Firestore 同步模式。手機可左右滑動睇齊全部欄位，新輸入的資產會即時同步返資料庫。
            </p>
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
          <p className="status-message">
            你而家仲未有已儲存資產，可以先用上面表單新增第一筆資料。
          </p>
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
          {formatCurrency(assetTypeValue, mockPortfolio.baseCurrency)}
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
          {formatCurrency(accountValue, mockPortfolio.baseCurrency)}
        </p>

        <HoldingsTable
          holdings={filteredHoldings}
          onUpdatePrice={(holding) => handleRunPriceUpdates([holding])}
          updatingAssetIds={updatingAssetIds}
        />
      </section>
    </div>
  );
}
