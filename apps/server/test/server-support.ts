import { spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { TestContext } from 'vite-plus/test';
import { isSkillCheckRequest } from '@lar-factory/shared';
import type { BoardData, SkillCheckAnswer } from '@lar-factory/shared';
import { checkouts, testEnv } from './repo-support.ts';
import { projectsDb } from './stats-db.ts';

/** The calls the fakes logged, skipping a last line a running fake has not finished writing. */
async function readCalls(file: string): Promise<string[][]> {
  const lines = (await readFile(file, 'utf8')).split('\n');
  return lines.slice(0, -1).filter(Boolean).map((l) => JSON.parse(l) as string[]);
}

/** The board data sample mode serves. */
export const SAMPLE_DATA = fileURLToPath(import.meta.resolve('@lar-factory/shared/test/sample.json'));

/** Sample mode's T3 settings and model list, so the Start menu can be tried without T3. */
export const SAMPLE_MODELS = {
  T3_SETTINGS: new URL('./t3-settings.sample.json', import.meta.url).pathname,
  T3_MODEL_MANIFEST: new URL('./model-manifest.sample.json', import.meta.url).pathname,
};

export async function freePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

/** The repositories a test board has onboarded unless its options name others. */
const TEST_REPOSITORIES = ['maddec01/lar-server', 'maddec01/lar-apple', 'maddec01/lar-factory'];

/** Writes the board app's list of onboarded repositories under `home`. */
export function writeRepositoryList(home: string, repos: readonly string[]): void {
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repositories.json'), JSON.stringify({ repositories: repos.map((repo) => ({ repo })) }));
}

/**
 * Lists TEST_REPOSITORIES under `home` with `repo` still onboarding, its PR open. Its default branch has no
 * .lar-factory.json yet, as NOT_LANDED tells the fake gh, or the board finishes the onboarding with the file.
 */
export const NOT_LANDED = { repoConfigs: { 'maddec01/lar-factory': null } };

export function writeOnboarding(home: string, repo: string): void {
  const progress = { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'project-factory' }, prUrl: `https://github.com/${repo}/pull/1` };
  writeRepositoryList(home, TEST_REPOSITORIES);
  const file = join(home, 'Library/Application Support/Lar Factory/repositories.json');
  writeFileSync(file, JSON.stringify({ repositories: TEST_REPOSITORIES.map((r) => (r === repo ? { repo: r, onboarding: progress } : { repo: r })) }));
}

/**
 * Starts a board on the fake gh, whose state `options` holds. Its home lists TEST_REPOSITORIES as onboarded, or
 * `options.repositories` (null for no list file), unless the home already has a list. `skillCheck`, when given, plays
 * the board app: the board gets an IPC channel, and each skill check it asks for gets `skillCheck`'s answer.
 */
export async function startBoard(t: TestContext, options = {}, fixture = false, fastRefresh = false, env: Record<string, string> = {}, directory?: string,
  skillCheck?: () => string | null) {
  const dir = await mkdtemp(join(tmpdir(), 'lar-board-test-'));
  const stateFile = join(dir, 'github.json');
  await writeFile(stateFile, JSON.stringify(options));
  await writeFile(stateFile + '.calls', '');
  await writeFile(stateFile + '.t3calls', '');
  // T3 settings whose built-in Claude instance has no transcripts, so tests never read real ones.
  const settingsFile = join(dir, 't3-settings.json');
  await writeFile(settingsFile, JSON.stringify({ providerInstances: { claudeAgent: { driver: 'claudeAgent', config: { homePath: join(dir, 'no-claude') } } } }));
  // T3 Code's runtime file, naming this test's process, so T3 Code counts as running.
  const runtimeFile = join(dir, 't3-runtime.json');
  await writeFile(runtimeFile, JSON.stringify({ version: 1, pid: process.pid, port: 3773, origin: 'http://127.0.0.1:3773' }));
  // Each test gets a spare port; BOARD_PORT '' leaves the board to pick one from its range.
  const home = env.HOME ?? dir;
  const { repositories = TEST_REPOSITORIES } = options as { repositories?: readonly string[] | null };
  if (repositories && !existsSync(join(home, 'Library/Application Support/Lar Factory/repositories.json'))) writeRepositoryList(home, repositories);
  const port = 'BOARD_PORT' in env ? env.BOARD_PORT : String(await freePort());
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning',
    ...(fastRefresh ? ['--import', new URL('./fast-refresh.ts', import.meta.url).href] : []), 'src/server.ts'], {
    cwd: directory ?? new URL('../', import.meta.url),
    // A home of its own keeps a live board's record out of the real one.
    env: { ...testEnv(), HOME: dir, BOARD_PORT: port, GH_PATH: new URL('./fake-gh.cjs', import.meta.url).pathname,
      T3_PATH: new URL('./fake-t3.cjs', import.meta.url).pathname, SHELL: new URL('./fake-shell.sh', import.meta.url).pathname,
      FAKE_GH_STATE: stateFile, T3_STATE_DB: join(dir, 'no-t3.sqlite'), T3_SETTINGS: settingsFile, T3_SERVER_RUNTIME: runtimeFile, BOARD_DATA_FILE: fixture ? SAMPLE_DATA : '',
      ...(fixture ? SAMPLE_MODELS : {}), ...env },
    stdio: skillCheck ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    // The board leads its own process group, which the gh it runs joins.
    detached: true,
  });
  // A board in its own group misses the terminal's Ctrl-C, and an interrupted run skips onTestFinished. So a
  // watchdog that ignores Ctrl-C reads this worker's pipe and, once the worker dies, stops the group and
  // removes the home.
  const watchdog = child.pid ? spawn('/bin/sh', ['-c', 'trap "" INT HUP; read _; kill -TERM -"$1" 2>/dev/null; sleep 1; rm -rf "$2"',
    'watchdog', String(child.pid), dir], { stdio: ['pipe', 'ignore', 'ignore'] }) : undefined;
  watchdog?.unref();
  (watchdog?.stdin as Socket | undefined)?.unref();
  let skillChecks = 0;
  if (skillCheck) child.on('message', (message) => {
    if (!isSkillCheckRequest(message)) return;
    skillChecks += 1;
    child.send({ type: 'skills-checked', id: message.id, refusal: skillCheck() } satisfies SkillCheckAnswer);
  });
  let logs = '';
  child.stdout!.on('data', (data: Buffer) => { logs += data.toString(); });
  child.stderr!.on('data', (data: Buffer) => { logs += data.toString(); });
  const stop = async () => {
    // A board that failed to start has already exited, or never got a pid.
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      // Stopping the whole group stops a gh still running, so none writes into the home as it is removed.
      process.kill(-child.pid, 'SIGTERM');
      await exited;
    }
  };
  t.onTestFinished(async () => {
    // The watchdog stays up through cleanup, so an interrupt during it is still covered, and goes even if cleanup
    // throws, so it never signals a group id the system may have reused.
    try {
      await stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    } finally {
      watchdog?.kill();
    }
  });
  const board = () => fetch(`${url}/api/board`).then((r) => r.json());
  const post = (body: unknown, origin = url, path = '/api/items') => fetch(`${url}${path}`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let url = '';
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    // The board logs the address it bound.
    url = logs.match(/board on (http:\/\/127\.0\.0\.1:\d+)/)?.[1] ?? '';
    if (url) try {
      const response = await fetch(`${url}/api/board`);
      if (response.ok) return {
        url,
        pid: child.pid!,
        stop,
        update: (value: object) => writeFile(stateFile, JSON.stringify(value)),
        calls: () => readCalls(stateFile + '.calls'),
        t3Calls: () => readCalls(stateFile + '.t3calls'),
        logs: () => logs,
        /** How many skill checks the board has asked for. */
        skillChecks: () => skillChecks,
        board,
        post,
        /** Posts the body with the session the board serves now, as the page does. */
        postSession: async (body: object, path: string, origin = url) =>
          post({ session: (await board() as BoardData).capture!.session, ...body }, origin, path),
      };
    } catch { /* Wait for the subprocess to listen. */ }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Board did not start: ${logs}`);
}

export type Board = Awaited<ReturnType<typeof startBoard>>;

/** Polls the board data until `check` passes, and returns that data. */
export async function until(board: Board, check: (data: BoardData) => boolean): Promise<BoardData> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const data = await board.board() as BoardData;
    if (check(data)) return data;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('The board never reached the expected state');
}

/** Waits for the board to load its repositories' configs, which Add item checks a draft's repository against. */
export const onboarded = (board: Board) => until(board, (data) => data.repos.length > 0);

/** Whether a gh call reads a repository's .lar-factory.json. */
export const readsRepositoryConfig = (args: readonly string[]) => args[0] === 'api' && !!args[1]?.endsWith('/.lar-factory.json');


/** Environment for a board that can Start maddec01/lar-factory items: a temporary home holding its
 * checkout, and a T3 database with a live project there. */
export function startableEnv(t: TestContext): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'lar-start-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-factory': 'git@github.com:maddec01/lar-factory.git' });
  return { HOME: home, T3_STATE_DB: projectsDb(t, [{ id: 'project-factory', root: `${home}/Developer/lar/lar-factory` }]) };
}
