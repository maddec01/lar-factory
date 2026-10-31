import { isRecord } from '@lar-factory/shared';
import type { ThreadRows, ThreadSession } from './t3-db.ts';

/** T3 97e35bc orchestrationV2.ts provider threads own native transcript references.
 * Provider sessions describe runtime attachment, not transcript identity.
 * Keep the SQL-era row interface so ADR0007/0008 calculations stay unchanged.
 */
export function executionStats(projections: Record<string, unknown>[]): { rows: ThreadRows; sessions: ThreadSession[] } {
  const rows: ThreadRows = { threads: [], turns: [], runs: [], waits: [], lastMessages: [], active: new Set() };
  const sessions: (ThreadSession & { createdAt: string })[] = [];
  const facts = (projection: Record<string, unknown>, key: string): Record<string, unknown>[] => {
    const value = projection[key];
    if (!Array.isArray(value) || !value.every(isRecord)) throw Error('Invalid execution stats');
    return value;
  };
  const string = (value: unknown): string => {
    if (typeof value !== 'string') throw Error('Invalid execution stats field');
    return value;
  };
  const timestamp = (value: unknown): string | null => {
    if (value === null) return null;
    const text = string(value);
    if (!Number.isFinite(Date.parse(text))) throw Error('Invalid execution stats timestamp');
    return text;
  };
  for (const projection of projections) {
    if (!isRecord(projection.thread)) throw Error('Invalid execution stats thread');
    const thread = projection.thread;
    const id = string(thread.id);
    const lineage = isRecord(thread.lineage) ? thread.lineage : {};
    const messages = facts(projection, 'messages').sort((a, b) => string(a.createdAt).localeCompare(string(b.createdAt)));
    rows.threads.push({ id, title: thread.title, deletedAt: thread.deletedAt, root: lineage.rootThreadId, parent: lineage.parentThreadId,
      text: lineage.relationshipToParent == null ? messages.find(message => message.role === 'user')?.text : undefined });
    rows.lastMessages.push({ thread: id, at: messages.length ? timestamp(messages.at(-1)!.createdAt) : null });
    facts(projection, 'providerSessions');
    for (const provider of facts(projection, 'providerThreads')) {
      const providerId = string(provider.id);
      if (provider.status === 'active') rows.active.add(providerId);
      if (isRecord(provider.nativeThreadRef) && typeof provider.nativeThreadRef.nativeId === 'string' && typeof provider.providerInstanceId === 'string') {
        sessions.push({ thread: id, driver: provider.driver, instance: provider.providerInstanceId, session: provider.nativeThreadRef.nativeId, createdAt: string(provider.createdAt) });
      }
    }
    for (const turn of facts(projection, 'providerTurns')) rows.turns.push({ id: string(turn.id), thread: id, providerThread: string(turn.providerThreadId), status: string(turn.status), startedAt: timestamp(turn.startedAt), completedAt: timestamp(turn.completedAt) });
    for (const wait of facts(projection, 'runtimeRequests')) {
      if (wait.providerTurnId === null) continue;
      rows.waits.push({ turn: string(wait.providerTurnId), createdAt: timestamp(wait.createdAt), resolvedAt: timestamp(wait.resolvedAt) });
    }
    for (const run of facts(projection, 'subagents')) {
      if (run.childThreadId === null) continue;
      rows.runs.push({ thread: string(run.childThreadId), startedAt: timestamp(run.startedAt), completedAt: timestamp(run.completedAt) });
    }
  }
  sessions.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { rows, sessions: sessions.map(({ createdAt: _createdAt, ...session }) => session) };
}
