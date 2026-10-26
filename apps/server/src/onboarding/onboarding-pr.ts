// Onboarding's PR, which adds .lar-factory.json, opened on GitHub without touching any checkout: a branch starts at the
// default branch's head, the file goes on it with gh api, then gh pr create opens the PR, whose URL goes in the
// onboarding's entry. The branch is lar-factory/onboarding; when that is taken, its open PR is reused, and with none the
// first free lar-factory/onboarding-N is used. Each refresh finishes an onboarding whose PR merged, or whose default
// branch got a .lar-factory.json another way, closing the PR then, and marks a PR closed without merging, which the
// Pull request step offers to reopen.

import { SHOW_SETTINGS, isRecord, onboardingConfigFile, sameRepo, type OnboardingRepository, type RepositoryConfigAnswers, type ShowSetting } from '@lar-factory/shared';
import {
  type OnboardedRepository, findRepositoryConfig, isItemSource, isProgress, isRepo, readRepositoryList, saveOnboarded, saveOnboarding, savePrClosed,
  stillOnboarding,
} from '../config/repository-config.ts';
import { addFile, branchExists, closePr, createBranch, createPr, defaultBranchHead, message, openPrFrom, prState, reopenPr } from '../github/github.ts';
import { boardDataDir } from '../port/board-record.ts';

const ONBOARDING_BRANCH = 'lar-factory/onboarding';
const TITLE = 'chore: onboard to lar Factory';
const BODY = 'Adds `.lar-factory.json`, the Repository config lar Factory reads for this repository. '
  + 'Onboarding finishes on the board once this PR merges.';
const LANDED = '`.lar-factory.json` reached the default branch without this PR, so lar Factory finished onboarding with that file '
  + 'and closed this PR.';

type Run = (args: string[]) => Promise<string>;

/**
 * How far opening a repository's PR with one .lar-factory.json got, so Retry goes on from the gh call that failed; Retry
 * with other answers starts again, so the PR never carries an older file.
 */
interface Opening {
  content: string;
  head?: { branch: string; sha: string };
  /** The branch the PR comes from, once it is made or found with an open PR. */
  branch?: string;
  file?: true;
  url?: string;
}

/** The branch onboarding's PR comes from: the first of lar-factory/onboarding, -2, -3 and on that is free, or taken with an open PR to reuse. */
async function onboardingBranch(repo: string, run?: Run): Promise<{ branch: string; prUrl: string | null }> {
  for (let n = 1; ; n++) {
    const branch = n === 1 ? ONBOARDING_BRANCH : `${ONBOARDING_BRANCH}-${n}`;
    if (!await branchExists(repo, branch, run)) return { branch, prUrl: null };
    const prUrl = await openPrFrom(repo, branch, run);
    if (prUrl) return { branch, prUrl };
  }
}

const isConfig = (value: unknown): value is RepositoryConfigAnswers => isRecord(value) && isItemSource(value.itemSource)
  && SHOW_SETTINGS.includes(value.show as ShowSetting) && typeof value.role === 'string' && value.role.trim() !== '';

/**
 * Opens the PR for the body's `repo` with its `config`, then keeps the body's `progress` on the Pull request step with
 * the PR's URL, in place of the onboarding saved under `replaces` when it names one. Returns the URL and the
 * repositories still onboarding, or the status and problem, with gh's message, when a call or the list refuses it.
 */
export function createPrOpener(dir = boardDataDir(), run?: Run) {
  const openings = new Map<string, Opening>();
  return async (input: Record<string, unknown>): Promise<{ prUrl: string; onboarding: OnboardingRepository[] } | { status: number; error: string }> => {
    const { repo, progress, config, replaces } = input;
    if (!isRepo(repo) || !isProgress(progress) || !isConfig(config) || replaces !== undefined && typeof replaces !== 'string') {
      return { status: 400, error: "Send the repository, where its onboarding stopped and its .lar-factory.json's values." };
    }
    const key = repo.toLowerCase();
    const content = onboardingConfigFile({ ...config, role: config.role.trim() });
    const kept = openings.get(key);
    const opening: Opening = kept?.content === content ? kept : { content };
    openings.set(key, opening);
    try {
      opening.head ??= await defaultBranchHead(repo, run);
      if (!opening.branch) {
        const { branch, prUrl } = await onboardingBranch(repo, run);
        if (prUrl) Object.assign(opening, { file: true, url: prUrl });
        else await createBranch(repo, branch, opening.head.sha, run);
        opening.branch = branch;
      }
      if (!opening.file) opening.file = await addFile(repo, opening.branch, '.lar-factory.json', content, TITLE, run).then(() => true as const);
      opening.url ??= await createPr(repo, { base: opening.head.branch, head: opening.branch, title: TITLE, body: BODY }, run);
    } catch (err) {
      return { status: 502, error: `Can't open ${repo}'s onboarding PR: ${message(err)}` };
    }
    const done = [...new Set([...progress.done, progress.step])].filter((step) => step !== 'pr');
    try {
      const list = saveOnboarding({ repo, progress: { ...progress, step: 'pr', done, prUrl: opening.url } }, replaces ?? null, dir);
      openings.delete(key);
      return { prUrl: opening.url, onboarding: stillOnboarding(list) };
    } catch (err) {
      return { status: 409, error: message(err) };
    }
  };
}

/**
 * Reopens the PR of the body's `repo`'s onboarding, which closed without merging, and returns the repositories still
 * onboarding; or the status and problem, with gh's message, when the body, the list or gh refuses it.
 */
export async function reopenOnboardingPr(input: Record<string, unknown>, dir = boardDataDir(), run?: Run):
  Promise<{ onboarding: OnboardingRepository[] } | { status: number; error: string }> {
  const { repo } = input;
  if (!isRepo(repo)) return { status: 400, error: 'Send the repository whose onboarding PR to reopen.' };
  let prUrl;
  try { prUrl = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo))?.onboarding?.prUrl; }
  catch (err) { return { status: 409, error: message(err) }; }
  if (!prUrl) return { status: 409, error: `${repo} has no onboarding PR to reopen.` };
  try { await reopenPr(prUrl, run); }
  catch (err) { return { status: 502, error: `Can't reopen ${repo}'s onboarding PR: ${message(err)}` }; }
  try { return { onboarding: stillOnboarding(savePrClosed(repo, false, dir)) }; }
  catch (err) { return { status: 409, error: message(err) }; }
}

/**
 * Follows each onboarding PR in `list` and returns the list as the file has it then, with any save made meanwhile. An onboarding finishes once its PR merged, or
 * once its default branch has a .lar-factory.json the board can read, which came another way; an open PR is then
 * closed with a comment that says why. A PR closed without merging is marked closed, and the mark goes once it is open
 * again. A PR or file that can't be read, or a PR that can't be closed, leaves its onboarding as it is, and `failed`
 * hears why. `finished` hears each repository whose onboarding finishes.
 */
export async function followOnboardingPrs(list: OnboardedRepository[], dir = boardDataDir(), run?: Run, { failed = () => {}, finished = () => {} }: {
  failed?: (repo: string, problem: string) => void; finished?: (repo: string) => void } = {}): Promise<OnboardedRepository[]> {
  const followed = list.filter((e) => e.onboarding?.prUrl);
  for (const { repo, onboarding } of followed) {
    if (!onboarding?.prUrl) continue;
    try {
      const state = await prState(onboarding.prUrl, run);
      if (state === 'MERGED') {
        saveOnboarded(repo, null, dir);
        finished(repo);
        continue;
      }
      const found = await findRepositoryConfig(repo, run);
      if (found && !('problem' in found)) {
        if (state === 'OPEN') await closePr(onboarding.prUrl, LANDED, run);
        saveOnboarded(repo, null, dir);
        finished(repo);
      } else if ((state === 'CLOSED') !== !!onboarding.prClosed) {
        savePrClosed(repo, state === 'CLOSED', dir);
      }
    } catch (err) {
      failed(repo, message(err));
    }
  }
  return followed.length ? readRepositoryList(dir) : list;
}
