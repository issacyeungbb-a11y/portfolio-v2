import assert from 'node:assert/strict';
import test from 'node:test';

import { sortAnalysisHoldingsByHKD } from './analysisSnapshotRanking.ts';

test('sortAnalysisHoldingsByHKD ranks holdings by HKD value instead of raw marketValue', () => {
  const sorted = sortAnalysisHoldingsByHKD([
    { marketValue: 180000, currency: 'JPY', symbol: '3350' },
    { marketValue: 2000, currency: 'USD', symbol: 'NVDA' },
    { marketValue: 12000, currency: 'HKD', symbol: '2800' },
  ]);

  assert.deepEqual(sorted.map((holding) => holding.symbol), ['NVDA', '2800', '3350']);
});
