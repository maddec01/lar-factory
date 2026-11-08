// The title bar's five counters: need you, shaping, building against the automatic build limit, shipped and spend, always for
// the whole factory. Each opens a popover of every item behind its number; picking one opens the item dialog.

import type { ItemThread } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

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

const counters = () => $$<HTMLButtonElement>('.counters button[aria-haspopup]');
/** A counter's label, as its name starts: "building:". */
const labelOf = (b: Element) => /^[^:]*:/.exec(text(b))?.[0] ?? '';
/** What a screen reader says for a counter: its label, then what its number means: "building: 4 builds open: 2 working, 1 waiting to close, 1 stopped". */
const nameOf = (b: Element) => `${labelOf(b)} ${b.getAttribute('aria-description')}`;
/** The number a counter shows. */
const value = (b: Element) => text(b).slice(labelOf(b).length).trim();
const counter = (label: string) => counters().find((b) => labelOf(b) === `${label}:`)!;
const popup = () => $('[data-state="open"] .counter-popup');
const rows = () => [...popup()!.querySelectorAll('li')].map(textBesideIcon);
/** The popover's head, its title and count, and its foot. */
const head = (pop: HTMLElement) => text(pop.querySelector('[data-counter-head]'));
const foot = (pop: HTMLElement) => text(pop.querySelector('[data-counter-foot]'));
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

test('the counts are the whole factory’s with a repository scoped', async () => {
    await mountPage();

    const before = counters().map(value);

    await openCounter('need you');

    const items = rows();

    await close();

    const { useScopeStore } = await import('@/features/filters/ScopeStore');

    await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
    expect($('[data-search-field]')!.getAttribute('aria-description')).toBe('filtered by lar-apple');
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
    expect(value(counter('building'))).toBe('5');
    expect(nameOf(counter('building'))).toBe(
        'building: 5 builds open · automatic limit 1: 2 working, 1 starting, 1 waiting to close, 1 stopped',
    );
});

test('a concept in progress is no build at work', async () => {
    await mountPage(moved('I_sample09', 'In progress', limited));
    expect(value(counter('building'))).toBe('4');

    const pop = await openCounter('building');

    expect(rows().map((r) => r.split(' ')[0])).not.toContain('#200');
    expect(head(pop)).toBe('Building4Automatic limit 2');
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

test('shipped lists this week’s done items, newest first', async () => {
    await mountPage();

    const pop = await openCounter('shipped');

    expect(head(pop)).toBe('Shipped4last 7 days');
    expect(rows().map((r) => r.split(' ')[0])).toEqual(['#5', '#40', '#203', '#181']);
});

test('spend lists every priced item, highest cost first, with its cost', async () => {
    await mountPage(completeSample);

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spend$198.70');
    expect(rows()).toHaveLength(16);
    expect(rows().slice(0, 3)).toEqual([
        '#150 Direct streaming from away, with automatic port mapping$46.90',
        '#5 Crash when a server goes offline mid-playback$41.20',
        '#40 Resume from the stored position$27.00',
    ]);

    const costs = rows().map((row) => Number(/\$([\d.]+)$/.exec(row)![1]));

    expect(costs).toEqual([...costs].sort((a, b) => b - a));
    expect(text(pop)).not.toMatch(/and \d+ more|Top 5/);
    expect(foot(pop)).toBe('16 priced items, an API estimate.');
});

test('while the first read could add items, a count with none is a dash, one with items its number, and empty panels show the loader', async () => {
    const data = structuredClone(completeSample);

    await mountPage({ ...data, items: data.items.filter((i) => i.status === 'Done'), firstRead });
    expect(counters().slice(0, 4).map(value)).toEqual(['–', '–', '–', '4']);
    for (const label of ['need you', 'shaping', 'building'] as const) {
        expect(nameOf(counter(label))).toBe(`${label}: Still loading projects`);

        const pop = await openCounter(label);

        expect(text(pop.querySelector('p')), `${label} pop-up`).toBe('Loading projects…');
        expect(pop.querySelector('[data-loader]'), `${label} pop-up`).not.toBeNull();
        expect(pop.querySelector('[data-counter-foot]'), `${label} has no foot yet`).toBeNull();
        await close();
    }

    const building = await openCounter('building');

    expect(head(building), 'no zero claimed in the panel either').toBe('BuildingAutomatic limit 2');
    expect(building.querySelector('[data-counter-head] [style]'), 'no empty limit bars').toBeNull();
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
    expect(value(counter('spend'))).toMatch(/^\$[\d.,]+\+$/);

    const pop = await openCounter('spend');

    expect(head(pop)).toMatch(/^Agent spend\$[\d.,]+ so far$/);
    expect(text(pop)).toContain('$200.00');
    expect(foot(pop)).toBe('Partial figures. Some usage is unavailable.');
    expect(
        pop.querySelector('[data-counter-list]')!.compareDocumentPosition(pop.querySelector('[data-counter-foot]')!) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        'the notice comes after the list',
    ).toBeTruthy();
});

test('spend shows a dash with no figures known and usage unavailable, and its panel says usage is unavailable', async () => {
    const data = structuredClone(completeSample);

    data.items = [];
    data.itemSourceProblems = [{ repo: 'owner/failed', problem: 'Read failed' }];
    await mountPage(data);
    expect(value(counter('spend'))).toBe('–');

    const pop = await openCounter('spend');

    expect(head(pop)).toBe('Agent spendUnavailable');
    expect(text(pop.querySelector('p'))).toBe('Usage is unavailable, so nothing is priced.');
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

test('current PR evidence groups failed checks and excludes checks-only waiting from Needs you', async () => {
    await mountPage();

    const pop = await openCounter('need you');
    const groups = [...pop.querySelectorAll('h3')].map((heading) => ({
        heading: text(heading),
        body: text(heading.parentElement),
    }));

    expect(groups.find((group) => group.heading.startsWith('Checks failed'))?.body).toContain('#142');
    expect(text(pop)).not.toContain('#149');
    expect(groups.some((group) => group.heading.startsWith('Checks running'))).toBe(false);
    expect(groups.find((group) => group.heading.startsWith('Ready to merge'))?.body ?? '').not.toContain('#142');
});
