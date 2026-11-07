// The board search as the page shows it: the field and its shortcut, and the dialog that sets Scope, Kind and Labels,
// runs actions, and opens Settings and tickets.

import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item, RepositorySetup } from '@lar-factory/shared';
import { expect, test, vi } from 'vite-plus/test';

import { $, $$, NOW, mountPage, sample, settle, stubApp, text, toolChecks, updatesOff } from '@/test/PageTest';

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
const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const withItems = (items: Item[]): BoardData => ({ ...sample, items });
const seed = (kinds: string[], labels: string[] = []) =>
    localStorage.setItem(FILTERS_KEY, JSON.stringify({ kinds, labels }));

const field = () => $<HTMLButtonElement>('[data-search-field]')!;
const dialog = () => $('[data-search-dialog]');
const input = () => $<HTMLInputElement>('[data-search-dialog] input')!;
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
    $$('[data-search-dialog] [role="group"]').map((group) => [
        text(group.querySelector('span')),
        [...group.querySelectorAll('[role="option"] .flex-1')].map((name) => text(name)),
    ]);
const option = (name: string) =>
    $$<HTMLElement>('[data-search-dialog] [role="option"]').find((o) => text(o.querySelector('.flex-1')) === name)!;
const choose = (name: string) => settle(() => option(name).click());
const removes = () => $$('[data-search-dialog] li button').map((button) => button.getAttribute('aria-label'));
const clear = () => settle(() => $<HTMLButtonElement>('[data-search-clear]')!.click());
const saved = () => JSON.parse(localStorage.getItem(FILTERS_KEY)!) as unknown;
const queue = () => $$<HTMLLIElement>('.queue ol > li').map((row) => row.dataset.item);
const scopes = async () => (await import('@/features/filters/ScopeStore')).useScopeStore.getState();

/** Gives the field `room` pixels, each token `width` and the title bar `bar`: jsdom lays nothing out. */
function layOut(room: number, width: number, bar = 1280) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return { width: this.matches('header') ? bar : room } as DOMRect;
    });
    vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(width);
}

const pills = () => [...field().querySelectorAll('[title]')].map((pill) => text(pill));
const count = () => text(field().querySelector('[data-search-count]'));

test.each([
    ['no filters', [], [], 'Search'],
    ['one filter', ['bug'], [], 'Search, filtered by Bug'],
    ['many', ['bug', 'no-kind'], ['docs'], 'Search, filtered by Bug, No kind, docs'],
])('the field names itself with %s', async (_name, kinds, labels, label) => {
    seed(kinds, labels);
    await mountPage();
    expect(field().getAttribute('aria-label')).toBe(label);
    expect(field().getAttribute('aria-haspopup')).toBe('dialog');
});

test('with room, the field shows a magnifier, its tokens, the muted Search and the key hint', async () => {
    seed(['bug'], ['docs']);
    layOut(416, 60);
    await mountPage();
    expect(field().querySelector('svg')).not.toBeNull();
    expect(pills()).toEqual(['Bug', 'docs']);
    expect(text(field())).toBe('BugdocsSearchCtrl K');
    expect(field().className.split(' ')).toContain('text-base-700');
});

test('tokens that do not fit collapse to a count before Search goes, then the field folds to a magnifier with a count', async () => {
    seed(['bug', 'feature'], ['docs']);
    layOut(170, 60);
    await mountPage();
    expect([pills().filter((pill) => pill !== '+2'), count()]).toEqual([['Bug'], '+2']);
    expect(text(field())).toContain('Search');
});

test('at its narrowest the field is its magnifier with the number of filters, and still opens', async () => {
    seed(['bug', 'feature'], ['docs']);
    layOut(60, 60);
    await mountPage();
    expect(field().hasAttribute('data-folded')).toBe(true);
    expect(text(field())).toBe('3');
    expect(field().getAttribute('aria-label')).toBe('Search, filtered by Bug, Feature, docs');
    await openDialog();
    expect(dialog()).not.toBeNull();
});

test('on the narrowest title bar the field folds with room to spare', async () => {
    seed(['bug', 'feature'], ['docs']);
    layOut(189, 60, 320);
    await mountPage();
    expect(field().hasAttribute('data-folded')).toBe(true);
    expect(text(field())).toBe('3');
});

test('just above the narrowest title bar the field keeps the word Search and a count', async () => {
    seed(['bug', 'feature'], ['docs']);
    layOut(110, 60, 360);
    await mountPage();
    expect(field().hasAttribute('data-folded')).toBe(false);
    expect(text(field())).toBe('3Search');
});

test('a token in the closed field only opens the dialog', async () => {
    seed(['bug']);
    layOut(416, 60);
    await mountPage();
    expect(field().querySelector('button, a, [role="button"]')).toBeNull();
    await settle(() => field().querySelector<HTMLElement>('[title="Bug"]')!.click());
    expect(dialog()).not.toBeNull();
    expect(saved()).toEqual({ kinds: ['bug'], labels: [] });
});

test('off Apple platforms Ctrl K opens the dialog, ⌘K does not, and the field says so', async () => {
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

test('on Apple platforms ⌘K opens the dialog, Ctrl K does not, and the hint says ⌘K', async () => {
    vi.spyOn(navigator, 'platform', 'get').mockReturnValue('MacIntel');
    layOut(416, 60);
    await mountPage();
    expect(field().getAttribute('aria-keyshortcuts')).toBe('Meta+K');
    expect(text(field())).toBe('Search⌘K');
    await press('k', { ctrlKey: true });
    expect(dialog()).toBeNull();
    await press('K', { metaKey: true });
    expect(dialog()).not.toBeNull();
});

test('above the missing-t3 notice there is no field and no shortcut', async () => {
    await mountPage({ ...sample, tools: toolChecks({ t3: { result: 'missing' } }) });
    expect($('[data-search-field]')).toBeNull();
    await press('k', { ctrlKey: true });
    expect(dialog()).toBeNull();
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
        'a Project page',
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

test('the dialog lists repositories with All Projects first, in List order, then kinds and labels', async () => {
    await mountPage(withItems([item('Q1', { number: 1, labels: ['docs', 'area: web'] })]));
    await openDialog();
    expect(groups()).toEqual([
        ['Actions', ['Add item', 'List', 'Settings']],
        ['Projects', ['All Projects', 'lar-server', 'lar-apple']],
        ['Kinds', ['Bug', 'Feature', 'Improvement', 'Concept', 'No kind']],
        ['Labels', ['area: web', 'docs']],
    ]);
    expect(option('All Projects').getAttribute('aria-checked')).toBe('true');
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

test('choosing a repository swaps Scope and All Projects clears it, with the dialog open', async () => {
    await mountPage();
    await openDialog();
    await choose('lar-apple');
    expect(removes()).toEqual(['Remove lar-apple']);
    await choose('lar-server');
    expect(removes()).toEqual(['Remove lar-server']);
    await choose('lar-server');
    expect(removes(), 'choosing it again keeps it').toEqual(['Remove lar-server']);
    expect(option('lar-server').getAttribute('aria-checked')).toBe('true');
    await choose('All Projects');
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
    expect(field().getAttribute('aria-label')).toBe('Search');
});

test('typing repeats none of the work the query does not change', async () => {
    await mountPage();
    await openDialog();
    await type('a');
    calls.stageRows = 0;
    calls.pages = 0;
    await type('ab');
    await type('abc');
    expect(calls).toEqual({ stageRows: 0, pages: 0 });
});

test('every query word must match, and an empty list says nothing matches', async () => {
    await mountPage();
    await openDialog();
    await type('PROJECTS all');
    expect(groups()).toEqual([['Projects', ['All Projects']]]);
    await type('zzz');
    expect(groups()).toEqual([]);
    expect(text($('[data-search-dialog] [role="status"]'))).toBe('Nothing matches.');
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

test('whatever the filters hide, the labels stay on offer', async () => {
    seed(['bug']);
    await mountPage(withItems([item('Q1', { number: 1, kind: 'feature', labels: ['docs'] })]));
    await openDialog();
    expect(queue()).toEqual([]);
    expect(groups().at(-1)).toEqual(['Labels', ['docs']]);
});

test('Azure repositories head their labels Tags', async () => {
    const repos = [{ repo: AZURE, role: 'API', items: 'azure-board' as const, team: 'Team', labels: [] }];

    await mountPage({ ...sample, repos, items: [item('Q1', { number: 1, repo: AZURE, labels: ['docs'] })] });
    await openDialog();
    expect(groups().at(-1)).toEqual(['Tags', ['docs']]);
});

test('a picked label no such item shows stays listed and removable', async () => {
    seed([], ['gone']);
    await mountPage(withItems([item('Q1', { number: 1, labels: ['docs'] })]));
    expect(field().getAttribute('aria-label')).toBe('Search, filtered by gone');
    await openDialog();
    expect(groups().at(-1)).toEqual(['Labels', ['docs', 'gone']]);
    expect(option('gone').getAttribute('aria-checked')).toBe('true');
    await choose('gone');
    expect(groups().at(-1)).toEqual(['Labels', ['docs']]);
    expect(queue()).toEqual(['Q1']);
});

test('a saved Scope missing from the board shows no token, and returns with its repository', async () => {
    localStorage.setItem(SCOPE_KEY, 'maddec01/lar-gone');
    await mountPage();
    expect(field().getAttribute('aria-label')).toBe('Search');
    await openDialog();
    expect(removes()).toEqual([]);
    expect($('[data-search-clear]')).toBeNull();
    expect(option('All Projects').getAttribute('aria-checked')).toBe('true');

    const { useBoardStore } = await import('@/services/board/board.hooks');

    await settle(() =>
        useBoardStore
            .getState()
            .receive({ ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: 'maddec01/lar-gone' }] }),
    );
    expect(removes()).toEqual(['Remove lar-gone']);
    expect((await scopes()).savedScope).toBe('maddec01/lar-gone');
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
    ['Settings', '', '.settings-nav'],
    ['Add item from a ticket', 'ticket', '[data-pane]'],
    ['Archive', 'archive', '.settings-nav'],
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

test('each action does what it says', async () => {
    await mountPage();

    const { addItem, settings, list } = await stores();

    await openDialog();
    await choose('List');
    expect(list().open).toBe(true);
    await settle(() => list().setOpen(false));
    await openDialog();
    await type('from a ticket');
    await choose('Add item from a ticket');
    expect(addItem()).toMatchObject({ open: true, pane: 'pick' });
    await settle(() => addItem().setOpen(false));
    await openDialog();
    await choose('Add item');
    expect(addItem()).toMatchObject({ open: true, pane: 'new' });
    await settle(() => addItem().setOpen(false));
    await openDialog();
    await type('archive');
    await choose('Archive');
    expect(settings()).toMatchObject({ open: true, section: 'archive' });
});

test('choosing a Settings section or a single setting opens Settings on the section that holds it', async () => {
    await mountPage();

    const { settings } = await stores();

    await openDialog();
    await type('diagnostics');
    await choose('Diagnostics');
    expect(settings()).toMatchObject({ open: true, section: 'diagnostics' });
    expect(text($('.settings-body'))).toContain('Board server');
    await settle(() => settings().setOpen(false));
    await openDialog();
    await type('full refresh');
    await choose('Full refresh');
    expect(settings()).toMatchObject({ open: true, section: 'general' });
    expect(text($('.settings-body'))).toContain('Full refresh');
});

const UPDATE = { ...updatesOff, enabled: true, status: 'available', availableVersion: '9.9.9', message: null } as const;

test('Update is offered only while it has a step to run, and runs the step the pill does', async () => {
    const downloadUpdate = vi.fn(async () => ({ accepted: true, completed: false, state: UPDATE }));

    stubApp({ getUpdateState: async () => UPDATE, onUpdateState: () => () => {}, downloadUpdate });
    await mountPage();
    await openDialog();
    expect(groups()[0]).toEqual(['Actions', ['Add item', 'List', 'Settings', 'Download the update']]);
    await choose('Download the update');
    expect(dialog()).toBeNull();
    expect(downloadUpdate).toHaveBeenCalledOnce();

    const { useUpdateStore } = await import('@/features/updates/UpdateStore');

    await settle(() => useUpdateStore.setState({ state: { ...UPDATE, status: 'downloading' } }));
    await openDialog();
    expect(groups()[0]).toEqual(['Actions', ['Add item', 'List', 'Settings']]);
});

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
    expect(groups().find(([label]) => label === 'Settings')?.[1]).toContain('Match list size when opening an item');
    await settle(() => option('Search all tickets').click());
    expect(tickets()).toEqual(['Match kept', 'Match hidden']);
    expect(saved()).toEqual({ kinds: ['bug'], labels: [] });
    expect(removes()).toEqual(['Remove Bug']);
    await type('match ');
    expect(tickets(), 'any change to the query narrows them again').toEqual(['Match kept', 'Search all tickets']);
});

test('closing the dialog forgets Search all tickets', async () => {
    seed(['bug']);
    await mountPage(WIDE);
    await openDialog();
    await type('match');
    await choose('Search all tickets');
    await press('Escape');
    await openDialog();
    await type('match');
    expect(tickets()).toEqual(['Match kept', 'Search all tickets']);
});

test('after Search all tickets the highlight is on the first ticket it added', async () => {
    seed(['bug']);
    await mountPage(WIDE);
    await openDialog();
    await type('#');
    await press('ArrowUp');
    await press('Enter');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')!)).toBe(option('Match hidden'));
});

test('Clear filters is offered once typing and while a filter is on; it clears them with the dialog open', async () => {
    seed(['bug']);
    await mountPage();
    await openDialog();
    expect(groups()[0]![1]).not.toContain('Clear filters');
    await type('clear');
    await choose('Clear filters');
    expect(removes()).toEqual([]);
    expect(saved()).toEqual({ kinds: [], labels: [] });
    expect(dialog()).not.toBeNull();
    expect(groups()).toEqual([]);
});

test("a Done ticket older than the board's 7-day window is not listed", async () => {
    const closed = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

    await mountPage(
        withItems([
            item('D1', { number: 1, title: 'Shipped long ago', status: 'Done', closedAt: closed(8) }),
            item('D2', { number: 2, title: 'Shipped lately', status: 'Done', closedAt: closed(6) }),
        ]),
    );
    await openDialog();
    await type('shipped');
    expect(tickets()).toEqual(['Shipped lately']);
});

test('while the first read is unfinished the dialog shows the loading cue, not that nothing matches', async () => {
    await mountPage({ ...sample, items: [], firstRead: { step: 'items', running: [], settled: false } });
    await openDialog();

    const status = () => text($('[data-search-dialog] [role="status"]'));

    expect(status(), 'no tickets are on offer before typing').toBe('');
    await type('zzz');
    expect(groups()).toEqual([]);
    expect(status()).toBe('Loading Projects…');
    expect($('[data-search-dialog] [data-loader]')).not.toBeNull();
});
