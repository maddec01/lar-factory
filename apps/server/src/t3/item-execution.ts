import { executionStats } from './execution-stats.ts';
import type { ItemThread, StartedThread } from '@lar-factory/shared';
import { readJsonRecord } from '../json-file.ts';
import { boardProjects } from './board-projects.ts';
import { readExecution, subscribeExecutionShell, type ShellRead, type ExecutionRead } from './execution-protocol.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';

/** Each recorded thread's shell as T3 shows it, by thread ID. A thread T3 removed or deleted is left out. */
export function executionItemThreads(shells: Record<string, unknown>[]) {
  const byId = new Map<string, ItemThread>();
  const parents = new Map<string, { parent?: string; root?: string }>();
  for (const shell of shells) {
    if (typeof shell.id !== 'string' || shell.deletedAt) continue;
    if (typeof shell.updatedAt !== 'string' || !Number.isFinite(Date.parse(shell.updatedAt))) throw Error('Invalid execution timestamp');
    const state: ItemThread['state'] = shell.pendingRuntimeRequest ? 'needs you'
      : ['preparing', 'starting', 'running', 'waiting'].includes(String(shell.status)) ? 'running'
      : ['failed', 'interrupted', 'cancelled'].includes(String(shell.status)) ? 'stopped' : 'done';
    byId.set(shell.id, { id: shell.id, title: typeof shell.title === 'string' ? shell.title : shell.id, state, updated: shell.updatedAt });
    const lineage = shell.lineage as { parentThreadId?: string; rootThreadId?: string } | undefined;
    parents.set(shell.id, { parent: lineage?.parentThreadId, root: lineage?.rootThreadId });
  }
  for (const thread of byId.values()) {
    if (thread.state !== 'running' && thread.state !== 'needs you') continue;
    const seen = new Set([thread.id]);
    const root = parents.get(thread.id)?.root;
    if (root && root !== thread.id && byId.has(root)) byId.get(root)!.hasLiveChildren = true;
    let parent = parents.get(thread.id)?.parent;
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      if (byId.has(parent)) byId.get(parent)!.hasLiveChildren = true;
      parent = parents.get(parent)?.parent;
    }
  }
  /** The recorded threads T3 shows, newest first; undefined for work with no recorded thread. */
  return (threadIds: readonly string[]): ItemThread[] | undefined => threadIds.length
    ? threadIds.flatMap((id) => byId.get(id) ?? []).sort((a, b) => b.updated.localeCompare(a.updated)) : undefined;
}

/** The last lookup the board read while T3 could be read, kept through an outage, and when it read it. */
let lastSeen: { lookup: ReturnType<typeof executionItemThreads>; observedAt: string } | undefined;

let current: { key: string; stop(): void; shell?: ShellRead; lookup?: ReturnType<typeof executionItemThreads>; available: boolean; shells?: Record<string, unknown>[]; reads?: Map<string, ExecutionRead>; fingerprints?: Map<string, string>; observedAt?: string } | undefined;
/**
 * The recorded threads as T3 shows them now. While T3 can't be read, each thread's last observation with when the board
 * saw it, or 'unavailable' once one was never seen. Failures never become empty success.
 */
export function protocolItemThreads(threadIds: readonly string[]): ItemThread[] | 'unavailable' | undefined {
  const path = serverRuntimePath(process.env);
  const runtime = readJsonRecord(path);
  if (!t3Running(path) || typeof runtime?.origin !== 'string') {
    if (current) current.available = false;
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
      let pending: ShellRead | undefined;
      let running = false;
      const drain = async () => {
        if (running) return;
        running = true;
        try {
          while (pending && current === state) {
            const read = pending;
            pending = undefined;
            if (read?.availability !== 'available' || !read.observation) continue;
            const shells = [...read.observation.snapshot.threads as Record<string, unknown>[], ...read.observation.snapshot.archivedThreads as Record<string, unknown>[]];
            let cursor = 0;
            const worker = async () => {
              while (cursor < shells.length && current === state) {
                const shell = shells[cursor++]!;
                if (typeof shell.id !== 'string') throw Error('Invalid thread ID');
                const fingerprint = JSON.stringify(shell);
                if (fingerprints.get(shell.id) === fingerprint && entries.get(shell.id)?.availability === 'available') continue;
                const result = await readExecution(origin, version, protocol, shell.id);
                const retained = entries.get(shell.id)?.observation;
                entries.set(shell.id, { ...result, observation: result.observation ?? retained });
                fingerprints.set(shell.id, fingerprint);
              }
            };
            await Promise.all(Array.from({ length: Math.min(8, shells.length) }, worker));
            if (current !== state) return;
          }
        } catch { /* A detail failure does not invalidate independently observed shell status. */ }
        finally { running = false; if (pending) void drain(); }
      };
      state.reads = entries;
      state.fingerprints = fingerprints;
      state.stop = subscribeExecutionShell(origin, version, protocol, read => {
        state.shell = read;
        state.available = false;
        if (read.availability === 'available' && read.observation) {
          // Shell events already contain status and runtime requests. History reads must not delay those facts.
          try {
            const shells = [...read.observation.snapshot.threads as Record<string, unknown>[], ...read.observation.snapshot.archivedThreads as Record<string, unknown>[]];
            state.lookup = executionItemThreads(shells);
            state.shells = shells;
            state.observedAt = read.observation.observedAt;
            lastSeen = { lookup: state.lookup, observedAt: state.observedAt };
            state.available = true;
          } catch { state.available = false; }
        }
        pending = read;
        void drain();
      });
    } catch { state.available = false; }
  }
  if (!threadIds.length) return undefined;
  if (current.available) return current.lookup?.(threadIds);
  const seen = lastSeen?.lookup(threadIds);
  if (!lastSeen || seen?.length !== threadIds.length) return 'unavailable';
  const { observedAt } = lastSeen;
  return seen.map((thread) => ({ ...thread, observedAt }));
}

/**
 * The one root thread in `projectId` whose first user message is `message`, leaving out the `known` thread IDs, as the
 * protocol shows it now; null when none or more than one does. Unavailable observations throw.
 */
export function protocolStartedThread(projectId: string, message: string, known: readonly string[]): StartedThread | null {
  protocolItemThreads([]);
  if (!current?.available) throw Error('T3 execution unavailable');
  const candidates = (current.shells ?? []).filter((shell) => shell.projectId === projectId && !shell.deletedAt && typeof shell.id === 'string'
    && !known.includes(shell.id) && shell.title === message.split('\n')[0]);
  if (candidates.some(shell => !executionAvailable(shell))) throw Error('T3 execution unavailable');
  const matches = candidates.filter((shell) => {
    const first = current!.reads?.get(String(shell.id))?.observation?.projection.messages
      .filter((entry) => entry.role === 'user').sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
    return first?.text === message;
  });
  return matches.length === 1 ? { threadId: String(matches[0]!.id), title: String(matches[0]!.title) } : null;
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
  const shell = current?.shells?.find(shell => shell.id === threadId);
  return { availability: shell && executionAvailable(shell) && read ? read.availability : 'unavailable',
    ...(read?.observation ? { observation: read.observation } : {}) };
}

/** Complete current observations only; no database fallback for timing facts. */
export function protocolStatsInputs(threadIds?: readonly string[]) {
  if (threadIds?.length === 0) return executionStats([]);
  protocolItemThreads([]);
  if (!current?.available || !current.reads) throw Error('T3 execution unavailable');
  const shells = (current.shells ?? []).filter(shell => !shell.deletedAt);
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
  return executionStats(shells.filter(shell => !wanted || wanted.has(String(shell.id))).map(shell => {
    const read = current!.reads!.get(String(shell.id));
    if (!executionAvailable(shell) || !read?.observation) throw Error('T3 execution unavailable');
    return read.observation.projection;
  }));
}
