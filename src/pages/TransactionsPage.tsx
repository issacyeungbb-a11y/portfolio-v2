import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../data/mockPortfolio';
import { useAssetTransactions } from '../hooks/useAssetTransactions';

function formatTradeDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

export function TransactionsPage() {
  const { entries, status, error } = useAssetTransactions();
  const totalTradeAmountHKD = entries.reduce(
    (sum, entry) => sum + convertCurrency(entry.quantity * entry.price, entry.currency, 'HKD'),
    0,
  );

  return (
    <div className="page-stack">
      {error ? <p className="status-message status-message-error">{error}</p> : null}

      <section className="summary-grid">
        <article className="summary-card">
          <p className="summary-label">交易總數</p>
          <strong className="summary-value">{entries.length}</strong>
          <p className="summary-hint">已儲存買入 / 賣出交易記錄</p>
        </article>
        <article className="summary-card">
          <p className="summary-label">累計交易金額</p>
          <strong className="summary-value">{formatCurrencyRounded(totalTradeAmountHKD, 'HKD')}</strong>
          <p className="summary-hint">按各筆成交價 x 數量換算 HKD 累計</p>
        </article>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Transactions</p>
            <h2>交易記錄</h2>
          </div>
          <span className={status === 'loading' ? 'chip chip-soft' : 'chip chip-strong'}>
            {status === 'loading' ? '同步中' : `${entries.length} 筆`}
          </span>
        </div>

        <div className="settings-list">
          {entries.length > 0 ? (
            entries.map((entry) => {
              const grossAmount = entry.quantity * entry.price;
              return (
                <div key={entry.id} className="setting-row">
                  <div>
                    <strong>
                      {entry.symbol} · {entry.transactionType === 'buy' ? '買入' : '賣出'}
                    </strong>
                    <p>
                      {entry.assetName} · {getAssetTypeLabel(entry.assetType)} · {getAccountSourceLabel(entry.accountSource)}
                    </p>
                    <p>
                      {formatTradeDate(entry.date)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                  </div>
                  <div className="table-metric">
                    <strong className="table-metric-primary">
                      {entry.quantity} @ {formatCurrency(entry.price, entry.currency)}
                    </strong>
                    <span className="table-metric-secondary">
                      總額 {formatCurrency(grossAmount, entry.currency)} · 手續費 {formatCurrency(entry.fees, entry.currency)}
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <p className="status-message">
              未有交易記錄。你可以喺資產頁每隻資產旁邊撳「交易」開始新增。
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
