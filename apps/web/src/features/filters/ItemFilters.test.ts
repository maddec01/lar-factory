// The Kind and Labels filters on List and the board: what each row matches, what the Labels filter offers, how each
// surface keeps its own choices, and that Queue numbers ignore them.

import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { labelChoices, rowFilter } from './ItemFilters';
import { $, $$, mountPage, sample, settle, text } from '@/test/PageTest';

const BOARD_KEY = 'lar-board:filters:board';
const LIST_KEY = 'lar-board:filters:list';
const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const saved = (key: string) => JSON.parse(localStorage.getItem(key)!) as unknown;
const seed = (key: string, kinds: string[], labels: string[] = []) =>
    localStorage.setItem(key, JSON.stringify({ kinds, labels }));

/** A stage's heading with the count beside it: "Queue 2". */
const heading = (id: string) => `${text($(id))} ${text($(id)!.parentElement!.querySelector('[data-slot="count"]'))}`;
const queueRows = () => $$<HTMLLIElement>('[data-stage="queue"] ol > li');
const bar = () => $('[data-list-modal] [data-item-filters]')!;
const open = (which: string) =>
    settle(() => bar().querySelector<HTMLButtonElement>(`[data-filter="${which}"]`)!.click());
const choices = () => $$<HTMLLabelElement>('[data-filter-choice], [data-label-choice]').map((c) => text(c));
const choose = (name: string) =>
    settle(() =>
        $$<HTMLLabelElement>('[data-filter-choice], [data-label-choice]')
            .find((c) => text(c) === name)!
            .querySelector('input')!
            .click(),
    );
/** Each filter chip's action, as its name starts and its tooltip says: "Remove Feature". */
const chips = () => [...bar().querySelectorAll('[data-filter-chip]')].map((c) => c.getAttribute('title'));
const removeChip = (name: string) =>
    settle(() => bar().querySelector<HTMLButtonElement>(`[data-filter-chip][title="Remove ${name}"]`)!.click());
const clear = () => settle(() => bar().querySelector<HTMLButtonElement>('[data-filter-clear]')!.click());
const search = () => settle(() => $<HTMLButtonElement>('[data-search-field]')!.click());
const removeToken = (name: string) =>
    settle(() => $<HTMLButtonElement>(`[data-command-palette] button[aria-label="Remove ${name}"]`)!.click());
const withItems = (items: Item[], rest: Partial<BoardData> = {}): BoardData => ({ ...sample, ...rest, items });

test('choices within a filter match any, and the two filters must both match', () => {
    const bug = item('b', { kind: 'bug', labels: ['area: web'] });
    const feature = item('f', { kind: 'feature', labels: ['area: api'] });
    const concept = item('c', { kind: 'concept', labels: ['area: web'] });
    const shows = (kinds: Parameters<typeof rowFilter>[0]['kinds'], labels: string[]) =>
        [bug, feature, concept].filter(rowFilter({ kinds, labels }, [])).map((i) => i.id);

    expect(shows([], [])).toEqual(['b', 'f', 'c']);
    expect(shows(['bug', 'feature'], [])).toEqual(['b', 'f']);
    expect(shows([], ['area: web', 'area: api'])).toEqual(['b', 'f', 'c']);
    expect(shows(['bug', 'feature'], ['AREA: WEB'])).toEqual(['b']);
});

test('No kind finds builds, decisions and tickets with no recognised kind, and no others', () => {
    const rows = (['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'issue'] as const).map((kind) =>
        item(kind, { kind }),
    );

    expect(rows.filter(rowFilter({ kinds: ['no-kind'], labels: [] }, [])).map((i) => i.id)).toEqual([
        'decision',
        'build',
        'issue',
    ]);
});

test('local work appears under kind filters and drops out once a label filter is active', () => {
    const local = item('local', { kind: 'feature', number: 0, labels: [] });

    expect(rowFilter({ kinds: ['feature'], labels: [] }, [])(local)).toBe(true);
    expect(rowFilter({ kinds: ['feature'], labels: ['area: web'] }, [])(local)).toBe(false);
});

test('the Labels filter offers each name once without case, across repositories, and never a managed label', () => {
    const rows = [
        item('a', {
            repo: 'maddec01/lar-server',
            labels: ['Area: Web', 'linked-work', 'bug', 'status-queued', 'decision-grill'],
            labelColors: { 'Area: Web': '#BFDADC' },
        }),
        item('b', { repo: 'maddec01/lar-apple', labels: ['area: web', 'docs'] }),
    ];

    expect(labelChoices(rows, [])).toEqual([
        { name: 'Area: Web', color: '#BFDADC' },
        { name: 'docs', color: undefined },
    ]);
});

test('a label mapped to the item’s kind is neither offered nor matched on that row, as its row hides it', () => {
    const setup = {
        vocabulary: effectiveVocabulary({ bug: { type: null, labels: ['oops'] } }).vocabulary,
    } as NonNullable<BoardData['repos'][number]['setup']>;
    const repos = [{ ...sample.repos[0]!, repo: base.repo, setup }];
    const mapped = item('a', { kind: 'bug', labels: ['oops'] });

    expect(labelChoices([mapped], repos)).toEqual([]);
    expect(rowFilter({ kinds: [], labels: ['oops'] }, repos)(mapped)).toBe(false);
    expect(rowFilter({ kinds: [], labels: ['oops'] }, repos)({ ...mapped, kind: 'feature' })).toBe(true);
});

test('the board keeps Queue numbers while a filter hides the first row, whose item the Queue header never offers', async () => {
    seed(BOARD_KEY, ['bug']);
    await mountPage(
        withItems([
            item('Q1', { number: 1, title: 'First', kind: 'feature' }),
            item('Q2', { number: 2, title: 'Second', kind: 'bug' }),
            item('Q3', { number: 3, title: 'Third', kind: 'bug' }),
        ]),
    );
    expect(queueRows().map((r) => [r.dataset.item, text(r.querySelector('.queue-n'))])).toEqual([
        ['Q2', '2'],
        ['Q3', '3'],
    ]);
    expect(heading('#queue-h')).toBe('Queue 2');
    expect($('[data-stage="queue"] header button')).toBeNull();
    await search();
    await removeToken('Bug');
    expect(queueRows().map((r) => text(r.querySelector('.queue-n')))).toEqual(['1', '2', '3']);
});

test('a start error on a hidden row stays out of view, and shows on the row once the filter clears', async () => {
    seed(BOARD_KEY, ['bug']);
    await mountPage(withItems([item('Q1', { number: 1, title: 'First', kind: 'feature' })]));

    const { useStartStore } = await import('@/features/items/StartStore');

    await settle(() => useStartStore.getState().set('Q1', { phase: 'error', message: 'T3 is down' }));
    expect(text($('[data-stage="queue"]'))).not.toContain('T3 is down');
    await search();
    await removeToken('Bug');
    expect(text($('[data-stage="queue"] li[data-item="Q1"] [role="alert"]'))).toBe('T3 is down');
});

const parent = item('P', { number: 10, title: 'Parent', kind: 'bug', status: 'In progress', labels: ['area: web'] });
const part = item('C', {
    number: 11,
    title: 'Part',
    kind: 'feature',
    status: 'In progress',
    labels: ['only-on-part'],
    parentId: 'P',
});

test('a dossier follows its parent, whatever its part matches; its part stays out of other stages', async () => {
    seed(BOARD_KEY, ['feature']);
    await mountPage(withItems([parent, part]));
    expect($('[data-dossiers]'), 'the part matches, its parent doesn’t').toBeNull();
    expect($('[data-stage="dock"]'), 'with no dossiers the dock takes no height').toBeNull();
    expect($('[data-stage="build"] li[data-item="C"]')).toBeNull();
});

test('the filters apply to every pane, their counts follow, and each says when nothing matches', async () => {
    seed(BOARD_KEY, ['bug']);
    await mountPage(
        withItems([
            item('F', { number: 5, kind: 'feature', status: 'In progress' }),
            item('Q', { number: 6, kind: 'feature' }),
            item('S', { number: 7, kind: 'feature', status: 'Shaping' }),
            item('R', { number: 8, kind: 'feature', status: 'Ready' }),
        ]),
    );
    expect(['#queue-h', '#shaping-h', '#build-h'].map(heading)).toEqual(['Queue 0', 'Shaping 0', 'Build 0']);
    expect(text($('[data-stage="queue"]'))).toContain('Nothing queued matches.');
    expect(text($('[data-stage="shaping"] p'))).toBe('Nothing in shaping matches.');
    expect(text($('[data-stage="ready"]'))).toContain('Nothing ready to build matches.');
    expect(text($('[data-stage="build"] p'))).toBe('Nothing in build matches.');
    await search();
    await removeToken('Bug');
    expect(['#queue-h', '#shaping-h', '#build-h'].map(heading)).toEqual(['Queue 1', 'Shaping 1', 'Build 1']);
});

test('removing a chip or clearing moves focus to the Kind menu, which always stays', async () => {
    const kindMenu = () => bar().querySelector<HTMLElement>('[data-filter="kind"]');

    seed(LIST_KEY, ['bug'], ['gone']);
    await mountPage(withItems([]));
    await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());
    await removeChip('gone');
    expect(document.activeElement).toBe(kindMenu());
    (document.activeElement as HTMLElement).blur();
    await clear();
    expect(bar().querySelector('[data-filter-clear]')).toBeNull();
    expect(document.activeElement).toBe(kindMenu());
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
    await mountPage(
        withItems([listed('L1', 'feature'), listed('L2', 'bug'), item('Q1', { number: 1, kind: 'feature' })]),
    );
    expect(queueRows()).toEqual([]);
    await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());

    const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item);

    expect(rows()).toEqual(['L1']);
    expect(chips()).toEqual(['Remove Feature']);
    await clear();
    expect(rows()).toEqual(expect.arrayContaining(['L1', 'L2']));
    expect(saved(LIST_KEY)).toEqual({ kinds: [], labels: [] });
    expect(saved(BOARD_KEY), 'clearing List leaves the board alone').toEqual({ kinds: ['bug'], labels: [] });
});

test('the list counts follow the filters, and its Labels filter holds the chosen repository’s names', async () => {
    const other = sample.repos[1]!.repo;

    await mountPage(
        withItems([
            item('L1', { status: 'List', kind: 'bug', labels: ['docs'] }),
            item('L2', { status: 'List', kind: 'feature', repo: other, labels: ['Docs', 'infra'] }),
        ]),
    );
    await settle(() => $<HTMLButtonElement>('.title-bar button.list-button')!.click());
    await open('labels');
    expect(choices(), 'All projects lists the union, without case').toEqual(['docs', 'infra']);
    await choose('docs');

    const rows = () =>
        $$<HTMLButtonElement>('[data-list-modal] button[data-item]')
            .map((b) => b.dataset.item)
            .map(String)
            .sort();

    expect(rows(), 'matched without case across repositories').toEqual(['L1', 'L2']);
    await removeChip('docs');
    await settle(() =>
        $$<HTMLButtonElement>('[data-list-modal] nav[aria-label="Projects"] button')
            .find((b) => b.textContent?.includes('lar-apple'))!
            .click(),
    );
    await open('labels');
    expect(choices(), 'a picked repository offers its own').toEqual(['Docs', 'infra']);
});
