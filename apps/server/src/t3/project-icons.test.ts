import type { BoardData, ChosenProjectIcon } from '@lar-factory/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test';

import { checkouts } from '../../test/repo-support.ts';
import { createBoardState } from '../board/board-state.ts';
import { createProjectIcons } from './project-icons.ts';
import type { ProjectFact, ProjectRead } from './project-protocol.ts';

const t3 = vi.hoisted(() => ({
    read: { availability: 'unavailable' } as ProjectRead,
    session: vi.fn(async () => ({ token: 'board-token', sessionId: 'board', expiresAt: '2099-01-01' })),
    invalidate: vi.fn(),
    listeners: new Set<() => void>(),
    /** When each read of T3's projects started, which every icon read does first. */
    reads: [] as number[],
}));

vi.mock('./repository-project-discovery.ts', () => ({
    repositoryProjects: async () => {
        t3.reads.push(Date.now());

        return t3.read;
    },
    subscribeRepositoryProjects(listener: () => void) {
        t3.listeners.add(listener);

        return () => t3.listeners.delete(listener);
    },
    repositoryProjectAccess: () =>
        t3.read.availability === 'available'
            ? {
                  origin: new URL('http://127.0.0.1:3773'),
                  protocol: { subscriptionSession: t3.session, invalidateSession: t3.invalidate },
              }
            : undefined,
}));

const home = mkdtempSync(join(tmpdir(), 'lar-project-icons-'));

checkouts(home, {
    factory: 'git@github.com:maddec01/lar-factory.git',
    server: 'https://github.com/maddec01/lar-server',
    'server-copy': 'https://github.com/maddec01/lar-server',
    apple: 'https://github.com/maddec01/lar-apple',
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const fact = (name: string, fields: Partial<ProjectFact> = {}): ProjectFact => ({
    id: `id-${name}`,
    title: name,
    workspaceRoot: join(home, 'Developer/lar', name),
    faviconPath: null,
    projectIcon: null,
    ...fields,
});
const listed = (...projects: ProjectFact[]): ProjectRead => ({
    availability: 'available',
    observation: { projects, observedAt: '2026-11-03T00:00:00Z' },
});
const repo = (name: string) => ({ repo: `maddec01/${name}` });
const boardOf = (...repos: string[]) => createBoardState({ repos: repos.map(repo), items: [] } as unknown as BoardData);

/** What T3 answers per workspace: the asset fetch's response, or an RPC that fails or never answers. */
const rpcFails = () => new Response();
const rpcHangs = () => new Response();
const rpcNotFound = () => new Response();
let assets: Record<string, (signal?: AbortSignal) => Response | Promise<Response>>;
let requests: Record<string, unknown>[];
let requestHeaders: (Headers | undefined)[];
const png = (body: string) => () => new Response(body, { headers: { 'Content-Type': 'image/png' } });

class FakeT3Socket extends EventTarget {
    static OPEN = 1;
    static count = 0;
    readyState = 1;
    constructor() {
        super();
        FakeT3Socket.count++;
        queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(value: string) {
        const frame = JSON.parse(value) as { _tag: string; tag: string; payload: { resource: { cwd: string } } };

        if (frame._tag !== 'Request') return;

        // oxlint-disable-next-line vitest/no-standalone-expect -- the fake socket runs inside the test that drives it
        expect(frame.tag).toBe('assets.createUrl');
        requests.push(frame.payload.resource);

        const name = frame.payload.resource.cwd.split('/').at(-1)!;

        if (assets[name] === rpcHangs) return;

        const exit =
            assets[name] === rpcFails
                ? { _tag: 'Failure', cause: [] }
                : assets[name] === rpcNotFound
                  ? {
                        _tag: 'Failure',
                        cause: [
                            {
                                _tag: 'Fail',
                                error: { _tag: 'AssetProjectFaviconNotFoundError', resource: frame.payload.resource },
                            },
                        ],
                    }
                  : {
                        _tag: 'Success',
                        value: {
                            relativeUrl: `/api/assets/signed/${name}?token=signed-secret`,
                            expiresAt: 'not a date Date.parse reads',
                        },
                    };

        queueMicrotask(() =>
            this.dispatchEvent(
                new MessageEvent('message', { data: JSON.stringify({ _tag: 'Exit', requestId: '1', exit }) }),
            ),
        );
    }
    close() {
        this.readyState = 3;
    }
}

beforeEach(() => {
    t3.reads = [];
    assets = {};
    requests = [];
    requestHeaders = [];
    FakeT3Socket.count = 0;
    vi.stubGlobal('WebSocket', FakeT3Socket);
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: URL, init?: RequestInit) => {
            if (input.pathname === '/api/auth/websocket-ticket/rpc') return Response.json({ ticket: 'fixture' });

            requestHeaders.push(new Headers(init?.headers));
            // oxlint-disable-next-line vitest/no-standalone-expect -- the fetch stub runs inside the test that drives it
            expect(init?.redirect).toBe('error');

            return Promise.race([
                assets[input.pathname.split('/').at(-1)!]!(init?.signal ?? undefined),
                new Promise<Response>((_, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
            ]);
        }),
    );
});
// A test that fails before it stops leaves its listener, which later tests' project changes would call.
afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.clearAllMocks();
    t3.listeners.clear();
});

it('publishes a favicon outside the checkout and a checkout favicon with no T3 path, URL or token on the board', async () => {
    t3.read = listed(fact('factory', { faviconPath: '../shared/logo.svg' }), fact('apple'));
    assets = {
        factory: () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } }),
        apple: png('apple'),
    };

    const board = boardOf('lar-factory', 'lar-apple');
    const icons = createProjectIcons(board);

    await icons.refresh();

    const { projectIcons } = board.snapshot();

    // Each revision is the first 16 hex digits of the body's SHA-256, from shasum.
    expect(projectIcons).toEqual({
        'maddec01/lar-factory': { kind: 'favicon', projectId: 'id-factory', revision: 'd4dc56669143034f' },
        'maddec01/lar-apple': { kind: 'favicon', projectId: 'id-apple', revision: '3a7bd3e2360a3d29' },
    });
    expect(requests).toEqual(
        expect.arrayContaining([
            { _tag: 'project-favicon', cwd: join(home, 'Developer/lar/factory'), path: '../shared/logo.svg' },
            { _tag: 'project-favicon', cwd: join(home, 'Developer/lar/apple') },
        ]),
    );
    expect(
        requestHeaders.every((headers) => !headers?.has('authorization')),
        'the signed URL needs no bearer',
    ).toBe(true);

    const onBoard = JSON.stringify(board.snapshot());

    expect(onBoard).not.toContain('/api/assets/');
    expect(onBoard).not.toContain('signed-secret');
    expect(onBoard).not.toContain('board-token');
    expect(onBoard).not.toContain('logo.svg');
    expect(await icons.image('id-factory')).toEqual({ type: 'image/svg+xml', body: Buffer.from('<svg/>') });
});

it('gives a replaced file a new revision, and an unchanged one leaves the board alone', async () => {
    t3.read = listed(fact('factory'));
    assets = { factory: png('old') };

    const board = boardOf('lar-factory');
    const pushed = vi.fn();

    board.subscribe(pushed);

    const icons = createProjectIcons(board);

    await icons.refresh();

    const first = board.snapshot().projectIcons!['maddec01/lar-factory'];

    expect(pushed).toHaveBeenCalledTimes(1);
    await icons.refresh();
    expect(pushed).toHaveBeenCalledTimes(1);
    assets = { factory: png('new') };
    await icons.refresh();
    expect(pushed).toHaveBeenCalledTimes(2);
    expect(board.snapshot().projectIcons!['maddec01/lar-factory']).not.toEqual(first);
    expect((await icons.image('id-factory'))?.body).toEqual(Buffer.from('new'));
});

it('refreshes on its own timer every 4 minutes and when the repositories change, until stopped', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    t3.read = listed(fact('factory'));
    assets = { factory: png('old') };

    const board = boardOf();
    const icons = createProjectIcons(board);
    const stop = icons.start();

    await vi.waitFor(() => expect(board.snapshot().projectIcons).toBeUndefined());

    board.update({ repos: [repo('lar-factory')] } as Partial<BoardData>);
    board.push();
    await vi.waitFor(() => expect(board.snapshot().projectIcons).toBeDefined());
    // The change came during the first read, so a second read follows it; a file replaced before that one ends would show early.
    await icons.refresh();

    const first = board.snapshot().projectIcons;

    assets = { factory: png('new') };
    await vi.advanceTimersByTimeAsync(239_000);
    expect(board.snapshot().projectIcons).toEqual(first);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() => expect(board.snapshot().projectIcons).not.toEqual(first));

    stop();

    const stopped = board.snapshot().projectIcons;

    assets = { factory: png('newer') };
    await vi.advanceTimersByTimeAsync(480_000);
    expect(board.snapshot().projectIcons).toEqual(stopped);
    expect(vi.getTimerCount()).toBe(0);
});

/** An answer that waits for `release`, so a test can act while a read runs. */
const held = (answer: () => Response) => {
    let release = () => {};
    const waiting = new Promise<void>((resolve) => {
        release = resolve;
    });

    return {
        answer: async () => {
            await waiting;

            return answer();
        },
        release: () => release(),
    };
};
const projectsChanged = () => {
    for (const listener of t3.listeners) listener();
};

describe('with no 4-minute tick', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    });

    it('reads again when the repositories change during a read, whose owners came too early', async () => {
        t3.read = listed(fact('factory'));

        const first = held(png('a'));

        assets = { factory: first.answer };

        const board = boardOf();
        const stop = createProjectIcons(board).start();

        await vi.waitFor(() => expect(requests).toHaveLength(1));

        board.update({ repos: [repo('lar-factory')] } as Partial<BoardData>);
        board.push();
        first.release();

        await vi.waitFor(() => expect(board.snapshot().projectIcons).toBeDefined());
        stop();
    });

    it('publishes a favicon that later shell data names after a first read found none, until stopped', async () => {
        t3.read = listed(fact('factory'));
        assets = { factory: rpcNotFound };

        const board = boardOf('lar-factory');
        const stop = createProjectIcons(board).start();

        await vi.waitFor(() => expect(requests).toHaveLength(1));
        await vi.waitFor(() => expect(board.snapshot().projectIcons).toBeUndefined());

        t3.read = listed(fact('factory', { faviconPath: 'logo.png' }));
        assets = { factory: png('a') };
        projectsChanged();
        await vi.waitFor(() => expect(board.snapshot().projectIcons).toBeDefined());
        expect(requests.at(-1)).toEqual({
            _tag: 'project-favicon',
            cwd: join(home, 'Developer/lar/factory'),
            path: 'logo.png',
        });

        stop();
        expect(t3.listeners.size).toBe(0);
    });

    it('answers changes during a read with one more read, and nothing after it', async () => {
        t3.read = listed(fact('factory'));

        const first = held(png('a'));

        assets = { factory: first.answer };

        const stop = createProjectIcons(boardOf('lar-factory')).start();

        await vi.waitFor(() => expect(requests).toHaveLength(1));

        projectsChanged();
        projectsChanged();
        projectsChanged();
        first.release();

        await vi.waitFor(() => expect(requests).toHaveLength(2));
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(requests).toHaveLength(2);
        stop();
    });

    it('keeps a good icon when a change reports T3 unavailable', async () => {
        t3.read = listed(fact('factory'));
        assets = { factory: png('a') };

        const board = boardOf('lar-factory');
        const stop = createProjectIcons(board).start();

        await vi.waitFor(() => expect(board.snapshot().projectIcons).toBeDefined());

        const known = board.snapshot().projectIcons;

        t3.read = { ...t3.read, availability: 'unavailable' };
        projectsChanged();
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(board.snapshot().projectIcons).toEqual(known);
        stop();
    });
});

describe('between reads for T3 changes', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    });
    afterEach(() => {
        t3.listeners.clear();
    });

    const started = (count: number) => vi.waitFor(() => expect(t3.reads).toHaveLength(count));
    /** The board's reads running with the startup read finished. Each read gets new bytes, so it ends by publishing them. */
    const running = async () => {
        let answers = 0;
        const newBytes = () => png(String(++answers))();

        t3.read = listed(fact('factory'));
        assets = { factory: newBytes };

        const board = boardOf('lar-factory');
        const update = vi.spyOn(board, 'update');
        const icons = createProjectIcons(board);
        const stop = icons.start();
        /** Waits for every read started so far to end. */
        const readsEnded = async () => {
            await vi.waitFor(() =>
                expect(update.mock.calls.filter(([fields]) => 'projectIcons' in fields)).toHaveLength(t3.reads.length),
            );
            await vi.advanceTimersByTimeAsync(0);
        };
        /** Runs a read for a T3 change, which opens a gap, until it ends, and returns when it started. */
        const changeRead = async () => {
            const before = t3.reads.length;

            projectsChanged();
            await started(before + 1);
            await readsEnded();

            return t3.reads.at(-1)!;
        };
        /** Makes the next read run until `release`. */
        const holdNextRead = () => {
            const hold = held(() => {
                assets = { factory: newBytes };

                return newBytes();
            });

            assets = { factory: hold.answer };

            return hold;
        };
        /** Starts a direct read that runs until `release`. */
        const heldRead = async () => {
            const hold = holdNextRead();
            const asked = requests.length;
            const read = icons.refresh();

            await vi.waitFor(() => expect(requests).toHaveLength(asked + 1));

            return { read, release: hold.release };
        };
        /** Stops once every read has ended, so none reaches the next test's fixtures. */
        const finish = async () => {
            await readsEnded();
            stop();
        };

        await readsEnded();

        return { board, icons, stop, finish, readsEnded, changeRead, holdNextRead, heldRead };
    };
    const listRepositories = (board: ReturnType<typeof boardOf>) => {
        board.update({ repos: [repo('lar-factory'), repo('lar-apple')] } as Partial<BoardData>);
        board.push();
    };
    /** Advances to just before `read`'s gap ends and checks no read came, then to its end and checks one did. */
    const readsAtGapEnd = async (read: number) => {
        const reads = t3.reads.length;

        await vi.advanceTimersByTimeAsync(read + 29_999 - Date.now());
        expect(t3.reads).toHaveLength(reads);
        await vi.advanceTimersByTimeAsync(1);
        expect(t3.reads).toHaveLength(reads + 1);
        expect(t3.reads.at(-1)! - read).toBe(30_000);
    };

    it('reads the first change at once, because the startup read opens no gap', async () => {
        const { finish } = await running();
        const changedAt = Date.now();

        projectsChanged();
        await vi.advanceTimersByTimeAsync(0);
        expect(t3.reads).toHaveLength(2);
        expect(t3.reads[1]).toBe(changedAt);
        await finish();
    });

    // oxlint-disable-next-line vitest/expect-expect -- readsAtGapEnd asserts the reads
    it('answers any number of changes inside a gap with one read when it ends, which opens the next gap', async () => {
        const { finish, changeRead, readsEnded } = await running();
        const first = await changeRead();

        projectsChanged();
        projectsChanged();
        projectsChanged();
        await readsAtGapEnd(first);
        await readsEnded();

        const second = t3.reads.at(-1)!;

        projectsChanged();
        await readsAtGapEnd(second);
        await finish();
    });

    it('holds a change during a read for T3 until the gap that read opened ends', async () => {
        const { finish, holdNextRead, readsEnded } = await running();
        const hold = holdNextRead();

        projectsChanged();
        await started(2);

        const read = t3.reads[1]!;

        await vi.waitFor(() => expect(requests).toHaveLength(2));

        projectsChanged();
        hold.release();
        await readsEnded();
        await readsAtGapEnd(read);
        await finish();
    });

    it('reads a change right after a running read and measures the gap from when its read starts', async () => {
        const { finish, heldRead, readsEnded } = await running();
        const hold = await heldRead();

        projectsChanged();
        projectsChanged();
        await vi.advanceTimersByTimeAsync(1_000);

        const reads = t3.reads.length;

        hold.release();
        await started(reads + 1);

        const read = t3.reads.at(-1)!;

        await readsEnded();
        expect(t3.reads, 'both changes share it').toHaveLength(reads + 1);

        projectsChanged();
        await readsAtGapEnd(read);
        await finish();
    });

    it('opens a gap from a read shared with a repository list change', async () => {
        const { board, finish, heldRead, readsEnded } = await running();
        const hold = await heldRead();

        listRepositories(board);
        projectsChanged();

        const reads = t3.reads.length;

        hold.release();
        await started(reads + 1);

        const read = t3.reads.at(-1)!;

        await readsEnded();
        expect(t3.reads, 'the change and the list share one read').toHaveLength(reads + 1);

        projectsChanged();
        await readsAtGapEnd(read);
        await finish();
    });

    it('lets repository list changes and the picker read inside a gap, and their reads leave the gap alone', async () => {
        const { board, icons, finish, changeRead, readsEnded } = await running();
        const first = await changeRead();

        await vi.advanceTimersByTimeAsync(10_000);

        const listedAt = Date.now();

        listRepositories(board);
        await vi.advanceTimersByTimeAsync(0);
        expect(t3.reads).toHaveLength(3);
        expect(t3.reads[2]).toBe(listedAt);
        await readsEnded();

        await icons.byProject();
        expect(t3.reads).toHaveLength(4);
        await readsEnded();

        projectsChanged();
        await readsAtGapEnd(first);
        await finish();
    });

    it('keeps a good icon on the board through a gap and while T3 is unavailable', async () => {
        const { board, stop } = await running();
        const known = board.snapshot().projectIcons;

        t3.read = { ...t3.read, availability: 'unavailable' };
        projectsChanged();
        await started(2);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(board.snapshot().projectIcons).toEqual(known);

        t3.read = { ...t3.read, availability: 'available' };
        projectsChanged();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(t3.reads).toHaveLength(2);
        expect(board.snapshot().projectIcons).toEqual(known);
        stop();
    });

    it('starts no read after stop for a change waiting for a gap, and direct calls still read', async () => {
        const { icons, stop, changeRead } = await running();

        await changeRead();
        projectsChanged();

        const atStop = t3.reads.length;

        stop();
        expect(vi.getTimerCount()).toBe(0);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(t3.reads).toHaveLength(atStop);

        await icons.refresh();
        expect(t3.reads, 'a direct call is exempt').toHaveLength(atStop + 1);
        await icons.byProject();
        expect(t3.reads).toHaveLength(atStop + 2);
    });

    it('starts no read after stop for a T3 or repository list change waiting for a running read', async () => {
        const { board, stop, heldRead } = await running();
        const hold = await heldRead();

        projectsChanged();
        listRepositories(board);

        const reads = t3.reads.length;

        stop();
        hold.release();
        await hold.read;
        await vi.advanceTimersByTimeAsync(60_000);

        expect(t3.reads).toHaveLength(reads);
        expect(vi.getTimerCount()).toBe(0);
    });
});

type Answer = () => Response | Promise<Response>;

/** Answers that say this attempt learned nothing about the file. */
const inconclusive: [string, Answer][] = [
    ['the server fails', () => new Response('', { status: 500 })],
    ['the RPC fails', rpcFails],
    ['the connection fails', () => Promise.reject(new TypeError('fetch failed'))],
];
/** Answers that say T3 has no file the board can use. */
const gone: [string, Answer][] = [
    ['T3 answers 404', () => new Response('', { status: 404 })],
    ['T3 finds no favicon', rpcNotFound],
    [
        'the body is over 1 MB',
        () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } }),
    ],
    ['the media type is not allowed', () => new Response('<html>', { headers: { 'Content-Type': 'text/html' } })],
    ['the media type is .icns', () => new Response('icns', { headers: { 'Content-Type': 'image/x-icns' } })],
    ['the body is empty', () => new Response('', { headers: { 'Content-Type': 'image/png' } })],
];

it.each([...inconclusive, ...gone])('publishes nothing when %s', async (_case, answer) => {
    t3.read = listed(fact('factory'));
    assets = { factory: answer };

    const board = boardOf('lar-factory');
    const icons = createProjectIcons(board);

    await icons.refresh();
    expect(board.snapshot().projectIcons).toBeUndefined();
    expect(await icons.image('id-factory')).toBeUndefined();
    expect(t3.invalidate, 'a failed fetch leaves the board session alone').not.toHaveBeenCalled();
});

it('keeps a body of exactly 1 MB and stops reading past it', async () => {
    t3.read = listed(fact('factory'));
    assets = { factory: () => new Response(new Uint8Array(1024 * 1024), { headers: { 'Content-Type': 'image/png' } }) };

    const icons = createProjectIcons(boardOf('lar-factory'));

    await icons.refresh();
    expect((await icons.image('id-factory'))?.body.length).toBe(1024 * 1024);

    const cancelled = vi.fn();
    let chunks = 0;
    const endless = new ReadableStream<Uint8Array>({
        pull(controller) {
            chunks++;
            controller.enqueue(new Uint8Array(512 * 1024));
        },
        cancel: cancelled,
    });

    assets = { factory: () => new Response(endless, { headers: { 'Content-Type': 'image/png' } }) };
    await icons.refresh();
    expect(cancelled).toHaveBeenCalled();
    expect(chunks).toBeLessThan(6);
    expect(await icons.image('id-factory'), 'an image over the limit is gone').toBeUndefined();
});

it.each([
    ['the RPC', rpcHangs],
    ['the image fetch', () => new Promise<Response>(() => {})],
    [
        'the body',
        (signal?: AbortSignal) =>
            new Response(
                new ReadableStream({
                    start(controller) {
                        signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
                    },
                }),
                { headers: { 'Content-Type': 'image/png' } },
            ),
    ],
])('gives up after 5 seconds when %s never finishes', async (_case, answer) => {
    t3.read = listed(fact('factory'));
    assets = { factory: png('good') };

    const board = boardOf('lar-factory');
    const icons = createProjectIcons(board);

    await icons.refresh();

    const known = board.snapshot().projectIcons;

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    requests = [];
    assets = { factory: answer };

    let done = false;
    const refresh = icons.refresh().then(() => {
        done = true;
    });

    await vi.waitFor(() => expect(requests).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(4_900);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    await refresh;
    expect(board.snapshot().projectIcons, 'the last good icon stays').toEqual(known);
});

it('refuses a URL that leaves the T3 origin', async () => {
    t3.read = listed(fact('factory'));

    const send = vi.spyOn(FakeT3Socket.prototype, 'send').mockImplementation(function (
        this: FakeT3Socket,
        value: string,
    ) {
        if ((JSON.parse(value) as { _tag: string })._tag !== 'Request') return;

        queueMicrotask(() =>
            this.dispatchEvent(
                new MessageEvent('message', {
                    data: JSON.stringify({
                        _tag: 'Exit',
                        requestId: '1',
                        exit: { _tag: 'Success', value: { relativeUrl: '//elsewhere.example/logo.png' } },
                    }),
                }),
            ),
        );
    });

    const board = boardOf('lar-factory');

    await createProjectIcons(board).refresh();
    send.mockRestore();
    expect(vi.mocked(fetch).mock.calls.filter(([url]) => (url as URL).host === 'elsewhere.example')).toEqual([]);
    expect(board.snapshot().projectIcons).toBeUndefined();
});

it('keeps the last good bytes through an inconclusive fetch, and drops them when T3 has no usable file or no longer lists the project', async () => {
    t3.read = listed(fact('factory'));
    assets = { factory: png('good') };

    const board = boardOf('lar-factory');
    const icons = createProjectIcons(board);

    await icons.refresh();

    const known = board.snapshot().projectIcons;

    for (const [, answer] of inconclusive) {
        assets = { factory: answer };
        await icons.refresh();
        expect(board.snapshot().projectIcons).toEqual(known);
        expect((await icons.image('id-factory'))?.body).toEqual(Buffer.from('good'));
    }
    for (const [name, answer] of gone) {
        assets = { factory: answer };
        await icons.refresh();
        expect(board.snapshot().projectIcons, `${name} answer`).toEqual({});
        expect(await icons.image('id-factory'), `${name} answer`).toBeUndefined();
        assets = { factory: png('good') };
        await icons.refresh();
        expect(board.snapshot().projectIcons, `${name} answer`).toEqual(known);
    }
    t3.read = listed();
    expect(await icons.image('id-factory'), 'an unlisted project answers at once').toBeUndefined();
    await icons.refresh();
    t3.read = listed(fact('factory'));
    expect(await icons.image('id-factory'), 'its bytes are gone').toBeUndefined();
});

it('leaves a repository without exactly one main checkout out of the map', async () => {
    t3.read = listed(fact('server'), fact('server-copy'), fact('factory'));
    assets = { server: png('a'), 'server-copy': png('b'), factory: png('c') };

    const board = boardOf('lar-server', 'lar-docs', 'lar-factory');

    await createProjectIcons(board).refresh();
    expect(Object.keys(board.snapshot().projectIcons!)).toEqual(['maddec01/lar-factory']);
});

it('holds the icon of every project T3 lists, on the board or not, with no T3 path, URL or token', async () => {
    const chosen: ChosenProjectIcon = { kind: 'emoji', emoji: '🚀' };

    t3.read = listed(
        fact('factory'),
        fact('apple', { faviconPath: 'logo.png' }),
        fact('server', { projectIcon: chosen }),
        fact('docs'),
    );
    assets = { factory: png('a'), apple: png('b'), docs: () => new Response('', { status: 404 }) };

    const board = boardOf('lar-factory');
    const icons = createProjectIcons(board);

    const held = await icons.byProject();

    // The revision is the first 16 hex digits of the body's SHA-256, from shasum.
    expect(Object.fromEntries(held)).toEqual({
        'id-factory': { kind: 'favicon', projectId: 'id-factory', revision: 'ca978112ca1bbdca' },
        'id-apple': { kind: 'favicon', projectId: 'id-apple', revision: '3e23e8160039594a' },
        'id-server': chosen,
    });
    expect(JSON.stringify([...held])).not.toMatch(/signed-secret|\/api\/assets\/|board-token|logo\.png/);
    expect((await icons.image('id-apple'))?.body, 'the endpoint serves a project off the board').toEqual(
        Buffer.from('b'),
    );
    expect(Object.keys(board.snapshot().projectIcons!), 'the board still only names its own').toEqual([
        'maddec01/lar-factory',
    ]);
});

it('answers a list within 2 seconds with what it knows when T3 is slow', async () => {
    t3.read = listed(fact('factory'));
    assets = { factory: png('a') };

    const icons = createProjectIcons(boardOf());
    const known = await icons.byProject();

    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    assets = { factory: rpcHangs };

    let held: ReadonlyMap<string, unknown> | undefined;
    const list = icons.byProject().then((found) => {
        held = found;
    });

    await vi.advanceTimersByTimeAsync(1_900);
    expect(held).toBeUndefined();
    await vi.advanceTimersByTimeAsync(200);
    await list;
    expect(held).toEqual(known);
    await vi.advanceTimersByTimeAsync(5_000);
});

it('keeps a known icon while T3 is unavailable, sends nothing and knows nothing without one', async () => {
    t3.read = listed(fact('factory'), fact('apple'));
    assets = { factory: png('good'), apple: () => new Response('', { status: 404 }) };

    const board = boardOf('lar-factory', 'lar-apple');
    const icons = createProjectIcons(board);

    await icons.refresh();

    const known = board.snapshot().projectIcons;

    expect(Object.keys(known!)).toEqual(['maddec01/lar-factory']);

    t3.read = { ...t3.read, availability: 'unavailable' };

    const before = requests.length;

    await icons.refresh();
    expect(requests).toHaveLength(before);
    expect(board.snapshot().projectIcons).toEqual(known);
    expect((await icons.image('id-factory'))?.body).toEqual(Buffer.from('good'));
    expect(await icons.image('id-apple')).toBeUndefined();

    t3.read = { availability: 'unavailable' };

    const fresh = boardOf('lar-factory');
    const nothing = createProjectIcons(fresh);

    await nothing.refresh();
    expect(fresh.snapshot().projectIcons).toBeUndefined();
    expect(await nothing.image('id-factory')).toBeUndefined();
});

it.each<ChosenProjectIcon>([
    { kind: 'emoji', emoji: '🚀' },
    { kind: 'lucide', name: 'rocket', color: 'sky' },
    { kind: 'monogram', text: 'LF', color: 'rose' },
])(
    'publishes a chosen $kind icon without asking T3 for a favicon, and drops bytes it no longer needs',
    async (chosen) => {
        t3.read = listed(fact('factory'));
        assets = { factory: png('good') };

        const board = boardOf('lar-factory');
        const icons = createProjectIcons(board);

        await icons.refresh();
        t3.read = listed(fact('factory', { projectIcon: chosen }));
        requests = [];
        await icons.refresh();
        expect(requests).toEqual([]);
        expect(board.snapshot().projectIcons).toEqual({ 'maddec01/lar-factory': chosen });
        expect(await icons.image('id-factory')).toBeUndefined();
    },
);

it('runs at most four fetches at once', async () => {
    const names = ['a', 'b', 'c', 'd', 'e', 'f'];
    const origins = Object.fromEntries(names.map((name) => [name, `https://github.com/maddec01/${name}`]));

    checkouts(home, origins);

    let running = 0;
    let most = 0;
    const slow = async () => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running--;

        return new Response('x', { headers: { 'Content-Type': 'image/png' } });
    };

    assets = Object.fromEntries(names.map((name) => [name, slow]));
    t3.read = listed(...names.map((name) => fact(name)));

    const board = boardOf(...names);

    await createProjectIcons(board).refresh();
    expect(Object.keys(board.snapshot().projectIcons!)).toHaveLength(6);
    expect(most).toBe(4);
});
