import assert from 'node:assert/strict';
import { describe, test } from 'vite-plus/test';

import { boardSections, closesTicketOnAbandon, placementOf } from './board-view.ts';
import type { BoardSection, PlacementFacts } from './board-view.ts';
import type { BoardData, Item, ItemThread, NeedsYouCause, Status } from './model.ts';

const ticketed = (repo: string) =>
    ({
        content: 'ticket',
        revision: 0,
        kind: 'issue',
        parentId: null,
        linkedPrs: [],
        repo,
        number: 7,
        title: 'Keep history',
    }) as unknown as Item;

test('a discovered concept stays in List until it has been added locally', () => {
    const concept = {
        ...ticketed('owner/repo'),
        id: 'concept',
        kind: 'concept',
        status: 'List',
        recorded: false,
    } as Item;
    const data = { items: [concept], repos: [], firstRead: { settled: true } } as unknown as BoardData;
    const fresh = boardSections(data, Date.now());

    assert.equal(fresh.list[0]?.id, concept.id);
    assert.deepEqual([fresh.concepts.length, fresh.shaping.length], [0, 0]);
    data.items = [{ ...concept, recorded: true }];
    assert.equal(boardSections(data, Date.now()).concepts[0]?.id, concept.id);
});

const AT = Date.parse('2026-11-02T12:00:00Z');
const boardWith = (item: Item, data: Partial<BoardData> = {}) =>
    ({
        items: [item],
        repos: [],
        error: null,
        fetchedAt: new Date(AT).toISOString(),
        refreshSeconds: 60,
        firstRead: { settled: true },
        ...data,
    }) as unknown as BoardData;
const delivered = (status: Status, build: object, more: Partial<Item> = {}) =>
    ({
        ...ticketed('owner/repo'),
        id: 'built',
        kind: 'issue',
        status,
        updatedAt: '2026-11-02',
        threads: [{ id: 'build', purpose: 'build', state: 'running', ...build }],
        ...more,
    }) as Item;
const onDesk = (item: Item, data?: Partial<BoardData>, clientError?: string) =>
    boardSections(boardWith(item, data), AT, clientError).needsYou.length === 1;

for (const status of ['Verify'] as const) {
    test(`${status} with only checks running stays in Build, but an explicit question still reaches the desk`, () => {
        const waiting = delivered(
            status,
            { state: 'done' },
            {
                linkedPrs: [{ state: 'open', checks: { running: 1, failed: 0 } }] as Item['linkedPrs'],
            },
        );

        assert.equal(onDesk(waiting), false);
        assert.deepEqual(placementOf(waiting, { unavailable: false, all: [waiting] }).sections, ['build']);
        assert.equal(
            onDesk({ ...waiting, needsYou: { reason: 'Answer this', offers: [], causes: [], ticketOpen: true } }),
            true,
        );
        assert.equal(onDesk({ ...waiting, threads: [{ id: 'question', state: 'needs you' }] as ItemThread[] }), true);
        assert.equal(
            onDesk({
                ...waiting,
                linkedPrs: [{ state: 'open', checks: { running: 1, failed: 1 } }] as Item['linkedPrs'],
            }),
            true,
        );
    });

    test(`${status} stays on the desk while thread activity is unavailable`, () => {
        const running = delivered(status, { currentRunning: true });

        assert.equal(onDesk(running, undefined, 'HTTP 502'), true, 'a client error');
        assert.equal(onDesk(running, { error: 'HTTP 502' }), true, 'a failed read');
        assert.equal(onDesk(running, { fetchedAt: '2026-11-02T11:00:00Z' }), true, 'old data');
        assert.equal(
            onDesk(running, { firstRead: { settled: false } as BoardData['firstRead'] }),
            true,
            'an unsettled first read',
        );
    });
}

const waiting = (causes: NeedsYouCause[], change: Partial<Item> = {}) =>
    ({
        ...ticketed('owner/repo'),
        status: 'Review',
        needsYou: { reason: 'Why.', offers: [], causes, ticketOpen: false },
        ...change,
    }) as Item;

test('Abandon closes the ticket only while a notice says it is open and offers no refusal', () => {
    const notice = (ticketOpen: boolean) =>
        waiting([{ type: 'pr-closed' }], {
            needsYou: { reason: 'Why.', offers: ['set-aside'], causes: [{ type: 'pr-closed' }], ticketOpen },
        });

    assert.deepEqual(
        [
            closesTicketOnAbandon(notice(true)),
            closesTicketOnAbandon(notice(false)),
            closesTicketOnAbandon({ ...notice(true), abandonRefusal: 'No.' }),
        ],
        [true, false, false],
    );
    assert.equal(closesTicketOnAbandon(ticketed('owner/repo')), true, 'List and Queued work has no notice to ask');
});

test('a current shaping question enters the desk and leaves when answered', () => {
    const item = {
        ...ticketed('owner/repo'),
        status: 'Shaping',
        threads: [{ id: 'question', state: 'needs you' }],
    } as Item;
    const data = { items: [item], repos: [], firstRead: { settled: true } } as unknown as BoardData;

    assert.deepEqual(boardSections(data, Date.now()).needsYou, [item]);
    item.threads = [{ id: 'question', state: 'running' }] as Item['threads'];
    assert.deepEqual(boardSections(data, Date.now()).needsYou, []);
});

describe('placementOf', () => {
    const work = (change: Partial<Item> = {}) =>
        ({
            ...ticketed('owner/repo'),
            id: 'work',
            flow: 'single',
            kind: 'issue',
            status: 'Shaping',
            threads: [],
            ...change,
        }) as Item;
    const concept = (change: Partial<Item> = {}) =>
        work({
            id: 'concept',
            kind: 'concept',
            status: 'In progress',
            refinement: { complete: false, reasons: ['open'] },
            ...change,
        });
    const part = (change: Partial<Item> = {}) => work({ parentId: 'concept', flow: 'linked', ...change });
    const buildThread = { id: 'build', purpose: 'build', state: 'done' } as ItemThread;
    const running = { ...buildThread, state: 'running', currentRunning: true } as ItemThread;
    const starting = { phase: 'starting' } as const;
    const uncertain = { phase: 'may-have-started', message: 'Maybe.' } as const;
    const place = (item: Item, facts: Partial<PlacementFacts> = {}) =>
        placementOf(item, { unavailable: false, all: [item], ...facts });
    const sections = (item: Item, facts?: Partial<PlacementFacts>) => place(item, facts).sections;

    test('concept groups keep parents and children in the dock and add human waits to the desk', () => {
        const parent = concept({ kind: 'concept', flow: 'linked' });

        for (const status of [
            'List',
            'Queued',
            'Shaping',
            'Ready',
            'In progress',
            'Review',
            'Verify',
            'Ready to merge',
            'Needs you',
            'Done',
        ] as const) {
            const child = part({ status, repo: 'owner/other', threads: [buildThread] });
            const all = [parent, child];

            const expected: BoardSection[] = ['Needs you', 'Verify', 'Ready to merge'].includes(status)
                ? ['desk', 'dock']
                : ['dock'];

            assert.deepEqual(sections(child, { all }), expected, status);

            if (status !== 'List' && status !== 'Done') {
                const changed = { ...parent, status };

                assert.deepEqual(sections(changed, { all: [changed, child] }), expected, `parent ${status}`);
            }
        }
    });

    describe('Your desk', () => {
        test.each<[string, Item, boolean]>([
            ['Needs you', work({ status: 'Needs you' }), true],
            ['Verify', work({ status: 'Verify' }), true],
            ['Verify with an agent running again', work({ status: 'Verify', threads: [running] }), false],
            ['Ready', work({ status: 'Ready' }), false],
        ])('%s: %s', (_name, item, onDesk) => {
            assert.equal(sections(item).includes('desk'), onDesk);
        });
    });

    describe('Queue', () => {
        test('lets go of a Queued item once its start is in flight', () => {
            assert.deepEqual(sections(work({ status: 'Queued' }), { starts: { shape: starting } }), ['shaping']);
            assert.deepEqual(sections(work({ status: 'Queued' }), { starts: { shape: uncertain } }), ['shaping']);
            assert.deepEqual(sections(concept({ status: 'Queued' }), { starts: { shape: starting } }), ['dock']);
        });
    });

    describe('Concepts and linked work', () => {
        test('keeps groups together with a List or Done parent', () => {
            for (const status of ['List', 'Done'] as const) {
                const parent = concept({ status });
                const child = part({ status: 'Shaping' });

                assert.deepEqual(sections(parent, { all: [parent, child] }), ['dock']);
                assert.deepEqual(
                    place(child, { all: [parent, child] }),
                    { sections: ['dock'] },
                    'an unfinished part keeps its group reachable',
                );
            }
        });
    });
});
