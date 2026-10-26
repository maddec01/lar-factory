// The Add item dialog: the form, its repo-dependent fields, and each phase of a submission.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, addStylesheet, fetchMock, mountPage, sample, settle } from '../../test/support.ts';
import type { BoardData } from '@lar-factory/shared';

const withFactory: BoardData = { ...sample, repos: [
  ...sample.repos, { repo: 'maddec01/lar-factory', platform: 'Factory', role: 'The factory' },
] };
const addButton = () => $<HTMLButtonElement>('.add-item')!;
const dialog = () => $('#add-item-dialog');
const field = <T extends HTMLElement = HTMLInputElement>(id: string) => $<T>(`#${id}`)!;
const submit = () => field<HTMLButtonElement>('item-submit');
const result = () => field('item-result');
const labels = () => $$<HTMLInputElement>('input[name="labels"]').map((input) => input.value);
const box = (label: string) => $$('[role="checkbox"]').find((each) => each.closest('label')!.textContent === label)!;

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

test('Add item opens a dialog with the configured repositories, kinds, and the selected repo\'s applicability', async () => {
  await open();
  const popup = dialog()!;
  expect(popup.getAttribute('role')).toBe('dialog');
  expect(document.getElementById(popup.getAttribute('aria-labelledby')!)!.textContent).toBe('Add item');
  expect(document.activeElement, 'focus starts on the repo select').toBe(field('item-repo'));
  expect($$<HTMLOptionElement>('#item-repo option').map((o) => [o.value, o.textContent])).toEqual([
    ['maddec01/lar-server', 'Server'], ['maddec01/lar-apple', 'Apple'], ['maddec01/lar-factory', 'Factory']]);
  expect($$<HTMLOptionElement>('#item-kind option').map((o) => o.value)).toEqual(['', 'bug', 'feature', 'improvement']);
  expect($('label[for="item-title"]')!.textContent).toBe('Title (required)');
  expect(field('item-title').required).toBe(true);
  expect($('label[for="item-description"]')!.textContent).toBe('Description (optional)');
  expect([result().getAttribute('role'), result().dataset.slot, result().dataset.variant]).toEqual(['status', 'alert', 'warning']);
  expect(popup.textContent).toContain('Create an issue in lar and add it to List.');

  expect(labels()).toEqual(['area: server', 'area: web']);
  expect(popup.textContent).toContain('Selecting neither means both server and web.');
  const hint = $('.applicability')!.getAttribute('aria-describedby')!;
  expect(document.getElementById(hint)!.textContent).toBe('Selecting neither means both server and web.');
});

test('changing the repo shows its applicability, unchecked, and a repo with none shows no group', async () => {
  await open();
  await settle(() => box('area: web').click());
  await enter(field<HTMLSelectElement>('item-kind'), 'bug');
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-apple');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-apple');
  expect(field<HTMLSelectElement>('item-kind').value, 'the kind stays').toBe('bug');
  expect(labels()).toEqual(['app: music', 'app: video', 'app: photos', 'app: books', 'os: ios', 'os: macos', 'os: tvos', 'os: watchos']);
  expect(dialog()!.textContent).toContain('No apps selected means all apps.');
  expect(dialog()!.textContent).toContain('No OSes selected means all OSes.');
  await enter(field<HTMLSelectElement>('item-repo'), 'maddec01/lar-factory');
  expect(field<HTMLSelectElement>('item-repo').value).toBe('maddec01/lar-factory');
  expect($('.applicability')).toBeNull();
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
  expect(box('area: web').getAttribute('aria-checked')).toBe('true');
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
  expect(box('area: server').getAttribute('aria-checked')).toBe('false');
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
  expect($('.sidebar [data-item="I_created501"]'), 'the board shows the new data').not.toBeNull();
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
  expect(box('area: server').getAttribute('aria-checked')).toBe('false');

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
