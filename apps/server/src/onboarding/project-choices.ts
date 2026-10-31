import type { ProjectChoice, Provider } from '@lar-factory/shared';
import type { OnboardedRepository } from '../config/repository-config.ts';
import { azureRepo, checkouts, githubRepo, onAzureDevOps, originHost } from '../t3/repository-project.ts';

/** The provider an origin URL is on, or null for any other host. */
function providerOf(origin: string): Provider | null {
  if (onAzureDevOps(origin)) return 'Azure DevOps';
  return originHost(origin) === 'github.com' ? 'GitHub' : null;
}

/**
 * T3's projects and their repository origins, read without contacting the tracker.
 */
export async function projectChoices(list: readonly OnboardedRepository[], env: NodeJS.ProcessEnv = process.env): Promise<ProjectChoice[]> {
  let found;
  try { found = await checkouts(env); }
  catch { throw new Error("Can't read T3 Code's projects; reconnect T3 Code before onboarding"); }
  const listed = new Map(list.map((entry) => [entry.repo.toLowerCase(), entry]));
  return Promise.all(found.map(async ({ id, title, folder, origin }) => {
    const provider = origin ? providerOf(origin) : null;
    const repo = provider === 'GitHub' ? githubRepo(origin) : provider === 'Azure DevOps' ? azureRepo(origin!) : null;
    const entry = repo ? listed.get(repo.toLowerCase()) : undefined;
    return { id, name: title, folder, repo, provider: repo ? provider : null, onBoard: !!entry };
  }));
}
