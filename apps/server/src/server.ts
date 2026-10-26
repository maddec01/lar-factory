// The board server: refreshes the project through `gh` every refreshSeconds,
// keeps the last good copy in memory, serves it on 127.0.0.1 and pushes each
// change to open pages over /api/events.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GH_FLOOR, ghBlocksRead, itemSource, type BoardData, type Item, type ItemSource, type ModelGroup, type ToolCheck, type ToolChecks } from '@lar-factory/shared';
import { createBoardState } from './board/board-state.ts';
import { loadConfig } from './config/config.ts';
import { editPrBody, readPrBody } from './github/github.ts';
import { mergedStats, prStatsEdits, updatedBody } from './github/pr-stats.ts';
import { createBoardServer } from './http/http.ts';
import { createItemCommands } from './items/item-commands.ts';
import { configuredSources } from './items/item-sources.ts';
import { log } from './log.ts';
import { loadBuild } from './page/page.ts';
import { boardDataDir, recordBoard } from './port/board-record.ts';
import { BOARD_PORTS, listenOnFreePort, reportListening } from './port/port.ts';
import { createStartAfter } from './start-after/start-after.ts';
import type { StatsSources } from './stats/item-stats.ts';
import { loadModelChoices } from './t3/model-choices.ts';
import { anyOnAzureDevOps, repositoryProjectHints } from './t3/repository-project.ts';
import { loadT3Reads } from './t3/t3-reads.ts';
import { environmentIdPath, modelManifestPath, readEnvironmentId, statsDbPath, t3SettingsPath, usageRatesPath } from './t3/t3-settings.ts';
import { TOOL_NAMES, checkTools, lookUpTools, missingTool, probeGh, tools } from './tools/tools.ts';

const HOST = '127.0.0.1';
const config = loadConfig();
const fixture = process.env.BOARD_DATA_FILE;
const capture = { session: randomUUID(), enabled: !fixture };

const board = createBoardState({
  capture,
  project: { owner: config.owner, title: config.title },
  repos: config.repos,
  refreshSeconds: config.refreshSeconds,
  fetchedAt: null,
  error: null,
  items: [],
  modelChoices: [],
});

const statsSources: StatsSources = { db: statsDbPath(), settings: t3SettingsPath(), rates: usageRatesPath(), home: homedir() };
const modelManifest = modelManifestPath();
const environmentIdFile = environmentIdPath();
const items = configuredSources(config);
let refreshing = false;
/** Set when a read is asked for during a running one, so exactly one more starts after it. */
let readAgain = false;
let syncingPrStats = false;
/** The running tool check, so Recheck and the retry never run two at once. */
let checkingTools: Promise<void> | null = null;
/** The startup tool check, which runs once the board listens; requests other than /healthz and assets wait for it. */
let firstToolCheck: Promise<void> | undefined;
let toolRetry: NodeJS.Timeout | undefined;
let toolLog = '';
/** How often the board looks again for a missing t3 or gh, or a logged-out gh. Tests shorten it with BOARD_TOOL_RETRY_MS. */
const TOOL_RETRY_MS = Number(process.env.BOARD_TOOL_RETRY_MS) || 10_000;

/** Logs `whenSet` or `whenCleared` each time the condition it's given flips; it starts cleared. */
function flipLog(whenSet: string, whenCleared: string): (set: boolean) => void {
  let last = false;
  return (set) => {
    if (set !== last) log(set ? whenSet : whenCleared);
    last = set;
  };
}

const statsUnavailable = flipLog(`item stats unavailable: can't read ${statsSources.db}`, `item stats readable again from ${statsSources.db}`);
const pricingUnavailable = flipLog(`API cost unavailable: can't read rates from ${statsSources.rates}`, `API cost readable again from ${statsSources.rates}`);
const modelsUnavailable = flipLog(`only T3 default offered: no models read from ${statsSources.settings} and ${modelManifest}`, 'model choices readable again');

/**
 * Attaches each item's stats and T3 threads, from one read of T3 Code's database. Stats are those frozen in its
 * latest merged linked PR's block once no linked PR is open, else read afresh from the database and transcripts;
 * threads are read afresh. The board keeps working without either.
 */
function withT3Reads(items: Item[]): Item[] {
  const { stats, threads, statsUnavailable: unreadable, priced } = loadT3Reads(statsSources, Date.now());
  statsUnavailable(unreadable);
  if (priced !== null) pricingUnavailable(!priced);
  return items.map((item) => ({ ...item, stats: mergedStats(item) ?? stats(item), threads: threads(item) }));
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
  } finally {
    syncingPrStats = false;
  }
}

/** Reads the model choices T3 offers now into the board data. */
function offerModelChoices(): ModelGroup[] {
  const groups = loadModelChoices(statsSources.settings, modelManifest);
  modelsUnavailable(!groups.length);
  board.update({ modelChoices: groups });
  return groups;
}

/** Logs where each tool is, or why it's missing, when that changes. */
function logTools(): void {
  const lines = TOOL_NAMES.map((name) => {
    const path = tools()?.[name].path;
    return path ? `${name} at ${path}` : missingTool(name);
  });
  const gh = board.snapshot().tools?.gh.result;
  if (gh === 'logged-out') lines.push('gh is logged out');
  if (gh === 'outdated') lines.push(`gh is older than ${GH_FLOOR}`);
  if (gh === 'no-project-scope') lines.push("gh can't read Projects");
  const az = board.snapshot().tools?.az?.result;
  if (az === 'logged-out') lines.push('az is logged out');
  if (az === 'no-extension') lines.push('az has no azure-devops extension');
  const message = lines.join('; ');
  if (message !== toolLog) log(message);
  toolLog = message;
}

/** Shows the checks, whose failures have notices, and looks again in TOOL_RETRY_MS while one fails. */
function showToolChecks(checks: ToolChecks): void {
  board.update({ tools: checks });
  logTools();
  clearTimeout(toolRetry);
  if (Object.values(checks).some((check) => check.result !== 'ok')) toolRetry = setTimeout(() => void recheckTools(false), TOOL_RETRY_MS);
}

/**
 * Looks every tool up again and checks each command, az only while a listed repository is on Azure DevOps,
 * then reads GitHub if gh works now and didn't before.
 * Startup and Recheck reread the login shell PATH; the timed retry passes false to keep the last one.
 * A check asked for during a running one waits for it, then runs.
 */
async function recheckTools(rereadLoginPath = true): Promise<void> {
  while (checkingTools) await checkingTools;
  const { tools: before } = board.snapshot();
  const ghBlocked = ghStopsRead(before?.gh);
  checkingTools = (async () => {
    const [, withAz] = await Promise.all([lookUpTools(process.env, rereadLoginPath), anyOnAzureDevOps(config.repos)]);
    const { tools: checks, ghError } = await checkTools(withAz);
    showToolChecks(checks);
    if (ghError) log(`gh probe failed: ${ghError}`);
  })().finally(() => { checkingTools = null; });
  await checkingTools;
  board.push();
  if (ghBlocked && !ghStopsRead(board.snapshot().tools?.gh)) readSoon();
}

/** Whether gh's check stops the read: it blocks every repository the board lists, or the Project when it lists none. */
function ghStopsRead(check: ToolCheck | undefined): boolean {
  const sources: ItemSource[] = config.repos.length ? config.repos.map(itemSource) : ['project'];
  return sources.every((source) => ghBlocksRead(check, source));
}

/** Reads GitHub now; while a read runs this one is skipped, so two reads never run together. */
async function refresh(): Promise<void> {
  if (refreshing) return;
  // Before the first tool check there's no gh to read with; that check starts the first read.
  // A gh that blocks the read has its own notice and retries; reading would only fail.
  if (ghStopsRead(board.snapshot().tools?.gh)) return;
  refreshing = true;
  readAgain = false;
  let read = false;
  const readRevision = board.revision();
  offerModelChoices();
  try {
    const snapshot = await items.read();
    const { error, fetchedAt } = board.snapshot();
    const recovered = error !== null || fetchedAt === null;
    board.applyRead(snapshot.items, readRevision, withT3Reads);
    board.update({ project: { owner: config.owner, title: snapshot.title }, fetchedAt: new Date().toISOString(), error: null,
      t3EnvironmentId: readEnvironmentId(environmentIdFile), repositoryProjects: await repositoryProjectHints(config.repos) });
    if (recovered) log(`read ${snapshot.items.length} items from the ${snapshot.title} project`);
    read = true;
  } catch (err) {
    // Probe gh, so a gh that went missing or logged out shows its notice instead of Stale.
    const gh = await probeGh();
    if (gh.check.result !== 'ok') showToolChecks({ ...board.snapshot().tools!, gh: gh.check });
    const error = ghStopsRead(gh.check) ? null : gh.error ?? (err instanceof Error ? err.message : String(err));
    board.update({ error });
    if (error) log(`refresh failed, serving data from ${board.snapshot().fetchedAt ?? 'never'}: ${error}`);
  } finally {
    refreshing = false;
  }
  board.push();
  // PR edits take a gh call or two each, and a start runs t3; the board doesn't wait for them.
  if (read) void syncPrStats(board.snapshot().items);
  if (read) void startAfter.startUnblocked();
  if (readAgain) void refresh();
}

/** Reads GitHub now, or once more after the running read, so a change made during that read is read too. */
function readSoon(): void {
  if (refreshing) readAgain = true;
  else void refresh();
}

// The page `pnpm run build` wrote, read once at startup. The path is relative to this
// entry, so it holds both for the source and for the packaged app's bundle in
// Resources/server/dist/, beside Resources/web/dist/.
const page = loadBuild(new URL('../../web/dist/', import.meta.url));

const commands = createItemCommands({ board, items, repos: config.repos, offerModelChoices });
// Sample mode keeps no armed starts: it serves a fixed file and starts nothing.
const startAfter = createStartAfter({ board, commands, offerModelChoices, file: fixture ? null : join(boardDataDir(), 'armed-starts.json'),
  renamedId: items.renamedId });
const { server, endStreams } = createBoardServer({
  board, commands, startAfter, page, appSecret: process.env.BOARD_APP_SECRET || null, sample: !!fixture,
  recheck: recheckTools, readSoon, ready: () => firstToolCheck,
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
// trying the layout, e.g. with packages/shared/test/sample.json).
if (fixture) {
  board.update({ ...JSON.parse(readFileSync(fixture, 'utf8')) as BoardData, repos: config.repos, capture });
  offerModelChoices();
  log(`serving ${fixture} instead of GitHub`);
}
const timer = setInterval(() => {
  if (!fixture) void refresh();
}, config.refreshSeconds * 1000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    clearTimeout(toolRetry);
    endStreams();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
