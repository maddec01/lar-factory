import type { BoardData } from '@lar-factory/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';

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
