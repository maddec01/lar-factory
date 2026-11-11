// The Shaping, Ready to build and Build sections: their rows from the placement rule, each with its status, agent figures, a build's slices
// and its side action.

import { normalizeItems } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread, RawItem, Slice, ThreadActivity } from '@lar-factory/shared';
import { rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';
import { iconConcept } from '@lar-works/design-system/testing';
import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    NOW,
    answer,
    fresh,
    holdPosts,
    mountPage,
    posted,
    pressMenu,
    recorded,
    sample,
    settle,
    text,
    toast,
} from '@/test/PageTest';
import { conceptIcons } from '@/ui/board';

const PANES = ['shaping', 'ready', 'build'];
const SHAPING = [130, 22, 200, 23];
const BUILD = [31, 149, 34, 147, 142, 141, 150, 30, 180];
const rows = () => PANES.flatMap((pane) => $$(`[data-stage="${pane}"] li[data-item]`));
const row = (id: string) =>
    $(`:is([data-stage="shaping"], [data-stage="ready"], [data-stage="build"]) li[data-item="${id}"]`)!;
const opener = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-row-open]')!;
const numberOf = (id: string) => sample.items.find((i) => i.id === id)!.number;
const col = (id: string, name: string) => row(id).querySelector<HTMLElement>(`[data-col="${name}"]`)!;
const side = (id: string) => col(id, 'side')!;
/** A row's side after the agent figures that lead it: its status or action. */
const sideAfterFigures = (id: string) =>
    text(side(id)).slice(text(side(id).querySelector('[data-col="figures"]')).length);
/** A section heading's title and the count shown beside it. */
const heading = (id: string) => [
    text($(`#${id}`)),
    text($(`#${id}`)!.parentElement!.querySelector('[data-slot="count"]')),
];
const state = (id: string) => row(id).querySelector<HTMLElement>('[data-state]')!;
const startBuild = (id = 'I_sample13') => $<HTMLButtonElement>(`[data-start="${id}"]`)!;
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) =>
    settle(() => {
        (el as HTMLElement).click();
        vi.advanceTimersByTime(0);
    });
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
/** The board with `raws` as items, each open slice numbered in `keys` active or blocked, as its work record holds it. */
const boardOf = (
    raws: RawItem[],
    { active = [], blocked = [] }: { active?: number[]; blocked?: number[] } = {},
): BoardData => {
    const progress = (slice: Slice): Slice =>
        slice.progress !== 'waiting'
            ? slice
            : {
                  ...slice,
                  progress: blocked.includes(slice.number)
                      ? 'blocked'
                      : active.includes(slice.number)
                        ? 'active'
                        : 'waiting',
              };
    const items = normalizeItems(raws).map((item) => ({ ...item, slices: item.slices.map(progress) }));

    return { ...sample, error: null, items: recorded(items) };
};
const withItem = (id: string, change: Partial<Item>, data: BoardData = sample): BoardData => ({
    ...data,
    items: data.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
});
/** The sample with #140 out of its concept's dossier, so it has a row in the table. */
const loose = withItem('I_sample13', { parent: null, parentId: null, status: 'Review' });
/** #140 with its blocker closed, so its Start build runs, on a board whose writes are on. */
const unblocked = (data: BoardData = loose): BoardData =>
    withItem(
        'I_sample13',
        {
            status: 'Ready',
            blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }],
        },
        {
            ...data,
            capture: { session: 's1', enabled: true },
            modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }],
        },
    );
const thread = (id: string, state: ItemThread['state']): ItemThread => ({
    id,
    title: `Thread ${id}`,
    state,
    updated: '2026-10-21T09:00:00.000Z',
});
/** T3's read of a thread at work, with its action `seconds` old at NOW. */
const acting = (
    action: string,
    seconds: number,
    more: Partial<Extract<ThreadActivity, { available: true }>> = {},
): ThreadActivity => ({
    available: true,
    readAt: new Date(NOW).toISOString(),
    action,
    actionAt: new Date(NOW - seconds * 1000).toISOString(),
    toolRunning: false,
    agents: [],
    ...more,
});

beforeEach(() => localStorage.clear());

const inPane = (pane: string) => $$(`[data-stage="${pane}"] li[data-item]`).map((r) => numberOf(r.dataset.item!));
const shapingRows = () => $$('[data-stage="shaping"] li[data-item]').map((r) => numberOf(r.dataset.item!));
const readyRows = () => $$('[data-stage="ready"] li[data-item]').map((r) => numberOf(r.dataset.item!));

test('each pane holds the rows the placement rule gives it, and Build lists the furthest along first', async () => {
    await mountPage();
    expect(shapingRows()).toEqual(SHAPING);
    expect(readyRows()).toEqual([140]);
    expect(inPane('build')).toEqual(BUILD);
    expect(heading('shaping-h')).toEqual(['Shaping', String(SHAPING.length)]);
    expect(heading('build-h')).toEqual(['Build', String(BUILD.length)]);
});

test('a live board push moves a row between sections with no reload', async () => {
    await mountPage(withItem('I_sample13', { blockers: [] }));
    expect(readyRows()).toContain(140);
    await settle(async () =>
        (await import('@/services/board/board.hooks')).useBoardStore
            .getState()
            .receive(withItem('I_sample13', { blockers: [], status: 'In progress', statuses: ['In progress'] })),
    );
    expect(readyRows()).not.toContain(140);
    expect(inPane('build')).toContain(140);
});

test('Build’s header counts the factory’s builds against the automatic build limit, one bar per build past it', async () => {
    const limited = { ...sample, buildLimit: { limit: 'automatic' as const, automatic: 2 } };
    const receive = async (data: BoardData) =>
        settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(data));

    await mountPage(limited);

    const header = $('[data-stage="build"] header .build-limit')!;

    expect(text(header), 'In progress and Review count').toBe('4 open · limit 2');
    expect(header.querySelectorAll('.bar')).toHaveLength(4);
    expect(header.getAttribute('title')).toContain('2 working, 1 waiting to close, 1 stopped');
    expect(iconConcept(row('I_sample15').querySelector('[data-glyph]')!, conceptIcons)).toBe('stopped');
    await receive(withItem('I_sample09', { status: 'In progress' }, limited));
    expect(text($('.build-limit')), 'a concept in progress is no build at work').toBe('4 open · limit 2');
    await receive({
        ...limited,
        items: sample.items.map((i) =>
            ['I_sample14', 'I_sample23'].includes(i.id) ? { ...i, status: 'Done' as const } : i,
        ),
    });
    expect(text($('.build-limit'))).toBe('2 open · limit 2');
    await receive({ ...limited, buildLimit: { limit: 4, automatic: 2 } });
    expect([text($('.build-limit')), $$('.build-limit .bar').length]).toEqual(['4 open · limit 4', 4]);
    await receive({ ...sample, buildLimit: undefined });
    expect([text($('.build-limit')), $$('.build-limit .bar').length], 'no limit reported').toEqual(['4 open', 0]);
});

test('scoped to a repository whose items haven’t landed yet, the main area says it’s reading instead of an empty desk and panes', async () => {
    await mountPage({
        ...sample,
        items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
        firstRead: { step: 'items', running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false },
    });

    const { useScopeStore } = await import('@/features/filters/ScopeStore');

    await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
    expect(text($('[data-reading]'))).toBe('Loading projects…');
    expect([$('[data-stage="build"]'), $('section.desk')]).toEqual([null, null]);
    await settle(() => useScopeStore.getState().setScope('maddec01/lar-server'));
    expect([$('[data-reading]'), $('[data-stage="build"]') !== null]).toEqual([null, true]);
});

test('the note names the blocked-by issues still open', async () => {
    await mountPage(
        withItem(
            'I_sample13',
            {
                blockers: [
                    { number: 202, repo: 'maddec01/lar-server', state: 'open' },
                    { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
                ],
            },
            loose,
        ),
    );
    expect(text(col('I_sample13', 'next'))).toContain('Blocked by #202 until it completes');
    await settle(async () =>
        (await import('@/services/board/board.hooks')).useBoardStore
            .getState()
            .receive(withItem('I_sample13', { blockers: [] }, loose)),
    );
    expect(row('I_sample13').textContent, 'with no open issue listed, nothing blocks').not.toContain('Blocked by');
    expect(side('I_sample13').querySelector('[data-open-thread]')!.getAttribute('aria-label')).toBe('Open thread');
});

test('a Dependency holds the badge until it is marked met, whatever its ticket shows, and the badge names it', async () => {
    const dependency = (met: boolean) => ({
        number: 40,
        repo: 'maddec01/lar-server',
        state: met ? ('closed' as const) : ('open' as const),
        title: 'An export endpoint',
        dependency: {
            dependencyId: 'dep-1',
            revision: 2,
            owner: 'server team',
            need: 'An export endpoint',
            ticket: 'maddec01/lar-server#40',
            named: [],
            evidence: '',
            met: met ? { by: 'pedro', at: '2026-10-21T08:00:00Z' } : null,
            needsReview: false,
            observation: {
                subject: 'maddec01/lar-server#40',
                kind: 'closed' as const,
                detail: null,
                observedAt: '2026-10-21T09:00:00Z',
                lastGood: null,
            },
        },
    });

    await mountPage(withItem('I_sample13', { blockers: [dependency(false)] }, loose));

    const note = col('I_sample13', 'next').querySelector<HTMLElement>('[data-blocked]')!;

    expect([text(note), note.title]).toEqual([
        'Blocked by the Dependency on server team until you mark it met',
        'Blocked by the Dependency on server team until you mark it met',
    ]);
    await settle(async () =>
        (await import('@/services/board/board.hooks')).useBoardStore
            .getState()
            .receive(withItem('I_sample13', { blockers: [dependency(true)] }, loose)),
    );
    expect(row('I_sample13').textContent).not.toContain('Blocked by');
});

test('Start after on a blocked Ready row arms its start on the picked model, then reads Starts after until pressed again', async () => {
    const blocked = {
        ...withItem('I_sample13', { status: 'Ready' }, loose),
        capture: { session: 's1', enabled: true },
        modelChoices: unblocked().modelChoices,
    };

    holdPosts(blocked);
    await mountPage(blocked);

    const after = () => side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;

    await pressMenu(after());
    expect(dialog(), 'the menu opens without the dialog').toBeNull();
    await press(entries()[1]!);
    expect(posted()).toEqual([
        ['/api/arm', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }],
    ]);
    await answer({
        error: null,
        board: { ...blocked, armed: { I_sample13: { model: { instanceId: 'codex', model: 'gpt-5.5' } } } },
    });
    expect([text(after()), after().getAttribute('aria-pressed')]).toEqual(['Starts after ✓', 'true']);
    expect(after().title).toBe('Starts by itself once #202 completes. Pressing it again disarms it');
    await press(after());
    expect(posted().at(-1)).toEqual(['/api/disarm', { session: 's1', itemId: 'I_sample13' }]);
    await answer({ error: null, board: { ...blocked, armed: {} } });
    expect(text(after()), 'the row already says what blocks it').toBe('Start after');
    expect(after().title, 'nothing starts by itself until it is armed').toBe(
        'Pick a model to start it once #202 completes',
    );
});

test('a start the board ran by itself and that failed shows its error under the row, and dismissing it clears it', async () => {
    const failed = { ...unblocked(), armedErrors: { I_sample13: 'T3 is down.' } };

    holdPosts(failed);
    await mountPage(failed);

    const error = row('I_sample13').querySelector('[data-start-after-error="I_sample13"]')!;

    expect(text(error.querySelector('[role="alert"]'))).toBe('Start after failed: T3 is down.');
    await press(error.querySelector('button')!);
    expect(posted()).toEqual([['/api/disarm', { session: 's1', itemId: 'I_sample13' }]]);
});

test('Start build sends the build with the chosen model, then shows the thread it started in a tag and a toast', async () => {
    holdPosts(unblocked());
    await mountPage(unblocked());
    await pressMenu(startBuild());
    expect(dialog(), 'the menu opens without the dialog').toBeNull();
    expect(entries().map(text)).toEqual(['Project default in T3', 'GPT-5.5']);
    await press(entries()[1]!);
    expect(dialog(), 'picking an entry doesn’t open the dialog').toBeNull();
    expect(posted()).toEqual([
        [
            '/api/start-build',
            { drift: 'keep', session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } },
        ],
    ]);
    expect([text(startBuild()), startBuild().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);

    const started = { threadId: 'thread-1', title: 'Build maddec01/lar-server#140' };

    await answer({ thread: started, error: null, board: { ...unblocked(), startedBuilds: { I_sample13: started } } });

    const tag = row('I_sample13').querySelector('[data-start-result]')!;

    expect([text(tag), tag.getAttribute('title')]).toEqual(['Started', 'T3 thread thread-1']);
    expect(startBuild()).toBeNull();
    expect(text(toast())).toBe('Build started for #140. Open thread');
    expect(JSON.parse(localStorage.getItem('lar-board:model-choice')!)).toEqual({
        instanceId: 'codex',
        model: 'gpt-5.5',
    });
});

test('active slices read as Working after the parent run ended, keeping that detail', async () => {
    const board = unblocked();
    const slice = (progress: 'active' | 'done') => ({
        number: 1,
        title: 'Slice',
        url: '',
        repo: 'maddec01/lar-server',
        state: 'open' as const,
        progress,
    });
    const withSlice = (progress: 'active' | 'done'): BoardData => ({
        ...board,
        items: board.items.map((i) =>
            i.id === 'I_sample13'
                ? {
                      ...i,
                      status: 'In progress' as const,
                      statuses: ['In progress' as const],
                      buildPhase: 'implement',
                      slices: [slice(progress)],
                      threads: [
                          {
                              id: 'b1',
                              title: 'Build',
                              state: 'done' as const,
                              purpose: 'build',
                              updated: '2026-10-31T00:00:00Z',
                          },
                      ],
                  }
                : i,
        ),
    });

    await mountPage(withSlice('active'));
    expect(state('I_sample13').title).toContain('Working, parent run finished');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(withSlice('done')));
    expect(state('I_sample13').title).toContain('Run finished');
    expect(text(row('I_sample13').querySelector('[data-meta]'))).not.toContain('Working');
});

test('a descendant holds Run finished back: Working while it runs, and waiting while it is only live', async () => {
    const board = unblocked();
    const at = (more: Partial<ItemThread>): BoardData => ({
        ...board,
        items: board.items.map((i) =>
            i.id === 'I_sample13'
                ? {
                      ...i,
                      status: 'In progress' as const,
                      statuses: ['In progress' as const],
                      buildPhase: 'implement',
                      slices: [],
                      threads: [
                          {
                              id: 'b1',
                              title: 'Build',
                              state: 'done' as const,
                              purpose: 'build',
                              updated: '2026-10-31T00:00:00Z',
                              ...more,
                          },
                      ],
                  }
                : i,
        ),
    });

    await mountPage(at({ hasRunningChildren: true, hasLiveChildren: true }));
    expect(state('I_sample13').title).toContain('Working, parent run finished');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(at({ hasLiveChildren: true })));
    expect(state('I_sample13').title).toBe('Run finished, child waiting');
    await settle(() => useBoardStore.getState().receive(at({})));
    expect(state('I_sample13').title).toBe('Run finished');
});

test('a moved build whose thread stopped before a phase offers Retry start, with Starting on its row while it runs', async () => {
    const moved = (extra: Partial<BoardData> = {}): BoardData => {
        const board = unblocked();

        return {
            ...board,
            ...extra,
            items: board.items.map((i) =>
                i.id === 'I_sample13'
                    ? {
                          ...i,
                          status: 'In progress' as const,
                          statuses: ['In progress' as const],
                          buildPhase: null,
                          slices: [],
                          threads: [
                              {
                                  id: 'b1',
                                  title: 'Build',
                                  state: 'stopped' as const,
                                  purpose: 'build',
                                  updated: '2026-10-31T00:00:00Z',
                              },
                          ],
                      }
                    : i,
            ),
        };
    };

    holdPosts(moved());
    await mountPage(moved());
    expect(text(startBuild())).toBe('Retry start');

    const group = row('I_sample13').querySelector('[data-col="side"] .start-group')!;

    expect(group.textContent, 'no second line says the run stopped').not.toContain('Run stopped');
    expect(
        group.querySelector('a, button:not([data-start])'),
        'the stopped thread stays one press away',
    ).not.toBeNull();

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive(moved({ startProgress: { I_sample13: { build: { phase: 'starting' } } } })),
    );
    expect(text(startBuild())).toBe('Starting…');
    expect(text(state('I_sample13')), 'Start build already says Starting, and Build names the stage').toBe('');
});

// A build's slices.

const build = (count: number) =>
    rawIssue('I_build', 59, 'In progress', ['build'], {
        subIssuesSummary: { total: count, completed: 1 },
        subIssues: { nodes: Array.from({ length: count }, (_, i) => sliceRef(100 + i, i ? 'OPEN' : 'CLOSED')) },
    });
/** The build row's slice bar segments' colours, its count button's text and its first blocked or active slice. */
const slices = (id = 'I_59') => {
    const bar = col(id, 'bar').querySelector('ol')!;

    return {
        segments: [...bar.children].map((li) => li.getAttribute('data-state')),
        count: countShown(count(id)),
        next: text(col(id, 'next')),
    };
};
const count = (id = 'I_59') => row(id).querySelector<HTMLButtonElement>('button[data-col="count"]')!;
/** A slice count's visible text, after the words that name its toggle for screen readers: "1/3 slices". */
const countShown = (el: Element | null) => text(el).replace(/^(Show|Hide) slices: /, '');
/** What a slice count's toggle does, as its name starts: "Show slices". */
const countAction = (el: Element) => /^(Show|Hide) slices(?=:)/.exec(text(el))?.[0] ?? null;
const list = (id = 'I_59') => row(id).querySelector('[data-slices] ul');

test('a build shows its slice bar and its count, naming the first blocked slice plus how many more are blocked or active', async () => {
    const raw = rawIssue('I_build', 59, 'In progress', ['build'], {
        subIssuesSummary: { total: 5, completed: 1 },
        subIssues: {
            nodes: [
                sliceRef(65, 'CLOSED'),
                sliceRef(66, 'OPEN'),
                sliceRef(67, 'OPEN'),
                sliceRef(68, 'OPEN'),
                sliceRef(69, 'OPEN'),
            ],
        },
    });

    await mountPage(boardOf([raw], { active: [66, 67, 69], blocked: [67, 69] }));
    expect(slices()).toEqual({
        segments: ['ready', 'active', 'waiting', 'off', 'waiting'],
        count: '1/5 slices',
        next: 'blocked Issue 67 +2 more',
    });

    const sliceNote = col('I_59', 'next').querySelector('[data-note]')!;

    expect(sliceNote.firstElementChild!.className, 'blocked reads in its colour').toContain('text-warning-fg');
    expect(sliceNote.getAttribute('title'), 'the rest are named on hover').toBe(
        'blocked #67 Issue 67\nblocked #69 Issue 69\nactive #66 Issue 66',
    );
    expect(col('I_59', 'bar').querySelector('ol > li .lar-status-pulse'), 'the active slice pulses').not.toBeNull();
    expect(
        rows().map((r) => r.dataset.item),
        'slices are no rows of their own',
    ).toEqual(['I_59']);
    await press(count());
    expect(
        [...list()!.querySelectorAll('li')].map((li) => text(li).slice(0, 3)),
        'the list shows every slice',
    ).toEqual(['#65', '#66', '#67', '#68', '#69']);
});

test('a build’s count leaves out slices closed as not planned, and names none while none is active or blocked', async () => {
    const raw = rawIssue('I_build', 59, 'In progress', ['build'], {
        subIssuesSummary: { total: 4, completed: 2 },
        subIssues: {
            nodes: [
                sliceRef(65, 'CLOSED'),
                { ...sliceRef(66, 'CLOSED'), stateReason: 'NOT_PLANNED' },
                sliceRef(67, 'OPEN'),
                sliceRef(68, 'OPEN'),
            ],
        },
    });

    await mountPage(boardOf([raw]));
    expect(slices()).toEqual({
        segments: ['ready', 'off', 'off'],
        count: '1/3 slices',
        next: '',
    });
});

test('the count unfolds the slice list under the row and folds it again, without opening the dialog', async () => {
    await mountPage(loose);
    expect([
        count('I_sample13').getAttribute('aria-expanded'),
        countAction(count('I_sample13')),
        list('I_sample13'),
    ]).toEqual(['false', 'Show slices', null]);
    await press(count('I_sample13'));
    expect([count('I_sample13').getAttribute('aria-expanded'), countAction(count('I_sample13'))]).toEqual([
        'true',
        'Hide slices',
    ]);
    // #145 is recorded active, but #140 still waits on #202, so it shows waiting.
    expect([...list('I_sample13')!.querySelectorAll('li')].map(text)).toEqual([
        '#144Owner table and sign-upDone',
        '#145Sign-in sessionsBlocked',
        '#146Owner settings pageQueued',
    ]);
    expect(dialog()).toBeNull();
    await settle(async () =>
        (await import('@/services/board/board.hooks')).useBoardStore
            .getState()
            .receive({ ...loose, fetchedAt: '2026-10-21T09:59:00.000Z' }),
    );
    expect(list('I_sample13'), 'new data keeps it open').not.toBeNull();
    await press(count('I_sample13'));
    expect(list('I_sample13')).toBeNull();
});

test.each(['Shaping', 'In progress', 'Review'] as const)(
    'the status tooltip follows the latest real thread at %s',
    async (status) => {
        const id = 'I_sample14';
        const data = withItem(id, { status, threads: [] });

        await mountPage(data);

        const activity = () => state(id).title;

        expect(activity()).toBe('Not started');

        const { useBoardStore } = await import('@/services/board/board.hooks');

        for (const [state, expected] of [
            ['running', 'Thread running'],
            ['stopped', 'Run stopped'],
            ['done', 'Run finished'],
            ['needs you', 'Thread needs you'],
        ] as const) {
            await settle(() =>
                useBoardStore.getState().receive(withItem(id, { status, threads: [thread('t1', state)] })),
            );

            if (status === 'Shaping' && state === 'needs you') {
                expect($(`.desk-card[data-item="${id}"]`)).not.toBeNull();
            } else expect(activity()).toBe(expected);
        }
        await settle(() => useBoardStore.getState().receive(withItem(id, { status, threads: 'unavailable' })));
        expect(activity()).toBe('Thread unavailable');
        await settle(() =>
            useBoardStore.getState().receive(
                withItem(id, {
                    status,
                    threads: [{ ...thread('t1', 'running'), observedAt: '2026-10-21T09:05:00.000Z' }],
                }),
            ),
        );
        expect(activity()).toMatch(/^Thread running, last seen \d\d:05$/);
    },
);

test('a stopped build replaces its remembered Started tag with recovery, also in the item dialog', async () => {
    const data = unblocked();

    holdPosts(data);
    await mountPage(data);
    await pressMenu(startBuild());
    await press(entries()[0]!);

    const started = { threadId: 'stopped-build', title: 'Build maddec01/lar-server#140' };

    await answer({ thread: started, error: null });

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive(
            withItem(
                'I_sample13',
                { threads: [thread('newer-shaping', 'stopped'), thread('stopped-build', 'stopped')] },
                {
                    ...data,
                    startedBuilds: { I_sample13: started },
                },
            ),
        ),
    );
    expect(text(side('I_sample13').querySelector('[data-start]'))).toBe('Start again');
    expect(side('I_sample13').querySelector('[data-start-result]')).toBeNull();
    expect(side('I_sample13').querySelector('[data-open-thread]')!.getAttribute('href')).toBe(
        't3code://threads/sample-environment/stopped-build',
    );
    await press(opener('I_sample13'));
    expect(text(dialog()!.querySelector('[data-slot="modal-footer"]'))).toContain('Start again');
    expect(
        dialog()!.querySelector('[data-open-thread][href$="/stopped-build"]'),
        'the recovery keeps its own thread',
    ).not.toBeNull();

    const again = side('I_sample13').querySelector<HTMLButtonElement>('[data-start]')!;

    expect(text(again)).toBe('Start again');
    expect(text(dialog()!.querySelector('[data-start]'))).toBe('Start again');
    await pressMenu(again);
    await press(entries()[0]!);
    expect(posted()).toHaveLength(2);
    expect(text(startBuild())).toBe('Starting…');
    await answer({
        thread: { threadId: 'new-build', title: 'Build again' },
        error: null,
        board: { ...data, startedBuilds: { I_sample13: { threadId: 'new-build', title: 'Build again' } } },
    });
    expect(text(side('I_sample13').querySelector('[data-start-result]'))).toBe('Started');
});

test('live slice transitions update the bar, expanded list and count without a reload', async () => {
    const initial = boardOf([build(3)]);

    await mountPage(initial);
    await press(count());

    const { useBoardStore } = await import('@/services/board/board.hooks');

    for (const progress of ['active', 'unknown', 'blocked', 'waiting', 'done'] as const) {
        const data = {
            ...initial,
            items: initial.items.map((item) => ({
                ...item,
                slices: item.slices.map((slice, index) => (index === 1 ? { ...slice, progress } : slice)),
            })),
        };

        await settle(() => useBoardStore.getState().receive(data));
        expect(text(list()!.querySelectorAll('li')[1]!)).toMatch(
            new RegExp(
                `#101Issue 101${progress === 'waiting' ? 'Queued' : progress === 'active' ? 'Working' : progress.charAt(0).toUpperCase() + progress.slice(1)}$`,
            ),
        );
        expect(countShown(count())).toBe(progress === 'done' ? '2/3 slices' : '1/3 slices');

        const segment = col('I_59', 'bar').querySelectorAll('ol > li')[1]!;

        expect(segment.querySelector('.lar-status-pulse') !== null).toBe(progress === 'active');

        if (progress === 'unknown') {
            expect(segment.getAttribute('data-state')).toBe('off');
            expect(text(list())).toContain('?');
            expect(text(col('I_59', 'next'))).toBe('');
        }
    }
});

test('usage with none known yet says it’s still trying after three seconds, keeps known figures, and says when T3 couldn’t read it', async () => {
    const id = 'I_sample13';
    const at = (change: Partial<Item>) =>
        withItem(
            id,
            { stats: undefined, usageState: undefined, threads: [thread('t1', 'done')], ...change },
            fresh(loose),
        );
    const receive = async (data: BoardData) =>
        settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(data));

    await mountPage(at({}));
    expect(text(row(id))).toContain('Loading usage');
    await settle(() => vi.advanceTimersByTime(3_000));
    expect(text(row(id))).toContain('Still trying…');
    expect(row(id).querySelector('[data-loader]')!.getAttribute('title')).toBe('Loading usage');
    await receive(at({ usageState: 'loading', stats: { agentMs: 120_000, tokens: 34_000 } }));
    expect(text(row(id)), 'known figures stay while usage loads').toContain('2m');
    expect(text(row(id))).not.toContain('Still trying…');
    await receive(at({ usageState: 'failed' }));
    expect(text(row(id))).toContain('Usage unavailable');
    expect(text(row(id))).not.toMatch(/Loading usage|Still trying/);
});

describe.each(['Verify', 'Ready to merge'] as const)('%s with its build thread running', (status) => {
    const threads = (build: ItemThread['state'], more: Partial<ItemThread> = {}): ItemThread[] => [
        thread('other', 'done'),
        { ...thread('build', build), purpose: 'build', ...more },
    ];
    const at = (t: ItemThread[], change: Partial<Item> = {}): BoardData =>
        withItem('I_sample13', { status, blockers: [], threads: t, ...change }, fresh(loose));
    const running = threads('running', { currentRunning: true });
    const receive = async (data: BoardData) =>
        settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(data));
    const desk = () => $('.desk-card[data-item="I_sample13"]');

    test('its row sits in Build as Working, with Open thread on the build thread, and leaves the desk', async () => {
        await mountPage(at(running));
        expect(desk()).toBeNull();
        expect(text(state('I_sample13'))).toBe('Working');

        const open = side('I_sample13').querySelector<HTMLAnchorElement>('[data-open-thread]')!;

        expect([open.getAttribute('aria-label'), open.getAttribute('href')]).toEqual([
            'Open thread',
            't3code://threads/sample-environment/build',
        ]);
    });

    test('it returns to the desk with its Status when the thread stops, with no write', async () => {
        await mountPage(at(running));
        await receive(at(threads('done'), { slices: [] }));
        expect(text(desk())).toContain('Review PR');
        expect(text(desk()!.querySelector('.desk-actions'))).toContain('Review PR');
        expect(sideAfterFigures('I_sample13'), 'the status stays in one place on the Build row').toBe('');
        expect(posted()).toEqual([]);
    });

    test('it returns to the desk at its Status while the page can’t read the board', async () => {
        await mountPage(at(running));
        expect(desk()).toBeNull();
        await settle(async () =>
            (await import('@/services/board/board.hooks')).useBoardStore.getState().fail('HTTP 502'),
        );
        expect(text(desk())).toContain('Review PR');
    });
});

describe('the activity line', () => {
    const at = (more: Partial<ItemThread> = {}, change: Partial<Item> = {}, data: BoardData = fresh(loose)) =>
        withItem(
            'I_sample13',
            {
                status: 'In progress',
                blockers: [],
                buildPhase: 'implement',
                slices: [{ number: 1, title: 'Startup responsiveness', progress: 'active' }] as Slice[],
                threads: [
                    {
                        ...thread('build', 'running'),
                        purpose: 'build',
                        currentRunning: true,
                        activity: acting('Edit stage-row.tsx', 3),
                        ...more,
                    },
                ],
                ...change,
            },
            data,
        );
    const line = () => row('I_sample13').querySelector<HTMLElement>('[data-activity]');
    const lineText = () => text(line()).replace(/\s+/g, ' ');
    const moving = () =>
        row('I_sample13').querySelector('.lar-status-pulse, .animate-spin, .lar-progress-indeterminate');
    const store = async () => (await import('@/services/board/board.hooks')).useBoardStore.getState();

    test('five minutes with no action reads Quiet, unless a tool still runs', async () => {
        await mountPage(at({ activity: acting('Read a.ts', 295) }));
        expect(text(state('I_sample13'))).toBe('Implementing');
        await settle(() => vi.advanceTimersByTime(5_000));
        expect(line()!.dataset.activity).toBe('quiet');
        expect(lineText(), 'with no second age').toBe('No action for 5m');
        expect(line()!.querySelector('[data-action]')!.className).toContain('text-fg');
        expect(line()!.querySelector('[data-action]')!.className).not.toContain('text-warning-fg');
        expect(line()!.querySelector('[data-mark]')!.className).toContain('border-warning-fg');
        expect(text(state('I_sample13'))).toBe('Idle');
        expect(moving(), 'a quiet thread is still at work').not.toBeNull();
        await settle(async () =>
            (await store()).receive(at({ activity: acting('pnpm test', 1800, { toolRunning: true }) })),
        );
        expect(text(state('I_sample13'))).toBe('Implementing');
        expect(lineText()).toContain('pnpm test');
    });

    test('a thread or agent waiting on the user has one status phrase and stops the row animating', async () => {
        const waiting = {
            state: 'needs you',
            currentRunning: undefined,
            updated: new Date(NOW - 180_000).toISOString(),
        } as const;

        await mountPage(at(waiting));
        expect(line()).toBeNull();
        expect(text(state('I_sample13'))).toBe('Needs you');
        expect(moving()).toBeNull();
        await settle(async () =>
            (await store()).receive(at({ ...waiting, state: 'done', hasLiveChildren: true, childNeedsYou: true })),
        );
        expect(text(state('I_sample13'))).toBe('Needs you');
        expect(moving()).toBeNull();
    });

    test('a row says activity is unavailable, never an old action, when T3 or the server can’t be read', async () => {
        const unavailable = () => expect(line()).toBeNull();

        await mountPage(at({ activity: { available: false } }));
        unavailable();
        await settle(async () => (await store()).receive(at({ observedAt: new Date(NOW).toISOString() })));
        unavailable();
        await settle(async () => (await store()).receive(at({}, { threads: 'unavailable' })));
        unavailable();
        await settle(async () => (await store()).receive(at()));
        expect(lineText()).toContain('Edit stage-row.tsx');
        await settle(async () => (await store()).fail('Disconnected'));
        unavailable();
    });

    test('a T3 read that goes old with no error says unavailable on its own: the line, the state column, the motion, then back', async () => {
        const { ACTIVITY_STALE_MS } = await import('@lar-factory/shared');

        await mountPage(at());
        expect(text(state('I_sample13'))).toBe('Implementing');
        expect(moving()).not.toBeNull();
        // The system time alone moves, as the page's poll would bring the sample back.
        vi.setSystemTime(NOW + ACTIVITY_STALE_MS - 1_000);
        await settle(() => vi.advanceTimersByTime(1_000));
        expect(line()!.dataset.activity, 'still within the limit').toBe('working');
        await settle(() => vi.advanceTimersByTime(1_000));
        expect(line()).toBeNull();
        expect((await store()).data.error).toBeNull();
        expect(text(state('I_sample13')), 'no phase reads as current').toBe('Activity unavailable');
        expect(moving()).toBeNull();
        expect(row('I_sample13').querySelector('.lar-status-spin'), 'its glyph stops too').toBeNull();
        await settle(async () =>
            (await store()).receive(
                at({
                    activity: { ...acting('Grep', 1), readAt: new Date(Date.now()).toISOString() } as ThreadActivity,
                }),
            ),
        );
        expect(line()!.dataset.activity).toBe('working');
        expect(text(state('I_sample13'))).toBe('Implementing');
    });
});

test('Build and its row animate for current execution, stop together, and shaping alone never spins Build', async () => {
    const build: ItemThread = { ...thread('build', 'running'), purpose: 'build', currentRunning: true };
    const idle = { ...fresh(), items: sample.items.map((item) => ({ ...item, slices: [], threads: [] })) };
    const data = withItem('I_sample14', { slices: [], threads: [build] }, idle);
    const buildGlyph = () => $('[data-stage="build"] header svg')!;
    const rowGlyph = () => row('I_sample14').querySelector('[data-glyph] svg')!;

    await mountPage(data);
    expect(buildGlyph().classList.contains('lucide-loader-circle')).toBe(true);
    expect(rowGlyph().closest('.lar-status-spin')).not.toBeNull();

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const stopped = withItem(
        'I_sample14',
        { slices: [], threads: [{ ...build, state: 'done', currentRunning: undefined }] },
        idle,
    );

    await settle(() => useBoardStore.getState().receive(stopped));
    expect(buildGlyph().classList.contains('lucide-circle')).toBe(true);
    expect(rowGlyph().classList.contains('lucide-circle')).toBe(true);
    await settle(() =>
        useBoardStore
            .getState()
            .receive(withItem('I_sample02', { status: 'Shaping', threads: [{ ...build, purpose: 'shape' }] }, stopped)),
    );
    expect(buildGlyph().classList.contains('lucide-circle')).toBe(true);
    expect(row('I_sample02').querySelector('[data-glyph] .lar-status-pulse')).not.toBeNull();
    expect($('[data-stage="shaping"] header .lar-status-pulse')).toBeNull();
    expect($('[data-stage="ready"] header svg.lucide-circle-arrow-right')).not.toBeNull();
});

test('status icons require current execution and suppress unavailable, cached, held and starting work', async () => {
    const build: ItemThread = { ...thread('build', 'running'), purpose: 'build', currentRunning: true };
    const idle = { ...fresh(), items: sample.items.map((item) => ({ ...item, threads: [], slices: [] })) };
    const data = withItem(
        'I_sample14',
        { threads: [build] },
        withItem('I_sample02', { status: 'Shaping', threads: [{ ...build, purpose: 'shape' }] }, idle),
    );

    await mountPage(data);

    const { useBoardStore } = await import('@/services/board/board.hooks');
    const motion = () => $$('[data-stage] [data-glyph] .lar-status-spin, [data-stage] [data-glyph] .lar-status-pulse');

    expect(motion()).toHaveLength(2);

    const cases: [string, BoardData][] = [
        ['stale', { ...data, fetchedAt: '2020-01-01T00:00:00Z' }],
        ['failed read', { ...data, error: 'Read failed' }],
        ['first read', { ...data, firstRead: { ...data.firstRead, settled: false, ready: true } }],
        ['T3 unavailable', { ...data, t3Availability: { availability: 'unavailable' } }],
        ['T3 not running', { ...data, tools: { t3: { result: 'not-running' } } }],
        ['cached T3 read', { ...data, t3Availability: { availability: 'available', observedAt: build.updated } }],
        ['local read failure', { ...data, localProblem: 'Local records unavailable' }],
        ...(['paused', 'archived', 'needsYou', 'threads'] as const).map(
            (key) =>
                [
                    key,
                    {
                        ...data,
                        items: data.items.map((item) => ({
                            ...item,
                            ...(key === 'paused'
                                ? { paused: 'Settings changed' }
                                : key === 'archived'
                                  ? { archived: { setAside: true, hidden: false, ticketOpen: true } }
                                  : key === 'needsYou'
                                    ? { needsYou: { reason: 'Help', offers: [], causes: [], ticketOpen: true } }
                                    : { threads: 'unavailable' as const }),
                        })),
                    },
                ] as [string, BoardData],
        ),
        ...(['starting', 'may-have-started'] as const).map(
            (phase) =>
                [
                    phase,
                    {
                        ...data,
                        startProgress: {
                            I_sample14: { build: phase === 'starting' ? { phase } : { phase, message: 'Check T3' } },
                            I_sample02: { shape: phase === 'starting' ? { phase } : { phase, message: 'Check T3' } },
                        },
                    },
                ] as [string, BoardData],
        ),
    ];

    for (const [label, next] of cases) {
        await settle(() => useBoardStore.getState().receive(next));
        expect(motion(), `after ${label}`).toHaveLength(0);
        expect($('[data-stage="build"] header .lar-status-spin'), `after ${label}`).toBeNull();
        expect(
            $$('[data-slot=toolbar-counter]')
                .find((counter) => counter.textContent!.startsWith('building:'))!
                .querySelector('.lar-status-spin'),
            `after ${label}`,
        ).toBeNull();
    }
    await settle(() => useBoardStore.getState().receive(data));
    await settle(() => useBoardStore.getState().fail('Disconnected'));
    expect(motion(), 'client read failed').toHaveLength(0);
    await settle(() => useBoardStore.getState().receive(data));

    const { useStartStore } = await import('@/features/items/StartStore');

    await settle(() => {
        useStartStore.getState().set('I_sample14', { phase: 'pending' }, 'build');
        useStartStore.getState().set('I_sample02', { phase: 'pending' }, 'refine');
    });
    expect(motion(), 'local launches still pending').toHaveLength(0);
    await settle(() => {
        useStartStore.getState().set('I_sample14', undefined, 'build');
        useStartStore.getState().set('I_sample02', undefined, 'refine');
    });
    for (const evidence of [
        { state: 'running' as const, currentRunning: undefined },
        { state: 'done' as const, currentRunning: undefined, queued: true as const, hasLiveChildren: true as const },
        { observedAt: build.updated, hasRunningChildren: true as const },
    ]) {
        await settle(() =>
            useBoardStore.getState().receive(
                withItem(
                    'I_sample14',
                    { threads: [{ ...build, ...evidence }] },
                    withItem(
                        'I_sample02',
                        {
                            status: 'Shaping',
                            threads: [{ ...build, purpose: 'shape', ...evidence }],
                        },
                        idle,
                    ),
                ),
            ),
        );
        expect(motion(), `evidence ${JSON.stringify(evidence)}`).toHaveLength(0);
    }
});
