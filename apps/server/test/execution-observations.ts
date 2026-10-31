import { executionStats } from '../src/t3/execution-stats.ts';
import { readFileSync } from 'node:fs';
import { executionItemThreads } from '../src/t3/item-execution.ts';
import type { FixtureRequest, FixtureThread } from './stats-db.ts';

export function protocolItemThreads(threadIds: readonly string[]) {
  try {
    const threads: FixtureThread[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
    const shells = threads.map(thread => ({
      id: thread.id, title: thread.title ?? thread.id, deletedAt: thread.deletedAt,
      status: thread.turns?.some(turn => !turn.completedAt) ? 'running' : 'completed',
      updatedAt: new Date(thread.turns?.at(-1)?.completedAt ?? thread.turns?.at(-1)?.startedAt ?? '2026-10-20T08:00:00.000Z').toISOString(),
    }));
    return executionItemThreads(shells)(threadIds);
  } catch { return threadIds.length ? 'unavailable' as const : undefined; }
}
export function protocolThreadByTitle() { return null; }

/** Spawned boards consume the same protocol mapping as production. */
export function protocolStatsInputs() {
  const threads: FixtureThread[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
  return executionStats(threads.map(thread => ({
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
}
