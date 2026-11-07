import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { expect, test } from 'vite-plus/test';

import { openBoardAddress } from './board-address.ts';

test('rejects untrusted Host headers without contacting the child', async () => {
    const address = await openBoardAddress();
    let contacted = false;
    const child = createServer((_req, res) => {
        contacted = true;
        res.end();
    });

    child.listen(0, '127.0.0.1');
    await once(child, 'listening');
    address.connect(new URL(`http://127.0.0.1:${(child.address() as import('node:net').AddressInfo).port}`));

    try {
        for (const host of ['attacker.example', '127.0.0.1:1', 'localhost:1']) {
            const status = await new Promise<number | undefined>((resolve, reject) => {
                const req = request(address.url, { headers: { Host: host } }, (res) => {
                    res.resume();
                    resolve(res.statusCode);
                });

                req.on('error', reject);
                req.end();
            });

            expect(status).toBe(421);
        }
        expect(contacted).toBe(false);
    } finally {
        address.close();
        child.close();
    }
});

test('keeps the page address across child ports and refuses requests while disconnected', async () => {
    const address = await openBoardAddress();
    const children = [];

    try {
        for (const value of ['first', 'second']) {
            const child = createServer((req, res) => {
                expect(req.headers.origin).toBe(`http://${req.headers.host}`);
                res.setHeader('Content-Type', 'text/event-stream');
                res.end(`data: ${value}\n\n`);
            });

            children.push(child);
            child.listen(0, '127.0.0.1');
            await once(child, 'listening');

            const port = (child.address() as import('node:net').AddressInfo).port;

            address.connect(new URL(`http://127.0.0.1:${port}`));

            const response = await fetch(new URL('/api/events', address.url), {
                headers: { Origin: address.url.origin },
            });

            expect(await response.text()).toBe(`data: ${value}\n\n`);
            address.disconnect();
            expect((await fetch(new URL('/api/events', address.url))).status).toBe(503);
        }
    } finally {
        address.close();
        for (const child of children) child.close();
    }
});

test('does not authorize foreign origins or inject a secret into requests', async () => {
    const address = await openBoardAddress();
    const child = createServer((req, res) => res.end(JSON.stringify(req.headers)));

    child.listen(0, '127.0.0.1');
    await once(child, 'listening');

    const port = (child.address() as import('node:net').AddressInfo).port;

    address.connect(new URL(`http://127.0.0.1:${port}`));

    try {
        const response = await fetch(address.url, { headers: { Origin: 'https://foreign.example' } });
        const headers = await response.json();

        expect(headers.origin).toBe('https://foreign.example');
        expect(headers['x-board-secret']).toBeUndefined();

        const write = await fetch(address.url, {
            method: 'POST',
            headers: {
                Origin: address.url.origin,
                'X-Board-Secret': 'launch-secret',
            },
        });

        expect((await write.json())['x-board-secret']).toBe('launch-secret');
    } finally {
        address.close();
        child.close();
    }
});

test('interrupts a live event stream so reconnect can reach the replacement child', async () => {
    const address = await openBoardAddress();
    const child = createServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write('data: loaded\n\n');
    });

    child.listen(0, '127.0.0.1');
    await once(child, 'listening');
    address.connect(new URL(`http://127.0.0.1:${(child.address() as import('node:net').AddressInfo).port}`));

    try {
        const response = await fetch(new URL('/api/events', address.url));
        const reader = response.body!.getReader();

        expect(new TextDecoder().decode((await reader.read()).value)).toBe('data: loaded\n\n');
        address.disconnect();
        await expect(reader.read()).rejects.toThrow();
        expect((await fetch(new URL('/api/events', address.url))).status).toBe(503);
    } finally {
        address.close();
        child.closeAllConnections();
        child.close();
    }
});
