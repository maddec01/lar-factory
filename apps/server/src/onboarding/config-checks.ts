// Whether each GitHub repository has .lar-factory.json on its default branch, and its values, for onboarding's offers
// and its T3 project step. Each repository's answer is read once and kept until clear(), which Recheck calls, so a refresh makes
// no gh call for a repository already answered. A check that fails answers hasConfig null, is logged and is tried again next time.

import type { ProjectChoice } from '@lar-factory/shared';
import { findRepositoryConfig } from '../config/repository-config.ts';
import { log } from '../log.ts';

/** Whether a repository has .lar-factory.json on its default branch, with its values or why they can't be reused. */
export type ConfigAnswer = Pick<ProjectChoice, 'hasConfig' | 'config' | 'configProblem'>;

export interface ConfigChecks {
  /** `repo`'s answer; hasConfig is null when gh can't tell. */
  configOf(repo: string): Promise<ConfigAnswer>;
  /** Forgets every answer, so each repository is read again. */
  clear(): void;
}

export function createConfigChecks(run?: (args: string[]) => Promise<string>, logLine: (line: string) => void = log): ConfigChecks {
  /** Each repository's answer, or its read while it runs, by lowercased owner/name. */
  const answers = new Map<string, Promise<ConfigAnswer>>();
  /** The repositories whose latest check failed, so a failure that lasts logs once. */
  const failing = new Set<string>();
  const check = async (repo: string, key: string): Promise<ConfigAnswer> => {
    let found;
    try { found = await findRepositoryConfig(repo, run); }
    catch (err) {
      if (!failing.has(key)) logLine(`can't tell whether ${repo} has .lar-factory.json: ${err instanceof Error ? err.message : String(err)}`);
      failing.add(key);
      return { hasConfig: null };
    }
    failing.delete(key);
    if (!found) return { hasConfig: false };
    if ('problem' in found) return { hasConfig: true, configProblem: found.problem };
    return { hasConfig: true, config: { itemSource: found.itemSource, show: found.show, role: found.role } };
  };
  return {
    configOf: (repo) => {
      const key = repo.toLowerCase();
      const known = answers.get(key);
      if (known) return known;
      const read = check(repo, key);
      answers.set(key, read);
      // A failure is no answer, so the next check reads again, unless clear() dropped this read already.
      void read.then(({ hasConfig }) => { if (hasConfig === null && answers.get(key) === read) answers.delete(key); });
      return read;
    },
    clear: () => answers.clear(),
  };
}
