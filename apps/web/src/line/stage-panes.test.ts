// The Shaping, Ready to build and Build sections: their rows from the placement rule, each with its status, agent figures, a build's slices
// and its side action.

import { beforeEach, describe, expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, answer, holdPosts, mountPage, posted, pressMenu, recorded, sample, settle, text, toast } from '../../test/support.ts';
import { normalizeItems } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread, RepositorySetup, KindDisagreement, RawItem, Slice } from '@lar-factory/shared';
import { rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';

const PANES = ['shaping', 'ready', 'build'];
const SHAPING = [130, 22, 200, 23];
const BUILD = [31, 900026, 34, 147, 142, 141, 150, 30, 180];
const row2 = (id: string) => $(`[data-stage="ready"] li[data-item="${id}"]`)!;
const rows = () => PANES.flatMap((pane) => $$(`[data-stage="${pane}"] li[data-item]`));
const row = (id: string) => $(`:is([data-stage="shaping"], [data-stage="ready"], [data-stage="build"]) li[data-item="${id}"]`)!;
const opener = (id: string) => row(id).querySelector<HTMLButtonElement>('[data-row-open]')!;
const numberOf = (id: string) => sample.items.find((i) => i.id === id)!.number;
const meta = (id: string) => row(id).querySelector<HTMLElement>('[data-meta]')!;
const col = (id: string, name: string) => row(id).querySelector<HTMLElement>(`[data-col="${name}"]`)!;
const side = (id: string) => col(id, 'side')!;
const state = (id: string) => row(id).querySelector<HTMLElement>('[data-state]')!;
const startBuild = (id = 'I_sample13') => $<HTMLButtonElement>(`[data-start="${id}"]`)!;
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) => settle(() => {
  (el as HTMLElement).click();
  vi.advanceTimersByTime(0);
});
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialog = () => $('[data-item-dialog]');
/** The board with `raws` as items, each open slice numbered in `keys` active or blocked, as its work record holds it. */
const boardOf = (raws: RawItem[], { active = [], blocked = [] }: { active?: number[]; blocked?: number[] } = {}): BoardData => {
  const progress = (slice: Slice): Slice => (slice.progress !== 'waiting' ? slice
    : { ...slice, progress: blocked.includes(slice.number) ? 'blocked' : active.includes(slice.number) ? 'active' : 'waiting' });
  const items = normalizeItems(raws).map((item) => ({ ...item, slices: item.slices.map(progress) }));
  return { ...sample, error: null, items: recorded(items) };
};
const withItem = (id: string, change: Partial<Item>, data: BoardData = sample): BoardData =>
  ({ ...data, items: data.items.map((i) => (i.id === id ? { ...i, ...change } : i)) });
/** The sample with #140 out of its concept's dossier, so it has a row in the table. */
const loose = withItem('I_sample13', { parent: null, parentId: null, status: 'Review' });
/** #140 with its blocker closed, so its Start build runs, on a board whose writes are on. */
const unblocked = (data: BoardData = loose): BoardData => withItem('I_sample13', {
  status: 'Ready', blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }],
}, { ...data, capture: { session: 's1', enabled: true }, modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }] });
const thread = (id: string, state: ItemThread['state']): ItemThread => ({ id, title: `Thread ${id}`, state, updated: '2026-10-21T09:00:00.000Z' });

beforeEach(() => localStorage.clear());

const inPane = (pane: string) => $$(`[data-stage="${pane}"] li[data-item]`).map((r) => numberOf(r.dataset.item!));
const shapingRows = () => $$('[data-stage="shaping"] li[data-item]').map((r) => numberOf(r.dataset.item!));
const readyRows = () => $$('[data-stage="ready"] li[data-item]').map((r) => numberOf(r.dataset.item!));

test('each pane holds the rows the placement rule gives it, and Build lists the furthest along first', async () => {
  await mountPage();
  expect(shapingRows()).toEqual(SHAPING);
  expect(readyRows()).toEqual([140]);
  expect(inPane('build')).toEqual(BUILD);
  expect(text($('#shaping-h'))).toBe(`Shaping ${SHAPING.length}`);
  expect(text($('#build-h'))).toBe(`Build ${BUILD.length}`);
});

test('a live board push moves a row between sections with no reload', async () => {
  await mountPage(withItem('I_sample13', { blockers: [] }));
  expect(readyRows()).toContain(140);
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(withItem('I_sample13', { blockers: [], status: 'In progress', statuses: ['In progress'] })));
  expect(readyRows()).not.toContain(140);
  expect(inPane('build')).toContain(140);
});

test("Build's header counts the factory's builds against the limit, one bar per build past it", async () => {
  await mountPage();
  const slots = $('[data-stage="build"] header .build-slots')!;
  expect(text(slots)).toBe('3/2 building');
  expect(slots.querySelectorAll('.slot')).toHaveLength(3);
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(withItem('I_sample09', { status: 'In progress' })));
  expect(text($('.build-slots')), 'a concept in progress takes no build slot').toBe('3/2 building');
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive({ ...sample, items: sample.items.map((i) => (['I_sample14', 'I_sample23'].includes(i.id) ? { ...i, status: 'Review' as const } : i)) }));
  expect(text($('.build-slots'))).toBe('1/2 building');
});

test('a row\'s controls are their own focus stops, none nested in the button that opens details', async () => {
  await mountPage(loose);
  for (const id of ['I_sample13', 'I_sample14']) {
    const open = opener(id);
    expect([open.tagName, open.type, open.tabIndex, open.querySelector('a, button, [tabindex]')]).toEqual(['BUTTON', 'button', 0, null]);
    open.focus();
    expect(document.activeElement).toBe(open);
    const others = [...row(id).querySelectorAll<HTMLElement>('a, button')].filter((el) => el !== open);
    expect(others.length, 'its slice count and action').toBeGreaterThan(0);
    for (const other of others) expect(open.contains(other)).toBe(false);
    open.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  }
  expect(opener('I_sample14').className, 'a visible focus ring').toContain('focus-visible:outline-2');
});

test('a run known to be running with no progress details says Working, and the missing telemetry stays out of the row', async () => {
  await mountPage(withItem('I_sample14', { status: 'In progress', buildPhase: null, threads: [thread('t1', 'running')] }, { ...loose, error: null, fetchedAt: new Date(NOW).toISOString() }));
  expect(text(state('I_sample14'))).toBe('Working');
  expect(text(row('I_sample14')), 'no telemetry note').not.toContain('unavailable');
});

test('rows share their columns down all four sections', async () => {
  await mountPage(withItem('I_sample13', { blockers: [] }));
  const grid = (el: Element) => el.querySelector('[data-row-open]')!.className.split(' ').filter((c) => c.includes('grid-cols')).join(' ');
  const inEach = ['queue', 'shaping', 'ready', 'build'].map((section) => $(`[data-stage="${section}"] li[data-item]`)!);
  expect(new Set(inEach.map(grid)).size).toBe(1);
  expect(inEach.every((li) => li.querySelector('[data-repo-cell]') && li.querySelector('[data-col="state"]') && li.querySelector('[data-col="side"]'))).toBe(true);
});

test('only a row with slices or a run at work has a progress line, with a long bar and readable text, and nothing of it sits in the base row', async () => {
  await mountPage(withItem('I_sample14', { status: 'In progress', buildPhase: 'implement', slices: [], threads: [{ ...thread('t1', 'running'), purpose: 'build', currentRunning: true }] }, { ...loose, error: null, fetchedAt: new Date(NOW).toISOString() }));
  const progress = (id: string) => row(id).querySelector<HTMLElement>('[data-progress]');
  expect(text(state('I_sample14')), 'the phase says it once, on the progress line').toBe('In progress');
  expect(text(progress('I_sample14'))).toBe('Implementing');
  expect(meta('I_sample14').querySelector('[data-col="bar"], [role="img"][aria-label="Implementing"]')).toBeNull();
  expect(progress('I_sample14')!.querySelector('[data-col="bar"] .activity-sweep')).not.toBeNull();
  expect(progress('I_sample13')!.querySelector('[data-col="bar"] ol')).not.toBeNull();
  expect(text(progress('I_sample13')!.querySelector('[data-col="count"]'))).toBe('1/3 slices');
  expect(text(progress('I_sample13')!.querySelector('[data-col="next"]'))).toBe('active Sign-in sessions');
  const queue = $('[data-stage="queue"] li[data-item]')!;
  expect(queue.querySelector('[data-progress]'), 'a Queue row is one line').toBeNull();
  expect(queue.querySelector('[data-row-open]')!.parentElement!.contains(queue.querySelector('[data-col="side"]')), 'its action sits beside its title').toBe(true);
});

test('a part names its concept on its stage row', async () => {
  await mountPage();
  expect(text(row2('I_sample13').querySelector('[data-concept]'))).toBe('Concept: lar cloud: website sign-in and relay');
});

test('the sections run from top to bottom in the order work moves, with the dock last', async () => {
  await mountPage();
  expect($$('.stages [data-stage]').map((section) => section.getAttribute('data-stage'))).toEqual(['queue', 'shaping', 'ready', 'build', 'dock']);
  expect($('[data-scroll]'), 'the page scrolls, and no section scrolls inside itself').toBeNull();
});

test('with nothing in them, the panes say so', async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => ['List', 'Queued', 'Done'].includes(i.status)) });
  expect(text($('[data-stage="shaping"] p'))).toBe('Nothing in shaping.');
  expect(text($('[data-stage="ready"]'))).toContain('Nothing ready to build.');
  expect(text($('[data-stage="build"] p'))).toBe('Nothing in build.');
});

test("the panes take the main area's scope", async () => {
  await mountPage();
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect(rows().every((r) => sample.items.find((i) => i.id === r.dataset.item)!.repo === 'maddec01/lar-apple')).toBe(true);
  expect(shapingRows()).toEqual([22, 23]);
});

test("scoped to a repository whose items haven't landed yet, the main area says it's reading instead of an empty desk and panes", async () => {
  await mountPage({ ...sample, items: sample.items.filter((i) => i.repo !== 'maddec01/lar-apple'),
    firstRead: { step: 'items', running: ['lar-apple'], waiting: ['maddec01/lar-apple'], settled: false } });
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect(text($('[data-reading]'))).toBe('Loading projects…');
  expect([$('[data-stage="build"]'), $('section.desk')]).toEqual([null, null]);
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-server'));
  expect([$('[data-reading]'), $('[data-stage="build"]') !== null]).toEqual([null, true]);
});

test('a row is one line: the status glyph, source and repository, kind, the numbered title, status, PR and a red note while blocked', async () => {
  await mountPage(loose);
  const title = row('I_sample13').querySelector('[data-title]')!;
  expect([text(title), title.getAttribute('title')]).toEqual(['#140 Owner accounts', '#140 Owner accounts']);
  expect(row('I_sample13').querySelector('[data-glyph] svg')).not.toBeNull();
  expect(title.className.split(' '), 'one line, with the whole title in its tooltip').toContain('truncate');
  const cell = meta('I_sample14').querySelector('[data-repo-cell]')!;
  expect([cell.querySelector('[data-project-icon]') !== null, text(cell).endsWith('lar-apple'), cell.querySelector('[role="img"]')], 'the cell is the project icon and name, with no source icon').toEqual([true, true, null]);
  expect(cell.previousElementSibling!.getAttribute('aria-label'), 'the source icon sits beside it').toBe('GitHub issue. Saved on GitHub.');
  expect(text(meta('I_sample14').querySelector('[data-state]'))).toBe('In progress');
  expect(text(meta('I_sample14'))).toContain('PR #33 (draft)');
  const blocked = meta('I_sample13').querySelector<HTMLElement>('[data-blocked]')!;
  expect([text(blocked), blocked.title], 'what blocks it reads once, in full on hover').toEqual(['Blocked by #202 until it completes', 'Blocked by #202 until it completes']);
  expect(blocked.outerHTML).toContain('danger');
  expect(text(row('I_sample13')).match(/Blocked by/gi), 'no second copy for a screen reader').toHaveLength(1);
  expect(row('I_sample14').querySelector('[data-row-open] [data-open-thread]'), 'the action is no part of the button that opens details').toBeNull();
});

test('no row has a coloured repository dot', async () => {
  await mountPage(loose);
  expect($('[data-stage="build"] [class*="repo-tone"]:not([data-project-icon])')).toBeNull();
});

test('the note names the blocked-by issues still open', async () => {
  await mountPage(withItem('I_sample13', { blockers: [
    { number: 202, repo: 'maddec01/lar-server', state: 'open' }, { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
  ] }, loose));
  expect(text(meta('I_sample13'))).toContain('Blocked by #202 until it completes');
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState()
    .receive(withItem('I_sample13', { blockers: [] }, loose)));
  expect(meta('I_sample13').textContent, 'with no open issue listed, nothing blocks').not.toContain('Blocked by');
  expect(text(side('I_sample13'))).toBe('Open thread');
});

test('a Dependency holds the badge until it is marked met, whatever its ticket shows, and the badge names it', async () => {
  const dependency = (met: boolean) => ({ number: 40, repo: 'maddec01/lar-server', state: met ? 'closed' as const : 'open' as const, title: 'An export endpoint',
    dependency: { dependencyId: 'dep-1', revision: 2, owner: 'server team', need: 'An export endpoint', ticket: 'maddec01/lar-server#40', named: [], evidence: '',
      met: met ? { by: 'pedro', at: '2026-10-21T08:00:00Z' } : null, needsReview: false,
      observation: { subject: 'maddec01/lar-server#40', kind: 'closed' as const, detail: null, observedAt: '2026-10-21T09:00:00Z', lastGood: null } } });
  await mountPage(withItem('I_sample13', { blockers: [dependency(false)] }, loose));
  const note = meta('I_sample13').querySelector<HTMLElement>('[data-blocked]')!;
  expect([text(note), note.title]).toEqual(['Blocked by the Dependency on server team until you mark it met', 'Blocked by the Dependency on server team until you mark it met']);
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState()
    .receive(withItem('I_sample13', { blockers: [dependency(true)] }, loose)));
  expect(meta('I_sample13').textContent).not.toContain('Blocked by');
});

test('the figures show agent time, tokens and cost on one line, or nothing before any thread worked on it', async () => {
  const stats = { agentMs: (3 * 60 + 20) * 60_000, wallMs: 70 * 60_000, tokens: 12_436_000, costUsd: 41.197 };
  let data = withItem('I_sample14', { stats }, loose);
  data = withItem('I_sample15', { stats: { agentMs: 45 * 60_000, tokens: 980 } }, data);
  data = withItem('I_sample16', { status: 'Review', stats: { ...stats, costUsd: 41, frozen: true } }, data);
  data = withItem('I_sample07', { stats: 'unavailable' }, data);
  await mountPage(data);
  const figures = (id: string) => col(id, 'figures').firstElementChild as HTMLElement;
  expect([text(figures('I_sample14')), figures('I_sample14').title]).toEqual(['3h 20m · 12.4M · $41.20', 'Agent time · tokens · cost']);
  expect(text(figures('I_sample15')), 'nothing priced').toBe('45m · 980');
  expect(figures('I_sample16').title).toBe('Agent time · tokens · cost, as it stood at merge');
  expect([text(col('I_sample13', 'figures')), text(col('I_sample07', 'figures'))]).toEqual(['', '']);
});

test('a row opens the item dialog and stays marked while it shows', async () => {
  await mountPage(loose);
  await press(opener('I_sample14'));
  expect(text(dialog()!.querySelector('[data-slot="modal-header"] h2'))).toBe('#30 Chapter markers in the scrubber');
  expect(row('I_sample14').className).toContain('ring-(--primary)');
  expect(row('I_sample15').className).not.toContain('ring-(--primary)');
});

test('the side says where the item waits on you, or shows its next action', async () => {
  await mountPage(loose);
  const say = (id: string) => [text(side(id)), [...side(id).querySelectorAll('button, a')].map((b) => text(b))];
  for (const id of ['I_sample16', 'I_sample17', 'I_sample11']) {
    expect($(`.desk-card[data-item="${id}"]`)).not.toBeNull();
    expect(text(side(id)), 'its row keeps its action on the desk card').toBe('on your desk');
  }
  expect(say('I_sample07')).toEqual(['Open thread', ['Open thread']]);
  expect(say('I_sample14')).toEqual(['Open thread', ['Open thread']]);
  expect(say('I_sample15')).toEqual(['Open thread', ['Open thread']]);
  expect(say('I_sample13')).toEqual(['Open thread', ['Open thread']]);
  expect(state('I_sample14').title, "the thread's state is in the status's tooltip").toContain('Thread running');
});

test('Start after on a blocked Ready row arms its start on the picked model, then reads Starts after until pressed again', async () => {
  const blocked = { ...withItem('I_sample13', { status: 'Ready' }, loose), capture: { session: 's1', enabled: true }, modelChoices: unblocked().modelChoices };
  holdPosts(blocked);
  await mountPage(blocked);
  const after = () => side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  await pressMenu(after());
  expect(dialog(), 'the menu opens without the dialog').toBeNull();
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/arm', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  await answer({ error: null, board: { ...blocked, armed: { I_sample13: { model: { instanceId: 'codex', model: 'gpt-5.5' } } } } });
  expect([text(after()), after().getAttribute('aria-pressed')]).toEqual(['Starts after ✓', 'true']);
  expect(after().title).toBe('Starts by itself once #202 completes. Pressing it again disarms it');
  await press(after());
  expect(posted().at(-1)).toEqual(['/api/disarm', { session: 's1', itemId: 'I_sample13' }]);
  await answer({ error: null, board: { ...blocked, armed: {} } });
  expect(text(after()), 'the row already says what blocks it').toBe('Start after ▾');
  expect(after().title, 'nothing starts by itself until it is armed').toBe('Pick a model to start it once #202 completes');
});

test("Start after leaves the blocker to the row's note, and its title and label name it in full", async () => {
  await mountPage(withItem('I_sample13', { status: 'Ready', blockers: [
    { number: 202, repo: 'maddec01/lar-server', state: 'open' }, { number: 12, repo: 'maddec01/lar-apple', state: 'open' },
  ] }, loose));
  const after = side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([text(after), after.title]).toEqual(['Start after ▾', 'Pick a model to start it once #202, maddec01/lar-apple#12 complete']);
  expect(after.getAttribute('aria-label')).toBe('Start #140 Owner accounts after maddec01/lar-apple#12');
});

test("a blocked build whose repository has no T3 project offers no Start after: Start build shows the project's hint", async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  await mountPage({ ...withItem('I_sample13', { status: 'Ready' }, loose), repositoryProjects: { 'maddec01/lar-server': hint } });
  expect([startBuild().disabled, startBuild().title]).toEqual([true, hint]);
  expect(side('I_sample13').querySelector('[data-start-after]')).toBeNull();
});

test("a blocked build whose repository is still onboarding offers no Start after: Start build waits for onboarding's PR", async () => {
  await mountPage({ ...withItem('I_sample13', { status: 'Ready' }, loose), onboarding: [{ repo: 'maddec01/lar-server', progress: { step: 'pr', done: ['project'], answers: { projectId: 'p1' } } }] });
  expect([startBuild().disabled, startBuild().title]).toEqual([true, "Waits for onboarding to finish"]);
  expect(side('I_sample13').querySelector('[data-start-after]')).toBeNull();
});

test('a start armed before its repository lost its T3 project still shows Starts after, so it can be disarmed', async () => {
  const hint = 'No T3 project is a checkout of maddec01/lar-server; add the checkout in T3 Code';
  const armed = { ...withItem('I_sample13', { status: 'Ready' }, loose), capture: { session: 's1', enabled: true }, repositoryProjects: { 'maddec01/lar-server': hint },
    armed: { I_sample13: { model: { instanceId: 'codex', model: 'gpt-5.5' } } } };
  holdPosts(armed);
  await mountPage(armed);
  expect(startBuild(), 'a blocker holds it too, so Start after stands alone').toBeNull();
  const after = side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([text(after), after.getAttribute('aria-pressed')]).toEqual(['Starts after ✓', 'true']);
  await press(after);
  expect(posted()).toEqual([['/api/disarm', { session: 's1', itemId: 'I_sample13' }]]);
  await answer({ error: null, board: { ...armed, armed: {} } });
  expect(side('I_sample13').querySelector('[data-start-after]'), 'once disarmed, none can be armed again').toBeNull();
});

test("a start the board ran by itself and that failed shows its error under the row, and dismissing it clears it", async () => {
  const failed = { ...unblocked(), armedErrors: { I_sample13: 'T3 is down.' } };
  holdPosts(failed);
  await mountPage(failed);
  const error = row('I_sample13').querySelector('[data-start-after-error="I_sample13"]')!;
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
  await mountPage(withItem('I_sample13', { status: 'Ready' }, loose));
  expect(startBuild()).toBeNull();
  const after = side('I_sample13').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([after.dataset.kind, Boolean(after.querySelector('[data-slot="icon"] svg'))]).toEqual(['start', true]);
});

test('known missing delivery access disables Start build without blocking the rest of the board', async () => {
  const data = unblocked();
  data.repos = data.repos.map(repo => ({ ...repo, setup: { ...repo.setup, access: { ...repo.setup?.access, 'push-branch': 'refused', 'open-pr': 'allowed' } } as RepositorySetup }));
  await mountPage(data);
  const start = $<HTMLButtonElement>('[data-build-unavailable="I_sample13"]')!;
  expect(start.disabled).toBe(true);
  expect(start.title).toContain('push branches');
  expect($('[data-onboard]')).toBeNull();
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
  expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  expect([text(startBuild()), startBuild().getAttribute('aria-disabled')]).toEqual(['Starting…', 'true']);
  const started = { threadId: 'thread-1', title: 'Build maddec01/lar-server#140' };
  await answer({ thread: started, error: null, board: { ...unblocked(), startedBuilds: { I_sample13: started } } });
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
  expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13' }]]);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(startBuild())).toBe('Retry start ▾');
  const message = row('I_sample13').querySelector('p.start')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('T3 is down.');
  await press(message.querySelector('button.dismiss')!);
  expect(row('I_sample13').querySelector('p.start')).toBeNull();
  expect(text(startBuild())).toBe('Start build ▾');
  expect(dialog(), 'closing the error does not open the dialog').toBeNull();
});

test('a Start build that may have run hides Start build; closing its message leaves a tag', async () => {
  holdPosts(unblocked());
  await mountPage(unblocked());
  await pressMenu(startBuild());
  await press(entries()[0]!);
await answer({ thread: null, uncertain: true, error: 'Check T3.', board: { ...unblocked(), startProgress: { I_sample13: { build: { phase: 'may-have-started', message: 'Check T3.' } } } } });
  expect(startBuild()).toBeNull();
  const message = row('I_sample13').querySelector<HTMLElement>('p.start[data-start-result]')!;
  expect(text(message.querySelector('[role="alert"]'))).toBe('Check T3.');
  await press(message.querySelector('button.dismiss')!);
  expect(text(row('I_sample13').querySelector('.started-tag.unsure'))).toBe('May have started');
});

test('active slices read as Working after the parent run ended, keeping that detail', async () => {
  const board = unblocked();
  const slice = (progress: 'active' | 'done') => ({ number: 1, title: 'Slice', url: '', repo: 'maddec01/lar-server', state: 'open' as const, progress });
  const withSlice = (progress: 'active' | 'done'): BoardData => ({ ...board, items: board.items.map((i) => i.id === 'I_sample13' ? { ...i, status: 'In progress' as const, statuses: ['In progress' as const], buildPhase: 'implement', slices: [slice(progress)], threads: [{ id: 'b1', title: 'Build', state: 'done' as const, purpose: 'build', updated: '2026-10-31T00:00:00Z' }] } : i) });
  await mountPage(withSlice('active'));
  expect(state('I_sample13').title).toContain('Working, parent run finished');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(withSlice('done')));
  expect(state('I_sample13').title).toContain('Run finished');
  expect(text(row('I_sample13').querySelector('[data-meta]'))).not.toContain('Working');
});

test('a descendant holds Run finished back: Working while it runs, and waiting while it is only live', async () => {
  const board = unblocked();
  const at = (more: Partial<ItemThread>): BoardData => ({ ...board, items: board.items.map((i) => i.id === 'I_sample13' ? { ...i, status: 'In progress' as const, statuses: ['In progress' as const], buildPhase: 'implement', slices: [], threads: [{ id: 'b1', title: 'Build', state: 'done' as const, purpose: 'build', updated: '2026-10-31T00:00:00Z', ...more }] } : i) });
  await mountPage(at({ hasRunningChildren: true, hasLiveChildren: true }));
  expect(state('I_sample13').title).toContain('Working, parent run finished');
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(at({ hasLiveChildren: true })));
  expect(state('I_sample13').title).toBe('Run finished, child waiting');
  await settle(() => useBoardStore.getState().receive(at({})));
  expect(state('I_sample13').title).toBe('Run finished');
});

test('a moved build whose thread stopped before a phase offers Retry start, with Starting on its row while it runs', async () => {
  const moved = (extra: Partial<BoardData> = {}): BoardData => {
    const board = unblocked();
    return { ...board, ...extra, items: board.items.map((i) => i.id === 'I_sample13' ? { ...i, status: 'In progress' as const, statuses: ['In progress' as const], buildPhase: null, slices: [], threads: [{ id: 'b1', title: 'Build', state: 'stopped' as const, purpose: 'build', updated: '2026-10-31T00:00:00Z' }] } : i) };
  };
  holdPosts(moved());
  await mountPage(moved());
  expect(text(startBuild())).toBe('Retry start ▾');
  const group = row('I_sample13').querySelector('[data-col="side"] .start-group')!;
  expect(group.textContent, 'no second line says the run stopped').not.toContain('Run stopped');
  expect(group.querySelector('a, button:not([data-start])'), 'the stopped thread stays one press away').not.toBeNull();
  const { useBoardStore } = await import('../board/board-store.ts');
  await settle(() => useBoardStore.getState().receive(moved({ startProgress: { I_sample13: { build: { phase: 'starting' } } } })));
  expect(text(startBuild())).toBe('Starting…');
  expect(text(state('I_sample13')), 'Start build already says Starting').toBe('In progress');
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

const build = (count: number) => rawIssue('I_build', 59, 'In progress', ['build'], {
  subIssuesSummary: { total: count, completed: 1 },
  subIssues: { nodes: Array.from({ length: count }, (_, i) => sliceRef(100 + i, i ? 'OPEN' : 'CLOSED')) },
});
/** The build row's slice bar segments' colours, its count button's text and its first blocked or active slice. */
const slices = (id = 'I_59') => {
  const bar = col(id, 'bar').querySelector('ol')!;
  return { segments: [...bar.children].map((li) => (li as HTMLElement).style.background), count: text(count(id)), next: text(col(id, 'next')) };
};
const count = (id = 'I_59') => row(id).querySelector<HTMLButtonElement>('button[data-col="count"]')!;
const list = (id = 'I_59') => row(id).querySelector('[data-slices] ul');

test('a build shows its slice bar and its count, naming the first blocked slice plus how many more are blocked or active', async () => {
  const raw = rawIssue('I_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 5, completed: 1 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN'), sliceRef(69, 'OPEN')] },
  });
  await mountPage(boardOf([raw], { active: [66, 67, 69], blocked: [67, 69] }));
  expect(slices()).toEqual({
    segments: ['var(--st-done)', 'var(--st-now)', 'var(--st-review)', 'var(--soft)', 'var(--st-review)'],
    count: '1/5 slices', next: 'blocked Issue 67 +2 more',
  });
  expect(col('I_59', 'next').firstElementChild!.className, 'blocked reads in its colour').toContain('text-(--st-review)');
  expect(col('I_59', 'next').getAttribute('title'), 'the rest are named on hover').toBe('blocked #67 Issue 67\nblocked #69 Issue 69\nactive #66 Issue 66');
  expect(col('I_59', 'bar').querySelector('ol > li.status-pulse'), 'the active slice pulses').not.toBeNull();
  expect(rows().map((r) => r.dataset.item), 'slices are no rows of their own').toEqual(['I_59']);
  await press(count());
  expect([...list()!.querySelectorAll('li')].map((li) => text(li).slice(0, 3)), 'the list shows every slice').toEqual(['#65', '#66', '#67', '#68', '#69']);
});

test('with none blocked, a build names its first active slice, and no more when it is the only one', async () => {
  const raw = rawIssue('I_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 1 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN')] },
  });
  await mountPage(boardOf([raw], { active: [66, 67] }));
  expect([slices().count, slices().next]).toEqual(['1/3 slices', 'active Issue 66 +1 more']);
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(boardOf([raw], { active: [67] })));
  expect([slices().count, slices().next]).toEqual(['1/3 slices', 'active Issue 67']);
});

test('a build\'s count leaves out slices closed as not planned, and names none while none is active or blocked', async () => {
  const raw = rawIssue('I_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 4, completed: 2 },
    subIssues: { nodes: [sliceRef(65, 'CLOSED'), { ...sliceRef(66, 'CLOSED'), stateReason: 'NOT_PLANNED' }, sliceRef(67, 'OPEN'), sliceRef(68, 'OPEN')] },
  });
  await mountPage(boardOf([raw]));
  expect(slices()).toEqual({ segments: ['var(--st-done)', 'var(--soft)', 'var(--soft)'], count: '1/3 slices', next: '' });
});

test('an open slice the project auto-added is no row of its own', async () => {
  const slice = rawIssue('I_slice66', 66, 'In progress', ['improvement'], {
    parent: { number: 59, title: 'Issue 59', url: 'https://github.com/maddec01/lar-factory/issues/59', state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-factory' } },
  });
  const raw = rawIssue('I_build', 59, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 1 }, subIssues: { nodes: [sliceRef(65, 'CLOSED'), sliceRef(66, 'OPEN'), sliceRef(67, 'OPEN')] },
  });
  await mountPage(boardOf([slice, raw, rawIssue('I_other', 70, 'In progress', ['bug'])]));
  expect(rows().map((r) => r.dataset.item)).toEqual(['I_59', 'I_70']);
});

test('the count unfolds the slice list under the row and folds it again, without opening the dialog', async () => {
  await mountPage(loose);
  expect([count('I_sample13').getAttribute('aria-expanded'), count('I_sample13').getAttribute('aria-label'), list('I_sample13')]).toEqual(['false', 'Show slices', null]);
  await press(count('I_sample13'));
  expect([count('I_sample13').getAttribute('aria-expanded'), count('I_sample13').getAttribute('aria-label')]).toEqual(['true', 'Hide slices']);
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
    copy.querySelectorAll('[data-col="bar"] ol > li').forEach((li) => li.remove());
    return [...copy.querySelectorAll('*')].map((e) => `${e.tagName}.${e.className}`).join(' ');
  };
  await mountPage(boardOf([build(14)], { active: [101, 102] }));
  const many = shape();
  await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(boardOf([build(3)], { active: [101, 102] })));
  expect(shape()).toBe(many);
});

test.each(['Shaping', 'In progress', 'Review'] as const)('the status tooltip follows the latest real thread at %s', async (status) => {
  const id = 'I_sample14';
  const data = withItem(id, { status, threads: [] });
  await mountPage(data);
  const activity = () => state(id).title;
  expect(activity()).toBe('Not started');
  const { useBoardStore } = await import('../board/board-store.ts');
  for (const [state, expected] of [['running', 'Thread running'], ['stopped', 'Run stopped'], ['done', 'Run finished'], ['needs you', 'Thread needs you']] as const) {
    await settle(() => useBoardStore.getState().receive(withItem(id, { status, threads: [thread('t1', state)] })));
    if (status === 'Shaping' && state === 'needs you') {
      expect($(`.desk-card[data-item="${id}"]`)).not.toBeNull();
    } else expect(activity()).toBe(expected);
  }
  await settle(() => useBoardStore.getState().receive(withItem(id, { status, threads: 'unavailable' })));
  expect(activity()).toBe('Thread unavailable');
  await settle(() => useBoardStore.getState().receive(withItem(id, { status, threads: [{ ...thread('t1', 'running'), observedAt: '2026-10-21T09:05:00.000Z' }] })));
  expect(activity()).toMatch(/^Thread running, last seen \d\d:05$/);
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
  await settle(() => useBoardStore.getState().receive(withItem('I_sample13', { threads: [thread('newer-shaping', 'stopped'), thread('stopped-build', 'stopped')] }, {
    ...data, startedBuilds: { I_sample13: started },
  })));
  expect(text(side('I_sample13'))).toContain('Run stopped.');
  expect(side('I_sample13').querySelector('[data-start-result]')).toBeNull();
  expect(side('I_sample13').querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/stopped-build');
  await press(opener('I_sample13'));
  expect(text(dialog()!.querySelector('[data-slot="modal-footer"]'))).toContain('Run stopped.');
  expect(dialog()!.querySelector('[data-open-thread][href$="/stopped-build"]'), 'the recovery keeps its own thread').not.toBeNull();
  const again = side('I_sample13').querySelector<HTMLButtonElement>('[data-start]')!;
  expect(text(again)).toBe('Start again ▾');
  expect(text(dialog()!.querySelector('[data-start]'))).toBe('Start again ▾');
  await pressMenu(again);
  await press(entries()[0]!);
  expect(posted()).toHaveLength(2);
  expect(text(startBuild())).toBe('Starting…');
  await answer({ thread: { threadId: 'new-build', title: 'Build again' }, error: null,
    board: { ...data, startedBuilds: { I_sample13: { threadId: 'new-build', title: 'Build again' } } } });
  expect(text(side('I_sample13').querySelector('[data-start-result]'))).toBe('Started');
});

test.each([false, true])('a Ready item keeps Start build after shaping stops (recorded: %s)', async (recorded) => {
  const shaping = thread('stopped-shaping', 'stopped');
  await mountPage(withItem('I_sample13', { threads: [shaping] }, {
    ...unblocked(), started: recorded ? { I_sample13: { threadId: shaping.id, title: shaping.title } } : {},
  }));
  expect(text(startBuild())).toBe('Start build ▾');
  expect(text(side('I_sample13'))).not.toContain('Run stopped.');
  await press(opener('I_sample13'));
  expect(text(dialog()!.querySelector('[data-slot="modal-footer"]'))).toContain('Start build ▾');
});

test('live slice transitions update the bar, expanded list and count without a reload', async () => {
  const initial = boardOf([build(3)]);
  await mountPage(initial);
  await press(count());
  const { useBoardStore } = await import('../board/board-store.ts');
  for (const progress of ['active', 'unknown', 'blocked', 'waiting', 'done'] as const) {
    const data = { ...initial, items: initial.items.map(item => ({ ...item, slices: item.slices.map((slice, index) => index === 1 ? { ...slice, progress } : slice) })) };
    await settle(() => useBoardStore.getState().receive(data));
    expect(text(list())).toContain(progress);
    expect(text(count())).toBe(progress === 'done' ? '2/3 slices' : '1/3 slices');
    const segment = col('I_59', 'bar').querySelectorAll('ol > li')[1]!;
    expect(segment.classList.contains('status-pulse')).toBe(progress === 'active');
    if (progress === 'unknown') {
      expect((segment as HTMLElement).style.background).toBe('var(--muted-foreground)');
      expect(text(list())).toContain('?');
      expect(text(col('I_59', 'next'))).toBe('');
    }
  }
});

test('a build with no ticket says Build in the kind cell', async () => {
  await mountPage(withItem('I_sample13', { kind: 'build', labels: [], recorded: true, number: 0 }, loose));
  expect(text(row('I_sample13').querySelector('[data-kind]'))).toBe('Build');
});

test('a ticket with no recognised kind leaves the kind cell empty', async () => {
  const shaping = sample.items.find((i) => i.number === 130)!.id;
  await mountPage(withItem(shaping, { kind: 'issue' }));
  expect(text(row(shaping).querySelector('[data-kind]'))).toBe('');
});

test('a row shows a kind disagreement', async () => {
  const kindDisagreement: KindDisagreement = { ticketKind: 'bug', changed: 'item', kept: false, swap: { add: [], remove: [], type: null } };
  await mountPage({ ...loose, items: loose.items.map((i) => (i.id === 'I_sample14' ? { ...i, kindDisagreement } : i)) });
  expect(text(meta('I_sample14').querySelector('[data-kind-marker]'))).toBe('Bug');
  expect(meta('I_sample13').querySelector('[data-kind-marker]')).toBeNull();
});

describe.each(['Verify', 'Ready to merge'] as const)('%s with its build thread running', (status) => {
  const threads = (build: ItemThread['state'], more: Partial<ItemThread> = {}): ItemThread[] => [thread('other', 'done'), { ...thread('build', build), purpose: 'build', ...more }];
  const at = (t: ItemThread[], change: Partial<Item> = {}): BoardData => withItem('I_sample13', { status, blockers: [], threads: t, ...change }, { ...loose, error: null, fetchedAt: new Date(NOW).toISOString() });
  const running = threads('running', { currentRunning: true });
  const receive = async (data: BoardData) => settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(data));
  const desk = () => $('.desk-card[data-item="I_sample13"]');

  test('its row sits in Build as Working, with Open thread on the build thread, and leaves the desk', async () => {
    await mountPage(at(running));
    expect(desk()).toBeNull();
    expect(text(state('I_sample13'))).toBe('Working');
    const open = side('I_sample13').querySelector<HTMLAnchorElement>('[data-open-thread]')!;
    expect([text(open), open.getAttribute('href')]).toEqual(['Open thread', 't3code://threads/sample-environment/build']);
  });

  test('its row says Working with slices too, and with a running child', async () => {
    await mountPage(at(threads('done', { hasRunningChildren: true }), { slices: [{ number: 1, title: 'One', progress: 'done' }] as Slice[] }));
    expect(desk()).toBeNull();
    expect(text(state('I_sample13'))).toBe('Working');
    expect(state('I_sample13').title).toBe('Parent run finished');
  });

  test('it returns to the desk with its Status when the thread stops, with no write', async () => {
    await mountPage(at(running));
    await receive(at(threads('done'), { slices: [] }));
    expect(text(desk())).toContain(status);
    expect(text(desk()!.querySelector('.desk-actions'))).toContain('Open PR');
    expect(text(side('I_sample13')), 'its Build row points at the desk').toBe('on your desk');
    expect(posted()).toEqual([]);
  });

  test('it stays in Build as Working while a slice runs after the thread stops', async () => {
    await mountPage(at(threads('done')));
    expect(desk()).toBeNull();
    expect(text(state('I_sample13'))).toBe('Working');
    expect(state('I_sample13').title).toBe('Parent run finished');
  });

  test('it stays on the desk with an open question, even while a child runs', async () => {
    await mountPage(at(threads('needs you', { hasRunningChildren: true })));
    expect(text(desk())).toContain(status);
  });

  test('it returns to the desk at its Status while the page cannot read the board', async () => {
    await mountPage(at(running));
    expect(desk()).toBeNull();
    await settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().fail('HTTP 502'));
    expect(text(desk())).toContain(status);
  });
});
