import assert from 'node:assert/strict';
import { describe, test } from 'vite-plus/test';

import {
    abandonPrompt,
    boardSections,
    closesTicketOnAbandon,
    closeTicketPrompt,
    hasClosedPr,
    needsYouPrompt,
    placementOf,
} from './board-view.ts';
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

for (const status of ['Verify', 'Ready to merge'] as const) {
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

    test(`${status} leaves the desk while its build thread or a child runs`, () => {
        assert.equal(onDesk(delivered(status, { currentRunning: true })), false);
        assert.equal(onDesk(delivered(status, { state: 'done', hasRunningChildren: true })), false);
    });

    test(`${status} stays on the desk with an idle build thread, a queued run or another thread’s run`, () => {
        assert.equal(onDesk(delivered(status, { state: 'done' })), true);
        assert.equal(onDesk(delivered(status, {}), undefined), true, 'waiting counts as running in state alone');
        assert.equal(onDesk(delivered(status, { purpose: 'shape', currentRunning: true })), true);
        assert.equal(onDesk(delivered(status, { currentRunning: true, observedAt: '2026-11-02' })), true);
    });

    test(`${status} stays on the desk with an open question, even with a running child`, () => {
        assert.equal(onDesk(delivered(status, { state: 'needs you' })), true);
        assert.equal(onDesk(delivered(status, { state: 'needs you', hasRunningChildren: true })), true);
    });

    test(`${status} stays on the desk when paused, archived or holding a Needs you reason`, () => {
        for (const more of [
            { paused: true },
            { archived: true },
            { needsYou: { reason: 'Stuck', offers: [], causes: [], ticketOpen: true } },
        ] as Partial<Item>[]) {
            assert.equal(onDesk(delivered(status, { currentRunning: true }, more)), true);
        }
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

for (const [repo, detail, confirm, done] of [
    [
        'owner/repo',
        'This closes the issue as "not planned" on GitHub. You can reopen it on GitHub.',
        'Close issue',
        'Closed #7 Keep history as "not planned".',
    ],
    [
        'org/project/repo',
        'This moves the work item to Removed in Azure DevOps. You can reactivate it in Azure DevOps.',
        'Move to Removed',
        'Moved #7 Keep history to Removed.',
    ],
]) {
    test(`closing ${repo}’s ticket after Abandon explains how it stays recoverable`, () => {
        assert.deepEqual(closeTicketPrompt(ticketed(repo!)), {
            question: 'Close the ticket of #7 Keep history too?',
            detail,
            confirm,
            keep: 'Keep it open',
            done,
        });
    });
}

const waiting = (causes: NeedsYouCause[], change: Partial<Item> = {}) =>
    ({
        ...ticketed('owner/repo'),
        status: 'Review',
        needsYou: { reason: 'Why.', offers: [], causes, ticketOpen: false },
        ...change,
    }) as Item;
const GOES = 'This notice goes away.';
const STAYS = 'The notice stays with only its other note, which you can then mark as handled.';

test('a choice names the other note only when the notice has one, and then says the notice stays for it', () => {
    const noted = waiting([{ type: 'ticket-closed' }]);

    noted.needsYou!.hasOtherNote = true;
    for (const action of ['keep-working', 'reopen-pr', 'replace-pr', 'back-to-queue', 'back-to-list'] as const) {
        assert.ok(needsYouPrompt(noted, action).detail.endsWith(STAYS), action);
        assert.ok(needsYouPrompt(waiting([{ type: 'ticket-closed' }]), action).detail.endsWith(GOES), action);
    }
    assert.equal(
        needsYouPrompt(noted, 'mark-handled').detail,
        'This changes nothing except removing the notice. Its ticket stays closed.',
    );
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

for (const kind of ['issue', 'concept'] as const) {
    for (const status of [
        'List',
        'Queued',
        'Shaping',
        'Ready',
        'In progress',
        'Review',
        'Needs you',
        'Verify',
        'Ready to merge',
        'Done',
    ] as const) {
        test(kind + ' desk boundary in ' + status, () => {
            const item = {
                ...ticketed('owner/repo'),
                kind,
                status,
                threads: [{ id: 'q', state: 'needs you' }],
            } as Item;
            const data = { items: [item], repos: [], firstRead: { settled: true } } as unknown as BoardData;
            const expected =
                kind !== 'concept' && ['Shaping', 'Needs you', 'Verify', 'Ready to merge'].includes(status);

            assert.equal(boardSections(data, Date.now()).needsYou.length, Number(expected));
            item.threads = 'unavailable';

            const ordinary = kind !== 'concept' && ['Needs you', 'Verify', 'Ready to merge'].includes(status);

            assert.equal(boardSections(data, Date.now()).needsYou.length, Number(ordinary));
            item.threads = [{ id: 'q', state: 'needs you', observedAt: '2026-11-02' }] as Item['threads'];
            assert.equal(boardSections(data, Date.now()).needsYou.length, Number(ordinary));
        });
    }
}

test('Abandon from a notice names Archive and leaves the ticket as it is, and offers the close only while the ticket is open', () => {
    const notice = (ticketOpen: boolean) =>
        waiting([{ type: 'pr-closed' }], {
            needsYou: { reason: 'Why.', offers: ['set-aside'], causes: [{ type: 'pr-closed' }], ticketOpen },
        });

    assert.equal(
        abandonPrompt(notice(false)).detail,
        'This moves the item off the desk into Settings › Archive. Its ticket stays as it is. Any PR it has stays as it is.',
    );
    assert.equal(
        abandonPrompt(notice(true)).detail,
        'This moves the item off the desk into Settings › Archive. Its ticket stays as it is. Any PR it has stays as it is. Abandon and close ticket closes the ticket first.',
    );
    assert.equal(
        abandonPrompt({ ...notice(true), number: 0 }).detail,
        'This moves the item off the desk into Settings › Archive. It has no ticket. Any PR it has stays as it is.',
    );
    assert.deepEqual(
        [
            closesTicketOnAbandon(notice(true)),
            closesTicketOnAbandon(notice(false)),
            closesTicketOnAbandon({ ...notice(true), abandonRefusal: 'No.' }),
        ],
        [true, false, false],
    );
    assert.equal(closesTicketOnAbandon(ticketed('owner/repo')), true, 'List and Queued work has no notice to ask');
    assert.equal(
        closesTicketOnAbandon(
            waiting([], { needsYou: { reason: 'Why.', offers: ['keep-working'], causes: [], ticketOpen: false } }),
        ),
        true,
        'a notice that offers no Abandon changes nothing',
    );
});

test('a closed PR is one a cause names or the ticket links', () => {
    const pr = (state: 'open' | 'closed') => [{ number: 1, url: 'u', state }] as Item['linkedPrs'];

    assert.equal(hasClosedPr(waiting([{ type: 'pr-closed' }])), true);
    assert.equal(hasClosedPr(waiting([{ type: 'ticket-closed' }], { linkedPrs: pr('closed') })), true);
    assert.equal(hasClosedPr(waiting([{ type: 'ticket-closed' }], { linkedPrs: pr('open') })), false);
});

describe('placementOf', () => {
    const work = (change: Partial<Item> = {}) =>
        ({ ...ticketed('owner/repo'), id: 'work', kind: 'issue', status: 'Shaping', threads: [], ...change }) as Item;
    const concept = (change: Partial<Item> = {}) =>
        work({
            id: 'concept',
            kind: 'concept',
            status: 'In progress',
            refinement: { complete: false, reasons: ['open'] },
            ...change,
        });
    const part = (change: Partial<Item> = {}) => work({ parentId: 'concept', ...change });
    const buildThread = { id: 'build', purpose: 'build', state: 'done' } as ItemThread;
    const running = { ...buildThread, state: 'running', currentRunning: true } as ItemThread;
    const starting = { phase: 'starting' } as const;
    const uncertain = { phase: 'may-have-started', message: 'Maybe.' } as const;
    const failed = { phase: 'failed', message: 'No.' } as const;
    const place = (item: Item, facts: Partial<PlacementFacts> = {}) =>
        placementOf(item, { unavailable: false, all: [item], ...facts });
    const sections = (item: Item, facts?: Partial<PlacementFacts>) => place(item, facts).sections;

    test.each(['concept', 'issue'] as const)(
        '%s groups keep parents and children only in the dock across statuses',
        (kind) => {
            const parent = concept({ kind });

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

                assert.deepEqual(sections(child, { all }), ['dock'], status);

                if (status !== 'List' && status !== 'Done') {
                    const changed = { ...parent, status };

                    assert.deepEqual(sections(changed, { all: [changed, child] }), ['dock'], `parent ${status}`);
                }
            }
        },
    );

    describe('Your desk', () => {
        test.each<[string, Item, boolean]>([
            ['Needs you', work({ status: 'Needs you' }), true],
            [
                'an open question on shaping work',
                work({ threads: [{ id: 'q', state: 'needs you' }] as ItemThread[] }),
                true,
            ],
            [
                'an open question on a concept',
                concept({ threads: [{ id: 'q', state: 'needs you' }] as ItemThread[] }),
                false,
            ],
            ['Verify', work({ status: 'Verify' }), true],
            ['Ready to merge', work({ status: 'Ready to merge' }), true],
            ['Verify with an agent running again', work({ status: 'Verify', threads: [running] }), false],
            [
                'Ready to merge with an agent running again',
                work({ status: 'Ready to merge', threads: [running] }),
                false,
            ],
            ['Ready', work({ status: 'Ready' }), false],
            ['In progress', work({ status: 'In progress' }), false],
            ['a concept at Verify', concept({ status: 'Verify' }), false],
        ])('%s: %s', (_name, item, onDesk) => {
            assert.equal(sections(item).includes('desk'), onDesk);
        });

        test('keeps a running Verify item while thread activity is unavailable', () => {
            assert.deepEqual(sections(work({ status: 'Verify', threads: [running] }), { unavailable: true }), [
                'desk',
                'build',
            ]);
        });
    });

    describe('Queue', () => {
        test('holds Queued items and Queued concepts with no start in flight', () => {
            assert.deepEqual(sections(work({ status: 'Queued' })), ['queue']);
            assert.deepEqual(sections(concept({ status: 'Queued' })), ['queue']);
            assert.deepEqual(
                sections(work({ status: 'Queued' }), { starts: { shape: failed } }),
                ['queue'],
                'a failed start is over',
            );
        });

        test('lets go of a Queued item once its start is in flight', () => {
            assert.deepEqual(sections(work({ status: 'Queued' }), { starts: { shape: starting } }), ['shaping']);
            assert.deepEqual(sections(work({ status: 'Queued' }), { starts: { shape: uncertain } }), ['shaping']);
            assert.deepEqual(sections(concept({ status: 'Queued' }), { starts: { shape: starting } }), ['dock']);
        });
    });

    describe('Shaping', () => {
        test('holds standalone Shaping items while concepts stay in the dock', () => {
            assert.deepEqual(sections(work()), ['shaping']);
            assert.deepEqual(sections(concept()), ['dock']);
            assert.deepEqual(sections(concept({ refinement: undefined })), ['dock']);
        });

        test('leaves out a concept with Refinement complete, even with a question or a start', () => {
            const refined = { refinement: { complete: true, reasons: [] } };

            assert.deepEqual(sections(concept(refined)), ['dock']);
            assert.deepEqual(sections(concept({ ...refined, status: 'Needs you' })), ['dock']);
            assert.deepEqual(sections(concept({ ...refined, status: 'Queued' }), { starts: { shape: starting } }), [
                'dock',
            ]);
        });

        test('holds Ready items in its Ready to build group until a start is in flight', () => {
            assert.deepEqual(sections(work({ status: 'Ready' })), ['ready']);
            assert.deepEqual(sections(work({ status: 'Ready' }), { starts: { build: failed } }), ['ready']);
            assert.deepEqual(sections(work({ status: 'Ready' }), { starts: { shape: starting } }), ['shaping']);
        });
    });

    describe('Build', () => {
        test.each(['In progress', 'Review', 'Verify', 'Ready to merge'] as const)('holds %s', (status) => {
            assert.ok(sections(work({ status })).includes('build'));
        });

        test('keeps Verify and Ready to merge work with an agent running again', () => {
            assert.deepEqual(sections(work({ status: 'Verify', threads: [running] })), ['build']);
        });

        test('holds a build start in flight', () => {
            assert.deepEqual(sections(work({ status: 'Ready' }), { starts: { build: starting } }), ['build']);
            assert.deepEqual(sections(work({ status: 'Ready' }), { starts: { build: uncertain } }), ['build']);
        });

        test('leaves out concepts, which hold no build of their own', () => {
            assert.deepEqual(sections(concept({ status: 'Review' })), ['dock']);
        });

        test('lets go of merged work, whatever a start left behind', () => {
            assert.deepEqual(sections(work({ status: 'Done' })), []);
            assert.deepEqual(sections(work({ status: 'Done' }), { starts: { build: uncertain } }), []);
        });
    });

    describe('Needs you with no parent', () => {
        test('has a Build row with a recorded build thread and a Shaping row otherwise', () => {
            assert.deepEqual(sections(work({ status: 'Needs you', threads: [buildThread] })), ['desk', 'build']);
            assert.deepEqual(
                sections(work({ status: 'Needs you', threads: [{ ...buildThread, observedAt: '2026-11-02' }] })),
                ['desk', 'build'],
                'a retained copy still records the thread',
            );
            assert.deepEqual(sections(work({ status: 'Needs you' })), ['desk', 'shaping']);
            assert.deepEqual(sections(work({ status: 'Needs you', threads: 'unavailable' })), ['desk', 'shaping']);
        });

        test('shows one row while a start is in flight', () => {
            assert.deepEqual(sections(work({ status: 'Needs you' }), { starts: { build: starting } }), [
                'desk',
                'build',
            ]);
        });
    });

    describe('Concepts and linked work', () => {
        test('holds concepts once started and items with sub-issues', () => {
            const child = part();
            const parent = work({ id: 'concept', status: 'In progress' });

            assert.ok(sections(concept()).includes('dock'));
            assert.ok(!sections(concept({ status: 'Queued' })).includes('dock'));
            assert.deepEqual(sections(parent, { all: [parent, child] }), ['dock']);

            const queued = concept({ status: 'Queued' });

            assert.deepEqual(
                sections(queued, { all: [queued, child] }),
                ['dock'],
                'a sub-issue makes it linked work before it starts',
            );
        });

        test('leaves out List and Done parents and their children', () => {
            for (const status of ['List', 'Done'] as const) {
                const parent = concept({ status });
                const child = part({ status: 'Shaping' });

                assert.deepEqual(sections(parent, { all: [parent, child] }), []);
                assert.deepEqual(
                    place(child, { all: [parent, child] }),
                    { sections: ['shaping'] },
                    'a closed parent has no dossier to hold it',
                );
            }
        });

        test('a part with a missing parent is ordinary work', () => {
            assert.deepEqual(place(part({ status: 'Ready' })), { sections: ['ready'] });
        });
    });

    describe('a dossier part', () => {
        const parent = concept();
        const inDossier = (change: Partial<Item>, facts?: Partial<PlacementFacts>) => {
            const child = part(change);

            return place(child, { all: [parent, child], ...facts });
        };

        test.each<[string, Partial<Item>, Partial<PlacementFacts>?]>([
            ['Queued', { status: 'Queued' }],
            ['Queued with a start in flight', { status: 'Queued' }, { starts: { shape: starting } }],
            ['Shaping', { status: 'Shaping' }],
        ])('%s appears only in its dossier', (_name, change, facts) => {
            assert.deepEqual(inDossier(change, facts), { sections: ['dock'] });
        });

        test('Needs you with no recorded build thread appears only in its dossier', () => {
            assert.deepEqual(inDossier({ status: 'Needs you' }), { sections: ['dock'] });
            assert.deepEqual(inDossier({ status: 'Needs you' }, { starts: { build: starting } }), {
                sections: ['dock'],
            });
        });

        test.each<[string, Partial<Item>, BoardSection[], Partial<PlacementFacts>?]>([
            ['Ready', { status: 'Ready' }, ['dock']],
            ['Ready with a build start in flight', { status: 'Ready' }, ['dock'], { starts: { build: starting } }],
            ['In progress', { status: 'In progress' }, ['dock']],
            ['Review', { status: 'Review' }, ['dock']],
            ['Verify', { status: 'Verify' }, ['dock']],
            ['Ready to merge', { status: 'Ready to merge' }, ['dock']],
            ['Needs you with a recorded build thread', { status: 'Needs you', threads: [buildThread] }, ['dock']],
        ])('%s appears only in its dossier', (_name, change, expected, facts) => {
            assert.deepEqual(inDossier(change, facts), { sections: expected });
        });

        test('a merged part stays in its dossier only', () => {
            assert.deepEqual(inDossier({ status: 'Done' }), { sections: ['dock'] });
        });
    });

    test('a List item shows in no section', () => {
        assert.deepEqual(sections(work({ status: 'List' })), []);
        assert.deepEqual(sections(concept({ status: 'List' })), []);
    });
});

test('the desk leaves out Ready and a merged build counts under shipped', () => {
    const closedAt = new Date(AT - 1000).toISOString();
    const ready = delivered('Ready', { state: 'done' });
    const merged = delivered('Done', { state: 'done' }, { closedAt });

    assert.deepEqual(boardSections(boardWith(ready), AT).needsYou, []);
    assert.deepEqual(
        boardSections(boardWith(merged), AT).done.map((item) => item.id),
        [merged.id],
    );
});

test('shaping follows the placement rule: a pending start joins it, and a part still in its dossier leaves it', () => {
    const ids = (sections: { shaping: Item[] }) => sections.shaping.map((item) => item.id);
    const shaping = delivered('Shaping', { state: 'done' }, { threads: [] });

    assert.deepEqual(ids(boardSections(boardWith(shaping), AT)), [shaping.id]);

    const waiting = { ...shaping, status: 'Needs you' as const };

    assert.deepEqual(
        ids(boardSections(boardWith(waiting), AT)),
        [waiting.id],
        'waiting on the user during shaping, it stays in Shaping',
    );
    assert.deepEqual(
        boardSections(boardWith(waiting), AT).needsYou.map((item) => item.id),
        [waiting.id],
        'and is on the desk too',
    );

    const queued = { ...shaping, status: 'Queued' as const };

    assert.deepEqual(ids(boardSections(boardWith(queued), AT)), []);

    const starting = {
        startProgress: { [queued.id]: { shape: { phase: 'starting' } } },
    } as unknown as Partial<BoardData>;

    assert.deepEqual(ids(boardSections(boardWith(queued, starting), AT)), [queued.id]);

    const failed = { startProgress: { [queued.id]: { shape: { phase: 'failed' } } } } as unknown as Partial<BoardData>;

    assert.deepEqual(ids(boardSections(boardWith(queued, failed), AT)), [], 'a failed start waits in the Queue again');

    const parent = delivered('In progress', { state: 'done' }, { id: 'parent' });
    const part = { ...shaping, parentId: 'parent' };

    assert.deepEqual(ids(boardSections(boardWith(part, { items: [parent, part] }), AT)), []);
});
