// The board's configuration: the onboarded repositories and the board-wide settings, both in REPOSITORY_LIST_FILE in
// boardDataDir(), and each repository's Repository config, its .lar-factory.json read from its default branch. The
// board leaves the old repositories.json and settings.json untouched.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVIDERS, SHOW_SETTINGS, isRecord, onAzure, sameRepo, type OnboardingProgress, type OnboardingRepository, type Provider,
  type RepositoryConfigAnswers, type RepositoryItemSource, type SetupAnswers, type ShowSetting,
} from '@lar-factory/shared';
import { REPOSITORY_LIST_FILE, boardDataDir } from '@lar-factory/shared/data-dir';
import { readBranchFile as readAzureFile } from '../azure/azure-repos.ts';
import { readBranchFile } from '../github/github.ts';

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
  /** Why the list file couldn't be used, naming its path, when it couldn't; the defaults stand in for it. */
  problem?: string;
}

/** An onboarded repository, an entry of the repository list's `repositories`, with where it stopped while it is still onboarding. */
export interface OnboardedRepository {
  repo: string;
  onboarding?: OnboardingProgress;
}

/**
 * GitHub's owner/name, each part of letters, digits, ".", "_" or "-", or Azure DevOps's organization/project/repository
 * as its origin URL has them, which may hold "%" and "~" too; no part is "." or "..". repo-config.sh's repo_form and
 * azure_form.
 */
const REPO = /^(?:(?!\.\.?\/)[A-Za-z0-9._-]+\/(?!\.\.?$)[A-Za-z0-9._-]+|(?!\.\.?\/)[A-Za-z0-9._%~-]+\/(?!\.\.?\/)[A-Za-z0-9._%~-]+\/(?!\.\.?$)[A-Za-z0-9._%~-]+)$/;

/** Whether a value is a repository of the form owner/name or organization/project/repository. */
export const isRepo = (value: unknown): value is string => typeof value === 'string' && REPO.test(value);


const isTeam = (value: unknown): value is string => typeof value === 'string' && value !== '';

/**
 * Whether a value is an item source as .lar-factory.json holds it: GitHub issues or an Azure DevOps team's combined board.
 */
export function isItemSource(value: unknown): value is RepositoryItemSource {
  if (!isRecord(value)) return false;
  if (value.kind === 'issues') return true;
  return value.kind === 'azure-board' && isTeam(value.team);
}

function readJson(file: string): unknown {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { throw new Error(`${file} isn't valid JSON.`); }
}

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

const SETUP_SOURCES: readonly SetupAnswers['itemSource'][] = ['issues', 'azure-board'];

/** Whether the Provider and item source step's answers have their shape. */
function isSetup(value: unknown): value is SetupAnswers {
  return isRecord(value) && SETUP_SOURCES.includes(value.itemSource as SetupAnswers['itemSource'])
    && (value.team === undefined || typeof value.team === 'string') && SHOW_SETTINGS.includes(value.show as ShowSetting)
    && typeof value.showPicked === 'boolean' && typeof value.role === 'string';
}

/** Whether an entry's onboarding is progress the dialog can resume from. */
export function isProgress(value: unknown): value is OnboardingProgress {
  return isRecord(value) && typeof value.step === 'string' && strings(value.done) && isRecord(value.answers)
    && (value.answers.provider === undefined || PROVIDERS.includes(value.answers.provider as Provider))
    && typeof value.answers.projectId === 'string' && (value.answers.setup === undefined || isSetup(value.answers.setup));
}

/**
 * The repository list's entries as the file holds them, checked; none when there is no file. An entry's local
 * settings stay in `raw`, for repository-settings.ts to check.
 */
export function readListFile(file: string): { raw: Record<string, unknown> & { repositories: Record<string, unknown>[] }; list: OnboardedRepository[] } {
  if (!existsSync(file)) return { raw: { repositories: [] }, list: [] };
  const raw = readJson(file) as { repositories?: unknown } | null;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || !Array.isArray(raw.repositories)) {
    throw new Error(`${file}: expected an object with a repositories array, like {"repositories": [{"repo": "owner/name"}]}.`);
  }
  // An old source cannot be resumed. Remove that entry alone, keeping raw and checked entries aligned for later writes.
  const repositories = raw.repositories.filter((entry: unknown) => {
    const onboarding = isRecord(entry) && entry.onboarding;
    const answers = isRecord(onboarding) && onboarding.answers;
    const setup = isRecord(answers) && answers.setup;
    return !isRecord(setup) || typeof setup.itemSource !== 'string' || !['github-project', 'azure-sprint', 'azure-backlog'].includes(setup.itemSource);
  });
  const list = repositories.map((entry: unknown, index): OnboardedRepository => {
    const repo = (entry as { repo?: unknown } | null)?.repo;
    if (typeof entry !== 'object' || typeof repo !== 'string' || !REPO.test(repo)) {
      throw new Error(`${file}: repositories[${index}] needs a repo of the form owner/name.`);
    }
    const { onboarding } = entry as { onboarding?: unknown };
    if (onboarding === undefined) return { repo };
    if (!isProgress(onboarding)) throw new Error(`${file}: repositories[${index}] has an onboarding without its step, done steps and T3 project, or with answers it can't use.`);
    return { repo, onboarding };
  });
  return { raw: { ...raw, repositories: repositories as Record<string, unknown>[] }, list };
}

/**
 * The repository list's entries, `{ "repositories": [{ "repo": "owner/name" }] }`, where an entry still onboarding
 * carries its progress as `onboarding`; none when there is no file.
 */
export function readRepositoryList(dir = boardDataDir()): OnboardedRepository[] {
  return readListFile(join(dir, REPOSITORY_LIST_FILE)).list;
}

/**
 * Stores where an onboarding stopped in its repository's entry, adding the entry when there is none, and drops the
 * onboarding entry of `replaces`, the repository it was saved under before it picked another T3 project. Keeps every
 * other entry as the file has it, and returns the list. `replaceUnusableConfig` allows restarting only the named repository, after the caller has checked its saved
 * settings. Otherwise throws for a repository that is onboarded already.
 */
export function saveOnboarding({ repo, progress }: OnboardingRepository, replaces: string | null, dir = boardDataDir(),
  { replaceUnusableConfig = false } = {}): OnboardedRepository[] {
  return saveEntry({ repo, onboarding: progress }, replaces, dir, replaceUnusableConfig);
}

/**
 * Finishes an onboarding: its repository's entry keeps only the repository and its local settings, in place of its onboarding entry and of
 * the one saved under `replaces`, and is added when there is none. Throws for a repository that is onboarded already.
 */
export function saveOnboarded(repo: string, replaces: string | null, dir = boardDataDir()): OnboardedRepository[] {
  return saveEntry({ repo }, replaces, dir);
}

/** Writes `entry` over its repository's entry and drops the one of `replaces`, as saveOnboarding and saveOnboarded say. */
function saveEntry(entry: OnboardedRepository, replaces: string | null, dir: string, replaceUnusableConfig = false): OnboardedRepository[] {
  const { repo } = entry;
  if (!REPO.test(repo)) throw new Error(`${repo} isn't a repository of the form owner/name.`);
  const file = join(dir, REPOSITORY_LIST_FILE);
  const { raw, list } = readListFile(file);
  const onboarded = list.find((e) => !e.onboarding && (sameRepo(e.repo, repo) || replaces !== null && sameRepo(e.repo, replaces))
    && !(replaceUnusableConfig && sameRepo(e.repo, repo)));
  if (onboarded) throw new Error(`${onboarded.repo} is onboarded already.`);
  const at = list.findIndex((e) => sameRepo(e.repo, repo));
  const dropped = (e: OnboardedRepository) => sameRepo(e.repo, repo) || replaces !== null && sameRepo(e.repo, replaces);
  // The entry keeps its local settings through every onboarding save.
  const settings = at < 0 ? undefined : raw.repositories[at]!.settings;
  const written: Record<string, unknown> = { ...entry, ...settings !== undefined && { settings } };
  const repositories = raw.repositories.flatMap((e, i) => i === at ? [written] : dropped(list[i]!) ? [] : [e]);
  if (at < 0) repositories.push(written);
  return writeListFile(dir, { ...raw, repositories });
}

/** The list's repositories on the board: those no longer onboarding. */
export const onTheBoard = (list: readonly OnboardedRepository[]) => list.filter((e) => !e.onboarding);

/** Writes the repository list with `content` and returns its list. */
export function writeListFile(dir: string, content: Record<string, unknown>): OnboardedRepository[] {
  const file = join(dir, REPOSITORY_LIST_FILE);
  mkdirSync(dir, { recursive: true });
  // Written beside it, then renamed over it, so repo-config.sh never reads half a file.
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(content, null, 2)}\n`);
  renameSync(temp, file);
  return readListFile(file).list;
}

/** The list's repositories that are still onboarding, each with where it stopped. */
export function stillOnboarding(list: readonly OnboardedRepository[]): OnboardingRepository[] {
  return list.flatMap(({ repo, onboarding }) => onboarding ? [{ repo, progress: onboarding }] : []);
}

/**
 * The board-wide settings beside the list's `repositories`, such as `"refreshSeconds": 300`, with each missing field, or
 * the whole file, taking its default; a file it can't use takes them all, with the problem.
 */
export function readBoardSettings(dir = boardDataDir()): BoardSettings {
  const defaults = { refreshSeconds: 300 };
  const file = join(dir, REPOSITORY_LIST_FILE);
  if (!existsSync(file)) return defaults;
  let raw: unknown;
  try { raw = readJson(file); }
  catch (err) { return { ...defaults, problem: (err as Error).message }; }
  const seconds = (raw as { refreshSeconds?: unknown } | null)?.refreshSeconds;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw) || seconds !== undefined && !(typeof seconds === 'number' && seconds > 0)) {
    return { ...defaults, problem: `${file}: expected an object with a positive refreshSeconds, like {"refreshSeconds": 300}.` };
  }
  return { refreshSeconds: seconds ?? defaults.refreshSeconds };
}

/**
 * What is wrong with a parsed .lar-factory.json, in repo-config.sh's words, or null when nothing is. A GitHub repository
 * reads its issues, and an Azure DevOps one names its team's combined board, with no default.
 */
function problem(raw: Record<string, unknown>, azure: boolean): string | null {
  const source = raw.itemSource as Record<string, unknown> | undefined;
  if ('version' in raw && typeof raw.version !== 'number') return 'field version must be a number';
  if (typeof raw.role !== 'string' || !raw.role) return 'field role is missing or not a string';
  if ('itemSource' in raw && (typeof source !== 'object' || source === null || Array.isArray(source))) return 'field itemSource must be an object';
  if (source && source.kind !== (azure ? 'azure-board' : 'issues') || azure && !source) return 'has an unsupported item source. Run onboarding again';
  if (azure && !isTeam(source?.team)) return 'name the Azure DevOps team whose backlog and current sprint the board reads';
  if ('show' in raw && !SHOW_SETTINGS.includes(raw.show as ShowSetting)) return 'field show must be "all" or "opted-in"';
  if ('labels' in raw && (!Array.isArray(raw.labels) || raw.labels.some((l) => typeof l !== 'string'))) return 'field labels must be an array of strings';
  return null;
}

/**
 * The repository's .lar-factory.json from its default branch, or from `branch` when given, never a checkout, with
 * defaults filled in; null when it has none, or why the one it has is wrong. An Azure DevOps repository's file is read
 * with az, any other's with gh, and `run` stands in for that tool. Throws any other failure, such as a
 * logged-out gh or az.
 */
export async function findRepositoryConfig(repo: string, run?: (args: string[]) => Promise<string>, branch?: string): Promise<RepositoryConfig | { problem: string } | null> {
  const text = await (onAzure(repo) ? readAzureFile : readBranchFile)(repo, '.lar-factory.json', branch, run);
  if (text === null) return null;
  let raw: unknown;
  try { raw = JSON.parse(text); }
  catch { return { problem: ".lar-factory.json isn't valid JSON." }; }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { problem: ".lar-factory.json isn't a JSON object." };
  const wrong = problem(raw as Record<string, unknown>, onAzure(repo));
  if (wrong) return { problem: `.lar-factory.json ${wrong}.` };
  const file = raw as Partial<RepositoryConfig> & { role: string };
  const source = file.itemSource;
  const itemSource: RepositoryItemSource = source?.kind === 'azure-board' ? { kind: 'azure-board', team: source.team } : { kind: 'issues' };
  return { repo, version: file.version ?? 1, role: file.role, itemSource, show: file.show ?? 'all', labels: file.labels ?? [] };
}
