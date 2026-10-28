import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkouts } from './repo-support.ts';
import { startBoard, until } from './server-support.ts';
import { projectsDb } from './stats-db.ts';
import type { Board } from './server-support.ts';
import type { BoardData, ToolCheck } from '@lar-factory/shared';
import { projectIssue } from '@lar-factory/shared/test/raw-items';
import type { TestContext } from 'vite-plus/test';

const recheck = (board: Board) => board.post({}, board.url, '/api/recheck');

/** Each check's result, keeping a failed check whole; a passing check's version depends on the machine. */
const results = (tools: BoardData['tools']) => tools && Object.fromEntries(Object.entries(tools).map(([name, check]: [string, ToolCheck]) =>
  [name, check.result === 'ok' ? 'ok' : check]));
const allOk = { gh: 'ok', t3: 'ok', git: 'ok', jq: 'ok', curl: 'ok' };
const ghMissing = { ...allOk, gh: { result: 'missing', override: 'GH_PATH=/nowhere/gh', fix: 'brew install gh' } };
const ghLoggedOut = { ...allOk, gh: { result: 'logged-out', version: '2.96.0', fix: 'gh auth login' } };

/** Whether t3, git, jq and curl have landed, which the page doesn't wait for. */
const landed = (data: BoardData) => (['t3', 'git', 'jq', 'curl'] as const).every((name) => data.tools?.[name]);
const checked = (board: Board) => until(board, landed);

/** The board data once the first read has finished, or failed, and every check has landed. */
const afterRead = (board: Board) => until(board, (d) => Boolean(d.fetchedAt || d.error) && landed(d));

test('the board listens before a slow login shell answers, and its data waits for that first lookup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-slow-shell-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const shell = join(dir, 'slow-shell');
  writeFileSync(shell, '#!/bin/sh\nsleep 1\nexec /bin/sh -c "$2"\n', { mode: 0o755 });
  const board = await startBoard(t, {}, false, false, { SHELL: shell, GH_PATH: '/nowhere/gh' });
  assert.deepEqual(results((await checked(board)).tools), ghMissing);
  const logs = board.logs();
  assert.ok(logs.indexOf('board on ') < logs.indexOf('gh was not found'), logs);
});

test('Recheck finds a t3 that appeared after startup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-t3-later-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const t3 = join(dir, 't3');
  const board = await startBoard(t, {}, false, false, { T3_PATH: t3 });
  const t3Missing = { ...allOk, t3: { result: 'missing', override: `T3_PATH=${t3}` } };
  assert.deepEqual(results((await checked(board)).tools), t3Missing);
  // The page paints its notice from the data inline in it.
  const page = await (await fetch(`${board.url}/`)).text();
  const inline = JSON.parse(page.match(/<script id="board-data" type="application\/json">(.*?)<\/script>/s)![1]!);
  assert.deepEqual(results(inline.tools), t3Missing);
  copyFileSync(new URL('./fake-t3.cjs', import.meta.url), t3);
  chmodSync(t3, 0o755);
  const response = await recheck(board);
  assert.equal(response.status, 200);
  const { tools } = (await response.json()).board as BoardData;
  assert.deepEqual(results(tools), allOk);
  assert.deepEqual(tools?.t3, { result: 'ok', version: '0.1.4-nightly.1' });
  assert.deepEqual(tools?.gh, { result: 'ok', version: '2.96.0' });
});

test('a logged-out gh shows its notice and reads nothing until Recheck finds it logged in', async (t) => {
  const board = await startBoard(t, { ghAuth: 'logged-out' });
  const data = await checked(board);
  assert.deepEqual(results(data.tools), ghLoggedOut);
  assert.equal(data.error, null);
  assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
  await board.update({});
  assert.deepEqual(results((await (await recheck(board)).json()).board.tools), allOk);
  assert.ok((await afterRead(board)).fetchedAt, 'the board reads GitHub once gh works');
});

test('a gh that logs out after a whole read shows its notice, and the board keeps reading so it never shows Stale', async (t) => {
  const board = await startBoard(t, {}, false, true);
  await until(board, (d) => d.fetchedAt !== null);
  await board.update({ ghAuth: 'logged-out', fail: 'read' });
  const blocked = await until(board, (d) => d.tools?.gh?.result === 'logged-out');
  assert.equal(blocked.error, null);
  const read = await until(board, (d) => d.fetchedAt !== blocked.fetchedAt);
  assert.equal(read.error, null);
  assert.equal(read.tools?.gh?.result, 'logged-out');
});

test('a logged-out gh that logs in is found by the timed retry, which keeps the login PATH it read', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-shell-log-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const shellLog = join(dir, 'runs');
  const shellRuns = () => existsSync(shellLog) ? readFileSync(shellLog, 'utf8').trim().split('\n').length : 0;
  const board = await startBoard(t, { ghAuth: 'logged-out' }, false, false, { FAKE_SHELL_LOG: shellLog, BOARD_TOOL_RETRY_MS: '100' });
  assert.deepEqual(results((await checked(board)).tools), ghLoggedOut);
  await board.update({});
  assert.ok((await afterRead(board)).fetchedAt, 'the board reads GitHub once a retry finds gh logged in');
  assert.deepEqual(results((await board.board()).tools), allOk);
  assert.equal(shellRuns(), 1, 'only startup reads the login shell PATH');
  await recheck(board);
  assert.equal(shellRuns(), 2, 'Recheck reads it again');
});

/** How many times the board has run `gh auth status`, once per gh probe. */
const ghProbes = async (board: Board) => (await board.calls()).filter((args) => args[0] === 'auth' && args[1] === 'status').length;

test('an old gh and a missing jq wait for Recheck, while T3 Code not running is looked at again by itself', async (t) => {
  const waiting = await startBoard(t, { ghVersion: '2.93.1' }, false, false, { JQ_PATH: '/nowhere/jq', BOARD_TOOL_RETRY_MS: '50' });
  assert.ok((await afterRead(waiting)).fetchedAt, 'the board reads GitHub');
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(await ghProbes(waiting), 1, 'no timed retry');

  const dir = mkdtempSync(join(tmpdir(), 'lar-t3-closed-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const retrying = await startBoard(t, {}, false, false, { T3_SERVER_RUNTIME: join(dir, 'server-runtime.json'), BOARD_TOOL_RETRY_MS: '50' });
  await afterRead(retrying);
  const deadline = Date.now() + 5_000;
  while (await ghProbes(retrying) < 2 && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(await ghProbes(retrying) >= 2, 'the timed retry probes again');
});

test('a gh older than 2.94.0 shows its notice and the board still reads GitHub', async (t) => {
  const board = await startBoard(t, { ghVersion: '2.93.1' });
  const data = await afterRead(board);
  assert.ok(data.fetchedAt, 'the board reads GitHub');
  assert.deepEqual(data.tools?.gh, { result: 'outdated', version: '2.93.1', fix: 'brew upgrade gh' });
  assert.match(board.logs(), /gh is older than 2\.94\.0/);
});

test('a login without the project scope reads no Project until Recheck finds the scope', async (t) => {
  const board = await startBoard(t, { ghScopes: "'repo'" });
  const data = await board.board();
  assert.deepEqual(data.tools?.gh, { result: 'no-project-scope', version: '2.96.0', fix: 'gh auth refresh -s project' });
  assert.equal(data.error, null);
  assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
  assert.match(board.logs(), /gh can't read Projects/);
  await board.update({});
  assert.deepEqual(results((await (await recheck(board)).json()).board.tools), allOk);
  assert.ok((await afterRead(board)).fetchedAt, 'the board reads the Project once the login has the scope');
});

test('scopes the board can\'t read block nothing', async (t) => {
  const data = await afterRead(await startBoard(t, { ghScopes: null }));
  assert.ok(data.fetchedAt, 'the board reads GitHub');
  assert.deepEqual(data.tools?.gh, { result: 'ok', version: '2.96.0', scopes: 'unread' });
});

test('a missing gh names its override', async (t) => {
  const board = await startBoard(t, {}, false, false, { GH_PATH: '/nowhere/gh' });
  assert.deepEqual(results((await checked(board)).tools), ghMissing);
  assert.match(board.logs(), /t3 at \S+; gh was not found at GH_PATH=\/nowhere\/gh; az /);
});

test('a failed read whose gh auth status fails without a logout shows gh\'s error as Stale', async (t) => {
  const data = await afterRead(await startBoard(t, { fail: 'read', ghAuth: 'failed' }));
  assert.deepEqual(results(data.tools), allOk);
  assert.match(data.error ?? '', /gh auth status failed: error connecting to api\.github\.com/);
});

test('a failed read with gh logged in stays Stale with the read\'s error', async (t) => {
  const data = await afterRead(await startBoard(t, { fail: 'read' }));
  assert.deepEqual(results(data.tools), allOk);
  assert.match(data.error ?? '', /HTTP 502: Bad Gateway/);
});

test('a missing jq, git or curl has its check but doesn\'t stop the board reading GitHub', async (t) => {
  const board = await startBoard(t, {}, false, false, { JQ_PATH: '/nowhere/jq', GIT_PATH: '/nowhere/git', CURL_PATH: '/nowhere/curl' });
  const data = await afterRead(board);
  assert.ok(data.fetchedAt, 'the board reads GitHub');
  assert.deepEqual(results(data.tools), { ...allOk,
    git: { result: 'missing', override: 'GIT_PATH=/nowhere/git', fix: 'brew install git' },
    jq: { result: 'missing', override: 'JQ_PATH=/nowhere/jq', fix: 'brew install jq' },
    curl: { result: 'missing', override: 'CURL_PATH=/nowhere/curl', fix: 'brew install curl' } });
  assert.match(board.logs(), /git was not found at GIT_PATH=\/nowhere\/git; jq was not found at JQ_PATH=\/nowhere\/jq; curl was not found/);
});

test('a listed repository on Azure DevOps gets an az check, which Recheck reruns, and az never stops the read', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-azure-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  checkouts(home, { 'lar-api': 'git@ssh.dev.azure.com:v3/contoso/Fabrikam/lar-api' });
  const az = join(home, 'az');
  const fakeAz = (account: number) => {
    writeFileSync(az, `#!/bin/sh\n[ "$1" = version ] && echo '{"azure-cli": "2.67.0"}' && exit 0\n[ "$1" = account ] && exit ${account}\nexit 0\n`);
    chmodSync(az, 0o755);
  };
  fakeAz(1);
  const board = await startBoard(t, { repositories: ['maddec01/lar-factory', 'contoso/Fabrikam/lar-api'] }, false, false, { HOME: home, AZ_PATH: az,
    T3_STATE_DB: projectsDb(t, [{ id: 'project-api', root: join(home, 'Developer/lar/lar-api') }]) });
  const data = await afterRead(board);
  assert.ok(data.fetchedAt, 'the board reads GitHub');
  assert.deepEqual(results(data.tools), { ...allOk, az: { result: 'logged-out', version: '2.67.0', fix: 'az login' } });
  fakeAz(0);
  assert.deepEqual((await (await recheck(board)).json()).board.tools.az, { result: 'ok', version: '2.67.0' });
});

test('with only Azure DevOps repositories listed, gh isn\'t checked and a missing gh blocks no read', async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-azure-only-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  checkouts(home, { 'lar-api': 'git@ssh.dev.azure.com:v3/contoso/Fabrikam/lar-api' });
  const az = join(home, 'az');
  writeFileSync(az, `#!/bin/sh\n[ "$1" = version ] && echo '{"azure-cli": "2.67.0"}' && exit 0\nexit 0\n`, { mode: 0o755 });
  const env = { HOME: home, AZ_PATH: az, T3_STATE_DB: projectsDb(t, [{ id: 'project-api', root: join(home, 'Developer/lar/lar-api') }]) };
  const options = { repositories: ['contoso/Fabrikam/lar-api'] };
  const probed = await startBoard(t, options, false, false, env);
  const data = await afterRead(probed);
  assert.equal(data.tools?.gh, undefined);
  assert.deepEqual(data.toolProgress?.skipped, ['gh'], 'gh shows as left out');
  assert.equal(await ghProbes(probed), 0, 'gh isn\'t probed');

  const missing = await afterRead(await startBoard(t, options, false, false, { ...env, GH_PATH: '/nowhere/gh' }));
  assert.ok(missing.fetchedAt, 'the board reads without gh');
  assert.equal(missing.error, null);
  assert.equal(missing.tools?.gh, undefined);
});

test('onboarding asks for the gh check with no listed repository on GitHub', async (t) => {
  const board = await startBoard(t, { repositories: [] });
  assert.equal((await afterRead(board)).tools?.gh, undefined);
  assert.deepEqual((await (await board.post({ gh: true }, board.url, '/api/recheck')).json()).board.tools.gh, { result: 'ok', version: '2.96.0' });
});

test("onboarding's Checks step asks for the az check with no listed repository on Azure DevOps", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-azure-onboarding-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const az = join(dir, 'az');
  writeFileSync(az, `#!/bin/sh\n[ "$1" = version ] && echo '{"azure-cli": "2.67.0"}' && exit 0\nexit 0\n`, { mode: 0o755 });
  const board = await startBoard(t, {}, false, false, { AZ_PATH: az });
  const before = await afterRead(board);
  assert.equal(before.tools?.az, undefined);
  assert.deepEqual(before.toolProgress?.skipped, ['az']);
  const asked = (await (await board.post({ az: true }, board.url, '/api/recheck')).json()).board as BoardData;
  assert.deepEqual(asked.tools?.az, { result: 'ok', version: '2.67.0' });
  assert.deepEqual(asked.toolProgress, { checking: [], skipped: [] }, 'az, asked for, is no longer left out');
});

test('T3 Code not running has its check but doesn\'t stop the board reading GitHub, and Recheck finds it running', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-t3-closed-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const runtime = join(dir, 'server-runtime.json');
  const board = await startBoard(t, {}, false, false, { T3_SERVER_RUNTIME: runtime });
  const data = await afterRead(board);
  assert.ok(data.fetchedAt, 'the board reads GitHub');
  assert.deepEqual(results(data.tools), { ...allOk, t3: { result: 'not-running', version: '0.1.4-nightly.1' } });
  assert.match(board.logs(), /T3 Code is not running/);
  writeFileSync(runtime, JSON.stringify({ version: 1, pid: process.pid, port: 3773, origin: 'http://127.0.0.1:3773' }));
  assert.deepEqual((await (await recheck(board)).json()).board.tools.t3, { result: 'ok', version: '0.1.4-nightly.1' });
});

test('sample mode looks no tools up', async (t) => {
  const board = await startBoard(t, {}, true);
  assert.equal((await board.board()).tools, undefined);
  assert.equal((await board.board()).toolProgress, undefined);
  assert.equal((await recheck(board)).status, 403);
});

/** A command at `dir/name` that waits until `release` runs, then runs `body`. */
function heldCommand(dir: string, name: string, body: string): { path: string; release: () => void } {
  const path = join(dir, name);
  const go = join(dir, `${name}.go`);
  writeFileSync(path, `#!/bin/sh\nwhile [ ! -f '${go}' ]; do sleep 0.05; done\n${body}\n`, { mode: 0o755 });
  return { path, release: () => writeFileSync(go, '') };
}

/**
 * A home with lar-api's checkout on Azure DevOps, and an az there that logs each call, answers lar-api's
 * .lar-factory.json as a sprint and finds no current sprint, which is a problem on lar-api alone; `version` waits for
 * `release` when `held`.
 */
function azureHome(t: TestContext, held: boolean) {
  const home = mkdtempSync(join(tmpdir(), 'lar-azure-wait-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  checkouts(home, { 'lar-api': 'git@ssh.dev.azure.com:v3/contoso/Fabrikam/lar-api' });
  const log = join(home, 'az-calls');
  const go = join(home, 'az.go');
  const config = JSON.stringify({ path: '/.lar-factory.json', content: JSON.stringify({ role: 'API', itemSource: { kind: 'azure-sprint', team: 'Team' } }) });
  const az = join(home, 'az');
  writeFileSync(az, `#!/bin/sh
echo "$*" >> '${log}'
if [ "$1" = version ]; then
  ${held ? `while [ ! -f '${go}' ]; do sleep 0.05; done` : ':'}
  echo '{"azure-cli": "2.67.0"}'; exit 0
fi
[ "$1" = account ] || [ "$1" = extension ] && exit 0
case "$*" in *"--resource items"*) printf '%s' '${config}'; exit 0;; boards*) echo '[]'; exit 0;; esac
echo 'ERROR: offline' >&2; exit 1
`, { mode: 0o755 });
  /** The az calls that read items, not the check or the config. */
  const itemReads = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [])
    .filter((call) => /^(boards|devops invoke)\b/.test(call) && !call.includes('--resource items'));
  const env = { HOME: home, AZ_PATH: az, T3_STATE_DB: projectsDb(t, [{ id: 'project-api', root: join(home, 'Developer/lar/lar-api') }]) };
  return { home, env, itemReads, release: () => writeFileSync(go, '') };
}

const mixed = { items: [projectIssue(1, 'List', 'maddec01/lar-factory')], repositories: ['maddec01/lar-factory', 'contoso/Fabrikam/lar-api'] };

test('a slow az check holds up neither the page nor the GitHub read, and the Azure DevOps read waits for it', async (t) => {
  const azure = azureHome(t, true);
  const board = await startBoard(t, mixed, false, false, azure.env);
  const read = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(read.items.map((i) => i.id), ['I_1'], 'the GitHub read finished');
  assert.equal(read.tools?.az, undefined, 'az still checks');
  assert.ok(read.toolProgress?.checking.includes('az'), 'az shows as checking');
  assert.deepEqual(read.toolProgress?.skipped, [], 'neither provider\'s tool is left out');
  assert.equal(read.firstRead.settled, false, 'the first read waits for the Azure DevOps source');
  assert.deepEqual(azure.itemReads(), [], 'no Azure DevOps read before az\'s check lands');
  azure.release();
  const settled = await until(board, (d) => d.firstRead.settled);
  assert.equal(settled.tools?.az?.result, 'ok');
  assert.ok(!settled.toolProgress?.checking.includes('az'), 'az no longer checks');
  assert.ok(azure.itemReads().length > 0, 'the Azure DevOps source reads once az\'s check lands');
});

test('a slow gh check holds up no Azure DevOps read', async (t) => {
  const azure = azureHome(t, false);
  const hold = join(azure.home, 'gh.go');
  const board = await startBoard(t, { ...mixed, authHold: hold }, false, false, azure.env);
  const deadline = Date.now() + 5_000;
  while (!azure.itemReads().length && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
  assert.ok(azure.itemReads().length > 0, 'the Azure DevOps source reads while gh still checks');
  assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0, 'no GitHub read before gh\'s check lands');
  writeFileSync(hold, '');
  const settled = await until(board, (d) => d.firstRead.settled);
  assert.equal(settled.tools?.gh?.result, 'ok');
  assert.deepEqual(settled.items.map((i) => i.id), ['I_1']);
});

test('a slow t3 or jq check holds up neither the page nor the read, and its notice shows once it lands', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-slow-tools-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const t3 = heldCommand(dir, 't3', 'echo t3 v0.1.4-nightly.1');
  const jq = heldCommand(dir, 'jq', 'echo jq-1.7.1');
  const board = await startBoard(t, { items: [projectIssue(1, 'List')] }, false, false,
    { T3_PATH: t3.path, JQ_PATH: jq.path, T3_SERVER_RUNTIME: join(dir, 'no-runtime.json') });
  const read = await until(board, (d) => d.firstRead.settled);
  assert.ok(read.fetchedAt, 'the board reads GitHub');
  assert.equal(read.tools?.t3, undefined);
  assert.equal(read.tools?.jq, undefined);
  t3.release();
  jq.release();
  const landed = await until(board, (d) => d.tools?.t3 !== undefined && d.tools.jq !== undefined);
  assert.deepEqual(landed.tools?.t3, { result: 'not-running', version: '0.1.4-nightly.1' });
  assert.equal(landed.tools?.jq?.result, 'ok');
});
