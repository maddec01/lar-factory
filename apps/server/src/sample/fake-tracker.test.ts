import { readTrackerStructure, stripTrackerStructure } from '@lar-factory/shared';
import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';

import { FAKE_OPERATIONS } from './fake-failures.ts';
import { fakeItemSource } from './fake-item-source.ts';
import { createFakeTracker } from './fake-tracker.ts';

const REPO = 'lar-factory-sample/lar-server';
const OTHER = 'lar-factory-sample/lar-apple';
const create = () => createFakeTracker({ mode: 'sample' });
const draft = (identity: string) => ({
    identity,
    title: `New ${identity}`,
    body: 'Original draft',
    kind: 'feature' as const,
});

test('bundled fixtures seed an isolated namespace, bodies, labels, kinds and relationships without delivery evidence', async () => {
    const tracker = create();
    const items = await tracker.list(REPO);
    const owner = await tracker.read(REPO, 140);

    assert.ok(items.some((item) => item.kind === 'concept' && item.subIssues.total > 0));
    assert.ok(owner?.details.body.includes('Owner accounts'));
    assert.ok(owner?.details.subTickets.some((ticket) => ticket.number === 144));
    assert.ok((await tracker.labels(REPO).list()).some((label) => label.name === 'area: server'));
    assert.equal(await tracker.kinds(REPO).boardTypes(), null);
    assert.ok(items.every((item) => item.linkedPrs.length === 0 && !item.threads?.length && !item.stats));
    assert.ok(!JSON.stringify([tracker.repositories(), items, owner]).includes('maddec01/lar-'));
});

test('labels follow edits onto tickets, preserve other labels, and create idempotently', async () => {
    const tracker = create();
    const labels = tracker.labels(REPO);
    const issue = await tracker.create(REPO, draft('labels'));
    const number = issue.item.number;

    await labels.create({ name: 'custom', color: 'ff0000', description: 'Before' });
    await labels.create({ name: 'CUSTOM' });
    assert.equal((await labels.list()).filter((label) => label.name.toLowerCase() === 'custom').length, 1);
    await labels.addToTicket(number, ['custom', 'custom']);
    await labels.update('custom', { name: 'renamed', color: '00ff00', description: 'After' });
    assert.deepEqual((await tracker.read(REPO, number))?.item.labels, ['feature', 'renamed']);
    assert.equal((await tracker.read(REPO, number))?.item.labelColors?.renamed, '#00ff00');
    assert.deepEqual(
        (await labels.list()).find((label) => label.name === 'renamed'),
        { name: 'renamed', color: '00ff00', description: 'After' },
    );
    await labels.removeFromTicket(number, ['renamed']);
    assert.deepEqual((await tracker.kinds(REPO).read(number)).labels, ['feature']);
    await labels.addToTicket(number, ['renamed']);
    await labels.delete('renamed');
    assert.deepEqual((await tracker.read(REPO, number))?.item.labels, ['feature']);
    await assert.rejects(async () => labels.addToTicket(number, ['area: server', 'missing']), /does not exist/);
    assert.deepEqual((await tracker.read(REPO, number))?.item.labels, ['feature']);
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

test('concept parents, linked parts and cross-repository links project fresh references and reject cycles atomically', async () => {
    const tracker = create();
    const root = await tracker.create(REPO, { ...draft('concept'), kind: 'concept' });
    const child = await tracker.create(OTHER, { ...draft('part'), kind: 'build' });
    const rootRef = { repo: REPO, number: root.item.number };
    const childRef = { repo: OTHER, number: child.item.number };

    await tracker.setParent(childRef, rootRef);
    await tracker.setParent(childRef, rootRef);
    await tracker.setLink(childRef, rootRef, 'blocked-by');
    await tracker.setLink(rootRef, childRef, 'related');
    await tracker.setLink(rootRef, childRef, 'related');
    await tracker.edit(REPO, rootRef.number, { title: 'Renamed concept', state: 'closed' });

    const parent = await tracker.read(REPO, rootRef.number);
    const part = await tracker.read(OTHER, childRef.number);

    assert.equal(parent?.details.subTickets.length, 1);
    assert.equal(parent?.details.related?.length, 1);
    assert.equal(part?.item.parent?.title, 'Renamed concept');
    assert.equal(part?.item.blockers[0]?.state, 'closed');
    assert.equal(readTrackerStructure(part!.details.body)?.parent?.url, root.item.url);
    await assert.rejects(async () => tracker.setParent(rootRef, childRef), /cycle/);
    assert.equal((await tracker.read(REPO, rootRef.number))?.item.parent, null);
    await tracker.setLink(childRef, rootRef, 'blocked-by', false);
    await tracker.setLink(rootRef, childRef, 'related', false);
    await tracker.setParent(childRef, null);
    assert.deepEqual((await tracker.read(OTHER, childRef.number))?.item.blockers, []);
    assert.equal((await tracker.read(OTHER, childRef.number))?.item.parent, null);
    assert.deepEqual((await tracker.read(REPO, rootRef.number))?.details.related, []);
    assert.equal((await tracker.read(REPO, rootRef.number))?.item.subIssues.total, 0);
});

test('fail-next preserves state and the caller draft; retry after write-success/read-failure never duplicates', async () => {
    const tracker = create();
    const sent = draft('retry');
    const original = structuredClone(sent);
    const before = await tracker.list(REPO);

    tracker.failures.set('issues.create', { fail: 'next', message: 'Try again' });
    await assert.rejects(tracker.create(REPO, sent), /Try again/);
    assert.deepEqual(sent, original);
    assert.deepEqual(await tracker.list(REPO), before);

    const saved = await tracker.create(REPO, sent);

    tracker.failures.set('issues.read', { fail: 'next' });
    await assert.rejects(tracker.read(REPO, saved.item.number), /issues.read/);

    const retry = await tracker.create(REPO, sent);

    assert.equal(retry.item.id, saved.item.id);
    assert.equal((await tracker.list(REPO)).length, before.length + 1);
    await assert.rejects(tracker.create(REPO, { ...sent, title: 'Different' }), /another draft/);
    assert.deepEqual(await tracker.read(REPO, saved.item.number), saved);

    const pair = await Promise.all([tracker.create(OTHER, sent), tracker.create(OTHER, sent)]);

    assert.equal(pair[0].item.id, pair[1].item.id);
});

test('named failures refuse each write without mutation, persist until cleared, and expose read errors through adapters', async () => {
    const tracker = create();
    const issue = await tracker.create(REPO, draft('failures'));
    const ref = { repo: REPO, number: issue.item.number };
    const other = { repo: OTHER, number: 40 };
    const labels = tracker.labels(REPO);
    const operations = {
        'labels.create': () => labels.create({ name: 'new' }),
        'labels.update': () => labels.update('feature', { name: 'renamed' }),
        'labels.delete': () => labels.delete('feature'),
        'labels.addToTicket': () => labels.addToTicket(ref.number, ['area: server']),
        'labels.removeFromTicket': () => labels.removeFromTicket(ref.number, ['feature']),
        'kinds.setType': () => tracker.kinds(REPO).setType(ref.number, 'Bug'),
        'issues.edit': () => tracker.edit(REPO, ref.number, { body: 'Lost draft?' }),
        'links.parent': () => tracker.setParent(ref, other),
        'links.related': () => tracker.setLink(ref, other, 'related'),
        'links.blocked-by': () => tracker.setLink(ref, other, 'blocked-by'),
    } as const;

    for (const [operation, action] of Object.entries(operations)) {
        const before = [await tracker.list(REPO), await tracker.read(REPO, ref.number), await labels.list()];

        tracker.failures.set(operation as keyof typeof operations, { fail: 'always' });
        await assert.rejects(async () => action(), /Sample tracker refused/);
        await assert.rejects(async () => action(), /Sample tracker refused/);
        tracker.failures.set(operation as keyof typeof operations, null);
        assert.deepEqual([await tracker.list(REPO), await tracker.read(REPO, ref.number), await labels.list()], before);
    }

    for (const operation of [
        'labels.list',
        'kinds.read',
        'kinds.boardTypes',
        'issues.list',
        'issues.search',
        'issues.read',
    ] as const) {
        tracker.failures.set(operation, { fail: 'next' });

        const actions = {
            'labels.list': () => labels.list(),
            'kinds.read': () => tracker.kinds(REPO).read(ref.number),
            'kinds.boardTypes': () => tracker.kinds(REPO).boardTypes(),
            'issues.list': () => fakeItemSource(tracker, REPO).read(),
            'issues.search': () => fakeItemSource(tracker, REPO).searchTickets(REPO, 'New'),
            'issues.read': () => fakeItemSource(tracker, REPO).readTicket(REPO, ref.number),
        };

        await assert.rejects(async () => actions[operation](), /Sample tracker refused/);
    }
});

test('reset and restart restore identical seed, IDs and counters; pending writes cannot leak across reset', async () => {
    const tracker = create();
    const seed = await tracker.list(REPO);
    const first = await tracker.create(REPO, draft('reset'));

    tracker.failures.set('issues.create', { latencyMs: 25 });

    const pending = tracker.create(REPO, draft('pending'));

    tracker.reset();
    await assert.rejects(pending, /reset/);
    assert.deepEqual(await tracker.list(REPO), seed);
    assert.deepEqual(await create().list(REPO), seed);
    assert.deepEqual(await tracker.create(REPO, draft('reset')), first);

    const snapshot = await tracker.read(REPO, first.item.number);

    snapshot!.item.title = 'Changed outside';
    snapshot!.details.body = 'Changed outside';
    assert.deepEqual(await tracker.read(REPO, first.item.number), first);
});

test('latency and fail-next apply once even with concurrent calls', async () => {
    const tracker = create();

    tracker.failures.set('issues.create', { fail: 'next', latencyMs: 25 });

    let settled = false;
    const calls = Promise.allSettled([tracker.create(REPO, draft('one')), tracker.create(REPO, draft('two'))]).then(
        (result) => {
            settled = true;

            return result;
        },
    );

    await new Promise<void>((resolve) => setTimeout(resolve, 5));
    assert.equal(settled, false);

    const result = await calls;

    assert.deepEqual(
        result.map((entry) => entry.status),
        ['rejected', 'fulfilled'],
    );
    assert.throws(() => tracker.failures.set('issues.read', { latencyMs: Infinity }), /latency/);
});

test('every repository entry point fails closed, including relationship targets and source overrides', async () => {
    const tracker = create();
    const allowed = { repo: REPO, number: 200 };

    assert.throws(() => createFakeTracker({ mode: 'live' as 'sample' }), /local sample/);

    for (const repo of [
        'maddec01/lar-server',
        'lar-factory-sample/unseeded',
        'LAR-FACTORY-SAMPLE/lar-server',
        '../lar-server',
        REPO + '/extra',
    ]) {
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

test('delayed inputs and returned snapshots cannot mutate tracker state or cross the namespace boundary', async () => {
    const tracker = create();
    const issue = await tracker.create(REPO, draft('immutable'));
    const labels = tracker.labels(REPO);
    const sent = { name: 'original', color: 'ff0000' };

    tracker.failures.set('labels.create', { latencyMs: 10 });

    const pending = labels.create(sent);

    sent.name = 'changed';
    assert.equal((await pending).name, 'original');

    const snapshot = await labels.list();

    snapshot[0]!.name = 'Changed outside';
    assert.notDeepEqual(await labels.list(), snapshot);

    const extraFields = { body: 'Saved safely', repo: 'maddec01/lar-server', number: 999, id: 'spoofed' };

    await tracker.edit(REPO, issue.item.number, extraFields);

    const read = await tracker.read(REPO, issue.item.number);

    assert.equal(read?.item.repo, REPO);
    assert.equal(read?.item.id, issue.item.id);
    assert.equal(read?.item.number, issue.item.number);

    const before = await tracker.list(REPO);

    await assert.rejects(tracker.create(REPO, { ...draft('bad-label'), labels: ['okay', ''] }), /valid sample labels/);
    assert.deepEqual(await tracker.list(REPO), before);
    assert.ok(!(await labels.list()).some((label) => label.name === 'okay'));
    assert.throws(
        () => tracker.failures.set('unknown' as (typeof FAKE_OPERATIONS)[number], { fail: 'next' }),
        /named sample operation/,
    );
});
