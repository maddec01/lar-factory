import type { Item, ItemStats } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { createShownStats } from './shown-stats.ts';

const item = { id: 'a', labels: [], linkedPrs: [] } as unknown as Item;
const figures = (tokens: number): ItemStats => ({ agentMs: 0, tokens });
const tokens = (stats: Item['stats']) => (stats as ItemStats).tokens;

test('provisional figures hold the ones shown before them, for the first final read to keep', () => {
    const { shown } = createShownStats(new Set());
    const provisional = shown(item, figures(100), true, { live: figures(10), provisional: true });
    assert.equal((provisional as ItemStats).provisional, true);
    assert.equal(tokens(shown(item, provisional, true, { live: figures(20), provisional: false })), 100);
});

test('an item that left the board holds no figures', () => {
    const { shown, prune } = createShownStats(new Set());
    const provisional = shown(item, figures(100), true, { live: figures(10), provisional: true });
    prune(new Set(['b']));
    assert.equal(tokens(shown(item, provisional, true, { live: figures(20), provisional: false })), 20);
});
