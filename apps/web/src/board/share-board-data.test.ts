import { expect, test } from 'vite-plus/test';
import type { BoardData } from '@lar-factory/shared';
import sampleJson from '@lar-factory/shared/test/sample.json' with { type: 'json' };
import { shareBoardData } from './share-board-data.ts';

const sample = sampleJson as unknown as BoardData;
const clone = <T,>(value: T): T => structuredClone(value);

test('the first accepted board needs no previous snapshot', () => {
  expect(shareBoardData(null, sample)).toBe(sample);
});

test('an identical wire snapshot reuses the board and changing one item keeps every other item and setting', () => {
  expect(shareBoardData(sample, clone(sample))).toBe(sample);
  const next = clone(sample);
  next.items[0]!.title = 'New tracker title';
  const shared = shareBoardData(sample, next);
  expect(shared).toEqual(next);
  expect(shared.items[0]).not.toBe(sample.items[0]);
  expect(shared.items[0]!.labels).toBe(sample.items[0]!.labels);
  expect(shared.items.slice(1).every((item, i) => item === sample.items[i + 1])).toBe(true);
  expect(shared.repos).toBe(sample.repos);
  expect(shared.tools).toBe(sample.tools);
  expect(sample.items[0]!.title).not.toBe('New tracker title');
});

test('inserting, reordering and deleting items preserves identity by work ID and the incoming order', () => {
  const inserted = { ...clone(sample.items[0]!), id: 'new-work' };
  const next = { ...clone(sample), items: [inserted, ...clone(sample.items).reverse().slice(1)] };
  const shared = shareBoardData(sample, next);
  expect(shared).toEqual(next);
  const previous = new Map(sample.items.map((item) => [item.id, item]));
  expect(shared.items.slice(1).every((item) => item === previous.get(item.id))).toBe(true);
});

test('fresh activity read times, actions, agent lists and tracker checks are never treated as unchanged', () => {
  const thread = { id: 't', title: 'Build', state: 'running' as const, updated: '2026-11-05T10:00:00Z',
    activity: { available: true as const, readAt: '2026-11-05T10:00:00Z', action: 'Read a.ts', toolRunning: false, agents: [{ title: 'Review', action: 'Read b.ts' }] } };
  const before = { ...sample, items: [{ ...sample.items[0]!, threads: [thread] }] };
  const next = clone(before);
  next.items[0]!.threads[0]!.activity.readAt = '2026-11-05T10:00:02Z';
  let shared = shareBoardData(before, next);
  expect(shared).toEqual(next);
  expect(shared.items[0]!.threads).not.toBe(before.items[0]!.threads);
  expect((shared.items[0]!.threads as typeof before.items[0]['threads'])[0]!.activity.agents).toBe(thread.activity.agents);
  next.items[0]!.threads[0]!.activity.action = 'Run tests';
  next.items[0]!.threads[0]!.activity.agents = [];
  shared = shareBoardData(shared, clone(next));
  expect(shared).toEqual(next);
});

test('connection health and removed fields propagate even when no item changes', () => {
  const before = { ...sample, localProblem: 'Disconnected', t3Availability: { availability: 'unavailable' as const } };
  const next = clone(before) as BoardData;
  delete next.localProblem;
  next.t3Availability = { availability: 'available' };
  next.fetchedAt = '2026-11-05T10:00:00Z';
  const shared = shareBoardData(before, next);
  expect(shared).toEqual(next);
  expect(shared).not.toHaveProperty('localProblem');
  expect(shared.items).toBe(before.items);
});

test('a tracker check result and usage figures propagate on the first snapshot carrying them', () => {
  const next = clone(sample);
  const item = next.items.find((item) => item.linkedPrs.some((pr) => pr.checks))!;
  const pr = item.linkedPrs.find((pr) => pr.checks)!;
  pr.checks = { ...pr.checks!, failed: pr.checks!.failed + 1 };
  item.stats = { agentMs: 60_000, tokens: 200, costUsd: 1.25 };
  const shared = shareBoardData(sample, next);
  expect(shared).toEqual(next);
  expect(shared.items.find((before) => before.id === item.id)).not.toBe(sample.items.find((before) => before.id === item.id));
});

test('record keys are preserved as data without changing object prototypes', () => {
  const next = clone(sample);
  next.items[0]!.labelColors = JSON.parse('{"__proto__":"ff0000","constructor":"00ff00"}');
  const shared = shareBoardData(sample, next);
  expect(Object.hasOwn(shared.items[0]!.labelColors!, '__proto__')).toBe(true);
  expect(shared.items[0]!.labelColors).toEqual(next.items[0]!.labelColors);
  expect(Object.getPrototypeOf(shared.items[0]!.labelColors)).toBe(Object.prototype);
});
