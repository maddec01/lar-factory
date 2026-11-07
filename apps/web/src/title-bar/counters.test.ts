// The title bar's five counters: need you, shaping, building against the build limit, shipped and spend, always for
// the whole factory. Each opens a popover of every item behind its number; picking one opens the item dialog.

import type { BoardData, ItemThread } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fresh, moved, mountPage, push, sample, settle, text, textBesideIcon } from '../../test/support.ts';

/** The sample with a build limit of 2, which sample mode leaves out. */
const limited = { ...sample, buildLimit: { limit: 'automatic' as const, automatic: 2 } };
const completeSample = {
    ...limited,
    error: null,
    items: sample.items.map((item) => ({
        ...item,
        stats: item.stats && item.stats !== 'unavailable' ? item.stats : { agentMs: 0, tokens: 0, costUsd: 0 },
    })),
};

const counters = () => $$<HTMLButtonElement>('.counters button[aria-haspopup]');
const counter = (label: string) => counters().find((b) => b.getAttribute('aria-label')!.startsWith(`${label}: `))!;
const popup = () => $('[data-state="open"] .counter-popup');
const rows = () => [...popup()!.querySelectorAll('li')].map(textBesideIcon);
/** The popover's head, its title and count, and its foot. */
const head = (pop: HTMLElement) => text(pop.querySelector('.counter-head'));
const foot = (pop: HTMLElement) => text(pop.querySelector('.border-t'));
const classes = (el: Element | null) => el!.className.split(' ');
const close = () =>
    settle(() => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
/** A first read that hasn't settled, with one repository still to land. */
const firstRead = {
    step: 'items' as const,
    ready: true,
    settled: false,
    running: ['owner/pending'],
    waiting: ['owner/pending'],
};

async function openCounter(label: string): Promise<HTMLElement> {
    await settle(() => counter(label).click());

    return popup()!;
}

test("the counters show need you, shaping, building over the limit of 2, shipped this week and spend, in the board's order, each by its number and named by its label", async () => {
    await mountPage(completeSample);
    expect(counters().map(text)).toEqual(['7', '4', '4/2', '4', '$190.25']);
    expect(counters().map((b) => b.getAttribute('aria-label'))).toEqual([
        'need you: 7 items waiting on your answer, verification or merge',
        'shaping: 4 items being shaped',
        'building: 2 over the build limit',
        'shipped: Done in the last 7 days',
        'spend: Agent cost on open and recent items, an API estimate',
    ]);
    expect(counter('queued')).toBeUndefined();
});

test("the counts are the whole factory's with a repository scoped", async () => {
    await mountPage();

    const before = counters().map(text);

    await openCounter('need you');

    const items = rows();

    await close();

    const { useScopeStore } = await import('../board/scope-store.ts');

    await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
    expect($('[data-search-field]')!.getAttribute('aria-label')).toBe('Search, filtered by lar-apple');
    expect(counters().map(text)).toEqual(before);
    await openCounter('need you');
    expect(rows()).toEqual(items);
});

test('need you leaves out a Verify item while its build thread runs, and counts it again when it stops', async () => {
    const verify = (state: ItemThread['state'], currentRunning?: true) => ({
        ...fresh(),
        items: sample.items.map((i) =>
            i.id === 'I_sample10'
                ? {
                      ...i,
                      status: 'Verify' as const,
                      threads: [
                          {
                              id: 'build',
                              title: 'Build',
                              purpose: 'build',
                              state,
                              currentRunning,
                              updated: '2026-10-21T09:00:00.000Z',
                          } as ItemThread,
                      ],
                  }
                : i,
        ),
    });
    const count = () => Number(/need you: (\d+)/.exec(counter('need you').getAttribute('aria-label')!)![1]);

    await mountPage(verify('done'));

    const waiting = count();
    const { useBoardStore } = await import('../board/board-store.ts');

    await settle(() => useBoardStore.getState().receive(verify('running', true)));
    expect(count()).toBe(waiting - 1);
    await settle(() => useBoardStore.getState().receive(verify('done')));
    expect(count()).toBe(waiting);
});

test("a counter row shows its repository's project icon, not a tone dot", async () => {
    await mountPage({ ...sample, projectIcons: { 'maddec01/lar-server': { kind: 'emoji', emoji: '🚀' } } });

    const pop = await openCounter('need you');
    const icons = [...pop.querySelectorAll('li')].map((li) => li.querySelector('[data-project-icon]'));

    expect(icons.every(Boolean)).toBe(true);
    expect(icons.map(text)).toContain('🚀');
    expect(pop.querySelector('li [class*="repo-tone"].rounded-full')).toBeNull();
});

test('need you lists its items by status, each with its status glyph in its colour', async () => {
    await mountPage();

    const pop = await openCounter('need you');

    expect(head(pop)).toBe('Needs you7');
    expect([...pop.querySelectorAll('h3')].map(text)).toEqual(['Needs you 2', 'Verify 4', 'Ready to merge 1']);
    expect(rows()).toEqual([
        '#23 Faster library sync on large collections30m ago',
        '#202 Sign-in screen35m ago',
        '#900026 Bump FFmpeg to 7.140m ago',
        '#31 New artwork grid layout1h ago',
        '#34 Swipe between episodes2h ago',
        '#147 Fall back to software transcoding when the GPU is busy3h ago',
        '#142 Cache probe results between restarts1h ago',
    ]);

    const glyph = pop.querySelector('li svg') as SVGElement;

    expect(glyph.style.color).toBe('var(--st-amber)');

    const age = [...pop.querySelectorAll('li span')].find((s) => text(s) === '30m ago' && !s.children.length)!;

    expect(age.className.split(' '), 'an age such as "3d ago" stays on one line').toContain('whitespace-nowrap');
    // An auto track grows to the title's full width and pushes the age out of the popover; a shrinkable one truncates the title.
    expect(pop.querySelector('ul')!.className.split(' ')).toContain('grid-cols-[minmax(0,1fr)]');
});

test('building lists the builds at work, the build limit and what it means', async () => {
    await mountPage(limited);

    const pop = await openCounter('building');

    expect(head(pop)).toBe('Building4/2');
    expect(
        rows().map((r) => r.split(' ')[0]),
        'Review counts; Verify and Ready to merge only when at work again',
    ).toEqual(['#150', '#30', '#180', '#141']);
    expect(foot(pop)).toBe('At the build limit. Start build and Start after still go ahead.');
    expect(text(pop)).not.toContain('slot');
});

test('a build counts while its start is in flight or in Review, and the count shows the excess', async () => {
    const started = {
        ...limited,
        buildLimit: { limit: 1, automatic: 2 },
        startProgress: { I_sample13: { build: { phase: 'starting' as const } } },
    };

    await mountPage(moved('I_sample14', 'Review', started));
    expect(text(counter('building'))).toBe('5/1');
    expect(counter('building').getAttribute('aria-label')).toBe('building: 4 over the build limit');
});

test('without a build limit, as in sample mode, building shows only its count', async () => {
    await mountPage();
    expect(text(counter('building'))).toBe('4');
    expect(counter('building').getAttribute('aria-label')).toBe('building: 4 builds at work');

    const pop = await openCounter('building');

    expect([head(pop), pop.querySelector('.border-t')]).toEqual(['Building4', null]);
});

test('a concept in progress is no build at work', async () => {
    await mountPage(moved('I_sample09', 'In progress', limited));
    expect(text(counter('building'))).toBe('4/2');

    const pop = await openCounter('building');

    expect(rows().map((r) => r.split(' ')[0])).not.toContain('#200');
    expect(head(pop)).toBe('Building4/2');
});

test("shaping lists what the board's Shaping section holds, across the whole factory whatever the filters", async () => {
    await mountPage();

    const section = () => $$('[data-stage="shaping"] li[data-item]').map((row) => row.dataset.item);
    const listed = () => [...popup()!.querySelectorAll('[data-item]')].map((row) => row.getAttribute('data-item'));
    const board = section();

    expect(text(counter('shaping'))).toBe(String(board.length));

    const pop = await openCounter('shaping');

    expect(head(pop)).toBe(`Shaping${board.length}`);
    expect(listed().sort()).toEqual([...board].sort());
    await close();

    const { useScopeStore } = await import('../board/scope-store.ts');

    await settle(() => useScopeStore.getState().setFilters({ kinds: ['bug'], labels: [] }));
    await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
    expect(section().length, "the board's section narrows").toBeLessThan(board.length);
    expect(text(counter('shaping'))).toBe(String(board.length));
    await openCounter('shaping');
    expect(listed().sort()).toEqual([...board].sort());
});

test('an item waiting on you during shaping counts in both need you and shaping', async () => {
    const shapingThread = {
        id: 's',
        title: 'Shape',
        purpose: 'shape',
        state: 'done' as const,
        updated: '2026-10-21T09:00:00.000Z',
    };

    await mountPage(
        moved('I_sample05', 'Needs you', {
            ...sample,
            items: sample.items.map((i) =>
                i.id === 'I_sample05' ? { ...i, threads: [shapingThread as ItemThread] } : i,
            ),
        }),
    );
    await openCounter('need you');
    expect(popup()!.querySelector('[data-item="I_sample05"]')).not.toBeNull();
    await close();
    await openCounter('shaping');
    expect(popup()!.querySelector('[data-item="I_sample05"]')).not.toBeNull();
});

test('while a Queue start launches, the item counts in shaping as its row moves to the Shaping section', async () => {
    await mountPage();

    const before = Number(text(counter('shaping')));
    const { useBoardStore } = await import('../board/board-store.ts');

    await settle(() =>
        useBoardStore
            .getState()
            .receive({ ...sample, startProgress: { I_sample05: { shape: { phase: 'starting' } } } }),
    );
    expect(text(counter('shaping'))).toBe(String(before + 1));
    expect($('[data-stage="shaping"] li[data-item="I_sample05"]')).not.toBeNull();
    await openCounter('shaping');
    expect(popup()!.querySelector('[data-item="I_sample05"]')).not.toBeNull();
});

test("shipped lists this week's done items, newest first", async () => {
    await mountPage();

    const pop = await openCounter('shipped');

    expect(head(pop)).toBe('Shippedlast 7 days');
    expect(rows().map((r) => r.split(' ')[0])).toEqual(['#5', '#40', '#203', '#181']);
});

test("each row is named by its item's number and title, not by the popover's close", async () => {
    await mountPage();
    await openCounter('building');
    expect(popup()!.querySelector('li button')!.getAttribute('aria-label')).toBe(
        '#150 Relay for streaming away from home',
    );
});

test('spend lists every priced item, highest cost first, with its cost', async () => {
    await mountPage(completeSample);

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spend$190.25');
    expect(rows()).toHaveLength(13);
    expect(rows().slice(0, 3)).toEqual([
        '#150 Relay for streaming away from home$46.90',
        '#5 Crash when a server goes offline mid-playback$41.20',
        '#40 Resume from the stored position$27.00',
    ]);

    const costs = rows().map((row) => Number(/\$([\d.]+)$/.exec(row)![1]));

    expect(costs).toEqual([...costs].sort((a, b) => b - a));
    expect(text(pop)).not.toMatch(/and \d+ more|Top 5/);
    expect(foot(pop)).toBe('13 priced items, an API estimate.');
});

test('every panel lists every item in a list that scrolls between its head and foot', async () => {
    const many = {
        ...limited,
        items: Array.from({ length: 30 }, (_, n) => ({
            ...sample.items.find((i) => i.id === 'I_sample14')!,
            id: `I_many${n}`,
            number: 1000 + n,
        })),
    };

    await mountPage(moved('I_many0', 'In progress', many));

    const pop = await openCounter('building');

    expect(rows()).toHaveLength(30);
    expect(text(pop)).not.toMatch(/and \d+ more/);

    const list = pop.querySelector('ul')!.parentElement!;

    expect(classes(list)).toEqual(expect.arrayContaining(['min-h-0', 'flex-1', 'overflow-y-auto']));
    expect(list.contains(pop.querySelector('.counter-head')), 'the head stays out of the scroll').toBe(false);
    expect(list.contains(pop.querySelector('.border-t')), 'the foot stays out of the scroll').toBe(false);
    expect(classes(pop)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'min-h-0']));
});

// jsdom lays nothing out, so this checks the classes. The menu rows in the design system grow the same way under lg or a coarse pointer.
test("a panel has a menu's padding, and a row a menu row's height, radius and font", async () => {
    await mountPage();

    const pop = await openCounter('building');

    expect(classes(pop.closest('[data-slot="popover-content"]'))).toContain('p-1');
    expect(classes(pop.querySelector('li button'))).toEqual(
        expect.arrayContaining([
            'min-h-7',
            'max-lg:min-h-11',
            'pointer-coarse:min-h-11',
            'py-1',
            'text-sm',
            'rounded-[0.375rem]',
        ]),
    );
});

// jsdom lays nothing out, so this checks the classes behind the strip's steady width and the fold.
test("each counter has one icon box, a value slot that keeps its width, and folds by the bar's width", async () => {
    await mountPage(completeSample);
    expect(counters().map((b) => classes(b.querySelector('.counter-icon')))).toEqual(
        Array(5).fill(expect.arrayContaining(['size-4', 'shrink-0'])),
    );
    expect(
        counters().map((b) => classes(b.querySelector('.counter-value')).find((c) => c.startsWith('min-w-'))),
    ).toEqual(['min-w-[2ch]', 'min-w-[2ch]', 'min-w-[4ch]', 'min-w-[2ch]', 'min-w-[8ch]']);
    expect(
        ['need you', 'shaping', 'building', 'shipped', 'spend'].map((label) =>
            classes(counter(label)).find((c) => c.startsWith('@min-')),
        ),
    ).toEqual([
        undefined,
        '@min-[54rem]:inline-flex',
        undefined,
        '@min-[54rem]:inline-flex',
        '@min-[66rem]:inline-flex',
    ]);
});

test('the spend tooltip says the figure is an API estimate', async () => {
    await mountPage(completeSample);
    await settle(() => counter('spend').focus());
    await settle(() => vi.advanceTimersByTime(1000));
    expect(text($('[role="tooltip"]'))).toBe('Agent cost on open and recent items, an API estimate');
});

test('with nothing on the board each popover says so', async () => {
    await mountPage({ ...completeSample, items: [] });
    expect(counters().map(text)).toEqual(['0', '0', '0/2', '0', '$0.00']);

    const empty: [string, string][] = [];

    for (const label of ['need you', 'shaping', 'building', 'shipped', 'spend']) {
        const pop = await openCounter(label);

        empty.push([label, text(pop.querySelector('p'))]);
        await close();
    }
    expect(empty).toEqual([
        ['need you', 'Nothing waits on you.'],
        ['shaping', 'Nothing shaping right now.'],
        ['building', 'Nothing building right now.'],
        ['shipped', 'Nothing shipped this week.'],
        ['spend', 'No priced agent work yet.'],
    ]);
    expect(counter('building').getAttribute('aria-label')).toBe(
        'building: Room for 2 more builds under the build limit of 2',
    );
});

test('while the first read could add items, a count with none is a dash, one with items its number, and empty panels show the loader', async () => {
    const data = structuredClone(completeSample);

    await mountPage({ ...data, items: data.items.filter((i) => i.status === 'Done'), firstRead });
    expect(counters().slice(0, 4).map(text)).toEqual(['–', '–', '–/2', '4']);
    for (const label of ['need you', 'shaping', 'building'] as const) {
        expect(counter(label).getAttribute('aria-label')).toBe(`${label}: Still loading Projects`);

        const pop = await openCounter(label);

        expect(text(pop.querySelector('p')), label).toBe('Loading Projects…');
        expect(pop.querySelector('[data-loader]'), label).not.toBeNull();
        expect(pop.querySelector('.border-t'), `${label} has no foot yet`).toBeNull();
        await close();
    }

    const building = await openCounter('building');

    expect(head(building), 'no zero claimed in the panel either').toBe('Building–/2');
    expect(building.querySelector('.counter-head [style]'), 'no empty limit bars').toBeNull();
    await close();
    await push({ ...data, items: [], firstRead });
    expect(text(counter('shipped'))).toBe('–');

    const pop = await openCounter('shipped');

    expect(text(pop.querySelector('p'))).toBe('Loading Projects…');
});

test("picking a row closes the popover and opens that item's dialog", async () => {
    await mountPage();
    await openCounter('building');
    await settle(() => popup()!.querySelector<HTMLButtonElement>('li button')!.click());
    expect(popup()).toBeNull();
    expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe('#150 Relay for streaming away from home');
});

test('spend shows the known figures with a plus while some usage is unavailable, and its panel says so below the list', async () => {
    const data = structuredClone(completeSample);

    data.items[0] = { ...data.items[0]!, stats: { agentMs: 60_000, tokens: 1000, costUsd: 200 }, usageState: 'failed' };
    await mountPage(data);
    expect(text(counter('spend'))).toMatch(/^\$[\d.,]+\+$/);

    const pop = await openCounter('spend');

    expect(head(pop)).toMatch(/^Agent spend\$[\d.,]+ so far$/);
    expect(text(pop)).toContain('$200.00');
    expect(foot(pop)).toBe('Partial figures. Some usage is unavailable.');
    expect(
        pop.querySelector('ul')!.parentElement!.compareDocumentPosition(pop.querySelector('.border-t')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        'the notice comes after the list',
    ).toBeTruthy();
});

test('spend shows a dash with no figures known and usage unavailable, and its panel says usage is unavailable', async () => {
    const data = structuredClone(completeSample);

    data.items = [];
    data.itemSourceProblems = [{ repo: 'owner/failed', problem: 'Read failed' }];
    await mountPage(data);
    expect(text(counter('spend'))).toBe('–');

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spendUnavailable');
    expect(text(pop.querySelector('p'))).toBe('Usage is unavailable, so nothing is priced.');
});

test('spend shows the known figures with a plus while some usage still loads, and its panel says so', async () => {
    const data = structuredClone(completeSample);

    data.items[0] = {
        ...data.items[0]!,
        stats: { agentMs: 60_000, tokens: 1000, costUsd: 200 },
        usageState: 'loading',
    };
    await mountPage(data);
    expect(counter('spend').querySelector('[data-loader]')).toBeNull();
    expect(text(counter('spend'))).toMatch(/^\$[\d.,]+\+$/);

    const pop = await openCounter('spend');

    expect(text(pop)).toContain('$200.00');
    expect(foot(pop)).toBe('Partial figures. Some usage is still loading.');
});

test('spend shows the loader until it has a figure, in the strip and its panel', async () => {
    const data = structuredClone(completeSample);

    data.items = [];
    await mountPage({ ...data, firstRead });
    expect(counter('spend').querySelector('[data-loader]')).not.toBeNull();

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spendLoading');
    expect(text(pop.querySelector('p'))).toBe('Loading usage…');
});

test('unavailable usage takes precedence over loading', async () => {
    const data = structuredClone(completeSample);

    data.items = [];
    await mountPage({ ...data, firstRead, usageRead: { readable: false } });
    expect(counter('spend').querySelector('[data-loader]')).toBeNull();
    expect(text(counter('spend'))).toBe('–');

    const mixed = structuredClone(completeSample);

    mixed.items[0] = { ...mixed.items[0]!, usageState: 'loading' };
    await push({ ...mixed, usageRead: { readable: false } });
    expect(foot(await openCounter('spend'))).toBe('Partial figures. Some usage is unavailable.');
});

test('spend with T3 stopped and no figures is a dash, and with T3 not answered yet the loader', async () => {
    const none = (usageState?: 'loading'): BoardData => ({
        ...structuredClone(completeSample),
        items: [{ ...completeSample.items[0]!, stats: undefined, threads: 'unavailable', usageState }],
    });

    await mountPage(none());
    expect(text(counter('spend'))).toBe('–');
    await push(none('loading'));
    expect(counter('spend').querySelector('[data-loader]')).not.toBeNull();
});

test('spend stays complete with figures frozen at merge, or an item with no threads', async () => {
    const data: BoardData = structuredClone(completeSample);

    data.items[0] = {
        ...data.items[0]!,
        stats: { agentMs: 60_000, tokens: 1000, costUsd: 2, frozen: true },
        usageState: 'failed',
    };
    data.items[1] = { ...data.items[1]!, stats: 'unavailable', threads: [] };
    await mountPage(data);
    expect(text(counter('spend'))).toMatch(/^\$[\d.,]+$/);
});

test('building animates across the whole factory while the Build heading follows scope and filters', async () => {
    const idle = { ...fresh(limited), items: sample.items.map((item) => ({ ...item, slices: [], threads: [] })) };
    const running = {
        ...idle,
        items: idle.items.map((item) =>
            item.id === 'I_sample14'
                ? {
                      ...item,
                      kind: 'bug' as const,
                      threads: [
                          {
                              id: 'b',
                              title: 'Build',
                              purpose: 'build',
                              state: 'running' as const,
                              currentRunning: true as const,
                              updated: idle.fetchedAt!,
                          },
                      ],
                  }
                : item,
        ),
    };

    await mountPage(running);

    const heading = () => $('[data-stage="build"] header > :is(svg, .status-spin)')!;
    const counterIcon = () => counter('building').querySelector('svg')!;

    expect(heading().classList.contains('status-spin')).toBe(true);
    expect(counterIcon().closest('.status-spin')).not.toBeNull();

    let pop = await openCounter('building');
    const members = () => [...popup()!.querySelectorAll('[data-item]')].map((el) => el.getAttribute('data-item'));
    const originalMembers = members();

    expect(pop.querySelector('[data-item="I_sample14"] .status-spin')).not.toBeNull();
    await close();

    const { useScopeStore } = await import('../board/scope-store.ts');

    await settle(() => useScopeStore.getState().setScope('maddec01/lar-server'));
    expect(heading().classList.contains('lucide-circle')).toBe(true);
    expect(counterIcon().closest('.status-spin')).not.toBeNull();
    expect(text(counter('building'))).toBe('4/2');
    await openCounter('building');
    expect(members()).toEqual(originalMembers);
    await close();
    await settle(() => useScopeStore.getState().setScope(null));
    await settle(() => useScopeStore.getState().setFilters({ kinds: ['feature'], labels: [] }));
    expect(heading().classList.contains('lucide-circle')).toBe(true);
    expect(counterIcon().closest('.status-spin')).not.toBeNull();
    pop = await openCounter('building');
    expect(members()).toEqual(originalMembers);

    const { useBoardStore } = await import('../board/board-store.ts');

    await settle(() => useBoardStore.getState().receive(idle));
    expect(counterIcon().classList.contains('lucide-circle')).toBe(true);
    expect(text(counter('building'))).toBe('4/2');
    expect(members()).toEqual(originalMembers);
});

test('starting and idle builds keep their count and membership while shaping alone leaves the building icons still', async () => {
    const starting = {
        ...fresh(limited),
        items: sample.items.map((item) => ({
            ...item,
            slices: [],
            threads:
                item.id === 'I_sample02'
                    ? [
                          {
                              id: 's',
                              title: 'Shape',
                              purpose: 'shape',
                              state: 'running' as const,
                              currentRunning: true as const,
                              updated: item.updatedAt,
                          },
                      ]
                    : [],
        })),
        startProgress: { I_sample13: { build: { phase: 'starting' as const } } },
    };

    await mountPage(starting);
    expect(text(counter('building'))).toBe('5/2');
    expect(counter('building').querySelector('svg.lucide-circle')).not.toBeNull();
    expect(counter('need you').querySelector('svg.status-pulse')).toBeNull();
    expect(counter('need you').querySelector<SVGElement>('svg')!.style.color).toBe('var(--st-amber)');

    const pop = await openCounter('building');

    expect(pop.querySelectorAll('[data-item]')).toHaveLength(5);
    expect(pop.querySelector('[data-item="I_sample13"] svg.lucide-circle-arrow-right')).not.toBeNull();
    expect(pop.querySelector('svg.status-pulse, .status-spin')).toBeNull();
});
