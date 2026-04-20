import assert from 'node:assert/strict';
import test from 'node:test';

import {
  hasValidHoldingPrice,
  isHoldingPriceStale,
  isPortfolioValueCalculable,
} from './priceValidity.ts';

function createHolding(assetType, priceAsOf, currentPrice = 100) {
  return {
    assetType,
    currentPrice,
    priceAsOf,
  };
}

test('hasValidHoldingPrice follows the shared crypto freshness window', () => {
  const now = new Date('2026-04-20T12:00:00.000Z').getTime();
  const originalDateNow = Date.now;
  Date.now = () => now;

  try {
    const cryptoWithinWindow = createHolding(
      'crypto',
      new Date(now - 23 * 60 * 60 * 1000).toISOString(),
    );
    const cryptoOutsideWindow = createHolding(
      'crypto',
      new Date(now - 25 * 60 * 60 * 1000).toISOString(),
    );

    assert.equal(hasValidHoldingPrice(cryptoWithinWindow), true);
    assert.equal(hasValidHoldingPrice(cryptoOutsideWindow), false);
  } finally {
    Date.now = originalDateNow;
  }
});

test('non-crypto freshness rules remain unchanged', () => {
  const now = new Date('2026-04-20T12:00:00.000Z').getTime();
  const originalDateNow = Date.now;
  Date.now = () => now;

  try {
    const stockQuoteValid = createHolding(
      'stock',
      new Date(now - 119 * 60 * 60 * 1000).toISOString(),
    );
    const stockDisplayFresh = createHolding(
      'stock',
      new Date(now - 95 * 60 * 60 * 1000).toISOString(),
    );
    const stockDisplayStale = createHolding(
      'stock',
      new Date(now - 97 * 60 * 60 * 1000).toISOString(),
    );
    const cashHolding = createHolding('cash', undefined, 0);

    assert.equal(hasValidHoldingPrice(stockQuoteValid), true);
    assert.equal(isHoldingPriceStale(stockDisplayFresh), false);
    assert.equal(isHoldingPriceStale(stockDisplayStale), true);
    assert.equal(hasValidHoldingPrice(cashHolding), true);
  } finally {
    Date.now = originalDateNow;
  }
});

test('portfolio calculability still depends on quote freshness coverage', () => {
  const now = new Date('2026-04-20T12:00:00.000Z').getTime();
  const originalDateNow = Date.now;
  Date.now = () => now;

  try {
    const holdings = [
      createHolding('crypto', new Date(now - 23 * 60 * 60 * 1000).toISOString()),
      createHolding('stock', new Date(now - 119 * 60 * 60 * 1000).toISOString()),
      createHolding('crypto', new Date(now - 23 * 60 * 60 * 1000).toISOString()),
      createHolding('stock', new Date(now - 119 * 60 * 60 * 1000).toISOString()),
      createHolding('crypto', new Date(now - 25 * 60 * 60 * 1000).toISOString()),
    ];

    assert.equal(isPortfolioValueCalculable(holdings), true);
  } finally {
    Date.now = originalDateNow;
  }
});
