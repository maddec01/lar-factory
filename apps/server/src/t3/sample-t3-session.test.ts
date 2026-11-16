import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, vi } from 'vite-plus/test';

import { boardProjects } from './board-projects.ts';
import { sampleT3Session } from './sample-t3-session.ts';

vi.mock('./keychain-session.ts', () => ({
    keychainSessionVault: () => {
        throw new Error('The sample board must not touch the Keychain');
    },
}));

/** A `t3` that logs its arguments and answers each issue with the next session. */
function fakeT3(t: { onTestFinished(run: () => void): void }) {
    const dir = mkdtempSync(join(tmpdir(), 'lar-sample-t3-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

    const log = join(dir, 'calls');
    const cli = join(dir, 't3');

    writeFileSync(log, '');

    const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

    writeFileSync(
        cli,
        `#!/bin/sh\necho "$*" >> '${log}'\nprintf '{"token":"token","sessionId":"session-%s","expiresAt":"${expiresAt}"}' "$(wc -l < '${log}' | tr -d ' ')"\n`,
    );
    chmodSync(cli, 0o755);

    return { cli, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

const issued = (calls: string[]) => calls.filter((call) => call.startsWith('auth session issue'));

test("it issues a read-scope session named apart from the board's, and reads with it without the Keychain", async (t) => {
    const { cli, calls } = fakeT3(t);
    const request = vi.fn(async () => Response.json({ updatedAt: '2026-11-05T00:00:00Z', projects: [] }));

    vi.stubGlobal('fetch', request);
    t.onTestFinished(() => {
        vi.unstubAllGlobals();
    });

    const read = await boardProjects('http://127.0.0.1:3773', '', sampleT3Session(cli)).readProjects();

    expect(read.availability).toBe('available');
    expect(issued(calls())).toHaveLength(1);

    const [call] = issued(calls());

    expect(call).toContain('--scope orchestration:read');
    expect(call).toContain('--ttl 1h');
    expect(call).not.toContain('--subject lar-factory-board ');
});
