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
  (db) => db.exec(`
    -- Where a build stands in the lar-build workflow, and the PR it delivers through.
    ALTER TABLE work_records ADD COLUMN build_phase TEXT;
    ALTER TABLE work_records ADD COLUMN pull_request TEXT;
    -- Private markdown: a brief, a decision's text or a concept's map. Nothing here is written to a provider.
    CREATE TABLE bodies (
      work_id TEXT NOT NULL REFERENCES work_records (work_id),
      body TEXT NOT NULL,
      markdown TEXT NOT NULL,
      PRIMARY KEY (work_id, body)
    ) STRICT;
    -- A build's review rounds: each reviewer axis's verdict, then its findings in the order it gave them.
    CREATE TABLE review_rounds (
      work_id TEXT NOT NULL REFERENCES work_records (work_id),
      round INTEGER NOT NULL,
      base TEXT NOT NULL,
      recorded_at TEXT NOT NULL,
      PRIMARY KEY (work_id, round)
    ) STRICT;
    CREATE TABLE review_axes (
      work_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      axis TEXT NOT NULL,
      verdict TEXT NOT NULL,
      not_checked TEXT,
      PRIMARY KEY (work_id, round, axis),
      FOREIGN KEY (work_id, round) REFERENCES review_rounds (work_id, round)
    ) STRICT;
    CREATE TABLE review_findings (
      work_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      axis TEXT NOT NULL,
      finding INTEGER NOT NULL,
      severity TEXT NOT NULL,
      summary TEXT NOT NULL,
      disposition TEXT NOT NULL,
      reason TEXT,
      PRIMARY KEY (work_id, round, axis, finding),
      FOREIGN KEY (work_id, round, axis) REFERENCES review_axes (work_id, round, axis)
    ) STRICT;
    -- The T3 threads that worked on a record. A thread works on one record.
    CREATE TABLE threads (
      thread_id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES work_records (work_id),
      purpose TEXT NOT NULL,
      recorded_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX threads_by_work_id ON threads (work_id);
    -- A start the board asked T3 for, kept until it resolves to T3's thread ID or a failure.
    CREATE TABLE launch_intents (
      intent_id TEXT PRIMARY KEY,
      work_id TEXT NOT NULL REFERENCES work_records (work_id),
      purpose TEXT NOT NULL,
      requested_at TEXT NOT NULL,
      thread_id TEXT,
      failure TEXT,
      resolved_at TEXT
    ) STRICT;
    CREATE INDEX launch_intents_by_work_id ON launch_intents (work_id);
  `),
  (db) => db.exec(`
    -- When the work was finished, recorded from its delivery PR. Retention counts from it; Status never sets it.
    ALTER TABLE work_records ADD COLUMN finished_at TEXT;
  `),
];
