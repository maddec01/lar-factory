// The board server: refreshes the project through `gh` every refreshSeconds,
// keeps the last good copy in memory and serves it on 127.0.0.1.

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { loadConfig } from './config.ts';
import { addProjectItem, fetchProject, findProjectNumber, setItemStatus } from './github.ts';
import { validateDraft } from './add-item.ts';
import type { CreationProgress, CreationResult, ItemDraft } from './add-item.ts';
import { renderPage } from './page.ts';
import { DEFAULT_UI } from './render.ts';
import type { BoardData, Item } from './model.ts';

const HOST = '127.0.0.1';
const config = loadConfig();
const fixture = process.env.BOARD_DATA_FILE;
const capture = { session: randomUUID(), enabled: !fixture };

const state: BoardData = {
  capture,
  project: { title: config.title, url: null },
  repos: config.repos,
  refreshSeconds: config.refreshSeconds,
  fetchedAt: null,
  error: null,
  items: [],
};

let projectNumber = config.number;
let refreshing = false;
let revision = 0;
/** Items this board just created or moved, shown as changed until GitHub reports the change. */
const recentItems = new Map<string, { item: Item; revision: number; unconfirmedReads: number }>();
const submissions = new Map<string, {
  draft: ItemDraft; progress: CreationProgress; pending?: Promise<CreationResult>; published?: boolean;
}>();

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  const readRevision = revision;
  try {
    projectNumber ??= await findProjectNumber(config.owner, config.title);
    const snapshot = await fetchProject(config.owner, projectNumber);
    const recovered = state.error !== null || state.fetchedAt === null;
    state.project = { title: snapshot.title, url: snapshot.url };
    for (const [id, recent] of recentItems) {
      if (readRevision < recent.revision) continue;
      // Give GitHub three successful reads to expose the change, then trust what it reports.
      const reported = snapshot.items.some((i) => i.id === id && i.status === recent.item.status);
      if (reported || ++recent.unconfirmedReads >= 3) recentItems.delete(id);
    }
    state.items = [...snapshot.items.filter((i) => !recentItems.has(i.id)), ...[...recentItems.values()].map((r) => r.item)];
    state.fetchedAt = new Date().toISOString();
    state.error = null;
    if (recovered) log(`read ${snapshot.items.length} items from ${snapshot.url}`);
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    log(`refresh failed, serving data from ${state.fetchedAt ?? 'never'}: ${state.error}`);
  } finally {
    refreshing = false;
  }
}

// Browser modules: the shared template is served as JS by stripping its types.
const ASSETS = new Set(['client.ts', 'render.ts', 'model.ts', 'add-item.ts']);

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};

function send(res: ServerResponse, status: number, type: string, body: string): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

/** Only answer requests addressed to this machine, to block DNS rebinding. */
function allowedHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return [`127.0.0.1:${config.port}`, `localhost:${config.port}`].includes(host);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

/** Reads a small JSON object body, or answers the request with the problem and returns null. */
async function readJson(req: IncomingMessage, res: ServerResponse, what: string): Promise<Record<string, unknown> | null> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    json(res, 415, { error: `Send ${what} as JSON.` });
    return null;
  }
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 100_000) {
        json(res, 413, { error: `${what[0]!.toUpperCase()}${what.slice(1)} are too large.` });
        return null;
      }
      chunks.push(chunk as Buffer);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!input || typeof input !== 'object') throw new Error('Invalid JSON.');
    return input as Record<string, unknown>;
  } catch {
    json(res, 400, { error: `Send valid ${what} as JSON.` });
    return null;
  }
}

/** Shows a change at once and keeps it through refreshes until GitHub reports it. */
function showChanged(item: Item): void {
  recentItems.set(item.id, { item, revision: ++revision, unconfirmedReads: 0 });
  state.items = [...state.items.filter((i) => i.id !== item.id), item];
}

async function captureItem(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!capture.enabled) return json(res, 403, { error: 'Adding items is disabled in sample mode.' });
  const input = await readJson(req, res, 'item details');
  if (!input) return;
  if (input.session !== capture.session) {
    return json(res, 409, { uncertain: true, error: 'The board restarted. Check the repository issues before starting a new item.' });
  }
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) {
    return json(res, 400, { error: 'The submission needs a valid request ID.' });
  }
  let draft: ItemDraft;
  try { draft = validateDraft(input.draft, config.repos); }
  catch (err) { return json(res, 422, { error: (err as Error).message }); }
  let entry = submissions.get(input.requestId);
  if (entry && JSON.stringify(entry.draft) !== JSON.stringify(draft)) {
    return json(res, 409, { error: 'This submission already belongs to another item. Finish it before starting a new one.' });
  }
  if (!entry) {
    if (submissions.size >= 1000) return json(res, 503, { error: 'The board has reached its submission limit. Finish pending items and restart the board.' });
    entry = { draft, progress: {} };
    submissions.set(input.requestId, entry);
  }
  entry.pending ??= addProjectItem({ ...config, number: projectNumber }, draft, entry.progress);
  const result = await entry.pending;
  entry.pending = undefined;
  if (result.item && !entry.published) {
    showChanged(result.item);
    entry.published = true;
  }
  json(res, result.error ? 502 : 200, { ...result, board: state });
}

async function queueItem(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!capture.enabled) return json(res, 403, { error: 'Queuing is disabled in sample mode.' });
  const input = await readJson(req, res, 'the item to queue');
  if (!input) return;
  if (typeof input.itemId !== 'string') return json(res, 400, { error: 'Name the item to queue.' });
  const item = state.items.find((i) => i.id === input.itemId);
  if (!item) return json(res, 404, { error: 'That item is no longer on the board.' });
  if (item.status === 'Queued') return json(res, 200, { error: null, board: state });
  if (item.status !== 'List') return json(res, 409, { error: `Only List items can be queued; this one is in ${item.status}.` });
  const error = await setItemStatus({ ...config, number: projectNumber }, item.id, 'Queued');
  if (error) return json(res, 502, { error, board: state });
  showChanged({ ...item, status: 'Queued' });
  json(res, 200, { error: null, board: state });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowedHost(req)) return send(res, 421, 'text/plain; charset=utf-8', 'Misdirected request\n');
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (req.method === 'POST' && req.headers.origin !== `http://${req.headers.host}`) {
    return json(res, 403, { error: 'Submit from this board page.' });
  }
  if (req.method === 'POST' && path === '/api/items') return captureItem(req, res);
  if (req.method === 'POST' && path === '/api/queue') return queueItem(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
  }
  if (path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', renderPage(state, { now: Date.now(), ui: DEFAULT_UI }));
  }
  if (path === '/api/board') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state));
  if (path === '/healthz') return send(res, 200, 'text/plain; charset=utf-8', 'ok\n');
  const asset = path.startsWith('/assets/') ? path.slice('/assets/'.length) : '';
  if (ASSETS.has(asset)) {
    const source = await readFile(new URL(`./${asset}`, import.meta.url), 'utf8');
    return send(res, 200, 'text/javascript; charset=utf-8', stripTypeScriptTypes(source));
  }
  send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    log(`request ${req.url} failed: ${err instanceof Error ? err.stack : String(err)}`);
    if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal error\n');
  });
});

server.listen(config.port, HOST, () => {
  log(`board on http://${HOST}:${config.port}, refreshing every ${config.refreshSeconds} s`);
});

// BOARD_DATA_FILE serves a fixed JSON file instead of reading GitHub (for
// trying the layout, e.g. with test/sample.json).
if (fixture) {
  Object.assign(state, JSON.parse(readFileSync(fixture, 'utf8')) as BoardData);
  state.repos = config.repos;
  state.capture = capture;
  log(`serving ${fixture} instead of GitHub`);
} else await refresh();
const timer = setInterval(() => void (fixture || refresh()), config.refreshSeconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
