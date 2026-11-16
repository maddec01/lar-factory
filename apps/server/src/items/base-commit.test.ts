import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, type TestContext } from 'vite-plus/test';

import { committingEnv } from '../../test/repo-support.ts';
import { fetchBaseCommit } from './base-commit.ts';

const env = committingEnv();

/** A remote and its clone, the clone's local `main` one commit behind the remote's. */
function behindClone(t: TestContext, cloneArgs: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), 'lar-base-commit-'));

    t.onTestFinished(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));

    const git = (cwd: string, ...args: string[]) =>
        execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const [origin, checkout] = [join(dir, 'origin'), join(dir, 'checkout')];

    git(dir, 'init', '-q', '-b', 'main', origin);
    git(origin, 'commit', '-q', '--allow-empty', '-m', 'first');
    git(dir, 'clone', '-q', '--no-local', ...cloneArgs, origin, checkout);

    const behind = git(checkout, 'rev-parse', 'main');

    git(origin, 'commit', '-q', '--allow-empty', '-m', 'second');

    return { dir, origin, checkout, behind, tip: git(origin, 'rev-parse', 'main'), git };
}

it("returns the remote's current commit and leaves local main and the working tree alone", async (t) => {
    const { checkout, behind, tip, git } = behindClone(t);

    writeFileSync(join(checkout, 'unsaved.txt'), 'kept');
    expect(await fetchBaseCommit(checkout, 'main', { env })).toBe(tip);
    expect(git(checkout, 'rev-parse', 'main')).toBe(behind);
    expect(git(checkout, 'rev-parse', 'HEAD')).toBe(behind);
    expect(git(checkout, 'rev-parse', 'origin/main')).toBe(tip);
    expect(readFileSync(join(checkout, 'unsaved.txt'), 'utf8')).toBe('kept');
});

it('runs ssh in batch mode with no terminal prompt, keeping the configured ssh command', async (t) => {
    const { dir, checkout, git } = behindClone(t);
    const calls = join(dir, 'ssh-calls');
    const ssh = join(dir, 'recording ssh');

    writeFileSync(ssh, `#!/bin/sh\nprintf '%s %s\\n' "$GIT_TERMINAL_PROMPT" "$*" >> '${calls}'\nexit 255\n`, {
        mode: 0o755,
    });
    git(checkout, 'remote', 'set-url', 'origin', 'git@example.invalid:o/r.git');
    git(checkout, 'config', 'core.sshCommand', `'${ssh}' -i key`);
    await expect(fetchBaseCommit(checkout, 'main', { env: { ...env, GIT_SSH_VARIANT: 'ssh' } })).rejects.toThrow(
        'Could not fetch main',
    );
    expect(readFileSync(calls, 'utf8')).toMatch(/^0 -i key -o BatchMode=yes .*git@example\.invalid/);
});

it('fails an HTTPS login without running an askpass program', async (t) => {
    const { dir, checkout, git } = behindClone(t);
    const asked = join(dir, 'asked');
    const askpass = join(dir, 'askpass');

    writeFileSync(askpass, `#!/bin/sh\ntouch '${asked}'\n`, { mode: 0o755 });

    const server = createServer((_request, response) =>
        response.writeHead(401, { 'WWW-Authenticate': 'Basic realm="r"' }).end(),
    );

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.onTestFinished(() => {
        server.close();
    });
    git(checkout, 'remote', 'set-url', 'origin', `http://127.0.0.1:${(server.address() as AddressInfo).port}/o/r.git`);
    git(checkout, 'config', 'core.askPass', askpass);
    await expect(
        fetchBaseCommit(checkout, 'main', { env: { ...env, GIT_ASKPASS: askpass, SSH_ASKPASS: askpass } }),
    ).rejects.toThrow('Could not fetch main');
    expect(existsSync(asked)).toBe(false);
});
