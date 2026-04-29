import {
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../../data/mockPortfolio';
import type {
  AccountSource,
  AssetType,
} from '../../types/portfolio';
import type {
  ImportPreviewClassification,
  ImportPreviewItem,
} from '../../types/extractAssets';

interface ExistingAssetOption {
  id: string;
  label: string;
  accountSource: AccountSource;
}

interface ImportPreviewEditorProps {
  items: ImportPreviewItem[];
  existingAssetOptions: ExistingAssetOption[];
  cashAccountSources: AccountSource[];
  settlementCurrency: string;
  onChangeItem: (
    itemId: string,
    field: keyof ImportPreviewItem,
    value: string,
  ) => void;
  onRemoveItem: (itemId: string) => void;
  onConfirm: () => Promise<void> | void;
  isConfirming: boolean;
  confirmError: string | null;
  confirmSuccess: string | null;
}

const assetTypeOptions: AssetType[] = ['stock', 'etf', 'bond', 'crypto'];
const accountSourceOptions: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];

function getMissingFields(item: ImportPreviewItem) {
  const missing: string[] = [];

  if (!item.classification) {
    missing.push('分類');
  }
  if (!item.name.trim()) {
    missing.push('名稱');
  }
  if (!item.ticker.trim()) {
    missing.push('Ticker');
  }
  if (!item.type) {
    missing.push('類型');
  }
  if (!item.assetAccountSource) {
    missing.push('資產帳戶');
  }
  if (!item.settlementAccountSource) {
    missing.push('現金帳戶');
  }
  if (item.classification === 'existing_transaction' && !item.existingAssetId) {
    missing.push('對應資產');
  }
  if (!item.transactionType) {
    missing.push('交易類型');
  }
  if (!item.quantity.trim()) {
    missing.push('數量');
  }
  if (!item.currency.trim()) {
    missing.push('幣別');
  }
  if (!item.price.trim()) {
    missing.push('成交價');
  }
  if (!item.date.trim()) {
    missing.push('日期');
  }

  return missing;
}

function getClassificationLabel(value: ImportPreviewClassification) {
  return value === 'new_asset' ? '新增資產' : '原有資產交易';
}

export function ImportPreviewEditor({
  items,
  existingAssetOptions,
  cashAccountSources,
  settlementCurrency,
  onChangeItem,
  onRemoveItem,
  onConfirm,
  isConfirming,
  confirmError,
  confirmSuccess,
}: ImportPreviewEditorProps) {
  const missingFieldCount = items.reduce((sum, item) => sum + getMissingFields(item).length, 0);
  const hasMissingFields = missingFieldCount > 0;

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Preview</p>
          <h2>逐筆交易預覽</h2>
          <p className="table-hint">
            每筆資料都可以改為新增資產或原有資產交易，儲存時會按你選擇的現金帳戶更新對應 {settlementCurrency} 現金資產。
          </p>
        </div>
        <span className={hasMissingFields ? 'chip chip-strong' : 'chip chip-soft'}>
          {hasMissingFields ? `仍有 ${missingFieldCount} 個待補欄位` : `可確認 ${items.length} 筆`}
        </span>
      </div>

      <div className="extract-preview-list">
        {items.map((item, index) => {
          const missingFields = getMissingFields(item);

          return (
            <article key={item.id} className="extract-preview-card">
              <div className="extract-preview-header">
                <div>
                  <p className="holding-symbol">Item {index + 1}</p>
                  <h3>{item.ticker || item.name || '待補資料的交易'}</h3>
                </div>
                <div className="button-row">
                  <span className="chip chip-soft">{getClassificationLabel(item.classification)}</span>
                  <span className={missingFields.length > 0 ? 'chip chip-strong' : 'chip chip-soft'}>
                    {missingFields.length > 0 ? '需要補資料' : '資料完整'}
                  </span>
                  <button
                    className="button button-secondary button-danger-text"
                    type="button"
                    onClick={() => onRemoveItem(item.id)}
                    disabled={isConfirming}
                  >
                    刪除
                  </button>
                </div>
              </div>

              {missingFields.length > 0 ? (
                <p className="extract-missing-hint">缺少欄位: {missingFields.join('、')}</p>
              ) : null}

              <div className="asset-form-grid">
                <label className="form-field">
                  <span>預覽分類</span>
                  <select
                    value={item.classification}
                    onChange={(event) =>
                      onChangeItem(item.id, 'classification', event.target.value)
                    }
                    disabled={isConfirming}
                  >
                    <option value="new_asset">新增資產</option>
                    <option value="existing_transaction">原有資產交易</option>
                  </select>
                </label>

                {item.classification === 'existing_transaction' ? (
                  <label className={!item.existingAssetId ? 'form-field form-field-missing' : 'form-field'}>
                    <span>對應資產</span>
                    <select
                      value={item.existingAssetId}
                      onChange={(event) =>
                        onChangeItem(item.id, 'existingAssetId', event.target.value)
                      }
                      disabled={isConfirming}
                    >
                      <option value="">請選擇現有資產</option>
                      {existingAssetOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}

                <label className="form-field">
                  <span>資產帳戶</span>
                  <select
                    value={item.assetAccountSource}
                    onChange={(event) =>
                      onChangeItem(item.id, 'assetAccountSource', event.target.value)
                    }
                    disabled={isConfirming}
                  >
                    <option value="">請選擇帳戶</option>
                    {accountSourceOptions.map((option) => (
                      <option key={option} value={option}>
                        {getAccountSourceLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className={!item.settlementAccountSource ? 'form-field form-field-missing' : 'form-field'}>
                  <span>現金帳戶（{settlementCurrency}）</span>
                  <select
                    value={item.settlementAccountSource}
                    onChange={(event) =>
                      onChangeItem(item.id, 'settlementAccountSource', event.target.value)
                    }
                    disabled={isConfirming}
                  >
                    <option value="">請選擇現金帳戶</option>
                    {cashAccountSources.map((option) => (
                      <option key={option} value={option}>
                        {getAccountSourceLabel(option)}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="form-field">
                  <span>名稱</span>
                  <input
                    value={item.name}
                    onChange={(event) => onChangeItem(item.id, 'name', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className={!item.ticker.trim() ? 'form-field form-field-missing' : 'form-field'}>
                  <span>Ticker</span>
                  <input
                    value={item.ticker}
                    onChange={(event) => onChangeItem(item.id, 'ticker', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className={!item.type ? 'form-field form-field-missing' : 'form-field'}>
                  <span>類型</span>
                  <select
                    value={item.type}
                    onChange={(event) => onChangeItem(item.id, 'type', event.target.value)}
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

                <label className={!item.transactionType ? 'form-field form-field-missing' : 'form-field'}>
                  <span>交易類型</span>
                  <select
                    value={item.transactionType}
                    onChange={(event) =>
                      onChangeItem(item.id, 'transactionType', event.target.value)
                    }
                    disabled={isConfirming}
                  >
                    <option value="">請選擇</option>
                    <option value="buy">買入</option>
                    <option value="sell">賣出</option>
                  </select>
                </label>

                <label className={!item.quantity.trim() ? 'form-field form-field-missing' : 'form-field'}>
                  <span>數量</span>
                  <input
                    type="number"
                    step="any"
                    value={item.quantity}
                    onChange={(event) => onChangeItem(item.id, 'quantity', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className={!item.currency.trim() ? 'form-field form-field-missing' : 'form-field'}>
                  <span>幣別</span>
                  <input
                    value={item.currency}
                    onChange={(event) => onChangeItem(item.id, 'currency', event.target.value)}
                    disabled
                  />
                </label>

                <label className={!item.price.trim() ? 'form-field form-field-missing' : 'form-field'}>
                  <span>成交價</span>
                  <input
                    type="number"
                    step="any"
                    value={item.price}
                    onChange={(event) => onChangeItem(item.id, 'price', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className="form-field">
                  <span>手續費</span>
                  <input
                    type="number"
                    step="any"
                    value={item.fees}
                    onChange={(event) => onChangeItem(item.id, 'fees', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className={!item.date.trim() ? 'form-field form-field-missing' : 'form-field'}>
                  <span>日期</span>
                  <input
                    type="date"
                    value={item.date}
                    onChange={(event) => onChangeItem(item.id, 'date', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className="form-field">
                  <span>備註</span>
                  <input
                    value={item.note}
                    onChange={(event) => onChangeItem(item.id, 'note', event.target.value)}
                    disabled={isConfirming}
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
          disabled={isConfirming || hasMissingFields || items.length === 0 || cashAccountSources.length === 0}
          onClick={onConfirm}
        >
          {isConfirming ? '寫入中...' : `確認寫入 ${items.length} 筆`}
        </button>
      </div>
    </section>
  );
}
