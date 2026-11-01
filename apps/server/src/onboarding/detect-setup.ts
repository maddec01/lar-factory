import {
  REPOSITORY_OPERATIONS, onAzure, sameRepo, shownRepo, type Detected, type DomainDocLocation, type OperationAccess,
  type RepositoryItemSource, type RepositoryOperation, type SetupDetection,
} from '@lar-factory/shared';
import { az, type Az } from '../azure/azure-items.ts';
import { canPush as azureCanPush } from '../azure/azure-repos.ts';
import { azureAccess as readAzureAccess } from './azure-access.ts';
import { prHost } from '../config/pr-host.ts';
import { isRepo } from '../config/repository-config.ts';
import { type CommitTree, type RepositoryAccess, message, repositoryAccess } from '../github/github.ts';
import { type Checkout, azureRepo, checkouts, githubRepo, onAzureDevOps } from '../t3/repository-project.ts';
import { projectSkills } from './project-skills.ts';
import { readProjectTeams } from './project-teams.ts';

/** What detection reads: T3's projects, the default branch's tree, and the login's permissions and teams. */
export interface DetectReads {
  checkouts(): Promise<Checkout[]>;
  tree(repo: string): Promise<{ tree: CommitTree }>;
  github(repo: string): Promise<RepositoryAccess>;
  azurePush(repo: string): Promise<boolean>;
  azureAccess?(repo: string): Promise<Access>;
  teams(repo: string): Promise<string[]>;
}

/** The reads through gh, and for an Azure DevOps repository through `run` as az. */
export function detectReads(run: Az = az): DetectReads {
  return {
    checkouts: () => checkouts(process.env),
    tree: async (repo) => {
      const { commitTree, defaultBranchHead } = prHost(repo);
      const tool = onAzure(repo) ? run : undefined;
      const head = await defaultBranchHead(repo, tool);
      return { tree: await commitTree(repo, head.sha, tool) };
    },
    github: (repo) => repositoryAccess(repo),
    azurePush: (repo) => azureCanPush(repo, run),
    azureAccess: (repo) => readAzureAccess(repo, run),
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

/** Positive access needs both token scopes and the repository role. */
async function githubAccess(repo: string, reads: DetectReads): Promise<{ itemSources: Detected<RepositoryItemSource[]>; access: Access }> {
  let found;
  try { found = await reads.github(repo); }
  catch (err) { return { itemSources: { refused: `Can't read ${repo} with gh: ${message(err)}` }, access: {} }; }
  const { push, triage, issues, tokenWrites } = found;
  const access: Access = {};
  if (!push) access['push-branch'] = 'refused';
  if (!triage) access['tag-ticket'] = 'refused';
  if (tokenWrites === false) for (const operation of REPOSITORY_OPERATIONS) access[operation] = 'refused';
  if (tokenWrites === true) {
    if (push) for (const operation of ['push-branch', 'open-pr', 'edit-ticket', 'type-ticket', 'relate-ticket'] as const) access[operation] = 'allowed';
    if (triage) access['tag-ticket'] = 'allowed';
    if (issues) for (const operation of ['publish-ticket', 'comment-ticket'] as const) access[operation] = 'allowed';
  }
  if (!issues) for (const operation of ['publish-ticket', 'edit-ticket', 'comment-ticket', 'tag-ticket', 'type-ticket', 'relate-ticket'] as const) access[operation] = 'refused';
  return { itemSources: issues ? { found: [{ kind: 'issues' }] } : { refused: `${repo} has issues turned off.` }, access };
}

/** The teams' boards and the push access az finds; a push check that fails leaves both PR operations unverified. */
async function azureAccess(repo: string, reads: DetectReads): Promise<{ itemSources: Detected<RepositoryItemSource[]>; access: Access }> {
  const shown = shownRepo(repo);
  const [teams, access] = await Promise.all([
    reads.teams(repo).then((names): Detected<RepositoryItemSource[]> => ({ found: names.map((team) => ({ kind: 'azure-board', team })) }),
      (err) => ({ refused: `Can't read ${shown}'s teams with az: ${message(err)}` })),
    reads.azureAccess ? reads.azureAccess(repo).catch(() => ({})) : reads.azurePush(repo).then((push): Access => ({ 'push-branch': push ? 'allowed' : 'refused' }), () => ({})),
  ]);
  return { itemSources: teams, access };
}

/** What the login's permissions show it may do in the repository, each operation they can't settle left out. */
export async function detectAccess(repo: string, reads: DetectReads = detectReads()): Promise<Access> {
  return (await (onAzure(repo) ? azureAccess : githubAccess)(repo, reads)).access;
}

type TreeFacts = Pick<SetupDetection, 'domainDocs' | 'projectSkills'>;

/** The repository's glossary and ADRs when it has either, at the paths it has them, else off. */
function domainDocsOf(files: readonly string[]): DomainDocLocation {
  const glossary = ['GLOSSARY.md', 'CONTEXT.md'].find((path) => files.includes(path));
  const adrs = files.some((path) => path.startsWith('docs/adr/'));
  return glossary || adrs ? { kind: 'repository', glossary: glossary ?? 'GLOSSARY.md', adrs: 'docs/adr' } : { kind: 'off' };
}

/** The facts the default branch's tree holds, each Refused with the same problem when gh or az can't read it. */
async function treeFacts(repo: string, reads: DetectReads): Promise<TreeFacts> {
  let tree;
  try { ({ tree } = await reads.tree(repo)); }
  catch (err) {
    const refused = { refused: `Can't read ${shownRepo(repo)} with ${onAzure(repo) ? 'az' : 'gh'}: ${message(err)}` };
    return { domainDocs: refused, projectSkills: refused };
  }
  const files = [...tree.files.keys()];
  return {
    domainDocs: { found: domainDocsOf(files) },
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
    ...azure && process.env.LAR_FACTORY_AZURE_READ_ONLY === '1' && { azureReadOnly: true },
    access: Object.fromEntries(REPOSITORY_OPERATIONS.map((op) => [op, access[op] ?? 'unverified'])) as SetupDetection['access'],
    ...facts,
  } };
}
