import { readFileSync } from 'node:fs';
import { executionItemThreads } from '../src/t3/item-execution.ts';
import type { FixtureThread } from './stats-db.ts';

export function protocolItemThreads(repo: string, number: number) {
  try {
    const threads: FixtureThread[] = JSON.parse(readFileSync(process.env.T3_STATE_DB + '.execution.json', 'utf8'));
    const shells = threads.map(thread => ({
      id: thread.id, title: thread.title ?? thread.id, deletedAt: thread.deletedAt,
      lineage: { relationshipToParent: thread.rootThreadId ? 'subagent' : null },
      status: thread.turns?.some(turn => !turn.completedAt) ? 'running' : 'completed',
      updatedAt: new Date(thread.turns?.at(-1)?.completedAt ?? thread.turns?.at(-1)?.startedAt ?? '2026-10-20T08:00:00.000Z').toISOString(),
    }));
    const reads = new Map(threads.map(thread => [thread.id, { availability: 'available' as const, observation: {
      projection: { messages: (thread.messages ?? []).map((text, index) => ({ role: 'user', text, createdAt: String(index) })) },
    } }]));
    return executionItemThreads(shells, reads as unknown as Parameters<typeof executionItemThreads>[1])(repo, number);
  } catch { return undefined; }
}
export function protocolThreadByTitle() { return null; }
