import { afterEach, expect, it, vi } from 'vite-plus/test';

import { boardProjects } from './board-projects.ts';
import { readExecutionModels, readExecutionProjection } from './execution-capabilities.ts';
import type { BoardSession } from './project-protocol.ts';
import { subscribeProjects } from './project-subscription.ts';
import { ReadSession, setReadSessions } from './read-session.ts';

vi.mock('./project-subscription.ts');
vi.mock('./t3-settings.ts', () => ({ serverRuntimeOrigin: () => 'http://127.0.0.1:3773' }));
afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
});

/** An in-memory vault and an authority that issues `session-1`, `session-2`… expiring an hour after `now`. */
function fixture(now: () => number = Date.now) {
    let stored: BoardSession | undefined;
    const revoked: string[] = [];
    const issue = vi.fn(async () => ({
        token: `token-${issue.mock.calls.length}`,
        sessionId: `session-${issue.mock.calls.length}`,
        expiresAt: new Date(now() + 3_600_000).toISOString(),
    }));

    return {
        revoked,
        issue,
        sessions: {
            vault: {
                read: async () => stored,
                write: async (session: BoardSession) => {
                    stored = session;
                },
            },
            authority: {
                issue,
                revoke: async (id: string) => {
                    revoked.push(id);
                },
            },
        },
    };
}

it('repeated thread, model and project reads share one read session and revoke none', async () => {
    const t3 = fixture();
    const tokens: string[] = [];

    setReadSessions(t3.sessions);
    vi.mocked(subscribeProjects).mockImplementation((_origin, _version, protocol, _change, request) => {
        void protocol.subscriptionSession().then((session) => {
            tokens.push(session.token);
            request!.accept({ type: 'snapshot', config: { providers: [] } });
        });

        return () => {};
    });
    vi.stubGlobal(
        'fetch',
        vi.fn(async (_url: URL, init: RequestInit) => {
            tokens.push(new Headers(init.headers).get('Authorization')!.replace('Bearer ', ''));

            return Response.json({ projects: [], updatedAt: '2026-01-01' });
        }),
    );

    await readExecutionProjection('one');
    await readExecutionProjection('two');
    await readExecutionModels();
    expect((await boardProjects('http://127.0.0.1:3773', '').readProjects()).availability).toBe('available');

    expect(tokens).toEqual(['token-1', 'token-1', 'token-1', 'token-1']);
    expect(t3.issue).toHaveBeenCalledOnce();
    expect(t3.revoked).toEqual([]);
});

it('renews before expiry without revoking the session another reader still holds', async () => {
    let now = 0;
    const t3 = fixture(() => now);
    const session = new ReadSession(t3.sessions, () => now);
    const held = await session.subscriptionSession();

    now = 3_600_000 - 30_000;

    const renewed = await session.subscriptionSession();

    expect([held.sessionId, renewed.sessionId]).toEqual(['session-1', 'session-2']);
    expect(await t3.sessions.vault.read()).toBe(renewed);
    expect(t3.revoked).toEqual([]);
});

it('revokes a newly issued session if Keychain storage fails', async () => {
    const t3 = fixture();
    const session = new ReadSession({
        ...t3.sessions,
        vault: {
            read: async () => undefined,
            write: async () => {
                throw Error('locked');
            },
        },
    });

    await expect(session.subscriptionSession()).rejects.toThrow('Session renewal failed');
    expect(t3.revoked).toEqual(['session-1']);
});

it('reauthorization prevents a late vault read from restoring credentials', async () => {
    let release!: (session: BoardSession) => void;
    let reads = 0;
    const stored = { token: 'fixture', sessionId: 'old', expiresAt: '2099-01-01' };
    const session = new ReadSession({
        vault: {
            read: async () =>
                ++reads === 1
                    ? new Promise<BoardSession>((resolve) => {
                          release = resolve;
                      })
                    : stored,
            write: async () => {},
        },
        authority: {
            issue: async () => ({ ...stored, sessionId: 'new' }),
            revoke: async () => {},
        },
    });
    const pending = session.subscriptionSession();
    // oxlint-disable-next-line vitest/valid-expect -- awaited below, once the release settles it
    const rejected = expect(pending).rejects.toThrow('Session invalidated');
    const renewal = session.reauthorize();

    release(stored);
    await rejected;
    await renewal;
    expect((await session.subscriptionSession()).sessionId).toBe('new');
});
