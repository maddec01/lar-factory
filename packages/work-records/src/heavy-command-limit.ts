// Heavy command limit: how many heavy commands may run at once on this machine, across all builds and worktrees.

import { limitSetting, type SavedLimit } from './limit-setting.ts';

/** The saved limit, and why a file that couldn't be read or held an invalid value counts as Automatic. */
export type SavedHeavyCommandLimit = SavedLimit;

/**
 * The limit Automatic gives a machine with `cpus` CPUs and `totalMemoryBytes` of memory: the lower of a slot per 4 CPUs
 * and a slot per 8 GB, at least 1. Memory counts in whole GB, rounded to the nearest. Callers pass
 * `os.availableParallelism()` and `os.totalmem()`.
 */
export function automaticHeavyCommandLimit(cpus: number, totalMemoryBytes: number): number {
    const gb = Math.round(totalMemoryBytes / 2 ** 30);
    return Math.max(1, Math.floor(Math.min(cpus / 4, gb / 8)));
}

export const heavyCommandLimitSetting = limitSetting('heavy-command-limit.json', 'heavy command limit');
export const readHeavyCommandLimit = heavyCommandLimitSetting.read;
export const writeHeavyCommandLimit = heavyCommandLimitSetting.write;
