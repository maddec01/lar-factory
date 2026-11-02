// Shaping thread cleanup: this machine's setting for what the board does to an item's shaping threads once Start build
// records a build thread. It lives in the factory's data folder, never in a repository, so each machine keeps its own.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SHAPING_THREAD_CLEANUPS, type ShapingThreadCleanup } from '@lar-factory/shared';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { WorkRecordError } from './database.ts';

/** Settle the shaping threads, which item details still links to. */
const DEFAULT_SHAPING_THREAD_CLEANUP: ShapingThreadCleanup = 'settle';

const shapingThreadCleanupPath = (dir: string): string => join(dir, 'shaping-thread-cleanup.json');

function checkChoice(choice: unknown, source: string): ShapingThreadCleanup {
  if (!SHAPING_THREAD_CLEANUPS.includes(choice as ShapingThreadCleanup)) {
    throw new WorkRecordError('invalid', `The shaping thread cleanup setting in ${source} needs a choice of ${SHAPING_THREAD_CLEANUPS.join(', ')}.`);
  }
  return choice as ShapingThreadCleanup;
}

/** This machine's choice in `dir`, or the default while none is saved. */
export function readShapingThreadCleanup(dir = boardDataDir()): ShapingThreadCleanup {
  const path = shapingThreadCleanupPath(dir);
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return DEFAULT_SHAPING_THREAD_CLEANUP;
    throw new WorkRecordError('invalid', `Can't read the shaping thread cleanup setting ${path}: ${(error as Error).message}.`);
  }
  try {
    return checkChoice((JSON.parse(text) as { choice?: unknown } | null)?.choice, path);
  } catch (error) {
    if (error instanceof WorkRecordError) throw error;
    throw new WorkRecordError('invalid', `The shaping thread cleanup setting ${path} isn't JSON: ${(error as Error).message}.`);
  }
}

/** Saves `choice` as this machine's setting in `dir`, replacing the old file whole. */
export function writeShapingThreadCleanup(choice: ShapingThreadCleanup, dir = boardDataDir()): ShapingThreadCleanup {
  const checked = checkChoice(choice, 'the change');
  const path = shapingThreadCleanupPath(dir);
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(`${path}.${process.pid}.tmp`, `${JSON.stringify({ choice: checked }, null, 2)}\n`);
    renameSync(`${path}.${process.pid}.tmp`, path);
  } catch (error) {
    throw new WorkRecordError('unwritable', `Can't save the shaping thread cleanup setting ${path}: ${(error as Error).message}.`);
  }
  return checked;
}
