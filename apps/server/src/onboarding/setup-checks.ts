// The checks onboarding's Checks step runs after the command checks, one at a time so Retry reruns one: that the
// picked T3 project's folder is the main checkout of the repository's origin and its only one, as Start needs; that the
// item source can be read; and that gh's login can push to the repository. A failed check names its fix.

import { SETUP_CHECKS, sameRepo, type RepositoryItemSource, type SetupCheckId, type SetupCheckResult } from '@lar-factory/shared';
import { isItemSource, isRepo } from '../config/repository-config.ts';
import { canPush, fetchProject, fetchRepoIssues, message } from '../github/github.ts';
import { type Checkout, checkouts, githubRepo } from '../t3/repository-project.ts';

/** What the checks read: T3's projects with their origins, the item source's items, and gh's push permission. */
export interface SetupCheckReads {
  checkouts(): Promise<Checkout[]>;
  /** How many items the item source has for the board; throws why it can't be read. */
  countItems(source: RepositoryItemSource, repo: string): Promise<number>;
  canPush(repo: string): Promise<boolean>;
}

const READS: SetupCheckReads = {
  checkouts: () => checkouts(process.env),
  countItems: async (source, repo) => source.kind === 'github-project'
    ? (await fetchProject(source.owner, source.number)).items.length : (await fetchRepoIssues(repo)).length,
  canPush: (repo) => canPush(repo),
};

const failed = (problem: string, fix: string, command?: string): SetupCheckResult => ({ passed: false, problem, fix, ...command && { command } });

async function checkCheckout(repo: string, projectId: string, reads: SetupCheckReads): Promise<SetupCheckResult> {
  let projects;
  try { projects = await reads.checkouts(); }
  catch (err) { return failed(`Can't read T3 Code's projects: ${message(err)}`, 'Open T3 Code, then Retry.'); }
  const picked = projects.find((p) => p.id === projectId);
  if (!picked) return failed('T3 Code no longer has the picked T3 project.', 'Go Back and pick one.');
  if (!picked.origin) return failed(`${picked.folder} isn't a main checkout with an origin.`, `Pick the T3 project of ${repo}'s main checkout, not a worktree.`);
  const origin = githubRepo(picked.origin);
  if (!origin || !sameRepo(origin, repo)) {
    return failed(`${picked.folder}'s origin is ${origin ?? picked.origin}, not ${repo}.`, `Go Back and pick the T3 project of ${repo}'s main checkout.`);
  }
  const others = projects.filter((p) => p.id !== projectId && sameRepo(githubRepo(p.origin) ?? '', repo));
  if (others.length) {
    const folders = [picked, ...others].map((p) => p.folder).sort().join(', ');
    return failed(`Several T3 projects are checkouts of ${repo}: ${folders}.`, 'Remove all but one in T3 Code, then Retry.');
  }
  return { passed: true, detail: `${picked.folder} · origin ${origin}` };
}

async function checkSource(repo: string, source: RepositoryItemSource, reads: SetupCheckReads): Promise<SetupCheckResult> {
  const named = source.kind === 'github-project' ? `GitHub Project ${source.owner} #${source.number}` : `${repo}'s issues`;
  try {
    const count = await reads.countItems(source, repo);
    return { passed: true, detail: `${named} ${source.kind === 'github-project' ? 'has' : 'have'} ${count} items to show` };
  } catch (err) {
    return failed(`Can't read ${named}: ${message(err)}`, source.kind === 'github-project'
      ? "Check the Project's owner and number, and that gh's login can read the Project." : `Check that gh's login can read ${repo}'s issues.`);
  }
}

async function checkPush(repo: string, reads: SetupCheckReads): Promise<SetupCheckResult> {
  let pushes;
  try { pushes = await reads.canPush(repo); }
  catch (err) { return failed(`Can't read ${repo}'s permissions: ${message(err)}`, `Check that gh's login can read ${repo}, then Retry.`); }
  if (pushes) return { passed: true, detail: `gh's login can push to ${repo}` };
  return failed(`gh's login can't push to ${repo}, so lar-work's agents can't push their branches.`,
    `Get write access to ${repo}, or log gh in as an account that has it:`, 'gh auth login');
}

/** Runs the body's `check` for its `repo`, T3 project and item source; or the status and problem for a body it can't run. */
export async function runSetupCheck(input: Record<string, unknown>, reads: SetupCheckReads = READS):
  Promise<{ result: SetupCheckResult } | { status: number; error: string }> {
  const { check, repo, projectId, itemSource } = input;
  if (!SETUP_CHECKS.includes(check as SetupCheckId) || !isRepo(repo) || typeof projectId !== 'string' || !isItemSource(itemSource)) {
    return { status: 400, error: 'Send the check to run, the repository, its T3 project and its item source.' };
  }
  if (check === 'checkout') return { result: await checkCheckout(repo, projectId, reads) };
  if (check === 'source') return { result: await checkSource(repo, itemSource, reads) };
  return { result: await checkPush(repo, reads) };
}
