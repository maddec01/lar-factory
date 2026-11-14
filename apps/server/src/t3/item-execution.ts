import { isRecord } from '@lar-factory/shared';
import type { ItemThread, StartedThread } from '@lar-factory/shared';

import { readJsonRecord } from '../json-file.ts';
import { loopTrace } from '../startup/loop-trace.ts';
import { boardProjects } from './board-projects.ts';
import {
    readArchivedShells,
    readExecution,
    subscribeExecutionShell,
    type ShellRead,
    type ExecutionRead,
    type ThreadFamilyRead,
} from './execution-protocol.ts';
import { executionStats, statsProjection } from './execution-stats.ts';
import { pendingRequest, type PendingRequest } from './pending-request.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';
import { titledFrom } from './t3.ts';
import type { ActivityFamily } from './thread-activity.ts';

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

const pendingTasks = ({ pendingBackgroundTasks }: Record<string, unknown>): { kind?: unknown }[] =>
    Array.isArray(pendingBackgroundTasks) ? (pendingBackgroundTasks as { kind?: unknown }[]) : [];

const isSettled = (shell: Record<string, unknown>): boolean => !!shell.settledAt || shell.settledOverride === 'settled';

/** What orders a thread among the item's. Settling moves `updatedAt`, so a settled thread goes by its last run, and with no run known behind every thread with a time. */
const orderedBy = (shell: Record<string, unknown>): string =>
    isSettled(shell)
        ? ([shell.latestRunCompletedAt, shell.latestRunStartedAt, shell.latestRunRequestedAt].find(
              (at) => typeof at === 'string',
          ) ?? '')
        : String(shell.updatedAt);

const RUNNING = new Set(['preparing', 'starting', 'running', 'waiting']);
const ACTIVITY = new Set([...RUNNING, 'queued']);

/** A shell's status, where a newer queued or cancelled message can hide an older run that is still at work. */
const statusOf = (shell: Record<string, unknown>): string =>
    ACTIVITY.has(String(shell.activityRunStatus)) ? String(shell.activityRunStatus) : String(shell.status);

/** Admit only the user-facing question text from a pending request, never its command or tool payload. */
function questionSummary(value: unknown): string | undefined {
    if (!isRecord(value)) return undefined;

    const request = isRecord(value.request) ? value.request : value;
    const questions = Array.isArray(request.questions) ? request.questions : [];
    const text = questions
        .flatMap((question) =>
            isRecord(question) && typeof question.question === 'string' ? [question.question.trim()] : [],
        )
        .filter(Boolean)
        .join(' ');

    return text || (typeof request.question === 'string' ? request.question.trim() || undefined : undefined);
}

/**
 * Each recorded thread's shell as T3 shows it, by thread ID. A thread T3 removed or deleted is left out. One pass checks
 * every shell and finds the threads at work; a thread itself is built when a lookup first asks for it, as a board asks for
 * a few hundred of several thousand shells.
 */
export function executionItemThreads(shells: Record<string, unknown>[], requests = new Map<string, PendingRequest>()) {
    const shellsById = new Map<string, Record<string, unknown>>();
    const lineages = new Map<unknown, Lineage>();
    const working: Record<string, unknown>[] = [];

    for (const shell of shells) {
        if (typeof shell.id !== 'string' || shell.deletedAt) continue;

        if (typeof shell.updatedAt !== 'string' || !Number.isFinite(Date.parse(shell.updatedAt)))
            throw Error('Invalid execution timestamp');

        shellsById.set(shell.id, shell);
        lineages.set(shell.id, shell.lineage as Lineage);

        if (
            shell.pendingRuntimeRequest ||
            ACTIVITY.has(statusOf(shell)) ||
            (Array.isArray(shell.pendingBackgroundTasks) && shell.pendingBackgroundTasks.length)
        )
            working.push(shell);
    }

    const liveChildren = new Set<string>();
    const runningChildren = new Set<string>();
    const needsYouChildren = new Set<string>();
    const doubtRunning = new Set<string>();

    for (const shell of working) {
        const id = shell.id as string;

        if (shellsById.get(id) !== shell) continue;

        const status = statusOf(shell);
        const live = !!shell.pendingRuntimeRequest || ACTIVITY.has(status);
        // A thread's background tasks carry on after its turn ends, so it and its ancestors are still at work.
        const background = Array.isArray(shell.pendingBackgroundTasks) && shell.pendingBackgroundTasks.length > 0;

        if (background) runningChildren.add(id);

        const running = !shell.pendingRuntimeRequest && status === 'running';

        for (const ancestor of ancestorsOf(id, lineages)) {
            if (live) liveChildren.add(ancestor);

            if (background || running) runningChildren.add(ancestor);

            if (running && typeof shell.title === 'string' && shell.title.startsWith('Doubt · '))
                doubtRunning.add(ancestor);

            if (shell.pendingRuntimeRequest) needsYouChildren.add(ancestor);
        }
    }

    const threads = new Map<string, ItemThread>();
    const threadOf = (id: string): ItemThread | undefined => {
        const found = threads.get(id);

        if (found) return found;

        const shell = shellsById.get(id);

        if (!shell) return undefined;

        const status = statusOf(shell);
        const state: ItemThread['state'] = shell.pendingRuntimeRequest
            ? 'needs you'
            : RUNNING.has(status)
              ? 'running'
              : ['failed', 'interrupted', 'cancelled'].includes(status)
                ? 'stopped'
                : 'done';
        const requestShell = shell.pendingRuntimeRequest
            ? shell
            : working.find((child) => child.pendingRuntimeRequest && ancestorsOf(String(child.id), lineages).has(id));
        const basic = requestShell && pendingRequest(requestShell);
        const detailed = basic && requests.get(basic.threadId);
        const request = detailed?.id === basic?.id ? detailed : basic;
        const thread: ItemThread = {
            id,
            title: typeof shell.title === 'string' ? shell.title : id,
            state,
            ...(request
                ? {
                      pendingRequest: {
                          id: request.id,
                          threadId: request.threadId,
                          kind: request.kind,
                          ...(request.ownerTitle ? { ownerTitle: request.ownerTitle } : {}),
                      },
                  }
                : {}),
            ...(request?.summary ? { questionSummary: request.summary } : {}),
            ...(questionSummary(shell.pendingRuntimeRequest)
                ? { questionSummary: questionSummary(shell.pendingRuntimeRequest) }
                : {}),
            ...(!shell.pendingRuntimeRequest && status === 'running' ? { currentRunning: true as const } : {}),
            ...(!shell.pendingRuntimeRequest && status === 'queued' ? { queued: true as const } : {}),
            ...(shell.archivedAt ? { archived: true as const } : {}),
            updated: shell.updatedAt as string,
            ...(runningChildren.has(id) ? { hasRunningChildren: true } : {}),
            ...(liveChildren.has(id) ? { hasLiveChildren: true } : {}),
            ...(doubtRunning.has(id) ? { doubtRunning: true } : {}),
            ...(needsYouChildren.has(id) ? { childNeedsYou: true } : {}),
        };

        threads.set(id, thread);

        return thread;
    };

    /** The recorded threads T3 shows, newest first by `orderedBy` and archived ones last, since archiving updates a thread; undefined for work with no recorded thread. */
    return (threadIds: readonly string[]): ItemThread[] | undefined =>
        threadIds.length
            ? threadIds
                  .flatMap((id) => threadOf(id) ?? [])
                  .sort(
                      (a, b) =>
                          Number(!!a.archived) - Number(!!b.archived) ||
                          orderedBy(shellsById.get(b.id)!).localeCompare(orderedBy(shellsById.get(a.id)!)),
                  )
            : undefined;
}

/**
 * What thread activity needs from these shells for a thread: the thread and every thread T3 shows at work below it, with
 * their parents, whose subagent records name them, even after the parent finished; which of those have background tasks;
 * and whether one of those tasks is a command rather than an agent.
 */
export function activityFamilies(shells: Record<string, unknown>[]) {
    const live = shells.filter((shell) => typeof shell.id === 'string' && !shell.deletedAt);
    const lineages = new Map<unknown, Lineage>(live.map((shell) => [shell.id, shell.lineage as Lineage]));
    const background = new Set(live.filter((shell) => pendingTasks(shell).length).map((shell) => shell.id as string));
    const families = new Map<string, ActivityFamily>();
    const familyOf = (id: string) =>
        families.get(id) ?? families.set(id, { threads: new Set([id]), background, commandRunning: false }).get(id)!;

    for (const shell of live) {
        const id = shell.id as string;
        const tasks = pendingTasks(shell);

        if (!tasks.length && !RUNNING.has(statusOf(shell))) continue;

        const commandRunning = tasks.some((task) => task.kind !== 'subagent');

        for (const above of [id, ...ancestorsOf(id, lineages)]) {
            const family = familyOf(above);

            family.threads.add(id);

            const parent = lineages.get(id)?.parentThreadId;

            if (parent && above !== id) family.threads.add(parent);

            family.commandRunning ||= commandRunning;
        }
    }

    return (threadId: string): ActivityFamily =>
        families.get(threadId) ?? { threads: new Set([threadId]), background, commandRunning: false };
}

/** The last lookup the board read while T3 could be read, kept through an outage, and when it read it. */
let lastSeen: { lookup: ReturnType<typeof executionItemThreads>; observedAt: string } | undefined;

/** The archived list T3 last answered, kept through a failed read. */
let lastArchived: Record<string, unknown>[] = [];
/** How long one read of the archived list answers. Refresh runs about every 2 seconds. Any recorded thread missing from the active shells asks for the list, so with one the board reads it every 30 seconds for the server's life. */
const ARCHIVED_READ_MS = 30_000;

let current:
    | {
          key: string;
          stop(): void;
          demand?(shells: Record<string, unknown>[]): void;
          demandArchived?(): void;
          archivedCurrent?(): boolean;
          archivedAnswered?(): boolean;
          archivedFailed?(): boolean;
          shell?: ShellRead;
          lookup?: ReturnType<typeof executionItemThreads>;
          activityFamilies?: ReturnType<typeof activityFamilies>;
          available: boolean;
          shells?: Record<string, unknown>[];
          shownShells?: Record<string, unknown>[];
          shownById?: Map<unknown, Record<string, unknown>>;
          shellIds?: Set<unknown>;
          reads?: Map<string, ExecutionRead>;
          fingerprints?: Map<string, string>;
          observedAt?: string;
      }
    | undefined;
/** Each shell's JSON. T3's events replace a shell's record rather than change it, so a record's JSON never goes stale. */
const shellJson = new WeakMap<Record<string, unknown>, string>();

function fingerprintOf(shell: Record<string, unknown>): string {
    let json = shellJson.get(shell);

    if (json === undefined) {
        json = JSON.stringify(shell);
        shellJson.set(shell, json);
    }

    return json;
}

/** T3's runtime file as this synchronous pass read it, as a refresh asks once per item and slice. */
let runtimeNow: { key: string; origin: unknown; serverVersion: unknown; running: boolean } | undefined;

function readRuntime() {
    if (runtimeNow) return runtimeNow;

    const path = serverRuntimePath(process.env);
    const runtime = readJsonRecord(path);
    const key = JSON.stringify([path, runtime?.origin, runtime?.serverVersion, runtime?.pid]);

    runtimeNow = {
        key,
        origin: runtime?.origin,
        serverVersion: runtime?.serverVersion,
        running: (current?.key === key && current.available) || t3Running(path),
    };
    queueMicrotask(() => {
        runtimeNow = undefined;
    });

    return runtimeNow;
}

/** Whether T3 runs and its first thread list hasn't answered yet, which is no failure. */
export const protocolAwaitingFirstShell = (): boolean => !!current && !current.available && !current.shell;

/**
 * The recorded threads as T3 shows them now. While T3 can't be read, each thread's last observation with when the board
 * saw it, or 'unavailable' once one was never seen. Failures never become empty success.
 */
export function protocolItemThreads(threadIds: readonly string[]): ItemThread[] | 'unavailable' | undefined {
    const runtime = readRuntime();
    const { key } = runtime;

    if (!runtime.running || typeof runtime.origin !== 'string') {
        current?.stop();
        current = undefined;

        return 'unavailable';
    }

    if (current?.key !== key) {
        current?.stop();

        const state: NonNullable<typeof current> = { key, stop() {}, available: false };

        current = state;

        try {
            const origin = new URL(runtime.origin);
            const version = typeof runtime.serverVersion === 'string' ? runtime.serverVersion : '';
            const protocol = boardProjects(runtime.origin, version);
            const entries = new Map<string, ExecutionRead>();
            const requests = new Map<string, PendingRequest>();
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

                    const fingerprint = fingerprintOf(shell);

                    if (fingerprints.get(id) === fingerprint && entries.get(id)?.availability === 'available') continue;

                    active.add(id);

                    const startedEpoch = epoch;

                    void readExecution(origin, version, protocol, id)
                        .catch((): ExecutionRead => ({ availability: 'unavailable' }))
                        .then((result) => {
                            if (current !== state || epoch !== startedEpoch) return;

                            const request =
                                result.availability === 'available' &&
                                result.observation &&
                                pendingRequest(shell, result.observation.projection);

                            const changed = request
                                ? JSON.stringify(requests.get(id)) !== JSON.stringify(request)
                                : requests.has(id);

                            if (request) requests.set(id, request);
                            else requests.delete(id);

                            if (changed) state.lookup = executionItemThreads(state.shownShells ?? [], requests);

                            const observation = result.observation && {
                                ...result.observation,
                                projection: statsProjection(result.observation.projection),
                            };

                            entries.set(id, { ...result, observation: observation ?? entries.get(id)?.observation });
                            fingerprints.set(id, fingerprint);

                            if (result.availability !== 'available') retryAt.set(id, Date.now() + 1000);
                            else retryAt.delete(id);
                        })
                        .finally(() => {
                            active.delete(id);
                            drain();
                        });
                }
            };

            state.demand = (shells) => {
                for (const shell of shells) {
                    if (typeof shell.id !== 'string' || (retryAt.get(shell.id) ?? 0) > Date.now()) continue;

                    if (
                        fingerprints.get(shell.id) === fingerprintOf(shell) &&
                        entries.get(shell.id)?.availability === 'available'
                    )
                        continue;

                    queued.set(shell.id, shell);
                }
                drain();
            };

            let archivedReading = false;
            let archivedReadAt = -Infinity;
            let archivedFresh = false;
            /** A read answered since a thread last left the active shells. Unlike `archivedFresh`, ageing or a failed reread keeps it, as neither brings a thread back. */
            let archivedAnswered = false;
            /** The latest read of the archived list failed, so a thread on neither list has no read coming yet. */
            let archivedFailed = false;
            let archivedEpoch = 0;
            const forgetArchived = () => {
                archivedEpoch++;
                archivedFresh = false;
                archivedAnswered = false;
                archivedFailed = false;
                archivedReadAt = -Infinity;
            };
            /** The shells a thread lookup shows: the subscribed ones, which win, then the archived list. */
            const showShells = () => {
                state.shownShells = [
                    ...state.shells!,
                    ...lastArchived.filter((shell) => !state.shellIds!.has(shell.id)),
                ];
                // The first shell with an ID wins, as a search of the list finds it.
                state.shownById = new Map();
                for (const shell of state.shownShells)
                    if (!state.shownById.has(shell.id)) state.shownById.set(shell.id, shell);
                state.lookup = executionItemThreads(state.shownShells, requests);
                state.activityFamilies = undefined;
                lastSeen = { lookup: state.lookup, observedAt: state.observedAt! };
            };

            state.archivedCurrent = () => archivedFresh && Date.now() - archivedReadAt < ARCHIVED_READ_MS;
            state.archivedAnswered = () => archivedAnswered;
            state.archivedFailed = () => archivedFailed;
            state.demandArchived = () => {
                if (!state.available || archivedReading || Date.now() - archivedReadAt < ARCHIVED_READ_MS) return;

                archivedReading = true;
                archivedReadAt = Date.now();

                const startedEpoch = archivedEpoch;

                void readArchivedShells(origin, version, protocol)
                    .catch((): ThreadFamilyRead => ({ availability: 'unavailable' }))
                    .then((read) => {
                        if (current !== state) return;

                        const threads = read.availability === 'available' ? read.observation?.threads : undefined;

                        try {
                            if (!threads) throw Error('T3 archived threads unavailable');

                            executionItemThreads(threads);
                        } catch {
                            archivedFresh = false;
                            archivedFailed = startedEpoch === archivedEpoch;

                            return;
                        }

                        archivedFailed = false;
                        lastArchived = threads;
                        showShells();

                        // A thread that left the active shells during the read may be missing from its answer.
                        if (startedEpoch === archivedEpoch) archivedFresh = archivedAnswered = true;
                        else archivedReadAt = -Infinity;
                    })
                    .finally(() => {
                        archivedReading = false;
                    });
            };
            state.reads = entries;
            state.fingerprints = fingerprints;
            state.stop = subscribeExecutionShell(origin, version, protocol, (read) => {
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
                        const shells = [
                            ...(read.observation.snapshot.threads as Record<string, unknown>[]),
                            ...(read.observation.snapshot.archivedThreads as Record<string, unknown>[]),
                        ];
                        const ids = new Set(shells.map((shell) => shell.id));

                        if ([...(state.shellIds ?? [])].some((id) => !ids.has(id))) forgetArchived();

                        state.shells = shells;
                        state.shellIds = ids;
                        state.observedAt = read.observation.observedAt;
                        showShells();
                        state.available = true;
                    } catch {
                        state.available = false;
                    }
                }
            });
        } catch {
            state.available = false;
            state.shell = { availability: 'unavailable' };
        }
    }

    if (!threadIds.length) return undefined;

    if (current.available) {
        if (threadIds.some((id) => !current!.shellIds?.has(id))) current.demandArchived?.();

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
export function protocolStartedThread(
    projectId: string,
    messages: readonly string[],
    known: readonly string[],
): StartedThread | null {
    protocolItemThreads([]);

    if (!current?.available) throw Error('T3 execution unavailable');

    const candidates = (current.shells ?? []).filter(
        (shell) =>
            shell.projectId === projectId &&
            !shell.deletedAt &&
            typeof shell.id === 'string' &&
            !known.includes(shell.id) &&
            messages.some((message) => titledFrom(shell.title, message)),
    );

    current.demand?.(candidates);

    if (candidates.some((shell) => !executionAvailable(shell))) throw Error('T3 execution unavailable');

    const matches = new Set(
        candidates
            .filter((shell) => {
                const first = current!.reads
                    ?.get(String(shell.id))
                    ?.observation?.projection.messages.filter((entry) => entry.role === 'user')
                    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];

                return messages.some((message) => first?.text === message);
            })
            .map((shell) => String(shell.id)),
    );

    if (matches.size !== 1) return null;

    const [threadId] = matches;

    return { threadId: threadId!, title: String(candidates.find((shell) => shell.id === threadId)!.title) };
}

/** A fresh observation of this thread, independent of another thread's history read. */
function executionAvailable(shell: Record<string, unknown>): boolean {
    return (
        !!current?.available &&
        current.fingerprints?.get(String(shell.id)) === fingerprintOf(shell) &&
        current.reads?.get(String(shell.id))?.availability === 'available'
    );
}

/** Thread-ID lookup for the future switch/import; retained facts never imply availability. */
export function protocolThreadById(threadId: string): ExecutionRead {
    protocolItemThreads([]);

    const read = current?.reads?.get(threadId);
    const shell = current?.shownById?.get(threadId);

    if (shell) current?.demand?.([shell]);

    return {
        availability: shell && executionAvailable(shell) && read ? read.availability : 'unavailable',
        ...(read?.observation ? { observation: read.observation } : {}),
    };
}

/** A thread as cleanup needs it. Absence from a snapshot doesn't prove deletion; only `lookupThread` confirms it. */
export type ThreadCleanupState = 'unavailable' | 'absent' | { archived: boolean; settled: boolean; live: boolean };

/** T3's shell statuses with no run at work or held up (`OrchestrationV2ShellThreadStatus` at the reference commit). Cleanup treats any other status, or none, as live, since deleting a thread cancels its runs. */
const IDLE_STATUSES = new Set(['idle', 'completed', 'interrupted', 'failed', 'cancelled', 'rolled_back']);

/** Work a shell's `status`, the latest unheld run, can hide (`isLiveSubagentShell` at the reference commit). A field another T3 release leaves out or sends in another form says nothing. */
const hasHiddenWork = ({ activityRunStatus, pendingBackgroundTasks }: Record<string, unknown>): boolean =>
    typeof activityRunStatus === 'string' ||
    (Array.isArray(pendingBackgroundTasks) && pendingBackgroundTasks.length > 0);

/** Whether the thread or a descendant T3 still has might be at work. */
function mayBeLive(threadId: string, shells: Record<string, unknown>[]): boolean {
    const lineages = new Map(shells.map((shell) => [shell.id, shell.lineage as Lineage]));

    return shells.some(
        (shell) =>
            !shell.deletedAt &&
            (!!shell.pendingRuntimeRequest || !IDLE_STATUSES.has(String(shell.status)) || hasHiddenWork(shell)) &&
            (shell.id === threadId || ancestorsOf(String(shell.id), lineages).has(threadId)),
    );
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

    const shell = current.shownById?.get(threadId);

    if (!shell || shell.deletedAt) return 'absent';

    return { archived: !!shell.archivedAt, settled: isSettled(shell), live: mayBeLive(threadId, current.shownShells!) };
}

/** The current shells' activity families, worked out once per snapshot when a pass first asks; undefined while T3 can't be read, so no read can pass as current. */
export function protocolActivityFamilies(): ReturnType<typeof activityFamilies> | undefined {
    protocolItemThreads([]);

    if (!current?.available || !current.shownShells) return undefined;

    return (current.activityFamilies ??= activityFamilies(current.shownShells));
}

/**
 * How the latest read of a thread stands for usage: current, pending after an earlier success with its shell since changed,
 * never read, failed until a read succeeds, or gone, as deleted or on neither of T3's thread lists.
 */
export type ThreadUsageRead = 'current' | 'pending' | 'never' | 'failed' | 'gone';

/** The rows the stats read can count, and how far each thread's read lets them answer. */
export type StatsInputs = Awaited<ReturnType<typeof executionStats>> & {
    /** The read of each thread in these threads' family: the threads and their lineage descendants, as `agentTime` counts them. */
    familyReads(threadIds: readonly string[]): ThreadUsageRead[];
    /** Whether every requested thread and descendant was read successfully at least once, or is gone. */
    allObserved: boolean;
};

/** `threadIds` and their lineage descendants among `shells`. */
function threadFamily(threadIds: readonly string[], shells: Record<string, unknown>[]): Set<string> {
    const wanted = new Set(threadIds);
    let added = true;

    while (added) {
        added = false;
        for (const shell of shells) {
            const lineage = shell.lineage as { rootThreadId?: string; parentThreadId?: string } | undefined;

            if (
                typeof shell.id === 'string' &&
                !wanted.has(shell.id) &&
                (wanted.has(lineage?.rootThreadId ?? '') || wanted.has(lineage?.parentThreadId ?? ''))
            ) {
                wanted.add(shell.id);
                added = true;
            }
        }
    }

    return wanted;
}

function threadUsageRead(id: string): ThreadUsageRead {
    const shell = current?.shownById?.get(id);

    if (!shell) return current?.archivedAnswered?.() ? 'gone' : 'never';

    if (shell.deletedAt) return 'gone';

    const read = current?.reads?.get(id);

    if (!read) return 'never';

    if (read.availability !== 'available' || !read.observation) return 'failed';

    return executionAvailable(shell) ? 'current' : 'pending';
}

/** How far the reads of some threads and their lineage descendants have landed, as the usage catch-up paces itself by them. */
export interface ThreadReads {
    /** Each thread's read. A thread T3 can't answer for reads as failed, so it holds up no catch-up. */
    reads: Map<string, ThreadUsageRead>;
    /** The threads with an observation, whose transcripts a warm can read. */
    observed: Set<string>;
    /** Asks for the reads still needed. */
    demand(): void;
}

/** Where the reads of `threadIds` stand now, or null while T3 runs with its thread list not yet read. Reads nothing by itself. */
export function protocolThreadReads(threadIds: readonly string[]): ThreadReads | null {
    return loopTrace.span('thread reads', () => threadReadsNow(threadIds));
}

function threadReadsNow(threadIds: readonly string[]): ThreadReads | null {
    if (!threadIds.length) return { reads: new Map(), observed: new Set(), demand() {} };

    protocolItemThreads(threadIds);

    if (protocolAwaitingFirstShell()) return null;

    if (!current?.available || !current.reads)
        return { reads: new Map(threadIds.map((id) => [id, 'failed'])), observed: new Set(), demand() {} };

    const state = current;
    const shells = (state.shownShells ?? []).filter((shell) => !shell.deletedAt);
    const family = threadFamily(threadIds, shells);
    const reads = new Map(
        [...family].map((id): [string, ThreadUsageRead] => {
            const read = threadUsageRead(id);

            return [id, read === 'never' && state.archivedFailed?.() && !state.shellIds?.has(id) ? 'failed' : read];
        }),
    );

    return {
        reads,
        observed: new Set([...family].filter((id) => state.reads!.get(id)?.observation)),
        demand: () => state.demand?.(shells.filter((shell) => family.has(String(shell.id)))),
    };
}

/**
 * What the latest observations can count, with no database fallback for timing facts: a pending thread counts from its last
 * read, and a failed one from its retained observation, so it still takes part in deduplication. Null while T3 runs with its
 * thread list not yet read. Throws while T3 is stopped or its list can't be read.
 */
export async function protocolStatsInputs(
    threadIds?: readonly string[],
    pause?: () => Promise<void>,
): Promise<StatsInputs | null> {
    if (threadIds?.length === 0) return { ...(await executionStats([])), familyReads: () => [], allObserved: true };

    protocolItemThreads(threadIds ?? []);

    if (current && !current.available && !current.shell) return null;

    if (!current?.available || !current.reads) throw Error('T3 execution unavailable');

    const shells = (current.shownShells ?? []).filter((shell) => !shell.deletedAt);
    const wanted = threadIds ? threadFamily(threadIds, shells) : undefined;
    const requested = shells.filter((shell) => !wanted || wanted.has(String(shell.id)));

    current.demand?.(requested);

    const observation = (id: string) => current!.reads!.get(id)?.observation;
    // A warm reads these inputs' transcripts before the stats read that uses them, so a read landing in between waits for the next inputs.
    const reads = new Map(
        [...(wanted ?? requested.map((shell) => String(shell.id)))].map((id) => [id, threadUsageRead(id)]),
    );
    const projections = requested.flatMap((shell) => observation(String(shell.id))?.projection ?? []);

    return {
        ...(await executionStats(projections, pause)),
        familyReads: (ids) => [...threadFamily(ids, shells)].map((id) => reads.get(id) ?? 'never'),
        allObserved: [...reads].every(([id, read]) => read !== 'never' && (read !== 'failed' || !!observation(id))),
    };
}

/** All live shell bindings, including slice and child threads. Unknown bindings refuse cleanup. */
export function liveWorktreePaths(): string[] | undefined {
    protocolItemThreads([]);

    if (!current?.available || !current.shells) return undefined;

    return liveBindings(
        current.shells,
        (current.shell?.observation?.snapshot.projects as Record<string, unknown>[]) ?? [],
    );
}

export function liveBindings(
    shells: Record<string, unknown>[],
    projects: Record<string, unknown>[] = [],
): string[] | undefined {
    const paths: string[] = [];

    for (const shell of shells) {
        if (
            shell.deletedAt ||
            (!shell.pendingRuntimeRequest &&
                !['preparing', 'starting', 'running', 'waiting'].includes(String(shell.status)))
        )
            continue;

        const workspace = shell.workspace as { worktreePath?: unknown; rootPath?: unknown } | undefined;
        const path =
            shell.worktreePath ??
            workspace?.worktreePath ??
            workspace?.rootPath ??
            projects.find((project) => project.id === shell.projectId)?.workspaceRoot;

        if (typeof path !== 'string' || !path) return undefined;

        paths.push(path);
    }

    return paths;
}
