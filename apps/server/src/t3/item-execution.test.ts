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
  it('shows a subagent thread only when it is recorded', () => {
    const child = { ...shell, id: 'child', lineage: { relationshipToParent: 'subagent' } };
    expect(executionItemThreads([child])(['child'])).toHaveLength(1);
  });
});

it('exposes discovery-owned thread lookup without transport configuration', () => {
  expect(protocolThreadById('missing-thread').availability).toBe('unavailable');
});
