import { expect, it, vi } from 'vite-plus/test';

import { readArchivedShells, subscribeExecutionShell } from './execution-protocol.ts';
import type { ProjectProtocol } from './project-protocol.ts';

const fixture = vi.hoisted(() => ({ accept: (_value: unknown) => {}, tag: '', payload: {} as unknown }));

vi.mock('./project-subscription.ts', () => ({
    subscribeProjects: (
        _origin: URL,
        _version: string,
        _protocol: unknown,
        _change: unknown,
        execution: { tag: string; payload: unknown; accept: (value: unknown) => void },
    ) => {
        fixture.accept = execution.accept;
        fixture.tag = execution.tag;
        fixture.payload = execution.payload;

        return () => {};
    },
}));

it('keeps projects and active/archived threads during metadata refresh and applies intervening removals', () => {
    const changed = vi.fn();
    const stop = subscribeExecutionShell(new URL('http://127.0.0.1:3773'), 'any', {} as ProjectProtocol, changed);
    const projects = [{ id: 'factory' }, { id: 'other' }];
    const threads = [{ id: 'active' }];
    const archivedThreads = [{ id: 'archived' }];
    const snapshot = { snapshotSequence: 3, projects, threads, archivedThreads };

    fixture.accept({ kind: 'snapshot', snapshot });
    fixture.accept({
        kind: 'snapshot',
        resolvedRepositoryIdentityRoots: ['/other'],
        snapshot: {
            snapshotSequence: 5,
            projects: [{ id: 'other', repositoryIdentity: 'resolved' }],
            threads: [],
            archivedThreads: [],
        },
    });
    expect(changed.mock.lastCall![0].observation.snapshot).toEqual({
        ...snapshot,
        projects: [projects[0], { id: 'other', repositoryIdentity: 'resolved' }],
    });
    fixture.accept({ kind: 'project.removed', sequence: 4, projectId: 'factory' });
    expect(changed.mock.lastCall![0].observation.snapshot.projects).toEqual([
        { id: 'other', repositoryIdentity: 'resolved' },
    ]);
    fixture.accept({
        kind: 'snapshot',
        resolvedRepositoryIdentityRoots: ['/factory'],
        snapshot: { snapshotSequence: 5, projects: [{ id: 'factory' }], threads: [], archivedThreads: [] },
    });
    expect(changed.mock.lastCall![0].observation.snapshot.projects).toEqual([
        { id: 'other', repositoryIdentity: 'resolved' },
    ]);
    fixture.accept({
        kind: 'snapshot',
        snapshot: { snapshotSequence: 6, projects: [], threads: [], archivedThreads: [] },
    });
    expect(changed.mock.lastCall![0].observation.snapshot.projects).toEqual([]);
    stop();
});

it('reads archived shells through their own RPC, and refuses a response that lacks them', async () => {
    const read = readArchivedShells(new URL('http://127.0.0.1:3773'), 'any', {} as ProjectProtocol);

    expect([fixture.tag, fixture.payload]).toEqual(['orchestration.getArchivedShellSnapshot', {}]);
    fixture.accept({ schemaVersion: 2, snapshotSequence: 7, projects: [], threads: [{ id: 'archived' }] });
    expect(await read).toMatchObject({
        availability: 'available',
        observation: { snapshotSequence: 7, threads: [{ id: 'archived' }] },
    });
    void readArchivedShells(new URL('http://127.0.0.1:3773'), 'any', {} as ProjectProtocol);
    expect(() => fixture.accept({ snapshotSequence: 7, threads: 'none' })).toThrow('Invalid');
});
