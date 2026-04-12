import { useMemo, useState } from 'react';

import { AssetTransactionForm } from '../components/assets/AssetTransactionForm';
import { TransactionInputPanel } from '../components/transactions/TransactionInputPanel';
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../data/mockPortfolio';
import { useAssetTransactions } from '../hooks/useAssetTransactions';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import type { AssetTransactionEntry, Holding } from '../types/portfolio';

function formatTradeDate(value: string) {
  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function buildHoldingFallback(entry: AssetTransactionEntry): Holding {
  return {
    id: entry.assetId,
    name: entry.assetName,
    symbol: entry.symbol,
    assetType: entry.assetType,
    accountSource: entry.accountSource,
    currency: entry.currency,
    quantity: entry.quantityAfter ?? 0,
    averageCost: entry.averageCostAfter ?? entry.price,
    currentPrice: entry.price,
    marketValue: 0,
    unrealizedPnl: 0,
    unrealizedPct: 0,
    allocation: 0,
  };
}

export function TransactionsPage() {
  const { holdings } = usePortfolioAssets();
  const {
    entries,
    status,
    error,
    editTransaction,
    removeTransaction,
  } = useAssetTransactions();
  const [editingEntry, setEditingEntry] = useState<AssetTransactionEntry | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [isTransactionInputOpen, setIsTransactionInputOpen] = useState(false);

  const visibleEntries = entries.filter(
    (entry) => !(entry.recordType === 'seed' && entry.note === '歷史持倉基線'),
  );
  const totalTradeAmountHKD = visibleEntries.reduce(
    (sum, entry) => sum + convertCurrency(entry.quantity * entry.price, entry.currency, 'HKD'),
    0,
  );
  const holdingsById = useMemo(
    () => new Map(holdings.map((holding) => [holding.id, holding])),
    [holdings],
  );

  async function handleEditTransaction(
    payload: Omit<AssetTransactionEntry, 'id' | 'createdAt' | 'updatedAt' | 'realizedPnlHKD'>,
  ) {
    if (!editingEntry) {
      return;
    }

    setIsSaving(true);
    setActionError(null);

    try {
      await editTransaction(editingEntry.id, payload);
      setActionSuccess(`${editingEntry.symbol} 交易已更新。`);
      setEditingEntry(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '更新交易失敗，請稍後再試。';
      setActionError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteTransaction() {
    if (!editingEntry) {
      return;
    }

    setIsDeleting(true);
    setActionError(null);

    try {
      await removeTransaction(editingEntry.id);
      setActionSuccess(`${editingEntry.symbol} 交易已刪除。`);
      setEditingEntry(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '刪除交易失敗，請稍後再試。';
      setActionError(message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="hero-panel assets-toolbar assets-toolbar-hero">
        <div className="assets-toolbar-top">
          <span className="assets-toolbar-subtle">{visibleEntries.length} 筆 · 交易記錄</span>
        </div>
        <div className="assets-toolbar-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={() => setIsTransactionInputOpen((current) => !current)}
          >
            {isTransactionInputOpen ? '收起輸入交易' : '輸入交易'}
          </button>
        </div>
        <div className="assets-toolbar-footnote" aria-label="交易輸入提示">
          <span>撳「輸入交易」可用 AI 文字或手動新增記錄</span>
        </div>
      </section>

      {isTransactionInputOpen ? (
        <TransactionInputPanel onClose={() => setIsTransactionInputOpen(false)} />
      ) : null}

      {error ? <p className="status-message status-message-error">{error}</p> : null}
      {actionError ? <p className="status-message status-message-error">{actionError}</p> : null}
      {actionSuccess ? <p className="status-message status-message-success">{actionSuccess}</p> : null}

      <section className="summary-grid">
        <article className="summary-card">
          <p className="summary-label">記錄總數</p>
          <strong className="summary-value">{visibleEntries.length}</strong>
          <p className="summary-hint">包括建倉記錄與買入 / 賣出交易</p>
        </article>
        <article className="summary-card">
          <p className="summary-label">累計交易金額</p>
          <strong className="summary-value">{formatCurrencyRounded(totalTradeAmountHKD, 'HKD')}</strong>
          <p className="summary-hint">按各筆成交價 x 數量換算 HKD 累計</p>
        </article>
        <article className="summary-card">
          <p className="summary-label">已實現盈虧</p>
          <strong className="summary-value">
            {formatCurrencyRounded(
              visibleEntries.reduce((sum, entry) => sum + entry.realizedPnlHKD, 0),
              'HKD',
            )}
          </strong>
          <p className="summary-hint">賣出交易扣除手續費後累計</p>
        </article>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">交易</p>
            <h2>交易記錄</h2>
          </div>
          <span className={status === 'loading' ? 'chip chip-soft' : 'chip chip-strong'}>
            {status === 'loading' ? '同步中' : `${visibleEntries.length} 筆`}
          </span>
        </div>

        <div className="settings-list">
          {visibleEntries.length > 0 ? (
            visibleEntries.map((entry) => {
              const grossAmount = entry.quantity * entry.price;
              const backingHolding = holdingsById.get(entry.assetId) ?? buildHoldingFallback(entry);
              const typeLabel =
                entry.recordType === 'asset_created'
                  ? '新增資產'
                  : entry.recordType === 'seed'
                    ? '新增資產'
                    : entry.transactionType === 'buy'
                      ? '買入'
                      : '賣出';
              return (
                <div key={entry.id} className="setting-row setting-row-wide">
                  <div>
                    <strong>
                      {entry.symbol} · {typeLabel}
                    </strong>
                    <p>
                      {entry.assetName} · {getAssetTypeLabel(entry.assetType)} · {getAccountSourceLabel(entry.accountSource)}
                    </p>
                    <p>
                      {formatTradeDate(entry.date)}
                      {entry.note ? ` · ${entry.note}` : ''}
                    </p>
                    <p className="table-hint">
                      結算 {getAccountSourceLabel(entry.settlementAccountSource ?? entry.accountSource)} ·
                      {' '}
                      持倉 {entry.quantityAfter ?? 0} · 均成本 {formatCurrency(entry.averageCostAfter ?? 0, entry.currency)}
                    </p>
                  </div>
                  <div className="table-metric">
                    <strong className="table-metric-primary">
                      {entry.quantity} @ {formatCurrency(entry.price, entry.currency)}
                    </strong>
                    <span className="table-metric-secondary">
                      總額 {formatCurrency(grossAmount, entry.currency)} · 手續費 {formatCurrency(entry.fees, entry.currency)}
                    </span>
                    <span className="table-metric-secondary">
                      已實現 {formatCurrency(entry.realizedPnlHKD, 'HKD')}
                    </span>
                    <div className="table-action-stack">
                      <button
                        className="button button-secondary table-action-button"
                        type="button"
                        onClick={() => {
                          setActionError(null);
                          setActionSuccess(null);
                          setEditingEntry(entry);
                        }}
                      >
                        編輯
                      </button>
                    </div>
                  </div>
                  {editingEntry?.id === entry.id ? (
                    <div className="transaction-inline-form">
                      <AssetTransactionForm
                        holding={backingHolding}
                        initialValue={entry}
                        title={`編輯 ${entry.symbol} 交易`}
                        submitLabel="儲存修改"
                        deleteLabel="刪除交易"
                        onSubmit={handleEditTransaction}
                        onDelete={handleDeleteTransaction}
                        onCancel={() => {
                          setActionError(null);
                          setEditingEntry(null);
                        }}
                        isSubmitting={isSaving}
                        isDeleting={isDeleting}
                        error={actionError}
                      />
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <p className="status-message">
              尚未有交易記錄，撳上方「輸入交易」開始新增
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
