// The line's Queue: Queued items as numbered rows that open the item dialog, the build slots, Shape issue and
// Start next with their model menu, and what a start shows on the row. Ported from the Queued cases of the old Board
// view's tests.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, answer, holdPosts, moved, mountPage, posted, pressMenu, sample, settle, text, toast } from '../../test/support.ts';
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
  await settle(() => {
    el.click();
    vi.advanceTimersByTime(0);
  });
};
const sample05 = sample.items.find((i) => i.id === 'I_sample05')!;
/** A Queued decision under `parent`, a sample item's number. */
const decision = (id: string, parent: number): Item => ({
  ...sample05, id, number: 300 + parent, title: `Decide under #${parent}`, labels: ['decision-grill'],
  parent: { number: parent, repo: sample05.repo!, title: 'Parent', url: 'https://github.com/x', state: 'open' },
  parentId: sample.items.find((i) => i.number === parent)?.id ?? null,
});

beforeEach(() => localStorage.clear());

test('the Queue lists Queued items in the scope as numbered rows, each with its repository, age and labels', async () => {
  await mountPage();
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample05', 'I_sample06', 'I_sample21']);
  expect(text(queue().querySelector('#queue-h'))).toBe('Queue 3');
  expect(rows().map((r) => text(r.querySelector('.queue-n')))).toEqual(['1', '2', '3']);
  expect(text(row('I_sample05').querySelector('.queue-title'))).toBe(`#129 ${sample05.title}`);
  expect(text(row('I_sample05').querySelector('.queue-meta'))).toBe('lar-server · queued 2h ago');
  expect(text(row('I_sample21').querySelector('.queue-meta'))).toBe('lar-server · queued 24h ago');

  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect(rows().map((r) => r.dataset.item), 'only the scoped repository').toEqual(['I_sample06']);
});

test('a row shows every label, colons and all, except managed ones', async () => {
  const labelled = { ...sample05, labels: ['needs-triage', 'area: web', 'status-queued', 'Improvement', 'app: music', 'active', 'build', 'Area: Server', 'decision-grill'] };
  await mountPage({ ...sample, items: sample.items.map((i) => i.id === sample05.id ? labelled : i) });
  expect(text(row('I_sample05').querySelector('.queue-meta'))).toBe('lar-server · queued 2h ago · needs-triage, area: web, app: music, active, Area: Server');
});

test("a dossier's parts are left out and show in the dossier; a Queued parent stays, and an item whose parent isn't on the board stays", async () => {
  for (const id of ['I_sample05', 'I_sample09']) {
    localStorage.setItem(`lar-board:dossier-open:${id}`, '1');
    localStorage.setItem(`lar-board:dossier-view:${id}`, 'list');
  }
  await mountPage({ ...sample, items: [...sample.items, decision('I_d200', 200), decision('I_d129', 129), decision('I_d999', 999)] });
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample05', 'I_sample06', 'I_sample21', 'I_d999']);
  expect($('[data-dossier="I_sample05"] [data-part="I_d129"]'), "#129's sub-issue, in its dossier").not.toBeNull();
  expect($('[data-dossier="I_sample09"] [data-part="I_d200"]'), "concept #200's decision, in its dossier").not.toBeNull();
});

test('an empty Queue says where items come from, and has no Start next', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => i.status !== 'Queued') });
  expect(text(queue().querySelector('p'))).toBe('Queue empty. Queue items from the List.');
  expect(queue().querySelector('[data-start]')).toBeNull();
});

test('a row opens the item dialog and stays marked while it shows', async () => {
  await mountPage();
  await settle(() => row('I_sample06').querySelector<HTMLButtonElement>('.queue-title')!.click());
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe(`#20 ${sample.items.find((i) => i.id === 'I_sample06')!.title}`);
  expect(row('I_sample06').className).toContain('ring-2');
});

test('the header shows the build slots; while they are full the first row waits for one, and Start still works', async () => {
  await mountPage(withChoices);
  const slots = queue().querySelector('.build-slots')!;
  expect(text(slots), 'three builds in progress, past the limit').toBe('3/2 building');
  expect(slots.querySelectorAll('.slot'), 'a bar per build past the limit').toHaveLength(3);
  expect(text(row('I_sample05')), 'the first row').toContain('next when a build slot frees');
  expect(text(row('I_sample06'))).not.toContain('next when a build slot frees');
  expect(start().getAttribute('aria-disabled')).not.toBe('true');
  expect(startNext().getAttribute('aria-disabled')).not.toBe('true');
});

test('a Queued item blocked by an open issue shows only Start after, a Start, and Start next passes over it', async () => {
  const blocked = { ...withChoices, items: sample.items.map((i) => (i.id === 'I_sample05'
    ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' as const }] } : i)) };
  await mountPage(blocked);
  expect(row('I_sample05').querySelector('[data-start]'), 'no disabled Start beside it').toBeNull();
  const after = row('I_sample05').querySelector<HTMLElement>('[data-start-after]')!;
  expect([text(after), after.dataset.kind, Boolean(after.querySelector('[data-slot="icon"] svg'))]).toEqual(['Start after #202 ▾', 'start', true]);
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test("a Queued item whose repository has no T3 project has its Shape issue disabled with the project's hint, and Start next passes over it", async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  await mountPage({ ...withChoices, repositoryProjects: { 'maddec01/lar-server': hint } });
  expect([text(start()), start().disabled, start().title]).toEqual(['Shape issue', true, hint]);
  expect(row('I_sample05').querySelector('[data-start-after]'), 'nothing blocks it, so no Start after').toBeNull();
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test("a Queued item whose repository is still onboarding has its Shape issue disabled until onboarding's PR merges, and Start next passes over it", async () => {
  await mountPage({ ...withChoices, onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'pr', done: ['project'], answers: { projectId: 'p1' } } }] });
  expect([text(start()), start().disabled, start().title]).toEqual(['Shape issue', true, "Waits for onboarding to finish"]);
  expect(startNext().getAttribute('data-start')).toBe('I_sample06');
});

test('when no queued item can start, Start next shows disabled and says why', async () => {
  const held = { ...withChoices, items: sample.items.map((i) => (['I_sample05', 'I_sample06', 'I_sample21'].includes(i.id)
    ? { ...i, blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' as const }] } : i)) };
  await mountPage(held);
  const next = [...queue().querySelectorAll<HTMLButtonElement>('header button')].find((b) => text(b) === 'Start next')!;
  expect([next.disabled, next.title]).toEqual([true, 'Every queued item is blocked, needs a T3 project, waits for onboarding, or has a thread at work.']);
  expect(next.className, 'pointer events stay on, so the title shows').toContain('disabled:pointer-events-auto');
  expect(next.dataset.kind, 'a Main action while disabled too').toBe('main');
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

test('Shape issue sits on Queued issues, one Start on every row, and Start next is filled', async () => {
  await mountPage();
  expect($$('.queue li [data-start]').map((b) => b.getAttribute('data-start'))).toEqual(['I_sample05', 'I_sample06', 'I_sample21']);
  expect([text(start()), start().getAttribute('aria-haspopup'), start().getAttribute('aria-label')])
    .toEqual(['Shape issue ▾', 'menu', `Shape issue #129 ${sample05.title}`]);
  expect([start(), start('I_sample06')].map((b) => [b.dataset.kind, Boolean(b.querySelector('[data-slot="icon"] svg'))]), 'every row the same Start, with its icon')
    .toEqual([['start', true], ['start', true]]);
  expect(startNext().dataset.kind, "Start next is the Queue's Main action").toBe('main');
});

test("Shape issue opens its menu without opening the dialog, and starts its row's item with the picked model", async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  await pressMenu(start('I_sample06'));
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
  expect(text(toast())).toBe('Refining started for #20. Open thread');
  expect(JSON.parse(localStorage.getItem(CHOICE_KEY)!)).toEqual({ instanceId: 'claudeAgent', model: 'claude-opus-5-5' });
});

test('Start next starts the first row that can start, with its model menu', async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  expect([text(startNext()), startNext().getAttribute('aria-label')]).toEqual(['Start next ▾', `Start next #129 ${sample05.title}`]);
  await pressMenu(startNext());
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_sample05', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
});

test('while an item has a running or needs-you thread, its row has Open thread in place of Shape issue', async () => {
  const threads = (state: string) => [{ id: 't1', title: 'x', state }];
  const items = sample.items.map((i) => (i.id === 'I_sample05' ? { ...i, threads: threads('running') } : i.id === 'I_sample06' ? { ...i, threads: threads('needs you') } : i)) as Item[];
  await mountPage({ ...sample, items, t3EnvironmentId: 'env-1' });
  expect(row('I_sample05').querySelector('[data-start]')).toBeNull();
  const open = row('I_sample05').querySelector<HTMLAnchorElement>('[data-open-thread]')!;
  expect([text(open), open.getAttribute('href')]).toEqual(['Open thread', expect.stringContaining('t1')]);
  expect(row('I_sample06').querySelector('[data-open-thread]')).not.toBeNull();
});

test("a failed Start shows on its row with Retry start; closing the error doesn't open the dialog", async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  await pressMenu(start());
  await press(entries()[0]!);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(start())).toBe('Retry start ▾');
  expect(text(row('I_sample05').querySelector('p.start [role="alert"]'))).toBe('T3 is down.');
  await press(row('I_sample05').querySelector<HTMLButtonElement>('p.start button.dismiss')!);
  expect(row('I_sample05').querySelector('p.start')).toBeNull();
  expect(dialog()).toBeNull();
  expect(text(start())).toBe('Shape issue ▾');
});

test('a Start that may have run hides Shape issue; closing its message leaves a tag', async () => {
  holdPosts(withChoices);
  await mountPage(withChoices);
  await pressMenu(start());
  await press(entries()[0]!);
  await answer({ thread: null, uncertain: true, error: 'Check T3.' });
  expect(row('I_sample05').querySelector('[data-start]')).toBeNull();
  const message = row('I_sample05').querySelector<HTMLElement>('p.start[data-start-result]')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
  await settle(() => message.querySelector<HTMLButtonElement>('button.dismiss')!.click());
  expect(text(row('I_sample05').querySelector('.started-tag.unsure'))).toBe('May have started');
});

test('a thread another page started shows on its row in place of Shape issue', async () => {
  await mountPage({ ...sample, started: { I_sample06: { threadId: 'thread-9', title: 'x' } } });
  expect(row('I_sample06').querySelector('.started-tag')?.getAttribute('title')).toBe('T3 thread thread-9');
  expect(row('I_sample06').querySelector('[data-start]')).toBeNull();
});

test('in sample mode Shape issue still opens its menu, which starts nothing', async () => {
  await mountPage({ ...withChoices, capture: { session: 's', enabled: false } });
  expect(start().hasAttribute('disabled')).toBe(false);
  await pressMenu(start());
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

test('Abandon from the dialog takes the item off the Queue; a failed one is a toast', async () => {
  holdPosts();
  const data: BoardData = { ...sample, capture: { enabled: true, session: 's1' } as BoardData['capture'] };
  await mountPage(data);
  await settle(() => row('I_sample06').click());
  await press(dialog()!.querySelector<HTMLButtonElement>('[data-abandon="I_sample06"]')!);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  await answer({ error: 'Could not abandon #20.' }, 502);
  expect(text(toast())).toMatch(/^Couldn't abandon #20 .*\. Could not abandon #20\.$/);
  expect(rows().map((r) => r.dataset.item)).toContain('I_sample06');

  await press(dialog()!.querySelector<HTMLButtonElement>('[data-abandon="I_sample06"]')!);
  await settle(() => $$<HTMLButtonElement>('#abandon-dialog [data-slot="modal-footer"] button')[1]!.click());
  await answer({ error: null, board: { ...data, items: data.items.filter((i) => i.id !== 'I_sample06') } });
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_sample05', 'I_sample21']);
});
