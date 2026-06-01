import { useMemo, useState } from 'react';

import { AssetInputForm } from '../components/assets/AssetInputForm';
import { PriceUpdateReviewPanel } from '../components/assets/PriceUpdateReviewPanel';
import { TransactionInputPanel } from '../components/transactions/TransactionInputPanel';
import { CurrencyToggle } from '../components/ui/CurrencyToggle';
import { StatusMessages } from '../components/ui/StatusMessages';
import { SystemDiagnosticsPanel } from '../components/ui/SystemDiagnosticsPanel';
import { useAccountCashFlows } from '../hooks/useAccountCashFlows';
import { useAccountPrincipals } from '../hooks/useAccountPrincipals';
import { useAssetTransactions } from '../hooks/useAssetTransactions';
import { usePortfolioAssets } from '../hooks/usePortfolioAssets';
import { useTodaySnapshotStatus } from '../hooks/usePortfolioSnapshots';
import { usePriceUpdateReviews } from '../hooks/usePriceUpdateReviews';
import { useDisplayCurrency } from '../hooks/useDisplayCurrency';
import { useTopBar, type TopBarConfig } from '../layout/TopBarContext';
import { callPortfolioFunction, triggerManualSnapshot } from '../lib/api/vercelFunctions';
import { recalculateHoldingAllocations } from '../lib/firebase/assets';
import { hasValidHoldingPrice } from '../lib/portfolio/priceValidity';
import { HoldingsTable } from '../components/portfolio/HoldingsTable';
import { SummaryCard } from '../components/portfolio/SummaryCard';
import { WarningPanel } from '../components/ui/DesignSystem';
import {
  convertCurrency,
  formatCurrency,
  formatCurrencyRounded,
  getAccountSourceLabel,
  getAssetTypeLabel,
  getHoldingCostInCurrency,
  getHoldingValueInCurrency,
  getCashFlowSignedAmount,
} from '../data/mockPortfolio';
import type {
  AccountCashFlowEntry,
  AccountSource,
  AssetTransactionEntry,
  AssetType,
  DisplayCurrency,
  Holding,
  PortfolioAssetInput,
} from '../types/portfolio';
import type { PendingPriceUpdateReview, PriceUpdateRequest, PriceUpdateResponse } from '../types/priceUpdates';

const MANUAL_PRICE_UPDATE_BATCH_SIZE = 3;
const MANUAL_PRICE_UPDATE_RETRY_DELAY_MS = 2000;
const ASSET_ARCHIVE_TRANSACTION_LIMIT = 1000;
const CASH_LEDGER_ACCOUNTS: AccountSource[] = ['IB', 'Futu', 'Crypto'];

interface CashLedgerEntry {
  id: string;
  accountSource: AccountSource;
  date: string;
  createdAt?: string;
  label: string;
  detail: string;
  amount: number;
  currency: string;
  source: 'trade' | 'cash_flow';
}

interface ClosedAssetArchiveEntry {
  assetId: string;
  assetName: string;
  symbol: string;
  assetType: AssetType;
  accountSource: AccountSource;
  currency: string;
  totalSoldQuantity: number;
  totalSaleProceeds: number;
  totalFees: number;
  realizedPnlHKD: number;
  lastExitDate: string;
  lastExitCreatedAt?: string;
  averageExitPrice: number;
  transactions: AssetTransactionEntry[];
}

const assetFilterOptions: Array<{ value: AssetType | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'stock', label: '股票' },
  { value: 'etf', label: 'ETF' },
  { value: 'bond', label: '債券' },
  { value: 'crypto', label: '加密貨幣' },
  { value: 'cash', label: '現金' },
];

const accountFilterOptions: Array<{ value: AccountSource | 'all'; label: string }> = [
  { value: 'all', label: '全部帳戶' },
  { value: 'Futu', label: 'Futu' },
  { value: 'IB', label: 'IB' },
  { value: 'Crypto', label: 'Crypto' },
  { value: 'Other', label: '其他' },
];

function formatLatestPriceUpdate(value: string | null) {
  if (!value) {
    return '未更新';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function getHongKongDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function formatSnapshotCapturedAt(value?: string) {
  if (!value) {
    return '';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      timeZone: 'Asia/Hong_Kong',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDateLabel(value: string) {
  if (!value) {
    return '未有日期';
  }

  try {
    return new Intl.DateTimeFormat('zh-HK', {
      dateStyle: 'medium',
    }).format(new Date(`${value}T00:00:00`));
  } catch {
    return value;
  }
}

function formatLedgerAmount(value: number, currency: string) {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  const amount = new Intl.NumberFormat('zh-HK', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3,
  }).format(Math.abs(value));

  return `${sign}${currency} ${amount}`;
}

function getCashFlowTypeLabel(type: AccountCashFlowEntry['type']) {
  if (type === 'deposit') return '入金';
  if (type === 'withdrawal') return '提款';
  return '調整';
}

function getTransactionSettlementAccountSource(entry: AssetTransactionEntry) {
  return entry.settlementAccountSource ?? entry.accountSource;
}

function getAssetTransactionCashDelta(entry: AssetTransactionEntry) {
  if ((entry.recordType ?? 'trade') !== 'trade') {
    return 0;
  }

  const grossAmount = entry.quantity * entry.price;
  return entry.transactionType === 'buy'
    ? -(grossAmount + entry.fees)
    : grossAmount - entry.fees;
}

function buildCashLedgerEntries(
  accountSource: AccountSource,
  transactions: AssetTransactionEntry[],
  cashFlows: AccountCashFlowEntry[],
) {
  const tradeEntries: CashLedgerEntry[] = transactions
    .filter((entry) => getTransactionSettlementAccountSource(entry) === accountSource)
    .flatMap((entry) => {
      const amount = getAssetTransactionCashDelta(entry);
      if (Math.abs(amount) < 1e-9) {
        return [];
      }

      const action = entry.transactionType === 'buy' ? '買入' : '賣出';

      return [{
        id: `trade-${entry.id}`,
        accountSource,
        date: entry.date,
        createdAt: entry.createdAt,
        label: `${entry.symbol} · ${action}`,
        detail: `${entry.quantity} @ ${formatLedgerAmount(entry.price, entry.currency).replace(/^[+-]/, '')} · 手續費 ${formatLedgerAmount(entry.fees, entry.currency).replace(/^[+-]/, '')}`,
        amount,
        currency: entry.currency,
        source: 'trade' as const,
      }];
    });

  const externalFlowEntries: CashLedgerEntry[] = cashFlows
    .filter((entry) => entry.accountSource === accountSource)
    .map((entry) => ({
      id: `cash-flow-${entry.id}`,
      accountSource,
      date: entry.date,
      createdAt: entry.createdAt,
      label: getCashFlowTypeLabel(entry.type),
      detail: entry.note || '外部資金流水',
      amount: getCashFlowSignedAmount(entry),
      currency: entry.currency,
      source: 'cash_flow' as const,
    }));

  return [...tradeEntries, ...externalFlowEntries].sort((left, right) => {
    const dateDiff = right.date.localeCompare(left.date);
    if (dateDiff !== 0) return dateDiff;

    return (right.createdAt ?? '').localeCompare(left.createdAt ?? '');
  });
}

function buildClosedAssetArchiveEntries(transactions: AssetTransactionEntry[]) {
  const groupedTransactions = transactions.reduce<Record<string, AssetTransactionEntry[]>>(
    (accumulator, entry) => {
      if (!entry.assetId || entry.assetType === 'cash') {
        return accumulator;
      }

      accumulator[entry.assetId] = [...(accumulator[entry.assetId] ?? []), entry];
      return accumulator;
    },
    {},
  );

  return Object.entries(groupedTransactions)
    .flatMap<ClosedAssetArchiveEntry>(([assetId, assetTransactionsForAsset]) => {
      const sortedTransactions = [...assetTransactionsForAsset].sort((left, right) => {
        const dateDiff = left.date.localeCompare(right.date);
        if (dateDiff !== 0) return dateDiff;

        const createdDiff = (left.createdAt ?? '').localeCompare(right.createdAt ?? '');
        if (createdDiff !== 0) return createdDiff;

        return left.id.localeCompare(right.id);
      });
      const latestTransaction = sortedTransactions[sortedTransactions.length - 1];

      if (!latestTransaction || (latestTransaction.quantityAfter ?? 0) > 1e-8) {
        return [];
      }

      const sellTransactions = sortedTransactions.filter(
        (entry) => (entry.recordType ?? 'trade') === 'trade' && entry.transactionType === 'sell',
      );

      if (sellTransactions.length === 0) {
        return [];
      }

      const totalSoldQuantity = sellTransactions.reduce((sum, entry) => sum + entry.quantity, 0);
      const totalSaleProceeds = sellTransactions.reduce(
        (sum, entry) => sum + (entry.quantity * entry.price - entry.fees),
        0,
      );
      const totalFees = sellTransactions.reduce((sum, entry) => sum + entry.fees, 0);
      const realizedPnlHKD = sortedTransactions.reduce(
        (sum, entry) => sum + (entry.realizedPnlHKD || 0),
        0,
      );

      return [{
        assetId,
        assetName: latestTransaction.assetName,
        symbol: latestTransaction.symbol,
        assetType: latestTransaction.assetType,
        accountSource: latestTransaction.accountSource,
        currency: latestTransaction.currency,
        totalSoldQuantity,
        totalSaleProceeds,
        totalFees,
        realizedPnlHKD,
        lastExitDate: latestTransaction.date,
        lastExitCreatedAt: latestTransaction.createdAt,
        averageExitPrice: totalSoldQuantity === 0 ? 0 : totalSaleProceeds / totalSoldQuantity,
        transactions: sortedTransactions,
      }];
    })
    .sort((left, right) => {
      const dateDiff = right.lastExitDate.localeCompare(left.lastExitDate);
      if (dateDiff !== 0) return dateDiff;

      return (right.lastExitCreatedAt ?? '').localeCompare(left.lastExitCreatedAt ?? '');
    });
}

function getPendingPriceUpdateReason(review: PendingPriceUpdateReview) {
  if (review.invalidReason) {
    const trimmedReason = review.invalidReason.trim();
    if (trimmedReason.length <= 24) {
      return trimmedReason;
    }
  }

  switch (review.failureCategory) {
    case 'quote_time':
      return '價格過舊';
    case 'source_missing':
      return '來源缺失';
    case 'diff_too_large':
      return '變動過大';
    case 'price_missing':
      return '價格缺失';
    case 'response_format':
      return '回應格式異常';
    case 'confidence_low':
      return '可信度不足';
    case 'ticker_format':
      return '代號格式錯誤';
    case 'unknown':
      return '待人工檢查';
    default:
      return '價格過舊';
  }
}

function hasPassedHongKongSnapshotDeadline(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const currentMinutes = hour * 60 + minute;

  return currentMinutes >= 8 * 60;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function AssetsPage() {
  const {
    holdings: firestoreHoldings,
    status,
    error,
    isEmpty,
    editAsset,
    removeAsset,
  } = usePortfolioAssets();
  const { entries: accountPrincipals, error: accountPrincipalsError } = useAccountPrincipals();
  const { entries: accountCashFlows, error: accountCashFlowsError } = useAccountCashFlows();
  const { entries: assetTransactions, error: assetTransactionsError } = useAssetTransactions({
    limitCount: ASSET_ARCHIVE_TRANSACTION_LIMIT,
  });
  const {
    todaySnapshot,
    status: todaySnapshotStatus,
    error: todaySnapshotError,
    refresh: refreshTodaySnapshot,
  } = useTodaySnapshotStatus();
  const {
    reviews,
    error: reviewsError,
    hasPendingReviews,
    saveReviews,
    applyReviews,
    confirmReview,
    dismissReview,
    overrideReview,
  } = usePriceUpdateReviews();
  const [assetFilter, setAssetFilter] = useState<AssetType | 'all'>('all');
  const [accountFilter, setAccountFilter] = useState<AccountSource | 'all'>('all');
  const [displayCurrency, setDisplayCurrency] = useDisplayCurrency();
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [tradingHolding, setTradingHolding] = useState<Holding | null>(null);
  const [cashLedgerAccount, setCashLedgerAccount] = useState<AccountSource | null>(null);
  const [selectedClosedAssetId, setSelectedClosedAssetId] = useState<string | null>(null);
  const [isEditingAsset, setIsEditingAsset] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [isDeletingAsset, setIsDeletingAsset] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isUpdatingAllPrices, setIsUpdatingAllPrices] = useState(false);
  const [isBulkUpdateConfirmOpen, setIsBulkUpdateConfirmOpen] = useState(false);
  const [updatingAssetIds, setUpdatingAssetIds] = useState<string[]>([]);
  const [priceUpdateError, setPriceUpdateError] = useState<string | null>(null);
  const [priceUpdateSuccess, setPriceUpdateSuccess] = useState<string | null>(null);
  const [confirmingAssetIds, setConfirmingAssetIds] = useState<string[]>([]);
  const [dismissingAssetIds, setDismissingAssetIds] = useState<string[]>([]);
  const [overridingAssetIds, setOverridingAssetIds] = useState<string[]>([]);
  const [reviewActionError, setReviewActionError] = useState<string | null>(null);
  const [reviewActionSuccess, setReviewActionSuccess] = useState<string | null>(null);
  const [isGeneratingManualSnapshot, setIsGeneratingManualSnapshot] = useState(false);
  const [manualSnapshotError, setManualSnapshotError] = useState<string | null>(null);
  const [manualSnapshotSuccess, setManualSnapshotSuccess] = useState<string | null>(null);

  const holdings: Holding[] = recalculateHoldingAllocations(
    firestoreHoldings,
    (holding) => getHoldingValueInCurrency(holding, 'HKD'),
  );

  const filteredHoldings = holdings.filter((holding) => {
    const matchesAssetType = assetFilter === 'all' || holding.assetType === assetFilter;
    const matchesAccount = accountFilter === 'all' || holding.accountSource === accountFilter;

    return matchesAssetType && matchesAccount;
  });

  const nonCashHoldings = holdings.filter((holding) => holding.assetType !== 'cash');
  const todayKey = getHongKongDateKey();
  // 今日已更新：lastPriceUpdatedAt 在今日（HKT），無論 priceAsOf 是否符合顯示時窗
  const todayUpdatedHoldings = nonCashHoldings.filter((holding) => {
    if (!holding.lastPriceUpdatedAt) {
      return false;
    }

    return getHongKongDateKey(new Date(holding.lastPriceUpdatedAt)) === todayKey;
  });
  const todayUpdatedCount = todayUpdatedHoldings.length;
  const latestSyncAt = todayUpdatedHoldings.reduce<string | undefined>((latest, holding) => {
    if (!holding.lastPriceUpdatedAt) return latest;
    if (!latest) return holding.lastPriceUpdatedAt;
    return holding.lastPriceUpdatedAt > latest ? holding.lastPriceUpdatedAt : latest;
  }, undefined);
  const latestSyncTimeLabel = latestSyncAt
    ? new Intl.DateTimeFormat('zh-HK', {
        timeZone: 'Asia/Hong_Kong',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(new Date(latestSyncAt))
    : undefined;
  // 待更新：後端 QUOTE_FRESHNESS 時窗內無有效價格（hasValidHoldingPrice 使用 QUOTE 時窗）
  const pendingPriceCount = holdings.filter(
    (holding) => holding.assetType !== 'cash' && !hasValidHoldingPrice(holding),
  ).length;
  const pendingPriceUpdateReasons = reviews.reduce<Record<string, string>>((accumulator, review) => {
    accumulator[review.assetId] = getPendingPriceUpdateReason(review);
    return accumulator;
  }, {});
  const filteredValue = filteredHoldings.reduce(
    (sum, holding) => sum + getHoldingValueInCurrency(holding, displayCurrency),
    0,
  );
  const assetTypeValue = holdings
    .filter((holding) => assetFilter === 'all' || holding.assetType === assetFilter)
    .reduce(
      (sum, holding) => sum + getHoldingValueInCurrency(holding, displayCurrency),
      0,
    );
  const accountValue = holdings
    .filter((holding) => accountFilter === 'all' || holding.accountSource === accountFilter)
    .reduce(
      (sum, holding) => sum + getHoldingValueInCurrency(holding, displayCurrency),
      0,
    );
  const filteredCost = filteredHoldings.reduce(
    (sum, holding) => sum + getHoldingCostInCurrency(holding, displayCurrency),
    0,
  );
  const principalEntries =
    accountFilter === 'all'
      ? accountPrincipals
      : accountPrincipals.filter((entry) => entry.accountSource === accountFilter);
  const cashFlowEntries =
    accountFilter === 'all'
      ? accountCashFlows
      : accountCashFlows.filter((entry) => entry.accountSource === accountFilter);
  const filteredPrincipal =
    principalEntries.reduce(
      (sum, entry) =>
        sum + convertCurrency(entry.principalAmount, entry.currency, displayCurrency),
      0,
    ) +
    cashFlowEntries.reduce(
      (sum, entry) =>
        sum +
        convertCurrency(
          getCashFlowSignedAmount(entry),
          entry.currency,
          displayCurrency,
        ),
      0,
    );
  const filteredPnl = filteredValue - filteredPrincipal;
  const syncedCoveragePct =
    nonCashHoldings.length === 0
      ? 0
      : Math.round((todayUpdatedCount / nonCashHoldings.length) * 100);
  const coverageLabel =
    nonCashHoldings.length === 0 ? '未有可更新資產' : `${syncedCoveragePct}% 今日已同步`;
  const todaySnapshotComplete = todaySnapshot.exists;
  const activeFilterLabel = `${getAssetTypeLabel(assetFilter)} · ${getAccountSourceLabel(accountFilter)}`;
  const todaySnapshotLabel = !todaySnapshot.exists
    ? todaySnapshotStatus === 'loading'
      ? '今日快照 同步中'
      : '今日快照 待補'
    : todaySnapshot.quality === 'fallback'
      ? '今日快照 部分完成'
      : '今日快照 完整';
  const shouldShowMissingSnapshotNotice =
    todaySnapshotStatus === 'ready' &&
    nonCashHoldings.length > 0 &&
    !todaySnapshot.exists &&
    hasPassedHongKongSnapshotDeadline();
  const topBarConfig = useMemo<TopBarConfig>(
    () => ({
      title: '資產管理',
      subtitle: '管理持倉、價格更新與資料覆核。',
      primaryStatus: {
        label: pendingPriceCount > 0 ? `價格待更新 ${pendingPriceCount} 項` : '全部價格已更新',
        tone: pendingPriceCount > 0 ? 'warning' : 'success',
      },
    }),
    [
      pendingPriceCount,
    ],
  );
  const cashLedgerByAccount = useMemo(
    () =>
      CASH_LEDGER_ACCOUNTS.reduce<Record<AccountSource, CashLedgerEntry[]>>(
        (accumulator, accountSource) => {
          accumulator[accountSource] = buildCashLedgerEntries(
            accountSource,
            assetTransactions,
            accountCashFlows,
          );
          return accumulator;
        },
        {
          IB: [],
          Futu: [],
          Crypto: [],
          Other: [],
        },
      ),
    [accountCashFlows, assetTransactions],
  );
  const cashHoldingsByAccount = useMemo(
    () =>
      new Map(
        holdings
          .filter((holding) => holding.assetType === 'cash' && holding.currency === 'USD')
          .map((holding) => [holding.accountSource, holding]),
      ),
    [holdings],
  );
  const activeCashLedgerAccount = cashLedgerAccount ?? 'Futu';
  const closedAssetArchiveEntries = useMemo(
    () => buildClosedAssetArchiveEntries(assetTransactions),
    [assetTransactions],
  );
  const selectedClosedAsset = selectedClosedAssetId
    ? closedAssetArchiveEntries.find((entry) => entry.assetId === selectedClosedAssetId) ?? null
    : null;
  const closedArchivePnl = closedAssetArchiveEntries.reduce(
    (sum, entry) => sum + entry.realizedPnlHKD,
    0,
  );
  const closedArchiveSaleProceeds = closedAssetArchiveEntries.reduce(
    (sum, entry) => sum + convertCurrency(entry.totalSaleProceeds, entry.currency, displayCurrency),
    0,
  );

  useTopBar(topBarConfig);

  async function handleTriggerManualSnapshot() {
    setManualSnapshotError(null);
    setManualSnapshotSuccess(null);
    setIsGeneratingManualSnapshot(true);

    try {
      const result = (await triggerManualSnapshot()) as {
        ok?: boolean;
        message?: string;
      };

      setManualSnapshotSuccess(result.message ?? '已後補今日快照。');
      await refreshTodaySnapshot();
    } catch (error) {
      setManualSnapshotError(
        error instanceof Error ? error.message : '後補快照失敗，請稍後再試。',
      );
    } finally {
      setIsGeneratingManualSnapshot(false);
    }
  }

  async function handleEditHolding(payload: PortfolioAssetInput) {
    if (!editingHolding) {
      return;
    }

    setIsEditingAsset(true);
    setSaveError(null);

    try {
      await editAsset(editingHolding.id, payload);
      setEditingHolding(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '更新資產失敗，請稍後再試。';
      setSaveError(message);
    } finally {
      setIsEditingAsset(false);
    }
  }

  async function handleDeleteHolding() {
    if (!editingHolding) {
      return;
    }

    setIsDeletingAsset(true);
    setSaveError(null);

    try {
      await removeAsset(editingHolding.id);
      setIsDeleteConfirmOpen(false);
      setEditingHolding(null);
    } catch (submissionError) {
      const message =
        submissionError instanceof Error
          ? submissionError.message
          : '刪除資產失敗，請稍後再試。';
      setSaveError(message);
    } finally {
      setIsDeletingAsset(false);
    }
  }

  function buildPriceUpdateRequest(targetHoldings: Holding[]): PriceUpdateRequest {
    return {
      assets: targetHoldings.map((holding) => ({
        assetId: holding.id,
        assetName: holding.name,
        ticker: holding.symbol,
        assetType: holding.assetType,
        accountSource: holding.accountSource,
        currentPrice: holding.currentPrice,
        currency: holding.currency,
      })),
    };
  }

  function chunkHoldingsForManualUpdate(targetHoldings: Holding[]) {
    const chunks: Holding[][] = [];

    for (let index = 0; index < targetHoldings.length; index += MANUAL_PRICE_UPDATE_BATCH_SIZE) {
      chunks.push(targetHoldings.slice(index, index + MANUAL_PRICE_UPDATE_BATCH_SIZE));
    }

    return chunks;
  }

  async function callPriceUpdateChunkWithRetry(chunk: Holding[]) {
    try {
      return (await callPortfolioFunction(
        'update-prices',
        buildPriceUpdateRequest(chunk),
      )) as PriceUpdateResponse;
    } catch (error) {
      await sleep(MANUAL_PRICE_UPDATE_RETRY_DELAY_MS);
      return (await callPortfolioFunction(
        'update-prices',
        buildPriceUpdateRequest(chunk),
      )) as PriceUpdateResponse;
    }
  }

  async function handleRunPriceUpdates(targetHoldings: Holding[]) {
    // 現金資產不走價格更新流程，餘額只由交易調整
    const updatableHoldings = targetHoldings.filter((h) => h.assetType !== 'cash');

    if (updatableHoldings.length === 0) {
      setPriceUpdateError('目前沒有可更新的資產。');
      return;
    }

    // Rebind target to filtered list for the rest of the function
    targetHoldings = updatableHoldings;

    const targetIds = targetHoldings.map((holding) => holding.id);
    const isBulkUpdate = targetHoldings.length > 1;

    setPriceUpdateError(null);
    setPriceUpdateSuccess(null);
    setReviewActionError(null);
    setReviewActionSuccess(null);

    if (isBulkUpdate) {
      setIsUpdatingAllPrices(true);
    } else {
      setUpdatingAssetIds((current) => [...new Set([...current, ...targetIds])]);
    }

    try {
      const chunks = chunkHoldingsForManualUpdate(targetHoldings);
      const responses: PriceUpdateResponse[] = [];

      for (const chunk of chunks) {
        const response = await callPriceUpdateChunkWithRetry(chunk);
        responses.push(response);
      }

      const mergedResults = responses.flatMap((response) => response.results);
      const validResults = mergedResults.filter(
        (review) => review.price != null && review.price > 0 && !review.invalidReason,
      );
      const invalidResults = mergedResults.filter(
        (review) => review.price == null || review.price <= 0 || Boolean(review.invalidReason),
      );

      if (validResults.length > 0) {
        await applyReviews(validResults);
      }

      await saveReviews(invalidResults);

      if (validResults.length > 0 && invalidResults.length > 0) {
        setPriceUpdateSuccess(
          `已自動更新 ${validResults.length} 項資產；${invalidResults.length} 項需要人工確認。`,
        );
      } else if (validResults.length > 0) {
        setPriceUpdateSuccess(`已自動更新 ${validResults.length} 項資產價格。`);
      } else if (invalidResults.length > 0) {
        setPriceUpdateSuccess(`現有 ${invalidResults.length} 項需要人工確認。`);
      } else {
        setPriceUpdateSuccess('本次沒有可套用的價格更新。');
      }
    } catch (error) {
      setPriceUpdateError(
        error instanceof Error ? error.message : '價格更新失敗，請稍後再試。',
      );
    } finally {
      if (isBulkUpdate) {
        setIsUpdatingAllPrices(false);
      }
      setUpdatingAssetIds((current) => current.filter((id) => !targetIds.includes(id)));
    }
  }

  async function handleConfirmBulkPriceUpdate() {
    setIsBulkUpdateConfirmOpen(false);
    await handleRunPriceUpdates(nonCashHoldings);
  }

  async function handleConfirmReview(review: PendingPriceUpdateReview) {
    setReviewActionError(null);
    setReviewActionSuccess(null);
    setConfirmingAssetIds((current) => [...current, review.assetId]);

    try {
      await confirmReview(review);
      setReviewActionSuccess(`已確認 ${review.ticker} 的新價格，正式資產價格已更新。`);
    } catch (error) {
      setReviewActionError(
        error instanceof Error ? error.message : '確認價格更新失敗，請稍後再試。',
      );
    } finally {
      setConfirmingAssetIds((current) => current.filter((id) => id !== review.assetId));
    }
  }

  async function handleDismissReview(assetId: string) {
    setReviewActionError(null);
    setReviewActionSuccess(null);
    setDismissingAssetIds((current) => [...current, assetId]);

    try {
      await dismissReview(assetId);
      setReviewActionSuccess('已略過這次價格更新。');
    } catch (error) {
      setReviewActionError(
        error instanceof Error ? error.message : '略過價格更新失敗，請稍後再試。',
      );
    } finally {
      setDismissingAssetIds((current) => current.filter((id) => id !== assetId));
    }
  }

  async function handleOverrideReview(review: PendingPriceUpdateReview, manualPrice: number) {
    setReviewActionError(null);
    setReviewActionSuccess(null);
    setOverridingAssetIds((current) => [...current, review.assetId]);

    try {
      await overrideReview(review, manualPrice);
      setReviewActionSuccess(
        `已手動寫入 ${review.ticker} 最新價格 ${manualPrice} ${review.currency}。`,
      );
    } catch (error) {
      setReviewActionError(
        error instanceof Error ? error.message : '手動寫入價格失敗，請稍後再試。',
      );
    } finally {
      setOverridingAssetIds((current) => current.filter((id) => id !== review.assetId));
    }
  }

  return (
    <div className="page-stack">
      <section className="summary-cluster">
        <div className="summary-grid summary-grid-primary">
          <SummaryCard
            label={`總資產 ${displayCurrency}`}
            value={formatCurrencyRounded(filteredValue, displayCurrency)}
            hint={`${filteredHoldings.length} 項 · ${activeFilterLabel}`}
          />
          <SummaryCard
            label={`本金損益 ${displayCurrency}`}
            value={formatCurrencyRounded(filteredPnl, displayCurrency)}
            hint={`本金 ${formatCurrency(filteredPrincipal, displayCurrency)}`}
            tone={filteredPnl > 0 ? 'positive' : filteredPnl < 0 ? 'caution' : 'default'}
          />
        </div>
        <div className="summary-grid summary-grid-secondary">
          <SummaryCard
            label="更新狀態"
            value={coverageLabel}
            hint={
              hasPendingReviews
                ? `待處理 ${reviews.length} 項`
                : pendingPriceCount > 0
                  ? `待更新 ${pendingPriceCount} 項`
                  : latestSyncTimeLabel
                    ? `同步於 ${latestSyncTimeLabel}`
                    : `成本 ${formatCurrency(filteredCost, displayCurrency)}`
            }
            tone={pendingPriceCount > 0 || hasPendingReviews ? 'caution' : 'positive'}
          />
        </div>
      </section>

      <section className="card assets-toolbar assets-status-strip">
        <p className="table-hint" style={{ margin: 0 }}>
          {nonCashHoldings.length === 0 ? '未有可更新資產' : `價格覆蓋率 ${syncedCoveragePct}%`}
          {' · '}待處理 {pendingPriceCount + reviews.length} 項
          {' · '}{todaySnapshotLabel}
        </p>
        <div className="assets-toolbar-actions">
          <CurrencyToggle value={displayCurrency} onChange={setDisplayCurrency} />
          <button
            className="button button-secondary"
            type="button"
            onClick={() => setIsBulkUpdateConfirmOpen(true)}
            disabled={isUpdatingAllPrices || nonCashHoldings.length === 0}
          >
            {isUpdatingAllPrices ? '更新全部資產中...' : '更新全部資產'}
          </button>
          <details className="assets-secondary-actions">
            <summary>更多操作</summary>
            <div className="button-row">
              {!todaySnapshotComplete ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={handleTriggerManualSnapshot}
                  disabled={isGeneratingManualSnapshot}
                >
                  {isGeneratingManualSnapshot ? '後補中...' : '後補快照'}
                </button>
              ) : null}
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsFilterPanelOpen((current) => !current)}
              >
                {isFilterPanelOpen ? '收起篩選' : '篩選持倉'}
              </button>
            </div>
          </details>
        </div>
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <h2>全部持倉</h2>
          </div>
          <span className={status === 'error' ? 'chip chip-strong' : 'chip chip-soft'}>
            {status === 'loading'
              ? '資料同步中'
              : status === 'error'
                ? '連接失敗'
                : '已連接'}
          </span>
        </div>

        {error ? <p className="status-message status-message-error">{error}</p> : null}
        {isEmpty ? (
          <p className="status-message">尚未有資產</p>
        ) : null}

        {isFilterPanelOpen ? (
          <div className="assets-filter-panel">
            <div className="assets-filter-block">
              <span className="assets-filter-label">資產類別</span>
              <div className="filter-row">
                {assetFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={assetFilter === option.value ? 'filter-chip active' : 'filter-chip'}
                    type="button"
                    onClick={() => setAssetFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="filter-total">
                {getAssetTypeLabel(assetFilter)} · {formatCurrencyRounded(assetTypeValue, displayCurrency)}
              </p>
            </div>

            <div className="assets-filter-block">
              <span className="assets-filter-label">帳戶來源</span>
              <div className="filter-row">
                {accountFilterOptions.map((option) => (
                  <button
                    key={option.value}
                    className={accountFilter === option.value ? 'filter-chip active' : 'filter-chip'}
                    type="button"
                    onClick={() => setAccountFilter(option.value)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <p className="filter-total">
                {getAccountSourceLabel(accountFilter)} · {formatCurrencyRounded(accountValue, displayCurrency)}
              </p>
            </div>
          </div>
        ) : null}

        <HoldingsTable
          holdings={filteredHoldings}
          displayCurrency={displayCurrency}
          onEdit={(holding) => {
            setSaveError(null);
            setEditingHolding(holding);
          }}
          onTrade={(holding) => {
            setTradingHolding(holding);
          }}
          onUpdatePrice={(holding) => handleRunPriceUpdates([holding])}
          onViewCashLedger={(holding) => {
            setCashLedgerAccount(
              CASH_LEDGER_ACCOUNTS.includes(holding.accountSource)
                ? holding.accountSource
                : 'Futu',
            );
          }}
          updatingAssetIds={updatingAssetIds}
          pendingPriceUpdateReasons={pendingPriceUpdateReasons}
        />
      </section>

      <section className="card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">清倉檔案</p>
            <h2>已清倉資產</h2>
            <p className="table-hint">
              從最近 {ASSET_ARCHIVE_TRANSACTION_LIMIT} 筆交易自動找出最後持倉數量為 0 的資產，方便翻查賣出金額及已實現盈虧。
            </p>
          </div>
          <span className="chip chip-soft">
            {closedAssetArchiveEntries.length} 項
          </span>
        </div>

        {closedAssetArchiveEntries.length > 0 ? (
          <>
            <div className="summary-grid summary-grid-secondary">
              <SummaryCard
                label={`清倉賣出總額 ${displayCurrency}`}
                value={formatCurrencyRounded(closedArchiveSaleProceeds, displayCurrency)}
                hint="按每項交易原幣轉換作估算"
              />
              <SummaryCard
                label={`已實現盈虧 ${displayCurrency}`}
                value={formatCurrencyRounded(convertCurrency(closedArchivePnl, 'HKD', displayCurrency), displayCurrency)}
                hint="由交易紀錄 realizedPnlHKD 匯總"
                tone={closedArchivePnl > 0 ? 'positive' : closedArchivePnl < 0 ? 'caution' : 'default'}
              />
            </div>

            <div className="closed-asset-grid">
              {closedAssetArchiveEntries.map((entry) => (
                <button
                  key={entry.assetId}
                  className="closed-asset-card"
                  type="button"
                  onClick={() => setSelectedClosedAssetId(entry.assetId)}
                >
                  <span className="closed-asset-card-topline">
                    <span className="table-chip">{getAssetTypeLabel(entry.assetType)}</span>
                    <span className="table-chip table-chip-strong">{getAccountSourceLabel(entry.accountSource)}</span>
                  </span>
                  <strong>{entry.assetName}</strong>
                  <span className="table-hint">{entry.symbol} · 清倉於 {formatDateLabel(entry.lastExitDate)}</span>
                  <span className="closed-asset-card-metrics">
                    <span>
                      <small>賣出</small>
                      {formatCurrencyRounded(convertCurrency(entry.totalSaleProceeds, entry.currency, displayCurrency), displayCurrency)}
                    </span>
                    <span>
                      <small>盈虧</small>
                      <strong data-tone={entry.realizedPnlHKD >= 0 ? 'positive' : 'caution'}>
                        {formatCurrencyRounded(convertCurrency(entry.realizedPnlHKD, 'HKD', displayCurrency), displayCurrency)}
                      </strong>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="status-message">
            暫時未搵到已清倉資產；之後有資產賣出至 0 股/單位，就會自動出現在這裡。
          </p>
        )}
      </section>

      {selectedClosedAsset ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card modal-card-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="closed-asset-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">清倉詳情</p>
                <h2 id="closed-asset-title">{selectedClosedAsset.assetName}</h2>
                <p className="table-hint">
                  {selectedClosedAsset.symbol}
                  {' · '}
                  {getAccountSourceLabel(selectedClosedAsset.accountSource)}
                  {' · '}
                  清倉於 {formatDateLabel(selectedClosedAsset.lastExitDate)}
                </p>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setSelectedClosedAssetId(null)}
              >
                關閉
              </button>
            </div>

            <div className="summary-grid summary-grid-secondary">
              <SummaryCard
                label="賣出數量"
                value={new Intl.NumberFormat('zh-HK', {
                  maximumFractionDigits: 8,
                }).format(selectedClosedAsset.totalSoldQuantity)}
                hint={`平均賣出價 ${formatCurrency(selectedClosedAsset.averageExitPrice, selectedClosedAsset.currency)}`}
              />
              <SummaryCard
                label={`賣出所得 ${selectedClosedAsset.currency}`}
                value={formatCurrencyRounded(selectedClosedAsset.totalSaleProceeds, selectedClosedAsset.currency)}
                hint={`手續費 ${formatCurrency(selectedClosedAsset.totalFees, selectedClosedAsset.currency)}`}
              />
              <SummaryCard
                label={`已實現盈虧 ${displayCurrency}`}
                value={formatCurrencyRounded(convertCurrency(selectedClosedAsset.realizedPnlHKD, 'HKD', displayCurrency), displayCurrency)}
                hint="清倉前所有交易盈虧合計"
                tone={selectedClosedAsset.realizedPnlHKD > 0 ? 'positive' : selectedClosedAsset.realizedPnlHKD < 0 ? 'caution' : 'default'}
              />
            </div>

            <div className="settings-list">
              {selectedClosedAsset.transactions.map((entry) => (
                <div key={entry.id} className="setting-row setting-row-wide">
                  <div>
                    <strong>
                      {entry.recordType === 'seed'
                        ? '歷史基線'
                        : entry.transactionType === 'buy'
                          ? '買入'
                          : '賣出'}
                      {' · '}
                      {formatDateLabel(entry.date)}
                    </strong>
                    <p>
                      {entry.quantity} @ {formatCurrency(entry.price, entry.currency)}
                      {' · '}
                      手續費 {formatCurrency(entry.fees, entry.currency)}
                    </p>
                    {entry.note ? <p className="table-hint">{entry.note}</p> : null}
                  </div>
                  <div className="table-metric">
                    <strong
                      className="table-metric-primary"
                      data-tone={entry.realizedPnlHKD >= 0 ? 'positive' : 'caution'}
                    >
                      {formatCurrencyRounded(convertCurrency(entry.realizedPnlHKD, 'HKD', displayCurrency), displayCurrency)}
                    </strong>
                    <span className="table-metric-secondary">
                      餘下 {entry.quantityAfter ?? 0}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {cashLedgerAccount ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card modal-card-wide"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cash-ledger-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">現金流水</p>
                <h2 id="cash-ledger-title">三個現金帳戶流水</h2>
                <p className="table-hint">
                  顯示交易買賣造成的現金加減，以及資金頁記錄的入金、提款或調整。
                </p>
              </div>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setCashLedgerAccount(null)}
              >
                關閉
              </button>
            </div>

            <div className="filter-row" role="tablist" aria-label="現金帳戶">
              {CASH_LEDGER_ACCOUNTS.map((accountSource) => {
                const cashHolding = cashHoldingsByAccount.get(accountSource);
                return (
                  <button
                    key={accountSource}
                    className={activeCashLedgerAccount === accountSource ? 'filter-chip active' : 'filter-chip'}
                    type="button"
                    onClick={() => setCashLedgerAccount(accountSource)}
                  >
                    {getAccountSourceLabel(accountSource)}
                    {' · '}
                    {cashHolding ? formatLedgerAmount(cashHolding.currentPrice, cashHolding.currency) : '未設定'}
                  </button>
                );
              })}
            </div>

            <div className="settings-list">
              {cashLedgerByAccount[activeCashLedgerAccount].length > 0 ? (
                cashLedgerByAccount[activeCashLedgerAccount].map((entry) => (
                  <div key={entry.id} className="setting-row setting-row-wide">
                    <div>
                      <strong>{entry.label}</strong>
                      <p>
                        {formatDateLabel(entry.date)}
                        {' · '}
                        {entry.source === 'trade' ? '交易現金變動' : '外部資金流水'}
                      </p>
                      <p className="table-hint">{entry.detail}</p>
                    </div>
                    <div className="table-metric">
                      <strong
                        className="table-metric-primary"
                        data-tone={entry.amount >= 0 ? 'positive' : 'caution'}
                      >
                        {formatLedgerAmount(entry.amount, entry.currency)}
                      </strong>
                    </div>
                  </div>
                ))
              ) : (
                <p className="status-message">暫時未有 {getAccountSourceLabel(activeCashLedgerAccount)} 現金流水。</p>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {isBulkUpdateConfirmOpen ? (
        <div className="modal-backdrop" role="presentation">
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="bulk-price-update-title"
          >
            <div className="section-heading">
              <div>
                <p className="eyebrow">確認</p>
                <h2 id="bulk-price-update-title">確認更新全部資產？</h2>
              </div>
            </div>
            <p className="status-message">
              會為目前全部 {nonCashHoldings.length} 項非現金資產檢查最新價格；有效結果會直接寫入，未能確認的項目會先保留供你再檢查。
            </p>
            <div className="button-row">
              <button
                className="button button-primary"
                type="button"
                onClick={handleConfirmBulkPriceUpdate}
              >
                確認更新
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsBulkUpdateConfirmOpen(false)}
              >
                取消
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {editingHolding ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <AssetInputForm
              initialValue={{
                name: editingHolding.name,
                symbol: editingHolding.symbol,
                assetType: editingHolding.assetType,
                accountSource: editingHolding.accountSource,
                currency: editingHolding.currency,
                quantity: editingHolding.quantity,
                averageCost: editingHolding.averageCost,
                currentPrice: editingHolding.currentPrice,
              }}
              title={`編輯 ${editingHolding.symbol}`}
              submitLabel="儲存變更"
              cancelLabel="關閉"
              deleteLabel="刪除資產"
              onSubmit={handleEditHolding}
              onDelete={() => setIsDeleteConfirmOpen(true)}
              onCancel={() => {
                setSaveError(null);
                setIsDeleteConfirmOpen(false);
                setEditingHolding(null);
              }}
              isSubmitting={isEditingAsset}
              isDeleting={isDeletingAsset}
              error={saveError}
            />
          </div>
        </div>
      ) : null}

      {tradingHolding ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
            <TransactionInputPanel
              presetHolding={tradingHolding}
              onClose={() => {
                setTradingHolding(null);
              }}
            />
          </div>
        </div>
      ) : null}

      {isDeleteConfirmOpen && editingHolding ? (
        <div className="modal-backdrop" role="presentation">
          <WarningPanel
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-label="永久刪除資產確認"
            eyebrow="警告"
            title="永久刪除資產"
            description={`刪除 ${editingHolding.name} (${editingHolding.symbol}) 後，會影響資產估值、配置比例、損益統計及歷史分析記錄。此動作無法自動回復。`}
          >
            <div className="button-row">
              <button
                className="button button-danger"
                type="button"
                onClick={handleDeleteHolding}
                disabled={isDeletingAsset}
              >
                {isDeletingAsset ? '刪除中...' : '永久刪除資產'}
              </button>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => setIsDeleteConfirmOpen(false)}
                disabled={isDeletingAsset}
                >
                  取消
                </button>
            </div>
          </WarningPanel>
        </div>
      ) : null}

      <StatusMessages
        errors={[
          priceUpdateError,
          accountPrincipalsError,
          accountCashFlowsError,
          assetTransactionsError,
          reviewsError,
          todaySnapshotError,
          manualSnapshotError,
        ]}
        successes={[priceUpdateSuccess, manualSnapshotSuccess]}
      />
      {shouldShowMissingSnapshotNotice ? (
        <WarningPanel
          eyebrow="快照"
          title="今日快照未生成"
          description="今日快照未能自動生成，建議手動後補以確保走勢數據完整。"
          tone="caution"
        >
          <div className="button-row">
            <button
              className="button button-secondary"
              type="button"
              onClick={handleTriggerManualSnapshot}
              disabled={isGeneratingManualSnapshot}
            >
              {isGeneratingManualSnapshot ? '生成中...' : '後補快照'}
            </button>
          </div>
        </WarningPanel>
      ) : null}
      <PriceUpdateReviewPanel
        reviews={reviews}
        onConfirm={handleConfirmReview}
        onDismiss={handleDismissReview}
        onOverride={handleOverrideReview}
        confirmingAssetIds={confirmingAssetIds}
        dismissingAssetIds={dismissingAssetIds}
        overridingAssetIds={overridingAssetIds}
        actionError={reviewActionError}
        actionSuccess={reviewActionSuccess}
      />

      {/* P1-2: 系統診斷面板（管理用途，按需展開） */}
      <SystemDiagnosticsPanel />
    </div>
  );
}
