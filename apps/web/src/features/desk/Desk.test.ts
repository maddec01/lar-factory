// Your desk: Needs you, Verify and Ready to merge items and open questions as cards in one sideways row, each opening the item dialog
// and carrying the buttons for its next action, narrowed by the board's Scope, Kind and Labels; and the line's heading below it.

import type { BoardData, Item } from '@lar-factory/shared';
import { describe, expect, test } from 'vite-plus/test';

import { $, $$, fresh, mountPage, sample, settle, text } from '@/test/PageTest';

const cards = () => $$('.desk-card');
const card = (id: string) => $(`.desk-card[data-item="${id}"]`)!;
/** A card's buttons and links, as their text, an icon button's name in brackets, with a disabled one's title. */
const controls = (id: string) =>
    [...card(id).querySelectorAll('.desk-actions :is(button, a)')].map(
        (b) =>
            (text(b) || `[${b.getAttribute('aria-label')}]`) +
            ((b as HTMLButtonElement).disabled ? ` (disabled: ${b.getAttribute('title')})` : ''),
    );
/** The card's next-step line. */
const nextLine = (id: string) => text(card(id).querySelector('.desk-next'));
const dialog = () => $('[data-item-dialog]');
const withItem = (id: string, change: Partial<Item>): BoardData => ({
    ...sample,
    items: sample.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
});

test('the desk shows what waits on you, counted, as cards in one row that scrolls sideways with no scrollbar', async () => {
    await mountPage();
    expect(text($('#desk-h'))).toBe('Your desk 7');

    const statuses = cards().map((c) => sample.items.find((i) => i.id === c.dataset.item)!.status);

    expect(new Set(statuses)).toEqual(new Set(['Needs you', 'Verify', 'Ready to merge']));
    expect(cards()).toHaveLength(7);

    const row = cards()[0]!.parentElement!.className.split(' ');

    expect(row).toEqual(
        expect.arrayContaining([
            '-mx-6',
            'px-6',
            'overflow-x-auto',
            '[scrollbar-width:none]',
            '[&::-webkit-scrollbar]:hidden',
        ]),
    );
});

test('a desk card shows its repository, kind and age, numbered title, then its status and next step beside its action', async () => {
    await mountPage();

    const rows = [...card('I_sample16').querySelector('button')!.children];

    expect(rows.map(text)).toEqual(['🍎lar-appleFeature1h ago', '#31 New artwork grid layout']);
    expect(nextLine('I_sample16')).toBe('can merge · 1 passed');
    expect(text(card('I_sample16'))).toContain('Verify');
    expect(card('I_sample16').querySelector('ol'), 'no status track').toBeNull();
});

test("a desk card's title is one line, cut short, with the whole title in its tooltip", async () => {
    await mountPage();

    const title = card('I_sample28').querySelector('.desk-title')!;

    expect(title.className.split(' ')).toEqual(expect.arrayContaining(['truncate', 'h-5']));
    expect(title.getAttribute('title')).toBe('#147 Fall back to software transcoding when the GPU is busy');
});

test('every desk card has the same rows at the same heights', async () => {
    await mountPage();

    const heights = (c: HTMLElement) =>
        [
            c.querySelector('.desk-meta'),
            c.querySelector('.desk-title'),
            c.querySelector('.desk-next'),
            c.querySelector('.desk-actions'),
        ].map((row) => row?.className.split(' ').find((name) => /^h-\d+$/.test(name)));

    for (const c of cards()) expect(heights(c)).toEqual(['h-6', 'h-5', 'h-5', 'h-8']);
});

test('a desk card opens the item dialog and stays marked while it shows', async () => {
    await mountPage();
    await settle(() => card('I_sample17').click());
    expect(dialog()!.textContent).toContain('Cache probe results between restarts');
    expect(card('I_sample17').className).toContain('ring-2');
});

test('a desk card is no button wrapping buttons: its summary is the button, and pressing it opens the item dialog', async () => {
    await mountPage();
    expect($$('.desk-card button button, button.desk-card')).toHaveLength(0);
    await settle(() => card('I_sample16').querySelector<HTMLButtonElement>(':scope > button')!.click());
    expect(dialog()!.textContent).toContain('New artwork grid layout');
});

const liveThread = [{ id: 't1', title: 'Build', state: 'running' as const, updated: '2026-10-21T09:00:00.000Z' }];
const NO_THREAD = 'No T3 thread has worked on this yet';

test.each<[string, BoardData, string, string, string[]]>([
    ['Needs you with no thread', sample, 'I_sample11', '', [`Answer in T3 (disabled: ${NO_THREAD})`]],
    ['Needs you', sample, 'I_sample12', '', ['Answer in T3']],
    [
        'Needs you with a linked PR',
        withItem('I_sample12', { linkedPrs: sample.items.find((i) => i.id === 'I_sample16')!.linkedPrs }),
        'I_sample12',
        '',
        ['Answer in T3'],
    ],
    ['Verify', sample, 'I_sample16', 'can merge · 1 passed', ['Open PR', `[Open thread] (disabled: ${NO_THREAD})`]],
    [
        'Ready to merge',
        sample,
        'I_sample17',
        'can merge · 4 passed · 1 failed',
        ['Open PR', `[Open thread] (disabled: ${NO_THREAD})`],
    ],
    [
        'Verify with a recorded PR',
        withItem('I_sample16', {
            linkedPrs: [
                {
                    number: 9,
                    url: 'https://github.com/o/r/pull/9',
                    state: 'open',
                    isDraft: false,
                    checks: null,
                    mergeState: 'checking',
                    pipelineUnread: true,
                },
            ],
        }),
        'I_sample16',
        'Test it with the steps in the PR, then merge',
        ['Open PR', `[Open thread] (disabled: ${NO_THREAD})`],
    ],
    [
        'Verify with no PR',
        withItem('I_sample16', { linkedPrs: [] }),
        'I_sample16',
        'Test it with the steps in the PR, then merge',
        ['Open PR (disabled: No pull request is linked to this item yet)', `[Open thread] (disabled: ${NO_THREAD})`],
    ],
])(
    'a %s card says its next step and has its action on the left, Open thread in the corner unless that is the action',
    async (_card, data, id, next, buttons) => {
        await mountPage(data);
        expect([nextLine(id), controls(id)]).toEqual([next, buttons]);
    },
);

test("a card's check counts read in full in a tooltip, since they can truncate", async () => {
    await mountPage();
    expect(card('I_sample17').querySelector('.desk-next [title]')!.getAttribute('title')).toBe(
        'can merge · 4 passed · 1 failed',
    );
});

test("Open thread in a card's corner is a square icon button named and titled Open thread", async () => {
    await mountPage(withItem('I_sample16', { threads: liveThread }));

    const corner = card('I_sample16').querySelector('.desk-actions [data-open-thread]')!;

    expect([
        corner.getAttribute('aria-label'),
        corner.getAttribute('title'),
        corner.getAttribute('data-icon-only'),
    ]).toEqual(['Open thread', 'Open thread', '']);
});

test('Open thread opens the latest thread in T3, and Open PR the pull request the item dialog links, in a new tab', async () => {
    await mountPage();
    expect(card('I_sample12').querySelector('[data-open-thread]')!.getAttribute('href')).toMatch(/^t3code:\/\//);

    const pr = card('I_sample16').querySelector<HTMLAnchorElement>('[data-pr-link]')!;

    expect([pr.getAttribute('href'), pr.target]).toEqual(['https://github.com/maddec01/lar-apple/pull/32', '_blank']);
});

test.each([
    ['an issue whose PR GitHub is still checking', 'I_sample26', 'checking · 4 passed · 2 running'],
    ['an issue whose PR is blocked', 'I_sample27', 'blocked · 3 passed · 1 failed'],
    ['an issue whose PR has no checks and conflicts', 'I_sample28', 'conflicts · no checks'],
])(
    'a Verify card for %s says its merge state, then its checks leaving out zero counts other than passed',
    async (_what, id, line) => {
        await mountPage();
        expect(nextLine(id)).toBe(line);
    },
);

test('a Verify card reads the PR Open PR opens, its first linked one', async () => {
    const linkedPrs = (id: string) => sample.items.find((i) => i.id === id)!.linkedPrs;

    await mountPage(
        withItem('I_sample16', {
            linkedPrs: [...linkedPrs('I_sample16'), { ...linkedPrs('I_sample27')[0]!, number: 99 }],
        }),
    );
    expect(nextLine('I_sample16')).toBe('can merge · 1 passed');
    expect(text(card('I_sample16'))).toContain('Verify');
});

test("clicks on a card's buttons open no item dialog", async () => {
    await mountPage();
    await settle(() => card('I_sample12').querySelector<HTMLElement>('[data-open-thread]')!.click());
    await settle(() => card('I_sample16').querySelector<HTMLElement>('[data-pr-link]')!.click());
    expect(dialog()).toBeNull();
});

test('a click on a card beside its buttons opens the item dialog', async () => {
    await mountPage();
    await settle(() => card('I_sample12').querySelector<HTMLElement>('.desk-actions')!.click());
    expect(dialog()).not.toBeNull();
});

test('an empty desk is one small neutral line under no card row', async () => {
    await mountPage({
        ...sample,
        items: sample.items.filter((i) => !['Needs you', 'Verify', 'Ready to merge'].includes(i.status)),
    });
    expect(cards()).toHaveLength(0);
    expect(text($('.desk'))).toBe('Your deskNothing waits on you.');
    expect($('.desk')!.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-baseline']));
});

const noWaiting = sample.items.filter((i) => !['Needs you', 'Verify', 'Ready to merge'].includes(i.status));

test('an empty desk during the first read shows the loader, as the read may still add items', async () => {
    await mountPage({
        ...sample,
        items: noWaiting,
        firstRead: {
            step: 'items',
            ready: true,
            settled: false,
            running: ['owner/pending'],
            waiting: ['owner/pending'],
        },
    });
    expect(text($('.desk'))).toBe('Your deskLoading Projects…');
    expect($('.desk [data-loader]')).not.toBeNull();
});

const feature = (item: Item) => ({ ...item, kind: 'feature' as const });
const FILTERED = 'Your deskNothing on your desk matches the filters.';
const NOTHING = 'Your deskNothing waits on you.';
const seedFilters = (kinds: string[], labels: string[] = []) =>
    localStorage.setItem('lar-board:filters:board', JSON.stringify({ kinds, labels }));

describe('narrowed by Scope, Kind and Labels', () => {
    test('Kind and Labels narrow the cards, and the heading counts what stays while the title bar counts the whole factory', async () => {
        const data: BoardData = {
            ...sample,
            items: sample.items.map((i) =>
                i.id === 'I_sample16'
                    ? { ...i, kind: 'bug' as const, labels: ['area: web'] }
                    : i.kind === 'bug'
                      ? feature(i)
                      : i,
            ),
        };

        seedFilters(['bug'], ['area: web']);
        await mountPage(data);
        expect(cards().map((c) => c.dataset.item)).toEqual(['I_sample16']);
        expect(text($('#desk-h'))).toBe('Your desk 1');
        expect(text($('.counters button[aria-haspopup]'))).toBe('7');
    });

    test('Scope narrows the cards, and the heading counts them', async () => {
        localStorage.setItem('lar-board:scope', 'maddec01/lar-apple');
        await mountPage();
        expect(cards().length).toBeGreaterThan(0);
        expect(cards().length).toBeLessThan(7);
        expect(
            cards().every((c) => sample.items.find((i) => i.id === c.dataset.item)!.repo === 'maddec01/lar-apple'),
        ).toBe(true);
        expect(text($('#desk-h'))).toBe(`Your desk ${cards().length}`);
        expect(text($('.counters button[aria-haspopup]'))).toBe('7');
    });

    test('filters that hide every card say so on the same one line', async () => {
        seedFilters([], ['no such label']);
        await mountPage();
        expect(cards()).toHaveLength(0);
        expect(text($('.desk'))).toBe(FILTERED);
        expect($('.desk')!.className.split(' ')).toEqual(expect.arrayContaining(['flex', 'items-baseline']));
    });

    test('a Scope with nothing on the desk says the filters hide it while another repository has cards', async () => {
        const data: BoardData = {
            ...sample,
            items: sample.items.filter(
                (i) => i.repo !== 'maddec01/lar-apple' || !['Needs you', 'Verify', 'Ready to merge'].includes(i.status),
            ),
        };

        localStorage.setItem('lar-board:scope', 'maddec01/lar-apple');
        await mountPage(data);
        expect(text($('.desk'))).toBe(FILTERED);
    });

    test('an empty desk with filters on still says nothing waits on you', async () => {
        seedFilters(['bug']);
        await mountPage({ ...sample, items: noWaiting });
        expect(text($('.desk'))).toBe(NOTHING);
    });

    test('clearing the filters brings the cards back', async () => {
        seedFilters([], ['no such label']);
        await mountPage();
        await settle(() => $<HTMLButtonElement>('[data-search-field]')!.click());
        await settle(() => $<HTMLButtonElement>('[data-search-clear]')!.click());
        expect(cards()).toHaveLength(7);
    });

    test('the disconnected message comes before the filtered one', async () => {
        seedFilters([], ['no such label']);
        await mountPage();

        const { useBoardStore } = await import('@/services/board/board.hooks');

        await settle(() => useBoardStore.getState().fail('down'));
        expect(text($('.desk'))).toBe('Your deskNothing waited on you at the last read.');
    });

    test('the loader comes before the filtered message', async () => {
        seedFilters([], ['no such label']);
        await mountPage({
            ...sample,
            firstRead: {
                step: 'items',
                ready: true,
                settled: false,
                running: ['owner/pending'],
                waiting: ['owner/pending'],
            },
        });
        expect(text($('.desk'))).toBe('Your deskLoading Projects…');
    });
});

test('a desk with cards stays as it is during the first read', async () => {
    await mountPage({
        ...sample,
        firstRead: {
            step: 'items',
            ready: true,
            settled: false,
            running: ['owner/pending'],
            waiting: ['owner/pending'],
        },
    });
    expect(cards().length).toBeGreaterThan(0);
    expect($('.desk [data-loader]')).toBeNull();
});

test('the stage layout follows the desk', async () => {
    await mountPage();
    expect($('.desk')!.compareDocumentPosition($('.stages')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

const questionBoard = (child: Partial<Item> = {}, concept: Partial<Item> = {}): BoardData => ({
    ...sample,
    items: sample.items.map((item) =>
        item.id === 'I_sample09'
            ? {
                  ...item,
                  status: 'Needs you',
                  threads: [
                      {
                          id: 'concept-question',
                          title: 'Concept question',
                          state: 'needs you',
                          updated: '2026-10-21T09:00:00.000Z',
                      },
                  ],
                  ...concept,
              }
            : item.id === 'I_sample12'
              ? { ...item, status: 'Needs you', parentId: 'I_sample09', threads: [], ...child }
              : item,
    ),
});

test('a decision with no thread answers in its concept thread without inheriting its thread association or usage', async () => {
    const data = questionBoard({ stats: undefined });

    await mountPage(data);

    const action = card('I_sample12').querySelector<HTMLAnchorElement>('[data-open-thread]')!;

    expect([text(action), action.href]).toEqual([
        'Answer in concept thread',
        't3code://threads/sample-environment/concept-question',
    ]);
    expect(nextLine('I_sample12'), 'its action says it').toBe('');

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const child = useBoardStore.getState().data.items.find((item) => item.id === 'I_sample12')!;

    expect(child.threads).toEqual([]);
    expect(child.stats).toBeUndefined();
    expect(card('I_sample09')).not.toBeNull();
    await settle(() => card('I_sample12').click());
    expect(text(dialog()!.querySelector('[data-open-thread]'))).toBe('Answer in concept thread');
});

test('a decision keeps its own thread even when its concept has a waiting thread', async () => {
    await mountPage(
        questionBoard({
            threads: [{ id: 'own-decision', title: 'Decision', state: 'stopped', updated: '2026-10-21T09:00:00.000Z' }],
        }),
    );

    const action = card('I_sample12').querySelector<HTMLAnchorElement>('[data-open-thread]')!;

    expect(action.href).toBe('t3code://threads/sample-environment/own-decision');
    expect(text(action)).toBe('Answer in T3');
});

test.each([
    ['unavailable child observations', { threads: 'unavailable' }, {}],
    ['unavailable concept observations', {}, { threads: 'unavailable' }],
    [
        'retained concept observations',
        {},
        {
            threads: [
                {
                    id: 'stale-concept',
                    title: 'Old question',
                    state: 'needs you',
                    updated: '2026-10-21T09:00:00.000Z',
                    observedAt: '2026-10-21T09:01:00.000Z',
                },
            ],
        },
    ],
    [
        'a finished concept thread',
        {},
        { threads: [{ id: 'done-concept', title: 'Finished', state: 'done', updated: '2026-10-21T09:00:00.000Z' }] },
    ],
    ['a missing parent', { parentId: 'missing' }, {}],
    ['a parent cycle', { parentId: 'I_sample12' }, {}],
    ['an unrelated repository thread', { parentId: null }, {}],
] satisfies [string, Partial<Item>, Partial<Item>][])(
    'a decision does not borrow an unrelated question for %s',
    async (_name, child, concept) => {
        await mountPage(questionBoard(child, concept));

        const action = card('I_sample12').querySelector<HTMLButtonElement>('[data-open-thread]')!;

        expect(action.tagName).toBe('BUTTON');
        expect(action.disabled).toBe(true);
        expect(action.getAttribute('href')).toBeNull();
    },
);

test('a Ready item has no desk card and keeps Start build on its row', async () => {
    await mountPage(withItem('I_sample13', { parent: null, parentId: null, blockers: [] }));
    expect($('.desk-card[data-item="I_sample13"]')).toBeNull();
    expect($('[data-stage="ready"] [data-item="I_sample13"] [data-start="I_sample13"]')).not.toBeNull();
});

test('a Ready part has no desk card, shows in Ready to build and stays in its dossier', async () => {
    await mountPage();
    expect($('.desk-card[data-item="I_sample13"]')).toBeNull();
    expect($('[data-stage="ready"] [data-item="I_sample13"]')).not.toBeNull();
    await settle(() => $<HTMLButtonElement>('[data-dossier="I_sample09"] [data-dossier-open]')!.click());
    expect(
        $(
            '[data-dossier="I_sample09"] [data-map-part="I_sample13"], [data-dossier="I_sample09"] [data-part="I_sample13"]',
        ),
    ).not.toBeNull();
});

test('shaping questions target the older question and leave the desk on a board update', async () => {
    const data = withItem('I_sample12', {
        status: 'Shaping',
        threads: [
            { id: 'newer', title: 'Newer', state: 'done', updated: '2026-11-02' },
            { id: 'question', title: 'Question', state: 'needs you', updated: '2026-11-01' },
        ],
    });

    await mountPage(data);
    expect(nextLine('I_sample12'), 'its action says it').toBe('');
    expect(card('I_sample12').querySelector('a')?.getAttribute('href')).toBe(
        't3code://threads/sample-environment/question',
    );
    await settle(() => card('I_sample12').click());
    expect(
        [...dialog()!.querySelectorAll('[data-slot="modal-footer"] [data-open-thread]')].map((a) => [
            text(a),
            a.getAttribute('href'),
        ]),
    ).toEqual([
        ['Open thread', 't3code://threads/sample-environment/newer'],
        ['Answer in T3', 't3code://threads/sample-environment/question'],
    ]);

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...data,
            items: data.items.map((item) => (item.id === 'I_sample12' ? { ...item, threads: [] } : item)),
        }),
    );
    expect(card('I_sample12')).toBeNull();
});

test.each([
    ['prototype', 'Prototype'],
    [null, 'No method'],
] as const)("a decision's card with method %s names %s", async (decisionMethod, name) => {
    await mountPage({
        ...sample,
        items: sample.items.map((i) =>
            i.id === 'I_sample12' ? { ...i, kind: 'decision' as const, decisionMethod } : i,
        ),
    });
    expect(text($('[data-item="I_sample12"] .desk-meta'))).toContain(name);
});

test('desk status icons stay still and Needs you keeps its amber colour even with running threads', async () => {
    const data = {
        ...fresh(),
        items: sample.items.map((item) => ({
            ...item,
            paused: 'Settings changed',
            threads: [
                {
                    id: 'b',
                    title: 'Build',
                    purpose: 'build',
                    state: 'running' as const,
                    currentRunning: true as const,
                    updated: item.updatedAt,
                },
            ],
        })),
    };

    await mountPage(data);
    expect(cards()).toHaveLength(7);
    expect($('.desk-card svg.status-pulse, .desk-card .status-spin')).toBeNull();

    const needsYou = data.items.find((item) => item.status === 'Needs you')!;

    expect(card(needsYou.id).querySelector<SVGElement>('svg.lucide-circle-dot')!.style.color).toBe('var(--st-amber)');
});
