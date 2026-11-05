import type { ProjectChoice, ProjectIcon, Provider } from '@lar-factory/shared';
import { azureRepo, checkouts, githubRepo, linkedWorktree, onAzureDevOps, originHost, tilde } from '../t3/repository-project.ts';

/** The provider an origin URL is on, or null for any other host. */
function providerOf(origin: string): Provider | null {
  if (onAzureDevOps(origin)) return 'Azure DevOps';
  return originHost(origin) === 'github.com' ? 'GitHub' : null;
}

/**
 * T3's projects, their repository origins and their `icons` by project ID, read without contacting the tracker.
 */
export async function projectChoices(list: readonly { repo: string }[], icons: ReadonlyMap<string, ProjectIcon>, env: NodeJS.ProcessEnv = process.env): Promise<ProjectChoice[]> {
  let found;
  try { found = await checkouts(env); }
  catch { throw new Error("Can't read T3 Code's projects; reconnect T3 Code before onboarding"); }
  const listed = new Map(list.map((entry) => [entry.repo.toLowerCase(), entry]));
  return Promise.all(found.map(async ({ id, title, folder, origin }) => {
    const provider = origin ? providerOf(origin) : null;
    const repo = provider === 'GitHub' ? githubRepo(origin) : provider === 'Azure DevOps' ? azureRepo(origin!) : null;
    const entry = repo ? listed.get(repo.toLowerCase()) : undefined;
    const blocked = repo ? null : linkedWorktree(folder) ? 'linked-worktree' : 'no-provider-origin';
    return { id, name: title, folder, shownFolder: tilde(folder, env.HOME ?? ''), repo, provider: repo ? provider : null, blocked, onBoard: !!entry, icon: icons.get(id) ?? null };
  }));
}
