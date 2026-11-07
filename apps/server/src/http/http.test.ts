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

const png = { type: 'image/png', body: Buffer.from('png bytes') };

it("sends a listed project's favicon with its checked type, nosniff and long caching, and no SVG policy", async () => {
    const { get, lookup } = await serve(async () => png);
    const response = await get('/api/project-icon/project%3Aone?v=abc');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('png bytes');
    expect(lookup).toHaveBeenCalledWith('project:one');
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('max-age=31536000');
    expect(response.headers.get('content-security-policy')).toBeNull();
});

it("sends an SVG under T3's policy", async () => {
    const { get } = await serve(async () => ({ type: 'image/svg+xml', body: Buffer.from('<svg/>') }));
    const response = await get('/api/project-icon/one');

    expect(response.headers.get('content-security-policy')).toBe(
        "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
});

it('answers 404 for an unlisted ID, one with no bytes and a malformed one', async () => {
    const { get } = await serve(async () => undefined);

    expect((await get('/api/project-icon/unlisted')).status).toBe(404);
    expect((await get('/api/project-icon/%E0%A4%A')).status).toBe(404);
    expect((await get('/api/project-icon/')).status).toBe(404);
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

/** A board server with open event streams, a guarded write and a count of how many times a push stringifies the board. */
async function serveStreams() {
    const board = createBoardState({ repos: [], items: [] } as unknown as BoardData);
    let stringified = 0;

    board.update({ count: { toJSON: () => (stringified++, 0) } } as unknown as Partial<BoardData>);

    const { server, endStreams } = createBoardServer({
        board,
        page: { template: '<html></html>', assets: new Map() },
        ready: () => undefined,
        retention: { save: () => ({ status: 200, body: { error: null } }) },
    } as unknown as HttpDeps);

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    close = () =>
        new Promise((resolve) => {
            endStreams();
            server.close(resolve);
        });

    const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const open = async () => {
        const reader = (await fetch(`${origin}/api/events`)).body!.pipeThrough(new TextDecoderStream()).getReader();
        let buffered = '';
        /** The next event's board. */
        const next = async (): Promise<BoardData> => {
            while (!buffered.includes('\n\n')) buffered += (await reader.read()).value ?? '';

            const end = buffered.indexOf('\n\n');
            const event = buffered.slice('data: '.length, end);

            buffered = buffered.slice(end + 2);

            return JSON.parse(event) as BoardData;
        };

        return { next };
    };
    const write = () =>
        fetch(`${origin}/api/retention`, {
            method: 'POST',
            headers: { Origin: origin, 'Content-Type': 'application/json' },
            body: '{}',
        });

    return { board, open, write, stringified: () => stringified };
}

const fetchedAt = (at: string) => ({ fetchedAt: at });

it('stringifies the board once per push, however many pages listen', async () => {
    const { board, open, stringified } = await serveStreams();
    const [first, second] = [await open(), await open()];

    await first.next();
    await second.next();

    const before = stringified();

    board.update(fetchedAt('a'));
    board.push();
    expect((await first.next()).fetchedAt).toBe('a');
    expect((await second.next()).fetchedAt).toBe('a');
    expect(stringified() - before).toBe(1);
});

it('writes no identical board to a stream, and sends the next one that differs', async () => {
    const { board, open } = await serveStreams();
    const stream = await open();

    await stream.next();
    board.push();
    board.push();
    board.update(fetchedAt('a'));
    board.push();
    // The event right after the first is the changed board: the identical pushes wrote nothing.
    expect((await stream.next()).fetchedAt).toBe('a');
});

it('sends a new stream the board at once, though the open ones already have it', async () => {
    const { board, open } = await serveStreams();

    board.update(fetchedAt('a'));

    const reconnected = await open();

    expect((await reconnected.next()).fetchedAt).toBe('a');

    const another = await open();

    expect((await another.next()).fetchedAt).toBe('a');
});

it('calls every subscriber on each push, also when no stream gets the board', async () => {
    const { board, open } = await serveStreams();
    const subscriber = vi.fn();

    board.subscribe(subscriber);
    await (await open()).next();
    board.push();
    board.push();
    expect(subscriber).toHaveBeenCalledTimes(2);
});

it("sends the board again after a write, as the write's answer may have shown the page something no push did", async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

    try {
        const { board, open, write } = await serveStreams();
        const stream = await open();

        await stream.next();
        // The answer carries the changed board with no push, then the board goes back to what the stream last received.
        board.update(fetchedAt('answered'));
        expect((await write()).status).toBe(200);
        board.update({ fetchedAt: null });
        board.push();
        vi.advanceTimersByTime(2_000);
        expect((await stream.next()).fetchedAt).toBeNull();
    } finally {
        vi.useRealTimers();
    }
});
