import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';
import type { BoardData, ItemThread } from './model.ts';
import { sampleActivityFrom, threadActivityLine, type ThreadActivity } from './thread-activity.ts';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const activity = (over: Partial<Extract<ThreadActivity, { available: true }>> = {}): ThreadActivity => ({ available: true, toolRunning: false, agents: [], ...over });
const thread = (over: Partial<ItemThread> = {}): ItemThread => ({ id: 't', title: 'Build', state: 'running', updated: ago(1), ...over });

test('a working thread shows its newest action, its age and its agents', () => {
  expect(threadActivityLine(thread({ activity: activity({ action: 'Read a.ts', actionAt: ago(2), agents: [{ title: 'Review', actionAt: ago(1), action: 'pnpm test' }] }) }), NOW))
    .toEqual({ state: 'working', action: 'pnpm test', ageMs: 60_000, agents: 1 });
  expect(threadActivityLine(thread({ activity: activity({ action: 'Read a.ts', actionAt: ago(2), agents: [{ title: 'Review', actionAt: ago(3), action: 'pnpm test' }] }) }), NOW))
    .toEqual({ state: 'working', action: 'Read a.ts', ageMs: 120_000, agents: 1 });
});

test('a thread with no action yet says Starting, and a queued one says Queued', () => {
  expect(threadActivityLine(thread({ activity: activity() }), NOW)).toEqual({ state: 'working', action: 'Starting', ageMs: 60_000, agents: 0 });
  expect(threadActivityLine(thread({ state: 'done', queued: true, activity: activity({ action: 'Read a.ts', actionAt: ago(90) }) }), NOW))
    .toEqual({ state: 'working', action: 'Queued', ageMs: 60_000, agents: 0 });
});

test('an agent that has not acted yet does not hide an older action behind Starting', () => {
  expect(threadActivityLine(thread({ activity: activity({ action: 'Read a.ts', actionAt: ago(2), agents: [{ title: 'Review', actionAt: ago(1) }] }) }), NOW))
    .toMatchObject({ state: 'working', action: 'Read a.ts', agents: 1 });
});

test('a thread goes quiet after 5 minutes with no action from it or any agent, unless a tool runs', () => {
  const quiet = (minutes: number, over = {}) => threadActivityLine(thread({ activity: activity({ action: 'Read a.ts', actionAt: ago(minutes), ...over }) }), NOW);
  expect(quiet(4.9)?.state).toBe('working');
  expect(quiet(5)).toEqual({ state: 'quiet', action: 'No action for 5m', ageMs: 300_000, agents: 0 });
  expect(quiet(72.5)?.action).toBe('No action for 72m');
  expect(quiet(30, { toolRunning: true })).toMatchObject({ state: 'working', action: 'Read a.ts' });
  expect(quiet(30, { agents: [{ title: 'Review', action: 'Grep', actionAt: ago(1) }] })).toMatchObject({ state: 'working', action: 'Grep' });
  expect(quiet(30, { agents: [{ title: 'Review', action: 'Grep', actionAt: ago(20) }] })).toMatchObject({ state: 'quiet', action: 'No action for 20m', agents: 1 });
});

test('a thread waiting on the user or stopped says so, and agents still at work keep a stopped thread working', () => {
  expect(threadActivityLine(thread({ state: 'needs you', updated: ago(3), activity: activity({ action: 'Read a.ts', actionAt: ago(90) }) }), NOW))
    .toEqual({ state: 'waiting', action: 'Waiting on you', ageMs: 180_000, agents: 0 });
  expect(threadActivityLine(thread({ state: 'stopped', updated: ago(3) }), NOW)).toEqual({ state: 'stopped', action: 'Stopped', ageMs: 180_000, agents: 0 });
  expect(threadActivityLine(thread({ state: 'stopped', activity: activity({ agents: [{ title: 'Review', action: 'Grep', actionAt: ago(1) }] }) }), NOW))
    .toMatchObject({ state: 'working', action: 'Grep', agents: 1 });
});

test('a failed or stale read says unavailable, never an old action', () => {
  const unavailable = { state: 'unavailable', action: 'Activity unavailable', agents: 0 };
  expect(threadActivityLine(thread({ activity: { available: false } }), NOW)).toEqual(unavailable);
  expect(threadActivityLine(thread({ observedAt: ago(1), activity: activity({ action: 'Read a.ts', actionAt: ago(1) }) }), NOW)).toEqual(unavailable);
  expect(threadActivityLine(thread({ state: 'done', observedAt: ago(1) }), NOW)).toEqual(unavailable);
  expect(threadActivityLine(thread(), NOW), 'a thread at work the server read nothing for').toEqual(unavailable);
});

test('a thread that finished with nothing at work shows nothing', () => {
  expect(threadActivityLine(thread({ state: 'done' }), NOW)).toBeUndefined();
});

test('the sample has a row for each state, whenever the sample board runs', () => {
  const sample = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;
  const lines = sampleActivityFrom(sample, NOW).items.flatMap((item) => (Array.isArray(item.threads) ? item.threads : []))
    .filter((t) => t.activity).map((t) => threadActivityLine(t, NOW)!);
  expect(lines.map((line) => [line.state, line.action, line.agents])).toEqual(expect.arrayContaining([
    ['working', 'Edit scrubber.tsx', 0],
    ['working', 'pnpm test', 3],
    ['quiet', 'No action for 12m', 0],
    ['waiting', 'Waiting on you', 1],
    ['stopped', 'Stopped', 0],
  ]));
});
