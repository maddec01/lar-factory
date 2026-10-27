// The line's Queue: Queued items as numbered rows that open the item dialog, the build slots, Start refining and
// Start next with their model menu, and what a start shows on the row. Ported from the Queued cases of the old Board
// view's tests.

import { beforeEach, expect, test } from 'vite-plus/test';
import { $, $$, answer, holdPosts, moved, mountPage, posted, sample, settle, text, toast } from '../../test/support.ts';
import type { BoardData, Item, ModelGroup } from '@lar-factory/shared';

const MODEL_CHOICES: ModelGroup[] = [
  { instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] },
  { instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Opus 5.5' }] },
];
const withChoices: BoardData = { ...sample, capture: { session: 's1', enabled: true }, modelChoices: MODEL_CHOICES };
const CHOICE_KEY = 'lar-board:model-choice';

const queue = () => $('.queue')!;
const rows = () => $$<HTMLLIElement>('.queue ol > li');
const row = (id: string) => $<HTMLLIElement>(`.queue li[data-item="${id}"]`)!;
const start = (id = 'I_sample05') => row(id).querySelector<HTMLButtonElement>(`[data-start="${id}"]`)!;
const startNext = () => queue().querySelector<HTMLButtonElement>('header [data-start]')!;
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
const press = async (el: HTMLElement) => {
  el.focus();
  await settle(() => el.click());
};
const sample05 = sample.items.find((i) => i.id === 'I_sample05')!;
/** A Queued decision under `parent`, a sample item's number. */
const decision = (id: string, parent: number): Item => ({
  ...sample05, id, number: 300 + parent, title: `Decide under #${parent}`, labels: ['decision-grill'],
  parent: { number: parent, repo: sample05.repo!, title: 'Parent', url: 'https://github.com/x', state: 'open' },
});

beforeEach(() => localStorage.clear());

test('the Queue lists Queued items in the scope as numbered rows, each with its repository, age and labels', async () => {
  await mountPage();
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample05', 'I_sample06', 'I_sample21']);
  expect(text(queue().querySelector('#queue-h'))).toBe('Queue 3');
  expect(rows().map((r) => text(r.querySelector('.queue-n')))).toEqual(['1', '2', '3']);
  expect(text(row('I_sample05').querySelector('.queue-title'))).toBe(`#129 ${sample05.title}`);
  expect(text(row('I_sample05').querySelector('.queue-meta'))).toBe('lar-server · queued 2h ago · improvement');
  expect(text(row('I_sample21').querySelector('.queue-meta'))).toBe('Draft · queued 24h ago');

  const { useSidebarStore } = await import('../sidebar/sidebar-store.ts');
  await settle(() => useSidebarStore.getState().setScope('maddec01/lar-apple'));
  expect(rows().map((r) => r.dataset.item), 'only the scoped repository').toEqual(['I_sample06']);
});

test('a row for an untagged item two repositories read names both', async () => {
  const [web, api] = ['contoso/Fabrikam/web', 'contoso/Fabrikam/api'];
  const untagged = { ...sample05, repo: web, untaggedFor: [web, api], labels: [] };
  await mountPage({ ...sample, repos: [...sample.repos, { repo: web, role: 'app', items: 'sprint', team: 'Web', show: 'all', labels: [] }, { repo: api, role: 'api', items: 'sprint', team: 'Web', show: 'all', labels: [] }],
    items: sample.items.map((i) => (i.id === sample05.id ? untagged : i)) });
  expect(text(row('I_sample05').querySelector('.queue-meta'))).toBe('web or api · queued 2h ago');
});

test("a row shows the item's kind label and its repository's custom labels, colons and all, without case, and hides every other label", async () => {
  const labelled = { ...sample05, labels: ['needs-triage', 'area: web', 'status-queued', 'Improvement', 'app: music', 'active', 'build', 'Area: Server', 'decision-grill'] };
  await mountPage({ ...sample, items: sample.items.map((i) => i.id === sample05.id ? labelled : i) });
  expect(text(row('I_sample05').querySelector('.queue-meta'))).toBe('lar-server · queued 2h ago · area: web, Improvement, Area: Server');
});

test("a dossier's parts are left out and show in the dossier; a Queued parent stays, and an item whose parent isn't on the board stays", async () => {
  await mountPage({ ...sample, items: [...sample.items, decision('I_d200', 200), decision('I_d129', 129), decision('I_d999', 999)] });
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample05', 'I_sample06', 'I_sample21', 'I_d999']);
  expect($('[data-dossier="I_sample05"] [data-part="I_d129"]'), "#129's sub-issue, in its dossier").not.toBeNull();
  expect($('[data-dossier="I_sample09"] [data-part="I_d200"]'), "concept #200's decision, in its dossier").not.toBeNull();
});

test('an empty Queue says where items come from, and has no Start next', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => i.status !== 'Queued') });
  expect(text(queue().querySelector('p'))).toBe('Queue empty. Queue items from List in the sidebar.');
  expect(queue().querySelector('[data-start]')).toBeNull();
});

test('a row opens the item dialog and stays marked while it shows', async () => {
  await mountPage();
  await settle(() => row('I_sample06').querySelector<HTMLButtonElement>('.queue-title')!.click());
  expect(text(dialog()!.querySelector('[data-slot="dialog-title"]'))).toBe(`#20 ${sample.items.find((i) => i.id === 'I_sample06')!.title}`);
  expect(row('I_sample06').className).toContain('ring-2');
});

test('while the slots are full, the row Start next starts waits for one, not a draft before it', async () => {
  const draftFirst = [sample.items.find((i) => i.id === 'I_sample21')!, ...sample.items.filter((i) => i.id !== 'I_sample21')];
  await mountPage({ ...withChoices, items: draftFirst });
  expect(rows()[0]!.dataset.item).toBe('I_sample21');
  expect(text(rows()[0]!), 'the draft can\'t start').not.toContain('next when a build slot frees');
  expect(text(row('I_sample05'))).toContain('next when a build slot frees');
  expect(startNext().getAttribute('data-start')).toBe('I_sample05');
  expect(start().className, 'the primary Start is on the row Start next starts').toContain('bg-primary');
});

test('the header shows the build slots; while they are full the first row waits for one, and Start still works', async () => {
  await mountPage(withChoices);
  const slots = queue().querySelector('.build-slots')!;
  expect(text(slots), 'three builds in progress, past the limit').toBe('3/2 building');
  expect(slots.querySelectorAll('.slot'), 'a bar per build past the limit').toHaveLength(3);
  expect(text(row('I_sample05')), 'the first row').toContain('next when a build slot frees');
  expect(text(row('I_sample06'))).not.toContain('next when a build slot frees');
  expect(start().getAttribute('aria-disabled')).toBeNull();
  expect(startNext().getAttribute('aria-disabled')).toBeNull();
});

test('a Queued item blocked by an open issue has its Start refining disabled, with Start after, and Start next passes over it', async () => {
  const blocked = { ...withChoices, items: sample.items.map((i) => (i.id === 'I_sample05'
    ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' as const }] } : i)) };
  await mountPage(blocked);
  expect([text(start()), start().disabled, start().title]).toEqual(['Start refining', true, 'Blocked by #202 until it closes']);
  expect(text(row('I_sample05').querySelector('[data-start-after]'))).toBe('Start after #202 ▾');
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
  expect(start('I_sample06').className, 'the primary Start follows Start next').toContain('bg-primary');
  expect(start().className).not.toContain('bg-primary');
});

test("a Queued item whose repository has no T3 project has its Start refining disabled with the project's hint, and Start next passes over it", async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  await mountPage({ ...withChoices, repositoryProjects: { 'maddec01/lar-server': hint } });
  expect([text(start()), start().disabled, start().title]).toEqual(['Start refining', true, hint]);
  expect(row('I_sample05').querySelector('[data-start-after]'), 'nothing blocks it, so no Start after').toBeNull();
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test("a Queued item whose repository is still onboarding has its Start refining disabled until onboarding's PR merges, and Start next passes over it", async () => {
  await mountPage({ ...withChoices, onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'pr', done: ['project'], answers: { projectId: 'p1' } } }] });
  expect([text(start()), start().disabled, start().title]).toEqual(['Start refining', true, "Waits for onboarding's PR to merge"]);
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test('a Queued issue that also carries Review has no Start refining or Start after, and Start next passes over it', async () => {
  const twice = { ...withChoices, items: sample.items.map((i) => (i.id === 'I_sample05' ? { ...i, statuses: ['Queued', 'Review'] as Item['statuses'] } : i)) };
  await mountPage(twice);
  expect(row('I_sample05').querySelector('[data-start], [data-start-after]')).toBeNull();
  expect(row('I_sample05').querySelector('.queue-title [data-two-statuses]')!.getAttribute('aria-label')).toBe('Carries Queued and Review; keep one');
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test('when no queued item can start, Start next shows disabled and says why', async () => {
  const held = { ...withChoices, items: sample.items.map((i) => (['I_sample05', 'I_sample06'].includes(i.id)
    ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' as const }] } : i)) };
  await mountPage(held);
  const next = [...queue().querySelectorAll<HTMLButtonElement>('header button')].find((b) => text(b) === 'Start next')!;
  expect([next.disabled, next.title]).toEqual([true, 'Every queued item is blocked, needs an issue or a T3 project, waits for onboarding, or has a thread at work.']);
  expect(next.className, 'pointer events stay on, so the title shows').toContain('disabled:pointer-events-auto');
  expect(text(queue()), 'no row waits for a slot').not.toContain('next when a build slot frees');
});

test('a concept in progress takes no build slot', async () => {
  await mountPage(moved('I_sample09', 'In progress'));
  expect(text(queue().querySelector('.build-slots'))).toBe('3/2 building');
});

test('with a build slot free, nothing waits', async () => {
  await mountPage({ ...sample, items: sample.items.map((i) => (['I_sample14', 'I_sample23'].includes(i.id) ? { ...i, status: 'Review' as const } : i)) });
  expect(text(queue().querySelector('.build-slots'))).toBe('1/2 building');
  expect(text(queue())).not.toContain('next when a build slot frees');
});

test('the drag handles and Auto-start are disabled and say they are not built yet', async () => {
  await mountPage();
  const handles = $$<HTMLButtonElement>('.queue li button.drag');
  expect(handles).toHaveLength(3);
  expect(handles.every((h) => h.disabled && h.title === "Reordering isn't built yet")).toBe(true);
  const auto = queue().querySelector<HTMLButtonElement>('header [role="switch"]')!;
  expect([text(auto), auto.disabled, auto.getAttribute('aria-checked'), auto.title])
    .toEqual(['Auto-start', true, 'false', "Auto-start isn't built yet: it will start the next item whenever a build slot frees"]);
});

test('Start refining sits on Queued issues, primary on the row Start next starts; a queued draft asks for an issue instead', async () => {
  await mountPage();
  expect($$('.queue li [data-start]').map((b) => b.getAttribute('data-start'))).toEqual(['I_sample05', 'I_sample06']);
  expect([text(start()), start().getAttribute('aria-haspopup'), start().getAttribute('aria-label')])
    .toEqual(['Start refining ▾', 'menu', `Start refining #129 ${sample05.title}`]);
  expect(start().className).toContain('bg-primary');
  expect(start('I_sample06').className, 'later rows are outlined').not.toContain('bg-primary');
  expect(text(row('I_sample21').querySelector('.queue-hint'))).toBe('Needs an issue to start');
  expect(row('I_sample21').querySelector<HTMLElement>('.queue-hint')!.title).toBe('This draft needs an issue before it can start. Convert it to an issue in a repo.');
});

test("Start refining opens its menu without opening the dialog, and starts its row's item with the picked model", async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  await press(start('I_sample06'));
  expect(entries().map(text)).toEqual(['T3 default', 'GPT-5.5', 'Opus 5.5']);
  await press(entries()[2]!);
  expect(dialog(), 'neither the button nor the menu opens the dialog').toBeNull();
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample06', model: { instanceId: 'claudeAgent', model: 'claude-opus-5-5' } }]]);
  expect([text(start('I_sample06')), start('I_sample06').getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);

  const title = `#20 ${sample.items.find((i) => i.id === 'I_sample06')!.title}`;
  await answer({ thread: { threadId: 'thread-1', title }, error: null });
  const tag = row('I_sample06').querySelector('[data-start-result]')!;
  expect([text(tag), tag.getAttribute('title')]).toEqual(['Started', 'T3 thread thread-1']);
  expect(row('I_sample06').querySelector('[data-start]')).toBeNull();
  expect(text(toast())).toBe(`Started T3 thread thread-1 for ${title}.`);
  expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!)).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
});

test('Start next starts the first row that can start, with its model menu', async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  expect([text(startNext()), startNext().getAttribute('aria-label')]).toEqual(['Start next ▾', `Start next #129 ${sample05.title}`]);
  await press(startNext());
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample05', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
});

test('Start next passes over a draft and an item with a live thread', async () => {
  const live = (i: Item): Item => (i.id === 'I_sample05' ? { ...i, threads: [{ id: 't1', title: 'x', state: 'running' }] } as Item : i);
  const draftFirst = [sample.items.find((i) => i.id === 'I_sample21')!, ...sample.items.filter((i) => i.id !== 'I_sample21').map(live)];
  await mountPage({ ...withChoices, items: draftFirst });
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test('while an item has a running or needs-you thread, its row has Open thread in place of Start refining', async () => {
  const threads = (state: string) => [{ id: 't1', title: 'x', state }];
  const items = sample.items.map((i) => (i.id === 'I_sample05' ? { ...i, threads: threads('running') } : i.id === 'I_sample06' ? { ...i, threads: threads('needs you') } : i)) as Item[];
  await mountPage({ ...sample, items, t3EnvironmentId: 'env-1' });
  expect(queue().querySelector('li [data-start]')).toBeNull();
  const open = row('I_sample05').querySelector<HTMLAnchorElement>('[data-open-thread]')!;
  expect([text(open), open.getAttribute('href')]).toEqual(['Open thread', expect.stringContaining('t1')]);
  expect(row('I_sample06').querySelector('[data-open-thread]')).not.toBeNull();
});

test("a failed Start shows on its row with Retry start; closing the error doesn't open the dialog", async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  await press(start());
  await press(entries()[0]!);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(start())).toBe('Retry start ▾');
  expect(text(row('I_sample05').querySelector('p.start [role="alert"]'))).toBe('T3 is down.');
  await press(row('I_sample05').querySelector<HTMLButtonElement>('p.start button.dismiss')!);
  expect(row('I_sample05').querySelector('p.start')).toBeNull();
  expect(dialog()).toBeNull();
  expect(text(start())).toBe('Start refining ▾');
});

test('a Start that may have run hides Start refining; closing its message leaves a tag', async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  await press(start());
  await press(entries()[0]!);
  await answer({ thread: null, uncertain: true, error: 'Check T3.' });
  expect(row('I_sample05').querySelector('[data-start]')).toBeNull();
  const message = row('I_sample05').querySelector<HTMLElement>('p.start[data-start-result]')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
  await settle(() => message.querySelector<HTMLButtonElement>('button.dismiss')!.click());
  expect(text(row('I_sample05').querySelector('.started-tag.unsure'))).toBe('May have started');
});

test('a thread another page started shows on its row in place of Start refining', async () => {
  await mountPage({ ...sample, started: { I_sample06: { threadId: 'thread-9', title: 'x' } } });
  expect(row('I_sample06').querySelector('.started-tag')?.getAttribute('title')).toBe('T3 thread thread-9');
  expect(row('I_sample06').querySelector('[data-start]')).toBeNull();
});

test('in sample mode Start refining still opens its menu, which starts nothing', async () => {
  await mountPage({ ...withChoices, capture: { session: 's', enabled: false } });
  expect(start().hasAttribute('disabled')).toBe(false);
  await press(start());
  expect(entries().every((e) => e.getAttribute('aria-disabled') === 'true')).toBe(true);
  await press(entries()[1]!);
  expect(posted()).toEqual([]);
});

test('Back to List from the dialog takes the item off the Queue', async () => {
  holdPosts();
  await mountPage();
  await settle(() => row('I_sample05').click());
  await press(dialog()!.querySelector<HTMLButtonElement>('[data-back-to-list="I_sample05"]')!);
  expect(posted()).toEqual([['/api/back-to-list', { itemId: 'I_sample05' }]]);
  await answer({ error: null, board: moved('I_sample05', 'List') });
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample06', 'I_sample21']);
  expect(text(toast())).toMatch(/^Moved #129 .* to List\. View item$/);
});

test('the dialog gives Queued issues and drafts Back to List and Abandon, but not pull requests', async () => {
  const pr: Item = { ...sample05, id: 'I_pr', content: 'pr', number: 300, title: 'A queued pull request' };
  await mountPage({ ...sample, items: [...sample.items, pr] });
  await settle(() => row('I_sample21').click());
  expect(dialog()!.querySelector('[data-back-to-list]')!.getAttribute('aria-label')).toBe('Back to List draft Offline downloads on watchOS');
  expect(dialog()!.querySelector('[data-abandon="I_sample21"]')).not.toBeNull();
  await settle(() => row('I_pr').click());
  expect(dialog()!.querySelector('[data-back-to-list], [data-abandon]')).toBeNull();
});

test('Abandon from the dialog takes the item off the Queue; a failed one is a toast', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' } as BoardData['capture'] };
  await mountPage(data);
  await settle(() => row('I_sample06').click());
  await press(dialog()!.querySelector<HTMLButtonElement>('[data-abandon="I_sample06"]')!);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  await answer({ error: 'Could not delete #20.' }, 502);
  expect(text(toast())).toMatch(/^Couldn't abandon #20 .*\. Could not delete #20\.$/);
  expect(rows().map((r) => r.dataset.item)).toContain('I_sample06');

  await press(dialog()!.querySelector<HTMLButtonElement>('[data-abandon="I_sample06"]')!);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog button')[1]!.click());
  await answer({ error: null, board: { ...data, items: data.items.filter((i) => i.id !== 'I_sample06') } });
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample05', 'I_sample21']);
});
