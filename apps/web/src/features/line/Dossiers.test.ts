// The dock's dossiers: each started concept, and each open item with sub-issues on the board: its one line, and expanded
// under it, what keeps the work moving and its parts as a Work map or a list. Ports the old Board view's
// concept block tests.

import type { BoardData, Item } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { $, $$, answer, fresh, holdPosts, mountPage, posted, pressMenu, sample, settle, text } from '@/test/PageTest';

const C200 = 'I_sample09';
const C180 = 'I_sample23';
const dossier = (id = C200) => $(`[data-dossier="${id}"]`)!;
const header = (id = C200) => dossier(id).querySelector<HTMLElement>('[data-item]')!;
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
    flow: 'linked',
    blockers,
});
const withDecision = (blockers?: Item['blockers']) =>
    writable({ ...sample, items: [...sample.items, decision(blockers)] });
const receive = (data: BoardData) =>
    settle(async () => (await import('@/services/board/board.hooks')).useBoardStore.getState().receive(data));
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

const SECTIONS = ['queue', 'shaping', 'ready', 'build', 'dock'];
const panes = () => SECTIONS.filter((id) => $(`[data-stage="${id}"]`));

test('a grouped child reaches the desk with parent context when Projects shows its repository without its parent', async () => {
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
    expect(text($('.desk-row[data-item="I_sample13"]'))).toContain('in #200 lar cloud: sign-in and direct connections');
    // A part that waits on you offers its thread, as the desk's row does; its row opens its details.
    expect(step('I_sample13').querySelector('.row-side [data-open-thread]')).not.toBeNull();
    expect(step('I_sample13').querySelector('[data-row-open]')).not.toBeNull();
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
        expect(!!$('.desk-row[data-item="I_sample13"]')).toBe(
            ['Needs you', 'Verify', 'Ready to merge'].includes(status),
        );
        expect($('[data-stage="shaping"] [data-item="I_sample09"]')).toBeNull();
    }
    // The part's row opens its details; its action opens its thread, as the desk's row does.
    await press(step('I_sample13').querySelector('[data-row-open]')!);
    expect(dialogTitle()).toContain('Owner accounts');
    expect($('[data-item-dialog] [data-open-thread]')).not.toBeNull();
    expect($('[data-item-dialog] a[href="https://github.com/maddec01/lar-server/pull/150"]')).not.toBeNull();
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

test('a part with nothing to wait on is ready to start, with its Start', async () => {
    holdPosts(unblocked());
    await mountOpen(unblocked());

    // Each part shows once, in the list with its own Start; nothing repeats it above the list.
    const ready = step('I_sample13');

    expect(text(ready.querySelector('[data-row-open]'))).toContain('#140 Owner accounts');
    expect(dossier().querySelector('[data-attention-row="ready"]'), 'no Ready to start row repeats it').toBeNull();
    expect(dossier().querySelector('[data-attention-row="waiting"]'), 'nothing waits').toBeNull();
    await pressMenu(startIn(ready)!);
    expect(dialogTitle(), 'Start opens its menu, not the dialog').toBe('');
    await press(entries()[1]!);
    expect(posted()).toEqual([
        ['/api/start-build', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }],
    ]);
});

test('a Queued decision shows only Start after while a blocker is open, naming the last open one', async () => {
    const data = withDecision([
        { number: 201, repo: 'maddec01/lar-server', state: 'open' },
        { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
        { number: 140, repo: 'maddec01/lar-server', state: 'open' },
    ]);

    holdPosts(data);

    // The parts list says what a held part waits on; its Work map card offers Start after.
    const map = await mapOpen(data);
    const card = () => map.querySelector('[data-map-part="I_d204"]')!;

    expect(startIn(card())).toBeNull();

    const after = card().querySelector<HTMLButtonElement>('[data-start-after]')!;

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
    expect(text(card().querySelector('[data-start-after]'))).toBe('Starts after #140 ✓');
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

test('queued empty concepts and parts with off-board parents stay in the dock and keep their desk waits', async () => {
    const concept = { ...c200, status: 'Queued' as const, subIssues: { total: 0, completed: 0 } };
    const part = sample.items.find((item) => item.number === 23)!;

    await mountPage({ ...sample, items: [concept, part] });
    expect(dossier(concept.id)).not.toBeNull();
    expect(dossier(part.id)).not.toBeNull();
    expect($(`[data-stage]:not([data-stage="dock"]) li[data-item="${part.id}"]`)).toBeNull();
    expect($(`[data-stage]:not([data-stage="dock"]) li[data-item="${concept.id}"]`)).toBeNull();
    expect($(`section.desk [data-item="${part.id}"]`)).not.toBeNull();
    expect(text(header(concept.id))).toContain('No parts yet');
    // Its thread's wait reads where its parent would, on the row's one line.
    expect(text(header(part.id))).toContain('Needs you');
    expect(text(header(part.id))).not.toContain('0/0 parts');
    expect(text(header(part.id))).not.toContain('Linked work');
    expect(opener(part.id)).toBeNull();
    await press(header(part.id).querySelector('[data-title]')!);
    expect(dialogTitle()).toContain('Faster library sync');
});

test('the live map follows recorded parts, blockers and gate changes while prose cannot invent Dependencies', async () => {
    const first = workPart('W_first', { status: 'List', passingBrief: false });
    const next = workPart('W_next', {
        status: 'Queued',
        blockers: [{ workId: first.id, number: 0, repo: first.repo, state: 'open' }],
    });
    const change = {
        map: {
            ...c200.map!,
            check: undefined,
            dependencies: ['No external Dependencies are recorded.', 'Invented prose Dependency'],
        },
    };
    const map = await mapOpen(conceptOf([first, next], change));

    const tooltip = () => map.querySelector('[data-map-part="W_first"] [data-title]')!.getAttribute('title');

    expect(map.querySelector('path[data-edge="W_first W_next"]')).not.toBeNull();
    expect(tooltip(), 'the record facts are in the tooltip, the foot says one state').toContain(
        'Not queued · Brief not approved',
    );
    expect(text(dossier())).not.toContain('Invented prose Dependency');
    await receive(
        conceptOf(
            [
                { ...first, status: 'Ready', passingBrief: true },
                { ...next, blockers: [] },
            ],
            change,
        ),
    );
    expect(map.querySelector('path[data-edge="W_first W_next"]')).toBeNull();
    expect(tooltip()).not.toContain('Not queued');
    await receive(conceptOf([{ ...first, status: 'Ready', passingBrief: true }], change));
    expect(map.querySelector('[data-map-part="W_next"]')).toBeNull();
});
