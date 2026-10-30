// The notice in Settings › Repositories that offers a PR bringing a repository's .lar-factory.json up to CONFIG_VERSION,
// and the record of the notices dismissed, config-update-notices.json in boardDataDir(): each repository with the app
// version it was dismissed at, `{ "dismissed": { "owner/name": 2 } }`. A dismissed notice comes back only once the app
// writes a higher version.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_VERSION, isRecord, sameRepo } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { notEditable, type Refused } from './edit-config.ts';

const FILE = 'config-update-notices.json';

/** Whether `value` maps each repository to a version number. */
const isVersions = (value: unknown): value is Record<string, number> => isRecord(value) && Object.values(value).every((v) => typeof v === 'number');

/** Each repository whose notice was dismissed, with the app version it was dismissed at; none when the file is missing or unusable. */
export function readDismissedUpdates(dir = boardDataDir()): Map<string, number> {
  const file = join(dir, FILE);
  if (!existsSync(file)) return new Map();
  let raw: unknown;
  try { raw = JSON.parse(readFileSync(file, 'utf8')); }
  catch { return new Map(); }
  if (!isRecord(raw) || !isVersions(raw.dismissed)) return new Map();
  return new Map(Object.entries(raw.dismissed));
}

/**
 * Records the repository's notice dismissed at `version`, in place of any earlier dismissal, keeping the other
 * repositories'. Refuses a repository that isn't onboarded, as notEditable says, and records nothing then.
 */
export function dismissConfigUpdate(repo: string, version = CONFIG_VERSION, dir = boardDataDir()): Refused | null {
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  const kept = [...readDismissedUpdates(dir)].filter(([r]) => !sameRepo(r, repo));
  const file = join(dir, FILE);
  mkdirSync(dir, { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ dismissed: Object.fromEntries([...kept, [repo, version]]) }, null, 2)}\n`);
  renameSync(temp, file);
  return null;
}

/** The app version the repository's notice offers its file up to, or undefined when the file is at it or the notice was dismissed at it. */
export function configUpdateOf({ repo, version }: { repo: string; version: number }, dismissed: ReadonlyMap<string, number>,
  appVersion = CONFIG_VERSION): number | undefined {
  if (version >= appVersion) return undefined;
  const at = [...dismissed].find(([r]) => sameRepo(r, repo))?.[1];
  return at !== undefined && at >= appVersion ? undefined : appVersion;
}
