// The work-record database's connection: how it opens, updates its schema and runs each write. The settings and the
// update protection follow pingdotgg/t3code at 97e35bcf23e4dcf34c2dcffadd37c08db0e01e52 (#686, Q18):
// apps/server/src/persistence/Sqlite.ts for the PRAGMAs, apps/server/src/persistence/Migrations.ts for running every
// pending migration in one transaction, and apps/server/src/serviceLauncher.ts for copying the database before an
// update, restoring the copy when the update fails and deleting it once it succeeds. T3 copies its files with the
// server stopped; the board and threads may hold this database open, so the copy comes from VACUUM INTO, which
// includes committed WAL data, and the restore goes through SQLite's backup API.

import { chmodSync, closeSync, existsSync, mkdirSync, openSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { boardDataDir } from '@lar-factory/shared/data-dir';
import { MIGRATIONS } from './migrations.ts';

/** The work-record database in the factory's data folder. */
export const workRecordsPath = (dir = boardDataDir()): string => join(dir, 'work-records.db');

/** One schema step. The database's `user_version` counts the steps applied. */
export type Migration = (db: DatabaseSync) => void;

export type WorkRecordErrorCode =
  | 'invalid'
  | 'not-found'
  | 'stale-revision'
  | 'ticket-taken'
  | 'busy'
  | 'unwritable'
  | 'schema-too-new'
  | 'schema-update-failed';

/** A failure the command reports as it is. Messages name records, tickets and paths, never credentials. */
export class WorkRecordError extends Error {
  readonly code: WorkRecordErrorCode;
  constructor(code: WorkRecordErrorCode, message: string) {
    super(message);
    this.name = 'WorkRecordError';
    this.code = code;
  }
}

export interface Database {
  readonly db: DatabaseSync;
  /** Runs `change` in one write transaction: it commits whole or not at all. */
  write<T>(change: () => T): T;
  /** Runs `query` after checking the schema is still the one this process knows. */
  read<T>(query: () => T): T;
  close(): void;
}

// SQLite's primary result codes, from an extended code.
const BUSY = 5;
const LOCKED = 6;
const READONLY = 8;
const CANTOPEN = 14;

/** `error` as a WorkRecordError when SQLite says the database is locked or can't be written. */
function sqliteError(error: unknown, path: string): unknown {
  if (error instanceof WorkRecordError || !(error instanceof Error) || !('errcode' in error)) return error;
  const code = Number(error.errcode) & 0xff;
  if (code === BUSY || code === LOCKED) return new WorkRecordError('busy', `The work-record database ${path} is locked by another writer; try again.`);
  if (code === READONLY || code === CANTOPEN) return new WorkRecordError('unwritable', `The work-record database ${path} can't be written: ${error.message}.`);
  return error;
}

const userVersion = (db: DatabaseSync): number => Number(db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
const dataVersion = (db: DatabaseSync): number => Number(db.prepare('PRAGMA data_version').get()?.data_version ?? 0);

function tooNew(version: number, known: number, path: string): WorkRecordError {
  return new WorkRecordError('schema-too-new',
    `The work-record database ${path} has schema version ${version}, which is newer than this command understands (${known}). Update Lar Factory.`);
}

function transaction<T>(db: DatabaseSync, change: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = change();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

/**
 * Applies the pending migrations in one transaction, after copying the database when it already holds a schema. A
 * failed migration still inside the transaction rolls back cleanly. One that ended the transaction may have committed
 * part of its work, so the copy replaces the database. A writer that commits between the copy and the lock would be
 * lost by that restore, so the copy is taken again when one does.
 */
async function migrate(db: DatabaseSync, path: string, migrations: readonly Migration[]): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    const from = userVersion(db);
    if (from > migrations.length) throw tooNew(from, migrations.length, path);
    if (from === migrations.length) return;
    const copy = from > 0 ? `${path}.before-v${migrations.length}-${process.pid}` : null;
    const seen = dataVersion(db);
    try {
      if (copy) db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
      db.exec('BEGIN IMMEDIATE');
      if (dataVersion(db) !== seen) {
        db.exec('ROLLBACK');
        if (attempt === 3) throw new WorkRecordError('busy', `The work-record database ${path} kept changing during its schema update; try again.`);
        continue;
      }
      for (let version = from + 1; version <= migrations.length; version++) {
        try {
          migrations[version - 1]!(db);
          if (!db.isTransaction) throw new Error('the migration ended its transaction');
        } catch (error) {
          const intact = db.isTransaction;
          if (intact) db.exec('ROLLBACK');
          else if (copy) await restore(copy, path);
          throw new WorkRecordError('schema-update-failed',
            `The work-record database's schema update to version ${version} failed: ${error instanceof Error ? error.message : String(error)}. Its committed records are unchanged.`);
        }
      }
      db.exec(`PRAGMA user_version = ${migrations.length}`);
      db.exec('COMMIT');
      return;
    } catch (error) {
      if (db.isTransaction) db.exec('ROLLBACK');
      throw sqliteError(error, path);
    } finally {
      if (copy) rmSync(copy, { force: true });
    }
  }
}

/** Writes the copy at `copy` back over the database at `path` through SQLite, which honours other connections' locks. */
async function restore(copy: string, path: string): Promise<void> {
  const source = new DatabaseSync(copy, { readOnly: true });
  try {
    await backup(source, path);
  } finally {
    source.close();
  }
}

/**
 * Opens the work-record database at `path`, creating its folder and bringing its schema up to date. Throws a
 * WorkRecordError when the schema is newer than this process knows, the update fails, or the file can't be written.
 */
export async function openDatabase(path = workRecordsPath(), { migrations = MIGRATIONS, busyTimeout = 5000 }: {
  migrations?: readonly Migration[];
  /** How long a write waits for another writer, in milliseconds. */
  busyTimeout?: number;
} = {}): Promise<Database> {
  let db: DatabaseSync;
  try {
    mkdirSync(dirname(path), { recursive: true });
    // The records are private. Making the file 0600 before SQLite opens it gives the WAL files SQLite creates the same mode.
    closeSync(openSync(path, 'a', 0o600));
    db = new DatabaseSync(path);
    // The board and thread commands write from separate processes; wait rather than fail with SQLITE_BUSY.
    db.exec(`PRAGMA busy_timeout = ${Math.trunc(busyTimeout)}`);
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA journal_mode = WAL');
    // NORMAL syncs only at WAL checkpoints: an app crash loses nothing, power loss can roll back the latest commits.
    db.exec('PRAGMA synchronous = NORMAL');
    // macOS fsync misses drive caches; F_FULLFSYNC flushes them at checkpoints.
    db.exec('PRAGMA checkpoint_fullfsync = ON');
    // An older database, or one copied in, may be readable by others.
    for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600);
  } catch (error) {
    const failure = sqliteError(error, path);
    throw failure instanceof WorkRecordError ? failure
      : new WorkRecordError('unwritable', `The work-record database ${path} can't be opened: ${error instanceof Error ? error.message : String(error)}.`);
  }
  try {
    await migrate(db, path, migrations);
  } catch (error) {
    db.close();
    throw error;
  }
  // A newer process may update the schema while this one stays open; check before every statement batch.
  const checked = <T>(run: () => T): T => {
    const version = userVersion(db);
    if (version !== migrations.length) throw tooNew(version, migrations.length, path);
    return run();
  };
  return {
    db,
    write: (change) => {
      try {
        return transaction(db, () => checked(change));
      } catch (error) {
        throw sqliteError(error, path);
      }
    },
    read: (query) => {
      try {
        return checked(query);
      } catch (error) {
        throw sqliteError(error, path);
      }
    },
    close: () => db.close(),
  };
}
