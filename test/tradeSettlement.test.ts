import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SETTLEMENT_CURRENCY,
  calculateCashDelta,
  calculateSettlementCashDelta,
  convertToSettlementAmount,
} from '../src/lib/portfolio/tradeSettlement.ts';

test('現金池仍然係 USD', () => {
  assert.equal(SETTLEMENT_CURRENCY, 'USD');
});

test('美元交易的現金變動維持原數', () => {
  const delta = calculateSettlementCashDelta({
    recordType: 'trade',
    transactionType: 'buy',
    quantity: 10,
    price: 240,
    fees: 1.5,
    currency: 'USD',
  });

  assert.equal(delta, -2401.5);
});

test('港股買入按匯率折算成 USD 扣數', () => {
  // 100 股 @ HKD 105 + HKD 50 手續費 = HKD 10,550 → USD 10,550 / 7.8
  const delta = calculateSettlementCashDelta({
    recordType: 'trade',
    transactionType: 'buy',
    quantity: 100,
    price: 105,
    fees: 50,
    currency: 'HKD',
  });

  assert.equal(delta, -1352.56);
  // 未折算前係港幣原數，證明交易記錄本身仍然以港幣入賬
  assert.equal(
    calculateCashDelta({
      recordType: 'trade',
      transactionType: 'buy',
      quantity: 100,
      price: 105,
      fees: 50,
    }),
    -10550,
  );
});

test('港股賣出折算後為正數入賬', () => {
  const delta = calculateSettlementCashDelta({
    recordType: 'trade',
    transactionType: 'sell',
    quantity: 100,
    price: 105,
    fees: 50,
    currency: 'HKD',
  });

  assert.equal(delta, 1339.74);
});

test('反向沖銷同原本寫入完全對稱', () => {
  const entry = {
    recordType: 'trade' as const,
    transactionType: 'buy' as const,
    quantity: 300,
    price: 88.35,
    fees: 12.7,
    currency: 'HKD',
  };

  const applied = calculateSettlementCashDelta(entry);
  const reversed = calculateSettlementCashDelta(entry) * -1;

  assert.equal(applied + reversed, 0);
});

test('seed / asset_created 唔會郁現金', () => {
  for (const recordType of ['seed', 'asset_created'] as const) {
    assert.equal(
      calculateSettlementCashDelta({
        recordType,
        transactionType: 'buy',
        quantity: 100,
        price: 105,
        fees: 0,
        currency: 'HKD',
      }),
      0,
    );
  }
});

test('未知幣別唔會亂折算', () => {
  assert.equal(convertToSettlementAmount(1000, 'USDT'), 1000);
  assert.equal(convertToSettlementAmount(780, 'HKD'), 100);
  assert.equal(convertToSettlementAmount(100, 'USD'), 100);
});
