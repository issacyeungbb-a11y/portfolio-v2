import assert from 'node:assert/strict';
import test from 'node:test';

import {
  QUOTE_FRESHNESS_WINDOW_MS,
} from './priceFreshness.js';
import {
  getQuoteFreshnessWindowMs,
  isStaleQuote,
} from './updatePrices.ts';

test('server quote freshness window follows centralized config', () => {
  const cryptoWindow = 24 * 60 * 60 * 1000;
  const stockWindow = 5 * 24 * 60 * 60 * 1000;

  assert.equal(QUOTE_FRESHNESS_WINDOW_MS.crypto, cryptoWindow);
  assert.equal(getQuoteFreshnessWindowMs('crypto'), cryptoWindow);
  assert.equal(getQuoteFreshnessWindowMs('stock'), stockWindow);
  assert.equal(getQuoteFreshnessWindowMs('etf'), stockWindow);
  assert.equal(getQuoteFreshnessWindowMs('bond'), stockWindow);
});

test('server stale quote checks keep crypto at 24h and leave other assets unchanged', () => {
  const now = new Date('2026-04-20T12:00:00.000Z').getTime();
  const originalDateNow = Date.now;
  Date.now = () => now;

  try {
    const cryptoWithinWindow = new Date(now - 23 * 60 * 60 * 1000).toISOString();
    const cryptoOutsideWindow = new Date(now - 25 * 60 * 60 * 1000).toISOString();
    const stockWithinWindow = new Date(now - 119 * 60 * 60 * 1000).toISOString();
    const stockOutsideWindow = new Date(now - 121 * 60 * 60 * 1000).toISOString();

    assert.equal(isStaleQuote(cryptoWithinWindow, 'crypto'), false);
    assert.equal(isStaleQuote(cryptoOutsideWindow, 'crypto'), true);
    assert.equal(isStaleQuote(stockWithinWindow, 'stock'), false);
    assert.equal(isStaleQuote(stockOutsideWindow, 'stock'), true);
    assert.equal(isStaleQuote(stockWithinWindow, 'etf'), false);
    assert.equal(isStaleQuote(stockOutsideWindow, 'bond'), true);
  } finally {
    Date.now = originalDateNow;
  }
});
