import { normalizeCurrencyCode } from '../currency.js';
import type { AssetType } from '../../types/portfolio';

// 交易計價幣別＝上市市場的幣別。港股用港幣、美股用美元、日股用日圓。
// 現金結算仍然統一走 USD 現金戶口（見 assetTransactions.ts），呢度只負責
// 「呢筆交易的價格同手續費係咩幣」。
export type TradeCurrency = 'HKD' | 'USD' | 'JPY';

export const DEFAULT_TRADE_CURRENCY: TradeCurrency = 'USD';

export const TRADE_CURRENCY_OPTIONS: Array<{ value: TradeCurrency; label: string }> = [
  { value: 'HKD', label: '港股 · HKD' },
  { value: 'USD', label: '美股 · USD' },
  { value: 'JPY', label: '日股 · JPY' },
];

// 券商 / 報價商常見寫法：富途 HK.09988、Yahoo 9988.HK、TradingView SEHK:9988
const HK_PREFIXES = ['HK.', 'HK:', 'HKEX.', 'HKEX:', 'SEHK.', 'SEHK:'];
const US_PREFIXES = ['US.', 'US:', 'NASDAQ.', 'NASDAQ:', 'NYSE.', 'NYSE:', 'AMEX.', 'AMEX:'];
const JP_PREFIXES = ['JP.', 'JP:', 'TSE.', 'TSE:'];

const HK_SUFFIXES = ['.HK', '.HKG'];
const JP_SUFFIXES = ['.T', '.JP'];

function normalizeSymbol(symbol: string) {
  return symbol.trim().toUpperCase().replace(/\s+/g, '');
}

export function isTradeCurrency(value: string): value is TradeCurrency {
  const normalized = normalizeCurrencyCode(value);
  return normalized === 'HKD' || normalized === 'USD' || normalized === 'JPY';
}

export function toTradeCurrency(value?: string | null): TradeCurrency | null {
  if (!value) {
    return null;
  }

  const normalized = normalizeCurrencyCode(value);
  return isTradeCurrency(normalized) ? normalized : null;
}

// 由 ticker 推斷上市市場。純數字代號（700、0700、09988）係港交所寫法，
// 美股 ticker 永遠有英文字母，所以唔會撞。
export function inferTradeCurrencyFromSymbol(
  symbol: string,
  assetType?: AssetType | '',
): TradeCurrency {
  // 加密貨幣一律以美元計價，避免似港股代號的 ticker 被誤判成港股。
  if (assetType === 'crypto') {
    return 'USD';
  }

  const normalized = normalizeSymbol(symbol);

  if (!normalized) {
    return DEFAULT_TRADE_CURRENCY;
  }

  if (
    HK_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    HK_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return 'HKD';
  }

  if (US_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return 'USD';
  }

  if (
    JP_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    JP_SUFFIXES.some((suffix) => normalized.endsWith(suffix))
  ) {
    return 'JPY';
  }

  if (/^\d{1,5}$/.test(normalized)) {
    return 'HKD';
  }

  return DEFAULT_TRADE_CURRENCY;
}

export interface ResolveTradeCurrencyInput {
  symbol: string;
  assetType?: AssetType | '';
  // 現有資產：資產本身的幣別係唯一真實來源，因為 averageCost / currentPrice
  // 都係用嗰個幣別記錄。
  holdingCurrency?: string | null;
  // AI 解析文字時抽到的幣別（例如「買入 9988 100 股 @ 港幣 105」）。
  parsedCurrency?: string | null;
}

export function resolveTradeCurrency({
  symbol,
  assetType,
  holdingCurrency,
  parsedCurrency,
}: ResolveTradeCurrencyInput): TradeCurrency {
  return (
    toTradeCurrency(holdingCurrency) ??
    toTradeCurrency(parsedCurrency) ??
    inferTradeCurrencyFromSymbol(symbol, assetType)
  );
}

export function getTradeCurrencyLabel(currency: string) {
  const normalized = normalizeCurrencyCode(currency);
  return (
    TRADE_CURRENCY_OPTIONS.find((option) => option.value === normalized)?.label ?? normalized
  );
}

// 現有資產的幣別同 ticker 推斷出的市場對唔上，通常代表舊記錄用錯幣別
// （例如港股 9988 被寫成 USD）。回傳提示訊息俾畫面顯示，null 代表冇問題。
export function getTradeCurrencyMismatchWarning(input: {
  symbol: string;
  assetType?: AssetType | '';
  tradeCurrency: string;
}) {
  const inferred = inferTradeCurrencyFromSymbol(input.symbol, input.assetType);
  const selected = normalizeCurrencyCode(input.tradeCurrency);

  if (!input.symbol.trim() || !selected || selected === inferred) {
    return null;
  }

  return `${input.symbol.trim().toUpperCase()} 睇落係${getTradeCurrencyLabel(inferred)}，但呢筆交易用緊 ${selected} 計算，請確認幣別。`;
}
