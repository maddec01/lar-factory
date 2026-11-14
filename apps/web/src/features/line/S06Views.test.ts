import type { Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { $, mountPage, sample, settle, text } from '@/test/PageTest';

const parent = sample.items.find((item) => item.id === 'I_sample09')!;
const template = sample.items.find((item) => item.id === 'I_sample13')!;
const part = (number: number, extra: Partial<Item> = {}): Item => ({
    ...template,
    id: `b${number}`,
    number,
    title: `Build ${number}`,
    parentId: parent.id,
    repo: 'maddec01/lar-apple',
    status: 'Shaping',
    blockers: [],
    threads: [],
    stats: undefined,
    createdAt: `2026-10-20T00:00:${String(number).padStart(2, '0')}Z`,
    ...extra,
});
const press = (element: Element | null) => settle(() => (element as HTMLElement).click());
const group = () => $(`[data-dossier="${parent.id}"]`)!;
const mount = async (parts: Item[], extra: Partial<Item> = {}) => {
    localStorage.clear();
    // A dossier opens on its parts list; these tests start on its Work map.
    localStorage.setItem(`lar-board:dossier-view:${parent.id}`, 'map');
    await mountPage({ ...sample, items: [{ ...parent, ...extra }, ...parts] });
    await press(group().querySelector('[data-dossier-open]'));
};

test('a growing concept folds every gate and status hold behind its compact summary', async () => {
    const builds = Array.from({ length: 20 }, (_, i) => part(i + 1));
    const holds = builds.flatMap((item) => [
        { workId: item.id, reason: `${item.title}: the current brief needs an approved gate.` },
        { workId: item.id, reason: `${item.title}: status is Shaping; finish shaping first.` },
    ]);

    await mount(builds, {
        conceptBuild: {
            run: null,
            holds,
            members: builds.map((item) => ({
                workId: item.id,
                title: item.title,
                repository: item.repo,
                kind: 'build',
                status: item.status,
                waits: [],
                complete: false,
            })),
        },
    });

    const run = group().querySelector('[data-concept-build-run]')!;
    const disclosure = run.querySelector('details')!;

    expect(text(disclosure.querySelector('summary'))).toBe('Build hold details');
    expect(text(group()).match(/Waiting on 20 gates/g)).toHaveLength(1);
    expect(disclosure.open).toBe(false);
    await press(disclosure.querySelector('summary'));
    expect(disclosure.open).toBe(true);
    expect(run.querySelectorAll('[aria-label="Concept build holds"] li')).toHaveLength(40);
});

test('list and map keep numeric creation order despite status and approval renewal', async () => {
    const parts = [part(10), part(2), part(1, { status: 'Ready' })];

    await mount(parts, {
        conceptBuild: {
            run: null,
            holds: [],
            members: parts.map((item) => ({
                workId: item.id,
                title: item.title,
                repository: item.repo,
                kind: 'build',
                status: item.status,
                waits: [],
                complete: false,
            })),
        },
    });
    expect([...group().querySelectorAll('[data-map-part]')].map((el) => el.getAttribute('data-map-part'))).toEqual([
        'b1',
        'b2',
        'b10',
    ]);
    localStorage.setItem(`lar-board:dossier-view:${parent.id}`, 'list');
    await press([...group().querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Parts list')!);
    expect([...group().querySelectorAll('[data-part]')].map((el) => el.getAttribute('data-part'))).toEqual([
        'b1',
        'b2',
        'b10',
    ]);
});

test('retired parts appear in map history, Show done and details with their survivor relation', async () => {
    const retired = [
        part(4, {
            setAside: true,
            supersededBy: { workId: 'b5', title: 'b05', number: 0, repo: template.repo, url: '', state: 'open' },
        }),
        part(6, { setAside: true }),
    ];

    await mount([part(5)], { retiredParts: retired });
    expect(text(group().querySelector('[data-map-history]'))).toContain('2 retired parts');
    await press(group().querySelector('[data-map-history]'));
    expect(text(group().querySelector('[data-map-history-parts]'))).toContain('Merged into b05');
    expect(text(group().querySelector('[data-map-history-parts]'))).toContain('Set aside');
    await press(group().querySelector('[data-history-part="b4"] button'));
    expect(text($('[data-item-dialog]'))).toContain('Merged into b05');
    expect($('[data-item-dialog] [data-start]')).toBeNull();

    const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

    await settle(() => useItemDialogStore.getState().close());
    await press([...group().querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Parts list')!);
    expect(group().querySelector('[data-part="b4"]')).toBeNull();
    await press([...group().querySelectorAll('button')].find((el) => text(el).startsWith('Show 2 past parts'))!);
    expect(text(group().querySelector('[data-part="b4"]'))).toContain('Merged into b05');
    expect(text(group().querySelector('[data-part="b6"]'))).toContain('Set aside');
});

test('a decision card gives its long project name its own bounded line beside a reachable Decide', async () => {
    const decision = part(4, {
        kind: 'decision',
        decisionMethod: 'grill',
        status: 'Queued',
        repo: 'maddec01/lar-apple',
        title: 'D4: Clarification of bounded fourteen-case fixture coverage',
    });

    await mount([decision]);

    const card = group().querySelector('[data-map-part="b4"]')!;
    const repo = card.querySelector('[data-part-repo]')!;

    expect(card.querySelector('[data-map-head]')!.contains(repo)).toBe(false);
    expect(text(card.querySelector('[data-start]'))).toBe('Decide');
});

test('a linked part held by a ticketless prerequisite names it in full: Start after on its map card, its wait in the list', async () => {
    const title = 'Produce the compatible greeting contract and accepted immutable manifest';
    const build = part(2, {
        status: 'Ready',
        blockers: [{ workId: 'producer', repo: 'other/producer', number: 0, title, state: 'open' }],
    });

    await mount([build], { kind: 'feature' });

    const control = group().querySelector('[data-map-part="b2"] [data-start-after]')!;

    expect(text(control)).toContain(title);

    // The parts list offers no start for a part other work holds; its row says what it waits on.
    await press([...group().querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Parts list')!);
    expect(group().querySelector('[data-part-action] [data-start-after]')).toBeNull();
    expect(text(group().querySelector('[data-part="b2"]'))).toContain(`Blocked · starts after ${title}`);
});

test('a retired prerequisite in history stays unresolved on the map', async () => {
    const retired = part(4, { setAside: true, completion: { complete: false, reasons: ['Set aside'] } });
    const dependent = part(8, {
        blockers: [{ workId: retired.id, repo: retired.repo, number: retired.number, state: 'open' }],
    });

    await mount([dependent], { retiredParts: [retired] });
    expect(text(group().querySelector('[data-edge-label]'))).toContain('1 past prerequisite');
    expect(group().querySelector('[data-edge]')?.getAttribute('stroke-dasharray')).toBe('5 4');
    expect(text(group().querySelector('[data-map-part="b8"]'))).toContain('Waiting');
});
