import { afterEach, expect, it, vi } from 'vite-plus/test';
import type { ExecutionRead, ShellRead } from './execution-protocol.ts';

const fixture = vi.hoisted(() => ({ changed: undefined as ((read: ShellRead) => void) | undefined,
  read: vi.fn<(id: string) => Promise<ExecutionRead>>() }));
vi.mock('../json-file.ts', () => ({ readJsonRecord: () => ({ origin: 'http://localhost:3773', serverVersion: 'fixture', pid: 1 }) }));
vi.mock('./t3-settings.ts', () => ({ serverRuntimePath: () => '/fixture', t3Running: () => true }));
vi.mock('./board-projects.ts', () => ({ boardProjects: () => ({}) }));
vi.mock('./execution-protocol.ts', () => ({
  subscribeExecutionShell: (_origin: unknown, _version: unknown, _protocol: unknown, changed: typeof fixture.changed) => { fixture.changed = changed; return () => {}; },
  readExecution: (_origin: unknown, _version: unknown, _protocol: unknown, id: string) => fixture.read(id),
}));
afterEach(() => { vi.resetModules(); fixture.read.mockReset(); });
it('loads history once, refreshes changed threads and keeps timestamped last observations through an outage', async () => {
  const { protocolItemThreads, protocolThreadById } = await import('./item-execution.ts');
  const observedAt = '2026-10-31T12:00:00Z';
  fixture.read.mockImplementation(async id => ({ availability: 'available', observation: { observedAt,
    projection: { thread: { id }, messages: [{ role: 'user', text: 'Build Owner/Repo#636', createdAt: observedAt }] } } }));
  protocolItemThreads(['one', 'archive']);
  const shells = [{ id: 'one', updatedAt: observedAt }, { id: 'archive', updatedAt: observedAt }];
  const publish = (threads: Record<string, unknown>[] = shells) => fixture.changed!({ availability: 'available', observation: { observedAt, snapshot: { threads: [threads[0]], archivedThreads: [threads[1]] } } });
  publish();
  await vi.waitFor(() => expect(protocolItemThreads(['one', 'archive'])).toHaveLength(2));
  publish();
  await vi.waitFor(() => expect(protocolItemThreads(['one', 'archive'])).toHaveLength(2));
  expect(fixture.read).toHaveBeenCalledTimes(2);
  publish([{ ...shells[0]!, title: 'changed' }, shells[1]!]);
  await vi.waitFor(() => expect(protocolItemThreads(['one'])).toMatchObject([{ title: 'changed' }]));
  expect(fixture.read).toHaveBeenCalledTimes(3);
  fixture.changed!({ availability: 'unavailable' });
  expect(protocolThreadById('one')).toMatchObject({ availability: 'unavailable', observation: { observedAt } });
  expect(protocolItemThreads(['one'])).toMatchObject([{ id: 'one', title: 'changed', observedAt }]);
  expect(protocolItemThreads(['one', 'never-seen'])).toBe('unavailable');
  publish();
  await vi.waitFor(() => expect(protocolItemThreads(['one', 'archive'])).toHaveLength(2));
});
