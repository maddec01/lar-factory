import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import type { TestContext } from 'vite-plus/test';
import type { BoardData } from '@mux-factory/shared';
import { checkouts, testEnv } from './repo-support.ts';
import { projectsDb } from './stats-db.ts';

async function readCalls(file: string): Promise<string[][]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
}

/** The board data sample mode serves. */
export const SAMPLE_DATA = fileURLToPath(import.meta.resolve('@mux-factory/shared/test/sample.json'));

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

export async function startBoard(t: TestContext, options = {}, fixture = false, fastRefresh = false, env: Record<string, string> = {}, directory?: string) {
  const dir = await mkdtemp(join(tmpdir(), 'mux-board-test-'));
  const stateFile = join(dir, 'github.json');
  await writeFile(stateFile, JSON.stringify(options));
  await writeFile(stateFile + '.calls', '');
  await writeFile(stateFile + '.t3calls', '');
  // T3 settings whose built-in Claude instance has no transcripts, so tests never read real ones.
  const settingsFile = join(dir, 't3-settings.json');
  await writeFile(settingsFile, JSON.stringify({ providerInstances: { claudeAgent: { driver: 'claudeAgent', config: { homePath: join(dir, 'no-claude') } } } }));
  // Each test gets a spare port; BOARD_PORT '' leaves the board to pick one from its range.
  const port = 'BOARD_PORT' in env ? env.BOARD_PORT : String(await freePort());
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning',
    ...(fastRefresh ? ['--import', new URL('./fast-refresh.ts', import.meta.url).href] : []), 'src/server.ts'], {
    cwd: directory ?? new URL('../', import.meta.url),
    // A home of its own keeps a live board's record out of the real one.
    env: { ...testEnv(), HOME: dir, BOARD_PORT: port, GH_PATH: new URL('./fake-gh.cjs', import.meta.url).pathname,
      T3_PATH: new URL('./fake-t3.cjs', import.meta.url).pathname, SHELL: new URL('./fake-shell.sh', import.meta.url).pathname,
      FAKE_GH_STATE: stateFile, T3_STATE_DB: join(dir, 'no-t3.sqlite'), T3_SETTINGS: settingsFile, BOARD_DATA_FILE: fixture ? SAMPLE_DATA : '',
      ...(fixture ? SAMPLE_MODELS : {}), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (data: Buffer) => { logs += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { logs += data.toString(); });
  const stop = async () => {
    // A board that failed to start has already exited.
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  };
  t.onTestFinished(async () => {
    await stop();
    await rm(dir, { recursive: true, force: true });
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

/** A draft project item, as the fake gh returns it. */
export const draftItem = (status: string) => ({ id: 'PVTI_draft', updatedAt: '2026-10-21T09:00:00Z', status: { name: status },
  content: { __typename: 'DraftIssue', title: 'Idea', updatedAt: '2026-10-21T09:00:00Z' } });

/** Environment for a board that can Start maddec01/mux-factory items: a temporary home holding its
 * checkout, and a T3 database with a live project there. */
export function startableEnv(t: TestContext): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'mux-start-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  checkouts(home, { 'mux-factory': 'git@github.com:maddec01/mux-factory.git' });
  return { HOME: home, T3_STATE_DB: projectsDb(t, [{ id: 'project-factory', root: `${home}/Developer/Mux/mux-factory` }]) };
}
