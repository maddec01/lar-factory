import { describe, it, expect } from 'vite-plus/test';
import { executionItemThreads, protocolThreadById } from './item-execution.ts';

describe('recorded thread lookup', () => {
  const shell = { id: 'root', title: 'Build', updatedAt: '2026-10-31T12:00:00Z', status: 'idle' };
  it('shows the recorded threads, archived ones too, whatever their first message names', () => {
    const lookup = executionItemThreads([shell, { ...shell, id: 'other' }, { ...shell, id: 'put-away', archivedAt: shell.updatedAt }]);
    expect(lookup(['root'])).toEqual([{ id: 'root', title: 'Build', state: 'done', updated: shell.updatedAt }]);
    expect(lookup(['put-away'])).toEqual([{ id: 'put-away', title: 'Build', state: 'done', archived: true, updated: shell.updatedAt }]);
  });
  it('keeps showing a settled thread, which has a link as any other', () => {
    const lookup = executionItemThreads([{ ...shell, settledAt: shell.updatedAt, settledOverride: 'settled' }]);
    expect(lookup(['root'])).toEqual([{ id: 'root', title: 'Build', state: 'done', updated: shell.updatedAt }]);
  });
  describe('order, since settling moves updatedAt', () => {
    const order = (shells: object[]) => executionItemThreads(shells as Record<string, unknown>[])(['shaping', 'build'])?.map(thread => thread.id);
    const build = { ...shell, id: 'build', updatedAt: '2026-11-02T20:37:30Z', latestRunCompletedAt: '2026-11-02T20:37:30Z' };
    const shaping = { ...shell, id: 'shaping', updatedAt: '2026-11-02T20:38:51Z', latestRunCompletedAt: '2026-11-02T20:37:13Z' };
    it('keeps a just-settled shaping thread behind the build it preceded', () => {
      expect(order([build, { ...shaping, settledAt: shaping.updatedAt, settledOverride: 'settled' }])).toEqual(['build', 'shaping']);
    });
    it('keeps a settled thread with no known run behind an unsettled one', () => {
      expect(order([build, { ...shaping, settledOverride: 'settled', latestRunCompletedAt: null }])).toEqual(['build', 'shaping']);
    });
    it('keeps a build T3 settled on its own ahead of an older unsettled shaping thread', () => {
      const autoSettled = { ...build, updatedAt: '2026-11-05T00:00:00Z', settledAt: '2026-11-05T00:00:00Z' };
      expect(order([autoSettled, { ...shaping, updatedAt: '2026-11-02T20:37:13Z' }])).toEqual(['build', 'shaping']);
    });
    it('still shows an unsettled thread by its latest update', () => {
      expect(order([build, shaping])).toEqual(['shaping', 'build']);
    });
  });
  it('leaves out a recorded thread T3 no longer has, and has nothing to show for work with no recorded thread', () => {
    const lookup = executionItemThreads([{ ...shell, id: 'gone', deletedAt: shell.updatedAt }]);
    expect(lookup(['root', 'gone'])).toEqual([]);
    expect(lookup([])).toBeUndefined();
  });
  it('distinguishes running descendants from waiting descendants', () => {
    const parent = { ...shell, status: 'interrupted' };
    const child = { ...shell, id: 'child', status: 'running', lineage: { parentThreadId: 'root' } };
    expect(executionItemThreads([parent, child])(['root'])?.[0]).toMatchObject({ hasRunningChildren: true, hasLiveChildren: true });
    expect(executionItemThreads([parent, { ...child, status: 'waiting' }])(['root'])?.[0]).not.toHaveProperty('hasRunningChildren');
  });
  it('keeps a finished thread at work while it or a descendant has background tasks, without holding a start', () => {
    const parent = { ...shell, status: 'completed' };
    const child = { ...shell, id: 'child', status: 'completed', lineage: { parentThreadId: 'root' }, pendingBackgroundTasks: [{ kind: 'subagent' }] };
    const [own] = executionItemThreads([{ ...parent, pendingBackgroundTasks: [{ kind: 'shell' }] }])(['root'])!;
    expect(own).toMatchObject({ state: 'done', hasRunningChildren: true });
    expect(own).not.toHaveProperty('hasLiveChildren');
    expect(executionItemThreads([parent, child])(['root'])?.[0]).toMatchObject({ state: 'done', hasRunningChildren: true });
    for (const noSignal of [[], { kind: 'shell' }, undefined]) expect(executionItemThreads([{ ...parent, pendingBackgroundTasks: noSignal }])(['root'])?.[0]).not.toHaveProperty('hasRunningChildren');
  });
  it('shows current descendant tasks, including background checks, and drops them when they finish', () => {
    const parent = { ...shell, status: 'completed' };
    const child = { ...shell, id: 'fixer', title: 'Fix startup test failures', status: 'running', lineage: { parentThreadId: 'missing', rootThreadId: 'root' } };
    const read = (changes = {}) => executionItemThreads([parent, { ...child, ...changes }])(['root'])![0]!;
    expect(read().childActivity).toEqual({ titles: ['Fix startup test failures'], count: 1 });
    expect(read({ status: 'completed', pendingBackgroundTasks: [{ kind: 'shell' }] }).childActivity).toEqual({ titles: ['Fix startup test failures'], count: 1 });
    for (const status of ['waiting', 'queued', 'completed', 'cancelled']) expect(read({ status }).childActivity).toBeUndefined();
    expect(read({ deletedAt: shell.updatedAt }).childActivity).toBeUndefined();
    expect(read({ lineage: { parentThreadId: 'unrelated' } }).childActivity).toBeUndefined();
  });
  it('bounds task titles while counting each descendant once through parent and root paths', () => {
    const children = Array.from({ length: 8 }, (_, i) => ({ ...shell, id: `child-${i}`, title: `Task ${i}`, status: 'running', pendingBackgroundTasks: [{ kind: 'shell' }], lineage: { parentThreadId: 'root', rootThreadId: 'root' } }));
    const parent = executionItemThreads([shell, ...children])(['root'])![0]!;
    expect(parent.childActivity).toEqual({ titles: ['Task 0', 'Task 1', 'Task 2'], count: 8 });
  });
  it('marks a queued thread, still done, and holds its ancestors as live', () => {
    const parent = { ...shell, status: 'idle' };
    const child = { ...shell, id: 'child', status: 'idle', lineage: { parentThreadId: 'root', rootThreadId: 'root' } };
    const grandchild = { ...shell, id: 'grandchild', status: 'queued', lineage: { parentThreadId: 'child', rootThreadId: 'root' } };
    expect(executionItemThreads([{ ...shell, status: 'queued' }])(['root'])).toEqual([
      { id: 'root', title: 'Build', state: 'done', queued: true, updated: shell.updatedAt },
    ]);
    expect(executionItemThreads([parent, child, grandchild])(['root', 'child'])).toMatchObject([
      { id: 'root', state: 'done', hasLiveChildren: true }, { id: 'child', hasLiveChildren: true },
    ]);
    expect(executionItemThreads([parent, child, grandchild])(['root'])?.[0]).not.toHaveProperty('hasRunningChildren');
    expect(executionItemThreads([parent])(['root'])?.[0]).not.toHaveProperty('queued');
  });
  it('keeps an active run visible when a newer message was cancelled or queued', () => {
    for (const status of ['cancelled', 'queued', 'completed']) {
      const lookup = executionItemThreads([{ ...shell, status, activeRunId: 'older-run', activityRunStatus: 'running' }]);
      expect(lookup(['root'])?.[0]).toMatchObject({ state: 'running', currentRunning: true });
      expect(lookup(['root'])?.[0]).not.toHaveProperty('queued');
    }
    expect(executionItemThreads([{ ...shell, status: 'cancelled', activityRunStatus: 'waiting' }])(['root'])?.[0]).toMatchObject({ state: 'running' });
    expect(executionItemThreads([{ ...shell, activityRunStatus: 'running', pendingRuntimeRequest: { id: 'question' } }])(['root'])?.[0]).toMatchObject({ state: 'needs you' });
    expect(executionItemThreads([{ ...shell, status: 'cancelled', activityRunStatus: null }])(['root'])?.[0]).toMatchObject({ state: 'stopped' });
  });
  it('shows a subagent thread only when it is recorded', () => {
    const child = { ...shell, id: 'child', lineage: { relationshipToParent: 'subagent' } };
    expect(executionItemThreads([child])(['child'])).toHaveLength(1);
  });
  it('keeps an interrupted root held while one of its nested child threads runs or waits', () => {
    const parent = { ...shell, status: 'interrupted' };
    const child = { ...shell, id: 'child', status: 'idle', lineage: { parentThreadId: 'root', rootThreadId: 'root' } };
    const grandchild = { ...shell, id: 'grandchild', status: 'running', lineage: { parentThreadId: 'child', rootThreadId: 'root' } };
    expect(executionItemThreads([parent, child, grandchild])(['root', 'child'])).toMatchObject([
      { id: 'root', state: 'stopped', hasLiveChildren: true }, { id: 'child', hasLiveChildren: true },
    ]);
    expect(executionItemThreads([parent, { ...grandchild, pendingRuntimeRequest: { id: 'question' } }])(['root'])).toMatchObject([{ hasLiveChildren: true }]);
    expect(executionItemThreads([parent, { ...grandchild, status: 'cancelled' }])(['root'])).toEqual([
      { id: 'root', title: 'Build', state: 'stopped', updated: shell.updatedAt },
    ]);
  });
});

it('exposes discovery-owned thread lookup without transport configuration', () => {
  expect(protocolThreadById('missing-thread').availability).toBe('unavailable');
});
