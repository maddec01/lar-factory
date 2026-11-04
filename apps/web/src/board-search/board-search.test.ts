// The board search as the page shows it: the field and its shortcut, and the dialog that sets Scope, Kind and Labels.

import { expect, test, vi } from 'vite-plus/test';
import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item, RepositorySetup } from '@lar-factory/shared';
import { $, $$, mountPage, sample, settle, text, toolChecks } from '../../test/support.ts';

const FILTERS_KEY = 'lar-board:filters:board';
const SCOPE_KEY = 'lar-board:scope';
const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const withItems = (items: Item[]): BoardData => ({ ...sample, items });
const seed = (kinds: string[], labels: string[] = []) => localStorage.setItem(FILTERS_KEY, JSON.stringify({ kinds, labels }));

const field = () => $<HTMLButtonElement>('[data-search-field]')!;
const dialog = () => $('[data-search-dialog]');
const input = () => $<HTMLInputElement>('[data-search-dialog] input')!;
const openDialog = () => settle(() => field().click());
const press = (key: string, modifiers: KeyboardEventInit = {}) => settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers })));
const type = (value: string) => settle(() => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input(), value);
  input().dispatchEvent(new Event('input', { bubbles: true }));
});
const groups = () => $$('[data-search-dialog] [role="group"]').map((group) => [
  text(group.querySelector('span')), [...group.querySelectorAll('[role="option"] .truncate')].map((name) => text(name)),
]);
const option = (name: string) => $$<HTMLElement>('[data-search-dialog] [role="option"]').find((o) => text(o.querySelector('.truncate')) === name)!;
const choose = (name: string) => settle(() => option(name).click());
const removes = () => $$('[data-search-dialog] li button').map((button) => button.getAttribute('aria-label'));
const clear = () => settle(() => $<HTMLButtonElement>('[data-search-clear]')!.click());
const saved = () => JSON.parse(localStorage.getItem(FILTERS_KEY)!) as unknown;
const queue = () => $$<HTMLLIElement>('.queue ol > li').map((row) => row.dataset.item);
const scopes = async () => (await import('../board/scope-store.ts')).useScopeStore.getState();

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
  ['the item dialog', async () => {
    const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
    await settle(() => useItemDialogStore.getState().open('I_sample01'));
  }],
  ['the wizard', async () => {
    const { useWizardStore } = await import('../onboarding/wizard-store.ts');
    await settle(() => useWizardStore.getState().start());
  }],
  ['Edit repository', async () => {
    const { useBoardStore } = await import('../board/board-store.ts');
    const { useEditStore } = await import('../repositories/edit-store.ts');
    const setup = { ...effectiveVocabulary(), repo: sample.repos[0]!.repo, role: '', itemSource: { kind: 'issues' }, labels: [], domainDocs: { kind: 'off' }, skills: [], access: {}, sources: {} } as unknown as RepositorySetup;
    await settle(() => useBoardStore.getState().receive({ ...sample, repos: [{ ...sample.repos[0]!, setup }, sample.repos[1]!] }));
    await settle(() => useEditStore.getState().open(sample.repos[0]!.repo));
  }],
  ['Abandon', async () => {
    const { useAbandonStore } = await import('../items/abandon-store.ts');
    await settle(() => useAbandonStore.getState().ask(base));
  }],
];

test.each(OTHER_DIALOGS)('the shortcut does nothing while %s is open', async (_name, open) => {
  await mountPage();
  await open();
  expect($('[role="dialog"], [role="alertdialog"]'), 'the other dialog is open').not.toBeNull();
  await press('k', { ctrlKey: true });
  expect(dialog()).toBeNull();
});

test('the dialog lists repositories with All repositories first, in List order, then kinds and labels', async () => {
  await mountPage(withItems([item('Q1', { number: 1, labels: ['docs', 'area: web'] })]));
  await openDialog();
  expect(groups()).toEqual([
    ['Repositories', ['All repositories', 'lar-server', 'lar-apple']],
    ['Kinds', ['Bug', 'Feature', 'Improvement', 'Concept', 'No kind']],
    ['Labels', ['area: web', 'docs']],
  ]);
  expect(option('All repositories').getAttribute('aria-checked')).toBe('true');
});

test('choosing a kind or label toggles its token, saves it and keeps the dialog open', async () => {
  await mountPage(withItems([item('Q1', { number: 1, kind: 'feature', labels: ['docs'] }), item('Q2', { number: 2, kind: 'bug', labels: ['area: web'] })]));
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

test('choosing a repository swaps Scope and All repositories clears it, with the dialog open', async () => {
  await mountPage();
  await openDialog();
  await choose('lar-apple');
  expect(removes()).toEqual(['Remove lar-apple']);
  await choose('lar-server');
  expect(removes()).toEqual(['Remove lar-server']);
  await choose('lar-server');
  expect(removes(), 'choosing it again keeps it').toEqual(['Remove lar-server']);
  expect(option('lar-server').getAttribute('aria-checked')).toBe('true');
  await choose('All repositories');
  expect(removes()).toEqual([]);
  expect(localStorage.getItem(SCOPE_KEY)).toBeNull();
  expect(dialog()).not.toBeNull();
});

test('the arrow keys and Enter choose an option, and Esc closes', async () => {
  await mountPage();
  await openDialog();
  await press('ArrowDown');
  await press('Enter');
  expect(removes()).toEqual(['Remove lar-server']);
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
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: 'maddec01/lar-gone' }] }));
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

test('every query word must match, and an empty list says nothing matches', async () => {
  await mountPage();
  await openDialog();
  await type('REPOS all');
  expect(groups()).toEqual([['Repositories', ['All repositories']]]);
  await type('zzz');
  expect(groups()).toEqual([]);
  expect(text($('[data-search-dialog] [role="status"]'))).toBe('Nothing matches.');
});

test('labels come from the items in Scope on the desk and the stages', async () => {
  localStorage.setItem(SCOPE_KEY, 'maddec01/lar-apple');
  await mountPage(withItems([
    item('Q1', { number: 1, repo: 'maddec01/lar-apple', labels: ['apple-queued'] }),
    item('D1', { number: 2, repo: 'maddec01/lar-apple', status: 'Verify', labels: ['apple-desk'] }),
    item('O1', { number: 3, repo: 'maddec01/lar-server', labels: ['server-only'] }),
    item('L1', { number: 4, repo: 'maddec01/lar-apple', status: 'List', labels: ['on-list'] }),
  ]));
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
  expect(option('All repositories').getAttribute('aria-checked')).toBe('true');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive({ ...sample, repos: [...sample.repos, { ...sample.repos[0]!, repo: 'maddec01/lar-gone' }] }));
  expect(removes()).toEqual(['Remove lar-gone']);
  expect((await scopes()).savedScope).toBe('maddec01/lar-gone');
});
