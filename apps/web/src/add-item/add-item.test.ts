// The Add item dialog: the New work form and each phase of a submission, and the Pick a ticket pane.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, chooseOption, fetchMock, formValue, mountPage, openOptions, push, sample, settle, text } from '../../test/support.ts';
import { pastePlain, selectEnd, typeInto } from '../../test/editor.ts';
import type { BoardData } from '@lar-factory/shared';

beforeEach(() => localStorage.removeItem('lar-board:add-item'));

const withFactory: BoardData = { ...sample, repos: [
  ...sample.repos, { repo: 'maddec01/lar-factory', role: 'The factory', labels: [] }, { repo: 'maddec01/lar-empty', role: 'Empty', labels: [] },
] };
const addButton = () => $<HTMLButtonElement>('.add-item')!;
const dialog = () => $('#add-item-dialog');
const field = <T extends HTMLElement = HTMLInputElement>(id: string) => $<T>(`#${id}`)!;
const submit = () => field<HTMLButtonElement>('item-submit');
const result = () => field('item-result');
const editorArea = () => $('#add-item-dialog [contenteditable]')!;

async function open(data: BoardData = withFactory): Promise<void> {
  await mountPage(data);
  // A click focuses the button it presses.
  addButton().focus();
  await settle(() => addButton().click());
  // The Modal moves focus on the next frame.
  await settle(() => vi.advanceTimersByTime(50));
}

/** Sets a field's value the way typing does, so React hears it. */
async function enter(el: HTMLInputElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await settle(() => el.dispatchEvent(new Event('input', { bubbles: true })));
}

async function fillDraft(): Promise<void> {
  await chooseOption(field('item-kind'), 'Bug');
  await enter(field('item-title'), 'Playback stalls');
  await typeInto(editorArea(), 'After a seek.');
}

const respond = (body: object, status = 200) => fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
const posted = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;

test('Add item opens a dialog with the configured repositories and kinds, and no labels to pick', async () => {
  await open();
  const popup = dialog()!;
  expect(popup.getAttribute('role')).toBe('dialog');
  expect(document.getElementById(popup.getAttribute('aria-labelledby')!)!.textContent).toBe('Add item');
  expect(document.activeElement, 'focus starts on the title').toBe(field('item-title'));
  expect(await openOptions(field('item-repo'))).toEqual(['lar-server', 'lar-apple', 'lar-factory', 'lar-empty']);
  await chooseOption(field('item-repo'), 'lar-server');
  expect(await openOptions(field('item-kind'))).toEqual(['Bug', 'Feature', 'Improvement']);
  await settle(() => $('[role="listbox"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  field('item-title').focus();
  expect(field('item-title').getAttribute('aria-label')).toBe('Title');
  expect(field('item-title').required).toBe(true);
  expect(editorArea().getAttribute('aria-label')).toBe('Description');
  expect([result().getAttribute('role'), result().dataset.slot, result().dataset.tone]).toEqual(['status', 'alert', 'warning']);
  expect(popup.textContent).toContain('Record work in lar-server and add it to List.');
  expect(popup.textContent, 'one line describes it').not.toContain('Capture work for a repository.');
  expect(field<HTMLInputElement>('item-create-issue').disabled).toBe(true);
  expect($('#item-labels')).toBeNull();
});

test('the side panel heads Repository and Kind in small uppercase labels, beside the title and the editor', async () => {
  await open();
  const panel = $('#add-item-dialog aside[aria-label="Details"]')!;
  const labels = [...panel.querySelectorAll<HTMLLabelElement>(':scope > div > label')];
  expect(labels.filter(l => l.htmlFor).map((l) => [l.htmlFor, l.textContent])).toEqual([['item-repo', 'Repository'], ['item-kind', 'Kind']]);
  expect(labels.filter(l => l.htmlFor).every((l) => l.classList.contains('uppercase'))).toBe(true);
  expect(field('item-repo').getAttribute('role')).toBe('combobox');
  expect(field('item-kind').getAttribute('role')).toBe('combobox');
  expect(panel.contains(field('item-title')) || panel.contains(editorArea()), 'the title and editor sit left of it').toBe(false);
});

test.each([['- a\nb', '- a\n- b'], ['1. a\nb', '1. a\n2. b'], ['# h', '# h']])('typing %j in the description creates the item with %j', async (typed, body) => {
  await open();
  await chooseOption(field('item-kind'), 'Bug');
  await enter(field('item-title'), 'Playback stalls');
  await typeInto(editorArea(), typed);
  respond({ item: null, error: null }, 500);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).description).toBe(body);
});

test('a description typed in Add item survives closing and reopening it', async () => {
  await open();
  await typeInto(editorArea(), '- a\nb');
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()).toBeNull();
  await settle(() => addButton().click());
  expect([...editorArea().querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['a', 'b']);
  await chooseOption(field('item-kind'), 'Bug');
  await enter(field('item-title'), 'Playback stalls');
  respond({ item: null, error: null }, 500);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).description).toBe('- a\n- b');
});

test('a description added to over several openings creates the item with all of it', async () => {
  await open();
  const reopen = async () => {
    await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
    await settle(() => vi.advanceTimersByTime(50));
    await settle(() => addButton().click());
  };
  await typeInto(editorArea(), 'x');
  await reopen();
  await selectEnd(editorArea());
  await typeInto(editorArea(), 'y');
  await reopen();
  await selectEnd(editorArea());
  await typeInto(editorArea(), 'z');
  await chooseOption(field('item-kind'), 'Bug');
  await enter(field('item-title'), 'Playback stalls');
  respond({ item: null, error: null }, 500);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).description).toBe('xyz');
});

test('pasted Markdown shows formatted in the description', async () => {
  await open();
  await pastePlain(editorArea(), '## Steps\n\n1. Play\n2. Quit');
  expect(editorArea().querySelector('h2')!.textContent).toBe('Steps');
  expect(editorArea().querySelectorAll('ol > li').length).toBe(2);
});

test('the expand button and Ctrl+Shift+E grow the dialog to the window and back, even while typing in the editor', async () => {
  await open();
  const expand = () => $<HTMLButtonElement>('#add-item-dialog button[data-expand]')!;
  expect([expand().getAttribute('aria-label'), expand().getAttribute('aria-keyshortcuts')]).toEqual(['Expand', 'Control+Shift+E']);
  await settle(() => expand().click());
  expect(dialog()!.style.width).toBe('calc(100vw - 2rem)');
  expect(dialog()!.style.height).toBe('calc(100dvh - (52px + 1rem))');
  expect(expand().getAttribute('aria-label')).toBe('Restore size');
  editorArea().focus();
  await settle(() => editorArea().dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true })));
  expect(dialog()!.style.width, 'restored').toBe('');
  await settle(() => editorArea().dispatchEvent(new KeyboardEvent('keydown', { key: 'E', ctrlKey: true, shiftKey: true, bubbles: true })));
  expect(dialog()!.style.width).toBe('calc(100vw - 2rem)');
  expect(dialog(), 'the shortcut leaves the dialog open').not.toBeNull();
});

test('a draft without a kind is not sent and says why', async () => {
  await open();
  await enter(field('item-title'), 'Playback stalls');
  await settle(() => submit().click());
  expect(fetchMock).not.toHaveBeenCalled();
  expect(result().textContent).toBe('Choose bug, feature or improvement.');
  await enter(field('item-title'), 'Playback stalls on seek');
  expect(result().textContent, 'editing clears the message').toBe('');
});

test('a missing kind moves focus to the Kind control once the title is filled', async () => {
  await open();
  await enter(field('item-title'), 'Playback stalls');
  await settle(() => submit().click());
  expect(document.activeElement).toBe(field('item-kind'));
});

test('the kind dropdown shows each kind with its icon, in the list and in the closed control', async () => {
  await open();
  expect(text(field('item-kind'))).toContain('Choose a kind');
  await openOptions(field('item-kind'));
  expect($$('[role="option"]').map((option) => [text(option), option.querySelectorAll('svg.lucide').length])).toEqual([['Bug', 1], ['Feature', 1], ['Improvement', 1]]);
  await settle(() => $$('[role="option"]')[0]!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(text(field('item-kind'))).toBe('Bug');
  expect(field('item-kind').querySelector('[aria-hidden="true"] svg.lucide-bug')).not.toBeNull();
});

test('picking in a Select clears the message and keeps the draft, and reopening shows the kept values', async () => {
  await open();
  await settle(() => submit().click());
  expect(result().textContent).toBe('Choose bug, feature or improvement.');
  await chooseOption(field('item-kind'), 'Feature');
  expect(result().textContent).toBe('');
  await chooseOption(field('item-repo'), 'lar-apple');
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => addButton().click());
  expect([formValue('repo'), formValue('kind')]).toEqual(['maddec01/lar-apple', 'feature']);
  expect([text(field('item-repo')), text(field('item-kind'))]).toEqual(['lar-apple', 'Feature']);
});

test('the list opens above the dialog, after it in the page, and Escape closes only the list', async () => {
  await open();
  await openOptions(field('item-kind'));
  const list = $('[role="listbox"]')!;
  expect(dialog()!.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING, 'later in the page at the same z-index').toBeTruthy();
  expect(dialog()!.contains(list)).toBe(false);
  expect(list.className).toContain('z-50');
  await settle(() => list.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect($('[role="listbox"]')).toBeNull();
  expect(dialog()).not.toBeNull();
});

test('a repo picked while a message shows is the one posted', async () => {
  await open();
  await settle(() => submit().click());
  expect(result().textContent).toBe('Choose bug, feature or improvement.');
  await chooseOption(field('item-repo'), 'lar-apple');
  expect(formValue('repo')).toBe('maddec01/lar-apple');
  await fillDraft();
  respond({ item: null, error: null }, 500);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).repo).toBe('maddec01/lar-apple');
});

test('submitting posts the draft, shows it sending, then closes and announces the recorded work, which has no ticket number', async () => {
  await open();
  await fillDraft();
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
  await settle(() => submit().click());

  expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/items');
  const body = posted();
  expect(body.draft).toEqual({ createIssue: false, repo: 'maddec01/lar-server', kind: 'bug', title: 'Playback stalls', description: 'After a seek.' });
  expect(typeof body.requestId).toBe('string');
  expect(submit().textContent).toBe('Adding…');
  expect(submit().disabled).toBe(true);
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(true);
  expect(editorArea().getAttribute('contenteditable'), 'the description locks with them').toBe('false');
  expect($('#add-item-form')!.getAttribute('aria-busy')).toBe('true');
  expect(result().textContent).toBe('Adding it to List…');

  const item = { ...sample.items[0]!, id: 'work-501', title: 'Playback stalls', number: 0, url: null };
  const board = { ...sample, items: [...sample.items, item] };
  await settle(() => finish(new Response(JSON.stringify({ item, error: null, board }))));
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog(), 'the dialog closes').toBeNull();
  expect(document.activeElement, 'focus goes back to Add item').toBe(addButton());
  const toast = $('[data-slot="toast"][role="status"] [data-toast]')!;
  expect(toast.textContent).toBe('Added Playback stalls to List. View item Queue');
  expect(toast.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: Added Playback stalls');
  expect(text($('.title-bar .list-button')), 'the board shows the new data').toBe('List5');
});

test('a refused submission keeps the draft for editing', async () => {
  await open();
  await fillDraft();
  respond({ item: null, error: null }, 500);
  await settle(() => submit().click());
  expect(result().textContent).toBe('Request failed (HTTP 500).');
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
  expect(field('item-title').value).toBe('Playback stalls');
});

test('a submission the restarted board can\'t confirm says to check List, and only New item goes on', async () => {
  await open();
  await fillDraft();
  respond({ uncertain: true, error: 'The board restarted. Check List for this item before adding it again.' }, 409);
  await settle(() => submit().click());
  expect(result().textContent).toBe('The board restarted. Check List for this item before adding it again.');
  expect(submit().disabled).toBe(true);
  expect(field<HTMLButtonElement>('item-new').hidden).toBe(false);
});

test('a lost response offers a retry', async () => {
  await open();
  await fillDraft();
  fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  await settle(() => submit().click());
  expect(result().textContent).toBe('The submission response was lost. Retry this submission to recover its result without adding it twice.');
  expect(submit().textContent).toBe('Retry this submission');
});

test('sample mode disables adding and says so', async () => {
  await open({ ...withFactory, capture: { session: 's', enabled: false } });
  expect(submit().disabled).toBe(true);
  expect(result().textContent).toBe('Adding items is disabled in sample mode.');
});

test('the description names the repository picked', async () => {
  await open();
  await chooseOption(field('item-repo'), 'lar-apple');
  expect(dialog()!.textContent).toContain('Record work in lar-apple and add it to List.');
});

test('with no repository onboarded, adding is disabled and says where to add one, but not before the first read, beside a read error or a repository left off the board', async () => {
  const empty = { ...withFactory, repos: [], repositoryConfigProblems: [], error: null };
  const hint = () => $('#item-repo-hint');
  await open(empty);
  expect(submit().disabled).toBe(true);
  expect(dialog()!.textContent).toContain('Record work and add it to List.');
  expect(hint()!.textContent).toBe('No repository is onboarded. Read how to add a repository.');
  expect(field('item-repo').getAttribute('aria-describedby')).toBe('item-repo-hint');
  for (const data of [{ ...empty, error: 'gh: HTTP 502' }, { ...empty, fetchedAt: null },
    { ...empty, repositoryConfigProblems: [{ repo: 'maddec01/lar-apple', problem: 'no .lar-factory.json on its default branch.' }] }]) {
    await push(data);
    expect(hint()).toBeNull();
    expect(field('item-repo').hasAttribute('aria-describedby')).toBe(false);
    expect(submit().disabled).toBe(true);
  }
});

test('opened before the repositories arrive, the dialog picks the first one once they do', async () => {
  await open({ ...withFactory, repos: [], fetchedAt: null });
  await push(withFactory);
  expect(formValue('repo')).toBe('maddec01/lar-server');
  expect(dialog()!.textContent).toContain('Record work in lar-server and add it to List.');
  expect(submit().disabled).toBe(false);
});

test('the dialog opens as the copied Modal, and nothing over the title bar drags', async () => {
  const warnings = vi.spyOn(console, 'warn');
  await open();
  const { noDrag } = addStylesheet();
  const popup = dialog()!;
  expect(popup.dataset.slot).toBe('modal-content');
  expect(popup.getAttribute('aria-describedby'), 'its description names it').toBe('add-item-description');
  expect([popup, $('[data-slot="modal-overlay"]')!].map(noDrag)).toEqual([true, true]);
  expect(warnings.mock.calls.filter((args) => args.some((arg) => /Missing.*Description/.test(String(arg))))).toEqual([]);
});

test('Close returns focus to Add item, and reopening keeps a draft but not a finished item', async () => {
  await open();
  await enter(field('item-title'), 'Half written');
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(addButton());

  await settle(() => addButton().click());
  expect(dialog()).not.toBeNull();
  expect(field('item-title').value).toBe('Half written');

  await fillDraft();
  const item = { ...sample.items[0]!, title: 'Playback stalls', number: 501 };
  respond({ item, error: null, board: withFactory });
  await settle(() => submit().click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()).toBeNull();
  await settle(() => addButton().click());
  expect(field('item-title').value).toBe('');
  expect(result().textContent).toBe('');
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
  expect(submit().textContent).toBe('Add item');
});

/** The fetch calls to `path`, each with its body, if it has one. */
const calls = (path: string) => fetchMock.mock.calls.map((call) => call as unknown as [string, RequestInit | undefined])
  .filter(([url]) => url.startsWith(path)).map(([url, init]) => [url, init?.body ? JSON.parse(String(init.body)) : null]);
const ticketButton = (number: number) => $<HTMLButtonElement>(`[data-ticket="${number}"]`)!;

async function searchFor(query: string): Promise<void> {
  await enter(field('pick-query'), query);
  await settle(() => field<HTMLButtonElement>('pick-search').click());
}

test('Pick a ticket searches the repository picked and lists its open tickets, saying which are on the board already', async () => {
  await open();
  await settle(() => $<HTMLButtonElement>('[data-pane="pick"]')!.click());
  expect($('[data-pane="pick"]')!.getAttribute('aria-pressed')).toBe('true');
  expect(dialog()!.style.height, 'the short pane sizes the dialog to its content').toBe('auto');
  expect([...$('#pick-ticket')!.classList], 'a long result list scrolls above the footer').toEqual(expect.arrayContaining(['min-h-0', 'overflow-y-auto']));
  expect(dialog()!.textContent).toContain('Find an open ticket in lar-server.');
  expect(text($('#pick-ticket'))).toContain('Find tickets outside your list, or open one you’ve already added.');
  await openOptions(field('pick-repo'));
  expect(dialog()!.compareDocumentPosition($('[role="listbox"]')!) & Node.DOCUMENT_POSITION_FOLLOWING, 'the list opens above the dialog').toBeTruthy();
  await settle(() => $$('[role="option"]').find((option) => text(option) === 'lar-apple')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8' }, { number: 9, title: 'Seek is slow', url: 'u9', workId: 'work-9' }], error: null });
  await searchFor('seek');
  expect(calls('/api/tickets')).toEqual([['/api/tickets?repo=maddec01%2Flar-apple&q=seek', null]]);
  expect($$('[data-ticket]').map(text)).toEqual(['#8Seek stalls', '#9Seek is slowAlready added']);
  respond({ tickets: [], error: null });
  await searchFor('nothing');
  expect(text(field('pick-result'))).toBe('No open ticket matches.');
});

test('picking a new ticket closes the dialog and announces it, and one on the board already opens its item', async () => {
  await open();
  await settle(() => $<HTMLButtonElement>('[data-pane="pick"]')!.click());
  respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8' }], error: null });
  await searchFor('seek');
  const item = { ...sample.items[0]!, id: 'work-8', number: 8, title: 'Seek stalls' };
  respond({ item, created: true, error: null, board: { ...sample, items: [...sample.items, item] } });
  await settle(() => ticketButton(8).click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(calls('/api/pick-ticket')).toEqual([['/api/pick-ticket', { repo: 'maddec01/lar-server', number: 8 }]]);
  expect(dialog()).toBeNull();
  expect(text($('[data-slot="toast"][role="status"] [data-toast]'))).toBe('Added #8 Seek stalls to List. View item Queue');

  await settle(() => addButton().click());
  respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8', workId: 'work-8' }], error: null });
  await searchFor('seek');
  respond({ item, created: false, error: null, board: { ...sample, items: [...sample.items, item] } });
  await settle(() => ticketButton(8).click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()).toBeNull();
  expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe('#8 Seek stalls');
});

test('a pick the server refuses keeps the dialog open and says why', async () => {
  await open();
  await settle(() => $<HTMLButtonElement>('[data-pane="pick"]')!.click());
  respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8' }], error: null });
  await searchFor('#8');
  respond({ error: 'maddec01/lar-server has no open ticket #8.' }, 404);
  await settle(() => ticketButton(8).click());
  expect(dialog()).not.toBeNull();
  expect(text(field('pick-result'))).toBe('maddec01/lar-server has no open ticket #8.');
});

test('captured work shows no ticket number, and attaching a ticket keeps its item', async () => {
  const captured = { ...sample.items[0]!, id: 'work-1', number: 0, title: 'Playback stalls', url: null, parent: null, status: 'List' as const, statuses: ['List' as const] };
  await mountPage({ ...withFactory, items: [...sample.items, captured] });
  const { useItemDialogStore } = await import('../item-dialog/item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open('work-1'));
  expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe('Playback stalls');
  await settle(() => $<HTMLButtonElement>('[data-attach-ticket="work-1"]')!.click());
  respond({ tickets: [{ number: 8, title: 'Seek stalls', url: 'u8' }], error: null });
  await enter(field('attach-query'), 'seek');
  await settle(() => field<HTMLButtonElement>('attach-search').click());
  const attached = { ...captured, number: 8, url: 'https://github.com/maddec01/lar-server/issues/8' };
  respond({ error: null, board: { ...withFactory, items: [...sample.items, attached] } });
  await settle(() => ticketButton(8).click());
  expect(calls('/api/attach-ticket')).toEqual([['/api/attach-ticket', { itemId: 'work-1', number: 8 }]]);
  expect(text($('[data-item-dialog] [data-slot="modal-header"] h2'))).toBe('#8 Playback stalls');
  expect($('[data-attach-ticket]'), 'an item with a ticket has none to attach').toBeNull();
});

test('Create issue starts from each repository default and an override applies only to this item', async () => {
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  const repos = [true, false].map((enabled, index) => ({ ...withFactory.repos[index]!, setup: {
    repo: withFactory.repos[index]!.repo, createIssuesFromAddItem: enabled,
    access: { 'publish-ticket': 'allowed', 'tag-ticket': 'refused', 'type-ticket': 'refused' }, ...effectiveVocabulary(),
  } })) as BoardData['repos'];
  respond({ options: { provider: 'github', labels: [], types: [], assignees: [], milestones: [], iterations: [], problems: [] } });
  await open({ ...withFactory, repos });
  expect(field<HTMLInputElement>('item-create-issue').checked).toBe(true);
  expect(field<HTMLInputElement>('item-create-issue').disabled).toBe(false);
  await chooseOption(field('item-repo'), 'lar-apple');
  expect(field<HTMLInputElement>('item-create-issue').checked).toBe(false);
  respond({ options: { provider: 'github', labels: ['forbidden'], types: ['Bug'], assignees: [], milestones: [], iterations: [], problems: [] } });
  await settle(() => field<HTMLInputElement>('item-create-issue').click());
  expect($('#item-labels')).toBeNull();
  expect($('#item-type')).toBeNull();
  await fillDraft();
  respond({ error: 'HTTP 403: denied' }, 502);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).createIssue).toBe(true);
  expect(dialog()).not.toBeNull();
  expect(field('item-title').value).toBe('Playback stalls');
});

test('a lost response keeps its request ID after the page reloads', async () => {
  await open();
  await fillDraft();
  fetchMock.mockImplementationOnce(async () => { throw Error('Connection lost'); });
  await settle(() => submit().click());
  const requestId = posted().requestId;
  vi.resetModules();
  await open();
  expect(field('item-title').value).toBe('Playback stalls');
  expect(submit().textContent).toBe('Retry this submission');
  respond({ uncertain: true, error: 'Check the board.' }, 409);
  await settle(() => submit().click());
  expect(posted().requestId).toBe(requestId);
  expect(submit().disabled).toBe(true);
});

const picked = () => $$<HTMLInputElement>('#item-labels input[name="labels"]').map((input) => input.value);
const typedLabels = () => $$<HTMLInputElement>('#item-labels input[name="newLabels"]').map((input) => input.value);
const chips = () => $$('#item-labels [data-label-chip]').map(text);
const choices = () => $$<HTMLLabelElement>('[data-label-choice]');
const choice = (name: string) => choices().find((c) => text(c).startsWith(name))!;
const search = () => $<HTMLInputElement>('[data-label-picker] input[aria-label]')!;
const openPicker = () => settle(() => $<HTMLButtonElement>('#item-labels button')!.click());
const toggle = (name: string) => settle(() => choice(name).querySelector('input')!.click());
const createButton = () => $$<HTMLButtonElement>('[data-label-picker] button').find((b) => text(b).startsWith('Create'));

/** A repository that reads `labels`, whose bug and feature map to labels and which has `access` besides ticket creation. */
function labelledRepo(effectiveVocabulary: typeof import('@lar-factory/shared').effectiveVocabulary, labels: string[], { access = {}, repo = withFactory.repos[0]!.repo, createIssuesFromAddItem = true, bug = ['backend'], feature = ['triage'] }: { access?: object; repo?: string; createIssuesFromAddItem?: boolean; bug?: string[]; feature?: string[] } = {}) {
  const config = { ...withFactory.repos[0]!, repo, setup: {
    repo, createIssuesFromAddItem,
    access: { 'publish-ticket': 'allowed', 'tag-ticket': 'allowed', 'manage-labels': 'allowed', ...access },
    ...effectiveVocabulary({ bug: { type: null, labels: bug }, feature: { type: null, labels: feature } }),
  } } as BoardData['repos'][number];
  const data = { ...withFactory, repos: [config] };
  const provider = repo.split('/').length === 3 ? 'azure' : 'github';
  fetchMock.mockImplementation(async (url) => new Response(JSON.stringify(url.startsWith('/api/ticket-options')
    ? { options: { provider, labels, labelColors: { docs: '0E8A16' }, types: [], assignees: [], milestones: [], iterations: [], problems: [] } }
    : data)));
  return data;
}
const labelSetup = async (labels: string[], options?: Parameters<typeof labelledRepo>[2]) => {
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  await open(labelledRepo(effectiveVocabulary, labels, options));
};

test('the footer has one Add item button with Create issue at its left, and the formatting hint sits under the description', async () => {
  await labelSetup([]);
  const footer = $('#add-item-form [data-slot="modal-footer"]') ?? submit().parentElement!;
  expect(submit().textContent).toBe('Add item');
  expect(footer.contains(field('item-create-issue'))).toBe(true);
  expect(footer.textContent).not.toContain('Formats as you type');
  expect(footer.textContent).not.toContain('Add to List');
  const hint = $$('#add-item-form p').find((p) => text(p) === 'Formats as you type · saved as Markdown')!;
  expect(editorArea().compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect($('aside[aria-label="Details"]')!.contains(hint)).toBe(false);
});

test('Azure uses the same footer wording, and its picker calls them tags', async () => {
  await labelSetup(['docs'], { repo: 'org/project/repo' });
  expect(submit().textContent).toBe('Add item');
  expect(text($('label:has(#item-create-issue)'))).toBe('Create issue');
  expect($('#item-labels')!.getAttribute('aria-label')).toBe('Tags');
});

test('ticking Create issue shows the ticket fields, and unticking hides them and says labels need a ticket', async () => {
  await labelSetup(['docs']);
  await settle(() => vi.advanceTimersByTime(50));
  expect($('#item-labels')).not.toBeNull();
  await settle(() => field<HTMLInputElement>('item-create-issue').click());
  expect($('#item-labels')).toBeNull();
  expect(text($('aside[aria-label="Details"]'))).toContain('Local work has its kind alone. Tick Create issue to add labels. Saved only on this machine.');
  await settle(() => field<HTMLInputElement>('item-create-issue').click());
  expect($('#item-labels')).not.toBeNull();
});

test('Create issue follows the repository until the user changes it, and the change survives closing the dialog', async () => {
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  const repos = [true, false].map((enabled, index) => ({ ...withFactory.repos[index]!, setup: {
    repo: withFactory.repos[index]!.repo, createIssuesFromAddItem: enabled,
    access: { 'publish-ticket': 'allowed' }, ...effectiveVocabulary(),
  } })) as BoardData['repos'];
  const data = { ...withFactory, repos };
  fetchMock.mockImplementation(async (url) => new Response(JSON.stringify(url.startsWith('/api/ticket-options')
    ? { options: { provider: 'github', labels: [], types: [], assignees: [], milestones: [], iterations: [], problems: [] } } : data)));
  await open(data);
  const box = () => field<HTMLInputElement>('item-create-issue');
  expect(box().checked).toBe(true);
  await chooseOption(field('item-repo'), 'lar-apple');
  expect(box().checked, 'it follows the repository').toBe(false);
  await chooseOption(field('item-repo'), 'lar-server');
  expect(box().checked, 'and back').toBe(true);
  await settle(() => box().click());
  expect(box().checked).toBe(false);
  await chooseOption(field('item-repo'), 'lar-apple');
  await settle(() => box().click());
  await chooseOption(field('item-repo'), 'lar-server');
  expect(box().checked, 'the choice stays through repository changes').toBe(true);
  await settle(() => box().click());
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => addButton().click());
  expect(box().checked, 'and through closing the dialog').toBe(false);
});

test('without create access the checkbox is off and disabled with the reason, in the footer, and submits local work', async () => {
  await labelSetup(['docs'], { access: { 'publish-ticket': 'refused' } });
  const box = field<HTMLInputElement>('item-create-issue');
  expect([box.checked, box.disabled]).toEqual([false, true]);
  const reason = document.getElementById(box.getAttribute('aria-describedby')!)!;
  expect(text(reason)).toContain('publish-ticket');
  expect(submit().parentElement!.contains(reason)).toBe(true);
  expect(text($('aside[aria-label="Details"]'))).not.toContain('Tick Create issue');
  await fillDraft();
  respond({ error: 'Denied' }, 403);
  await settle(() => submit().click());
  expect(posted().draft).toEqual({ repo: withFactory.repos[0]!.repo, kind: 'bug', title: 'Playback stalls', description: 'After a seek.', createIssue: false });
});

test('the picker starts from the kind\'s mapped labels, leaving out one the tracker no longer has, and never offers managed labels', async () => {
  await labelSetup(['backend', 'docs', 'linked-work', 'bug', 'status-done', 'decision-1'], { bug: ['backend', 'renamed-away'] });
  await chooseOption(field('item-kind'), 'Bug');
  expect(picked()).toEqual(['backend']);
  expect(chips()).toEqual(['backend']);
  await openPicker();
  expect(choices().map(text)).toEqual(['backend', 'docs']);
  expect(choice('docs').querySelector<HTMLElement>('[data-label-dot]')!.style.background).toBe('rgb(14, 138, 22)');
});

test("on Azure the picker never offers a repo- tag, and refuses a typed name holding one or a separator", async () => {
  await labelSetup(['repo-lar-api', 'docs'], { repo: 'contoso/Fabrikam%20Fiber/lar-api' });
  await openPicker();
  expect(choices().map(text)).toEqual(['docs']);
  for (const [typed, reason] of [['repo-other', /reserved for the work item's repository/], ['foo; linked-work', /without commas or semicolons/]] as const) {
    await settle(() => { const input = search(); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, typed); input.dispatchEvent(new Event('input', { bubbles: true })); });
    expect(createButton()).toBeUndefined();
    expect(text($('[data-label-picker] [role="alert"]'))).toMatch(reason);
  }
});

test('a managed label the kind maps to stays on the ticket, locked, without being offered', async () => {
  await labelSetup(['bug', 'docs', 'linked-work'], { bug: ['bug'] });
  await chooseOption(field('item-kind'), 'Bug');
  await openPicker();
  expect(picked()).toEqual(['bug']);
  expect(choices().map(text)).toEqual(['docs', 'bug · set by kind']);
  expect(choice('bug').querySelector('input')!.disabled).toBe(true);
});

test('changing kind swaps its mapped labels and keeps what the user picked', async () => {
  await labelSetup(['backend', 'triage', 'docs']);
  await chooseOption(field('item-kind'), 'Bug');
  await openPicker();
  await toggle('docs');
  expect(picked()).toEqual(['backend', 'docs']);
  await settle(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await chooseOption(field('item-kind'), 'Feature');
  expect(picked()).toEqual(['docs', 'triage']);
});

test('a typed label is created on submit, is kept with the draft, and can be unticked', async () => {
  await labelSetup(['backend', 'docs']);
  await chooseOption(field('item-kind'), 'Bug');
  await enter(field('item-title'), 'Playback stalls');
  await openPicker();
  expect(search().placeholder).toBe('Filter or type a new label');
  await enter(search(), 'needs-design');
  expect($$('[data-label-picker] p').some((p) => text(p) === 'No match.'), 'the create button says what to do').toBe(false);
  await settle(() => createButton()!.click());
  expect(search().value).toBe('');
  expect(typedLabels()).toEqual(['needs-design']);
  expect(picked()).toEqual(['backend']);
  expect(chips()).toEqual(['backend', 'needs-designnew']);
  expect(text($('[data-label-picker]'))).toContain('The new label is created when the ticket submits.');
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => addButton().click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(typedLabels(), 'a closed dialog keeps the typed label').toEqual(['needs-design']);
  respond({ error: 'Could not create the label needs-design, so no ticket was created. HTTP 403' }, 502);
  await settle(() => submit().click());
  expect((posted().draft as { options: unknown }).options).toEqual({ labels: ['backend'], newLabels: ['needs-design'] });
  expect(dialog(), 'a failed label creation keeps the draft open').not.toBeNull();
  expect(text(result())).toContain('Could not create the label needs-design');
  expect(field('item-title').value).toBe('Playback stalls');
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
  await openPicker();
  await toggle('needs-design');
  expect(typedLabels()).toEqual([]);
  expect(choice('needs-design'), 'it stays a choice once unticked').toBeDefined();
});

test('a typed label the tracker has by the time the draft reopens becomes an ordinary pick', async () => {
  await labelSetup(['docs']);
  await openPicker();
  await enter(search(), 'needs-design');
  await settle(() => createButton()!.click());
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  labelledRepo(effectiveVocabulary, ['docs', 'needs-design']);
  await settle(() => addButton().click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(typedLabels()).toEqual([]);
  expect(picked()).toEqual(['needs-design']);
  await openPicker();
  expect(choices().map(text)).toEqual(['docs', 'needs-design']);
});

test('Enter on a typed name adds it and does not submit the form', async () => {
  await labelSetup(['docs']);
  await openPicker();
  await enter(search(), 'needs-design');
  const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await settle(() => search().dispatchEvent(key));
  expect(key.defaultPrevented).toBe(true);
  expect(typedLabels()).toEqual(['needs-design']);
  expect(calls('/api/items')).toEqual([]);
});

test.each([['linked-work', /reserved for the factory/], ['bug', /reserved for the item's kind/], ['status-done', /reserved for board status/], ['-x', /hyphen/]])('typing %s is refused with its reason', async (name, reason) => {
  await labelSetup(['docs']);
  await openPicker();
  await enter(search(), name);
  expect(createButton()).toBeUndefined();
  expect(text($('[data-label-picker] [role="alert"]'))).toMatch(reason);
  const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await settle(() => search().dispatchEvent(key));
  expect(typedLabels()).toEqual([]);
});

test('Azure refuses a tag name with a separator', async () => {
  await labelSetup(['docs'], { repo: 'org/project/repo' });
  await openPicker();
  await enter(search(), 'a;b');
  expect(createButton()).toBeUndefined();
  expect(text($('[data-label-picker] [role="alert"]'))).toMatch(/semicolons/);
});

test('without label management access the picker still picks but says why it cannot create', async () => {
  await labelSetup(['docs'], { access: { 'manage-labels': 'refused' } });
  await openPicker();
  expect(search().placeholder).toBe('Filter labels');
  expect(text($('[data-label-picker]'))).not.toContain('created when the ticket submits');
  await enter(search(), 'needs-design');
  expect(createButton()).toBeUndefined();
  expect(text($('[data-label-picker] [role="alert"]'))).toContain('manage-labels');
  await enter(search(), '');
  await toggle('docs');
  expect(picked()).toEqual(['docs']);
});

test('a repository with no labels yet still offers typing one, with label management access', async () => {
  await labelSetup([]);
  await openPicker();
  await enter(search(), 'first');
  await settle(() => createButton()!.click());
  expect(typedLabels()).toEqual(['first']);
});

test('a kind is still required, and local work with Create issue off sends no labels', async () => {
  await labelSetup(['backend', 'docs']);
  await enter(field('item-title'), 'Playback stalls');
  await openPicker();
  await enter(search(), 'needs-design');
  await settle(() => createButton()!.click());
  await settle(() => submit().click());
  expect(text(result())).toContain('Choose bug, feature or improvement.');
  expect(calls('/api/items')).toEqual([]);
  await chooseOption(field('item-kind'), 'Bug');
  await settle(() => field<HTMLInputElement>('item-create-issue').click());
  respond({ error: 'Denied' }, 403);
  await settle(() => submit().click());
  expect(posted().draft).toEqual({ repo: withFactory.repos[0]!.repo, kind: 'bug', title: 'Playback stalls', description: '', createIssue: false });
});

test('provider fields start from only the kind mapping and submit the chosen options', async () => {
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  const config = { ...withFactory.repos[0]!, setup: {
    repo: withFactory.repos[0]!.repo,
    access: { 'publish-ticket': 'allowed', 'tag-ticket': 'allowed', 'type-ticket': 'allowed' },
    ...effectiveVocabulary({ bug: { type: 'Bug', labels: ['backend'] } }),
  } } as BoardData['repos'][number];
  const data = { ...withFactory, repos: [config] };
  fetchMock.mockImplementation(async url => new Response(JSON.stringify(url.startsWith('/api/ticket-options')
    ? { options: { provider: 'github', labels: ['backend', 'triage'], types: ['Bug', 'Task'], assignees: ['writer'], milestones: [{ value: '12', name: 'Next' }], iterations: [], problems: [] } }
    : data)));
  await open(data);
  await fillDraft();
  expect(formValue('type')).toBe('Bug');
  expect(picked()).toEqual(['backend']);
  expect(formValue('assignee')).toBe('');
  expect(formValue('milestone')).toBe('');
  expect($('#item-iteration')).toBeNull();
  await chooseOption(field('item-assignee'), 'writer');
  await chooseOption(field('item-milestone'), 'Next');
  respond({ error: 'Denied' }, 403);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).options).toEqual({ labels: ['backend'], type: 'Bug', assignee: 'writer', milestone: '12' });
});

test('ticket options keep their picks in a kept draft, and changing repository reads the new one', async () => {
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  const repos = withFactory.repos.slice(0, 2).map((repo) => ({ ...repo, setup: {
    repo: repo.repo, createIssuesFromAddItem: true,
    access: { 'publish-ticket': 'allowed', 'tag-ticket': 'allowed', 'type-ticket': 'allowed' }, ...effectiveVocabulary(),
  } })) as BoardData['repos'];
  const data = { ...withFactory, repos };
  const assignees = (repo: string) => repo.includes('apple') ? ['apple-dev'] : ['writer'];
  fetchMock.mockImplementation(async url => new Response(JSON.stringify(url.startsWith('/api/ticket-options')
    ? { options: { provider: 'github', labels: [], types: [], assignees: assignees(url), milestones: [], iterations: [], problems: [] } }
    : data)));
  await open(data);
  await chooseOption(field('item-kind'), 'Bug');
  await chooseOption(field('item-assignee'), 'writer');
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  await settle(() => addButton().click());
  expect(formValue('assignee')).toBe('writer');
  await chooseOption(field('item-repo'), 'lar-apple');
  expect(formValue('assignee'), 'the other repository starts at None').toBe('');
  await chooseOption(field('item-assignee'), 'apple-dev');
  await enter(field('item-title'), 'Playback stalls');
  respond({ error: 'Denied' }, 403);
  await settle(() => submit().click());
  expect(posted().draft).toMatchObject({ repo: 'maddec01/lar-apple', kind: 'bug', options: { assignee: 'apple-dev' } });
});

test('submitting before options load leaves their defaults to the server', async () => {
  const { effectiveVocabulary } = await import('@lar-factory/shared');
  const config = { ...withFactory.repos[0]!, setup: {
    repo: withFactory.repos[0]!.repo, access: { 'publish-ticket': 'allowed' }, ...effectiveVocabulary(),
  } } as BoardData['repos'][number];
  const data = { ...withFactory, repos: [config] };
  fetchMock.mockImplementation(async url => url.startsWith('/api/ticket-options') ? new Promise<Response>(() => {}) : new Response(JSON.stringify(data)));
  await open(data);
  await fillDraft();
  respond({ error: 'Denied' }, 403);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).options).toEqual({});
});

test('denied creation offers Recheck access without losing the current draft', async () => {
  await open();
  await fillDraft();
  expect(field<HTMLInputElement>('item-create-issue').disabled).toBe(true);
  const recheck = [...dialog()!.querySelectorAll<HTMLButtonElement>('button')].find(button => text(button) === 'Recheck access');
  expect(recheck).toBeDefined();
  respond(withFactory);
  await settle(() => recheck!.click());
  expect(posted()).toMatchObject({ repo: withFactory.repos[0]!.repo, change: 'recheck' });
  expect(field<HTMLInputElement>('item-title').value).toBe('Playback stalls');
  expect(formValue('kind')).toBe('bug');
  expect(text(editorArea())).toBe('After a seek.');
  expect(dialog()).not.toBeNull();
});
