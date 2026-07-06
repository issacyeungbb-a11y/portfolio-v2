const FX_TO_HKD = {
  HKD: 1,
  USD: 7.8,
  JPY: 0.052
};
const CURRENCY_ALIASES = {
  HK$: "HKD",
  HKD: "HKD",
  USD: "USD",
  US$: "USD",
  JPY: "JPY",
  JPY100: "JPY",
  YEN: "JPY",
  YENS: "JPY",
  "\xA5": "JPY",
  "\uFFE5": "JPY",
  "\u5186": "JPY",
  "\u65E5\u5713": "JPY",
  "\u65E5\u5143": "JPY",
  "\u65E5\u5E63": "JPY"
};
function normalizeCurrencyCode(currency) {
  const normalized = currency.trim().toUpperCase().replace(/\s+/g, "");
  return CURRENCY_ALIASES[normalized] ?? normalized;
}
function convertCurrency(amount, fromCurrency, toCurrency, customRates) {
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
function getFxRateToHKD(currency, customRates) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const fxRates = customRates ?? FX_TO_HKD;
  return fxRates[normalizedCurrency] ?? null;
}
function convertToHKDValue(amount, currency, customRates) {
  return convertCurrency(amount, currency, "HKD", customRates);
}
function formatCurrency(value, currency) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const fractionDigits = 0;
  const amount = new Intl.NumberFormat("zh-HK", {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits
  }).format(value);
  return `${normalizedCurrency} ${amount}`;
}
function formatCurrencyRounded(value, currency) {
  const normalizedCurrency = normalizeCurrencyCode(currency);
  const amount = new Intl.NumberFormat("zh-HK", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(value);
  return `${normalizedCurrency} ${amount}`;
}
function formatPercent(value) {
  const decimals = Math.abs(value) < 10 ? 1 : 0;
  const rounded = Number(value.toFixed(decimals));
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(decimals)}%`;
}
export {
  CURRENCY_ALIASES,
  FX_TO_HKD,
  convertCurrency,
  convertToHKDValue,
  formatCurrency,
  formatCurrencyRounded,
  formatPercent,
  getFxRateToHKD,
  normalizeCurrencyCode
};
