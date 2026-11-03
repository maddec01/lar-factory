// The item dialog: opened through its store, it shows an item's repository, status and agent work figures in its header,
// a meta area of labels under the title, a progress bar with the slices as an overview, then sub-tickets and pull
// requests in a sidebar, and its footer carries GitHub and the action the item's status asks for.

import { expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, answer, detailsRead, fetchMock, holdPosts, mountPage, moved, posted, pressMenu, sample, settle, text, toast } from '../../test/support.ts';
import type { Blocker, BoardData, DependencyHold, Item, ItemThread } from '@lar-factory/shared';

const dialog = () => $('[data-item-dialog]');
const inDialog = <T extends Element = HTMLElement>(selector: string) => dialog()!.querySelector<T>(selector);
const footer = () => inDialog('[data-slot="modal-footer"]')!;
/** The item dialog's `attr` button, not the board's behind it. */
const button = (attr: string, id: string) => inDialog<HTMLButtonElement>(`[data-${attr}="${id}"]`)!;
/** A sidebar section by the start of its heading. */
const section = (heading: string) => $$('[data-item-dialog] aside section').find((s) => text(s.querySelector('h2')).startsWith(heading))!;
const press = async (el: HTMLElement) => {
  el.focus();
  await settle(() => el.click());
};
/** The confirmation a Needs you choice opens. */
const confirmation = () => $('#needs-you-dialog');
const confirmButtons = () => $$<HTMLButtonElement>('#needs-you-dialog [data-slot="modal-footer"] button');
const confirmPress = (name: string) => press(confirmButtons().find((b) => text(b) === name)!);
const without = (id: string): BoardData => ({ ...sample, items: sample.items.filter((i) => i.id !== id) });

/** Opens the item dialog on `itemId` through its store, as every list on the page does. */
async function openItem(itemId: string): Promise<void> {
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  await settle(() => useItemDialogStore.getState().open(itemId));
}

test('the dialog shows the repository, status, update time, blockers, numbered title, parent and a progress bar', async () => {
  await mountPage();
  await openItem('I_sample13');
  expect(dialog()!.getAttribute('role')).toBe('dialog');
  const summary = inDialog('[data-item-summary] > div')!;
  expect(text(summary)).toBe('lar-server Ready· updated 1h agoblocked by 1. Blocked by #202 until it completes');
  expect(text(inDialog('[data-slot="modal-header"] h2'))).toBe('#140 Owner accounts');
  const parent = inDialog<HTMLAnchorElement>('[data-item-parent] a')!;
  expect([text(parent), parent.href]).toEqual(['#200 lar cloud: website sign-in and relay', 'https://github.com/maddec01/lar-server/issues/200']);
  expect(steps()).toHaveLength(8);
  expect(text(inDialog('[data-meta]'))).toContain('Usage totals are still loading.');
  expect(inDialog('[data-labels]'), "a build's only label is managed").toBeNull();
});

/** The progress bar's active step segments. */
const steps = () => $$('[data-item-dialog] [data-progress] [data-steps] > li');

test('a cleanup problem shows in the dialog with no button, and never on the card', async () => {
  const problem = "The board couldn't clean up the shaping threads. T3 refused it. It keeps trying.";
  const carrying = { ...sample, items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, shapingCleanupProblem: problem } : i)) };
  await mountPage(carrying);
  expect($$('main *').some((el) => text(el).includes(problem))).toBe(false);
  await openItem('I_sample13');
  const notice = inDialog('[data-shaping-cleanup-problem]')!;
  expect(text(notice)).toBe(problem);
  expect(notice.querySelector('button')).toBeNull();
  expect(inDialog('[data-needs-you-reason]')).toBeNull();
});

test('an item with no cleanup problem shows no notice', async () => {
  await mountPage();
  await openItem('I_sample13');
  expect(inDialog('[data-shaping-cleanup-problem]')).toBeNull();
});

test('the progress bar names the current step on its segment and every step in a title and an accessible label', async () => {
  await mountPage();
  await openItem('I_sample13');
  const current = steps()[3]!;
  expect([current.getAttribute('aria-label'), current.getAttribute('aria-current'), text(current)]).toEqual(['Step 4 of 8: Ready', 'step', 'Ready4/8']);
  expect(steps().map((s) => s.title)).toEqual(['Queued', 'Shaping', 'Needs you', 'Ready', 'In progress', 'Review', 'Verify', 'Ready to merge']);
  expect(steps().filter((s) => s !== current).map((s) => text(s))).toEqual(Array(7).fill(''));
  expect(steps().filter((s) => s.hasAttribute('aria-current'))).toEqual([current]);
});

test('slices show as an overview under the progress bar, not in the sidebar, with a bar of their own while the item is not at work', async () => {
  await mountPage();
  await openItem('I_sample13');
  const slices = inDialog('[data-slices]')!;
  expect(text(slices.querySelector('p'))).toBe('Slices · 1/3 done');
  expect([...slices.querySelectorAll('ul > li')].map(text)).toEqual(['#144Owner table and sign-updone', '#145Sign-in sessionsactive', '#146Owner settings pagewaiting']);
  expect(slices.querySelectorAll('ol > li'), 'a small bar of the slices').toHaveLength(3);
  expect(steps()[3]!.querySelector('ol'), 'the Ready segment is not subdivided').toBeNull();
  expect($$('[data-item-dialog] aside h2').map(text)).toEqual(['Sub-tickets']);
});

test('an In progress item with slices subdivides its current segment, a mini segment for each slice', async () => {
  const slices = sample.items.find((i) => i.id === 'I_sample13')!.slices;
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample14' ? { ...i, slices } : i)) });
  await openItem('I_sample14');
  expect([...steps()[4]!.querySelectorAll<HTMLElement>('ol > li')].map((s) => s.title)).toEqual(['#144 Owner table and sign-up', '#145 Sign-in sessions', '#146 Owner settings page']);
  expect(text(inDialog('[data-slices] p'))).toBe('Slices · 1/3 done');
  expect(inDialog('[data-slices] ol'), 'the bar is in the track, not repeated').toBeNull();
  expect(inDialog('[data-slices] ul')!.children).toHaveLength(3);
});

test('the labels, people and dates sit in a meta area under the title, and the sidebar holds only relations', async () => {
  await mountPage();
  await openItem('I_sample13');
  const meta = text(inDialog('[data-meta]'));
  expect(meta).toMatch(/Author.*maddec01.*Assignees.*maddec01.*claude-bot.*Milestone.*Cloud v0\.1.*Created.*Updated/);
  expect(inDialog('[data-meta]')!.closest('aside'), 'not in the sidebar').toBeNull();
  expect(text(inDialog('aside'))).not.toMatch(/Author|Assignees|Labels|Created|Updated|Agent work/);
});

test('an item with no slices, pull requests or sub-tickets has no sidebar', async () => {
  await mountPage();
  await openItem('I_sample01');
  expect(inDialog('aside')).toBeNull();
});

test('the header bar holds the agent work figures and the close button', async () => {
  await mountPage();
  await openItem('I_sample14');
  const close = inDialog<HTMLButtonElement>('header [aria-label="Close"]')!;
  expect(inDialog('header')!.contains(inDialog('[data-agent-work]'))).toBe(true);
  expect(dialog()!.querySelectorAll('[aria-label="Close"]'), 'the popup draws no second one').toHaveLength(1);
  await press(close);
  expect(dialog()).toBeNull();
});

test('the dialog lays out by its own width and never hides an overflow', async () => {
  await mountPage();
  await openItem('I_sample13');
  expect(inDialog('[data-item-body]')!.classList.contains('@container')).toBe(true);
  expect(inDialog('[data-item-body]')!.className).not.toMatch(/overflow/);
});

test('the dialog shows the hint, each pull request with its checks, and the agent work figures', async () => {
  await mountPage();
  await openItem('I_sample14');
  const work = inDialog('header [data-agent-work]')!;
  expect(text(inDialog('[data-item-summary]'))).toBe('lar-apple In progress· updated 25m agoFeature');
  expect(text(inDialog('header'))).toBe('#30 Chapter markers in the scrubber$24.18 · 2h 14m · 16.6M tokens · 1h 20m wall');
  expect(work.title).toBe('Cost $24.18 · Agent time 2h 14m · Tokens 16.6M · Wall time 1h 20m');
  expect(inDialog('[data-meta] [data-agent-work]')!.className, 'a narrow dialog shows them in the meta area instead').toContain('@min-[40rem]:hidden');
  expect(work.className, 'a wide one in the header').toContain('@max-[40rem]:hidden');
  const pr = section('Pull requests').querySelector('li')!;
  expect([text(pr), pr.querySelector('a')!.getAttribute('href')]).toEqual(['PR #33 (draft)checks running', 'https://github.com/maddec01/lar-apple/pull/33']);

  await openItem('I_sample16');
  expect(text(inDialog('[data-item-body] > div:nth-child(2)')), 'the hint').toBe('Test it with the steps in the PR, then merge');
  expect(inDialog('[data-agent-work]'), 'no figures').toBeNull();
  expect(text(inDialog('[data-meta]')), 'unreadable stats say so').toContain('Usage details are unavailable.');
});

/** The footer's buttons and links, left to right, as their text, with " (disabled: <title>)" on a disabled one. */
const footerControls = () => [...footer().querySelectorAll<HTMLElement>('button, a')].map((el) =>
  `${text(el).trim()}${(el as HTMLButtonElement).disabled ? ` (disabled: ${el.title})` : ''}`);

test.each([
  ['List', 'I_sample01', ['Abandon', 'GitHub', 'Queue']],
  ['Queued', 'I_sample05', ['Move to List', 'Abandon', 'GitHub', 'Shape issue ▾']],
    ['Shaping', 'I_sample07', ['GitHub', 'Open thread']],
  ['Needs you', 'I_sample11', ['GitHub', 'Answer in T3 (disabled: No T3 thread has worked on this yet)']],
  ['blocked Ready', 'I_sample13', ['GitHub', 'Open thread', 'Start after #202 ▾']],
  ['In progress', 'I_sample14', ['GitHub', 'Open thread']],
  ['Review', 'I_sample15', ['GitHub', 'Open thread']],
  ['Verify', 'I_sample16', ['GitHub', 'Verify build']],
  ['Ready to merge', 'I_sample17', ['GitHub', 'Merge PR']],
  ['Done', 'I_sample19', ['GitHub']],
])('a %s item’s footer has its action', async (_status, itemId, controls) => {
  await mountPage();
  await openItem(itemId);
  expect(footerControls()).toEqual(controls);
});

test.each([
  ['Verify', 'Verify build', 'I_sample16'],
  ['Ready to merge', 'Merge PR', 'I_sample17'],
])('a %s item with no linked pull request has %s disabled, its title saying why', async (_status, label, itemId) => {
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === itemId ? { ...i, linkedPrs: [] } : i)) });
  await openItem(itemId);
  expect(footerControls().at(-1)).toBe(`${label} (disabled: No pull request is linked to this item yet)`);
});

test('GitHub opens the item, and Verify build and Merge PR open its pull request, in a new tab', async () => {
  await mountPage();
  await openItem('I_sample16');
  const links = [...footer().querySelectorAll('a')].map((a) => [text(a).trim(), a.getAttribute('href'), a.target]);
  expect(links).toEqual([['GitHub', 'https://github.com/maddec01/lar-apple/issues/31', '_blank'], ['Verify build', 'https://github.com/maddec01/lar-apple/pull/32', '_blank']]);
  const verify = footer().querySelector<HTMLAnchorElement>('[data-pr-link]')!;
  expect([verify.dataset.kind, Boolean(verify.querySelector('[data-slot="icon"] .lucide-git-pull-request'))], 'an Open with the pull request icon').toEqual(['open', true]);
  expect(verify.className.split(' '), "a link takes its kind's height, not the Copy's").not.toContain('h-9');
  await openItem('I_sample17');
  expect(footer().querySelector('a:last-child')!.getAttribute('href')).toMatch(/\/pull\/\d+$/);
});

test('an Azure work item\'s footer opens it on Azure DevOps', async () => {
  const url = 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/31';
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample01' ? { ...i, repo: 'contoso/Fabrikam%20Fiber/lar-apple', url } : i)) });
  await openItem('I_sample01');
  expect([...footer().querySelectorAll('a')].map((a) => [text(a).trim(), a.getAttribute('href')])).toEqual([['Azure DevOps', url]]);
});

test('a Queued item blocked by an open issue has only Start after in the footer', async () => {
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample05'
    ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' as const }] } : i)) });
  await openItem('I_sample05');
  expect(footerControls()).toEqual(['Move to List', 'Abandon', 'GitHub', 'Start after #202 ▾']);
});

/** The sample with `itemId`'s threads replaced. */
const withThreads = (itemId: string, threads: Item['threads'], data: BoardData = sample): BoardData =>
  ({ ...data, items: data.items.map((i) => (i.id === itemId ? { ...i, threads } : i)) });
const thread = (id: string, state: ItemThread['state']): ItemThread => ({ id, title: `Thread ${id}`, state, updated: '2026-10-21T09:00:00.000Z' });
/** The footer's last control: the item's status action. */
const statusAction = () => footer().querySelector<HTMLElement>(':scope > span:last-child > :last-child')!;

test('Open thread and Answer in T3 link to the latest thread in T3 Code, in the same tab', async () => {
  await mountPage(withThreads('I_sample10', [thread('new', 'running'), thread('old', 'done')]));
  await openItem('I_sample10');
  const open = statusAction() as HTMLAnchorElement;
  expect([text(open), open.getAttribute('href'), open.target]).toEqual(['Open thread', 't3code://threads/sample-environment/new', '']);

  await openItem('I_sample12');
  const answerLink = statusAction() as HTMLAnchorElement;
  expect([text(answerLink), answerLink.getAttribute('href')]).toEqual(['Answer in T3', 't3code://threads/sample-environment/sample-thread-202']);
});

test.each(['Verify', 'Ready to merge'] as const)('%s with its build thread running offers Open thread on that thread, says Working and keeps its stage', async (status) => {
  const fresh = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
  const change = (threads: Item['threads']) => ({ ...fresh, items: fresh.items.map((i) => (i.id === 'I_sample10' ? { ...i, status, threads } : i)) });
  await mountPage(change([thread('other', 'done'), { ...thread('build', 'running'), purpose: 'build', currentRunning: true }]));
  await openItem('I_sample10');
  const open = statusAction() as HTMLAnchorElement;
  expect([text(open), open.getAttribute('href')]).toEqual(['Open thread', 't3code://threads/sample-environment/build']);
  expect(text(inDialog('[data-item-summary]'))).toContain('Working');
  expect(text(inDialog('[data-item-summary]'))).not.toContain(status);
  expect(text(inDialog('[data-steps] [aria-current="step"]'))).toContain('Working');
  expect(inDialog('[data-steps] [aria-current="step"]')!.getAttribute('aria-label')).toMatch(status === 'Verify' ? /^Step 7 of 8: Working/ : /^Step 8 of 8: Working/);

  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(change([{ ...thread('build', 'done'), purpose: 'build' }])));
  expect(text(statusAction())).toBe(status === 'Verify' ? 'Verify build' : 'Merge PR');
  expect(text(inDialog('[data-item-summary]'))).toContain(status);
});

test.each([
  ['T3 Code\'s database can\'t be read', withThreads('I_sample10', 'unavailable'), 'The T3 Code database could not be read'],
  ['T3 Code\'s environment id is missing', { ...sample, t3EnvironmentId: undefined }, 'T3 Code hasn\'t written its environment id'],
])('Open thread is disabled when %s, and its title says so', async (_case, data, reason) => {
  await mountPage(data);
  await openItem('I_sample10');
  expect(footerControls()).toEqual(['GitHub', `Open thread (disabled: ${reason})`]);
});

test("a Queued item has Shape issue disabled in the footer until onboarding's PR merges while its repository is still onboarding", async () => {
  await mountPage({ ...sample, onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'pr', done: ['project'], answers: { projectId: 'p1' } } }] });
  await openItem('I_sample05');
  expect(footerControls()).toEqual(['Move to List', 'Abandon', 'GitHub', "Shape issue (disabled: Waits for onboarding to finish)"]);
});

test.each([['running'], ['needs you']] as const)('a Queued item with a %s thread offers Open thread instead of Shape issue, and neither Move to List nor Abandon', async (state) => {
  await mountPage(withThreads('I_sample05', [thread('live', state)]));
  await openItem('I_sample05');
  expect(footerControls()).toEqual(['GitHub', 'Open thread']);
  expect(statusAction().getAttribute('href')).toBe('t3code://threads/sample-environment/live');
});

test('a Ready item with a queued thread offers Open thread instead of Start build', async () => {
  await mountPage(withThreads('I_sample13', [{ ...thread('queued', 'done'), queued: true }]));
  await openItem('I_sample13');
  expect(statusAction().getAttribute('href')).toBe('t3code://threads/sample-environment/queued');
  expect(footerControls()).not.toContain('Start build ▾');
});

test('an archived thread shows as archived in details, with no link to it anywhere in the dialog', async () => {
  await mountPage(withThreads('I_sample10', [{ ...thread('put-away', 'done'), title: 'Shape: accounts', archived: true }]));
  await openItem('I_sample10');
  expect(text(inDialog('[data-earlier-threads]')!)).toBe('T3 · Shape: accounts · archived');
  expect(statusAction().getAttribute('href')).toBeNull();
  expect(statusAction().getAttribute('title')).toBe('This thread is archived in T3 Code');
  expect(dialog()!.querySelector('a[href*="put-away"]')).toBeNull();
});

test('beside an archived shaping thread, Open thread links the build thread', async () => {
  await mountPage(withThreads('I_sample10', [thread('build', 'running'), { ...thread('put-away', 'done'), archived: true }]));
  await openItem('I_sample10');
  expect(statusAction().getAttribute('href')).toBe('t3code://threads/sample-environment/build');
  expect(text(inDialog('[data-earlier-threads]')!)).toBe('T3 · Thread put-away · archived');
  expect(dialog()!.querySelector('a[href*="put-away"]')).toBeNull();
});

test('a long thread title truncates alone, keeping the row\'s archived mark in view', async () => {
  await mountPage(withThreads('I_sample10', [{ ...thread('put-away', 'done'), archived: true }]));
  await openItem('I_sample10');
  const row = inDialog('[data-earlier-threads] li')!;
  expect(row.querySelector('.truncate')!.textContent).toBe('T3 · Thread put-away');
  expect(row.querySelector('.shrink-0')!.textContent).toBe('· archived');
});

test('a settled shaping thread keeps a row in details whose link opens it, while Open thread links the build', async () => {
  const shaping = { ...thread('settled', 'done'), title: 'Shape: accounts', purpose: 'shape' };
  await mountPage(withThreads('I_sample10', [{ ...thread('build', 'running'), purpose: 'build' }, shaping]));
  await openItem('I_sample10');
  expect(statusAction().getAttribute('href')).toBe('t3code://threads/sample-environment/build');
  const row = inDialog('[data-earlier-threads] li')!;
  expect(text(row)).toBe('T3 · Shape: accounts · shaping');
  expect(row.querySelector('a.truncate')!.getAttribute('href')).toBe('t3code://threads/sample-environment/settled');
  expect(row.querySelector('.shrink-0')!.textContent).toBe('· shaping');
});

test('an earlier shaping thread lists beside an archived one, and only the archived one has no link', async () => {
  await mountPage(withThreads('I_sample10', [
    { ...thread('build', 'running'), purpose: 'build' },
    { ...thread('settled', 'done'), purpose: 'shape' },
    { ...thread('put-away', 'done'), purpose: 'shape', archived: true },
  ]));
  await openItem('I_sample10');
  expect($$('[data-item-dialog] [data-earlier-threads] li').map(text)).toEqual(['T3 · Thread settled · shaping', 'T3 · Thread put-away · archived']);
  expect(dialog()!.querySelector('a[href*="settled"]')).not.toBeNull();
  expect(dialog()!.querySelector('a[href*="put-away"]')).toBeNull();
});

test('a shaping thread still the latest and an earlier build show no row', async () => {
  await mountPage(withThreads('I_sample14', [{ ...thread('shaping', 'running'), purpose: 'shape' }, { ...thread('old-build', 'done'), purpose: 'build' }]));
  await openItem('I_sample14');
  expect(inDialog('[data-earlier-threads]')).toBeNull();
});

test('without T3\'s environment id, a settled shaping thread\'s row has no link', async () => {
  await mountPage(withThreads('I_sample10', [thread('build', 'running'), { ...thread('settled', 'done'), purpose: 'shape' }], { ...sample, t3EnvironmentId: undefined }));
  await openItem('I_sample10');
  expect(text(inDialog('[data-earlier-threads] li')!)).toBe('T3 · Thread settled · shaping');
  expect(dialog()!.querySelector('a[href*="settled"]')).toBeNull();
});

test('details list no earlier threads for an item without any', async () => {
  await mountPage(withThreads('I_sample10', [thread('build', 'running')]));
  await openItem('I_sample10');
  expect(inDialog('[data-earlier-threads]')).toBeNull();
});

test('a Queued item whose threads are all done still offers Shape issue', async () => {
  await mountPage(withThreads('I_sample05', [thread('old', 'done')]));
  await openItem('I_sample05');
  expect(footerControls().at(-1)).toBe('Shape issue ▾');
});

test('Queue in the dialog shows it in flight, then shows the item Queued, says so, and moves focus to Shape issue', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('queue', 'I_sample01'));
  expect([text(button('queue', 'I_sample01')), button('queue', 'I_sample01').getAttribute('aria-disabled')]).toEqual(['Queuing…', 'true']);
  expect(posted()).toEqual([['/api/queue', { itemId: 'I_sample01' }]]);

  await answer({ error: null, board: moved('I_sample01', 'Queued') });
  expect(text(inDialog('[data-item-summary]'))).toMatch(/ Queued· /);
  expect(toast()).toBeNull();
  expect(document.activeElement).toBe(button('start', 'I_sample01'));
});

test('a failed Queue stays in the dialog with a close button, which hands focus back to Queue', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample02');
  await press(button('queue', 'I_sample02'));
  await answer({ error: 'Could not set Queued.' }, 502);
  expect(text(inDialog('.action-error [role="alert"]'))).toBe('Could not set Queued.');
  const close = inDialog<HTMLButtonElement>('.action-error button.dismiss')!;
  await press(close);
  expect(inDialog('.action-error')).toBeNull();
  expect(document.activeElement).toBe(button('queue', 'I_sample02'));
});

test("Abandon is greyed out with the reason on an item whose type can't be abandoned", async () => {
  const refusal = "Issue has no Removed state in Fabrikam Fiber, so the board can't abandon it. Close or delete it in Azure DevOps.";
  await mountPage({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample01' ? { ...i, abandonRefusal: refusal } : i)) });
  await openItem('I_sample01');
  expect(footerControls()).toEqual([`Abandon (disabled: ${refusal})`, 'GitHub', 'Queue']);
  const abandon = button('abandon', 'I_sample01');
  expect(abandon.className, 'pointer events stay on, so the title shows').toContain('disabled:pointer-events-auto');
  const reason = footer().querySelector<HTMLElement>('[data-abandon-refusal]')!;
  expect(text(reason), 'a visible line says why').toBe(refusal);
  expect(abandon.getAttribute('aria-describedby')).toBe(reason.id);
});

test('Shape issue opens the model menu, and picking a model starts the item and tags it Started', async () => {
  const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }] };
  holdPosts(withChoices);
  await mountPage(withChoices);
  await openItem('I_sample05');
  await pressMenu(button('start', 'I_sample05'));
  await settle(() => vi.advanceTimersByTime(20));
  expect($$('[role="menu"] [role="menuitemradio"]').map(text)).toEqual(['T3 default', 'GPT-5.5']);
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[1]!.click());
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample05', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  expect(text(button('start', 'I_sample05'))).toBe('Starting…');

  const thread = { threadId: 'thread-1', title: 'Other title' };
  await answer({ thread, error: null, board: { ...withChoices, started: { I_sample05: thread } } });
  const tag = inDialog('[data-start-result="I_sample05"]')!;
  expect(text(tag)).toBe('Started');
  expect(document.activeElement, 'focus moves to the dialog’s tag').toBe(tag);
  expect(inDialog('[data-back-to-list], [data-abandon]'), 'a started item can’t go back').toBeNull();
  expect(text(toast())).toBe('Refining started for #129. Open thread');
});

test('a failed Start shows in the dialog and offers Retry start', async () => {
  holdPosts();
  await mountPage({ ...sample, capture: { session: 's1', enabled: true } });
  await openItem('I_sample05');
  await pressMenu(button('start', 'I_sample05'));
  await settle(() => vi.advanceTimersByTime(20));
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
  await answer({ error: 'T3 is not running.' }, 502);
  expect(text(inDialog('p.start [role="alert"]'))).toBe('T3 is not running.');
  expect(text(button('start', 'I_sample05'))).toBe('Retry start ▾');
});

/** The sample with #140's blocker closed, so its Start build runs, and writes on. */
const readyBuild: BoardData = {
  ...withThreads('I_sample13', undefined), capture: { session: 's1', enabled: true },
  items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }] } : i)),
};

test('Start build in a Ready item’s footer sends the build, then tags it Started', async () => {
  holdPosts(readyBuild);
  await mountPage(readyBuild);
  await openItem('I_sample13');
  expect(footerControls()).toEqual(['GitHub', 'Open thread', 'Start build ▾']);
  await pressMenu(button('start', 'I_sample13'));
  await settle(() => vi.advanceTimersByTime(20));
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
  expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13' }]]);
  const thread = { threadId: 'thread-1', title: 'Build maddec01/lar-server#140' };
  await answer({ thread, error: null, board: { ...readyBuild, startedBuilds: { I_sample13: thread } } });
  expect(text(inDialog('[data-start-result="I_sample13"]'))).toBe('Started');
});

test('a build the board started, through Start after or from another page, shows Started at once', async () => {
  await mountPage({ ...readyBuild, startedBuilds: { I_sample13: { threadId: 'build-1', title: 'Build maddec01/lar-server#140' } } });
  await openItem('I_sample13');
  const tag = inDialog('[data-start-result="I_sample13"]')!;
  expect([text(tag), tag.getAttribute('title')]).toEqual(['Started', 'T3 thread build-1']);
  expect(footerControls()).toEqual(['GitHub', 'Open thread']);
});

test('a failed Start build shows in the dialog and offers Retry start', async () => {
  holdPosts(readyBuild);
  await mountPage(readyBuild);
  await openItem('I_sample13');
  await pressMenu(button('start', 'I_sample13'));
  await settle(() => vi.advanceTimersByTime(20));
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
  await answer({ thread: null, error: 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code' }, 409);
  expect(text(inDialog('p.start [role="alert"]'))).toBe('No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code');
  expect(text(button('start', 'I_sample13'))).toBe('Retry start ▾');
});

test('Start build is disabled with the hint while T3 has no project for the repository', async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  await mountPage({ ...readyBuild, repositoryProjects: { 'maddec01/lar-server': hint } });
  await openItem('I_sample13');
  expect(footerControls()).toEqual(['GitHub', 'Open thread', `Start build (disabled: ${hint})`]);
});

test("Start build is disabled until onboarding's PR merges while the repository is still onboarding", async () => {
  await mountPage({ ...readyBuild, onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'pr', done: ['project'], answers: { projectId: 'p1' } } }] });
  await openItem('I_sample13');
  expect(footerControls()).toEqual(['GitHub', 'Open thread', "Start build (disabled: Waits for onboarding to finish)"]);
});

test.each([['running'], ['needs you']] as const)('a Ready item with a %s thread offers Open thread instead of Start build', async (state) => {
  await mountPage(withThreads('I_sample13', [thread('live', state)], readyBuild));
  await openItem('I_sample13');
  expect(footerControls()).toEqual(['GitHub', 'Open thread']);
});

test('Move to List in the dialog shows the item in List, says so, and moves focus to Queue', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample05');
  await press(button('back-to-list', 'I_sample05'));
  expect(text(button('back-to-list', 'I_sample05'))).toBe('Moving to List…');
  expect(posted()).toEqual([['/api/back-to-list', { itemId: 'I_sample05' }]]);
  await answer({ error: null, board: moved('I_sample05', 'List') });
  expect(text(toast())).toMatch(/^Moved #129 .* to List\. View item$/);
  expect(document.activeElement).toBe(button('queue', 'I_sample05'));
});

test('a failed Move to List is a toast, and focus goes back to Move to List', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample05');
  await press(button('back-to-list', 'I_sample05'));
  await answer({ error: 'GitHub is down.' }, 502);
  expect(text(toast())).toMatch(/^Couldn't move #129 .* to List\. GitHub is down\.$/);
  expect(document.activeElement).toBe(button('back-to-list', 'I_sample05'));
});

test('Abandon in the dialog sets work aside without a follow-up ticket confirmation', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 'session-1' } };
  await mountPage(data);
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  expect(text($('#abandon-dialog h2'))).toMatch(/#61/);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  expect(posted()).toEqual([['/api/abandon', { session: 'session-1', itemId: 'I_sample01' }]]);
  expect(text(button('abandon', 'I_sample01'))).toBe('Abandoning…');
  await answer({ error: null, board: without('I_sample01') });
  expect(text(toast())).toBe(`Set #61 ${sample.items[0]!.title} aside on this Mac.`);
  expect($('[data-item-dialog]'), 'the dialog closes').toBeNull();
  expect($('#abandon-dialog')).toBeNull();
  expect(posted().map(([path]) => path)).toEqual(['/api/abandon']);
});

test('keeping the ticket open after Abandon closes nothing', async () => {
  holdPosts();
  await mountPage({ ...sample, capture: { enabled: true, session: 'session-1' } });
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  await answer({ error: null, board: without('I_sample01') });
  await settle(() => vi.advanceTimersByTime(300));
  expect($('#abandon-dialog')).toBeNull();
  expect(posted().map(([path]) => path)).toEqual(['/api/abandon']);
});

test('a failed Abandon retains its confirmation, inline error and focus', async () => {
  holdPosts();
  await mountPage();
  await openItem('I_sample01');
  await press(button('abandon', 'I_sample01'));
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  await answer({ error: 'Could not abandon #61.' }, 502);
  expect(text(toast())).toMatch(/^Couldn't abandon #61 .*\. Could not abandon #61\.$/);
  expect(inDialog('.action-error'), 'no inline error').toBeNull();
  await settle(() => vi.advanceTimersByTime(20));
  expect($('#abandon-dialog')?.getAttribute('role')).toBe('alertdialog');
  expect(text($('#abandon-dialog [data-slot="alert"]'))).toBe('Could not abandon #61.');
  expect($('#abandon-dialog')?.contains(document.activeElement)).toBe(true);
});

const abandonButtons = () => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button');
const abandonPress = (name: string) => press(abandonButtons().find((b) => text(b) === name)!);
const boxes = () => $$<HTMLLabelElement>('#abandon-dialog label');
const tick = (name: string) => settle(() => boxes().find((box) => text(box).includes(name))!.querySelector('input')!.click());
const closedPlan = { branch: 'build/old', localBranches: ['build/old'], worktreePaths: [], remoteBranch: 'build/old', localAvailable: true, remoteAvailable: true, dirtyFiles: [], unpushedCommits: [] };

/** Presses Abandon on a Review item's notice: its confirmation is open, and its inspection is the post in flight. */
async function abandonFromNotice(ticketOpen = false) {
  const id = 'I_sample05';
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' }, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', needsYou: { reason: 'Its PR closed.', offers: ['set-aside'], causes: [{ type: 'pr-closed' }], ticketOpen } } : i) };
  await mountPage(data);
  holdPosts(data);
  await openItem(id);
  await press(button('abandon', id));
  expect(posted()).toEqual([['/api/inspect-owned-cleanup', { itemId: id }]]);
  return id;
}

test('Abandon on a notice asks with both cleanup boxes unticked and the remote warning, and Cancel changes nothing', async () => {
  const id = await abandonFromNotice();
  expect(text($('#abandon-dialog [role="status"]'))).toMatch(/^Checking/);
  expect(abandonButtons()[1]!.disabled, 'Abandon waits for the answer').toBe(true);
  await answer({ token: 't1', plans: [closedPlan] });
  expect(text($('#abandon-detail'))).toBe('This moves the item off the desk into Settings › Archive. Its ticket stays as it is. Any PR it has stays as it is.');
  expect(text($('#abandon-dialog')), 'the boxes ask about the branch and worktree').not.toContain('no branch or worktree it can remove');
  expect(boxes().map((box) => text(box).trim()), 'each box names its branches').toEqual(['Remove old local worktrees and branches: build/old', 'Delete pushed remote branch: build/old']);
  expect(boxes().map((box) => box.querySelector('input')!.checked)).toEqual([false, false]);
  expect(text($('#abandon-dialog'))).toContain('Deleting the remote branch of a closed PR can stop it being reopened, including after a restore from Archive.');
  expect(abandonButtons().map(text), 'a closed ticket has nothing to close').toEqual(['Cancel', 'Abandon']);
  await abandonPress('Cancel');
  expect(posted().map(([path]) => path)).toEqual(['/api/inspect-owned-cleanup']);
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
  expect(button('abandon', id)).not.toBeNull();
});

const NOTHING_TO_REMOVE = 'The board has no branch or worktree it can remove for this work, so anything there stays.';

for (const [name, plan] of [
  ['an unpushed branch in a live worktree', { ...closedPlan, localBranches: [], remoteBranch: null, localAvailable: false, remoteAvailable: false }],
  ['a pushed branch with an open PR', { ...closedPlan, localAvailable: false, remoteAvailable: false }],
] as const) test(`Abandon on a notice with ${name} says the board can remove nothing, with no box to tick`, async () => {
  await abandonFromNotice();
  await answer({ token: 't1', plans: [plan] });
  expect(boxes()).toEqual([]);
  expect(text($('#abandon-dialog'))).toContain(NOTHING_TO_REMOVE);
  expect(text($('#abandon-dialog'))).not.toContain('Unticked');
});

test('Abandon on a notice with no branch or worktree asks nothing about cleanup and sets the work aside', async () => {
  const id = await abandonFromNotice(true);
  await answer({ token: 't1', plans: [] });
  expect(boxes()).toEqual([]);
  expect(text($('#abandon-dialog'))).toContain(NOTHING_TO_REMOVE);
  expect(abandonButtons().map(text)).toEqual(['Cancel', 'Abandon', 'Abandon and close ticket']);
  await abandonPress('Abandon');
  expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
  expect(posted()).toHaveLength(2);
});

test('ticked cleanup with something to lose confirms the loss, runs first, then closes the ticket', async () => {
  const id = await abandonFromNotice(true);
  await answer({ token: 't1', plans: [{ ...closedPlan, dirtyFiles: ['/w: M a.ts'], unpushedCommits: ['build/old: abc Work'] }] });
  await tick('Remove old');
  await abandonPress('Abandon and close ticket');
  expect(posted(), 'the first press only shows the loss').toHaveLength(1);
  const loss = $('#abandon-dialog [data-cleanup-loss]')!;
  expect(loss.getAttribute('role'), 'the list is announced').toBe('alert');
  expect(vi.mocked(Element.prototype.scrollIntoView).mock.contexts, 'the list scrolls into view above the buttons').toContain(loss.parentElement);
  expect(text(loss.querySelector('li > span'))).toBe('build/old');
  expect($$('#abandon-dialog [data-cleanup-loss] ul ul li').map(text), 'each line drops the branch it sits under').toEqual(['/w: M a.ts', 'abc Work']);
  await abandonPress('Confirm loss, abandon and close ticket');
  expect(posted().at(-1)).toEqual(['/api/execute-owned-cleanup', { itemId: id, options: { token: 't1', local: true, remote: false, confirmedLoss: true } }]);
  await answer({ errors: [], remainingBranches: ['build/old'] });
  expect(posted().at(-1), 'unticked remaining branches are no failure').toEqual(['/api/abandon-and-close', { itemId: id }]);
});

test('when the board cannot inspect, the confirmation says what stays and still abandons without cleanup', async () => {
  const id = await abandonFromNotice();
  await answer({ error: 'T3 is unavailable.' }, 409);
  expect(text($('#abandon-dialog [data-slot="alert"]'))).toBe("The board can't inspect this work's branch or worktree. T3 is unavailable. You can abandon without cleanup, and anything there stays.");
  expect(boxes()).toEqual([]);
  await abandonPress('Abandon without cleanup');
  expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
});

test('a cleanup error keeps the item and ticket, and offers a fresh retry or the same Abandon without further cleanup', async () => {
  const id = await abandonFromNotice(true);
  await answer({ token: 't1', plans: [closedPlan] });
  await tick('Delete pushed');
  await abandonPress('Abandon and close ticket');
  await answer({ errors: ['Could not delete remote branch build/old'], remainingBranches: ['build/old'] });
  expect(posted().map(([path]) => path), 'the ticket stays alone').toEqual(['/api/inspect-owned-cleanup', '/api/execute-owned-cleanup']);
  expect(text($('#abandon-dialog [data-slot="alert"]'))).toContain('Could not delete remote branch build/old');
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
  expect(abandonButtons().map(text)).toEqual(['Cancel', 'Try cleanup again', 'Abandon and close ticket without further cleanup']);
  expect(abandonButtons().at(-1)!.dataset.wrap, 'a long label wraps instead of clipping at 320 px').toBeDefined();
  await abandonPress('Try cleanup again');
  expect(posted().at(-1)).toEqual(['/api/inspect-owned-cleanup', { itemId: id }]);
  await answer({ token: 't2', plans: [closedPlan] });
  expect(boxes().map((box) => box.querySelector('input')!.checked), 'the retry keeps the ticks').toEqual([false, true]);
  await abandonPress('Abandon');
  expect(posted().at(-1)).toEqual(['/api/execute-owned-cleanup', { itemId: id, options: { token: 't2', local: false, remote: true, confirmedLoss: false } }]);
  await answer({ error: 'Cleanup changed. Inspect and confirm again.' }, 409);
  await abandonPress('Abandon without further cleanup');
  expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
  expect(posted().filter(([path]) => path === '/api/execute-owned-cleanup')).toHaveLength(2);
});

test('a failed Abandon after cleanup keeps the confirmation, and its retry does not clean up again', async () => {
  const id = await abandonFromNotice();
  await answer({ token: 't1', plans: [closedPlan] });
  await tick('Remove old');
  await abandonPress('Abandon');
  await answer({ errors: [], remainingBranches: [] });
  expect(posted().at(-1)?.[0]).toBe('/api/abandon');
  await answer({ error: 'Could not abandon.' }, 409);
  expect(text($('#abandon-dialog [data-slot="alert"]'))).toBe('Could not abandon.');
  expect(toast(), 'the confirmation shows the failure, so no toast covers its buttons').toBeNull();
  await abandonPress('Abandon');
  expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
  expect(posted().filter(([path]) => path === '/api/execute-owned-cleanup')).toHaveLength(1);
});

test('after cleanup, a failed Abandon does not say the work has no branch or worktree', async () => {
  await abandonFromNotice();
  await answer({ token: 't1', plans: [closedPlan] });
  await tick('Remove old');
  await abandonPress('Abandon');
  await answer({ errors: [], remainingBranches: [] });
  await answer({ error: 'Could not abandon.' }, 409);
  expect(text($('#abandon-dialog'))).not.toContain(NOTHING_TO_REMOVE);
});

test('a cancelled loss prompt leaves no trace on the next Abandon', async () => {
  const id = await abandonFromNotice();
  await answer({ token: 't1', plans: [{ ...closedPlan, unpushedCommits: ['build/old: abc Work'] }] });
  await tick('Remove old');
  await tick('Delete pushed');
  await abandonPress('Abandon');
  expect(abandonButtons().map(text)).toEqual(['Cancel', 'Confirm loss and abandon']);
  await abandonPress('Cancel');
  await press(button('abandon', id));
  await answer({ token: 't2', plans: [] });
  expect(abandonButtons().map(text), 'no fresh offer keeps the loss').toEqual(['Cancel', 'Abandon']);
  await abandonPress('Cancel');
  await press(button('abandon', id));
  await answer({ token: 't3', plans: [closedPlan] });
  expect(boxes().map((box) => box.querySelector('input')!.checked), 'a fresh offer starts unticked').toEqual([false, false]);
  expect(abandonButtons().map(text)).toEqual(['Cancel', 'Abandon']);
});

test('the closed-PR warning shows only beside a closed PR', async () => {
  const id = 'I_sample05';
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' }, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', linkedPrs: [], needsYou: { reason: 'Its ticket closed.', offers: ['set-aside'], causes: [{ type: 'ticket-closed' }], ticketOpen: false } } : i) };
  await mountPage(data);
  holdPosts(data);
  await openItem(id);
  await press(button('abandon', id));
  await answer({ token: 't1', plans: [closedPlan] });
  expect(text($('#abandon-dialog'))).toContain('Delete pushed remote branch');
  expect(text($('#abandon-dialog'))).not.toContain('Deleting the remote branch of a closed PR');
});

test('a failed cleanup no longer offers to close a ticket the board has since read closed', async () => {
  const id = await abandonFromNotice(true);
  await answer({ token: 't1', plans: [closedPlan] });
  await tick('Delete pushed');
  await abandonPress('Abandon and close ticket');
  await answer({ errors: ['Could not delete remote branch build/old'], remainingBranches: ['build/old'], board: { ...sample, capture: { enabled: true, session: 's1' }, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', needsYou: { reason: 'Its PR closed.', offers: ['set-aside'], causes: [{ type: 'pr-closed' }], ticketOpen: false } } : i) } });
  expect(text($('#abandon-detail'))).not.toContain('close ticket');
  expect(abandonButtons().map(text)).toEqual(['Cancel', 'Try cleanup again', 'Abandon without further cleanup']);
  await abandonPress('Abandon without further cleanup');
  expect(posted().at(-1)).toEqual(['/api/abandon', { session: 's1', itemId: id }]);
});

test('a failed cleanup on work with no ticket says nothing about a ticket', async () => {
  const id = 'I_sample05';
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' }, items: sample.items.map(i => i.id === id
    ? { ...i, number: 0, status: 'Review', needsYou: { reason: 'Its PR closed.', offers: ['set-aside'], causes: [{ type: 'pr-closed' }], ticketOpen: false } } : i) };
  await mountPage(data);
  holdPosts(data);
  await openItem(id);
  await press(button('abandon', id));
  await answer({ token: 't1', plans: [closedPlan] });
  await tick('Delete pushed');
  await abandonPress('Abandon');
  await answer({ errors: ['Could not delete remote branch build/old'], remainingBranches: ['build/old'] });
  expect(text($('#abandon-dialog [data-slot="alert"]'))).toBe("Cleanup didn't finish. The item stays on the desk with its notice. Could not delete remote branch build/old");
});

test('in sample mode the dialog’s actions are disabled', async () => {
  await mountPage({ ...sample, capture: { enabled: false } as BoardData['capture'] });
  await openItem('I_sample01');
  for (const b of [button('queue', 'I_sample01'), button('abandon', 'I_sample01')]) expect([b.disabled, b.title]).toEqual([true, 'Disabled in sample mode']);
});

test('an item that leaves the board closes the dialog for good: its coming back later opens nothing', async () => {
  await mountPage();
  await openItem('I_sample13');
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(without('I_sample13')));
  expect(useItemDialogStore.getState().itemId).toBeNull();
  await settle(() => useBoardStore.getState().receive(sample));
  expect(dialog()).toBeNull();
});

test('closing the dialog clears the store, and Escape closes it', async () => {
  await mountPage();
  await openItem('I_sample13');
  const { useItemDialogStore } = await import('./item-dialog-store.ts');
  const popup = dialog()!;
  await settle(() => popup.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(useItemDialogStore.getState().itemId).toBeNull();
  expect(dialog()).toBeNull();
});

test('work that needs you shows why, confirms each choice before posting it, offers no Clear, and sets the work aside through Abandon', async () => {
  holdPosts();
  const id = 'I_sample05';
  const reason = 'Its PR closed without merging.';
  await mountPage({ ...sample, capture: { enabled: true, session: 'session-1' },
    items: sample.items.map((i) => (i.id === id ? { ...i, status: 'Review', needsYou: { reason, offers: ['reopen-pr', 'replace-pr', 'set-aside'], causes: [{ type: 'pr-closed' }, { type: 'ticket-closed' }], ticketOpen: false } } : i)) });
  await openItem(id);
  expect(text(inDialog('[data-needs-you-reason] p'))).toBe(`Needs you: ${reason}`);
  expect($$('[data-needs-you-reason] button').map(text)).toEqual(['Reopen PR', 'Start a replacement build', 'Abandon']);
  await press($$<HTMLButtonElement>('[data-needs-you-reason] button')[0]!);
  expect(posted(), 'pressing a choice writes nothing').toEqual([]);
  expect(confirmation()!.getAttribute('role')).toBe('alertdialog');
  expect(text($('#needs-you-detail'))).toContain('Its ticket stays closed.');
  expect(confirmButtons().map(text)).toEqual(['Cancel', 'Reopen PR']);
  await confirmPress('Reopen PR');
  expect(posted()).toEqual([['/api/needs-you', { itemId: id, choice: 'reopen-pr' }]]);
  await answer({ error: "Couldn't reopen the PR." }, 502);
  expect(text($('#needs-you-dialog [data-slot="alert"]')), 'the failure stays in the confirmation').toBe("Couldn't reopen the PR.");
  expect(inDialog('.action-error [role="alert"]')).toBeNull();
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
  await confirmPress('Try again');
  expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: id, choice: 'reopen-pr' }]);
  expect(posted()).toHaveLength(2);
  await answer({ error: null });
  expect(confirmation()).toBeNull();
  await press($$<HTMLButtonElement>('[data-needs-you-reason] button')[1]!);
  expect(text($('#needs-you-dialog h2'))).toMatch(/^Start a replacement build for #129 /);
  await confirmPress('Start a replacement build');
  expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: id, choice: 'replace-pr' }]);
  await answer({ error: null });
  await press($$<HTMLButtonElement>('[data-needs-you-reason] button')[2]!);
  expect(text($('#abandon-dialog h2'))).toMatch(/^Abandon #129 /);
});

test('Cancel and Escape leave the notice and post nothing, and the choice takes focus back', async () => {
  holdPosts();
  const id = 'I_sample05';
  await mountPage({ ...sample, capture: { enabled: true, session: 'session-1' },
    items: sample.items.map((i) => (i.id === id ? { ...i, status: 'Review', needsYou: { reason: 'Why.', offers: ['keep-working', 'set-aside'], causes: [{ type: 'ticket-closed' }], ticketOpen: false } } : i)) });
  await openItem(id);
  await press(button('needs-you', id));
  await confirmPress('Cancel');
  await settle(() => vi.advanceTimersByTime(100));
  expect(confirmation()).toBeNull();
  expect(document.activeElement).toBe(button('needs-you', id));
  await press(button('needs-you', id));
  await settle(() => vi.advanceTimersByTime(100));
  await settle(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  await settle(() => vi.advanceTimersByTime(100));
  expect(confirmation(), 'Escape cancels').toBeNull();
  expect(dialog(), 'and leaves the item dialog open').not.toBeNull();
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
  expect(posted()).toEqual([]);
});

/** A Dependency on the server team blocking a build, its ticket read an hour before NOW as `kind`. */
function dependencyBlocker(kind: NonNullable<DependencyHold['observation']>['kind'], change: Partial<DependencyHold> = {}): Blocker {
  const hold: DependencyHold = { dependencyId: 'dep-1', revision: 3, owner: 'server team', need: 'An export endpoint', ticket: 'maddec01/lar-server#40',
    named: [{ reference: 'maddec01/lar-server#40', url: 'https://github.com/maddec01/lar-server/issues/40' }], evidence: 'The endpoint answers in staging', met: null, needsReview: false,
    observation: { subject: 'maddec01/lar-server#40', kind, detail: null, observedAt: '2026-10-21T09:00:00Z', lastGood: null }, ...change };
  return { number: 40, repo: 'maddec01/lar-server', state: hold.met ? 'closed' : 'open', title: hold.need, dependency: hold };
}
const withDependency = (blocker: Blocker): BoardData => ({ ...sample, capture: { enabled: true, session: 'session-1' },
  items: sample.items.map((i) => (i.id === 'I_sample13' ? { ...i, blockers: [blocker] } : i)) });
const dependencyRow = () => inDialog('[data-dependency="dep-1"]')!;

test('a Dependency shows its team, ticket, latest read and evidence, suggests Mark met once its ticket closed, and posts the mark', async () => {
  holdPosts();
  await mountPage(withDependency(dependencyBlocker('closed')));
  await openItem('I_sample13');
  expect(text(inDialog('[data-item-summary] > div'))).toContain('blocked by 1');
  expect(text(section('Dependencies').querySelector('[data-dependency-owner]'))).toBe('Dependency on server team · not met');
  expect(text(dependencyRow())).toContain('An export endpoint');
  expect(text(dependencyRow().querySelector('[data-dependency-read]'))).toBe('maddec01/lar-server#40 closed, read 1h ago');
  const ticket = dependencyRow().querySelector<HTMLAnchorElement>('[data-dependency-read] a')!;
  expect([text(ticket), ticket.href, ticket.target], 'its ticket opens in the browser').toEqual(['maddec01/lar-server#40', 'https://github.com/maddec01/lar-server/issues/40', '_blank']);
  expect(text(dependencyRow().querySelector('[data-dependency-evidence]'))).toBe('Evidence: The endpoint answers in staging');
  expect(text(dependencyRow().querySelector('[data-dependency-notice]'))).toBe('Its ticket maddec01/lar-server#40 is closed. Mark it met once the change is delivered.');
  expect(footerControls()).toEqual(['GitHub', 'Open thread', 'Start after server team ▾']);
  expect(inDialog<HTMLButtonElement>('[data-start-after]')!.title).toBe('Starts by itself once you mark the Dependency on server team met');
  expect(dependencyRow().querySelector('button')!.getAttribute('aria-label')).toMatch(/^Mark the Dependency on server team met: #140 /);
  await press(dependencyRow().querySelector<HTMLButtonElement>('button')!);
  expect(posted()).toEqual([['/api/dependency-met', { itemId: 'I_sample13', dependencyId: 'dep-1', revision: 3, met: true }]]);
  await answer({ error: 'The Dependency dep-1 is at revision 4, not 3; read it again and retry.' }, 409);
  expect(text(inDialog('.action-error [role="alert"]'))).toBe('The Dependency dep-1 is at revision 4, not 3; read it again and retry.');
});

test('a Dependency with an open ticket suggests nothing, and one without a read or evidence says so', async () => {
  await mountPage(withDependency(dependencyBlocker('open', { evidence: '', observation: null })));
  await openItem('I_sample13');
  expect(text(dependencyRow().querySelector('[data-dependency-read]'))).toBe('maddec01/lar-server#40 not read yet');
  expect(text(dependencyRow().querySelector('[data-dependency-evidence]'))).toBe('No evidence agreed yet');
  expect(dependencyRow().querySelector('[data-dependency-notice]')).toBeNull();
});

test('a Dependency naming no ticket or PR says it is a handover only', async () => {
  await mountPage(withDependency(dependencyBlocker('open', { ticket: null, named: [], observation: null })));
  await openItem('I_sample13');
  expect(text(dependencyRow().querySelector('[data-dependency-read]'))).toBe('No ticket. Handover only.');
});

test("a Dependency whose read failed says how in words, beside the last read that answered", async () => {
  const lastGood = { kind: 'open' as const, observedAt: '2026-10-19T09:00:00Z' };
  await mountPage(withDependency(dependencyBlocker('access-lost', { observation: { subject: 'maddec01/lar-server#40', kind: 'access-lost', detail: 'HTTP 403',
    observedAt: '2026-10-21T09:00:00Z', lastGood } })));
  await openItem('I_sample13');
  expect(text(dependencyRow().querySelector('[data-dependency-read]'))).toBe('maddec01/lar-server#40 access lost, read 1h ago; last read open, 2d ago');
});

test('a met Dependency whose ticket changed since asks for a review, offers to clear the mark and no longer blocks', async () => {
  holdPosts();
  await mountPage(withDependency(dependencyBlocker('reopened', { met: { by: 'pedro', at: '2026-10-21T08:00:00Z' }, needsReview: true })));
  await openItem('I_sample13');
  expect(text(inDialog('[data-item-summary] > div'))).not.toContain('blocked by');
  expect(text(section('Dependencies').querySelector('[data-dependency-owner]'))).toBe('Dependency on server team · met, marked by pedro 2h ago');
  expect(text(dependencyRow().querySelector('[data-dependency-notice]'))).toBe('Its ticket maddec01/lar-server#40 changed to reopened after you marked it met. Review the mark.');
  const clear = dependencyRow().querySelector<HTMLButtonElement>('button')!;
  expect(text(clear)).toBe('Clear met mark');
  expect(clear.getAttribute('aria-label')).toMatch(/^Clear the met mark on the Dependency on server team: #140 /);
  await press(clear);
  expect(posted()).toEqual([['/api/dependency-met', { itemId: 'I_sample13', dependencyId: 'dep-1', revision: 3, met: false }]]);
});

test('work that needs nothing from you shows no reason', async () => {
  await mountPage();
  await openItem('I_sample05');
  expect(inDialog('[data-needs-you-reason]')).toBeNull();
});

test('stopped shaping offers Resume shaping and starts through the existing model menu', async () => {
  const stopped = { ...thread('stopped-shape', 'stopped'), purpose: 'shape' };
  const older = { ...thread('older-shape', 'done'), purpose: 'shape' };
  const data: BoardData = { ...withThreads('I_sample05', [stopped, older]), capture: { session: 's1', enabled: true },
    started: { I_sample05: { threadId: older.id, title: older.title } } };
  data.items = data.items.map((item) => item.id === 'I_sample05' ? { ...item, status: 'Shaping' } : item);
  holdPosts(data);
  await mountPage(data);
  await openItem('I_sample05');
  expect(text(button('start', 'I_sample05'))).toBe('Resume shaping ▾');
  expect(inDialog('[data-open-thread="I_sample05"]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/stopped-shape');
  await pressMenu(button('start', 'I_sample05'));
  await settle(() => $$('[role="menu"] [role="menuitemradio"]')[0]!.click());
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample05' }]]);
  await answer({ thread: { threadId: 'resumed', title: 'Resume shaping' }, error: null,
    board: { ...data, started: { I_sample05: { threadId: 'resumed', title: 'Resume shaping' } } } });
  expect(text(inDialog('[data-start-result="I_sample05"]'))).toBe('Started');
  expect(inDialog('[data-start="I_sample05"]')).toBeNull();
});

test.each(['Shaping', 'Queued'] as const)('a stopped parent with an active child keeps Open thread in %s', async (status) => {
  const data = withThreads('I_sample05', [{ ...thread('parent', 'stopped'), purpose: 'shape', hasLiveChildren: true }]);
  data.items = data.items.map((item) => item.id === 'I_sample05' ? { ...item, status } : item);
  await mountPage(data);
  await openItem('I_sample05');
  expect(inDialog('[data-start="I_sample05"]')).toBeNull();
  expect(text(inDialog('[data-open-thread="I_sample05"]'))).toBe('Open thread');
});

test('slice details follow live unknown and recovered progress while open', async () => {
  await mountPage();
  await openItem('I_sample13');
  const { useBoardStore } = await import('../board/board-store.ts');
  for (const progress of ['unknown', 'active', 'blocked', 'waiting', 'done'] as const) {
    await settle(() => useBoardStore.getState().receive({ ...sample, items: sample.items.map(item => item.id === 'I_sample13'
      ? { ...item, slices: item.slices.map((slice, index) => index === 1 ? { ...slice, progress } : slice) } : item) }));
    const chip = inDialog('[data-slices] ul')!.children[1]!;
    expect(text(chip)).toContain(progress);
    expect(chip.querySelector('.status-pulse') !== null).toBe(progress === 'active');
    expect(text(inDialog('[data-slices] p'))).toBe(progress === 'done' ? 'Slices · 2/3 done' : 'Slices · 1/3 done');
    if (progress === 'unknown') expect(text(chip)).toContain('?');
  }
});

test('deleted work thread offers the later recovery actions without Clear', async () => {
  const id = 'I_sample05';
  await mountPage({ ...sample, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', needsYou: { reason: 'The latest work thread was deleted.', causes: [], ticketOpen: false, deletedThread: true,
      offers: ['start-again', 'back-to-queue', 'back-to-list'] } } : i) });
  await openItem(id);
  expect($$('[data-needs-you-reason] button').map(text)).toEqual(['Start again', 'Back to Queue', 'Move to List']);
  expect($$<HTMLButtonElement>('[data-needs-you-reason] button').map(button => button.disabled)).toEqual([false, false, false]);
});

test('moving deleted-thread work with a passing brief asks before sending the move', async () => {
  const id = 'I_sample05';
  await mountPage({ ...sample, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', passingBrief: true, needsYou: { reason: 'Deleted', causes: [], ticketOpen: false, deletedThread: true,
      offers: ['back-to-list'] } } : i) });
  await openItem(id);
  await press(button('needs-you', id));
  expect(confirmButtons().map(text)).toEqual(['Cancel', 'Keep passing', 'Reshape']);
  expect(text(confirmation())).toContain('This moves the item to List.');
  expect(posted()).toEqual([]);
});

test('Back to Queue asks first and sends the move only once confirmed', async () => {
  const id = 'I_sample05';
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' }, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', passingBrief: false, needsYou: { reason: 'Deleted', causes: [], ticketOpen: false, deletedThread: true, offers: ['back-to-queue'] } } : i) };
  await mountPage(data);
  holdPosts(data);
  await openItem(id);
  await press(button('needs-you', id));
  expect(posted()).toEqual([]);
  await confirmPress('Back to Queue');
  expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
  await answer({ token: 'empty', plans: [] });
  expect(posted().at(-1)).toEqual(['/api/needs-you', { itemId: id, choice: 'back-to-queue' }]);
});

async function recoveryItem(build = true, needsYou: Partial<NonNullable<Item['needsYou']>> = { reason: 'Deleted work thread', causes: [], deletedThread: true }) {
  const id = 'I_sample05';
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' }, items: sample.items.map(i => i.id === id
    ? { ...i, status: 'Review', threads: [],
      needsYou: { reason: '', causes: [], ticketOpen: false, startAgainPurpose: build ? 'build' : 'shape', offers: ['start-again', 'back-to-list'], ...needsYou } } : i) };
  await mountPage(data);
  holdPosts(data);
  await openItem(id);
  await press(button('needs-you', id));
  return id;
}

test('shaping Start again confirms before posting and keeps the notice and the confirmation on failure', async () => {
  const id = await recoveryItem(false);
  expect(posted()).toEqual([]);
  await confirmPress('Start again');
  expect(posted()).toEqual([['/api/start-again', { itemId: id, options: {} }]]);
  await answer({ error: 'T3 is unavailable.' }, 502);
  expect(text($('#needs-you-dialog [data-slot="alert"]'))).toBe('T3 is unavailable.');
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
});

test('an uncertain start keeps the confirmation open with its message', async () => {
  await recoveryItem(false);
  await confirmPress('Start again');
  await answer({ thread: null, error: 'T3 may have started it.', uncertain: true }, 502);
  expect(text($('#needs-you-dialog [data-slot="alert"]'))).toBe('T3 may have started it.');
  expect(confirmButtons().map(text)).toEqual(['Cancel', 'Try again']);
});

test('a no-thread notice starts again through its confirmation, and a started thread removes the notice', async () => {
  const id = await recoveryItem(false, { reason: 'T3 shows no thread.', causes: [{ type: 'no-thread' }], offers: ['start-again', 'set-aside'] });
  expect(text($('#needs-you-detail'))).toContain('This starts a new shaping thread in T3.');
  expect(posted()).toEqual([]);
  await confirmPress('Start again');
  expect(posted()).toEqual([['/api/start-again', { itemId: id, options: {} }]]);
  await answer({ error: 'T3 refused.' }, 502);
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
  await confirmPress('Try again');
  await answer({ thread: { threadId: 't', title: 't' }, error: null, board: { ...sample, items: sample.items.map(i => i.id === id ? { ...i, needsYou: undefined } : i) } });
  expect(confirmation()).toBeNull();
  expect(inDialog('[data-needs-you-reason]')).toBeNull();
});

test('a no-thread build inspects its branch on opening, and only reads', async () => {
  const id = await recoveryItem(true, { reason: 'T3 shows no thread.', causes: [{ type: 'no-thread' }], offers: ['start-again', 'set-aside'] });
  expect(posted()).toEqual([['/api/inspect-recovery', { itemId: id }]]);
});

test('build recovery inspects before offering branches and explains a missing worktree', async () => {
  const id = await recoveryItem();
  expect(posted()).toEqual([['/api/inspect-recovery', { itemId: id }]]);
  expect(text(confirmation())).toContain('Checking the branch and PR...');
  await answer({ inspection: { branch: 'build/old', branchExists: true, worktreePath: null, pr: 'none' } });
  expect(text(confirmation())).toContain('The old worktree is gone.');
  expect(confirmButtons().map(text)).toEqual(['Cancel', 'Continue on old branch', 'Start on new branch']);
});

test('open PR recovery offers only continue and preserves the PR in its confirmation', async () => {
  await recoveryItem();
  await answer({ inspection: { branch: 'build/old', branchExists: true, worktreePath: '/old', pr: 'open' } });
  expect(text(confirmation())).toContain('Its commits and reviews stay, and the PR stays open.');
  expect(confirmButtons().map(text)).toEqual(['Cancel', 'Continue on old branch']);
});

test('inspection errors preserve the recovery notice and can be read again', async () => {
  const id = await recoveryItem();
  await answer({ error: 'Cannot inspect local worktrees' }, 502);
  expect(text($('#needs-you-dialog [data-slot="alert"]'))).toContain('Cannot inspect local worktrees');
  expect(inDialog('[data-needs-you-reason]')).not.toBeNull();
  await confirmPress('Try again');
  expect(posted()).toEqual([['/api/inspect-recovery', { itemId: id }], ['/api/inspect-recovery', { itemId: id }]]);
  await answer({ inspection: { branch: 'build/old', branchExists: true, worktreePath: null, pr: 'none' } });
  expect($('#needs-you-dialog [data-slot="alert"]')).toBeNull();
});

test('absent branch starts new once confirmed and receives the successful board', async () => {
  const id = await recoveryItem();
  await answer({ inspection: { branch: 'build/old', branchExists: false, worktreePath: null, pr: 'none' } });
  expect(posted(), 'nothing starts until the confirmation').toHaveLength(1);
  await confirmPress('Start again');
  expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
  await answer({ token: 'empty', plans: [] });
  expect(posted().at(-1)).toEqual(['/api/start-again', { itemId: id, options: { branchChoice: 'new' } }]);
  await answer({ board: { ...sample, items: sample.items.map(i => i.id === id ? { ...i, needsYou: undefined } : i) } });
  expect(inDialog('[data-needs-you-reason]')).toBeNull();
});

test('unknown PR state warns before choosing a new branch', async () => {
  await recoveryItem();
  await answer({ inspection: { branch: 'build/old', branchExists: false, worktreePath: null, pr: 'unknown', warning: 'Observation failed' } });
  expect(text(confirmation())).toContain('A new branch or move could create a second PR.');
  expect(posted()).toHaveLength(1);
  expect(confirmButtons().map(text)).not.toContain('Continue on old branch');
});

test('choosing a branch uses the model menu and sends recovery options', async () => {
  const id = await recoveryItem();
  await answer({ inspection: { branch: 'build/old', branchExists: true, worktreePath: null, pr: 'none' } });
  await pressMenu(confirmButtons().find(b => text(b) === 'Start on new branch')!);
  await press($<HTMLElement>('[data-start-pick]')!);
  expect(posted().at(-1)?.[0]).toBe('/api/inspect-owned-cleanup');
  await answer({ token: 'empty', plans: [] });
  expect(posted().at(-1)).toEqual(['/api/start-again', { itemId: id, options: { branchChoice: 'new', confirmedOpenPr: false } }]);
  await answer({ error: 'Start refused' }, 409);
  expect(text($('#needs-you-dialog [data-slot="alert"]'))).toBe('Start refused');
});

/** The dialog's footer with `threads` on an item at `status`. */
const footerAt = async (status: Item['status'], threads: Item['threads'], data: BoardData = sample) => {
  const board = withThreads('I_sample16', threads, data);
  await mountPage({ ...board, items: board.items.map((i) => (i.id === 'I_sample16' ? { ...i, status, completion: undefined } : i)) });
  await openItem('I_sample16');
  return footerControls();
};

test.each([
  ['Verify', ['GitHub', 'Open thread', 'Verify build']],
  ['Ready to merge', ['GitHub', 'Open thread', 'Merge PR']],
  ['Done', ['GitHub', 'Open thread']],
  ['Review', ['GitHub', 'Open thread']],
] as const)('a %s item with a thread has exactly one way to its thread', async (status, controls) => {
  expect(await footerAt(status, [thread('latest', 'done')])).toEqual(controls);
  expect(inDialog('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/latest');
});

test('a stopped run\'s latest thread is linked once, beside Start again', async () => {
  const data = withThreads('I_sample13', [thread('stopped-build', 'stopped')], { ...sample, startedBuilds: { I_sample13: { threadId: 'stopped-build', title: 'Build' } } });
  await mountPage({ ...data, items: data.items.map((i) => (i.id === 'I_sample13' ? { ...i, blockers: [] } : i)) });
  await openItem('I_sample13');
  expect(text(footer())).toContain('Run stopped.');
  expect(footerControls().filter((control) => control === 'Open thread')).toHaveLength(1);
});

test('an item with no recorded thread shows no extra Open thread', async () => {
  expect(await footerAt('Verify', [])).toEqual(['GitHub', 'Verify build']);
});

test.each([
  ['threads can\'t be read', 'unavailable' as const, sample, 'The T3 Code database could not be read'],
  ['the thread is archived', [{ ...thread('old', 'done'), archived: true as const }], sample, 'This thread is archived in T3 Code'],
  ['the environment id is missing', [thread('latest', 'done')], { ...sample, t3EnvironmentId: undefined }, 'T3 Code hasn\'t written its environment id'],
])('beside the Status\'s action, Open thread is disabled when %s', async (_case, threads, data, reason) => {
  expect(await footerAt('Verify', threads, data)).toEqual(['GitHub', `Open thread (disabled: ${reason})`, 'Verify build']);
});

test('Answer in T3 keeps the question\'s thread, and Open thread joins it only for a different thread', async () => {
  expect(await footerAt('Needs you', [thread('latest', 'running'), thread('question', 'needs you')])).toEqual(['GitHub', 'Open thread', 'Answer in T3']);
  expect(statusAction().getAttribute('href')).toBe('t3code://threads/sample-environment/question');
  await openItem('I_sample12');
  expect(footerControls()).toEqual(['GitHub', 'Answer in T3']);
});

const CONCEPT = 'I_sample09';
const stats = (costUsd: number) => ({ agentMs: 60_000, tokens: 1000, costUsd });
const conceptBoard = (own: Item['stats'], part: Item['stats'], threads: Item['threads'] = [thread('part', 'done')]): BoardData => ({ ...sample,
  items: sample.items.map((i) => (i.id === CONCEPT ? { ...i, kind: 'concept' as const, stats: own } : i.parentId === CONCEPT ? { ...i, stats: undefined, threads: i.id === 'I_sample10' ? threads : [] } : i))
    .map((i) => (i.id === 'I_sample10' ? { ...i, stats: part } : i)) });

test('concept details label its own cost and its total on the board', async () => {
  await mountPage(conceptBoard(stats(1), stats(2)));
  await openItem(CONCEPT);
  const meta = text(inDialog('[data-meta]'));
  expect(meta).toContain('Own cost: $1.00');
  expect(meta).toContain('Total on the board: $3.00');
  expect(inDialog('[data-slot="modal-header"] [data-agent-work]'), 'the labelled figures sit in the meta area alone').toBeNull();
});

test('a concept with no usable total shows its own cost only, and unreadable usage says so', async () => {
  await mountPage(conceptBoard(stats(1), 'unavailable'));
  await openItem(CONCEPT);
  expect(text(inDialog('[data-meta]'))).toContain('Own cost: $1.00');
  expect(text(inDialog('[data-meta]'))).not.toContain('Total on the board');
  expect(text(inDialog('[data-concept-part="I_sample10"]'))).toContain('Usage details are unavailable.');
});

test('a concept whose usage can\'t be read says so instead of a number', async () => {
  await mountPage(conceptBoard('unavailable', 'unavailable'));
  await openItem(CONCEPT);
  expect(text(inDialog('[data-meta]'))).toContain('Usage details are unavailable.');
  expect(text(inDialog('[data-meta]'))).not.toContain('$');
});

test('concept details list each part with its status, cost and Open thread, and a part opens its own details', async () => {
  await mountPage(conceptBoard(stats(1), stats(2)));
  await openItem(CONCEPT);
  const row = inDialog('[data-concept-part="I_sample10"]')!;
  expect(text(row)).toContain('#201 Relay: broker only or full TURN?');
  expect(text(row)).toContain('Shaping');
  expect(text(row)).toContain('$2.00');
  expect(row.querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/part');
  expect(inDialog('[data-concept-part="I_sample13"] [data-open-thread]'), 'a part with no thread has no control').toBeNull();
  await press(row.querySelector('button')!);
  expect(text(inDialog('[data-slot="modal-header"] h2'))).toBe('#201 Relay: broker only or full TURN?');
});

const decisionBoard = (change: Partial<Item>): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === 'I_sample05' ? { ...i, kind: 'decision' as const, labels: [], status: 'Done' as const, ...change } : i)) });

test('decision details show the method, cost and every thread, and pick up the next stats read', async () => {
  const threads = [{ ...thread('latest', 'done'), purpose: 'build' }, { ...thread('older', 'done'), purpose: 'research' }];
  const data = decisionBoard({ decisionMethod: 'research', stats: stats(4), threads });
  await mountPage(data);
  await openItem('I_sample05');
  expect(text(inDialog('[data-item-kind]'))).toContain('Research');
  expect(text(inDialog('[data-item-kind]'))).not.toContain('Decision');
  expect(text(inDialog('[data-slot="modal-header"]'))).toContain('$4.00');
  expect(inDialog('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/latest');
  expect(inDialog<HTMLAnchorElement>('[data-earlier-threads] a')!.getAttribute('href')).toBe('t3code://threads/sample-environment/older');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(decisionBoard({ decisionMethod: 'research', stats: stats(5), threads })));
  expect(text(inDialog('[data-slot="modal-header"]'))).toContain('$5.00');
});

test('a settled decision with no thread and no valid method shows no control, no cost and No method', async () => {
  await mountPage(decisionBoard({ decisionMethod: null, threads: [], stats: undefined }));
  await openItem('I_sample05');
  expect(text(inDialog('[data-item-kind]'))).toContain('No method');
  expect(inDialog('[data-open-thread]')).toBeNull();
  expect(inDialog('[data-agent-work]')).toBeNull();
});

test('while T3 can\'t be read, known figures stay and say they are last known', async () => {
  const data = { ...conceptBoard(stats(1), stats(2)), usageRead: { readable: false, readAt: '2026-11-03T10:00:00.000Z' } };
  await mountPage(data);
  await openItem(CONCEPT);
  const meta = text(inDialog('[data-meta]'));
  expect(meta).toContain('Own cost: $1.00');
  expect(meta).toContain('Total on the board: $3.00');
  expect(meta).toContain('last known');
  expect(meta).not.toContain('Usage details are unavailable.');
  expect(inDialog('[data-agent-work]')!.title).toMatch(/Last known figures from 3 Nov, \d\d:\d\d: T3 Code's usage can't be read now\./);
});

test('figures of all zeros show no misleading number', async () => {
  await mountPage(conceptBoard({ agentMs: 0, tokens: 0, costUsd: 0 }, undefined));
  await openItem(CONCEPT);
  expect(inDialog('[data-agent-work]')).toBeNull();
});

test('a T3 outage that leaves usage readable shows figures as current', async () => {
  await mountPage({ ...conceptBoard(stats(1), stats(2)), t3Availability: { availability: 'unavailable' }, usageRead: { readable: true } });
  await openItem(CONCEPT);
  expect(text(inDialog('[data-meta]'))).not.toContain('last known');
});

test('a settled decision with no thread leaves out the unfinished-sounding note', async () => {
  await mountPage(decisionBoard({ decisionMethod: 'grill', threads: [], stats: undefined, completion: { complete: true, reasons: [] } }));
  await openItem('I_sample05');
  expect(text(inDialog('[data-meta]'))).not.toContain('No T3 thread');
});

test('a concept with no thread of its own says so beside its total', async () => {
  await mountPage({ ...conceptBoard(undefined, stats(2)), items: conceptBoard(undefined, stats(2)).items.map((i) => (i.id === CONCEPT ? { ...i, threads: [] } : i)) });
  await openItem(CONCEPT);
  const meta = text(inDialog('[data-meta]'));
  expect(meta).toContain('No T3 thread of its own.');
  expect(meta).toContain('Total on the board: $2.00');
  expect(meta).not.toContain('has worked on this yet');
});

test('a decision\'s question thread is linked by Answer in T3 alone, not again among its earlier threads', async () => {
  await mountPage(decisionBoard({ status: 'Needs you', threads: [thread('newer', 'done'), thread('question', 'needs you')] }));
  await openItem('I_sample05');
  expect(footerControls()).toEqual(expect.arrayContaining(['Open thread', 'Answer in T3']));
  expect(inDialog('[data-earlier-threads]')).toBeNull();
});

test('a settled decision keeps a link to an older thread that once asked a question', async () => {
  await mountPage(decisionBoard({ threads: [thread('newer', 'done'), thread('question', 'needs you')] }));
  await openItem('I_sample05');
  expect(inDialog('[data-earlier-threads] a')!.getAttribute('href')).toBe('t3code://threads/sample-environment/question');
});

test('during a usage outage, work known to have no thread doesn\'t claim lost usage', async () => {
  await mountPage(decisionBoard({ threads: [], stats: 'unavailable', completion: { complete: true, reasons: [] } }));
  await openItem('I_sample05');
  const meta = text(inDialog('[data-meta]'));
  expect(meta).not.toContain('Usage details are unavailable.');
  expect(meta).not.toContain('No T3 thread');
});

const ID = (n: number) => `${n}${n}${n}${n}${n}${n}${n}${n}-1111-4111-8111-111111111111`;
const conceptWith = (change: Partial<Item>): BoardData => ({ ...sample, items: sample.items.map((i) => (i.id === CONCEPT ? { ...i, kind: 'concept' as const, ...change } : i)) });

test('a concept\'s Delivery counts its unfinished parts without work IDs, and keeps its other reasons in words', async () => {
  const board = conceptWith({ completion: { complete: false, reasons: [
    "Its Fog isn't gone.", `Its build ${ID(1)} isn't Done.`, `Its build ${ID(2)} isn't Done.`, `Its decision ${ID(3)} isn't settled.`, 'No delivery planned.', `Its Dependency ${ID(4)} on server team isn't met.`,
  ] } });
  await mountPage({ ...board, items: board.items.map((i) => (i.id === 'I_sample13' ? { ...i, id: ID(1), title: 'Owner accounts' } : i)) });
  await openItem(CONCEPT);
  const meta = text(inDialog('[data-meta]'));
  expect(meta).toContain("2 builds remaining. 1 decision unsettled. Its Fog isn't gone. No delivery planned. Dependency on server team isn't met.");
  expect(meta).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  expect($$<HTMLElement>('[data-item-dialog] [data-meta] span[title]').some((el) => el.title === 'Owner accounts')).toBe(true);
});

test('a concept\'s Refinement says what it needs without work IDs', async () => {
  await mountPage(conceptWith({ refinement: { complete: false, reasons: ['Its map is empty.', `Its decision ${ID(5)} isn't settled.`] } }));
  await openItem(CONCEPT);
  const meta = text(inDialog('[data-meta]'));
  expect(meta).toContain('1 decision unsettled. Its map is empty.');
  expect(meta).not.toContain(ID(5));
});

test('a concept shows its parts done from its records, with no status ladder', async () => {
  await mountPage(conceptWith({ status: 'In progress', subIssues: { total: 9, completed: 5 } }));
  await openItem(CONCEPT);
  expect(text(inDialog('[data-parts-progress]'))).toBe('Parts · 5/9 done');
  expect(inDialog('[data-parts-progress] [aria-hidden] > div')!.style.width).toBe(`${5 / 9 * 100}%`);
  expect(inDialog('[data-steps]')).toBeNull();
  expect(text(inDialog('[data-progress]'))).not.toContain('5/8');
});

test('a concept with no parts shows no parts progress', async () => {
  await mountPage(conceptWith({ status: 'Done', subIssues: { total: 0, completed: 0 } }));
  await openItem(CONCEPT);
  expect(inDialog('[data-parts-progress]')).toBeNull();
});

test('a build keeps its status ladder', async () => {
  await mountPage();
  await openItem('I_sample14');
  expect(inDialog('[data-steps]')).not.toBeNull();
  expect(inDialog('[data-parts-progress]')).toBeNull();
});

test.each([[true, 0], [false, 1]])('with details loading, a concept recorded %s draws %i legacy diagrams', async (recorded, diagrams) => {
  const board = conceptWith({ recorded, map: { destination: '', decisions: [], fog: [], diagram: 'graph TD; A-->B' } });
  fetchMock.mockImplementation((url: string) => (detailsRead(url) ? new Promise<Response>(() => {}) : Promise.resolve(new Response(JSON.stringify(board)))));
  await mountPage(board);
  await openItem(CONCEPT);
  expect(dialog()!.querySelectorAll('[data-map-diagram]')).toHaveLength(diagrams);
});
