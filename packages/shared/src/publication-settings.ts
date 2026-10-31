// Node entry used by the installed command and the board. Discovery only reads provider metadata.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { decodePart, isRecord, onAzure, sameRepo, type RepositorySetup } from './index.ts';
import { applySharedDefaults, isRepo, readRepositorySetups, sharedConfigOf } from './repository-settings.ts';
import { publicationSettingsSnapshot, type VocabularyCapability, type VocabularyDiscovery } from './vocabulary.ts';

/** Authenticated GETs. GitHub list reads include every page; Azure reads return its JSON envelope. */
export interface VocabularyReads {
  github(path: string): Promise<unknown>;
  azure(repo: string, resource: 'workitemtypes' | 'tags'): Promise<unknown>;
  /** Fresh default-branch config text, or null when absent. Omit only when using the last usable cache. */
  sharedConfig?(repo: string): Promise<string | null>;
}

const exec = promisify(execFile);
async function commandOutput(command: string, args: string[]): Promise<string> {
  const executable = process.env[command === 'gh' ? 'GH_PATH' : 'AZ_PATH'] || command;
  const { stdout } = await exec(executable, args, { timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
  return stdout;
}

async function jsonCommand(command: string, args: string[]): Promise<unknown> {
  return JSON.parse(await commandOutput(command, args));
}

/** Reads .lar-factory.json from the default branch with the provider CLI, as the board's file reader does. */
async function sharedConfig(repo: string): Promise<string | null> {
  try {
    if (!onAzure(repo)) return await commandOutput('gh', ['api', `repos/${repo}/contents/.lar-factory.json`, '-H', 'Accept: application/vnd.github.raw']);
    const [organization, project, repository] = repo.split('/');
    const raw = await jsonCommand('az', ['devops', 'invoke', '--area', 'git', '--resource', 'items', '--route-parameters',
      `project=${decodePart(project!)}`, `repositoryId=${decodePart(repository!)}`, '--query-parameters', 'path=/.lar-factory.json', 'includeContent=true',
      '--api-version', '7.1', '--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json']);
    if (!isRecord(raw) || typeof raw.content !== 'string') throw new Error('The provider returned no config content.');
    return raw.content;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (onAzure(repo) ? /TF401174/.test(reason) : /HTTP 404/.test(reason)) return null;
    throw err;
  }
}

/** Uses each provider CLI's existing local login, without reading or persisting its credentials. */
export const vocabularyReads: VocabularyReads = {
  sharedConfig,
  github: (path) => jsonCommand('gh', ['api', '--method', 'GET', path, '--paginate', '--slurp']),
  azure: (repo, resource) => readAzureVocabulary(repo, resource),
};

/** Use the Azure DevOps extension's login for metadata, as the board does, rather than az rest's tenant. */
export async function readAzureVocabulary(repo: string, resource: 'workitemtypes' | 'tags', run?: (args: string[]) => Promise<string>): Promise<unknown> {
  const [organization, project] = repo.split('/');
  const args = ['devops', 'invoke', '--area', 'wit', '--resource', resource, '--route-parameters', `project=${decodePart(project!)}`,
    '--http-method', 'GET', '--api-version', '7.1', '--org', `https://dev.azure.com/${organization}`, '--detect', 'false', '--output', 'json'];
  return run ? JSON.parse(await run(args)) : jsonCommand('az', args);
}

function failure(err: unknown): VocabularyCapability {
  const reason = err instanceof Error ? err.message : String(err);
  // 404 may conceal a private resource. Never call it unsupported without explicit evidence.
  return { state: /(?:HTTP\s*|status(?: code)?[=: ]+)(?:410|501)\b|not implemented|unsupported (?:capability|api|api version)/i.test(reason) ? 'unsupported' : 'refused', reason };
}

/** A valid empty response is available with zero choices. A malformed response is a refused read. */
async function choices(read: () => Promise<unknown>): Promise<VocabularyCapability> {
  try {
    const raw = await read();
    const list = Array.isArray(raw) ? raw.flatMap((page) => isRecord(page) && Array.isArray(page.value) ? page.value : page)
      : isRecord(raw) ? raw.value : undefined;
    if (!Array.isArray(list) || list.some((item) => !isRecord(item) || typeof item.name !== 'string' || !item.name.trim())) {
      throw new Error('The provider returned an unreadable list of terms.');
    }
    return { state: 'available', choices: [...new Set(list.filter((item) => item.isDisabled !== true).map((item) => item.name as string))] };
  } catch (err) { return failure(err); }
}

export async function discoverVocabulary(repo: string, reads: VocabularyReads = vocabularyReads): Promise<VocabularyDiscovery> {
  if (!isRepo(repo)) throw new Error('Name a GitHub or Azure DevOps repository.');
  if (onAzure(repo)) {
    const [types, labels] = await Promise.all([
      choices(() => reads.azure(repo, 'workitemtypes')), choices(() => reads.azure(repo, 'tags')),
    ]);
    return { provider: 'azure', types, labels };
  }
  const types = async (): Promise<VocabularyCapability> => {
    try {
      const raw = await reads.github(`repos/${repo}`);
      const metadata = Array.isArray(raw) ? raw[0] : raw;
      if (!isRecord(metadata) || !isRecord(metadata.owner) || typeof metadata.owner.type !== 'string') throw new Error('Could not detect the repository owner.');
      if (metadata.owner.type === 'User') return { state: 'unsupported', reason: 'GitHub issue types are available only in organization repositories.' };
      return choices(() => reads.github(`repos/${repo}/issue-types`));
    } catch (err) { return failure(err); }
  };
  const [foundTypes, labels] = await Promise.all([types(), choices(() => reads.github(`repos/${repo}/labels?per_page=100`))]);
  return { provider: 'github', types: foundTypes, labels };
}

export interface PublicationSettings {
  setup: RepositorySetup;
  discovery: VocabularyDiscovery;
  /** Compare with a fresh read before each write; changed mappings or destination require a replacement plan. */
  snapshot: string;
}

/** Refreshes shared defaults through the same settings parser and writer, even while the board is closed. */
export async function readPublicationSettings(repo: string, options: { dir?: string; reads?: VocabularyReads } = {}): Promise<PublicationSettings> {
  const listed = readRepositorySetups(options.dir).find((s) => sameRepo(s.repo, repo));
  if (!listed) throw new Error(`${repo} is not on this Mac's list.`);
  const reads = options.reads ?? vocabularyReads;
  if (reads.sharedConfig) {
    try {
      const text = await reads.sharedConfig(listed.repo);
      applySharedDefaults(listed.repo, text === null ? null : sharedConfigOf(text, onAzure(listed.repo)).read, options.dir);
    } catch (err) {
      applySharedDefaults(listed.repo, { problem: `Could not read .lar-factory.json. ${err instanceof Error ? err.message : String(err)}` }, options.dir);
    }
  }
  const setup = readRepositorySetups(options.dir).find((s) => sameRepo(s.repo, repo))!;
  return { setup, discovery: await discoverVocabulary(setup.repo, reads), snapshot: publicationSettingsSnapshot(setup) };
}

export { readRepositorySetups, setOverride, setVocabularyOverride, sharedConfigOf, applySharedDefaults } from './repository-settings.ts';
