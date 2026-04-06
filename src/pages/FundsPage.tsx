import { useMemo, useState } from 'react';

import {
  convertCurrency,
  formatCurrency,
  getAccountSourceLabel,
} from '../data/mockPortfolio';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import type { AccountCashFlowEntry, AccountCashFlowType, AccountSource } from '../types/portfolio';

const accountSourceOptions: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];
const cashFlowTypeOptions: Array<{ value: AccountCashFlowType; label: string }> = [
  { value: 'deposit', label: '入金' },
  { value: 'withdrawal', label: '提款' },
  { value: 'adjustment', label: '調整' },
];

function getCashFlowSignedAmount(entry: Pick<AccountCashFlowEntry, 'type' | 'amount'>) {
  if (entry.type === 'withdrawal') {
    return -Math.abs(entry.amount);
  }

  return entry.amount;
}

function getCashFlowTypeLabel(type: AccountCashFlowType) {
  return cashFlowTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function FundsPage() {
  const { entries: accountPrincipals, error: accountPrincipalsError } = useAccountPrincipals();
  const {
    entries: cashFlows,
    error: cashFlowsError,
    addCashFlow,
  } = useAccountCashFlows();
  const [accountSource, setAccountSource] = useState<AccountSource>('Futu');
  const [type, setType] = useState<AccountCashFlowType>('deposit');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('HKD');
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  const accountSummaries = useMemo(() => {
    return accountSourceOptions.map((source) => {
      const basePrincipal =
        accountPrincipals.find((entry) => entry.accountSource === source) ?? {
          accountSource: source,
          principalAmount: 0,
          currency: 'HKD',
        };

      const relatedFlows = cashFlows.filter((entry) => entry.accountSource === source);
      const netFlowHKD = relatedFlows.reduce(
        (sum, entry) =>
          sum +
          convertCurrency(
            getCashFlowSignedAmount(entry),
            entry.currency,
            'HKD',
          ),
        0,
      );
      const baselineHKD = convertCurrency(
        basePrincipal.principalAmount,
        basePrincipal.currency,
        'HKD',
      );

      return {
        accountSource: source,
        baseline: basePrincipal,
        recentCount: relatedFlows.length,
        netFlowHKD,
        totalPrincipalHKD: baselineHKD + netFlowHKD,
      };
    });
  }, [accountPrincipals, cashFlows]);

  async function handleCreateCashFlow() {
    if (!amount.trim()) {
      setSaveError('請先輸入金額。');
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(null);

    try {
      await addCashFlow({
        accountSource,
        type,
        amount: Number(amount) || 0,
        currency: currency.trim().toUpperCase() || 'HKD',
        date,
        note: note.trim() || undefined,
      });

      setAmount('');
      setNote('');
      setSaveSuccess('資金流水已新增。');
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : '新增資金流水失敗，請稍後再試。',
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="page-stack">
      {accountPrincipalsError ? (
        <p className="status-message status-message-error">{accountPrincipalsError}</p>
      ) : null}
      {cashFlowsError ? (
        <p className="status-message status-message-error">{cashFlowsError}</p>
      ) : null}

      <section className="summary-grid">
        {accountSummaries.map((summary) => (
          <article key={summary.accountSource} className="summary-card">
            <p className="summary-label">{getAccountSourceLabel(summary.accountSource)}</p>
            <strong className="summary-value">{formatCurrency(summary.totalPrincipalHKD, 'HKD')}</strong>
            <p className="summary-hint">
              基線 {formatCurrency(summary.baseline.principalAmount, summary.baseline.currency)} ·
              流水 {summary.recentCount} 筆
            </p>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">New Entry</p>
            <h2>新增資金流水</h2>
            <p className="table-hint">用來記錄每個帳戶之後嘅入金、提款或手動調整。</p>
          </div>
        </div>

        {saveError ? <p className="status-message status-message-error">{saveError}</p> : null}
        {saveSuccess ? <p className="status-message status-message-success">{saveSuccess}</p> : null}

        <div className="asset-form-grid">
          <label className="form-field">
            <span>帳戶來源</span>
            <select
              value={accountSource}
              onChange={(event) => setAccountSource(event.target.value as AccountSource)}
              disabled={isSaving}
            >
              {accountSourceOptions.map((option) => (
                <option key={option} value={option}>
                  {getAccountSourceLabel(option)}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>類型</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as AccountCashFlowType)}
              disabled={isSaving}
            >
              {cashFlowTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>金額</span>
            <input
              type="number"
              step="any"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              disabled={isSaving}
              placeholder="例如 10000"
            />
          </label>

          <label className="form-field">
            <span>幣別</span>
            <input
              value={currency}
              onChange={(event) => setCurrency(event.target.value.toUpperCase())}
              disabled={isSaving}
              placeholder="例如 HKD / USD"
            />
          </label>

          <label className="form-field">
            <span>日期</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              disabled={isSaving}
            />
          </label>

          <label className="form-field">
            <span>備註</span>
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={isSaving}
              placeholder="例如 四月加倉入金"
            />
          </label>
        </div>

        <div className="form-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={handleCreateCashFlow}
            disabled={isSaving}
          >
            {isSaving ? '新增中...' : '新增資金流水'}
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Recent Flows</p>
            <h2>最近資金紀錄</h2>
          </div>
        </div>

        <div className="settings-list">
          {cashFlows.length > 0 ? (
            cashFlows.slice(0, 12).map((entry) => {
              const signedAmount = getCashFlowSignedAmount(entry);
              return (
                <div key={entry.id} className="setting-row">
                  <div>
                    <strong>
                      {getAccountSourceLabel(entry.accountSource)} · {getCashFlowTypeLabel(entry.type)}
                    </strong>
                    <p>
                      {entry.date}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                  </div>
                  <span className={signedAmount >= 0 ? 'chip chip-strong' : 'chip chip-soft'}>
                    {signedAmount >= 0 ? '+' : '-'}
                    {formatCurrency(Math.abs(signedAmount), entry.currency)}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="status-message">未有資金流水。</p>
          )}
        </div>
      </section>
    </div>
  );
}
