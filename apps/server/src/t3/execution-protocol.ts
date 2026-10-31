import { isRecord } from '@lar-factory/shared';
import { ExecutionRecovery } from './execution-recovery.ts';
import { type ProjectProtocol, type ProjectRead } from './project-protocol.ts';
import { subscribeProjects } from './project-subscription.ts';

export interface ExecutionRead {
  availability: ProjectRead['availability'];
  observation?: ReturnType<ExecutionRecovery['observation']>;
}

/** Uses the board's existing Keychain session and ticket/reconnect transport.
 * Contract: T3 97e35bcf23e4 orchestrationV2.ts:3832 and rpc.ts:1810.
 * Domain events force a fresh snapshot rather than guessing projection changes.
 */
export function subscribeExecution(origin: URL, version: string, protocol: ProjectProtocol,
  threadId: string, onChange: (read: ExecutionRead) => void): () => void {
  if (!threadId.trim()) throw new Error('Thread ID required');
  const recovery = new ExecutionRecovery(threadId);
  return subscribeProjects(origin, version, protocol,
    read => onChange({ availability: read.availability, observation: recovery.observation() }), {
      tag: 'orchestration.subscribeThread', payload: { threadId },
      accept(value) {
        if (recovery.accept(value)) onChange({ availability: 'available', observation: recovery.observation() });
      },
    });
}

/** A bounded authenticated thread-ID lookup. Failure retains no invented empty result. */
export function readExecution(origin: URL, version: string, protocol: ProjectProtocol,
  threadId: string): Promise<ExecutionRead> {
  return new Promise(resolve => {
    const finish = (read: ExecutionRead) => { queueMicrotask(() => { clearTimeout(timer); stop(); resolve(read); }); };
    const timer = setTimeout(() => finish({ availability: 'unavailable' }), 15_000);
    const stop = subscribeExecution(origin, version, protocol, threadId, finish);
  });
}

export interface ThreadFamilyRead {
  availability: ProjectRead['availability'];
  observation?: { threads: Record<string, unknown>[]; snapshotSequence: number; observedAt: string };
}

/** Source contract orchestrationV2.ts:3650. Includes active family members. */
export function readThreadFamily(origin: URL, version: string, protocol: ProjectProtocol,
  threadId: string): Promise<ThreadFamilyRead> {
  if (!threadId.trim()) throw new Error('Thread ID required');
  return new Promise(resolve => {
    const finish = (read: ThreadFamilyRead) => { queueMicrotask(() => { clearTimeout(timer); stop(); resolve(read); }); };
    const timer = setTimeout(() => finish({ availability: 'unavailable' }), 15_000);
    const stop = subscribeProjects(origin, version, protocol, read => finish({ availability: read.availability }), {
      tag: 'orchestration.getThreadFamily', payload: { threadId },
      accept(value) {
        if (!isRecord(value) || !Number.isSafeInteger(value.snapshotSequence) || (value.snapshotSequence as number) < 0 || !Array.isArray(value.threads) || !value.threads.every(isRecord)) throw new Error('Invalid thread family');
        finish({ availability: 'available', observation: { threads: value.threads, snapshotSequence: value.snapshotSequence as number, observedAt: new Date().toISOString() } });
      },
    });
  });
}

/** Exact pinned contract, not a claim about arbitrary T3 releases.
 * SQL association, transcript mapping and usage remain unchanged for #708/#709.
 * Azure policies/reviewer readiness are absent from this protocol.
 */
export const executionCapabilities = {
  source: '97e35bcf23e4dcf34c2dcffadd37c08db0e01e52',
  threadIdLookup: true, threadSubscription: true, activeThreadFamily: true,
  runs: true, attempts: true, subagents: true, providerTurns: true,
  runtimeRequests: true, messages: true,
  azurePolicies: false, azureReviewerVotes: false, transcriptUsage: false,
} as const;

export interface ShellRead {
  availability: ProjectRead['availability'];
  observation?: { snapshot: Record<string, unknown>; observedAt: string };
}

/** Full shell snapshots include thread worktree and PR context where populated.
 * Refresh on incremental changes; never infer missing/deleted threads from failure.
 */
export function subscribeExecutionShell(origin: URL, version: string, protocol: ProjectProtocol,
  onChange: (read: ShellRead) => void): () => void {
  let observation: ShellRead['observation'];
  let sequence = -1;
  return subscribeProjects(origin, version, protocol,
    read => onChange({ availability: read.availability, observation }), {
      tag: 'orchestration.subscribeShell', payload: { requestCompletionMarker: true, omitIdleSubagents: false, omitOlderSettled: false },
      accept(value) {
        if (!isRecord(value)) throw Error('Invalid shell event');
        if (value.kind === 'synchronized') return;
        if (value.kind !== 'snapshot') {
          if (!observation || !Number.isSafeInteger(value.sequence)) throw Error('Shell refresh required');
          if ((value.sequence as number) <= sequence) return;
          const snapshot = { ...observation.snapshot };
          const threadEvent = value.kind === 'thread.updated' || value.kind === 'thread.removed';
          const projectEvent = value.kind === 'project.updated' || value.kind === 'project.removed';
          if (!threadEvent && !projectEvent) throw Error('Unknown shell event');
          if (threadEvent && !['active', 'archive'].includes(String(value.location))) throw Error('Invalid thread location');
          const key = projectEvent ? 'projects' : value.location === 'archive' ? 'archivedThreads' : 'threads';
          const record = projectEvent ? value.project : value.thread;
          const removed = value.kind === 'thread.removed' || value.kind === 'project.removed';
          const id = removed ? projectEvent ? value.projectId : value.threadId : isRecord(record) ? record.id : undefined;
          if (typeof id !== 'string') throw Error('Invalid shell ID');
          snapshot[key] = (snapshot[key] as Record<string, unknown>[]).filter(entry => entry.id !== id);
          if (!removed) (snapshot[key] as Record<string, unknown>[]).push(record as Record<string, unknown>);
          sequence = value.sequence as number;
          snapshot.snapshotSequence = sequence;
          observation = { snapshot, observedAt: new Date().toISOString() };
          onChange({ availability: 'available', observation });
          return;
        }
        if (!isRecord(value.snapshot)) throw Error('Invalid shell snapshot');
        const snapshot = value.snapshot;
        if (!Number.isSafeInteger(snapshot.snapshotSequence) || (snapshot.snapshotSequence as number) < 0 || !['projects', 'threads', 'archivedThreads'].every(key => Array.isArray(snapshot[key]) && snapshot[key].every(isRecord))) throw Error('Invalid shell snapshot');
        if ((snapshot.snapshotSequence as number) < sequence) return;
        if (snapshot.snapshotSequence === sequence && observation) {
          for (const key of ['projects', 'threads', 'archivedThreads']) {
            const previous = observation.snapshot[key] as Record<string, unknown>[];
            const incoming = snapshot[key] as Record<string, unknown>[];
            const records = new Map(previous.map(record => [record.id, record]));
            for (const record of incoming) records.set(record.id, record);
            snapshot[key] = [...records.values()];
          }
        }
        sequence = snapshot.snapshotSequence as number;
        observation = { snapshot, observedAt: new Date().toISOString() };
        onChange({ availability: 'available', observation });
      },
    });
}
