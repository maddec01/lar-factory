import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server } from 'node:net';
import { test, type TestContext } from 'vite-plus/test';

import { freePort } from '../../test/server-support.ts';
import { listenOnFreePort } from './port.ts';

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

        if (port < 65535 && (await isFree(port + 1))) return port;
    }
}

async function isFree(port: number): Promise<boolean> {
    const server = createServer();

    try {
        server.listen(port, '127.0.0.1');
        await once(server, 'listening');

        return true;
    } catch {
        return false;
    } finally {
        if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    }
}

test('a taken port is skipped for the next one', async (t) => {
    const first = await freePair();

    await hold(t, first);

    const server = createServer();

    t.onTestFinished(() => new Promise<void>((resolve) => server.close(() => resolve())));
    assert.equal(await listenOnFreePort(server, '127.0.0.1', [first, first + 1]), first + 1);
    assert.equal((server.address() as { port: number }).port, first + 1);
});
