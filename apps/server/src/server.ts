// The board server: reads each item source through `gh` or `az` at its own pace, every 15 s while it holds active work
// and every 5 min while idle, refreshes T3's threads and stats every 2 s without either, keeps the last good copy in
// memory, serves it on 127.0.0.1 and pushes each change to open pages over /api/events.

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { GH_FLOOR, SETTLED_FIRST_READ, ghBlocksRead, itemSource, refKey, type BoardData, type FirstRead, type Item, type ItemSource, type GhCheck, type ModelGroup, type Status, type ToolChecks } from '@lar-factory/shared';
import { createBoardState } from './board/board-state.ts';
import { configUpdateOf, dismissConfigUpdate, readDismissedUpdates } from './config/config-update.ts';
import { openConfigUpdatePr, openEditPr, readEditConfig, readEditPrs } from './config/edit-config.ts';
import { onTheBoard, readBoardSettings, readOnboardedConfigs, readRepositoryList, stillOnboarding, type OnboardedRepository } from './config/repository-config.ts';
import { editPrBody, ghCooldown, ghQuotaLow, readPrBody } from './github/github.ts';
import { mergedStats, prStatsEdits, updatedBody } from './github/pr-stats.ts';
import { createBoardServer } from './http/http.ts';
import { createItemCommands } from './items/item-commands.ts';
import { ACTIVE_READ_MS, onboardedSources, repoView } from './items/item-sources.ts';
import type { ReadPace, ReadProgress } from './items/item-source.ts';
import { log } from './log.ts';
import { createItemDetails, detailsFileFor } from './item-details/item-details.ts';
import { createClashRuns } from './onboarding/clash-runs.ts';
import { createConfigChecks } from './onboarding/config-checks.ts';
import { createProject } from './onboarding/create-project.ts';
import { keepOnboarding } from './onboarding/keep-onboarding.ts';
import {
  createPrOpener, followOnboardingPrs, followResetPrs, previewOnboardingPr, reopenOnboardingPr, resetRepository,
} from './onboarding/onboarding-pr.ts';
import { onboardingOffers, projectChoices } from './onboarding/project-choices.ts';
import { findFixedClashes } from './onboarding/fixed-clashes.ts';
import { createCustomLabel, createRepositoryLabels, readRepositoryLabels, renameRepositoryLabels } from './onboarding/repository-labels.ts';
import { runSetupCheck } from './onboarding/setup-checks.ts';
import { loadBuild } from './page/page.ts';
import { boardDataDir, recordBoard } from './port/board-record.ts';
import { BOARD_PORTS, listenOnFreePort, reportListening } from './port/port.ts';
import { installHome, loadBundledSkills, withInstallState } from './skills/bundled-skills.ts';
import { parentSkillCheck } from './skills/skill-check.ts';
import { createStartAfter } from './start-after/start-after.ts';
import type { StatsSources } from './stats/item-stats.ts';
import { loadModelChoices } from './t3/model-choices.ts';
import { anyOnAzureDevOps, repositoryProjectHints } from './t3/repository-project.ts';
import { loadT3Reads } from './t3/t3-reads.ts';
import { environmentIdPath, modelManifestPath, readEnvironmentId, statsDbPath, t3SettingsPath, usageRatesPath } from './t3/t3-settings.ts';
import { TOOL_NAMES, checkTools, lookUpTools, missingTool, probeGh, tools } from './tools/tools.ts';

const HOST = '127.0.0.1';
const settings = readBoardSettings();
// A settings file the board can't use leaves it on the defaults; the problem stays the board's read error until it restarts.
if (settings.problem) log(`using the default settings: ${settings.problem}`);
const fixture = process.env.BOARD_DATA_FILE;
const capture = { session: randomUUID(), enabled: !fixture };
const bundled = loadBundledSkills();
if (bundled.error) log(`no bundled skills in Settings: ${bundled.error}`);
/** The bundled skills with their install state; the Sample board shows none, as it installs nothing. */
const bundledSkills = () => fixture ? bundled.skills : withInstallState(bundled.skills, installHome());

const board = createBoardState({
  capture,
  project: { title: '' },
  repos: [],
  refreshSeconds: settings.refreshSeconds,
  fetchedAt: null,
  error: settings.problem ?? null,
  items: [],
  firstRead: { step: 'repositories', running: [], settled: false },
  modelChoices: [],
  bundledSkills: bundledSkills(),
});

const statsSources: StatsSources = { db: statsDbPath(), settings: t3SettingsPath(), rates: usageRatesPath(), home: homedir() };
const modelManifest = modelManifestPath();
const environmentIdFile = environmentIdPath();
// Each read publishes the repositories once their configs load, so Add item offers them while the items still load.
const items = onboardedSources(async () => {
  let list: OnboardedRepository[];
  try { list = readRepositoryList(); }
  catch (err) {
    // A list the board can't read onboards nothing, so no repository or notice of the last good read stays beside its error.
    board.update({ repos: [], repositoryConfigProblems: [], onboarding: [] });
    throw err;
  }
  // An onboarding whose PR merged, or whose .lar-factory.json landed another way, finishes here, so a merge made while
  // the dialog is closed finishes too; a PR closed without merging is marked for the Pull request step.
  // Each refresh follows every PR again, so a problem from an earlier one goes once its PR reads.
  const followProblems = new Map<string, string>();
  list = await followOnboardingPrs(list, undefined, undefined, {
    failed: (repo, problem) => {
      log(`can't follow ${repo}'s onboarding PR: ${problem}`);
      followProblems.set(repo, problem);
    },
    // A finished onboarding has its .lar-factory.json now, which the kept answer may not say.
    finished: configChecks.forget });
  // A reset PR that merged or closed unmerged drops its entry, so offerOnboarding, which runs after this read, offers the
  // repository again while its default branch has a .lar-factory.json. A problem logs once until it changes or the PR reads.
  const resetProblems = new Map<string, string>();
  list = await followResetPrs(list, undefined, undefined, {
    failed: (repo, problem) => {
      if (resetFollowProblems.get(repo) !== problem) log(`can't follow ${repo}'s reset PR: ${problem}`);
      resetProblems.set(repo, problem);
    },
    // The merge took its .lar-factory.json away, which the kept answer may still have.
    dropped: configChecks.forget });
  resetFollowProblems = resetProblems;
  // A repository still onboarding has no Repository config on its default branch until its PR merges, and one
  // resetting is off the board though its default branch still has one. Each refresh asks gh for every open Edit PR, so
  // its row's mark survives a restart and goes once the PR merges or closes. A file below the app's Repository config
  // version gets the notice offering its update PR, unless this Mac dismissed it at that version.
  const onboarded = onTheBoard(list);
  const [read, editPrs] = await Promise.all([readOnboardedConfigs(list),
    readEditPrs(onboarded.map((e) => e.repo), undefined, (repo, problem) => log(`can't read ${repo}'s Edit PR: ${problem}`))]);
  const dismissed = readDismissedUpdates();
  board.update({
    repos: read.configs.map((config) => {
      const configUpdate = configUpdateOf(config, dismissed);
      return { ...repoView(config), version: config.version, ...editPrs.has(config.repo) && { editPr: editPrs.get(config.repo) },
        ...configUpdate !== undefined && { configUpdate } };
    }),
    repositoryConfigProblems: read.problems, onboarding: stillOnboarding(list, followProblems),
  });
  moveFirstRead({ step: 'items' });
  return read;
});
/** Each resetting repository's problem following its reset PR on the last read, so a problem that lasts logs once. */
let resetFollowProblems = new Map<string, string>();
/** Each repository's .lar-factory.json answer for onboarding, kept until Recheck. */
const configChecks = createConfigChecks();
/** T3's projects as onboarding offers them, as the list is now. */
const choices = () => projectChoices(onboarded(), configChecks.configOf);
const offersUnavailable = flipLog("no onboarding offers: can't read T3 Code's projects", 'onboarding offers readable again');
let refreshing = false;
/** Set when a read is asked for during a running one, so exactly one more starts after it. */
let readAgain = false;
let syncingPrStats = false;
/** When the board last wrote each PR's stats block, by PR URL. */
const prStatsSyncedAt = new Map<string, number>();
const PR_STATS_MS = 5 * 60_000;
/** The running tool check, so Recheck and the retry never run two at once. */
let checkingTools: Promise<void> | null = null;
/** The startup tool check, which runs once the board listens; requests other than /healthz and assets wait for it. */
let firstToolCheck: Promise<void> | undefined;
let toolRetry: NodeJS.Timeout | undefined;
let toolLog = '';
/** How often the board looks again while a check fails that retriesTools names. Tests shorten it with BOARD_TOOL_RETRY_MS. */
const TOOL_RETRY_MS = Number(process.env.BOARD_TOOL_RETRY_MS) || 10_000;

/**
 * Changes the first read's progress and pushes it at once, so a page names what runs now. A settled first read stays
 * settled: the polls and reads after it report nothing.
 */
function moveFirstRead(change: Partial<FirstRead>): void {
  const current = board.snapshot().firstRead;
  if (current.settled) return;
  board.update({ firstRead: { ...current, ...change } });
  board.push();
}

/** Marks each item source of the first read as running while it reads. */
const firstReadProgress: ReadProgress = {
  started: (name) => moveFirstRead({ running: [...board.snapshot().firstRead.running, name] }),
  finished: (name) => {
    const running = [...board.snapshot().firstRead.running];
    const at = running.indexOf(name);
    if (at !== -1) running.splice(at, 1);
    moveFirstRead({ running });
  },
};

/** The first read ends: it read the repositories, failed, or gh blocked it. */
const settleFirstRead = () => moveFirstRead({ running: [], settled: true });

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
function withT3Reads(items: Item[], withStats = true): Item[] {
  const now = Date.now();
  const { stats, threads, statsUnavailable: unreadable, priced } = loadT3Reads(statsSources, now, withStats);
  if (withStats) {
    statsReadAt = now;
    statsUnavailable(unreadable);
    if (priced !== null) pricingUnavailable(!priced);
  }
  return items.map((item) => {
    const shown = { ...item, stats: withStats ? mergedStats(item) ?? stats(item) : item.stats, threads: threads(item) };
    // A slice's implementer thread names the slice, so a build is running while a thread runs for it or any slice.
    const running = (found: ReturnType<typeof threads>) => Array.isArray(found) && found.some((t) => t.state === 'running');
    if (running(shown.threads) || item.slices.some((slice) => running(threads(slice)))) lastRunning.set(item.id, now);
    return shown;
  });
}

/** Tests read every source this often, whatever its work; unset, sources read at their pace. */
const TEST_READ_MS = Number(process.env.BOARD_READ_MS) || 0;
/** How often the board reads T3's database for threads, and for stats, which cost several times more; neither calls gh or az. */
const LOCAL_REFRESH_MS = 2_000;
const LOCAL_STATS_MS = 30_000;
let statsReadAt = -Infinity;
/** How long an item stays active after its thread stops running or it closes, so a source reads what the agent wrote last. */
const SETTLE_MS = 5 * 60_000;
/** The statuses an agent works in, which keep an item active while T3 can't say whether its thread runs. */
const AGENT_STATUSES = new Set<Status>(['Shaping', 'In progress', 'Review']);
/** When each item last had a running thread of its own or of one of its slices, by Item.id. */
const lastRunning = new Map<string, number>();

/**
 * Whether an item keeps its source on the fast cadence: its thread runs or ran in the last SETTLE_MS, it sits in an
 * agent's status while T3 can't say, it closed in the last SETTLE_MS, its PR's checks run, the board shows a change to
 * it GitHub hasn't reported, or an armed start waits on it or for it.
 */
function isActive(item: Item, now: number, waitedOn: ReadonlySet<string>): boolean {
  const shown = board.find(item.id) ?? item;
  if (now - (lastRunning.get(item.id) ?? -Infinity) < SETTLE_MS) return true;
  if (item.state === 'open' && AGENT_STATUSES.has(item.status) && !Array.isArray(shown.threads)) return true;
  if (item.closedAt && now - Date.parse(item.closedAt) < SETTLE_MS) return true;
  if ([item.pipeline, ...item.linkedPrs].some((pr) => pr?.checks?.running)) return true;
  if (board.changing(item.id) || board.snapshot().armed?.[item.id]) return true;
  return item.repo !== null && item.number !== null && waitedOn.has(refKey(item.repo, item.number));
}

/** The pace reads run at now: slow while gh's quota runs low. */
function readPace(): ReadPace {
  const now = Date.now();
  const armed = board.snapshot().armed ?? {};
  const waitedOn = new Set(board.snapshot().items.filter((i) => armed[i.id]).flatMap((i) => i.blockers.map((b) => refKey(b.repo, b.number))));
  return { now, slow: quotaLow, activeMs: TEST_READ_MS || ACTIVE_READ_MS, idleMs: TEST_READ_MS || settings.refreshSeconds * 1000,
    active: (item) => isActive(item, now, waitedOn) };
}

/** Whether gh's quota ran low at its last check, made at most every QUOTA_CHECK_MS. */
let quotaLow = false;
let quotaCheckedAt = -Infinity;
const QUOTA_CHECK_MS = 5 * 60_000;
async function checkQuota(): Promise<void> {
  if (Date.now() - quotaCheckedAt < QUOTA_CHECK_MS) return;
  quotaCheckedAt = Date.now();
  const low = await ghQuotaLow().catch(() => quotaLow);
  if (low !== quotaLow) log(low ? "gh's quota is low: every source reads at the idle pace" : "gh's quota recovered");
  quotaLow = low;
}

/** Shows T3's threads, and every LOCAL_STATS_MS its stats, as they are now on the items as last read, pushing only when they changed. */
function refreshLocal(): void {
  if (refreshing) return;
  const before = board.snapshot().items;
  const after = withT3Reads(before, Date.now() - statsReadAt >= LOCAL_STATS_MS);
  const t3Of = (items: Item[]) => JSON.stringify(items.map((i) => [i.stats, i.threads]));
  if (t3Of(after) === t3Of(before)) return;
  board.update({ items: after });
  board.push();
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
    const now = Date.now();
    for (const edit of prStatsEdits(items)) {
      // Stats grow while a build runs; each PR's block is written at most every PR_STATS_MS, not on every read.
      if (now - (prStatsSyncedAt.get(edit.url) ?? -Infinity) < PR_STATS_MS) continue;
      prStatsSyncedAt.set(edit.url, now);
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
  const checks = board.snapshot().tools;
  const gh = checks?.gh;
  if (gh?.result === 'logged-out') lines.push('gh is logged out');
  if (gh?.result === 'outdated' || gh?.result === 'no-project-scope' && gh.upgrade) lines.push(`gh is older than ${GH_FLOOR}`);
  if (gh?.result === 'no-project-scope') lines.push("gh can't read Projects");
  if (checks?.t3.result === 'not-running') lines.push('T3 Code is not running');
  const az = checks?.az?.result;
  if (az === 'logged-out') lines.push('az is logged out');
  if (az === 'no-extension') lines.push('az has no azure-devops extension');
  const message = lines.join('; ');
  if (message !== toolLog) log(message);
  toolLog = message;
}

/**
 * Whether the board looks again by itself: while gh is missing, logged out or without the project scope, which stop
 * reads, while t3 is missing or T3 Code isn't running. An old gh, a missing git, jq or curl and az wait for Recheck.
 */
function retriesTools(checks: ToolChecks): boolean {
  return ['missing', 'logged-out', 'no-project-scope'].includes(checks.gh.result) || checks.t3.result !== 'ok';
}

/** Shows the checks, whose failures have notices, and looks again in TOOL_RETRY_MS while retriesTools says so. */
function showToolChecks(checks: ToolChecks): void {
  board.update({ tools: checks });
  logTools();
  clearTimeout(toolRetry);
  if (retriesTools(checks)) toolRetry = setTimeout(() => void recheckTools(false), TOOL_RETRY_MS);
}

/**
 * Looks every tool up again and checks each command, az only while a listed repository is on Azure DevOps or `az`
 * asks for it, then reads GitHub if gh works now and didn't before.
 * Startup and Recheck reread the login shell PATH; the timed retry passes false to keep the last one.
 * A check asked for during a running one waits for it, then runs.
 */
async function recheckTools(rereadLoginPath = true, az = false): Promise<void> {
  while (checkingTools) await checkingTools;
  // Recheck asks each repository for its .lar-factory.json again; the timed retry keeps the answers.
  if (rereadLoginPath) configChecks.clear();
  const { tools: before } = board.snapshot();
  const ghBlocked = ghStopsRead(before?.gh);
  checkingTools = (async () => {
    const [, withAz] = await Promise.all([lookUpTools(process.env, rereadLoginPath), anyOnAzureDevOps(onboarded())]);
    const { tools: checks, ghError } = await checkTools(withAz || az);
    showToolChecks(checks);
    if (ghError) log(`gh probe failed: ${ghError}`);
  })().finally(() => { checkingTools = null; });
  await checkingTools;
  // A gh that still blocks the read after a check means the first read never starts.
  if (ghStopsRead(board.snapshot().tools?.gh)) settleFirstRead();
  board.push();
  if (ghBlocked && !ghStopsRead(board.snapshot().tools?.gh)) readSoon();
}

/** The onboarded repositories as the list is now; none while it can't be read, which the read reports. */
function onboarded(): OnboardedRepository[] {
  try { return readRepositoryList(); }
  catch { return []; }
}

/**
 * Whether gh's check stops the read: it blocks every repository the board lists. With none, nothing reads a Project,
 * so only a missing or logged-out gh stops it.
 */
function ghStopsRead(check: GhCheck | undefined): boolean {
  const repos = items.repos();
  const sources: ItemSource[] = repos.length ? repos.map(itemSource) : ['issues'];
  return sources.every((source) => ghBlocksRead(check, source));
}

/**
 * Reads the sources due at the pace now; while a read runs this one is skipped, so two reads never run together, and
 * a tick with no source due reads nothing.
 */
async function refresh(): Promise<void> {
  if (refreshing) return;
  // Before the first tool check there's no gh to read with; that check starts the first read.
  // A gh that blocks the read has its own notice and retries; reading would only fail.
  if (ghStopsRead(board.snapshot().tools?.gh)) {
    // Without a check yet it is only too early to read; the check settles the first read if gh blocks it.
    if (board.snapshot().tools) settleFirstRead();
    return;
  }
  refreshing = true;
  readAgain = false;
  let read = false;
  const readRevision = board.revision();
  try {
    await checkQuota();
    const pace = readPace();
    if (!items.due(pace)) return;
    offerModelChoices();
    // The app installs after the board server starts, so each read picks up the latest install's state.
    board.update({ bundledSkills: bundledSkills() });
    const snapshot = await items.read(firstReadProgress, pace);
    const { error, fetchedAt } = board.snapshot();
    const recovered = error !== null && error !== settings.problem || fetchedAt === null;
    board.applyRead(snapshot.items, readRevision, withT3Reads, items.readAfresh);
    const repos = items.repos();
    moveFirstRead({ step: 'finishing' });
    board.update({ project: { title: snapshot.title }, fetchedAt: new Date().toISOString(), error: settings.problem ?? null, itemSourceProblems: snapshot.problems ?? [],
      t3EnvironmentId: readEnvironmentId(environmentIdFile), repositoryProjects: await repositoryProjectHints(repos) });
    if (recovered) log(`read ${snapshot.items.length} items from ${repos.length} repositories`);
    read = true;
  } catch (err) {
    // Probe gh, so a gh that went missing or logged out shows its notice instead of Stale; a cooling gh calls nothing.
    const gh = ghCooldown.until() ? { check: board.snapshot().tools!.gh } : await probeGh();
    if (gh.check.result !== 'ok') showToolChecks({ ...board.snapshot().tools!, gh: gh.check });
    const error = ghStopsRead(gh.check) ? null : gh.error ?? (err instanceof Error ? err.message : String(err));
    board.update({ error });
    if (error) log(`refresh failed, serving data from ${board.snapshot().fetchedAt ?? 'never'}: ${error}`);
  } finally {
    refreshing = false;
    settleFirstRead();
  }
  board.push();
  // Repositories not answered yet take a gh call each, so the offers follow the read instead of holding it up.
  void offerOnboarding().then(() => board.push());
  // PR edits take a gh call or two each, and a start runs t3; the board doesn't wait for them.
  if (read) void syncPrStats(board.snapshot().items);
  if (read) void startAfter.startUnblocked();
  if (readAgain) void refresh();
}

/** Offers to onboard each T3 project whose repository has .lar-factory.json and isn't on the list; none while T3's projects can't be read. */
async function offerOnboarding(): Promise<void> {
  try {
    board.update({ onboardingOffers: onboardingOffers(await choices()) });
    offersUnavailable(false);
  } catch {
    board.update({ onboardingOffers: [] });
    offersUnavailable(true);
  }
}

/**
 * Reads the source listing the item at `url` now, or every source after loading the configs again when there is none;
 * or once more after the running read, so a change made during that read is read too.
 */
function readSoon(url?: string): void {
  if (url === undefined) items.reload();
  else items.invalidate(url);
  if (refreshing) readAgain = true;
  else void refresh();
}

// The page `pnpm run build` wrote, read once at startup. The path is relative to this
// entry, so it holds both for the source and for the packaged app's bundle in
// Resources/server/dist/, beside Resources/web/dist/.
const page = loadBuild(new URL('../../web/dist/', import.meta.url));

/** Onboarding's Clash agent runs, kept while the board runs so closing the dialog leaves a run going. */
const clashRuns = createClashRuns(offerModelChoices);
const commands = createItemCommands({ board, items, repos: items.repos, offerModelChoices, checkSkills: parentSkillCheck() });
// Sample mode keeps no armed starts: it serves a fixed file and starts nothing.
const startAfter = createStartAfter({ board, commands, offerModelChoices, file: fixture ? null : join(boardDataDir(), 'armed-starts.json'),
  renamedId: items.renamedId });
const { server, endStreams } = createBoardServer({
  board, commands, startAfter, page, appSecret: process.env.BOARD_APP_SECRET || null, sample: !!fixture,
  recheck: (options) => recheckTools(true, options?.az), itemDetails: createItemDetails(fixture ? detailsFileFor(fixture) : null), readSoon, ready: () => firstToolCheck, projectChoices: choices,
  keepOnboarding: (input) => keepOnboarding(input),
  createProject: (input) => createProject(input, choices),
  runSetupCheck: (input) => runSetupCheck(input),
  repositoryLabels: { read: (input) => readRepositoryLabels(input), create: (input) => createRepositoryLabels(input), rename: (input) => renameRepositoryLabels(input),
    custom: (input) => createCustomLabel(input) },
  findFixedClashes: (input) => findFixedClashes(input),
  startClashRun: (input) => clashRuns.start(input), clashRuns: (repo) => clashRuns.list(repo),
  openOnboardingPr: createPrOpener(), previewOnboardingPr: (input) => previewOnboardingPr(input), reopenOnboardingPr: (input) => reopenOnboardingPr(input),
  resetRepository: (input) => resetRepository(input),
  readEditConfig: (input) => readEditConfig(input), openEditPr: (input) => openEditPr(input),
  openConfigUpdatePr: (input) => openConfigUpdatePr(input), dismissConfigUpdate: (repo) => dismissConfigUpdate(repo),
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
log(`board on http://${HOST}:${port}, reading active work every ${ACTIVE_READ_MS / 1000} s and the rest every ${settings.refreshSeconds} s`);
reportListening(port);
// status.sh finds live boards by their records; a sample board isn't one to refresh.
if (!fixture) process.on('exit', recordBoard(port));
// Sample mode runs no tools, so it looks none up. The check starts the first read once gh works.
if (!fixture) firstToolCheck = recheckTools();
// The repositories still onboarding show before the first read, which waits for gh.
if (!fixture) board.update({ onboarding: stillOnboarding(onboarded()) });

// BOARD_DATA_FILE serves a fixed JSON file instead of reading GitHub (for
// trying the layout, e.g. with packages/shared/test/sample.json).
if (fixture) {
  board.update({ ...JSON.parse(readFileSync(fixture, 'utf8')) as BoardData, capture, firstRead: SETTLED_FIRST_READ });
  offerModelChoices();
  log(`serving ${fixture} instead of GitHub`);
}
// Each tick only checks whether a source is due; refresh reads nothing when none is.
const timer = setInterval(() => {
  if (!fixture) void refresh();
}, 1_000);
const localTimer = setInterval(() => {
  if (!fixture) refreshLocal();
}, LOCAL_REFRESH_MS);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearInterval(timer);
    clearInterval(localTimer);
    clearTimeout(toolRetry);
    endStreams();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 2000).unref();
  });
}
