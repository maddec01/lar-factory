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
const inGroup = (label: string, ...args: Parameters<typeof input>) =>
    results(...args)
        .groups.find((group) => group.label === label)
        ?.options.map(({ name }) => name);
/** The tickets, those on the board then the List's, as one list; undefined when neither group shows. */
const tickets = (...args: Parameters<typeof input>) => {
    const found = results(...args).groups.filter(({ label }) => label === 'On the board' || label === 'List');

    return found.length ? found.flatMap((group) => group.options.map(({ name }) => name)) : undefined;
};

test('tickets match on title and reference, never on repository, status or kind', () => {
    const items = [
        item('A', { title: 'Plain', number: 7, repo: 'maddec01/lar-server', status: 'Verify', kind: 'bug' }),
    ];

    expect(tickets('lar-server', items)).toBeUndefined();
    expect(tickets('verify', items)).toBeUndefined();
    expect(tickets('bug', items)).toBeUndefined();
    expect(tickets('#7', items)).toEqual(['#7 Plain']);
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
