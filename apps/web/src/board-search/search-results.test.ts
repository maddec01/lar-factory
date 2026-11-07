import type { BoardData, Item } from '@lar-factory/shared';
import { beforeEach, expect, test, vi } from 'vite-plus/test';

import { NOW, mountPage, sample } from '../../test/support.ts';
import type {
    SearchInput,
    searchResults as SearchResults,
    settingsOptions as SettingsOptions,
} from './search-results.tsx';

// The stores read the page's data as they load.
let searchResults: typeof SearchResults;
let settingsOptions: typeof SettingsOptions;

beforeEach(async () => {
    await mountPage();
    ({ searchResults, settingsOptions } = await import('./search-results.tsx'));
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

test('an empty query lists the everyday actions, then the filters, and neither settings nor tickets', () => {
    const { groups } = results('  ', [item('A', { title: 'Fix the login' })], { filtering: true });

    expect(groups.map(({ label, options }) => [label, options.map(({ name }) => name)])).toEqual([
        ['Actions', ['Add item', 'List', 'Settings']],
        ['Kinds', ['Bug']],
    ]);
});

test.each([
    ['download', 'Download the update'],
    ['install', 'Restart to update'],
] as const)('an update to %s adds its step to the actions', (update, name) => {
    expect(inGroup('Actions', ' ', [], { update })).toEqual(['Add item', 'List', 'Settings', name]);
});

test('typing lists actions, filters, Settings entries and tickets in that order', () => {
    const { groups } = results('e', [item('A', { title: 'Fix the login' })], { filtering: true });

    expect(groups.map(({ label }) => label)).toEqual(['Actions', 'Settings', 'Tickets']);
    expect(results('bug', [item('A', { title: 'A bug' })]).groups.map(({ label }) => label)).toEqual([
        'Kinds',
        'Tickets',
    ]);
    expect(inGroup('Actions', 'item')).toEqual(['Add item', 'Add item from a ticket']);
    expect(inGroup('Actions', 'archive')).toEqual(['Archive']);
});

test('Clear filters is on offer only while a filter is on', () => {
    expect(inGroup('Actions', 'clear', [], { filtering: true })).toEqual(['Clear filters']);
    expect(inGroup('Actions', 'clear')).toBeUndefined();
});

test('a result holds every query word as a case-insensitive substring, in any order', () => {
    const items = [
        item('A', { title: 'Fix the LOGIN page', number: 12 }),
        item('B', { title: 'Fix the footer', number: 34 }),
    ];

    expect(inGroup('Tickets', 'login FIX', items)).toEqual(['Fix the LOGIN page']);
    expect(inGroup('Tickets', 'fix #34', items)).toEqual(['Fix the footer']);
    expect(inGroup('Tickets', 'login footer', items)).toBeUndefined();
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

test('a ticket shows its reference, and its repository and status apart from the words', () => {
    const [ticket] = results('login', [
        item('A', { title: 'Login', number: 12, repo: 'maddec01/lar-server', status: 'Verify' }),
    ]).groups.at(-1)!.options;

    expect([ticket!.hint, ticket!.meta]).toEqual(['#12', 'lar-server · Verify']);

    const [local] = results('login', [item('A', { title: 'Login', number: undefined })]).groups.at(-1)!.options;

    expect(local!.hint).toBeUndefined();
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

test('Settings entries come from each page label and row title, and name their page', () => {
    const settings = results('match list', [], {}).groups.find(({ label }) => label === 'Settings')!.options;

    expect(settings.map(({ name, hint }) => [name, hint])).toEqual([
        ['Match list size when opening an item', 'General'],
    ]);
    expect(inGroup('Settings', 'diagnostics')).toContain('Diagnostics');
    expect(inGroup('Settings', 'diagnostics')).toContain('Board server');

    const data = { ...sample, items: [], retention: {} } as unknown as BoardData;

    expect(inGroup('Settings', 'keep work', [], { data })).toEqual(['Keep work']);
});

test('a row that only shows a note is not offered as a setting', () => {
    expect(inGroup('Settings', 'updates itself')).toBeUndefined();
    expect(inGroup('Settings', 'updates')).toEqual(['Updates']);

    const data = { ...sample, items: [], bundledSkills: [] } as unknown as BoardData;

    expect(inGroup('Settings', "couldn't read", [], { data })).toBeUndefined();
});

test('nothing archived is listed, whatever Archive last read', async () => {
    const { useArchiveStore } = await import('../archive/archive-store.ts');

    useArchiveStore.setState({ items: [item('X', { title: 'Shelved work' })] });

    const data = { ...sample, items: [], retention: {} } as unknown as BoardData;

    expect(names('shelved', [], { data })).toEqual([]);
});

test('Add item starts on New work, and Add item from a ticket on the ticket pane', async () => {
    const { useAddItemStore } = await import('../add-item/add-item-store.ts');
    const action = (name: string) => results('item').groups[0]!.options.find((option) => option.name === name)!;

    action('Add item from a ticket').select();
    expect(useAddItemStore.getState()).toMatchObject({ open: true, pane: 'pick' });
    action('Add item').select();
    expect(useAddItemStore.getState()).toMatchObject({ open: true, pane: 'new' });
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

test('Projects and their settings open the matching Project page from board search', async () => {
    const { effectiveVocabulary } = await import('@lar-factory/shared');
    const { useSettingsStore } = await import('../settings/settings-store.ts');
    const setup = {
        ...effectiveVocabulary(),
        repo: 'team/app',
        role: '',
        access: {},
        sources: {},
        skills: [],
        labels: [],
        domainDocs: { kind: 'off' },
        structureSync: true,
    } as unknown as import('@lar-factory/shared').RepositorySetup;
    const data = {
        ...sample,
        repos: [
            { repo: setup.repo, role: '', labels: [], setup },
            { repo: 'team/unread', role: '', labels: [] },
        ],
    };
    const options = settingsOptions(data, { app: false, targets: null, version: null }, handlers.leave);

    expect(options.find((entry) => entry.name === 'Projects')).toBeDefined();
    expect(options.find((entry) => entry.value === 'project:team/unread')).toBeUndefined();

    const entry = options.find((entry) => entry.name === 'Project skills')!;

    expect(entry.hint).toBe('team/app');
    entry.select();
    expect(useSettingsStore.getState()).toMatchObject({ open: true, section: 'projects', project: 'team/app' });
});
