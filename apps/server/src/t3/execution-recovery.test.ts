import { expect, it } from 'vite-plus/test';
import { ExecutionRecovery } from './execution-recovery.ts';

it('retains thread facts across stale snapshots and accepts equal-sequence fragments', () => {
  const recovery = new ExecutionRecovery('thread-1');
  const projection = { thread: { id: 'thread-1' }, runs: [], attempts: [], nodes: [], subagents: [], providerSessions: [], providerThreads: [], providerTurns: [], runtimeRequests: [], messages: [], updatedAt: '2026-10-31T00:00:00Z' };
  expect(recovery.accept({ kind: 'snapshot', snapshotSequence: 4, projection }, 0)).toBe(true);
  expect(recovery.accept({ kind: 'snapshot', snapshotSequence: 3, projection }, 1)).toBe(false);
  expect(recovery.observation()?.observedAt).toBe('1970-01-01T00:00:00.000Z');
  expect(recovery.accept({ kind: 'snapshot', snapshotSequence: 4, projection: { ...projection, messages: [{ id: 'message-1' }] } }, 2)).toBe(true);
  expect(recovery.observation()?.projection.messages).toEqual([{ id: 'message-1' }]);
  expect(() => recovery.accept({ kind: 'snapshot', snapshotSequence: 5, projection: { ...projection, thread: { id: 'other' } } })).toThrow();
});
