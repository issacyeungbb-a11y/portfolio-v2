import type { AssetTransactionRecordType, AssetTransactionType } from '../../types/portfolio';

// Static rates mirror FX_TO_HKD in src/lib/currency.ts — kept inline to preserve zero imports.
const FX_TO_HKD: Record<string, number> = { HKD: 1, USD: 7.8, JPY: 0.052 };

function convertToHKD(amount: number, currency: string) {
  const rate = FX_TO_HKD[currency.trim().toUpperCase()] ?? 1;
  return amount * rate;
}

export interface LedgerEntryForRebuild {
  id?: string;
  transactionType: AssetTransactionType;
  quantity: number;
  price: number;
  fees: number;
  currency: string;
  date: string;
  createdAt?: string;
  recordType: AssetTransactionRecordType;
}

export interface TxRebuildResult {
  id?: string;
  realizedPnlHKD: number;
  quantityAfter: number;
  averageCostAfter: number;
}

export interface LedgerRebuildResult {
  finalQuantity: number;
  finalAverageCost: number;
  finalLatestTradePrice: number;
  txResults: TxRebuildResult[];
}

export function validateLedgerEntry(entry: LedgerEntryForRebuild, quantityBefore: number) {
  if (entry.recordType === 'asset_created') {
    return;
  }

  if (entry.quantity <= 0 || entry.price <= 0) {
    throw new Error('交易數量同成交價都必須大過 0。');
  }

  if (
    entry.recordType !== 'seed' &&
    entry.transactionType === 'sell' &&
    entry.quantity > quantityBefore
  ) {
    throw new Error('賣出數量不可大過當時持倉。');
  }
}

export interface AssetValueWeight {
  symbol: string;
  quantity: number;
  currentPrice: number;
  currency: string;
}

export interface ValueWeightedRiskResult {
  valueWeightedHighRisk: boolean;
  staleValuePct: number;
  largestStaleAssetSymbol?: string;
  largestStaleAssetPct?: number;
}

export function computeValueWeightedRisk(
  staleAssets: AssetValueWeight[],
  allNonCashAssets: AssetValueWeight[],
  fxRates: { USD: number; JPY: number; HKD?: number },
): ValueWeightedRiskResult {
  if (allNonCashAssets.length === 0) {
    return { valueWeightedHighRisk: false, staleValuePct: 0 };
  }

  const toHKD = (amount: number, currency: string) => {
    const cur = currency.trim().toUpperCase();
    if (cur === 'USD') return amount * fxRates.USD;
    if (cur === 'JPY') return amount * fxRates.JPY;
    return amount;
  };

  const totalHKD = allNonCashAssets.reduce((sum, a) => sum + toHKD(a.quantity * a.currentPrice, a.currency), 0);

  if (totalHKD <= 0) {
    return { valueWeightedHighRisk: false, staleValuePct: 0 };
  }

  const staleHKD = staleAssets.reduce((sum, a) => sum + toHKD(a.quantity * a.currentPrice, a.currency), 0);
  const staleValuePct = Math.round((staleHKD / totalHKD) * 100);
  let valueWeightedHighRisk = staleValuePct > 20;
  let largestStaleAssetSymbol: string | undefined;
  let largestStaleAssetPct: number | undefined;
  let largestAssetHKD = 0;

  for (const asset of staleAssets) {
    const assetHKD = toHKD(asset.quantity * asset.currentPrice, asset.currency);
    if (assetHKD > largestAssetHKD) {
      largestAssetHKD = assetHKD;
      largestStaleAssetSymbol = asset.symbol;
      largestStaleAssetPct = Math.round((assetHKD / totalHKD) * 100);
    }
    if (assetHKD / totalHKD > 0.15) {
      valueWeightedHighRisk = true;
    }
  }

  return { valueWeightedHighRisk, staleValuePct, largestStaleAssetSymbol, largestStaleAssetPct };
}

export function runLedgerRebuild(transactions: LedgerEntryForRebuild[]): LedgerRebuildResult {
  let quantity = 0;
  let averageCost = 0;
  let latestTradePrice = 0;
  const txResults: TxRebuildResult[] = [];

  for (const transaction of transactions) {
    validateLedgerEntry(transaction, quantity);

    let nextQuantity = quantity;
    let nextAverageCost = averageCost;
    let realizedPnl = 0;

    if (transaction.recordType === 'asset_created') {
      // no-op: placeholder record, no quantity or cost change
    } else if (transaction.recordType === 'seed') {
      nextQuantity = transaction.quantity;
      nextAverageCost =
        transaction.quantity === 0
          ? 0
          : ((transaction.quantity * transaction.price) + transaction.fees) / transaction.quantity;
    } else if (transaction.transactionType === 'buy') {
      nextQuantity = quantity + transaction.quantity;
      nextAverageCost =
        nextQuantity === 0
          ? 0
          : ((quantity * averageCost) +
              (transaction.quantity * transaction.price) +
              transaction.fees) /
            nextQuantity;
    } else {
      nextQuantity = Math.max(0, quantity - transaction.quantity);
      realizedPnl =
        (transaction.price - averageCost) * transaction.quantity - transaction.fees;
      nextAverageCost = nextQuantity === 0 ? 0 : averageCost;
    }

    latestTradePrice = transaction.price;
    quantity = nextQuantity;
    averageCost = nextAverageCost;

    txResults.push({
      id: transaction.id,
      realizedPnlHKD: convertToHKD(realizedPnl, transaction.currency),
      quantityAfter: nextQuantity,
      averageCostAfter: nextAverageCost,
    });
  }

  return {
    finalQuantity: quantity,
    finalAverageCost: averageCost,
    finalLatestTradePrice: latestTradePrice,
    txResults,
  };
}
