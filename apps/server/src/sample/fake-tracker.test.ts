import { stripTrackerStructure } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { fakeItemSource } from './fake-item-source.ts';
import { createFakeTracker } from './fake-tracker.ts';

const REPO = 'lar-factory-sample/lar-server';
const create = () => createFakeTracker({ mode: 'sample' });
const draft = (identity: string) => ({
    identity,
    title: `New ${identity}`,
    body: 'Original draft',
    kind: 'feature' as const,
});

test('kinds, issues and bodies can be written and read through production adapters', async () => {
    const tracker = create();
    const issue = await tracker.create(REPO, draft('body'));
    const number = issue.item.number;
    const source = fakeItemSource(tracker, REPO);

    await tracker.kinds(REPO).setType(number, 'Bug');
    assert.deepEqual(await tracker.kinds(REPO).read(number), { labels: ['feature'], type: 'Bug' });
    assert.equal((await tracker.read(REPO, number))?.item.kind, 'bug');
    await tracker.edit(REPO, number, {
        title: 'Edited title',
        body: 'Edited body',
        kind: 'concept',
        map: { destination: 'Destination', decisions: [], fog: [] },
    });

    const read = await source.readTicket(REPO, number);

    assert.equal(read?.title, 'Edited title');
    assert.equal(stripTrackerStructure(read!.text), 'Edited body');
    assert.equal(read?.kind, 'concept');
    assert.equal((await tracker.read(REPO, number))?.item.map?.destination, 'Destination');
    await tracker.edit(REPO, number, { body: '## Destination\n\nUpdated destination\n\n## Fog\n\n- One question' });
    assert.deepEqual((await tracker.read(REPO, number))?.item.map, {
        destination: 'Updated destination',
        decisions: [],
        fog: ['One question'],
    });
    assert.equal((await source.searchTickets(REPO, 'edited title'))[0]?.number, number);
    assert.equal((await source.searchTickets(REPO, `#${number}`))[0]?.number, number);
    assert.ok((await source.read()).items.some((item) => item.number === number));
    assert.equal(await source.abandon((await tracker.read(REPO, number))!.item), null);
    assert.deepEqual(await source.observeTicket(REPO, number), { state: 'closed', assignee: '' });
    assert.equal(await source.readTicket(REPO, number), null);
    assert.deepEqual(await source.observeTicket(REPO, 999999), { state: 'not-found' });
});

test('every repository entry point fails closed, including relationship targets and source overrides', async () => {
    const tracker = create();
    const allowed = { repo: REPO, number: 200 };

    assert.throws(() => createFakeTracker({ mode: 'live' as 'sample' }), /local sample/);

    for (const repo of ['maddec01/lar-server', 'LAR-FACTORY-SAMPLE/lar-server']) {
        const denied = { repo, number: 200 };
        const actions = [
            () => tracker.labels(repo),
            () => tracker.kinds(repo),
            () => tracker.list(repo),
            () => tracker.read(repo, 200),
            () => tracker.search(repo, ''),
            () => tracker.create(repo, draft('denied')),
            () => tracker.edit(repo, 200, { body: 'denied' }),
            () => tracker.setParent(allowed, denied),
            () => tracker.setParent(denied, allowed),
            () => tracker.setLink(allowed, denied, 'related'),
            () => tracker.setLink(denied, allowed, 'blocked-by'),
            () => fakeItemSource(tracker, REPO).searchTickets(repo, ''),
        ];

        for (const action of actions) await assert.rejects(async () => action(), /fake repositor/);
    }
});
