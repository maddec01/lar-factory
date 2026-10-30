// The factory's work records: the one module that writes the work-record database. Each operation validates its input
// first and runs in one transaction, so a refused or failed change leaves every record as it was. Every change names
// the revision it read; a stale revision changes nothing, so the board and threads never overwrite each other's work.

import { randomUUID } from 'node:crypto';
import { STATUSES, type Status } from '@lar-factory/shared';
import { openDatabase, WorkRecordError, workRecordsPath, type Database } from './database.ts';

export { WorkRecordError, workRecordsPath, type WorkRecordErrorCode } from './database.ts';

/** The board's kinds, plus a build's slice. */
export const WORK_KINDS = ['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'slice', 'issue'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

export interface WorkRecord {
  /** The record's local identity, fixed for its life whether or not it has a ticket. */
  workId: string;
  /** The repository the work belongs to, as the board names it: `owner/name`. */
  repository: string;
  kind: WorkKind;
  status: Status;
  /** A Queued record's place in its repository's Queue; null in every other Status. */
  queueOrder: number | null;
  /** Its published ticket, `owner/name#number`, or null while it has none. */
  ticket: string | null;
  /** Whether it is set aside, which leaves its Status as it was. */
  setAside: boolean;
  /** Counts the record's changes; every change names the revision it read. */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface NewWorkRecord {
  repository: string;
  kind: WorkKind;
  status?: Status;
  ticket?: string;
}

export interface WorkRecordFilter {
  repository?: string;
  status?: Status;
  kind?: WorkKind;
}

export interface WorkRecords {
  create(record: NewWorkRecord): WorkRecord;
  /** Throws `not-found` when no record has `workId`. */
  read(workId: string): WorkRecord;
  /** The matching records, Queued ones in Queue order first, then the rest in the order they were made. */
  list(filter: WorkRecordFilter): WorkRecord[];
  update(workId: string, revision: number, change: { status?: Status; kind?: WorkKind }): WorkRecord;
  /** Gives a ticketless record its ticket. The work ID stays; a record can't swap one ticket for another. */
  attachTicket(workId: string, revision: number, ticket: string): WorkRecord;
  /** The record holding `ticket`, made first when none does yet. */
  importTicket(record: NewWorkRecord & { ticket: string }): { record: WorkRecord; created: boolean };
  setAside(workId: string, revision: number): WorkRecord;
  restore(workId: string, revision: number): WorkRecord;
  close(): void;
}

interface Row {
  work_id: string;
  repository: string;
  kind: WorkKind;
  status: Status;
  queue_order: number | null;
  ticket: string | null;
  set_aside_at: string | null;
  revision: number;
  created_at: string;
  updated_at: string;
}

const fromRow = (row: Row): WorkRecord => ({
  workId: row.work_id,
  repository: row.repository,
  kind: row.kind,
  status: row.status,
  queueOrder: row.queue_order,
  ticket: row.ticket,
  setAside: row.set_aside_at !== null,
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const invalid = (message: string) => new WorkRecordError('invalid', message);

function checkRepository(repository: unknown): string {
  if (typeof repository !== 'string' || !/^[^\s/]+(\/[^\s/]+)+$/.test(repository)) throw invalid(`The repository "${String(repository)}" isn't a repository name like owner/name.`);
  return repository;
}

function checkKind(kind: unknown): WorkKind {
  if (!WORK_KINDS.includes(kind as WorkKind)) throw invalid(`The kind "${String(kind)}" isn't one of ${WORK_KINDS.join(', ')}.`);
  return kind as WorkKind;
}

function checkStatus(status: unknown): Status {
  if (!STATUSES.includes(status as Status)) throw invalid(`The Status "${String(status)}" isn't one of ${STATUSES.join(', ')}.`);
  return status as Status;
}

function checkTicket(ticket: unknown): string {
  if (typeof ticket !== 'string' || !/^[^\s/#]+(\/[^\s/#]+)+#[1-9]\d*$/.test(ticket)) throw invalid(`The ticket "${String(ticket)}" isn't a ticket reference like owner/name#12.`);
  return ticket;
}

function checkRevision(revision: unknown): number {
  if (!Number.isSafeInteger(revision) || (revision as number) < 1) throw invalid(`The revision "${String(revision)}" isn't a whole number from 1.`);
  return revision as number;
}

/** Opens the work records in the database at `path`, the factory data folder's by default. */
export async function openWorkRecords(path = workRecordsPath()): Promise<WorkRecords> {
  return workRecords(await openDatabase(path));
}

function workRecords(database: Database): WorkRecords {
  const { db } = database;
  const select = db.prepare('SELECT * FROM work_records WHERE work_id = ?');
  const byTicket = db.prepare('SELECT * FROM work_records WHERE ticket = ?');
  const nextQueueOrder = db.prepare('SELECT coalesce(max(queue_order), 0) + 1 AS next FROM work_records WHERE repository = ?');

  const find = (workId: string): Row => {
    const row = select.get(workId) as Row | undefined;
    if (!row) throw new WorkRecordError('not-found', `No work record has the work ID "${workId}".`);
    return row;
  };
  const queueOrder = (repository: string, status: Status, current: number | null = null): number | null =>
    status !== 'Queued' ? null : current ?? Number(nextQueueOrder.get(repository)!.next);

  // Each filtered query's statement, prepared the first time its combination of filters runs.
  const filteredQueries = new Map<string, ReturnType<typeof db.prepare>>();
  /** The rows of `query` that pass each condition with a value: a string it binds, or true for a test that binds none. */
  const filtered = (query: string, order: string, conditions: readonly [test: string, value: string | true | undefined][]) => {
    const used = conditions.filter(([, value]) => value !== undefined);
    const sql = `${query}${used.length ? ` WHERE ${used.map(([test]) => test).join(' AND ')}` : ''} ${order}`;
    let statement = filteredQueries.get(sql);
    if (!statement) filteredQueries.set(sql, (statement = db.prepare(sql)));
    return statement.all(...used.flatMap(([, value]) => (typeof value === 'string' ? [value] : [])));
  };

  const insertRow = db.prepare(`INSERT INTO work_records (work_id, repository, kind, status, queue_order, ticket, set_aside_at, revision, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, NULL, 1, ?, ?)`);
  const insert = (record: NewWorkRecord): WorkRecord => {
    const repository = checkRepository(record.repository);
    const kind = checkKind(record.kind);
    const status = checkStatus(record.status ?? 'List');
    const ticket = record.ticket === undefined ? null : checkTicket(record.ticket);
    if (ticket && byTicket.get(ticket)) throw new WorkRecordError('ticket-taken', `Another work record already holds the ticket ${ticket}.`);
    const now = new Date().toISOString();
    const workId = randomUUID();
    insertRow.run(workId, repository, kind, status, queueOrder(repository, status), ticket, now, now);
    return fromRow(find(workId));
  };

  /** Applies `change` to the record at `revision`, bumping it; throws when the record moved on. */
  const change = (workId: string, revision: number, apply: (row: Row) => Partial<Row>): WorkRecord =>
    database.write(() => {
      const expected = checkRevision(revision);
      const row = find(workId);
      if (row.revision !== expected) {
        throw new WorkRecordError('stale-revision', `The work record ${workId} is at revision ${row.revision}, not ${expected}; read it again and retry.`);
      }
      const next = { ...row, ...apply(row), revision: row.revision + 1, updated_at: new Date().toISOString() };
      db.prepare(`UPDATE work_records SET kind = ?, status = ?, queue_order = ?, ticket = ?, set_aside_at = ?, revision = ?, updated_at = ?
        WHERE work_id = ? AND revision = ?`)
        .run(next.kind, next.status, next.queue_order, next.ticket, next.set_aside_at, next.revision, next.updated_at, workId, expected);
      return fromRow(find(workId));
    });

  return {
    create: (record) => database.write(() => insert(record)),
    read: (workId) => database.read(() => fromRow(find(workId))),
    list: (filter) => database.read(() => (filtered('SELECT * FROM work_records', 'ORDER BY queue_order IS NULL, queue_order, rowid', [
      ['repository = ?', filter.repository === undefined ? undefined : checkRepository(filter.repository)],
      ['status = ?', filter.status === undefined ? undefined : checkStatus(filter.status)],
      ['kind = ?', filter.kind === undefined ? undefined : checkKind(filter.kind)],
    ]) as unknown as Row[]).map(fromRow)),
    update: (workId, revision, { status, kind }) => {
      const nextStatus = status === undefined ? undefined : checkStatus(status);
      const nextKind = kind === undefined ? undefined : checkKind(kind);
      return change(workId, revision, (row) => {
        const moved = nextStatus ?? row.status;
        return {
          status: moved,
          kind: nextKind ?? row.kind,
          queue_order: queueOrder(row.repository, moved, moved === row.status ? row.queue_order : null),
        };
      });
    },
    attachTicket: (workId, revision, ticket) => {
      const reference = checkTicket(ticket);
      return change(workId, revision, (row) => {
        if (row.ticket === reference) return {};
        if (row.ticket) throw invalid(`The work record ${workId} already has the ticket ${row.ticket}; it can't take ${reference}.`);
        const holder = byTicket.get(reference) as Row | undefined;
        if (holder) throw new WorkRecordError('ticket-taken', `The work record ${holder.work_id} already holds the ticket ${reference}.`);
        return { ticket: reference };
      });
    },
    importTicket: (record) => database.write(() => {
      const ticket = checkTicket(record.ticket);
      const existing = byTicket.get(ticket) as Row | undefined;
      if (!existing) return { record: insert(record), created: true };
      if (existing.repository !== record.repository) {
        throw new WorkRecordError('ticket-taken', `The ticket ${ticket} already belongs to the work record ${existing.work_id} in ${existing.repository}.`);
      }
      return { record: fromRow(existing), created: false };
    }),
    setAside: (workId, revision) => change(workId, revision, (row) => {
      if (row.set_aside_at) throw invalid(`The work record ${workId} is already set aside.`);
      return { set_aside_at: new Date().toISOString() };
    }),
    restore: (workId, revision) => change(workId, revision, (row) => {
      if (!row.set_aside_at) throw invalid(`The work record ${workId} isn't set aside.`);
      return { set_aside_at: null };
    }),
    close: () => database.close(),
  };
}
