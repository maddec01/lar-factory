// Azure Repos through az, beside github.ts's gh calls: the default branch's head, files and blobs, and onboarding's branch,
// file and PR, opened without touching any checkout. A repository is organization/project/repository as its origin URL has them.

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommitTree } from '../github/github.ts';
import { az, decoded, withFile, type Az } from './azure-items.ts';
import { prStateOf, type AzurePr } from './azure-prs.ts';

/** The REST API version every `az devops invoke` call passes, as invoke's own default is 5.0. */
const API_VERSION = '7.1';

/** The az flags that name the repository's organization, with its project and repository names as az takes them. */
function names(repo: string) {
  const [organization, project, repository] = repo.split('/') as [string, string, string];
  return { org: ['--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'], project: decoded(project), repository: decoded(repository) };
}

/** A PR's id and organization, from its URL https://dev.azure.com/<org>/<project>/_git/<repository>/pullrequest/<id>. */
function prOf(url: string): { id: string; repo: string } {
  const match = /^https:\/\/dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/]+)\/pullrequest\/(\d+)$/.exec(url);
  if (!match) throw new Error(`${url} isn't an Azure Repos PR URL.`);
  return { id: match[4]!, repo: `${match[1]}/${match[2]}/${match[3]}` };
}

async function json<T>(run: Az, args: string[], repo: string): Promise<T> {
  return JSON.parse(await run([...args, ...names(repo).org])) as T;
}

/** The args of `az devops invoke` on a git resource of the repository, routed to its project, repository and then `route`. */
function invokeArgs(repo: string, resource: string, route: string[], more: string[]): string[] {
  const { project, repository } = names(repo);
  return ['devops', 'invoke', '--area', 'git', '--resource', resource, '--route-parameters', `project=${project}`, `repositoryId=${repository}`,
    ...route, ...more, '--api-version', API_VERSION];
}

/** `az devops invoke` on a git resource of the repository, whose JSON answer it parses. */
function invoke<T>(run: Az, repo: string, resource: string, route: string[], more: string[]): Promise<T> {
  return json<T>(run, invokeArgs(repo, resource, route, more), repo);
}

/** `invoke` posting `body`, written to a file of its own for az's --in-file. */
function post<T>(run: Az, repo: string, resource: string, route: string[], body: unknown): Promise<T> {
  return withFile(body, (file) => invoke<T>(run, repo, resource, route, ['--http-method', 'POST', '--in-file', file]));
}

/** `az repos <args>` on the repository. */
function repos<T>(run: Az, repo: string, args: string[]): Promise<T> {
  const { project, repository } = names(repo);
  return json<T>(run, ['repos', ...args, '--repository', repository, '--project', project], repo);
}

/** A file's text on the repository's default branch, read through the items API without a version; null when it has none there. */
export async function readDefaultBranchFile(repo: string, path: string, run: Az = az): Promise<string | null> {
  try {
    return (await invoke<{ content: string }>(run, repo, 'items', [], ['--query-parameters', `path=/${path}`, 'includeContent=true'])).content;
  } catch (err) {
    // TF401174 is Azure's "item could not be found".
    if (/TF401174/.test(err instanceof Error ? err.message : String(err))) return null;
    throw err;
  }
}

/** The branch's head, or null when the repository has no such branch; az's --filter matches the start of each name. */
async function branchHead(repo: string, branch: string, run: Az): Promise<string | null> {
  const refs = await repos<{ name: string; objectId: string }[]>(run, repo, ['ref', 'list', '--filter', `heads/${branch}`]);
  return refs.find((r) => r.name === `refs/heads/${branch}`)?.objectId ?? null;
}

/** The repository's default branch and the commit at its head. */
async function defaultBranchHead(repo: string, run: Az = az): Promise<{ branch: string; sha: string }> {
  const branch = (await repos<{ defaultBranch: string }>(run, repo, ['show'])).defaultBranch.replace(/^refs\/heads\//, '');
  const sha = await branchHead(repo, branch, run);
  if (!sha) throw new Error(`${repo} has no ${branch} branch to start from.`);
  return { branch, sha };
}

/** The commit's files, by path, from a recursive read of its tree; throws when Azure DevOps lists only part of them. */
async function commitTree(repo: string, commit: string, run: Az = az): Promise<CommitTree> {
  const { treeId } = await invoke<{ treeId: string }>(run, repo, 'commits', [`commitId=${commit}`], []);
  // invoke sets continuation_token from the X-MS-ContinuationToken header, which a tree too big for one answer gets.
  const { objectId, treeEntries, continuation_token } = await invoke<{
    objectId: string;
    treeEntries: { relativePath: string; mode: string; gitObjectType: string; objectId: string }[];
    continuation_token?: string | null;
  }>(run, repo, 'trees', [`sha1=${treeId}`], ['--query-parameters', 'recursive=true']);
  if (continuation_token) throw new Error('Azure DevOps listed only part of its files, since it has too many.');
  return { sha: objectId, files: new Map(treeEntries.filter((entry) => entry.gitObjectType === 'blob')
    .map((entry) => [entry.relativePath, { mode: entry.mode, sha: entry.objectId }])) };
}

/** The path of each file on the repository's default branch. */
async function defaultBranchFiles(repo: string, run: Az = az): Promise<string[]> {
  const { sha } = await defaultBranchHead(repo, run);
  return [...(await commitTree(repo, sha, run)).files.keys()];
}

/** A blob's text; az devops invoke writes an answer that isn't JSON only to a new --out-file. */
async function readBlob(repo: string, sha: string, run: Az = az): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar-azure-'));
  try {
    const file = join(dir, 'blob');
    await run([...invokeArgs(repo, 'blobs', [`sha1=${sha}`], ['--query-parameters', '$format=octetstream', '--accept-media-type', 'application/octet-stream',
      '--out-file', file]), ...names(repo).org]);
    return await readFile(file, 'utf8');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** The Git Repositories security namespace, and its GenericContribute bit, which lets a user push. */
const GIT_REPOSITORIES = '2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87';
const GENERIC_CONTRIBUTE = 4;

/** Whether az's login can push to the repository, as Azure DevOps evaluates GenericContribute on it for the caller. */
export async function canPush(repo: string, run: Az = az): Promise<boolean> {
  const { id, project } = await repos<{ id: string; project: { id: string } }>(run, repo, ['show']);
  const { value } = await json<{ value: boolean[] }>(run, ['devops', 'invoke', '--area', 'security', '--resource', 'permissions', '--route-parameters',
    `securityNamespaceId=${GIT_REPOSITORIES}`, `permissions=${GENERIC_CONTRIBUTE}`, '--query-parameters', `tokens=repoV2/${project.id}/${id}`,
    '--api-version', API_VERSION], repo);
  return value[0] === true;
}

/** Makes a branch on Azure Repos at the commit, leaving every checkout alone. */
async function createBranch(repo: string, branch: string, sha: string, run: Az = az): Promise<void> {
  await repos(run, repo, ['ref', 'create', '--name', `heads/${branch}`, '--object-id', sha]);
}

/** Whether the repository has the branch on Azure Repos. */
async function branchExists(repo: string, branch: string, run: Az = az): Promise<boolean> {
  return await branchHead(repo, branch, run) !== null;
}

/** The PR's URL, as Azure Repos shows it. */
const prUrl = (repo: string, id: number) => {
  const [organization, project, repository] = repo.split('/');
  return `https://dev.azure.com/${organization}/${project}/_git/${repository}/pullrequest/${id}`;
};

/** The URL of the open PR from the branch, or null when it has none. */
async function openPrFrom(repo: string, branch: string, run: Az = az): Promise<string | null> {
  const [pr] = await repos<AzurePr[]>(run, repo, ['pr', 'list', '--source-branch', branch, '--status', 'active']);
  return pr ? prUrl(repo, pr.pullRequestId) : null;
}

/** Opens a PR from `head` into `base`, set to complete its linked work items when it merges, and returns its URL. */
async function createPr(repo: string, pr: { base: string; head: string; title: string; body: string }, run: Az = az): Promise<string> {
  // The joined --name=value form keeps a title or description that starts with - from being read as an option.
  const created = await repos<AzurePr>(run, repo, ['pr', 'create', '--source-branch', pr.head, '--target-branch', pr.base, `--title=${pr.title}`,
    `--description=${pr.body}`, '--transition-work-items', 'true']);
  return prUrl(repo, created.pullRequestId);
}

/** Whether a PR, by its URL, is open, merged or closed without merging, as az repos pr show says: active, completed or abandoned. */
async function prState(url: string, run: Az = az): Promise<'OPEN' | 'MERGED' | 'CLOSED'> {
  const { id, repo } = prOf(url);
  const state = prStateOf(await json<AzurePr>(run, ['repos', 'pr', 'show', '--id', id], repo));
  return state === 'merged' ? 'MERGED' : state === 'closed' ? 'CLOSED' : 'OPEN';
}

/** Abandons a PR, by its URL, after a comment that says why. */
async function closePr(url: string, comment: string, run: Az = az): Promise<void> {
  const { id, repo } = prOf(url);
  // az repos pr has no comment command; a thread of one comment, closed, is a plain comment.
  await post(run, repo, 'pullRequestThreads', [`pullRequestId=${id}`], { comments: [{ content: comment, commentType: 1 }], status: 'closed' });
  await json(run, ['repos', 'pr', 'update', '--id', id, '--status', 'abandoned'], repo);
}

/** Reactivates a PR, by its URL, that was abandoned. */
async function reopenPr(url: string, run: Az = az): Promise<void> {
  const { id, repo } = prOf(url);
  await json(run, ['repos', 'pr', 'update', '--id', id, '--status', 'active'], repo);
}

/** The calls that open and follow onboarding's PR on Azure Repos, each named and shaped as github.ts's gh call is. */
export const AZURE_REPOS = {
  branchExists, closePr, commitTree, createBranch, createPr, defaultBranchFiles, defaultBranchHead, openPrFrom, prState, readBlob, reopenPr,
};
