import type { BoardData } from '@lar-factory/shared';
import type { AddressInfo } from 'node:net';
import { expect, test, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import { createBoardServer, type HttpDeps } from './http.ts';

test('settings reads and writes use the existing origin, app-secret and body guards', async (t) => {
    const save = vi.fn(() => ({ status: 200, body: { error: null } }));
    const read = vi.fn(() => ({ settings: { version: 1 } }));
    const { server, endStreams } = createBoardServer({
        board: createBoardState({ repos: [], items: [], modelChoices: [] } as unknown as BoardData),
        ready: () => undefined,
        appSecret: 'test-secret',
        sample: true,
        sampleControl: async () => ({ status: 200, body: {} }),
        factorySettings: { read, save },
    } as unknown as HttpDeps);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    t.onTestFinished(
        () =>
            new Promise<void>((resolve) => {
                endStreams();
                server.close(() => resolve());
            }),
    );

    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const url = `${origin}/api/factory-settings`;
    const headers = { Origin: origin, 'Content-Type': 'application/json', 'X-Board-Secret': 'test-secret' };

    expect((await fetch(url)).status).toBe(200);
    expect(read).toHaveBeenCalledWith([]);
    expect(
        (await fetch(url, { method: 'POST', headers: { ...headers, Origin: 'https://foreign.invalid' }, body: '{}' }))
            .status,
    ).toBe(403);
    expect(
        (await fetch(url, { method: 'POST', headers: { ...headers, 'X-Board-Secret': 'wrong' }, body: '{}' })).status,
    ).toBe(403);
    expect((await fetch(url, { method: 'POST', headers, body: '[]' })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
    expect(
        (await fetch(url, { method: 'POST', headers, body: '{"revision":"current","settings":{"version":1}}' })).status,
    ).toBe(200);
    expect(save).toHaveBeenCalledWith({ revision: 'current', settings: { version: 1 } });
});
