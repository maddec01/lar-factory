import { describe, expect, it } from 'vite-plus/test';
import { ShellRecovery } from './shell-recovery.ts';

describe('shell recovery', () => {
  it('rejects replay and stale snapshots while retaining projects', () => {
    const recovery = new ShellRecovery();
    const project = { id: 'one', title: 'One', workspaceRoot: '/one' };
    expect(recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [project] } })).toBe(true);
    expect(recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [{ ...project, title: 'Enriched' }] } })).toBe(true);
    expect(recovery.observation(0).projects[0]?.title).toBe('Enriched');
    expect(recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [project] } })).toBe(true);
    expect(recovery.accept({ kind: 'project.removed', sequence: 2, projectId: 'one' })).toBe(false);
    expect(recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 1, projects: [] } })).toBe(false);
    expect(recovery.observation(0).projects).toEqual([project]);
    expect(recovery.accept({ kind: 'thread.removed', sequence: 5 })).toBe(false);
    expect(recovery.accept({ kind: 'project.removed', sequence: 6, projectId: 'one' })).toBe(true);
    expect(recovery.observation(0).projects).toEqual([]);
  });
});

it('merges marked metadata updates without removing unrelated projects, including at a later sequence', () => {
  const recovery = new ShellRecovery();
  const project = (id: string) => ({ id, title: id, workspaceRoot: `/${id}` });
  recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [project('factory'), project('other')] } });
  recovery.accept({ kind: 'snapshot', resolvedRepositoryIdentityRoots: ['/other'], snapshot: { snapshotSequence: 3, projects: [project('other')] } });
  expect(recovery.observation().projects.map(p => p.id)).toEqual(['factory', 'other']);
  recovery.accept({ kind: 'snapshot', resolvedRepositoryIdentityRoots: ['/other'], snapshot: { snapshotSequence: 5, projects: [{ ...project('other'), title: 'Updated' }] } });
  expect(recovery.observation().projects).toEqual([project('factory'), { ...project('other'), title: 'Updated' }]);
  recovery.accept({ kind: 'project.removed', sequence: 4, projectId: 'other' });
  recovery.accept({ kind: 'snapshot', resolvedRepositoryIdentityRoots: ['/other'], snapshot: { snapshotSequence: 6, projects: [project('other')] } });
  expect(recovery.observation().projects).toEqual([project('factory')]);
  recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 7, projects: [] } });
  expect(recovery.observation().projects).toEqual([]);
});

it('rejects malformed metadata markers without changing the observation', () => {
  const recovery = new ShellRecovery();
  const first = { id: 'factory', title: 'Factory', workspaceRoot: '/factory' };
  recovery.accept({ kind: 'snapshot', snapshot: { snapshotSequence: 3, projects: [first] } });
  expect(() => recovery.accept({ kind: 'snapshot', resolvedRepositoryIdentityRoots: 'invalid', snapshot: { snapshotSequence: 4, projects: [] } })).toThrow();
  expect(recovery.observation().projects).toEqual([first]);
});
