// The details cache: a hit while the item's updatedAt matches, a miss once it changes, nothing kept for a provider
// without a cache, and no more entries than the bound, dropping the one used longest ago.

import { expect, test } from 'vite-plus/test';
import { createDetailsCache } from './details-cache.ts';
import type { ItemDetails } from '@lar-factory/shared';

const details = (body: string): ItemDetails => ({ body, format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null });
const entry = (updatedAt: string, body = 'text') => ({ updatedAt, details: details(body), older: null });
const everything = () => true;

test('hits while the updatedAt is the one the details were read at, and misses once it changes', () => {
  const cache = createDetailsCache(everything);
  cache.put('I_1', entry('2026-10-21T08:00:00Z'));
  expect(cache.get('I_1', '2026-10-21T08:00:00Z')?.details.body).toBe('text');
  expect(cache.get('I_1', '2026-10-21T08:05:00Z')).toBeNull();
  expect(cache.get('I_2', '2026-10-21T08:00:00Z')).toBeNull();
});

test('an entry read again at a new updatedAt replaces the old one', () => {
  const cache = createDetailsCache(everything);
  cache.put('I_1', entry('2026-10-21T08:00:00Z', 'old'));
  cache.put('I_1', entry('2026-10-21T08:05:00Z', 'new'));
  expect(cache.get('I_1', '2026-10-21T08:00:00Z')).toBeNull();
  expect(cache.get('I_1', '2026-10-21T08:05:00Z')?.details.body).toBe('new');
});

test('keeps nothing for an item whose provider has no cache', () => {
  const cache = createDetailsCache((itemId) => !itemId.startsWith('azure:'));
  cache.put('azure:contoso/310', entry('2026-10-21T08:00:00Z'));
  cache.put('I_1', entry('2026-10-21T08:00:00Z'));
  expect(cache.get('azure:contoso/310', '2026-10-21T08:00:00Z')).toBeNull();
  expect(cache.get('I_1', '2026-10-21T08:00:00Z')).not.toBeNull();
});

test('keeps at most the bound, dropping the entry used longest ago', () => {
  const cache = createDetailsCache(everything, 2);
  cache.put('I_1', entry('t'));
  cache.put('I_2', entry('t'));
  cache.get('I_1', 't');
  cache.put('I_3', entry('t'));
  expect(cache.get('I_2', 't'), 'the one not used').toBeNull();
  expect(cache.get('I_1', 't')).not.toBeNull();
  expect(cache.get('I_3', 't')).not.toBeNull();
});
