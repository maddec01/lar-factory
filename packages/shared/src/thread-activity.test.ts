import { readFileSync } from 'node:fs';
import { expect, test } from 'vite-plus/test';

import type { BoardData, Item, ItemThread } from './model.ts';
import {
    ACTIVITY_STALE_MS,
    itemActivityAgents,
    itemActivityLine,
    itemActivityStill,
    sampleActivityFrom,
    threadActivityLine,
    type ThreadActivity,
} from './thread-activity.ts';

const NOW = Date.parse('2026-11-04T12:00:00Z');
const ago = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();
const activity = (over: Partial<Extract<ThreadActivity, { available: true }>> = {}): ThreadActivity => ({
    available: true,
    readAt: ago(0),
    toolRunning: false,
    agents: [],
    ...over,
});
const thread = (over: Partial<ItemThread> = {}): ItemThread => ({
    id: 't',
    title: 'Build',
    state: 'running',
    updated: ago(1),
    ...over,
});

test('a working thread shows its newest action, its age and its agents', () => {
    expect(
        threadActivityLine(
            thread({
                activity: activity({
                    action: 'Read a.ts',
                    actionAt: ago(2),
                    agents: [{ title: 'Review', actionAt: ago(1), action: 'pnpm test' }],
                }),
            }),
            NOW,
        ),
    ).toEqual({ state: 'working', action: 'pnpm test', ageMs: 60_000, agents: 1 });
    expect(
        threadActivityLine(
            thread({
                activity: activity({
                    action: 'Read a.ts',
                    actionAt: ago(2),
                    agents: [{ title: 'Review', actionAt: ago(3), action: 'pnpm test' }],
                }),
            }),
            NOW,
        ),
    ).toEqual({ state: 'working', action: 'Read a.ts', ageMs: 120_000, agents: 1 });
});

test('a thread with no action yet says Starting, and a queued one says Queued', () => {
    expect(threadActivityLine(thread({ activity: activity() }), NOW)).toEqual({
        state: 'working',
        action: 'Starting',
        ageMs: 60_000,
        agents: 0,
    });
    expect(
        threadActivityLine(
            thread({ state: 'done', queued: true, activity: activity({ action: 'Read a.ts', actionAt: ago(90) }) }),
            NOW,
        ),
    ).toEqual({ state: 'working', action: 'Queued', ageMs: 60_000, agents: 0 });
});

test('an agent that has not acted yet does not hide an older action behind Starting', () => {
    expect(
        threadActivityLine(
            thread({
                activity: activity({
                    action: 'Read a.ts',
                    actionAt: ago(2),
                    agents: [{ title: 'Review', actionAt: ago(1) }],
                }),
            }),
            NOW,
        ),
    ).toMatchObject({ state: 'working', action: 'Read a.ts', agents: 1 });
});

test('a thread goes quiet after 5 minutes with no action from it or any agent, unless a tool runs', () => {
    const quiet = (minutes: number, over = {}) =>
        threadActivityLine(
            thread({ activity: activity({ action: 'Read a.ts', actionAt: ago(minutes), ...over }) }),
            NOW,
        );

    expect(quiet(4.9)?.state).toBe('working');
    expect(quiet(5)).toEqual({ state: 'quiet', action: 'No action for 5m', ageMs: 300_000, agents: 0 });
    expect(quiet(72.5)?.action).toBe('No action for 72m');
    expect(quiet(30, { toolRunning: true })).toMatchObject({ state: 'working', action: 'Read a.ts' });
    expect(quiet(30, { agents: [{ title: 'Review', action: 'Grep', actionAt: ago(1) }] })).toMatchObject({
        state: 'working',
        action: 'Grep',
    });
    expect(quiet(30, { agents: [{ title: 'Review', action: 'Grep', actionAt: ago(20) }] })).toMatchObject({
        state: 'quiet',
        action: 'No action for 20m',
        agents: 1,
    });
});

test('a thread waiting on the user or stopped says so, and agents still at work keep a stopped thread working', () => {
    expect(
        threadActivityLine(
            thread({
                state: 'needs you',
                updated: ago(3),
                activity: activity({ action: 'Read a.ts', actionAt: ago(90) }),
            }),
            NOW,
        ),
    ).toEqual({ state: 'waiting', action: 'Waiting on you', ageMs: 180_000, agents: 0 });
    expect(threadActivityLine(thread({ state: 'stopped', updated: ago(3) }), NOW)).toEqual({
        state: 'stopped',
        action: 'Stopped',
        ageMs: 180_000,
        agents: 0,
    });
    expect(
        threadActivityLine(
            thread({
                state: 'stopped',
                activity: activity({ agents: [{ title: 'Review', action: 'Grep', actionAt: ago(1) }] }),
            }),
            NOW,
        ),
    ).toMatchObject({ state: 'working', action: 'Grep', agents: 1 });
});

test('an agent waiting on the user makes its thread wait on you', () => {
    expect(
        threadActivityLine(
            thread({
                state: 'done',
                hasLiveChildren: true,
                childNeedsYou: true,
                updated: ago(3),
                activity: activity(),
            }),
            NOW,
        ),
    ).toEqual({ state: 'waiting', action: 'Waiting on you', ageMs: 180_000, agents: 0 });
});

test('a failed or stale read says unavailable, never an old action', () => {
    const unavailable = { state: 'unavailable', action: 'Activity unavailable', agents: 0 };

    expect(threadActivityLine(thread({ activity: { available: false } }), NOW)).toEqual(unavailable);
    expect(
        threadActivityLine(
            thread({ observedAt: ago(1), activity: activity({ action: 'Read a.ts', actionAt: ago(1) }) }),
            NOW,
        ),
    ).toEqual(unavailable);
    expect(threadActivityLine(thread({ state: 'done', observedAt: ago(1) }), NOW)).toEqual(unavailable);
    expect(threadActivityLine(thread(), NOW), 'a thread at work the server read nothing for').toEqual(unavailable);
});

test('an old read says unavailable, while a fresh one keeps quiet, ages and running tools', () => {
    const unavailable = { state: 'unavailable', action: 'Activity unavailable', agents: 0 };
    const stamped = (ms: number, over: Parameters<typeof activity>[0] = {}) =>
        thread({
            activity: activity({
                action: 'Read a.ts',
                actionAt: ago(1),
                readAt: new Date(NOW - ms).toISOString(),
                ...over,
            }),
        });

    expect(threadActivityLine(stamped(ACTIVITY_STALE_MS), NOW)).toEqual({
        state: 'working',
        action: 'Read a.ts',
        ageMs: 60_000,
        agents: 0,
    });
    expect(threadActivityLine(stamped(ACTIVITY_STALE_MS + 1), NOW)).toEqual(unavailable);
    expect(threadActivityLine(stamped(0, { actionAt: ago(6) }), NOW)?.state).toBe('quiet');
    expect(
        threadActivityLine(stamped(ACTIVITY_STALE_MS + 1, { actionAt: ago(6) }), NOW),
        'an old read cannot say quiet',
    ).toEqual(unavailable);
    expect(threadActivityLine(stamped(0, { actionAt: ago(30), toolRunning: true }), NOW)).toMatchObject({
        state: 'working',
        ageMs: 30 * 60_000,
    });
});

test('a thread that finished with nothing at work shows nothing', () => {
    expect(threadActivityLine(thread({ state: 'done' }), NOW)).toBeUndefined();
});

const item = (threads: Item['threads'], over: Partial<Item> = {}) =>
    ({ status: 'In progress', threads, ...over }) as Item;
const working = (id: string, action: string) => thread({ id, activity: activity({ action, actionAt: ago(1) }) });

test('a row follows its newest thread at work, skipping finished and archived ones', () => {
    expect(
        itemActivityLine(
            item([thread({ id: 'new', state: 'done' }), working('older', 'Read a.ts'), working('oldest', 'Read b.ts')]),
            NOW,
        )?.action,
    ).toBe('Read a.ts');
    expect(
        itemActivityLine(item([{ ...working('new', 'Read a.ts'), archived: true }, working('older', 'Read b.ts')]), NOW)
            ?.action,
    ).toBe('Read b.ts');
    expect(itemActivityLine(item([thread({ state: 'done' })]), NOW)).toBeUndefined();
    expect(itemActivityLine(item([]), NOW)).toBeUndefined();
    expect(itemActivityLine(item(undefined), NOW)).toBeUndefined();
});

test('a paused or archived item shows no line', () => {
    expect(itemActivityLine(item([working('t', 'Read a.ts')], { paused: 'Paused' }), NOW)).toBeUndefined();
    expect(
        itemActivityLine(
            item([working('t', 'Read a.ts')], { archived: { setAside: true, hidden: false, ticketOpen: true } }),
            NOW,
        ),
    ).toBeUndefined();
});

test('a stopped thread counts only as the newest thread of work still under way', () => {
    const stopped = thread({ state: 'stopped' });

    expect(itemActivityLine(item([stopped]), NOW)?.state).toBe('stopped');
    expect(itemActivityLine(item([stopped], { status: 'Shaping' }), NOW)?.state).toBe('stopped');
    expect(itemActivityLine(item([thread({ state: 'done' }), stopped]), NOW), 'a later run finished').toBeUndefined();
    expect(itemActivityLine(item([stopped], { status: 'Done' }), NOW)).toBeUndefined();
});

test("a row says unavailable when T3 or the page can't be read, and only for work that may be under way", () => {
    const line = { state: 'unavailable', action: 'Activity unavailable', agents: 0 };

    expect(itemActivityLine(item('unavailable'), NOW)).toEqual(line);
    expect(itemActivityLine(item('unavailable', { status: 'Done' }), NOW)).toBeUndefined();
    expect(itemActivityLine(item([working('t', 'Read a.ts')]), NOW, true)).toEqual(line);
    expect(itemActivityLine(item([thread({ state: 'done' })]), NOW, true)).toBeUndefined();
    expect(itemActivityLine(item([thread({ state: 'done', observedAt: ago(1) })]), NOW)).toBeUndefined();
});

test("only a thread that waits, stopped or can't be read holds a row still", () => {
    expect(itemActivityStill(item([thread({ state: 'stopped' })]), NOW)).toBe(true);
    expect(itemActivityStill(item([thread({ state: 'needs you', activity: activity() })]), NOW)).toBe(true);
    expect(itemActivityStill(item([thread({ activity: { available: false } })]), NOW)).toBe(true);
    expect(
        itemActivityStill(item([thread({ activity: activity({ actionAt: ago(60) }) })]), NOW),
        'quiet is still at work',
    ).toBe(false);
    expect(itemActivityStill(item([working('t', 'Read a.ts')]), NOW)).toBe(false);
    expect(itemActivityStill(item([]), NOW)).toBe(false);

    const old = thread({ activity: activity({ readAt: new Date(NOW - ACTIVITY_STALE_MS - 1).toISOString() }) });

    expect(itemActivityStill(item([old]), NOW), 'an old read').toBe(true);
    expect(itemActivityAgents(item([old]), NOW)).toBe('unavailable');
    expect(itemActivityAgents(item([working('t', 'Read a.ts')]), NOW)).toEqual([
        { title: 'Lead thread', action: 'Read a.ts', actionAt: ago(1) },
    ]);
});

test('the sample has a row for each state, whenever the sample board runs', () => {
    const sample = JSON.parse(readFileSync(new URL('../test/sample.json', import.meta.url), 'utf8')) as BoardData;
    const lines = sampleActivityFrom(sample, NOW)
        .items.flatMap((item) => (Array.isArray(item.threads) ? item.threads : []))
        .filter((t) => t.activity)
        .map((t) => threadActivityLine(t, NOW)!);

    expect(lines.map((line) => [line.state, line.action, line.agents])).toEqual(
        expect.arrayContaining([
            ['working', 'Edit scrubber.tsx', 0],
            ['working', 'pnpm test', 3],
            ['quiet', 'No action for 12m', 0],
            ['waiting', 'Waiting on you', 1],
            ['stopped', 'Stopped', 0],
        ]),
    );

    const later = NOW + 60 * 60_000;

    expect(
        sampleActivityFrom(sample, NOW)
            .items.flatMap((item) => (Array.isArray(item.threads) ? item.threads : []))
            .filter((t) => t.activity?.available)
            .map((t) => threadActivityLine(t, later)!.state),
        'an hour on, the sample has read nothing and its reads still count',
    ).not.toContain('unavailable');
});
