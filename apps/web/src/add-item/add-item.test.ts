// The Add item dialog: the form, its repo-dependent fields, and each phase of a submission.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, checkedOf, fetchMock, mountPage, push, sample, settle, text } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';

const withFactory: BoardData = { ...sample, repos: [
  ...sample.repos, { repo: 'maddec01/lar-factory', role: 'The factory', labels: [] }, { repo: 'maddec01/lar-empty', role: 'Empty', labels: [] },
] };
const addButton = () => $<HTMLButtonElement>('.add-item')!;
const dialog = () => $('#add-item-dialog');
const field = <T extends HTMLElement = HTMLInputElement>(id: string) => $<T>(`#${id}`)!;
const submit = () => field<HTMLButtonElement>('item-submit');
const result = () => field('item-result');
const labels = () => $$<HTMLInputElement>('input[name="labels"]').map((input) => input.value);
const box = (label: string) => $$('input[type="checkbox"]').find((each) => each.closest('label')!.textContent === label)!;

async function open(data: BoardData = withFactory): Promise<void> {
  await mountPage(data);
  await settle(() => addButton().click());
  // Base UI moves focus on the next frame.
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
  await enter(field<HTMLTextAreaElement>('item-description'), 'After a seek.');
}

const respond = (body: object, status = 200) => fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify(body), { status }));
const created = { number: 501, html_url: 'https://github.com/maddec01/lar-server/issues/501' };
const posted = () => JSON.parse(String((fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit])[1].body)) as Record<string, unknown>;

test('Add item opens a dialog with the configured repositories, kinds, and the selected repo\'s custom labels', async () => {
  await open();
  const popup = dialog()!;
  expect(popup.getAttribute('role')).toBe('dialog');
  expect(document.getElementById(popup.getAttribute('aria-labelledby')!)!.textContent).toBe('Add item');
  expect(document.activeElement, 'focus starts on the repo select').toBe(field('item-repo'));
  expect($$<HTMLOptionElement>('#item-repo option').map((o) => [o.value, o.textContent])).toEqual([
    ['maddec01/lar-server', 'lar-server'], ['maddec01/lar-apple', 'lar-apple'], ['maddec01/lar-factory', 'lar-factory'],
    ['maddec01/lar-empty', 'lar-empty']]);
  expect($$<HTMLOptionElement>('#item-kind option').map((o) => o.value)).toEqual(['', 'bug', 'feature', 'improvement']);
  expect($('label[for="item-title"]')!.textContent).toBe('Title (required)');
  expect(field('item-title').required).toBe(true);
  expect($('label[for="item-description"]')!.textContent).toBe('Description (optional)');
  expect([result().getAttribute('role'), result().dataset.slot, result().dataset.tone]).toEqual(['status', 'alert', 'warning']);
  expect(popup.textContent).toContain('Create an issue in lar-server and add it to List.');

  expect(labels()).toEqual(['area: server', 'area: web']);
  expect($('.custom-labels')!.textContent).toBe('Labelsarea: serverarea: web');
});

test('changing the repo shows its custom labels, unchecked, and a repo with none or an empty list shows no toggles', async () => {
  await open();
  await settle(() => box('area: web').click());
  await enter(field<HTMLSelectElement>('item-kind'), 'bug');
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-apple');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-apple');
  expect(field<HTMLSelectElement>('item-kind').value, 'the kind stays').toBe('bug');
  expect(labels()).toEqual(['app: music', 'app: video', 'app: photos', 'app: books', 'os: ios', 'os: macos', 'os: tvos', 'os: watchos']);
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-factory');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-factory');
  expect($('.custom-labels'), 'no .lar-factory.json labels').toBeNull();
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-empty');
  expect($('.custom-labels'), 'an empty labels').toBeNull();
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-server');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-server');
  expect(field<HTMLSelectElement>('item-kind').value, 'the kind stays').toBe('bug');
  expect($$<HTMLInputElement>('input[name="labels"]').some((input) => input.checked), 'a repo shown again starts unchecked').toBe(false);
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

test('ticking a box counts as editing and clears the message', async () => {
  await open();
  await settle(() => submit().click());
  expect(result().textContent).toBe('Choose bug, feature or improvement.');
  await settle(() => box('area: web').click());
  expect(checkedOf(box('area: web'))).toBe('true');
  expect(result().textContent).toBe('');
});

test('a repo picked while a message shows is the one posted', async () => {
  await open();
  await settle(() => submit().click());
  expect(result().textContent).toBe('Choose bug, feature or improvement.');
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-apple');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-apple');
  await fillDraft();
  respond({ item: null, issueUrl: null, error: null }, 500);
  await settle(() => submit().click());
  expect((posted().draft as Record<string, unknown>).repo).toBe('maddec01/lar-apple');
});

test('submitting posts the draft, shows it sending, then closes and announces the new item', async () => {
  await open();
  await settle(() => box('area: web').click());
  await fillDraft();
  let finish!: (response: Response) => void;
  fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => (finish = resolve)));
  await settle(() => submit().click());

  expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/items');
  const body = posted();
  expect(body.draft).toEqual({ repo: 'maddec01/lar-server', kind: 'bug', title: 'Playback stalls', description: 'After a seek.', labels: ['area: web'] });
  expect(typeof body.requestId).toBe('string');
  expect(submit().textContent).toBe('Adding…');
  expect(submit().disabled).toBe(true);
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(true);
  expect(box('area: server').hasAttribute('data-disabled'), 'the boxes lock with the fields').toBe(true);
  await settle(() => box('area: server').click());
  expect(checkedOf(box('area: server'))).toBe('false');
  expect($('#add-item-form')!.getAttribute('aria-busy')).toBe('true');
  expect(result().textContent).toBe('Creating the issue and adding it to List…');

  const item = { ...sample.items[0]!, id: 'I_created501', title: 'Playback stalls', number: 501 };
  const board = { ...sample, items: [...sample.items, item] };
  await settle(() => finish(new Response(JSON.stringify({ item, issueUrl: created.html_url, error: null, board }))));
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()!.hidden, 'the dialog closes').toBe(true);
  expect(document.activeElement, 'focus goes back to Add item').toBe(addButton());
  const toast = $('[data-toast][role="status"]')!;
  expect(toast.textContent).toBe('Added #501 Playback stalls to List. View item');
  expect(toast.querySelector('.dismiss')!.getAttribute('aria-label')).toBe('Dismiss: Added #501');
  expect(text($('.title-bar .list-button')), 'the board shows the new data').toBe('List5');
});

test('a created issue the server could not add offers a retry of the same request', async () => {
  await open();
  await fillDraft();
  respond({ item: null, issueUrl: created.html_url, error: 'Could not add it to List.' }, 502);
  await settle(() => submit().click());
  const first = posted();
  expect(result().textContent).toBe('Issue created. Could not add it to List. Retry to finish this issue.View created issue');
  expect(submit().textContent).toBe('Retry this submission');
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(true);
  expect(box('area: server').hasAttribute('data-disabled'), 'the boxes lock with the fields').toBe(true);
  await settle(() => box('area: server').click());
  expect(checkedOf(box('area: server'))).toBe('false');

  respond({ item: null, issueUrl: null, error: 'Still failing.' }, 502);
  await settle(() => submit().click());
  expect(posted().requestId, 'the retry repeats the same request').toBe(first.requestId);
});

test('an error before any issue exists keeps the draft for editing', async () => {
  await open();
  await fillDraft();
  respond({ item: null, issueUrl: null, error: null }, 500);
  await settle(() => submit().click());
  expect(result().textContent).toBe('Request failed (HTTP 500).');
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
  expect(field('item-title').value).toBe('Playback stalls');
});

test('an uncertain creation points at the repo\'s issues and only New item goes on', async () => {
  await open();
  await fillDraft();
  respond({ item: null, issueUrl: null, error: 'GitHub did not answer.', uncertain: true });
  await settle(() => submit().click());
  expect(result().querySelector('a')!.href).toBe('https://github.com/maddec01/lar-server/issues');
  expect(result().querySelector('a')!.textContent).toBe('Check repository issues');
  expect(submit().disabled).toBe(true);
  expect(field<HTMLButtonElement>('item-new').hidden).toBe(false);
});

test('a lost response offers a retry', async () => {
  await open();
  await fillDraft();
  fetchMock.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
  await settle(() => submit().click());
  expect(result().textContent).toBe('The submission response was lost. Retry this submission to recover its result without creating another issue.');
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
  expect(dialog()!.textContent).toContain('Create an issue in lar-apple and add it to List.');
});

test('with no repository onboarded, adding is disabled and says where to add one, but not before the first read, beside a read error or a repository left off the board', async () => {
  const empty = { ...withFactory, repos: [], repositoryConfigProblems: [], error: null };
  const hint = () => $('#item-repo-hint');
  await open(empty);
  expect(submit().disabled).toBe(true);
  expect(dialog()!.textContent).toContain('Create an issue and add it to List.');
  expect(hint()!.textContent).toBe('No repository is onboarded. See Adding a repository in apps/server/README.md.');
  expect(field('item-repo').getAttribute('aria-describedby')).toBe('item-repo-hint');
  addStylesheet();
  expect(getComputedStyle(field('item-kind').closest('.form-field')!).alignContent, 'the hint grows its row without stretching Kind').toBe('start');
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
  expect(dialog()!.textContent).toContain('Create an issue in lar-server and add it to List.');
  expect(labels()).toEqual(['area: server', 'area: web']);
  expect(submit().disabled).toBe(false);
});

test('the dialog opens centred on T3\'s backdrop and glass panel, and nothing over the title bar drags', async () => {
  await open();
  const { noDrag } = addStylesheet();
  const popup = dialog()!;
  const viewport = popup.closest('[data-slot="dialog-viewport"]')!;
  const backdrop = $('[data-slot="dialog-backdrop"]')!;
  expect(viewport.className).toContain('grid-rows-[1fr_auto_1fr]');
  expect(popup.classList).toContain('row-start-2');
  expect(popup.classList).toContain('dialog-glass');
  expect(backdrop.classList).toContain('dialog-backdrop');
  expect([popup, viewport, backdrop].map(noDrag)).toEqual([true, true, true]);
});

test('Close returns focus to Add item, and reopening keeps a draft but not a finished item', async () => {
  await open();
  await enter(field('item-title'), 'Half written');
  await settle(() => $<HTMLButtonElement>('#add-item-dialog button[aria-label="Close"]')!.click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()!.hidden).toBe(true);
  expect(document.activeElement).toBe(addButton());

  await settle(() => addButton().click());
  expect(dialog()!.hidden).toBe(false);
  expect(field('item-title').value).toBe('Half written');

  await fillDraft();
  const item = { ...sample.items[0]!, title: 'Playback stalls', number: 501 };
  respond({ item, issueUrl: created.html_url, error: null, board: withFactory });
  await settle(() => submit().click());
  await settle(() => vi.advanceTimersByTime(50));
  expect(dialog()!.hidden).toBe(true);
  await settle(() => addButton().click());
  expect(field('item-title').value).toBe('');
  expect(result().textContent).toBe('');
  expect(field<HTMLFieldSetElement>('item-fields').disabled).toBe(false);
  expect(submit().textContent).toBe('Add to List');
});

test('on an Azure repository, Only for <repo> starts unticked, and ticked, the draft is only for that repository', async () => {
  const azure: BoardData = { ...withFactory, capture: { session: 's1', enabled: true },
    repos: [...withFactory.repos, { repo: 'contoso/Fabrikam/web', role: 'app', items: 'sprint', team: 'Web', show: 'all', labels: [] }] };
  await open(azure);
  expect($$('input[type="checkbox"]').some((each) => each.closest('label')!.textContent!.startsWith('Only for')), 'a GitHub repository has no such box').toBe(false);
  await enter(field<HTMLSelectElement>('item-repo'), 'contoso/Fabrikam/web');
  expect(checkedOf(box('Only for web'))).toBe('false');
  await fillDraft();
  respond({ error: 'Could not create the work item.', item: null, issueUrl: null }, 502);
  await settle(() => submit().click());
  expect(posted().draft).toMatchObject({ repo: 'contoso/Fabrikam/web' });
  expect(posted().draft, 'unticked, the draft is for every repository reading the source').not.toHaveProperty('onlyFor');
  await settle(() => box('Only for web').click());
  expect(checkedOf(box('Only for web'))).toBe('true');
  respond({ error: 'Could not create the work item.', item: null, issueUrl: null }, 502);
  await settle(() => submit().click());
  expect(posted().draft).toMatchObject({ repo: 'contoso/Fabrikam/web', onlyFor: true });
});

test('on an Azure repository, the custom tags are headed Tags', async () => {
  const azure: BoardData = { ...withFactory, capture: { session: 's1', enabled: true },
    repos: [...withFactory.repos, { repo: 'contoso/Fabrikam/web', role: 'app', items: 'sprint', team: 'Web', show: 'all', labels: ['area: web'] }] };
  await open(azure);
  await enter(field<HTMLSelectElement>('item-repo'), 'contoso/Fabrikam/web');
  expect($('.custom-labels')!.textContent).toBe('Tagsarea: web');
});

test('on an Azure repository, Add item says work item, and an uncertain creation points at the project\'s work items', async () => {
  const azure: BoardData = { ...withFactory, capture: { session: 's1', enabled: true },
    repos: [...withFactory.repos, { repo: 'contoso/Fabrikam%20Fiber/lar%20web', role: 'app', items: 'sprint', team: 'Web', show: 'all', labels: [] }] };
  await open(azure);
  await enter(field<HTMLSelectElement>('item-repo'), 'contoso/Fabrikam%20Fiber/lar%20web');
  expect(dialog()!.textContent).toContain('Create a work item in lar web and add it to List.');
  await fillDraft();
  respond({ item: null, issueUrl: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/501', error: 'Could not add it to List.' }, 502);
  await settle(() => submit().click());
  expect(result().textContent).toBe('Work item created. Could not add it to List. Retry to finish this work item.View created work item');
  respond({ item: null, issueUrl: null, error: 'az did not answer.', uncertain: true });
  await settle(() => submit().click());
  expect(result().querySelector('a')!.href).toBe('https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems');
  expect(result().querySelector('a')!.textContent).toBe('Check the project’s work items');
});
