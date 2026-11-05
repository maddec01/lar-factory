// Runtime discovery follows T3 apps/server/src/serverRuntimeState.ts.
// Exercised 2026-10-31 on nightly 0.1.6-nightly.20261030.3917: eight projects.
import { readJsonRecord } from '../json-file.ts';
import { boardProjects, type BoardSessions } from './board-projects.ts';
import { subscribeProjects } from './project-subscription.ts';
import type { ProjectProtocol, ProjectRead } from './project-protocol.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';

let pending: Promise<ProjectRead> | undefined;
let current: { key: string; origin: string; read: ProjectRead; stop: () => void; protocol: ReturnType<typeof boardProjects> } | undefined;
const subscribers = new Set<() => void>();
let announced: string | undefined;
let sessions: BoardSessions | undefined;

/** Has discovery read T3 with `own` instead of the board's Keychain session, from its next read. */
export function useProjectSessions(own: BoardSessions): void {
  sessions = own;
}

/** Calls `changed` when T3's project facts or availability differ from the last it announced, until the returned function is called. Thread updates never do. */
export function subscribeRepositoryProjects(changed: () => void): () => void {
  subscribers.add(changed);
  return () => { subscribers.delete(changed); };
}

function announce({ availability, observation }: ProjectRead) {
  const next = JSON.stringify([availability, observation?.projects]);
  if (next === announced) return;
  announced = next;
  for (const changed of subscribers) changed();
}

/** Sanitized discovery state for server callers, including the last successful observation. */
export function repositoryProjects(env: NodeJS.ProcessEnv = process.env): Promise<ProjectRead> {
  pending ??= discover(env).finally(() => { pending = undefined; });
  return pending;
}

/** The T3 server discovery last reached and the session it holds, unless T3 has stopped since. */
export function repositoryProjectAccess(): { origin: URL; protocol: Pick<ProjectProtocol, 'subscriptionSession'> } | undefined {
  return current?.key ? { origin: new URL(current.origin), protocol: current.protocol } : undefined;
}

async function discover(env: NodeJS.ProcessEnv): Promise<ProjectRead> {
  const path = serverRuntimePath(env);
  const runtime = readJsonRecord(path);
  const key = JSON.stringify([path, runtime?.origin, runtime?.serverVersion, runtime?.pid]);
  // The subscription says when this T3 stops, so while it shows T3 the board need not ask the process.
  if (current?.key === key && current.read.availability === 'available') return current.read;
  if (!t3Running(path) || typeof runtime?.origin !== 'string') {
    current?.stop();
    if (current) { current.key = ''; current.read = { ...current.read, availability: 'unavailable' }; announce(current.read); }
    return current?.read ?? { availability: 'unavailable' };
  }
  if (current?.key === key) return current.read;
  current?.stop();
  try {
    const version = typeof runtime.serverVersion === 'string' ? runtime.serverVersion : '';
    const protocol = boardProjects(runtime.origin, version, sessions);
    const read = await protocol.readProjects();
    const state = { key, origin: runtime.origin, protocol, read: { ...read, observation: read.observation ?? current?.read.observation }, stop: () => {} };
    current = state;
    // The HTTP read can lack what the shell supplies, so the first shell data always counts as a change.
    announced = undefined;
    state.stop = subscribeProjects(new URL(runtime.origin), version, protocol, read => {
      state.read = { ...read, observation: read.observation ?? state.read.observation };
      announce(state.read);
    });
    return state.read;
  } catch {
    return { availability: 'unavailable', ...(current?.read.observation ? { observation: current.read.observation } : {}) };
  }
}


let authorizing: Promise<ProjectRead> | undefined;
/** Coalesce requests and restart discovery after renewing the server-held session. */
export function reauthorizeRepositoryProjects(): Promise<ProjectRead> {
  authorizing ??= (async () => {
    await repositoryProjects();
    const state = current;
    if (!state) throw new Error('T3 unavailable');
    await state.protocol.reauthorize();
    state.stop();
    state.key = '';
    return repositoryProjects();
  })().finally(() => { authorizing = undefined; });
  return authorizing;
}
