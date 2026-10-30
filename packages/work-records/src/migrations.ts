// The work-record database's schema, one step per entry. Never edit a released step: add one.

import type { Migration } from './database.ts';

export const MIGRATIONS: readonly Migration[] = [
  (db) => db.exec(`
    CREATE TABLE work_records (
      work_id TEXT PRIMARY KEY,
      repository TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      -- A Queued record's place in its repository's Queue; null in every other Status.
      queue_order INTEGER,
      ticket TEXT UNIQUE,
      set_aside_at TEXT,
      revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX work_records_by_repository ON work_records (repository, status);
  `),
];
