import { DISPLAY_FRESHNESS_WINDOW_MS, QUOTE_FRESHNESS_WINDOW_MS } from '../../config/priceFreshness';
import type { Holding } from '../../types/portfolio';

/**
 * 時窗語意：
 *   QUOTE_FRESHNESS  — 後端「接受」報價的上限（與 server/updatePrices 一致）
 *   DISPLAY_FRESHNESS — 前端「顯示提示」的上限（更嚴格，用於視覺 stale 標記）
 *
 * hasValidHoldingPrice 使用 QUOTE_FRESHNESS：
 *   等同後端已接受此價格 → 不應在前端顯示為「待更新」。
 * isHoldingPriceStale 使用 DISPLAY_FRESHNESS：
 *   純視覺提示，表示「價格偏舊」，不代表系統未更新。
 */

function getDisplayFreshnessWindowMs(assetType: Holding['assetType']) {
  return DISPLAY_FRESHNESS_WINDOW_MS[assetType] ?? DISPLAY_FRESHNESS_WINDOW_MS.stock;
}

function getQuoteFreshnessWindowMs(assetType: Holding['assetType']) {
  return QUOTE_FRESHNESS_WINDOW_MS[assetType] ?? QUOTE_FRESHNESS_WINDOW_MS.stock;
}

function hasMissingOrInvalidPrice(holding: Holding) {
  if (holding.assetType === 'cash') return false;
  if (holding.currentPrice <= 0 || !holding.priceAsOf) return true;
  return Number.isNaN(new Date(holding.priceAsOf).getTime());
}

/**
 * 後端已接受此價格（priceAsOf 在 QUOTE_FRESHNESS 時窗內且 currentPrice > 0）。
 * 對應 server/updatePrices → isStaleQuote 的接受窗口。
 * 用途：「待更新」計數、coverage 計算。
 *
 * 現金：永遠有效（currentPrice >= 0 即可）。現金餘額只由交易增減，不走價格更新流程，
 * 因此沒有 priceAsOf，不應以時窗判斷。
 */
export function hasValidHoldingPrice(holding: Holding) {
  if (holding.assetType === 'cash') return holding.currentPrice >= 0;
  if (hasMissingOrInvalidPrice(holding)) return false;
  return Date.now() - new Date(holding.priceAsOf!).getTime() <= getQuoteFreshnessWindowMs(holding.assetType);
}

/**
 * 價格偏舊（超過 DISPLAY_FRESHNESS 但可能仍在 QUOTE_FRESHNESS 內）。
 * 純視覺提示；不代表系統未更新，不影響「待更新」計數。
 * 現金：永遠不算 stale（餘額由交易決定，無時窗概念）。
 */
export function isHoldingPriceStale(holding: Holding) {
  if (holding.assetType === 'cash') return false;
  if (hasMissingOrInvalidPrice(holding)) return true;
  return Date.now() - new Date(holding.priceAsOf!).getTime() > getDisplayFreshnessWindowMs(holding.assetType);
}

export function isPortfolioValueCalculable(holdings: Holding[]) {
  const pricedHoldings = holdings.filter((holding) => holding.assetType !== 'cash');

  if (pricedHoldings.length === 0) {
    return true;
  }

  // 使用 QUOTE_FRESHNESS 判斷：後端已接受的價格均算有效
  const validPricedHoldings = pricedHoldings.filter((holding) => hasValidHoldingPrice(holding));
  const coverage = validPricedHoldings.length / pricedHoldings.length;

  return coverage >= 0.8;
}

export function getEffectiveHoldingPrice(holding: Holding) {
  return hasValidHoldingPrice(holding) ? holding.currentPrice : 0;
}
