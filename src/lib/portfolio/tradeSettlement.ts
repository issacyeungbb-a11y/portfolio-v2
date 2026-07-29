import { convertCurrency } from '../currency.js';
import type { AssetTransactionRecordType, AssetTransactionType } from '../../types/portfolio';

// 交易本身以上市市場的幣別記錄（港股 HKD、美股 USD、日股 JPY），但每個帳戶
// 只得一個 USD 現金池，所以現金變動要由交易幣別折算返 USD 先扣數。
export const SETTLEMENT_CURRENCY = 'USD';

export interface SettlementCashDeltaInput {
  recordType: AssetTransactionRecordType;
  transactionType: AssetTransactionType;
  quantity: number;
  price: number;
  fees: number;
}

// 以交易幣別計嘅現金變動：買入為負（成交金額 + 手續費），賣出為正（成交金額 − 手續費）。
// seed / asset_created 只係歷史基線，唔會郁現金。
export function calculateCashDelta(entry: SettlementCashDeltaInput) {
  if (entry.recordType !== 'trade') {
    return 0;
  }

  const grossAmount = entry.quantity * entry.price;

  return entry.transactionType === 'buy'
    ? -(grossAmount + entry.fees)
    : grossAmount - entry.fees;
}

// 四捨五入到仙位，令 update / delete 反向沖銷同原本寫入完全對稱，
// 唔會喺現金餘額度累積浮點誤差。
export function convertToSettlementAmount(amount: number, currency: string) {
  const converted = convertCurrency(amount, currency, SETTLEMENT_CURRENCY);
  return Math.round(converted * 100) / 100;
}

export function calculateSettlementCashDelta(
  entry: SettlementCashDeltaInput & { currency: string },
) {
  return convertToSettlementAmount(calculateCashDelta(entry), entry.currency);
}
