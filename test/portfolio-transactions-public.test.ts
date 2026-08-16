import assert from 'node:assert/strict';
import test from 'node:test';
import { readdir, readFile } from 'node:fs/promises';

import {
  buildPublicTransactions,
  parsePublicTransactionQuery,
} from '../server/portfolioTransactionsPublic.ts';

const NOW = new Date('2026-08-16T04:00:00.000Z');

test('public transaction query defaults to 30 Hong Kong days and clamps at 365', () => {
  assert.deepEqual(parsePublicTransactionQuery('/api/portfolio-transactions-public', NOW), {
    days: 30,
    startDate: '2026-07-17',
    endDate: '2026-08-16',
    symbol: '',
  });
  assert.equal(
    parsePublicTransactionQuery('/api/portfolio-transactions-public?days=999', NOW).days,
    365,
  );
});

test('explicit dates take priority over days and symbol filtering is normalized', () => {
  assert.deepEqual(
    parsePublicTransactionQuery(
      '/api/portfolio-transactions-public?days=7&from=2026-07-16&to=2026-08-16&symbol=crcl',
      NOW,
    ),
    {
      days: 7,
      startDate: '2026-07-16',
      endDate: '2026-08-16',
      symbol: 'CRCL',
    },
  );
});

test('only formal trades are returned with required fields and closed positions retained', () => {
  const query = parsePublicTransactionQuery(
    '/api/portfolio-transactions-public?from=2026-07-16&to=2026-08-16',
    NOW,
  );
  const transactions = buildPublicTransactions(
    [
      {
        id: 'closed-sell',
        data: {
          assetId: 'meituan', assetName: '美團', symbol: '03690', assetType: 'stock',
          accountSource: 'Futu', settlementAccountSource: 'Futu', transactionType: 'sell',
          quantity: 310, price: 119.9, fees: 10, currency: 'HKD', date: '2026-08-05',
          realizedPnlHKD: 7077.2, quantityAfter: 0, averageCostAfter: 0, note: '清倉',
          recordType: 'trade', createdAt: new Date('2026-08-05T09:00:00Z'),
        },
      },
      {
        id: 'open-buy',
        data: {
          assetId: 'crcl-futu', assetName: 'Circle', symbol: 'CRCL', assetType: 'stock',
          accountSource: 'Futu', transactionType: 'buy', quantity: 10, price: 100,
          fees: 0, currency: 'USD', date: '2026-07-20', realizedPnlHKD: 0,
          quantityAfter: 10, averageCostAfter: 100, recordType: 'trade',
        },
      },
      { id: 'seed', data: { date: '2026-08-10', recordType: 'seed', transactionType: 'buy' } },
      { id: 'created', data: { date: '2026-08-11', recordType: 'asset_created', transactionType: 'buy' } },
      { id: 'old', data: { date: '2026-06-01', recordType: 'trade', transactionType: 'buy' } },
    ],
    [
      {
        id: 'meituan',
        data: { quantity: 0, averageCost: 0, currentPrice: 110, archivedAt: '2026-08-05' },
      },
      {
        id: 'crcl-futu',
        data: { assetType: 'stock', quantity: 10, averageCost: 100, currentPrice: 120 },
      },
    ],
    query,
  );

  assert.deepEqual(transactions.map((entry) => entry.id), ['closed-sell', 'open-buy']);
  assert.equal(transactions[0].positionStatus, 'closed');
  assert.equal(transactions[0].sellTimingPct, (119.9 - 110) / 119.9 * 100);
  assert.equal(transactions[1].positionStatus, 'open');
  assert.equal(transactions[1].performanceSinceTradePct, 20);
  assert.equal(transactions[1].fees, 0);

  for (const transaction of transactions) {
    for (const field of [
      'date', 'symbol', 'transactionType', 'quantity', 'price', 'currency',
      'accountSource', 'quantityAfter', 'averageCostAfter', 'realizedPnlHKD',
    ]) {
      assert.ok(field in transaction, `${field} must always be present`);
    }
  }
});

test('a 7-day range is a subset of the 30-day range', () => {
  const documents = [
    { id: 'recent', data: { date: '2026-08-15', recordType: 'trade', transactionType: 'buy' } },
    { id: 'older', data: { date: '2026-07-25', recordType: 'trade', transactionType: 'sell' } },
  ];
  const seven = buildPublicTransactions(
    documents,
    [],
    parsePublicTransactionQuery('/api/portfolio-transactions-public?days=7', NOW),
  );
  const thirty = buildPublicTransactions(
    documents,
    [],
    parsePublicTransactionQuery('/api/portfolio-transactions-public?days=30', NOW),
  );

  assert.ok(seven.length <= thirty.length);
  assert.deepEqual(seven.map((entry) => entry.id), ['recent']);
});

test('the protected read-only route reuses health and preserves the 12-function limit', async () => {
  const [apiSource, readerSource, vercelConfigSource, rulesSource, apiFiles] = await Promise.all([
    readFile(new URL('../api/health.ts', import.meta.url), 'utf8'),
    readFile(new URL('../server/portfolioTransactionsPublic.ts', import.meta.url), 'utf8'),
    readFile(new URL('../vercel.json', import.meta.url), 'utf8'),
    readFile(new URL('../firebase/firestore.rules', import.meta.url), 'utf8'),
    readdir(new URL('../api/', import.meta.url)),
  ]);
  const vercelConfig = JSON.parse(vercelConfigSource);

  assert.match(apiSource, /requestCode !== configuredCode/);
  assert.match(apiSource, /message: 'Unauthorized'/);
  assert.match(apiSource, /Cache-Control', 'no-store'/);
  assert.match(apiSource, /Access-Control-Allow-Origin', '\*'/);
  assert.match(apiSource, /readPublicPortfolioTransactions\(query\)/);
  assert.doesNotMatch(apiSource, /portfolioTransactionsPublic[\s\S]{0,500}\.(create|set|update|delete)\(/);
  assert.match(readerSource, /collection\('assetTransactions'\)[\s\S]*\.get\(\)/);
  assert.doesNotMatch(readerSource, /\.(create|set|update|delete)\(/);
  assert.deepEqual(
    vercelConfig.rewrites.find((rewrite: { source: string }) =>
      rewrite.source === '/api/portfolio-transactions-public'),
    {
      source: '/api/portfolio-transactions-public',
      destination: '/api/health?portfolioTransactionsPublic=1',
    },
  );
  assert.equal(apiFiles.filter((file) => file.endsWith('.ts')).length, 12);

  // This remains an acknowledged risk until the browser app has authenticated writes.
  assert.match(
    rulesSource,
    /match \/assetTransactions\/\{entryId\}[\s\S]*allow read, create, update: if true;[\s\S]*allow delete: if true;/,
  );
});
