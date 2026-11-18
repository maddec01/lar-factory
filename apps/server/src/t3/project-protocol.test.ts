import { expect, it } from 'vite-plus/test';

import { ProjectProtocol, type BoardSession, type SessionAuthority, type SessionVault } from './project-protocol.ts';
import { ReadSession } from './read-session.ts';

const adapterOf = (vault: SessionVault, authority: SessionAuthority, request: (token: string) => Promise<Response>) =>
    new ProjectProtocol(new ReadSession({ vault, authority }), request, 'fixture-release');

it('retains the observation after rejection and reports renewal failure', async () => {
    let session: BoardSession | undefined;
    let rejected = false;
    let fail = false;
    const adapter = adapterOf(
        {
            read: async () => session,
            write: async (value) => {
                session = value;
            },
        },
        {
            issue: async () => {
                if (fail) throw Error('private');

                return { token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' };
            },
            revoke: async () => {},
        },
        async () =>
            rejected ? new Response('', { status: 401 }) : Response.json({ projects: [], updatedAt: '2026-01-01' }),
    );
    const first = await adapter.readProjects();

    expect(first.availability).toBe('available');
    rejected = true;
    expect(await adapter.readProjects()).toEqual({ availability: 'renewal-required', observation: first.observation });
    session = undefined;
    fail = true;
    expect((await adapter.readProjects()).availability).toBe('renewal-required');
});

it('reads compatible projects on T3 0.1.6-nightly.20261031.3977', async () => {
    const adapter = adapterOf(
        {
            read: async () => ({ token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }),
            write: async () => {},
        },
        {
            issue: async () => {
                throw Error();
            },
            revoke: async () => {},
        },
        async () =>
            Response.json({
                projects: [{ id: 'repo', title: 'Repository', workspaceRoot: '/repo', futureField: true }],
                updatedAt: '2026-01-01',
                futureField: true,
            }),
    );

    expect((await adapter.readProjects()).observation?.projects).toEqual([
        { id: 'repo', title: 'Repository', workspaceRoot: '/repo', faviconPath: null, projectIcon: null },
    ]);
});

it('rejects remote endpoints before sending credentials', async () => {
    const { boardProjects } = await import('./board-projects.ts');

    expect(() => boardProjects('https://example.com', 'fixture-release')).toThrow('Expected local T3 server');
});

const projectsWith = async (fields: object) => {
    const adapter = adapterOf(
        {
            read: async () => ({ token: 'fixture', sessionId: 'board', expiresAt: '2099-01-01' }),
            write: async () => {},
        },
        {
            issue: async () => {
                throw Error();
            },
            revoke: async () => {},
        },
        async () =>
            Response.json({
                projects: [{ id: 'repo', title: 'Repository', workspaceRoot: '/repo', ...fields }],
                updatedAt: '2026-01-01',
            }),
    );
    const read = await adapter.readProjects();

    expect(read.availability).toBe('available');

    return read.observation!.projects[0]!;
};

it('reads the chosen icon', async () => {
    const projectIcon = { kind: 'lucide', name: 'git-branch', color: 'sky' };

    expect((await projectsWith({ projectIcon })).projectIcon).toEqual(projectIcon);
});
