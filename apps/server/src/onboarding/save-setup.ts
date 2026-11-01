import { REPOSITORY_OPERATIONS, writeAccessProblem, structureSyncOperations, isRecord, onAzure, type LocalSetupAnswers, type OnboardingRepository, type RepositoryOperation, type RepositoryItemSource } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { isRepo, saveConnections, saveOnboarded, stillOnboarding } from '../config/repository-config.ts';
import { saveLocalSetup, validateRepositorySettings } from '../config/repository-settings.ts';
import { checkIssueListAccess, message } from '../github/github.ts';
import { checkAzureSourceAccess } from './azure-source-access.ts';
import { detectAccess } from './detect-setup.ts';

/** Access checks never make test writes. */
export interface SaveReads {
  source?(repo: string, source: RepositoryItemSource): Promise<void>;
  access(repo: string): Promise<Parameters<typeof saveLocalSetup>[2]>;
}

const saveReads: SaveReads = {
  access: (repo) => detectAccess(repo),
  source: async (repo, source) => {
    if (source.kind === 'issues') {
      // Prove list access without loading every issue and its PR evidence during Add.
      await checkIssueListAccess(repo);
      return;
    }
    await checkAzureSourceAccess(repo, source.team);
  },
};

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

/** The body's answers, or null when one is missing or has the wrong shape. */
function answersOf({ projectId, role, itemSource, domainDocs, skills, consent, structureSync }: Record<string, unknown>): LocalSetupAnswers | null {
  const docs = isRecord(domainDocs) && (domainDocs.kind === 'private'
    || domainDocs.kind === 'repository' && typeof domainDocs.glossary === 'string' && typeof domainDocs.adrs === 'string');
  if (structureSync !== undefined && typeof structureSync !== 'boolean') return null;
  if (typeof projectId !== 'string' || role !== undefined && typeof role !== 'string' || !isRecord(itemSource) || !docs || !strings(skills)
    || consent !== undefined && (!Array.isArray(consent) || !consent.every((op) => REPOSITORY_OPERATIONS.includes(op as RepositoryOperation)))) return null;
  return { projectId, structureSync: structureSync !== false, role: typeof role === 'string' ? role.trim() : '', itemSource, domainDocs, skills, consent: [] } as unknown as LocalSetupAnswers;
}

const ANSWERS = 'Send the repository, its T3 project, role, item source, domain-doc location, skills.';

/**
 * Saves the body's answers as its `repo`'s local settings and finishes its onboarding, in place of the one saved under
 * `replaces` when it names one. Its `connections`, when it sends them, become the repository's Connections. Returns the repositories still onboarding, or the status and problem. An access read
 * that fails leaves every operation unverified.
 */
export async function saveSetup(input: Record<string, unknown>, dir = boardDataDir(), reads: SaveReads = saveReads):
  Promise<{ onboarding: OnboardingRepository[] } | { status: number; error: string }> {
  const { repo, replaces, connections } = input;
  const answers = answersOf(input);
  if (!isRepo(repo) || !answers || replaces !== undefined && typeof replaces !== 'string' || connections !== undefined && !strings(connections)) {
    return { status: 400, error: ANSWERS };
  }
  const { role, itemSource, domainDocs, skills } = answers;
  const fits = validateRepositorySettings({ role, itemSource, domainDocs, skills }, onAzure(repo));
  if (fits) return { status: 400, error: `${repo}: ${fits}.` };
  try { await reads.source?.(repo, answers.itemSource); }
  catch (err) { return { status: 403, error: `Can't read the selected issue list. ${message(err)}` }; }
  const access = await reads.access(repo).catch(() => ({} as Awaited<ReturnType<SaveReads['access']>>));
  if (answers.structureSync !== false) {
    const needed = { 'publish-ticket': 'create issues or work items', 'edit-ticket': 'edit issues or work items', 'comment-ticket': 'post comments', 'tag-ticket': 'set issue labels' } as const;
    const missing = structureSyncOperations(repo).filter((op) => writeAccessProblem(repo, op, access) !== null).map((op) => needed[op as keyof typeof needed]);
    if (missing.length) return { status: 403, error: `Saving concepts and links needs verified permission to ${missing.join(', ')}. ${onAzure(repo) ? 'Grant work item write and comment access.' : 'GitHub needs Issues: Read and write. This read-only check cannot verify fine-grained token permissions; sign in with a classic token or gh OAuth login with repo scope.'} Recheck access or turn off sharing concepts and links.` };
  }
  try {
    const list = saveOnboarded(repo, replaces ?? null, dir);
    saveLocalSetup(repo, answers, access, dir);
    if (connections) saveConnections(repo, connections, dir);
    return { onboarding: stillOnboarding(list) };
  } catch (err) {
    return { status: 409, error: message(err) };
  }
}
