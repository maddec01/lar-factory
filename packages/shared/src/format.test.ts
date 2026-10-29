import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { duration } from './format.ts';

test('durations keep positive times under a minute visible and use whole minutes after that', () => {
  assert.deepEqual([-1, 0, 1, 59_999, 60_000, 138_072, 3_600_000, 3_900_000].map(duration),
    ['0m', '0m', '<1m', '<1m', '1m', '2m', '1h 0m', '1h 5m']);
});
