// The updater's lock and progress, shared by the board and scripts/update.ts.
// They live outside the checkout: a file inside it would fail the next update's clean check.

import { linkSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { UpdateProgress } from './model.ts';

export interface UpdatePaths {
  dir: string;
  lock: string;
  progress: string;
  log: string;
  boardLog: string;
}

export function updatePaths(home = process.env.HOME || homedir()): UpdatePaths {
  const dir = join(home, 'Library/Application Support/mux-factory-board');
  const logs = join(home, 'Library/Logs');
  return {
    dir,
    lock: join(dir, 'update.lock'),
    progress: join(dir, 'update.json'),
    log: join(logs, 'mux-board-update.log'),
    boardLog: join(logs, 'mux-board.log'),
  };
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** The pid of the live updater holding the lock, or null. A lock left by a dead process is cleared. */
export function lockHolder(paths: UpdatePaths): number | null {
  let pid: number;
  try { pid = Number(readFileSync(paths.lock, 'utf8').trim()); }
  catch { return null; }
  if (Number.isInteger(pid) && pid > 0 && alive(pid)) return pid;
  // Clear only the dead lock read above, not one another updater has just taken.
  try { if (readFileSync(paths.lock, 'utf8').trim() === String(pid)) unlinkSync(paths.lock); }
  catch { /* Another process cleared it first. */ }
  return null;
}

/** Takes the lock for this process; false when a live updater holds it. */
export function acquireLock(paths: UpdatePaths): boolean {
  mkdirSync(paths.dir, { recursive: true });
  // The lock appears with its pid already in it: link fails if it exists, so no one reads it empty.
  const temporary = `${paths.lock}.${process.pid}.tmp`;
  writeFileSync(temporary, String(process.pid));
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        linkSync(temporary, paths.lock);
        return true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        if (lockHolder(paths) !== null) return false;
      }
    }
    return false;
  } finally { unlinkSync(temporary); }
}

export function releaseLock(paths: UpdatePaths): void {
  try {
    if (readFileSync(paths.lock, 'utf8').trim() === String(process.pid)) unlinkSync(paths.lock);
  } catch { /* Already gone. */ }
}

export function writeProgress(paths: UpdatePaths, progress: UpdateProgress): void {
  mkdirSync(paths.dir, { recursive: true });
  const temporary = `${paths.progress}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(progress));
  renameSync(temporary, paths.progress);
}

/** The latest update's progress, or null if none ran. A running update whose process died reads as failed. */
export function readProgress(paths: UpdatePaths): UpdateProgress | null {
  let progress: UpdateProgress;
  try { progress = JSON.parse(readFileSync(paths.progress, 'utf8')) as UpdateProgress; }
  catch { return null; }
  if (progress.state === 'running' && !alive(progress.pid)) {
    return { ...progress, state: 'failed', error: `The updater stopped before it finished. See ${paths.log}, then press Update to retry.` };
  }
  return progress;
}
