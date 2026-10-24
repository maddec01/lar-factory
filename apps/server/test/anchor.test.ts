import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorKeys, survivingAnchor } from '../src/anchor.ts';

test('an item drawn twice gets one key per appearance', () => {
  assert.deepEqual(anchorKeys(['a', 'b', 'a', 'c']), ['a|0', 'b|0', 'a|1', 'c|0']);
});

test('the visible item is held when it survives a refresh', () => {
  const keys = anchorKeys(['a', 'b', 'c', 'd']);
  assert.equal(survivingAnchor(keys, 2, new Set(['x|0', 'a|0', 'c|0', 'd|0'])), 'c|0', 'even when content above it changed');
});

test('when the visible item goes, the nearest surviving one is held', () => {
  const keys = anchorKeys(['a', 'b', 'c', 'd', 'e']);
  assert.equal(survivingAnchor(keys, 2, new Set(['a|0', 'd|0', 'e|0'])), 'd|0', 'the next one down is as near as the one above, and is tried first');
  assert.equal(survivingAnchor(keys, 3, new Set(['a|0', 'b|0'])), 'b|0', 'nearest by position in the old order');
  assert.equal(survivingAnchor(keys, 4, new Set(['a|0'])), 'a|0');
  assert.equal(survivingAnchor(keys, 2, new Set()), null, 'nothing survived');
});
