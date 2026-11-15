// The title bar's five counters: need you, shaping, building against the automatic build limit, shipped and spend, always for
// the whole factory. Each opens a popover of every item behind its number; picking one opens the item dialog. Need you's
// brings Your desk into view instead while the desk shows cards.

import type { ItemThread } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, fresh, moved, mountPage, push, sample, settle, text, textBesideIcon } from '@/test/PageTest';

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

const counters = () => $$<HTMLButtonElement>('[data-slot="title-bar-status"] [data-slot="toolbar-counter"]');
/** A counter's label, as its name starts: "building:". */
const labelOf = (b: Element) => /^[^:]*:/.exec(text(b))?.[0] ?? '';
/** What a screen reader says for a counter: its label, then what its number means: "building: 4 builds open: 2 working, 1 run stopped". */
const nameOf = (b: Element) => `${labelOf(b)} ${b.getAttribute('aria-description')}`;
/** The number a counter shows. */
const value = (b: Element) => {
    const copy = b.cloneNode(true) as Element;

    copy.querySelectorAll('[aria-hidden]').forEach((element) => element.remove());

    return text(copy).slice(labelOf(b).length).trim();
};
const counter = (label: string) => counters().find((b) => labelOf(b) === `${label}:`)!;
/** The open counter's popover: its header, its list (`data-counter-list`) and its footer. */
const popup = () => $('[data-counter-list]')?.closest<HTMLElement>('[data-state="open"]') ?? null;
const rows = () => [...popup()!.querySelectorAll('li')].map(textBesideIcon);
/** The popover's head, its title and count, and its foot. */
const head = (pop: HTMLElement) => text(pop.querySelector('[data-slot="popover-header"]'));
const foot = (pop: HTMLElement) => text(pop.querySelector('[data-slot="status-popover-footer"]'));
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

/** Filters that hide every desk card, so need you's press opens its list rather than bringing Your desk into view. */
const hideDesk = () =>
    localStorage.setItem('lar-board:filters:board', JSON.stringify({ kinds: [], labels: ['no such label'] }));

async function openCounter(label: string): Promise<HTMLElement> {
    await settle(() => counter(label).click());

    return popup()!;
}

test('need you brings Your desk into view rather than listing the cards it already shows', async () => {
    await mountPage();
    await settle(() => counter('need you').click());
    expect(popup()).toBeNull();
    await settle(() => vi.advanceTimersByTime(0));
    expect($('section.desk')!.dataset.flash, 'its cards glow once').toBe('');
});

test('the counts are the whole factory’s with a repository scoped', async () => {
    hideDesk();
    await mountPage();

    const before = counters().map(value);

    await openCounter('need you');

    const items = rows();

    await close();

    const { useScopeStore } = await import('@/features/filters/ScopeStore');

    await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
    expect($('[data-search-field]')!.getAttribute('aria-description')).toBe('filtered by lar-apple, no such label');
    expect(counters().map(value)).toEqual(before);
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
                      parentId: null,
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
    const count = () => Number(/need you: (\d+)/.exec(nameOf(counter('need you')))![1]);

    await mountPage(verify('done'));

    const waiting = count();
    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() => useBoardStore.getState().receive(verify('running', true)));
    expect(count()).toBe(waiting - 1);
    await settle(() => useBoardStore.getState().receive(verify('done')));
    expect(count()).toBe(waiting);
});

test('a build counts while its start is in flight or in Review, and the count shows the excess', async () => {
    const started = {
        ...limited,
        buildLimit: { limit: 1, automatic: 2 },
        startProgress: { I_sample13: { build: { phase: 'starting' as const } } },
    };

    await mountPage(moved('I_sample14', 'Review', started));
    expect(value(counter('building'))).toBe('9');
    expect(nameOf(counter('building'))).toBe(
        'building: 9 builds open · shared limit 1: 2 working, 2 checks failed, 1 starting, 1 run stopped, 1 verify build, 1 checks running, 1 resolve conflicts',
    );
});

test('a concept in progress is no build at work', async () => {
    await mountPage(moved('I_sample09', 'In progress', limited));
    expect(value(counter('building'))).toBe('8');

    const pop = await openCounter('building');

    expect(rows().map((r) => r.split(' ')[0])).not.toContain('#200');
    expect(head(pop)).toBe('Building8Shared limit 2');
});

test('an item waiting on you during shaping counts in both need you and shaping', async () => {
    const shapingThread = {
        id: 's',
        title: 'Shape',
        purpose: 'shape',
        state: 'done' as const,
        updated: '2026-10-21T09:00:00.000Z',
    };

    hideDesk();
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

    const before = Number(value(counter('shaping')));
    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore
            .getState()
            .receive({ ...sample, startProgress: { I_sample05: { shape: { phase: 'starting' } } } }),
    );
    expect(value(counter('shaping'))).toBe(String(before + 1));
    expect($('[data-stage="shaping"] li[data-item="I_sample05"]')).not.toBeNull();
    await openCounter('shaping');
    expect(popup()!.querySelector('[data-item="I_sample05"]')).not.toBeNull();
});

test('shipped lists this week’s delivered builds, newest first', async () => {
    await mountPage();

    const pop = await openCounter('shipped');

    expect(head(pop)).toBe('Shipped16Last 7 days');
    expect(rows().map((r) => /^(#\d+|Part \d+)/.exec(r)![1])).toEqual([
        '#5',
        '#40',
        'Part 23',
        'Part 17',
        'Part 20',
        'Part 19',
        '#181',
        'Part 21',
        'Part 18',
        'Part 16',
        'Part 13',
        '#292',
        '#291',
        '#144',
        '#290',
        'Part 2',
    ]);
});

test('spend lists every priced item, highest cost first, with its cost and project, the total saying what it covers and its foot that it is an estimate', async () => {
    await mountPage(completeSample);
    expect(value(counter('spend')), 'the bar gives whole dollars').toBe('$489');

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spend37 items$489 · All open work, and recently finished work');
    expect(rows()).toHaveLength(37);
    expect(pop.querySelector('li [data-project-icon]'), 'each row names its project').not.toBeNull();
    expect(rows().slice(0, 3)).toEqual([
        '#150 Direct streaming from away, with automatic port mappinglar-server$46.90',
        '#5 Crash when a server goes offline mid-playbacklar-apple$41.20',
        '#269 Prepare signed household records and share secrets for every server a household ownslar-server$39.40',
    ]);

    const costs = rows().map((row) => Number(/\$([\d.]+)$/.exec(row)![1]));

    expect(costs).toEqual([...costs].sort((a, b) => b - a));
    expect(text(pop)).not.toMatch(/and \d+ more|Top 5/);
    expect(foot(pop)).toBe('An estimate at API prices.');
});

test('a counter’s rows name a ticketless concept part as its row does, give a title two lines, and set the age apart from the project by one dot', async () => {
    await mountPage({
        ...completeSample,
        items: completeSample.items.map((item) => (item.number === 150 ? { ...item, number: 0, partOrder: 15 } : item)),
    });

    const pop = await openCounter('spend');

    expect(rows()[0]).toMatch(/^Part 15 Direct streaming/);
    expect(pop.querySelector('[data-counter-title]')!.className).toContain('line-clamp-2');
    await close();

    const shipped = await openCounter('shipped');
    const sub = shipped.querySelector('li [data-counter-title]')!.nextElementSibling!;

    expect([...sub.children].map((child) => text(child)).slice(-2)[0], 'the dot stands alone').toBe('·');
});

test('spend says what it covers from the retention setting', async () => {
    await mountPage({ ...completeSample, retention: { hideAfterDays: 7, deleteAfterDays: null } });
    expect(head(await openCounter('spend'))).toBe(
        'Agent spend37 items$489 · All open work, and work finished in the last 7 days',
    );
});

test('while usage is summed again, the bar keeps the last complete total, never the part summed so far', async () => {
    await mountPage(completeSample);
    expect(value(counter('spend'))).toBe('$489');

    const loading = structuredClone(completeSample);

    loading.items[0] = {
        ...loading.items[0]!,
        stats: { agentMs: 60_000, tokens: 1000, costUsd: 1000 },
        usageState: 'loading',
    };
    await push(loading);
    expect(value(counter('spend')), 'no partial sum and no plus').toBe('$489');
    expect(nameOf(counter('spend'))).toContain('The last complete total. Usage is still loading.');
    expect(head(await openCounter('spend')), 'the panel gives the part summed so far').toMatch(/so far/);
});

test('while the first read could add items, a count with none is a dash, one with items its number, and empty panels show the loader', async () => {
    const data = structuredClone(completeSample);

    await mountPage({ ...data, items: data.items.filter((i) => i.status === 'Done'), firstRead });
    expect(counters().slice(0, 4).map(value)).toEqual(['–', '–', '–', '16']);
    for (const label of ['need you', 'shaping', 'building'] as const) {
        expect(nameOf(counter(label))).toBe(`${label}: Still loading projects`);

        const pop = await openCounter(label);

        expect(text(pop.querySelector('p')), `${label} pop-up`).toBe('Loading projects…');
        expect(pop.querySelector('[data-loader]'), `${label} pop-up`).not.toBeNull();
        expect(pop.querySelector('[data-slot="status-popover-footer"]'), `${label} has no foot yet`).toBeNull();
        await close();
    }

    const building = await openCounter('building');

    expect(head(building), 'no zero claimed in the panel either').toBe('BuildingShared limit 2');
    expect(building.querySelector('[data-slot="popover-header"] [style]'), 'no empty limit bars').toBeNull();
    await close();
    await push({ ...data, items: [], firstRead });
    expect(value(counter('shipped'))).toBe('–');

    const pop = await openCounter('shipped');

    expect(text(pop.querySelector('p'))).toBe('Loading projects…');
});

test('picking a row closes the popover and opens that item’s dialog', async () => {
    await mountPage();
    await openCounter('building');
    await settle(() => popup()!.querySelector<HTMLButtonElement>('li button')!.click());
    expect(popup()).toBeNull();
    expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe(
        '#150 Direct streaming from away, with automatic port mapping',
    );
});

test('spend shows the known figures with a plus while some usage is unavailable, and its panel says so below the list', async () => {
    const data = structuredClone(completeSample);

    data.items[0] = { ...data.items[0]!, stats: { agentMs: 60_000, tokens: 1000, costUsd: 200 }, usageState: 'failed' };
    await mountPage(data);
    expect(value(counter('spend'))).toMatch(/^\$[\d,]+\+$/);

    const pop = await openCounter('spend');

    expect(head(pop)).toMatch(/^Agent spend\d+ items\$[\d.,]+ so far · All open work, and recently finished work$/);
    expect(text(pop)).toContain('$200.00');
    expect(foot(pop)).toBe('Partial figures. Some usage is unavailable.');
    expect(
        pop
            .querySelector('[data-counter-list]')!
            .compareDocumentPosition(pop.querySelector('[data-slot="status-popover-footer"]')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        'the notice comes after the list',
    ).toBeTruthy();
});

test('spend shows a dash with no figures known and usage unavailable while the first read runs, its panel says usage is unavailable, and it goes once the read settles with nothing priced', async () => {
    const data = structuredClone(completeSample);

    data.items = [];
    data.itemSourceProblems = [{ repo: 'owner/failed', problem: 'Read failed' }];
    await mountPage({ ...data, firstRead });
    expect(value(counter('spend'))).toBe('–');

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spendUnavailable');
    expect(text(pop.querySelector('p'))).toBe('Usage is unavailable, so nothing is priced.');
    await close();
    await push(data);
    expect(counter('spend'), 'a counter shows only while it has something to count').toBeUndefined();
});

test('unavailable usage takes precedence over loading', async () => {
    const data = structuredClone(completeSample);

    data.items = [];
    await mountPage({ ...data, firstRead, usageRead: { readable: false } });
    expect(counter('spend').querySelector('[data-loader]')).toBeNull();
    expect(value(counter('spend'))).toBe('–');

    const mixed = structuredClone(completeSample);

    mixed.items[0] = { ...mixed.items[0]!, usageState: 'loading' };
    await push({ ...mixed, usageRead: { readable: false } });
    expect(foot(await openCounter('spend'))).toBe('Partial figures. Some usage is unavailable.');
});

test('current PR evidence says failed checks at the row’s end and excludes checks-only waiting from Needs you', async () => {
    hideDesk();
    await mountPage();

    const pop = await openCounter('need you');

    expect(rows().find((row) => row.startsWith('#142'))).toMatch(/Checks failed$/);
    expect(text(pop)).not.toContain('#149');
    expect(rows().some((row) => row.endsWith('Checks running'))).toBe(false);
});

test('spend keeps a visible placeholder while no usage is known', async () => {
    await mountPage({ ...completeSample, items: [], firstRead });
    expect(value(counter('spend'))).toBe('–');
    expect(counter('spend').querySelector('[data-loader]')).toBeNull();
    expect(head(await openCounter('spend'))).toBe('Agent spendLoading');
});
