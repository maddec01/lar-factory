// Retention: this machine's setting for when finished and set-aside work records leave the board. It lives in the
// factory's data folder, never in a repository, so each machine keeps its own.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { WorkRecordError } from './database.ts';

export interface Retention {
  /** Days after a record is finished or set aside before the board hides it. */
  hideAfterDays: number;
  /** Days after a record is finished or set aside before it is deleted, or null to keep it indefinitely. */
  deleteAfterDays: number | null;
}

/** Keep every record, and hide finished and set-aside ones after seven days. */
export const DEFAULT_RETENTION: Retention = { hideAfterDays: 7, deleteAfterDays: null };

export const retentionPath = (dir = boardDataDir()): string => join(dir, 'retention.json');

const wholeDays = (days: unknown): days is number => Number.isSafeInteger(days) && (days as number) >= 0;

function checkRetention(value: unknown, source: string): Retention {
  const { hideAfterDays, deleteAfterDays } = (value ?? {}) as Partial<Retention>;
  if (!wholeDays(hideAfterDays) || !(deleteAfterDays === null || wholeDays(deleteAfterDays))) {
    throw new WorkRecordError('invalid', `The retention setting in ${source} needs hideAfterDays and deleteAfterDays as whole numbers of days from 0, deleteAfterDays null to keep records.`);
  }
  return { hideAfterDays, deleteAfterDays };
}

/** This machine's retention setting in `dir`, or the default while none is saved. */
export function readRetention(dir = boardDataDir()): Retention {
  const path = retentionPath(dir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...DEFAULT_RETENTION };
    throw new WorkRecordError('invalid', `Can't read the retention setting ${path}: ${(error as Error).message}.`);
  }
  try {
    return checkRetention(JSON.parse(text), path);
  } catch (error) {
    if (error instanceof WorkRecordError) throw error;
    throw new WorkRecordError('invalid', `The retention setting ${path} isn't JSON: ${(error as Error).message}.`);
  }
}

/** Saves `retention` as this machine's setting in `dir`, replacing the old one whole. */
export function writeRetention(retention: Retention, dir = boardDataDir()): Retention {
  const checked = checkRetention(retention, 'the change');
  const path = retentionPath(dir);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify(checked, null, 2)}\n`);
    renameSync(`${path}.${process.pid}.tmp`, path);
  } catch (error) {
    throw new WorkRecordError('unwritable', `Can't save the retention setting ${path}: ${(error as Error).message}.`);
  }
  return checked;
}
