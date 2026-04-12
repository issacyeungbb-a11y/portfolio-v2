import { useEffect, useMemo, useState } from 'react';

import {
  convertCurrency,
  formatCurrency,
  getAccountSourceLabel,
  getCashFlowSignedAmount,
} from '../data/mockPortfolio';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import { usePortfolioAccess } from '../hooks/usePortfolioAccess';
import type {
  AccountCashFlowEntry,
  AccountCashFlowType,
  AccountPrincipalEntry,
  AccountSource,
} from '../types/portfolio';

const accountSourceOptions: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];
const cashFlowTypeOptions: Array<{ value: AccountCashFlowType; label: string }> = [
  { value: 'deposit', label: '入金' },
  { value: 'withdrawal', label: '提款' },
  { value: 'adjustment', label: '調整' },
];

function getCashFlowTypeLabel(type: AccountCashFlowType) {
  return cashFlowTypeOptions.find((option) => option.value === type)?.label ?? type;
}

export function FundsPage() {
  const { status: accessStatus, lock } = usePortfolioAccess();
  const {
    entries: accountPrincipals,
    error: accountPrincipalsError,
    status: accountPrincipalStatus,
    updateAccountPrincipal,
  } = useAccountPrincipals();
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
  const [savingAccountSource, setSavingAccountSource] = useState<AccountSource | null>(null);
  const [principalSaveMessage, setPrincipalSaveMessage] = useState<string | null>(null);
  const [principalSaveError, setPrincipalSaveError] = useState<string | null>(null);

  const principalEntries = useMemo(() => {
    const entryMap = new Map<AccountSource, AccountPrincipalEntry>();

    accountSourceOptions.forEach((source) => {
      entryMap.set(source, {
        accountSource: source,
        principalAmount: 0,
        currency: 'HKD',
      });
    });

    accountPrincipals.forEach((entry) => {
      entryMap.set(entry.accountSource, entry);
    });

    return accountSourceOptions.map((source) => entryMap.get(source)!);
  }, [accountPrincipals]);

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
  const totalPrincipalHKD = accountSummaries.reduce((sum, summary) => sum + summary.totalPrincipalHKD, 0);

  async function handleSavePrincipal(entry: AccountPrincipalEntry) {
    setSavingAccountSource(entry.accountSource);
    setPrincipalSaveError(null);
    setPrincipalSaveMessage(null);

    try {
      await updateAccountPrincipal(entry);
      setPrincipalSaveMessage(`${getAccountSourceLabel(entry.accountSource)} 本金已更新。`);
    } catch (error) {
      setPrincipalSaveError(
        error instanceof Error ? error.message : '儲存帳戶本金失敗，請稍後再試。',
      );
    } finally {
      setSavingAccountSource(null);
    }
  }

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
        <article className="summary-card">
          <p className="summary-label">全部本金總數</p>
          <strong className="summary-value">{formatCurrency(totalPrincipalHKD, 'HKD')}</strong>
          <p className="summary-hint">已合併各帳戶本金基線與資金流水</p>
        </article>
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
            <p className="eyebrow">Account Principals</p>
            <h2>各帳戶本金</h2>
            <p className="table-hint">本金設定而家集中喺資金頁管理。</p>
          </div>
          <span className="chip chip-soft">
            {accountPrincipalStatus === 'loading' ? '同步中' : '已連接'}
          </span>
        </div>

        {principalSaveError ? <p className="status-message status-message-error">{principalSaveError}</p> : null}
        {principalSaveMessage ? <p className="status-message status-message-success">{principalSaveMessage}</p> : null}

        <div className="settings-list">
          {principalEntries.map((entry) => (
            <AccountPrincipalRow
              key={entry.accountSource}
              entry={entry}
              isSaving={savingAccountSource === entry.accountSource}
              onSave={handleSavePrincipal}
            />
          ))}
        </div>
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

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Access</p>
            <h2>資料與存取</h2>
          </div>
        </div>

        <div className="settings-list">
          <div className="setting-row">
            <div>
              <strong>共享資料路徑</strong>
              <p className="mono-value">portfolio/app</p>
            </div>
            <span className="chip chip-strong">Shared</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>目前模式</strong>
            </div>
            <span className="chip chip-soft">
              {accessStatus === 'unlocked' ? 'Access Code' : accessStatus}
            </span>
          </div>
        </div>

        <div className="button-row">
          <button className="button button-secondary" type="button" onClick={lock}>
            重新鎖定此裝置
          </button>
        </div>
      </section>
    </div>
  );
}

function AccountPrincipalRow({
  entry,
  isSaving,
  onSave,
}: {
  entry: AccountPrincipalEntry;
  isSaving: boolean;
  onSave: (entry: AccountPrincipalEntry) => Promise<void>;
}) {
  const [principalAmount, setPrincipalAmount] = useState(String(entry.principalAmount));
  const [currency, setCurrency] = useState(entry.currency || 'HKD');

  useEffect(() => {
    setPrincipalAmount(String(entry.principalAmount));
    setCurrency(entry.currency || 'HKD');
  }, [entry.accountSource, entry.principalAmount, entry.currency]);

  return (
    <div className="setting-row setting-row-form">
      <div className="setting-row-copy">
        <strong>{getAccountSourceLabel(entry.accountSource)}</strong>
        <p>
          目前本金 {formatCurrency(entry.principalAmount, entry.currency)}
          {entry.updatedAt
            ? ` · 更新於 ${new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.updatedAt))}`
            : ''}
        </p>
      </div>
      <div className="setting-row-controls">
        <input
          className="settings-inline-input"
          type="number"
          step="any"
          value={principalAmount}
          onChange={(event) => setPrincipalAmount(event.target.value)}
          placeholder="本金金額"
          disabled={isSaving}
        />
        <input
          className="settings-inline-input settings-inline-currency"
          value={currency}
          onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          placeholder="幣別"
          disabled={isSaving}
        />
        <button
          className="button button-secondary"
          type="button"
          onClick={() =>
            onSave({
              accountSource: entry.accountSource,
              principalAmount: Number(principalAmount) || 0,
              currency: currency.trim().toUpperCase() || 'HKD',
            })
          }
          disabled={isSaving}
        >
          {isSaving ? '儲存中...' : '儲存'}
        </button>
      </div>
    </div>
  );
}
