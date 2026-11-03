import { executionStats } from '../src/t3/execution-stats.ts';
import { readFileSync } from 'node:fs';
import { executionItemThreads } from '../src/t3/item-execution.ts';
import type { ThreadReads, ThreadUsageRead } from '../src/t3/item-execution.ts';
import type { FixtureRequest, FixtureThread } from './stats-db.ts';

export function protocolItemThreads(threadIds: readonly string[]) {
  try {
    const threads: (FixtureThread & { retainedAt?: string })[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
    const requests: FixtureRequest[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.requests.json', 'utf8'));
    const shells = threads.map(thread => ({
      id: thread.id, title: thread.title ?? thread.id, deletedAt: thread.deletedAt,
      lineage: { parentThreadId: thread.parentThreadId ?? thread.rootThreadId, rootThreadId: thread.rootThreadId },
      pendingRuntimeRequest: requests.some(request => !request.resolvedAt && thread.turns?.some(turn => turn.id === request.turnId)),
      status: thread.turns?.some(turn => !turn.completedAt) ? 'running' : thread.turns?.at(-1)?.status ?? 'completed',
      updatedAt: new Date(thread.turns?.at(-1)?.completedAt ?? thread.turns?.at(-1)?.startedAt ?? '2026-10-20T08:00:00.000Z').toISOString(),
    }));
    return executionItemThreads(shells)(threadIds)?.map(thread => {
      const retainedAt = threads.find(source => source.id === thread.id)?.retainedAt;
      return retainedAt ? { ...thread, observedAt: retainedAt } : thread;
    });
  } catch { return threadIds.length ? 'unavailable' as const : undefined; }
}
/** Spawned boards never read a thread as cleanable, so no server run reaches T3's thread commands. With FAKE_THREAD_CLEANUP, one gone from the fixture reads as absent. */
export function threadCleanupState(threadId: string): 'unavailable' | 'absent' {
  if (process.env.FAKE_THREAD_CLEANUP !== '1') return 'unavailable';
  const threads: FixtureThread[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
  return threads.some(thread => thread.id === threadId) ? 'unavailable' : 'absent';
}
/** Spawned boards find started threads through the fake t3 CLI alone. */
export function protocolStartedThread(): never { throw Error("T3 execution unavailable"); }

/** Spawned boards consume the same protocol mapping as production. */
export async function protocolStatsInputs() {
  if (process.env.FAKE_EXECUTION_STATS_UNAVAILABLE === '1') throw Error('Usage unavailable');
  const threads: FixtureThread[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
  const inputs = await executionStats(threads.filter(thread => thread.read !== 'never').map(thread => ({
    thread: { id: thread.id, title: thread.title ?? thread.id, deletedAt: thread.deletedAt ?? null,
      lineage: { rootThreadId: thread.rootThreadId ?? thread.id, parentThreadId: thread.parentThreadId ?? thread.rootThreadId ?? null, relationshipToParent: thread.rootThreadId ? 'subagent' : null } },
    messages: [...(thread.messages ?? []).map((text, index) => ({ role: 'user', text, createdAt: new Date(Date.parse('2026-10-20T08:00:00Z') + index * 60000).toISOString() })),
      ...(thread.repliedAt ? [{ role: 'assistant', text: 'Done.', createdAt: thread.repliedAt }] : [])],
    providerSessions: [],
    providerThreads: [...(thread.sessions ?? []).map((entry, index) => {
      const session = typeof entry === 'string' ? { session: entry } : entry;
      return { id: `${thread.id}:session:${index}`, driver: session.driver ?? 'claudeAgent', providerInstanceId: session.instance ?? 'claudeAgent', nativeThreadRef: { nativeId: session.session }, createdAt: session.createdAt ?? '2026-10-20T08:00:00Z' };
    }), ...(thread.turns ?? []).map(turn => ({ id: `${thread.id}:${turn.providerThread ?? turn.id}`, status: !turn.completedAt && !turn.abandoned ? 'active' : 'idle' }))],
    providerTurns: (thread.turns ?? []).map(turn => ({ ...turn, providerThreadId: `${thread.id}:${turn.providerThread ?? turn.id}`, status: turn.status ?? (turn.completedAt ? 'completed' : 'running'), completedAt: turn.completedAt ?? null })),
    runtimeRequests: (JSON.parse(readFileSync(process.env.T3_STATE_DB + '.requests.json', 'utf8')) as FixtureRequest[])
      .filter(request => thread.turns?.some(turn => turn.id === request.turnId))
      .map(request => ({ providerTurnId: request.turnId, createdAt: request.createdAt, resolvedAt: request.resolvedAt ?? null })),
    subagents: threads.flatMap(child => child.rootThreadId === thread.id || child.parentThreadId === thread.id
      ? [child.subagent ?? []].flat().map(run => ({ ...run, childThreadId: child.id, completedAt: run.completedAt ?? null })) : []),
  })));
  const reads = threadUsage(threads);
  return { ...inputs, allObserved: threads.every(thread => thread.read !== 'never'), familyReads: (threadIds: readonly string[]) => [...threadFamily(threads, threadIds)].map(reads) };
}

function threadFamily(threads: FixtureThread[], threadIds: readonly string[]): Set<string> {
  const family = new Set(threadIds);
  for (const _ of threads) for (const { id, rootThreadId, parentThreadId } of threads) if (family.has(rootThreadId ?? '') || family.has(parentThreadId ?? '')) family.add(id);
  return family;
}

const threadUsage = (threads: FixtureThread[]) => (id: string): ThreadUsageRead => {
  const thread = threads.find(candidate => candidate.id === id);
  return !thread || thread.deletedAt ? 'gone' : thread.read ?? 'current';
};

/** Spawned boards read each fixture thread as its `read` says; with no fixture, T3 can't answer for any of them. */
export function protocolThreadReads(threadIds: readonly string[]): ThreadReads {
  let threads: FixtureThread[];
  try {
    if (process.env.FAKE_EXECUTION_STATS_UNAVAILABLE === '1') throw Error('Usage unavailable');
    threads = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
  } catch { return { reads: new Map(threadIds.map(id => [id, 'failed'])), observed: new Set(), demand() {} }; }
  const family = [...threadFamily(threads, threadIds)];
  const reads = threadUsage(threads);
  return { reads: new Map(family.map(id => [id, reads(id)])), observed: new Set(family.filter(id => ['current', 'failed'].includes(reads(id)))), demand() {} };
}

export function liveWorktreePaths(): string[] | undefined {
  try {
    const threads: FixtureThread[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
    return threads.some(thread => thread.turns?.some(turn => !turn.completedAt)) ? undefined : [];
  } catch { return undefined; }
}
