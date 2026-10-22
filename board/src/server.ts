// The board server: refreshes the project through `gh` every refreshSeconds,
// keeps the last good copy in memory and serves it on 127.0.0.1.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { expandHome, loadConfig } from './config.ts';
import { abandonItem, addProjectItem, editPrBody, fetchProject, findProjectNumber, readPrBody, setItemStatus } from './github.ts';
import { validateDraft } from './add-item.ts';
import { startThread } from './t3.ts';
import { loadItemStats, statsDbPath, t3SettingsPath, usageRatesPath } from './item-stats.ts';
import type { StatsSources } from './item-stats.ts';
import { mergedStats, prStatsEdits, updatedBody } from './pr-stats.ts';
import type { StartResult } from './t3.ts';
import type { CreationProgress, CreationResult, ItemDraft } from './add-item.ts';
import { renderPage } from './page.ts';
import { DEFAULT_UI } from './render.ts';
import { canAbandon, workMessage } from './model.ts';
import { revisionCheck } from './revision.ts';
import { lockHolder, readProgress, updatePaths } from './update-state.ts';
import type { BoardData, Item } from './model.ts';

const HOST = '127.0.0.1';
const config = loadConfig();
const fixture = process.env.BOARD_DATA_FILE;
const capture = { session: randomUUID(), enabled: !fixture };
const updates = updatePaths();
// Only the launch-agent board updates itself: launchd sets its token, and it runs on the configured port.
const updatable = !fixture && Boolean(process.env.BOARD_LAUNCH_TOKEN) && config.port === config.configuredPort;
const code = revisionCheck({ updatable, logs: { update: updates.log, board: updates.boardLog } });

const state: BoardData = {
  capture,
  codeUpdate: code.status,
  project: { title: config.title, url: null },
  repos: config.repos,
  refreshSeconds: config.refreshSeconds,
  fetchedAt: null,
  error: null,
  items: [],
};

const statsSources: StatsSources = { db: statsDbPath(), settings: t3SettingsPath(), rates: usageRatesPath(), home: homedir() };
let statsUnavailable = false;
let pricingUnavailable = false;
let projectNumber = config.number;
let refreshing = false;
let syncingPrStats = false;
let revision = 0;
/** Items this board just created or moved, shown as changed until GitHub reports the change. */
const recentItems = new Map<string, { item: Item; revision: number; unconfirmedReads: number }>();
const submissions = new Map<string, {
  draft: ItemDraft; progress: CreationProgress; pending?: Promise<CreationResult>; published?: boolean;
}>();
/** Starts by item id. A kept result is reused, so one item starts at most one thread per board run. */
const starts = new Map<string, Promise<StartResult>>();
let runningStarts = 0;
/** Set while the board waits for a new updater to take the lock. */
let launchingUpdate = false;
/** Deletes in flight by item id, so a second press waits for the first. */
const abandoning = new Map<string, Promise<string | null>>();
/** Item ids this board deleted. GitHub can still list them for a while, so reads drop them. */
const abandoned = new Set<string>();
const REQUEST_ID = /^[a-f0-9-]{36}$/;

function log(message: string): void {
  console.log(`${new Date().toISOString()} ${message}`);
}

/**
 * Attaches each item's stats: those frozen in its latest merged linked PR's block once
 * no linked PR is open, else read afresh from T3 Code's database and transcripts; the
 * board keeps working without them.
 */
function withStats(items: Item[]): Item[] {
  const stats = loadItemStats(statsSources, Date.now());
  if ((stats === 'unavailable') !== statsUnavailable) {
    statsUnavailable = !statsUnavailable;
    log(statsUnavailable ? `item stats unavailable: can't read ${statsSources.db}` : `item stats readable again from ${statsSources.db}`);
  }
  if (typeof stats === 'function' && !stats.priced !== pricingUnavailable) {
    pricingUnavailable = !pricingUnavailable;
    log(pricingUnavailable ? `API cost unavailable: can't read rates from ${statsSources.rates}` : `API cost readable again from ${statsSources.rates}`);
  }
  return items.map((item) => {
    const frozen = mergedStats(item);
    if (frozen) return { ...item, stats: frozen };
    if (!item.repo || item.number === null || !stats) return { ...item, stats: undefined };
    return { ...item, stats: stats === 'unavailable' ? stats : stats(item.repo, item.number) ?? undefined };
  });
}

/**
 * Brings the stats block in each open PR linked to a build up to date;
 * a failed edit is logged and tried again next refresh. Runs beside the refreshes,
 * never two at once: a refresh while one runs starts none.
 */
async function syncPrStats(items: Item[]): Promise<void> {
  if (syncingPrStats) return;
  syncingPrStats = true;
  try {
    await editPrStats(items);
  } finally {
    syncingPrStats = false;
  }
}

async function editPrStats(items: Item[]): Promise<void> {
  for (const edit of prStatsEdits(items)) {
    try {
      // The board read the body a while ago; apply the block to the body as it is now, so no one's edit is lost.
      const body = updatedBody(await readPrBody(edit.url), edit.block);
      if (body === null) continue;
      await editPrBody(edit.url, body);
      log(`updated item stats in ${edit.url}`);
    } catch (err) {
      log(`could not update item stats in ${edit.url}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

async function refresh(): Promise<void> {
  if (refreshing) return;
  refreshing = true;
  let read = false;
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
    state.items = withStats([...snapshot.items.filter((i) => !recentItems.has(i.id) && !abandoned.has(i.id)), ...[...recentItems.values()].map((r) => r.item)]);
    state.fetchedAt = new Date().toISOString();
    state.error = null;
    if (recovered) log(`read ${snapshot.items.length} items from ${snapshot.url}`);
    read = true;
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    log(`refresh failed, serving data from ${state.fetchedAt ?? 'never'}: ${state.error}`);
  } finally {
    refreshing = false;
  }
  // PR edits take a gh call or two each; the board doesn't wait for them.
  if (read) void syncPrStats(state.items);
}

// Browser modules: the shared template is served as JS by stripping its types.
const ASSETS = new Map(['client.ts', 'render.ts', 'model.ts', 'add-item.ts', 'anchor.ts', 'slice-popover.ts'].map((name) =>
  [name, stripTypeScriptTypes(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8'))]));

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
  if (abandoned.has(item.id)) return;
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
  if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
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

async function startItem(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!capture.enabled) return json(res, 403, { error: 'Starting threads is disabled in sample mode.' });
  const input = await readJson(req, res, 'the item to start');
  if (!input) return;
  if (input.session !== capture.session) {
    return json(res, 409, { error: 'The board restarted. Press Start again.', board: state });
  }
  const { itemId } = input;
  if (typeof itemId !== 'string') return json(res, 400, { error: 'Name the item to start.' });
  let pending = starts.get(itemId);
  if (!pending && updating()) {
    return json(res, 409, { error: 'The board is updating and will restart. Press Start when the update finishes.', board: state });
  }
  if (!pending) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return json(res, 404, { error: 'That item is no longer on the board.' });
    if (item.status !== 'Queued') return json(res, 409, { error: `Only Queued items can be started; this one is in ${item.status}.` });
    const message = workMessage(item);
    if (!message) return json(res, 409, { error: 'This item needs an issue before it can start.' });
    if (!config.t3Project) return json(res, 503, { error: 'Set board.t3Project in config.json to start threads.' });
    let project: string;
    try { project = expandHome(config.t3Project, process.env.HOME); }
    catch (err) { return json(res, 503, { error: (err as Error).message }); }
    // Only a failure t3 reported may run again; a started or unconfirmed thread is kept.
    runningStarts++;
    pending = startThread(project, message).then((result) => {
      if (result.thread) state.started = { ...state.started, [itemId]: result.thread };
      else if (!result.uncertain) starts.delete(itemId);
      return result;
    }).finally(() => { runningStarts--; });
    starts.set(itemId, pending);
  }
  const result = await pending;
  json(res, result.error ? 502 : 200, { ...result, board: state });
}

function updating(): boolean {
  return updatable && (launchingUpdate || lockHolder(updates) !== null);
}

/**
 * Starts scripts/update.ts in its own process group, so it outlives the board when
 * launchd restarts it, and waits until it holds the lock or reports why it can't.
 */
function launchUpdater(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', fileURLToPath(new URL('../scripts/update.ts', import.meta.url))], {
      cwd: fileURLToPath(new URL('../', import.meta.url)), detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: { ...process.env, BOARD_PORT: String(config.port) },
    });
    let settled = false;
    const settle = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.connected) child.disconnect();
      child.unref();
      resolve(error);
    };
    const timer = setTimeout(() => settle(`The updater didn't start. See ${updates.log}.`), 10_000);
    child.on('message', (message: { started?: boolean; busy?: string }) => settle(message.busy ?? null));
    child.on('exit', () => settle(`The updater stopped before it started. See ${updates.log}.`));
    child.on('error', (err) => settle(`The updater couldn't start: ${err.message}`));
  });
}

async function updateBoard(res: ServerResponse): Promise<void> {
  if (!updatable) return json(res, 403, { error: `Only the launch-agent board updates itself. Run ${code.status.command} instead.` });
  if (runningStarts) return json(res, 409, { error: 'A Start is running. Press Update when it finishes.', board: state });
  if (updating()) return json(res, 409, { error: 'An update is already running. Wait for it to finish, then retry.', board: state });
  launchingUpdate = true;
  try {
    const error = await launchUpdater();
    state.update = readProgress(updates);
    if (!error) log('update started');
    json(res, error ? 409 : 202, { error, board: state });
  } finally { launchingUpdate = false; }
}

async function abandonListItem(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!capture.enabled) return json(res, 403, { error: 'Abandoning is disabled in sample mode.' });
  const input = await readJson(req, res, 'the item to abandon');
  if (!input) return;
  if (input.session !== capture.session) {
    return json(res, 409, { error: 'The board restarted. Press Abandon again.', board: state });
  }
  const { itemId } = input;
  if (typeof itemId !== 'string') return json(res, 400, { error: 'Name the item to abandon.' });
  let pending = abandoning.get(itemId);
  if (!pending) {
    const item = state.items.find((i) => i.id === itemId);
    // A second press after the delete finished has nothing left to do.
    if (!item && abandoned.has(itemId)) return json(res, 200, { error: null, board: state });
    if (!item) return json(res, 404, { error: 'That item is no longer on the board.', board: state });
    if (!canAbandon(item)) return json(res, 409, { error: `Only List issues and drafts can be abandoned; this one is a ${item.type} in ${item.status}.` });
    pending = abandonItem({ ...config, number: projectNumber }, item).then((error) => {
      abandoning.delete(itemId);
      if (!error) {
        abandoned.add(itemId);
        recentItems.delete(itemId);
        state.items = state.items.filter((i) => i.id !== itemId);
      }
      return error;
    });
    abandoning.set(itemId, pending);
  }
  const error = await pending;
  json(res, error ? 502 : 200, { error, board: state });
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowedHost(req)) return send(res, 421, 'text/plain; charset=utf-8', 'Misdirected request\n');
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!path.startsWith('/assets/')) state.update = updatable ? readProgress(updates) : null;
  if (req.method === 'POST' && req.headers.origin !== `http://${req.headers.host}`) {
    return json(res, 403, { error: 'Submit from this board page.' });
  }
  if (req.method === 'POST' && path === '/api/items') return captureItem(req, res);
  if (req.method === 'POST' && path === '/api/queue') return queueItem(req, res);
  if (req.method === 'POST' && path === '/api/start') return startItem(req, res);
  if (req.method === 'POST' && path === '/api/update') return updateBoard(res);
  if (req.method === 'POST' && path === '/api/abandon') return abandonListItem(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
  }
  if (path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', renderPage(state, { now: Date.now(), ui: DEFAULT_UI }));
  }
  if (path === '/api/board') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state));
  if (path === '/healthz') return json(res, 200, {
    runningRevision: code.status.runningRevision, launchToken: process.env.BOARD_LAUNCH_TOKEN ?? null,
  });
  const asset = path.startsWith('/assets/') ? path.slice('/assets/'.length) : '';
  if (ASSETS.has(asset)) {
    return send(res, 200, 'text/javascript; charset=utf-8', ASSETS.get(asset)!);
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
void code.refresh();
if (fixture) {
  Object.assign(state, JSON.parse(readFileSync(fixture, 'utf8')) as BoardData);
  state.repos = config.repos;
  state.capture = capture;
  state.codeUpdate = code.status;
  log(`serving ${fixture} instead of GitHub`);
} else await refresh();
const timer = setInterval(() => {
  void code.refresh();
  if (!fixture) void refresh();
}, config.refreshSeconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
