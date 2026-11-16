import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';

import { checkTools, findTools, lookUpTools, readLoginPath } from './tools.ts';

/** A temp folder with `bin` holding runnable files of the given names, and a login shell whose PATH starts with `bin`. */
async function machine(t: TestContext, names: string[]) {
    const dir = await mkdtemp(join(tmpdir(), 'lar-tools-test-'));

    t.onTestFinished(() => rm(dir, { recursive: true, force: true }));

    const bin = join(dir, 'bin');

    await mkdir(bin);
    for (const name of names) {
        await writeFile(join(bin, name), '#!/bin/sh\n');
        await chmod(join(bin, name), 0o755);
    }

    const shell = join(dir, 'login-shell');

    // Called as `<shell> -ilc <script>`; a login shell sets its own PATH before the script runs.
    await writeFile(shell, `#!/bin/sh\nPATH=${bin}:/usr/bin:/bin; export PATH; exec /bin/sh -c "$2"\n`);
    await chmod(shell, 0o755);

    return { dir, bin, shell };
}

test('finds the tools on the login shell PATH when started with a bare PATH', async (t) => {
    const { bin, shell } = await machine(t, ['t3', 'gh', 'az']);
    const env = { PATH: '/usr/bin:/bin', SHELL: shell };
    const loginPath = await readLoginPath(env);

    assert.equal(loginPath?.split(':')[0], bin);

    const tools = findTools(env, loginPath);

    assert.deepEqual(tools.t3, { path: join(bin, 't3') });
    assert.deepEqual(tools.gh, { path: join(bin, 'gh') });
    assert.deepEqual(tools.az, { path: join(bin, 'az') });
    assert.equal(tools.searchPath.split(':')[0], bin);
});

test('the checks report each command: its version, missing with the override and fix, or a logged-out gh', async (t) => {
    const { dir, bin, shell } = await machine(t, []);
    const script = async (name: string, body: string) => {
        await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
        await chmod(join(bin, name), 0o755);
    };

    await script('t3', 'echo t3 v0.1.3-nightly.1');
    await script(
        'gh',
        '[ "$1" = --version ] && echo "gh version 2.96.1 (2026-08-01)" && exit 0\necho "You are not logged into any GitHub hosts." >&2; exit 1',
    );
    await script('git', 'echo git version 2.56.0');
    // A command that runs passes, even when it prints no version.
    await script('curl', 'exit 2');
    await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell, JQ_PATH: join(dir, 'nowhere/jq') });
    await writeFile(join(dir, 'server-runtime.json'), JSON.stringify({ version: 1, pid: process.pid, port: 3773 }));

    const { tools, ghError } = await checkTools({ gh: true, az: false }, join(dir, 'server-runtime.json'));

    assert.deepEqual(tools, {
        t3: { result: 'ok', version: '0.1.3-nightly.1' },
        gh: { result: 'logged-out', version: '2.96.1', fix: 'gh auth login' },
        git: { result: 'ok', version: '2.56.0' },
        jq: { result: 'missing', override: `JQ_PATH=${join(dir, 'nowhere/jq')}`, fix: 'brew install jq' },
        curl: { result: 'ok' },
    });
    assert.equal(ghError, undefined);
});
