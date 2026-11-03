// Heavy command limit: how many heavy commands may run at once on this machine, across all builds and worktrees. The
// setting lives in the factory's data folder, never in a repository, so each machine keeps its own.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HeavyCommandLimit } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { WorkRecordError } from './database.ts';

/** The saved limit, and why a file that couldn't be read or held an invalid value counts as Automatic. */
export interface SavedHeavyCommandLimit { limit: HeavyCommandLimit; problem?: string }

const heavyCommandLimitPath = (dir: string): string => join(dir, 'heavy-command-limit.json');

/**
 * The limit Automatic gives a machine with `cpus` CPUs and `totalMemoryBytes` of memory: the lower of a slot per 4 CPUs
 * and a slot per 8 GB, at least 1. Memory counts in whole GB, rounded to the nearest. Callers pass
 * `os.availableParallelism()` and `os.totalmem()`.
 */
export function automaticHeavyCommandLimit(cpus: number, totalMemoryBytes: number): number {
  const gb = Math.round(totalMemoryBytes / 2 ** 30);
  return Math.max(1, Math.floor(Math.min(cpus / 4, gb / 8)));
}

const validLimit = (limit: unknown): limit is HeavyCommandLimit => limit === 'automatic' || (Number.isSafeInteger(limit) && (limit as number) >= 1);
const NEEDS = 'needs a limit of "automatic" or a whole number from 1';

/** This machine's limit in `dir`. A missing file is Automatic; so is one it can't use, with the reason. */
export function readHeavyCommandLimit(dir = boardDataDir()): SavedHeavyCommandLimit {
  const path = heavyCommandLimitPath(dir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { limit: 'automatic' };
    return { limit: 'automatic', problem: `Can't read the heavy command limit setting ${path}: ${(error as Error).message}.` };
  }
  let limit: unknown;
  try {
    limit = (JSON.parse(text) as { limit?: unknown } | null)?.limit;
  } catch (error) {
    return { limit: 'automatic', problem: `The heavy command limit setting ${path} isn't JSON: ${(error as Error).message}.` };
  }
  return validLimit(limit) ? { limit } : { limit: 'automatic', problem: `The heavy command limit setting ${path} ${NEEDS}.` };
}

/** Saves `limit` as this machine's setting in `dir`, replacing the old file whole. */
export function writeHeavyCommandLimit(limit: HeavyCommandLimit, dir = boardDataDir()): HeavyCommandLimit {
  if (!validLimit(limit)) throw new WorkRecordError('invalid', `The heavy command limit ${NEEDS}.`);
  const path = heavyCommandLimitPath(dir);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify({ limit }, null, 2)}\n`);
    renameSync(`${path}.${process.pid}.tmp`, path);
  } catch (error) {
    throw new WorkRecordError('unwritable', `Can't save the heavy command limit setting ${path}: ${(error as Error).message}.`);
  }
  return limit;
}
