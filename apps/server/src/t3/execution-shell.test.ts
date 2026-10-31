import { expect, it, vi } from 'vite-plus/test';
import { subscribeExecutionShell } from './execution-protocol.ts';
import type { ProjectProtocol } from './project-protocol.ts';

const fixture = vi.hoisted(() => ({ accept: (_value: unknown) => {} }));
vi.mock('./project-subscription.ts', () => ({ subscribeProjects: (_origin: URL, _version: string, _protocol: unknown, _change: unknown, execution: { accept(value: unknown): void }) => {
  fixture.accept = execution.accept;
  return () => {};
} }));

it('keeps projects and active/archived threads during metadata refresh and applies intervening removals', () => {
  const changed = vi.fn();
  const stop = subscribeExecutionShell(new URL('http://127.0.0.1:3773'), 'any', {} as ProjectProtocol, changed);
  const projects = [{ id: 'factory' }, { id: 'other' }];
  const threads = [{ id: 'active' }];
  const archivedThreads = [{ id: 'archived' }];
  const snapshot = { snapshotSequence: 3, projects, threads, archivedThreads };
  fixture.accept({ kind: 'snapshot', snapshot });
  fixture.accept({ kind: 'snapshot', resolvedRepositoryIdentityRoots: ['/other'], snapshot: { snapshotSequence: 5, projects: [{ id: 'other', repositoryIdentity: 'resolved' }], threads: [], archivedThreads: [] } });
  expect(changed.mock.lastCall![0].observation.snapshot).toEqual({ ...snapshot, projects: [projects[0], { id: 'other', repositoryIdentity: 'resolved' }] });
  fixture.accept({ kind: 'project.removed', sequence: 4, projectId: 'factory' });
  expect(changed.mock.lastCall![0].observation.snapshot.projects).toEqual([{ id: 'other', repositoryIdentity: 'resolved' }]);
  fixture.accept({ kind: 'snapshot', resolvedRepositoryIdentityRoots: ['/factory'], snapshot: { snapshotSequence: 5, projects: [{ id: 'factory' }], threads: [], archivedThreads: [] } });
  expect(changed.mock.lastCall![0].observation.snapshot.projects).toEqual([{ id: 'other', repositoryIdentity: 'resolved' }]);
  fixture.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 6, projects: [], threads: [], archivedThreads: [] } });
  expect(changed.mock.lastCall![0].observation.snapshot.projects).toEqual([]);
  stop();
});
