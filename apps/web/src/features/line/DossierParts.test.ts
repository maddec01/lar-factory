// What the dossiers hold: their parts in dependency order, and which parts are done.

import type { Item } from '@lar-factory/shared';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { expect, test } from 'vite-plus/test';

import { isDone, partWaves, partsOf } from './DossierParts';

const items = (sampleJson as unknown as { items: Item[] }).items;
const byNumber = (n: number) => items.find((i) => i.number === n)!;
const child = (number: number, parent: Item, change: Partial<Item> = {}): Item => ({
    ...byNumber(129),
    id: `I_c${number}`,
    number,
    status: 'Shaping',
    labels: [],
    parent: { number: parent.number!, repo: parent.repo!, title: parent.title, url: parent.url!, state: 'open' },
    parentId: parent.id,
    flow: 'linked',
    ...change,
});

test('parts follow dependency waves across repositories, with stable ties and external blockers ignored', () => {
    const parent = byNumber(200);
    const first = child(1, parent, { id: 'I_a1', repo: 'owner/a', blockers: [] });
    const after = child(1, parent, {
        id: 'I_b1',
        repo: 'owner/b',
        blockers: [{ repo: 'owner/a', number: 1, state: 'open' }],
    });
    const parallel = child(3, parent, { blockers: [{ repo: 'external/repo', number: 1, state: 'open' }] });
    const last = child(4, parent, { blockers: [{ repo: 'owner/b', number: 1, state: 'closed' }] });

    expect(partsOf(parent, [last, after, parallel, first]).map((p) => [p.item.repo, p.item.number])).toEqual([
        [parallel.repo, 3],
        ['owner/a', 1],
        ['owner/b', 1],
        [last.repo, 4],
    ]);
});

test('ticketless parts are told apart by their work IDs, and wait on each other through them', () => {
    const parent = byNumber(200);
    const ticketless = (id: string, blockers: Item['blockers'] = []) =>
        child(0, parent, { id, repo: 'owner/a', blockers });
    const first = ticketless('W_first');
    const second = ticketless('W_second', [{ repo: 'owner/a', number: 0, state: 'open', workId: 'W_first' }]);
    const third = ticketless('W_third', [{ repo: 'owner/a', number: 0, state: 'open', workId: 'W_second' }]);

    expect(partsOf(parent, [third, second, first]).map((p) => p.item.id)).toEqual(['W_first', 'W_second', 'W_third']);
    expect(Object.fromEntries(partWaves(partsOf(parent, [third, second, first])))).toEqual({
        W_first: 0,
        W_second: 1,
        W_third: 2,
    });
});

test('recorded decisions need no factory labels, and local completion facts override the displayed Status', () => {
    const parent = byNumber(200);
    const complete = child(0, parent, {
        id: 'W_decided',
        recorded: true,
        kind: 'decision',
        status: 'Shaping',
        labels: [],
        completion: { complete: true, reasons: [] },
    });
    const pending = child(0, parent, {
        id: 'W_pending',
        recorded: true,
        kind: 'decision',
        status: 'List',
        labels: [],
        completion: { complete: false, reasons: ['Its confirmed answer isn’t recorded.'] },
    });
    const build = child(0, parent, {
        id: 'W_build',
        recorded: true,
        kind: 'build',
        status: 'Ready',
        labels: ['decision-grill'],
        completion: { complete: false, reasons: ['No merged PR.'] },
    });

    expect(partsOf(parent, [complete, pending, build]).map((part) => part.kind)).toEqual([
        'decision',
        'decision',
        'build',
    ]);
    expect(isDone(complete)).toBe(true);
    expect(complete.status).toBe('Shaping');
    expect(isDone(pending)).toBe(false);
    expect(isDone(build)).toBe(false);
});

test('a record-derived concept uses the same deterministic member order as its CLI report', () => {
    const parent = {
        id: 'group',
        kind: 'concept',
        conceptBuild: { members: [{ workId: 'older' }, { workId: 'dependent' }, { workId: 'newer' }] },
    } as Item;
    const part = (id: string) =>
        ({
            id,
            kind: 'build',
            parentId: 'group',
            status: 'Ready',
            blockers: [],
            labels: [],
            recorded: true,
            subIssues: { total: 0, completed: 0 },
        }) as unknown as Item;

    expect(
        partsOf(parent, [parent, part('newer'), part('dependent'), part('older')]).map((entry) => entry.item.id),
    ).toEqual(['older', 'dependent', 'newer']);
});
