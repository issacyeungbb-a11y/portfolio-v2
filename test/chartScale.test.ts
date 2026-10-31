import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildNiceScale, pickLabelIndices } from '../src/lib/chartScale.ts';

test('nice scale uses round steps that cover every value', () => {
  const scale = buildNiceScale([76_500, 461_800, 847_100]);
  assert.deepEqual(scale.ticks, [0, 200_000, 400_000, 600_000, 800_000, 1_000_000]);
  assert.ok(scale.min <= 76_500 && scale.max >= 847_100);
});

test('nice scale keeps a tight domain for values far from zero', () => {
  const scale = buildNiceScale([232_145, 234_957]);
  assert.deepEqual(scale.ticks, [232_000, 233_000, 234_000, 235_000]);
});

test('nice scale can force zero for change bars', () => {
  const scale = buildNiceScale([0.12, 0.35, 0.05], { includeZero: true });
  assert.equal(scale.ticks[0], 0);
  assert.equal(scale.ticks[scale.ticks.length - 1], 0.4);
  const mixed = buildNiceScale([-0.1391, 0.3503], { includeZero: true });
  assert.ok(mixed.ticks.includes(0));
  assert.deepEqual(mixed.ticks, [-0.2, 0, 0.2, 0.4]);
});

test('nice scale survives a flat series', () => {
  const scale = buildNiceScale([500, 500]);
  assert.ok(scale.min < 500 && scale.max > 500);
});

test('label indices always include both ends without crowding', () => {
  assert.deepEqual(pickLabelIndices(45, 5), [0, 11, 22, 33, 44]);
  assert.deepEqual(pickLabelIndices(8, 5), [0, 2, 4, 7]);
  assert.deepEqual(pickLabelIndices(2, 6), [0, 1]);
  assert.deepEqual(pickLabelIndices(1, 6), [0]);
});
