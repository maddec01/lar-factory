// The Shaping, Ready to build and Build sections: their rows from the placement rule and each row's side action.

import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import {
    $,
    $$,
    answer,
    fresh,
    holdPosts,
    mountPage,
    posted,
    pressMenu,
    sample,
    settle,
    text,
    toast,
} from '@/test/PageTest';

const row = (id: string) =>
    $(`:is([data-stage="shaping"], [data-stage="ready"], [data-stage="build"]) li[data-item="${id}"]`)!;
const opener = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-row-open]')!;
const numberOf = (id: string) => sample.items.find((i) => i.id === id)!.number;
const col = (id: string, name: string) => row(id).querySelector<HTMLElement>(`[data-col="${name}"]`)!;
const side = (id: string) => col(id, 'side')!;
/** A row's facts on its one line: what holds it or its thread does, its progress, then its end. */
const meta = (id: string) => row(id).querySelector<HTMLElement>('[data-row-meta]')!;
const startBuild = (id = 'I_sample13') => $<HTMLButtonElement>(`[data-start="${id}"]`)!;
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) =>
    settle(() => {
        (el as HTMLElement).click();
        vi.advanceTimersByTime(0);
    });
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
const withItem = (id: string, change: Partial<Item>, data: BoardData = sample): BoardData => ({
    ...data,
    items: data.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
});
/** The sample with #140 out of its concept's dossier, so it has a row in the table. */
const loose = withItem('I_sample13', { parent: null, parentId: null, flow: 'single', status: 'Review' });
/** #140 with its blocker closed, so its Start build runs, on a board whose writes are on. */
const unblocked = (data: BoardData = loose): BoardData =>
    withItem(
        'I_sample13',
        {
            status: 'Ready',
            blockers: [{ number: 202, repo: 'acme/api', state: 'closed' }],
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

beforeEach(() => localStorage.clear());

const inPane = (pane: string) => $$(`[data-stage="${pane}"] li[data-item]`).map((r) => numberOf(r.dataset.item!));
const readyRows = () => $$('[data-stage="ready"] li[data-item]').map((r) => numberOf(r.dataset.item!));

test('each stage section sits in its own box, and empty ones keep their empty marker in stage order', async () => {
    const ready = unblocked();

    await mountPage({ ...ready, items: ready.items.filter((i) => i.id === 'I_sample13') });

    const sections = $$('[aria-label="Work by stage"] [data-stage]');

    expect(sections.map((s) => s.dataset.stage)).toEqual(['queue', 'shaping', 'ready', 'build']);
    expect(sections.every((s) => s.classList.contains('stage-box'))).toBe(true);
    expect(sections.filter((s) => s.hasAttribute('data-empty')).map((s) => s.dataset.stage)).toEqual([
        'queue',
        'shaping',
        'build',
    ]);
});

test('a live board push moves a row between sections with no reload', async () => {
    await mountPage(withItem('I_sample13', { blockers: [], parentId: null, flow: 'single' }));
    expect(readyRows()).toContain(140);
    await settle(async () =>
        (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(
            withItem('I_sample13', {
                blockers: [],
                parentId: null,
                flow: 'single',
                status: 'In progress',
                statuses: ['In progress'],
            }),
        ),
    );
    expect(readyRows()).not.toContain(140);
    expect(inPane('build')).toContain(140);
});

test('a blocked Ready row offers no Build and says what it starts after; its dialog’s Start after arms the start on the picked model, then reads Starts after until pressed again', async () => {
    const blocked = {
        ...withItem('I_sample13', { status: 'Ready' }, loose),
        capture: { session: 's1', enabled: true },
        modelChoices: unblocked().modelChoices,
    };

    holdPosts(blocked);
    await mountPage(blocked);
    expect(
        side('I_sample13').querySelector('[data-start], [data-start-after]'),
        'a held build starts on its own; its row has nothing to press',
    ).toBeNull();
    expect(text(meta('I_sample13').querySelector('[data-blocked]'))).toBe('Blocked · starts after #202');
    await press(opener('I_sample13'));

    const after = () => dialog()!.querySelector<HTMLButtonElement>('[data-start-after]')!;

    await pressMenu(after());
    await press(entries()[1]!);
    expect(posted()).toEqual([
        ['/api/arm', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }],
    ]);
    await answer({
        error: null,
        board: { ...blocked, armed: { I_sample13: { model: { instanceId: 'codex', model: 'gpt-5.5' } } } },
    });
    expect([text(after()), after().getAttribute('aria-pressed')]).toEqual(['Starts after #202 ✓', 'true']);
    expect(after().title).toBe('Starts by itself once #202 completes. Pressing it again disarms it');
    await press(after());
    expect(posted().at(-1)).toEqual(['/api/disarm', { session: 's1', itemId: 'I_sample13' }]);
    await answer({ error: null, board: { ...blocked, armed: {} } });
    expect(text(after()), 'the row already says what blocks it').toBe('Start after #202');
    expect(after().title, 'nothing starts by itself until it is armed').toBe(
        'Pick a model to start it once #202 completes',
    );
});

test('Start build sends the build with the chosen model, then shows the thread it started in a tag and a toast', async () => {
    holdPosts(unblocked());
    await mountPage(unblocked());
    await pressMenu($('[data-start-model="I_sample13"]')!);
    expect(dialog(), 'the menu opens without the dialog').toBeNull();
    expect(entries().map(text)).toEqual(['Project default in T3', 'GPT-5.5']);
    await press(entries()[1]!);
    expect(dialog(), 'picking an entry doesn’t open the dialog').toBeNull();
    expect(posted()).toEqual([
        ['/api/start-build', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }],
    ]);
    expect([text(startBuild()), startBuild().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);

    const started = { threadId: 'thread-1', title: 'Build acme/api#140' };

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

test('a stopped build replaces its remembered Started tag with recovery, also in the item dialog', async () => {
    const data = unblocked();

    holdPosts(data);
    await mountPage(data);
    await press(startBuild());

    const started = { threadId: 'stopped-build', title: 'Build acme/api#140' };

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
    await press(again);
    expect(posted()).toHaveLength(2);
    expect(text(startBuild())).toBe('Starting…');
    await answer({
        thread: { threadId: 'new-build', title: 'Build again' },
        error: null,
        board: { ...data, startedBuilds: { I_sample13: { threadId: 'new-build', title: 'Build again' } } },
    });
    expect(text(side('I_sample13').querySelector('[data-start-result]'))).toBe('Started');
});

test('Verify: its running row returns to the desk when the thread stops or the board disconnects', async () => {
    const threads = (build: ItemThread['state'], more: Partial<ItemThread> = {}): ItemThread[] => [
        thread('other', 'done'),
        { ...thread('build', build), purpose: 'build', ...more },
    ];
    const at = (t: ItemThread[], change: Partial<Item> = {}): BoardData =>
        withItem('I_sample13', { status: 'Verify', blockers: [], threads: t, ...change }, fresh(loose));
    const running = threads('running', { currentRunning: true });
    const receive = async (data: BoardData) =>
        settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(data));
    const desk = () => $('.desk-row[data-item="I_sample13"]');

    await mountPage(at(running));
    expect(desk()).toBeNull();
    // Its state leads the row's facts.
    expect(text(meta('I_sample13'))).toMatch(/^Working/);

    const open = side('I_sample13').querySelector<HTMLAnchorElement>('[data-open-thread]')!;

    expect([text(open), open.getAttribute('href')]).toEqual([
        'Open thread',
        't3code://threads/sample-environment/build',
    ]);

    // Legacy Verify also opens the single PR review action on the desk.
    const wait = 'Review PR';

    await receive(at(threads('done'), { slices: [] }));
    expect(text(desk())).toContain(wait);
    expect(text(desk()!.querySelector('[data-col="side"]'))).toContain(wait);
    expect(text(side('I_sample13')), 'the status stays in one place on the Build row').toBe('');
    expect(posted()).toEqual([]);
    await receive(at(running));
    expect(desk()).toBeNull();
    await settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().fail('HTTP 502'));
    expect(text(desk())).toContain(wait);
    expect(posted()).toEqual([]);
});

test('an idle unfinished build with an open PR shows as waiting on its PR, in its row and its details', async () => {
    const pr = sample.items.find((i) => i.id === 'I_sample14')!.linkedPrs;
    const idle: ItemThread = { ...thread('build', 'done'), purpose: 'build' };

    await mountPage(
        fresh(
            withItem('I_sample13', {
                parent: null,
                parentId: null,
                flow: 'single',
                status: 'In progress',
                buildPhase: 'Checks',
                linkedPrs: pr,
                slices: [],
                blockers: [],
                threads: [idle],
            }),
        ),
    );

    expect(text(meta('I_sample13'))).toContain('Waiting on its PR');
    expect(text(meta('I_sample13'))).not.toContain('Activity unavailable');

    await press(opener('I_sample13'));
    expect(text(dialog())).toContain('Waiting on its PR');
});

test('a brief gate leads the shaping row while its owner finishes a command', async () => {
    const now = '2026-10-21T10:00:00.000Z';
    const data = fresh(
        withItem('I_sample13', {
            parentId: null,
            parent: null,
            flow: 'single',
            status: 'Shaping',
            slices: [],
            blockers: [],
            linkedPrs: [],
            briefApproval: { reason: 'Review the brief.', digest: 'brief' },
            passingBrief: false,
            threads: [
                {
                    ...thread('shape', 'running'),
                    purpose: 'shape',
                    currentRunning: true,
                    updated: now,
                    activity: {
                        available: true,
                        readAt: now,
                        action: 'Running a command',
                        actionAt: now,
                        toolRunning: true,
                        agents: [],
                    },
                },
            ],
        }),
    );

    await mountPage(data);
    expect(text($('.desk-row[data-item="I_sample13"]'))).toContain('Approve brief');
    expect(text(meta('I_sample13'))).toMatch(/^Approve brief/);
    expect(text(meta('I_sample13'))).not.toContain('Running a command');
});

test('a PR row and its desk review wait change together when the owner hands back', async () => {
    const pr = sample.items
        .find((i) => i.id === 'I_sample14')!
        .linkedPrs.map((pr) => ({
            ...pr,
            state: 'open' as const,
            checks: null,
            mergeState: 'checking' as const,
            pipelineUnread: true as const,
        }));
    const at = (running: boolean) =>
        fresh(
            withItem('I_sample13', {
                parentId: null,
                parent: null,
                flow: 'single',
                status: 'Ready to merge',
                slices: [],
                blockers: [],
                linkedPrs: pr,
                threads: [
                    {
                        ...thread('build', running ? 'running' : 'done'),
                        purpose: 'build',
                        ...(running && { currentRunning: true }),
                    },
                ],
            }),
        );

    await mountPage(at(true));
    expect($('.desk-row[data-item="I_sample13"]')).toBeNull();
    expect(text(meta('I_sample13'))).not.toContain('Review PR');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(at(false)));
    expect(text($('.desk-row[data-item="I_sample13"]'))).toContain('Review PR');
    expect(text(meta('I_sample13'))).toContain('Review PR');
});

test('an approved shaping owner keeps Publishing Spec until Build is available, including its resumed run', async () => {
    const now = '2026-10-21T10:00:00.000Z';
    const item = {
        ...sample.items.find((item) => item.id === 'I_sample13')!,
        parentId: null,
        parent: null,
        flow: 'single' as const,
        status: 'Shaping' as const,
        passingBrief: true,
        briefApproval: undefined,
        briefReviewing: undefined,
        needsYou: undefined,
        blockers: [],
        buildStarted: undefined,
        slices: [],
        threads: [
            {
                id: 'shape',
                title: 'Shape',
                purpose: 'shape',
                state: 'running' as const,
                updated: now,
                currentRunning: true as const,
                activity: { available: true as const, readAt: now, agents: [], toolRunning: false },
            },
        ],
    } satisfies Item;
    const board = fresh({ ...sample, items: [item], startProgress: { [item.id]: { shape: { phase: 'starting' } } } });

    await mountPage(board);
    expect(text(meta(item.id))).toContain('Publishing Spec…');
    expect(text(meta(item.id))).not.toMatch(/Starting|Working/);

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore.getState().receive({
            ...board,
            startProgress: {},
            items: [
                {
                    ...item,
                    status: 'Ready',
                    threads: [{ ...item.threads[0]!, state: 'done', currentRunning: undefined, activity: undefined }],
                },
            ],
        }),
    );
    expect(text(row(item.id))).not.toContain('Publishing Spec');
    expect(text(startBuild(item.id))).toBe('Build');
});

test.each([
    [{ required: 'green', handlingFeedback: true }, 'Fixing review feedback'],
    [{ required: 'failed', handlingFeedback: true }, 'Fixing review feedback'],
    [{ required: 'pending', handlingFeedback: true }, 'Fixing review feedback'],
] as const)('PR intent leads an active row, with the command action in its tooltip: %s', async (review, label) => {
    const now = '2026-10-21T10:00:00.000Z';
    const pr = sample.items.find((i) => i.id === 'I_sample14')!.linkedPrs[0]!;

    await mountPage(
        fresh(
            withItem(
                'I_sample13',
                {
                    parent: null,
                    parentId: null,
                    flow: 'single',
                    status: 'Review',
                    blockers: [],
                    slices: [],
                    verification: {
                        required: false,
                        invalidated: false,
                        prReview: true,
                        prReviewHandedBack: false,
                        head: null,
                        latest: null,
                        resume: null,
                    },
                    linkedPrs: [{ ...pr, state: 'open', isDraft: false, review }],
                    threads: [
                        {
                            id: 'owner',
                            title: 'Build',
                            purpose: 'build',
                            state: 'running',
                            updated: now,
                            currentRunning: true,
                            activity: {
                                available: true,
                                readAt: now,
                                action: 'Running a command',
                                actionAt: now,
                                toolRunning: true,
                                agents: [],
                            },
                        },
                    ],
                },
                loose,
            ),
        ),
    );
    expect(text(meta('I_sample13'))).toMatch(new RegExp(`^${label}`));
    expect(text(row('I_sample13'))).not.toContain('Running a command');
    expect(meta('I_sample13').querySelector('[title*="Running a command"]')).not.toBeNull();
    expect(text(meta('I_sample13'))).not.toContain('Running a command');
    expect($('.desk-row[data-item="I_sample13"]')).toBeNull();
});

test('while a review round runs, its reviewers take the row’s progress and unfold under it as slices do', async () => {
    await mountPage(
        fresh(
            withItem('I_sample13', {
                parent: null,
                parentId: null,
                flow: 'single',
                status: 'Review',
                linkedPrs: [],
                blockers: [],
                reviewers: [
                    { id: 'code', name: 'Code', status: 'Running' },
                    { id: 'security', name: 'Security', status: 'Changes requested' },
                ],
            }),
        ),
    );

    expect(text(col('I_sample13', 'progress'))).toContain('1/2 reviews');

    await press(row('I_sample13').querySelector('[data-col="progress"] button')!);
    expect(text(row('I_sample13').querySelector('[data-slices]'))).toBe(
        'Code reviewRunningSecurity reviewChanges requested',
    );
});

test('a build fixing a failed Verify says so in its state cell, with Verify’s note in its tooltip, on one line', async () => {
    const note = 'Greeting shows the old name';

    await mountPage(
        fresh(
            withItem('I_sample13', {
                parent: null,
                parentId: null,
                flow: 'single',
                status: 'In progress',
                blockers: [],
                verification: {
                    required: true,
                    head: 'b2',
                    latest: {
                        id: 'v1',
                        pr: '#40',
                        head: 'b1',
                        result: 'fail',
                        by: 'User',
                        at: '',
                        note,
                        testSteps: '',
                    },
                    resume: null,
                },
            }),
        ),
    );

    const state = meta('I_sample13').querySelector<HTMLElement>('[title*="Failed Verify"]');

    expect(state?.title).toContain(note);
    expect(text(row('I_sample13'))).not.toContain(note);
});
