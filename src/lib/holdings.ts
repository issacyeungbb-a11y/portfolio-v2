import type {
  AccountCashFlowEntry,
  AllocationBucketKey,
  AllocationSlice,
  Holding,
} from '../types/portfolio';
import { convertCurrency, normalizeCurrencyCode } from './currency';

const bucketMeta: Record<AllocationBucketKey, { label: string; color: string }> = {
  stock: { label: '股票', color: '#0f766e' },
  etf: { label: 'ETF', color: '#d97706' },
  bond: { label: '債券', color: '#2563eb' },
  crypto: { label: '加密貨幣', color: '#7c3aed' },
  cash: { label: '現金', color: '#4b5563' },
};

export function getCashFlowSignedAmount(entry: Pick<AccountCashFlowEntry, 'type' | 'amount'>) {
  return entry.type === 'withdrawal' ? -Math.abs(entry.amount) : entry.amount;
}

export function getHoldingValueInCurrency(holding: Holding, currency: string) {
  return convertCurrency(holding.marketValue, holding.currency, currency);
}

export function getHoldingCostInCurrency(holding: Holding, currency: string) {
  if (holding.assetType === 'cash') {
    return getHoldingValueInCurrency(holding, currency);
  }

  return convertCurrency(holding.quantity * holding.averageCost, holding.currency, currency);
}

export function getPortfolioTotalValue(holdingsList: Holding[], currency: string) {
  return holdingsList.reduce(
    (sum, holding) => sum + getHoldingValueInCurrency(holding, currency),
    0,
  );
}

export function getPortfolioTotalCost(holdingsList: Holding[], currency: string) {
  return holdingsList.reduce(
    (sum, holding) => sum + getHoldingCostInCurrency(holding, currency),
    0,
  );
}

export function buildAllocationSlices(holdingsList: Holding[]): AllocationSlice[] {
  const totalHKD = getPortfolioTotalValue(holdingsList, 'HKD');
  const grouped = new Map<AllocationBucketKey, Holding[]>();

  for (const holding of holdingsList) {
    const bucketKey = holding.assetType;
    const current = grouped.get(bucketKey) ?? [];
    grouped.set(bucketKey, [...current, holding]);
  }

  return [...grouped.entries()]
    .map(([key, bucketHoldings]) => {
      const totalValueHKD = getPortfolioTotalValue(bucketHoldings, 'HKD');
      const totalValueUSD = getPortfolioTotalValue(bucketHoldings, 'USD');

      return {
        key,
        label: bucketMeta[key].label,
        color: bucketMeta[key].color,
        value: totalHKD === 0 ? 0 : (totalValueHKD / totalHKD) * 100,
        totalValueHKD,
        totalValueUSD,
        holdings: [...bucketHoldings].sort(
          (left, right) =>
            getHoldingValueInCurrency(right, 'HKD') - getHoldingValueInCurrency(left, 'HKD'),
        ),
      };
    })
    .sort((left, right) => right.totalValueHKD - left.totalValueHKD);
}

export function getAssetTypeLabel(assetType: Holding['assetType'] | 'all') {
  if (assetType === 'stock') return '股票';
  if (assetType === 'etf') return 'ETF';
  if (assetType === 'bond') return '債券';
  if (assetType === 'crypto') return '加密貨幣';
  if (assetType === 'cash') return '現金';
  return '全部資產類別';
}

export function getAccountSourceLabel(accountSource: Holding['accountSource'] | 'all') {
  if (accountSource === 'Futu') return 'Futu';
  if (accountSource === 'IB') return 'IB';
  if (accountSource === 'Crypto') return 'Crypto';
  if (accountSource === 'Other') return '其他';
  return '全部帳戶來源';
}

export { normalizeCurrencyCode };
