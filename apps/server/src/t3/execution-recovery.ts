import { isRecord } from '@lar-factory/shared';

/** Snapshot envelope from T3 97e35bcf23e4 orchestrationV2.ts:3832.
 * Entity payloads remain opaque until consumers define their required fields.
 */
export class ExecutionRecovery {
  private sequence = -1;
  private retained?: { projection: { thread: Record<string, unknown>; messages: Record<string, unknown>[] }; observedAt: string };
  private readonly threadId: string;
  constructor(threadId: string) { this.threadId = threadId; }

  accept(value: unknown, now = Date.now()): boolean {
    if (!isRecord(value)) throw new Error('Invalid execution event');
    if (value.kind === 'synchronized') return false;
    if (value.kind !== 'snapshot') throw new Error('Execution refresh required');
    const sequence = value.snapshotSequence;
    if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence) || sequence < 0) throw new Error('Invalid execution sequence');
    if (sequence < this.sequence) return false;
    const projection = value.projection;
    if (!isRecord(projection) || !isRecord(projection.thread) || projection.thread.id !== this.threadId || typeof projection.updatedAt !== 'string' || !Number.isFinite(Date.parse(projection.updatedAt))) throw new Error('Invalid execution projection');
    for (const key of ['runs', 'attempts', 'nodes', 'subagents', 'providerSessions', 'providerThreads', 'providerTurns', 'runtimeRequests', 'messages']) {
      if (!Array.isArray(projection[key]) || !projection[key].every(isRecord)) throw new Error('Invalid execution facts');
    }
    if (sequence === this.sequence && this.retained) {
      for (const [key, incoming] of Object.entries(projection)) {
        const previous = this.retained.projection[key as keyof typeof this.retained.projection];
        if (!Array.isArray(incoming) || !Array.isArray(previous)) continue;
        const facts = new Map(previous.map(fact => [typeof fact.id === 'string' ? fact.id : JSON.stringify(fact), fact]));
        for (const fact of incoming) facts.set(typeof fact.id === 'string' ? fact.id : JSON.stringify(fact), fact);
        projection[key] = [...facts.values()];
      }
    }
    this.sequence = sequence;
    this.retained = { projection: { ...projection, thread: projection.thread, messages: projection.messages as Record<string, unknown>[] }, observedAt: new Date(now).toISOString() };
    return true;
  }

  observation() { return this.retained; }
}
