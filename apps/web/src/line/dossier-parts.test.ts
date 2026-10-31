// What the dossiers hold: which items are dossiers, their parts in order with their kinds, waits and threads, and
// which items they take off the rest of the line.

import { expect, test } from 'vite-plus/test';
import type { Item } from '@lar-factory/shared';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { DECISION_KINDS, dossiersOf, inDossiers, openWaits, partKind, partWaves, partsOf } from './dossier-parts.ts';

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
  expect(partKind({ ...byNumber(201), labels: ['decision-wayfind'] }), 'an unknown decision builds').toBe('build');
  expect(partKind({ ...byNumber(201), labels: [['decision:', 'grill'].join(' ')] }), 'the old decision label builds').toBe('build');
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

test('the dossiers take their parents and parts off the rest of the line', () => {
  const ids = inDossiers(dossiersOf(items, items));
  expect(items.filter((i) => ids.has(i.id)).map((i) => i.number)).toEqual([200, 201, 202, 140, 180, 203, 181, 40]);
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
