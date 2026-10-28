// The List modal: the title bar's List button opens it, the left pane picks All, a repository or Draft, the right
// pane shows that group's items with search, Add item, Scope board and the sort menu.

import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, moved, mountPage, push, sample, settle, text } from '../../test/support.ts';
afterEach(() => {
  delete (Element.prototype as Partial<Element>).getAnimations;
});

const listButton = () => $<HTMLButtonElement>('.title-bar button.list-button')!;
const modal = () => $('[role="dialog"][data-list-modal]');
const groups = () => $$<HTMLButtonElement>('[data-list-modal] nav[aria-label="Repositories"] button');
const group = (name: string) => groups().find((b) => b.querySelector('.name')?.textContent === name)!;
const counts = () => groups().map((b) => [text(b.querySelector('.name')), text(b.querySelector('.count'))]);
const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item);
const search = () => $<HTMLInputElement>('[data-list-modal] input[type="search"]')!;
const open = () => settle(() => listButton().click());
const active = () => groups().filter((b) => b.getAttribute('aria-current') === 'page').map((b) => text(b.querySelector('.name')));
const closeTop = () => settle(() => $$<HTMLButtonElement>('[role="dialog"] button[aria-label="Close"]').at(-1)!.click());

async function type(value: string): Promise<void> {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search(), value);
  await settle(() => search().dispatchEvent(new Event('input', { bubbles: true })));
}

/** Opens a Radix menu trigger the way a pointer does. */
const press = (el: Element) => settle(() => {
  el.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
});

test('the title bar\'s List button counts the List and opens the List modal', async () => {
  await mountPage();
  expect(text(listButton())).toBe('List4');
  expect(listButton().title, 'it names itself once its label is screen-reader only').toBe('List');
  expect(modal()).toBeNull();
  await open();
  expect(modal()).not.toBeNull();
  expect(text($('[data-list-modal] h2'))).toBe('List');
});

test('choosing a repository in the left pane shows only its items on the right', async () => {
  await mountPage();
  await open();
  expect(rows()).toEqual(['I_sample02', 'I_sample01', 'I_sample03', 'I_sample04']);
  await settle(() => group('lar-apple').click());
  expect(rows()).toEqual(['I_sample03']);
  expect(group('lar-apple').getAttribute('aria-current')).toBe('page');
  await settle(() => group('Draft').click());
  expect(rows()).toEqual(['I_sample04']);
  await settle(() => group('All repositories').click());
  expect(rows()).toHaveLength(4);
});

test('the left pane lists All, each repository with its count, then Draft under No repository', async () => {
  await mountPage();
  await open();
  expect(counts()).toEqual([['All repositories', '4'], ['lar-server', '2'], ['lar-apple', '1'], ['Draft', '1']]);
  const nav = $('[data-list-modal] nav[aria-label="Repositories"]')!;
  expect(nav.querySelector('[role="group"][aria-label="No repository"] .name')?.textContent).toBe('Draft');
});

test('the repositories go by their items in List, most first, whatever the config\'s order', async () => {
  await mountPage({ ...sample, repos: [...sample.repos].reverse() });
  await open();
  expect(counts()).toEqual([['All repositories', '4'], ['lar-server', '2'], ['lar-apple', '1'], ['Draft', '1']]);
  // The order holds while the search changes the counts.
  await type('subtitle');
  expect(counts().map(([name]) => name)).toEqual(['All repositories', 'lar-server', 'lar-apple', 'Draft']);
});

test('the List modal starts on the board\'s scope', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-apple').click());
  await settle(() => $<HTMLButtonElement>('[data-list-modal] button.scope-board')!.click());
  await closeTop();
  await open();
  expect(active()).toEqual(['lar-apple']);
  expect(rows()).toEqual(['I_sample03']);
});

test('a picked group that leaves shows All repositories, marked as the one picked', async () => {
  await mountPage();
  await open();
  await settle(() => group('Draft').click());
  await push(moved('I_sample04', 'Queued'));
  expect(groups().map((b) => text(b.querySelector('.name')))).not.toContain('Draft');
  expect(active()).toEqual(['All repositories']);
  expect(rows()).toHaveLength(3);
});

test('under All repositories a row names its repository, except a Draft', async () => {
  await mountPage();
  await open();
  const meta = (id: string) => text($(`[data-list-modal] button[data-item="${id}"] span span:last-child`));
  expect(meta('I_sample03')).toMatch(/^lar-apple · /);
  expect(meta('I_sample04')).toMatch(/^draft · /);
});

test('a repository whose items have not landed yet says it is reading, not that its List is empty', async () => {
  const reading = { ...sample, items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
    firstRead: { step: 'items' as const, running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false } };
  await mountPage(reading);
  await open();
  await settle(() => group('lar-apple').click());
  expect(text($('[data-list-modal] .empty'))).toBe('Reading lar-apple…');
  expect(counts().find(([name]) => name === 'lar-apple'), 'no count in the left pane').toEqual(['lar-apple', '']);
  const header = () => text($('[data-list-modal] button.scope-board')!.parentElement);
  expect(header(), 'no count in the header').toBe('lar-appleScope boardRecently updated');
  await push({ ...sample, firstRead: { step: 'finishing', running: [], settled: true } });
  expect(rows()).toEqual(['I_sample03']);
  expect(counts().find(([name]) => name === 'lar-apple')).toEqual(['lar-apple', '1']);
  expect(header()).toBe('lar-apple1Scope boardRecently updated');
});

test('the search filters the right pane and the counts on the left follow it', async () => {
  await mountPage();
  await open();
  await type('subtitle');
  expect(rows()).toEqual(['I_sample03']);
  expect(counts()).toEqual([['All repositories', '1'], ['lar-server', '0'], ['lar-apple', '1'], ['Draft', '0']]);
  await settle(() => group('lar-server').click());
  expect(rows()).toEqual([]);
  expect(text($('[data-list-modal] .empty'))).toBe('Nothing here matches.');
});

test('Scope board scopes the board to the chosen repository, and is only there for a repository', async () => {
  await mountPage();
  await open();
  const scope = () => $<HTMLButtonElement>('[data-list-modal] button.scope-board');
  expect(scope()).toBeNull();
  await settle(() => group('lar-apple').click());
  expect(text(scope())).toBe('Scope board');
  await settle(() => scope()!.click());
  expect(text($('.title-bar button.scope'))).toBe('lar-apple');
  expect(scope()!.getAttribute('aria-pressed')).toBe('true');
  expect(text(scope())).toBe('Board scoped');
  await settle(() => scope()!.click());
  expect(text($('.title-bar button.scope'))).toBe('All repositories');
  expect(text(scope())).toBe('Scope board');
});

test('Scope board is a toggle, so it keeps its own size, not the button kinds\' 28 px', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-apple').click());
  const scope = $('[data-list-modal] button.scope-board')!;
  expect([scope.getAttribute('data-kind'), scope.hasAttribute('data-toggle')]).toEqual(['other', true]);
});

test('the sort menu reorders the items', async () => {
  await mountPage();
  await open();
  const sort = $<HTMLButtonElement>('[data-list-modal] button.sort')!;
  expect(text(sort)).toBe('Recently updated');
  await press(sort);
  const options = $$<HTMLElement>('[role="menuitemradio"]');
  expect(options.map(text)).toEqual(['Recently updated', 'Oldest', 'Title']);
  await settle(() => options[1]!.click());
  expect(rows()).toEqual(['I_sample04', 'I_sample03', 'I_sample01', 'I_sample02']);
  await press($('[data-list-modal] button.sort')!);
  await settle(() => $$<HTMLElement>('[role="menuitemradio"]')[2]!.click());
  expect(rows()).toEqual(['I_sample01', 'I_sample03', 'I_sample04', 'I_sample02']);
});

test('an item opens the item dialog over the List modal, and closing it comes back to the List as it was', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-server').click());
  await type('a');
  await press($('[data-list-modal] button.sort')!);
  await settle(() => $$<HTMLElement>('[role="menuitemradio"]')[2]!.click());
  const before = rows();
  const row = $<HTMLButtonElement>('[data-list-modal] button[data-item="I_sample01"]')!;
  row.focus();
  await settle(() => row.click());
  expect($('[data-item-dialog]'), 'the item dialog is open').not.toBeNull();
  expect(modal(), 'the List modal stays under it').not.toBeNull();
  await closeTop();
  await settle(() => vi.advanceTimersByTime(500));
  expect($('[data-item-dialog]')).toBeNull();
  expect(active()).toEqual(['lar-server']);
  expect(search().value).toBe('a');
  expect(text($('[data-list-modal] button.sort'))).toBe('Title');
  expect(rows()).toEqual(before);
  expect(document.activeElement, 'focus goes back to the row').toBe(row);
});

test('closing the item dialog of an item that left List meanwhile puts focus on the List\'s search', async () => {
  await mountPage();
  await open();
  const row = $<HTMLButtonElement>('[data-list-modal] button[data-item="I_sample01"]')!;
  row.focus();
  await settle(() => row.click());
  await push(moved('I_sample01', 'Queued'));
  expect(row.isConnected, 'its row is gone').toBe(false);
  await closeTop();
  await settle(() => vi.advanceTimersByTime(500));
  expect($('[data-item-dialog]')).toBeNull();
  expect(modal(), 'the List stays open').not.toBeNull();
  expect(document.activeElement).toBe(search());
});

test('Add item looks as it does in the title bar: the List modal\'s Main action, with the same icon', async () => {
  await mountPage();
  await open();
  const add = $('[data-list-modal] button.add-item')!;
  expect(add.getAttribute('data-kind')).toBe('main');
  expect(add.querySelector('svg')!.outerHTML).toBe($('.title-bar button.add-item svg')!.outerHTML);
});

test('Add item opens the Add item flow over the List modal, and closing it hands focus back to Add item', async () => {
  await mountPage();
  await open();
  await settle(() => group('lar-apple').click());
  const add = $<HTMLButtonElement>('[data-list-modal] button.add-item')!;
  add.focus();
  await settle(() => add.click());
  expect($('#add-item-dialog'), 'Add item is open').not.toBeNull();
  expect(modal(), 'the List modal stays under it').not.toBeNull();
  await closeTop();
  await settle(() => vi.advanceTimersByTime(500));
  expect($('#add-item-dialog')).toBeNull();
  expect(active()).toEqual(['lar-apple']);
  expect(document.activeElement, 'focus goes back to Add item').toBe(add);
});

test('the List\'s items sit in the copied Modal.Body, which fades at its scrolled edges', async () => {
  await mountPage();
  await open();
  expect($('[data-list-modal] [data-slot="modal-body"]')!.className).toContain('mask-image');
});
