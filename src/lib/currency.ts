export const FX_TO_HKD: Record<string, number> = {
  HKD: 1,
  USD: 7.8,
  JPY: 0.052,
};

export const CURRENCY_ALIASES: Record<string, string> = {
  HK$: 'HKD',
  HKD: 'HKD',
  USD: 'USD',
  US$: 'USD',
  JPY: 'JPY',
  JPY100: 'JPY',
  YEN: 'JPY',
  YENS: 'JPY',
  '¥': 'JPY',
  '￥': 'JPY',
  '円': 'JPY',
  '日圓': 'JPY',
  '日元': 'JPY',
  '日幣': 'JPY',
};

export function normalizeCurrencyCode(currency: string) {
  const normalized = currency.trim().toUpperCase().replace(/\s+/g, '');
  return CURRENCY_ALIASES[normalized] ?? normalized;
}

export function convertCurrency(
  amount: number,
  fromCurrency: string,
  toCurrency: string,
  customRates?: Record<string, number>,
) {
  const normalizedFromCurrency = normalizeCurrencyCode(fromCurrency);
  const normalizedToCurrency = normalizeCurrencyCode(toCurrency);

  if (normalizedFromCurrency === normalizedToCurrency) return amount;

  const fxRates = customRates ?? FX_TO_HKD;
  const fromRate = fxRates[normalizedFromCurrency];
  const toRate = fxRates[normalizedToCurrency];

  if (!fromRate || !toRate) return amount;

  const valueInHKD = amount * fromRate;
  return valueInHKD / toRate;
}

export function getFxRateToHKD(
  currency: string,
  customRates?: Record<string, number>,
) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const fxRates = customRates ?? FX_TO_HKD;
  return fxRates[normalizedCurrency] ?? null;
}

export function convertToHKDValue(
  amount: number,
  currency: string,
  customRates?: Record<string, number>,
) {
  return convertCurrency(amount, currency, 'HKD', customRates);
}

export function formatCurrency(value: number, currency: string) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const fractionDigits = 0;
  const amount = new Intl.NumberFormat('zh-HK', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);

  return `${normalizedCurrency} ${amount}`;
}

export function formatCurrencyRounded(value: number, currency: string) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const amount = new Intl.NumberFormat('zh-HK', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

  return `${normalizedCurrency} ${amount}`;
}

export function formatPercent(value: number) {
  const sign = value > 0 ? '+' : '';
  return `${sign}${Math.round(value)}%`;
}
