import { stripTrackerStructure } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { createFakeTracker } from './fake-tracker.ts';
import { sampleProvider } from './sample-adapters.ts';

test('sample Specs use only the fake tracker and refuse a stale revision', async () => {
    const tracker = createFakeTracker({ mode: 'sample' });
    const provider = sampleProvider(tracker, async () => {});
    const ticket = await provider.readSpec!('lar-factory-sample/lar-server', 149);
    const next = await provider.replaceSpec!(ticket, 'Approved D1.');

    assert.equal(stripTrackerStructure(next.body).trim(), 'Approved D1.');
    assert.equal(next.editorWrite, true);
    await assert.rejects(provider.replaceSpec!(ticket, 'Stale D2.'), /changed before/);
    assert.equal(
        stripTrackerStructure((await provider.readSpec!(ticket.repository, ticket.number)).body).trim(),
        'Approved D1.',
    );
    await assert.rejects(provider.readSpec!('real/product', 149), /sample/i);
});
