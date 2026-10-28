import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import { TOOL_NAMES, checkTools, findTools, lookUpTools, mergePaths, probeAz, probeGh, readLoginPath, versionOf } from './tools.ts';

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

test('git, jq and curl are looked up like gh, each with its own override', async (t) => {
  assert.deepEqual(TOOL_NAMES, ['t3', 'gh', 'az', 'git', 'jq', 'curl']);
  const { dir, bin } = await machine(t, ['git', 'jq', 'curl', 'my-jq']);
  const found = findTools({ PATH: bin }, null, []);
  assert.deepEqual([found.git, found.jq, found.curl], [{ path: join(bin, 'git') }, { path: join(bin, 'jq') }, { path: join(bin, 'curl') }]);
  const overridden = findTools({ PATH: bin, GIT_PATH: join(dir, 'nowhere/git'), JQ_PATH: 'my-jq', CURL_PATH: 'absent-curl' }, null, []);
  assert.deepEqual(overridden.git, { path: null, override: `GIT_PATH=${join(dir, 'nowhere/git')}` });
  assert.deepEqual(overridden.jq, { path: join(bin, 'my-jq') });
  assert.deepEqual(overridden.curl, { path: null, override: 'CURL_PATH=absent-curl' });
});

test('a version is the first version number on the first line, else that line', () => {
  assert.equal(versionOf('t3 v0.1.3-nightly.20261025.3655\n'), '0.1.3-nightly.20261025.3655');
  assert.equal(versionOf('gh version 2.102.0 (2026-09-30)\nhttps://github.com/cli/cli/releases/tag/v2.102.0\n'), '2.102.0');
  assert.equal(versionOf('jq-1.7.1-apple\n'), '1.7.1-apple');
  assert.equal(versionOf('curl 8.7.1 (x86_64-apple-darwin26.0) libcurl/8.7.1\nRelease-Date: 2024-03-27\n'), '8.7.1');
  assert.equal(versionOf('nightly build\n'), 'nightly build');
  assert.equal(versionOf(''), undefined);
});

test('the checks report each command: its version, missing with the override and fix, or a logged-out gh', async (t) => {
  const { dir, bin, shell } = await machine(t, []);
  const script = async (name: string, body: string) => {
    await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
    await chmod(join(bin, name), 0o755);
  };
  await script('t3', 'echo t3 v0.1.3-nightly.1');
  await script('gh', '[ "$1" = --version ] && echo "gh version 2.96.1 (2026-08-01)" && exit 0\necho "You are not logged into any GitHub hosts." >&2; exit 1');
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

test('each check is heard as it lands, so a slow one holds up no other', async (t) => {
  const { dir, bin, shell } = await machine(t, []);
  const script = async (name: string, body: string) => {
    await writeFile(join(bin, name), `#!/bin/sh\n${body}\n`);
    await chmod(join(bin, name), 0o755);
  };
  await script('t3', 'echo t3 v0.1.3-nightly.1');
  await script('gh', 'echo "gh version 2.96.1 (2026-08-01)"');
  await script('git', 'sleep 1; echo git version 2.56.0');
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell });
  const heard: string[] = [];
  await checkTools({ gh: true, az: false }, join(dir, 'no-runtime.json'), (check) => heard.push(...Object.keys(check)));
  assert.equal(heard.length, 5);
  assert.equal(heard.at(-1), 'git', 'the slow git lands last');
});

test('t3 is not running without T3\'s runtime file, and missing outranks it', async (t) => {
  const { dir, bin, shell } = await machine(t, []);
  await writeFile(join(bin, 't3'), '#!/bin/sh\necho t3 v0.1.3-nightly.1\n');
  await chmod(join(bin, 't3'), 0o755);
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell });
  assert.deepEqual((await checkTools({ gh: false, az: false }, join(dir, 'no-runtime.json'))).tools.t3, { result: 'not-running', version: '0.1.3-nightly.1' });
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell, T3_PATH: '/nowhere/t3' });
  assert.deepEqual((await checkTools({ gh: false, az: false }, join(dir, 'no-runtime.json'))).tools.t3, { result: 'missing', override: 'T3_PATH=/nowhere/t3' });
});

/** `gh auth status` for a classic token with these scopes, or with no scopes line when null. */
const authStatus = (scopes: string | null) => ['github.com', '  ✓ Logged in to github.com account maddec01 (keyring)', '  - Active account: true',
  '  - Token: gho_************************************', ...(scopes === null ? [] : [`  - Token scopes: ${scopes}`])].join('\n');

/** Probes a gh that prints `version` for `--version` and `status` for `auth status`. */
async function probeWith(t: TestContext, version: string, status: string) {
  const { dir, bin, shell } = await machine(t, []);
  await writeFile(join(dir, 'version'), `${version}\n`);
  await writeFile(join(dir, 'status'), `${status}\n`);
  await writeFile(join(bin, 'gh'), `#!/bin/sh\n[ "$1" = --version ] && exec cat ${join(dir, 'version')}\nexec cat ${join(dir, 'status')}\n`);
  await chmod(join(bin, 'gh'), 0o755);
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell });
  return (await probeGh()).check;
}

const withProject = "'gist', 'project', 'read:org', 'repo', 'workflow'";

test('a gh older than 2.94.0 is outdated, with brew upgrade gh as its fix', async (t) => {
  assert.deepEqual(await probeWith(t, 'gh version 2.93.2 (2026-06-01)\nhttps://github.com/cli/cli/releases/tag/v2.93.2', authStatus(withProject)),
    { result: 'outdated', version: '2.93.2', fix: 'brew upgrade gh' });
  assert.deepEqual(await probeWith(t, 'gh version 2.9.0 (2020-01-01)', authStatus(withProject)),
    { result: 'outdated', version: '2.9.0', fix: 'brew upgrade gh' });
});

test('a gh at 2.94.0 or newer with the project scope passes', async (t) => {
  assert.deepEqual(await probeWith(t, 'gh version 2.94.0 (2026-07-01)', authStatus(withProject)), { result: 'ok', version: '2.94.0' });
  assert.deepEqual(await probeWith(t, 'gh version 2.102.0 (2026-09-30)', authStatus(withProject)), { result: 'ok', version: '2.102.0' });
});

test('a login without the project scope has gh auth refresh -s project as its fix, and an old gh also names its upgrade', async (t) => {
  const noProject = authStatus("'gist', 'read:org', 'repo', 'workflow'");
  assert.deepEqual(await probeWith(t, 'gh version 2.102.0 (2026-09-30)', noProject),
    { result: 'no-project-scope', version: '2.102.0', fix: 'gh auth refresh -s project' });
  assert.deepEqual(await probeWith(t, 'gh version 2.93.2 (2026-06-01)', noProject),
    { result: 'no-project-scope', version: '2.93.2', fix: 'gh auth refresh -s project', upgrade: 'brew upgrade gh' });
});

test('scopes the board can\'t read block nothing', async (t) => {
  // GH_TOKEN, a fine-grained token or several accounts: no scopes line, an empty one, or one per account.
  assert.deepEqual(await probeWith(t, 'gh version 2.102.0 (2026-09-30)', authStatus(null)), { result: 'ok', version: '2.102.0', scopes: 'unread' });
  assert.deepEqual(await probeWith(t, 'gh version 2.102.0 (2026-09-30)', authStatus('none')), { result: 'ok', version: '2.102.0', scopes: 'unread' });
  assert.deepEqual(await probeWith(t, 'gh version 2.102.0 (2026-09-30)', `${authStatus("'repo'")}\n${authStatus(withProject)}`),
    { result: 'ok', version: '2.102.0', scopes: 'unread' });
  assert.deepEqual(await probeWith(t, 'gh version 2.93.2 (2026-06-01)', authStatus(null)),
    { result: 'outdated', version: '2.93.2', fix: 'brew upgrade gh', scopes: 'unread' });
});

test('a missing or logged-out gh still blocks reading', async (t) => {
  const { shell } = await machine(t, []);
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell, GH_PATH: '/nowhere/gh' });
  assert.deepEqual((await probeGh()).check, { result: 'missing', override: 'GH_PATH=/nowhere/gh', fix: 'brew install gh' });
});

const AZ_VERSION = `echo '{"azure-cli": "2.67.0", "azure-cli-core": "2.67.0", "extensions": {"azure-devops": "1.0.1"}}'`;

/**
 * Probes an az that runs `version` as given, and whose `account show` and `extension show` exit with these codes.
 * `--version`, which looks up the latest az over the network, exits 9.
 */
async function probeAzWith(t: TestContext, account: number, extension: number, version = AZ_VERSION) {
  const { bin, shell } = await machine(t, []);
  await writeFile(join(bin, 'az'), `#!/bin/sh
[ "$*" = version ] && { ${version}; exit; }
[ "$1 $2" = "account show" ] && { [ ${account} = 0 ] && echo '{}' || echo "Please run 'az login' to setup account." >&2; exit ${account}; }
[ "$*" = "extension show --name azure-devops" ] && exit ${extension}
exit 9
`);
  await chmod(join(bin, 'az'), 0o755);
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell });
  return probeAz();
}

test('an az signed in with the azure-devops extension passes, with its version', async (t) => {
  assert.deepEqual(await probeAzWith(t, 0, 0), { result: 'ok', version: '2.67.0' });
});

test('az names its fix: az login when signed out, else az extension add without the extension', async (t) => {
  assert.deepEqual(await probeAzWith(t, 1, 1), { result: 'logged-out', version: '2.67.0', fix: 'az login' });
  assert.deepEqual(await probeAzWith(t, 0, 1), { result: 'no-extension', version: '2.67.0', fix: 'az extension add --name azure-devops' });
});

test('an az that fails to print its version still has its sign-in and extension checked, without a version', async (t) => {
  assert.deepEqual(await probeAzWith(t, 0, 0, 'exit 1'), { result: 'ok' });
  assert.deepEqual(await probeAzWith(t, 1, 0, 'echo not json'), { result: 'logged-out', fix: 'az login' });
  assert.deepEqual(await probeAzWith(t, 0, 1, `echo '{"extensions": {}}'`), { result: 'no-extension', fix: 'az extension add --name azure-devops' });
});

test('a missing az has brew install azure-cli as its fix', async (t) => {
  const { shell } = await machine(t, []);
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell, AZ_PATH: '/nowhere/az' });
  assert.deepEqual(await probeAz(), { result: 'missing', override: 'AZ_PATH=/nowhere/az', fix: 'brew install azure-cli' });
});

test('the checks probe gh and az only when asked to', async (t) => {
  const { shell } = await machine(t, []);
  await lookUpTools({ PATH: '/usr/bin:/bin', SHELL: shell, GH_PATH: '/nowhere/gh', AZ_PATH: '/nowhere/az' });
  const neither = (await checkTools({ gh: false, az: false })).tools;
  assert.deepEqual(['gh' in neither, 'az' in neither], [false, false]);
  const both = (await checkTools({ gh: true, az: true })).tools;
  assert.deepEqual([both.gh?.result, both.az?.result], ['missing', 'missing']);
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
