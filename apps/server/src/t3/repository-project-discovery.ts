// Runtime discovery follows T3 apps/server/src/serverRuntimeState.ts.
// Exercised 2026-10-31 on nightly 0.1.6-nightly.20261030.3917: eight projects.
import { readJsonRecord } from '../json-file.ts';
import { boardProjects } from './board-projects.ts';
import { subscribeProjects } from './project-subscription.ts';
import type { ProjectProtocol, ProjectRead } from './project-protocol.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';

let pending: Promise<ProjectRead> | undefined;
let current: { key: string; origin: string; read: ProjectRead; stop: () => void; protocol: ReturnType<typeof boardProjects> } | undefined;

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
  if (!t3Running(path) || typeof runtime?.origin !== 'string') {
    current?.stop();
    if (current) { current.key = ''; current.read = { ...current.read, availability: 'unavailable' }; }
    return current?.read ?? { availability: 'unavailable' };
  }
  const key = JSON.stringify([path, runtime.origin, runtime.serverVersion, runtime.pid]);
  if (current?.key === key) return current.read;
  current?.stop();
  try {
    const version = typeof runtime.serverVersion === 'string' ? runtime.serverVersion : '';
    const protocol = boardProjects(runtime.origin, version);
    const read = await protocol.readProjects();
    const state = { key, origin: runtime.origin, protocol, read: { ...read, observation: read.observation ?? current?.read.observation }, stop: () => {} };
    current = state;
    state.stop = subscribeProjects(new URL(runtime.origin), version, protocol, read => {
      state.read = { ...read, observation: read.observation ?? state.read.observation };
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
