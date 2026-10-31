// Onboarding's detection, its first step: what the repository and the login allow before onboarding asks anything,
// read without a checkout and with no test write. One read of the default branch's tree finds the domain docs, the
// factory files of an earlier setup, the shared .lar-factory.json and the project skills; the login's permissions,
// gh's or on Azure DevOps az's, give each operation's access and the item sources. A fact the login can't read is
// Refused with why, and an operation its permissions can't settle stays unverified until the factory needs it.

import {
  REPOSITORY_OPERATIONS, onAzure, sameRepo, shownRepo, type Detected, type DomainDocLocation, type FactoryFile, type OperationAccess,
  type RepositoryItemSource, type RepositoryOperation, type SetupDetection,
} from '@lar-factory/shared';
import { az, type Az } from '../azure/azure-items.ts';
import { canPush as azureCanPush } from '../azure/azure-repos.ts';
import { prHost } from '../config/pr-host.ts';
import { sharedConfigOf } from '../config/repository-settings.ts';
import { isRepo } from '../config/repository-config.ts';
import { type CommitTree, message, repositoryAccess } from '../github/github.ts';
import { type Checkout, azureRepo, checkouts, githubRepo, onAzureDevOps } from '../t3/repository-project.ts';
import { AGENT_DOC_PATHS, withoutAgentSkills } from './agent-setup.ts';
import { projectSkills } from './fixed-clashes.ts';
import { linkTarget } from './pr-changes.ts';
import { readProjectTeams } from './project-teams.ts';

/** What detection reads: T3's projects, the default branch's tree, and the login's permissions and teams. */
export interface DetectReads {
  checkouts(): Promise<Checkout[]>;
  tree(repo: string): Promise<{ tree: CommitTree; read: (sha: string) => Promise<string> }>;
  github(repo: string): Promise<{ push: boolean; triage: boolean; issues: boolean }>;
  azurePush(repo: string): Promise<boolean>;
  teams(repo: string): Promise<string[]>;
}

/** The reads through gh, and for an Azure DevOps repository through `run` as az. */
function detectReads(run: Az = az): DetectReads {
  return {
    checkouts: () => checkouts(process.env),
    tree: async (repo) => {
      const { commitTree, defaultBranchHead, readBlob } = prHost(repo);
      const tool = onAzure(repo) ? run : undefined;
      const head = await defaultBranchHead(repo, tool);
      return { tree: await commitTree(repo, head.sha, tool), read: (sha) => readBlob(repo, sha, tool) };
    },
    github: (repo) => repositoryAccess(repo),
    azurePush: (repo) => azureCanPush(repo, run),
    teams: async (repo) => {
      const read = await readProjectTeams({ repo }, run);
      if ('error' in read) throw new Error(read.error.replace(/^Can't load teams\. /, ''));
      return read.teams;
    },
  };
}

/** The repository an origin names: organization/project/repository on Azure DevOps, else GitHub's owner/name. */
const originRepo = (origin: string | null): string | null => origin && onAzureDevOps(origin) ? azureRepo(origin) : githubRepo(origin);

/** The picked T3 project's folder, once it is the main checkout of the repository's origin and its only one. */
async function detectCheckout(key: string, projectId: string, reads: DetectReads): Promise<Detected<string>> {
  const repo = shownRepo(key);
  let projects;
  try { projects = await reads.checkouts(); }
  catch (err) { return { refused: `Can't read T3 Code's projects: ${message(err)}. Open T3 Code, then retry.` }; }
  const picked = projects.find((p) => p.id === projectId);
  if (!picked) return { refused: 'This project is no longer in T3 Code. Go back and choose another.' };
  if (!picked.origin) return { refused: `${picked.folder} is not a repository folder with a remote. Choose the main repository folder for ${repo}.` };
  const origin = originRepo(picked.origin);
  if (!origin || !sameRepo(origin, key)) {
    return { refused: `${picked.folder} connects to ${origin ? shownRepo(origin) : picked.origin} instead of ${repo}. Go back and choose the main repository folder for ${repo}.` };
  }
  const others = projects.filter((p) => p.id !== projectId && sameRepo(originRepo(p.origin) ?? '', key));
  if (others.length) {
    const folders = [picked, ...others].map((p) => p.folder).sort().join(', ');
    return { refused: `More than one T3 project points to ${repo}. The folders are ${folders}. Keep one project in T3 Code, then retry.` };
  }
  return { found: picked.folder };
}

type Access = Partial<Record<RepositoryOperation, Exclude<OperationAccess, 'unverified'>>>;

/**
 * The item sources and access gh's permissions give. Without push, a fork PR or editing one's own issues may still
 * work, so those stay unverified; tagging needs triage.
 */
async function githubAccess(repo: string, reads: DetectReads): Promise<{ itemSources: Detected<RepositoryItemSource[]>; access: Access }> {
  let found;
  try { found = await reads.github(repo); }
  catch (err) { return { itemSources: { refused: `Can't read ${repo} with gh: ${message(err)}` }, access: {} }; }
  const { push, triage, issues } = found;
  return {
    itemSources: issues ? { found: [{ kind: 'issues' }] } : { refused: `${repo} has issues turned off.` },
    access: {
      'push-branch': push ? 'allowed' : 'refused', ...push && { 'open-pr': 'allowed', 'edit-ticket': 'allowed' },
      'publish-ticket': issues ? 'allowed' : 'refused', 'tag-ticket': triage ? 'allowed' : 'refused',
    },
  };
}

/** The teams' boards and the push access az finds; a push check that fails leaves both PR operations unverified. */
async function azureAccess(repo: string, reads: DetectReads): Promise<{ itemSources: Detected<RepositoryItemSource[]>; access: Access }> {
  const shown = shownRepo(repo);
  const [teams, push] = await Promise.all([
    reads.teams(repo).then((names): Detected<RepositoryItemSource[]> => ({ found: names.map((team) => ({ kind: 'azure-board', team })) }),
      (err) => ({ refused: `Can't read ${shown}'s teams with az: ${message(err)}` })),
    reads.azurePush(repo).catch(() => null),
  ]);
  if (push === null) return { itemSources: teams, access: {} };
  const pushes = push ? 'allowed' : 'refused';
  return { itemSources: teams, access: { 'push-branch': pushes, 'open-pr': pushes } };
}

/** What the login's permissions show it may do in the repository, each operation they can't settle left out. */
export async function detectAccess(repo: string, reads: DetectReads = detectReads()): Promise<Access> {
  return (await (onAzure(repo) ? azureAccess : githubAccess)(repo, reads)).access;
}

type TreeFacts = Pick<SetupDetection, 'domainDocs' | 'factoryFiles' | 'sharedConfig' | 'projectSkills'>;

/** The repository's glossary and ADRs when it has either, at the paths it has them, else private drafts. */
function domainDocsOf(files: readonly string[]): DomainDocLocation {
  const glossary = ['GLOSSARY.md', 'CONTEXT.md'].find((path) => files.includes(path));
  const adrs = files.some((path) => path.startsWith('docs/adr/'));
  return glossary || adrs ? { kind: 'repository', glossary: glossary ?? 'GLOSSARY.md', adrs: 'docs/adr' } : { kind: 'private' };
}

/** The files CLAUDE.md and AGENTS.md lead to that hold an `## Agent skills` section, each once. */
async function agentSkillsFiles(tree: CommitTree, read: (sha: string) => Promise<string>): Promise<string[]> {
  const paths: string[] = [];
  for (const name of ['AGENTS.md', 'CLAUDE.md']) {
    const path = await linkTarget(tree, read, name);
    const file = path === null ? undefined : tree.files.get(path);
    if (!path || !file || paths.includes(path)) continue;
    if (withoutAgentSkills(await read(file.sha)) !== null) paths.push(path);
  }
  return paths;
}

/** The facts the default branch's tree holds, each Refused with the same problem when gh or az can't read it. */
async function treeFacts(repo: string, reads: DetectReads): Promise<TreeFacts> {
  let tree, read;
  try { ({ tree, read } = await reads.tree(repo)); }
  catch (err) {
    const refused = { refused: `Can't read ${shownRepo(repo)} with ${onAzure(repo) ? 'az' : 'gh'}: ${message(err)}` };
    return { domainDocs: refused, factoryFiles: refused, sharedConfig: refused, projectSkills: refused };
  }
  const files = [...tree.files.keys()];
  const config = tree.files.get('.lar-factory.json');
  const skills = await agentSkillsFiles(tree, read);
  const docs = AGENT_DOC_PATHS.filter((path) => tree.files.has(path));
  const factoryFiles: FactoryFile[] = [
    ...config ? [{ kind: 'config' as const, paths: ['.lar-factory.json'] }] : [],
    ...skills.length ? [{ kind: 'agent-skills' as const, paths: skills }] : [],
    ...docs.length ? [{ kind: 'agent-docs' as const, paths: docs }] : [],
  ];
  return {
    domainDocs: { found: domainDocsOf(files) },
    factoryFiles: { found: factoryFiles },
    sharedConfig: { found: config ? sharedConfigOf(await read(config.sha), onAzure(repo)).read : null },
    projectSkills: { found: [...new Set(projectSkills(files).map((skill) => skill.name))].sort() },
  };
}

/** Detects the body's `repo`'s setup with its T3 project, or the status and problem for a body it can't use. */
export async function detectSetup(input: Record<string, unknown>, reads: DetectReads = detectReads()):
  Promise<{ detection: SetupDetection } | { status: number; error: string }> {
  const { repo, projectId } = input;
  if (!isRepo(repo) || typeof projectId !== 'string') return { status: 400, error: 'Choose a repository and its T3 project before detecting its setup.' };
  const azure = onAzure(repo);
  const [checkout, { itemSources, access }, facts] = await Promise.all([
    detectCheckout(repo, projectId, reads), (azure ? azureAccess : githubAccess)(repo, reads), treeFacts(repo, reads),
  ]);
  return { detection: {
    repo, provider: azure ? 'Azure DevOps' : 'GitHub', checkout, itemSources,
    access: Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, access[op] ?? 'unverified'])) as SetupDetection['access'],
    ...facts,
  } };
}
