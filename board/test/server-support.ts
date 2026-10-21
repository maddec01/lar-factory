import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { TestContext } from 'node:test';

async function readCalls(file: string): Promise<string[][]> {
  return (await readFile(file, 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]);
}

/** A raw GraphQL project item, as the fake gh returns it. */
export function rawIssue(number: number, status: string, repo = 'maddec01/mux-factory') {
  return {
    id: `PVTI_${number}`, updatedAt: '2026-10-21T09:00:00Z', status: { name: status },
    content: { __typename: 'Issue', number, title: `Issue ${number}`, url: `https://github.com/${repo}/issues/${number}`,
      state: 'OPEN', closedAt: null, updatedAt: '2026-10-21T09:00:00Z', repository: { nameWithOwner: repo },
      labels: { nodes: [] }, parent: null, subIssuesSummary: { total: 0, completed: 0 },
      issueDependenciesSummary: { blockedBy: 0 }, closedByPullRequestsReferences: { nodes: [] } },
  };
}

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
  const port = env.BOARD_PORT ? Number(env.BOARD_PORT) : await freePort();
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning',
    ...(fastRefresh ? ['--import', new URL('./fast-refresh.ts', import.meta.url).href] : []), 'src/server.ts'], {
    cwd: directory ?? new URL('../', import.meta.url),
    env: { ...process.env, BOARD_PORT: String(port), GH_PATH: new URL('./fake-gh.cjs', import.meta.url).pathname,
      T3_PATH: new URL('./fake-t3.cjs', import.meta.url).pathname,
      FAKE_GH_STATE: stateFile, BOARD_DATA_FILE: fixture ? 'test/sample.json' : '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (data: Buffer) => { logs += data.toString(); });
  child.stderr.on('data', (data: Buffer) => { logs += data.toString(); });
  t.after(async () => {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
    await rm(dir, { recursive: true, force: true });
  });
  const url = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      const response = await fetch(`${url}/api/board`);
      if (response.ok) return {
        url,
        update: (value: object) => writeFile(stateFile, JSON.stringify(value)),
        calls: () => readCalls(stateFile + '.calls'),
        t3Calls: () => readCalls(stateFile + '.t3calls'),
        board: () => fetch(`${url}/api/board`).then((r) => r.json()),
        post: (body: unknown, origin = url, path = '/api/items') => fetch(`${url}${path}`, { method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      };
    } catch { /* Wait for the subprocess to listen. */ }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Board did not start: ${logs}`);
}
