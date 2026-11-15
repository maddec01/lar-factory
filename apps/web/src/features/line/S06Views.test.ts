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

    expect(text(disclosure.querySelector('summary'))).toBe('0/20 builds done · waiting on 20 approvals');
    expect(text(group()).match(/waiting on 20 approvals/g)).toHaveLength(1);
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
    expect(group().querySelector('[data-map-history]')!.getAttribute('aria-label')).toBe('Show 2 set aside');
    expect(
        group().querySelector('[data-map-history] [data-glyph], [data-map-history] svg'),
        'its done glyph',
    ).not.toBeNull();
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
    // The fold of the done parts, not a part's own "Show slices" toggle.
    await press([...group().querySelectorAll('button')].find((el) => /^Show \d+ (done|set aside)/.test(text(el)))!);
    expect(text(group().querySelector('[data-part="b4"]'))).toContain('Merged into b05');
    expect(text(group().querySelector('[data-part="b6"]'))).toContain('Set aside');
});

test('a decision made in another project names that project under its title, its head naming its kind, step and track, beside a reachable Decide', async () => {
    const decision = part(4, {
        kind: 'decision',
        decisionMethod: 'grill',
        status: 'Queued',
        repo: 'maddec01/lar-apple',
        title: 'D4: Clarification of bounded fourteen-case fixture coverage',
    });

    await mount([decision]);

    const card = group().querySelector('[data-map-part="b4"]')!;

    // A map card's lane names its project; a decision made in another project says which under its title.
    expect(card.querySelector('[data-card-head] [data-part-repo]')).toBeNull();
    expect(text(card.querySelector('[data-map-sub] [data-part-repo]'))).toContain('lar-apple');
    expect(text(card.querySelector('[data-title]'))).toBe(
        '#4 D4: Clarification of bounded fourteen-case fixture coverage',
    );
    expect(text(card.querySelector('[data-col="side"] [data-start]'))).toBe('Decide');
});

test('every map card keeps its head indicators, and its number leads its title as its row’s does, ticket or not', async () => {
    await mount([part(3, { status: 'Ready' }), part(5, { number: 0, partOrder: 5, title: 'Ticketless build' })]);

    const card = (id: string) => group().querySelector(`[data-map-part="${id}"]`)!;
    const head = (id: string) => card(id).querySelector('[data-card-head]')!;

    // The head: the kind in words, the step and its track, and where the ticket lives in the corner.
    expect(text(head('b3'))).toContain('Build');
    expect(text(head('b3'))).toContain('Ready to build');
    expect(head('b3').querySelector('[role="img"][aria-label^="Step "]')).not.toBeNull();
    // A ticket's #3 leads its title; a ticketless part's part number leads its own, once.
    expect(text(card('b3').querySelector('[data-title]'))).toBe('#3 Build 3');
    expect(text(card('b5').querySelector('[data-title]'))).toBe('Part 5 Ticketless build');
    expect(text(card('b5')).match(/Part 5/g)).toHaveLength(1);
});

test('a linked part held by a ticketless prerequisite names it in full: Start after on its map card and its list row, its wait in the list', async () => {
    const title = 'Produce the compatible greeting contract and accepted immutable manifest';
    const build = part(2, {
        status: 'Ready',
        blockers: [{ workId: 'producer', repo: 'other/producer', number: 0, title, state: 'open' }],
    });

    await mount([build], { kind: 'feature' });

    const control = group().querySelector('[data-map-part="b2"] [data-start-after]')!;

    // The button is short; its tooltip names the prerequisite in full.
    expect(text(control)).toBe('Start when unblocked');
    expect(control.getAttribute('title')).toContain(title);

    // The parts list offers the same Start after as the card, so switching views never changes what a part offers; its
    // row says what it waits on.
    await press([...group().querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === 'Parts list')!);
    expect(text(group().querySelector('[data-part="b2"] [data-col="side"] [data-start-after]'))).toBe(
        'Start when unblocked',
    );
    expect(text(group().querySelector('[data-part="b2"]'))).toContain('Blocked by 1 part');
});

test('a retired prerequisite in history stays unresolved on the map', async () => {
    const retired = part(4, { setAside: true, completion: { complete: false, reasons: ['Set aside'] } });
    const dependent = part(8, {
        blockers: [{ workId: retired.id, repo: retired.repo, number: retired.number, state: 'open' }],
    });

    await mount([dependent], { retiredParts: [retired] });
    expect(group().querySelector('[data-map-part="b8"] [data-title]')!.getAttribute('title')).toContain(
        'After 1 past prerequisite',
    );
    expect(text(group().querySelector('[data-edge-label]'))).toBe('1 past prerequisite');
    expect(
        group().querySelector('[data-edge^="history"]')?.getAttribute('stroke-dasharray'),
        'its rail stays dashed, unresolved',
    ).toBe('5 4');
    expect(text(group().querySelector('[data-map-part="b8"] [data-map-facts]'))).toContain('Blocked by #4');
});

test('a card says its queue and gate facts quietly under its title, which its part number leads', async () => {
    await mount([
        part(5, { number: 0, partOrder: 5, title: 'Ticketless build', status: 'List', passingBrief: false }),
        part(6, { status: 'Ready', passingBrief: true }),
    ]);

    const facts = (id: string) => text(group().querySelector(`[data-map-part="${id}"] [data-map-record-state]`));

    expect(text(group().querySelector('[data-map-part="b5"] [data-title]'))).toBe('Part 5 Ticketless build');
    expect(text(group().querySelector('[data-map-part="b5"] [data-map-sub]'))).toBe('Not queued · Brief not approved');
    expect(facts('b6')).toBe('Brief approved');
});

test('a card whose thread is at work says what it does now on a line of its own; one without keeps its look', async () => {
    const now = new Date().toISOString();

    await mount([
        part(3, {
            threads: [
                {
                    id: 'shape-3',
                    title: 'Shaping',
                    purpose: 'shape',
                    state: 'running',
                    updated: now,
                    activity: {
                        available: true,
                        readAt: '2100-01-01T00:00:00.000Z',
                        action: 'Read direct-connection-options.md',
                        actionAt: now,
                        toolRunning: true,
                        agents: [],
                    },
                },
            ],
        }),
        part(4, { status: 'Ready' }),
    ]);

    const line = group().querySelector('[data-map-part="b3"] [data-map-activity] [data-activity]')!;

    expect(line.getAttribute('data-activity')).toBe('working');
    expect(text(line.querySelector('[data-action]'))).toBe('Read direct-connection-options.md');
    expect(line.getAttribute('title'), 'its tooltip says it in full').toContain('Read direct-connection-options.md');
    expect(
        group().querySelector('[data-map-part="b3"] [data-card-head] [role="img"]'),
        'its step and track stay',
    ).not.toBeNull();
    expect(group().querySelector('[data-map-part="b4"] [data-map-activity]')).toBeNull();
});

test('project lanes come first, the concept’s own leading, and Decisions last, whatever waits where', async () => {
    await mount([
        part(3, { kind: 'decision', decisionMethod: 'grill', status: 'Needs you' }),
        part(4, { status: 'Ready', repo: parent.repo }),
        part(5, { status: 'Ready' }),
    ]);

    const lanes = [...group().querySelectorAll('[data-work-map] [data-map-canvas] > div.absolute.left-0')].map((band) =>
        text(band),
    );

    expect(lanes.at(-1)).toBe('Decisions');
    expect(lanes[0]).toBe('Builds');
    expect(group().querySelector('[data-work-map-gutter]'), 'the +n cue floats, with no rule of its own').toBeNull();
});

test('a blocked part whose builds lack access says what it starts after, disabled with why, never a disabled Build', async () => {
    const server = sample.repos.find((repo) => repo.repo === 'maddec01/lar-server')!;
    const blocked = part(2, {
        status: 'Ready',
        repo: server.repo,
        blockers: [{ workId: 'b9', repo: server.repo, number: 9, title: 'Build 9', state: 'open' }],
    });

    localStorage.clear();
    localStorage.setItem(`lar-board:dossier-view:${parent.id}`, 'map');
    await mountPage({
        ...sample,
        repos: sample.repos.map((repo) =>
            repo === server
                ? {
                      ...repo,
                      setup: { ...repo.setup!, access: { ...repo.setup!.access, 'push-branch': 'refused' as const } },
                  }
                : repo,
        ),
        items: [parent, blocked, part(9, { status: 'In progress', repo: server.repo })],
    });
    await press(group().querySelector('[data-dossier-open]'));

    const control = group().querySelector<HTMLButtonElement>('[data-map-part="b2"] [data-col="side"] button')!;

    expect(text(control)).toBe('Start after #9');
    expect(control.disabled).toBe(true);
    expect(control.getAttribute('title')).toMatch(/push branches/);
    expect(text(group().querySelector('[data-map-part="b2"] [data-map-facts]')), 'its state stays').toMatch(/^Blocked/);
});
