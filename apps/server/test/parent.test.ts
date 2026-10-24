import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freePort, SAMPLE_DATA, SAMPLE_MODELS } from './server-support.ts';
import { testEnv } from './repo-support.ts';
import type { ParentMessage } from '../src/port/port.ts';

/** Starts a sample board with an IPC channel and returns the messages it sends before /healthz answers. */
async function reportedPorts(t: TestContext, env: Record<string, string>): Promise<ParentMessage[]> {
  const home = mkdtempSync(join(tmpdir(), 'mux-board-parent-'));
  const child = fork('src/server.ts', [], {
    cwd: new URL('../', import.meta.url), execArgv: ['--disable-warning=ExperimentalWarning'], stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...testEnv(), ...SAMPLE_MODELS, HOME: home, BOARD_DATA_FILE: SAMPLE_DATA, ...env },
  });
  t.onTestFinished(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
    rmSync(home, { recursive: true, force: true });
  });
  const messages: ParentMessage[] = [];
  child.on('message', (message: ParentMessage) => messages.push(message));
  const [first] = await once(child, 'message', { signal: AbortSignal.timeout(10_000) }) as [ParentMessage];
  const health = await fetch(`http://127.0.0.1:${first.port}/healthz`);
  assert.equal(health.status, 200);
  // Give a second message time to arrive, so the test sees there is only one.
  await new Promise((r) => setTimeout(r, 100));
  return messages;
}

test('a board with an IPC channel reports the port it took from its range once it listens', async (t) => {
  const messages = await reportedPorts(t, { BOARD_PORT: '' });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.type, 'listening');
  assert.ok(messages[0]!.port >= 4317 && messages[0]!.port <= 4416);
});

test('a board with an IPC channel reports its pinned BOARD_PORT once it listens', async (t) => {
  const port = await freePort();
  assert.deepEqual(await reportedPorts(t, { BOARD_PORT: String(port) }), [{ type: 'listening', port }]);
});
