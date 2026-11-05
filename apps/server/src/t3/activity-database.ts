// Keep the read-only activity connection between passes, never a transaction or query result. Every statement still
// reads T3's latest committed data. A replaced database or a failed pass drops the connection before the next read.

import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { openT3Db } from './t3-db.ts';

export function createActivityDatabase(path: string) {
  let current: { db: DatabaseSync; dev: number; ino: number } | undefined;
  const close = () => {
    const before = current;
    current = undefined;
    before?.db.close();
  };
  return {
    open(): DatabaseSync {
      try {
        const { dev, ino } = statSync(path);
        if (current && (current.dev !== dev || current.ino !== ino)) close();
        current ??= { db: openT3Db(path), dev, ino };
        return current.db;
      } catch (error) {
        close();
        throw error;
      }
    },
    release(db: DatabaseSync | undefined, failed: boolean): void {
      // An idle pass or a T3 outage should hold no database open.
      if (!db || failed && current?.db === db) close();
    },
    close,
  };
}
