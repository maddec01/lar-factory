import type { BoardData, Item } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import type { SearchInput, searchResults as SearchResults, settingsOptions as SettingsOptions } from './SearchResults';
import { NOW, mountPage, sample } from '@/test/PageTest';

// The stores read the page's data as they load.
let searchResults: typeof SearchResults;
let settingsOptions: typeof SettingsOptions;

beforeEach(async () => {
    await mountPage();
    ({ searchResults, settingsOptions } = await import('./SearchResults'));
});

const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({
    ...base,
    id,
    labels: [],
    labelColors: {},
    kind: 'feature',
    status: 'List',
    ...change,
});
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW - days * DAY).toISOString();

const filterGroups = [
    { label: 'Kinds', options: [{ value: 'kind:bug', name: 'Bug', icon: null, select: () => undefined }] },
];
const handlers = { leave: (run: () => void) => run(), clear: vi.fn(), widen: vi.fn() };

const input = (
    query: string,
    items: Item[] = [],
    { data = { ...sample, items } as BoardData, ...change }: Partial<SearchInput> = {},
): SearchInput => ({
    data,
    now: NOW,
    query,
    scope: null,
    filters: { kinds: [], labels: [] },
    widened: false,
    filterGroups,
    filtering: false,
    update: 'none',
    settingOptions: settingsOptions(data, { app: false, targets: null, version: null }, handlers.leave),
    ...change,
});
const results = (...args: Parameters<typeof input>) => searchResults(input(...args), handlers);
const names = (...args: Parameters<typeof input>) =>
    results(...args).groups.flatMap((group) => group.options.map(({ name }) => name));
const inGroup = (label: string, ...args: Parameters<typeof input>) =>
    results(...args)
        .groups.find((group) => group.label === label)
        ?.options.map(({ name }) => name);
/** The tickets, those on the board then the List's, as one list; undefined when neither group shows. */
const tickets = (...args: Parameters<typeof input>) => {
    const found = results(...args).groups.filter(({ label }) => label === 'On the board' || label === 'List');

    return found.length ? found.flatMap((group) => group.options.map(({ name }) => name)) : undefined;
};

test.each([
    ['download', 'Download the update'],
    ['install', 'Restart to update'],
] as const)('an update to %s adds its step to the actions', (update, name) => {
    expect(inGroup('Actions', ' ', [], { update })).toEqual(['Add item', 'List', 'Settings', name]);
});

test('Clear filters is on offer only while a filter is on', () => {
    expect(inGroup('Actions', 'clear', [], { filtering: true })).toEqual(['Clear filters']);
    expect(inGroup('Actions', 'clear')).toBeUndefined();
});

test('tickets match on title and reference, never on repository, status or kind', () => {
    const items = [
        item('A', { title: 'Plain', number: 7, repo: 'maddec01/lar-server', status: 'Verify', kind: 'bug' }),
    ];

    expect(tickets('lar-server', items)).toBeUndefined();
    expect(tickets('verify', items)).toBeUndefined();
    expect(tickets('bug', items)).toBeUndefined();
    expect(tickets('#7', items)).toEqual(['#7 Plain']);
});

test('tickets span every status in board order, open work first and Done, limited to its 7-day window, last', () => {
    const items = [
        item('D1', { title: 'match done old', status: 'Done', closedAt: ago(8) }),
        item('D2', { title: 'match done new', status: 'Done', closedAt: ago(6) }),
        item('V', { title: 'match verify', status: 'Verify', updatedAt: ago(1) }),
        item('L', { title: 'match list', status: 'List', updatedAt: ago(1) }),
    ];

    expect(inGroup('On the board', 'match', items)).toEqual(['#129 match verify']);
    expect(inGroup('List', 'match', items)).toEqual(['#129 match list']);
    expect(inGroup('Recently finished', 'match', items)).toEqual(['#129 match done new']);
    expect(
        results('match', items)
            .groups.map((group) => group.label)
            .filter((label) => ['On the board', 'List', 'Recently finished'].includes(label)),
    ).toEqual(['On the board', 'List', 'Recently finished']);
});

test('a ticket says what the board says for it: a part its hold or Done, a List ticket only its project, under List', () => {
    const items = [
        item('P15', {
            title: 'Sign in first',
            number: 0,
            parentId: 'C',
            partOrder: 15,
            status: 'Ready',
            kind: 'build',
        }),
        item('P26', {
            title: 'match release',
            number: 0,
            parentId: 'C',
            partOrder: 26,
            status: 'Queued',
            kind: 'decision',
            blockers: [{ number: 0, repo: base.repo, state: 'open', workId: 'P15', title: 'Sign in first' }],
        }),
        item('L', { title: 'match listed', repo: 'maddec01/lar-server' }),
        item('P4', { title: 'match done', number: 0, parentId: 'C', partOrder: 4, status: 'Done', kind: 'build' }),
    ];
    const meta = (label: string) =>
        results('match', items)
            .groups.find((group) => group.label === label)!
            .options.map((option) => option.meta);

    expect(meta('On the board')).toEqual([expect.stringMatching(/ · Blocked by Part 15$/)]);
    expect(meta('List')).toEqual(['lar-server']);
    expect(meta('Recently finished')).toEqual([expect.stringMatching(/ · Done$/)]);
});

test("a ticket shows its kind as the board's rows do, by the rows' own kind mark", async () => {
    const { RowKindMark } = await import('@/features/line');
    const items = [
        item('B', { title: 'match bug', kind: 'bug' }),
        item('D', { title: 'match decision', kind: 'decision' }),
    ];
    const icon = (id: string) =>
        results('match', items)
            .groups.flatMap((group) => group.options)
            .find((option) => option.value === `ticket:${id}`)!.icon as { type: unknown; props: { item: Item } };

    expect(icon('B').type).toBe(RowKindMark);
    expect(icon('D').props.item.id).toBe('D');
    // Listed, as the List's rows are, so one item reads with one mark in both.
    expect((icon('B').props as { listed?: boolean }).listed).toBe(true);
});

const FILTERED = [
    item('K', { title: 'match kept', kind: 'bug', repo: 'maddec01/lar-server', updatedAt: ago(1) }),
    item('R', { title: 'match other repo', kind: 'bug', repo: 'maddec01/lar-apple', updatedAt: ago(2) }),
    item('F', { title: 'match feature', kind: 'feature', repo: 'maddec01/lar-server', updatedAt: ago(3) }),
];
const NARROWED = { scope: 'maddec01/lar-server', filters: { kinds: ['bug' as const], labels: [] }, filtering: true };

test('Scope, Kind and Labels narrow tickets only, and a last row offers what they hide', () => {
    const { groups } = results('e', FILTERED, NARROWED);

    const items = groups.find(({ label }) => label === 'List')!;

    expect(items.options.map(({ name }) => name)).toEqual(['#129 match kept', 'Search all tickets']);
    expect(items.options.at(-1)!.hint).toBe('2 more');
    expect(groups.find(({ label }) => label === 'Settings')?.options.length).toBeGreaterThan(0);
    expect(inGroup('Actions', 'e', FILTERED, NARROWED)).toContain('Settings');
});

test('the last row shows even when tokens hide every match, and not when they hide none', () => {
    expect(tickets('other repo', FILTERED, NARROWED)).toEqual(['Search all tickets']);
    expect(tickets('kept', FILTERED, NARROWED)).toEqual(['#129 match kept']);
});

test('once widened, the hidden tickets follow the kept ones, the row goes, and choosing it named the first of them', () => {
    expect(tickets('match', FILTERED, { ...NARROWED, widened: true })).toEqual([
        '#129 match kept',
        '#129 match other repo',
        '#129 match feature',
    ]);

    const row = results('match', FILTERED, NARROWED)
        .groups.find(({ label }) => label === 'List')!
        .options.at(-1)!;

    expect(row.select()).toBe('ticket:R');
    expect(handlers.widen).toHaveBeenCalledOnce();
});

test('nothing archived is listed, whatever Archive last read', async () => {
    const { useArchiveStore } = await import('@/services/archive/archive.hooks');

    useArchiveStore.setState({ items: [item('X', { title: 'Shelved work' })] });

    const data = { ...sample, items: [], retention: {} } as unknown as BoardData;

    expect(names('shelved', [], { data })).toEqual([]);
});

test.each([
    ['a whole read', { step: 'items', running: [], settled: false }, null, true],
    [
        'one repository still reading',
        { step: 'items', running: [], waiting: ['maddec01/lar-apple'], settled: false },
        'maddec01/lar-apple',
        true,
    ],
    [
        'another repository still reading',
        { step: 'items', running: [], waiting: ['maddec01/lar-apple'], settled: false },
        'maddec01/lar-server',
        false,
    ],
    ['a settled read', { step: 'finishing', running: [], settled: true }, null, false],
] as const)('with %s, tickets may yet arrive only once typing asks for them', (_name, firstRead, scope, reading) => {
    const data = { ...sample, items: [], firstRead } as unknown as BoardData;

    expect(results('x', [], { data, scope }).reading).toBe(reading);
    expect(results(' ', [], { data, scope }).reading).toBe(false);
});

test('widened, a read of any repository may still add tickets', () => {
    const firstRead = { step: 'items', running: [], waiting: ['maddec01/lar-apple'], settled: false };
    const data = { ...sample, items: [], firstRead } as unknown as BoardData;

    expect(results('x', [], { data, scope: 'maddec01/lar-server', widened: true }).reading).toBe(true);
});

test('items come before Settings, which lists three matches and More settings for the rest until it is chosen', () => {
    const moreSettings = vi.fn();
    const many = { ...handlers, moreSettings };
    const labels = (change: Partial<SearchInput> = {}) =>
        searchResults(input('e', FILTERED, change), many).groups.map(({ label }) => label);
    const settings = (change: Partial<SearchInput> = {}) =>
        searchResults(input('e', FILTERED, change), many).groups.find(({ label }) => label === 'Settings')!.options;

    expect(labels().indexOf('List')).toBeLessThan(labels().indexOf('Settings'));
    expect(settings().map(({ name }) => name)).toHaveLength(4);
    expect(settings().at(-1)).toMatchObject({ name: 'More settings', hint: expect.stringMatching(/^\d+ more$/) });
    expect(settings().at(-1)!.select()).toBe(settings({ allSettings: true })[3]!.value);
    expect(moreSettings).toHaveBeenCalledOnce();
    expect(settings({ allSettings: true }).length).toBeGreaterThan(4);
    expect(settings({ allSettings: true }).map(({ name }) => name)).not.toContain('More settings');
});

test("a project's settings name it by its short name and still match its owner", () => {
    const project = sample.repos.find((repo) => repo.setup)!.repo;
    const [owner, name] = project.split('/');

    expect(inGroup('Settings', `settings for ${name}`, [], { allSettings: true })).toEqual([`Settings for ${name}`]);
    expect(inGroup('Settings', `${owner} settings for`, [], { allSettings: true })).toContain(`Settings for ${name}`);
});
