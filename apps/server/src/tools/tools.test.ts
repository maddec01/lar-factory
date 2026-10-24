import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { findTools, mergePaths, readLoginPath } from '../src/tools.ts';

/** A temp folder with `bin` holding runnable files of the given names, and a login shell whose PATH starts with `bin`. */
async function machine(t: TestContext, names: string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'mux-tools-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
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

test('an empty override counts as unset', async (t) => {
  const { bin } = await machine(t, ['gh']);
  assert.deepEqual(findTools({ PATH: bin, GH_PATH: '' }, null).gh, { path: join(bin, 'gh') });
});

test('an override with a slash that is not runnable leaves the tool missing, with no fallback', async (t) => {
  const { dir, bin } = await machine(t, ['t3', 'not-runnable']);
  await chmod(join(bin, 'not-runnable'), 0o644);
  for (const override of [join(dir, 'nowhere/t3'), join(bin, 'not-runnable'), bin]) {
    assert.deepEqual(findTools({ PATH: bin, T3_PATH: override }, null).t3, { path: null, override: `T3_PATH=${override}` });
  }
});

test('an override with a slash that is runnable is used as given', async (t) => {
  const { bin } = await machine(t, ['my-t3']);
  assert.deepEqual(findTools({ PATH: '/usr/bin', T3_PATH: join(bin, 'my-t3') }, null).t3, { path: join(bin, 'my-t3') });
});

test('a bare-name override is looked up on the PATH', async (t) => {
  const { bin } = await machine(t, ['t3', 'other-t3']);
  assert.deepEqual(findTools({ PATH: bin, T3_PATH: 'other-t3' }, null).t3, { path: join(bin, 'other-t3') });
  assert.deepEqual(findTools({ PATH: bin, T3_PATH: 'absent-t3' }, null).t3, { path: null, override: 'T3_PATH=absent-t3' });
});

test('a missing az is reported as missing and the other tools are still found', async (t) => {
  const { bin } = await machine(t, ['t3', 'gh']);
  // No Homebrew folders, which may hold a real az.
  const tools = findTools({ PATH: bin }, null, []);
  assert.deepEqual(tools.az, { path: null });
  assert.deepEqual(tools.t3, { path: join(bin, 't3') });
  assert.deepEqual(tools.gh, { path: join(bin, 'gh') });
});

test('the login shell PATH goes before the inherited one, then the Homebrew folders, without duplicates', () => {
  assert.equal(mergePaths('/a:/usr/bin::/b', '/usr/bin:/c:/a'), '/a:/usr/bin:/b:/c:/opt/homebrew/bin:/usr/local/bin');
  assert.equal(mergePaths(null, '/usr/local/bin:/bin'), '/usr/local/bin:/bin:/opt/homebrew/bin');
});

test('a login shell that fails falls back to launchctl', async (t) => {
  const { dir } = await machine(t, []);
  const shell = join(dir, 'broken-shell');
  await writeFile(shell, '#!/bin/sh\nexit 1\n');
  await chmod(shell, 0o755);
  const launchctl = join(dir, 'launchctl');
  await writeFile(launchctl, '#!/bin/sh\n[ "$1 $2" = "getenv PATH" ] && echo /from/launchd:/usr/bin\n');
  await chmod(launchctl, 0o755);
  assert.equal(await readLoginPath({ PATH: '/usr/bin:/bin', SHELL: shell }, launchctl), '/from/launchd:/usr/bin');
});
