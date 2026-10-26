// Finds the repository project Start opens a card's thread in: the T3 project whose
// folder is a main checkout with the repository as its git origin. Each failure is a
// hint that names the fix; the board never adds or changes T3 projects. The same checkouts
// tell whether a listed repository is on Azure DevOps, which only then needs az.

import { statSync } from 'node:fs';
import { join } from 'node:path';
import { runTool } from '../tools/run-tool.ts';
import { liveProjects } from './t3-db.ts';
import { statsDbPath } from './t3-settings.ts';
import type { RepoConfig } from '@lar-factory/shared';

export type RepositoryProject = { projectId: string; error?: undefined } | { error: string };

/** The repository project's id for `repo`, or why there isn't exactly one. */
export async function repositoryProject(repo: string, repos: readonly { repo: string }[],
  env: NodeJS.ProcessEnv = process.env): Promise<RepositoryProject> {
  if (!repos.some((r) => r.repo.toLowerCase() === repo.toLowerCase())) {
    return { error: `${repo} isn't onboarded; add it to the board's repositories` };
  }
  return (await projectFinder(env))(repo);
}

/** Each configured repository's project hint: null when Start finds its repository project, else why not. */
export async function repositoryProjectHints(repos: readonly RepoConfig[],
  env: NodeJS.ProcessEnv = process.env): Promise<Record<string, string | null>> {
  const find = await projectFinder(env);
  return Object.fromEntries(repos.map(({ repo }) => [repo, find(repo).error ?? null]));
}

/** Whether a listed repository's checkout has its origin on Azure DevOps; false when T3's projects can't be read. */
export async function anyOnAzureDevOps(repos: readonly { repo: string }[], env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  let found;
  try { found = await checkouts(env); }
  catch { return false; }
  const listed = new Set(repos.map(({ repo }) => repo.toLowerCase()));
  return found.some(({ origin }) => origin !== null && onAzureDevOps(origin) && listed.has(azureRepo(origin)?.toLowerCase() ?? ''));
}

/** Whether an origin URL is on Azure DevOps: dev.azure.com, its ssh host, or an older *.visualstudio.com organization. */
export function onAzureDevOps(url: string): boolean {
  const host = originHost(url);
  return host === 'dev.azure.com' || host.endsWith('.dev.azure.com') || host.endsWith('.visualstudio.com');
}

/** An https or ssh origin URL's host, lowercased. */
export function originHost(url: string): string {
  return url.match(/^(?:[a-z+]+:\/\/)?(?:[^@/]+@)?([^/:]+)/i)?.[1]?.toLowerCase() ?? '';
}

interface Checkout { id: string; title: string; folder: string; origin: string | null }

/** T3's live projects with each one's `origin` URL, null for a worktree or a checkout without one; throws when T3's projects can't be read. */
export async function checkouts(env: NodeJS.ProcessEnv): Promise<Checkout[]> {
  const projects = liveProjects(statsDbPath(env), env.HOME ?? '');
  const origins = await Promise.all(projects.map((p) => mainCheckout(p.folder) ? originUrl(p.folder) : null));
  return projects.map((p, i) => ({ ...p, origin: origins[i] ?? null }));
}

/** Reads T3's live projects and their checkouts' origins once, and finds a repository's project among them. */
async function projectFinder(env: NodeJS.ProcessEnv): Promise<(repo: string) => RepositoryProject> {
  const home = env.HOME ?? '';
  let projects: Checkout[];
  try { projects = await checkouts(env); }
  catch { return () => ({ error: `Can't read T3 Code's projects at ${statsDbPath(env)}` }); }
  return (repo) => {
    const matches = projects.filter((p) => githubRepo(p.origin)?.toLowerCase() === repo.toLowerCase());
    if (matches.length === 1) return { projectId: matches[0]!.id };
    if (!matches.length) return { error: `No T3 project is a checkout of ${repo}; add the checkout in T3 Code` };
    const folders = matches.map((p) => tilde(p.folder, home)).sort().join(', ');
    return { error: `Several T3 projects are checkouts of ${repo}: ${folders}; remove all but one in T3 Code` };
  };
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
export function githubRepo(url: string | null): string | null {
  return url?.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?\/?$/)?.[1] ?? null;
}

/** `project/repo` from an https or ssh Azure DevOps URL, whose https URLs put `_git` between them. */
export function azureRepo(url: string): string | null {
  return githubRepo(url.replace('/_git/', '/'));
}

/** `folder` with the home folder shown as `~`. */
function tilde(folder: string, home: string): string {
  return home && folder.startsWith(`${home}/`) ? `~${folder.slice(home.length)}` : folder;
}
