import { expect, test } from 'vite-plus/test';

import type { Item, ItemThread } from './model.ts';
import {
    itemActivityAgents,
    itemActivityThread,
    itemActivityLine,
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

const item = (threads: Item['threads'], over: Partial<Item> = {}) =>
    ({ status: 'In progress', threads, ...over }) as Item;

test('a running build owns activity even when a shaping thread still reports live work or a question', () => {
    const shape = thread({
        id: 'shape',
        purpose: 'shape',
        state: 'needs you',
        activity: activity({ action: 'Shaping' }),
    });
    const build = thread({
        id: 'build',
        purpose: 'build',
        activity: activity({ action: 'Implementing', actionAt: ago(0) }),
    });
    const work = item([shape, build], { status: 'In progress' });

    expect(itemActivityThread(work)?.id).toBe('build');
    expect(itemActivityLine(work, NOW)?.action).toBe('Implementing');
    expect(itemActivityAgents(work, NOW)).not.toContainEqual(expect.objectContaining({ action: 'Shaping' }));
    expect(itemActivityThread({ ...work, threads: [shape, { ...build, state: 'done' }] })).toBeUndefined();
});
