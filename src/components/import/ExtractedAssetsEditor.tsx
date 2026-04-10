import {
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../../data/mockPortfolio';
import type {
  AccountSource,
  AssetType,
} from '../../types/portfolio';
import {
  getMissingExtractedAssetFields,
  type EditableExtractedAsset,
  type EditableExtractedAssetField,
} from '../../types/extractAssets';

interface ExtractedAssetsEditorProps {
  assets: EditableExtractedAsset[];
  accountSource: AccountSource;
  onChangeAsset: (
    assetId: string,
    field: keyof EditableExtractedAsset,
    value: string,
  ) => void;
  onRemoveAsset: (assetId: string) => void;
  onChangeAccountSource: (value: AccountSource) => void;
  onConfirm: () => Promise<void> | void;
  isConfirming: boolean;
  confirmError: string | null;
  confirmSuccess: string | null;
  submitLabel?: string;
}

const assetTypeOptions: AssetType[] = ['stock', 'etf', 'bond', 'crypto'];
const accountSourceOptions: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];

const fieldLabels: Record<EditableExtractedAssetField, string> = {
  name: '名稱',
  ticker: 'Ticker',
  type: '類型',
  quantity: '數量',
  currency: '幣別',
  costBasis: 'Cost Basis',
  currentPrice: '現價',
};

export function ExtractedAssetsEditor({
  assets,
  accountSource,
  onChangeAsset,
  onRemoveAsset,
  onChangeAccountSource,
  onConfirm,
  isConfirming,
  confirmError,
  confirmSuccess,
  submitLabel,
}: ExtractedAssetsEditorProps) {
  const missingFieldCount = assets.reduce(
    (sum, asset) => sum + getMissingExtractedAssetFields(asset).length,
    0,
  );
  const hasMissingFields = missingFieldCount > 0;

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Review</p>
          <h2>解析預覽</h2>
          <p className="table-hint">
            檢查 AI 分類成新增資產嘅內容。呢度只會建立非現金資產，現金流會交由交易記錄扣減或增加既有現金帳戶。
          </p>
        </div>
        <span className={hasMissingFields ? 'chip chip-strong' : 'chip chip-soft'}>
          {hasMissingFields ? `仍有 ${missingFieldCount} 個缺欄位` : '可確認匯入'}
        </span>
      </div>

      <div className="extract-meta-row">
        <label className="form-field extract-account-field">
          <span>匯入到哪個帳戶來源</span>
          <select
            value={accountSource}
            onChange={(event) => onChangeAccountSource(event.target.value as AccountSource)}
            disabled={isConfirming}
          >
            {accountSourceOptions.map((option) => (
              <option key={option} value={option}>
                {getAccountSourceLabel(option)}
              </option>
            ))}
          </select>
        </label>

        <div className="extract-meta-note">
          <strong>匯入規則</strong>
          <p>
            匯入時會將 `costBasis` 寫成平均成本；如果 AI 有讀到 `現價`，會一併寫入，否則資產頁會顯示待更新。
          </p>
        </div>
      </div>

      <div className="extract-preview-list">
        {assets.length === 0 ? (
          <div className="extract-empty-state">
            <strong>已清空解析結果</strong>
            <p>如果呢次辨識到的資產都唔需要，可以重新上傳截圖再試。</p>
          </div>
        ) : null}

        {assets.map((asset, index) => {
          const missingFields = getMissingExtractedAssetFields(asset);

          return (
            <article key={asset.id} className="extract-preview-card">
              <div className="extract-preview-header">
                <div>
                  <p className="holding-symbol">Asset {index + 1}</p>
                  <h3>{asset.ticker || asset.name || '待補資料的資產'}</h3>
                </div>
                <div className="button-row">
                  <button
                    className="button button-secondary button-danger-text"
                    type="button"
                    onClick={() => onRemoveAsset(asset.id)}
                    disabled={isConfirming}
                  >
                    刪除資產
                  </button>
                  <span className="chip chip-soft">
                    {asset.type ? getAssetTypeLabel(asset.type) : '未分類'}
                  </span>
                  <span className={missingFields.length > 0 ? 'chip chip-strong' : 'chip chip-soft'}>
                    {missingFields.length > 0 ? '需要補資料' : '資料完整'}
                  </span>
                </div>
              </div>

              {missingFields.length > 0 ? (
                <p className="extract-missing-hint">
                  缺少欄位: {missingFields.map((field) => fieldLabels[field]).join('、')}
                </p>
              ) : null}

              <div className="asset-form-grid">
                <label
                  className={
                    missingFields.includes('name') ? 'form-field form-field-missing' : 'form-field'
                  }
                >
                  <span>名稱</span>
                  <input
                    value={asset.name}
                    onChange={(event) => onChangeAsset(asset.id, 'name', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 Apple"
                  />
                </label>

                <label
                  className={
                    missingFields.includes('ticker') ? 'form-field form-field-missing' : 'form-field'
                  }
                >
                  <span>Ticker</span>
                  <input
                    value={asset.ticker}
                    onChange={(event) => onChangeAsset(asset.id, 'ticker', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 AAPL"
                  />
                </label>

                <label
                  className={
                    missingFields.includes('type') ? 'form-field form-field-missing' : 'form-field'
                  }
                >
                  <span>類型</span>
                  <select
                    value={asset.type}
                    onChange={(event) => onChangeAsset(asset.id, 'type', event.target.value)}
                    disabled={isConfirming}
                  >
                    <option value="">請選擇類型</option>
                    {assetTypeOptions.map((option) => (
                      <option key={option} value={option}>
                        {getAssetTypeLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label
                  className={
                    missingFields.includes('quantity')
                      ? 'form-field form-field-missing'
                      : 'form-field'
                  }
                >
                  <span>數量</span>
                  <input
                    type="number"
                    step="any"
                    value={asset.quantity}
                    onChange={(event) => onChangeAsset(asset.id, 'quantity', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 10"
                  />
                </label>

                <label
                  className={
                    missingFields.includes('currency')
                      ? 'form-field form-field-missing'
                      : 'form-field'
                  }
                >
                  <span>幣別</span>
                  <input
                    value={asset.currency}
                    onChange={(event) => onChangeAsset(asset.id, 'currency', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 HKD"
                  />
                </label>

                <label
                  className={
                    missingFields.includes('costBasis')
                      ? 'form-field form-field-missing'
                      : 'form-field'
                  }
                >
                  <span>Cost Basis</span>
                  <input
                    type="number"
                    step="any"
                    value={asset.costBasis}
                    onChange={(event) => onChangeAsset(asset.id, 'costBasis', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 184.9"
                  />
                </label>

                <label className="form-field">
                  <span>現價</span>
                  <input
                    type="number"
                    step="any"
                    value={asset.currentPrice}
                    onChange={(event) => onChangeAsset(asset.id, 'currentPrice', event.target.value)}
                    disabled={isConfirming}
                    placeholder="可留空，之後更新"
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>

      {confirmError ? <p className="status-message status-message-error">{confirmError}</p> : null}
      {confirmSuccess ? <p className="status-message status-message-success">{confirmSuccess}</p> : null}

      <div className="form-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={isConfirming || hasMissingFields || assets.length === 0}
          onClick={onConfirm}
        >
          {isConfirming ? '寫入中...' : submitLabel ?? `確認寫入 ${assets.length} 項資產`}
        </button>
      </div>
    </section>
  );
}
