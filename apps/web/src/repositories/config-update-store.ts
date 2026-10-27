// The config update notice on a repository's row in Settings › Repositories: Open PR posts the repository for the PR
// that rewrites its .lar-factory.json at the app's version, Dismiss posts it to hide the notice at that version. The
// board the server sends back drops the notice; a call that fails keeps it, with the problem.

import { create } from 'zustand';
import { postAction, receive } from '../items/card-actions.ts';

type Call = 'pr' | 'dismiss';

interface ConfigUpdateState {
  /** The call running for each repository, by repository. */
  running: Record<string, Call>;
  /** Why each repository's last call failed, with gh's message, by repository. */
  errors: Record<string, string>;
  openPr: (repo: string) => Promise<void>;
  dismiss: (repo: string) => Promise<void>;
}

const PATHS: Record<Call, string> = { pr: '/api/repositories/config-update/pr', dismiss: '/api/repositories/config-update/dismiss' };

export const useConfigUpdateStore = create<ConfigUpdateState>()((set, get) => {
  async function call(repo: string, which: Call): Promise<void> {
    if (get().running[repo]) return;
    const { [repo]: _, ...errors } = get().errors;
    set({ running: { ...get().running, [repo]: which }, errors });
    const result = await postAction(PATHS[which], { repo });
    receive(result);
    const { [repo]: __, ...running } = get().running;
    set({ running, errors: result.error ? { ...get().errors, [repo]: result.error } : get().errors });
  }
  return { running: {}, errors: {}, openPr: (repo) => call(repo, 'pr'), dismiss: (repo) => call(repo, 'dismiss') };
});
