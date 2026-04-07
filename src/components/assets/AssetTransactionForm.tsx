import { useEffect, useState, type FormEvent } from 'react';

import { formatCurrencyRounded, getAccountSourceLabel, getAssetTypeLabel } from '../../data/mockPortfolio';
import type { AssetTransactionEntry, Holding } from '../../types/portfolio';

interface AssetTransactionFormProps {
  holding: Holding;
  onSubmit: (
    payload: Omit<AssetTransactionEntry, 'id' | 'createdAt' | 'updatedAt' | 'realizedPnlHKD'>,
  ) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
  error?: string | null;
}

export function AssetTransactionForm({
  holding,
  onSubmit,
  onCancel,
  isSubmitting = false,
  error = null,
}: AssetTransactionFormProps) {
  const [transactionType, setTransactionType] = useState<'buy' | 'sell'>('buy');
  const [quantity, setQuantity] = useState('');
  const [price, setPrice] = useState(String(holding.currentPrice || holding.averageCost || ''));
  const [fees, setFees] = useState('0');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');

  useEffect(() => {
    setTransactionType('buy');
    setQuantity('');
    setPrice(String(holding.currentPrice || holding.averageCost || ''));
    setFees('0');
    setDate(new Date().toISOString().slice(0, 10));
    setNote('');
  }, [holding.id, holding.currentPrice, holding.averageCost]);

  const quantityValue = Number(quantity) || 0;
  const priceValue = Number(price) || 0;
  const feesValue = Number(fees) || 0;
  const grossAmount = quantityValue * priceValue;
  const netAmount = transactionType === 'buy' ? grossAmount + feesValue : grossAmount - feesValue;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await onSubmit({
        assetId: holding.id,
        assetName: holding.name,
        symbol: holding.symbol,
        assetType: holding.assetType,
        accountSource: holding.accountSource,
        transactionType,
        quantity: quantityValue,
        price: priceValue,
        fees: feesValue,
        currency: holding.currency,
        date,
        note: note.trim() || undefined,
      });
    } catch {
      return;
    }
  }

  return (
    <section className="asset-form-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Trade Entry</p>
          <h2>交易 {holding.symbol}</h2>
          <p className="table-hint">
            {holding.name} · {getAssetTypeLabel(holding.assetType)} · {getAccountSourceLabel(holding.accountSource)}
          </p>
        </div>
        <button className="button button-secondary" type="button" onClick={onCancel}>
          關閉
        </button>
      </div>

      <form className="asset-form" onSubmit={handleSubmit}>
        <div className="asset-form-grid">
          <label className="form-field">
            <span>交易類型</span>
            <select
              value={transactionType}
              onChange={(event) => setTransactionType(event.target.value as 'buy' | 'sell')}
              disabled={isSubmitting}
            >
              <option value="buy">買入</option>
              <option value="sell">賣出</option>
            </select>
          </label>

          <label className="form-field">
            <span>交易日期</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={isSubmitting}
            />
          </label>

          <label className="form-field">
            <span>數量</span>
            <input
              type="number"
              min="0"
              step="any"
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              disabled={isSubmitting}
              placeholder="例如 10"
              required
            />
          </label>

          <label className="form-field">
            <span>成交價</span>
            <input
              type="number"
              min="0"
              step="any"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={isSubmitting}
              placeholder="例如 198.4"
              required
            />
          </label>

          <label className="form-field">
            <span>手續費</span>
            <input
              type="number"
              min="0"
              step="any"
              value={fees}
              onChange={(event) => setFees(event.target.value)}
              disabled={isSubmitting}
              placeholder="例如 15"
            />
          </label>

          <label className="form-field">
            <span>備註</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={isSubmitting}
              placeholder="例如 加倉 / 止賺"
            />
          </label>
        </div>

        <div className="derived-preview">
          <div className="derived-card">
            <span>預估交易總額</span>
            <strong>{formatCurrencyRounded(netAmount, holding.currency)}</strong>
            <small>
              毛額 {formatCurrencyRounded(grossAmount, holding.currency)} · 手續費 {formatCurrencyRounded(feesValue, holding.currency)}
            </small>
          </div>
        </div>

        {error ? <p className="status-message status-message-error">{error}</p> : null}

        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '儲存中...' : '儲存交易'}
          </button>
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={isSubmitting}>
            取消
          </button>
        </div>
      </form>
    </section>
  );
}
