import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import type { Item } from './item-domain.ts';
import { startActionChoice, startAfterRef } from './start-action.ts';

const item = (patch: Partial<Item>): Item => ({ ...(sample.items[0] as Item), threads: [], ...patch });

test.each([
    [{ status: 'Queued', kind: 'build' }, 'Shape'],
    [{ status: 'Queued', kind: 'concept' }, 'Shape'],
    [{ status: 'Queued', kind: 'decision', decisionMethod: 'task' }, 'Decide'],
    [{ status: 'Ready', kind: 'build' }, 'Build'],
    [{ status: 'Ready', kind: 'concept' }, 'Build all'],
    [{ status: 'Queued', kind: 'issue', recorded: false, labels: ['decision-task'] }, 'Decide'],
    [{ status: 'Queued', kind: 'build', recorded: true, labels: ['decision-task'] }, 'Shape'],
    [{ status: 'Queued', kind: 'issue', recorded: false, labels: ['decision-unknown'] }, 'Shape'],
] satisfies [Partial<Item>, string][])('%j names the work it starts', (patch, label) => {
    expect(startActionChoice(item(patch)).label).toBe(label);
});

test('a deferred start names both the work and prerequisite, armed or unarmed', () => {
    const work = item({ status: 'Ready' });

    expect(startActionChoice(work, 'build', { prerequisite: '#42', armed: false }).label).toBe('Start after #42');
    expect(startActionChoice(work, 'build', { prerequisite: 'server team', armed: true }).label).toBe(
        'Starts after server team',
    );
});

test('a deferred start without a short name for its prerequisite starts when unblocked', () => {
    expect(startActionChoice(item({ status: 'Ready' }), 'build', { prerequisite: null, armed: false }).label).toBe(
        'Start when unblocked',
    );
    expect(startActionChoice(item({ status: 'Ready' }), 'build', { prerequisite: null, armed: true }).label).toBe(
        'Starts when unblocked',
    );
});

test('a deferred start names its last open blocker by number, then by part number, never by its title', () => {
    const repo = 'acme/app';
    const blocker = { repo, state: 'open' as const, number: 0, workId: 'W_sign_in', title: 'Sign in with a long name' };
    const held = item({ repo, blockers: [{ repo, state: 'closed', number: 7 }, blocker] });
    const part = item({ id: 'W_sign_in', partOrder: 15 });

    expect(startAfterRef(held, [part])).toBe('Part 15');
    expect(startAfterRef(held, [])).toBeNull();
    expect(startAfterRef({ ...held, blockers: [{ ...blocker, number: 42 }] })).toBe('#42');
    expect(startAfterRef({ ...held, blockers: [{ ...blocker, number: 42, repo: 'acme/api' }] })).toBe('api#42');
    expect(startAfterRef({ ...held, blockers: [] })).toBeNull();
});
