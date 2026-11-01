import { discoverVocabulary, saveVocabularyLabels, type VocabularyReads } from '@lar-factory/shared/publication-settings';
import { isVocabularyMapping, vocabularySelectionProblem } from '@lar-factory/shared/vocabulary';
import { writeAccessProblem, structureSyncOperations, isRecord, onAzure, type LocalSetupAnswers, type OnboardingRepository, type RepositoryItemSource } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { isRepo, saveConnections, saveOnboarded, stillOnboarding } from '../config/repository-config.ts';
import { saveLocalSetup, validateRepositorySettings } from '../config/repository-settings.ts';
import { checkIssueListAccess, message } from '../github/github.ts';
import { checkAzureSourceAccess } from './azure-source-access.ts';
import { detectAccess } from './detect-setup.ts';

/** Access checks never make test writes. */
export interface SaveReads {
  vocabulary?: VocabularyReads;
  createLabel?(repo: string, name: string): Promise<string>;
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
function answersOf({ projectId, role, itemSource, domainDocs, skills, structureSync, vocabulary }: Record<string, unknown>): LocalSetupAnswers | null {
  if (vocabulary !== undefined && !isVocabularyMapping(vocabulary)) return null;
  const docs = isRecord(domainDocs) && (domainDocs.kind === 'off'
    || domainDocs.kind === 'repository' && typeof domainDocs.glossary === 'string' && typeof domainDocs.adrs === 'string');
  if (structureSync !== undefined && typeof structureSync !== 'boolean') return null;
  if (typeof projectId !== 'string' || role !== undefined && typeof role !== 'string' || !isRecord(itemSource) || !docs || !strings(skills)) return null;
  return { ...(vocabulary === undefined ? {} : { vocabulary }), projectId, structureSync: structureSync !== false, role: typeof role === 'string' ? role.trim() : '', itemSource, domainDocs, skills } as unknown as LocalSetupAnswers;
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
  if (answers.vocabulary && Object.keys(answers.vocabulary).length) {
    const discovery = await discoverVocabulary(repo, reads.vocabulary);
    for (const term of Object.values(answers.vocabulary)) {
      const selectionProblem = vocabularySelectionProblem(term, discovery);
      if (selectionProblem) return { status: 400, error: selectionProblem };
      for (const operation of [...(term.type === null ? [] : ['type-ticket' as const]), ...(term.labels.length ? ['tag-ticket' as const] : [])]) {
        const problem = writeAccessProblem(repo, operation, access);
        if (problem) return { status: 403, error: problem };
      }
    }
  }
  if (answers.structureSync !== false) {
    const needed = { 'publish-ticket': 'create issues or work items', 'edit-ticket': 'edit issues or work items', 'comment-ticket': 'post comments', 'tag-ticket': 'set issue labels' } as const;
    const missing = structureSyncOperations(repo).filter((op) => writeAccessProblem(repo, op, access) !== null).map((op) => needed[op as keyof typeof needed]);
    if (missing.length) return { status: 403, error: `Saving concepts and links needs verified permission to ${missing.join(', ')}. ${onAzure(repo) ? 'Grant work item write and comment access.' : 'GitHub needs Issues: Read and write. This read-only check cannot verify fine-grained token permissions; sign in with a classic token or gh OAuth login with repo scope.'} Recheck access or turn off sharing concepts and links.` };
  }
  try {
    if (input.newLabels !== undefined) {
      if (!isRecord(input.newLabels)) throw new Error('Choose vocabulary kinds for new labels.');
      const discovery = await discoverVocabulary(repo, reads.vocabulary);
      const vocabulary = { ...answers.vocabulary };
      for (const [key, names] of Object.entries(input.newLabels)) {
        if (!isVocabularyMapping({ [key]: { type: null, labels: [] } })) throw new Error('Choose a vocabulary kind.');
        const labels = await saveVocabularyLabels(repo, names, discovery, access, reads.createLabel);
        const term = vocabulary[key as keyof typeof vocabulary] ?? { type: null, labels: [] };
        vocabulary[key as keyof typeof vocabulary] = { ...term, labels: [...new Set([...term.labels, ...labels])] };
      }
      answers.vocabulary = vocabulary;
    }
    const list = saveOnboarded(repo, replaces ?? null, dir);
    saveLocalSetup(repo, answers, access, dir);
    if (connections) saveConnections(repo, connections, dir);
    return { onboarding: stillOnboarding(list) };
  } catch (err) {
    return { status: 409, error: message(err) };
  }
}
