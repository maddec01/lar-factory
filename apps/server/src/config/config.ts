// Reads the repo root's config.json (the factory's shared config), or the file
// BOARD_CONFIG_FILE names (the board app ships its own copy).

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ITEM_SOURCE_KINDS } from '@lar-factory/shared';
import type { RepoConfig } from '@lar-factory/shared';

export interface BoardConfig {
  owner: string;
  title: string;
  /** Project number; found by title when config.json doesn't name it. */
  number: number | null;
  repos: RepoConfig[];
  refreshSeconds: number;
}

export const CONFIG_URL = new URL('../../../../config.json', import.meta.url);

/** BOARD_CONFIG_FILE's absolute path when set, else the checkout's config.json. */
export function configUrl(env: NodeJS.ProcessEnv = process.env): URL {
  const file = env.BOARD_CONFIG_FILE;
  return file ? pathToFileURL(file) : CONFIG_URL;
}

export function loadConfig(url: URL = configUrl()): BoardConfig {
  if (!existsSync(url)) throw new Error(`${fileURLToPath(url)}: no config file there`);
  const raw = JSON.parse(readFileSync(url, 'utf8')) as {
    project?: { owner?: string; title?: string; number?: number };
    repos?: RepoConfig[];
    board?: { refreshSeconds?: number };
  };
  const owner = raw.project?.owner;
  const title = raw.project?.title;
  if (!owner || !title) throw new Error(`${fileURLToPath(url)}: project.owner and project.title are required`);
  return {
    owner,
    title,
    number: raw.project?.number ?? null,
    repos: (raw.repos ?? []).map((entry) => checkRepo(entry, url)),
    refreshSeconds: raw.board?.refreshSeconds ?? 45,
  };
}

/** A repos entry with a role, and its item source when it names one; an older entry's checkout `path` is dropped. */
function checkRepo(entry: RepoConfig, url: URL): RepoConfig {
  const name = entry.repo ?? 'a repos entry';
  if (typeof entry.role !== 'string' || !entry.role.trim()) throw new Error(`${fileURLToPath(url)}: ${name} needs a "role"`);
  if (entry.items !== undefined && !ITEM_SOURCE_KINDS.includes(entry.items)) {
    throw new Error(`${fileURLToPath(url)}: ${name} has "items": ${JSON.stringify(entry.items)}; use "project" or "issues"`);
  }
  return { repo: entry.repo, platform: entry.platform, role: entry.role, ...(entry.items ? { items: entry.items } : {}) };
}
