import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:net';
import { once } from 'node:events';
import { BOARD_PORTS, listenOnFreePort } from './port.ts';
import { freePort } from '../../test/server-support.ts';

async function hold(t: TestContext, port: number): Promise<Server> {
  const server = createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  t.onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return server;
}

/** A free port whose next port is free too. */
async function freePair(): Promise<number> {
  for (;;) {
    const port = await freePort();
    if (port < 65535 && await isFree(port + 1)) return port;
  }
}

async function isFree(port: number): Promise<boolean> {
  const server = createServer();
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    return true;
  } catch { return false; }
  finally { if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve())); }
}

test('a board without BOARD_PORT tries 4317 to 4416 in order', () => {
  assert.equal(BOARD_PORTS[0], 4317);
  assert.equal(BOARD_PORTS.at(-1), 4416);
  assert.equal(BOARD_PORTS.length, 100);
});

test('a taken port is skipped for the next one', async (t) => {
  const first = await freePair();
  await hold(t, first);
  const server = createServer();
  t.onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  assert.equal(await listenOnFreePort(server, '127.0.0.1', [first, first + 1]), first + 1);
  assert.equal((server.address() as { port: number }).port, first + 1);
});

test('every port taken gives null and leaves the server closed', async (t) => {
  const port = await freePort();
  await hold(t, port);
  const server = createServer();
  assert.equal(await listenOnFreePort(server, '127.0.0.1', [port]), null);
  assert.equal(server.listening, false);
});

test('port zero binds an OS-assigned port and returns the actual listening port', async (t) => {
  const server = createServer();
  t.onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const port = await listenOnFreePort(server, '127.0.0.1', [0]);
  assert.ok(port && port > 0);
  assert.equal((server.address() as { port: number }).port, port);
});
