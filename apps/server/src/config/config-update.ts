// The notice in Settings › Repositories that offers a PR bringing a repository's .lar-factory.json up to CONFIG_VERSION.
// A dismissed notice comes back only once the app writes a higher version; the repository's local settings keep the
// version it was dismissed at.

import { CONFIG_VERSION, sameRepo } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { notEditable, type Refused } from './edit-config.ts';
import { recordDismissedUpdate } from './repository-settings.ts';

/**
 * Records the repository's notice dismissed at `version`, in place of any earlier dismissal. Refuses a repository that
 * isn't onboarded, as notEditable says, and records nothing then.
 */
export function dismissConfigUpdate(repo: string, version = CONFIG_VERSION, dir = boardDataDir()): Refused | null {
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  recordDismissedUpdate(repo, version, dir);
  return null;
}

/** The app version the repository's notice offers its file up to, or undefined when the file is at it or the notice was dismissed at it. */
export function configUpdateOf({ repo, version }: { repo: string; version: number }, dismissed: ReadonlyMap<string, number>,
  appVersion = CONFIG_VERSION): number | undefined {
  if (version >= appVersion) return undefined;
  const at = [...dismissed].find(([r]) => sameRepo(r, repo))?.[1];
  return at !== undefined && at >= appVersion ? undefined : appVersion;
}
