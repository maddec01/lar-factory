import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import type { TestContext } from 'node:test';

export async function startBoard(t: TestContext, options = {}, fixture = false, fastRefresh = false) {
  const dir = await mkdtemp(join(tmpdir(), 'mux-board-test-'));
  const stateFile = join(dir, 'github.json');
  await writeFile(stateFile, JSON.stringify(options));
  await writeFile(stateFile + '.calls', '');
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  const port = address.port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning',
    ...(fastRefresh ? ['--import', './test/fast-refresh.ts'] : []), 'src/server.ts'], {
    cwd: new URL('../', import.meta.url),
    env: { ...process.env, BOARD_PORT: String(port), GH_PATH: new URL('./fake-gh.cjs', import.meta.url).pathname,
      FAKE_GH_STATE: stateFile, BOARD_DATA_FILE: fixture ? 'test/sample.json' : '' },
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
        calls: async (): Promise<string[][]> => (await readFile(stateFile + '.calls', 'utf8')).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l) as string[]),
        board: () => fetch(`${url}/api/board`).then((r) => r.json()),
        post: (body: unknown, origin = url) => fetch(`${url}/api/items`, { method: 'POST',
          headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      };
    } catch { /* Wait for the subprocess to listen. */ }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`Board did not start: ${logs}`);
}
