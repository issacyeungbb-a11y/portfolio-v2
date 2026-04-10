import type { Holding } from '../../types/portfolio';

function getPriceFreshnessWindowMs(assetType: Holding['assetType']) {
  if (assetType === 'crypto') {
    return 36 * 60 * 60 * 1000;
  }

  if (assetType === 'cash') {
    return Number.POSITIVE_INFINITY;
  }

  return 4 * 24 * 60 * 60 * 1000;
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
