import { useEffect, useState, type FormEvent } from 'react';

import {
  formatCurrency,
  formatPercent,
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../../data/mockPortfolio';
import type { AccountSource, AssetType, PortfolioAssetInput } from '../../types/portfolio';

interface AssetInputFormProps {
  onSubmit: (payload: PortfolioAssetInput) => Promise<void> | void;
  onCancel: () => void;
  isSubmitting?: boolean;
  error?: string | null;
  title?: string;
  submitLabel?: string;
  cancelLabel?: string;
  initialValue?: PortfolioAssetInput | null;
}

interface AssetFormState {
  name: string;
  symbol: string;
  assetType: AssetType;
  accountSource: AccountSource;
  currency: string;
  quantity: string;
  averageCost: string;
  currentPrice: string;
}

const initialFormState: AssetFormState = {
  name: '',
  symbol: '',
  assetType: 'stock',
  accountSource: 'Futu',
  currency: 'HKD',
  quantity: '',
  averageCost: '',
  currentPrice: '',
};

const assetTypeOptions: AssetType[] = ['stock', 'etf', 'bond', 'crypto', 'cash'];
const accountSourceOptions: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];

export function AssetInputForm({
  onSubmit,
  onCancel,
  isSubmitting = false,
  error = null,
  title = '輸入資產',
  submitLabel = '加入資產',
  cancelLabel = '取消',
  initialValue = null,
}: AssetInputFormProps) {
  const [form, setForm] = useState<AssetFormState>(() =>
    initialValue
      ? {
          name: initialValue.name,
          symbol: initialValue.symbol,
          assetType: initialValue.assetType,
          accountSource: initialValue.accountSource,
          currency: initialValue.currency,
          quantity: String(initialValue.quantity),
          averageCost: String(initialValue.averageCost),
          currentPrice: String(initialValue.currentPrice),
        }
      : initialFormState,
  );

  useEffect(() => {
    if (!initialValue) {
      setForm(initialFormState);
      return;
    }

    setForm({
      name: initialValue.name,
      symbol: initialValue.symbol,
      assetType: initialValue.assetType,
      accountSource: initialValue.accountSource,
      currency: initialValue.currency,
      quantity: String(initialValue.quantity),
      averageCost: String(initialValue.averageCost),
      currentPrice: String(initialValue.currentPrice),
    });
  }, [initialValue]);

  const quantity = Number(form.quantity) || 0;
  const averageCost = Number(form.averageCost) || 0;
  const currentPrice = Number(form.currentPrice) || 0;
  const marketValue = quantity * currentPrice;
  const costBasis = quantity * averageCost;
  const unrealizedPnl = marketValue - costBasis;
  const unrealizedPct = costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100;
  const displayCurrency = form.currency.trim().toUpperCase() || 'HKD';

  function updateField<K extends keyof AssetFormState>(key: K, value: AssetFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await onSubmit({
        name: form.name.trim(),
        symbol: form.symbol.trim().toUpperCase(),
        assetType: form.assetType,
        accountSource: form.accountSource,
        currency: displayCurrency,
        quantity,
        averageCost,
        currentPrice,
      });

      if (!initialValue) {
        setForm(initialFormState);
      }
    } catch {
      return;
    }
  }

  return (
    <section className="asset-form-panel">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Manual Input</p>
          <h2>{title}</h2>
          <p className="table-hint">填好核心資料後，市值、損益與配置比重會由前端即時計算。</p>
        </div>
        <button className="button button-secondary" type="button" onClick={onCancel}>
          {cancelLabel}
        </button>
      </div>

      <form className="asset-form" onSubmit={handleSubmit}>
        <div className="asset-form-grid">
          <label className="form-field">
            <span>資產名稱</span>
            <input
              required
              disabled={isSubmitting}
              value={form.name}
              onChange={(event) => updateField('name', event.target.value)}
              placeholder="例如 Apple"
            />
          </label>

          <label className="form-field">
            <span>代號</span>
            <input
              required
              disabled={isSubmitting}
              value={form.symbol}
              onChange={(event) => updateField('symbol', event.target.value)}
              placeholder="例如 AAPL"
            />
          </label>

          <label className="form-field">
            <span>資產類別</span>
            <select
              disabled={isSubmitting}
              value={form.assetType}
              onChange={(event) => updateField('assetType', event.target.value as AssetType)}
            >
              {assetTypeOptions.map((option) => (
                <option key={option} value={option}>
                  {getAssetTypeLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>帳戶來源</span>
            <select
              disabled={isSubmitting}
              value={form.accountSource}
              onChange={(event) =>
                updateField('accountSource', event.target.value as AccountSource)
              }
            >
              {accountSourceOptions.map((option) => (
                <option key={option} value={option}>
                  {getAccountSourceLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>幣別</span>
            <input
              required
              disabled={isSubmitting}
              value={form.currency}
              onChange={(event) => updateField('currency', event.target.value)}
              placeholder="例如 HKD / USD"
            />
          </label>

          <label className="form-field">
            <span>持倉數量</span>
            <input
              required
              disabled={isSubmitting}
              min="0"
              step="any"
              type="number"
              value={form.quantity}
              onChange={(event) => updateField('quantity', event.target.value)}
              placeholder="例如 10"
            />
          </label>

          <label className="form-field">
            <span>平均成本</span>
            <input
              required
              disabled={isSubmitting}
              min="0"
              step="any"
              type="number"
              value={form.averageCost}
              onChange={(event) => updateField('averageCost', event.target.value)}
              placeholder="例如 184.9"
            />
          </label>

          <label className="form-field">
            <span>現價</span>
            <input
              required
              disabled={isSubmitting}
              min="0"
              step="any"
              type="number"
              value={form.currentPrice}
              onChange={(event) => updateField('currentPrice', event.target.value)}
              placeholder="例如 198.4"
            />
          </label>

        </div>

        <div className="derived-preview">
          <div className="derived-card">
            <span>預估市值</span>
            <strong>{formatCurrency(marketValue, displayCurrency)}</strong>
          </div>
          <div className="derived-card">
            <span>預估損益</span>
            <strong data-tone={unrealizedPnl >= 0 ? 'positive' : 'caution'}>
              {formatCurrency(unrealizedPnl, displayCurrency)}
            </strong>
            <small>{formatPercent(unrealizedPct)}</small>
          </div>
          <div className="derived-card">
            <span>資料預覽</span>
            <strong>
              {getAssetTypeLabel(form.assetType)} · {getAccountSourceLabel(form.accountSource)}
            </strong>
            <small>{displayCurrency}</small>
          </div>
        </div>

        {error ? <p className="status-message status-message-error">{error}</p> : null}

        <div className="form-actions">
          <button className="button button-primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? '儲存中...' : submitLabel}
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            {cancelLabel}
          </button>
        </div>
      </form>
    </section>
  );
}
