import { SHARED_SETTINGS, structureSyncOperations, writeAccessProblem, sameRepo, type RepositorySetup, type RepositoryConfigProblem, type SharedSetting, type SharedRepositorySettings } from '@lar-factory/shared';
import { detectAccess } from '../onboarding/detect-setup.ts';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { readRepositorySetups, setOverride, setStructureSync, replaceAccess } from '@lar-factory/shared/repository-settings';
export { readRepositorySetups, saveLocalSetup, setOverride, validateRepositorySettings } from '@lar-factory/shared/repository-settings';
import { notEditable, type Refused } from './editable-repository.ts';
import { isRepo, onTheBoard, type OnboardedRepository, type RepositoryConfig } from './repository-config.ts';

/** Changes local values or reads the signed-in account's access again. */
export async function changeRepositorySettings(input: Record<string, unknown>, dir = boardDataDir()): Promise<{ setup: RepositorySetup } | Refused> {
  const { repo, change, key, value } = input;
  if (!isRepo(repo) || !['override', 'recheck', 'structure-sync'].includes(change as string)) {
    return { status: 400, error: 'Send the repository and the change to its settings.' };
  }
  if (change === 'override' && !SHARED_SETTINGS.includes(key as SharedSetting)) return { status: 400, error: 'Choose a repository setting.' };
  const refused = notEditable(repo, dir);
  if (refused) return refused;
  try {
    if (change === 'recheck') replaceAccess(repo, await detectAccess(repo), dir);
    else if (change === 'structure-sync') {
      if (typeof value !== 'boolean') throw new Error('Choose whether to save concepts and links.');
      const setup = readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))!;
      if (value && structureSyncOperations(repo).some((op) => writeAccessProblem(repo, op, setup.access) !== null)) throw new Error('Saving concepts and links needs permission to create issues, post comments and save their structure. Recheck access or leave it off.');
      setStructureSync(repo, value, dir);
    }
    else setOverride(repo, key as SharedSetting, value as SharedRepositorySettings[SharedSetting], dir);
  } catch (err) {
    return { status: 400, error: (err as Error).message };
  }
  return { setup: readRepositorySetups(dir).find((s) => sameRepo(s.repo, repo))! };
}

/** The repository list and settings come only from this machine. */
export interface OnboardedConfigs {
  configs: RepositoryConfig[];
  setups: RepositorySetup[];
  problems: RepositoryConfigProblem[];
}

export async function readOnboardedConfigs(list: readonly OnboardedRepository[], _run?: (args: string[]) => Promise<string>, dir = boardDataDir()): Promise<OnboardedConfigs> {
  const settings = readRepositorySetups(dir);
  const configs: RepositoryConfig[] = [];
  const setups: RepositorySetup[] = [];
  const problems: RepositoryConfigProblem[] = [];
  for (const { repo } of onTheBoard(list)) {
    const setup = settings.find((s) => sameRepo(s.repo, repo));
    if (!setup?.itemSource) {
      problems.push({ repo, problem: 'Choose the team whose work appears in the list.' });
      continue;
    }
    configs.push({ repo, role: setup.role, itemSource: setup.itemSource, labels: setup.labels });
    setups.push(setup);
  }
  return { configs, setups, problems };
}
