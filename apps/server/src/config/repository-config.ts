// The board's configuration: the onboarded repositories and the board-wide settings, in files in boardDataDir(),
// and each repository's Repository config, its .lar-factory.json read from its default branch.
// skills/lar-work/scripts/repo-config.sh reads the same files, with the same shapes, defaults and wording.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVIDERS, SHOW_SETTINGS, isRecord, sameRepo, type CleanupPicks, type OnboardingProgress, type OnboardingRepository, type Provider, type RepositoryConfigProblem, type RepositoryItemSource,
  type SetupAnswers, type ShowSetting,
} from '@lar-factory/shared';
import { readDefaultBranchFile } from '../github/github.ts';
import { boardDataDir } from '../port/board-record.ts';

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

/** An onboarded repository, an entry of repositories.json's `repositories`, with where it stopped while it is still onboarding. */
export interface OnboardedRepository {
  repo: string;
  onboarding?: OnboardingProgress;
}

/** owner/name, each part of letters, digits, ".", "_" or "-", and neither "." nor ".."; repo-config.sh's repo_form. */
const REPO = /^(?!\.\.?\/)[A-Za-z0-9._-]+\/(?!\.\.?$)[A-Za-z0-9._-]+$/;
const GITHUB_LOGIN = /^[A-Za-z0-9](-?[A-Za-z0-9])*$/;

/** Whether a value is a repository of the form owner/name. */
export const isRepo = (value: unknown): value is string => typeof value === 'string' && REPO.test(value);

/** Whether a value is an item source as .lar-factory.json holds it: a GitHub Project by owner and positive number, or the issues. */
export function isItemSource(value: unknown): value is RepositoryItemSource {
  if (!isRecord(value)) return false;
  if (value.kind === 'issues') return true;
  return value.kind === 'github-project' && typeof value.owner === 'string' && GITHUB_LOGIN.test(value.owner)
    && Number.isInteger(value.number) && (value.number as number) > 0;
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${file} isn't valid JSON.`); }
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** Whether the Provider and item source step's answers have their shape. */
function isSetup(value: unknown): value is SetupAnswers {
  return isRecord(value) && (value.itemSource === 'github-project' || value.itemSource === 'issues')
    && typeof value.projectOwner === 'string' && typeof value.projectNumber === 'string' && SHOW_SETTINGS.includes(value.show as ShowSetting)
    && typeof value.showPicked === 'boolean' && typeof value.role === 'string';
}

/** Whether the Cleanup step's picks have their shape. */
function isCleanup(value: unknown): value is CleanupPicks {
  return isRecord(value) && isRecord(value.ticks) && Object.values(value.ticks).every((tick) => typeof tick === 'boolean')
    && isRecord(value.skills) && Object.values(value.skills).every((pick) => isRecord(pick)
      && (pick.kind === 'delete' || pick.kind === 'rename' && typeof pick.name === 'string'));
}

/** Whether an entry's onboarding is progress the dialog can resume from. */
export function isProgress(value: unknown): value is OnboardingProgress {
  return isRecord(value) && typeof value.step === 'string' && strings(value.done) && isRecord(value.answers)
    && (value.answers.provider === undefined || PROVIDERS.includes(value.answers.provider as Provider))
    && typeof value.answers.projectId === 'string' && (value.answers.setup === undefined || isSetup(value.answers.setup))
    && (value.answers.cleanup === undefined || isCleanup(value.answers.cleanup))
    && (value.answers.customLabels === undefined || strings(value.answers.customLabels))
    && (value.prUrl === undefined || typeof value.prUrl === 'string') && (value.prClosed === undefined || value.prClosed === true)
    && (value.reusesConfig === undefined || value.reusesConfig === true);
}

/** repositories.json's entries as the file holds them, checked; none when there is no file. */
function readListFile(file: string): { raw: Record<string, unknown> & { repositories: Record<string, unknown>[] }; list: OnboardedRepository[] } {
  if (!existsSync(file)) return { raw: { repositories: [] }, list: [] };
  const raw = readJson(file) as { repositories?: unknown } | null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray(raw.repositories)) {
    throw new Error(`${file}: expected an object with a repositories array, like {"repositories": [{"repo": "owner/name"}]}.`);
  }
  const list = raw.repositories.map((entry: unknown, index): OnboardedRepository => {
    const repo = (entry as { repo?: unknown } | null)?.repo;
    if (typeof entry !== 'object' || typeof repo !== 'string' || !REPO.test(repo)) {
      throw new Error(`${file}: repositories[${index}] needs a repo of the form owner/name.`);
    }
    const { onboarding } = entry as { onboarding?: unknown };
    if (onboarding === undefined) return { repo };
    if (!isProgress(onboarding)) throw new Error(`${file}: repositories[${index}] has an onboarding without its step, done steps and T3 project, or with answers it can't use.`);
    return { repo, onboarding };
  });
  return { raw: raw as { repositories: Record<string, unknown>[] }, list };
}

/**
 * repositories.json's entries, `{ "repositories": [{ "repo": "owner/name" }] }`, where an entry still onboarding
 * carries its progress as `onboarding`; none when there is no file.
 */
export function readRepositoryList(dir = boardDataDir()): OnboardedRepository[] {
  return readListFile(join(dir, 'repositories.json')).list;
}

/**
 * Stores where an onboarding stopped in its repository's entry, adding the entry when there is none, and drops the
 * onboarding entry of `replaces`, the repository it was saved under before it picked another T3 project. Keeps every
 * other entry as the file has it, and returns the list. Only the board marks a PR closed or keeping its
 * .lar-factory.json, so the progress's own marks are dropped and the saved ones kept while the PR is the same;
 * `reusesConfig` marks the PR the board opened. Throws for a repository that is onboarded already.
 */
export function saveOnboarding({ repo, progress }: OnboardingRepository, replaces: string | null, dir = boardDataDir(),
  { reusesConfig = false } = {}): OnboardedRepository[] {
  const { prClosed: _, reusesConfig: __, ...sent } = progress;
  const saved = onboardingOf(repo, dir);
  const samePr = saved?.prUrl !== undefined && saved.prUrl === sent.prUrl;
  return saveEntry({ repo, onboarding: {
    ...sent, ...samePr && saved.prClosed && { prClosed: true },
    ...(reusesConfig || samePr && saved.reusesConfig) && { reusesConfig: true },
  } }, replaces, dir);
}

/** Marks whether the repository's onboarding PR closed without merging, as the board found it on GitHub, and returns the list. */
export function savePrClosed(repo: string, closed: boolean, dir = boardDataDir()): OnboardedRepository[] {
  const onboarding = onboardingOf(repo, dir);
  if (!onboarding) throw new Error(`${repo} is not onboarding.`);
  const { prClosed: _, ...progress } = onboarding;
  return saveEntry({ repo, onboarding: closed ? { ...progress, prClosed: true } : progress }, null, dir);
}

const onboardingOf = (repo: string, dir: string) => readRepositoryList(dir).find((e) => sameRepo(e.repo, repo))?.onboarding;

/**
 * Finishes an onboarding: its repository's entry keeps only the repository, in place of its onboarding entry and of
 * the one saved under `replaces`, and is added when there is none. Throws for a repository that is onboarded already.
 */
export function saveOnboarded(repo: string, replaces: string | null, dir = boardDataDir()): OnboardedRepository[] {
  return saveEntry({ repo }, replaces, dir);
}

/** Writes `entry` over its repository's entry and drops the one of `replaces`, as saveOnboarding and saveOnboarded say. */
function saveEntry(entry: OnboardedRepository, replaces: string | null, dir: string): OnboardedRepository[] {
  const { repo } = entry;
  if (!REPO.test(repo)) throw new Error(`${repo} isn't a repository of the form owner/name.`);
  const file = join(dir, 'repositories.json');
  const { raw, list } = readListFile(file);
  const onboarded = list.find((e) => !e.onboarding && (sameRepo(e.repo, repo) || replaces !== null && sameRepo(e.repo, replaces)));
  if (onboarded) throw new Error(`${onboarded.repo} is onboarded already.`);
  const at = list.findIndex((e) => sameRepo(e.repo, repo));
  const dropped = (e: OnboardedRepository) => sameRepo(e.repo, repo) || replaces !== null && sameRepo(e.repo, replaces);
  const written: Record<string, unknown> = { ...entry };
  const repositories = raw.repositories.flatMap((e, i) => i === at ? [written] : dropped(list[i]!) ? [] : [e]);
  if (at < 0) repositories.push(written);
  mkdirSync(dir, { recursive: true });
  // Written beside it, then renamed over it, so repo-config.sh never reads half a file.
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify({ ...raw, repositories }, null, 2)}\n`);
  renameSync(temp, file);
  return readListFile(file).list;
}

/** The list's repositories that are still onboarding, each with where it stopped and the problem in `followProblems`, by repository, following its PR met. */
export function stillOnboarding(list: readonly OnboardedRepository[], followProblems: ReadonlyMap<string, string> = new Map()): OnboardingRepository[] {
  return list.flatMap(({ repo, onboarding }) => {
    if (!onboarding) return [];
    const followProblem = [...followProblems].find(([r]) => sameRepo(r, repo))?.[1];
    return [{ repo, progress: onboarding, ...followProblem !== undefined && { followProblem } }];
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

/** A .lar-factory.json that is missing or wrong, which leaves its repository off the board; other read failures stay plain errors. */
class RepositoryConfigError extends Error {
  readonly repo: string;
  readonly problem: string;
  constructor(repo: string, problem: string) {
    super(`${repo}: ${problem}`);
    this.repo = repo;
    this.problem = problem;
  }
}

/**
 * The repository's .lar-factory.json from its default branch, never a checkout, with defaults filled in; null when it
 * has none, or why the one it has is wrong. Throws any other failure, such as a logged-out gh.
 */
export async function findRepositoryConfig(repo: string, run?: (args: string[]) => Promise<string>): Promise<RepositoryConfig | { problem: string } | null> {
  const text = await readDefaultBranchFile(repo, '.lar-factory.json', run);
  if (text === null) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { problem: ".lar-factory.json isn't valid JSON." }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { problem: ".lar-factory.json isn't a JSON object." };
  const wrong = problem(raw as Record<string, unknown>);
  if (wrong) return { problem: `.lar-factory.json ${wrong}.` };
  const file = raw as Partial<RepositoryConfig> & { role: string };
  const itemSource: RepositoryItemSource = file.itemSource?.kind === 'github-project'
    ? { kind: 'github-project', owner: file.itemSource.owner, number: file.itemSource.number }
    : { kind: 'issues' };
  return { repo, version: file.version ?? 1, role: file.role, itemSource, show: file.show ?? 'all', labels: file.labels ?? [] };
}

/** The repository's .lar-factory.json from its default branch, as findRepositoryConfig reads it; throws why it can't. */
export async function readRepositoryConfig(repo: string, run?: (args: string[]) => Promise<string>): Promise<RepositoryConfig> {
  const found = await findRepositoryConfig(repo, run);
  if (!found) throw new RepositoryConfigError(repo, 'no .lar-factory.json on its default branch.');
  if ('problem' in found) throw new RepositoryConfigError(repo, found.problem);
  return found;
}

/** The onboarded repositories' configs, and why each repository left off the board couldn't be read. */
export interface OnboardedConfigs {
  configs: RepositoryConfig[];
  problems: RepositoryConfigProblem[];
}

/**
 * Each onboarded repository's config, in the list's order, and the problem of each whose .lar-factory.json is
 * missing or wrong, which stays off the board; throws any other failure, such as a logged-out gh.
 */
export async function readOnboardedConfigs(list: readonly OnboardedRepository[], run?: (args: string[]) => Promise<string>): Promise<OnboardedConfigs> {
  const read = await Promise.all(list.map(({ repo }) => readRepositoryConfig(repo, run).catch((err: unknown) => {
    if (err instanceof RepositoryConfigError) return { repo: err.repo, problem: err.problem };
    throw err;
  })));
  return {
    configs: read.filter((r): r is RepositoryConfig => 'role' in r),
    problems: read.filter((r): r is RepositoryConfigProblem => !('role' in r)),
  };
}
