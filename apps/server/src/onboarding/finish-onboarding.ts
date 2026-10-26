// Finishes an onboarding that reuses its repository's .lar-factory.json once its checks pass, with no PR: the
// repository's entry in this Mac's list stops being onboarding, so the next read puts it on the board.

import type { OnboardingRepository } from '@lar-factory/shared';
import { findRepositoryConfig, isRepo, saveOnboarded, stillOnboarding } from '../config/repository-config.ts';
import { message } from '../github/github.ts';
import { boardDataDir } from '../port/board-record.ts';

/**
 * Finishes the body's `repo`, in place of the onboarding saved under `replaces` when it names one, once its default
 * branch has a .lar-factory.json the board can read, and returns the repositories still onboarding; or the status and
 * problem when the body, the file or the list refuses it.
 */
export async function finishOnboarding(input: Record<string, unknown>, dir = boardDataDir(), run?: (args: string[]) => Promise<string>):
  Promise<{ onboarding: OnboardingRepository[] } | { status: number; error: string }> {
  const { repo, replaces } = input;
  if (!isRepo(repo) || replaces !== undefined && typeof replaces !== 'string') return { status: 400, error: 'Send the repository whose onboarding finishes.' };
  let found;
  try { found = await findRepositoryConfig(repo, run); }
  catch (err) { return { status: 502, error: `Can't read ${repo}'s .lar-factory.json: ${message(err)}` }; }
  if (!found) return { status: 409, error: `${repo} has no .lar-factory.json on its default branch to reuse.` };
  if ('problem' in found) return { status: 409, error: found.problem };
  try { return { onboarding: stillOnboarding(saveOnboarded(repo, replaces ?? null, dir)) }; }
  catch (err) { return { status: 409, error: message(err) }; }
}
