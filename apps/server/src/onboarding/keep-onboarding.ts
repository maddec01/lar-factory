// Keeps an onboarding whose dialog closed after it picked a T3 project: the page sends where it stopped, which goes in
// this Mac's list, so the board shows the repository with Resume, also after a restart.

import { sameRepo, type OnboardingRepository } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { findRepositoryConfig, isProgress, isRepo, readRepositoryList, saveOnboarding, stillOnboarding } from '../config/repository-config.ts';

/**
 * Stores the body's `progress` for its `repo`, in place of the onboarding saved under `replaces` when it names one, and
 * returns the repositories still onboarding; or the status and problem when the body or the list refuses it. Only the
 * progress's step, done steps and answers are saved.
 */
export async function keepOnboarding(input: Record<string, unknown>, dir = boardDataDir(), run?: (args: string[]) => Promise<string>): Promise<{ onboarding: OnboardingRepository[] } | { status: number; error: string }> {
  const { repo, progress, replaces } = input;
  if (!isRepo(repo) || !isProgress(progress) || replaces !== undefined && typeof replaces !== 'string') {
    return { status: 400, error: 'Send the repository and where its onboarding stopped.' };
  }
  try {
    const existing = readRepositoryList(dir).find((entry) => sameRepo(entry.repo, repo));
    let replaceUnusableConfig = false;
    if (existing && !existing.onboarding) {
      const config = await findRepositoryConfig(repo, run);
      replaceUnusableConfig = !config || 'problem' in config;
    }
    const { step, done, answers } = progress;
    return { onboarding: stillOnboarding(saveOnboarding({ repo, progress: { step, done, answers } }, replaces ?? null, dir, { replaceUnusableConfig })) };
  }
  catch (err) { return { status: 409, error: err instanceof Error ? err.message : String(err) }; }
}
