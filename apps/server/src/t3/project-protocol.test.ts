import { expect, it } from 'vite-plus/test';

import { ProjectProtocol, type BoardSession } from './project-protocol.ts';

it('retains the observation after rejection and reports renewal failure', async () => {
    let session: BoardSession | undefined;
    let rejected = false;
    let fail = false;
    const adapter = new ProjectProtocol(
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
        'fixture-release',
    );
    const first = await adapter.readProjects();

    expect(first.availability).toBe('available');
    rejected = true;
    expect(await adapter.readProjects()).toEqual({ availability: 'renewal-required', observation: first.observation });
    session = undefined;
    fail = true;
    expect((await adapter.readProjects()).availability).toBe('renewal-required');
});

it.each(['0.1.6-nightly.20261031.3977'])('reads compatible projects on T3 %s', async (version) => {
    const adapter = new ProjectProtocol(
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
        version,
    );

    expect((await adapter.readProjects()).observation?.projects).toEqual([
        { id: 'repo', title: 'Repository', workspaceRoot: '/repo', faviconPath: null, projectIcon: null },
    ]);
});

it('rejects remote endpoints before sending credentials', async () => {
    const { boardProjects } = await import('./board-projects.ts');

    expect(() => boardProjects('https://example.com', 'fixture-release')).toThrow('Expected local T3 server');
});

it('revokes a newly issued session if Keychain storage fails', async () => {
    const revoked: string[] = [];
    const adapter = new ProjectProtocol(
        {
            read: async () => undefined,
            write: async () => {
                throw Error('locked');
            },
        },
        {
            issue: async () => ({ token: 'fixture', sessionId: 'new', expiresAt: '2099-01-01' }),
            revoke: async (id) => {
                revoked.push(id);
            },
        },
        async () => {
            throw Error('must not request');
        },
        'fixture-release',
    );

    expect((await adapter.readProjects()).availability).toBe('renewal-required');
    expect(revoked).toEqual(['new']);
});

it('renews before expiry, persists the replacement, and revokes the old session', async () => {
    const events: string[] = [];
    const adapter = new ProjectProtocol(
        {
            read: async () => ({ token: 'old-fixture', sessionId: 'old', expiresAt: new Date(30_000).toISOString() }),
            write: async (session) => {
                events.push(`stored:${session.sessionId}`);
            },
        },
        {
            issue: async () => ({
                token: 'new-fixture',
                sessionId: 'new',
                expiresAt: new Date(3_600_000).toISOString(),
            }),
            revoke: async (id) => {
                events.push(`revoked:${id}`);
            },
        },
        async (token) => {
            expect(token).toBe('new-fixture');

            return Response.json({ projects: [], updatedAt: '2026-01-01' });
        },
        'fixture-release',
        () => 0,
    );

    expect((await adapter.readProjects()).availability).toBe('available');
    expect(events).toEqual(['stored:new', 'revoked:old']);
});

it('reauthorization prevents a late vault read from restoring credentials', async () => {
    let release!: (session: BoardSession) => void;
    let reads = 0;
    const stored = { token: 'fixture', sessionId: 'old', expiresAt: '2099-01-01' };
    const adapter = new ProjectProtocol(
        {
            read: async () =>
                ++reads === 1
                    ? new Promise<BoardSession>((resolve) => {
                          release = resolve;
                      })
                    : stored,
            write: async () => {},
        },
        {
            issue: async () => ({ ...stored, sessionId: 'new' }),
            revoke: async () => {},
        },
        async () => {
            throw Error();
        },
        '',
    );
    const pending = adapter.subscriptionSession();
    // oxlint-disable-next-line vitest/valid-expect -- awaited below, once the release settles it
    const rejected = expect(pending).rejects.toThrow('Session invalidated');
    const renewal = adapter.reauthorize();

    release(stored);
    await rejected;
    await renewal;
    expect((await adapter.subscriptionSession()).sessionId).toBe('new');
});

const projectsWith = async (fields: object) => {
    const adapter = new ProjectProtocol(
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
        'fixture-release',
    );
    const read = await adapter.readProjects();

    expect(read.availability).toBe('available');

    return read.observation!.projects[0]!;
};

it('reads the chosen icon', async () => {
    const projectIcon = { kind: 'lucide', name: 'git-branch', color: 'sky' };

    expect((await projectsWith({ projectIcon })).projectIcon).toEqual(projectIcon);
});
