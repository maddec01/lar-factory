// The Kind and Labels filters on List and the board: what each row matches, what the Labels filter offers, how each
// surface keeps its own choices, and that Queue numbers and Start next ignore them.

import { beforeEach, expect, test } from 'vite-plus/test';
import { $, $$, mountPage, sample, settle, text } from '../../test/support.ts';
import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { labelChoices, rowFilter } from './item-filters.ts';

const BOARD_KEY = 'lar-board:filters:board';
const LIST_KEY = 'lar-board:filters:list';
const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const saved = (key: string) => JSON.parse(localStorage.getItem(key)!) as unknown;
const seed = (key: string, kinds: string[], labels: string[] = []) => localStorage.setItem(key, JSON.stringify({ kinds, labels }));

const queueRows = () => $$<HTMLLIElement>('.queue ol > li');
const startNext = () => $<HTMLButtonElement>('.queue header [data-start]')!;
const bar = (root = '[data-line-filters]') => $(`${root} [data-item-filters]`)!;
const open = (which: string, root?: string) => settle(() => bar(root).querySelector<HTMLButtonElement>(`[data-filter="${which}"]`)!.click());
const choices = () => $$<HTMLLabelElement>('[data-filter-choice], [data-label-choice]').map((c) => text(c));
const choose = (name: string) => settle(() => $$<HTMLLabelElement>('[data-filter-choice], [data-label-choice]').find((c) => text(c) === name)!.querySelector('input')!.click());
const chips = (root?: string) => [...bar(root).querySelectorAll('[data-filter-chip]')].map((c) => c.getAttribute('aria-label'));
const removeChip = (name: string, root?: string) => settle(() => bar(root).querySelector<HTMLButtonElement>(`[aria-label="Remove ${name}"]`)!.click());
const clear = (root?: string) => settle(() => bar(root).querySelector<HTMLButtonElement>('[data-filter-clear]')!.click());
const withItems = (items: Item[], rest: Partial<BoardData> = {}): BoardData => ({ ...sample, ...rest, items });

beforeEach(() => localStorage.clear());

test('choices within a filter match any, and the two filters must both match', () => {
  const bug = item('b', { kind: 'bug', labels: ['area: web'] });
  const feature = item('f', { kind: 'feature', labels: ['area: api'] });
  const concept = item('c', { kind: 'concept', labels: ['area: web'] });
  const shows = (kinds: Parameters<typeof rowFilter>[0]['kinds'], labels: string[]) => [bug, feature, concept].filter(rowFilter({ kinds, labels }, [])).map((i) => i.id);
  expect(shows([], [])).toEqual(['b', 'f', 'c']);
  expect(shows(['bug', 'feature'], [])).toEqual(['b', 'f']);
  expect(shows([], ['area: web', 'area: api'])).toEqual(['b', 'f', 'c']);
  expect(shows(['bug', 'feature'], ['AREA: WEB'])).toEqual(['b']);
});

test('No kind finds builds, decisions and tickets with no recognised kind, and no others', () => {
  const rows = (['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'issue'] as const).map((kind) => item(kind, { kind }));
  expect(rows.filter(rowFilter({ kinds: ['no-kind'], labels: [] }, [])).map((i) => i.id)).toEqual(['decision', 'build', 'issue']);
});

test('local work appears under kind filters and drops out once a label filter is active', () => {
  const local = item('local', { kind: 'feature', number: 0, labels: [] });
  expect(rowFilter({ kinds: ['feature'], labels: [] }, [])(local)).toBe(true);
  expect(rowFilter({ kinds: ['feature'], labels: ['area: web'] }, [])(local)).toBe(false);
});

test('the Labels filter offers each name once without case, across repositories, and never a managed label', () => {
  const rows = [
    item('a', { repo: 'maddec01/lar-server', labels: ['Area: Web', 'linked-work', 'bug', 'status-queued', 'decision-grill'], labelColors: { 'Area: Web': '#BFDADC' } }),
    item('b', { repo: 'maddec01/lar-apple', labels: ['area: web', 'docs'] }),
  ];
  expect(labelChoices(rows, [])).toEqual([{ name: 'Area: Web', color: '#BFDADC' }, { name: 'docs', color: undefined }]);
});

test('a label mapped to the item\'s kind is neither offered nor matched on that row, as its row hides it', () => {
  const setup = { vocabulary: effectiveVocabulary({ bug: { type: null, labels: ['oops'] } }).vocabulary } as NonNullable<BoardData['repos'][number]['setup']>;
  const repos = [{ ...sample.repos[0]!, repo: base.repo, setup }];
  const mapped = item('a', { kind: 'bug', labels: ['oops'] });
  expect(labelChoices([mapped], repos)).toEqual([]);
  expect(rowFilter({ kinds: [], labels: ['oops'] }, repos)(mapped)).toBe(false);
  expect(rowFilter({ kinds: [], labels: ['oops'] }, repos)({ ...mapped, kind: 'feature' })).toBe(true);
});

test('the board keeps Queue numbers, and Start next starts and names the first startable item a filter hides', async () => {
  seed(BOARD_KEY, ['bug']);
  await mountPage(withItems([
    item('Q1', { number: 1, title: 'First', kind: 'feature' }),
    item('Q2', { number: 2, title: 'Second', kind: 'bug' }),
    item('Q3', { number: 3, title: 'Third', kind: 'bug' }),
  ]));
  expect(queueRows().map((r) => [r.dataset.item, text(r.querySelector('.queue-n'))])).toEqual([['Q2', '2'], ['Q3', '3']]);
  expect(text($('#queue-h'))).toBe('Queue 2');
  expect(startNext().dataset.start).toBe('Q1');
  expect(text(startNext())).toContain('Start next: #1 First');
  await removeChip('Bug');
  expect(queueRows().map((r) => text(r.querySelector('.queue-n')))).toEqual(['1', '2', '3']);
  expect(startNext().dataset.start, 'an unfiltered Queue starts the same item').toBe('Q1');
  expect(text(startNext())).toContain('Start next');
  expect(text(startNext())).not.toContain('First');
});

test('a failed Start next on a hidden row still shows its error', async () => {
  seed(BOARD_KEY, ['bug']);
  await mountPage(withItems([item('Q1', { number: 1, title: 'First', kind: 'feature' })]));
  const { useStartStore } = await import('../items/start-store.ts');
  await settle(() => useStartStore.getState().set('Q1', { phase: 'error', message: 'T3 is down' }));
  expect(text($('.queue'))).toContain('T3 is down');
});

test('a shown Start next item keeps the plain button', async () => {
  seed(BOARD_KEY, ['feature']);
  await mountPage(withItems([item('Q1', { number: 1, title: 'First', kind: 'feature' }), item('Q2', { number: 2, title: 'Second', kind: 'bug' })]));
  expect(startNext().dataset.start).toBe('Q1');
  expect(text(startNext())).not.toContain('First');
});

const parent = item('P', { number: 10, title: 'Parent', kind: 'bug', status: 'In progress', labels: ['area: web'] });
const part = item('C', { number: 11, title: 'Part', kind: 'feature', status: 'In progress', labels: ['only-on-part'], parentId: 'P' });

test('a part has no row of its own, so a part that matches keeps no dossier whose parent does not', async () => {
  seed(BOARD_KEY, ['feature']);
  await mountPage(withItems([parent, part]));
  expect($('[data-dossiers]')).toBeNull();
  expect($('[data-flight="C"]'), 'nor a row of its own').toBeNull();
});

test('a dossier follows its parent\'s row, and the Labels filter offers none of its part\'s labels', async () => {
  seed(BOARD_KEY, ['bug']);
  await mountPage(withItems([parent, part]));
  expect($('[data-dossiers]'), 'the parent matches, its part does not').not.toBeNull();
  await open('labels');
  expect(choices()).toEqual(['area: web']);
});

test('in flight rows follow the filter, and the empty line says nothing matches', async () => {
  seed(BOARD_KEY, ['bug']);
  await mountPage(withItems([item('F', { number: 5, kind: 'feature', status: 'In progress' }), item('Q', { number: 6, kind: 'feature' })]));
  expect($('[data-flight="F"]')).toBeNull();
  expect(text($('[data-in-flight-title]'))).toBe('Everything else in flight · 0');
  expect(text($('[data-in-flight]'))).toContain('Nothing in flight matches.');
  expect(text($('.queue'))).toContain('Nothing queued matches.');
});

test('the dropdown checklists change the board, add removable chips and save them; Clear removes them all', async () => {
  await mountPage(withItems([
    item('Q1', { number: 1, kind: 'feature', labels: ['docs'] }),
    item('Q2', { number: 2, kind: 'bug', labels: ['area: web'] }),
  ]));
  await open('kind');
  expect(choices()).toEqual(['Bug', 'Feature', 'Improvement', 'Concept', 'No kind']);
  await choose('Bug');
  expect(queueRows().map((r) => r.dataset.item)).toEqual(['Q2']);
  expect(saved(BOARD_KEY)).toEqual({ kinds: ['bug'], labels: [] });
  await open('labels');
  expect(choices(), 'it offers what the surface holds, whatever the filter hides').toEqual(['area: web', 'docs']);
  await choose('docs');
  expect(queueRows()).toEqual([]);
  expect(chips()).toEqual(['Remove Bug', 'Remove docs']);
  await clear();
  expect(queueRows().map((r) => r.dataset.item)).toEqual(['Q1', 'Q2']);
  expect(saved(BOARD_KEY)).toEqual({ kinds: [], labels: [] });
  expect(chips()).toEqual([]);
  expect(bar().querySelector('[data-filter-clear]')).toBeNull();
});

test('removing a chip or clearing moves focus to the Kind menu, which always stays', async () => {
  const kindMenu = () => bar().querySelector<HTMLElement>('[data-filter="kind"]');
  seed(BOARD_KEY, ['bug'], ['gone']);
  await mountPage(withItems([]));
  await removeChip('gone');
  expect(document.activeElement).toBe(kindMenu());
  (document.activeElement as HTMLElement).blur();
  await clear();
  expect(bar().querySelector('[data-filter-clear]')).toBeNull();
  expect(document.activeElement).toBe(kindMenu());
});

test('a saved label no item carries still shows as a removable chip', async () => {
  seed(BOARD_KEY, [], ['gone']);
  await mountPage(withItems([item('Q1', { number: 1 })]));
  expect(chips()).toEqual(['Remove gone']);
  expect(queueRows()).toEqual([]);
  await removeChip('gone');
  expect(queueRows().map((r) => r.dataset.item)).toEqual(['Q1']);
});

test('a broken save reads as no filters', async () => {
  localStorage.setItem(BOARD_KEY, '{not json');
  await mountPage(withItems([item('Q1', { number: 1 })]));
  expect(queueRows().map((r) => r.dataset.item)).toEqual(['Q1']);
});

test('List and the board keep separate filters, and filters write nothing to the tracker', async () => {
  const listed = (id: string, kind: Item['kind']) => item(id, { kind, status: 'List' });
  seed(BOARD_KEY, ['bug']);
  seed(LIST_KEY, ['feature']);
  await mountPage(withItems([listed('L1', 'feature'), listed('L2', 'bug'), item('Q1', { number: 1, kind: 'feature' })]));
  expect(queueRows()).toEqual([]);
  await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());
  const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item);
  expect(rows()).toEqual(['L1']);
  expect(chips('[data-list-modal]')).toEqual(['Remove Feature']);
  await clear('[data-list-modal]');
  expect(rows()).toEqual(expect.arrayContaining(['L1', 'L2']));
  expect(saved(LIST_KEY)).toEqual({ kinds: [], labels: [] });
  expect(saved(BOARD_KEY), 'clearing List leaves the board alone').toEqual({ kinds: ['bug'], labels: [] });
});

test('the List counts follow the filters, and its Labels filter holds the chosen repository\'s names', async () => {
  const other = sample.repos[1]!.repo;
  await mountPage(withItems([
    item('L1', { status: 'List', kind: 'bug', labels: ['docs'] }),
    item('L2', { status: 'List', kind: 'feature', repo: other, labels: ['Docs', 'infra'] }),
  ]));
  await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());
  const root = '[data-list-modal]';
  await open('labels', root);
  expect(choices(), 'All repositories lists the union, without case').toEqual(['docs', 'infra']);
  await choose('docs');
  const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item).sort();
  expect(rows(), 'matched without case across repositories').toEqual(['L1', 'L2']);
  await removeChip('docs', root);
  await settle(() => $$<HTMLButtonElement>('[data-list-modal] nav[aria-label="Repositories"] button').find((b) => b.textContent?.includes('lar-apple'))!.click());
  await open('labels', root);
  expect(choices(), 'a picked repository offers its own').toEqual(['Docs', 'infra']);
});
