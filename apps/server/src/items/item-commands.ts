// The commands the board's buttons send: queue, back to List, start, start build, abandon, close an
// abandoned item's ticket, restore set-aside work and act on Needs you.
// Every Status move writes the item's work record, naming the revision the board read, and never its ticket. The maps of
// commands in flight are private here, so every rule about which command blocks which lives in this file.

import { refreshSpecs } from '@lar-factory/work-records/spec-sync';
import { join } from 'node:path';
import { userInfo } from 'node:os';
import { randomUUID } from 'node:crypto';
import { WAITS_FOR_ONBOARDING, blockedText, writeAccessProblem, buildBranch, buildMessage, canAbandon, canResumeShaping, earlierBuildMessage, earlierWorkMessage, isDriftChoice, isOnboarding, sameRepo, workMessage } from '@lar-factory/shared';
import type { BoardData, DriftChoice, FactoryThreadContext, Item, ModelChoice, ModelGroup, OperationAccess, SkillCheckOutcome, StartedThread, StartResult, Status } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { WorkRecordError, type LaunchIntent, type WorkRecords } from '@lar-factory/work-records';
import { assertAzureThreadAllowed } from '@lar-factory/shared/azure-safety';
import type { BoardState } from '../board/board-state.ts';
import { prHost, prUrl } from '../config/pr-host.ts';
import { readRepositoryList } from '../config/repository-config.ts';
import { readRepositorySetups } from '../config/repository-settings.ts';
import { installHome } from '../skills/bundled-skills.ts';
import { readJsonRecord } from '../json-file.ts';
import { serverRuntimePath } from '../t3/t3-settings.ts';
import { runTool } from '../tools/run-tool.ts';
import { inspectWorkRecovery } from './work-recovery.ts';
import { checkouts, repositoryProject } from '../t3/repository-project.ts';
import type { RepositoryProject } from '../t3/repository-project.ts';
import { findModelChoice } from '../t3/model-choices.ts';
import { protocolStartedThread } from '../t3/item-execution.ts';
import { findStartedThread, lookupThread, startThread } from '../t3/t3.ts';
import type { ItemSource } from './item-source.ts';
import { importPickedTicket } from './import-ticket.ts';

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
   * before starting again.
   */
  start(itemId: string, model: unknown): Promise<Reply>;
  /**
   * Starts a Ready build's thread in a new worktree, or retries a confirmed stopped or deleted one, once nothing open
   * blocks it, as lar-shape's step 5 does after Go: it moves a parent record that isn't a build to In progress first,
   * and snapshots the repository's selected project skills on the record. Launch intents guard it as they guard Start.
   * Drift refuses it with the skills that changed until `drift` carries the User's DriftChoice.
   */
  inspectRecovery(itemId: string): Promise<Reply>;
  startAgain(itemId: string, model: unknown, options: unknown): Promise<Reply>;
  startBuild(itemId: string, model: unknown, drift?: unknown): Promise<Reply>;
  /**
   * Sets List or Queued work aside on this Mac, or work whose Needs you offers it, and leaves its ticket as it is.
   * Archive offers closeTicket separately. The combined action closes before setting work aside.
   */
  abandon(itemId: string): Reply;
  abandonAndClose(itemId: string): Promise<Reply>;
  /**
   * Closes the open ticket of set-aside work in Archive: as not planned on GitHub, to Removed on Azure DevOps. A close
   * that succeeded answers a second press without closing again.
   */
  closeTicket(itemId: string): Promise<Reply>;
  /** Brings set-aside work in Archive back to the board in the Status it had, unless retention hides it as finished. */
  restore(itemId: string): Reply;
  /**
   * Acts on work that needs you as `choice` says, then clears its reason: `clear` alone, or one of its offers. Reopening
   * the PR reopens it in its provider, a replacement build moves the work to Ready for Start build, and reopening the
   * work moves it to List. Setting it aside is Abandon.
   */
  resolveNeedsYou(itemId: string, choice: unknown, briefChoice?: unknown): Promise<Reply>;
  /**
   * Marks a Dependency holding the item met, as the user decided, or clears the mark when `met` is false. `revision` is
   * the Dependency's as the board showed it, so a change since then refuses the write.
   */
  markDependencyMet(itemId: string, dependencyId: unknown, revision: unknown, met: unknown): Reply;
}

export interface ItemCommandsDeps {
  /** Exact installation/data handoff. Null is reserved for deterministic protocol tests. */
  inspectWorkRecovery?: typeof inspectWorkRecovery;
  checkoutOf?: (projectId: string) => Promise<string>;
  factoryContext?: FactoryThreadContext | null;
  board: BoardState;
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
  /** The project skills selected for the repository as builds start now; tests stand in for the local settings. */
  skillsOf?: (repo: string) => readonly string[];
  /** Reopens the repository's PR `number`; tests stand in for gh and az. */
  reopenPr?: (repo: string, number: number) => Promise<void>;
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
const NO_THREAD = "The board asked T3 for a thread, but T3 shows no thread for it. Check the repository's project in T3 Code, then clear Needs you to start again.";

export function createItemCommands({ inspectWorkRecovery: inspect = inspectWorkRecovery,
  checkoutOf = async projectId => {
    const checkout = (await checkouts(process.env)).find(p => p.id === projectId);
    if (!checkout) throw new Error('Cannot find the repository checkout.');
    return checkout.folder;
  }, board, items, records, reread, archive, offerModelChoices, checkSkills, projectOf = currentRepositoryProject,
  baseOf = async (repo) => (await prHost(repo).defaultBranchHead(repo)).branch,
  buildAccessOf = (repo) => readRepositorySetups().find(setup => sameRepo(setup.repo, repo))?.access ?? {},
  showThread = lookupThread, startThread: startIn = startThread, recoverThread = recoverStartedThread, skillsOf = selectedSkills, factoryContext = currentFactoryContext(),
  reopenPr = (repo, number) => prHost(repo).reopenPr(prUrl(repo, number)) }: ItemCommandsDeps): ItemCommands {
  const retryBuilds = new Set<string>();
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
  /** Ticket closes by item id: one in flight, so a second press waits for it, or one that succeeded, kept. */
  const combined = new Map<string, Promise<Reply>>();
  const closing = new Map<string, Promise<string | null>>();

  const reply = (status: number, body: object): Reply => ({ status, body });
  const withBoard = (status: number, body: object): Reply => reply(status, { ...body, board: board.snapshot() });

  /** Why a command in flight on the item, or a Start this board run, blocks this action; null when nothing does. */
  function busyReason(itemId: string, action: Action): string | null {
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
      // Keep a started or unconfirmed thread; only a confirmed stop or a failure reported by t3 allows retry.
      pending = track(runs, itemId, Promise.resolve().then(work).then((result) => {
        settled.add(pending!);
        if (result.thread) finishedStarts.set(pending!, result.thread.threadId);
        if (result.thread) board.update({ [record]: { ...board.snapshot()[record], [itemId]: result.thread } } satisfies Partial<BoardData>);
        board.push();
        return result;
      }), (result) => !!result.thread || !!result.uncertain);
    }
    const { refused, ...result } = await pending;
    return withBoard(refused ? 409 : result.error ? 502 : 200, result);
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
      try { found = await recoverThread(projectId, messages, known); } catch { found = 'unknown'; }
      if (typeof found === 'object') {
        write(item.id, (revision) => records!.resolveLaunchIntent(item.id, revision, intent.intentId, { threadId: found.threadId }));
        return { thread: found, error: null };
      }
      if (found === 'absent' && Date.now() - Date.parse(intent.requestedAt) >= SHOW_GRACE_MS) {
        write(item.id, (revision) => records!.resolveLaunchIntent(item.id, revision, intent.intentId, { failure: NO_THREAD }));
        write(item.id, (revision) => records!.setNeedsYou(item.id, revision, NO_THREAD));
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

  /**
   * Starts the item's thread for `record` through `ask`, guarded by its work record: a held or unresolved start answers
   * for it, Needs you and a paused setup refuse it, and a launch intent is on the record before `ask` runs. Without records, `ask` alone.
   */
  async function launch(item: Item, record: StartRecord, projectId: string, message: string, ask: () => Promise<StartResult>,
    prepare: () => void = () => {}, recovery = false): Promise<Start> {
    if (!records) return ask();
    const purpose = PURPOSES[record];
    const unresolved = records.launchIntents({ workId: item.id, unresolved: true }).find((intent) => intent.purpose === purpose);
    if (unresolved) return settle(item, unresolved, projectId);
    const needsYou = records.read(item.id).needsYou;
    if (needsYou && !recovery) return { thread: null, error: `Needs you: ${needsYou}`, refused: true };
    // A build whose PR closed unmerged starts a replacement, so the thread that opened that PR holds no start.
    const held = recovery ? null : record === 'startedBuilds' && prClosed(item.id) ? null : heldThread(board.find(item.id) ?? item, purpose);
    const shown = board.snapshot()[record]?.[item.id];
    if (held) return { thread: shown?.threadId === held.threadId ? shown : held, error: null };
    prepare();
    const { intent } = write(item.id, (revision) => records.recordLaunchIntent(item.id, revision, purpose));
    asking.add(intent.intentId);
    const result = await ask().finally(() => asking.delete(intent.intentId));
    const outcome = result.thread ? { threadId: result.thread.threadId } : !result.uncertain ? { failure: result.error ?? 'T3 started no thread.' } : null;
    // An outcome the record refuses leaves the intent unresolved, for a refresh to settle through T3.
    if (outcome) try { write(item.id, (revision) => records.resolveLaunchIntent(item.id, revision, intent.intentId, outcome)); } catch { /* settled later */ }
    if (recovery && result.thread && records.read(item.id).needsYou) write(item.id, revision => records.clearNeedsYou(item.id, revision));
    return result;
  }

  function eligibleRecovery(item: Item): boolean {
    return !!records && !!item.needsYou?.deletedThread && item.needsYou.offers.includes('start-again')
      && Array.isArray(item.threads) && !item.threads.some(t => t.state === 'running' || t.state === 'needs you' || t.hasLiveChildren);
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
        try { answer = await showThread(threadId); } catch { answer = 'unknown'; }
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

    start: (itemId, model) => startOnce(starts, 'started', itemId, model, (item, choice) => {
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
    }),

    async inspectRecovery(itemId) {
      const item = board.find(itemId);
      if (!item) return withBoard(404, { error: GONE });
      if (!eligibleRecovery(item)) return withBoard(409, { error: 'This work has no eligible deleted thread.' });
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
      const build = recordedThreads(itemId).at(-1)?.purpose === 'build';
      return startOnce(build ? buildStarts : starts, build ? 'startedBuilds' : 'started', itemId, model, (item, choice) => {
        if (!current || !eligibleRecovery(item)) return withBoard(409, { error: 'This work has no eligible deleted thread.' });
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
                write(itemId, revision => records!.resetBuild(itemId, revision));
              }
              write(itemId, revision => records!.setBuildBranch(itemId, revision, branch));
            }, true);
            return { ...result, warning: inspection.warning, message: continuing && !inspection.worktreePath ? 'The old worktree is gone. Created a new worktree on its branch.' : undefined };
          } catch (error) { return { thread: null, error: (error as Error).message }; }
        };
      });
    },

    startBuild: (itemId, model, drift) => startOnce(buildStarts, 'startedBuilds', itemId, model, (item, choice) => {
      if (drift !== undefined && !isDriftChoice(drift)) return reply(422, { error: 'Choose Replace and start or Start anyway.' });
      if (item.status !== 'Ready') return reply(409, { error: `Only Ready items can start a build; this one is in ${item.status}.` });
      let accessProblem: string | null;
      try { accessProblem = (['push-branch', 'open-pr'] as const).map(operation => writeAccessProblem(item.repo, operation, buildAccessOf(item.repo))).find(problem => problem !== null) ?? null; }
      catch { accessProblem = 'Could not read repository access. Recheck it in Settings.'; }
      if (accessProblem) return withBoard(403, { error: accessProblem });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy });
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      const previous = board.snapshot().startedBuilds?.[itemId];
      const retry = retryBuilds.has(itemId) || previous && Array.isArray(item.threads) && item.threads.some((t) => t.id === previous.threadId && t.state === 'stopped')
        || recordedThreads(itemId).some((t) => t.purpose === PURPOSES.startedBuilds) || prClosed(itemId);
      const branch = `${buildBranch(item)}${retry ? `-retry-${randomUUID().slice(0, 8)}` : ''}`;
      const { repo } = item;
      return async () => {
        if (records) { await refreshSpecs(records, { workId: item.id }); reread(); }
        // A refusal comes before any write, so a build that can't start changes nothing on GitHub.
        const skills = await checkSkills?.(drift);
        if (skills?.refusal) return { thread: null, error: skills.refusal, refused: true, ...skills.drift && { drift: skills.drift } };
        const repoProject = await projectOf(repo);
        if (repoProject.error !== undefined) return { thread: null, error: repoProject.error, refused: true };
        let base: string;
        try { base = await baseOf(repo); }
        catch { return { thread: null, error: 'Could not read the repository’s default branch. Retry after checking access.', refused: true }; }
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
    }),

    abandon(itemId) {
      const item = board.find(itemId);
      // A second press after Abandon finished has nothing left to do.
      if (!item && board.removed(itemId)) return withBoard(200, { error: null });
      if (!item) return withBoard(404, { error: GONE });
      // Needs you offers setting work aside whatever its Status and threads, as after its PR closed unmerged.
      const offered = item.needsYou?.offers.includes('set-aside');
      if (!canAbandon(item) && !offered) return reply(409, { error: `Only List and Queued items can be abandoned; this one is in ${item.status}.` });
      const busy = combined.has(itemId) ? "Abandon and close ticket is running." : offered ? null : busyReason(itemId, 'abandon');
      if (busy) return withBoard(409, { error: busy });
      if (records) {
        try { records.setAside(item.id, item.revision); }
        catch (err) {
          reread();
          return withBoard(409, { error: (err as Error).message });
        }
      }
      board.remove(itemId);
      reread();
      return withBoard(200, { error: null });
    },

    abandonAndClose(itemId) {
      const pending = combined.get(itemId);
      if (pending) return pending;
      const item = board.find(itemId);
      if (!item && (board.removed(itemId) || archive().some(i => i.id === itemId && i.archived?.setAside))) return Promise.resolve(withBoard(200, { error: null }));
      if (!item) return Promise.resolve(withBoard(404, { error: GONE }));
      const offered = item.needsYou?.offers.includes('set-aside');
      const busy = busyReason(itemId, 'abandon');
      if ((!canAbandon(item) && !offered) || busy || !item.number || item.abandonRefusal) return Promise.resolve(withBoard(409, { error: busy ?? item.abandonRefusal ?? 'This work cannot be abandoned with ticket closure.' }));
      return track(combined, itemId, Promise.resolve().then(async () => {
        try {
          const observation = await items.observeTicket(item.repo, item.number);
          if (observation.state !== 'closed' || observation.abandonmentComplete === false) {
            if (observation.state !== 'open' && observation.state !== 'closed') return withBoard(502, { error: 'Could not establish the ticket state. Try again to reconcile before abandoning.' });
            const error = await items.abandon(item);
            if (error) return withBoard(502, { error });
          }
          try {
            if (records) {
              const current = records.read(item.id);
              if (current.status !== item.status) throw new Error('The work changed status while its ticket closed. Check the updated work.');
              records.setAside(item.id, current.revision);
            }
          } catch (error) {
            reread();
            return withBoard(409, { error: `The ticket is closed, but the work remains on the board. Try again to finish abandonment. ${(error as Error).message}` });
          }
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

    restore(itemId) {
      if (!records) return withBoard(409, { error: 'The board has no work records to change.' });
      if (!archive().some((shown) => shown.id === itemId && shown.archived?.setAside)) {
        return withBoard(409, { error: "That work isn't set aside in Archive, so there is nothing to restore." });
      }
      try { write(itemId, (revision) => records.restore(itemId, revision)); }
      catch (err) { return withBoard(409, { error: (err as Error).message }); }
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
          write(itemId, revision => records.update(itemId, revision, { status: choice === 'back-to-queue' ? 'Queued' : 'List' }));
          starts.delete(itemId);
          buildStarts.delete(itemId);
        } catch (error) { return withBoard(409, { error: (error as Error).message }); }
        return withBoard(200, { error: null });
      }
      const offered = choice === 'clear' || (choice !== 'set-aside' && item.needsYou.offers.some((offer) => offer === choice));
      if (!offered) return withBoard(409, { error: 'Pick one of the choices the board offers for this work.' });
      try {
        if (choice === 'reopen-pr') {
          const pullRequest = records.read(itemId).pullRequest!;
          await reopenPr(item.repo, Number(pullRequest.slice(pullRequest.lastIndexOf('#') + 1)));
        }
        write(itemId, (revision) => records.clearNeedsYou(itemId, revision));
        if (choice === 'replace-pr') write(itemId, (revision) => records.update(itemId, revision, { status: 'Ready' }));
        if (choice === 'reopen-work') write(itemId, (revision) => records.update(itemId, revision, { status: 'List' }));
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
