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

it('resolves a started thread across message formats, and only when one thread matches, a cut-short title included', async () => {
  const { protocolItemThreads, protocolStartedThread } = await import('./item-execution.ts');
  const observedAt = '2026-10-31T12:00:00Z';
  const current = 'Build #7 T\nBuild w1. Read /a/long/path/builder.md and follow it.';
  const earlier = 'Build w1. Read /a/long/path/builder.md and follow it.';
  const first: Record<string, string> = { 'in-current': current, 'in-earlier': earlier };
  fixture.read.mockImplementation(async id => ({ availability: 'available', observation: { observedAt,
    projection: { thread: { id }, messages: [{ role: 'user', text: first[id], createdAt: observedAt }] } } }));
  protocolItemThreads([]);
  const shell = (id: string, title: string) => ({ id, projectId: 'p', title, updatedAt: observedAt });
  fixture.changed!({ availability: 'available', observation: { observedAt, snapshot: { threads: [shell('in-earlier', 'Build w1. Read /a/long…')], archivedThreads: [] } } });
  await vi.waitFor(() => expect(protocolStartedThread('p', [current, earlier], [])).toEqual({ threadId: 'in-earlier', title: 'Build w1. Read /a/long…' }));
  fixture.changed!({ availability: 'available', observation: { observedAt, snapshot: { threads: [shell('in-earlier', 'Build w1. Read /a/long…'), shell('in-current', 'Build #7 T')], archivedThreads: [] } } });
  await vi.waitFor(() => expect(protocolStartedThread('p', [current, earlier], [])).toBeNull());
  expect(protocolStartedThread('p', [current, earlier], ['in-earlier'])).toEqual({ threadId: 'in-current', title: 'Build #7 T' });
});

it('finds the one started thread whose first message is the start message, leaving out recorded ones', async () => {
  const { protocolItemThreads, protocolStartedThread } = await import('./item-execution.ts');
  const observedAt = '2026-10-31T12:00:00Z';
  const message = 'Build w1. Read builder.md and follow it.';
  fixture.read.mockImplementation(async id => ({ availability: 'available', observation: { observedAt,
    projection: { thread: { id }, messages: [{ role: 'user', text: message, createdAt: observedAt }] } } }));
  protocolItemThreads([]);
  expect(() => protocolStartedThread('p', [message], [])).toThrow('unavailable');
  const shell = (id: string) => ({ id, projectId: 'p', title: message, updatedAt: observedAt });
  fixture.changed!({ availability: 'available', observation: { observedAt, snapshot: { threads: [shell('old'), shell('new')], archivedThreads: [] } } });
  await vi.waitFor(() => expect(protocolStartedThread('p', [message], ['old'])).toEqual({ threadId: 'new', title: message }));
  expect(protocolStartedThread('p', [message], ['old'])).toEqual({ threadId: 'new', title: message });
  expect(protocolStartedThread('p', [message], []), 'two matches establish nothing').toBeNull();
  expect(protocolStartedThread('other', [message], [])).toBeNull();
});

it('shows shell status changes immediately while history reads wait, without treating stale details as current', async () => {
  const { protocolItemThreads, protocolStartedThread, protocolThreadById, protocolStatsInputs } = await import('./item-execution.ts');
  const observedAt = '2026-10-31T12:00:00Z';
  let release!: (read: ExecutionRead) => void;
  const delayed = new Promise<ExecutionRead>(resolve => { release = resolve; });
  fixture.read.mockReturnValue(delayed);
  protocolItemThreads(['one']);
  const publish = (thread: Record<string, unknown>) => fixture.changed!({ availability: 'available', observation: {
    observedAt, snapshot: { threads: [thread], archivedThreads: [] },
  } });
  const shell = { id: 'one', projectId: 'p', title: 'Shape issue', updatedAt: observedAt, status: 'running' };
  publish(shell);
  expect(protocolItemThreads(['one'])).toMatchObject([{ state: 'running' }]);
  expect(protocolThreadById('one').availability).toBe('unavailable');
  expect(() => protocolStatsInputs()).toThrow('unavailable');
  expect(() => protocolStartedThread('p', ['Shape issue'], [])).toThrow('unavailable');

  publish({ ...shell, pendingRuntimeRequest: { id: 'request' } });
  expect(protocolItemThreads(['one'])).toMatchObject([{ state: 'needs you' }]);
  release({ availability: 'available', observation: { observedAt, projection: { thread: { id: 'one' }, messages: [] } } });
  await vi.waitFor(() => expect(protocolThreadById('one').availability).toBe('available'));
  expect(protocolItemThreads(['one'])).toMatchObject([{ state: 'needs you' }]);
  expect(fixture.read).toHaveBeenCalledTimes(2);
});

it('reads stats only for the requested thread family even when unrelated history is still loading', async () => {
  const { protocolItemThreads, protocolThreadById, protocolStatsInputs } = await import('./item-execution.ts');
  const observedAt = '2026-10-31T12:00:00Z';
  fixture.read.mockImplementation(async id => id === 'unrelated' ? new Promise<ExecutionRead>(() => {}) : {
    availability: 'available', observation: { observedAt, projection: { thread: { id }, messages: [], providerSessions: [],
      providerThreads: [], providerTurns: [], runtimeRequests: [], subagents: [] } },
  });
  protocolItemThreads(['own']);
  fixture.changed!({ availability: 'available', observation: { observedAt, snapshot: {
    threads: [{ id: 'own', updatedAt: observedAt }, { id: 'child', updatedAt: observedAt, lineage: { rootThreadId: 'own' } },
      { id: 'unrelated', updatedAt: observedAt }], archivedThreads: [],
  } } });
  await vi.waitFor(() => expect(protocolThreadById('child').availability).toBe('available'));
  expect(protocolStatsInputs(['own']).rows.threads.map(thread => thread.id)).toEqual(['own', 'child']);
  expect(() => protocolStatsInputs()).toThrow('unavailable');
  expect(protocolStatsInputs([]).rows.threads).toEqual([]);
});
