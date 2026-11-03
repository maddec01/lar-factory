import { inspectCleanups, executeCleanup, type CleanupPlan } from './work-cleanup.ts';
// The commands the board's buttons send: queue, back to List, start, start build, abandon, close an
// abandoned item's ticket, restore set-aside work and act on Needs you.
// Every Status move writes the item's work record, naming the revision the board read, and never its ticket. The maps of
// commands in flight are private here, so every rule about which command blocks which lives in this file.

import { changeKind, type KindChangeDeps } from '@lar-factory/work-records/change-kind';
import { refreshSpecs } from '@lar-factory/work-records/spec-sync';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { readTicketSpec, stripTrackerStructure, SWAP_KINDS, WAITS_FOR_ONBOARDING, blockedText, writeAccessProblem, buildBranch, buildMessage, canAbandon, canResumeShaping, canRetryBuild, earlierBuildMessage, earlierWorkMessage, isDriftChoice, isLiveThread, isOnboarding, kindCanChange, sameRepo, workMessage } from '@lar-factory/shared';
import type { BoardData, DriftChoice, FactoryThreadContext, Item, LabelChange, ModelChoice, ModelGroup, OperationAccess, PickedTicket, ShapingThreadCleanup, SkillCheckOutcome, StartedThread, StartProgress, StartPurpose, StartResult, Status, SwapKind } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { readShapingThreadCleanup, WorkRecordError, type LaunchIntent, type PullRequestState, type SavedShapingThreadCleanup, type WorkRecord, type WorkRecords } from '@lar-factory/work-records';
import { assertAzureThreadAllowed } from '@lar-factory/shared/azure-safety';
import type { BoardState } from '../board/board-state.ts';
import { observePr, prHost, prUrl } from '../config/pr-host.ts';
import { readRepositoryList } from '../config/repository-config.ts';
import { readRepositorySetups } from '../config/repository-settings.ts';
import { installHome } from '../skills/bundled-skills.ts';
import { readJsonRecord } from '../json-file.ts';
import { log } from '../log.ts';
import { serverRuntimePath } from '../t3/t3-settings.ts';
import { runTool } from '../tools/run-tool.ts';
import { inspectWorkRecovery } from './work-recovery.ts';
import { checkouts, repositoryProject } from '../t3/repository-project.ts';
import type { RepositoryProject } from '../t3/repository-project.ts';
import { findModelChoice } from '../t3/model-choices.ts';
import { liveWorktreePaths } from '../t3/item-execution.ts';
import { protocolStartedThread } from '../t3/item-execution.ts';
import { findStartedThread, lookupThread, startThread } from '../t3/t3.ts';
import type { ItemSource } from './item-source.ts';
import { importPickedTicket } from './import-ticket.ts';
import { needsYouNotice, NO_THREAD, savedNeedsYou } from './needs-you-causes.ts';
import { observeWork } from './observe-records.ts';

/** A command's answer: the HTTP status and the JSON body. */
export interface Reply {
  status: number;
  body: object;
}

export interface ItemCommands {
  /**
   * Settles each unresolved launch intent through T3, and checks each started or recorded thread missing from an
   * available thread read. A thread's state never moves Status.
   */
  reconcileStarts(items: Item[]): Promise<void>;
  queue(itemId: string): Promise<Reply>;
  backToList(itemId: string): Reply;
  /**
   * Starts a T3 thread for a Queued item that nothing open blocks, once unless its recorded thread stopped or was
   * deleted. It writes a launch intent on the work record before it asks T3, and settles an unresolved one through T3
   * before starting again. `quiet` leaves a failure to the caller to show, as Start after does.
   */
  start(itemId: string, model: unknown, quiet?: boolean): Promise<Reply>;
  /**
   * Starts a Ready build's thread in a new worktree, or retries a confirmed stopped or deleted one, once nothing open
   * blocks it, as lar-shape's step 5 does after Go: it moves a parent record that isn't a build to In progress first,
   * and snapshots the repository's selected project skills on the record. Launch intents guard it as they guard Start.
   * Drift refuses it with the skills that changed until `drift` carries the User's DriftChoice.
   */
  inspectOwnedCleanup(itemId: string): Promise<Reply>;
  executeOwnedCleanup(itemId: string, input: unknown): Promise<Reply>;
  inspectRecovery(itemId: string): Promise<Reply>;
  startAgain(itemId: string, model: unknown, options: unknown): Promise<Reply>;
  startBuild(itemId: string, model: unknown, drift?: unknown, quiet?: boolean): Promise<Reply>;
  /** Clears the refused or failed start the item shows for `purpose`, on every page. */
  dismissStartError(itemId: string, purpose: unknown): Reply;
  /**
   * Sets List or Queued work aside on this Mac, or work whose Needs you offers it, and leaves its ticket as it is.
   * Archive offers closeTicket separately. The combined action closes before setting work aside.
   */
  abandon(itemId: string): Promise<Reply>;
  abandonAndClose(itemId: string): Promise<Reply>;
  /**
   * Closes the open ticket of set-aside work in Archive: as not planned on GitHub, to Removed on Azure DevOps. A close
   * that succeeded answers a second press without closing again.
   */
  closeTicket(itemId: string): Promise<Reply>;
  /**
   * Brings set-aside work in Archive back to the board in the Status it had, unless retention hides it as finished, then
   * reads its PR and ticket through the observer's rules, as no observer reads set-aside work. A failed read keeps the
   * notice as last saved for the next observer pass, and the restore still succeeds.
   */
  restore(itemId: string): Promise<Reply>;
  /**
   * Acts on work that needs you as `choice`, one of its notice's offers, says, then removes every cause the notice names
   * and refuses anything else. Reopening the PR reopens it in its provider, a replacement build moves the work to Ready
   * for Start build, Keep working changes nothing else and Mark as handled also removes the free text. Setting it aside
   * is Abandon, and Start again is its own command.
   */
  resolveNeedsYou(itemId: string, choice: unknown, briefChoice?: unknown): Promise<Reply>;
  /**
   * Marks a Dependency holding the item met, as the user decided, or clears the mark when `met` is false. `revision` is
   * the Dependency's as the board showed it, so a change since then refuses the write.
   */
  markDependencyMet(itemId: string, dependencyId: unknown, revision: unknown, met: unknown): Reply;
  /**
   * Gives an ordinary item `kind`, through the same path as `lar-work change-kind`, making its record first if it has none. The
   * answer's `line` says what changed, also after a failure, its `itemId` where the item is now, and `labelChanges` the
   * label writes the tracker took.
   */
  changeKind(itemId: string, kind: unknown): Promise<Reply & { labelChanges: LabelChange[]; ticketType: string | null }>;
  /** Answers a kind disagreement with no tracker write: keep both kinds, or give the item the kind `ticketKind`, the one the user saw. */
  answerKind(itemId: string, answer: unknown, ticketKind: unknown): Reply;
}

export interface ItemCommandsDeps {
  /** Exact installation/data handoff. Null is reserved for deterministic protocol tests. */
  inspectWorkRecovery?: typeof inspectWorkRecovery;
  checkoutOf?: (projectId: string) => Promise<string>;
  factoryContext?: FactoryThreadContext | null;
  board: BoardState;
  /** The file that names the failed starts already cleared; none keeps them for this board run only. */
  clearedFailuresFile?: string | null;
  /** Where the commands write changes to tickets. */
  items: ItemSource;
  /** Where the commands write Status moves; null in sample mode, which moves nothing. */
  records: WorkRecords | null;
  /** Shows the work records as they are now, after a write or a refused one. */
  reread(): void;
  /** Archive's work as the records are now: set aside, or finished and hidden by retention. */
  archive(): Item[];
  /** Reads the model choices T3 offers now into the board data. */
  offerModelChoices(): ModelGroup[];
  /**
   * Checks the installed skills against the bundle before Start build, replacing Drift if `drift` says so: resolves
   * with why the build can't start, or null, and the skills with Drift while it waits for a choice. Missing without a
   * bundle, so Start build checks nothing.
   */
  checkSkills?: (drift?: DriftChoice) => Promise<SkillCheckOutcome>;
  /** The repository's T3 project as the onboarded repositories are now; tests stand in for it. */
  projectOf?: (repo: string) => Promise<RepositoryProject>;
  /** The provider's default branch, resolved before changing or launching the build. */
  baseOf?: (repo: string) => Promise<string>;
  buildAccessOf?: (repo: string) => Partial<Record<'push-branch' | 'open-pr', OperationAccess>>;
  /** Starts a T3 thread; tests stand in for t3. */
  startThread?: typeof startThread;
  showThread?: typeof lookupThread;
  /** Finds the thread an unresolved start opened, through T3's protocol and then its CLI; tests stand in for both. */
  recoverThread?: (projectId: string, messages: readonly string[], known: readonly string[]) => Promise<StartedThread | 'absent' | 'unknown'>;
  /** This machine's shaping thread cleanup choice, which throws when unreadable; tests stand in for the local setting. */
  shapingThreadCleanupChoice?: () => ShapingThreadCleanup;
  /** The project skills selected for the repository as builds start now; tests stand in for the local settings. */
  skillsOf?: (repo: string) => readonly string[];
  /** Reopens the repository's PR `number`; tests stand in for gh and az. */
  reopenPr?: (repo: string, number: number) => Promise<void>;
  /** Reads the repository's PR `number` as it is now; tests stand in for gh and az. */
  readPr?: (repo: string, number: number) => Promise<PullRequestState>;
  /** The tracker of a kind change; tests stand in for it. */
  kindTracker?: (repo: string) => Pick<KindChangeDeps, 'labels' | 'kinds'>;
}

type Action = 'queue' | 'back to List' | 'start' | 'abandon';

/** A status change the board's buttons make: Queue moves List to Queued, Back to List the reverse. */
interface Move {
  action: Action;
  from: Status;
  to: Status;
  refused: (status: Status) => string;
}

const QUEUE: Move = {
  action: 'queue', from: 'List', to: 'Queued',
  refused: (status) => `Only List items can be queued; this one is in ${status}.`,
};

const BACK_TO_LIST: Move = {
  action: 'back to List', from: 'Queued', to: 'List',
  refused: (status) => `Only Queued items can be moved back to List; this one is in ${status}.`,
};

/** A refused Start ran no t3: one of the repository project's checks failed. */
type Start = StartResult & { refused?: true };

const GONE = 'That item is no longer on the board.';

/** Keeps `work` in `inFlight` under `key` until it settles, or for good when `keep` says so. */
function track<T>(inFlight: Map<string, Promise<T>>, key: string, work: Promise<T>, keep: (result: T) => boolean = () => false): Promise<T> {
  const tracked = work.then((result) => {
    if (!keep(result)) inFlight.delete(key);
    return result;
  });
  inFlight.set(key, tracked);
  return tracked;
}

/** Where lar-build is installed, for the build message: under the board app's install root, else the home. */
const larBuild = () => join(installHome(), '.agents/skills/lar-build');
const currentFactoryContext = (): FactoryThreadContext => ({dataDir:boardDataDir(),bin:join(installHome(),'.local/bin'),shapeSkill:join(installHome(),'.agents/skills/lar-shape/SKILL.md'),azureReadOnly:process.env.LAR_FACTORY_AZURE_READ_ONLY==='1'});

/** The repository project for an onboarded repository as the list is now, so a repository onboarded after a refusal starts on the next Start. */
async function currentRepositoryProject(repo: string): Promise<RepositoryProject> {
  let repos;
  try { repos = readRepositoryList(); }
  catch (err) { return { error: `Can't read the onboarded repositories: ${(err as Error).message}` }; }
  return repositoryProject(repo, repos);
}

/** The thread an unresolved start opened as T3's protocol shows it, else as its CLI does. */
async function recoverStartedThread(projectId: string, messages: readonly string[], known: readonly string[]): Promise<StartedThread | 'absent' | 'unknown'> {
  try {
    const found = protocolStartedThread(projectId, messages, known);
    if (found) return found;
  } catch { /* The CLI reads T3 when the protocol can't. */ }
  return findStartedThread(projectId, messages, known);
}

/** The project skills selected for the repository in its local settings, or none. */
function selectedSkills(repo: string): readonly string[] {
  try { return readRepositorySetups().find((setup) => sameRepo(setup.repo, repo))?.skills ?? []; }
  catch { return []; }
}

/** How long T3 may take to show a thread it started before its absence counts. */
const SHOW_GRACE_MS = 60_000;

/** What each kind of start records its thread for, and the board data that shows it. */
const PURPOSES = { started: 'shape', startedBuilds: 'build' } as const;
type StartRecord = keyof typeof PURPOSES;

const MAY_HAVE_STARTED = "This work's last start may have opened a T3 thread. Check the repository's project in T3 Code; the board settles it once T3 shows it.";
const START_CRASHED = 'The start failed. Check the board log.';
const START_PURPOSES: readonly StartPurpose[] = ['shape', 'build'];
const isStartPurpose = (purpose: unknown): purpose is StartPurpose => START_PURPOSES.includes(purpose as StartPurpose);
const LIVE_SHAPING = 'A shaping thread is still at work on this item. Wait for it to finish, then start the build.';

export function createItemCommands({ inspectWorkRecovery: inspect = inspectWorkRecovery,
  checkoutOf = async projectId => {
    const checkout = (await checkouts(process.env)).find(p => p.id === projectId);
    if (!checkout) throw new Error('Cannot find the repository checkout.');
    return checkout.folder;
  }, clearedFailuresFile = null, board, items, records, reread, archive, offerModelChoices, checkSkills, kindTracker, projectOf = currentRepositoryProject,
  baseOf = async (repo) => (await prHost(repo).defaultBranchHead(repo)).branch,
  buildAccessOf = (repo) => readRepositorySetups().find(setup => sameRepo(setup.repo, repo))?.access ?? {},
  showThread = lookupThread, startThread: startIn = startThread, recoverThread = recoverStartedThread, shapingThreadCleanupChoice = readShapingThreadCleanup, skillsOf = selectedSkills, factoryContext = currentFactoryContext(),
  reopenPr = (repo, number) => prHost(repo).reopenPr(prUrl(repo, number)), readPr = (repo, number) => observePr(repo, number) }: ItemCommandsDeps): ItemCommands {
  const retryBuilds = new Set<string>();
  /** The starts running now, from the press until T3 answers or a check refuses them. */
  const running: Record<StartPurpose, Set<string>> = { shape: new Set(), build: new Set() };
  /** The latest refused or failed start's message, by item id, until it's dismissed or a start runs again. */
  const failures: Record<StartPurpose, Map<string, string>> = { shape: new Map(), build: new Map() };
  /** The failed launch intents whose failure was cleared, kept so a restart doesn't show it again. */
  const clearedIntents = new Set(Object.keys((clearedFailuresFile && readJsonRecord(clearedFailuresFile)) ?? {}));
  /** Thread lookups by thread ID: one in flight, or when the next may run. */
  const checks = new Map<string, { pending: boolean; retryAt: number }>();
  /** Recorded threads the T3 CLI confirmed deleted, which no longer hold a start. */
  const deleted = new Set<string>();
  /** The intents whose start is asking T3 now, which only its answer settles. */
  const asking = new Set<string>();
  /** Intent settlements in flight by intent ID, so a refresh and a Start share one. */
  const settling = new Map<string, Promise<Start>>();
  /** Starts by item id. A kept result is reused, so one item starts at most one thread per board run. */
  const starts = new Map<string, Promise<Start>>();
  /** Start builds by item id, kept like Starts, so an item started while Queued can still start its build. */
  const buildStarts = new Map<string, Promise<Start>>();
  // Only settled starts can be retried; requests arriving during a retry share its pending result.
  const finishedStarts = new WeakMap<Promise<Start>, string>();
  const settled = new WeakSet<Promise<Start>>();
  /** Saves only this ticket, retaining its text while a closed-ticket persistence failure is retried. */
  async function abandonmentRecord(item: Item) {
    let ticket = abandonmentTickets.get(item.id);
    if (!ticket) {
      ticket = await items.readTicket(item.repo, item.number!) ?? undefined;
      if (!ticket) throw new Error('Could not read the ticket before abandonment. Try again.');
      abandonmentTickets.set(item.id, ticket);
    }
    const context = stripTrackerStructure(ticket.text).replace(/<!-- lar-factory:create [^\n]*? -->/g, '').trimEnd();
    const parsed = readTicketSpec(context);
    return records!.importTicket({ title: ticket.title, repository: item.repo, kind: ticket.kind,
      ticket: `${item.repo}#${ticket.number}`, context: parsed.marked ? parsed.original ?? '' : context }).record;
  }
  /** Ticket closes by item id: one in flight, so a second press waits for it, or one that succeeded, kept. */
  const abandonmentTickets = new Map<string, PickedTicket>();
  const abandoning = new Map<string, Promise<Reply>>();
  const combined = new Map<string, Promise<Reply>>();
  const closing = new Map<string, Promise<string | null>>();

  const reply = (status: number, body: object): Reply => ({ status, body });
  const withBoard = (status: number, body: object): Reply => reply(status, { ...body, board: board.snapshot() });

  /** Sets the board data's start progress from the running starts, the failures and the unresolved launch intents. */
  function showStarts(): void {
    const progress: NonNullable<BoardData['startProgress']> = {};
    const put = (itemId: string, purpose: StartPurpose, start: StartProgress) => { progress[itemId] = { ...progress[itemId], [purpose]: start }; };
    for (const purpose of START_PURPOSES) for (const [itemId, message] of failures[purpose]) put(itemId, purpose, { phase: 'failed', message });
    let intents: LaunchIntent[] = [];
    try { intents = records?.launchIntents({ unresolved: true }) ?? []; } catch { /* The next read shows them. */ }
    for (const { workId, purpose } of intents) if (isStartPurpose(purpose)) put(workId, purpose, { phase: 'may-have-started', message: MAY_HAVE_STARTED });
    for (const purpose of START_PURPOSES) for (const itemId of running[purpose]) put(itemId, purpose, { phase: 'starting' });
    board.update({ startProgress: progress });
  }

  /** Shows the starts, and pushes them only when they changed. */
  function pushStarts(): void {
    const before = JSON.stringify(board.snapshot().startProgress ?? {});
    showStarts();
    if (JSON.stringify(board.snapshot().startProgress) !== before) board.push();
  }

  /** A failure on the record survives a restart while its item can still start again; No thread shows as Needs you instead. */
  function restoreFailures(): void {
    if (!records) return;
    try {
      const latest = new Map(records.launchIntents({}).map((intent) => [`${intent.purpose} ${intent.workId}`, intent]));
      for (const { intentId, workId, purpose, failure } of latest.values()) {
        if (!isStartPurpose(purpose) || !failure || failure === NO_THREAD || clearedIntents.has(intentId)) continue;
        const { status, buildPhase } = records.read(workId);
        if ((purpose === 'build' ? ['Ready', 'In progress'] : ['Queued', 'Shaping']).includes(status) && !buildPhase) failures[purpose].set(workId, failure);
      }
    } catch (err) { log(`can't read the failed starts: ${(err as Error).message}`); }
  }
  restoreFailures();
  showStarts();

  /** Clears the item's failure for `purpose`, for good: a restart shows it again only from a later failed intent. */
  function clearFailure(itemId: string, purpose: StartPurpose): void {
    failures[purpose].delete(itemId);
    if (!records || !clearedFailuresFile) return;
    try {
      const latest = records.launchIntents({ workId: itemId }).filter((intent) => intent.purpose === purpose).at(-1);
      if (!latest?.failure || clearedIntents.has(latest.intentId)) return;
      clearedIntents.add(latest.intentId);
      mkdirSync(dirname(clearedFailuresFile), { recursive: true });
      writeFileSync(clearedFailuresFile, JSON.stringify(Object.fromEntries([...clearedIntents].map((id) => [id, true]))));
    } catch (err) { log(`can't save the cleared start failure of ${itemId}: ${(err as Error).message}`); }
  }
  const clearFailures = (itemId: string) => { for (const purpose of START_PURPOSES) clearFailure(itemId, purpose); };

  /** Why a command in flight on the item, or a Start this board run, blocks this action; null when nothing does. */
  function busyReason(itemId: string, action: Action): string | null {
    if (abandoning.has(itemId)) return 'Abandon is running. Wait for it to finish.';
    if (combined.has(itemId)) return 'Abandon and close ticket is running. Wait for it to finish.';
    if (['List', 'Queued'].includes(board.find(itemId)?.status ?? '') && recordedThreads(itemId).length > 0 && !!recordedThreads(itemId).at(-1)?.deletedAt && !records?.launchIntents({ workId: itemId, unresolved: true }).length) return null;
    const started = buildStarts.has(itemId) || starts.has(itemId) || !!board.snapshot().started?.[itemId] || recordedStart(itemId);
    if (started && action === 'back to List') return 'Start is running or has run for this item. Check its T3 thread before moving it back to List.';
    if (started && action === 'abandon') return 'Start is running or has run for this item. Check its T3 thread before abandoning it.';
    return null;
  }

  /**
   * Moves the item's work record to `to` at the revision the board read: the error to show, null once it moved. A
   * revision a thread moved past refuses and shows the record as it is now; any answer reads the records again.
   */
  function setStatus(item: Item, to: Status): { status: number; error: string } | null {
    if (!records) return { status: 409, error: 'The board has no work records to move.' };
    try {
      records.update(item.id, item.revision, { status: to });
      return null;
    } catch (err) {
      const refused = err instanceof WorkRecordError && (err.code === 'stale-revision' || err.code === 'not-found' || err.code === 'invalid');
      return { status: refused ? 409 : 502, error: (err as Error).message };
    } finally {
      reread();
    }
  }

  function move(itemId: string, { action, from, to, refused }: Move): Reply {
    const item = board.find(itemId);
    if (!item) return reply(404, { error: GONE });
    if (item.status === to) return withBoard(200, { error: null });
    if (item.status !== from) return reply(409, { error: refused(item.status) });
    const busy = busyReason(itemId, action);
    if (busy) return withBoard(409, { error: busy });
    const failed = setStatus(item, to);
    if (!failed) {
      clearFailures(itemId);
      pushStarts();
    }
    return withBoard(failed?.status ?? 200, { error: failed?.error ?? null });
  }

  /**
   * Refuses a start while the item's repository is still onboarding, until it saves its setup, or while a blocker's work
   * isn't complete; Start after starts it once they complete.
   */
  function blockedReply(item: Item): Reply | null {
    if (isOnboarding(board.snapshot(), item.repo)) return withBoard(409, { error: WAITS_FOR_ONBOARDING });
    const blocked = blockedText(item);
    return blocked ? withBoard(409, { error: `${blocked}; use Start after to start it then.` }) : null;
  }

  /**
   * Runs a start once until its recorded thread stops, keyed in `runs`, on the model choice the
   * board offers now, and records the thread it opened in the board data's `record`. `begin`
   * refuses the item, or returns the work that starts its thread.
   */
  async function startOnce(runs: Map<string, Promise<Start>>, record: StartRecord, itemId: string, model: unknown,
    begin: (item: Item, choice: ModelChoice | undefined) => Reply | (() => Promise<Start>)): Promise<Reply> {
    // Only a choice the board offers right now reaches t3 as arguments.
    let choice: ModelChoice | undefined;
    if (model !== undefined) {
      const found = findModelChoice(offerModelChoices(), model);
      if (!found) return withBoard(422, { error: "That model choice isn't offered. Pick another one." });
      choice = found;
    }
    let pending = runs.get(itemId);
    const item = board.find(itemId);
    if (item) {
      try { assertAzureThreadAllowed(item.repo); }
      catch (error) { return withBoard(403, { error: (error as Error).message }); }
    }
    const previous = pending && finishedStarts.get(pending);
    if (previous && Array.isArray(item?.threads) && item.threads.some((t) => t.id === previous && t.state === 'stopped')
      && !item.threads.some((t) => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren)) {
      runs.delete(itemId);
      pending = undefined;
    }
    // With work records, the record guards a settled start, so each press reads it again.
    if (records && pending && settled.has(pending)) {
      runs.delete(itemId);
      pending = undefined;
    }
    if (!pending) {
      const item = board.find(itemId);
      if (!item) return reply(404, { error: GONE });
      const work = begin(item, choice);
      if (typeof work !== 'function') return work;
      const purpose = PURPOSES[record];
      running[purpose].add(itemId);
      failures[purpose].delete(itemId);
      // Keep a started or unconfirmed thread; only a confirmed stop or a failure reported by t3 allows retry.
      pending = track(runs, itemId, Promise.resolve().then(work).finally(() => {
        running[purpose].delete(itemId);
        showStarts();
      }).then((result) => {
        settled.add(pending!);
        if (result.thread) finishedStarts.set(pending!, result.thread.threadId);
        if (result.thread) board.update({ [record]: { ...board.snapshot()[record], [itemId]: result.thread } } satisfies Partial<BoardData>);
        board.push();
        return result;
      }), (result) => !!result.thread || !!result.uncertain);
      pushStarts();
    }
    const { refused, ...result } = await pending;
    return withBoard(refused ? 409 : result.error ? 502 : 200, result);
  }

  /**
   * Runs a press of Start or Start build, showing whatever refuses or fails it on every page. A failure the caller
   * shows itself stays off the board, and so does an item that's gone.
   */
  async function press(record: StartRecord, itemId: string, quiet: boolean, run: () => Promise<Reply>): Promise<Reply> {
    const purpose = PURPOSES[record];
    const fail = (error: string) => {
      if (quiet) clearFailure(itemId, purpose);
      else if (board.find(itemId)) failures[purpose].set(itemId, error);
    };
    try {
      const answer = await run();
      const { error, uncertain } = answer.body as Partial<StartResult>;
      if (error && !uncertain) fail(error);
      else failures[purpose].delete(itemId);
      showStarts();
      board.push();
      return withBoard(answer.status, answer.body);
    } catch (error) {
      // The log gets the detail, as every page can read this.
      fail(START_CRASHED);
      showStarts();
      board.push();
      throw error;
    }
  }

  /** The threads the item's work record holds; none without records or a record. */
  function recordedThreads(workId: string) {
    try { return records?.threads(workId) ?? []; }
    catch { return []; }
  }

  /** Whether the work record holds a thread or an unresolved launch intent. */
  function recordedStart(workId: string): boolean {
    return recordedThreads(workId).length > 0 || !!records?.launchIntents({ workId, unresolved: true }).length;
  }

  /** Whether the work's recorded PR is observed closed unmerged, so its build starts again as a replacement. */
  function prClosed(workId: string): boolean {
    try { return records?.observations(workId).some((o) => o.of === 'pr' && o.state === 'closed') ?? false; }
    catch { return false; }
  }

  /** Writes a change to the item's work record at its current revision, then shows the records again. */
  function write<T>(workId: string, change: (revision: number) => T): T {
    try { return change(records!.read(workId).revision); }
    finally { reread(); }
  }

  /**
   * Settles an unresolved launch intent through T3: to the thread T3 shows for it, to a failure with Needs you once T3
   * shows none after SHOW_GRACE_MS, or not yet while T3 can't answer.
   */
  function settle(item: Item, intent: LaunchIntent, projectId: string): Promise<Start> {
    const running = settling.get(intent.intentId);
    if (running) return running;
    // An intent recorded before thread names carried a phase started its thread with the earlier message.
    const messages = intent.purpose === PURPOSES.startedBuilds
      ? [buildMessage(item, larBuild(), factoryContext), earlierBuildMessage(item, larBuild(), factoryContext)]
      : [workMessage(item, factoryContext), earlierWorkMessage(item, factoryContext)];
    return track(settling, intent.intentId, (async (): Promise<Start> => {
      const known = records!.threads(item.id).map((t) => t.threadId);
      let found: Awaited<ReturnType<typeof recoverThread>>;
      try { found = await recoverThread(projectId, intent.recovery?.message ? [intent.recovery.message] : messages, known); } catch { found = 'unknown'; }
      if (typeof found === 'object') {
        write(item.id, (revision) => records!.resolveLaunchIntent(item.id, revision, intent.intentId, { threadId: found.threadId }));
        const saved = savedNeedsYou(records!.read(item.id), records!.observations(item.id));
        if (saved.causes.some((cause) => cause.type === 'no-thread')) write(item.id, (revision) => records!.setNeedsYouCauses(item.id, revision, saved.causes.filter((cause) => cause.type !== 'no-thread'), { clearReason: saved.oldWording }));
        return { thread: found, error: null };
      }
      if (found === 'absent' && Date.now() - Date.parse(intent.requestedAt) >= SHOW_GRACE_MS) {
        write(item.id, (revision) => records!.resolveLaunchIntent(item.id, revision, intent.intentId, { failure: NO_THREAD }));
        const saved = savedNeedsYou(records!.read(item.id), records!.observations(item.id));
        const causes = saved.causes.some((cause) => cause.type === 'no-thread') ? saved.causes : [...saved.causes, { type: 'no-thread' as const }];
        write(item.id, (revision) => records!.setNeedsYouCauses(item.id, revision, causes, { clearReason: saved.oldWording }));
        return { thread: null, error: `Needs you: ${NO_THREAD}`, refused: true };
      }
      return { thread: null, error: MAY_HAVE_STARTED, uncertain: true };
    })());
  }

  /**
   * The thread the work record already holds for `purpose`: one not confirmed stopped or deleted, with the item's
   * threads as T3 shows them. Null when every one stopped or was deleted, so a start may run again.
   */
  function heldThread(item: Item, purpose: string): StartedThread | null {
    const history = records!.threads(item.id).filter((t) => t.purpose === purpose);
    if (history.at(-1)?.deletedAt && Array.isArray(item.threads) && !item.threads.some(t => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren)) return null;
    for (const { threadId } of history.reverse()) {
      if (deleted.has(threadId) || records!.threads(item.id).find(t => t.threadId === threadId)?.deletedAt) continue;
      const shown = Array.isArray(item.threads) ? item.threads.find((t) => t.id === threadId) : undefined;
      if (shown && shown.state !== 'running' && shown.state !== 'needs you' && !shown.hasLiveChildren) continue;
      return { threadId, title: shown?.title ?? item.title };
    }
    return null;
  }

  /** The choice a Start build saves. An unreadable setting never stops the build. */
  function savedShapingThreadCleanup(): SavedShapingThreadCleanup {
    try { return shapingThreadCleanupChoice(); }
    catch { return 'unreadable'; }
  }

  /**
   * Starts the item's thread for `record` through `ask`, guarded by its work record: a held or unresolved start answers
   * for it, Needs you and a paused setup refuse it, and a launch intent is on the record before `ask` runs. Without records, `ask` alone.
   */
  async function launch(item: Item, record: StartRecord, projectId: string, message: string, ask: () => Promise<StartResult>,
    prepare: () => void = () => {}, recovery = false, stagedRecovery?: { branch: string; reset: boolean; message?: string }): Promise<Start> {
    if (!records) return ask();
    const purpose = PURPOSES[record];
    const unresolved = records.launchIntents({ workId: item.id, unresolved: true }).find((intent) => intent.purpose === purpose);
    if (unresolved) return settle(item, unresolved, projectId);
    const needsYou = needsYouNotice(records.read(item.id), records.observations(item.id));
    if (needsYou && !recovery) return { thread: null, error: `Needs you: ${needsYou.reason}`, refused: true };
    // A build whose PR closed unmerged starts a replacement, so the thread that opened that PR holds no start.
    const held = recovery ? null : record === 'startedBuilds' && prClosed(item.id) ? null : heldThread(board.find(item.id) ?? item, purpose);
    const shown = board.snapshot()[record]?.[item.id];
    if (held) return { thread: shown?.threadId === held.threadId ? shown : held, error: null };
    prepare();
    const cleanup = record === 'startedBuilds' ? savedShapingThreadCleanup() : undefined;
    const { intent } = write(item.id, (revision) => records.recordLaunchIntent(item.id, revision, purpose, stagedRecovery, cleanup));
    asking.add(intent.intentId);
    const result = await ask().finally(() => asking.delete(intent.intentId));
    const outcome = result.thread ? { threadId: result.thread.threadId } : !result.uncertain ? { failure: result.error ?? 'T3 started no thread.' } : null;
    // An outcome the record refuses leaves the intent unresolved, for a refresh to settle through T3.
    if (outcome) try { write(item.id, (revision) => records.resolveLaunchIntent(item.id, revision, intent.intentId, outcome)); } catch { /* settled later */ }
    if (recovery && result.thread) write(item.id, revision => records.setNeedsYouCauses(item.id, revision, [], { clearReason: true }));
    return result;
  }

  /**
   * Removes the causes the notice names, and a saved old wording of them, in one write with `change`. A cause raised
   * since then stays, because the user hasn't seen it.
   */
  function removeCauses(item: Item, change: { status?: Status; clearReason?: boolean }): void {
    const seen = item.needsYou!.causes.map((cause) => JSON.stringify(cause));
    const saved = savedNeedsYou(records!.read(item.id), records!.observations(item.id));
    const left = saved.causes.filter((cause) => !seen.includes(JSON.stringify(cause)));
    write(item.id, (revision) => records!.setNeedsYouCauses(item.id, revision, left, { ...change, clearReason: change.clearReason || saved.oldWording }));
  }

  /** Whether the item's notice is one Start again answers: a deleted thread, or a start T3 shows no thread for. */
  const recovers = (item: Item) => !!item.needsYou?.deletedThread || !!item.needsYou?.causes.some((cause) => cause.type === 'no-thread');

  /** Whether Start again starts a build: as its notice says, else as the last recorded thread did. */
  const recoversBuild = (item: Item) => (item.needsYou?.startAgainPurpose ?? recordedThreads(item.id).at(-1)?.purpose) === 'build';

  /** Only work with no recorded thread reads no threads, and the record may hold one the board hasn't read yet. Any other read that isn't a list may hide a live one, and so may a list without a recorded thread, as T3 leaves out only deleted threads. */
  function eligibleRecovery(item: Item): boolean {
    const { threads } = item;
    return !!records && recovers(item) && item.needsYou!.offers.includes('start-again')
      && (threads === undefined ? !recordedThreads(item.id).length : Array.isArray(threads) && !threads.some(t => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren)
        && recordedThreads(item.id).every(recorded => recorded.deletedAt || threads.some(t => t.id === recorded.threadId)));
  }

  async function cleanupSliceBranches(item: Item): Promise<string[]> {
    const slices = records!.children(item.id).filter(child => child.kind === 'slice');
    if (!slices.length) return [];
    const project = await projectOf(item.repo);
    if (project.error !== undefined) throw new Error(project.error);
    const checkout = await checkoutOf(project.projectId);
    const result = await runTool('git', ['-C', checkout, 'for-each-ref', '--format=%(refname:short)', 'refs/heads/'], { timeout: 10_000 });
    if (result.code !== 0) throw new Error('Cannot capture cleanup ownership');
    return result.stdout.split('\n').filter(name => slices.some(slice => name.startsWith(`slice/${slice.workId.slice(0, 8)}-`)));
  }

  const cleanupTokens = new Map<string, { itemId: string; plans: CleanupPlan[]; expiresAt: number }>();
  function pruneCleanupTokens(itemId?: string) {
    for (const [token, saved] of cleanupTokens) if (saved.expiresAt <= Date.now() || saved.itemId === itemId) cleanupTokens.delete(token);
    while (cleanupTokens.size >= 100) cleanupTokens.delete(cleanupTokens.keys().next().value!);
  }
  const cleaning = new Set<string>();
  async function ownedCleanup(item: Item, onlyBranch?: string) {
    if (!records) throw new Error('Work records are unavailable.');
    const snapshots = records.cleanupOwnership(item.id);
    const saved = new Set(snapshots.flatMap(snapshot => [snapshot.branch, ...snapshot.sliceBranches]));
    // A build's notice plans its branches in memory, so inspecting and Cancel write nothing. Only a saved branch or a
    // recorded build thread shows the board made them: a name derived from the ticket could be anyone's branch.
    const noticed = item.kind === 'build' && item.needsYou || recovers(item) && recoversBuild(item);
    const savedBranch = noticed ? records.read(item.id).buildBranch : null;
    const planned = noticed && (savedBranch || recordedThreads(item.id).some(thread => thread.purpose === PURPOSES.startedBuilds))
      ? { branch: savedBranch || buildBranch(item), sliceBranches: await cleanupSliceBranches(item) } : null;
    if (planned) snapshots.push({ ...planned, sliceIds: [] });
    const branches = [...new Set(snapshots.flatMap(snapshot => [snapshot.branch, ...snapshot.sliceBranches]).filter(Boolean))].filter(branch => !onlyBranch || branch === onlyBranch);
    if (!branches.length) return { checkout: '', plans: [] as CleanupPlan[], unsaved: null };
    const unsaved = planned && [planned.branch, ...planned.sliceBranches].some(branch => !saved.has(branch)) ? planned : null;
    const project = await projectOf(item.repo);
    if (project.error !== undefined) throw new Error(project.error);
    const checkout = await checkoutOf(project.projectId);
    const livePaths = liveWorktreePaths();
    if (!livePaths) throw new Error('Cannot verify live T3 worktree bindings. Try again when T3 is available.');
    const writable = !writeAccessProblem(item.repo, 'push-branch', buildAccessOf(item.repo)) && process.env.LAR_FACTORY_AZURE_READ_ONLY !== '1';
    const defaultBranch = await baseOf(item.repo);
    const plans = await inspectCleanups(branches, { repository: item.repo, checkout, item, sliceIds: [], sliceBranches: [], liveWorktreePaths: livePaths, defaultBranch, writable });
    return { checkout, plans, unsaved };
  }

  async function recoveryInspection(item: Item) {
    const project = await projectOf(item.repo);
    if (project.error !== undefined) throw new Error(project.error);
    const checkout = await checkoutOf(project.projectId);
    const record = records!.read(item.id);
    return inspect({ repository: item.repo, checkout, item, branch: record.buildBranch, recordedPr: record.pullRequest });
  }

  /** When each unresolved intent may be settled again on a refresh, by intent ID. */
  const settleAt = new Map<string, number>();

  /** Settles the item's unresolved launch intents, each at most every 30 seconds, and shows a thread T3 shows for one. */
  async function settleIntents(item: Item): Promise<void> {
    let intents: LaunchIntent[];
    try { intents = records?.launchIntents({ workId: item.id, unresolved: true }) ?? []; }
    catch { return; }
    for (const intent of intents) {
      if (asking.has(intent.intentId) || Date.now() < (settleAt.get(intent.intentId) ?? -Infinity)) continue;
      settleAt.set(intent.intentId, Date.now() + 30_000);
      const record: StartRecord = intent.purpose === PURPOSES.startedBuilds ? 'startedBuilds' : 'started';
      const repoProject = await projectOf(item.repo);
      if (repoProject.error !== undefined) continue;
      const { thread } = await settle(item, intent, repoProject.projectId);
      if (thread) board.update({ [record]: { ...board.snapshot()[record], [item.id]: thread } } satisfies Partial<BoardData>);
      showStarts();
      board.push();
    }
  }

  /** Moves the item's parent record to In progress, unless it's a build or there already: the error to show, else null. */
  function parentInProgress({ parentId }: Item): string | null {
    const parent = parentId ? board.find(parentId) : undefined;
    if (!parent || parent.kind === 'build' || parent.status === 'In progress') return null;
    return setStatus(parent, 'In progress')?.error ?? null;
  }

  return {
    async reconcileStarts(currentItems) {
      pushStarts();
      const warnings = { ...board.snapshot().startCheckFailures };
      for (const id of Object.keys(warnings)) if (!currentItems.some((item) => item.id === id)) delete warnings[id];
      if (JSON.stringify(warnings) !== JSON.stringify(board.snapshot().startCheckFailures ?? {})) {
        board.update({ startCheckFailures: warnings });
        board.push();
      }
      const runsOf = { started: starts, startedBuilds: buildStarts };
      // Each thread a start opened this board run or the record holds, which an available read may lack.
      const missing = currentItems.flatMap((item) => {
        if (!Array.isArray(item.threads)) return [];
        const shown = item.threads;
        const ids = new Map<string, StartRecord>();
        for (const record of ['started', 'startedBuilds'] as const) {
          const run = runsOf[record].get(item.id);
          const threadId = run && finishedStarts.get(run);
          if (threadId) ids.set(threadId, record);
        }
        for (const { threadId, purpose } of recordedThreads(item.id)) {
          if (!ids.has(threadId) && !deleted.has(threadId)) ids.set(threadId, purpose === PURPOSES.startedBuilds ? 'startedBuilds' : 'started');
        }
        return [...ids].map(([threadId, record]) => ({ item, threadId, record, shown: shown.some((thread) => thread.id === threadId) }));
      });
      const clearWarning = (id: string) => {
        const failures = { ...board.snapshot().startCheckFailures };
        if (!(id in failures)) return;
        delete failures[id];
        board.update({ startCheckFailures: failures });
        board.push();
      };
      await Promise.all([...missing.map(async ({ item, threadId, record, shown }) => {
        const id = item.id;
        if (shown) return clearWarning(id);
        const previous = checks.get(threadId);
        if (previous?.pending || (previous && Date.now() < previous.retryAt)) return;
        checks.set(threadId, { pending: true, retryAt: Infinity });
        let answer: Awaited<ReturnType<typeof lookupThread>>;
        // A deletion the record holds needs no lookup, which could only raise a warning while the CLI is unavailable.
        try { answer = recordedThreads(id).some(thread => thread.threadId === threadId && thread.deletedAt) ? 'deleted' : await showThread(threadId); }
        catch { answer = 'unknown'; }
        checks.set(threadId, { pending: false, retryAt: answer === 'unknown' ? Date.now() + 30_000 : Infinity });
        if (!board.find(id)) return;
        const failures = { ...board.snapshot().startCheckFailures };
        if (answer === 'unknown') failures[id] = item.title;
        else delete failures[id];
        if (answer === 'deleted') {
          if (records?.threads(id).some(thread => thread.threadId === threadId && !thread.deletedAt)) {
            write(id, revision => records.confirmThreadDeleted(id, revision, threadId));
          }
          deleted.add(threadId);
          const runs = runsOf[record];
          const run = runs.get(id);
          if (run && finishedStarts.get(run) === threadId) {
            runs.delete(id);
            finishedStarts.delete(run);
          }
          if (record === 'startedBuilds') retryBuilds.add(id);
          if (board.snapshot()[record]?.[id]?.threadId === threadId) {
            const shownStarts = { ...board.snapshot()[record] };
            delete shownStarts[id];
            board.update({ [record]: shownStarts });
          }
        }
        board.update({ startCheckFailures: failures });
        board.push();
      }), ...currentItems.map((item) => settleIntents(item))]);
    },
    async queue(itemId) {
      const item = board.find(itemId);
      if (!item || item.recorded !== false) return move(itemId, QUEUE);
      if (!records) return withBoard(409, {error: 'The board has no work records to queue.'});
      try {
        const ticket = await items.readTicket(item.repo, item.number);
        if (!ticket) return withBoard(404, {error: 'This issue is no longer open.'});
        const {record} = await importPickedTicket(records, item.repo, ticket);
        reread();
        const result = move(record.workId, QUEUE);
        return {...result, body: {...result.body, itemId: record.workId, item: board.find(record.workId) ?? null}};
      } catch (error) { return withBoard(502, {error:(error as Error).message}); }
    },
    backToList: (itemId) => move(itemId, BACK_TO_LIST),

    async changeKind(itemId, kind) {
      const refused = (status: number, error: string) => ({ status, body: { error }, labelChanges: [], ticketType: null });
      if (!SWAP_KINDS.includes(kind as SwapKind)) return refused(422, 'Choose Bug, Feature or Improvement.');
      const item = board.find(itemId);
      if (!item) return refused(404, GONE);
      if (!kindCanChange(item.kind)) return refused(422, 'Only an ordinary item can change kind here.');
      if (!records) return refused(409, 'The board has no work records.');
      try {
        let workId = itemId;
        if (item.recorded === false) {
          const ticket = await items.readTicket(item.repo, item.number);
          if (!ticket) return refused(404, 'This issue is no longer open.');
          workId = (await importPickedTicket(records, item.repo, ticket)).record.workId;
          reread();
        }
        const setup = board.snapshot().repos.find((r) => sameRepo(r.repo, item.repo))?.setup;
        const { line, error, labelChanges, ticketType } = await changeKind(records, workId, records.read(workId).revision, kind as SwapKind, { setup, ...kindTracker?.(item.repo) });
        reread();
        return { status: error ? 502 : 200, body: { error, line, itemId: workId }, labelChanges, ticketType };
      } catch (error) {
        reread();
        return refused(error instanceof WorkRecordError ? 409 : 502, (error as Error).message);
      }
    },

    answerKind(itemId, answer, ticketKind) {
      const item = board.find(itemId);
      if (!item) return withBoard(404, { error: GONE });
      const disagreement = item.kindDisagreement;
      if (!records || !disagreement || disagreement.ticketKind !== ticketKind) return withBoard(409, { error: "The kinds changed. Check the updated item." });
      try {
        const { revision } = records.read(itemId);
        if (answer === 'keep') records.recordKindAnswer(itemId, revision, { answer: 'keep', ticketKind: disagreement.ticketKind });
        else if (answer === 'update-item' && disagreement.ticketKind) records.update(itemId, revision, { kind: disagreement.ticketKind, agreedTicketKind: disagreement.ticketKind });
        else return withBoard(422, { error: 'Choose keep or update-item.' });
      } catch (error) {
        reread();
        return withBoard(error instanceof WorkRecordError ? 409 : 502, { error: (error as Error).message });
      }
      reread();
      return withBoard(200, { error: null });
    },

    dismissStartError(itemId, purpose) {
      if (!isStartPurpose(purpose)) return withBoard(422, { error: 'Name the start to dismiss.' });
      clearFailure(itemId, purpose);
      pushStarts();
      return withBoard(200, { error: null });
    },

    start: (itemId, model, quiet = false) => press('started', itemId, quiet, () => startOnce(starts, 'started', itemId, model, (item, choice) => {
      const held = records && item.status === 'Shaping' ? heldThread(item, PURPOSES.started) : null;
      if (held && records?.launchIntents({ workId: item.id }).some(intent => intent.purpose === 'shape' && intent.threadId === held.threadId))
        return withBoard(200, { thread: held, error: null });
      if (item.status !== 'Queued' && !canResumeShaping(item)) return reply(409, { error: `Only Queued items or stopped shaping sessions can be started; this one is in ${item.status}.` });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy });
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      const repo = item.repo;
      return async () => {
        const repoProject = await projectOf(repo);
        if (repoProject.error !== undefined) return { thread: null, error: repoProject.error, refused: true };
        if (item.status === 'Shaping' && (!canResumeShaping(board.find(item.id) ?? item) || records && records.read(item.id).status !== 'Shaping')) {
          reread();
          return { thread: null, error: 'Shaping changed while the thread was starting. Check the updated item.', refused: true };
        }
        // The title can change while the project is read, so the thread is named from the record as it stands now.
        if (records) reread();
        const current = board.find(item.id) ?? item;
        const message = workMessage(current, factoryContext);
        return launch(current, 'started', repoProject.projectId, message, () => startIn(repoProject.projectId, message, choice));
      };
    })),

    async inspectOwnedCleanup(itemId) {
      const item = board.find(itemId);
      if (!item) return withBoard(404, { error: GONE });
      try {
        const { plans } = await ownedCleanup(item);
        const token = randomUUID();
        pruneCleanupTokens(itemId);
        cleanupTokens.set(token, { itemId, plans, expiresAt: Date.now() + 10 * 60_000 });
        return withBoard(200, { plans, token });
      } catch (error) { return withBoard(409, { error: (error as Error).message }); }
    },
    async executeOwnedCleanup(itemId, input) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) return withBoard(422, { error: 'Invalid cleanup options.' });
      const options = input as Record<string, unknown>;
      if (Object.keys(options).some(key => !['local', 'remote', 'confirmedLoss', 'token'].includes(key)) || ['local', 'remote', 'confirmedLoss'].some(key => options[key] !== undefined && typeof options[key] !== 'boolean') || typeof options.token !== 'string') return withBoard(422, { error: 'Invalid cleanup options.' });
      pruneCleanupTokens();
      const saved = cleanupTokens.get(options.token);
      if (!saved || saved.itemId !== itemId || cleaning.has(itemId)) return withBoard(409, { error: 'Inspect cleanup again.' });
      const item = board.find(itemId);
      if (!item) return withBoard(404, { error: GONE });
      cleaning.add(itemId);
      try {
        const { checkout, plans, unsaved } = await ownedCleanup(item);
        if (JSON.stringify(plans) !== JSON.stringify(saved.plans)) throw new Error('Cleanup changed. Inspect and confirm again.');
        if (options.local && plans.some(plan => plan.dirtyFiles.length || plan.unpushedCommits.length) && options.confirmedLoss !== true) throw new Error('Confirm loss of dirty files and unpushed commits.');
        if (options.remote && plans.some(plan => plan.remoteBranch && !plan.remoteAvailable)) throw new Error('Remote cleanup is unavailable.');
        cleanupTokens.delete(options.token);
        // captureCleanup lists a branch before its slices, as the plan does, so the plans stay comparable after it.
        if (unsaved && item.kind === 'build' && (options.local || options.remote)) write(itemId, revision => records!.captureCleanup(itemId, revision, unsaved.branch, unsaved.sliceBranches));
        const errors: string[] = [];
        const remainingBranches: string[] = [];
        for (const plan of plans) {
          const fresh = (await ownedCleanup(item, plan.branch)).plans.find(candidate => candidate.branch === plan.branch);
          if (!fresh) throw new Error('Cleanup ownership changed.');
          const result = await executeCleanup({ plan: fresh, expectedPlan: plan, checkout, repository: item.repo, local: options.local === true, remote: options.remote === true && plan.remoteAvailable, confirmedLoss: options.confirmedLoss === true });
          errors.push(...result.errors);
          remainingBranches.push(...result.remainingBranches);
          if (!result.remainingBranches.includes(plan.branch) && !result.errors.length) write(itemId, revision => records!.resolveCleanup(itemId, revision, [plan.branch]));
        }
        return withBoard(200, { errors, remainingBranches, message: remainingBranches.length ? 'Unticked or failed cleanup targets remain for you to remove.' : 'Cleanup complete.' });
      } catch (error) { return withBoard(409, { error: (error as Error).message }); }
      finally { cleaning.delete(itemId); }
    },

    async inspectRecovery(itemId) {
      const item = board.find(itemId);
      if (!item) return withBoard(404, { error: GONE });
      if (!eligibleRecovery(item)) return withBoard(409, { error: 'This work offers no Start again.' });
      try {
        const inspection = await recoveryInspection(item);
        return withBoard(200, { inspection, choices: inspection.pr === 'open' ? ['continue'] : inspection.branchExists ? ['continue', 'new'] : ['new'] });
      } catch (error) { return withBoard(502, { error: (error as Error).message }); }
    },

    async startAgain(itemId, model, options) {
      if (!options || typeof options !== 'object' || Array.isArray(options)) return withBoard(422, { error: 'Choose recovery options.' });
      const { branchChoice, confirmedOpenPr } = options as Record<string, unknown>;
      if (branchChoice !== undefined && branchChoice !== 'continue' && branchChoice !== 'new' || confirmedOpenPr !== undefined && typeof confirmedOpenPr !== 'boolean') return withBoard(422, { error: 'Invalid recovery options.' });
      const current = board.find(itemId);
      const build = !!current && recoversBuild(current);
      return startOnce(build ? buildStarts : starts, build ? 'startedBuilds' : 'started', itemId, model, (item, choice) => {
        if (!current || !eligibleRecovery(item)) return withBoard(409, { error: 'This work offers no Start again.' });
        const blocked = blockedReply(item);
        if (blocked) return blocked;
        return async () => {
          try {
            const project = await projectOf(item.repo);
            if (project.error !== undefined) return { thread: null, error: project.error, refused: true };
            if (!eligibleRecovery(board.find(itemId) ?? item)) return { thread: null, error: 'Recovery changed. Refresh the item.', refused: true };
            if (!build) return launch(item, 'started', project.projectId, workMessage(item, factoryContext), () => startIn(project.projectId, workMessage(item, factoryContext), choice), undefined, true);
            const inspection = await recoveryInspection(item);
            if (inspection.pr === 'open' && (branchChoice !== 'continue' || confirmedOpenPr !== true)) return { thread: null, error: 'Confirm continuing on the open PR branch.', refused: true };
            if (inspection.branchExists && branchChoice === undefined) return { thread: null, error: 'Choose continue or new branch.', refused: true };
            const continuing = inspection.branchExists && branchChoice === 'continue';
            if (inspection.pr === 'open' && !continuing) return { thread: null, error: 'The open PR branch is unavailable.', refused: true };
            const accessProblem = (['push-branch', 'open-pr'] as const).map(operation => writeAccessProblem(item.repo, operation, buildAccessOf(item.repo))).find(Boolean);
            if (accessProblem) return { thread: null, error: accessProblem, refused: true };
            if (continuing && inspection.worktreePath && !choice) return { thread: null, error: 'Choose a model before continuing in an existing worktree.', refused: true };
            const skills = await checkSkills?.();
            if (skills?.refusal) return { thread: null, error: skills.refusal, refused: true };
            const base = await baseOf(item.repo);
            const branch = continuing ? inspection.branch : buildBranch(item) + '-recovery-' + randomUUID().slice(0, 8);
            const message = buildMessage(!continuing ? { ...item, slices: [] } : item, larBuild(), factoryContext);
            const workspace = continuing && inspection.worktreePath
              ? { type: 'existing_worktree' as const, worktreePath: inspection.worktreePath, branch, origin: String(readJsonRecord(serverRuntimePath(process.env))?.origin ?? ''), commandId: randomUUID() }
              : { base: continuing ? branch : base, branch };
            const cleanupBranches = continuing ? [] : await cleanupSliceBranches(item);
            const result = await launch(item, 'startedBuilds', project.projectId, message, () => startIn(project.projectId, message, choice, workspace), () => {
              if (!continuing) {
                write(itemId, revision => records!.captureCleanup(itemId, revision, inspection.branch, cleanupBranches));
              }
            }, true, { branch, reset: !continuing, message });
            return { ...result, warning: inspection.warning, message: continuing && !inspection.worktreePath ? 'The old worktree is gone. Created a new worktree on its branch.' : undefined };
          } catch (error) { return { thread: null, error: (error as Error).message }; }
        };
      });
    },

    startBuild: (itemId, model, drift, quiet = false) => press('startedBuilds', itemId, quiet, () => startOnce(buildStarts, 'startedBuilds', itemId, model, (item, choice) => {
      if (drift !== undefined && !isDriftChoice(drift)) return reply(422, { error: 'Choose Replace and start or Start anyway.' });
      // A press that crossed the start's move answers with the thread it opened.
      const held = records && item.status === 'In progress' ? heldThread(item, PURPOSES.startedBuilds) : null;
      if (held && records?.launchIntents({ workId: item.id }).some(intent => intent.purpose === PURPOSES.startedBuilds && intent.threadId === held.threadId)) return withBoard(200, { thread: held, error: null });
      if (item.status !== 'Ready' && !canRetryBuild(item)) return reply(409, { error: `Only Ready items can start a build; this one is in ${item.status}.` });
      let accessProblem: string | null;
      try { accessProblem = (['push-branch', 'open-pr'] as const).map(operation => writeAccessProblem(item.repo, operation, buildAccessOf(item.repo))).find(problem => problem !== null) ?? null; }
      catch { accessProblem = 'Could not read repository access. Recheck it in Settings.'; }
      if (accessProblem) return withBoard(403, { error: accessProblem, hold: true });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy, hold: true });
      if (isOnboarding(board.snapshot(), item.repo)) return withBoard(409, { error: WAITS_FOR_ONBOARDING, hold: true });
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      // While T3 can't be read the launch reports any problem, so a retained observation refuses nothing.
      if (Array.isArray(item.threads) && item.threads.some((t) => t.purpose === PURPOSES.started && !t.observedAt && isLiveThread(t))) return withBoard(409, { error: LIVE_SHAPING, hold: true });
      const previous = board.snapshot().startedBuilds?.[itemId];
      const retry = retryBuilds.has(itemId) || previous && Array.isArray(item.threads) && item.threads.some((t) => t.id === previous.threadId && t.state === 'stopped')
        || recordedThreads(itemId).some((t) => t.purpose === PURPOSES.startedBuilds) || prClosed(itemId);
      const branch = `${buildBranch(item)}${retry ? `-retry-${randomUUID().slice(0, 8)}` : ''}`;
      const { repo } = item;
      return async () => {
        if (records) { await refreshSpecs(records, { workId: item.id }); reread(); }
        // A refusal comes before any write, so a build that can't start changes nothing on GitHub.
        const skills = await checkSkills?.(drift);
        if (skills?.refusal) return { thread: null, error: skills.refusal, refused: true, hold: true, ...skills.drift && { drift: skills.drift } };
        const repoProject = await projectOf(repo);
        if (repoProject.error !== undefined) return { thread: null, error: repoProject.error, refused: true, hold: true };
        let base: string;
        try { base = await baseOf(repo); }
        catch { return { thread: null, error: 'Could not read the repository’s default branch. Retry after checking access.', refused: true, hold: true }; }
        const error = parentInProgress(item);
        if (error) return { thread: null, error };
        // A build snapshots its skills once, so a retry keeps the selection its first start saw.
        const snapshot = () => {
          if (records!.read(item.id).skills === null) write(item.id, (revision) => records!.snapshotSkills(item.id, revision, skillsOf(repo)));
        };
        // Refreshing the Spec can change the title, so use the current record.
        const current = board.find(item.id) ?? item;
        const message = buildMessage(current, larBuild(), factoryContext);
        return launch(current, 'startedBuilds', repoProject.projectId, message, () => startIn(repoProject.projectId, message, choice, { base, branch }), () => {
          snapshot();
          if (records) write(item.id, revision => records.setBuildBranch(item.id, revision, branch));
        });
      };
    })),

    async abandon(itemId) {
      const item = board.find(itemId);
      // A second press after Abandon finished has nothing left to do.
      if (!item && board.removed(itemId)) return withBoard(200, { error: null });
      if (!item) return withBoard(404, { error: GONE });
      // Needs you offers setting work aside whatever its Status and threads, as after its PR closed unmerged.
      const offered = item.needsYou?.offers.includes('set-aside');
      if (!canAbandon(item) && !offered) return reply(409, { error: `Only List and Queued items can be abandoned; this one is in ${item.status}.` });
      const busy = combined.has(itemId) || abandoning.has(itemId) ? "Abandon is running. Wait for it to finish." : offered ? null : busyReason(itemId, 'abandon');
      if (busy) return withBoard(409, { error: busy });
      return track(abandoning, itemId, Promise.resolve().then(async () => {
        if (records) {
          try {
            const current = item.recorded === false ? await abandonmentRecord(item) : null;
            if (current && current.status !== item.status) throw new Error('The work changed status while its ticket was read. Check the updated work.');
            records.setAside(current?.workId ?? item.id, current?.revision ?? item.revision);
          }
          catch (err) {
            reread();
            return withBoard(409, { error: (err as Error).message });
          }
        }
        abandonmentTickets.delete(itemId);
        board.remove(itemId);
        reread();
        return withBoard(200, { error: null });
      }));
    },

    abandonAndClose(itemId) {
      const pending = combined.get(itemId);
      if (pending) return pending;
      const item = board.find(itemId);
      if (!item && (board.removed(itemId) || archive().some(i => i.id === itemId && i.archived?.setAside))) return Promise.resolve(withBoard(200, { error: null }));
      if (!item) return Promise.resolve(withBoard(404, { error: GONE }));
      const offered = item.needsYou?.offers.includes('set-aside');
      const busy = abandoning.has(itemId) ? 'Abandon is running. Wait for it to finish.' : offered ? null : busyReason(itemId, 'abandon');
      if ((!canAbandon(item) && !offered) || busy || !item.number || item.abandonRefusal) return Promise.resolve(withBoard(409, { error: busy ?? item.abandonRefusal ?? 'This work cannot be abandoned with ticket closure.' }));
      if (offered && !item.needsYou!.ticketOpen) return Promise.resolve(withBoard(409, { error: "The board doesn't see this work's ticket open, so it closes nothing. Press Abandon to set the work aside." }));
      return track(combined, itemId, Promise.resolve().then(async () => {
        try {
          if (records && item.recorded === false && !abandonmentTickets.has(item.id)) {
            const ticket = await items.readTicket(item.repo, item.number);
            if (!ticket) return withBoard(502, { error: 'Could not read the ticket before abandonment. Try again.' });
            abandonmentTickets.set(item.id, ticket);
          }
          const observation = await items.observeTicket(item.repo, item.number);
          if (observation.state !== 'closed' || observation.abandonmentComplete === false) {
            if (observation.state !== 'open' && observation.state !== 'closed') return withBoard(502, { error: 'Could not establish the ticket state. Try again to reconcile before abandoning.' });
            const error = await items.abandon(item);
            if (error) return withBoard(502, { error });
          }
          try {
            if (records) {
              const current = item.recorded === false ? await abandonmentRecord(item) : records.read(item.id);
              if (current.status !== item.status) throw new Error('The work changed status while its ticket closed. Check the updated work.');
              records.setAside(current.workId, current.revision);
            }
          } catch (error) {
            reread();
            return withBoard(409, { error: `The ticket is closed, but the work remains on the board. Try again to finish abandonment. ${(error as Error).message}` });
          }
          abandonmentTickets.delete(itemId);
          board.remove(itemId);
          reread();
          return withBoard(200, { error: null });
        } catch (error) { return withBoard(502, { error: (error as Error).message }); }
      }));
    },

    async closeTicket(itemId) {
      const kept = closing.get(itemId);
      if (kept) {
        const error = await kept;
        return withBoard(error ? 502 : 200, { error });
      }
      const item = archive().find((shown) => shown.id === itemId);
      if (!item?.archived?.setAside) return withBoard(409, { error: "That work isn't set aside, so the board closes no ticket. Abandon it first." });
      if (!item.number) return withBoard(409, { error: 'That work has no ticket to close.' });
      if (item.abandonRefusal) return withBoard(409, { error: item.abandonRefusal });
      if (!item.archived.ticketOpen) return withBoard(409, { error: "The board doesn't see that work's ticket open, so it closes nothing. Check it in its provider." });
      const error = await track(closing, itemId, items.abandon(item), (failed) => failed === null);
      return withBoard(error ? 502 : 200, { error });
    },

    async restore(itemId) {
      if (!records) return withBoard(409, { error: 'The board has no work records to change.' });
      if (!archive().some((shown) => shown.id === itemId && shown.archived?.setAside)) {
        return withBoard(409, { error: "That work isn't set aside in Archive, so there is nothing to restore." });
      }
      let restored: WorkRecord;
      try { restored = write(itemId, (revision) => records.restore(itemId, revision)); }
      catch (err) { return withBoard(409, { error: (err as Error).message }); }
      try { await observeWork(records, restored, { ticket: (repo, number) => items.observeTicket(repo, number), pr: readPr }, reread); }
      catch (err) { log(`can't recheck ${itemId} after its restore: ${(err as Error).message}`); }
      return withBoard(200, { error: null });
    },

    async resolveNeedsYou(itemId, choice, briefChoice) {
      const item = board.find(itemId);
      if (!item) return reply(404, { error: GONE });
      if (!records) return withBoard(409, { error: 'The board has no work records to change.' });
      if (!item.needsYou) return withBoard(409, { error: "That work doesn't need you." });
      if (item.needsYou.deletedThread) {
        if (choice !== 'back-to-queue' && choice !== 'back-to-list') return withBoard(409, { error: 'Choose a move offered for this work.' });
        if (!item.needsYou.offers.includes(choice) || !Array.isArray(item.threads) || item.threads.some(t => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren)) return withBoard(409, { error: 'This work cannot move while a thread or PR is open.' });
        if (briefChoice !== undefined && briefChoice !== 'keep' && briefChoice !== 'reshape') return withBoard(422, { error: 'Choose keep passing or reshape.' });
        if (records.gate(itemId).current && briefChoice === undefined) return withBoard(422, { error: 'Choose keep passing or reshape.' });
        try {
          const inspection = await recoveryInspection(item);
          if (inspection.pr === 'open') return withBoard(409, { error: 'An open PR requires Start again.' });
          if (briefChoice === 'reshape') write(itemId, revision => records.invalidateGate(itemId, revision));
          const cleanupBranches = item.kind === 'build' ? await cleanupSliceBranches(item) : [];
          if (item.kind === 'build') write(itemId, revision => records.captureCleanup(itemId, revision, inspection.branch, cleanupBranches));
          if (item.kind === 'build') write(itemId, revision => records.resetBuild(itemId, revision));
          removeCauses(item, { status: choice === 'back-to-queue' ? 'Queued' : 'List' });
          starts.delete(itemId);
          buildStarts.delete(itemId);
          clearFailures(itemId);
          pushStarts();
        } catch (error) { return withBoard(409, { error: (error as Error).message }); }
        return withBoard(200, { error: null });
      }
      const offered = choice !== 'set-aside' && choice !== 'start-again' && item.needsYou.offers.some((offer) => offer === choice);
      if (!offered) return withBoard(409, { error: 'Pick one of the choices the board offers for this work.' });
      try {
        if (choice === 'reopen-pr') {
          const pullRequest = records.read(itemId).pullRequest!;
          await reopenPr(item.repo, Number(pullRequest.slice(pullRequest.lastIndexOf('#') + 1)));
        }
        removeCauses(item, { ...choice === 'replace-pr' && { status: 'Ready' }, clearReason: choice === 'mark-handled' });
      } catch (err) {
        reread();
        return withBoard(err instanceof WorkRecordError ? 409 : 502, { error: (err as Error).message });
      }
      return withBoard(200, { error: null });
    },

    markDependencyMet(itemId, dependencyId, revision, met) {
      const item = board.find(itemId);
      if (!item) return reply(404, { error: GONE });
      if (!records) return withBoard(409, { error: 'The board has no work records to change.' });
      if (!item.blockers.some((b) => b.dependency?.dependencyId === dependencyId)) return withBoard(409, { error: "That Dependency doesn't hold this work." });
      if (typeof met !== 'boolean') return withBoard(400, { error: 'Say whether the Dependency is met.' });
      let refused: Error | null = null;
      try {
        if (met) records.markDependencyMet(dependencyId as string, revision as number, userInfo().username);
        else records.clearDependencyMet(dependencyId as string, revision as number);
      } catch (err) {
        refused = err as Error;
      }
      reread();
      return refused ? withBoard(refused instanceof WorkRecordError ? 409 : 500, { error: refused.message }) : withBoard(200, { error: null });
    },
  };
}
