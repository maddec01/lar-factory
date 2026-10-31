import { describe, it, expect } from 'vite-plus/test';
import { executionItemThreads, protocolThreadById } from './item-execution.ts';
import type { ExecutionRead } from './execution-protocol.ts';

describe('protocol item association', () => {
  const shell = { id: 'root', title: 'Build', updatedAt: '2026-10-31T12:00:00Z', archivedAt: '2026-10-31T12:00:00Z', status: 'idle' };
  const read: ExecutionRead = { availability: 'available', observation: { observedAt: shell.updatedAt, projection: { thread: shell, messages: [
    { role: 'user', text: '$lar-work Owner/Repo#708', createdAt: '2026-10-30T12:00:00Z' },
    { role: 'user', text: '$lar-work Owner/Repo#636', createdAt: shell.updatedAt },
  ] } } };
  it('includes archived roots and associates only the first user message', () => {
    const lookup = executionItemThreads([shell], new Map([['root', read]]));
    expect(lookup('owner/repo', 708)).toEqual([{ id: 'root', title: 'Build', state: 'done', updated: shell.updatedAt }]);
    expect(lookup('owner/repo', 636)).toBeUndefined();
  });
  it('distinguishes successful empty from disconnected projections', () => {
    expect(executionItemThreads([], new Map())('owner/repo', 708)).toBeUndefined();
    expect(() => executionItemThreads([shell], new Map())).toThrow('Execution unavailable');
    expect(() => executionItemThreads([shell], new Map([['root', { ...read, availability: 'unavailable' }]]))).toThrow('Execution unavailable');
  });
  it('does not associate descendants independently', () => {
    expect(executionItemThreads([{ ...shell, lineage: { relationshipToParent: 'subagent' } }], new Map())('owner/repo', 708)).toBeUndefined();
  });
});

it('exposes discovery-owned thread lookup without transport configuration', () => {
  expect(protocolThreadById('missing-thread').availability).toBe('unavailable');
});
