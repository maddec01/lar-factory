// Azure Repos through az, beside github.ts's gh calls: the default branch's head, files and blobs, and the commit, branch
// and PR operations. A repository is organization/project/repository as its origin URL has them.

import { decodePart } from '@lar-factory/shared';
import type { CommitTree } from '../github/github.ts';
import { API_VERSION, az, azureGet, orgFlags, refusalOf, withFile, type Az } from './azure-items.ts';
import { prStateOf, type AzurePr } from './azure-prs.ts';

/** The az flags that name the repository's organization, with its project and repository names as az takes them. */
function names(repo: string) {
  const [organization, project, repository] = repo.split('/') as [string, string, string];
  return { org: orgFlags(organization), project: decodePart(project), repository: decodePart(repository) };
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

/** The branch's head, or null when the repository has no such branch; az's --filter matches the start of each name. */
async function branchHead(repo: string, branch: string, run: Az = az): Promise<string | null> {
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

/** The Git Repositories security namespace, and its GenericContribute bit, which lets a user push. */
const GIT_REPOSITORIES = '2e9eb7ed-3c0a-47d4-87c1-0ffdd275fd87';
const GENERIC_CONTRIBUTE = 4;

/** Whether az's login can push to the repository, as Azure DevOps evaluates GenericContribute on it for the caller. */
export async function canPush(repo: string, run: Az = az): Promise<boolean> {
  const { id, project } = await repos<{ id: string; project: { id: string } }>(run, repo, ['show']);
  const [organization] = repo.split('/');
  const { value } = await azureGet<{ value: unknown[] }>(
    `https://dev.azure.com/${organization}/_apis/permissions/${GIT_REPOSITORIES}/${GENERIC_CONTRIBUTE}?tokens=${encodeURIComponent(`repoV2/${project.id}/${id}`)}&api-version=${API_VERSION}`, run);
  if (value?.length !== 1 || typeof value[0] !== 'boolean') throw new Error('Azure DevOps returned no push permission decision');
  return value[0];
}

/** Whether the repository has the branch on Azure Repos. */
async function branchExists(repo: string, branch: string, run: Az = az): Promise<boolean> {
  return await branchHead(repo, branch, run) !== null;
}

/** A PR's URL, from its repository and id. */
export const prUrl = (repo: string, id: number) => {
  const [organization, project, repository] = repo.split('/');
  return `https://dev.azure.com/${organization}/${project}/_git/${repository}/pullrequest/${id}`;
};

/** Replaces a PR's description, by its URL. */
async function editPrBody(url: string, body: string, run: Az = az): Promise<void> {
  const { id, repo } = prOf(url);
  await json(run, ['repos', 'pr', 'update', '--id', id, `--description=${body}`], repo);
}

/**
 * Whether a PR, by its URL, is open, merged or closed without merging, as az repos pr show says: active, completed or
 * abandoned. Throws NotFound or AccessLost when Azure DevOps says so.
 */
async function prState(url: string, run: Az = az): Promise<'OPEN' | 'MERGED' | 'CLOSED'> {
  const { id, repo } = prOf(url);
  const state = prStateOf(await json<AzurePr>(run, ['repos', 'pr', 'show', '--id', id], repo).catch((err: unknown) => { throw refusalOf(err); }));
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

/** The calls that open and follow the board's PRs on Azure Repos, each named and shaped as github.ts's gh call is. */
export const AZURE_REPOS = {
  branchExists, closePr, commitTree, defaultBranchHead, editPrBody, prState, reopenPr, openPrByHead,
};

/** Finds an active PR with the exact source branch. */
async function openPrByHead(repo: string, branch: string, run: Az = az): Promise<string | null> {
  const prs = await repos<{ sourceRefName: string; pullRequestId: number }[]>(run, repo, ['pr', 'list', '--status', 'active', '--source-branch', branch]);
  const pr = prs.find(pr => pr.sourceRefName === `refs/heads/${branch}`);
  return pr ? prUrl(repo, pr.pullRequestId) : null;
}
