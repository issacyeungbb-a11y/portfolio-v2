import type {
  AssetTransactionEntry,
  DisplayCurrency,
  Holding,
} from '../../types/portfolio';

const FX_TO_HKD: Record<string, number> = {
  HKD: 1,
  USD: 7.8,
  JPY: 0.052,
};

function normalizeCurrencyCode(currency: string) {
  const normalized = currency.trim().toUpperCase().replace(/\s+/g, '');
  if (normalized === 'HK$') return 'HKD';
  if (normalized === 'US$') return 'USD';
  if (normalized === 'JPY100' || normalized === 'YEN' || normalized === 'YENS') return 'JPY';
  return normalized;
}

function convertCurrency(amount: number, fromCurrency: string, toCurrency: string) {
  const normalizedFromCurrency = normalizeCurrencyCode(fromCurrency);
  const normalizedToCurrency = normalizeCurrencyCode(toCurrency);

  if (normalizedFromCurrency === normalizedToCurrency) return amount;

  const fromRate = FX_TO_HKD[normalizedFromCurrency];
  const toRate = FX_TO_HKD[normalizedToCurrency];

  if (!fromRate || !toRate) return amount;

  return (amount * fromRate) / toRate;
}

export interface TransactionPriceComparison {
  entry: AssetTransactionEntry;
  kind: 'buy' | 'sell';
  label: '買入至今' | '賣後比較';
  currentPrice: number;
  currentValueDisplay: number;
  basisDisplay: number;
  comparisonDisplay: number;
  returnRate?: number;
}

export function getTransactionPriceComparison(
  entry: AssetTransactionEntry,
  holding: Holding | undefined,
  displayCurrency: DisplayCurrency,
): TransactionPriceComparison | null {
  if ((entry.recordType ?? 'trade') !== 'trade' || entry.assetType === 'cash') {
    return null;
  }

  if (!holding || !Number.isFinite(holding.currentPrice) || holding.currentPrice <= 0) {
    return null;
  }

  const currentValueDisplay = convertCurrency(
    entry.quantity * holding.currentPrice,
    holding.currency,
    displayCurrency,
  );

  if (entry.transactionType === 'buy') {
    const costDisplay = convertCurrency(
      entry.quantity * entry.price + entry.fees,
      entry.currency,
      displayCurrency,
    );
    const comparisonDisplay = currentValueDisplay - costDisplay;

    return {
      entry,
      kind: 'buy',
      label: '買入至今',
      currentPrice: holding.currentPrice,
      currentValueDisplay,
      basisDisplay: costDisplay,
      comparisonDisplay,
      returnRate: costDisplay > 0 ? comparisonDisplay / costDisplay : undefined,
    };
  }

  const proceedsDisplay = convertCurrency(
    entry.quantity * entry.price - entry.fees,
    entry.currency,
    displayCurrency,
  );

  return {
    entry,
    kind: 'sell',
    label: '賣後比較',
    currentPrice: holding.currentPrice,
    currentValueDisplay,
    basisDisplay: proceedsDisplay,
    comparisonDisplay: proceedsDisplay - currentValueDisplay,
  };
}
