// Keeps an onboarding whose dialog closed after it picked a T3 project: the page sends where it stopped, which goes in
// this Mac's list, so the board shows the repository with Resume, also after a restart.

import { sameRepo, type OnboardingRepository } from '@lar-factory/shared';
import { isProgress, isRepo, readRepositoryList, saveOnboarding, stillOnboarding } from '../config/repository-config.ts';
import { boardDataDir } from '../port/board-record.ts';

/**
 * Stores the body's `progress` for its `repo`, in place of the onboarding saved under `replaces` when it names one, and
 * returns the repositories still onboarding; or the status and problem when the body or the list refuses it. Only the
 * board opens an onboarding's PR, so a `prUrl` in the body keeps the one saved for the repository, or none; a body
 * without one drops it, as Start over does.
 */
export function keepOnboarding(input: Record<string, unknown>, dir = boardDataDir()): { onboarding: OnboardingRepository[] } | { status: number; error: string } {
  const { repo, progress, replaces } = input;
  if (!isRepo(repo) || !isProgress(progress) || replaces !== undefined && typeof replaces !== 'string') {
    return { status: 400, error: 'Send the repository and where its onboarding stopped.' };
  }
  try {
    const { prUrl: sent, ...rest } = progress;
    const saved = sent === undefined ? undefined : readRepositoryList(dir).find((e) => sameRepo(e.repo, repo))?.onboarding?.prUrl;
    return { onboarding: stillOnboarding(saveOnboarding({ repo, progress: saved ? { ...rest, prUrl: saved } : rest }, replaces ?? null, dir)) };
  }
  catch (err) { return { status: 409, error: err instanceof Error ? err.message : String(err) }; }
}
