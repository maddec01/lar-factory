// The board search as the page shows it: the field and its shortcut, and the dialog that sets Scope, Kind and Labels,
// runs actions, and opens Settings and tickets.

import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item, RepositorySetup } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, mountPage, sample, settle, text } from '@/test/PageTest';

// Counts the board work that doesn't depend on the query, which a keystroke must not repeat.
const calls = vi.hoisted(() => ({ stageRows: 0, pages: 0 }));

vi.mock('@/features/line/StageRows', async (actual) => {
    const real = await actual<typeof import('@/features/line/StageRows')>();

    return {
        ...real,
        stageRows: (...args: Parameters<typeof real.stageRows>) => {
            calls.stageRows++;

            return real.stageRows(...args);
        },
    };
});
vi.mock('@/features/settings/SettingsPages', async (actual) => {
    const real = await actual<typeof import('@/features/settings/SettingsPages')>();

    return {
        ...real,
        pages: (...args: Parameters<typeof real.pages>) => {
            calls.pages++;

            return real.pages(...args);
        },
    };
});

const FILTERS_KEY = 'lar-board:filters:board';
const SCOPE_KEY = 'lar-board:scope';
const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const withItems = (items: Item[]): BoardData => ({ ...sample, items });
const seed = (kinds: string[], labels: string[] = []) =>
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ kinds, labels }));

const field = () => $<HTMLButtonElement>('[data-search-field]')!;
const dialog = () => $('[data-command-palette]');
const input = () => $<HTMLInputElement>('[data-command-palette] input')!;
const openDialog = () => settle(() => field().click());
const press = (key: string, modifiers: KeyboardEventInit = {}) =>
    settle(() =>
        document.activeElement!.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
        ),
    );
const type = (value: string) =>
    settle(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
        input().dispatchEvent(new Event('input', { bubbles: true }));
    });
const groups = () =>
    $$('[data-command-palette] [role="group"]').map((group) => [
        text(group.querySelector('span')),
        [...group.querySelectorAll('[role="option"] .flex-1')].map((name) => text(name)),
    ]);
const option = (name: string) =>
    $$<HTMLElement>('[data-command-palette] [role="option"]').find((o) => text(o.querySelector('.flex-1')) === name)!;
const choose = (name: string) => settle(() => option(name).click());
const removes = () => $$('[data-command-palette] li button').map((button) => button.getAttribute('aria-label'));
const clear = () => settle(() => $<HTMLButtonElement>('[data-search-clear]')!.click());
const saved = () => JSON.parse(localStorage.getItem(FILTERS_KEY)!) as unknown;
const queue = () => $$<HTMLLIElement>('[data-stage="queue"] ol > li').map((row) => row.dataset.item);

test('off Apple platforms Ctrl K opens the dialog, ⌘K doesn’t, and the field says so', async () => {
    await mountPage();
    expect(field().getAttribute('aria-keyshortcuts')).toBe('Control+K');
    await press('k', { metaKey: true });
    expect(dialog()).toBeNull();
    await press('k', { ctrlKey: true, shiftKey: true });
    expect(dialog()).toBeNull();
    await press('k', { ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
});

const OTHER_DIALOGS: [string, () => Promise<void>][] = [
    ['Settings', () => settle(() => $<HTMLButtonElement>('.title-bar .open-settings')!.click())],
    ['Add item', () => settle(() => $<HTMLButtonElement>('.title-bar .add-item')!.click())],
    ['List', () => settle(() => $<HTMLButtonElement>('.title-bar .list-button')!.click())],
    [
        'the item dialog',
        async () => {
            const { useItemDialogStore } = await import('@/features/item-dialog/ItemDialogStore');

            await settle(() => useItemDialogStore.getState().open('I_sample01'));
        },
    ],
    [
        'the wizard',
        async () => {
            const { useWizardStore } = await import('@/features/onboarding/WizardStore');

            await settle(() => useWizardStore.getState().start());
        },
    ],
    [
        'a project page',
        async () => {
            const { useBoardStore } = await import('@/services/board/board.hooks');
            const { useSettingsStore } = await import('@/features/settings/SettingsStore');
            const setup = {
                ...effectiveVocabulary(),
                repo: sample.repos[0]!.repo,
                role: '',
                itemSource: { kind: 'issues' },
                labels: [],
                domainDocs: { kind: 'off' },
                skills: [],
                access: {},
                sources: {},
            } as unknown as RepositorySetup;

            await settle(() =>
                useBoardStore
                    .getState()
                    .receive({ ...sample, repos: [{ ...sample.repos[0]!, setup }, sample.repos[1]!] }),
            );
            await settle(() => {
                useSettingsStore.getState().openProject(sample.repos[0]!.repo);
                useSettingsStore.getState().setOpen(true);
            });
        },
    ],
    [
        'Abandon',
        async () => {
            const { useAbandonStore } = await import('@/features/items/AbandonStore');

            await settle(() => useAbandonStore.getState().ask(base));
        },
    ],
];

test.each(OTHER_DIALOGS)('the shortcut does nothing while %s is open', async (_name, open) => {
    await mountPage();
    await open();
    expect($('[role="dialog"], [role="alertdialog"]'), 'the other dialog is open').not.toBeNull();
    await press('k', { ctrlKey: true });
    expect(dialog()).toBeNull();
});

test('choosing a kind or label toggles its token, saves it and keeps the dialog open', async () => {
    await mountPage(
        withItems([
            item('Q1', { number: 1, kind: 'feature', labels: ['docs'] }),
            item('Q2', { number: 2, kind: 'bug', labels: ['area: web'] }),
        ]),
    );
    await openDialog();
    await choose('Bug');
    expect(queue()).toEqual(['Q2']);
    expect(saved()).toEqual({ kinds: ['bug'], labels: [] });
    await choose('docs');
    expect(queue()).toEqual([]);
    expect(removes()).toEqual(['Remove Bug', 'Remove docs']);
    expect(option('Bug').getAttribute('aria-checked')).toBe('true');
    expect(dialog()).not.toBeNull();
    expect(document.activeElement).toBe(input());
    await choose('Bug');
    await choose('docs');
    expect(queue()).toEqual(['Q1', 'Q2']);
    expect(removes()).toEqual([]);
});

test('choosing a repository swaps Scope and All projects clears it, with the dialog open', async () => {
    await mountPage();
    await openDialog();
    await choose('lar-apple');
    expect(removes()).toEqual(['Remove lar-apple']);
    await choose('lar-server');
    expect(removes()).toEqual(['Remove lar-server']);
    await choose('lar-server');
    expect(removes(), 'choosing it again keeps it').toEqual(['Remove lar-server']);
    expect(option('lar-server').getAttribute('aria-checked')).toBe('true');
    await choose('All projects');
    expect(removes()).toEqual([]);
    expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
    expect(dialog()).not.toBeNull();
});

test('the arrow keys and Enter choose an option, and Esc closes', async () => {
    await mountPage();
    await openDialog();
    await type('lar');
    await press('ArrowDown');
    await press('Enter');
    expect(removes()).toEqual(['Remove lar-apple']);
    await press('Escape');
    expect(dialog()).toBeNull();
});

test('each token has a remove button, and Backspace in an empty query removes the last token', async () => {
    seed(['bug'], ['docs']);
    localStorage.setItem(SCOPE_KEY, 'maddec01/lar-apple');
    await mountPage();
    await openDialog();
    expect(removes()).toEqual(['Remove lar-apple', 'Remove Bug', 'Remove docs']);
    await type('a');
    await press('Backspace');
    expect(removes(), 'a query takes the key').toHaveLength(3);
    await type('');
    await press('Backspace');
    expect(removes()).toEqual(['Remove lar-apple', 'Remove Bug']);
    await settle(() => $<HTMLButtonElement>('[aria-label="Remove Bug"]')!.click());
    await press('Backspace');
    expect(removes()).toEqual([]);
    expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
    await press('Backspace');
    expect(dialog(), 'with no tokens the key does nothing').not.toBeNull();
});

test('Clear and Backspace leave a saved Scope that is off the board, which returns with its repository', async () => {
    localStorage.setItem(SCOPE_KEY, 'maddec01/lar-gone');
    seed(['bug'], ['docs']);
    await mountPage();
    await openDialog();
    expect(removes()).toEqual(['Remove Bug', 'Remove docs']);
    await press('Backspace');
    await press('Backspace');
    await press('Backspace');
    expect(removes()).toEqual([]);
    expect(localStorage.getItem(SCOPE_KEY)).toBe('maddec01/lar-gone');
    await choose('Bug');
    await clear();
    expect(removes()).toEqual([]);
    expect(saved()).toEqual({ kinds: [], labels: [] });
    expect(localStorage.getItem(SCOPE_KEY)).toBe('maddec01/lar-gone');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore
            .getState()
            .receive({ ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: 'maddec01/lar-gone' }] }),
    );
    expect(removes()).toEqual(['Remove lar-gone']);
});

test('Clear removes every token, Scope included, and leaves the focus in the field', async () => {
    seed(['bug'], ['docs']);
    localStorage.setItem(SCOPE_KEY, 'maddec01/lar-apple');
    await mountPage();
    await openDialog();
    await clear();
    expect(removes()).toEqual([]);
    expect(saved()).toEqual({ kinds: [], labels: [] });
    expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
    expect($('[data-search-clear]')).toBeNull();
    expect(document.activeElement).toBe(input());
    expect(field().getAttribute('aria-description')).toBeNull();
});

test('labels come from the items in Scope on the desk and the stages', async () => {
    localStorage.setItem(SCOPE_KEY, 'maddec01/lar-apple');
    await mountPage(
        withItems([
            item('Q1', { number: 1, repo: 'maddec01/lar-apple', labels: ['apple-queued'] }),
            item('D1', { number: 2, repo: 'maddec01/lar-apple', status: 'Verify', labels: ['apple-desk'] }),
            item('O1', { number: 3, repo: 'maddec01/lar-server', labels: ['server-only'] }),
            item('L1', { number: 4, repo: 'maddec01/lar-apple', status: 'List', labels: ['on-list'] }),
        ]),
    );
    await openDialog();
    expect(groups().at(-1)).toEqual(['Labels', ['apple-desk', 'apple-queued']]);
});

const stores = async () => ({
    addItem: (await import('@/features/add-item/AddItemStore')).useAddItemStore.getState,
    settings: (await import('@/features/settings/SettingsStore')).useSettingsStore.getState,
    itemDialog: (await import('@/features/item-dialog/ItemDialogStore')).useItemDialogStore.getState,
    list: (await import('@/features/list/ListStore')).useListStore.getState,
});
/** Lets a closed dialog's return of the focus run, which Radix leaves to the next task. */
const returnFocus = () => settle(() => vi.advanceTimersByTime(0));

test.each([
    ['Add item', '', '[data-pane]'],
    ['List', '', '[data-list-modal]'],
    ['Settings', '', '[data-settings-nav]'],
    ['Add item from a ticket', 'ticket', '[data-pane]'],
    ['Archive', 'archive', '[data-settings-nav]'],
] as const)(
    'choosing %s closes the dialog, opens its own, and returns the focus to the field when that closes',
    async (name, query, opened) => {
        await mountPage();
        await openDialog();
        await type(query);
        await choose(name);
        expect(dialog()).toBeNull();
        await returnFocus();
        expect($(opened)).not.toBeNull();
        expect($('[role="dialog"]')!.contains(document.activeElement), 'the focus is in the new dialog').toBe(true);
        await press('Escape');
        await returnFocus();
        expect($('[role="dialog"]')).toBeNull();
        expect(document.activeElement).toBe(field());
    },
);

const WIDE: BoardData = withItems([
    item('K1', { number: 1, title: 'Match kept', kind: 'bug' }),
    item('H1', { number: 2, title: 'Match hidden', kind: 'feature' }),
]);
const tickets = () => groups().find(([label]) => label === 'Tickets')?.[1];

test('choosing a ticket closes the dialog and opens its item dialog, which returns the focus to the field', async () => {
    await mountPage(WIDE);

    const { itemDialog } = await stores();

    await openDialog();
    await type('#2');
    await choose('Match hidden');
    expect(dialog()).toBeNull();
    expect(itemDialog().itemId).toBe('H1');
    await returnFocus();
    expect($('[data-item-dialog]')!.contains(document.activeElement)).toBe(true);
    await press('Escape');
    await returnFocus();
    expect(document.activeElement).toBe(field());
});

test('tokens narrow tickets only, and Search all tickets lists the rest until the query changes, leaving the filters', async () => {
    seed(['bug']);
    await mountPage(WIDE);
    await openDialog();
    await type('match');
    expect(tickets()).toEqual(['Match kept', 'Search all tickets']);
    expect(groups().find(([label]) => label === 'Settings')?.[1]).toContain('Open items full-size with List');
    await settle(() => option('Search all tickets').click());
    expect(tickets()).toEqual(['Match kept', 'Match hidden']);
    expect(saved()).toEqual({ kinds: ['bug'], labels: [] });
    expect(removes()).toEqual(['Remove Bug']);
    await type('match ');
    expect(tickets(), 'any change to the query narrows them again').toEqual(['Match kept', 'Search all tickets']);
});
