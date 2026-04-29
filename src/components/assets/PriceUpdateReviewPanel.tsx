import { useState } from 'react';

import {
  formatCurrency,
  formatPercent,
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../../data/mockPortfolio';
import type { PendingPriceUpdateReview } from '../../types/priceUpdates';

interface PriceUpdateReviewPanelProps {
  reviews: PendingPriceUpdateReview[];
  onConfirm: (review: PendingPriceUpdateReview) => Promise<void> | void;
  onDismiss: (assetId: string) => Promise<void> | void;
  onOverride: (review: PendingPriceUpdateReview, manualPrice: number) => Promise<void> | void;
  confirmingAssetIds: string[];
  dismissingAssetIds: string[];
  overridingAssetIds: string[];
  actionError: string | null;
  actionSuccess: string | null;
}

function getFailureCategoryLabel(category?: PendingPriceUpdateReview['failureCategory']) {
  if (category === 'ticker_format') return '代號格式問題';
  if (category === 'quote_time') return 'Quote 時間過舊';
  if (category === 'source_missing') return '來源不足';
  if (category === 'response_format') return '回覆格式問題';
  if (category === 'price_missing') return '未能取得價格';
  if (category === 'confidence_low') return '可信度不足';
  if (category === 'diff_too_large') return '價格差距過大，需人工確認';
  if (category === 'unknown') return '原因不明';
  return '需要人工檢查';
}

function getFailureTone(
  category?: PendingPriceUpdateReview['failureCategory'],
): 'caution' | 'warning' | 'error' {
  if (category === 'diff_too_large') return 'caution';
  if (category === 'quote_time' || category === 'confidence_low') return 'warning';
  return 'error';
}

export function PriceUpdateReviewPanel({
  reviews,
  onConfirm,
  onDismiss,
  onOverride,
  confirmingAssetIds,
  dismissingAssetIds,
  overridingAssetIds,
  actionError,
  actionSuccess,
}: PriceUpdateReviewPanelProps) {
  const [editingIds, setEditingIds] = useState<string[]>([]);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});

  function startEditing(assetId: string) {
    setEditingIds((prev) => (prev.includes(assetId) ? prev : [...prev, assetId]));
    setPriceInputs((prev) => (assetId in prev ? prev : { ...prev, [assetId]: '' }));
  }

  function cancelEditing(assetId: string) {
    setEditingIds((prev) => prev.filter((id) => id !== assetId));
    setPriceInputs((prev) => {
      const next = { ...prev };
      delete next[assetId];
      return next;
    });
  }

  async function handleSaveManualPrice(review: PendingPriceUpdateReview) {
    const price = parseFloat(priceInputs[review.assetId] ?? '');
    if (!isNaN(price) && price > 0) {
      await onOverride(review, price);
      cancelEditing(review.assetId);
    }
  }

  if (reviews.length === 0) {
    return null;
  }

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">價格審查</p>
          <h2>需要人工確認</h2>
          <p className="table-hint">有效價格會即時寫入資產。以下為仍需人工處理的項目。</p>
        </div>
        <span className="chip chip-strong">{reviews.length} 項待處理</span>
      </div>

      {actionError ? <p className="status-message status-message-error">{actionError}</p> : null}
      {actionSuccess ? <p className="status-message status-message-success">{actionSuccess}</p> : null}

      <div className="extract-preview-list">
        {reviews.map((review) => {
          const isConfirming = confirmingAssetIds.includes(review.assetId);
          const isDismissing = dismissingAssetIds.includes(review.assetId);
          const isOverriding = overridingAssetIds.includes(review.assetId);
          const isEditing = editingIds.includes(review.assetId);
          const isLoading = isConfirming || isDismissing || isOverriding;

          const hasValidSuggestedPrice =
            review.price != null && review.price > 0 && !review.invalidReason;
          const hasSuggestedPrice = review.price != null && review.price > 0;
          const diffTone = Math.abs(review.diffPct) >= 0.15 ? 'caution' : 'positive';

          const failureTone = getFailureTone(review.failureCategory);
          const failureLabel = getFailureCategoryLabel(review.failureCategory);

          const manualPriceRaw = priceInputs[review.assetId] ?? '';
          const manualPrice = parseFloat(manualPriceRaw);
          const isManualPriceValid = !isNaN(manualPrice) && manualPrice > 0;

          return (
            <article key={review.assetId} className="extract-preview-card">
              {/* Header */}
              <div className="extract-preview-header">
                <div>
                  <p className="holding-symbol">{review.ticker}</p>
                  <h3>{review.assetName}</h3>
                  <p className="table-hint">
                    {review.accountSource ? getAccountSourceLabel(review.accountSource) : '未記錄帳戶來源'}
                  </p>
                </div>
                <span className="chip chip-soft">{getAssetTypeLabel(review.assetType)}</span>
              </div>

              {/* Price comparison */}
              <div className="holding-grid">
                <div>
                  <p className="muted-label">現有價格</p>
                  <strong>{formatCurrency(review.currentPrice, review.assetCurrency || review.currency)}</strong>
                </div>
                <div>
                  <p className="muted-label">建議新價格</p>
                  <strong>
                    {hasSuggestedPrice
                      ? formatCurrency(review.price as number, review.currency)
                      : '未取得'}
                  </strong>
                </div>
                <div>
                  <p className="muted-label">差距</p>
                  <strong data-tone={hasSuggestedPrice ? diffTone : undefined}>
                    {hasSuggestedPrice ? formatPercent(review.diffPct * 100) : '—'}
                  </strong>
                </div>
              </div>

              <div className="roadmap-list">
                <div className="roadmap-item">
                  <strong>比價基準</strong>
                  <p>
                    {review.comparisonCurrentPrice != null && review.comparisonCurrency
                      ? `${formatCurrency(review.comparisonCurrentPrice, review.comparisonCurrency)} 對 ${hasSuggestedPrice ? formatCurrency(review.price as number, review.comparisonCurrency) : '未取得'}`
                      : '沿用資產現有價格作比較'}
                  </p>
                </div>
                <div className="roadmap-item">
                  <strong>Debug</strong>
                  <p>
                    {`failure=${review.failureCategory ?? 'none'} · asset=${review.assetCurrency || review.currency || '—'} · market=${review.marketCurrency || review.currency || '—'}`}
                  </p>
                  {review.currencyMismatch ? <p>系統已按匯率換算後再比較差幅。</p> : null}
                </div>
              </div>

              {/* Failure reason — prominent block */}
              {(!review.isValid || review.invalidReason || review.failureCategory) ? (
                <div className="review-failure-block" data-tone={failureTone}>
                  <p className="review-failure-label">
                    <span aria-hidden="true">⚠</span>
                    <span>{failureLabel}</span>
                  </p>
                  {review.invalidReason ? (
                    <p className="review-failure-reason">{review.invalidReason}</p>
                  ) : null}
                </div>
              ) : null}

              {/* Source and time details */}
              <div className="roadmap-list">
                <div className="roadmap-item">
                  <strong>來源</strong>
                  <p>{review.sourceName || '未提供來源名稱'}</p>
                  {review.sourceUrl ? (
                    <a
                      className="text-link review-source-link"
                      href={review.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {review.sourceUrl}
                    </a>
                  ) : (
                    <p>未提供來源網址</p>
                  )}
                </div>
                <div className="roadmap-item">
                  <strong>價格時間</strong>
                  <p>{review.asOf || '未提供'}</p>
                </div>
              </div>

              {/* Manual price input form */}
              {isEditing ? (
                <div className="manual-price-form">
                  <input
                    className="manual-price-input"
                    type="number"
                    min="0"
                    step="any"
                    placeholder={`輸入 ${review.currency} 最新價格`}
                    value={manualPriceRaw}
                    onChange={(e) =>
                      setPriceInputs((prev) => ({ ...prev, [review.assetId]: e.target.value }))
                    }
                    disabled={isLoading}
                    autoFocus
                  />
                  <span className="manual-price-currency">{review.currency}</span>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => handleSaveManualPrice(review)}
                    disabled={isLoading || !isManualPriceValid}
                  >
                    {isOverriding ? '儲存中...' : '儲存'}
                  </button>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => cancelEditing(review.assetId)}
                    disabled={isLoading}
                  >
                    取消
                  </button>
                </div>
              ) : null}

              {/* Actions */}
              <div className="form-actions">
                {hasValidSuggestedPrice ? (
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={() => onConfirm(review)}
                    disabled={isLoading}
                  >
                    {isConfirming ? '確認中...' : '確認寫入正式價格'}
                  </button>
                ) : null}
                {!isEditing ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={() => startEditing(review.assetId)}
                    disabled={isLoading}
                  >
                    手動輸入價格
                  </button>
                ) : null}
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => onDismiss(review.assetId)}
                  disabled={isLoading}
                >
                  {isDismissing ? '略過中...' : '略過這次更新'}
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
