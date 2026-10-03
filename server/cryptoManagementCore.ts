import { createHash } from 'node:crypto';
import { QUOTE_FRESHNESS_WINDOW_MS } from './priceFreshness.js';
import { cryptoPlatforms } from '../src/lib/cryptoPlatforms.js';
import type { CryptoCoin, CryptoFunding, CryptoManagementState, CryptoPosition, CryptoValuation } from '../src/types/cryptoManagement';

export function checksum(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
const number = (value: unknown, label: string, signed = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || (!signed && value < 0) || Math.abs(value) > 1e15) throw new Error(`${label}必須是有效${signed ? '' : '非負'}數字。`);
  return value;
};
const text = (value: unknown, label: string, required = true) => {
  if (typeof value !== 'string' || value.length > 160 || (required && !value.trim())) throw new Error(`${label}格式不正確。`);
  return value.trim();
};
export function validateState(state: CryptoManagementState) {
  if (!state || !Array.isArray(state.coins) || !Array.isArray(state.positions) || !Array.isArray(state.liabilities) || !Array.isArray(state.funding)) throw new Error('管理資料格式不正確。');
  if (state.coins.length > 100 || state.positions.length + state.liabilities.length > 200 || state.funding.length > 1000) throw new Error('記錄數量超出上限。');
  if (state.platforms !== undefined) {
    if (!Array.isArray(state.platforms)) throw new Error('平台資料格式不正確。');
    state.platforms = state.platforms.map(p => text(p, '平台'));
    if (new Set(state.platforms).size !== state.platforms.length) throw new Error('平台名稱重複。');
  }
  const symbols = new Set<string>();
  for (const coin of state.coins) {
    coin.symbol = text(coin.symbol, '代號').toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(coin.symbol) || symbols.has(coin.symbol)) throw new Error('幣種代號無效或重複。');
    symbols.add(coin.symbol);
    coin.name = text(coin.name, '幣種名稱');
    if (!['coingecko', 'manual'].includes(coin.priceSource)) throw new Error('請選擇價格來源。');
    coin.priceSourceId = text(coin.priceSourceId, 'CoinGecko ID', coin.priceSource === 'coingecko');
    if (coin.priceSource === 'coingecko' && !/^[a-z0-9-]+$/.test(coin.priceSourceId)) throw new Error('CoinGecko ID 格式不正確。');
    if (coin.manualPriceUsd !== null) number(coin.manualPriceUsd, '手動價格');
    if (coin.manualPriceAt !== null && !Number.isFinite(Date.parse(coin.manualPriceAt))) throw new Error('手動價格日期無效。');
  }
  const ids = new Set<string>();
  for (const row of [...state.positions, ...state.liabilities, ...state.funding]) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(row.id) || ids.has(row.id)) throw new Error('記錄 ID 無效或重複。');
    ids.add(row.id);
  }
  for (const row of [...state.positions, ...state.liabilities]) {
    if (!symbols.has(row.symbol)) throw new Error(`請先設定 ${row.symbol} 嘅價格來源。`);
    number(row.quantity, '數量');
    row.custodian = text(row.custodian, '平台');
    row.status = text(row.status, '狀態');
    row.network = text(row.network, '網絡', false);
    row.collateralSymbol = text(row.collateralSymbol, '抵押資產', false).toUpperCase();
    if (row.collateralSymbol && !symbols.has(row.collateralSymbol)) throw new Error('抵押資產必須是已設定幣種。');
  }
  for (const row of state.funding) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || new Date(`${row.date}T00:00:00Z`).toISOString().slice(0, 10) !== row.date) throw new Error('資金日期無效。');
    if (!['deposit', 'withdrawal', 'adjustment'].includes(row.type)) throw new Error('資金類型無效。');
    row.source = text(row.source, '資金說明');
    number(row.hkd, '港元', row.type === 'adjustment');
    number(row.usd, '美元', row.type === 'adjustment');
  }
  if (principal(state.funding) < 0) throw new Error('本金不能低於零。');
  state.platforms = cryptoPlatforms(state);
  if (state.platforms.length > 100) throw new Error('平台數量超出上限。');
  return state;
}
export function principal(funding: CryptoFunding[]) {
  return funding.filter(r => r.type !== 'withdrawal').reduce((sum, r) => sum + r.hkd, 0);
}
export function aggregate(rows: CryptoPosition[]) {
  return rows.reduce<Record<string, number>>((result, row) => ({ ...result, [row.symbol]: (result[row.symbol] ?? 0) + row.quantity }), {});
}
export function valueCrypto(state: CryptoManagementState, quotes: Record<string, { price: number; at: string }>, now = Date.now()): CryptoValuation {
  const quantities = aggregate(state.positions);
  const debt = aggregate(state.liabilities);
  const prices: Record<string, number | null> = {};
  const warnings: string[] = [];
  let grossUsd = 0; let debtUsd = 0;
  for (const coin of state.coins) {
    const quote = coin.priceSource === 'manual' ? { price: coin.manualPriceUsd ?? 0, at: coin.manualPriceAt ?? '' } : quotes[coin.symbol];
    const valid = quote && quote.price > 0 && Number.isFinite(quote.price) && Number.isFinite(Date.parse(quote.at)) && now - Date.parse(quote.at) <= QUOTE_FRESHNESS_WINDOW_MS.crypto && Date.parse(quote.at) <= now + 300000;
    prices[coin.symbol] = valid ? quote.price : null;
    if (!valid && ((quantities[coin.symbol] ?? 0) > 0 || (debt[coin.symbol] ?? 0) > 0)) warnings.push(`${coin.symbol} 價格待補或已過期`);
    grossUsd += (quantities[coin.symbol] ?? 0) * (prices[coin.symbol] ?? 0);
    debtUsd += (debt[coin.symbol] ?? 0) * (prices[coin.symbol] ?? 0);
  }
  return { quantities, prices, warnings, grossUsd, debtUsd, netUsd: grossUsd - debtUsd, principalHkd: principal(state.funding), withdrawnUsd: state.funding.filter(r => r.type === 'withdrawal').reduce((sum, r) => sum + r.usd, 0) };
}
export function monthlyMetrics(valuation: CryptoValuation, fx: number, previousNetUsd: number | null) {
  if (valuation.warnings.length || !Number.isFinite(fx) || fx <= 0) throw new Error('缺少有效價格或匯率，不能正式月結。');
  const totalHkd = valuation.netUsd * fx;
  return { currentNetUsd: valuation.netUsd, cumulativeWithdrawnUsd: valuation.withdrawnUsd, performanceTotalUsd: valuation.netUsd, totalHkd, principalHkd: valuation.principalHkd, returnHkd: totalHkd - valuation.principalHkd, returnPct: valuation.principalHkd ? totalHkd / valuation.principalHkd - 1 : 0, monthOverMonthPct: previousNetUsd !== null && previousNetUsd > 0 ? valuation.netUsd / previousNetUsd - 1 : null };
}
export const COIN_IDS: Record<string, string> = { BTC: 'bitcoin', ETH: 'ethereum', ADA: 'cardano', BNB: 'binancecoin', CRO: 'crypto-com-chain', ATOM: 'cosmos', ATONE: 'atomone', OSMO: 'osmosis', SNEK: 'snek', WLD: 'worldcoin-wld', NEAR: 'near', USDT: 'tether', USDC: 'usd-coin', NIGHT: 'midnight-3' };
export function parseCryptoSheet(rows: unknown[][]): Omit<CryptoManagementState, 'version' | 'migratedAt'> {
  if (rows[39]?.[0] !== '資產' || rows[68]?.[0] !== '負債' || rows[0]?.[2] !== 'HKD') throw new Error('來源工作表結構已改變，遷移已停止。');
  const position = (row: unknown[], index: number, debt = false): CryptoPosition => ({ id: `${debt ? 'debt' : 'position'}_${index + 1}`, symbol: String(row[0]), custodian: String(row[1]), quantity: number(row[2], '來源數量'), status: String(row[3]), network: String(row[1]).includes('BNB') ? 'BNB Chain' : String(row[1]).includes('Ethereum') ? 'Ethereum' : '', collateralSymbol: debt ? String(row[5] ?? '') : '' });
  const positions = rows.slice(40, 67).filter(r => r[0]).map((r, i) => position(r, i));
  const liabilities = rows.slice(69, 71).filter(r => r[0]).map((r, i) => position(r, i, true));
  const symbols = [...new Set([...positions, ...liabilities].map(r => r.symbol))];
  const coins: CryptoCoin[] = symbols.map(symbol => ({ symbol, name: symbol, priceSource: COIN_IDS[symbol] ? 'coingecko' : 'manual', priceSourceId: COIN_IDS[symbol] ?? '', manualPriceUsd: null, manualPriceAt: null }));
  const funding: CryptoFunding[] = rows.slice(1, 37).filter(r => typeof r[0] === 'number' && typeof r[2] === 'number').map((r, i) => ({ id: `funding_${i + 1}`, date: new Date((Number(r[0]) - 25569) * 86400000).toISOString().slice(0, 10), source: String(r[1]), type: 'deposit', hkd: Number(r[2]), usd: number(r[3], '來源美元') }));
  // Historical withdrawals were only summarized, never invent their individual dates.
  const withdrawn = rows[71]?.[16];
  if (typeof withdrawn === 'number' && withdrawn > 0) funding.push({ id: 'opening_withdrawals', date: '2026-10-01', source: '遷移前累計提取／消費（原表未逐筆列明）', type: 'withdrawal', hkd: 0, usd: withdrawn });
  const state = { version: 1, migratedAt: '', sourceChecksum: checksum(rows), coins, positions, liabilities, funding };
  validateState(state);
  return state;
}
