export const FX_TO_HKD = {
    HKD: 1,
    USD: 7.8,
    JPY: 0.052,
};
export const CURRENCY_ALIASES = {
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
export function normalizeCurrencyCode(currency) {
    const normalized = currency.trim().toUpperCase().replace(/\s+/g, '');
    return CURRENCY_ALIASES[normalized] ?? normalized;
}
export function convertCurrency(amount, fromCurrency, toCurrency, customRates) {
    const normalizedFromCurrency = normalizeCurrencyCode(fromCurrency);
    const normalizedToCurrency = normalizeCurrencyCode(toCurrency);
    if (normalizedFromCurrency === normalizedToCurrency)
        return amount;
    const fxRates = customRates ?? FX_TO_HKD;
    const fromRate = fxRates[normalizedFromCurrency];
    const toRate = fxRates[normalizedToCurrency];
    if (!fromRate || !toRate)
        return amount;
    const valueInHKD = amount * fromRate;
    return valueInHKD / toRate;
}
export function formatCurrency(value, currency) {
    const normalizedCurrency = normalizeCurrencyCode(currency);
    const fractionDigits = 0;
    const amount = new Intl.NumberFormat('zh-HK', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(value);
    return `${normalizedCurrency} ${amount}`;
}
export function formatCurrencyRounded(value, currency) {
    const normalizedCurrency = normalizeCurrencyCode(currency);
    const amount = new Intl.NumberFormat('zh-HK', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
    }).format(value);
    return `${normalizedCurrency} ${amount}`;
}
export function formatPercent(value) {
    const sign = value > 0 ? '+' : '';
    return `${sign}${Math.round(value)}%`;
}
