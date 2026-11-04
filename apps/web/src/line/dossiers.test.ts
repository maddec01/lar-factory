// The dock's dossiers: each started concept, and each open item with sub-issues on the board: its one line, and expanded
// under it, what keeps the work moving and its parts as a Work map or a list. Ports the old Board view's
// concept block tests.

import { beforeEach, expect, test, vi } from 'vite-plus/test';
import { $, $$, NOW, answer, holdPosts, mountPage, posted, pressMenu, recorded, sample, settle, text } from '../../test/support.ts';
import { normalizeItems } from '@lar-factory/shared';
import type { BoardData, DependencyHold, Item, ItemThread } from '@lar-factory/shared';
import { rawIssue, sliceRef } from '@lar-factory/shared/test/raw-items';

const C200 = 'I_sample09';
const C180 = 'I_sample23';
const dossier = (id = C200) => $(`[data-dossier="${id}"]`)!;
const header = (id = C200) => dossier(id).querySelector<HTMLElement>('[data-item]')!;
const line = (id = C200) => header(id).querySelector<HTMLElement>('[data-line="1"]')!;
/** The row's "what's next": the part that waits on you, the first part that can start, or the fallback. */
const next = (id = C200) => header(id).querySelector<HTMLElement>('[data-next]')!;
const chips = (id = C200) => [...header(id).querySelectorAll('[data-chip]')].map(text);
const opener = (id = C200) => header(id).querySelector<HTMLButtonElement>('[data-dossier-open]')!;
const VIEW_KEY = 'lar-board:dossier-view:';
const step = (id: string, d = C200) => dossier(d).querySelector<HTMLElement>(`[data-part="${id}"]`)!;
/** The parts the parts list shows, in its order. */
const listed = (d = C200) => [...dossier(d).querySelectorAll<HTMLElement>('[data-parts-list] [data-part]')].map((p) => p.dataset.part);
const startIn = (el: Element) => el.querySelector<HTMLButtonElement>('[data-start]');
/** Clicks `el`; a menu it closes hands focus back on the next tick. */
const press = (el: Element) => settle(() => {
  (el as HTMLElement).click();
  vi.advanceTimersByTime(0);
});
const entries = () => $$('[role="menu"] [role="menuitemradio"]');
const dialogTitle = () => text($('[data-item-dialog] [data-slot="modal-header"] h2'));
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
  ...sample.items.find((i) => i.id === 'I_sample05')!, id: 'I_d204', number: 204, title: 'Pick the relay host', labels: ['decision-grill'],
  repo: c200.repo, parent: { number: 200, repo: c200.repo!, title: c200.title, url: c200.url!, state: 'open' }, parentId: c200.id,
  blockers,
});
const withDecision = (blockers?: Item['blockers']) => writable({ ...sample, items: [...sample.items, decision(blockers)] });
const receive = (data: BoardData) => settle(async () => (await import('../board/board-store.ts')).useBoardStore.getState().receive(data));
const thread = (id: string, state: ItemThread['state']): ItemThread => ({ id, title: `Thread ${id}`, state, updated: '2026-10-21T09:00:00.000Z' });

/** Every sample dossier opens on its parts list here, so the tests of a dossier's body see it; the Work map tests clear this. */
beforeEach(() => {
  localStorage.clear();
  for (const id of [C200, C180, 'I_100', 'I_700']) localStorage.setItem(VIEW_KEY + id, 'list');
});

/** Dossier `id`'s body while it is expanded. */
const body = (id = C200) => dossier(id).querySelector<HTMLElement>('[data-dossier-body]');
/** The page with dossier `id` expanded, which the browser may remember from before a reload. */
const mountOpen = async (data: BoardData = sample, id = C200) => {
  await mountPage(data);
  if (!body(id)) await press(opener(id));
};
/** Dossier `id` expanded too. */
const openInstead = (id: string) => press(opener(id));

test('each started concept and item with sub-issues on the board is a dossier in the dock, in board order; with none the dock takes no height', async () => {
  await mountPage();
  expect(text($('#dock-h'))).toBe('Concepts and linked work 2');
  expect([...$('[data-dossiers]')!.children].map((el) => el.getAttribute('data-dossier'))).toEqual([C200, C180]);
  await receive({ ...sample, items: sample.items.filter((i) => !i.labels.includes('concept') && i.parent?.number !== 180) });
  expect([$$('[data-dossier]'), $('[data-stage="dock"]')], 'none without a concept or a parent').toEqual([[], null]);
});

test('a Queued concept stays out of the dock until it starts', async () => {
  const concept = { ...sample.items.find((i) => i.id === C200)!, id: 'I_queued', number: 777, status: 'Queued' as const, statuses: ['Queued' as const], threads: [] };
  await mountPage({ ...sample, items: [...sample.items, concept] });
  expect([$('[data-dossier="I_queued"]'), $('.queue li[data-item="I_queued"]') !== null]).toEqual([null, true]);
});

const SECTIONS = ['queue', 'shaping', 'ready', 'build', 'dock'];
const panes = () => SECTIONS.filter((id) => $(`[data-stage="${id}"]`));

test('a dock row is one line, and its chevron expands the Work map under it, with the desk, filters and every section in place', async () => {
  localStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountPage();
  expect([dossier().querySelector('[data-work-map]'), panes()]).toEqual([null, SECTIONS]);
  await press(opener());
  expect(body()!.querySelector('[data-work-map]'), 'expanded, it shows its map').not.toBeNull();
  expect([panes(), $('.desk') !== null, $('[data-line-filters]') !== null, $$('[data-dossier]').length], 'the page keeps its place').toEqual([SECTIONS, true, true, 2]);
  expect(header().compareDocumentPosition(body()!) & Node.DOCUMENT_POSITION_FOLLOWING, 'under its own row').toBeTruthy();
  expect([$('[data-dossier-back]'), body()!.className.split(' ').filter((c) => /^(flex-1|h-|max-h|overflow)/.test(c))], 'no way back to need, and no cap or forced height').toEqual([null, []]);
});

test('the chevron is a real button that says whether the row is expanded, and focus stays on it as the row collapses', async () => {
  await mountPage();
  const chevron = opener();
  expect([chevron.tagName, chevron.getAttribute('aria-expanded'), chevron.getAttribute('aria-label')]).toEqual(['BUTTON', 'false', 'Expand #200 lar cloud: website sign-in and relay']);
  chevron.focus();
  await clickWith(chevron, 0);
  expect([chevron.getAttribute('aria-expanded'), chevron.getAttribute('aria-label'), body() !== null]).toEqual(['true', 'Collapse #200 lar cloud: website sign-in and relay', true]);
  await clickWith(chevron, 0);
  expect([chevron.getAttribute('aria-expanded'), body(), document.activeElement, opener()]).toEqual(['false', null, chevron, chevron]);
});

test('clicks on the title, a chip, a nested Start, the view toggle or the body leave the row as it is', async () => {
  holdPosts(unblocked());
  await mountPage(withItem('I_sample12', { status: 'Shaping', threads: [thread('shaping', 'running')] }, unblocked()));
  await press(startIn(col('side'))!);
  await press(header().querySelector('[data-chips]')!);
  expect(body(), 'still collapsed').toBeNull();
  await press(header().querySelector('[data-title]')!);
  expect([dialogTitle(), body()], 'the title opens the details dialog alone').toEqual(['#200 lar cloud: website sign-in and relay', null]);
  await press($('[data-item-dialog] [aria-label="Close"]')!);
  await press(opener());
  await press(header().querySelector('[data-title]')!);
  await press($('[data-item-dialog] [aria-label="Close"]')!);
  await press(button(dossier(), 'Parts list'));
  await press(body()!);
  expect([opener().getAttribute('aria-expanded'), body()!.querySelector('[data-parts-list]') !== null]).toEqual(['true', true]);
});

test('each dossier expands on its own, and the browser remembers it across a reload', async () => {
  await mountPage();
  await press(opener());
  await press(opener(C180));
  expect([body() !== null, body(C180) !== null]).toEqual([true, true]);
  await press(opener());
  expect([body(), body(C180) !== null]).toEqual([null, true]);
  vi.resetModules();
  await mountPage();
  expect([body(), body(C180) !== null]).toEqual([null, true]);
});

test('a board push updates an expanded dossier in place, and one that leaves the board comes back as it was', async () => {
  await mountOpen();
  await receive(withItem('I_sample10', { title: 'Relay, renamed' }));
  expect([text(step('I_sample10')).includes('Relay, renamed'), panes()]).toEqual([true, SECTIONS]);
  await receive({ ...sample, items: sample.items.filter((i) => i.id !== C200 && i.parentId !== C200) });
  expect($(`[data-dossier="${C200}"]`)).toBeNull();
  await receive(sample);
  expect(body()).not.toBeNull();
});

test('a filter hides an expanded dossier with its row, and it is still expanded once the filter lets it back', async () => {
  localStorage.setItem('lar-board:filters:board', JSON.stringify({ kinds: [c200.kind], labels: [] }));
  await mountOpen();
  await receive(withItem(C200, { kind: 'bug', status: 'Shaping' }));
  expect($(`[data-dossier="${C200}"]`)).toBeNull();
  await receive(sample);
  expect(body()).not.toBeNull();
});

test("the expanded line holds the local planning note, with its detail on focus and hover, and a compact view toggle in place of a body row", async () => {
  const data = withItem(C200, { sync: { state: 'pending', message: 'Waiting for GitHub.' } });
  await mountPage(data);
  expect(header().querySelector('[data-structure-sync]'), 'collapsed, the row stays as it is').toBeNull();
  await press(opener());
  const note = header().querySelector<HTMLElement>('[data-structure-sync]')!;
  expect([text(note), note.tabIndex, note.getAttribute('aria-label')]).toEqual(['On this Mac', 0, 'Planning is saved on this Mac. Waiting for GitHub.']);
  expect(body()!.querySelector('[data-structure-sync]'), 'no row of its own').toBeNull();
  expect(text(body()), 'nor its sentence').not.toContain('Planning is saved');
  const tools = header().querySelector<HTMLElement>('[data-dossier-tools]')!;
  expect([...tools.querySelectorAll('button')].map((b) => [text(b), b.title])).toEqual([['Work map', 'Work map'], ['Parts list', 'Parts list']]);
  expect(tools.querySelectorAll('[role="img"]').length, 'no second source or repository icon').toBe(0);
  await receive(withItem(C200, { sync: { state: 'saved' } }));
  expect(header().querySelector('[data-structure-sync]'), 'once saved, nothing').toBeNull();
});

/** A pointer click (`detail` 1) or a key press's click (`detail` 0) on `el`. */
const clickWith = (el: Element, detail: number) => settle(() => {
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
});
/** Selects the text of `el`. */
const select = (el: Element) => {
  const range = document.createRange();
  range.selectNodeContents(el);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
};

test("a dossier's Start and view controls sit in its one action slot, and a click beside them toggles the row", async () => {
  await mountPage(writable(withItem('I_sample13', { blockers: [] }, calm({}))));
  expect(next().querySelector('[data-start]'), 'its next step keeps its room').toBeNull();
  await press(opener());
  const slot = col('side');
  expect(startIn(slot)).not.toBeNull();
  expect(slot.querySelector('[data-dossier-tools]')).not.toBeNull();
  expect(line().querySelector('[data-dossier-tools]'), 'none beside the title').toBeNull();
  expect(slot.firstElementChild!.className.split(' ')).toEqual(expect.arrayContaining(['row-action', 'justify-end', 'items-center']));
  await press(slot.firstElementChild!);
  expect(body(), 'its empty room still toggles').toBeNull();
});

test('only the title opens the item; anywhere else on the row but its controls toggles the dossier', async () => {
  await mountPage();
  for (const part of [line, (id?: string) => header(id).querySelector<HTMLElement>('[data-col="bar"]')!, next]) {
    await press(part());
    expect(body()).not.toBeNull();
    expect(dialogTitle()).toBe('');
    await press(part());
    expect(body()).toBeNull();
  }
});

test('letting go of a drag that selected text in the row leaves it as it was; a selection elsewhere or a key press still toggles it', async () => {
  await mountPage();
  select(header());
  await clickWith(header(), 1);
  expect(body()).toBeNull();
  await clickWith(opener(), 0);
  expect(body(), 'Enter or Space on the row\'s button, with text selected in it').not.toBeNull();
  await press(opener());
  select(header(C180));
  await clickWith(header(), 1);
  expect(body(), 'a click, with text selected in another row').not.toBeNull();
  window.getSelection()!.removeAllRanges();
});

const refined = { refinement: { complete: true, reasons: [] }, completion: { complete: false, reasons: ['No delivery planned.'] } };
const more = (id = C200) => header(id).querySelector('[data-chips-more]');
/** C200 with nothing that asks for the user's action and no fog left: no part in Needs you and no open decision. */
const calm = (over: Partial<Item>) => ({ ...sample, items: sample.items.filter((i) => i.kind !== 'decision' && i.status !== 'Needs you').map((i) => i.id === C200 ? { ...i, map: i.map && { ...i.map, fog: [] }, ...over } : i) });

test('a refined concept leaves Shaping and stays in the dock, where its row says Refined and that no delivery is planned', async () => {
  await mountPage(calm(refined));
  expect(text(header().querySelector('[data-refined]'))).toBe('Refined');
  expect(text(more()!.querySelector('.sr-only')), 'no delivery planned, beside the short badge, keeps the next step its room').toBe('no delivery planned');
  expect(header().getAttribute('title')).toContain('Refined · no delivery planned');
  expect($(`[data-stage="shaping"] [data-item="${C200}"]`)).toBeNull();
  await press(opener());
  expect(text(header().querySelector('[data-refined]')), 'an expanded dossier keeps its Refined').toBe('Refined');
  expect(text(dossier().querySelector('[data-no-delivery]')), 'and says so in words').toBe('No delivery planned.');
});

test("a refined concept's next step says no delivery is planned, once nothing else has a claim on it", async () => {
  const quiet = (data: BoardData): BoardData => ({ ...data, items: data.items.filter((i) => i.parentId !== C200) });
  const partless = { ...refined, subIssues: { completed: 0, total: 0 } };
  await mountPage(quiet(calm(partless)));
  expect(text(next())).toBe('No delivery planned');
  expect(chips(), 'the badge keeps its own word').toEqual(['Refined']);
  await receive(quiet(calm({ ...refined, subIssues: { completed: 0, total: 3 } })));
  expect(text(next()), 'unread parts come first').toBe('Some parts are outside the board');
  await receive(calm(refined));
  expect(text(next()), 'moving work comes first').not.toContain('No delivery planned');
  await receive(quiet(calm({ ...partless, completion: { complete: false, reasons: [] } })));
  expect(text(next()), 'with delivery planned, the usual words').toBe('Nothing waits on you');
});

test('a refined concept with active builds says Refined alone, and an unrefined one neither', async () => {
  await mountPage(calm({ ...refined, completion: { complete: false, reasons: ["Its build W_b isn't Done."] } }));
  expect(text(header().querySelector('[data-refined]'))).toBe('Refined');
  await receive(calm({ refinement: { complete: false, reasons: ["Its map is empty."] }, completion: refined.completion }));
  expect(header().querySelector('[data-refined]')).toBeNull();
  await receive(calm({ refinement: undefined }));
  expect(header().querySelector('[data-refined]')).toBeNull();
});

test('the row shows one chip by priority: what asks for action over Refined, Refined over fog, and the rest count in its tooltip', async () => {
  const words = (id = C200) => header(id).getAttribute('title');
  await mountPage(withItem(C200, refined));
  expect(chips(), 'a part in Needs you over open decisions and Refined').toEqual(['1 need you']);
  expect(header().querySelector('[data-refined]')).toBeNull();
  expect(text(more()!.querySelector('[aria-hidden]'))).toBe('+4');
  expect(text(more()!.querySelector('.sr-only')), 'the rest read to a screen reader').toBe('2 decisions, Refined, no delivery planned, 2 fog');
  expect(words()).toContain('1 need you · 2 decisions · Refined · no delivery planned · 2 fog');
  const title = next().querySelector('[title]')!;
  expect([title.getAttribute('title'), title.className.split(' ').includes('truncate')], 'the next step cuts off, with its full text in its tooltip').toEqual(['#202 Sign-in screen', true]);
  await receive(withItem('I_sample12', { status: 'Verify' }, withItem(C200, refined)));
  expect(chips(), 'an open decision over Refined').toEqual(['2 decisions']);
  await receive(calm({ ...refined, map: { ...c200.map!, fog: ['An open question.'] } }));
  expect(chips(), 'Refined over fog').toEqual(['Refined']);
  expect(words()).toContain('Refined · no delivery planned · 1 fog');
  await receive(calm({ refinement: undefined, map: { ...c200.map!, fog: ['An open question.'] } }));
  expect(chips(), 'fog with nothing above it').toEqual(['1 fog']);
  expect(more(), 'nothing more to count').toBeNull();
  await receive(calm({ refinement: undefined }));
  expect(header().querySelector('[data-chips]'), 'no chips, no room').toBeNull();
});

test('a settled decision counts as done in its part bar, whatever its Status says', async () => {
  const settledDecision: Partial<Item> = { recorded: true, kind: 'decision', labels: [], status: 'Shaping', completion: { complete: true, reasons: [] }, threads: undefined };
  const pending: Partial<Item> = { ...settledDecision, completion: { complete: false, reasons: ['No answer.'] } };
  const parts = [{ ...sample.items.find((i) => i.id === 'I_sample10')!, ...settledDecision }, { ...sample.items.find((i) => i.id === 'I_sample12')!, ...pending }];
  await mountPage({ ...sample, items: [{ ...c200, subIssues: { total: 2, completed: 0 } }, ...parts] });
  expect(text(col('count'))).toBe('1/2');
  const bar = [...col('bar').querySelectorAll<HTMLElement>('[data-part-bar] li')];
  expect(bar.map((li) => [li.title, li.style.background === 'var(--st-done)'])).toEqual([[expect.stringContaining('Complete'), true], [expect.stringContaining('Shaping'), false]]);
});

test('the line holds the kind, the title and chips that hide at zero, with its T3 threads in its tooltip', async () => {
  await mountPage();
  const title = header().querySelector('[data-title]')!;
  expect(text(header().querySelector('[data-kind]'))).toBe('Concept');
  expect(text(line())).toContain('#200 lar cloud: website sign-in and relay');
  expect(text(title)).toBe('#200 lar cloud: website sign-in and relay');
  expect(title.getAttribute('title'), 'its cut-off title reads in full in a tooltip').toBe('lar cloud: website sign-in and relay');
  expect(header().getAttribute('title'), 'every chip reads in the tooltip, even one that does not show').toBe('1 need you · 2 decisions · 2 fog · 4 T3 threads · 1 running · 1 awaiting your reply');
  expect(chips(), 'the part in Needs you, ahead of the open decisions and the fog left').toEqual(['1 need you']);
  expect(text(header(C180).querySelector('[data-kind]'))).toBe('Coupled work');
  expect(chips(C180)).toEqual([]);
  expect(header(C180).getAttribute('title'), 'a zero count is left out').toBe('3 T3 threads · 1 running');
  await receive({ ...sample, items: sample.items.map((i) => ({ ...i, threads: [] })) });
  expect(header().getAttribute('title'), 'with no threads, the chips alone: never "0 T3 threads"').toBe('1 need you · 2 decisions · 2 fog');
  expect(header(C180).getAttribute('title'), 'with no threads or chips, nothing').toBeNull();
});

test('a dossier stays on one line: nothing wraps, the title and Azure fields give up their room to an ellipsis, and the first chip keeps its full width', async () => {
  await mountPage(withItem(C200, { azure: { type: 'Feature', state: 'Active', assignee: 'Ana' } }));
  const classes = (el: Element) => el.className.split(' ');
  expect(classes(header())).toContain('h-12');
  expect(classes(line())).not.toContain('flex-wrap');
  expect(classes(header().querySelector('[data-title]')!)).toContain('truncate');
  const azure = header().querySelector('[data-azure]')!;
  expect(classes(azure.parentElement!)).toEqual(expect.arrayContaining(['shrink-[1000]', 'truncate']));
  expect(azure.getAttribute('title')).toBe('Feature · Active · Ana');
  // The next step's title truncates before the first chip gives up any width.
  const box = classes(header().querySelector('[data-chips]')!);
  expect(box).toContain('shrink-0');
  expect(box).not.toContain('overflow-hidden');
  expect(classes(next())).toContain('min-w-0');
  expect(classes(next())).not.toContain('flex-1');
});

test('the blocked chip counts the blocked slices of unfinished parts', async () => {
  const s13 = sample.items.find((i) => i.id === 'I_sample13')!;
  await mountPage(withItem('I_sample13', { slices: s13.slices.map((x, n) => (n < 2 ? { ...x, progress: 'blocked' as const } : x)) }));
  expect(header().getAttribute('title')).toContain('2 blocked');
  await receive(withItem('I_sample13', { slices: s13.slices.map((x, n) => (n < 2 ? { ...x, progress: 'blocked' as const } : x)) }, calm({})));
  expect(chips(), 'with nothing above it, it shows').toEqual(['2 blocked']);
});

const col = (name: string, id = C200) => header(id).querySelector<HTMLElement>(`[data-col="${name}"]`)!;

test("the line's what's next, part bar, parts done, agent figures and repositories sit in the same columns in every dossier", async () => {
  await mountPage();
  const grid = (id: string) => header(id).className.split(' ').filter((c) => c.includes('grid-cols'));
  expect(grid(C180)).toEqual(grid(C200));
  expect(['next', 'count', 'figures', 'repos'].map((name) => text(col(name)))).toEqual(['Needs you#202 Sign-in screen', '2/6', '1h 31m · 6.23M · $9.11', '']);
  expect(col('bar').querySelectorAll('[data-part-bar] li').length, 'a segment per part').toBe(6);
  expect(next().querySelector('[title]')!.className.split(' '), "what's next ends in an ellipsis").toContain('truncate');
  expect(col('repos').className.split(' '), 'other repositories are muted text').toContain('text-(--muted-foreground)');
  expect(text(header(C180).querySelector('[data-repo-cell]')), 'the row names its own repository in its identity cell').toContain('lar-server');
  expect([text(col('count', C180)), text(next(C180)), text(col('repos', C180))]).toEqual(['2/2', 'Nothing waits on you', '+ lar-apple']);
  expect(next(C180).querySelector('[title]')!.getAttribute('title'), 'its cut-off text reads in full in a tooltip').toBe('Nothing waits on you');
});

test('the line has no stage track and no repository dots; the agent figures sit on one line, and nothing shows without them', async () => {
  await mountPage();
  expect(header().querySelector('[class*="rounded-full"]:not([data-part-bar] li):not([data-chip]):not([data-chip] *)')).toBeNull();
  const figures = col('figures').firstElementChild!;
  expect([figures.children.length, text(figures), figures.children[0]!.className.split(' ')], "#200's parts' figures, one truncating line").toEqual([1, '1h 31m · 6.23M · $9.11', expect.arrayContaining(['truncate'])]);
  await receive({ ...sample, items: sample.items.map((i) => ({ ...i, stats: undefined, threads: [] })) });
  expect(text(col('figures')), 'no figures, an empty column').toBe('');
});

test('a concept keeps the provider counts when Reset hides an unfinished part', async () => {
  const data = withItem(C180, { subIssues: { total: 2, completed: 1 } });
  await mountOpen({ ...data, repos: data.repos.filter((r) => r.repo !== 'maddec01/lar-apple'),
    items: data.items.filter((i) => i.repo !== 'maddec01/lar-apple') }, C180);
  expect(text(col('count', C180))).toBe('1/2');
  expect(text(dossier(C180))).toContain("1 part the board doesn't read");
  expect(text(next(C180))).not.toContain('Nothing waits on you');
  await press(button(dossier(C180), 'Work map'));
  expect(text(dossier(C180))).toContain("1 part the board doesn't read");
});

test('an open dossier has no About section; what keeps the work moving is in labelled rows, each with its entries', async () => {
  await mountOpen();
  expect(dossier().querySelector('[data-about]')).toBeNull();
  expect(text(dossier())).not.toContain('Destination');
  const rows = () => [...dossier().querySelectorAll<HTMLElement>('[data-attention-row]')];
  expect(rows().map((r) => [r.dataset.attentionRow, text(r.firstElementChild)])).toEqual([
    ['you', 'Needs you 1'], ['decisions', 'Open decisions 2'], ['waiting', 'Waiting 1'], ['fog', 'Fog 2'],
  ]);
  const entries = (key: string) => [...dossier().querySelector(`[data-attention-row="${key}"] dd`)!.children].map(text);
  expect(entries('decisions')).toEqual(['#202 Sign-in screenPrototype · Needs you', '#201 Relay: broker only or full TURN?Grill · Shaping']);
  expect(entries('waiting')).toEqual(['#140 Owner accountswaits on #202']);
  expect(entries('fog'), "the map's fog questions").toEqual(c200.map!.fog);
  await press(button(dossier().querySelector('[data-attention-row="you"]')!, '#202 Sign-in screen'));
  expect(dialogTitle(), 'a part opens its item').toBe('#202 Sign-in screen');
  await press($('[data-item-dialog] [aria-label="Close"]')!);
  await press(button(dossier().querySelector('[data-attention-row="fog"]')!, '#201'));
  expect(dialogTitle(), "a fog question's #n opens its item").toBe(`#201 ${sample.items.find((i) => i.number === 201)!.title}`);
  await press($('[data-item-dialog] [aria-label="Close"]')!);
  await openInstead(C180);
  expect([dossier(C180).querySelector('[data-attention]'), text(dossier(C180).querySelector('[data-attention-none]'))], 'no rows when nothing has entries')
    .toEqual([null, 'Nothing holds this up.']);
});

test('a part at Verify or Ready to merge counts as moving while its build thread runs, and back on your desk when it stops', async () => {
  const build = { id: 'build', title: 'Build', purpose: 'build', state: 'running', currentRunning: true, updated: '2026-10-21T09:00:00.000Z' } as ItemThread;
  const fresh = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
  const clear = withItem('I_sample12', { status: 'Done' }, withItem('I_sample10', { status: 'Done' }, fresh));
  await mountOpen(withItem('I_sample13', { status: 'Ready to merge', blockers: [], threads: [build] }, clear));
  expect(dossier().querySelector('[data-attention-row="verify"]')).toBeNull();
  expect(text(next())).toBe('Moving#140 Owner accounts');
  const part = text(step('I_sample13'));
  expect([part.includes('Working'), part.includes('Ready to merge'), text(step('I_sample13').querySelector('[data-open-thread]'))]).toEqual([true, false, 'Open thread']);
  await receive(withItem('I_sample13', { status: 'Ready to merge', blockers: [], threads: [{ ...build, id: 'shape', title: 'Shape', purpose: 'shape', state: 'done', currentRunning: undefined }, { ...build, state: 'done', currentRunning: undefined, hasRunningChildren: true }] }, clear));
  expect(text(step('I_sample13')), 'it names the running build thread, not the newest one').toContain('T3 · Build· running');
  await receive(withItem('I_sample13', { status: 'Ready to merge', blockers: [], slices: [], threads: [{ ...build, state: 'done', currentRunning: undefined }] }, clear));
  expect(text(next())).toBe('To merge#140 Owner accounts');
  expect(text(step('I_sample13'))).toContain('Ready to merge');
});

test('a decision part and a work map node name the running build thread and say Working', async () => {
  const build = { id: 'build', title: 'Build', purpose: 'build', state: 'done', hasRunningChildren: true, updated: '2026-10-21T09:00:00.000Z' } as ItemThread;
  const shape = { ...build, id: 'shape', title: 'Shape', purpose: 'shape', hasRunningChildren: undefined };
  const data = withItem('I_sample10', { status: 'Verify', threads: [shape, build] }, { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() });
  await mountOpen(data);
  expect(text(dossier().querySelector('[data-attention-row="decisions"]'))).toContain('· Working');
  await press(button(dossier(), 'Work map'));
  const node = text(dossier().querySelector('[data-map-part="I_sample10"]'));
  expect([node.includes('Working · child work running'), node.includes('Verify')]).toEqual([true, false]);
});

test('parts in Verify or Ready to merge get their own row after Needs you, which with the chip counts only Needs you', async () => {
  await mountOpen(withItem('I_sample10', { status: 'Verify' }, withItem('I_sample13', { status: 'Ready to merge', blockers: [] })));
  const rows = [...dossier().querySelectorAll<HTMLElement>('[data-attention-row]')].map((r) => text(r.firstElementChild));
  expect(rows.slice(0, 2)).toEqual(['Needs you 1', 'To verify or merge 2']);
  expect(chips()).toContain('1 need you');
  expect(text(next()), "what's next names the part in Needs you first").toBe('Needs you#202 Sign-in screen');
  await receive(withItem('I_sample12', { status: 'Verify' }, withItem('I_sample10', { status: 'Verify' }, withItem('I_sample13', { status: 'Ready to merge', blockers: [] }))));
  expect([chips(), text(next())], 'with none in Needs you, no need-you chip and no Needs you wording').toEqual([['2 decisions'], 'To verify#202 Sign-in screen']);
  await receive(withItem('I_sample12', { status: 'Done' }, withItem('I_sample10', { status: 'Done' }, withItem('I_sample13', { status: 'Ready to merge', blockers: [] }))));
  expect(text(next()), 'a part ready to merge is named to merge').toBe('To merge#140 Owner accounts');
  await receive(withItem('I_sample10', { status: 'Verify' }, withItem('I_sample13', { status: 'Ready to merge', blockers: [] })));
  const verify = dossier().querySelector('[data-attention-row="verify"]')!;
  expect([verify.firstElementChild!.className.split(' '), dossier().querySelector('[data-attention]')!.className.split(' ')], 'its long label never wraps: the labels\' column grows past 7.5rem to fit it')
    .toEqual([expect.arrayContaining(['whitespace-nowrap']), expect.arrayContaining(['grid-cols-[minmax(7.5rem,max-content)_minmax(0,1fr)]'])]);
  expect([...verify.lastElementChild!.children].map(text)).toEqual(['#140 Owner accountsReady to merge', '#201 Relay: broker only or full TURN?Verify']);
  await press(button(verify, '#140 Owner accounts'));
  expect(dialogTitle()).toBe('#140 Owner accounts');
});

test('blocked slices name the part they belong to and what they wait on', async () => {
  const s13 = sample.items.find((i) => i.id === 'I_sample13')!;
  await mountOpen(withItem('I_sample13', { slices: s13.slices.map((x, n) => (n === 0 ? { ...x, progress: 'blocked' as const } : x)) }));
  const blocked = dossier().querySelector('[data-attention-row="blocked"]')!;
  expect([text(blocked.firstElementChild), [...blocked.lastElementChild!.children].map(text)])
    .toEqual(['Blocked slices 1', [`#${s13.slices[0]!.number} ${s13.slices[0]!.title}slice of #140 · waits on a re-slice`]]);
  await press(button(blocked, '#140'));
  expect(dialogTitle()).toBe('#140 Owner accounts');
});

test('a part with nothing to wait on is ready to start, with its Start', async () => {
  holdPosts(unblocked());
  await mountOpen(unblocked());
  const ready = dossier().querySelector('[data-attention-row="ready"]')!;
  expect([text(ready.firstElementChild), text(ready.querySelector('dd > div > span'))]).toEqual(['Ready to start 1', '#140 Owner accounts']);
  expect(dossier().querySelector('[data-attention-row="waiting"]'), 'nothing waits').toBeNull();
  await pressMenu(startIn(ready)!);
  expect(dialogTitle(), 'Start opens its menu, not the dialog').toBe('');
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
});

test('the Ready to start row and the header agree on what can start: a Queued decision can, a part with a live thread cannot', async () => {
  const data = withItem('I_sample12', { status: 'Shaping', threads: [thread('shaping', 'running')] }, withDecision());
  await mountOpen(data);
  const ready = () => dossier().querySelector('[data-attention-row="ready"]');
  expect([text(ready()!.firstElementChild), text(startIn(col('side')))]).toEqual(['Ready to start 1', 'Start ▾']);
  await receive(withItem('I_d204', { threads: [thread('t1', 'running')] }, data));
  expect([ready(), startIn(col('side'))], 'a live thread').toEqual([null, null]);
});

test('a dossier opens on its Work map, and the browser remembers a switch to the parts list for that dossier alone', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  for (const id of [C200, C180]) localStorage.removeItem(VIEW_KEY + id);
  await mountOpen();
  expect([button(dossier(), 'Work map').getAttribute('aria-pressed'), dossier().querySelector('[data-work-map]') !== null]).toEqual(['true', true]);
  await press(button(dossier(), 'Parts list'));
  expect([dossier().querySelector('[data-work-map]'), dossier().querySelector('[data-parts-list]') !== null, localStorage.getItem(VIEW_KEY + C200)]).toEqual([null, true, 'list']);
  vi.resetModules();
  await mountOpen();
  expect(button(dossier(), 'Parts list').getAttribute('aria-pressed'), 'it stays on the parts list').toBe('true');
  await openInstead(C180);
  expect(button(dossier(C180), 'Work map').getAttribute('aria-pressed'), 'the other dossier stays on its Work map').toBe('true');
});

test('the parts list holds the open parts in dependency order, two columns where there is room, the done ones behind Show N done', async () => {
  await mountOpen();
  expect(listed()).toEqual(['I_sample12', 'I_sample10', 'I_sample13']);
  expect(dossier().querySelector('[data-parts-list]')!.className.split(' ')).toContain('@4xl:grid-cols-2');
  const fold = button(dossier(), 'Show 1 done');
  await press(fold);
  expect([text(fold), fold.getAttribute('aria-expanded'), listed().length]).toEqual(['Hide 1 done', 'true', 4]);
  await openInstead(C180);
  expect(listed(C180), 'all done').toEqual([]);
  await press(button(dossier(C180), 'Show 2 done'));
  expect(listed(C180).length).toBe(2);
});

test('the open body has no Check phase, progress rows or stage header; the Work map keeps the end-to-end check', async () => {
  await mountOpen();
  expect(text(dossier())).not.toContain('Run end-to-end');
  expect(text(dossier())).not.toContain('Progress · ');
  expect(dossier().querySelectorAll('[data-item]').length, "only the header's").toBe(1);
});

test("a part's archived thread reads as archived, not as its last state", async () => {
await mountOpen(withItem('I_sample10', { threads: [{ ...thread('put-away', 'done'), archived: true }] }));
  expect(text(step('I_sample10').querySelector('[data-part-meta]'))).toContain('T3 · Thread put-away· archived');
});

test('each part shows what it asks next, then its stage track, status, figures and thread, and its slice bar', async () => {
  await mountOpen(withItem('I_sample13', { azure: { type: 'Feature', state: 'Active', assignee: 'Ana' },
    linkedPrs: [{ ...sample.items.flatMap((i) => i.linkedPrs)[0]!, number: 145, state: 'open', isDraft: false }] }));
  const lines = (id: string) => [step(id).querySelector('[data-row-open] > :first-child'), step(id).querySelector('[data-part-meta]'), step(id).children[1]].map(text);
  expect(lines('I_sample10')).toEqual(['#201 Relay: broker only or full TURN?', 'GrillShaping28m · 1.87M · $2.71T3 · Grill: relay broker only or full TURN· running', 'Open thread']);
  expect(lines('I_sample12')).toEqual(['#202 Sign-in screen', 'PrototypeNeeds you41m · 2.95M · $4.35T3 · Prototype: sign-in screen· needs you', 'on your desk']);
  expect(lines('I_sample13')).toEqual(['#140 Owner accounts', 'BuildReadyFeature · Active · AnaPR #145T3 · Shape: owner accounts· done', '1/3Start after #202 ▾']);
  expect(step('I_sample13').querySelector('[data-row-open] :is(button, a)'), 'the action is no part of the button that opens details').toBeNull();
  expect(step('I_sample13').querySelector('[data-part-meta] ol')!.getAttribute('title'), "the stage track, dashed while it waits").toBe('Ready, waiting');
  expect(step('I_sample10').querySelector('[data-part-meta] ol')!.getAttribute('title')).toBe('Shaping');
  expect(step('I_sample13').querySelector('[data-row-open] > :last-child ol'), 'its slice bar under the row').not.toBeNull();
  await press(step('I_sample10').querySelector('[data-row-open]')!);
  expect(dialogTitle(), 'a part opens its item').toBe('#201 Relay: broker only or full TURN?');
});

test('a part waiting on another, with no Start of its own, says what it waits on', async () => {
  await mountOpen(withItem('I_sample10', { threads: [], blockers: [{ number: 140, repo: 'maddec01/lar-server', state: 'open' }] }));
  expect(text(step('I_sample10').children[1])).toBe('waits on #140');
  expect(step('I_sample10').children[1]!.querySelector('[title]')?.className).toContain('truncate');
  expect([...step('I_sample10').children[1]!.querySelectorAll('button, svg')], 'plain text: no chip, no status icon').toEqual([]);
  const side = dossier().querySelector('[data-attention-row="waiting"] dd > div > span:last-child')!;
  expect([text(side), side.children.length], 'the Waiting row says it the same way').toEqual(['waits on #202', 0]);
});

test('a part with no thread yet says what it is waiting on', async () => {
  await mountOpen(withItem('I_sample13', { threads: [] }));
  expect(text(step('I_sample13').querySelector('[data-part-meta]')!.lastElementChild)).toBe('Waiting on #202');
});

test('a part held by a Dependency says what it is waiting on', async () => {
  const dependency: DependencyHold = { dependencyId: 'dep-1', revision: 1, owner: 'server team', need: 'An export endpoint', ticket: null, named: [], evidence: '',
    met: null, needsReview: false, observation: null };
  await mountOpen(withItem('I_sample13', { threads: [], blockers: [{ number: 202, repo: 'maddec01/lar-server', state: 'open' },
    { number: 0, repo: 'server team', state: 'open', title: dependency.need, dependency }] }));
  expect(text(step('I_sample13').querySelector('[data-part-meta]')!.lastElementChild))
    .toBe('Waiting on #202 and you to mark the Dependency on server team met');
});

test('a Ready part with completed prerequisites offers Start without blocking wording', async () => {
  await mountOpen(unblocked());
  const part = step('I_sample13');
  expect(text(startIn(part))).toBe('Start ▾');
  expect(text(part)).not.toContain('waits on');
});

test('a blocked build shows only Start after, a Start, in place of Start build', async () => {
  await mountOpen();
  expect(startIn(step('I_sample13'))).toBeNull();
  const after = step('I_sample13').querySelector<HTMLElement>('[data-start-after]')!;
  expect([text(after), after.dataset.kind]).toEqual(['Start after #202 ▾', 'start']);
  expect(text(next()), 'the header offers no start while a part waits on you').toBe('Needs you#202 Sign-in screen');
});

test('once its blockers complete, Start build sends the build, and the header offers it too', async () => {
  holdPosts(unblocked());
  await mountOpen(withItem('I_sample12', { status: 'Shaping', threads: [thread('shaping', 'running')] }, unblocked()));
  expect(text(startIn(col('side')))).toBe('Start ▾');
  expect(next().querySelector('.sr-only')?.textContent, 'Next reads to a screen reader and leaves its room to the title').toBe('Next');
  await pressMenu(startIn(step('I_sample13'))!);
  expect(dialogTitle(), 'the menu opens without the dialog').toBe('');
  await press(entries()[1]!);
  expect(posted()).toEqual([['/api/start-build', { drift: 'keep', session: 's1', itemId: 'I_sample13', model: { instanceId: 'codex', model: 'gpt-5.5' } }]]);
  await answer({ thread: null, error: 'T3 is down.' }, 502);
  expect(text(dossier().querySelector('p.start [role="alert"]')), 'its error shows under its row').toBe('T3 is down.');
});

/** #140, Ready, also carrying Verify. */
test("Start on a Queued decision is today's Start", async () => {
  holdPosts(withDecision());
await mountOpen(withDecision());
  expect(text(step('I_d204').children[1])).toBe('Start ▾');
  await pressMenu(startIn(step('I_d204'))!);
  await press(entries()[0]!);
  expect(posted()).toEqual([['/api/start', { session: 's1', itemId: 'I_d204' }]]);
});

test('a Queued decision shows only Start after while a blocker is open, naming the last open one', async () => {
  const data = withDecision([{ number: 201, repo: 'maddec01/lar-server', state: 'open' }, { number: 203, repo: 'maddec01/lar-server', state: 'closed' },
    { number: 140, repo: 'maddec01/lar-server', state: 'open' }]);
  holdPosts(data);
  await mountOpen(data);
  expect(startIn(step('I_d204'))).toBeNull();
  const after = step('I_d204').querySelector<HTMLButtonElement>('[data-start-after]')!;
  expect([text(after), after.title]).toEqual(['Start after #140 ▾', 'Pick a model to start it once #201, #140 complete']);
  await pressMenu(after);
  await press(entries()[0]!);
  expect(posted(), 'T3 default arms it with no model').toEqual([['/api/arm', { session: 's1', itemId: 'I_d204' }]]);
  await answer({ error: null, board: { ...data, armed: { I_d204: {} } } });
  expect(text(step('I_d204').querySelector('[data-start-after]'))).toBe('Starts after #140 ✓');
});

test('the map names unfinished dependencies without promising an automatic start', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen(withItem('I_sample10', { blockers: [{ number: 203, repo: 'maddec01/lar-server', state: 'open' }] }));
  await press(button(dossier(), 'Work map'));
  expect(text(dossier().querySelector('[data-map-part="I_sample10"]'))).toContain('Waiting on #203');
});

test("in the map, a part waiting on another repository's issue names it without its owner", async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen(withItem('I_sample10', { blockers: [{ number: 12, repo: 'maddec01/lar-apple', state: 'open' }] }));
  await press(button(dossier(), 'Work map'));
  expect(text(dossier().querySelector('[data-map-part="I_sample10"]'))).toContain('Waiting on lar-apple#12');
});

test('Open thread takes Start\'s place while a part has a live thread', async () => {
  const data = withDecision();
  await mountOpen(withItem('I_d204', { threads: [thread('t1', 'running')] }, data));
  expect(startIn(step('I_d204'))).toBeNull();
  expect(step('I_d204').querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/t1');
});

test('a map with no End-to-end check draws no check and no placeholder for one', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const { check: _, ...map } = c200.map!;
  await mountOpen(withItem(C200, { map }));
  await press(button(dossier(), 'Work map'));
  expect(dossier().querySelector('[data-map-check]')).toBeNull();
  expect(text(dossier().querySelector('[data-work-map]'))).not.toContain('end-to-end');
  expect(dossier().querySelector('path[data-edge$=" e2e"]')).toBeNull();
});

test('neither the parts list nor the Work map lanes draw a coloured repository dot', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen();
  await press(button(dossier(), 'Show 1 done'));
  expect([listed().length, dossier().querySelector('[class*="repo-tone"]:not([data-project-icon])')]).toEqual([4, null]);
  await press(button(dossier(), 'Work map'));
  expect([dossier().querySelectorAll('[data-work-map] .sticky').length, dossier().querySelector('[class*="repo-tone"]:not([data-project-icon])')]).toEqual([2, null]);
});

test('the Map view draws Decisions and Builds lanes, its current parts in order, and arrows for what waits on what', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen();
  const toggle = button(dossier(), 'Work map');
  await press(toggle);
  expect([toggle.getAttribute('aria-pressed'), button(dossier(), 'Parts list').getAttribute('aria-pressed')]).toEqual(['true', 'false']);
  const map = dossier().querySelector('[data-work-map]')!;
  expect(dossier().querySelector('[data-parts-list]'), "the map takes the parts list's place").toBeNull();
  expect([...map.querySelectorAll('.sticky')].map(text), "the concept's own repository goes unnamed").toEqual(['Decisions', 'Builds']);
  expect([...map.querySelectorAll('[data-map-part]')].map((n) => n.getAttribute('data-map-part')), 'current work only, the question first').toEqual(['I_sample12', 'I_sample10', 'I_sample13']);
  expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge'))).toEqual([
    'history I_sample10', 'I_sample12 I_sample13', 'I_sample13 e2e',
  ]);
  expect(text(map.querySelector('[data-map-check]'))).toBe('end-to-end checkSign in on the website, then stream from a phone off Wi-Fi3 steps · after #140');
  const node = (id: string) => map.querySelector(`[data-map-part="${id}"]`)!;
  expect(startIn(node('I_sample13')), 'a blocked part offers Start after alone').toBeNull();
  expect(text(node('I_sample13').querySelector('[data-start-after]')), 'the state line names what it waits on').toBe('Start after ▾');
  expect(node('I_sample13').querySelector('[data-start-after]')!.getAttribute('aria-label')).toBe('Start #140 Owner accounts after #202');
  expect(text(node('I_sample12').querySelector('[data-open-thread]'))).toBe('Answer in T3');
  await press(node('I_sample10').querySelector('button')!);
  expect(dialogTitle()).toBe('#201 Relay: broker only or full TURN?');
});

test('an item with sub-issues on the board is coupled work, its parts from its children', async () => {
  const parent = rawIssue('I_parent', 100, 'In progress', ['build'], {
    subIssuesSummary: { total: 3, completed: 0 },
    subIssues: { nodes: [sliceRef(101, 'OPEN'), sliceRef(102, 'OPEN'), sliceRef(103, 'OPEN')] },
  });
  const child = rawIssue('I_102', 102, 'In progress', ['build'], {
    parent: { number: 100, title: 'Issue 100', url: 'https://github.com/maddec01/lar-factory/issues/100', state: 'OPEN', repository: { nameWithOwner: 'maddec01/lar-factory' } },
  });
await mountOpen({ ...sample, error: null, items: recorded(normalizeItems([parent, child], { builds: new Set(['maddec01/lar-factory#102', 'maddec01/lar-factory#103']) })) }, 'I_100');
  expect(text(header('I_100').querySelector('[data-kind]'))).toBe('Coupled work');
  expect(text(col('count', 'I_100'))).toBe('0/2');
  expect(text(next('I_100'))).toBe('Moving#102 Issue 102');
  expect(listed('I_100'), 'its build sub-issue is a part; its slice is not').toEqual(['I_102']);
  expect($$('[data-part="I_102"]'), 'one row in its dossier').toHaveLength(1);
});

test('the dossiers take the main area\'s scope', async () => {
  await mountPage();
  const { useScopeStore } = await import('../board/scope-store.ts');
  await settle(() => useScopeStore.getState().setScope('maddec01/lar-apple'));
  expect($$('[data-dossier]').map((d) => d.getAttribute('data-dossier')), '#180 through its Apple build').toEqual([C180]);
});

test('the parts list keeps cross-repository dependency order even when builds return to a repository', async () => {
  const first = { ...sample.items.find((i) => i.id === 'I_sample24')!, state: 'open' as const, status: 'Ready' as const, blockers: [] };
  const second = { ...sample.items.find((i) => i.id === 'I_sample25')!, state: 'open' as const, status: 'Ready' as const };
  const last: Item = { ...first, id: 'I_last', number: 999, title: 'Finish in the server', blockers: [{ repo: second.repo!, number: second.number!, state: 'open' }] };
  await mountOpen({ ...sample, items: [...sample.items.filter((i) => ![first.id, second.id].includes(i.id)), last, second, first] }, C180);
  expect([...dossier(C180).querySelectorAll('[data-parts-list] [data-part]')].map((p) => p.getAttribute('data-part'))).toEqual([first.id, second.id, last.id]);
});

test('the parts list keeps a build before a research decision blocked by that build', async () => {
  const build = { ...sample.items.find((i) => i.id === 'I_sample13')!, blockers: [] };
  const research = { ...decision([{ repo: build.repo!, number: build.number!, state: 'open' }]), labels: ['decision-research'] };
  await mountOpen({ ...sample, items: [c200, research, build] });
  expect([...dossier().querySelectorAll('[data-parts-list] [data-part]')].map((p) => p.getAttribute('data-part'))).toEqual([build.id, research.id]);
});

test("a concept map's Dependencies show as a Dependencies row, after what waits and before the fog", async () => {
  const dependencies = ['A resume endpoint, from team/relay, blocks #140'];
  await mountOpen(withItem(C200, { map: { ...c200.map!, dependencies } }));
  const rows = [...dossier().querySelectorAll<HTMLElement>('[data-attention-row]')].map((r) => r.dataset.attentionRow);
  expect(rows).toEqual(['you', 'decisions', 'waiting', 'dependencies', 'fog']);
  const row = dossier().querySelector('[data-attention-row="dependencies"]')!;
  expect([text(row.firstElementChild), [...row.querySelector('dd')!.children].map(text)]).toEqual(['Dependencies 1', dependencies]);
  await press(button(row, '#140'));
  expect(dialogTitle(), "a Dependency's #n opens its item").toBe(`#140 ${sample.items.find((i) => i.number === 140)!.title}`);
});

test('a concept with no map has no fog row', async () => {
  const concept = rawIssue('I_concept', 700, 'Shaping', ['concept'], { body: 'A concept written as ordinary prose.' });
  await mountOpen({ ...sample, items: normalizeItems([concept]) }, 'I_700');
  expect([dossier('I_700').querySelector('[data-attention]'), dossier('I_700').querySelector('[data-about]')]).toEqual([null, null]);
});

test('unlabelled local decision parts show the decision lane and completed answer facts without changing their Status',async()=>{
  vi.stubGlobal('ResizeObserver',class{observe(){}disconnect(){}});
  const complete:Item={...sample.items.find(item=>item.id==='I_sample10')!,recorded:true,kind:'decision',labels:[],status:'Shaping',completion:{complete:true,reasons:[]},threads:undefined};
  const pending:Item={...sample.items.find(item=>item.id==='I_sample12')!,recorded:true,kind:'decision',labels:[],status:'Shaping',completion:{complete:false,reasons:['No answer.']},threads:undefined};
  const parent:Item={...c200,subIssues:{total:2,completed:1}};
  await mountOpen({...sample,items:[parent,complete,pending]});
  expect(text(col('count'))).toBe('1/2');
  await press(button(dossier(),'Work map'));
  const map=dossier().querySelector('[data-work-map]')!;
  expect([...map.querySelectorAll('.sticky')].map(text)).toEqual(['Decisions']);
  expect(map.querySelector(`[data-map-part="${complete.id}"]`),'folded into history').toBeNull();
  await press(map.querySelector('[data-map-history]')!);
  const doneNode=map.querySelector(`[data-history-part="${complete.id}"]`)!;
  const pendingNode=map.querySelector(`[data-map-part="${pending.id}"]`)!;
  expect(text(doneNode)).toContain('No method');expect(text(doneNode)).not.toContain('Shaping');expect(text(doneNode)).not.toContain('build');
  expect(text(pendingNode)).toContain('No method');expect(text(pendingNode)).toContain('Shaping');
  expect(complete.status).toBe('Shaping');expect(pending.status).toBe('Shaping');
});

test('a concept question takes priority over its parts and appears in Attention', async () => {
  await mountOpen(withItem(C200, { status: 'In progress', threads: [thread('own-question', 'needs you')] }));
  expect(text(next())).toContain(c200.title);
  expect(text(next())).toContain('Needs you');
  expect(text(dossier())).not.toContain('Nothing holds this up');
  expect(dossier().querySelector('a[href="t3code://threads/sample-environment/own-question"]')).not.toBeNull();
});

test('Needs you beside a badge that says it reads only to a screen reader, and shows when no badge says it', async () => {
  await mountPage();
  expect([chips(), next().querySelector('.sr-only')?.textContent], 'the badge says it').toEqual([['1 need you'], 'Needs you']);
  expect(text(next())).toBe('Needs you#202 Sign-in screen');
  await receive(withItem(C200, { status: 'In progress', threads: [thread('own-question', 'needs you')] }, calm({})));
  expect(chips(), 'the concept itself asks, and no part does').not.toContain('1 need you');
  expect(text(next())).toContain('Needs you');
  expect(next().querySelector('.sr-only'), 'no badge says it').toBeNull();
});

test('a shaping part with a question leads moving parts in the dossier', async () => {
  await mountOpen(withItem('I_sample12', { status: 'Shaping', threads: [thread('part-question', 'needs you')] }));
  expect(text(next())).toContain('Needs you');
  expect(chips()).toContain('1 need you');
  expect(dossier().querySelector('a[href="t3code://threads/sample-environment/part-question"]')).not.toBeNull();
});

/** #200 on its Work map with `parts` as its parts, in place of the sample's. */
const conceptOf = (parts: Item[], change: Partial<Item> = {}): BoardData => ({
  ...sample, error: null, fetchedAt: new Date(NOW).toISOString(),
  items: [{ ...c200, ...change }, ...parts.map((p) => ({ ...p, parent: { number: 200, repo: c200.repo!, title: c200.title, url: c200.url!, state: 'open' as const }, parentId: c200.id }))],
});
const base = sample.items.find((i) => i.id === 'I_sample13')!;
const workPart = (id: string, change: Partial<Item> = {}): Item => ({ ...base, id, number: 0, title: `Part ${id}`, recorded: true, kind: 'build', labels: [], blockers: [], slices: [], threads: [], linkedPrs: [], ...change });
const settledPart = (id: string, method: 'grill' | 'prototype' | 'research' | 'task', change: Partial<Item> = {}): Item =>
  workPart(id, { kind: 'decision', decisionMethod: method, status: 'Done', completion: { complete: true, reasons: [] }, ...change });
const mapOpen = async (data: BoardData) => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  localStorage.setItem(VIEW_KEY + C200, 'map');
  await mountOpen(data);
  return dossier().querySelector<HTMLElement>('[data-work-map]')!;
};
const fiveSettled = (['grill', 'prototype', 'research', 'task', 'grill'] as const).map((method, n) => settledPart(`W_s${n}`, method));

test('5 settled decisions fold into one group, and a running build leads a map short enough to need no scrolling', async () => {
  const running = workPart('W_build', { status: 'In progress', threads: [{ id: 'b', title: 'Build', state: 'running', currentRunning: true, purpose: 'build', updated: '2026-10-21T09:00:00.000Z' }] });
  const map = await mapOpen(conceptOf([...fiveSettled, running]));
  expect([...map.querySelectorAll('[data-map-part]')].map((n) => n.getAttribute('data-map-part'))).toEqual(['W_build']);
  const canvas = map.querySelector<HTMLElement>('[data-map-canvas]')!;
  const y = (el: HTMLElement) => parseInt(el.style.top, 10);
  expect(parseInt(canvas.style.height, 10), 'one lane and the group').toBeLessThanOrEqual(200);
  const group = map.querySelector<HTMLElement>('[data-map-history]')!;
  expect(y(group), 'the group sits below current work').toBeGreaterThan(y(map.querySelector<HTMLElement>('[data-map-part="W_build"]')!.parentElement!));
  expect([text(group), group.getAttribute('aria-expanded')]).toEqual(['5 settled decisionsShow', 'false']);
  expect(map.querySelector('[data-map-history-parts]')).toBeNull();
});

test('expanding the history group lists each settled part with its method; collapsing folds it again', async () => {
  const map = await mapOpen(conceptOf([...fiveSettled, settledPart('W_merged', 'task', { kind: 'build', decisionMethod: undefined })]));
  const group = map.querySelector<HTMLElement>('[data-map-history]')!;
  expect(text(group)).toBe('5 settled decisions · 1 finished buildShow');
  await press(group);
  const rows = [...map.querySelectorAll<HTMLElement>('[data-history-part]')];
  expect(rows.map(text)).toEqual(['ResearchPart W_s2', 'GrillPart W_s0', 'GrillPart W_s4', 'PrototypePart W_s1', 'TaskPart W_s3', 'BuildPart W_merged']);
  await press(button(rows[1]!, 'Part W_s0'));
  expect(dialogTitle()).toBe('Part W_s0');
  await press($('[data-item-dialog] [aria-label="Close"]')!);
  await press(group);
  expect(map.querySelector('[data-history-part]')).toBeNull();
});

test('a part waiting on a settled decision in the group keeps its edge, from the group, with its label', async () => {
  const held = workPart('W_next', { status: 'In progress', blockers: [{ number: 0, repo: c200.repo!, state: 'closed', workId: 'W_s0', title: 'x' }, { number: 0, repo: c200.repo!, state: 'closed', workId: 'W_s1', title: 'y' }] });
  const later = workPart('W_later', { status: 'Ready', blockers: [{ number: 0, repo: c200.repo!, state: 'open', workId: 'W_next' }] });
  const map = await mapOpen(conceptOf([...fiveSettled, held, later], { map: { ...c200.map!, check: undefined } }));
  expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge'))).toEqual(['history W_next', 'W_next W_later']);
  const label = () => map.querySelector<HTMLElement>('[data-edge-label="history W_next"]')!;
  expect([text(label()), label().tagName, label().getAttribute('aria-label')]).toEqual(['2 completed prerequisites', 'BUTTON', '2 completed prerequisites: Part W_s0, Part W_s1']);
  await press(map.querySelector('[data-map-history]')!);
  expect(map.querySelector('path[data-edge="history W_next"]'), 'expanding leaves the edge').not.toBeNull();
  await receive(conceptOf([...fiveSettled, { ...held, status: 'Done', completion: { complete: true, reasons: [] } }, later], { map: { ...c200.map!, check: undefined } }));
  expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge')), 'a board push moves it into the group').toEqual(['history W_later']);
  const single = map.querySelector('[data-edge-label="history W_later"]')!;
  expect([text(single), single.getAttribute('aria-label')]).toEqual(['1 completed prerequisite', '1 completed prerequisite: Part W_next']);
});

test('a part a finished part waited on keeps its edge into the group', async () => {
  const open = workPart('W_open', { status: 'In progress' });
  const map = await mapOpen(conceptOf([open, settledPart('W_done', 'task', { blockers: [{ number: 0, repo: c200.repo!, state: 'open', workId: 'W_open' }] })], { map: { ...c200.map!, check: undefined } }));
  expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge'))).toEqual(['W_open history']);
  const label = map.querySelector('[data-edge-label="W_open history"]')!;
  expect([text(label), label.getAttribute('aria-label')]).toEqual(['before 1 completed part', 'before 1 completed part: Part W_done']);
});

test('an edge label counts each finished blocker once, names them on focus, and shows them in history when pressed; an open blocker stays named', async () => {
  const closed = (workId: string) => ({ number: 0, repo: c200.repo!, state: 'closed' as const, workId, title: workId });
  const held = workPart('W_next', { status: 'Ready', blockers: [closed('W_s0'), closed('W_s0'), closed('W_s1'), { number: 0, repo: c200.repo!, state: 'open', workId: 'W_open', title: 'Part W_open' }] });
  const map = await mapOpen(conceptOf([...fiveSettled, workPart('W_open', { status: 'In progress' }), held], { map: { ...c200.map!, check: undefined } }));
  const label = map.querySelector<HTMLElement>('[data-edge-label="history W_next"]')!;
  expect(text(label), 'the same part listed twice counts once').toBe('2 completed prerequisites');
  expect([...map.querySelectorAll('path[data-edge]')].map((p) => p.getAttribute('data-edge')).sort()).toEqual(['W_open W_next', 'history W_next']);
  expect(text(map.querySelector('[data-map-part="W_next"] [data-map-facts]'))).toBe('Ready · Waiting on Part W_open');
  await settle(() => label.focus());
  await settle(() => vi.advanceTimersByTime(1000));
  expect(text(document.querySelector('[role="tooltip"]')), 'focus shows the names').toBe('Part W_s0, Part W_s1');
  expect(map.querySelector('[data-history-part]')).toBeNull();
  await press(label);
  expect(map.querySelector('[data-history-part="W_s0"]')).not.toBeNull();
  expect(map.querySelector('path[data-edge="history W_next"]'), 'expanding leaves the edge').not.toBeNull();
});

test('a node holds one waiting reason, on a state line that shares no width with its action', async () => {
  const blockers = [{ number: 201, repo: c200.repo!, state: 'open' as const }, { number: 140, repo: c200.repo!, state: 'open' as const }];
  const running: ItemThread = { id: 'r', title: 'R', state: 'running', updated: '2026-10-21T09:00:00.000Z' };
  const map = await mapOpen(writable(conceptOf([
    workPart('W_both', { number: 77, status: 'Ready', blockers, slices: [{ ...base.slices[0]!, progress: 'active' }] }),
    workPart('W_kids', { status: 'In progress', threads: [{ ...running, state: 'done', hasLiveChildren: true }], slices: [{ ...base.slices[0]!, progress: 'blocked' }] }),
    workPart('W_q', { status: 'Shaping', blockers, threads: [{ ...running, state: 'needs you' }] }),
  ])));
  const node = (id: string) => map.querySelector<HTMLElement>(`[data-map-part="${id}"]`)!;
  const facts = (id: string) => node(id).querySelector<HTMLElement>('[data-map-facts]')!;
  expect(text(facts('W_both')), 'both blockers, once, and nothing competing with them').toBe('Ready · Waiting on #201, #140');
  expect(text(node('W_both').querySelector('[data-start-after]'))).toBe('Start after ▾');
  expect(facts('W_both').parentElement!.querySelector('button, a'), 'the action sits on another line').toBeNull();
  expect(node('W_both').querySelector('[data-map-head] [data-start-after]')).not.toBeNull();
  expect(text(facts('W_kids')), 'a blocked slice, not also a waiting child').toBe('In progress · 1 slice blocked');
  expect(text(facts('W_q')), 'a question is the reason while one is open').toBe('Shaping · Needs you');
  expect(node('W_q').querySelector('[data-map-head] [data-open-thread]')).not.toBeNull();
  expect(node('W_both').querySelector('button')!.title, 'the whole line reads on hover, whatever it cuts off').toBe('#77 Part W_both · Ready · Waiting on #201, #140');
});

test('a build whose planner ended while its child and background work run reads as working, never as done', async () => {
  const planner: ItemThread = { id: 'plan', title: 'Plan', state: 'done', purpose: 'build', hasRunningChildren: true, updated: '2026-10-21T09:00:00.000Z' };
  const newest: ItemThread = { id: 'newer', title: 'Later', state: 'done', updated: '2026-10-21T10:00:00.000Z' };
  const build = workPart('W_build', { status: 'In progress', buildPhase: 'plan', threads: [newest, planner] });
  const map = await mapOpen(conceptOf([build]));
  const node = map.querySelector('[data-map-part="W_build"]')!;
  expect(text(node.querySelector('[data-map-facts]'))).toBe('Planning · child work running');
  expect(node.querySelector('[data-open-thread]')!.getAttribute('href')).toBe('t3code://threads/sample-environment/plan');
  expect(header().getAttribute('title'), 'the header counts it as running').toContain('1 running');
  await receive(conceptOf([{ ...build, threads: [newest, { ...planner, hasRunningChildren: undefined }] }]));
  expect(text(map.querySelector('[data-map-part="W_build"] [data-map-facts]')), 'once it all ends, it says so').toBe('In progress · Run finished');
});

test('a finished part with work still running stays with current work', async () => {
  const map = await mapOpen(conceptOf([settledPart('W_d', 'research', { threads: [{ id: 'd', title: 'D', state: 'done', hasRunningChildren: true, updated: '2026-10-21T09:00:00.000Z' }] })]));
  expect(map.querySelector('[data-map-history]')).toBeNull();
  expect(text(map.querySelector('[data-map-part="W_d"] [data-map-facts]'))).toContain('Complete · Working');
});

test('a status never repeats as its activity, and a part with no thread says nothing about one', async () => {
  const asks: ItemThread = { id: 'q', title: 'Q', state: 'needs you', updated: '2026-10-21T09:00:00.000Z' };
  const map = await mapOpen(conceptOf([workPart('W_q', { status: 'Needs you', threads: [asks] }), workPart('W_none', { status: 'Shaping' })]));
  expect(text(map.querySelector('[data-map-part="W_q"] [data-map-facts]'))).toBe('Needs you');
  expect(text(map.querySelector('[data-map-part="W_none"] [data-map-facts]'))).toBe('Shaping');
  await receive(conceptOf([workPart('W_q', { status: 'In progress', threads: [{ ...asks, state: 'running' }] })]));
  expect(text(map.querySelector('[data-map-part="W_q"] [data-map-facts]')), 'Working says In progress already').toBe('Working');
  expect(text(map)).not.toContain('thread');
});

test('a held Dependency shows met or not met under the map, naming what it holds, with no repeat of the line on the map', async () => {
  const hold = (id: string, need: string, met: DependencyHold['met']): DependencyHold => ({ dependencyId: id, revision: 1, owner: 'server team', need, ticket: null, named: [], evidence: '', met, needsReview: false, observation: null });
  const unmet = hold('d1', 'An export endpoint', null);
  const met = hold('d2', 'A relay', { by: 'Ana', at: '2026-10-21T09:00:00.000Z' } as DependencyHold['met']);
  const build = workPart('W_held', { number: 77, status: 'Ready', blockers: [{ number: 0, repo: 'server team', state: 'open', title: unmet.need, dependency: unmet }, { number: 0, repo: 'server team', state: 'closed', title: met.need, dependency: met }] });
  await mapOpen(conceptOf([build], { map: { ...c200.map!, dependencies: ['An export endpoint, from server team, blocks W_held', 'A handover, from team/docs, blocks W_held'] } }));
  const row = dossier().querySelector('[data-attention-row="dependencies"]')!;
  expect([...row.querySelector('dd')!.children].map(text)).toEqual(['server team: An export endpointnot met · holds #77', 'server team: A relaymet · holds #77', 'A handover, from team/docs, blocks W_held']);
  expect([...row.querySelectorAll('[data-dependency-state]')].map((el) => el.getAttribute('data-dependency-state'))).toEqual(['unmet', 'met']);
  expect(dossier().querySelector('[data-attention-row="fog"]'), 'the fog keeps its place too').not.toBeNull();
  const order = [...dossier().querySelectorAll('[data-work-map], [data-attention-row]')].map((el) => el.getAttribute('data-attention-row') ?? 'map');
  expect(order).toEqual(['map', 'dependencies', 'fog']);
});

test('the map view leaves out what its nodes already say, keeping a concept question above the map', async () => {
  await mapOpen(withItem(C200, { status: 'In progress', threads: [thread('own-question', 'needs you')] }));
  const order = [...dossier().querySelectorAll('[data-work-map], [data-attention-row]')].map((el) => el.getAttribute('data-attention-row') ?? 'map');
  expect(order).toEqual(['you', 'map', 'fog']);
  expect(dossier().querySelector('[data-attention-none]')).toBeNull();
});

test('only a part in another repository names it, by project icon and name, once per lane, apart from its source icon', async () => {
  const other = 'maddec01/lar-apple';
  const map = await mapOpen(conceptOf([
    workPart('W_home', { status: 'Shaping' }), workPart('W_home2', { status: 'Shaping' }),
    workPart('W_far', { status: 'Shaping', repo: other }), workPart('W_far2', { status: 'Shaping', repo: other }),
    workPart('W_q', { status: 'Shaping', repo: other, kind: 'decision', decisionMethod: 'grill' }),
    settledPart('W_old', 'task', { repo: other }), settledPart('W_oldhome', 'task'),
  ]));
  const repoName = (el: Element | null) => text(el!.querySelector('[data-part-repo] > .truncate'));
  const lanes = [...map.querySelectorAll('.sticky')];
  expect([text(lanes[0]), text(lanes[1]), repoName(lanes[2]!)]).toEqual(['Decisions', 'Builds', 'lar-apple']);
  expect(lanes[2]!.querySelector('[data-part-repo]')!.children.length, 'the icon and the name').toBe(2);
  expect(map.querySelector('[data-map-part="W_home"] [data-part-repo]'), 'home goes unnamed').toBeNull();
  expect(map.querySelector('[data-map-part="W_far"] [data-part-repo]'), 'its lane names it').toBeNull();
  expect(repoName(map.querySelector('[data-map-part="W_q"]')), 'the Decisions lane does not').toBe('lar-apple');
  expect(map.querySelector('[data-map-part="W_q"] [data-part-repo] [aria-label^="Saved"], [data-map-part="W_q"] [data-part-repo] [aria-label*="issue"]'), 'the source icon stays apart').toBeNull();
  await press(map.querySelector('[data-map-history]')!);
  expect(repoName(map.querySelector('[data-history-part="W_old"]'))).toBe('lar-apple');
  expect(map.querySelector('[data-history-part="W_oldhome"] [data-part-repo]')).toBeNull();
});

test('method and kind share one label on nodes, history rows and the parts list', async () => {
  const map = await mapOpen(conceptOf([workPart('W_b', { status: 'Shaping' }), workPart('W_g', { status: 'Shaping', kind: 'decision', decisionMethod: 'grill' }), settledPart('W_t', 'task')]));
  await press(map.querySelector('[data-map-history]')!);
  const label = (el: string) => text(map.querySelector(`${el} [data-part-kind]`));
  expect([label('[data-map-part="W_b"]'), label('[data-map-part="W_g"]'), label('[data-history-part="W_t"]')]).toEqual(['Build', 'Grill', 'Task']);
  await press(button(dossier(), 'Parts list'));
  expect(text(step('W_b').querySelector('[data-part-meta] [data-part-kind]'))).toBe('Build');
  expect(text(step('W_g').querySelector('[data-part-meta] [data-part-kind]'))).toBe('Grill');
});

test('a blocked slice shows on its part in the map', async () => {
  const build = workPart('W_b', { status: 'In progress', slices: [{ ...base.slices[0]!, progress: 'blocked' }] });
  const map = await mapOpen(conceptOf([build]));
  expect(text(map.querySelector('[data-map-part="W_b"] [data-map-facts]'))).toContain('1 slice blocked');
});

const partThread = { id: 'own', title: 'Own thread', state: 'done' as const, updated: '2026-10-21T09:00:00.000Z' };
const settled = { kind: 'decision' as const, labels: [], decisionMethod: 'research' as const, status: 'Done' as const, completion: { complete: true, reasons: [] } };
const openThreadIn = (el: Element) => el.querySelector('[data-open-thread]');
const showDone = () => press(button(dossier(), 'Show 2 done'));

test('a settled decision with a thread offers Open thread and names its method, in the list and on its card', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen(withItem('I_sample10', { ...settled, threads: [partThread] }));
  await press(button(dossier(), 'Parts list'));
  await showDone();
  expect(openThreadIn(step('I_sample10'))!.getAttribute('href')).toBe('t3code://threads/sample-environment/own');
  expect(text(step('I_sample10').querySelector('[data-part-meta]'))).toContain('Research');
  await press(button(dossier(), 'Work map'));
  await press(dossier().querySelector('[data-map-history]')!);
  const card = dossier().querySelector('[data-history-part="I_sample10"]')!;
  expect(openThreadIn(card)!.getAttribute('href')).toBe('t3code://threads/sample-environment/own');
  expect(text(card)).toContain('Research');
  expect(text(card)).not.toContain('decision');
});

test('a settled decision with no thread shows no thread control, and no valid method says No method', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen(withItem('I_sample10', { ...settled, decisionMethod: null, threads: [], stats: undefined }));
  await press(button(dossier(), 'Parts list'));
  await showDone();
  expect(openThreadIn(step('I_sample10'))).toBeNull();
  expect(text(step('I_sample10').querySelector('[data-part-meta]'))).toContain('No method');
  await press(button(dossier(), 'Work map'));
  await press(dossier().querySelector('[data-map-history]')!);
  const card = dossier().querySelector('[data-history-part="I_sample10"]')!;
  expect(openThreadIn(card)).toBeNull();
  expect(text(card)).toContain('No method');
  expect(text(dossier().querySelector('[data-work-map]')), 'absence says nothing').not.toContain('no thread');
});

test('a part that waits on another keeps saying so beside Open thread', async () => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  await mountOpen(withItem('I_sample10', { blockers: [{ number: 203, repo: 'maddec01/lar-server', state: 'open' }], threads: [partThread] }));
  await press(button(dossier(), 'Parts list'));
  expect(text(step('I_sample10'))).toContain('waits on #203');
  expect(openThreadIn(step('I_sample10'))).not.toBeNull();
  await press(button(dossier(), 'Work map'));
  const card = dossier().querySelector('[data-map-part="I_sample10"]')!;
  expect(text(card)).toContain('Waiting on #203');
  expect(openThreadIn(card)!.getAttribute('aria-label')).toBe('Open thread');
});

test('a row showing its Start or desk marker offers no Open thread', async () => {
  await mountOpen(withItem('I_sample12', { status: 'Verify', threads: [partThread] }, withItem('I_sample13', { status: 'Ready', threads: [partThread] })));
  await press(button(dossier(), 'Parts list'));
  expect(text(step('I_sample12'))).toContain('on your desk');
  expect(openThreadIn(step('I_sample12'))).toBeNull();
  expect(openThreadIn(step('I_sample13'))).toBeNull();
});

test('a part row keeps last-known figures, explains them, and hides all zeros', async () => {
  const usage = { agentMs: 60_000, tokens: 1000, costUsd: 2 };
  await mountOpen({ ...withItem('I_sample10', { stats: usage }, withItem('I_sample12', { stats: { agentMs: 0, tokens: 0, costUsd: 0 } })), usageRead: { readable: false } });
  await press(button(dossier(), 'Parts list'));
  const figures = step('I_sample10').querySelector<HTMLElement>('[data-part-meta] [title^="Agent time"]')!;
  expect(figures.title).toContain("Last known figures: T3 Code's usage can't be read now.");
  expect(text(figures)).toContain('$2.00');
  expect(step('I_sample12').querySelector('[data-part-meta] [title^="Agent time"]')).toBeNull();
});

test('a failed family marks its own known figures last known while the board reads usage', async () => {
  const usage = { agentMs: 60_000, tokens: 1000, costUsd: 2 };
  await mountOpen({ ...withItem('I_sample10', { stats: usage, usageState: 'failed' }, withItem('I_sample12', { stats: usage, usageState: 'current' })), usageRead: { readable: true, readAt: '2026-11-03T10:00:00.000Z' } });
  await press(button(dossier(), 'Parts list'));
  const figures = (id: string) => step(id).querySelector<HTMLElement>('[data-part-meta] [title^="Agent time"]')!;
  expect(figures('I_sample10').title).toContain("Last known figures: T3 Code's usage can't be read now.");
  expect(figures('I_sample12').title).not.toContain('Last known');
});

const dossierTotal = () => dossier().querySelector<HTMLElement>('[data-col="figures"] [title]')!;

test('a Dossier total marks a sum with a failed part partial with a + after its cost, and says why', async () => {
  const usage = { agentMs: 60_000, tokens: 1000, costUsd: 2 };
  await mountPage(withItem('I_sample10', { stats: usage, usageState: 'failed' }, withItem('I_sample12', { stats: usage, usageState: 'current' })));
  expect(text(dossierTotal())).toBe('24m · 1.41M · $6.05+ partial');
  expect([text(dossierTotal().querySelector('[data-partial]')), dossierTotal().querySelector('[data-partial] .sr-only') !== null], 'a + on screen, partial for a screen reader').toEqual(['+ partial', true]);
  expect(dossierTotal().title).toContain('This total is incomplete');
});

test('a Dossier total with a loading part and no figures for it gives no sum and shows the loader', async () => {
  await mountPage(withItem('I_sample10', { stats: undefined, usageState: 'loading', threads: [partThread] }));
  const total = dossier().querySelector('[data-col="figures"]')!;
  expect(text(total)).toBe('Loading usage');
  expect(total.querySelector('[data-loader]')).not.toBeNull();
});

test('a Dossier total with a failed part and no figures for it gives no sum and says its usage is incomplete', async () => {
  await mountPage(withItem('I_sample10', { stats: undefined, usageState: 'failed', threads: [partThread] }));
  expect(text(dossierTotal())).toBe('Usage incomplete');
  expect(dossierTotal().title).toBe("This total is incomplete: usage for part of it is still loading or can't be read.");
  expect(dossier().querySelector('[data-col="figures"] [data-loader]')).toBeNull();
});

test('a part with no figures yet says its usage can\'t be read', async () => {
  await mountOpen(withItem('I_sample10', { stats: 'unavailable' }));
  await press(button(dossier(), 'Parts list'));
  expect(text(step('I_sample10').querySelector('[data-part-meta]'))).toContain('Usage details are unavailable.');
});

test.each(['Verify', 'Ready to merge'] as const)('%s keeps its pulsing icon in names, Track and running thread lines while its part bar keeps building', async status => {
  const build: ItemThread = { ...thread('build', 'running'), purpose: 'build', currentRunning: true };
  const fresh = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
  const data = withItem('I_sample13', { status, blockers: [], slices: [], threads: [build] }, fresh);
  await mountOpen(data);
  const icon = status === 'Verify' ? 'lucide-circle-dot' : 'lucide-git-merge';
  const glyphs = () => step('I_sample13').querySelectorAll(`svg.${icon}.status-pulse`);
  expect(glyphs(), 'the name, Track and thread line agree').toHaveLength(3);
  expect(text(step('I_sample13'))).toContain('Working');
  const bar = () => [...dossier().querySelectorAll('[data-part-bar] li')].find(li => li.getAttribute('title')?.startsWith('#140')) as HTMLElement;
  expect(bar().classList.contains('status-pulse')).toBe(true);
  expect(bar().style.background).toBe('var(--st-now)');
  await receive(withItem('I_sample13', { status, blockers: [], slices: [], threads: [{ ...build, observedAt: build.updated }] }, fresh));
  expect(step('I_sample13').querySelector('svg.status-pulse')).toBeNull();
  expect(text(step('I_sample13'))).toContain('last seen');
  await receive(withItem('I_sample13', { status, blockers: [], slices: [], threads: [{ ...build, state: 'done', currentRunning: undefined }] }, fresh));
  expect(glyphs()).toHaveLength(0);
  expect(bar().classList.contains('status-pulse')).toBe(false);
  expect(bar().style.background).toBe(status === 'Verify' ? 'var(--st-amber)' : 'var(--st-done)');
});

test.each([
  ['Shaping', 'shape', 'lucide-circle-dashed', 'status-pulse'],
  ['In progress', 'build', 'lucide-loader-circle', 'status-spin'],
  ['Review', 'build', 'lucide-eye', 'status-pulse'],
] as const)('%s uses the item icon on its running dossier thread line and Track', async (status, purpose, icon, motion) => {
  const fresh = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
  await mountOpen(withItem('I_sample13', { status, slices: [], blockers: [], threads: [{ ...thread('own', 'running'), purpose, currentRunning: true }] }, fresh));
  expect(step('I_sample13').querySelectorAll(`svg.${icon}.${motion}`)).toHaveLength(3);
  expect(step('I_sample13').querySelector('[data-part-kind] svg.lucide-hammer')).not.toBeNull();
  await receive(withItem('I_sample13', { status, slices: [], blockers: [], threads: [{ ...thread('own', 'done'), purpose, hasRunningChildren: true }] }, fresh));
  expect(step('I_sample13').querySelectorAll(`svg.${icon}.${motion}`), 'delegated work continues after the parent turn').toHaveLength(3);
});

test('work map nodes keep resumed Verify icons and the Builds lane keeps Hammer', async () => {
  const build: ItemThread = { ...thread('build', 'done'), purpose: 'build', hasRunningChildren: true };
  const fresh = { ...sample, error: null, fetchedAt: new Date(NOW).toISOString() };
  await mountOpen(withItem('I_sample13', { status: 'Verify', slices: [], blockers: [], threads: [build] }, fresh));
  await press(button(dossier(), 'Work map'));
  const node = () => dossier().querySelector('[data-map-part="I_sample13"]')!;
  expect(node().querySelector('svg.lucide-circle-dot.status-pulse')).not.toBeNull();
  expect(text(node())).toContain('Working');
  expect(dossier().querySelector('[data-work-map] .lucide-hammer')).not.toBeNull();
  await receive(withItem('I_sample13', { status: 'Verify', slices: [], blockers: [], threads: [{ ...build, hasRunningChildren: undefined }] }, fresh));
  expect(node().querySelector('svg.lucide-circle-dot:not(.status-pulse)')).not.toBeNull();
});
