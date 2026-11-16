import type { BoardData } from '@lar-factory/shared';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { createBoardState } from '../board/board-state.ts';
import type { ProjectImage } from '../t3/project-icons.ts';
import { createBoardServer, type HttpDeps } from './http.ts';

let close: (() => Promise<unknown>) | undefined;

afterEach(() => close?.());

async function serve(projectIcon: (projectId: string) => Promise<ProjectImage | undefined>) {
    const lookup = vi.fn(projectIcon);
    const { server } = createBoardServer({
        board: createBoardState({ repos: [], items: [] } as unknown as BoardData),
        page: { template: '<html></html>', assets: new Map() },
        ready: () => undefined,
        projectIcon: lookup,
    } as unknown as HttpDeps);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(resolve));

    const { port } = server.address() as AddressInfo;

    return { lookup, get: (path: string) => fetch(`http://127.0.0.1:${port}${path}`) };
}

it("sends an SVG under T3's policy", async () => {
    const { get } = await serve(async () => ({ type: 'image/svg+xml', body: Buffer.from('<svg/>') }));
    const response = await get('/api/project-icon/one');

    expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
});

it("leaves the page's security headers as they were", async () => {
    const { get } = await serve(async () => undefined);
    const response = await get('/');

    expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
    );
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
});

it('sample mode refuses merge writes before commands, including when it reads T3', async () => {
    const mergePr = vi.fn();
    const { server } = createBoardServer({
        board: createBoardState({ repos: [], items: [] } as unknown as BoardData),
        commands: { mergePr },
        sample: true,
        sampleReadsT3: true,
        page: { template: '<html></html>', assets: new Map() },
        ready: () => undefined,
    } as unknown as HttpDeps);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () => new Promise((resolve) => server.close(resolve));

    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    for (const repo of ['owner/repo', 'o/p/r']) {
        const response = await fetch(`${origin}/api/merge-pr`, {
            method: 'POST',
            headers: { origin, 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId: 'item', repo, number: 8, token: 'anything', method: 'squash' }),
        });

        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ error: 'Merging is disabled in sample mode.' });
    }
    expect(mergePr).not.toHaveBeenCalled();
});
