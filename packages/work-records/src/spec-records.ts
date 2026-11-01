// Spec outbox and checkpoints share the gate transaction. Provider calls happen outside SQLite transactions.
import { createHash, randomUUID } from 'node:crypto';
import type { GateEvidence } from '@lar-factory/shared';
import { WorkRecordError, type Database } from './database.ts';
import type { WorkRecord } from './work-records.ts';

export interface SpecRemote { body: string; title: string; version: string; digest: string; editorWrite?: boolean; titleEditorWrite?: boolean }
export interface SpecState {
  generation: number;
  changedAt?: string;
  retryAfter?: number;
  original?: string;
  failure?: 'read' | 'write';
  sent?: { body: string; title: string; spec: string };
  ticket: string | null;
  active: boolean;
  pending: string | null;
  base: SpecRemote | null;
  held: SpecRemote | null;
  error: string | null;
  warning: string | null;
}
interface SpecChange { text: string; title?: string; source: NonNullable<GateEvidence['source']>; identity: string; evidence: string }
export interface SpecRecords {
  specEligible(workId: string): boolean;
  specState(workId: string): SpecState;
  specPending(): string[];
  /** Compare-and-swap the checkpoint, optionally importing/approving exact text in the same transaction. */
  saveSpecState(workId: string, generation: number, state: SpecState, change?: SpecChange): boolean;
}
const empty = (ticket: string | null): SpecState => ({ generation: 0, ticket, active: false, pending: null, base: null, held: null, error: null, warning: null });
function load(database: Database, workId: string, ticket: string | null): SpecState {
  const row = database.db.prepare('SELECT generation, state FROM ticket_specs WHERE work_id = ?').get(workId);
  const state = row ? { ...JSON.parse(String(row.state)) as SpecState, generation: Number(row.generation) } : empty(ticket);
  return state.ticket === ticket ? state : { ...empty(ticket), generation: state.generation };
}
function save(database: Database, workId: string, state: SpecState) {
  database.db.prepare('INSERT INTO ticket_specs (work_id, generation, state) VALUES (?, ?, ?) ON CONFLICT DO UPDATE SET generation = excluded.generation, state = excluded.state')
    .run(workId, state.generation + 1, JSON.stringify({ ...state, changedAt: new Date().toISOString() }));
}
/** Called only inside recordGate's transaction. Settings and verified access are checked by the drain. */
export function queueTicketSpec(database: Database, workId: string, ticket: string, text: string) {
  if (database.db.prepare('SELECT 1 FROM dependencies WHERE lower(ticket) = lower(?)').get(ticket)) return;
  const state = load(database, workId, ticket);
  save(database, workId, { ...state, pending: text, error: null, retryAfter: 0 });
}
export function specRecords(database: Database, read: (workId: string) => WorkRecord): SpecRecords {
  const { db } = database;
  return {
    specEligible: workId => database.read(() => {
      const record = read(workId);
      return Boolean(record.ticket) && !['concept', 'decision', 'slice'].includes(record.kind) && !db.prepare('SELECT 1 FROM dependencies WHERE lower(ticket) = lower(?)').get(record.ticket);
    }),
    specState: workId => database.read(() => load(database, workId, read(workId).ticket)),
    specPending: () => database.read(() => db.prepare("SELECT work_id FROM ticket_specs WHERE json_extract(state, '$.pending') IS NOT NULL").all().map(row => String(row.work_id))),
    saveSpecState: (workId, generation, state, change) => database.write(() => {
      const record = read(workId);
      const before = load(database, workId, record.ticket);
      if (before.generation !== generation || state.ticket !== record.ticket) return false;
      if (['concept', 'decision', 'slice'].includes(record.kind)) throw new WorkRecordError('invalid', 'This record cannot hold a ticket Spec.');
      save(database, workId, state);
      if (change) {
        const digest = createHash('sha256').update(JSON.stringify(change.text)).digest('hex');
        const approved = change.source === 'user';
        db.prepare(`INSERT INTO bodies (work_id, body, markdown, written, has_content, has_passing_gate)
          VALUES (?, 'brief', ?, (SELECT coalesce(max(written), 0) + 1 FROM bodies), ?, ? OR EXISTS (SELECT 1 FROM brief_gates WHERE work_id = ? AND brief_digest = ? AND source IN ('gate', 'user')))
          ON CONFLICT DO UPDATE SET markdown = excluded.markdown, written = excluded.written, has_content = excluded.has_content, has_passing_gate = excluded.has_passing_gate`)
          .run(workId, change.text, Number(Boolean(change.text.trim())), Number(approved), workId, digest);
        const at = new Date().toISOString();
        db.prepare('INSERT INTO brief_gates (gate_id, work_id, source_revision, brief_digest, approved_by, evidence, recorded_at, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
          .run(randomUUID(), workId, record.revision, digest, change.identity, change.evidence, at, change.source);
        db.prepare('UPDATE work_records SET title = ?, revision = revision + 1, updated_at = ? WHERE work_id = ?').run(change.title ?? record.title, at, workId);
      }
      return true;
    }),
  };
}
