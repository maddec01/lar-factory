// A machine limit setting: Automatic or a whole number from 1, in its own file in the factory's data folder, never in a
// repository, so each machine keeps its own.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HeavyCommandLimit } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { WorkRecordError } from './database.ts';

/** The saved limit, and why a file that couldn't be read or held an invalid value counts as Automatic. */
export interface SavedLimit { limit: HeavyCommandLimit; problem?: string }

export interface LimitSetting {
  /** This machine's limit in `dir`. A missing file is Automatic; so is one it can't use, with the reason. */
  read(dir?: string): SavedLimit;
  /** Saves `limit` as this machine's setting in `dir`, replacing the old file whole. */
  write(limit: HeavyCommandLimit, dir?: string): HeavyCommandLimit;
}

const validLimit = (limit: unknown): limit is HeavyCommandLimit => limit === 'automatic' || (Number.isSafeInteger(limit) && (limit as number) >= 1);
const NEEDS = 'needs a limit of "automatic" or a whole number from 1';

/** The setting `name`, such as "heavy command limit", kept in `file`. */
export function limitSetting(file: string, name: string): LimitSetting {
  const pathIn = (dir: string): string => join(dir, file);
  return {
    read(dir = boardDataDir()) {
      const path = pathIn(dir);
      let text: string;
      try {
        text = readFileSync(path, 'utf8');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { limit: 'automatic' };
        return { limit: 'automatic', problem: `Can't read the ${name} setting ${path}: ${(error as Error).message}.` };
      }
      let limit: unknown;
      try {
        limit = (JSON.parse(text) as { limit?: unknown } | null)?.limit;
      } catch (error) {
        return { limit: 'automatic', problem: `The ${name} setting ${path} isn't JSON: ${(error as Error).message}.` };
      }
      return validLimit(limit) ? { limit } : { limit: 'automatic', problem: `The ${name} setting ${path} ${NEEDS}.` };
    },
    write(limit, dir = boardDataDir()) {
      if (!validLimit(limit)) throw new WorkRecordError('invalid', `The ${name} ${NEEDS}.`);
      const path = pathIn(dir);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify({ limit }, null, 2)}\n`);
        renameSync(`${path}.${process.pid}.tmp`, path);
      } catch (error) {
        throw new WorkRecordError('unwritable', `Can't save the ${name} setting ${path}: ${(error as Error).message}.`);
      }
      return limit;
    },
  };
}
