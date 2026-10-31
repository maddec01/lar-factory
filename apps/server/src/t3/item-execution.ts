import { isRecord, type ItemThread } from '@lar-factory/shared';
import { namedIssue, issueKey } from '../threads/item-threads.ts';
import { readJsonRecord } from '../json-file.ts';
import { boardProjects } from './board-projects.ts';
import { readExecution, subscribeExecutionShell, type ShellRead, type ExecutionRead } from './execution-protocol.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';

/** Association uses the first user message, never a shell's latest message. */
export function executionItemThreads(shells: Record<string, unknown>[], reads: Map<string, ExecutionRead>) {
  const byIssue = new Map<string, ItemThread[]>();
  for (const shell of shells) {
    if (typeof shell.id !== 'string' || shell.deletedAt) continue;
    const lineage = shell.lineage;
    if (isRecord(lineage) && lineage.relationshipToParent != null) continue;
    const read = reads.get(shell.id);
    if (read?.availability !== 'available' || !read.observation) throw Error('Execution unavailable');
    const messages = read.observation.projection.messages.filter(message => message.role === 'user')
      .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const issue = typeof messages[0]?.text === 'string' ? namedIssue(messages[0].text) : null;
    if (!issue) continue;
    if (typeof shell.updatedAt !== 'string' || !Number.isFinite(Date.parse(shell.updatedAt))) throw Error('Invalid execution timestamp');
    const state: ItemThread['state'] = shell.pendingRuntimeRequest ? 'needs you'
      : ['preparing', 'starting', 'running', 'waiting'].includes(String(shell.status)) ? 'running'
      : ['failed', 'interrupted', 'cancelled'].includes(String(shell.status)) ? 'stopped' : 'done';
    const thread: ItemThread = { id: shell.id, title: typeof shell.title === 'string' ? shell.title : shell.id, state, updated: shell.updatedAt };
    byIssue.set(issue, [...(byIssue.get(issue) ?? []), thread]);
  }
  for (const threads of byIssue.values()) threads.sort((a, b) => b.updated.localeCompare(a.updated));
  return (repo: string, number: number) => byIssue.get(issueKey(repo, number));
}

let current: { key: string; stop(): void; shell?: ShellRead; lookup?: ReturnType<typeof executionItemThreads>; available: boolean; shells?: Record<string, unknown>[]; reads?: Map<string, ExecutionRead>; observedAt?: string } | undefined;
/** The server refresh reads only a completed observation. Failures never become empty success. */
export function protocolItemThreads(repo: string, number: number): ItemThread[] | 'unavailable' | undefined {
  const path = serverRuntimePath(process.env);
  const runtime = readJsonRecord(path);
  if (!t3Running(path) || typeof runtime?.origin !== 'string' || typeof runtime.serverVersion !== 'string') {
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
      const version = runtime.serverVersion;
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
            state.reads = new Map(entries);
            if (pending || state.shell?.availability !== 'available') continue;
            state.lookup = executionItemThreads(shells, entries);
            state.shells = shells;
            state.observedAt = read.observation.observedAt;
            state.available = true;
          }
        } catch { state.available = false; }
        finally { running = false; if (pending) void drain(); }
      };
      state.reads = entries;
      state.stop = subscribeExecutionShell(origin, version, protocol, read => {
        state.shell = read;
        state.available = false;
        pending = read;
        void drain();
      });
    } catch { state.available = false; }
  }
  return current.available ? current.lookup?.(repo, number) : 'unavailable';
}

/** Unavailable observations throw so callers retain an uncertain run. */
export function protocolThreadByTitle(projectId: string, title: string): { threadId: string; latest: string | null } | null {
  protocolItemThreads('', 0);
  if (!current?.available) throw Error('T3 execution unavailable');
  const shell = current.shells?.filter(shell => shell.projectId === projectId && shell.title === title && !shell.deletedAt)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0];
  if (!shell || typeof shell.id !== 'string') return null;
  const messages = current.reads?.get(shell.id)?.observation?.projection.messages
    .filter(message => message.role === 'assistant').sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return { threadId: shell.id, latest: typeof messages?.[0]?.text === 'string' ? messages[0].text : null };
}
