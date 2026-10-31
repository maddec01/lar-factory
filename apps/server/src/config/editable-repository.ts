import { sameRepo } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { message } from '../github/github.ts';
import { readRepositoryList } from './repository-config.ts';

export type Refused = { status: number; error: string };

/** A write must target a repository the user finished adding. */
export function notEditable(repo: string, dir = boardDataDir()): Refused | null {
  try {
    const entry = readRepositoryList(dir).find((e) => sameRepo(e.repo, repo));
    if (!entry) return { status: 409, error: `${repo} is not on this Mac's list.` };
    if (entry.onboarding) return { status: 409, error: `Finish adding ${repo} first.` };
    return null;
  } catch (err) { return { status: 409, error: message(err) }; }
}
