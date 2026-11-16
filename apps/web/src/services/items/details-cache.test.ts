// The details cache: a hit while the item's updatedAt matches, a miss once it changes.

import type { ItemDetails } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { createDetailsCache } from './details-cache';

const details = (body: string): ItemDetails => ({
    body,
    format: 'markdown',
    author: null,
    assignees: [],
    createdAt: null,
    subTickets: [],
    comments: [],
    hasOlderComments: false,
    olderCursor: null,
});
const entry = (updatedAt: string, body = 'text') => ({ updatedAt, details: details(body), older: null });
const everything = () => true;

test('hits while the updatedAt is the one the details were read at, and misses once it changes', () => {
    const cache = createDetailsCache(everything);

    cache.put('I_1', entry('2026-10-21T08:00:00Z'));
    expect(cache.get('I_1', '2026-10-21T08:00:00Z')?.details.body).toBe('text');
    expect(cache.get('I_1', '2026-10-21T08:05:00Z')).toBeNull();
    expect(cache.get('I_2', '2026-10-21T08:00:00Z')).toBeNull();
});
