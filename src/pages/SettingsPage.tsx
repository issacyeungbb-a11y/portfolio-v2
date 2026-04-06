import { useEffect, useMemo, useState } from 'react';

import { formatCurrency, getAccountSourceLabel } from '../data/mockPortfolio';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import { usePortfolioAccess } from '../hooks/usePortfolioAccess';
import type { AccountPrincipalEntry, AccountSource } from '../types/portfolio';

const accountSourceOptions: AccountSource[] = ['Futu', 'IB', 'Crypto', 'Other'];

export function SettingsPage() {
  const { status, lock } = usePortfolioAccess();
  const {
    entries: accountPrincipals,
    error: accountPrincipalError,
    status: accountPrincipalStatus,
    updateAccountPrincipal,
  } = useAccountPrincipals();
  const [savingAccountSource, setSavingAccountSource] = useState<AccountSource | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const principalEntries = useMemo(() => {
    const entryMap = new Map<AccountSource, AccountPrincipalEntry>();

    accountSourceOptions.forEach((accountSource) => {
      entryMap.set(accountSource, {
        accountSource,
        principalAmount: 0,
        currency: 'HKD',
      });
    });

    accountPrincipals.forEach((entry) => {
      entryMap.set(entry.accountSource, entry);
    });

    return accountSourceOptions.map((accountSource) => entryMap.get(accountSource)!);
  }, [accountPrincipals]);

  async function handleSavePrincipal(entry: AccountPrincipalEntry) {
    setSavingAccountSource(entry.accountSource);
    setSaveMessage(null);
    setSaveError(null);

    try {
      await updateAccountPrincipal(entry);
      setSaveMessage(`${getAccountSourceLabel(entry.accountSource)} 本金已更新。`);
    } catch (error) {
      setSaveError(
        error instanceof Error ? error.message : '儲存帳戶本金失敗，請稍後再試。',
      );
    } finally {
      setSavingAccountSource(null);
    }
  }

  return (
    <div className="page-stack">
      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Settings</p>
            <h2>資料與存取</h2>
          </div>
        </div>

        <div className="settings-list">
          <div className="setting-row">
            <div>
              <strong>基準貨幣</strong>
            </div>
            <span className="chip chip-soft">HKD</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>價格更新模式</strong>
            </div>
            <span className="chip chip-soft">Manual</span>
          </div>
          <div className="setting-row">
            <div>
              <strong>目前模式</strong>
            </div>
            <span className="chip chip-soft">
              {status === 'unlocked' ? 'Access Code' : status}
            </span>
          </div>
          <div className="setting-row">
            <div>
              <strong>共享資料路徑</strong>
              <p className="mono-value">portfolio/app</p>
            </div>
            <span className="chip chip-strong">Shared</span>
          </div>
        </div>

        <div className="button-row">
          <button className="button button-secondary" type="button">
            匯出資產資料
          </button>
          <button className="button button-secondary" type="button" onClick={lock}>
            重新鎖定此裝置
          </button>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Account Principals</p>
            <h2>各帳戶本金</h2>
            <p className="table-hint">記錄每個帳戶累積入金本金，之後可用來對照整體回報。</p>
          </div>
          <span className="chip chip-soft">
            {accountPrincipalStatus === 'loading' ? '同步中' : '已連接'}
          </span>
        </div>

        {accountPrincipalError ? (
          <p className="status-message status-message-error">{accountPrincipalError}</p>
        ) : null}
        {saveError ? <p className="status-message status-message-error">{saveError}</p> : null}
        {saveMessage ? <p className="status-message status-message-success">{saveMessage}</p> : null}

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
          {entry.updatedAt ? ` · 更新於 ${new Intl.DateTimeFormat('zh-HK', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(entry.updatedAt))}` : ''}
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
