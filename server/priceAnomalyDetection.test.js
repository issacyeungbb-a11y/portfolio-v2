import assert from 'node:assert/strict';
import test from 'node:test';

import {
  deriveHistoricalPriceAmplitudes,
  detectPriceAnomaly,
  getAnomalyThreshold,
} from './priceAnomalyDetection.ts';

test('deriveHistoricalPriceAmplitudes measures adjacent daily movement amplitude', () => {
  const amplitudes = deriveHistoricalPriceAmplitudes([100, 110, 99, 108]);

  assert.equal(amplitudes.length, 3);
  assert.equal(Number(amplitudes[0].toFixed(4)), 0.1);
  assert.equal(Number(amplitudes[1].toFixed(4)), 0.1);
  assert.equal(Number(amplitudes[2].toFixed(4)), 0.0909);
});

test('review thresholds allow larger daily moves before blocking automatic updates', () => {
  assert.equal(getAnomalyThreshold('stock'), 2);
  assert.equal(getAnomalyThreshold('etf'), 2);
  assert.equal(getAnomalyThreshold('bond'), 2);
  assert.equal(getAnomalyThreshold('crypto'), 5);

  assert.equal(detectPriceAnomaly(100, 250, 'stock').isAnomaly, false);
  assert.equal(detectPriceAnomaly(100, 301, 'stock').isAnomaly, true);
  assert.equal(detectPriceAnomaly(100, 550, 'crypto').isAnomaly, false);
  assert.equal(detectPriceAnomaly(100, 601, 'crypto').isAnomaly, true);
});
