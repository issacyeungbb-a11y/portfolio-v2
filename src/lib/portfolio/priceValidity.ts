import { DISPLAY_FRESHNESS_WINDOW_MS } from '../../config/priceFreshness';
import type { Holding } from '../../types/portfolio';

/**
 * 前端價格新鮮度判斷。
 * 時窗常數定義於 src/config/priceFreshness.ts → DISPLAY_FRESHNESS_WINDOW_MS。
 * 不要在此處硬編碼時窗數值。
 */
function getPriceFreshnessWindowMs(assetType: Holding['assetType']) {
  return DISPLAY_FRESHNESS_WINDOW_MS[assetType] ?? DISPLAY_FRESHNESS_WINDOW_MS.stock;
}

export function isHoldingPriceStale(holding: Holding) {
  if (holding.assetType === 'cash') {
    return false;
  }

  if (holding.currentPrice <= 0 || !holding.priceAsOf) {
    return true;
  }

  const parsed = new Date(holding.priceAsOf);
  if (Number.isNaN(parsed.getTime())) {
    return true;
  }

  return Date.now() - parsed.getTime() > getPriceFreshnessWindowMs(holding.assetType);
}

export function hasValidHoldingPrice(holding: Holding) {
  return !isHoldingPriceStale(holding);
}

export function isPortfolioValueCalculable(holdings: Holding[]) {
  const pricedHoldings = holdings.filter((holding) => holding.assetType !== 'cash');

  if (pricedHoldings.length === 0) {
    return true;
  }

  const validPricedHoldings = pricedHoldings.filter((holding) => hasValidHoldingPrice(holding));
  const coverage = validPricedHoldings.length / pricedHoldings.length;

  return coverage >= 0.8;
}

export function getEffectiveHoldingPrice(holding: Holding) {
  return hasValidHoldingPrice(holding) ? holding.currentPrice : 0;
}
