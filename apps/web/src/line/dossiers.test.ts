// The line's dossiers: each open concept, and each open item with sub-issues on the board, shown whole: its header,
// its map, its parts as a checklist or a map, and their rows. Ports the old Board view's concept block tests.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, answer, holdPosts, mountPage, posted, sample, settle, text } from '../../test/support.ts';
import { normalizeItems } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread } from '@lar-factory/shared';
import { rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';

const C200 = 'I_sample09';
const C180 = 'I_sample23';
const dossier = (id = C200) => $(`[data-dossier="${id}"]`)!;
/** The header's four cells: title, track, agent and side. */
const header = (id = C200) => [...dossier(id).firstElementChild!.children] as HTMLElement[];
const step = (id: string, d = C200) => dossier(d).querySelector<HTMLElement>(`[data-part="${id}"]`)!;
const phases = (d = C200) => [...dossier(d).querySelectorAll('[data-checklist] [data-phase]')];
const progress = (d = C200) => [...dossier(d).querySelectorAll('[data-item]')].slice(1) as HTMLElement[];
const row = (id: string, d = C200) => dossier(d).querySelector<HTMLElement>(`[data-item="${id}"]`)!;
const startIn = (el: Element) => el.querySelector<HTMLButtonElement>('[data-start]');
const press = (el: Element) => settle(() => (el as HTMLElement).click());
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialogTitle = () => text($('[data-item-dialog] [data-slot="dialog-title"]'));
const button = (within: Element, label: string) => [...within.querySelectorAll<HTMLButtonElement>('button')].find((b) => text(b) === label)!;
const withItem = (id: string, change: Partial<Item>, data: BoardData = sample): BoardData =>
  ({ ...data, items: data.items.map((i) => (i.id === id ? { ...i, ...change } : i)) });
const writable = (data: BoardData = sample): BoardData =>
  ({ ...data, capture: { session: 's1', enabled: true }, modelChoices: [{ instanceId: 'codex', name: 'Codex', models: [{ slug: 'gpt-5.5', label: 'GPT-5.5' }] }] });
/** #140 with its blocker #202 closed, on a board whose writes are on. */
const unblocked = () => writable(withItem('I_sample13', { blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'closed' }] }));
const c200 = sample.items.find((i) => i.id === C200)!;
/** A Queued grill under #200, blocked by `blockers`. */
const decision = (blockers: Item['blockers'] = []): Item => ({
  ...sample.items.find((i) => i.id === 'I_sample05')!, id: 'I_d204', number: 204, title: 'Pick the relay host', labels: ['decision: grill'],
  repo: c200.repo, parent: { number: 200, repo: c200.repo!, title: c200.title, url: c200.url!, state: 'open' },
  blockers,
});
const withDecision = (blockers?: Item['blockers']) => writable({ ...sample, items: [...sample.items, decision(blockers)] });
const receive = (data: BoardData) => settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(data));
const thread = (id: string, state: ItemThread['state']): ItemThread => ({ id, title: `Thread ${id}`, state, updated: '2026-10-21T09:00:00.000Z' });

beforeEach(() => localStorage.clear());

test('each open concept and item with sub-issues on the board is a dossier, in board order, between the Queue and the rest of the line', async () => {
  await mountPage();
  expect([...$('.line > div')!.children].map((el) => el.getAttribute('data-dossier') ?? el.className.split(' ')[0])).toEqual(['queue', C200, C180, 'overflow-hidden']);
  await receive({ ...sample, items: sample.items.filter((i) => !i.labels.includes('concept') && i.parent?.number !== 180) });
  expect($$('[data-dossier]'), 'none without a concept or a parent').toEqual([]);
});

test('the header shows the kind, status, parts done and repositories, the title, its T3 threads and the agent total', async () => {
  await mountPage();
  const [title, track, agent, side] = header();
  expect([...title!.children].map(text)).toEqual([
    'ConceptShaping · 1/4 parts done · Server', '#200 lar cloud: website sign-in and relay', '4 T3 threads · 1 running · 1 need you',
  ]);
  expect(title!.className.split(' '), 'one column as wide as the cell, so the lines truncate at 840 px, not overflow').toContain('grid-cols-[minmax(0,1fr)]');
  expect(track!.getAttribute('title')).toBe('Shaping');
  expect([...agent!.children].map(text), "#200's parts' figures").toEqual(['1h 31m', '6.23M · $9.11']);
  expect(text(side)).toBe('#202 waits on you');
  expect(text(header(C180)[0]!.firstElementChild)).toBe('Coupled workIn progress · 2/2 parts done · Server + Apple');
  expect([text(header(C180)[0]!.lastElementChild), text(header(C180)[3])]).toEqual(['3 T3 threads · 1 running · 0 need you', 'Nothing waits on you']);
});

test('the header opens the dossier\'s item, and its "waits on you" opens that part', async () => {
  await mountPage();
  await press(header()[3]!.querySelector('button')!);
  expect(dialogTitle()).toBe('#202 Sign-in screen');
  await press(dossier().firstElementChild!);
  expect(dialogTitle()).toBe('#200 lar cloud: website sign-in and relay');
});

test("the map shows the destination, decisions so far and open questions, each #n opening its item", async () => {
  await mountPage();
  const about = dossier().querySelector('[data-about]')!;
  expect([...about.children].slice(0, 3).map((s) => text(s.firstElementChild))).toEqual(['Destination', 'Decisions so far 3', 'Open questions 2']);
  expect(text(about.querySelector('p'))).toMatch(/^Anyone with a lar server signs in on lar\.app/);
  expect([...about.querySelectorAll('li')].map(text)[4]).toBe('What does the sign-in screen look like on the website and in the apps? (#202)');
  await press(button(about, '#203'));
  expect(dialogTitle()).toBe(`#203 ${sample.items.find((i) => i.number === 203)!.title}`);
  expect(text(dossier(C180).querySelector('[data-about] > section:nth-child(3) p'))).toBe('None. Every decision is made.');
});

test("in the map, #n opens the issue in the concept's repository, and owner/repo#n the one in that repository", async () => {
  const s10 = sample.items.find((i) => i.id === 'I_sample10')!;
  const twin: Item = { ...s10, id: 'I_twin', repo: 'maddec01/lar-apple', url: 'https://github.com/maddec01/lar-apple/issues/201', title: 'Apple twin' };
  const map = { ...c200.map!, decisions: [...c200.map!.decisions, 'The apps follow maddec01/lar-apple#201.'] };
  await mountPage({ ...sample, items: [twin, ...sample.items.map((i) => (i.id === C200 ? { ...i, map } : i))] });
  const about = dossier().querySelector('[data-about]')!;
  await press(button(about, '#201'));
  expect(dialogTitle()).toBe(`#201 ${s10.title}`);
  await press(button(about, 'maddec01/lar-apple#201'));
  expect(dialogTitle()).toBe('#201 Apple twin');
});

test('the checklist runs Decide, then Build per repository, then Check, the done parts folded', async () => {
  await mountPage();
  expect(phases().map((p) => text(p.querySelector('h4')))).toEqual(['Decide1/3 answered', 'Build Server', 'Checkthe agents run it once every build lands']);
  expect([...phases()[0]!.querySelectorAll('[data-part]')].map((s) => s.getAttribute('data-part'))).toEqual(['I_sample10', 'I_sample12']);
  const fold = button(phases()[0]!, '1 done');
  await press(fold);
  expect([fold.getAttribute('aria-expanded'), phases()[0]!.querySelectorAll('[data-part]').length]).toEqual(['true', 3]);
  expect(phases(C180).map((p) => text(p.querySelector('h4'))), 'which repository goes first').toEqual(['Build Servergoes first', 'Build Appleafter Server', 'Checkthe agents run it once every build lands']);
});

test('each step shows its kind, what it waits on, its figures and its own thread', async () => {
  await mountPage();
  const lines = (id: string) => [...step(id).children].map(text);
  expect(lines('I_sample10')).toEqual(['#201 Relay: broker only or full TURN?grillOpen thread', 'Shaping28m · 1.87M · $2.71waits on #203', 'T3 · Grill: relay broker only or full TURN· running']);
  expect(lines('I_sample12')).toEqual(['#202 Sign-in screenprototypeon your desk', 'Needs you41m · 2.95M · $4.35', 'T3 · Prototype: sign-in screen· needs you']);
  expect(lines('I_sample13')).toEqual(['#140 Owner accountsbuildStart buildStart after #202 ▾', 'Ready1/3 sliceswaits on #202', '', 'T3 · Shape: owner accounts· done']);
  const chip = button(step('I_sample13'), '#202');
  expect(chip.className, 'an open blocker').toContain('text-(--warning-foreground)');
  expect(button(step('I_sample10'), '#203').querySelector('.lucide-check'), 'a closed one is ticked').not.toBeNull();
  await press(chip);
  expect(dialogTitle()).toBe('#202 Sign-in screen');
});

test('a step with no thread yet says when its thread starts', async () => {
  await mountPage(withItem('I_sample13', { threads: [] }));
  expect(text(step('I_sample13').lastElementChild)).toBe('Thread starts when #202 is done');
});

test('the progress rows sit on the stage track, done parts folded, each side saying what it waits on', async () => {
  await mountPage();
  expect(text(dossier().lastElementChild!.firstElementChild!.firstElementChild)).toBe('Progress · 4 parts');
  expect(progress().map((r) => r.dataset.item)).toEqual(['I_sample10', 'I_sample12', 'I_sample13']);
  const side = (id: string) => text(row(id).lastElementChild);
  expect([side('I_sample10'), side('I_sample12'), side('I_sample13')]).toEqual(['running', 'on your desk', 'waits on #202']);
  expect(row('I_sample13').children[1]!.getAttribute('title'), 'a waiting part is dashed').toBe('Ready, waiting');
  await press(button(dossier(C180), '2 done'));
  expect(progress(C180).map((r) => text(r.lastElementChild))).toEqual(['PR #182 (merged)', 'PR #41 (merged)']);
  expect(button(dossier(C180), 'Hide 2 done')).toBeDefined();
});

test('Start build on a blocked build is disabled, its title naming the blocker, and Start after joins it', async () => {
  await mountPage();
  const start = startIn(step('I_sample13'))!;
  expect([text(start), start.disabled, start.title]).toEqual(['Start build', true, 'Blocked by #202 until it closes']);
  expect(text(step('I_sample13').querySelector('[data-start-after]'))).toBe('Start after #202 ▾');
  expect(text(header()[3]), 'the header offers no start while a part waits on you').toBe('#202 waits on you');
});

test('once its blockers close, Start build sends the build, and the header offers it too', async () => {
  holdPosts(unblocked());
  await mountPage(withItem('I_sample12', { status: 'Shaping' }, unblocked()));
  expect(text(startIn(header()[3]!))).toBe('Start #140 ▾');
  await press(startIn(step('I_sample13'))!);
  expect(dialogTitle(), 'the menu opens without the dialog').toBe('');
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/start-build', { session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(dossier().querySelector('p.start [role="alert"]')), 'its error shows under its row').toBe('T3 is down.');
});

/** #140, Ready, also carrying Verify. */
const twice = (data: BoardData = sample) => withItem('I_sample13', { statuses: ['Ready', 'Verify'] }, data);

test('a part that carries two statuses offers no Start build in its step or the header', async () => {
  await mountPage(twice(withItem('I_sample12', { status: 'Shaping' }, unblocked())));
  expect(startIn(step('I_sample13'))).toBeNull();
  expect(startIn(header()[3]!)).toBeNull();
});

test('a blocked part that carries two statuses offers no Start after in its step or its map node', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountPage(twice());
  expect(step('I_sample13').querySelector('[data-start], [data-start-after]')).toBeNull();
  await press(button(dossier(), 'Map'));
  expect(dossier().querySelector('[data-map-part="I_sample13"] :is([data-start], [data-start-after])')).toBeNull();
});

test("Start on a Queued decision is today's Start", async () => {
  holdPosts(withDecision());
  await mountPage(withDecision());
  expect(text(step('I_d204'))).toMatch(/^#204 Pick the relay hostgrillStart ▾/);
  await press(startIn(step('I_d204'))!);
  await press(entries()[0]!);
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_d204' }]]);
});

test('Start on a Queued decision is disabled while a blocker is open, its title naming it, and Start after names the last open one', async () => {
  const data = withDecision([{ number: 201, repo: 'maddec01/lar-server', state: 'open' }, { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
    { number: 140, repo: 'maddec01/lar-server', state: 'open' }]);
  holdPosts(data);
  await mountPage(data);
  const start = startIn(step('I_d204'))!;
  expect([text(start), start.disabled, start.title]).toEqual(['Start', true, 'Blocked by #201, #140 until they close']);
  const after = step('I_d204').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([text(after), after.title]).toEqual(['Start after #140 ▾', 'Starts by itself once #201, #140 close']);
  await press(after);
  await press(entries()[0]!);
  expect(posted(), 'T3 default arms it with no model').toEqual([['/api/arm', { session: 's1', itemId: 'I_d204' }]]);
  await answer({ error: null, board: { ...data, armed: { I_d204: {} } } });
  expect(text(step('I_d204').querySelector('[data-start-after]'))).toBe('Starts after #140 ✓');
});

test('in the map, a part waiting on something that is neither Ready nor Queued starts by itself after it', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountPage(withItem('I_sample10', { blockers: [{ number: 203, repo: 'maddec01/lar-server', state: 'open' }] }));
  await press(button(dossier(), 'Map'));
  expect(text(dossier().querySelector('[data-map-part="I_sample10"]'))).toContain('starts by itself after #203');
});

test("in the map, a part waiting on another repository's issue names it without its owner", async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountPage(withItem('I_sample10', { blockers: [{ number: 12, repo: 'maddec01/lar-apple', state: 'open' }] }));
  await press(button(dossier(), 'Map'));
  expect(text(dossier().querySelector('[data-map-part="I_sample10"]'))).toContain('starts by itself after lar-apple#12');
});

test('Open thread takes Start\'s place while a part has a live thread', async () => {
  const data = withDecision();
  await mountPage(withItem('I_d204', { threads: [thread('t1', 'running')] }, data));
  expect(startIn(step('I_d204'))).toBeNull();
  expect(step('I_d204').querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/t1');
});

test("the end-to-end check comes from the map: its title, numbered steps and waiting, with running it not built yet", async () => {
  await mountPage();
  const box = dossier().querySelector('[data-about] [data-check]')!;
  expect([...box.children].map(text)).toEqual(['End-to-end check', 'Sign in on the website, then stream from a phone off Wi-Fiwaiting', 'Create an owner account on lar.appRegister a server with the accountOpen the app on cellular and play a 4K title']);
  const check = phases()[2]!;
  expect(text(check)).toContain('waitingwaits on #140Thread starts when #140 is done');
  for (const label of ['Run end-to-end', 'Watch run']) {
    const b = button(check, label);
    expect([b.disabled, b.title, b.className.includes('disabled:pointer-events-auto')]).toEqual([true, `${label} isn't built yet: no workflow runs an end-to-end check`, true]);
  }
});

test('a map with no End-to-end check section has no Check phase, and its map says none is written', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { check: _, ...map } = c200.map!;
  await mountPage(withItem(C200, { map }));
  expect(phases().map((p) => text(p.querySelector('h4')))).toEqual(['Decide1/3 answered', 'Build Server']);
  expect(dossier().querySelector('[data-check]')).toBeNull();
  await press(button(dossier(), 'Map'));
  expect(text(dossier().querySelector('[data-work-map]'))).toContain('No end-to-end check written yet');
});

test('the Map view draws a lane per repository and Decisions, its parts by wave, and arrows for what waits on what', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountPage();
  const toggle = button(dossier(), 'Map');
  await press(toggle);
  expect([toggle.getAttribute('aria-pressed'), button(dossier(), 'Checklist').getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  const map = dossier().querySelector('[data-work-map]')!;
  expect(dossier().querySelector('[data-checklist]'), 'the map takes the checklist\'s place').toBeNull();
  expect(dossier().querySelector('[data-about]'), 'the map\'s sections stay under it').not.toBeNull();
  expect([...map.querySelectorAll('.sticky')].map(text)).toEqual(['Decisionsgrill, prototype, research', 'Serverlar-server']);
  expect([...map.querySelectorAll('.h-7\\.5')].map(text)).toEqual(['Wave 1· 2 in parallel', 'Wave 2· 2 in parallel', 'Check']);
  expect([...map.querySelectorAll('[data-map-part]')].map((n) => n.getAttribute('data-map-part'))).toEqual(['I_sample18', 'I_sample12', 'I_sample10', 'I_sample13']);
  expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge'))).toEqual([
    'maddec01/lar-server#203 maddec01/lar-server#201', 'maddec01/lar-server#202 maddec01/lar-server#140', 'maddec01/lar-server#140 e2e',
  ]);
  expect(text(map.querySelector('[data-map-check]'))).toBe('end-to-end checkSign in on the website, then stream from a phone off Wi-Fiwaiting · 3 stepsagents run it once #140 land');
  const node = (id: string) => map.querySelector(`[data-map-part="${id}"]`)!;
  expect(startIn(node('I_sample13')), 'a blocked part offers Start after alone').toBeNull();
  expect(text(node('I_sample13').querySelector('[data-start-after]'))).toBe('Start after #202 ▾');
  expect(text(node('I_sample12').querySelector('[data-open-thread]'))).toBe('Answer in T3');
  await press(node('I_sample10').querySelector('button')!);
  expect(dialogTitle()).toBe('#201 Relay: broker only or full TURN?');
});

test('an item with sub-issues on the board is coupled work; with no map, it says its parts come from GitHub', async () => {
  const parent = rawIssue('PVTI_parent', 100, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 0 },
    subIssues: { nodes: [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN'), sliceRef(103, 'OPEN')] },
  });
  const child = rawIssue('PVTI_102', 102, 'In progress', ['build'], {
    parent: { number: 100, title: 'Issue 100', url: 'https://github.com/maddec01/lar-factory/issues/100', state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-factory' } },
  });
  await mountPage({ ...sample, error: null, items: normalizeItems([parent, child], { builds: new Set(['maddec01/lar-factory#102', 'maddec01/lar-factory#103']) }) });
  const d = dossier('I_100');
  expect(text(header('I_100')[0]!.firstElementChild)).toBe('Coupled workIn progress · 0/1 parts done · lar-factory');
  expect(text(d.querySelector('[data-checklist]')!.previousElementSibling)).toBe("No map yet: the parts come from GitHub's sub-issues.");
  expect(progress('I_100').map((r) => r.dataset.item), 'its build sub-issue is a part; its slice is not').toEqual(['I_102']);
  expect(phases('I_100').map((p) => text(p.querySelector('h4'))), 'no Check phase without a map').toEqual(['Build lar-factory']);
  expect($('[data-in-flight] [data-item="I_102"]'), 'out of the rest of the line').toBeNull();
});

test('the dossiers take the main area\'s scope', async () => {
  await mountPage();
  await press($$('button.scope').find((b) => text(b).includes('Apple'))!);
  expect($$('[data-dossier]').map((d) => d.getAttribute('data-dossier')), '#180 through its Apple build').toEqual([C180]);
});
