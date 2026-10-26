// The board's configuration: the onboarded repositories and the board-wide settings, in files in boardDataDir(),
// and each repository's Repository config, its .lar-factory.json read from its default branch.
// skills/lar-work/scripts/repo-config.sh reads the same files, with the same shapes, defaults and wording.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHOW_SETTINGS, type ShowSetting } from '@lar-factory/shared';
import { readDefaultBranchFile } from '../github/github.ts';
import { boardDataDir } from '../port/board-record.ts';

/** Where a repository's items come from: a GitHub Project, which other repositories may name too, or its own issues. */
type RepositoryItemSource = { kind: 'github-project'; owner: string; number: number } | { kind: 'issues' };

/** One repository's Repository config, with each field its file leaves out filled in. */
export interface RepositoryConfig {
  repo: string;
  version: number;
  role: string;
  itemSource: RepositoryItemSource;
  show: ShowSetting;
  labels: string[];
}

export interface BoardSettings {
  refreshSeconds: number;
  /** Why settings.json couldn't be used, naming its path, when it couldn't; the defaults stand in for it. */
  problem?: string;
}

/** An onboarded repository, an entry of repositories.json's `repositories`. */
export interface OnboardedRepository {
  repo: string;
}

/** owner/name, each part of letters, digits, ".", "_" or "-", and neither "." nor ".."; repo-config.sh's repo_form. */
const REPO = /^(?!\.\.?\/)[A-Za-z0-9._-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${file} isn't valid JSON.`); }
}

/** repositories.json's entries, `{ "repositories": [{ "repo": "owner/name" }] }`; none when there is no file. */
export function readRepositoryList(dir = boardDataDir()): OnboardedRepository[] {
  const file = join(dir, 'repositories.json');
  if (!existsSync(file)) return [];
  const raw = readJson(file) as { repositories?: unknown } | null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray(raw.repositories)) {
    throw new Error(`${file}: expected an object with a repositories array, like {"repositories": [{"repo": "owner/name"}]}.`);
  }
  return raw.repositories.map((entry: unknown, index) => {
    const repo = (entry as { repo?: unknown } | null)?.repo;
    if (typeof entry !== 'object' || typeof repo !== 'string' || !REPO.test(repo)) {
      throw new Error(`${file}: repositories[${index}] needs a repo of the form owner/name.`);
    }
    return { repo };
  });
}

/** settings.json, with each missing field, or the whole file, taking its default; a file it can't use takes them all, with the problem. */
export function readBoardSettings(dir = boardDataDir()): BoardSettings {
  const defaults = { refreshSeconds: 45 };
  const file = join(dir, 'settings.json');
  if (!existsSync(file)) return defaults;
  let raw: unknown;
  try { raw = readJson(file); }
  catch (err) { return { ...defaults, problem: (err as Error).message }; }
  const seconds = (raw as { refreshSeconds?: unknown } | null)?.refreshSeconds;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || seconds !== undefined && !(typeof seconds === 'number' && seconds > 0)) {
    return { ...defaults, problem: `${file}: expected an object with a positive refreshSeconds, like {"refreshSeconds": 45}.` };
  }
  return { refreshSeconds: seconds ?? defaults.refreshSeconds };
}

/** What is wrong with a parsed .lar-factory.json, in repo-config.sh's words, or null when nothing is. */
function problem(raw: Record<string, unknown>): string | null {
  const source = raw.itemSource as Record<string, unknown> | undefined;
  if ('version' in raw && typeof raw.version !== 'number') return 'field version must be a number';
  if (typeof raw.role !== 'string' || !raw.role) return 'field role is missing or not a string';
  if ('itemSource' in raw && (typeof source !== 'object' || source === null || Array.isArray(source))) return 'field itemSource must be an object';
  if (source && source.kind !== 'issues' && source.kind !== 'github-project') return 'field itemSource.kind must be "issues" or "github-project"';
  if (source?.kind === 'github-project' && (typeof source.owner !== 'string' || !GITHUB_LOGIN.test(source.owner))) {
    return 'field itemSource.owner must be a GitHub login for a github-project';
  }
  if (source?.kind === 'github-project' && !(Number.isInteger(source.number) && (source.number as number) > 0)) {
    return 'field itemSource.number must be a positive whole number for a github-project';
  }
  if ('show' in raw && !SHOW_SETTINGS.includes(raw.show as ShowSetting)) return 'field show must be "all" or "opted-in"';
  if ('labels' in raw && (!Array.isArray(raw.labels) || raw.labels.some((l) => typeof l !== 'string'))) return 'field labels must be an array of strings';
  return null;
}

/** The repository's .lar-factory.json from its default branch, never a checkout, with defaults filled in; throws why it can't. */
export async function readRepositoryConfig(repo: string, run?: (args: string[]) => Promise<string>): Promise<RepositoryConfig> {
  const text = await readDefaultBranchFile(repo, '.lar-factory.json', run);
  if (text === null) throw new Error(`${repo}: no .lar-factory.json on its default branch.`);
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { throw new Error(`${repo}: .lar-factory.json isn't valid JSON.`); }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${repo}: .lar-factory.json isn't a JSON object.`);
  const wrong = problem(raw as Record<string, unknown>);
  if (wrong) throw new Error(`${repo}: .lar-factory.json ${wrong}.`);
  const file = raw as Partial<RepositoryConfig> & { role: string };
  const itemSource: RepositoryItemSource = file.itemSource?.kind === 'github-project'
    ? { kind: 'github-project', owner: file.itemSource.owner, number: file.itemSource.number }
    : { kind: 'issues' };
  return { repo, version: file.version ?? 1, role: file.role, itemSource, show: file.show ?? 'all', labels: file.labels ?? [] };
}

/** Each onboarded repository's config, in the list's order; throws the first that can't be read. */
export async function readOnboardedConfigs(dir = boardDataDir()): Promise<RepositoryConfig[]> {
  return Promise.all(readRepositoryList(dir).map(({ repo }) => readRepositoryConfig(repo)));
}
