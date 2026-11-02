import { executionStats } from './execution-stats.ts';
import type { ItemThread, StartedThread } from '@lar-factory/shared';
import { readJsonRecord } from '../json-file.ts';
import { boardProjects } from './board-projects.ts';
import { readArchivedShells, readExecution, subscribeExecutionShell, type ShellRead, type ExecutionRead, type ThreadFamilyRead } from './execution-protocol.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';
import { titledFrom } from './t3.ts';

type Lineage = { parentThreadId?: string; rootThreadId?: string } | undefined;

/** The threads above `id`, through its parents and its root, since T3's shells can leave out a thread between them. */
function ancestorsOf(id: string, lineages: Map<unknown, Lineage>): Set<string> {
  const above = new Set<string>();
  let parent = lineages.get(id)?.parentThreadId;
  while (parent && parent !== id && !above.has(parent)) {
    above.add(parent);
    parent = lineages.get(parent)?.parentThreadId;
  }
  const root = lineages.get(id)?.rootThreadId;
  if (root && root !== id) above.add(root);
  return above;
}

const isSettled = (shell: Record<string, unknown>): boolean => !!shell.settledAt || shell.settledOverride === 'settled';

/** What orders a thread among the item's. Settling moves `updatedAt`, so a settled thread goes by its last run, and with no run known behind every thread with a time. */
const orderedBy = (shell: Record<string, unknown>): string =>
  isSettled(shell) ? String(shell.latestRunCompletedAt ?? shell.latestRunStartedAt ?? shell.latestRunRequestedAt ?? '') : String(shell.updatedAt);

/** Each recorded thread's shell as T3 shows it, by thread ID. A thread T3 removed or deleted is left out. */
export function executionItemThreads(shells: Record<string, unknown>[]) {
  const byId = new Map<string, ItemThread>();
  const lineages = new Map<unknown, Lineage>();
  const order = new Map<string, string>();
  for (const shell of shells) {
    if (typeof shell.id !== 'string' || shell.deletedAt) continue;
    if (typeof shell.updatedAt !== 'string' || !Number.isFinite(Date.parse(shell.updatedAt))) throw Error('Invalid execution timestamp');
    const state: ItemThread['state'] = shell.pendingRuntimeRequest ? 'needs you'
      : ['preparing', 'starting', 'running', 'waiting'].includes(String(shell.status)) ? 'running'
      : ['failed', 'interrupted', 'cancelled'].includes(String(shell.status)) ? 'stopped' : 'done';
    byId.set(shell.id, { id: shell.id, title: typeof shell.title === 'string' ? shell.title : shell.id, state, ...(!shell.pendingRuntimeRequest && shell.status === 'running' ? { currentRunning: true as const } : {}), ...(!shell.pendingRuntimeRequest && shell.status === 'queued' ? { queued: true as const } : {}), ...(shell.archivedAt ? { archived: true as const } : {}), updated: shell.updatedAt });
    lineages.set(shell.id, shell.lineage as Lineage);
    order.set(shell.id, orderedBy(shell));
  }
  for (const thread of byId.values()) {
    if (thread.state !== 'running' && thread.state !== 'needs you' && !thread.queued) continue;
    for (const id of ancestorsOf(thread.id, lineages)) {
      const ancestor = byId.get(id);
      if (!ancestor) continue;
      ancestor.hasLiveChildren = true;
      if (thread.currentRunning) ancestor.hasRunningChildren = true;
    }
  }
  /** The recorded threads T3 shows, newest first by `orderedBy` and archived ones last, since archiving updates a thread; undefined for work with no recorded thread. */
  return (threadIds: readonly string[]): ItemThread[] | undefined => threadIds.length
    ? threadIds.flatMap((id) => byId.get(id) ?? []).sort((a, b) => Number(!!a.archived) - Number(!!b.archived) || order.get(b.id)!.localeCompare(order.get(a.id)!)) : undefined;
}

/** The last lookup the board read while T3 could be read, kept through an outage, and when it read it. */
let lastSeen: { lookup: ReturnType<typeof executionItemThreads>; observedAt: string } | undefined;

/** The archived list T3 last answered, kept through a failed read. */
let lastArchived: Record<string, unknown>[] = [];
/** How long one read of the archived list answers. Refresh runs about every 2 seconds. Any recorded thread missing from the active shells asks for the list, so with one the board reads it every 30 seconds for the server's life. */
const ARCHIVED_READ_MS = 30_000;

let current: { key: string; stop(): void; demand?(shells: Record<string, unknown>[]): void; demandArchived?(): void; archivedCurrent?(): boolean; shell?: ShellRead; lookup?: ReturnType<typeof executionItemThreads>; available: boolean; shells?: Record<string, unknown>[]; shownShells?: Record<string, unknown>[]; shellIds?: Set<unknown>; reads?: Map<string, ExecutionRead>; fingerprints?: Map<string, string>; observedAt?: string } | undefined;
/**
 * The recorded threads as T3 shows them now. While T3 can't be read, each thread's last observation with when the board
 * saw it, or 'unavailable' once one was never seen. Failures never become empty success.
 */
export function protocolItemThreads(threadIds: readonly string[]): ItemThread[] | 'unavailable' | undefined {
  const path = serverRuntimePath(process.env);
  const runtime = readJsonRecord(path);
  if (!t3Running(path) || typeof runtime?.origin !== 'string') {
    current?.stop();
    current = undefined;
    return 'unavailable';
  }
  const key = JSON.stringify([path, runtime.origin, runtime.serverVersion, runtime.pid]);
  if (current?.key !== key) {
    current?.stop();
    const state: NonNullable<typeof current> = { key, stop() {}, available: false };
    current = state;
    try {
      const origin = new URL(runtime.origin);
      const version = typeof runtime.serverVersion === 'string' ? runtime.serverVersion : '';
      const protocol = boardProjects(runtime.origin, version);
      const entries = new Map<string, ExecutionRead>();
      const fingerprints = new Map<string, string>();
      const queued = new Map<string, Record<string, unknown>>();
      const active = new Set<string>();
      const retryAt = new Map<string, number>();
      let epoch = 0;
      const drain = () => {
        if (current !== state || !state.available) return;
        for (const [id, shell] of queued) {
          if (active.size >= 8) break;
          if (active.has(id)) continue;
          queued.delete(id);
          if ((retryAt.get(id) ?? 0) > Date.now()) continue;
          const fingerprint = JSON.stringify(shell);
          if (fingerprints.get(id) === fingerprint && entries.get(id)?.availability === 'available') continue;
          active.add(id);
          const startedEpoch = epoch;
          void readExecution(origin, version, protocol, id).catch((): ExecutionRead => ({ availability: 'unavailable' })).then(result => {
            if (current !== state || epoch !== startedEpoch) return;
            const retained = entries.get(id)?.observation;
            entries.set(id, { ...result, observation: result.observation ?? retained });
            fingerprints.set(id, fingerprint);
            if (result.availability !== 'available') retryAt.set(id, Date.now() + 1000);
            else retryAt.delete(id);
          }).finally(() => { active.delete(id); drain(); });
        }
      };
      state.demand = shells => {
        for (const shell of shells) {
          if (typeof shell.id !== 'string' || (retryAt.get(shell.id) ?? 0) > Date.now()) continue;
          if (fingerprints.get(shell.id) === JSON.stringify(shell) && entries.get(shell.id)?.availability === 'available') continue;
          queued.set(shell.id, shell);
        }
        drain();
      };
      let archivedReading = false;
      let archivedReadAt = -Infinity;
      let archivedFresh = false;
      let archivedEpoch = 0;
      const forgetArchived = () => { archivedEpoch++; archivedFresh = false; archivedReadAt = -Infinity; };
      /** The shells a thread lookup shows: the subscribed ones, which win, then the archived list. */
      const showShells = () => {
        state.shownShells = [...state.shells!, ...lastArchived.filter(shell => !state.shellIds!.has(shell.id))];
        state.lookup = executionItemThreads(state.shownShells);
        lastSeen = { lookup: state.lookup, observedAt: state.observedAt! };
      };
      state.archivedCurrent = () => archivedFresh && Date.now() - archivedReadAt < ARCHIVED_READ_MS;
      state.demandArchived = () => {
        if (!state.available || archivedReading || Date.now() - archivedReadAt < ARCHIVED_READ_MS) return;
        archivedReading = true;
        archivedReadAt = Date.now();
        const startedEpoch = archivedEpoch;
        void readArchivedShells(origin, version, protocol).catch((): ThreadFamilyRead => ({ availability: 'unavailable' })).then(read => {
          if (current !== state) return;
          const threads = read.availability === 'available' ? read.observation?.threads : undefined;
          try {
            if (!threads) throw Error('T3 archived threads unavailable');
            executionItemThreads(threads);
          } catch { archivedFresh = false; return; }
          lastArchived = threads;
          showShells();
          // A thread that left the active shells during the read may be missing from its answer.
          if (startedEpoch === archivedEpoch) archivedFresh = true;
          else archivedReadAt = -Infinity;
        }).finally(() => { archivedReading = false; });
      };
      state.reads = entries;
      state.fingerprints = fingerprints;
      state.stop = subscribeExecutionShell(origin, version, protocol, read => {
        if (read.availability !== 'available') {
          epoch++;
          fingerprints.clear();
          queued.clear();
          retryAt.clear();
          forgetArchived();
        }
        state.shell = read;
        state.available = false;
        if (read.availability === 'available' && read.observation) {
          // Shell events already contain status and runtime requests. History reads must not delay those facts.
          try {
            const shells = [...read.observation.snapshot.threads as Record<string, unknown>[], ...read.observation.snapshot.archivedThreads as Record<string, unknown>[]];
            const ids = new Set(shells.map(shell => shell.id));
            if ([...state.shellIds ?? []].some(id => !ids.has(id))) forgetArchived();
            state.shells = shells;
            state.shellIds = ids;
            state.observedAt = read.observation.observedAt;
            showShells();
            state.available = true;
          } catch { state.available = false; }
        }
      });
    } catch { state.available = false; }
  }
  if (!threadIds.length) return undefined;
  if (current.available) {
    if (threadIds.some(id => !current!.shellIds?.has(id))) current.demandArchived?.();
    return current.lookup?.(threadIds);
  }
  const seen = lastSeen?.lookup(threadIds);
  if (!lastSeen || seen?.length !== threadIds.length) return 'unavailable';
  const { observedAt } = lastSeen;
  return seen.map((thread) => ({ ...thread, observedAt }));
}

/**
 * The one root thread in `projectId` whose first user message is any of `messages`, leaving out the `known` thread IDs,
 * as the protocol shows it now; null when none or more than one does. Unavailable observations throw.
 */
export function protocolStartedThread(projectId: string, messages: readonly string[], known: readonly string[]): StartedThread | null {
  protocolItemThreads([]);
  if (!current?.available) throw Error('T3 execution unavailable');
  const candidates = (current.shells ?? []).filter((shell) => shell.projectId === projectId && !shell.deletedAt && typeof shell.id === 'string'
    && !known.includes(shell.id) && messages.some(message => titledFrom(shell.title, message)));
  current.demand?.(candidates);
  if (candidates.some(shell => !executionAvailable(shell))) throw Error('T3 execution unavailable');
  const matches = new Set(candidates.filter((shell) => {
    const first = current!.reads?.get(String(shell.id))?.observation?.projection.messages
      .filter((entry) => entry.role === 'user').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    return messages.some(message => first?.text === message);
  }).map(shell => String(shell.id)));
  if (matches.size !== 1) return null;
  const [threadId] = matches;
  return { threadId: threadId!, title: String(candidates.find(shell => shell.id === threadId)!.title) };
}

/** A fresh observation of this thread, independent of another thread's history read. */
function executionAvailable(shell: Record<string, unknown>): boolean {
  return !!current?.available && current.fingerprints?.get(String(shell.id)) === JSON.stringify(shell)
    && current.reads?.get(String(shell.id))?.availability === 'available';
}

/** Thread-ID lookup for the future switch/import; retained facts never imply availability. */
export function protocolThreadById(threadId: string): ExecutionRead {
  protocolItemThreads([]);
  const read = current?.reads?.get(threadId);
  const shell = current?.shownShells?.find(shell => shell.id === threadId);
  if (shell) current?.demand?.([shell]);
  return { availability: shell && executionAvailable(shell) && read ? read.availability : 'unavailable',
    ...(read?.observation ? { observation: read.observation } : {}) };
}

/** A thread as cleanup needs it. Absence from a snapshot doesn't prove deletion; only `lookupThread` confirms it. */
export type ThreadCleanupState = 'unavailable' | 'absent' | { archived: boolean; settled: boolean; live: boolean };

/** T3's shell statuses with no run at work or held up (`OrchestrationV2ShellThreadStatus` at the reference commit). Cleanup treats any other status, or none, as live, since deleting a thread cancels its runs. */
const IDLE_STATUSES = new Set(['idle', 'completed', 'interrupted', 'failed', 'cancelled', 'rolled_back']);

/** Work a shell's `status`, the latest unheld run, can hide (`isLiveSubagentShell` at the reference commit). A field another T3 release leaves out or sends in another form says nothing. */
const hasHiddenWork = ({ activityRunStatus, pendingBackgroundTasks }: Record<string, unknown>): boolean =>
  typeof activityRunStatus === 'string' || (Array.isArray(pendingBackgroundTasks) && pendingBackgroundTasks.length > 0);

/** Whether the thread or a descendant T3 still has might be at work. */
function mayBeLive(threadId: string, shells: Record<string, unknown>[]): boolean {
  const lineages = new Map(shells.map(shell => [shell.id, shell.lineage as Lineage]));
  return shells.some(shell => !shell.deletedAt && (!!shell.pendingRuntimeRequest || !IDLE_STATUSES.has(String(shell.status)) || hasHiddenWork(shell))
    && (shell.id === threadId || ancestorsOf(String(shell.id), lineages).has(threadId)));
}

/**
 * One thread's cleanup state from the current shell snapshot and, for a thread it lacks, a current read of the archived
 * list, never from a retained last observation. Without such a read the thread may be archived, so it is unavailable.
 */
export function threadCleanupState(threadId: string): ThreadCleanupState {
  protocolItemThreads([]);
  if (!current?.available) return 'unavailable';
  if (!current.shellIds?.has(threadId) && !current.archivedCurrent?.()) {
    current.demandArchived?.();
    return 'unavailable';
  }
  const shell = current.shownShells?.find(shell => shell.id === threadId);
  if (!shell || shell.deletedAt) return 'absent';
  return { archived: !!shell.archivedAt, settled: isSettled(shell), live: mayBeLive(threadId, current.shownShells!) };
}

/** Complete current observations only; no database fallback for timing facts. */
export function protocolStatsInputs(threadIds?: readonly string[]) {
  if (threadIds?.length === 0) return executionStats([]);
  protocolItemThreads([]);
  if (!current?.available || !current.reads) throw Error('T3 execution unavailable');
  const shells = (current.shownShells ?? []).filter(shell => !shell.deletedAt);
  const wanted = threadIds ? new Set(threadIds) : undefined;
  if (wanted) {
    let added = true;
    while (added) {
      added = false;
      for (const shell of shells) {
        const lineage = shell.lineage as { rootThreadId?: string; parentThreadId?: string } | undefined;
        if (typeof shell.id === 'string' && !wanted.has(shell.id) && (wanted.has(lineage?.rootThreadId ?? '') || wanted.has(lineage?.parentThreadId ?? ''))) {
          wanted.add(shell.id);
          added = true;
        }
      }
    }
  }
  const requested = shells.filter(shell => !wanted || wanted.has(String(shell.id)));
  current.demand?.(requested);
  return executionStats(requested.map(shell => {
    const read = current!.reads!.get(String(shell.id));
    if (!executionAvailable(shell) || !read?.observation) throw Error('T3 execution unavailable');
    return read.observation.projection;
  }));
}

/** All live shell bindings, including slice and child threads. Unknown bindings refuse cleanup. */
export function liveWorktreePaths(): string[] | undefined {
  protocolItemThreads([]);
  if (!current?.available || !current.shells) return undefined;
  return liveBindings(current.shells, current.shell?.observation?.snapshot.projects as Record<string, unknown>[] ?? []);
}

export function liveBindings(shells: Record<string, unknown>[], projects: Record<string, unknown>[] = []): string[] | undefined {
  const paths: string[] = [];
  for (const shell of shells) {
    if (shell.deletedAt || !shell.pendingRuntimeRequest && !['preparing', 'starting', 'running', 'waiting'].includes(String(shell.status))) continue;
    const workspace = shell.workspace as { worktreePath?: unknown; rootPath?: unknown } | undefined;
    const path = shell.worktreePath ?? workspace?.worktreePath ?? workspace?.rootPath ?? projects.find(project => project.id === shell.projectId)?.workspaceRoot;
    if (typeof path !== 'string' || !path) return undefined;
    paths.push(path);
  }
  return paths;
}
