import { multiplyCryptoQuantity, summarizeCryptoCoins, addCryptoQuantity } from './cryptoClassification.js';
import type { CryptoManagementState, CryptoValuation } from '../types/cryptoManagement';

export type CryptoDisplayCurrency = 'USD' | 'HKD';
export function cryptoDisplayAmount(usd: number | null, currency: CryptoDisplayCurrency, usdHkd: number | null) {
  if (usd === null || !Number.isFinite(usd)) return null;
  if (currency === 'USD') return usd;
  return usdHkd !== null && Number.isFinite(usdHkd) && usdHkd > 0 ? multiplyCryptoQuantity(usd, usdHkd) : null;
}
export function cryptoPositionValue(quantity: number, price: number | null) {
  return price !== null && Number.isFinite(price) && price > 0 ? multiplyCryptoQuantity(quantity, price) : quantity === 0 ? 0 : null;
}
export function cryptoCoinValues(state: CryptoManagementState, valuation: CryptoValuation) {
  const coins = summarizeCryptoCoins(state).map(coin => {
    const price = valuation.prices[coin.symbol];
    const priceUsd = typeof price === 'number' && Number.isFinite(price) && price > 0 ? price : null;
    return { ...coin, priceUsd, valueUsd: cryptoPositionValue(coin.quantity, priceUsd) };
  });
  const complete = coins.every(coin => coin.valueUsd !== null);
  const totalUsd = coins.reduce((sum, coin) => addCryptoQuantity(sum, coin.valueUsd ?? 0), 0);
  // Allocation always uses all holdings, including earned branches, once. A missing price must not inflate the other coins' shares.
  return { complete, totalUsd, coins: coins.map(coin => ({ ...coin, allocation: complete && totalUsd > 0 && coin.valueUsd !== null ? coin.valueUsd / totalUsd : null })) };
}
export function formatCryptoMoney(amount: number | null, currency: CryptoDisplayCurrency, unitPrice = false) {
  if (amount === null || !Number.isFinite(amount)) return '待補';
  const tiny = amount !== 0 && Math.abs(amount) < (unitPrice ? 0.000001 : 0.01);
  return new Intl.NumberFormat('zh-HK', { style: 'currency', currency, ...(tiny ? { maximumSignificantDigits: 6 } : { minimumFractionDigits: 2, maximumFractionDigits: unitPrice ? 8 : 2 }) }).format(amount);
}
export const formatCryptoAllocation = (allocation: number | null) => allocation === null ? '—' : new Intl.NumberFormat('zh-HK', { style: 'percent', maximumFractionDigits: 2 }).format(allocation);
