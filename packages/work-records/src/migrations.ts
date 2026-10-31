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
  (db) => db.exec(`
    -- A record's one structural parent: a concept owns decisions and builds, a build owns slices.
    ALTER TABLE work_records ADD COLUMN parent_id TEXT REFERENCES work_records (work_id);
    CREATE INDEX work_records_by_parent ON work_records (parent_id);
    -- work_id waits on blocker_id. The module keeps the edges acyclic.
    CREATE TABLE blockers (
      work_id TEXT NOT NULL REFERENCES work_records (work_id),
      blocker_id TEXT NOT NULL REFERENCES work_records (work_id),
      PRIMARY KEY (work_id, blocker_id),
      CHECK (work_id <> blocker_id)
    ) STRICT;
    CREATE INDEX blockers_by_blocker ON blockers (blocker_id);
  `),
];
