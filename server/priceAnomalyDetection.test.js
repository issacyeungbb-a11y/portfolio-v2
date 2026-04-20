import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveHistoricalPriceAmplitudes } from './priceAnomalyDetection.ts';

test('deriveHistoricalPriceAmplitudes measures adjacent daily movement amplitude', () => {
  const amplitudes = deriveHistoricalPriceAmplitudes([100, 110, 99, 108]);

  assert.equal(amplitudes.length, 3);
  assert.equal(Number(amplitudes[0].toFixed(4)), 0.1);
  assert.equal(Number(amplitudes[1].toFixed(4)), 0.1);
  assert.equal(Number(amplitudes[2].toFixed(4)), 0.0909);
});
