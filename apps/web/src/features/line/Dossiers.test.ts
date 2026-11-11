// The dock's dossiers: each started concept, and each open item with sub-issues on the board: its one line, and expanded
// under it, what keeps the work moving and its parts as a Work map or a list. Ports the old Board view's
// concept block tests.

import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

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
    sample,
    settle,
    text,
} from '@/test/PageTest';

const C200 = 'I_sample09';
const C180 = 'I_sample23';
const dossier = (id = C200) => $(`[data-dossier="${id}"]`)!;
const header = (id = C200) => dossier(id).querySelector<HTMLElement>('[data-item]')!;
const line = (id = C200) => header(id).querySelector<HTMLElement>('[data-line="1"]')!;
/** The row's "what's next": the part that waits on you, the first part that can start, or the fallback. */
const next = (id = C200) => header(id).querySelector<HTMLElement>('[data-next]')!;
const chips = (id = C200) => [...header(id).querySelectorAll('[data-chip]')].map(text);
const opener = (id = C200) => header(id).querySelector<HTMLButtonElement>('[data-dossier-open]')!;
const VIEW_KEY = 'lar-board:dossier-view:';
const step = (id: string, d = C200) => dossier(d).querySelector<HTMLElement>(`[data-part="${id}"]`)!;
const startIn = (el: Element) => el.querySelector<HTMLButtonElement>('[data-start]');
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) =>
    settle(() => {
        (el as HTMLElement).click();
        vi.advanceTimersByTime(0);
    });
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialogTitle = () => text($('[data-item-dialog] [data-slot="modal-header"] h2'));
/** The button named `label`, by its text or, for an icon button, its accessible name. */
const button = (within: Element, label: string) =>
    [...within.querySelectorAll<HTMLButtonElement>('button')].find(
        (b) => text(b) === label || b.getAttribute('aria-label') === label,
    )!;
const withItem = (id: string, change: Partial<Item>, data: BoardData = sample): BoardData => ({
    ...data,
    items: data.items.map((i) => (i.id === id ? { ...i, ...change } : i)),
});
const writable = (data: BoardData = sample): BoardData => ({
    ...data,
    capture: { session: 's1', enabled: true },
    modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }],
});
/** #140 with its blocker #202 closed, on a board whose writes are on. */
const unblocked = () =>
    writable(withItem('I_sample13', { blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }] }));
const c200 = sample.items.find((i) => i.id === C200)!;
/** A Queued grill under #200, blocked by `blockers`. */
const decision = (blockers: Item['blockers'] = []): Item => ({
    ...sample.items.find((i) => i.id === 'I_sample05')!,
    id: 'I_d204',
    number: 204,
    title: 'Pick the relay host',
    labels: ['decision-grill'],
    repo: c200.repo,
    parent: { number: 200, repo: c200.repo!, title: c200.title, url: c200.url!, state: 'open' },
    parentId: c200.id,
    blockers,
});
const withDecision = (blockers?: Item['blockers']) =>
    writable({ ...sample, items: [...sample.items, decision(blockers)] });
const receive = (data: BoardData) =>
    settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(data));
const thread = (id: string, state: ItemThread['state']): ItemThread => ({
    id,
    title: `Thread ${id}`,
    state,
    updated: '2026-10-21T09:00:00.000Z',
});
/** An open pull request whose checks passed and that can merge: evidence that keeps a part's recorded Verify or
 *  Ready to merge stage, where a part with no pull request reads Review PR. */
const cleanPrs: Item['linkedPrs'] = [
    {
        number: 150,
        url: 'https://github.com/maddec01/lar-server/pull/150',
        state: 'open',
        isDraft: false,
        checks: { passed: 3, failed: 0, running: 0, total: 3, since: '2026-10-21T08:30:00Z' },
        mergeState: 'can merge',
    },
];

/** Every sample dossier opens on its parts list here, so the tests of a dossier's body see it; the Work map tests clear this. */
beforeEach(() => {
    localStorage.clear();
    for (const id of [C200, C180, 'I_100', 'I_700']) localStorage.setItem(VIEW_KEY + id, 'list');
});

/** Dossier `id`'s body while it is expanded. */
const body = (id = C200) => dossier(id).querySelector<HTMLElement>('[data-dossier-body]');
/** The page with dossier `id` expanded, which the browser may remember from before a reload. */
const mountOpen = async (data: BoardData = sample, id = C200) => {
    await mountPage(data);

    if (!body(id)) await press(opener(id));
};
/** Dossier `id` expanded too. */
const openInstead = (id: string) => press(opener(id));

const SECTIONS = ['queue', 'shaping', 'ready', 'build', 'dock'];
const panes = () => SECTIONS.filter((id) => $(`[data-stage="${id}"]`));

test('a grouped child stays out of the desk when Projects shows its repository without its parent', async () => {
    localStorage.setItem('lar-board:scope', 'maddec01/lar-apple');

    const data = withItem('I_sample13', {
        repo: 'maddec01/lar-apple',
        status: 'Verify',
        linkedPrs: cleanPrs,
        threads: [],
        slices: [],
    });

    await mountOpen(data);
    expect(step('I_sample13')).not.toBeNull();
    expect($('.desk-card[data-item="I_sample13"]')).toBeNull();
    expect(text(step('I_sample13'))).toContain('Open item details');
});

test('live status changes keep linked work in its group with details, thread and PR links', async () => {
    const data = withItem('I_sample13', { blockers: [], threads: [], slices: [], linkedPrs: cleanPrs });

    await mountOpen(data);
    for (const status of [
        'Queued',
        'Shaping',
        'Ready',
        'In progress',
        'Review',
        'Verify',
        'Ready to merge',
        'Needs you',
    ] as const) {
        await receive(withItem('I_sample13', { status }, data));
        expect(step('I_sample13')).not.toBeNull();
        expect($(`[data-stage]:not([data-stage="dock"]) [data-item="I_sample13"]`)).toBeNull();
        expect($('.desk-card[data-item="I_sample13"]')).toBeNull();
        expect($('[data-stage="shaping"] [data-item="I_sample09"]')).toBeNull();
    }
    await press(button(step('I_sample13'), 'Open item details'));
    expect(dialogTitle()).toContain('Owner accounts');
    expect($('[data-item-dialog] [data-open-thread]')).not.toBeNull();
    expect($('[data-item-dialog] a[href="https://github.com/maddec01/lar-server/pull/150"]')).not.toBeNull();
});

test('the chevron is a real button that says whether the row is expanded, and focus stays on it as the row collapses', async () => {
    await mountPage();

    const chevron = opener();

    expect([chevron.tagName, chevron.getAttribute('aria-expanded'), chevron.getAttribute('aria-label')]).toEqual([
        'BUTTON',
        'false',
        'Expand #200 lar cloud: sign-in and direct connections',
    ]);
    chevron.focus();
    await clickWith(chevron, 0);
    expect([chevron.getAttribute('aria-expanded'), chevron.getAttribute('aria-label'), body() !== null]).toEqual([
        'true',
        'Collapse #200 lar cloud: sign-in and direct connections',
        true,
    ]);
    await clickWith(chevron, 0);
    expect([chevron.getAttribute('aria-expanded'), body(), document.activeElement, opener()]).toEqual([
        'false',
        null,
        chevron,
        chevron,
    ]);
});

test('each dossier expands on its own, and the browser remembers it across a reload', async () => {
    await mountPage();
    await press(opener());
    await press(opener(C180));
    expect([body() !== null, body(C180) !== null]).toEqual([true, true]);
    await press(opener());
    expect([body(), body(C180) !== null]).toEqual([null, true]);
    vi.resetModules();
    await mountPage();
    expect([body(), body(C180) !== null]).toEqual([null, true]);
});

test('a board push updates an expanded dossier in place, and one that leaves the board comes back as it was', async () => {
    await mountOpen();
    await receive(withItem('I_sample10', { title: 'Relay, renamed' }));
    expect([text(step('I_sample10')).includes('Relay, renamed'), panes()]).toEqual([true, SECTIONS]);
    await receive({ ...sample, items: sample.items.filter((i) => i.id !== C200 && i.parentId !== C200) });
    expect($(`[data-dossier="${C200}"]`)).toBeNull();
    await receive(sample);
    expect(body()).not.toBeNull();
});

test('a filter hides an expanded dossier with its row, and it is still expanded once the filter lets it back', async () => {
    localStorage.setItem('lar-board:filters:board', JSON.stringify({ kinds: [c200.kind], labels: [] }));
    await mountOpen();
    await receive(withItem(C200, { kind: 'bug', status: 'Shaping' }));
    expect($(`[data-dossier="${C200}"]`)).toBeNull();
    await receive(sample);
    expect(body()).not.toBeNull();
});

/** A pointer click (`detail` 1) or a key press's click (`detail` 0) on `el`. */
const clickWith = (el: Element, detail: number) =>
    settle(() => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
    });
/** Selects the text of `el`. */
const select = (el: Element) => {
    const range = document.createRange();

    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
};

test('only the title opens the item; anywhere else on the row but its controls toggles the dossier', async () => {
    await mountPage();
    for (const part of [line, (id?: string) => header(id).querySelector<HTMLElement>('[data-col="bar"]')!, next]) {
        await press(part());
        expect(body()).not.toBeNull();
        expect(dialogTitle()).toBe('');
        await press(part());
        expect(body()).toBeNull();
    }
});

test('letting go of a drag that selected text in the row leaves it as it was; a selection elsewhere or a key press still toggles it', async () => {
    await mountPage();
    select(header());
    await clickWith(header(), 1);
    expect(body()).toBeNull();
    await clickWith(opener(), 0);
    expect(body(), 'Enter or Space on the row’s button, with text selected in it').not.toBeNull();
    await press(opener());
    select(header(C180));
    await clickWith(header(), 1);
    expect(body(), 'a click, with text selected in another row').not.toBeNull();
    window.getSelection()!.removeAllRanges();
});

const refined = {
    refinement: { complete: true, reasons: [] },
    completion: { complete: false, reasons: ['No delivery planned.'] },
};
const more = (id = C200) => header(id).querySelector('[data-chips-more]');
/** C200 with nothing that asks for the user's action and no fog left: no part in Needs you and no open decision. */
const calm = (over: Partial<Item>) => ({
    ...sample,
    items: sample.items
        .filter((i) => i.kind !== 'decision' && i.status !== 'Needs you')
        .map((i) => (i.id === C200 ? { ...i, map: i.map && { ...i.map, fog: [] }, ...over } : i)),
});

test('the row shows one chip by priority: what asks for action over Refined, Refined over fog, and the rest count in its tooltip', async () => {
    const words = (id = C200) => header(id).getAttribute('title');

    await mountPage(withItem(C200, refined));
    expect(chips(), 'a part in Needs you over open decisions and Refined').toEqual(['1 needs you']);
    expect(header().querySelector('[data-refined]')).toBeNull();
    expect(text(more()!.querySelector('[aria-hidden]'))).toBe('+4');
    expect(text(more()!.querySelector('.sr-only')), 'the rest read to a screen reader').toBe(
        '2 decisions, Refined, no delivery planned, 2 open questions',
    );
    expect(words()).toContain('1 needs you · 2 decisions · Refined · no delivery planned · 2 open questions');

    const title = next().querySelector('[title]')!;

    expect(
        [title.getAttribute('title'), title.className.split(' ').includes('truncate')],
        'the next step cuts off, with its full text in its tooltip',
    ).toEqual(['#202 Sign-in screen', true]);
    await receive(withItem('I_sample12', { status: 'Verify' }, withItem(C200, refined)));
    expect(chips(), 'an open decision over Refined').toEqual(['2 decisions']);
    await receive(calm({ ...refined, map: { ...c200.map!, fog: ['An open question.'] } }));
    expect(chips(), 'Refined over fog').toEqual(['Refined']);
    expect(words()).toContain('Refined · no delivery planned · 1 open question');
    await receive(calm({ refinement: undefined, map: { ...c200.map!, fog: ['An open question.'] } }));
    expect(chips(), 'fog with nothing above it').toEqual(['1 open question']);
    expect(more(), 'nothing more to count').toBeNull();
    await receive(calm({ refinement: undefined }));
    expect(header().querySelector('[data-chips]'), 'no chips, no room').toBeNull();
});

test('a settled decision counts as done in its part bar, whatever its Status says', async () => {
    const settledDecision: Partial<Item> = {
        recorded: true,
        kind: 'decision',
        labels: [],
        status: 'Shaping',
        completion: { complete: true, reasons: [] },
        threads: undefined,
    };
    const pending: Partial<Item> = { ...settledDecision, completion: { complete: false, reasons: ['No answer.'] } };
    const parts = [
        { ...sample.items.find((i) => i.id === 'I_sample10')!, ...settledDecision },
        { ...sample.items.find((i) => i.id === 'I_sample12')!, ...pending },
    ];

    await mountPage({ ...sample, items: [{ ...c200, subIssues: { total: 2, completed: 0 } }, ...parts] });
    expect(text(col('count'))).toBe('1/2 parts');

    const bar = [...col('bar').querySelectorAll<HTMLElement>('[data-part-bar] li')];

    expect(
        bar.map((li) => [
            li.getAttribute('aria-label'),
            li.querySelector<HTMLElement>('span')?.style.background === 'var(--color-board-done)',
        ]),
    ).toEqual([
        [expect.stringContaining('Complete'), true],
        [expect.stringContaining('Shaping'), false],
    ]);
});

test('the blocked chip counts the blocked slices of unfinished parts', async () => {
    const s13 = sample.items.find((i) => i.id === 'I_sample13')!;

    await mountPage(
        withItem('I_sample13', {
            slices: s13.slices.map((x, n) => (n < 2 ? { ...x, progress: 'blocked' as const } : x)),
        }),
    );
    expect(header().getAttribute('title')).toContain('2 blocked');
    await receive(
        withItem(
            'I_sample13',
            { slices: s13.slices.map((x, n) => (n < 2 ? { ...x, progress: 'blocked' as const } : x)) },
            calm({}),
        ),
    );
    expect(chips(), 'with nothing above it, it shows').toEqual(['2 blocked']);
});

const col = (name: string, id = C200) => header(id).querySelector<HTMLElement>(`[data-col="${name}"]`)!;

test('a part at Verify or Ready to merge counts as moving while its build thread runs, and asks for action in its group when it stops', async () => {
    const build = {
        id: 'build',
        title: 'Build',
        purpose: 'build',
        state: 'running',
        currentRunning: true,
        updated: '2026-10-21T09:00:00.000Z',
        activity: {
            available: true,
            readAt: new Date(NOW).toISOString(),
            action: 'Read a.ts',
            actionAt: new Date(NOW).toISOString(),
            toolRunning: false,
            agents: [],
        },
    } as ItemThread;
    const clear = withItem('I_sample12', { status: 'Done' }, withItem('I_sample10', { status: 'Done' }, fresh()));

    await mountOpen(withItem('I_sample13', { status: 'Ready to merge', blockers: [], threads: [build] }, clear));
    expect(dossier().querySelector('[data-attention-row="verify"]')).toBeNull();
    expect(text(next())).toBe('Moving#140 Owner accounts');

    const part = text(step('I_sample13'));

    expect([
        part.includes('Working'),
        part.includes('Ready to merge'),
        step('I_sample13').querySelector('[data-open-thread]')!.getAttribute('aria-label'),
    ]).toEqual([true, false, 'Open thread']);
    await receive(
        withItem(
            'I_sample13',
            {
                status: 'Ready to merge',
                blockers: [],
                threads: [
                    {
                        ...build,
                        id: 'shape',
                        title: 'Shape',
                        purpose: 'shape',
                        state: 'done',
                        currentRunning: undefined,
                    },
                    { ...build, state: 'done', currentRunning: undefined, hasRunningChildren: true },
                ],
            },
            clear,
        ),
    );
    expect(text(step('I_sample13')), 'it says what the running build thread does, not the newest one').toContain(
        'Read a.ts· 0s',
    );
    await receive(
        withItem(
            'I_sample13',
            {
                status: 'Ready to merge',
                blockers: [],
                slices: [],
                linkedPrs: cleanPrs,
                threads: [{ ...build, state: 'done', currentRunning: undefined }],
            },
            clear,
        ),
    );
    expect(text(next())).toBe('To merge#140 Owner accounts');
    expect(text(step('I_sample13'))).toContain('Ready to merge');
});

test('a part with nothing to wait on is ready to start, with its Start', async () => {
    holdPosts(unblocked());
    await mountOpen(unblocked());

    const ready = dossier().querySelector('[data-attention-row="ready"]')!;

    expect([text(ready.firstElementChild), text(ready.querySelector('dd > div > span'))]).toEqual([
        'Ready to start 1',
        '#140 Owner accounts',
    ]);
    expect(dossier().querySelector('[data-attention-row="waiting"]'), 'nothing waits').toBeNull();
    await pressMenu(startIn(ready)!);
    expect(dialogTitle(), 'Start opens its menu, not the dialog').toBe('');
    await press(entries()[1]!);
    expect(posted()).toEqual([
        [
            '/api/start-build',
            { drift: 'keep', session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } },
        ],
    ]);
});

test('the Ready to start row and the header agree on what can start: a Queued decision can, a part with a live thread can’t', async () => {
    const data = withItem('I_sample12', { status: 'Shaping', threads: [thread('shaping', 'running')] }, withDecision());

    await mountOpen(data);

    const ready = () => dossier().querySelector('[data-attention-row="ready"]');

    expect([text(ready()!.firstElementChild), text(startIn(col('side')))]).toEqual(['Ready to start 1', 'Start']);
    await receive(withItem('I_d204', { threads: [thread('t1', 'running')] }, data));
    expect([ready(), startIn(col('side'))], 'a live thread').toEqual([null, null]);
});

test('a dossier opens on its Work map, and the browser remembers a switch to the parts list for that dossier alone', async () => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    );
    for (const id of [C200, C180]) localStorage.removeItem(VIEW_KEY + id);
    await mountOpen();
    expect([
        button(dossier(), 'Work map').getAttribute('aria-pressed'),
        dossier().querySelector('[data-work-map]') !== null,
    ]).toEqual(['true', true]);
    await press(button(dossier(), 'Parts list'));
    expect([
        dossier().querySelector('[data-work-map]'),
        dossier().querySelector('[data-parts-list]') !== null,
        localStorage.getItem(VIEW_KEY + C200),
    ]).toEqual([null, true, 'list']);
    vi.resetModules();
    await mountOpen();
    expect(button(dossier(), 'Parts list').getAttribute('aria-pressed'), 'it stays on the parts list').toBe('true');
    await openInstead(C180);
    expect(
        button(dossier(C180), 'Work map').getAttribute('aria-pressed'),
        'the other dossier stays on its Work map',
    ).toBe('true');
});

test('once its blockers complete, Start build sends the build, and the header offers it too', async () => {
    holdPosts(unblocked());
    await mountOpen(
        withItem('I_sample12', { status: 'Shaping', threads: [thread('shaping', 'running')] }, unblocked()),
    );
    expect(text(startIn(col('side')))).toBe('Start');
    expect(
        next().querySelector('.sr-only')?.textContent,
        'Next reads to a screen reader and leaves its room to the title',
    ).toBe('Next');
    await pressMenu(startIn(step('I_sample13'))!);
    expect(dialogTitle(), 'the menu opens without the dialog').toBe('');
    await press(entries()[1]!);
    expect(posted()).toEqual([
        [
            '/api/start-build',
            { drift: 'keep', session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } },
        ],
    ]);
    await answer({ thread: null, error: 'T3 is down.' }, 502);
    expect(text(dossier().querySelector('.start [role="alert"]')), 'its error shows under its row').toBe('T3 is down.');
});

test('a Queued decision shows only Start after while a blocker is open, naming the last open one', async () => {
    const data = withDecision([
        { number: 201, repo: 'maddec01/lar-server', state: 'open' },
        { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
        { number: 140, repo: 'maddec01/lar-server', state: 'open' },
    ]);

    holdPosts(data);
    await mountOpen(data);
    expect(startIn(step('I_d204'))).toBeNull();

    const after = step('I_d204').querySelector<HTMLButtonElement>('[data-start-after]')!;

    expect([text(after), after.title]).toEqual([
        'Start after #140',
        'Pick a model to start it once #201, #140 complete',
    ]);
    await pressMenu(after);
    await press(entries()[0]!);
    expect(posted(), 'Project default in T3 arms it with no model').toEqual([
        ['/api/arm', { session: 's1', itemId: 'I_d204' }],
    ]);
    await answer({ error: null, board: { ...data, armed: { I_d204: {} } } });
    expect(text(step('I_d204').querySelector('[data-start-after]'))).toBe('Starts after #140 ✓');
});

test('the parts list keeps cross-repository dependency order even when builds return to a repository', async () => {
    const first = {
        ...sample.items.find((i) => i.id === 'I_sample24')!,
        state: 'open' as const,
        status: 'Ready' as const,
        blockers: [],
    };
    const second = {
        ...sample.items.find((i) => i.id === 'I_sample25')!,
        state: 'open' as const,
        status: 'Ready' as const,
    };
    const last: Item = {
        ...first,
        id: 'I_last',
        number: 999,
        title: 'Finish in the server',
        blockers: [{ repo: second.repo!, number: second.number!, state: 'open' }],
    };

    await mountOpen(
        {
            ...sample,
            items: [...sample.items.filter((i) => ![first.id, second.id].includes(i.id)), last, second, first],
        },
        C180,
    );
    expect(
        [...dossier(C180).querySelectorAll('[data-parts-list] [data-part]')].map((p) => p.getAttribute('data-part')),
    ).toEqual([first.id, second.id, last.id]);
});

test('the parts list keeps a build before a research decision blocked by that build', async () => {
    const build = { ...sample.items.find((i) => i.id === 'I_sample13')!, blockers: [] };
    const research = {
        ...decision([{ repo: build.repo!, number: build.number!, state: 'open' }]),
        labels: ['decision-research'],
    };

    await mountOpen({ ...sample, items: [c200, research, build] });
    expect(
        [...dossier().querySelectorAll('[data-parts-list] [data-part]')].map((p) => p.getAttribute('data-part')),
    ).toEqual([build.id, research.id]);
});

/** #200 on its Work map with `parts` as its parts, in place of the sample's. */
const conceptOf = (parts: Item[], change: Partial<Item> = {}): BoardData => ({
    ...fresh(),
    items: [
        { ...c200, ...change },
        ...parts.map((p) => ({
            ...p,
            parent: { number: 200, repo: c200.repo!, title: c200.title, url: c200.url!, state: 'open' as const },
            parentId: c200.id,
        })),
    ],
});
const base = sample.items.find((i) => i.id === 'I_sample13')!;
const workPart = (id: string, change: Partial<Item> = {}): Item => ({
    ...base,
    id,
    number: 0,
    title: `Part ${id}`,
    recorded: true,
    kind: 'build',
    labels: [],
    blockers: [],
    slices: [],
    threads: [],
    linkedPrs: [],
    ...change,
});
const settledPart = (
    id: string,
    method: 'grill' | 'prototype' | 'research' | 'task',
    change: Partial<Item> = {},
): Item =>
    workPart(id, {
        kind: 'decision',
        decisionMethod: method,
        status: 'Done',
        completion: { complete: true, reasons: [] },
        ...change,
    });
const mapOpen = async (data: BoardData) => {
    vi.stubGlobal(
        'ResizeObserver',
        class {
            observe() {}
            disconnect() {}
        },
    );
    localStorage.setItem(VIEW_KEY + C200, 'map');
    await mountOpen(data);

    return dossier().querySelector<HTMLElement>('[data-work-map]')!;
};
const fiveSettled = (['grill', 'prototype', 'research', 'task', 'grill'] as const).map((method, n) =>
    settledPart(`W_s${n}`, method),
);

test('a part waiting on a settled decision in the group keeps its edge, from the group, with its label', async () => {
    const held = workPart('W_next', {
        status: 'In progress',
        blockers: [
            { number: 0, repo: c200.repo!, state: 'closed', workId: 'W_s0', title: 'x' },
            { number: 0, repo: c200.repo!, state: 'closed', workId: 'W_s1', title: 'y' },
        ],
    });
    const later = workPart('W_later', {
        status: 'Ready',
        blockers: [{ number: 0, repo: c200.repo!, state: 'open', workId: 'W_next' }],
    });
    const map = await mapOpen(conceptOf([...fiveSettled, held, later], { map: { ...c200.map!, check: undefined } }));

    expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge'))).toEqual([
        'history W_next',
        'W_next W_later',
    ]);

    const label = () => map.querySelector<HTMLElement>('[data-edge-label="history W_next"]')!;

    expect([text(label()), label().tagName, label().getAttribute('aria-label')]).toEqual([
        '2 completed prerequisites',
        'BUTTON',
        '2 completed prerequisites: Part W_s0, Part W_s1',
    ]);
    await press(map.querySelector('[data-map-history]')!);
    expect(map.querySelector('path[data-edge="history W_next"]'), 'expanding leaves the edge').not.toBeNull();
    await receive(
        conceptOf([...fiveSettled, { ...held, status: 'Done', completion: { complete: true, reasons: [] } }, later], {
            map: { ...c200.map!, check: undefined },
        }),
    );
    expect(
        [...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge')),
        'a board push moves it into the group',
    ).toEqual(['history W_later']);

    const single = map.querySelector('[data-edge-label="history W_later"]')!;

    expect([text(single), single.getAttribute('aria-label')]).toEqual([
        '1 completed prerequisite',
        '1 completed prerequisite: Part W_next',
    ]);
});

test('an edge label counts each finished blocker once, names them on focus, and shows them in history when pressed; an open blocker stays named', async () => {
    const closed = (workId: string) => ({
        number: 0,
        repo: c200.repo!,
        state: 'closed' as const,
        workId,
        title: workId,
    });
    const held = workPart('W_next', {
        status: 'Ready',
        blockers: [
            closed('W_s0'),
            closed('W_s0'),
            closed('W_s1'),
            { number: 0, repo: c200.repo!, state: 'open', workId: 'W_open', title: 'Part W_open' },
        ],
    });
    const map = await mapOpen(
        conceptOf([...fiveSettled, workPart('W_open', { status: 'In progress' }), held], {
            map: { ...c200.map!, check: undefined },
        }),
    );
    const label = map.querySelector<HTMLElement>('[data-edge-label="history W_next"]')!;

    expect(text(label), 'the same part listed twice counts once').toBe('2 completed prerequisites');
    expect(
        [...map.querySelectorAll('path[data-edge]')]
            .map((p) => p.getAttribute('data-edge'))
            .map(String)
            .sort(),
    ).toEqual(['W_open W_next', 'history W_next']);
    expect(text(map.querySelector('[data-map-part="W_next"] [data-map-facts]'))).toBe(
        'Blocked · starts after Part W_open',
    );
    await settle(() => label.focus());
    await settle(() => vi.advanceTimersByTime(1000));
    expect(text(document.querySelector('[role="tooltip"]')), 'focus shows the names').toBe('Part W_s0, Part W_s1');
    expect(map.querySelector('[data-history-part]')).toBeNull();
    await press(label);
    expect(map.querySelector('[data-history-part="W_s0"]')).not.toBeNull();
    expect(map.querySelector('path[data-edge="history W_next"]'), 'expanding leaves the edge').not.toBeNull();
});

test('a build whose planner ended while its child and background work run reads as working, never as done', async () => {
    const planner: ItemThread = {
        id: 'plan',
        title: 'Plan',
        state: 'done',
        purpose: 'build',
        hasRunningChildren: true,
        updated: '2026-10-21T09:00:00.000Z',
    };
    const newest: ItemThread = { id: 'newer', title: 'Later', state: 'done', updated: '2026-10-21T10:00:00.000Z' };
    const build = workPart('W_build', { status: 'In progress', buildPhase: 'plan', threads: [newest, planner] });
    const map = await mapOpen(conceptOf([build]));
    const node = map.querySelector('[data-map-part="W_build"]')!;

    expect(text(node.querySelector('[data-map-facts]'))).toBe('Planning · child work running');
    expect(node.querySelector('[data-open-thread]')!.getAttribute('href')).toBe(
        't3code://threads/sample-environment/plan',
    );
    expect(header().getAttribute('title'), 'the header counts it as running').toContain('1 running');
    await receive(conceptOf([{ ...build, threads: [newest, { ...planner, hasRunningChildren: undefined }] }]));
    expect(text(map.querySelector('[data-map-part="W_build"] [data-map-facts]')), 'once it all ends, it says so').toBe(
        'In progress · Run finished',
    );
});

test('a finished part with work still running stays with current work', async () => {
    const map = await mapOpen(
        conceptOf([
            settledPart('W_d', 'research', {
                threads: [
                    {
                        id: 'd',
                        title: 'D',
                        state: 'done',
                        hasRunningChildren: true,
                        updated: '2026-10-21T09:00:00.000Z',
                    },
                ],
            }),
        ]),
    );

    expect(map.querySelector('[data-map-history]')).toBeNull();
    expect(text(map.querySelector('[data-map-part="W_d"] [data-map-facts]'))).toContain('Complete · Working');
});

const dossierTotal = () => dossier().querySelector<HTMLElement>('[data-col="figures"] [title]')!;

test('a Dossier total marks a sum with a failed part partial with a + after its cost, and says why', async () => {
    const usage = { agentMs: 60_000, tokens: 1000, costUsd: 2 };

    await mountPage(
        withItem(
            'I_sample10',
            { stats: usage, usageState: 'failed' },
            withItem('I_sample12', { stats: usage, usageState: 'current' }),
        ),
    );
    expect(text(dossierTotal())).toBe('45m · 2.59M · $7.90+ partial');
    expect(
        [
            text(dossierTotal().querySelector('[data-partial]')),
            dossierTotal().querySelector('[data-partial] .sr-only') !== null,
        ],
        'a + on screen, partial for a screen reader',
    ).toEqual(['+ partial', true]);
    expect(dossierTotal().title).toContain('This total is incomplete');
});

test('decision map and attention actions use answer wording only for a current question', async () => {
    const decision = workPart('W_question', {
        kind: 'decision',
        decisionMethod: 'grill',
        status: 'Shaping',
        threads: [thread('decision-thread', 'running')],
    });
    const data = conceptOf([decision]);
    const map = await mapOpen(data);
    const action = () => map.querySelector('[data-map-part="W_question"] [data-open-thread]')!;

    expect(action().getAttribute('aria-label')).toBe('Open thread');
    await receive(conceptOf([{ ...decision, status: 'Needs you' }]));
    expect(action().getAttribute('aria-label')).toBe('Open thread');
    await receive(conceptOf([{ ...decision, status: 'Needs you', threads: [thread('question-thread', 'needs you')] }]));
    expect([text(action()), action().getAttribute('href')]).toEqual([
        'Answer in T3',
        't3code://threads/sample-environment/question-thread',
    ]);
    await receive(conceptOf([{ ...decision, status: 'Needs you', threads: [thread('question-thread', 'done')] }]));
    expect(action().getAttribute('aria-label')).toBe('Open thread');
    await press(button(dossier(), 'Parts list'));

    const attentionAction = () => dossier().querySelector('[data-attention-row="you"] [data-open-thread]')!;

    expect(attentionAction().getAttribute('aria-label')).toBe('Open thread');
    await receive(conceptOf([{ ...decision, status: 'Needs you', threads: [thread('question-thread', 'needs you')] }]));
    expect(text(attentionAction())).toBe('Answer in T3');
});
