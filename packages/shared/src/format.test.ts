import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { duration, listed } from './format.ts';

test('durations keep positive times under a minute visible and use whole minutes after that', () => {
  assert.deepEqual([-1, 0, 1, 59_999, 60_000, 138_072, 3_600_000, 3_900_000].map(duration),
    ['0m', '0m', '<1m', '<1m', '1m', '2m', '1h 0m', '1h 5m']);
});

test('listed joins names as one phrase', () => {
  assert.deepEqual([[], ['a'], ['a', 'b'], ['a', 'b', 'c']].map(listed), ['', 'a', 'a and b', 'a, b and c']);
});
