// The T3 projects onboarding's first step offers: each one's repository from its folder's origin, the provider from
// the origin's host, whether the repository has a Repository config on its default branch with the values onboarding
// reuses, and whether it's on the board; and the offers the board shows for the ones it can onboard with the
// Repository config they have.

import type { OnboardingOffer, ProjectChoice, Provider } from '@lar-factory/shared';
import type { OnboardedRepository } from '../config/repository-config.ts';
import type { ConfigAnswer } from './config-checks.ts';
import { azureRepo, checkouts, githubRepo, onAzureDevOps, originHost } from '../t3/repository-project.ts';

/** The provider an origin URL is on, or null for any other host. */
function providerOf(origin: string): Provider | null {
  if (onAzureDevOps(origin)) return 'Azure DevOps';
  return originHost(origin) === 'github.com' ? 'GitHub' : null;
}

/**
 * T3's live projects as onboarding offers them, in T3's order, with `configOf` telling whether a repository has
 * .lar-factory.json on its default branch; throws when T3's projects can't be read.
 */
export async function projectChoices(list: readonly OnboardedRepository[], configOf: (repo: string) => Promise<ConfigAnswer>,
  env: NodeJS.ProcessEnv = process.env): Promise<ProjectChoice[]> {
  let found;
  try { found = await checkouts(env); }
  catch { throw new Error("Can't read T3 Code's projects; reconnect T3 Code before onboarding"); }
  const listed = new Map(list.map((entry) => [entry.repo.toLowerCase(), entry]));
  return Promise.all(found.map(async ({ id, title, folder, origin }) => {
    const provider = origin ? providerOf(origin) : null;
    const repo = provider === 'GitHub' ? githubRepo(origin) : provider === 'Azure DevOps' ? azureRepo(origin!) : null;
    const config: ConfigAnswer = repo ? await configOf(repo) : { hasConfig: null };
    const entry = repo ? listed.get(repo.toLowerCase()) : undefined;
    return { id, name: title, folder, repo, provider: repo ? provider : null, ...config, onBoard: !!entry && (!config.configProblem || !!entry.onboarding || !!entry.resetting) };
  }));
}

/** An offer for each T3 project whose repository has .lar-factory.json and isn't on the list. */
export function onboardingOffers(choices: readonly ProjectChoice[]): OnboardingOffer[] {
  return choices.filter((c) => c.provider && c.hasConfig === true && !c.onBoard && c.repo)
    .map(({ id, name, repo, provider, configProblem }) => ({ projectId: id, name, repo: repo!, provider: provider!, ...configProblem && { configProblem } }));
}
