// The board's configuration: the onboarded repositories and the board-wide settings, in files in boardDataDir(),
// and each repository's Repository config, its .lar-factory.json read from its default branch.
// skills/lar-work/scripts/repo-config.sh reads the same files, with the same shapes, defaults and wording.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PROVIDERS, SHOW_SETTINGS, isRecord, onAzure, sameRepo, type CleanupPicks, type OnboardingProgress, type OnboardingRepository, type Provider,
  type RepositoryConfigAnswers, type RepositoryConfigProblem, type RepositoryItemSource, type SetupAnswers, type ShowSetting,
} from '@lar-factory/shared';
import { problemOf } from '../azure/azure-items.ts';
import { readBranchFile as readAzureFile } from '../azure/azure-repos.ts';
import { ReadProblem } from '../items/item-source.ts';
import { readBranchFile } from '../github/github.ts';
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

/**
 * An onboarded repository, an entry of repositories.json's `repositories`, with where it stopped while it is still
 * onboarding, or its reset PR while it is resetting.
 */
export interface OnboardedRepository {
  repo: string;
  onboarding?: OnboardingProgress;
  resetting?: { prUrl: string };
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

/** Whether a value is the Repository config's values as onboarding and Edit send them: an item source, a show setting, a role and custom labels. */
export const isConfigAnswers = (value: unknown): value is RepositoryConfigAnswers => isRecord(value) && isItemSource(value.itemSource)
  && SHOW_SETTINGS.includes(value.show as ShowSetting) && typeof value.role === 'string' && value.role.trim() !== ''
  && Array.isArray(value.labels) && value.labels.every((l) => typeof l === 'string');

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
    const { onboarding, resetting } = entry as { onboarding?: unknown; resetting?: unknown };
    if (onboarding !== undefined && resetting !== undefined) throw new Error(`${file}: repositories[${index}] is both onboarding and resetting.`);
    if (resetting !== undefined) {
      if (!isRecord(resetting) || typeof resetting.prUrl !== 'string') throw new Error(`${file}: repositories[${index}] has a resetting without its PR's URL.`);
      return { repo, resetting: { prUrl: resetting.prUrl } };
    }
    if (onboarding === undefined) return { repo };
    if (!isProgress(onboarding)) throw new Error(`${file}: repositories[${index}] has an onboarding without its step, done steps and T3 project, or with answers it can't use.`);
    return { repo, onboarding };
  });
  return { raw: { ...raw, repositories: repositories as Record<string, unknown>[] }, list };
}

/**
 * repositories.json's entries, `{ "repositories": [{ "repo": "owner/name" }] }`, where an entry still onboarding
 * carries its progress as `onboarding`, and one resetting its reset PR as `resetting`; none when there is no file.
 */
export function readRepositoryList(dir = boardDataDir()): OnboardedRepository[] {
  return readListFile(join(dir, 'repositories.json')).list;
}

/**
 * Stores where an onboarding stopped in its repository's entry, adding the entry when there is none, and drops the
 * onboarding entry of `replaces`, the repository it was saved under before it picked another T3 project. Keeps every
 * other entry as the file has it, and returns the list. Only the board marks a PR closed or keeping its
 * .lar-factory.json, so the progress's own marks are dropped and the saved ones kept while the PR is the same;
 * `reusesConfig` marks the PR the board opened. `replaceUnusableConfig` allows restarting only the named repository,
 * after the caller has checked its saved settings. Otherwise throws for a repository that is onboarded already.
 */
export function saveOnboarding({ repo, progress }: OnboardingRepository, replaces: string | null, dir = boardDataDir(),
  { reusesConfig = false, replaceUnusableConfig = false } = {}): OnboardedRepository[] {
  const { prClosed: _, reusesConfig: __, ...sent } = progress;
  const saved = onboardingOf(repo, dir);
  const samePr = saved?.prUrl !== undefined && saved.prUrl === sent.prUrl;
  return saveEntry({ repo, onboarding: {
    ...sent, ...samePr && saved.prClosed && { prClosed: true },
    ...(reusesConfig || samePr && saved.reusesConfig) && { reusesConfig: true },
  } }, replaces, dir, replaceUnusableConfig);
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
function saveEntry(entry: OnboardedRepository, replaces: string | null, dir: string, replaceUnusableConfig = false): OnboardedRepository[] {
  const { repo } = entry;
  if (!REPO.test(repo)) throw new Error(`${repo} isn't a repository of the form owner/name.`);
  const file = join(dir, 'repositories.json');
  const { raw, list } = readListFile(file);
  const onboarded = list.find((e) => !e.onboarding && (sameRepo(e.repo, repo) || replaces !== null && sameRepo(e.repo, replaces))
    && !(replaceUnusableConfig && sameRepo(e.repo, repo) && !e.resetting));
  if (onboarded) throw new Error(`${onboarded.repo} is onboarded already.`);
  const at = list.findIndex((e) => sameRepo(e.repo, repo));
  const dropped = (e: OnboardedRepository) => sameRepo(e.repo, repo) || replaces !== null && sameRepo(e.repo, replaces);
  const written: Record<string, unknown> = { ...entry };
  const repositories = raw.repositories.flatMap((e, i) => i === at ? [written] : dropped(list[i]!) ? [] : [e]);
  if (at < 0) repositories.push(written);
  return writeListFile(dir, { ...raw, repositories });
}

/** Drops the repository's entry, keeping every other entry as the file has it, and returns the list. Throws for a repository the list doesn't name. */
export function dropRepository(repo: string, dir = boardDataDir()): OnboardedRepository[] {
  const file = join(dir, 'repositories.json');
  const { raw, list } = readListFile(file);
  if (!list.some((e) => sameRepo(e.repo, repo))) throw new Error(`${repo} is not on this Mac's list.`);
  return writeListFile(dir, { ...raw, repositories: raw.repositories.filter((_, i) => !sameRepo(list[i]!.repo, repo)) });
}

/**
 * Marks an onboarded repository resetting, with its reset PR's URL, keeping every other entry as the file has it, and
 * returns the list. Throws for a repository that is not onboarded, or is onboarding or resetting.
 */
export function saveResetting(repo: string, prUrl: string, dir = boardDataDir()): OnboardedRepository[] {
  const { raw, list } = readListFile(join(dir, 'repositories.json'));
  const at = list.findIndex((e) => sameRepo(e.repo, repo));
  if (at < 0 || list[at]!.onboarding || list[at]!.resetting) throw new Error(`${repo} is not onboarded.`);
  return writeListFile(dir, { ...raw, repositories: raw.repositories.map((e, i) => i === at ? { ...e, resetting: { prUrl } } : e) });
}

/** The list's repositories on the board: neither still onboarding nor resetting. */
export const onTheBoard = (list: readonly OnboardedRepository[]) => list.filter((e) => !e.onboarding && !e.resetting);

/** The reset PRs still waiting to merge or close, including after a board restart. */
export const stillResetting = (list: readonly OnboardedRepository[]) =>
  list.flatMap(({ repo, resetting }) => resetting ? [{ repo, prUrl: resetting.prUrl }] : []);

/** Writes repositories.json with `content` and returns its list. */
function writeListFile(dir: string, content: Record<string, unknown>): OnboardedRepository[] {
  const file = join(dir, 'repositories.json');
  mkdirSync(dir, { recursive: true });
  // Written beside it, then renamed over it, so repo-config.sh never reads half a file.
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(content, null, 2)}\n`);
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
  const defaults = { refreshSeconds: 300 };
  const file = join(dir, 'settings.json');
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

/** The repository's .lar-factory.json from its default branch, as findRepositoryConfig reads it; throws why it can't. */
export async function readRepositoryConfig(repo: string, run?: (args: string[]) => Promise<string>): Promise<RepositoryConfig> {
  const found = await findRepositoryConfig(repo, run);
  if (!found) throw new RepositoryConfigError(repo, 'no .lar-factory.json on its default branch.');
  if ('problem' in found) throw new RepositoryConfigError(repo, found.problem);
  return found;
}

/** The onboarded repositories' configs, why each repository left off the board couldn't be read, and the repositories resetting. */
export interface OnboardedConfigs {
  configs: RepositoryConfig[];
  problems: RepositoryConfigProblem[];
  resetting: string[];
}

/** Why az couldn't read an Azure repository's .lar-factory.json, with the fix when one command is it. */
function azProblem(err: unknown): string {
  const problem = problemOf(err);
  if (problem instanceof ReadProblem) return problem.fix ? `${problem.message} Run ${problem.fix}.` : problem.message;
  return `could not read .lar-factory.json. ${problem instanceof Error ? problem.message : String(problem)}`;
}

/**
 * Each config of the list's repositories on the board, in the list's order, the problem of each whose
 * .lar-factory.json is missing or wrong, or that az can't read, which stays off the board, and the repositories
 * resetting, which read none; throws any other failure, such as a logged-out gh.
 */
export async function readOnboardedConfigs(list: readonly OnboardedRepository[], run?: (args: string[]) => Promise<string>): Promise<OnboardedConfigs> {
  const read = await Promise.all(onTheBoard(list).map(({ repo }) => readRepositoryConfig(repo, run).catch((err: unknown) => {
    if (err instanceof RepositoryConfigError) return { repo: err.repo, problem: err.problem };
    if (onAzure(repo)) return { repo, problem: azProblem(err) };
    throw err;
  })));
  return {
    configs: read.filter((r): r is RepositoryConfig => 'role' in r),
    problems: read.filter((r): r is RepositoryConfigProblem => !('role' in r)),
    resetting: list.flatMap((e) => e.resetting ? [e.repo] : []),
  };
}
