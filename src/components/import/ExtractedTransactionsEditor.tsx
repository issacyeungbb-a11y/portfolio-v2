import {
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../../data/mockPortfolio';
import type {
  AccountSource,
  AssetType,
} from '../../types/portfolio';
import {
  getMissingExtractedTransactionFields,
  type EditableExtractedTransaction,
  type EditableExtractedTransactionField,
} from '../../types/extractAssets';

type TransactionEditorFieldLabel = EditableExtractedTransactionField | 'settlementAccountSource';

interface ExtractedTransactionsEditorProps {
  transactions: EditableExtractedTransaction[];
  cashAccountSources: AccountSource[];
  onChangeTransaction: (
    transactionId: string,
    field: keyof EditableExtractedTransaction,
    value: string,
  ) => void;
  onRemoveTransaction: (transactionId: string) => void;
  onConfirm: () => Promise<void> | void;
  isConfirming: boolean;
  confirmError: string | null;
  confirmSuccess: string | null;
  submitLabel?: string;
}

const assetTypeOptions: AssetType[] = ['stock', 'etf', 'bond', 'crypto'];

const fieldLabels: Record<TransactionEditorFieldLabel, string> = {
  name: '名稱',
  ticker: 'Ticker',
  type: '類型',
  transactionType: '交易類型',
  settlementAccountSource: '現金帳戶',
  quantity: '數量',
  currency: '幣別',
  price: '成交價',
  fees: '手續費',
  date: '日期',
  note: '備註',
};

export function ExtractedTransactionsEditor({
  transactions,
  cashAccountSources,
  onChangeTransaction,
  onRemoveTransaction,
  onConfirm,
  isConfirming,
  confirmError,
  confirmSuccess,
  submitLabel,
}: ExtractedTransactionsEditorProps) {
  const missingFieldCount = transactions.reduce(
    (sum, entry) =>
      sum + getMissingExtractedTransactionFields(entry).length + (entry.settlementAccountSource ? 0 : 1),
    0,
  );
  const hasMissingFields = missingFieldCount > 0;

  return (
    <section className="card">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Review</p>
          <h2>交易記錄預覽</h2>
          <p className="table-hint">
            檢查 AI 分類成原有資產交易嘅內容，確認後會寫入交易記錄，並用已鎖定嘅現金帳戶更新現金餘額。
          </p>
        </div>
        <span className={hasMissingFields ? 'chip chip-strong' : 'chip chip-soft'}>
          {hasMissingFields ? `仍有 ${missingFieldCount} 個缺欄位` : '可確認匯入'}
        </span>
      </div>

      <div className="extract-meta-row">
        <div className="extract-meta-note">
          <strong>匯入規則</strong>
          <p>
            系統會按 `Ticker + 帳戶來源` 對應現有資產，再由 IB、富途或穩定幣現金帳戶處理現金加減。
          </p>
        </div>
      </div>

      <div className="extract-preview-list">
        {transactions.length === 0 ? (
          <div className="extract-empty-state">
            <strong>未有可匯入交易</strong>
            <p>如果今次辨識到的交易都唔啱，可以重新上傳截圖或改寫文字再試。</p>
          </div>
        ) : null}

        {transactions.map((entry, index) => {
          const missingFields = getMissingExtractedTransactionFields(entry);
          const isEntryComplete = missingFields.length === 0 && Boolean(entry.settlementAccountSource);

          return (
            <article key={entry.id} className="extract-preview-card">
              <div className="extract-preview-header">
                <div>
                  <p className="holding-symbol">Trade {index + 1}</p>
                  <h3>{entry.ticker || entry.name || '待補資料的交易'}</h3>
                </div>
                <div className="button-row">
                  <button
                    className="button button-secondary button-danger-text"
                    type="button"
                    onClick={() => onRemoveTransaction(entry.id)}
                    disabled={isConfirming}
                  >
                    刪除交易
                  </button>
                  <span className="chip chip-soft">
                    {entry.type ? getAssetTypeLabel(entry.type) : '未分類'}
                  </span>
                  <span className={isEntryComplete ? 'chip chip-soft' : 'chip chip-strong'}>
                    {isEntryComplete ? '資料完整' : '需要補資料'}
                  </span>
                </div>
              </div>

              {missingFields.length > 0 || !entry.settlementAccountSource ? (
                <p className="extract-missing-hint">
                  缺少欄位: {[
                    ...missingFields.map((field) => fieldLabels[field]),
                    ...(entry.settlementAccountSource ? [] : [fieldLabels.settlementAccountSource]),
                  ].join('、')}
                </p>
              ) : null}

              <div className="asset-form-grid">
                <label className="form-field">
                  <span>名稱</span>
                  <input
                    value={entry.name}
                    onChange={(event) => onChangeTransaction(entry.id, 'name', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 Tesla"
                  />
                </label>

                <label className={missingFields.includes('ticker') ? 'form-field form-field-missing' : 'form-field'}>
                  <span>Ticker</span>
                  <input
                    value={entry.ticker}
                    onChange={(event) => onChangeTransaction(entry.id, 'ticker', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 TSLA"
                  />
                </label>

                <label className="form-field">
                  <span>類型</span>
                  <select
                    value={entry.type}
                    onChange={(event) => onChangeTransaction(entry.id, 'type', event.target.value)}
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
                    entry.settlementAccountSource
                      ? 'form-field'
                      : 'form-field form-field-missing'
                  }
                >
                  <span>現金帳戶</span>
                  <select
                    value={entry.settlementAccountSource}
                    onChange={(event) =>
                      onChangeTransaction(entry.id, 'settlementAccountSource', event.target.value)
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

                <label className={missingFields.includes('transactionType') ? 'form-field form-field-missing' : 'form-field'}>
                  <span>交易類型</span>
                  <select
                    value={entry.transactionType}
                    onChange={(event) => onChangeTransaction(entry.id, 'transactionType', event.target.value)}
                    disabled={isConfirming}
                  >
                    <option value="">請選擇</option>
                    <option value="buy">買入</option>
                    <option value="sell">賣出</option>
                  </select>
                </label>

                <label className={missingFields.includes('quantity') ? 'form-field form-field-missing' : 'form-field'}>
                  <span>數量</span>
                  <input
                    type="number"
                    step="any"
                    value={entry.quantity}
                    onChange={(event) => onChangeTransaction(entry.id, 'quantity', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 10"
                  />
                </label>

                <label className={missingFields.includes('currency') ? 'form-field form-field-missing' : 'form-field'}>
                  <span>幣別</span>
                  <input
                    value={entry.currency}
                    onChange={(event) => onChangeTransaction(entry.id, 'currency', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 USD"
                  />
                </label>

                <label className={missingFields.includes('price') ? 'form-field form-field-missing' : 'form-field'}>
                  <span>成交價</span>
                  <input
                    type="number"
                    step="any"
                    value={entry.price}
                    onChange={(event) => onChangeTransaction(entry.id, 'price', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 198.4"
                  />
                </label>

                <label className="form-field">
                  <span>手續費</span>
                  <input
                    type="number"
                    step="any"
                    value={entry.fees}
                    onChange={(event) => onChangeTransaction(entry.id, 'fees', event.target.value)}
                    disabled={isConfirming}
                    placeholder="例如 15"
                  />
                </label>

                <label className={missingFields.includes('date') ? 'form-field form-field-missing' : 'form-field'}>
                  <span>日期</span>
                  <input
                    type="date"
                    value={entry.date}
                    onChange={(event) => onChangeTransaction(entry.id, 'date', event.target.value)}
                    disabled={isConfirming}
                  />
                </label>

                <label className="form-field">
                  <span>備註</span>
                  <input
                    value={entry.note}
                    onChange={(event) => onChangeTransaction(entry.id, 'note', event.target.value)}
                    disabled={isConfirming}
                    placeholder="可留空"
                  />
                </label>
              </div>
            </article>
          );
        })}
      </div>

      {confirmError ? <p className="status-message status-message-error">{confirmError}</p> : null}
      {confirmSuccess ? <p className="status-message status-message-success">{confirmSuccess}</p> : null}
      {cashAccountSources.length === 0 ? (
        <p className="status-message status-message-error">
          未找到已鎖定的 IB、富途或穩定幣現金帳戶，交易暫時未可確認匯入。
        </p>
      ) : null}

      <div className="form-actions">
        <button
          className="button button-primary"
          type="button"
          disabled={isConfirming || hasMissingFields || transactions.length === 0 || cashAccountSources.length === 0}
          onClick={onConfirm}
        >
          {isConfirming ? '寫入中...' : submitLabel ?? `確認寫入 ${transactions.length} 筆交易`}
        </button>
      </div>
    </section>
  );
}
