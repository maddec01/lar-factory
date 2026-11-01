// The Add item dialog: the New work form and each phase of a submission, and the Pick a ticket pane.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, fetchMock, mountPage, push, sample, settle, text } from '../../test/support.ts';
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

/** Sets a field's value the way typing or picking does, so React hears it. A pick in a select fires
 * `input`, then `change` in a later task, so a re-render between them shows. */
async function enter(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): Promise<void> {
  const proto = Object.getPrototypeOf(el) as object;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, value);
  await settle(() => el.dispatchEvent(new Event('input', { bubbles: true })));
  if (el instanceof HTMLSelectElement) await settle(() => el.dispatchEvent(new Event('change', { bubbles: true })));
}

async function fillDraft(): Promise<void> {
  await enter(field<HTMLSelectElement>('item-kind'), 'bug');
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
  expect($$<HTMLOptionElement>('#item-repo option').map((o) => [o.value, o.textContent])).toEqual([
    ['maddec01/lar-server', 'lar-server'], ['maddec01/lar-apple', 'lar-apple'], ['maddec01/lar-factory', 'lar-factory'],
    ['maddec01/lar-empty', 'lar-empty']]);
  expect($$<HTMLOptionElement>('#item-kind option').map((o) => o.value)).toEqual(['', 'bug', 'feature', 'improvement']);
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
  expect(field('item-repo').tagName).toBe('SELECT');
  expect(field('item-kind').tagName).toBe('SELECT');
  expect(panel.contains(field('item-title')) || panel.contains(editorArea()), 'the title and editor sit left of it').toBe(false);
});

test.each([['- a\nb', '- a\n- b'], ['1. a\nb', '1. a\n2. b'], ['# h', '# h']])('typing %j in the description creates the item with %j', async (typed, body) => {
  await open();
  await enter(field<HTMLSelectElement>('item-kind'), 'bug');
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
  await enter(field<HTMLSelectElement>('item-kind'), 'bug');
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
  await enter(field<HTMLSelectElement>('item-kind'), 'bug');
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

test('a repo picked while a message shows is the one posted', async () => {
  await open();
  await settle(() => submit().click());
  expect(result().textContent).toBe('Choose bug, feature or improvement.');
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-apple');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-apple');
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
  expect(toast.textContent).toBe('Added Playback stalls to List. View item');
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
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-apple');
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
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-server');
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
  expect(submit().textContent).toBe('Add to List');
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
  await enter(field<HTMLSelectElement>('pick-repo'), 'maddec01/lar-apple');
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
  expect(text($('[data-slot="toast"][role="status"] [data-toast]'))).toBe('Added #8 Seek stalls to List. View item');

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
  await enter(field<HTMLSelectElement>('item-repo'), repos[1]!.repo);
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
  expect(field<HTMLSelectElement>('item-type').value).toBe('Bug');
  expect($<HTMLInputElement>('#item-labels input[value="backend"]')!.checked).toBe(true);
  expect($<HTMLInputElement>('#item-labels input[value="triage"]')!.checked).toBe(false);
  expect(field<HTMLSelectElement>('item-assignee').value).toBe('');
  expect(field<HTMLSelectElement>('item-milestone').value).toBe('');
  expect($('#item-iteration')).toBeNull();
  await enter(field<HTMLSelectElement>('item-assignee'), 'writer');
  await enter(field<HTMLSelectElement>('item-milestone'), '12');
  respond({ error: 'Denied' }, 403);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).options).toEqual({ labels: ['backend'], type: 'Bug', assignee: 'writer', milestone: '12' });
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
  expect(field<HTMLSelectElement>('item-kind').value).toBe('bug');
  expect(text(editorArea())).toBe('After a seek.');
  expect(dialog()).not.toBeNull();
});
