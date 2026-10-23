// Finds the repository project Start opens a card's thread in: the T3 project whose
// folder is the repository's configured checkout. Each check's failure is a hint
// that names the fix; the board never adds or changes T3 projects.

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { expandHome } from './config.ts';
import { projectIdAt, statsDbPath } from './item-stats.ts';
import type { RepoConfig } from './model.ts';

export type RepositoryProject = { projectId: string; error?: undefined } | { error: string };

/** The repository project's id for `repo`, or the first check that fails. */
export async function repositoryProject(repo: string, repos: readonly RepoConfig[],
  env: NodeJS.ProcessEnv = process.env): Promise<RepositoryProject> {
  const entry = repos.find((r) => r.repo.toLowerCase() === repo.toLowerCase());
  if (!entry) return { error: `${repo} isn't in config.json; add it with a path and role` };
  const fix = 'update its path in config.json';
  let folder: string;
  try { folder = expandHome(entry.path, env.HOME); }
  catch (err) { return { error: (err as Error).message }; }
  if (!existsSync(folder)) return { error: `${repo.split('/')[1]} isn't at ${entry.path}; ${fix}` };
  const origin = githubRepo(await originUrl(folder));
  if (origin?.toLowerCase() !== repo.toLowerCase()) {
    return { error: `${entry.path} is a checkout of ${origin ?? 'no GitHub repository'}, not ${repo}; ${fix}` };
  }
  const db = statsDbPath(env);
  let projectId: string | null;
  try { projectId = projectIdAt(db, folder, env.HOME ?? ''); }
  catch { return { error: `Can't read T3 Code's projects at ${db}` }; }
  return projectId ? { projectId } : { error: `No T3 project for ${entry.path}; add it in T3 Code` };
}

/** The checkout's `origin` URL, or null when it has none or isn't a git checkout. */
function originUrl(folder: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', ['-C', folder, 'remote', 'get-url', 'origin'], { timeout: 10_000 },
      (err, stdout) => resolve(err ? null : stdout.trim()));
  });
}

/** `owner/repo` from an https or ssh GitHub URL, with or without `.git`. */
function githubRepo(url: string | null): string | null {
  return url?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}
