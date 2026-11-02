import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import { effectiveVocabulary, kindDisagreement, type RepositorySetup, type TicketKinds, type TrackerLabels } from '@lar-factory/shared';
import { changeKind, checkKind } from './change-kind.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const REPO = 'team/app';
const AZURE = 'contoso/Fabrikam/web';
const ALLOWED = { 'tag-ticket': 'allowed', 'type-ticket': 'allowed' } as const;
const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const { records, dir } of opened.splice(0)) { records.close(); rmSync(dir, { recursive: true, force: true }); }
});
async function open(): Promise<WorkRecords> {
  const dir = mkdtempSync(join(tmpdir(), 'change-kind-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  return records;
}

const setupOf = (repo: string, access: object = ALLOWED, mapping: Parameters<typeof effectiveVocabulary>[0] = {
  bug: { type: 'Bug', labels: ['type: bug'] }, feature: { type: 'Feature', labels: ['type: feature'] },
}) => ({ repo, access, vocabulary: effectiveVocabulary(mapping).vocabulary, itemSource: { kind: 'azure-board', team: 'Web' } }) as unknown as RepositorySetup;

/** A tracker holding one ticket, which records each write and fails the one `fail` names. */
function fakeTracker(ticket: { labels: string[]; type: string | null }, { fail, board = null }: { fail?: string; board?: string[] | null } = {}) {
  const writes: string[] = [];
  const write = (name: string) => { if (name === fail) throw new Error(`refused ${name}`); writes.push(name); };
  const labels: Pick<TrackerLabels, 'addToTicket' | 'removeFromTicket'> = {
    addToTicket: async (_, names) => { for (const name of names) { write(`add ${name}`); if (!ticket.labels.includes(name)) ticket.labels.push(name); } },
    removeFromTicket: async (_, names) => { for (const name of names) { write(`remove ${name}`); ticket.labels = ticket.labels.filter((label) => label !== name); } },
  };
  const kinds: TicketKinds = {
    read: async () => ({ labels: [...ticket.labels], type: ticket.type }),
    setType: async (_, type) => { write(`type ${type}`); ticket.type = type; },
    boardTypes: async () => board,
  };
  return { labels, kinds, writes, ticket };
}

test('a ticket-backed item swaps its labels and type, then the record takes the kind and the agreed ticket kind', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: ['type: bug', 'bug', 'docs', 'build'], type: 'Bug' });
  const result = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker });
  expect(result.error).toBeNull();
  expect(tracker.ticket).toEqual({ labels: ['docs', 'build', 'type: feature'], type: 'Feature' });
  expect(result.line).toBe('#12: added label type: feature; removed label type: bug; removed label bug; type Bug to Feature.');
  expect(result.labelChanges).toEqual([{ label: 'type: feature', action: 'add' }, { label: 'type: bug', action: 'remove' }, { label: 'bug', action: 'remove' }]);
  expect(records.read(workId)).toMatchObject({ kind: 'feature', agreedTicketKind: 'feature', kindAnswer: null, revision: revision + 1 });
});

test('a new kind with no mapped type leaves the ticket\'s type alone', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: ['bug'], type: 'Bug' });
  const result = await changeKind(records, workId, revision, 'improvement', { setup: setupOf(REPO), ...tracker });
  expect(tracker.writes).toEqual(['remove bug']);
  expect(tracker.ticket.type).toBe('Bug');
  expect(records.read(workId).kind).toBe('improvement');
  expect(result.line).toBe('#12: removed label bug.');
});

test('a type the change leaves alone settles the question it would raise, until a kind changes', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: ['bug'], type: 'Bug' });
  const { record, ticketType } = await changeKind(records, workId, revision, 'improvement', { setup: setupOf(REPO), ...tracker });
  expect(ticketType).toBeNull();
  expect(record.kindAnswer).toEqual({ answer: 'update', itemKind: 'improvement', ticketKind: 'bug' });
  expect(kindDisagreement(record, tracker.ticket, setupOf(REPO).vocabulary)).toBeNull();
  expect(kindDisagreement(record, { labels: [], type: 'Feature' }, setupOf(REPO).vocabulary)).toMatchObject({ ticketKind: 'feature', changed: 'ticket' });
});

const AFTER_SWAP: [string, Parameters<typeof effectiveVocabulary>[0], string[], string | null, { labels: string[]; type: string | null }][] = [
  ['a mapping', { bug: { type: 'Bug', labels: ['type: bug'] }, feature: { type: 'Feature', labels: ['type: feature'] } }, ['type: bug', 'docs'], 'Bug', { labels: ['docs', 'type: feature'], type: 'Feature' }],
  ['no mapping', {}, ['bug', 'docs'], null, { labels: ['docs'], type: null }],
];
for (const [name, mapping, labels, type, after] of AFTER_SWAP) {
  test(`no disagreement remains after a swap, with ${name}`, async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
    const setup = setupOf(REPO, ALLOWED, mapping);
    const tracker = fakeTracker({ labels: [...labels], type });
    const { record, ticketType } = await changeKind(records, workId, revision, 'feature', { setup, ...tracker });
    expect(tracker.ticket).toEqual(after);
    expect(ticketType).toBe(after.type);
    expect(record.kindAnswer).toBeNull();
    expect(kindDisagreement(record, tracker.ticket, setup.vocabulary)).toBeNull();
  });
}

test('a type the team\'s backlog doesn\'t show stays unchanged, and the update line says so', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: AZURE, kind: 'feature', ticket: `${AZURE}#7` }).record;
  const tracker = fakeTracker({ labels: [], type: 'User Story' }, { board: ['User Story'] });
  const result = await changeKind(records, workId, revision, 'bug', { setup: setupOf(AZURE), ...tracker });
  expect(tracker.ticket).toEqual({ labels: ['type: bug'], type: 'User Story' });
  expect(result.line).toBe('#7: added tag type: bug. The type stays User Story, because the team\'s backlog doesn\'t show Bug.');
  expect(records.read(workId).kind).toBe('bug');
});

test('a write failing partway keeps the old kind and says what changed, and running the same change again finishes it', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: ['bug', 'defect'], type: 'Bug' }, { fail: 'remove defect' });
  const failed = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker });
  expect(failed.error).toBe('Could not finish changing #12 to Feature. refused remove defect');
  expect(failed.line).toBe('#12: added label type: feature; removed label bug.');
  expect(records.read(workId)).toMatchObject({ kind: 'bug', agreedTicketKind: null, revision });

  const retried = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...fakeTracker(tracker.ticket) });
  expect(retried.error).toBeNull();
  expect(retried.line).toBe('#12: removed label defect; type Bug to Feature.');
  expect(tracker.ticket).toEqual({ labels: ['type: feature'], type: 'Feature' });
  expect(records.read(workId).kind).toBe('feature');
});

test('a failed read changes nothing', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: [], type: null });
  tracker.kinds.read = async () => { throw new Error('gh failed: HTTP 502'); };
  const failed = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker });
  expect(failed.error).toBe('Could not finish changing #12 to Feature. gh failed: HTTP 502');
  expect(failed.line).toBe('');
  expect(records.read(workId).kind).toBe('bug');
});

for (const [name, access] of [['label', { 'tag-ticket': 'refused', 'type-ticket': 'allowed' }], ['type', { 'tag-ticket': 'allowed', 'type-ticket': 'refused' }]] as const) {
  test(`without ${name} access for a mapped value only the item changes, and the line says so`, async () => {
    const records = await open();
    const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
    const tracker = fakeTracker({ labels: ['bug'], type: 'Bug' });
    const result = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO, access), ...tracker });
    expect(tracker.writes).toEqual([]);
    expect(result.error).toBeNull();
    expect(result.line).toMatch(/^This item is now Feature\. Its ticket stays as it is: Access to (tag|type)-ticket was refused/);
    expect(records.read(workId)).toMatchObject({ kind: 'feature', agreedTicketKind: null });
  });
}

test('access only matters for what the change writes', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'issue', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: ['docs'], type: null });
  const result = await changeKind(records, workId, revision, 'improvement', { setup: setupOf(REPO, {}), ...tracker });
  expect(result.line).toBe('#12: nothing to change on the ticket.');
  expect(records.read(workId)).toMatchObject({ kind: 'improvement', agreedTicketKind: 'improvement' });
});

test('the same kind still swaps the ticket, for a record whose kind changed first', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'feature', ticket: `${REPO}#12` }).record;
  const tracker = fakeTracker({ labels: ['type: bug'], type: 'Bug' });
  await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker });
  expect(tracker.ticket).toEqual({ labels: ['type: feature'], type: 'Feature' });
});

test('local work changes kind with no tracker read or write', async () => {
  const records = await open();
  const { workId, revision } = records.create({ title: 'T', repository: REPO, kind: 'bug' });
  const result = await changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO) });
  expect(result).toMatchObject({ error: null, line: 'This item is now Feature. Local work has no ticket to change.', labelChanges: [] });
  expect(records.read(workId)).toMatchObject({ kind: 'feature', agreedTicketKind: null });
});

test('concepts, decisions, builds and slices refuse before any tracker call, as does a kind details doesn\'t offer', async () => {
  const records = await open();
  const tracker = fakeTracker({ labels: [], type: null });
  for (const kind of ['concept', 'decision', 'build', 'slice'] as const) {
    const { workId, revision } = records.create({ title: 'T', repository: REPO, kind });
    await expect(changeKind(records, workId, revision, 'bug', { setup: setupOf(REPO), ...tracker })).rejects.toThrow(`A ${kind} has no kind to change.`);
  }
  const { workId, revision } = records.create({ title: 'T', repository: REPO, kind: 'bug' });
  await expect(changeKind(records, workId, revision, 'concept' as 'bug', { setup: setupOf(REPO), ...tracker })).rejects.toThrow('Choose Bug, Feature or Improvement.');
});

test('a stale revision refuses before any tracker call', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  records.update(workId, revision, { status: 'Queued' });
  const tracker = fakeTracker({ labels: ['bug'], type: 'Bug' });
  await expect(changeKind(records, workId, revision, 'feature', { setup: setupOf(REPO), ...tracker })).rejects.toThrow(/revision/);
  expect(tracker.writes).toEqual([]);
});

test('a local kind update keeps the agreed ticket kind and drops an answer, which covered the old kinds', async () => {
  const records = await open();
  const { workId, revision } = records.importTicket({ title: 'T', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  const agreed = records.update(workId, revision, { kind: 'bug', agreedTicketKind: 'bug' });
  const answered = records.recordKindAnswer(workId, agreed.revision, { answer: 'keep', ticketKind: 'feature' });
  expect(answered.kindAnswer).toEqual({ answer: 'keep', itemKind: 'bug', ticketKind: 'feature' });
  const local = records.update(workId, answered.revision, { kind: 'improvement' });
  expect(local).toMatchObject({ agreedTicketKind: 'bug', kindAnswer: null });
});

test('an answer can say the ticket has no kind, and refuses anything else', async () => {
  const records = await open();
  const { workId, revision } = records.create({ title: 'T', repository: REPO, kind: 'bug' });
  expect(records.recordKindAnswer(workId, revision, { answer: 'update', ticketKind: null }).kindAnswer).toEqual({ answer: 'update', itemKind: 'bug', ticketKind: null });
  expect(() => records.recordKindAnswer(workId, revision + 1, { answer: 'maybe' as 'keep', ticketKind: null })).toThrow();
  expect(() => records.recordKindAnswer(workId, revision + 1, { answer: 'keep', ticketKind: 'concept' as 'bug' })).toThrow();
});

test('a record from before the migration has no agreed kind or answer, and keeps its kind', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'change-kind-'));
  const path = join(dir, 'work-records.db');
  const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, -1) });
  old.db.prepare(`INSERT INTO work_records (work_id, title, initial_context, repository, kind, status, revision, created_at, updated_at)
    VALUES ('old-work', 'T', '', 'team/app', 'bug', 'List', 1, '2026-01-01', '2026-01-01')`).run();
  old.close();
  const records = await openWorkRecords(path);
  opened.push({ records, dir });
  expect(records.read('old-work')).toMatchObject({ kind: 'bug', agreedTicketKind: null, kindAnswer: null });
});

test('the check plans the swap as the change would: a type the backlog doesn\'t show needs no type access and has a note', async () => {
  const records = await open();
  const { workId } = records.importTicket({ title: 'T', repository: AZURE, kind: 'bug', ticket: `${AZURE}#12` }).record;
  const tracker = fakeTracker({ labels: ['type: feature'], type: 'Feature' }, { board: ['Feature'] });
  const check = await checkKind(records.read(workId), { setup: setupOf(AZURE, { 'tag-ticket': 'allowed' }), ...tracker });
  expect(check).toMatchObject({
    ticketKind: 'feature', accessProblem: null, note: ' The type stays Feature, because the team\'s backlog doesn\'t show Bug.',
    swap: { add: ['type: bug'], remove: ['type: feature'], type: null },
  });
  expect(tracker.writes).toEqual([]);
});
