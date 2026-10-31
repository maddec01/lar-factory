import { CONFIG_VERSION, SHARED_SETTINGS, REPOSITORY_OPERATIONS, onAzure, sameRepo, type RepositorySetup, type RepositoryConfigProblem, type SharedSetting, type SharedRepositorySettings, type RepositoryOperation, type VocabularyKey, type VocabularyTerm } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { acceptSetup, applySharedDefaults, setVocabularyOverride, changeConsent, readRepositorySetups, recheckAccess, setOverride, sharedConfigOf } from '@lar-factory/shared/repository-settings';
export { acceptSetup, applySharedDefaults, readRepositorySetups, readDismissedUpdates, recordDismissedUpdate, recheckAccess, recordAccess, saveLocalSetup, setConsent, setOverride, sharedDefaultsOf, sharedConfigOf } from '@lar-factory/shared/repository-settings';
import { problemOf } from '../azure/azure-items.ts';
import { readBranchFile as readAzureFile } from '../azure/azure-repos.ts';
import { readBranchFile } from '../github/github.ts';
import { ReadProblem } from '../items/item-source.ts';
import { AGENT_DOC_PATHS, withoutAgentSkills } from '../onboarding/agent-setup.ts';
import { notEditable, type Refused } from './edit-config.ts';
import { isRepo, onTheBoard, type OnboardedRepository, type RepositoryConfig } from './repository-config.ts';

/**
 * Changes the body's onboarded `repo`'s local settings as Settings asks: `override` sets `key`'s override to `value`, or
 * removes it when the body has no value; `accept` accepts the setup as it is now; `recheck` forgets what the credentials
 * allowed; `consent` sets the operations offered to `value`, as changeConsent does. Answers the setup the change makes, or why it can't.
 */
export function changeRepositorySettings(input: Record<string, unknown>, dir = boardDataDir()): { setup: RepositorySetup } | Refused {
  const { repo, change, key, value } = input;
  if (!isRepo(repo) || !['override', 'vocabulary', 'accept', 'recheck', 'consent'].includes(change as string)) {
    return { status: 400, error: 'Send the repository and the change to its settings.' };
  }
  if (change === 'override' && !SHARED_SETTINGS.includes(key as SharedSetting)) return { status: 400, error: 'Send a setting Repository config can share.' };
  if (change === 'consent' && !(Array.isArray(value) && value.every((op) => REPOSITORY_OPERATIONS.includes(op as RepositoryOperation)))) {
    return { status: 400, error: 'Send the operations to offer.' };
  }
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  try {
    if (change === 'vocabulary') setVocabularyOverride(repo, key as VocabularyKey, value as VocabularyTerm | undefined, dir);
    else if (change === 'accept') acceptSetup(repo, dir);
    else if (change === 'recheck') recheckAccess(repo, dir);
    else if (change === 'consent') changeConsent(repo, value as RepositoryOperation[], dir);
    else setOverride(repo, key as SharedSetting, value as SharedRepositorySettings[SharedSetting], dir);
  } catch (err) {
    return { status: 400, error: (err as Error).message };
  }
  return { setup: readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))! };
}

type SharedRead = Parameters<typeof applySharedDefaults>[1];

/** Why az couldn't read an Azure repository's .lar-factory.json, with the fix when one command is it. */
function azProblem(err: unknown): string {
  const problem = problemOf(err);
  if (problem instanceof ReadProblem) return problem.fix ? `${problem.message} Run ${problem.fix}.` : problem.message;
  return `could not read .lar-factory.json. ${problem instanceof Error ? problem.message : String(problem)}`;
}

/**
 * The repository's .lar-factory.json from its default branch, with its version, as applySharedDefaults takes it. Throws
 * when gh can't read it, as a logged-out gh fails every repository.
 */
export async function readSharedDefaults(repo: string, run?: (args: string[]) => Promise<string>): Promise<{ read: SharedRead; version: number }> {
  let text: string | null;
  try { text = await (onAzure(repo) ? readAzureFile : readBranchFile)(repo, '.lar-factory.json', undefined, run); }
  catch (err) {
    if (onAzure(repo)) return { read: { problem: azProblem(err) }, version: CONFIG_VERSION };
    throw err;
  }
  return text === null ? { read: null, version: CONFIG_VERSION } : sharedConfigOf(text, onAzure(repo));
}

/** The onboarded repositories' configs and setups, and why each repository needs attention. */
export interface OnboardedConfigs {
  configs: RepositoryConfig[];
  /** The setup of each repository in `configs`, in its order. */
  setups: RepositorySetup[];
  problems: RepositoryConfigProblem[];
}

/**
 * Each config of the list's repositories on the board, in the list's order, made from its local settings over its
 * optional .lar-factory.json, whose latest read the settings keep. A repository with no item source stays off the board
 * with its problem, and one whose .lar-factory.json is wrong or unreadable keeps its last usable setup with the problem.
 * Throws any other failure, such as a logged-out gh.
 */
export async function readOnboardedConfigs(list: readonly OnboardedRepository[], run?: (args: string[]) => Promise<string>,
  dir = boardDataDir()): Promise<OnboardedConfigs> {
  const onboarded = onTheBoard(list);
  const reads = await Promise.all(onboarded.map(({ repo }) => readSharedDefaults(repo, run)));
  for (const [index, { repo }] of onboarded.entries()) applySharedDefaults(repo, reads[index]!.read, dir);
  const setups = readRepositorySetups(dir);
  const configs: RepositoryConfig[] = [];
  const onBoard: RepositorySetup[] = [];
  const problems: RepositoryConfigProblem[] = [];
  for (const [index, { repo }] of onboarded.entries()) {
    const setup = setups.find((s) => sameRepo(s.repo, repo))!;
    const { role, itemSource, labels, sharedProblem } = setup;
    if (!itemSource) {
      problems.push({ repo, problem: sharedProblem ?? 'no setting names the Azure DevOps team whose backlog and current sprint the board reads.' });
      continue;
    }
    if (sharedProblem) problems.push({ repo, kind: 'shared-config', problem: sharedProblem });
    configs.push({ repo, version: reads[index]!.version, role, itemSource, labels });
    onBoard.push(setup);
  }
  const guidance: RepositoryConfigProblem[] = [];
  // A repository already reporting its .lar-factory.json has one notice, so its guidance waits until that reads.
  await Promise.all(configs.filter((c) => !problems.some((p) => p.repo === c.repo)).map(async (config) => {
    const readFile = onAzure(config.repo) ? readAzureFile : readBranchFile;
    const stale: string[] = [];
    const paths = ['AGENTS.md', 'CLAUDE.md', ...AGENT_DOC_PATHS];
    let contents: (string | null)[];
    try {
      contents = await Promise.all(paths.map((path) => readFile(config.repo, path, undefined, run)));
    } catch (err) {
      const problem = problemOf(err);
      const detail = problem instanceof ReadProblem && problem.fix ? `${problem.message} Run ${problem.fix}.`
        : problem instanceof Error ? problem.message : String(problem);
      guidance.push({ repo: config.repo, kind: 'agent-guidance', problem: `Could not check agent guidance. ${detail} Refresh to retry.` });
      return;
    }
    for (const [index, path] of paths.entries()) {
      const content = contents[index];
      if (!content) continue;
      const outside = path.startsWith('docs/agents/') ? null : withoutAgentSkills(content);
      const guidance = outside === null ? (path.startsWith('docs/agents/') ? content : '') : content.match(/^## Agent skills\s*$[\s\S]*?(?=^#{1,2} |$(?![\s\S]))/m)?.[0] ?? '';
      if (/(?:`|\$|(?<![\w-])\/)(?:domain-modeling|to-tickets|triage|grilling|prototype|research|diagnosing-bugs|tdd|code-review|codebase-design|writing-for-agents|pr|retro|handoff|implement|developer-profile|unslop|skill-sync|code-review-and-quality|security-and-hardening|doubt-driven-development|frontend-ui-engineering|browser-testing-with-devtools)(?:`|\s|\/SKILL\.md)/.test(guidance)) stale.push(path);
    }
    if (stale.length) guidance.push({ repo: config.repo, kind: 'agent-guidance',
      problem: `${stale.join(', ')} names retired factory skills. Update the Agent skills block to use lar-shape for shaping and lar-build for builds, and replace docs/agents guidance with the current setup from lar-factory's apps/server/src/onboarding/agent-setup.ts. Merge the change into the default branch, then refresh.` });
  }));
  return { configs, setups: onBoard, problems: [...problems, ...guidance] };
}
