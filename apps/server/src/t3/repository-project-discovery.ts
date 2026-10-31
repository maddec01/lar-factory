// Runtime discovery follows T3 apps/server/src/serverRuntimeState.ts.
// Exercised 2026-10-31 on nightly 0.1.6-nightly.20261030.3917: eight projects.
import { readJsonRecord } from '../json-file.ts';
import { boardProjects } from './board-projects.ts';
import { subscribeProjects } from './project-subscription.ts';
import type { ProjectRead } from './project-protocol.ts';
import { serverRuntimePath, t3Running } from './t3-settings.ts';

let pending: Promise<ProjectRead> | undefined;
let current: { key: string; read: ProjectRead; stop: () => void } | undefined;

/** Sanitized discovery state for server callers, including the last successful observation. */
export function repositoryProjects(env: NodeJS.ProcessEnv = process.env): Promise<ProjectRead> {
  pending ??= discover(env).finally(() => { pending = undefined; });
  return pending;
}

async function discover(env: NodeJS.ProcessEnv): Promise<ProjectRead> {
  const path = serverRuntimePath(env);
  const runtime = readJsonRecord(path);
  if (!t3Running(path) || typeof runtime?.origin !== 'string' || typeof runtime.serverVersion !== 'string') {
    current?.stop();
    if (current) { current.key = ''; current.read = { ...current.read, availability: 'unavailable' }; }
    return current?.read ?? { availability: 'unavailable' };
  }
  const key = JSON.stringify([path, runtime.origin, runtime.serverVersion]);
  if (current?.key === key) return current.read;
  current?.stop();
  try {
    const protocol = boardProjects(runtime.origin, runtime.serverVersion);
    const state = { key, read: await protocol.readProjects(), stop: () => {} };
    current = state;
    state.stop = subscribeProjects(new URL(runtime.origin), runtime.serverVersion, protocol, read => {
      state.read = { ...read, observation: read.observation ?? state.read.observation };
    });
    return state.read;
  } catch {
    return { availability: 'unavailable', ...(current?.read.observation ? { observation: current.read.observation } : {}) };
  }
}
