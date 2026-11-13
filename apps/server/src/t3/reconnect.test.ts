import { fork, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import type { BoardSession } from './project-protocol.ts';
import {
    reconnectRepositoryProjects,
    repositoryProjectAccess,
    repositoryProjects,
    setProjectSessions,
} from './repository-project-discovery.ts';

const folder = mkdtempSync(join(tmpdir(), 'lar-t3-reconnect-'));
const env = { T3_SERVER_RUNTIME: join(folder, 'runtime.json') };
const children: ChildProcess[] = [];
let runtime: { origin: string; pid: number; token: string };

async function start() {
    const child = fork(new URL('../../test/t3-restart-server.mjs', import.meta.url), { silent: true });

    children.push(child);
    [runtime] = (await once(child, 'message')) as [typeof runtime];
    writeFileSync(env.T3_SERVER_RUNTIME, JSON.stringify({ origin: runtime.origin, pid: runtime.pid }));

    return child;
}

async function stop(child: ChildProcess) {
    const exited = once(child, 'exit');

    child.kill();
    await exited;
}

afterEach(async () => {
    for (const child of children) if (child.exitCode === null && child.signalCode === null) await stop(child);
    rmSync(folder, { recursive: true, force: true });
    await reconnectRepositoryProjects(env);
});

it('recovers automatically after a real server process restarts with a new port and credential', async () => {
    let stored: BoardSession | undefined;
    const issue = vi.fn(async () => ({
        token: runtime.token,
        sessionId: String(runtime.pid),
        expiresAt: '2099-01-01',
    }));

    setProjectSessions({
        vault: {
            read: async () => stored,
            write: async (session) => {
                stored = session;
            },
        },
        authority: { issue, revoke: async () => {} },
    });

    const first = await start();
    const old = { ...runtime };

    expect((await repositoryProjects(env)).availability).toBe('available');
    await stop(first);
    await vi.waitFor(async () => expect((await repositoryProjects(env)).availability).toBe('unavailable'));
    expect((await repositoryProjects(env)).observation?.projects[0]?.id).toBe('fixture');

    const started = Date.now();

    await start();
    expect(runtime.pid).not.toBe(old.pid);
    expect(runtime.origin).not.toBe(old.origin);
    expect(runtime.token).not.toBe(old.token);
    await vi.waitFor(async () => expect((await repositoryProjects(env)).availability).toBe('available'), {
        timeout: 6_000,
        interval: 100,
    });
    expect(Date.now() - started).toBeLessThan(6_000);
    expect(issue).toHaveBeenCalledTimes(2);
    expect(repositoryProjectAccess()?.origin.origin).toBe(runtime.origin);

    const protocol = repositoryProjectAccess()?.protocol;

    expect((await reconnectRepositoryProjects(env)).availability).toBe('available');
    expect(repositoryProjectAccess()?.protocol).not.toBe(protocol);
}, 15_000);
