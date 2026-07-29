import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getTradeCurrencyMismatchWarning,
  inferTradeCurrencyFromSymbol,
  resolveTradeCurrency,
  toTradeCurrency,
} from '../src/lib/portfolio/tradeCurrency.ts';

test('港交所純數字代號推斷為港幣', () => {
  assert.equal(inferTradeCurrencyFromSymbol('9988'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('09988'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('0700'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('700'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('2800'), 'HKD');
});

test('券商前綴同 Yahoo 後綴寫法都認得', () => {
  assert.equal(inferTradeCurrencyFromSymbol('9988.HK'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('HK.09988'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('SEHK:9988'), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol(' hk.0700 '), 'HKD');
  assert.equal(inferTradeCurrencyFromSymbol('US.BABA'), 'USD');
  assert.equal(inferTradeCurrencyFromSymbol('NASDAQ:AAPL'), 'USD');
  assert.equal(inferTradeCurrencyFromSymbol('7203.T'), 'JPY');
});

test('美股 ticker 維持美元', () => {
  assert.equal(inferTradeCurrencyFromSymbol('BABA'), 'USD');
  assert.equal(inferTradeCurrencyFromSymbol('AAPL'), 'USD');
  assert.equal(inferTradeCurrencyFromSymbol(''), 'USD');
});

test('加密貨幣一律美元，唔會被數字 ticker 誤判', () => {
  assert.equal(inferTradeCurrencyFromSymbol('BTC', 'crypto'), 'USD');
  assert.equal(inferTradeCurrencyFromSymbol('1000', 'crypto'), 'USD');
});

test('現有資產以資產本身幣別為準', () => {
  assert.equal(
    resolveTradeCurrency({ symbol: 'BABA', holdingCurrency: 'HKD' }),
    'HKD',
  );
  assert.equal(
    resolveTradeCurrency({ symbol: '9988', holdingCurrency: 'USD' }),
    'USD',
  );
});

test('資產幣別無效時退回 AI 解析結果，再退回 ticker 推斷', () => {
  assert.equal(
    resolveTradeCurrency({ symbol: '9988', holdingCurrency: 'USDT' }),
    'HKD',
  );
  assert.equal(
    resolveTradeCurrency({ symbol: 'BABA', parsedCurrency: 'HK$' }),
    'HKD',
  );
  assert.equal(resolveTradeCurrency({ symbol: '9988' }), 'HKD');
});

test('toTradeCurrency 只接受支援嘅幣別', () => {
  assert.equal(toTradeCurrency('hkd'), 'HKD');
  assert.equal(toTradeCurrency('US$'), 'USD');
  assert.equal(toTradeCurrency('USDT'), null);
  assert.equal(toTradeCurrency(''), null);
  assert.equal(toTradeCurrency(null), null);
});

test('幣別同推斷市場唔一致時提供警告', () => {
  assert.equal(
    getTradeCurrencyMismatchWarning({ symbol: '9988', tradeCurrency: 'HKD' }),
    null,
  );
  assert.match(
    getTradeCurrencyMismatchWarning({ symbol: '9988', tradeCurrency: 'USD' }) ?? '',
    /9988/,
  );
  assert.equal(
    getTradeCurrencyMismatchWarning({ symbol: '', tradeCurrency: 'USD' }),
    null,
  );
});
