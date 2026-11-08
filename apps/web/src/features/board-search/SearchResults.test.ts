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

    expect(inGroup('Tickets', 'lar-server', items)).toBeUndefined();
    expect(inGroup('Tickets', 'verify', items)).toBeUndefined();
    expect(inGroup('Tickets', 'bug', items)).toBeUndefined();
    expect(inGroup('Tickets', '#7', items)).toEqual(['Plain']);
});

test('tickets span every status in board order, with Done limited to its 7-day window', () => {
    const items = [
        item('D1', { title: 'match done old', status: 'Done', closedAt: ago(8) }),
        item('D2', { title: 'match done new', status: 'Done', closedAt: ago(6) }),
        item('V', { title: 'match verify', status: 'Verify', updatedAt: ago(1) }),
        item('L', { title: 'match list', status: 'List', updatedAt: ago(1) }),
    ];

    expect(inGroup('Tickets', 'match', items)).toEqual(['match list', 'match verify', 'match done new']);
});

const FILTERED = [
    item('K', { title: 'match kept', kind: 'bug', repo: 'maddec01/lar-server', updatedAt: ago(1) }),
    item('R', { title: 'match other repo', kind: 'bug', repo: 'maddec01/lar-apple', updatedAt: ago(2) }),
    item('F', { title: 'match feature', kind: 'feature', repo: 'maddec01/lar-server', updatedAt: ago(3) }),
];
const NARROWED = { scope: 'maddec01/lar-server', filters: { kinds: ['bug' as const], labels: [] }, filtering: true };

test('Scope, Kind and Labels narrow tickets only, and a last row offers what they hide', () => {
    const { groups } = results('e', FILTERED, NARROWED);

    expect(groups.at(-1)!.options.map(({ name }) => name)).toEqual(['match kept', 'Search all tickets']);
    expect(groups.at(-1)!.options.at(-1)!.hint).toBe('2 more');
    expect(groups.find(({ label }) => label === 'Settings')?.options.length).toBeGreaterThan(0);
    expect(inGroup('Actions', 'e', FILTERED, NARROWED)).toContain('Settings');
});

test('the last row shows even when tokens hide every match, and not when they hide none', () => {
    expect(inGroup('Tickets', 'other repo', FILTERED, NARROWED)).toEqual(['Search all tickets']);
    expect(inGroup('Tickets', 'kept', FILTERED, NARROWED)).toEqual(['match kept']);
});

test('once widened, the hidden tickets follow the kept ones, the row goes, and choosing it named the first of them', () => {
    expect(inGroup('Tickets', 'match', FILTERED, { ...NARROWED, widened: true })).toEqual([
        'match kept',
        'match other repo',
        'match feature',
    ]);

    const row = results('match', FILTERED, NARROWED).groups.at(-1)!.options.at(-1)!;

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
