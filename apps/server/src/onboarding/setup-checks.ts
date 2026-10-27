// The checks onboarding's Checks step runs after the command checks, one at a time so Retry reruns one: that the
// picked T3 project's folder is the main checkout of the repository's origin and its only one, as Start needs; that the
// item source can be read; and that the login, gh's or on Azure DevOps az's, can push to the repository. A failed check
// names its fix.

import { SETUP_CHECKS, decodePart, onAzure, sameRepo, shownRepo, type RepositoryItemSource, type SetupCheckId, type SetupCheckResult } from '@lar-factory/shared';
import { az, type Az } from '../azure/azure-items.ts';
import { azureBacklog } from '../azure/azure-backlog.ts';
import { canPush as azureCanPush } from '../azure/azure-repos.ts';
import { SPRINT_FIX, azureSprint } from '../azure/azure-sprint.ts';
import { isItemSource, isRepo } from '../config/repository-config.ts';
import { canPush, fetchProject, fetchRepoIssues, message } from '../github/github.ts';
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
      if (source.kind === 'azure-sprint' || source.kind === 'azure-backlog') {
        return (await (source.kind === 'azure-sprint' ? azureSprint : azureBacklog)([repo], source.team, run).read()).items.length;
      }
      return source.kind === 'github-project' ? (await fetchProject(source.owner, source.number)).items.length : (await fetchRepoIssues(repo)).length;
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
  if (!picked) return failed('T3 Code no longer has the picked T3 project.', 'Go Back and pick one.');
  if (!picked.origin) return failed(`${picked.folder} isn't a main checkout with an origin.`, `Pick the T3 project of ${repo}'s main checkout, not a worktree.`);
  const origin = originRepo(picked.origin);
  if (!origin || !sameRepo(origin, key)) {
    return failed(`${picked.folder}'s origin is ${origin ? shownRepo(origin) : picked.origin}, not ${repo}.`, `Go Back and pick the T3 project of ${repo}'s main checkout.`);
  }
  const others = projects.filter((p) => p.id !== projectId && sameRepo(originRepo(p.origin) ?? '', key));
  if (others.length) {
    const folders = [picked, ...others].map((p) => p.folder).sort().join(', ');
    return failed(`Several T3 projects are checkouts of ${repo}: ${folders}.`, 'Remove all but one in T3 Code, then Retry.');
  }
  return { passed: true, detail: `${picked.folder} · origin ${shownRepo(origin)}` };
}

/** The item source as the check names it. */
function sourceName(repo: string, source: RepositoryItemSource): string {
  if (source.kind === 'github-project') return `GitHub Project ${source.owner} #${source.number}`;
  if (source.kind === 'azure-sprint') return `${source.team}’s current sprint`;
  return source.kind === 'azure-backlog' ? `${source.team}’s backlog` : `${repo}'s issues`;
}

/** How to fix an item source that can't be read. */
function sourceFix(repo: string, source: RepositoryItemSource): string {
  if (source.kind === 'github-project') return "Check the Project's owner and number, and that gh's login can read the Project.";
  if (source.kind === 'issues') return `Check that gh's login can read ${repo}'s issues.`;
  return `Check the team's name, and that az's login can read ${decodePart(repo.split('/')[1]!)}'s boards.`;
}

async function checkSource(repo: string, source: RepositoryItemSource, reads: SetupCheckReads): Promise<SetupCheckResult> {
  const named = sourceName(repo, source);
  try {
    const count = await reads.countItems(source, repo);
    return { passed: true, detail: `${named} ${source.kind === 'issues' ? 'have' : 'has'} ${count} items to show` };
  } catch (err) {
    // A logged-out az or a missing azure-devops extension names the command that fixes it.
    if (err instanceof ReadProblem && err.fix) return failed(`Can't read ${named}: ${err.message}`, 'Run this, then Retry:', err.fix);
    // A team with no current iteration: the repository isn't onboarded yet, so another team is named by going Back.
    const sprintless = err instanceof ReadProblem ? err.message.indexOf(SPRINT_FIX) : -1;
    if (sprintless >= 0) return failed(`Can't read ${named}: ${message(err).slice(0, sprintless).trimEnd()}`, `${SPRINT_FIX}, then Retry, or go Back and name another team.`);
    return failed(`Can't read ${named}: ${message(err)}`, sourceFix(repo, source));
  }
}

async function checkPush(key: string, reads: SetupCheckReads): Promise<SetupCheckResult> {
  const login = tool(key);
  const repo = shownRepo(key);
  let pushes;
  try { pushes = await reads.canPush(key); }
  catch (err) { return failed(`Can't read ${repo}'s permissions: ${message(err)}`, `Check that ${login}'s login can read ${repo}, then Retry.`); }
  if (pushes) return { passed: true, detail: `${login}'s login can push to ${repo}` };
  return failed(`${login}'s login can't push to ${repo}, so lar-work's agents can't push their branches.`,
    `Get ${login === 'az' ? 'Contribute on' : 'write access to'} ${repo}, or log ${login} in as an account that has it:`, login === 'az' ? 'az login' : 'gh auth login');
}

/** Runs the body's `check` for its `repo`, T3 project and item source; or the status and problem for a body it can't run. */
export async function runSetupCheck(input: Record<string, unknown>, reads: SetupCheckReads = setupCheckReads()):
  Promise<{ result: SetupCheckResult } | { status: number; error: string }> {
  const { check, repo, projectId, itemSource } = input;
  if (!SETUP_CHECKS.includes(check as SetupCheckId) || !isRepo(repo) || typeof projectId !== 'string' || !isItemSource(itemSource)) {
    return { status: 400, error: 'Send the check to run, the repository, its T3 project and its item source.' };
  }
  if (check === 'checkout') return { result: await checkCheckout(repo, projectId, reads) };
  if (check === 'source') return { result: await checkSource(repo, itemSource, reads) };
  return { result: await checkPush(repo, reads) };
}
