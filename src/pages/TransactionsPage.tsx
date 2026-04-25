import { useMemo, useState } from 'react';

import { AssetTransactionForm } from '../components/assets/AssetTransactionForm';
import { TransactionInputPanel } from '../components/transactions/TransactionInputPanel';
import { CurrencyToggle } from '../components/ui/CurrencyToggle';
import { EmptyState } from '../components/ui/EmptyState';
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  getAccountSourceLabel,
  getAssetTypeLabel,
} from '../data/mockPortfolio';
import { useAssetTransactions } from '../hooks/useAssetTransactions';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
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
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();

  const visibleEntries = entries.filter(
    (entry) => !(entry.recordType === 'seed' && entry.note === '歷史持倉基線'),
  );
  const totalTradeAmountDisplay = visibleEntries.reduce(
    (sum, entry) => sum + convertCurrency(entry.quantity * entry.price, entry.currency, displayCurrency),
    0,
  );
  const holdingsById = useMemo(
    () => new Map(holdings.map((holding) => [holding.id, holding])),
    [holdings],
  );
  const latestTradeDate =
    [...visibleEntries]
      .map((entry) => entry.date)
      .filter(Boolean)
      .sort((left, right) => right.localeCompare(left))[0] ?? null;
  const latestTradeLabel = latestTradeDate ? formatTradeDate(latestTradeDate) : '未有記錄';
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '交易',
      subtitle: '查看、編輯同輸入持倉交易記錄。',
      metaItems: [
        { label: '基準貨幣', value: 'HKD' },
        { label: '顯示貨幣', value: displayCurrency },
        { label: '交易筆數', value: `${visibleEntries.length} 筆` },
        { label: '最近交易', value: latestTradeLabel },
      ],
      statusItems: [
        {
          label: status === 'error' ? '同步失敗' : status === 'loading' ? '同步中' : '已同步',
          tone: status === 'error' ? 'danger' : status === 'loading' ? 'warning' : 'success',
        },
        {
          label: visibleEntries.length > 0 ? '交易紀錄完整' : '暫無資料',
          tone: visibleEntries.length > 0 ? 'success' : 'neutral',
        },
      ],
      actions: (
        <div className="top-bar-inline-actions">
          <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
          <button
            className="button button-primary"
            type="button"
            onClick={() => setIsTransactionInputOpen((current) => !current)}
          >
            {isTransactionInputOpen ? '收起輸入交易' : '輸入交易'}
          </button>
        </div>
      ),
    }),
    [
      displayCurrency,
      isTransactionInputOpen,
      latestTradeLabel,
      setDisplayCurrency,
      status,
      visibleEntries.length,
    ],
  );

  useTopBar(topBarConfig);

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
      <section className="hero-panel transactions-hero-panel">
        <div className="dashboard-overview-hero">
          <span className="dashboard-overview-label">交易管理</span>
          <strong>{visibleEntries.length} 筆交易記錄</strong>
          <p className="table-hint">記錄建倉、買入同賣出，所有金額會按你揀選嘅顯示幣別統一顯示。</p>
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
          <strong className="summary-value">
            {formatCurrencyRounded(totalTradeAmountDisplay, displayCurrency)}
          </strong>
          <p className="summary-hint">按各筆成交價 x 數量換算至顯示幣別</p>
        </article>
        <article className="summary-card">
          <p className="summary-label">已實現盈虧</p>
          <strong className="summary-value">
            {formatCurrencyRounded(
              convertCurrency(
                visibleEntries.reduce((sum, entry) => sum + entry.realizedPnlHKD, 0),
                'HKD',
                displayCurrency,
              ),
              displayCurrency,
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
              const grossAmountDisplay = convertCurrency(grossAmount, entry.currency, displayCurrency);
              const feesDisplay = convertCurrency(entry.fees, entry.currency, displayCurrency);
              const realizedPnlDisplay = convertCurrency(entry.realizedPnlHKD, 'HKD', displayCurrency);
              const averageCostDisplay = convertCurrency(
                entry.averageCostAfter ?? 0,
                entry.currency,
                displayCurrency,
              );
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
                      持倉 {entry.quantityAfter ?? 0} · 均成本 {formatCurrency(averageCostDisplay, displayCurrency)}
                    </p>
                  </div>
                  <div className="table-metric">
                    <strong className="table-metric-primary">
                      {entry.quantity} @ {formatCurrency(convertCurrency(entry.price, entry.currency, displayCurrency), displayCurrency)}
                    </strong>
                    <span className="table-metric-secondary">
                      總額 {formatCurrency(grossAmountDisplay, displayCurrency)} · 手續費 {formatCurrency(feesDisplay, displayCurrency)}
                    </span>
                    <span className="table-metric-secondary">
                      已實現 {formatCurrency(realizedPnlDisplay, displayCurrency)}
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
            <EmptyState
              title="尚未有交易記錄"
              reason="你可以用頂欄「輸入交易」開始新增第一筆記錄，或者用 AI 文字快速整理多筆交易。"
              primaryAction={
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => setIsTransactionInputOpen(true)}
                >
                  輸入交易
                </button>
              }
            />
          )}
        </div>
      </section>
    </div>
  );
}
