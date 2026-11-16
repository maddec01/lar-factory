// The Kind and Labels filters on List and the board: what each row matches, how each surface keeps its own choices,
// and that Queue numbers ignore them.

import type { BoardData, Item } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { rowFilter } from './ItemFilters';
import { $, $$, mountPage, sample, settle } from '@/test/PageTest';

const BOARD_KEY = 'lar-board:filters:board';
const LIST_KEY = 'lar-board:filters:list';
const base = sample.items.find((i) => i.id === 'I_sample05')!;
const item = (id: string, change: Partial<Item>): Item => ({ ...base, id, labels: [], labelColors: {}, ...change });
const saved = (key: string) => JSON.parse(localStorage.getItem(key)!) as unknown;
const seed = (key: string, kinds: string[], labels: string[] = []) =>
    localStorage.setItem(key, JSON.stringify({ kinds, labels }));

const queueRows = () => $$<HTMLLIElement>('[data-stage="queue"] ol > li');
const bar = () => $('[data-list-modal] [data-item-filters]')!;
/** Each filter chip's action, as its name starts and its tooltip says: "Remove Feature". */
const chips = () => [...bar().querySelectorAll('[data-filter-chip]')].map((c) => c.getAttribute('title'));
const clear = () => settle(() => bar().querySelector<HTMLButtonElement>('[data-filter-clear]')!.click());
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

test('List and the board keep separate filters, and filters write nothing to the tracker', async () => {
    const listed = (id: string, kind: Item['kind']) => item(id, { kind, status: 'List' });

    seed(BOARD_KEY, ['bug']);
    seed(LIST_KEY, ['feature']);
    await mountPage(
        withItems([listed('L1', 'feature'), listed('L2', 'bug'), item('Q1', { number: 1, kind: 'feature' })]),
    );
    expect(queueRows()).toEqual([]);
    await settle(() => $<HTMLButtonElement>('.title-bar button[data-list-button]')!.click());

    const rows = () => $$<HTMLButtonElement>('[data-list-modal] button[data-item]').map((b) => b.dataset.item);

    expect(rows()).toEqual(['L1']);
    expect(chips()).toEqual(['Remove Feature']);
    await clear();
    expect(rows()).toEqual(expect.arrayContaining(['L1', 'L2']));
    expect(saved(LIST_KEY)).toEqual({ kinds: [], labels: [] });
    expect(saved(BOARD_KEY), 'clearing List leaves the board alone').toEqual({ kinds: ['bug'], labels: [] });
});
