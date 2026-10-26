// The T3 projects onboarding's first step offers: each one's repository from its folder's origin, the provider from
// the origin's host, whether the repository has a Repository config on its default branch with the values onboarding
// reuses, and whether it's on the board.

import type { ProjectChoice, Provider } from '@lar-factory/shared';
import { findRepositoryConfig } from '../config/repository-config.ts';
import { azureRepo, checkouts, githubRepo, onAzureDevOps, originHost } from '../t3/repository-project.ts';
import { statsDbPath } from '../t3/t3-settings.ts';

/** The provider an origin URL is on, or null for any other host. */
function providerOf(origin: string): Provider | null {
  if (onAzureDevOps(origin)) return 'Azure DevOps';
  return originHost(origin) === 'github.com' ? 'GitHub' : null;
}

/** Whether a GitHub repository has .lar-factory.json on its default branch, with its values or why they can't be reused. */
async function configOf(repo: string, run?: (args: string[]) => Promise<string>): Promise<Pick<ProjectChoice, 'hasConfig' | 'config' | 'configProblem'>> {
  let found;
  try { found = await findRepositoryConfig(repo, run); }
  catch { return { hasConfig: null }; }
  if (!found) return { hasConfig: false };
  if ('problem' in found) return { hasConfig: true, configProblem: found.problem };
  return { hasConfig: true, config: { itemSource: found.itemSource, show: found.show, role: found.role } };
}

/** T3's live projects as onboarding offers them, in T3's order; throws when T3's projects can't be read. */
export async function projectChoices(list: readonly { repo: string }[], env: NodeJS.ProcessEnv = process.env,
  run?: (args: string[]) => Promise<string>): Promise<ProjectChoice[]> {
  let found;
  try { found = await checkouts(env); }
  catch { throw new Error(`Can't read T3 Code's projects at ${statsDbPath(env)}`); }
  const listed = new Set(list.map(({ repo }) => repo.toLowerCase()));
  return Promise.all(found.map(async ({ id, title, folder, origin }) => {
    const provider = origin ? providerOf(origin) : null;
    const repo = provider === 'GitHub' ? githubRepo(origin) : provider === 'Azure DevOps' ? azureRepo(origin!) : null;
    // Reading an Azure DevOps repository's file waits for build #386.
    const config = repo && provider === 'GitHub' ? await configOf(repo, run) : { hasConfig: null };
    return { id, name: title, folder, repo, provider: repo ? provider : null, ...config, onBoard: !!repo && listed.has(repo.toLowerCase()) };
  }));
}
