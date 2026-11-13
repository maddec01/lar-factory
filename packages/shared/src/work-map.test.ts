import { expect, test } from 'vite-plus/test';

import sample from '../test/sample.json' with { type: 'json' };
import { parseConceptMap } from './concept-map.ts';
import type { DependencyHold, Item } from './model.ts';
import { projectWorkMap } from './work-map.ts';

const base = sample.items[0] as unknown as Item;
const part = (id: string, change: Partial<Item> = {}): Item => ({
    ...base,
    id,
    number: 0,
    kind: 'issue',
    status: 'Queued',
    parentId: 'group',
    blockers: [],
    ...change,
});
const blocker = (workId: string): Item['blockers'][number] => ({ workId, number: 0, repo: base.repo, state: 'open' });

test('nodes and blocker edges follow additions, removals and reparenting, ignoring stale map text', () => {
    const parent = part('group', { parentId: null, map: parseConceptMap('## Map\n- b waits for a\n- a is Ready') });
    const a = part('a');
    const b = part('b', { blockers: [blocker('a')] });
    const records = [parent, a, b, part('unrelated', { parentId: 'other' })];
    const first = projectWorkMap(records, 'group');

    expect(first.nodes.map((node) => node.item.id)).toEqual(['a', 'b']);
    expect(first.edges).toEqual([{ from: 'a', to: 'b', kind: 'blocker' }]);
    expect(projectWorkMap([parent, a, { ...b, blockers: [] }], 'group').edges).toEqual([]);
    expect(projectWorkMap([...records, part('c', { blockers: [blocker('b')] })], 'group').edges).toEqual([
        ...first.edges,
        { from: 'b', to: 'c', kind: 'blocker' },
    ]);

    const removed = projectWorkMap([parent, { ...a, parentId: 'other' }, b], 'group');

    expect(removed.nodes.map((node) => node.item.id)).toEqual(['b']);
    expect(removed.prerequisites.map((node) => node.id)).toEqual(['blocker:a']);
    expect(removed.edges).toEqual([{ from: 'blocker:a', to: 'b', kind: 'blocker' }]);
});

test('status, queue membership, gate state and wait reasons always come from current records', () => {
    const a = part('a', { status: 'List', passingBrief: false });

    expect(projectWorkMap([a]).nodes[0]).toMatchObject({
        status: 'List',
        queued: false,
        gate: 'not passed',
        waits: ['Brief gate has not passed', 'Not queued'],
    });

    const ready = { ...a, status: 'Ready' as const, passingBrief: true, blockers: [blocker('other')] };
    const next = projectWorkMap([ready]).nodes[0]!;

    expect(next).toMatchObject({ status: 'Ready', queued: true, gate: 'passed' });
    expect(next.waits.join()).toContain('Blocked by');
    expect(projectWorkMap([{ ...ready, status: 'Done', blockers: [], state: 'closed' }]).nodes[0]).toMatchObject({
        status: 'Done',
        waits: [],
    });
    expect(projectWorkMap([part('aside', { state: 'closed', closedAs: 'not-planned' })]).nodes).toHaveLength(1);
});

test('recorded Dependencies have their own nodes and edges, even when their ticket is a group part', () => {
    const a = part('a', { number: 1 });
    const hold: DependencyHold = {
        dependencyId: 'environment',
        revision: 1,
        owner: 'Environment team',
        need: 'Enable access',
        ticket: `${a.repo}#1`,
        named: [],
        evidence: '',
        met: null,
        needsReview: false,
        observation: null,
    };
    const b = part('b', { blockers: [{ number: 1, repo: a.repo, state: 'open', dependency: hold }] });
    const graph = projectWorkMap([a, b]);

    expect(graph.edges).toEqual([{ from: 'dependency:environment', to: 'b', kind: 'dependency' }]);
    expect(graph.prerequisites[0]).toMatchObject({ kind: 'dependency', title: 'Environment team: Enable access' });

    const accepted = projectWorkMap([
        a,
        {
            ...b,
            blockers: [
                { ...b.blockers[0]!, state: 'closed', dependency: { ...hold, met: { by: 'Pedro', at: '2026-11-13' } } },
            ],
        },
    ]);

    expect(accepted.prerequisites[0]?.blocker.dependency?.met).toEqual({ by: 'Pedro', at: '2026-11-13' });
    expect(accepted.nodes[1]?.waits).toEqual([]);
    expect(projectWorkMap([a, { ...b, blockers: [] }]).prerequisites).toEqual([]);
});
