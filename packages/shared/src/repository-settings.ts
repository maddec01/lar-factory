// Repository settings live in this machine's repository list. Repository files are never configuration.

import { join } from 'node:path';
import {
  VOCABULARY_KEYS, effectiveVocabulary, isVocabularyMapping, type VocabularyKey, type VocabularyTerm, REPOSITORY_OPERATIONS, SHARED_SETTINGS, isRecord, onAzure, sameRepo, type DomainDocLocation, type OperationAccess,
  type LocalSetupAnswers, type RepositoryItemSource, type RepositoryOperation, type RepositorySetup, type SharedRepositorySettings,
} from '@lar-factory/shared';
import { REPOSITORY_LIST_FILE, boardDataDir } from '@lar-factory/shared/data-dir';
import {
  connectedTo, isItemSource, readListFile, writeListFile,
} from './repository-list.ts';

/** One repository's local settings as its list entry keeps them. */
interface LocalSettings {
  structureSync?: boolean;
  projectId?: string;
  /** Values the user set on this machine. */
  overrides?: SharedRepositorySettings;
  /** What the credentials were found to allow; an operation it leaves out is unverified. */
  access?: Partial<Record<RepositoryOperation, Exclude<OperationAccess, 'unverified'>>>;

}

const isStrings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');
const isOperation = (value: unknown): value is RepositoryOperation => REPOSITORY_OPERATIONS.includes(value as RepositoryOperation);

const isDocPath = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && !/[\\\0]/.test(value) && !value.startsWith('/') && value.split('/').every((part) => part !== '' && part !== '.' && part !== '..');

const isDomainDocs = (value: unknown): value is DomainDocLocation => isRecord(value)
  && (value.kind === 'off' || value.kind === 'private' || value.kind === 'repository' && isDocPath(value.glossary) && isDocPath(value.adrs));

/** What is wrong with a local setting's value, or null when nothing is. An Azure DevOps repository's item source names a team. */
function settingsProblemOf(raw: Record<string, unknown>, azure: boolean): string | null {
  const source = raw.itemSource;
  if ('version' in raw && (typeof raw.version !== 'number' || !Number.isFinite(raw.version))) return 'field version must be a number';
  if ('role' in raw && typeof raw.role !== 'string') return 'field role must be a string';
  if ('itemSource' in raw && (!isItemSource(source) || source.kind !== (azure ? 'azure-board' : 'issues'))) {
    return azure ? 'field itemSource must name the Azure DevOps team whose board the board reads' : 'field itemSource must be {"kind": "issues"}';
  }
  if ('labels' in raw && !isStrings(raw.labels)) return 'field labels must be an array of strings';
  if ('domainDocs' in raw && !isDomainDocs(raw.domainDocs)) return 'field domainDocs must be {"kind": "off"} or name the repository\'s glossary and adrs paths';
  if ('vocabulary' in raw && !isVocabularyMapping(raw.vocabulary)) return 'field vocabulary must map concept, build and kinds to {type: string or null, labels: string[]}';
  for (const key of ['createIssuesFromAddItem', 'createIssuesFromRetro', 'writeRefinedSpec']) {
    if (key in raw && typeof raw[key] !== 'boolean') return `field ${key} must be a boolean`;
  }
  if ('skills' in raw && !isStrings(raw.skills)) return 'field skills must be an array of strings';
  return null;
}

/** Checks local repository settings at the HTTP boundary. */
export function validateRepositorySettings(raw: Record<string, unknown>, azure: boolean): string | null {
  return settingsProblemOf(raw, azure);
}

const isAccess = (value: unknown) => isRecord(value)
  && Object.entries(value).every(([op, access]) => isOperation(op) && (access === 'allowed' || access === 'refused'));

/** Whether an entry's `settings` has its shape, for a repository on Azure DevOps or not. */
function isLocalSettings(value: unknown, azure: boolean): value is LocalSettings {
  if (!isRecord(value)) return false;
  const settings = (v: unknown) => v === undefined || isRecord(v) && settingsProblemOf(v, azure) === null;
  return (value.structureSync === undefined || typeof value.structureSync === 'boolean') && (value.projectId === undefined || typeof value.projectId === 'string') && settings(value.overrides)
    && (value.access === undefined || isAccess(value.access));
}

/** The list's entries with their checked local settings; throws, naming the entry, for settings it can't use. */
function readSettings(dir: string) {
  const file = join(dir, REPOSITORY_LIST_FILE);
  const { raw, list } = readListFile(file);
  const settings = raw.repositories.map((entry, index): LocalSettings => {
    if (entry.settings === undefined) return {};
    if (!isLocalSettings(entry.settings, onAzure(list[index]!.repo))) throw new Error(`${file}: repositories[${index}] has local settings it can't use.`);
    return entry.settings;
  });
  return { raw, list, settings };
}

/** The setup that the repository's local settings and its Connections make. */
function setupOf(repo: string, local: LocalSettings, connections: string[] = []): RepositorySetup {
  const pick = <K extends keyof SharedRepositorySettings>(key: K) => local.overrides?.[key];
  const accessOf = (op: RepositoryOperation): OperationAccess => local.access?.[op] ?? 'unverified';
  const itemSource = pick('itemSource') ?? (onAzure(repo) ? null : { kind: 'issues' as const });
  const savedDocs = pick('domainDocs');
  const domainDocs = savedDocs?.kind === 'repository' ? savedDocs : { kind: 'off' as const };
  return {
    repo, structureSync: local.structureSync ?? true, ...local.projectId !== undefined && { projectId: local.projectId },
    ...onAzure(repo) && process.env.LAR_FACTORY_AZURE_READ_ONLY === '1' && { azureReadOnly: true },
    role: pick('role') ?? '', itemSource, labels: pick('labels') ?? [], domainDocs, skills: pick('skills') ?? [],
    createIssuesFromAddItem: pick('createIssuesFromAddItem') ?? true,
    createIssuesFromRetro: pick('createIssuesFromRetro') ?? true,
    writeRefinedSpec: pick('writeRefinedSpec') ?? true,
    ...effectiveVocabulary(local.overrides?.vocabulary),
    access: Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, accessOf(op)])) as RepositorySetup['access'],
    sources: Object.fromEntries(SHARED_SETTINGS.map((key) => [key,
      local.overrides?.[key] !== undefined ? 'local' : 'default'])) as RepositorySetup['sources'],
    connections,
  };
}

/** Each listed repository's setup, in the list's order. */
export function readRepositorySetups(dir = boardDataDir()): RepositorySetup[] {
  const { raw, list, settings } = readSettings(dir);
  return list.map(({ repo }, index) => setupOf(repo, settings[index]!, connectedTo(repo, raw.connections, list)));
}

/**
 * Updates local settings only for a listed repository.
 */
function updateSettings(repo: string, dir: string, change: (local: LocalSettings, setup: RepositorySetup) => LocalSettings): void {
  const { raw, list, settings } = readSettings(dir);
  const at = list.findIndex((e) => sameRepo(e.repo, repo));
  if (at < 0) throw new Error(`${repo} is not on this Mac's list.`);
  const saved = settings[at]!;
  const setup = setupOf(list[at]!.repo, saved);
  const changed = change(saved, setup);
  const next = Object.fromEntries(Object.entries(changed).filter(([key]) => key !== 'consent'));
  if (JSON.stringify(next) === JSON.stringify(saved)) return;
  writeListFile(dir, { ...raw, repositories: raw.repositories.map((e, i) => i === at ? { ...e, settings: next } : e) });
}

/** Sets a local value, or resets it to the factory default with undefined. */
export function setOverride<K extends keyof SharedRepositorySettings>(repo: string, key: K, value: SharedRepositorySettings[K] | undefined, dir = boardDataDir()): void {
  const problem = value === undefined ? null : settingsProblemOf({ [key]: value }, onAzure(repo));
  if (problem) throw new Error(`${repo}: ${problem}.`);
  updateSettings(repo, dir, ({ overrides = {}, ...local }) => {
    const { [key]: _, ...others } = overrides;
    return { ...local, overrides: value === undefined ? others : { ...others, [key]: value } };
  });
}

/** Change one local mapping. Undefined removes only that override and restores inheritance. */
export function setVocabularyOverride(repo: string, key: VocabularyKey, value: VocabularyTerm | undefined, dir = boardDataDir()): void {
  if (!VOCABULARY_KEYS.includes(key) || value !== undefined && !isVocabularyMapping({ [key]: value })) throw new Error('Send a Vocabulary term and its type and labels, or omit the value to inherit.');
  updateSettings(repo, dir, ({ overrides = {}, ...local }) => {
    const { [key]: _, ...vocabulary } = overrides.vocabulary ?? {};
    return { ...local, overrides: { ...overrides, vocabulary: value === undefined ? vocabulary : { ...vocabulary, [key]: value } } };
  });
}

/**
 * Follows a label's rename to `to`, or its deletion with null, in the mappings of the listed repositories `shares` picks.
 * All of them change in one write. Names repositories whose mappings changed.
 */
export function followLabelInMappings(shares: (repo: string) => boolean, name: string, to: string | null, dir = boardDataDir()): string[] {
  const { raw, list, settings } = readSettings(dir);
  const same = (label: string) => label.toLowerCase() === name.toLowerCase();
  const changed: string[] = [];
  const repositories = raw.repositories.map((entry, at) => {
    const local = settings[at]!;
    const vocabulary = local.overrides?.vocabulary ?? {};
    if (!shares(list[at]!.repo) || !Object.values(vocabulary).some((term) => term.labels.some(same))) return entry;
    changed.push(list[at]!.repo);
    const followed = Object.entries(vocabulary).map(([key, term]) => [key, { ...term, labels: [...new Set(term.labels.flatMap((label) => !same(label) ? [label] : to === null ? [] : [to]))] }]);
    return { ...entry, settings: { ...local, overrides: { ...local.overrides, vocabulary: Object.fromEntries(followed) } } };
  });
  if (changed.length) writeListFile(dir, { ...raw, repositories });
  return changed;
}

/** The access an onboarding's detection found, each operation it left unverified out. */
type FoundAccess = NonNullable<LocalSettings['access']>;

/** Saves onboarding answers and access on this machine. */
export function saveLocalSetup(repo: string, answers: LocalSetupAnswers, access: FoundAccess, dir = boardDataDir()): void {
  const { projectId, structureSync = true, ...answered } = answers;
  updateSettings(repo, dir, (local) => ({ ...local, projectId, structureSync, overrides: { ...local.overrides, ...answered }, access }));
}

/** Changes whether concepts and cross-repository links are saved to issues. */
export function setStructureSync(repo: string, enabled: boolean, dir = boardDataDir()): void {
  updateSettings(repo, dir, (local) => ({ ...local, structureSync: enabled }));
}

/** Replaces the saved result of the read-only access check. */
export function replaceAccess(repo: string, access: FoundAccess, dir = boardDataDir()): void {
  updateSettings(repo, dir, (local) => ({ ...local, access }));
}

/** Records what an attempted operation found the credentials allow. */
export function recordAccess(repo: string, op: RepositoryOperation, access: Exclude<OperationAccess, 'unverified'>, dir = boardDataDir()): void {
  updateSettings(repo, dir, (local) => ({ ...local, access: { ...local.access, [op]: access } }));
}

export * from "./repository-list.ts";
