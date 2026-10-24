// Finds the repository project Start opens a card's thread in: the T3 project whose
// folder is a main checkout with the repository as its git origin. Each failure is a
// hint that names the fix; the board never adds or changes T3 projects.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { liveProjects } from '../stats/item-stats.ts';
import { statsDbPath } from './t3-settings.ts';
import { runTool } from '../tools/run-tool.ts';
import type { RepoConfig } from '@mux-factory/shared';

export type RepositoryProject = { projectId: string; error?: undefined } | { error: string };

/** The repository project's id for `repo`, or why there isn't exactly one. */
export async function repositoryProject(repo: string, repos: readonly RepoConfig[],
  env: NodeJS.ProcessEnv = process.env): Promise<RepositoryProject> {
  if (!repos.some((r) => r.repo.toLowerCase() === repo.toLowerCase())) {
    return { error: `${repo} isn't in config.json; add it with a role` };
  }
  const db = statsDbPath(env);
  const home = env.HOME ?? '';
  let projects;
  try { projects = liveProjects(db, home); }
  catch { return { error: `Can't read T3 Code's projects at ${db}` }; }
  const origins = await Promise.all(projects.map((p) => mainCheckout(p.folder) ? originUrl(p.folder) : null));
  const matches = projects.filter((_, i) => githubRepo(origins[i] ?? null)?.toLowerCase() === repo.toLowerCase());
  if (matches.length === 1) return { projectId: matches[0]!.id };
  if (!matches.length) return { error: `No T3 project is a checkout of ${repo}; add the checkout in T3 Code` };
  const folders = matches.map((p) => tilde(p.folder, home)).sort().join(', ');
  return { error: `Several T3 projects are checkouts of ${repo}: ${folders}; remove all but one in T3 Code` };
}

/** Whether `folder` is a main checkout: its `.git` is a directory, not a worktree's `.git` file. */
function mainCheckout(folder: string): boolean {
  return statSync(join(folder, '.git'), { throwIfNoEntry: false })?.isDirectory() ?? false;
}

/** The checkout's `origin` URL, or null when it has none. */
async function originUrl(folder: string): Promise<string | null> {
  const { code, stdout } = await runTool('git', ['-C', folder, 'remote', 'get-url', 'origin'], { timeout: 10_000 });
  return code === 0 ? stdout.trim() : null;
}

/** `owner/repo` from an https or ssh GitHub URL, with or without `.git`. */
function githubRepo(url: string | null): string | null {
  return url?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

/** `folder` with the home folder shown as `~`. */
function tilde(folder: string, home: string): string {
  return home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder;
}
