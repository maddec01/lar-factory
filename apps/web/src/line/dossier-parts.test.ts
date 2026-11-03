// What the dossiers hold: which items are dossiers, their parts in order with their kinds, waits and threads, and
// which items they take off the rest of the line.

import { expect, test } from 'vite-plus/test';
import type { Item, ItemThread } from '@lar-factory/shared';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { DECISION_KINDS, dossiersOf, isDone, isHistory, openWaits, partActivity, partKind, partWaves, partsOf, shownThread } from './dossier-parts.ts';
import type { Part } from './dossier-parts.ts';

const items = (sampleJson as unknown as { items: Item[] }).items;
const byNumber = (n: number) => items.find((i) => i.number === n)!;
const child = (number: number, parent: Item, change: Partial<Item> = {}): Item => ({
  ...byNumber(129), id: `I_c${number}`, number, status: 'Shaping', labels: [],
  parent: { number: parent.number!, repo: parent.repo!, title: parent.title, url: parent.url!, state: 'open' }, parentId: parent.id, ...change,
});

test('every open concept, and every open item with a sub-issue on the board, is a dossier, in board order', () => {
  expect(dossiersOf(items, items).map((d) => d.parent.number)).toEqual([200, 180]);
  const parent = byNumber(150);
  const withChild = [...items, child(151, parent)];
  expect(dossiersOf(withChild, withChild).map((d) => d.parent.number), 'coupled work').toEqual([200, 150, 180]);
  const listed = withChild.map((i) => (i.number === 150 ? { ...i, status: 'List' as const } : i.number === 180 ? { ...i, status: 'Done' as const } : i));
  expect(dossiersOf(listed, listed).map((d) => d.parent.number), 'none in List or Done').toEqual([200]);
});

test('a dossier shows where its parent or any part is in the scope', () => {
  const apple = items.filter((i) => i.repo === 'maddec01/lar-apple');
  expect(dossiersOf(apple, items).map((d) => d.parent.number), '#180 through its Apple build #40').toEqual([180]);
  expect(dossiersOf([], items)).toEqual([]);
});

test('parts follow dependency waves, then kind, with each kind from its labels', () => {
  expect(partsOf(byNumber(200), items).map((p) => [p.item.number, p.kind])).toEqual([[203, 'research'], [202, 'prototype'], [201, 'grill'], [140, 'build']]);
  expect(partsOf(byNumber(180), items).map((p) => [p.item.number, p.kind])).toEqual([[181, 'build'], [40, 'build']]);
  expect(partKind({ ...byNumber(201), labels: ['decision-task'] }), 'a task decision is a decision').toBe('task');
  expect(DECISION_KINDS).toContain('task');
  expect(partKind({ ...byNumber(201), labels: ['decision-wayfind'] }), 'an unlabelled decision method stays a decision').toBe('decision');
  expect(partKind({ ...byNumber(201), labels: [['decision:', 'grill'].join(' ')] }), 'the local decision kind remains authoritative').toBe('decision');
});

test("each part carries its blocked-by issues and its newest thread", () => {
  const [research, prototype, grill, build] = partsOf(byNumber(200), items);
  expect(grill!.waitsOn).toEqual([{ number: 203, repo: 'maddec01/lar-server', state: 'closed' }]);
  expect([research!.thread?.title, grill!.thread?.state, prototype!.thread?.state, build!.thread?.state]).toEqual(['Research: hosting cost of the relay', 'running', 'needs you', 'done']);
});

test('a part waits on its open blockers until a thread takes it on', () => {
  const [, , grill, build] = partsOf(byNumber(200), items);
  expect(openWaits(build!).map((b) => b.number)).toEqual([202]);
  expect(openWaits(grill!), 'its blocker closed').toEqual([]);
  expect(openWaits({ ...build!, item: { ...build!.item, status: 'In progress' } }), 'building, whatever it waited for').toEqual([]);
});

test('parts follow dependency waves across repositories, with stable ties and external blockers ignored', () => {
  const parent = byNumber(200);
  const first = child(1, parent, { id: 'I_a1', repo: 'owner/a', blockers: [] });
  const after = child(1, parent, { id: 'I_b1', repo: 'owner/b', blockers: [{ repo: 'owner/a', number: 1, state: 'open' }] });
  const parallel = child(3, parent, { blockers: [{ repo: 'external/repo', number: 1, state: 'open' }] });
  const last = child(4, parent, { blockers: [{ repo: 'owner/b', number: 1, state: 'closed' }] });
  expect(partsOf(parent, [last, after, parallel, first]).map((p) => [p.item.repo, p.item.number])).toEqual([
    [parallel.repo, 3], ['owner/a', 1], ['owner/b', 1], [last.repo, 4],
  ]);
});

test('ticketless parts are told apart by their work IDs, and wait on each other through them', () => {
  const parent = byNumber(200);
  const ticketless = (id: string, blockers: Item['blockers'] = []) => child(0, parent, { id, repo: 'owner/a', blockers });
  const first = ticketless('W_first');
  const second = ticketless('W_second', [{ repo: 'owner/a', number: 0, state: 'open', workId: 'W_first' }]);
  const third = ticketless('W_third', [{ repo: 'owner/a', number: 0, state: 'open', workId: 'W_second' }]);
  expect(partsOf(parent, [third, second, first]).map((p) => p.item.id)).toEqual(['W_first', 'W_second', 'W_third']);
  expect(Object.fromEntries(partWaves(partsOf(parent, [third, second, first])))).toEqual({ W_first: 0, W_second: 1, W_third: 2 });
});

test('recorded decisions need no factory labels, and local completion facts override the displayed Status',()=>{
  const parent=byNumber(200);
  const complete=child(0,parent,{id:'W_decided',recorded:true,kind:'decision',status:'Shaping',labels:[],completion:{complete:true,reasons:[]}});
  const pending=child(0,parent,{id:'W_pending',recorded:true,kind:'decision',status:'List',labels:[],completion:{complete:false,reasons:['Its confirmed answer is not recorded.']}});
  const build=child(0,parent,{id:'W_build',recorded:true,kind:'build',status:'Ready',labels:['decision-grill'],completion:{complete:false,reasons:['No merged PR.']}});
  expect(partsOf(parent,[complete,pending,build]).map(part=>part.kind)).toEqual(['decision','decision','build']);
  expect(isDone(complete)).toBe(true);expect(complete.status).toBe('Shaping');expect(isDone(pending)).toBe(false);expect(isDone(build)).toBe(false);
});

const quiet: ItemThread = { id: 'newest', title: 'Newest', state: 'done', updated: '2026-10-21T09:00:00.000Z' };
const partWith = (threads: ItemThread[], change: Partial<Item> = {}): Part => {
  const item = child(1, byNumber(200), { status: 'In progress', threads, slices: [], ...change });
  return { item, kind: 'build', waitsOn: [], thread: threads[0] };
};

test.each<[string, ItemThread[], Partial<Item>, string, string | undefined]>([
  ['its running thread, behind a newer finished one', [quiet, { ...quiet, id: 'older', state: 'running' }], {}, 'working', 'older'],
  ['a finished planner with running child work', [{ ...quiet, hasRunningChildren: true }], {}, 'working', 'newest'],
  ['a finished thread with background tasks, behind a newer finished one', [quiet, { ...quiet, id: 'older', hasRunningChildren: true }], {}, 'working', 'older'],
  ['an active slice', [quiet], { slices: [{ number: 1, repo: 'o/r', title: 'S', progress: 'active' }] as Item['slices'] }, 'working', 'newest'],
  ['a child that is live without running', [{ ...quiet, hasLiveChildren: true }], {}, 'child waiting', 'newest'],
  ['a question beside a running thread', [{ ...quiet, state: 'running' }, { ...quiet, id: 'asks', state: 'needs you' }], {}, 'needs you', 'asks'],
  ['a stopped run', [{ ...quiet, state: 'stopped' }], {}, 'stopped', 'newest'],
  ['a run that ended with nothing left', [quiet], {}, 'finished', 'newest'],
  ['no thread at all', [], {}, 'none', undefined],
])('a build reads its activity from every thread and descendant: %s', (_name, threads, change, kind, thread) => {
  const activity = partActivity(partWith(threads, change));
  expect([activity.kind, activity.thread?.id]).toEqual([kind, thread]);
});

test('while activity is unavailable a part claims no live work, and keeps its question and its thread', () => {
  const slices = [{ number: 1, repo: 'o/r', title: 'S', progress: 'active' }] as Item['slices'];
  const read = (threads: ItemThread[], change: Partial<Item> = {}) => {
    const { kind, thread } = partActivity(partWith(threads, change), false, true);
    return [kind, thread?.id];
  };
  expect(read([{ ...quiet, state: 'running' }])).toEqual(['none', 'newest']);
  expect(read([quiet], { slices }), 'a recorded active slice').toEqual(['none', 'newest']);
  expect(read([{ ...quiet, hasLiveChildren: true }]), 'a live child').toEqual(['none', 'newest']);
  expect(read([{ ...quiet, state: 'needs you' }]), 'a question stands').toEqual(['needs you', 'newest']);
  expect(partActivity(partWith([quiet]), true, true).kind, 'work the status already vouches for').toBe('working');
});

test('a thread running behind a finished one is the thread a part shows, as running', () => {
  expect(shownThread(partWith([quiet, { ...quiet, id: 'older', hasRunningChildren: true }]))).toMatchObject({ id: 'older', state: 'running' });
});

test('a finished part folds into history only once nothing of it is still at work', () => {
  const finished = { status: 'Done', completion: { complete: true, reasons: [] } } as Partial<Item>;
  expect(isHistory(partWith([quiet], finished))).toBe(true);
  expect(isHistory(partWith([], finished)), 'no thread is normal').toBe(true);
  expect(isHistory(partWith([{ ...quiet, hasRunningChildren: true }], finished)), 'background work goes on').toBe(false);
  expect(isHistory(partWith([quiet])), 'not finished').toBe(false);
});
