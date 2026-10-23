// Reads ../config.json (the factory's shared config) relative to board/.

import { readFileSync } from 'node:fs';
import type { RepoConfig } from './model.ts';

export interface BoardConfig {
  owner: string;
  title: string;
  /** Project number; found by title when config.json doesn't name it. */
  number: number | null;
  repos: RepoConfig[];
  port: number;
  /** The port config.json names; BOARD_PORT overrides it for other runs. */
  configuredPort: number;
  refreshSeconds: number;
  /** T3 Code project that Start opens threads in, as written in config.json (may start with ~). */
  t3Project: string | null;
}

export const CONFIG_URL = new URL('../../config.json', import.meta.url);

export function loadConfig(url: URL = CONFIG_URL): BoardConfig {
  const raw = JSON.parse(readFileSync(url, 'utf8')) as {
    project?: { owner?: string; title?: string; number?: number };
    repos?: RepoConfig[];
    board?: { port?: number; refreshSeconds?: number; t3Project?: string };
  };
  const owner = raw.project?.owner;
  const title = raw.project?.title;
  if (!owner || !title) throw new Error(`${url.pathname}: project.owner and project.title are required`);
  return {
    owner,
    title,
    number: raw.project?.number ?? null,
    repos: (raw.repos ?? []).map((entry) => checkRepo(entry, url)),
    port: Number(process.env.BOARD_PORT ?? raw.board?.port ?? 4317),
    configuredPort: raw.board?.port ?? 4317,
    refreshSeconds: raw.board?.refreshSeconds ?? 45,
    t3Project: raw.board?.t3Project ?? null,
  };
}

function checkRepo(entry: RepoConfig, url: URL): RepoConfig {
  const fail = (problem: string) => { throw new Error(`${url.pathname}: ${entry.repo ?? 'a repos entry'} ${problem}`); };
  for (const field of ['path', 'role'] as const) {
    if (typeof entry[field] !== 'string' || !entry[field].trim()) fail(`needs a "${field}"`);
  }
  if (!entry.path.startsWith('~/')) fail(`"path" must start with ~/, since config.json is public: ${entry.path}`);
  return entry;
}

/** Expands a leading ~, which execFile leaves alone; config.json is public, so it can't name the home folder. */
export function expandHome(path: string, home: string | undefined): string {
  if (path !== '~' && !path.startsWith('~/')) return path;
  if (!home) throw new Error(`HOME is not set, so ${path} can't be expanded.`);
  return home + path.slice(1);
}
