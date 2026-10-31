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
