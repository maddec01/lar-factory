// The checks onboarding's Checks step runs after the command checks, one at a time so Retry reruns one: that the
// picked T3 project's folder is the main checkout of the repository's origin and its only one, as Start needs; that the
// item source can be read; and that the login, gh's or on Azure DevOps az's, can push to the repository. A failed check
// names its fix.

import { SETUP_CHECKS, decodePart, onAzure, sameRepo, shownRepo, type RepositoryItemSource, type SetupCheckId, type SetupCheckResult } from '@lar-factory/shared';
import { az, type Az } from '../azure/azure-items.ts';
import { azureBoard } from '../azure/azure-board.ts';
import { canPush as azureCanPush } from '../azure/azure-repos.ts';
import { isItemSource, isRepo } from '../config/repository-config.ts';
import { canPush, fetchRepoIssues, message } from '../github/github.ts';
import { ReadProblem } from '../items/item-source.ts';
import { type Checkout, azureRepo, checkouts, githubRepo, onAzureDevOps } from '../t3/repository-project.ts';

/** What the checks read: T3's projects with their origins, the item source's items, and the login's push permission. */
export interface SetupCheckReads {
  checkouts(): Promise<Checkout[]>;
  /** How many items the item source has for the board; throws why it can't be read. */
  countItems(source: RepositoryItemSource, repo: string): Promise<number>;
  canPush(repo: string): Promise<boolean>;
}

/** The reads through gh, and for an Azure DevOps repository through `run` as az. */
export function setupCheckReads(run: Az = az): SetupCheckReads {
  return {
    checkouts: () => checkouts(process.env),
    countItems: async (source, repo) => {
      return source.kind === 'azure-board' ? (await azureBoard([repo], source.team, run).read()).items.length : (await fetchRepoIssues(repo)).length;
    },
    canPush: (repo) => (onAzure(repo) ? azureCanPush(repo, run) : canPush(repo)),
  };
}

/** The repository an origin names: organization/project/repository on Azure DevOps, else GitHub's owner/name. */
const originRepo = (origin: string | null): string | null => origin && onAzureDevOps(origin) ? azureRepo(origin) : githubRepo(origin);

/** The login that reads and pushes the repository: az's on Azure DevOps, gh's on GitHub. */
const tool = (repo: string) => (onAzure(repo) ? 'az' : 'gh');

const failed = (problem: string, fix: string, command?: string): SetupCheckResult => ({ passed: false, problem, fix, ...command && { command } });

async function checkCheckout(key: string, projectId: string, reads: SetupCheckReads): Promise<SetupCheckResult> {
  const repo = shownRepo(key);
  let projects;
  try { projects = await reads.checkouts(); }
  catch (err) { return failed(`Can't read T3 Code's projects: ${message(err)}`, 'Open T3 Code, then Retry.'); }
  const picked = projects.find((p) => p.id === projectId);
  if (!picked) return failed('This project is no longer in T3 Code.', 'Go back and choose another.');
  if (!picked.origin) return failed(`${picked.folder} is not a repository folder with a remote.`, `Choose the main repository folder for ${repo}.`);
  const origin = originRepo(picked.origin);
  if (!origin || !sameRepo(origin, key)) {
    return failed(`${picked.folder} connects to ${origin ? shownRepo(origin) : picked.origin} instead of ${repo}.`, `Go back and choose the main repository folder for ${repo}.`);
  }
  const others = projects.filter((p) => p.id !== projectId && sameRepo(originRepo(p.origin) ?? '', key));
  if (others.length) {
    const folders = [picked, ...others].map((p) => p.folder).sort().join(', ');
    return failed(`More than one T3 project points to ${repo}. The folders are ${folders}.`, 'Keep one project in T3 Code, then retry.');
  }
  return { passed: true, detail: `${picked.folder} connects to ${shownRepo(origin)}.` };
}

/** The item source as the check names it. */
function sourceName(repo: string, source: RepositoryItemSource): string {
  if (source.kind === 'azure-board') return `${source.team}'s backlog and current sprint`;
  return `${repo}'s issues`;
}

/** How to fix an item source that can't be read. */
function sourceFix(repo: string, source: RepositoryItemSource): string {
  if (source.kind === 'issues') return `Check that gh can read issues in ${repo}.`;
  return `Check the team name and access to ${decodePart(repo.split('/')[1]!)} with az.`;
}

async function checkSource(repo: string, source: RepositoryItemSource, reads: SetupCheckReads): Promise<SetupCheckResult> {
  const named = sourceName(repo, source);
  try {
    const count = await reads.countItems(source, repo);
    return { passed: true, detail: `Found ${count} items in ${named}.` };
  } catch (err) {
    // A logged-out az or a missing azure-devops extension names the command that fixes it.
    if (err instanceof ReadProblem && err.fix) return failed(`Can't read ${named}: ${err.message}`, 'Run this command, then retry.', err.fix);
    if (onAzure(repo) && /request is invalid|HTTP 400|Bad Request/i.test(message(err))) {
      return failed(`Can't read ${named}: ${message(err)}`, 'Azure DevOps rejected the board\'s request. Retry, and report this request error if it persists.');
    }
    return failed(`Can't read ${named}: ${message(err)}`, sourceFix(repo, source));
  }
}

async function checkPush(key: string, reads: SetupCheckReads): Promise<SetupCheckResult> {
  const login = tool(key);
  const repo = shownRepo(key);
  let pushes;
  try { pushes = await reads.canPush(key); }
  catch (err) {
    if (onAzure(key)) return { passed: true, detail: `Warning: couldn't check ${repo}'s push permission: ${message(err)}. You can continue; agents will need Contribute permission to push.` };
    return failed(`Can't read ${repo}'s permissions: ${message(err)}`, `Check access to ${repo} with ${login}, then retry.`); }
  if (pushes) return { passed: true, detail: `${login} can push changes to ${repo}.` };
  return failed(`${login} cannot push changes to ${repo}. Agents need this permission to save their work.`,
    `Ask for ${login === 'az' ? 'Contribute permission on' : 'write access to'} ${repo}, or sign in with an account that has it.`, login === 'az' ? 'az login' : 'gh auth login');
}

/** Runs the body's `check` for its `repo`, T3 project and item source; or the status and problem for a body it can't run. */
export async function runSetupCheck(input: Record<string, unknown>, reads: SetupCheckReads = setupCheckReads()):
  Promise<{ result: SetupCheckResult } | { status: number; error: string }> {
  const { check, repo, projectId, itemSource } = input;
  if (!SETUP_CHECKS.includes(check as SetupCheckId) || !isRepo(repo) || typeof projectId !== 'string' || !isItemSource(itemSource)) {
    return { status: 400, error: 'Choose a repository and complete its settings before running checks.' };
  }
  if (check === 'checkout') return { result: await checkCheckout(repo, projectId, reads) };
  if (check === 'source') return { result: await checkSource(repo, itemSource, reads) };
  return { result: await checkPush(repo, reads) };
}
