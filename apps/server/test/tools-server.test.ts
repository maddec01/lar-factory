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

const recheck = (board: Board) => board.post({}, board.url, '/api/recheck');

/** Each check's result, keeping a failed check whole; a passing check's version depends on the machine. */
const results = (tools: BoardData['tools']) => tools && Object.fromEntries(Object.entries(tools).map(([name, check]: [string, ToolCheck]) =>
  [name, check.result === 'ok' ? 'ok' : check]));
const allOk = { gh: 'ok', t3: 'ok', git: 'ok', jq: 'ok', curl: 'ok' };
const ghMissing = { ...allOk, gh: { result: 'missing', override: 'GH_PATH=/nowhere/gh', fix: 'brew install gh' } };
const ghLoggedOut = { ...allOk, gh: { result: 'logged-out', version: '2.96.0', fix: 'gh auth login' } };

/** The board data once the first read has finished, or failed. */
const afterRead = (board: Board) => until(board, (d) => Boolean(d.fetchedAt || d.error));

test('the board listens before a slow login shell answers, and its data waits for that first lookup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-slow-shell-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const shell = join(dir, 'slow-shell');
  writeFileSync(shell, '#!/bin/sh\nsleep 1\nexec /bin/sh -c "$2"\n', { mode: 0o755 });
  const board = await startBoard(t, {}, false, false, { SHELL: shell, GH_PATH: '/nowhere/gh' });
  assert.deepEqual(results((await board.board()).tools), ghMissing);
  const logs = board.logs();
  assert.ok(logs.indexOf('board on ') < logs.indexOf('gh was not found'), logs);
});

test('Recheck finds a t3 that appeared after startup', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-t3-later-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const t3 = join(dir, 't3');
  const board = await startBoard(t, {}, false, false, { T3_PATH: t3 });
  const t3Missing = { ...allOk, t3: { result: 'missing', override: `T3_PATH=${t3}` } };
  assert.deepEqual(results((await board.board()).tools), t3Missing);
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
  const data = await board.board();
  assert.deepEqual(results(data.tools), ghLoggedOut);
  assert.equal(data.error, null);
  assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
  await board.update({});
  assert.deepEqual(results((await (await recheck(board)).json()).board.tools), allOk);
  assert.ok((await afterRead(board)).fetchedAt, 'the board reads GitHub once gh works');
});

test('a logged-out gh that logs in is found by the timed retry, which keeps the login PATH it read', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-shell-log-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const shellLog = join(dir, 'runs');
  const shellRuns = () => existsSync(shellLog) ? readFileSync(shellLog, 'utf8').trim().split('\n').length : 0;
  const board = await startBoard(t, { ghAuth: 'logged-out' }, false, false, { FAKE_SHELL_LOG: shellLog, BOARD_TOOL_RETRY_MS: '100' });
  assert.deepEqual(results((await board.board()).tools), ghLoggedOut);
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
  assert.deepEqual(results((await board.board()).tools), ghMissing);
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
  const config = join(home, 'config.json');
  writeFileSync(config, JSON.stringify({ project: { owner: 'maddec01', title: 'lar' },
    repos: [{ repo: 'maddec01/lar-factory', platform: 'Factory', role: 'factory' }, { repo: 'Fabrikam/lar-api', platform: 'Server', role: 'api' }] }));
  const az = join(home, 'az');
  const fakeAz = (account: number) => {
    writeFileSync(az, `#!/bin/sh\n[ "$1" = --version ] && echo 'azure-cli 2.67.0' && exit 0\n[ "$1" = account ] && exit ${account}\nexit 0\n`);
    chmodSync(az, 0o755);
  };
  fakeAz(1);
  const board = await startBoard(t, {}, false, false, { HOME: home, BOARD_CONFIG_FILE: config, AZ_PATH: az,
    T3_STATE_DB: projectsDb(t, [{ id: 'project-api', root: join(home, 'Developer/lar/lar-api') }]) });
  const data = await afterRead(board);
  assert.ok(data.fetchedAt, 'the board reads GitHub');
  assert.deepEqual(results(data.tools), { ...allOk, az: { result: 'logged-out', version: '2.67.0', fix: 'az login' } });
  fakeAz(0);
  assert.deepEqual((await (await recheck(board)).json()).board.tools.az, { result: 'ok', version: '2.67.0' });
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
  assert.equal((await recheck(board)).status, 403);
});
