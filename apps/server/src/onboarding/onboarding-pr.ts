// Onboarding's PR, which adds .lar-factory.json, opened on GitHub without touching any checkout: the branch
// lar-factory/onboarding starts at the default branch's head, the file goes on it with gh api, then gh pr create opens
// the PR, whose URL goes in the onboarding's entry. Each refresh finishes an onboarding whose PR merged.

import { SHOW_SETTINGS, isRecord, type OnboardingRepository, type RepositoryConfigAnswers, type ShowSetting } from '@lar-factory/shared';
import {
  type OnboardedRepository, isItemSource, isProgress, isRepo, saveOnboarded, saveOnboarding, stillOnboarding,
} from '../config/repository-config.ts';
import { addFile, createBranch, createPr, defaultBranchHead, message, prState } from '../github/github.ts';
import { boardDataDir } from '../port/board-record.ts';

const ONBOARDING_BRANCH = 'lar-factory/onboarding';
const TITLE = 'chore: onboard to lar Factory';
const BODY = 'Adds `.lar-factory.json`, the Repository config lar Factory reads for this repository. '
  + 'Onboarding finishes on the board once this PR merges.';

type Run = (args: string[]) => Promise<string>;

/** How far opening a repository's PR got, so Retry goes on from the gh call that failed. */
interface Opening {
  head?: { branch: string; sha: string };
  branch?: true;
  file?: true;
  url?: string;
}

const isConfig = (value: unknown): value is RepositoryConfigAnswers => isRecord(value) && isItemSource(value.itemSource)
  && SHOW_SETTINGS.includes(value.show as ShowSetting) && typeof value.role === 'string' && value.role.trim() !== '';

/** The .lar-factory.json onboarding writes; labels wait for build #383's label step. */
const fileFor = ({ role, itemSource, show }: RepositoryConfigAnswers) =>
  `${JSON.stringify({ version: 1, role: role.trim(), itemSource, show, labels: [] }, null, 2)}\n`;

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
    const opening = openings.get(key) ?? {};
    openings.set(key, opening);
    try {
      opening.head ??= await defaultBranchHead(repo, run);
      if (!opening.branch) opening.branch = await createBranch(repo, ONBOARDING_BRANCH, opening.head.sha, run).then(() => true as const);
      if (!opening.file) {
        opening.file = await addFile(repo, ONBOARDING_BRANCH, '.lar-factory.json', fileFor(config), TITLE, run).then(() => true as const);
      }
      opening.url ??= await createPr(repo, { base: opening.head.branch, head: ONBOARDING_BRANCH, title: TITLE, body: BODY }, run);
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
 * Finishes each onboarding in `list` whose PR merged, so its repository is onboarded, and returns the list as it is
 * then. A PR whose state can't be read leaves its onboarding as it is, and `failed` hears why.
 */
export async function finishMergedOnboardings(list: OnboardedRepository[], dir = boardDataDir(), run?: Run,
  failed: (repo: string, problem: string) => void = () => {}): Promise<OnboardedRepository[]> {
  let now = list;
  for (const { repo, onboarding } of list) {
    if (!onboarding?.prUrl) continue;
    try {
      if (await prState(onboarding.prUrl, run) === 'MERGED') now = saveOnboarded(repo, null, dir);
    } catch (err) {
      failed(repo, message(err));
    }
  }
  return now;
}
