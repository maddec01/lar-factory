// The factory's work records: the one module that writes the work-record database. Each operation validates its input
// first and runs in one transaction, so a refused or failed change leaves every record as it was. Every change names
// the revision it read; a stale revision changes nothing, so the board and threads never overwrite each other's work.

import { randomUUID } from 'node:crypto';
import type { StatementSync } from 'node:sqlite';
import { STATUSES, type Status } from '@lar-factory/shared';
import { openDatabase, WorkRecordError, workRecordsPath, type Database } from './database.ts';

export { WorkRecordError, workRecordsPath, type WorkRecordErrorCode } from './database.ts';

/** The board's kinds, plus a build's slice. */
export const WORK_KINDS = ['bug', 'feature', 'improvement', 'concept', 'decision', 'build', 'slice', 'issue'] as const;
export type WorkKind = (typeof WORK_KINDS)[number];

/** The stages of the lar-build workflow (`skills/lar-build/agents/builder.md`): Build's plan, implement, domain docs and
 * full check suite steps, then Review, Approve, Checks and Retro. A Small build skips plan. */
export const BUILD_PHASES = ['plan', 'implement', 'domain-docs', 'full-checks', 'review', 'approve', 'checks', 'retro'] as const;
export type BuildPhase = (typeof BUILD_PHASES)[number];

/** A record's private markdown: a concept's map, a decision's text, or any other record's brief. */
export const BODIES = ['brief', 'decision', 'map'] as const;
export type Body = (typeof BODIES)[number];

/** The lar-build reviewers, one axis each (`skills/lar-build/agents/builder.md`, Review). */
export const REVIEW_AXES = ['code', 'security', 'ui', 'performance'] as const;
export type ReviewAxis = (typeof REVIEW_AXES)[number];
/** A reviewer's verdict, or `skipped` when the builder didn't run it. */
export const REVIEW_VERDICTS = ['approve', 'changes', 'skipped'] as const;
export type ReviewVerdict = (typeof REVIEW_VERDICTS)[number];
export const FINDING_SEVERITIES = ['blocker', 'should', 'nit'] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];
/** What became of a finding: still open, fixed, or rejected with a reason. */
export const FINDING_DISPOSITIONS = ['open', 'fixed', 'rejected'] as const;
export type FindingDisposition = (typeof FINDING_DISPOSITIONS)[number];

export interface ReviewFinding {
  severity: FindingSeverity;
  /** The reviewer's finding as it gave it, location and fix included. */
  summary: string;
  disposition: FindingDisposition;
  /** Why it was rejected; null otherwise. */
  reason: string | null;
}

export interface AxisReview {
  axis: ReviewAxis;
  verdict: ReviewVerdict;
  /** What the reviewer couldn't check, or why a skipped axis was skipped. */
  notChecked: string | null;
  findings: ReviewFinding[];
}

export interface ReviewRound {
  /** Counts the build's rounds from 1. */
  round: number;
  /** The commit the round reviewed from. */
  base: string;
  recordedAt: string;
  reviewers: AxisReview[];
}

export interface NewReviewRound {
  base: string;
  reviewers: readonly {
    axis: ReviewAxis;
    verdict: ReviewVerdict;
    notChecked?: string;
    findings: readonly { severity: FindingSeverity; summary: string; disposition: FindingDisposition; reason?: string }[];
  }[];
}

/** One finding: the `finding`th the `axis` reviewer gave in `round`, counting from 1. */
export interface FindingRef {
  round: number;
  axis: ReviewAxis;
  finding: number;
}

/** The kinds that never become a PR of their own, so hold no build phase or PR. */
const UNBUILT_KINDS: readonly WorkKind[] = ['concept', 'decision', 'slice'];

/** The kinds each kind may own as a structural parent. */
const CHILD_KINDS: Partial<Record<WorkKind, readonly WorkKind[]>> = { concept: ['decision', 'build'], build: ['slice'] };

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
  /** The work ID of the record that owns it, or null while it has no parent. */
  parentId: string | null;
  /** Where its build stands, or null before it starts. */
  buildPhase: BuildPhase | null;
  /** The PR its build delivers through, `owner/name#number`, or null before one is recorded. */
  pullRequest: string | null;
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
  /** Puts the record under `parentId`, whose kind must own the record's kind. Clear a parent before setting another. */
  setParent(workId: string, revision: number, parentId: string): WorkRecord;
  clearParent(workId: string, revision: number): WorkRecord;
  /** Records that the work waits on `blockerId`. Refuses a self-blocker and an edge that would close a cycle. */
  addBlocker(workId: string, revision: number, blockerId: string): WorkRecord;
  removeBlocker(workId: string, revision: number, blockerId: string): WorkRecord;
  /** Writes the record's `body`, replacing any earlier one. A concept holds a map, a decision its text, others a brief. */
  setBody(workId: string, revision: number, body: Body, markdown: string): WorkRecord;
  /** The record's `body`, or null while it has none. */
  body(workId: string, body: Body): string | null;
  setBuildPhase(workId: string, revision: number, phase: BuildPhase): WorkRecord;
  /** Records the PR the build delivers through, replacing an earlier one. */
  setPullRequest(workId: string, revision: number, pullRequest: string): WorkRecord;
  /** Records the build's next review round with every axis and finding, whole or not at all. */
  recordReviewRound(workId: string, revision: number, round: NewReviewRound): WorkRecord;
  /** Records what became of a finding. A rejection needs its reason. */
  setFindingDisposition(workId: string, revision: number, finding: FindingRef, disposition: FindingDisposition, reason?: string): WorkRecord;
  /** The build's review rounds, oldest first. */
  reviewRounds(workId: string): ReviewRound[];
  /** The records it owns, in the order they were made. */
  children(workId: string): WorkRecord[];
  /** The records it waits on. */
  blockers(workId: string): WorkRecord[];
  /** The records that wait on it. */
  dependents(workId: string): WorkRecord[];
  close(): void;
}

interface Row {
  work_id: string;
  repository: string;
  kind: WorkKind;
  status: Status;
  queue_order: number | null;
  ticket: string | null;
  parent_id: string | null;
  build_phase: BuildPhase | null;
  pull_request: string | null;
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
  parentId: row.parent_id,
  buildPhase: row.build_phase,
  pullRequest: row.pull_request,
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

/** Throws unless `value` is one of `values`, naming it as `what`. */
function checkOneOf<T extends string>(values: readonly T[], value: unknown, what: string): T {
  if (!values.includes(value as T)) throw invalid(`The ${what} "${String(value)}" isn't one of ${values.join(', ')}.`);
  return value as T;
}

const checkKind = (kind: unknown): WorkKind => checkOneOf(WORK_KINDS, kind, 'kind');
const checkStatus = (status: unknown): Status => checkOneOf(STATUSES, status, 'Status');

/** Throws unless `reference` names a ticket or PR: `owner/name#12`. */
function checkReference(reference: unknown, what: 'ticket' | 'PR'): string {
  if (typeof reference !== 'string' || !/^[^\s/#]+(\/[^\s/#]+)+#[1-9]\d*$/.test(reference)) {
    throw invalid(`The ${what} "${String(reference)}" isn't a ${what} reference like owner/name#12.`);
  }
  return reference;
}

const checkTicket = (ticket: unknown): string => checkReference(ticket, 'ticket');

/** Throws unless a record of `kind` holds `body`. */
function checkHolds(kind: WorkKind, body: Body): void {
  const holder: WorkKind | undefined = body === 'map' ? 'concept' : body === 'decision' ? 'decision' : undefined;
  if (holder ? kind !== holder : kind === 'concept' || kind === 'decision') {
    throw invalid(holder ? `Only a ${holder} holds a ${body}; this record is a ${kind}.` : `A ${kind} holds no brief.`);
  }
}

/** Throws unless a record of `kind` can be built. */
function checkBuilt(kind: WorkKind): void {
  if (UNBUILT_KINDS.includes(kind)) throw invalid(`A ${kind} is never built, so it has no build phase, PR or review rounds.`);
}

function checkText(text: unknown, what: string): string {
  if (typeof text !== 'string') throw invalid(`The ${what} isn't text.`);
  return text;
}

function checkFilled(text: unknown, what: string): string {
  if (typeof text !== 'string' || !text.trim()) throw invalid(`The ${what} is empty or isn't text.`);
  return text;
}

/** A finding's disposition and the reason a rejection needs. */
function checkDisposition(disposition: unknown, reason: unknown): [FindingDisposition, string | null] {
  const checked = checkOneOf(FINDING_DISPOSITIONS, disposition, 'disposition');
  if (checked !== 'rejected') return [checked, null];
  return [checked, checkFilled(reason, 'reason for rejecting a finding')];
}

/** Throws unless a `parent` may own a `child`. */
function checkOwns(parent: Row, child: { work_id: string; kind: WorkKind }): void {
  const owns = CHILD_KINDS[parent.kind] ?? [];
  if (!owns.includes(child.kind)) {
    throw invalid(`A ${parent.kind} owns ${owns.length ? `only ${owns.join(' and ')} records` : 'no records'}, so ${parent.work_id} can't own the ${child.kind} ${child.work_id}.`);
  }
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
  const childRows = db.prepare('SELECT * FROM work_records WHERE parent_id = ? ORDER BY rowid');
  const blockerRows = db.prepare('SELECT r.* FROM blockers b JOIN work_records r ON r.work_id = b.blocker_id WHERE b.work_id = ? ORDER BY b.rowid');
  const dependentRows = db.prepare('SELECT r.* FROM blockers b JOIN work_records r ON r.work_id = b.work_id WHERE b.blocker_id = ? ORDER BY b.rowid');
  const hasBlocker = db.prepare('SELECT 1 FROM blockers WHERE work_id = ? AND blocker_id = ?');
  const insertBlocker = db.prepare('INSERT INTO blockers (work_id, blocker_id) VALUES (?, ?)');
  const deleteBlocker = db.prepare('DELETE FROM blockers WHERE work_id = ? AND blocker_id = ?');
  // Whether `blocker` already waits on `work`, directly or through other records.
  const waitsOn = db.prepare(`WITH RECURSIVE waiting (id) AS (SELECT ? UNION SELECT b.blocker_id FROM blockers b JOIN waiting ON b.work_id = waiting.id)
    SELECT 1 FROM waiting WHERE id = ?`);
  const bump = db.prepare('UPDATE work_records SET revision = revision + 1, updated_at = ? WHERE work_id = ?');
  const hasRounds = db.prepare('SELECT 1 FROM review_rounds WHERE work_id = ? LIMIT 1');
  const roundRows = db.prepare('SELECT * FROM review_rounds WHERE work_id = ? ORDER BY round');
  const axisRows = db.prepare('SELECT * FROM review_axes WHERE work_id = ? AND round = ? ORDER BY rowid');
  const findingRows = db.prepare('SELECT * FROM review_findings WHERE work_id = ? AND round = ? AND axis = ? ORDER BY finding');
  const nextRound = db.prepare('SELECT coalesce(max(round), 0) + 1 AS next FROM review_rounds WHERE work_id = ?');
  const insertRound = db.prepare('INSERT INTO review_rounds (work_id, round, base, recorded_at) VALUES (?, ?, ?, ?)');
  const insertAxis = db.prepare('INSERT INTO review_axes (work_id, round, axis, verdict, not_checked) VALUES (?, ?, ?, ?, ?)');
  const insertFinding = db.prepare('INSERT INTO review_findings (work_id, round, axis, finding, severity, summary, disposition, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const disposeFinding = db.prepare('UPDATE review_findings SET disposition = ?, reason = ? WHERE work_id = ? AND round = ? AND axis = ? AND finding = ?');
  const bodyNames = db.prepare('SELECT body FROM bodies WHERE work_id = ?');
  const bodyText = db.prepare('SELECT markdown FROM bodies WHERE work_id = ? AND body = ?');
  const writeBody = db.prepare('INSERT INTO bodies (work_id, body, markdown) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET markdown = excluded.markdown');
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

  /** Applies `change` to the record at `revision`, bumping it; throws when the record moved on. Records `apply`
   * returns in `touched` are bumped too, so a writer holding their old revision fails instead of overwriting. */
  const change = (workId: string, revision: number, apply: (row: Row, touched: string[]) => Partial<Row>): WorkRecord =>
    database.write(() => {
      const expected = checkRevision(revision);
      const row = find(workId);
      if (row.revision !== expected) {
        throw new WorkRecordError('stale-revision', `The work record ${workId} is at revision ${row.revision}, not ${expected}; read it again and retry.`);
      }
      const touched: string[] = [];
      const next = { ...row, ...apply(row, touched), revision: row.revision + 1, updated_at: new Date().toISOString() };
      db.prepare(`UPDATE work_records SET kind = ?, status = ?, queue_order = ?, ticket = ?, parent_id = ?, build_phase = ?, pull_request = ?,
        set_aside_at = ?, revision = ?, updated_at = ? WHERE work_id = ? AND revision = ?`)
        .run(next.kind, next.status, next.queue_order, next.ticket, next.parent_id, next.build_phase, next.pull_request, next.set_aside_at,
          next.revision, next.updated_at, workId, expected);
      for (const id of touched) bump.run(next.updated_at, id);
      return fromRow(find(workId));
    });

  const related = (query: StatementSync, workId: string): WorkRecord[] => database.read(() => {
    find(workId);
    return (query.all(workId) as unknown as Row[]).map(fromRow);
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
        if (nextKind && nextKind !== row.kind) {
          const child = { work_id: row.work_id, kind: nextKind };
          if (row.parent_id) checkOwns(find(row.parent_id), child);
          for (const owned of childRows.all(workId) as unknown as Row[]) checkOwns({ ...row, kind: nextKind }, owned);
          // The new kind must hold what the record already holds.
          if (row.build_phase || row.pull_request || hasRounds.get(workId)) checkBuilt(nextKind);
          for (const { body } of bodyNames.all(workId)) checkHolds(nextKind, body as Body);
        }
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
    setParent: (workId, revision, parentId) => change(workId, revision, (row, touched) => {
      const parent = find(parentId);
      if (row.parent_id) throw invalid(`The work record ${workId} already has the parent ${row.parent_id}; clear it first.`);
      checkOwns(parent, row);
      touched.push(parentId);
      return { parent_id: parentId };
    }),
    clearParent: (workId, revision) => change(workId, revision, (row, touched) => {
      if (!row.parent_id) throw invalid(`The work record ${workId} has no parent.`);
      touched.push(row.parent_id);
      return { parent_id: null };
    }),
    addBlocker: (workId, revision, blockerId) => change(workId, revision, (row, touched) => {
      find(blockerId);
      if (blockerId === workId) throw invalid(`The work record ${workId} can't block itself.`);
      if (hasBlocker.get(workId, blockerId)) throw invalid(`The work record ${workId} is already blocked by ${blockerId}.`);
      if (waitsOn.get(blockerId, workId)) throw invalid(`The work record ${blockerId} already waits on ${workId}, so blocking ${workId} by it would make a cycle.`);
      insertBlocker.run(workId, blockerId);
      touched.push(blockerId);
      return {};
    }),
    removeBlocker: (workId, revision, blockerId) => change(workId, revision, (row, touched) => {
      if (!deleteBlocker.run(workId, blockerId).changes) {
        throw invalid(`The work record ${workId} isn't blocked by ${blockerId}.`);
      }
      touched.push(blockerId);
      return {};
    }),
    setBody: (workId, revision, body, markdown) => {
      const name = checkOneOf(BODIES, body, 'body');
      const text = checkText(markdown, name);
      return change(workId, revision, (row) => {
        checkHolds(row.kind, name);
        writeBody.run(workId, name, text);
        return {};
      });
    },
    body: (workId, body) => database.read(() => {
      const name = checkOneOf(BODIES, body, 'body');
      find(workId);
      const row = bodyText.get(workId, name);
      return row ? String(row.markdown) : null;
    }),
    setBuildPhase: (workId, revision, phase) => {
      const checked = checkOneOf(BUILD_PHASES, phase, 'build phase');
      return change(workId, revision, (row) => (checkBuilt(row.kind), { build_phase: checked }));
    },
    setPullRequest: (workId, revision, pullRequest) => {
      const reference = checkReference(pullRequest, 'PR');
      return change(workId, revision, (row) => (checkBuilt(row.kind), { pull_request: reference }));
    },
    recordReviewRound: (workId, revision, round) => change(workId, revision, (row) => {
      checkBuilt(row.kind);
      if (typeof round?.base !== 'string' || !/^[0-9a-f]{7,64}$/.test(round.base)) throw invalid(`The round's base "${String(round?.base)}" isn't a commit sha.`);
      if (!Array.isArray(round.reviewers as unknown) || !round.reviewers.length) throw invalid('The round has no reviewers.');
      const number = Number(nextRound.get(workId)!.next);
      insertRound.run(workId, number, round.base, new Date().toISOString());
      const seen = new Set<ReviewAxis>();
      for (const reviewer of round.reviewers) {
        const axis = checkOneOf(REVIEW_AXES, reviewer?.axis, 'axis');
        if (seen.has(axis)) throw invalid(`The round lists the ${axis} reviewer twice.`);
        seen.add(axis);
        const verdict = checkOneOf(REVIEW_VERDICTS, reviewer.verdict, 'verdict');
        const notChecked = verdict === 'skipped' ? checkFilled(reviewer.notChecked, `reason the ${axis} reviewer was skipped`)
          : reviewer.notChecked === undefined ? null : checkFilled(reviewer.notChecked, `${axis} reviewer's note on what it couldn't check`);
        if (!Array.isArray(reviewer.findings as unknown)) throw invalid(`The ${axis} reviewer's findings aren't a list.`);
        if (verdict === 'skipped' && reviewer.findings.length) throw invalid(`The skipped ${axis} reviewer can't have findings.`);
        insertAxis.run(workId, number, axis, verdict, notChecked);
        reviewer.findings.forEach((finding, index) => {
          const severity = checkOneOf(FINDING_SEVERITIES, finding?.severity, 'severity');
          const summary = checkFilled(finding.summary, `${axis} finding`);
          const [disposition, reason] = checkDisposition(finding.disposition, finding.reason);
          insertFinding.run(workId, number, axis, index + 1, severity, summary, disposition, reason);
        });
      }
      return {};
    }),
    setFindingDisposition: (workId, revision, { round, axis, finding }, disposition, reason) => {
      const [checked, why] = checkDisposition(disposition, reason);
      return change(workId, revision, () => {
        const updated = disposeFinding.run(checked, why, workId, round, axis, finding);
        if (!updated.changes) throw new WorkRecordError('not-found', `The work record ${workId} has no finding ${finding} from the ${axis} reviewer in round ${round}.`);
        return {};
      });
    },
    reviewRounds: (workId) => database.read(() => {
      find(workId);
      return roundRows.all(workId).map((round): ReviewRound => ({
        round: Number(round.round),
        base: String(round.base),
        recordedAt: String(round.recorded_at),
        reviewers: axisRows.all(workId, Number(round.round)).map((axis): AxisReview => ({
          axis: axis.axis as ReviewAxis,
          verdict: axis.verdict as ReviewVerdict,
          notChecked: axis.not_checked as string | null,
          findings: findingRows.all(workId, Number(round.round), String(axis.axis)).map((finding): ReviewFinding => ({
            severity: finding.severity as FindingSeverity,
            summary: String(finding.summary),
            disposition: finding.disposition as FindingDisposition,
            reason: finding.reason as string | null,
          })),
        })),
      }));
    }),
    children: (workId) => related(childRows, workId),
    blockers: (workId) => related(blockerRows, workId),
    dependents: (workId) => related(dependentRows, workId),
    close: () => database.close(),
  };
}
