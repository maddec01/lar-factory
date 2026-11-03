import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeEach, expect, it, vi } from 'vite-plus/test';
import type { BoardData, ChosenProjectIcon } from '@lar-factory/shared';
import { createBoardState } from '../board/board-state.ts';
import { checkouts } from '../../test/repo-support.ts';
import type { ProjectFact, ProjectRead } from './project-protocol.ts';
import { createProjectIcons } from './project-icons.ts';

const t3 = vi.hoisted(() => ({
  read: { availability: 'unavailable' } as ProjectRead,
  session: vi.fn(async () => ({ token: 'board-token', sessionId: 'board', expiresAt: '2099-01-01' })),
  invalidate: vi.fn(),
}));
vi.mock('./repository-project-discovery.ts', () => ({
  repositoryProjects: async () => t3.read,
  repositoryProjectAccess: () => t3.read.availability === 'available'
    ? { origin: new URL('http://127.0.0.1:3773'), protocol: { subscriptionSession: t3.session, invalidateSession: t3.invalidate } } : undefined,
}));

const home = mkdtempSync(join(tmpdir(), 'lar-project-icons-'));
checkouts(home, {
  factory: 'git@github.com:maddec01/lar-factory.git',
  server: 'https://github.com/maddec01/lar-server',
  'server-copy': 'https://github.com/maddec01/lar-server',
  apple: 'https://github.com/maddec01/lar-apple',
});
afterAll(() => rmSync(home, { recursive: true, force: true }));

const fact = (name: string, fields: Partial<ProjectFact> = {}): ProjectFact =>
  ({ id: `id-${name}`, title: name, workspaceRoot: join(home, 'Developer/lar', name), faviconPath: null, projectIcon: null, ...fields });
const listed = (...projects: ProjectFact[]): ProjectRead => ({ availability: 'available', observation: { projects, observedAt: '2026-11-03T00:00:00Z' } });
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
  constructor() { super(); FakeT3Socket.count++; queueMicrotask(() => this.dispatchEvent(new Event('open'))); }
  send(value: string) {
    const frame = JSON.parse(value) as { _tag: string; tag: string; payload: { resource: { cwd: string } } };
    if (frame._tag !== 'Request') return;
    expect(frame.tag).toBe('assets.createUrl');
    requests.push(frame.payload.resource);
    const name = frame.payload.resource.cwd.split('/').at(-1)!;
    if (assets[name] === rpcHangs) return;
    const exit = assets[name] === rpcFails ? { _tag: 'Failure', cause: [] }
      : assets[name] === rpcNotFound ? { _tag: 'Failure', cause: [{ _tag: 'Fail', error: { _tag: 'AssetProjectFaviconNotFoundError', resource: frame.payload.resource } }] }
      : { _tag: 'Success', value: { relativeUrl: `/api/assets/signed/${name}?token=signed-secret`, expiresAt: 'not a date Date.parse reads' } };
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ _tag: 'Exit', requestId: '1', exit }) })));
  }
  close() { this.readyState = 3; }
}

beforeEach(() => {
  assets = {};
  requests = [];
  requestHeaders = [];
  FakeT3Socket.count = 0;
  vi.stubGlobal('WebSocket', FakeT3Socket);
  vi.stubGlobal('fetch', vi.fn(async (input: URL, init?: RequestInit) => {
    if (input.pathname === '/api/auth/websocket-ticket/rpc') return Response.json({ ticket: 'fixture' });
    requestHeaders.push(new Headers(init?.headers));
    expect(init?.redirect).toBe('error');
    return Promise.race([assets[input.pathname.split('/').at(-1)!]!(init?.signal ?? undefined), new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })]);
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); vi.clearAllMocks(); });

it('publishes a favicon outside the checkout and a checkout favicon with no T3 path, URL or token on the board', async () => {
  t3.read = listed(fact('factory', { faviconPath: '../shared/logo.svg' }), fact('apple'));
  assets = { factory: () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' } }), apple: png('apple') };
  const board = boardOf('lar-factory', 'lar-apple');
  const icons = createProjectIcons(board);
  await icons.refresh();

  const { projectIcons } = board.snapshot();
  // Each revision is the first 16 hex digits of the body's SHA-256, from shasum.
  expect(projectIcons).toEqual({
    'maddec01/lar-factory': { kind: 'favicon', projectId: 'id-factory', revision: 'd4dc56669143034f' },
    'maddec01/lar-apple': { kind: 'favicon', projectId: 'id-apple', revision: '3a7bd3e2360a3d29' },
  });
  expect(requests).toEqual(expect.arrayContaining([
    { _tag: 'project-favicon', cwd: join(home, 'Developer/lar/factory'), path: '../shared/logo.svg' },
    { _tag: 'project-favicon', cwd: join(home, 'Developer/lar/apple') },
  ]));
  expect(requestHeaders.every(headers => !headers?.has('authorization')), 'the signed URL needs no bearer').toBe(true);
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
  ['the body is over 1 MB', () => new Response(new Uint8Array(1024 * 1024 + 1), { headers: { 'Content-Type': 'image/png' } })],
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
    pull(controller) { chunks++; controller.enqueue(new Uint8Array(512 * 1024)); },
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
  ['the body', (signal?: AbortSignal) => new Response(new ReadableStream({ start(controller) { signal?.addEventListener('abort', () => controller.error(new Error('aborted'))); } }), { headers: { 'Content-Type': 'image/png' } })],
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
  const refresh = icons.refresh().then(() => { done = true; });
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  await vi.advanceTimersByTimeAsync(4_900);
  expect(done).toBe(false);
  await vi.advanceTimersByTimeAsync(200);
  await refresh;
  expect(board.snapshot().projectIcons, 'the last good icon stays').toEqual(known);
});

it('refuses a URL that leaves the T3 origin', async () => {
  t3.read = listed(fact('factory'));
  const send = FakeT3Socket.prototype.send;
  FakeT3Socket.prototype.send = function (value: string) {
    if ((JSON.parse(value) as { _tag: string })._tag !== 'Request') return;
    queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify({ _tag: 'Exit', requestId: '1', exit: { _tag: 'Success', value: { relativeUrl: '//elsewhere.example/logo.png' } } }) })));
  };
  const board = boardOf('lar-factory');
  await createProjectIcons(board).refresh();
  FakeT3Socket.prototype.send = send;
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
    expect(board.snapshot().projectIcons, name).toEqual({});
    expect(await icons.image('id-factory'), name).toBeUndefined();
    assets = { factory: png('good') };
    await icons.refresh();
    expect(board.snapshot().projectIcons, name).toEqual(known);
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
  t3.read = listed(fact('factory'), fact('apple', { faviconPath: 'logo.png' }), fact('server', { projectIcon: chosen }), fact('docs'));
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
  expect((await icons.image('id-apple'))?.body, 'the endpoint serves a project off the board').toEqual(Buffer.from('b'));
  expect(Object.keys(board.snapshot().projectIcons!), 'the board still only names its own').toEqual(['maddec01/lar-factory']);
});

it('reads T3 again for each list, so a project added since the last read has its icon', async () => {
  t3.read = listed(fact('factory'));
  assets = { factory: png('a'), apple: png('b') };
  const icons = createProjectIcons(boardOf());
  const running = icons.refresh();
  await vi.waitFor(() => expect(requests).toHaveLength(1));
  t3.read = listed(fact('factory'), fact('apple'));
  const held = await icons.byProject();
  await running;
  expect([...held.keys()]).toEqual(['id-factory', 'id-apple']);
});

it('answers a list within 2 seconds with what it knows when T3 is slow', async () => {
  t3.read = listed(fact('factory'));
  assets = { factory: png('a') };
  const icons = createProjectIcons(boardOf());
  const known = await icons.byProject();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  assets = { factory: rpcHangs };
  let held: ReadonlyMap<string, unknown> | undefined;
  const list = icons.byProject().then(found => { held = found; });
  await vi.advanceTimersByTimeAsync(1_900);
  expect(held).toBeUndefined();
  await vi.advanceTimersByTimeAsync(200);
  await list;
  expect(held).toEqual(known);
  await vi.advanceTimersByTimeAsync(5_000);
});

it('covers onboarding repositories', async () => {
  t3.read = listed(fact('factory'));
  assets = { factory: png('a') };
  const board = createBoardState({ repos: [], items: [], onboarding: [repo('lar-factory')] } as unknown as BoardData);
  await createProjectIcons(board).refresh();
  expect(Object.keys(board.snapshot().projectIcons!)).toEqual(['maddec01/lar-factory']);
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
])('publishes a chosen $kind icon without asking T3 for a favicon, and drops bytes it no longer needs', async (chosen) => {
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
});

it('runs at most four fetches at once', async () => {
  const names = ['a', 'b', 'c', 'd', 'e', 'f'];
  const origins = Object.fromEntries(names.map(name => [name, `https://github.com/maddec01/${name}`]));
  checkouts(home, origins);
  let running = 0;
  let most = 0;
  const slow = async () => {
    most = Math.max(most, ++running);
    await new Promise(resolve => setTimeout(resolve, 5));
    running--;
    return new Response('x', { headers: { 'Content-Type': 'image/png' } });
  };
  assets = Object.fromEntries(names.map(name => [name, slow]));
  t3.read = listed(...names.map(name => fact(name)));
  const board = boardOf(...names);
  await createProjectIcons(board).refresh();
  expect(Object.keys(board.snapshot().projectIcons!)).toHaveLength(6);
  expect(most).toBe(4);
});
