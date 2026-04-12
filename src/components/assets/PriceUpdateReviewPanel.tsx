import {
  formatCurrency,
  formatPercent,
  getAssetTypeLabel,
} from '../../data/mockPortfolio';
import type { PendingPriceUpdateReview } from '../../types/priceUpdates';

interface PriceUpdateReviewPanelProps {
  reviews: PendingPriceUpdateReview[];
  onConfirm: (review: PendingPriceUpdateReview) => Promise<void> | void;
  onDismiss: (assetId: string) => Promise<void> | void;
  confirmingAssetIds: string[];
  dismissingAssetIds: string[];
  actionError: string | null;
  actionSuccess: string | null;
}

function getFailureCategoryLabel(category?: PendingPriceUpdateReview['failureCategory']) {
  if (category === 'ticker_format') return '代號格式問題';
  if (category === 'quote_time') return 'quote 時間問題';
  if (category === 'source_missing') return '來源不足';
  if (category === 'response_format') return '回覆格式問題';
  if (category === 'price_missing') return '未取得價格';
  if (category === 'confidence_low') return '可信度不足';
  if (category === 'diff_too_large') return '價格差距過大';
  return '待檢查';
}

export function PriceUpdateReviewPanel({
  reviews,
  onConfirm,
  onDismiss,
  confirmingAssetIds,
  dismissingAssetIds,
  actionError,
  actionSuccess,
}: PriceUpdateReviewPanelProps) {
  if (reviews.length === 0) {
    return null;
  }

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">價格審查</p>
          <h2>需要人工確認</h2>
          <p className="table-hint">
            有效價格會即時寫入資產。下面係仍然需要你手動處理嘅項目。
          </p>
        </div>
        <span className="chip chip-strong">{reviews.length} 項待處理</span>
      </div>

      {actionError ? <p className="status-message status-message-error">{actionError}</p> : null}
      {actionSuccess ? <p className="status-message status-message-success">{actionSuccess}</p> : null}

      <div className="extract-preview-list">
        {reviews.map((review) => {
          const isConfirming = confirmingAssetIds.includes(review.assetId);
          const isDismissing = dismissingAssetIds.includes(review.assetId);
          const hasValidSuggestedPrice = review.price != null && review.price > 0 && !review.invalidReason;
          const diffTone = review.diffPct >= 0.15 ? 'caution' : 'positive';

          return (
            <article key={review.assetId} className="extract-preview-card">
              <div className="extract-preview-header">
                <div>
                  <p className="holding-symbol">{review.ticker}</p>
                  <h3>{review.assetName}</h3>
                </div>
                <div className="button-row">
                  <span className="chip chip-soft">{getAssetTypeLabel(review.assetType)}</span>
                  <span className={review.isValid ? 'chip chip-soft' : 'chip chip-strong'}>
                    {review.isValid ? '可直接確認' : '需要人工檢查'}
                  </span>
                </div>
              </div>

              <div className="holding-grid">
                <div>
                  <p className="muted-label">現有價格</p>
                  <strong>{formatCurrency(review.currentPrice, review.currency)}</strong>
                </div>
                <div>
                  <p className="muted-label">建議新價格</p>
                  <strong>
                    {!hasValidSuggestedPrice
                      ? '未取得'
                      : formatCurrency(review.price as number, review.currency)}
                  </strong>
                </div>
                <div>
                  <p className="muted-label">價格差距</p>
                  <strong data-tone={diffTone}>{formatPercent(review.diffPct * 100)}</strong>
                </div>
              </div>

              <div className="roadmap-list">
                {review.invalidReason ? (
                  <div className="roadmap-item">
                    <strong>結果</strong>
                    <p>{review.invalidReason}</p>
                    <p>分類：{getFailureCategoryLabel(review.failureCategory)}</p>
                  </div>
                ) : null}
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
                  <p>{review.asOf || '未提供 asOf'}</p>
                </div>
              </div>

              <div className="form-actions">
                <button
                  className="button button-primary"
                  type="button"
                  onClick={() => onConfirm(review)}
                  disabled={isConfirming || isDismissing || !hasValidSuggestedPrice}
                >
                  {isConfirming ? '確認中...' : hasValidSuggestedPrice ? '確認寫入正式價格' : '無法確認'}
                </button>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => onDismiss(review.assetId)}
                  disabled={isConfirming || isDismissing}
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
