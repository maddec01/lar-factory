import { describe, it, expect } from 'vite-plus/test';
import { executionItemThreads, protocolThreadById } from './item-execution.ts';

describe('recorded thread lookup', () => {
  const shell = { id: 'root', title: 'Build', updatedAt: '2026-10-31T12:00:00Z', archivedAt: '2026-10-31T12:00:00Z', status: 'idle' };
  it('shows the recorded threads, archived ones too, whatever their first message names', () => {
    const lookup = executionItemThreads([shell, { ...shell, id: 'other' }]);
    expect(lookup(['root'])).toEqual([{ id: 'root', title: 'Build', state: 'done', updated: shell.updatedAt }]);
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
