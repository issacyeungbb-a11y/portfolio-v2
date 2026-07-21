import type {
  AccountAllocationSlice,
  AccountCashFlowEntry,
  AccountSource,
  AllocationHolding,
  AllocationBucketKey,
  AllocationSlice,
  Holding,
} from '../types/portfolio';
import { convertCurrency, normalizeCurrencyCode } from './currency';

export const allocationBucketMeta: Record<AllocationBucketKey, { label: string; color: string }> = {
  stock: { label: '股票', color: '#0f766e' },
  etf: { label: 'ETF', color: '#d97706' },
  bond: { label: '債券', color: '#2563eb' },
  crypto: { label: '加密貨幣', color: '#7c3aed' },
  cash: { label: '現金', color: '#4b5563' },
};

export const allocationBucketOrder: AllocationBucketKey[] = [
  'stock',
  'etf',
  'bond',
  'crypto',
  'cash',
];

export const accountAllocationMeta: Record<AccountSource, { label: string; color: string }> = {
  Futu: { label: 'Futu', color: '#0f766e' },
  IB: { label: 'IB', color: '#2563eb' },
  Crypto: { label: 'Crypto', color: '#7c3aed' },
  Other: { label: '其他', color: '#d97706' },
};

export function getAllocationBucketMeta(key: AllocationBucketKey) {
  return allocationBucketMeta[key];
}

export function getAccountAllocationMeta(key: AccountSource) {
  return accountAllocationMeta[key];
}

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

function buildAllocationHoldingKey(holding: Holding) {
  return [
    holding.assetType,
    holding.symbol.trim().toUpperCase(),
    normalizeCurrencyCode(holding.currency),
  ].join('::');
}

export function aggregateHoldingsForAllocation(holdingsList: Holding[]): AllocationHolding[] {
  const grouped = new Map<string, AllocationHolding>();

  for (const holding of holdingsList) {
    const key = buildAllocationHoldingKey(holding);
    const existing = grouped.get(key);

    if (!existing) {
      grouped.set(key, {
        ...holding,
        accountSources: [holding.accountSource],
      });
      continue;
    }

    const marketValue =
      existing.marketValue +
      convertCurrency(holding.marketValue, holding.currency, existing.currency);
    const unrealizedPnl =
      existing.unrealizedPnl +
      convertCurrency(holding.unrealizedPnl, holding.currency, existing.currency);
    const quantity = existing.quantity + holding.quantity;
    const costBasis = marketValue - unrealizedPnl;

    grouped.set(key, {
      ...existing,
      id: `${existing.id}::aggregated`,
      quantity,
      marketValue,
      averageCost: quantity === 0 ? 0 : costBasis / quantity,
      currentPrice: quantity === 0 ? 0 : marketValue / quantity,
      unrealizedPnl,
      unrealizedPct: costBasis === 0 ? 0 : (unrealizedPnl / costBasis) * 100,
      allocation: existing.allocation + holding.allocation,
      accountSources: existing.accountSources.includes(holding.accountSource)
        ? existing.accountSources
        : [...existing.accountSources, holding.accountSource],
    });
  }

  return [...grouped.values()];
}

export function buildAllocationSlices(holdingsList: Holding[]): AllocationSlice[] {
  const totalHKD = getPortfolioTotalValue(holdingsList, 'HKD');
  const grouped = new Map<AllocationBucketKey, AllocationHolding[]>();

  for (const holding of aggregateHoldingsForAllocation(holdingsList)) {
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
        label: allocationBucketMeta[key].label,
        color: allocationBucketMeta[key].color,
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

export function buildAccountAllocationSlices(holdingsList: Holding[]): AccountAllocationSlice[] {
  const totalHKD = getPortfolioTotalValue(holdingsList, 'HKD');
  const grouped = new Map<AccountSource, AllocationHolding[]>();

  for (const holding of holdingsList) {
    const current = grouped.get(holding.accountSource) ?? [];
    grouped.set(holding.accountSource, [
      ...current,
      {
        ...holding,
        accountSources: [holding.accountSource],
      },
    ]);
  }

  return [...grouped.entries()]
    .map(([key, accountHoldings]) => {
      const totalValueHKD = getPortfolioTotalValue(accountHoldings, 'HKD');
      const totalValueUSD = getPortfolioTotalValue(accountHoldings, 'USD');

      return {
        key,
        label: accountAllocationMeta[key].label,
        color: accountAllocationMeta[key].color,
        value: totalHKD === 0 ? 0 : (totalValueHKD / totalHKD) * 100,
        totalValueHKD,
        totalValueUSD,
        holdings: [...accountHoldings].sort(
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
