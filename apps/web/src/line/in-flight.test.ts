// Everything else in flight: the line's table of every item past the Queue and short of Done, on one stage track,
// with its agent figures, a build's slices, and its side action. Ports the old Board view's in-flight cards and slice
// popover tests to the table.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, answer, holdPosts, mountPage, posted, pressMenu, sample, settle, text, toast } from '../../test/support.ts';
import { normalizeItems } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread, RawItem } from '@lar-factory/shared';
import { rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';

const table = () => $('[data-in-flight]')!;
const rows = () => $$('[data-in-flight] [data-item]');
const row = (id: string) => $(`[data-in-flight] [data-item="${id}"]`)!;
const numberOf = (id: string) => sample.items.find((i) => i.id === id)!.number;
/** The row's four cells: title, track, agent and side. */
const cells = (id: string) => [...row(id).children] as HTMLElement[];
const side = (id: string) => cells(id)[3]!;
const startBuild = (id = 'I_sample13') => $<HTMLButtonElement>(`[data-in-flight] [data-start="${id}"]`)!;
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) => settle(() => {
  (el as HTMLElement).click();
  vi.advanceTimersByTime(0);
});
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
const boardOf = (raws: RawItem[], keys: { active?: number[]; blocked?: number[] } = {}): BoardData => {
  const set = (numbers: number[] = []) => new Set(numbers.map((n) => `maddec01/lar-factory#${n}`));
  return { ...sample, error: null, items: normalizeItems(raws, { active: set(keys.active), blocked: set(keys.blocked) }) };
};
const withItem = (id: string, change: Partial<Item>, data: BoardData = sample): BoardData =>
  ({ ...data, items: data.items.map((i) => (i.id === id ? { ...i, ...change } : i)) });
/** The sample with #140 out of its concept's dossier, so it has a row in the table. */
const loose = withItem('I_sample13', { parent: null });
/** #140 with its blocker closed, so its Start build runs, on a board whose writes are on. */
const unblocked = (data: BoardData = loose): BoardData => withItem('I_sample13', {
  blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }],
}, { ...data, capture: { session: 's1', enabled: true }, modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }] });
const thread = (id: string, state: ItemThread['state']): ItemThread => ({ id, title: `Thread ${id}`, state, updated: '2026-10-21T09:00:00.000Z' });

beforeEach(() => localStorage.clear());

test('the table lists everything past the Queue and short of Done that no dossier shows, furthest along first, under the stage header', async () => {
  await mountPage();
  const header = table().firstElementChild!;
  expect(text(header.firstElementChild)).toBe('Everything else in flight · 11');
  expect([...header.querySelectorAll('ol > li')].map((li) => [li.getAttribute('title'), text(li)])).toEqual([
    ['Shaping, Needs you', 'RefineRefining'], ['Ready', 'ReadyReady'], ['In progress', 'BuildBuilding'],
    ['Review', 'ReviewReview'], ['Verify, Ready to merge', 'VerifyVerify'], ['Done', 'DoneDone'],
  ]);
  expect([...header.children].slice(2).map(text)).toEqual(['Agent', 'Thread · next']);
  expect(rows().map((r) => numberOf(r.dataset.item!)), 'Verify first, Refining last, in board order within a stage; #200 and #180 and their parts sit in dossiers')
    .toEqual([31, 210, 34, 147, 142, 141, 150, 30, 130, 22, 23]);
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(loose));
  expect(rows().map((r) => numberOf(r.dataset.item!)), 'a part out of its dossier is back').toEqual([31, 210, 34, 147, 142, 141, 150, 30, 140, 130, 22, 23]);
});

test('with nothing in flight, the table says so', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => ['List', 'Queued', 'Done'].includes(i.status)) });
  expect(text(table())).toBe('Everything else in flight · 0RefineRefiningReadyReadyBuildBuildingReviewReviewVerifyVerifyDoneDoneAgentThread · nextNothing else in flight.');
});

test('the table takes the main area\'s scope', async () => {
  await mountPage();
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect(rows().map((r) => numberOf(r.dataset.item!))).toEqual([31, 34, 30, 22, 23]);
});

test("scoped to a repository whose items haven't landed yet, the main area says it's reading instead of an empty desk and line", async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
    firstRead: { step: 'items', running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false } });
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect(text($('[data-reading]'))).toBe('Reading lar-apple…');
  expect([table(), $('section.desk')]).toEqual([null, null]);
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-server'));
  expect([$('[data-reading]'), table() !== null]).toEqual([null, true]);
});

test('a row shows its numbered title, status, repository and age, and a red badge while it is blocked', async () => {
  await mountPage(loose);
  const [title] = cells('I_sample13');
  expect(title!.getAttribute('title')).toBe('#140 Owner accounts');
  const [name, meta] = [...title!.querySelectorAll('.grid > span')].map(text);
  expect([name, meta]).toEqual(['#140 Owner accounts', 'Ready · lar-server · 1h agoblocked by 1']);
  const badge = [...title!.querySelectorAll('span')].find((s) => text(s) === 'blocked by 1')!;
  expect(badge.className).toContain('text-(--error-foreground)');
  expect(title!.querySelector('.grid')!.className.split(' '), 'one column as wide as the cell, so the lines truncate at 840 px, not overflow').toContain('grid-cols-[minmax(0,1fr)]');
  expect(cells('I_sample14')[0]!.textContent).not.toContain('blocked by');
});

test('the badge counts the blocked-by issues still open', async () => {
  await mountPage(withItem('I_sample13', { blockers: [
    { number: 202, repo: 'maddec01/lar-server', state: 'open' }, { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
  ] }, loose));
  expect(text(cells('I_sample13')[0]!)).toContain('blocked by 1');
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState()
    .receive(withItem('I_sample13', { blockers: [] }, loose)));
  expect(cells('I_sample13')[0]!.textContent, 'with no open issue listed, nothing blocks').not.toContain('blocked by');
  expect(text(startBuild())).toBe('Start build ▾');
});

test('the track fills the stages behind, marks the current one with its glyph, and dashes it while blocked', async () => {
  await mountPage(loose);
  const track = (id: string) => cells(id)[1]!;
  const at = (id: string) => [...track(id).children].findIndex((li) => li.querySelector('svg'));
  expect(['I_sample07', 'I_sample13', 'I_sample22', 'I_sample15', 'I_sample16', 'I_sample17'].map(at)).toEqual([0, 1, 2, 3, 4, 4]);
  expect([track('I_sample13').getAttribute('title'), track('I_sample22').getAttribute('title')]).toEqual(['Ready, waiting', 'In progress']);
  expect(track('I_sample13').querySelector('.border-dashed'), 'a blocked item waits').not.toBeNull();
  expect(track('I_sample22').querySelector('.border-dashed')).toBeNull();
});

test('the Agent column shows agent time over tokens and cost, or a dash before any thread worked on it', async () => {
  const stats = { agentMs: (3 * 60 + 20) * 60_000, wallMs: 70 * 60_000, tokens: 12_436_000, costUsd: 41.197 };
  let data = withItem('I_sample14', { stats }, loose);
  data = withItem('I_sample15', { stats: { agentMs: 45 * 60_000, tokens: 980 } }, data);
  data = withItem('I_sample16', { stats: { ...stats, costUsd: 41, frozen: true } }, data);
  data = withItem('I_sample07', { stats: 'unavailable' }, data);
  await mountPage(data);
  const agent = (id: string) => cells(id)[2]!;
  expect([...agent('I_sample14').children].map(text)).toEqual(['3h 20m', '12.4M · $41.20']);
  expect(agent('I_sample14').title).toBe('Agent time · tokens · cost');
  expect(text(agent('I_sample15').lastElementChild), 'nothing priced').toBe('980 · –');
  expect(agent('I_sample16').title).toBe('As it stood at merge');
  expect([text(agent('I_sample13')), text(agent('I_sample07'))]).toEqual(['–', '–']);
});

test('a row opens the item dialog and stays marked while it shows', async () => {
  await mountPage(loose);
  await press(row('I_sample14'));
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('#30 Chapter markers in the scrubber');
  expect(row('I_sample14').className).toContain('ring-(--primary)');
  expect(row('I_sample15').className).not.toContain('ring-(--primary)');
});

test('the side says where the item waits on you, or shows its thread and its next action', async () => {
  await mountPage(loose);
  const say = (id: string) => [text(side(id).firstElementChild), [...side(id).querySelectorAll('button, a')].map((b) => text(b))];
  expect(say('I_sample16')).toEqual(['on your desk', []]);
  expect(say('I_sample17')).toEqual(['on your desk', []]);
  expect(say('I_sample11')).toEqual(['on your desk', []]);
  expect(say('I_sample07')).toEqual(['Thread running', ['Open thread']]);
  expect(say('I_sample14')).toEqual(['Thread running', ['Open thread']]);
  expect(say('I_sample15')).toEqual(['Thread running', ['Open thread']]);
  expect(say('I_sample13')).toEqual(['blocked by 1', ['Start after #202 ▾']]);
});

test('Start after on a blocked Ready row arms its start on the picked model, then reads Starts after until pressed again', async () => {
  const blocked = { ...loose, capture: { session: 's1', enabled: true }, modelChoices: unblocked().modelChoices };
  holdPosts(blocked);
  await mountPage(blocked);
  const after = () => side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  await pressMenu(after());
  expect(dialog(), 'the menu opens without the dialog').toBeNull();
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/arm', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  await answer({ error: null, board: { ...blocked, armed: { I_sample13: { model: { instanceId: 'codex', model: 'gpt-5.5' } } } } });
  expect([text(after()), after().getAttribute('aria-pressed')]).toEqual(['Starts after #202 ✓', 'true']);
  await press(after());
  expect(posted().at(-1)).toEqual(['/api/disarm', { session: 's1', itemId: 'I_sample13' }]);
  await answer({ error: null, board: { ...blocked, armed: {} } });
  expect(text(after())).toBe('Start after #202 ▾');
});

test("Start after names the last open blocker, another repository's without its owner, and its title and label name it in full", async () => {
  await mountPage(withItem('I_sample13', { blockers: [
    { number: 202, repo: 'maddec01/lar-server', state: 'open' }, { number: 12, repo: 'maddec01/lar-apple', state: 'open' },
  ] }, loose));
  const after = side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([text(after), after.title]).toEqual(['Start after lar-apple#12 ▾', 'Starts by itself once #202, maddec01/lar-apple#12 close']);
  expect(after.getAttribute('aria-label')).toBe('Start #140 Owner accounts after maddec01/lar-apple#12');
});

test("a blocked build whose repository has no T3 project offers no Start after: Start build shows the project's hint", async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  await mountPage({ ...loose, repositoryProjects: { 'maddec01/lar-server': hint } });
  expect([startBuild().disabled, startBuild().title]).toEqual([true, hint]);
  expect(side('I_sample13').querySelector('[data-start-after]')).toBeNull();
});

test("a blocked build whose repository is still onboarding offers no Start after: Start build waits for onboarding's PR", async () => {
  await mountPage({ ...loose, onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'pr', done: ['project'], answers: { projectId: 'p1' } } }] });
  expect([startBuild().disabled, startBuild().title]).toEqual([true, "Waits for onboarding's PR to merge"]);
  expect(side('I_sample13').querySelector('[data-start-after]')).toBeNull();
});

test('a start armed before its repository lost its T3 project still shows Starts after, so it can be disarmed', async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  const armed = { ...loose, capture: { session: 's1', enabled: true }, repositoryProjects: { 'maddec01/lar-server': hint },
    armed: { I_sample13: { model: { instanceId: 'codex', model: 'gpt-5.5' } } } };
  holdPosts(armed);
  await mountPage(armed);
  expect(startBuild(), 'a blocker holds it too, so Start after stands alone').toBeNull();
  const after = side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([text(after), after.getAttribute('aria-pressed')]).toEqual(['Starts after #202 ✓', 'true']);
  await press(after);
  expect(posted()).toEqual([['/api/disarm', { session: 's1', itemId: 'I_sample13' }]]);
  await answer({ error: null, board: { ...armed, armed: {} } });
  expect(side('I_sample13').querySelector('[data-start-after]'), 'once disarmed, none can be armed again').toBeNull();
});

test("a start the board ran by itself and that failed shows its error under the row, and dismissing it clears it", async () => {
  const failed = { ...unblocked(), armedErrors: { I_sample13: 'T3 is down.' } };
  holdPosts(failed);
  await mountPage(failed);
  const error = table().querySelector('[data-start-after-error="I_sample13"]')!;
  expect(text(error.querySelector('[role="alert"]'))).toBe('Start after failed: T3 is down.');
  await press(error.querySelector('button')!);
  expect(posted()).toEqual([['/api/disarm', { session: 's1', itemId: 'I_sample13' }]]);
});

test('Open thread on a row opens the latest thread, as an Open with the thread icon, without opening the dialog', async () => {
  await mountPage(withItem('I_sample14', { threads: [thread('t1', 'running')] }, withItem('I_sample15', { threads: [] })));
  const open = side('I_sample14').querySelector<HTMLAnchorElement>('[data-open-thread]')!;
  expect([open.getAttribute('href'), open.dataset.kind, open.className.includes('border-base-400/90'), Boolean(open.querySelector('[data-slot="icon"] .lucide-message-square-text'))])
    .toEqual(['t3code://threads/sample-environment/t1', 'open', true, true]);
  await press(open);
  expect(dialog()).toBeNull();
  const none = side('I_sample15').querySelector<HTMLButtonElement>('[data-open-thread]')!;
  expect([none.disabled, none.title, none.dataset.kind]).toEqual([true, 'No T3 thread has worked on this yet', 'open']);
});

test('a blocked Ready row shows only Start after, a Start with its icon, never a disabled Start build beside it', async () => {
  await mountPage(loose);
  expect(startBuild()).toBeNull();
  const after = side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([after.dataset.kind, Boolean(after.querySelector('[data-slot="icon"] svg'))]).toEqual(['start', true]);
});

test('Start build is disabled with the hint while T3 has no project for the repository', async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  await mountPage({ ...unblocked(), repositoryProjects: { 'maddec01/lar-server': hint, 'maddec01/lar-apple': null } });
  expect([startBuild().disabled, startBuild().title, startBuild().dataset.kind]).toEqual([true, hint, 'start']);
  expect(startBuild().className, 'pointer events stay on, so the title shows').toContain('disabled:pointer-events-auto');
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState()
    .receive({ ...unblocked(), repositoryProjects: { 'maddec01/lar-server': null } }));
  expect([startBuild().disabled, text(startBuild())], 'a found project enables it').toEqual([false, 'Start build ▾']);
});

test.each(['running', 'needs you'] as const)('Open thread takes Start build\'s place while the item has a %s thread', async (state) => {
  await mountPage(withItem('I_sample13', { threads: [thread('t1', state)] }, unblocked()));
  expect(startBuild()).toBeNull();
  expect(side('I_sample13').querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/t1');
});

test('a done thread leaves Start build', async () => {
  await mountPage(withItem('I_sample13', { threads: [thread('t1', 'done')] }, unblocked()));
  expect(text(startBuild())).toBe('Start build ▾');
});

test('Start build sends the build with the chosen model, then shows the thread it started in a tag and a toast', async () => {
  holdPosts(unblocked());
  await mountPage(unblocked());
  await pressMenu(startBuild());
  expect(dialog(), 'the menu opens without the dialog').toBeNull();
  expect(entries().map(text)).toEqual(['T3 default', 'GPT-5.5']);
  await press(entries()[1]!);
  expect(dialog(), 'picking an entry does not open the dialog').toBeNull();
  expect(posted()).toEqual([['/api/start-build', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  expect([text(startBuild()), startBuild().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);
  const started = { threadId: 'thread-1', title: 'Build maddec01/lar-server#140' };
  await answer({ thread: started, error: null });
  const tag = row('I_sample13').querySelector('[data-start-result]')!;
  expect([text(tag), tag.getAttribute('title')]).toEqual(['Started', 'T3 thread thread-1']);
  expect(startBuild()).toBeNull();
  expect(text(toast())).toBe('Build started for #140. Open thread');
  expect(JSON.parse(localStorage.getItem('lar-board:model-choice')!)).toEqual({ instanceId: 'codex', model: 'gpt-5.5' });
});

test('a failed Start build shows its error under the row and offers Retry start; closing the error brings Start build back', async () => {
  holdPosts(unblocked());
  await mountPage(unblocked());
  await pressMenu(startBuild());
  await press(entries()[0]!);
  expect(posted()).toEqual([['/api/start-build', { session: 's1', itemId: 'I_sample13' }]]);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(startBuild())).toBe('Retry start ▾');
  const message = row('I_sample13').parentElement!.querySelector('p.start')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('T3 is down.');
  await press(message.querySelector('button.dismiss')!);
  expect(row('I_sample13').parentElement!.querySelector('p.start')).toBeNull();
  expect(text(startBuild())).toBe('Start build ▾');
  expect(dialog(), 'closing the error does not open the dialog').toBeNull();
});

test('a Start build that may have run hides Start build; closing its message leaves a tag', async () => {
  holdPosts(unblocked());
  await mountPage(unblocked());
  await pressMenu(startBuild());
  await press(entries()[0]!);
  await answer({ thread: null, uncertain: true, error: 'Check T3.' });
  expect(startBuild()).toBeNull();
  const message = row('I_sample13').parentElement!.querySelector<HTMLElement>('p.start[data-start-result]')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
  await press(message.querySelector('button.dismiss')!);
  expect(text(row('I_sample13').querySelector('.started-tag.unsure'))).toBe('May have started');
});

test('a thread Start refining opened this board run is not taken for the build\'s', async () => {
  await mountPage({ ...unblocked(), started: { I_sample13: { threadId: 'shaping-1', title: 'Shape #140' } } });
  expect(text(startBuild())).toBe('Start build ▾');
});

test('in sample mode, Start build opens its menu and no entry starts anything', async () => {
  holdPosts();
  await mountPage({ ...unblocked(), capture: { session: 's', enabled: false } });
  expect(startBuild().disabled).toBe(false);
  await pressMenu(startBuild());
  expect(entries().every((e) => e.getAttribute('aria-disabled') === 'true' && e.title === 'Disabled in sample mode')).toBe(true);
  await press(entries()[1]!);
  expect(posted()).toEqual([]);
});

// A build's slices.

const build = (count: number) => rawIssue('PVTI_build', 59, 'In progress', ['build'], {
  subIssuesSummary: { total: count, completed: 1 },
  subIssues: { nodes: Array.from({ length: count }, (_, i) => sliceRef(100 + i, i ? 'OPEN' : 'CLOSED')) },
});
/** The build row's slice bar segments' colours and its count button's text. */
const slices = (id = 'I_59') => {
  const bar = cells(id)[0]!.querySelector('.grid.gap-1 > ol')!;
  return { segments: [...bar.children].map((li) => (li as HTMLElement).style.background), count: text(cells(id)[0]!.querySelector('button')) };
};
const count = (id = 'I_59') => cells(id)[0]!.querySelector<HTMLButtonElement>('button')!;
const list = (id = 'I_59') => row(id).parentElement!.querySelector(':scope > div:last-child ul');

test('a build shows its slice bar and its count, naming the blocked slices before the active ones', async () => {
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 4, completed: 1 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  await mountPage(boardOf([raw], { active: [66, 67], blocked: [67] }));
  expect(slices()).toEqual({
    segments: ['var(--st-done)', 'var(--st-now)', 'var(--st-review)', 'var(--soft)'],
    count: '1/4 slices· blocked #67 Issue 67, active #66 Issue 66',
  });
  expect(cells('I_59')[0]!.querySelector('ol > li.status-pulse'), 'the active slice pulses').not.toBeNull();
  expect(rows().map((r) => r.dataset.item), 'slices are no rows of their own').toEqual(['I_59']);
});

test('a build\'s count leaves out slices closed as not planned, and names none while none is active or blocked', async () => {
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 4, completed: 2 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), { ...sliceRef(66, 'CLOSED'), stateReason: 'NOT_PLANNED' }, sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  await mountPage(boardOf([raw]));
  expect(slices()).toEqual({ segments: ['var(--st-done)', 'var(--soft)', 'var(--soft)'], count: '1/3 slices' });
});

test('an open slice the project auto-added is no row of its own', async () => {
  const slice = rawIssue('PVTI_slice66', 66, 'In progress', ['improvement'], {
    parent: { number: 59, title: 'Issue 59', url: 'https://github.com/maddec01/lar-factory/issues/59', state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-factory' } },
  });
  const raw = rawIssue('PVTI_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 1 }, subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN')] },
  });
  await mountPage(boardOf([slice, raw, rawIssue('PVTI_other', 70, 'In progress', ['bug'])]));
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_59', 'I_70']);
});

test('the count unfolds the slice list under the row and folds it again, without opening the dialog', async () => {
  await mountPage(loose);
  expect([count('I_sample13').getAttribute('aria-expanded'), list('I_sample13')]).toEqual(['false', null]);
  await press(count('I_sample13'));
  expect(count('I_sample13').getAttribute('aria-expanded')).toBe('true');
  expect([...list('I_sample13')!.querySelectorAll('li')].map(text)).toEqual(['#144Owner table and sign-updone', '#145Sign-in sessionsactive', '#146Owner settings pagewaiting']);
  expect(dialog()).toBeNull();
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive({ ...loose, fetchedAt: '2026-10-21T09:59:00.000Z' }));
  expect(list('I_sample13'), 'new data keeps it open').not.toBeNull();
  await press(count('I_sample13'));
  expect(list('I_sample13')).toBeNull();
});

test('a 3-slice and a 14-slice build render the same row structure', async () => {
  // Tags only, with the slice bar's segments dropped.
  const shape = () => {
    const copy = row('I_59').cloneNode(true) as Element;
    copy.querySelectorAll('.grid.gap-1 > ol > li').forEach((li) => li.remove());
    return [...copy.querySelectorAll('*')].map((e) => `${e.tagName}.${e.className}`).join(' ');
  };
  await mountPage(boardOf([build(14)], { active: [101, 102] }));
  const many = shape();
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(boardOf([build(3)], { active: [101, 102] })));
  expect(shape()).toBe(many);
});

test.each(['Shaping', 'In progress', 'Review'] as const)('line activity follows the latest real thread at %s', async (status) => {
  const id = 'I_sample14';
  const data = withItem(id, { status, threads: [] });
  await mountPage(data);
  const activity = () => text(side(id).firstElementChild);
  expect(activity()).toBe('Not started');
  const { useBoardStore } = await import('../board/board-store.ts');
  for (const [state, expected] of [['running', 'Thread running'], ['stopped', 'Run stopped'], ['done', 'Run finished'], ['needs you', 'Thread needs you']] as const) {
    await settle(() => useBoardStore.getState().receive(withItem(id, { status, threads: [thread('t1', state)] })));
    expect(activity()).toBe(expected);
  }
  await settle(() => useBoardStore.getState().receive(withItem(id, { status, threads: 'unavailable' })));
  expect(activity()).toBe('Thread unavailable');
});

test('a stopped build replaces its remembered Started tag with recovery, also in the item dialog', async () => {
  const data = unblocked();
  holdPosts(data);
  await mountPage(data);
  await pressMenu(startBuild());
  await press(entries()[0]!);
  const started = { threadId: 'stopped-build', title: 'Build maddec01/lar-server#140' };
  await answer({ thread: started, error: null });
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(withItem('I_sample13', { threads: [thread('stopped-build', 'stopped')] }, {
    ...data, startedBuilds: { I_sample13: started },
  })));
  expect(text(side('I_sample13'))).toContain('Run stopped.');
  expect(side('I_sample13').querySelector('[data-start-result]')).toBeNull();
  expect(side('I_sample13').querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/stopped-build');
  await press(row('I_sample13'));
  expect(text(dialog()!.querySelector('[data-slot="modal-footer"]'))).toContain('Run stopped.');
  expect(dialog()!.querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/stopped-build');
  expect(posted()).toHaveLength(1);
});
