import { test } from 'node:test';
import assert from 'node:assert/strict';
import { length, merged, minus } from './intervals.ts';

test('merging sorts the intervals, joins the ones that overlap or touch, and drops empty ones', () => {
  assert.deepEqual(merged([[5, 8], [1, 3], [3, 4], [7, 9], [6, 6], [10, 2]]), [[1, 4], [5, 9]]);
  assert.deepEqual(merged([]), []);
});

test('cutting keeps the parts no cut interval covers', () => {
  assert.deepEqual(minus([[0, 10]], [[2, 3], [5, 7], [6, 8]]), [[0, 2], [3, 5], [8, 10]]);
  assert.deepEqual(minus([[0, 10], [20, 30]], [[-5, 25]]), [[25, 30]]);
  assert.deepEqual(minus([[0, 10]], []), [[0, 10]]);
});

test('the length of intervals is the sum of their lengths', () => {
  assert.equal(length([[0, 2], [5, 9]]), 6);
  assert.equal(length([]), 0);
});
