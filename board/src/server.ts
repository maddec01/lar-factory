// The board server: refreshes the project through `gh` every refreshSeconds,
// keeps the last good copy in memory, serves it on 127.0.0.1 and pushes each
// change to open pages over /api/events.

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { BOARD_PORTS, listenOnFreePort, reportListening } from './port.ts';
import { recordBoard } from './board-record.ts';
import { abandonItem, addProjectItem, editPrBody, fetchProject, findProjectNumber, readPrBody, setItemStatus } from './github.ts';
import { validateDraft } from './add-item.ts';
import { startThread } from './t3.ts';
import { TOOL_NAMES, lookUpTools, lookupProblem, missingTool, probeGh, tools } from './tools.ts';
import { repositoryProject } from './repository-project.ts';
import type { RepositoryProject } from './repository-project.ts';
import { loadItemStats, modelManifestPath, statsDbPath, t3SettingsPath, usageRatesPath } from './item-stats.ts';
import { findModelChoice, loadModelChoices } from './model-choices.ts';
import type { StatsSources } from './item-stats.ts';
import { mergedStats, prStatsEdits, updatedBody } from './pr-stats.ts';
import type { StartResult } from './t3.ts';
import type { CreationProgress, CreationResult, ItemDraft } from './add-item.ts';
import { loadBuild, pageWithData } from './page.ts';
import { canAbandon, workMessage } from './model.ts';
import { revisionCheck } from './revision.ts';
import { lockHolder, readProgress, updatePaths } from './update-state.ts';
import type { BoardData, ContentType, Item, ModelChoice, ModelGroup, Status } from './model.ts';

const HOST = '127.0.0.1';
const config = loadConfig();
const fixture = process.env.BOARD_DATA_FILE;
const capture = { session: randomUUID(), enabled: !fixture };
const updates = updatePaths();
// Only the launch-agent board updates itself: launchd sets its token.
const updatable = !fixture && Boolean(process.env.BOARD_LAUNCH_TOKEN);
/** Set by the board app on each launch; while set, guarded writes must carry it in X-Board-Secret. */
const appSecret = process.env.BOARD_APP_SECRET || null;
/** Writes only the board app's page may make. /api/read stays open for status.sh, since it only starts a read. */
const GUARDED_WRITES = new Set(['/api/items', '/api/queue', '/api/back-to-list', '/api/start', '/api/abandon', '/api/update', '/api/recheck']);
// The app's server runs from inside the app, not a checkout it could compare with origin/main.
const code = revisionCheck({ updatable, logs: { update: updates.log, board: updates.boardLog } }, { disabled: Boolean(appSecret) });

const state: BoardData = {
  capture,
  codeUpdate: code.status,
  project: { title: config.title, url: null },
  repos: config.repos,
  refreshSeconds: config.refreshSeconds,
  fetchedAt: null,
  error: null,
  items: [],
  modelChoices: [],
};

const statsSources: StatsSources = { db: statsDbPath(), settings: t3SettingsPath(), rates: usageRatesPath(), home: homedir() };
let statsUnavailable = false;
const modelManifest = modelManifestPath();
let modelsUnavailable = false;
let pricingUnavailable = false;
let projectNumber = config.number;
let refreshing = false;
/** Set when a read is asked for during a running one, so exactly one more starts after it. */
let readAgain = false;
let syncingPrStats = false;
let revision = 0;
/** Items this board just created or moved, shown as changed until GitHub reports the change. */
const recentItems = new Map<string, { item: Item; revision: number; unconfirmedReads: number }>();
const submissions = new Map<string, {
  draft: ItemDraft; progress: CreationProgress; pending?: Promise<CreationResult>; published?: boolean;
}>();
/** A refused Start ran no t3: one of the repository project's checks failed. */
type Start = StartResult & { refused?: true };
/** Starts by item id. A kept result is reused, so one item starts at most one thread per board run. */
const starts = new Map<string, Promise<Start>>();
let runningStarts = 0;
/** Set while the board waits for a new updater to take the lock. */
let launchingUpdate = false;
/** Status changes in flight by item id; Start and Abandon wait out a move, and a move waits out Abandon. */
const moving = new Set<string>();
/** Deletes in flight by item id, so a second press waits for the first. */
const abandoning = new Map<string, Promise<string | null>>();
/** Item ids this board deleted. GitHub can still list them for a while, so reads drop them. */
const abandoned = new Set<string>();
const REQUEST_ID = /^[a-f0-9-]{36}$/;
/** Open /api/events responses, one per page. */
const streams = new Set<ServerResponse>();
/** The running tool check, so Recheck and the retry never run two at once. */
let checkingTools: Promise<void> | null = null;
/** The startup tool check, which runs once the board listens; requests other than /healthz and assets wait for it. */
let firstToolCheck: Promise<void> | undefined;
let toolRetry: NodeJS.Timeout | undefined;
let toolLog = '';
/** How often the board looks again for a missing t3 or gh, or a logged-out gh. Tests shorten it with BOARD_TOOL_RETRY_MS. */
const TOOL_RETRY_MS = Number(process.env.BOARD_TOOL_RETRY_MS) || 10_000;

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

/** Reads the model choices T3 offers now into the board data. */
function offerModelChoices(): ModelGroup[] {
  const groups = loadModelChoices(statsSources.settings, modelManifest);
  if (!groups.length !== modelsUnavailable) {
    modelsUnavailable = !modelsUnavailable;
    log(modelsUnavailable ? `only T3 default offered: no models read from ${statsSources.settings} and ${modelManifest}` : 'model choices readable again');
  }
  return state.modelChoices = groups;
}

/** Logs where each tool is, or why it's missing, when that changes. */
function logTools(): void {
  const lines = TOOL_NAMES.map((name) => {
    const path = tools()?.[name].path;
    return path ? `${name} at ${path}` : missingTool(name);
  });
  if (state.tools?.gh?.problem === 'logged-out') lines.push('gh is logged out');
  const message = lines.join('; ');
  if (message !== toolLog) log(message);
  toolLog = message;
}

/** Shows a gh problem in place of reading GitHub, and looks again in TOOL_RETRY_MS. */
function showToolProblems(problems: BoardData['tools']): void {
  state.tools = problems;
  logTools();
  clearTimeout(toolRetry);
  if (problems?.t3 || problems?.gh) toolRetry = setTimeout(() => void recheckTools(false), TOOL_RETRY_MS);
}

/**
 * Looks t3, gh and az up again and probes gh, then reads GitHub if gh works now and didn't before.
 * Startup and Recheck reread the login shell PATH; the timed retry passes false to keep the last one.
 * A check asked for during a running one waits for it, then runs.
 */
async function recheckTools(rereadLoginPath = true): Promise<void> {
  while (checkingTools) await checkingTools;
  const ghBroken = !state.tools || Boolean(state.tools.gh);
  checkingTools = (async () => {
    await lookUpTools(process.env, rereadLoginPath);
    const gh = await probeGh();
    const t3 = lookupProblem('t3');
    showToolProblems({ ...(t3 ? { t3 } : {}), ...(gh.problem ? { gh: gh.problem } : {}) });
    if (gh.error) log(`gh probe failed: ${gh.error}`);
  })().finally(() => { checkingTools = null; });
  await checkingTools;
  push();
  if (ghBroken && !state.tools?.gh) readSoon();
}

/** Reads GitHub now; while a read runs this one is skipped, so two reads never run together. */
async function refresh(): Promise<void> {
  if (refreshing) return;
  // Before the first tool check there's no gh to read with; that check starts the first read.
  // A missing or logged-out gh has its own notice and retries; reading would only fail.
  if (!state.tools || state.tools.gh) return;
  refreshing = true;
  readAgain = false;
  let read = false;
  const readRevision = revision;
  offerModelChoices();
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
    // Probe gh, so a gh that went missing or logged out shows its notice instead of Stale.
    const gh = await probeGh();
    if (gh.problem) showToolProblems({ ...state.tools, gh: gh.problem });
    state.error = gh.problem ? null : gh.error ?? (err instanceof Error ? err.message : String(err));
    if (state.error) log(`refresh failed, serving data from ${state.fetchedAt ?? 'never'}: ${state.error}`);
  } finally {
    refreshing = false;
  }
  push();
  // PR edits take a gh call or two each; the board doesn't wait for them.
  if (read) void syncPrStats(state.items);
  if (readAgain) void refresh();
}

/** Reads GitHub now, or once more after the running read, so a change made during that read is read too. */
function readSoon(): void {
  if (refreshing) readAgain = true;
  else void refresh();
}

// The page `pnpm run build` wrote, read once at startup.
const page = loadBuild();

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

/** Reads the update's progress into the board data, so a page follows a running update. */
function readUpdate(): void {
  state.update = updatable ? readProgress(updates) : null;
}

/** Sends the board data as one server-sent event. */
function sendBoard(res: ServerResponse): void {
  res.write(`data: ${JSON.stringify(state)}\n\n`);
}

/** Pushes the board data to every open page, after a read or a change made through the board. */
function push(): void {
  if (streams.size) readUpdate();
  for (const res of streams) sendBoard(res);
}

/** Opens a page's event stream and sends the board data at once, so a reconnecting page catches up. */
function openStream(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  if (req.method === 'HEAD') return void res.end();
  streams.add(res);
  res.on('close', () => streams.delete(res));
  sendBoard(res);
}

/** Only answer requests addressed to this machine, to block DNS rebinding. */
function allowedHost(req: IncomingMessage): boolean {
  const host = (req.headers.host ?? '').toLowerCase();
  return [`127.0.0.1:${port}`, `localhost:${port}`].includes(host);
}

/** Whether the request carries the app secret, compared in constant time. Hashing first evens out the lengths. */
function hasAppSecret(req: IncomingMessage, secret: string): boolean {
  const given = req.headers['x-board-secret'];
  if (typeof given !== 'string') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
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
  push();
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

/** A status change the board's buttons make: Queue moves List to Queued, Back to List the reverse. */
interface Move {
  from: Status;
  to: Status;
  disabled: string;
  what: string;
  unnamed: string;
  refused: (status: Status) => string;
  /** The refusal for an item Start holds, when the move would pull it from under a T3 thread. */
  started?: string;
}

const QUEUE: Move = {
  from: 'List', to: 'Queued', disabled: 'Queuing is disabled in sample mode.', what: 'the item to queue',
  unnamed: 'Name the item to queue.', refused: (status) => `Only List items can be queued; this one is in ${status}.`,
};

const BACK_TO_LIST: Move = {
  from: 'Queued', to: 'List', disabled: 'Moving items back to List is disabled in sample mode.', what: 'the item to move back to List',
  unnamed: 'Name the item to move back to List.', refused: (status) => `Only Queued items can be moved back to List; this one is in ${status}.`,
  started: 'Start is running or has run for this item. Check its T3 thread before moving it back to List.',
};

/** Whether a Start for the item is in flight, uncertain or done this board run. */
function startHolds(itemId: string): boolean {
  return starts.has(itemId) || !!state.started?.[itemId];
}

async function moveItem(req: IncomingMessage, res: ServerResponse, move: Move): Promise<void> {
  if (!capture.enabled) return json(res, 403, { error: move.disabled });
  const input = await readJson(req, res, move.what);
  if (!input) return;
  if (typeof input.itemId !== 'string') return json(res, 400, { error: move.unnamed });
  const item = state.items.find((i) => i.id === input.itemId);
  if (!item) return json(res, 404, { error: 'That item is no longer on the board.' });
  if (item.status === move.to) return json(res, 200, { error: null, board: state });
  if (item.status !== move.from) return json(res, 409, { error: move.refused(item.status) });
  if (move.started && startHolds(item.id)) return json(res, 409, { error: move.started, board: state });
  if (abandoning.has(item.id)) return json(res, 409, { error: 'This item is being abandoned, so it can\'t move.', board: state });
  moving.add(item.id);
  const error = await setItemStatus({ ...config, number: projectNumber }, item.id, move.to).finally(() => moving.delete(item.id));
  if (error) return json(res, 502, { error, board: state });
  showChanged({ ...item, status: move.to });
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
  // Only a choice the board offers right now reaches t3 as arguments.
  let choice: ModelChoice | undefined;
  if (input.model !== undefined) {
    const found = findModelChoice(offerModelChoices(), input.model);
    if (!found) return json(res, 422, { error: "That model choice isn't offered. Pick another one.", board: state });
    choice = found;
  }
  let pending = starts.get(itemId);
  if (!pending && updating()) {
    return json(res, 409, { error: 'The board is updating and will restart. Press Start when the update finishes.', board: state });
  }
  if (!pending) {
    const item = state.items.find((i) => i.id === itemId);
    if (!item) return json(res, 404, { error: 'That item is no longer on the board.' });
    if (item.status !== 'Queued') return json(res, 409, { error: `Only Queued items can be started; this one is in ${item.status}.` });
    if (moving.has(itemId)) return json(res, 409, { error: 'This item is moving back to List, so it can\'t start.', board: state });
    if (abandoning.has(itemId)) return json(res, 409, { error: 'This item is being abandoned, so it can\'t start.', board: state });
    const message = workMessage(item);
    if (!message || !item.repo) return json(res, 409, { error: 'This item needs an issue before it can start.' });
    // Only a refusal or a failure t3 reported may run again; a started or unconfirmed thread is kept.
    runningStarts++;
    pending = currentRepositoryProject(item.repo).then((project): Promise<Start> | Start =>
      project.error === undefined ? startThread(project.projectId, message, choice) : { thread: null, error: project.error, refused: true },
    ).then((result) => {
      if (result.thread) {
        state.started = { ...state.started, [itemId]: result.thread };
        push();
      }
      else if (!result.uncertain) starts.delete(itemId);
      return result;
    }).finally(() => { runningStarts--; });
    starts.set(itemId, pending);
  }
  const { refused, ...result } = await pending;
  json(res, refused ? 409 : result.error ? 502 : 200, { ...result, board: state });
}

/** The repository project from config.json as it is now, so a path fixed after a refusal works on the next Start. */
async function currentRepositoryProject(repo: string): Promise<RepositoryProject> {
  let repos;
  try { repos = loadConfig().repos; }
  catch (err) { return { error: `Can't read config.json: ${(err as Error).message}` }; }
  return repositoryProject(repo, repos);
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
      env: { ...process.env, BOARD_PORT: String(port) },
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
  if (!updatable) return json(res, 403, { error: `Only the launch-agent board updates itself.${code.status ? ` Run ${code.status.command} instead.` : ''}` });
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

const A_TYPE: Record<ContentType, string> = { Issue: 'an issue', PullRequest: 'a pull request', DraftIssue: 'a draft' };

async function abandonItemRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
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
    if (!canAbandon(item)) return json(res, 409, { error: `Only List and Queued issues and drafts can be abandoned; this one is ${A_TYPE[item.type]} in ${item.status}.` });
    if (startHolds(itemId)) return json(res, 409, { error: 'Start is running or has run for this item. Check its T3 thread before abandoning it.', board: state });
    if (moving.has(itemId)) return json(res, 409, { error: 'This item is being moved, so it can\'t be abandoned.', board: state });
    pending = abandonItem({ ...config, number: projectNumber }, item).then((error) => {
      abandoning.delete(itemId);
      if (!error) {
        abandoned.add(itemId);
        recentItems.delete(itemId);
        state.items = state.items.filter((i) => i.id !== itemId);
        push();
      }
      return error;
    });
    abandoning.set(itemId, pending);
  }
  const error = await pending;
  json(res, error ? 502 : 200, { error, board: state });
}

/** Looks the tools up again for the notices' Recheck button and answers with the board data. */
async function recheckRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!await readJson(req, res, 'the recheck request')) return;
  if (fixture) return json(res, 403, { error: 'Sample mode looks no tools up.' });
  await recheckTools();
  json(res, 200, { error: null, board: state });
}

/** Starts a read of GitHub for status.sh, so a moved item reaches the board before the next interval read. */
async function readRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!await readJson(req, res, 'the read request')) return;
  if (fixture) return json(res, 200, {});
  readSoon();
  json(res, 202, {});
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!allowedHost(req)) return send(res, 421, 'text/plain; charset=utf-8', 'Misdirected request\n');
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (!path.startsWith('/assets/')) readUpdate();
  // The update health check must answer at once; everything else runs tools or shows what the lookup found.
  if (path !== '/healthz' && !path.startsWith('/assets/')) await firstToolCheck;
  if (req.method === 'POST' && req.headers.origin !== `http://${req.headers.host}`) {
    return json(res, 403, { error: 'Submit from this board page.' });
  }
  if (req.method === 'POST' && appSecret && GUARDED_WRITES.has(path) && !hasAppSecret(req, appSecret)) {
    return json(res, 403, { error: 'Submit from the board app.' });
  }
  if (req.method === 'POST' && path === '/api/items') return captureItem(req, res);
  if (req.method === 'POST' && path === '/api/queue') return moveItem(req, res, QUEUE);
  if (req.method === 'POST' && path === '/api/back-to-list') return moveItem(req, res, BACK_TO_LIST);
  if (req.method === 'POST' && path === '/api/start') return startItem(req, res);
  if (req.method === 'POST' && path === '/api/update') return updateBoard(res);
  if (req.method === 'POST' && path === '/api/abandon') return abandonItemRequest(req, res);
  if (req.method === 'POST' && path === '/api/read') return readRequest(req, res);
  if (req.method === 'POST' && path === '/api/recheck') return recheckRequest(req, res);
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
  }
  if (path === '/') {
    return send(res, 200, 'text/html; charset=utf-8', pageWithData(page.template, state));
  }
  if (path === '/api/events') return openStream(req, res);
  if (path === '/api/board') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(state));
  if (path === '/healthz') return json(res, 200, {
    runningRevision: code.status?.runningRevision ?? null, launchToken: process.env.BOARD_LAUNCH_TOKEN ?? null,
  });
  const asset = path.startsWith('/assets/') ? page.assets.get(path.slice('/assets/'.length)) : undefined;
  if (asset) return send(res, 200, asset.type, asset.body);
  send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
}

const server = createServer((req, res) => {
  handle(req, res).catch((err: unknown) => {
    log(`request ${req.url} failed: ${err instanceof Error ? err.stack : String(err)}`);
    if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal error\n');
  });
});

/** Logs why the board can't start and exits. */
async function exitWith(message: string): Promise<never> {
  log(message);
  // Piped output is asynchronous on macOS: let the line out before exiting.
  await new Promise((resolve) => process.stdout.write('', resolve));
  process.exit(1);
}

// BOARD_PORT pins the port; otherwise take the first free one, so several boards can run.
const pinned = process.env.BOARD_PORT;
if (pinned && !(/^\d+$/.test(pinned) && Number(pinned) >= 1 && Number(pinned) <= 65535)) {
  await exitWith(`BOARD_PORT=${pinned} is not a port; choose one from 1 to 65535 or unset it`);
}
const ports = pinned ? [Number(pinned)] : BOARD_PORTS;
const port = await listenOnFreePort(server, HOST, ports) ?? await exitWith(ports.length === 1
  ? `port ${ports[0]} is taken; stop what holds it or choose another BOARD_PORT`
  : `ports ${ports[0]} to ${ports.at(-1)} are all taken; stop a board or set BOARD_PORT`);
log(`board on http://${HOST}:${port}, refreshing every ${config.refreshSeconds} s`);
reportListening(port);
// status.sh finds live boards by their records; a sample board isn't one to refresh.
if (!fixture) process.on('exit', recordBoard(port));
// Sample mode runs no tools, so it looks none up. The check starts the first read once gh works.
if (!fixture) firstToolCheck = recheckTools();

// BOARD_DATA_FILE serves a fixed JSON file instead of reading GitHub (for
// trying the layout, e.g. with test/sample.json).
void code.refresh();
if (fixture) {
  Object.assign(state, JSON.parse(readFileSync(fixture, 'utf8')) as BoardData);
  state.repos = config.repos;
  state.capture = capture;
  state.codeUpdate = code.status;
  offerModelChoices();
  log(`serving ${fixture} instead of GitHub`);
}
const timer = setInterval(() => {
  void code.refresh();
  if (!fixture) void refresh();
}, config.refreshSeconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    clearTimeout(toolRetry);
    for (const res of streams) res.end();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
