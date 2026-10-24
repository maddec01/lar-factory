// What the dossiers hold: which items are dossiers, their parts in order with their kinds, waits and threads, and
// which items they take off the rest of the line.

import { expect, test } from 'vite-plus/test';
import type { Item } from '@mux-factory/shared';
import sampleJson from '@mux-factory/shared/test/sample.json' with { type: 'json' };
import { dossiersOf, inDossiers, openWaits, partKind, partsOf } from './dossier-parts.ts';

const items = (sampleJson as unknown as { items: Item[] }).items;
const byNumber = (n: number) => items.find((i) => i.number === n)!;
const child = (number: number, parent: Item, change: Partial<Item> = {}): Item => ({
  ...byNumber(129), id: `PVTI_c${number}`, number, status: 'Shaping', labels: [],
  parent: { number: parent.number!, repo: parent.repo!, title: parent.title, url: parent.url!, state: 'OPEN' }, ...change,
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
  const apple = items.filter((i) => i.repo === 'maddec01/mux-apple');
  expect(dossiersOf(apple, items).map((d) => d.parent.number), '#180 through its Apple build #40').toEqual([180]);
  expect(dossiersOf([], items)).toEqual([]);
});

test('parts run decisions first, research, grill, prototype, then builds, each with its kind from its labels', () => {
  expect(partsOf(byNumber(200), items).map((p) => [p.item.number, p.kind])).toEqual([[203, 'research'], [201, 'grill'], [202, 'prototype'], [140, 'build']]);
  expect(partsOf(byNumber(180), items).map((p) => [p.item.number, p.kind])).toEqual([[181, 'build'], [40, 'build']]);
  expect(partKind({ ...byNumber(201), labels: ['decision: wayfind'] }), 'an unknown decision builds').toBe('build');
});

test("each part carries its blocked-by issues and its newest thread", () => {
  const [research, grill, prototype, build] = partsOf(byNumber(200), items);
  expect(grill!.waitsOn).toEqual([{ number: 203, repo: 'maddec01/mux-server', state: 'CLOSED' }]);
  expect([research!.thread?.title, grill!.thread?.state, prototype!.thread?.state, build!.thread?.state]).toEqual(['Research: hosting cost of the relay', 'running', 'needs you', 'done']);
});

test('a part waits on its open blockers until a thread takes it on', () => {
  const [, grill, , build] = partsOf(byNumber(200), items);
  expect(openWaits(build!).map((b) => b.number)).toEqual([202]);
  expect(openWaits(grill!), 'its blocker closed').toEqual([]);
  expect(openWaits({ ...build!, item: { ...build!.item, status: 'In progress' } }), 'building, whatever it waited for').toEqual([]);
});

test('the dossiers take their parents and parts off the rest of the line', () => {
  const ids = inDossiers(dossiersOf(items, items));
  expect(items.filter((i) => ids.has(i.id)).map((i) => i.number)).toEqual([200, 201, 202, 140, 180, 203, 181, 40]);
});
