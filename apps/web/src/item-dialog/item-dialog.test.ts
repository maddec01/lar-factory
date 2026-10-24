// The item dialog: opened through its store, it shows an item's repository, status, track, slices, pull
// requests, agent work and labels, and its footer carries GitHub and the action the item's status asks for.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, answer, holdPosts, mountPage, moved, posted, sample, settle, text, toast } from '../../test/support.ts';
import type { BoardData } from '@mux-factory/shared';

const dialog = () => $('[data-item-dialog]');
const inDialog = <T extends Element = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const footer = () => inDialog('[data-slot="dialog-footer"]')!;
/** The item dialog's `attr` button, not the board's behind it. */
const button = (attr: string, id: string) => inDialog<HTMLButtonElement>(`[data-${attr}="${id}"]`)!;
const press = async (el: HTMLElement) => {
  el.focus();
  await settle(() => el.click());
};
const without = (id: string): BoardData => ({ ...sample, items: sample.items.filter((i) => i.id !== id) });

/** Opens the item dialog on `itemId` through its store, as every list on the page does. */
async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}

test('the dialog shows the repository, status, update time, blockers, numbered title, parent, track and slices', async () => {
  await mountPage();
  await openItem('PVTI_sample13');
  expect(dialog()!.getAttribute('role')).toBe('dialog');
  const meta = inDialog('[data-slot="dialog-header"] > div')!;
  expect(text(meta)).toBe('Server Ready · updated 1h agoblocked by 1');
  expect(text(inDialog('[data-slot="dialog-title"]'))).toBe('#140 Owner accounts');
  const parent = inDialog<HTMLAnchorElement>('[data-slot="dialog-description"] a')!;
  expect([text(parent), parent.href]).toEqual(['#200 Mux cloud: website sign-in and relay', 'https://github.com/maddec01/mux-server/issues/200']);
  const [track, names] = $$('[data-item-dialog] [data-slot="dialog-panel"] > div:first-child ol');
  expect(track!.children).toHaveLength(10);
  expect(text(names!.querySelector('.font-semibold'))).toBe('Ready');
  const slices = inDialog('section')!;
  expect(text(slices.querySelector('h2'))).toBe('Slices 1/3 done');
  expect([...slices.querySelectorAll('li')].map(text)).toEqual(['#144Owner table and sign-updone', '#145Sign-in sessionsactive', '#146Owner settings pagewaiting']);
  expect(text(inDialog('section:last-of-type'))).toBe('Agent workNo T3 thread has worked on this yet.');
  expect(text(inDialog('[data-slot="dialog-panel"] > p'))).toBe('build');
});

test('the dialog shows the hint, each pull request with its checks, and the agent work figures', async () => {
  await mountPage();
  await openItem('PVTI_sample14');
  expect(text(inDialog('[data-slot="dialog-header"] > div'))).toMatch(/^Apple In progress · updated 25m ago$/);
  const pr = inDialog('section li')!;
  expect([text(pr), pr.querySelector('a')!.getAttribute('href')]).toEqual(['PR #33 (draft)checks running', 'https://github.com/maddec01/mux-apple/pull/33']);
  expect($$('[data-item-dialog] dl > div').map(text)).toEqual(['Agent time2h 14m', 'Wall time1h 20m', 'Tokens16.6M', 'Cost$24.18']);

  await openItem('PVTI_sample16');
  expect(text(inDialog('[data-slot="dialog-panel"] > div:nth-child(2)')), 'the hint').toBe('Test it with the steps in the PR, then merge');
  expect(text(inDialog('dl') ?? inDialog('section:last-of-type p')), 'unreadable stats say so').toBe('The T3 Code database could not be read');
});

/** The footer's buttons and links, left to right, as their text, with " (disabled: <title>)" on a disabled one. */
const footerControls = () => [...footer().querySelectorAll<HTMLElement>('button, a')].map((el) =>
  `${text(el).trim()}${(el as HTMLButtonElement).disabled ? ` (disabled: ${el.title})` : ''}`);

test.each([
  ['List', 'PVTI_sample01', ['Abandon', 'GitHub', 'Queue']],
  ['Queued', 'PVTI_sample05', ['← Back to List', 'Abandon', 'GitHub', 'Start refining ▾']],
  ['a Queued draft', 'PVTI_sample21', ['← Back to List', 'Abandon']],
  ['Shaping', 'PVTI_sample07', ['GitHub', "Open thread (disabled: Open thread isn't built yet)"]],
  ['Needs you', 'PVTI_sample11', ['GitHub', "Answer in T3 (disabled: Answer in T3 isn't built yet)"]],
  ['Ready', 'PVTI_sample13', ['GitHub', "Start build (disabled: Start build isn't built yet)"]],
  ['In progress', 'PVTI_sample14', ['GitHub', "Open thread (disabled: Open thread isn't built yet)"]],
  ['Review', 'PVTI_sample15', ['GitHub', "Open thread (disabled: Open thread isn't built yet)"]],
  ['Verify', 'PVTI_sample16', ['GitHub', 'Verify build']],
  ['Ready to merge', 'PVTI_sample17', ['GitHub', 'Merge PR']],
  ['Done', 'PVTI_sample19', ['GitHub']],
])('a %s item’s footer has its action', async (_status, itemId, controls) => {
  await mountPage();
  await openItem(itemId);
  expect(footerControls()).toEqual(controls);
});

test('GitHub opens the item, and Verify build and Merge PR open its pull request, in a new tab', async () => {
  await mountPage();
  await openItem('PVTI_sample16');
  const links = [...footer().querySelectorAll('a')].map((a) => [text(a).trim(), a.getAttribute('href'), a.target]);
  expect(links).toEqual([['GitHub', 'https://github.com/maddec01/mux-apple/issues/31', '_blank'], ['Verify build', 'https://github.com/maddec01/mux-apple/pull/32', '_blank']]);
  await openItem('PVTI_sample17');
  expect(footer().querySelector('a:last-child')!.getAttribute('href')).toMatch(/\/pull\/\d+$/);
});

test('Queue in the dialog shows it in flight, then shows the item Queued, says so, and moves focus to Start refining', async () => {
  holdPosts();
  await mountPage();
  await openItem('PVTI_sample01');
  await press(button('queue', 'PVTI_sample01'));
  expect([text(button('queue', 'PVTI_sample01')), button('queue', 'PVTI_sample01').getAttribute('aria-disabled')]).toEqual(['Queuing…', 'true']);
  expect(posted()).toEqual([['/api/queue', { itemId: 'PVTI_sample01' }]]);

  await answer({ error: null, board: moved('PVTI_sample01', 'Queued') });
  expect(text(inDialog('[data-slot="dialog-header"] > div'))).toMatch(/ Queued · /);
  expect(text(toast())).toBe(`Moved #61 ${sample.items[0]!.title} to Queued. View item`);
  expect(document.activeElement).toBe(button('start', 'PVTI_sample01'));
});

test('a failed Queue stays in the dialog with a close button, which hands focus back to Queue', async () => {
  holdPosts();
  await mountPage();
  await openItem('PVTI_sample02');
  await press(button('queue', 'PVTI_sample02'));
  await answer({ error: 'Could not set Queued.' }, 502);
  expect(text(inDialog('.action-error [role="alert"]'))).toBe('Could not set Queued.');
  const close = inDialog<HTMLButtonElement>('.action-error button.dismiss')!;
  await press(close);
  expect(inDialog('.action-error')).toBeNull();
  expect(document.activeElement).toBe(button('queue', 'PVTI_sample02'));
});

test('Start refining opens the model menu, and picking a model starts the item and tags it Started', async () => {
  const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }] };
  holdPosts(withChoices);
  await mountPage(withChoices);
  await openItem('PVTI_sample05');
  await press(button('start', 'PVTI_sample05'));
  await settle(() => vi.advanceTimersByTime(20));
  expect($$('[role="menu"] [role="menuitemradio"]').map(text)).toEqual(['T3 default', 'GPT-5.5']);
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[1]!.click());
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'PVTI_sample05', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  expect(text(button('start', 'PVTI_sample05'))).toBe('Starting…');

  await answer({ thread: { threadId: 'thread-1', title: 'Other title' }, error: null });
  const tag = inDialog('[data-start-result="PVTI_sample05"]')!;
  expect(text(tag)).toBe('Started');
  expect(document.activeElement, 'focus moves to the dialog’s tag').toBe(tag);
  expect(inDialog('[data-back-to-list], [data-abandon]'), 'a started item can’t go back').toBeNull();
  expect(text(toast())).toMatch(/^Started T3 thread Other title thread-1 for #129 /);
});

test('a failed Start shows in the dialog and offers Retry start', async () => {
  holdPosts();
  await mountPage({ ...sample, capture: { session: 's1', enabled: true } });
  await openItem('PVTI_sample05');
  await press(button('start', 'PVTI_sample05'));
  await settle(() => vi.advanceTimersByTime(20));
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
  await answer({ error: 'T3 is not running.' }, 502);
  expect(text(inDialog('p.start [role="alert"]'))).toBe('T3 is not running.');
  expect(text(button('start', 'PVTI_sample05'))).toBe('Retry start ▾');
});

test('Back to List in the dialog shows the item in List, says so, and moves focus to Queue', async () => {
  holdPosts();
  await mountPage();
  await openItem('PVTI_sample05');
  await press(button('back-to-list', 'PVTI_sample05'));
  expect(text(button('back-to-list', 'PVTI_sample05'))).toBe('← Moving to List…');
  expect(posted()).toEqual([['/api/back-to-list', { itemId: 'PVTI_sample05' }]]);
  await answer({ error: null, board: moved('PVTI_sample05', 'List') });
  expect(text(toast())).toMatch(/^Moved #129 .* to List\. View item$/);
  expect(document.activeElement).toBe(button('queue', 'PVTI_sample05'));
});

test('a failed Back to List is a toast, and focus goes back to Back to List', async () => {
  holdPosts();
  await mountPage();
  await openItem('PVTI_sample05');
  await press(button('back-to-list', 'PVTI_sample05'));
  await answer({ error: 'GitHub is down.' }, 502);
  expect(text(toast())).toMatch(/^Couldn't move #129 .* to List\. GitHub is down\.$/);
  expect(document.activeElement).toBe(button('back-to-list', 'PVTI_sample05'));
});

test('Abandon in the dialog asks first, then deletes the item, closes the dialog and says so', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } };
  await mountPage(data);
  await openItem('PVTI_sample01');
  await press(button('abandon', 'PVTI_sample01'));
  expect(text($('#abandon-heading'))).toMatch(/#61/);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'PVTI_sample01' }]]);
  expect(text(button('abandon', 'PVTI_sample01'))).toBe('Abandoning…');
  await answer({ error: null, board: without('PVTI_sample01') });
  expect(text(toast())).toBe(`Deleted #61 ${sample.items[0]!.title}.`);
  expect($('[data-item-dialog][data-open]'), 'the dialog closes').toBeNull();
});

test('a failed Abandon in the dialog is a toast, and focus goes back to Abandon', async () => {
  holdPosts();
  await mountPage();
  await openItem('PVTI_sample01');
  await press(button('abandon', 'PVTI_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  await answer({ error: 'Could not delete #61.' }, 502);
  expect(text(toast())).toMatch(/^Couldn't abandon #61 .*\. Could not delete #61\.$/);
  expect(inDialog('.action-error'), 'no inline error').toBeNull();
  await settle(() => vi.advanceTimersByTime(20));
  expect(document.activeElement).toBe(button('abandon', 'PVTI_sample01'));
});

test('in sample mode the dialog’s actions are disabled', async () => {
  await mountPage({ ...sample, capture: { enabled: false } as BoardData['capture'] });
  await openItem('PVTI_sample01');
  for (const b of [button('queue', 'PVTI_sample01'), button('abandon', 'PVTI_sample01')]) expect([b.disabled, b.title]).toEqual([true, 'Disabled in sample mode']);
});

test('an item that leaves the board closes the dialog for good: its coming back later opens nothing', async () => {
  await mountPage();
  await openItem('PVTI_sample13');
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(without('PVTI_sample13')));
  expect(useItemDialogStore.getState().itemId).toBeNull();
  await settle(() => useBoardStore.getState().receive(sample));
  expect(dialog()).toBeNull();
});

test('closing the dialog clears the store, and Escape closes it', async () => {
  await mountPage();
  await openItem('PVTI_sample13');
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  const popup = dialog()!;
  await settle(() => popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(useItemDialogStore.getState().itemId).toBeNull();
  expect(dialog()).toBeNull();
});
