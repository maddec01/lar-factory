import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { openWorkRecords, type WorkKind, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const open = async (path = join(tempDir(), 'work-records.db')) => {
  const records = await openWorkRecords(path);
  opened.push(records);
  return records;
};
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'work-records-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const records of opened.splice(0)) records.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('work records', () => {
  it('creates a ticketless record with a stable identity and reads it back', async () => {
    const records = await open();
    const made = records.create({ repository: 'maddec01/lar', kind: 'feature' });
    expect(made).toMatchObject({ repository: 'maddec01/lar', kind: 'feature', status: 'List', ticket: null, setAside: false, revision: 1 });
    expect(made.workId).toMatch(/^[0-9a-f-]{36}$/);
    expect(made.createdAt).toBe(made.updatedAt);
    expect(records.read(made.workId)).toEqual(made);
  });

  it('keeps records and their tickets across close and reopen', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const made = first.create({ repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#12' });
    first.close();
    const reopened = await open(path);
    expect(reopened.read(made.workId)).toEqual(made);
  });

  it('attaches a ticket without changing the work ID', async () => {
    const records = await open();
    const made = records.create({ repository: 'maddec01/lar', kind: 'concept' });
    const linked = records.attachTicket(made.workId, made.revision, 'maddec01/lar#7');
    expect(linked).toMatchObject({ workId: made.workId, ticket: 'maddec01/lar#7', revision: 2 });
  });

  it('resolves a repeated ticket import to the same record', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const imported = first.importTicket({ repository: 'maddec01/lar', kind: 'build', ticket: 'maddec01/lar#40' });
    first.close();
    const again = (await open(path)).importTicket({ repository: 'maddec01/lar', kind: 'build', ticket: 'maddec01/lar#40' });
    expect(imported.created).toBe(true);
    expect(again).toEqual({ record: imported.record, created: false });
  });

  it('refuses a ticket another record already holds', async () => {
    const records = await open();
    records.create({ repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#3' });
    const other = records.create({ repository: 'maddec01/lar', kind: 'bug' });
    expect(() => records.attachTicket(other.workId, 1, 'maddec01/lar#3')).toThrow(expect.objectContaining({ code: 'ticket-taken' }));
    expect(records.read(other.workId)).toEqual(other);
  });

  it('refuses to re-key a record that already has a different ticket', async () => {
    const records = await open();
    const made = records.create({ repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#3' });
    expect(() => records.attachTicket(made.workId, 1, 'maddec01/lar#4')).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('updates with the current revision and refuses a stale one without overwriting', async () => {
    const path = join(tempDir(), 'work-records.db');
    const board = await open(path);
    const thread = await open(path);
    const made = board.create({ repository: 'maddec01/lar', kind: 'feature' });

    const shaped = board.update(made.workId, made.revision, { status: 'Shaping' });
    expect(shaped).toMatchObject({ status: 'Shaping', revision: 2 });
    expect(() => thread.update(made.workId, made.revision, { status: 'Ready' })).toThrow(
      expect.objectContaining({ code: 'stale-revision', message: expect.stringContaining('revision 2') }),
    );
    expect(thread.read(made.workId)).toEqual(shaped);
  });

  it('keeps Queued records in the order they joined the Queue', async () => {
    const records = await open();
    const [a, b, c] = ['bug', 'feature', 'improvement'].map((kind) => records.create({ repository: 'maddec01/lar', kind: kind as 'bug' }));
    records.update(c!.workId, 1, { status: 'Queued' });
    records.update(a!.workId, 1, { status: 'Queued' });
    records.update(b!.workId, 1, { status: 'Queued' });
    expect(records.list({ status: 'Queued' }).map((r) => r.workId)).toEqual([c!.workId, a!.workId, b!.workId]);

    records.update(c!.workId, 2, { status: 'Shaping' });
    expect(records.read(c!.workId).queueOrder).toBeNull();
  });

  it('lists by repository, Status and kind', async () => {
    const records = await open();
    const lar = records.create({ repository: 'maddec01/lar', kind: 'bug' });
    records.create({ repository: 'maddec01/other', kind: 'bug' });
    const concept = records.create({ repository: 'maddec01/lar', kind: 'concept' });
    expect(records.list({ repository: 'maddec01/lar' }).map((r) => r.workId)).toEqual([lar.workId, concept.workId]);
    expect(records.list({ repository: 'maddec01/lar', kind: 'concept' }).map((r) => r.workId)).toEqual([concept.workId]);
    expect(records.list({ status: 'Done' })).toEqual([]);
  });

  it('sets a record aside and restores it without touching its Status', async () => {
    const records = await open();
    const made = records.create({ repository: 'maddec01/lar', kind: 'feature', status: 'Ready' });
    const aside = records.setAside(made.workId, 1);
    expect(aside).toMatchObject({ status: 'Ready', setAside: true, revision: 2 });
    expect(records.restore(aside.workId, 2)).toMatchObject({ status: 'Ready', setAside: false, revision: 3 });
    expect(() => records.restore(aside.workId, 3)).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('refuses malformed input and missing records without changing anything', async () => {
    const records = await open();
    expect(() => records.create({ repository: '', kind: 'bug' })).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.create({ repository: 'maddec01/lar', kind: 'chore' as 'bug' })).toThrow(/kind "chore"/);
    expect(() => records.create({ repository: 'maddec01/lar', kind: 'bug', status: 'Doing' as 'List' })).toThrow(/Status "Doing"/);
    expect(() => records.create({ repository: 'maddec01/lar', kind: 'bug', ticket: 'lar-12' })).toThrow(/ticket "lar-12"/);
    expect(() => records.read('nope')).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => records.update('nope', 1, { status: 'Ready' })).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(records.list({})).toEqual([]);
  });
});

describe('work-record structure', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ repository: 'maddec01/lar', kind });

  it('puts decisions and builds under a concept and slices under a build', async () => {
    const records = await open();
    const concept = lar(records, 'concept');
    const decision = lar(records, 'decision');
    const build = lar(records, 'build');
    const slice = lar(records, 'slice');

    expect(records.setParent(decision.workId, 1, concept.workId)).toMatchObject({ parentId: concept.workId, revision: 2 });
    records.setParent(build.workId, 1, concept.workId);
    records.setParent(slice.workId, 1, build.workId);
    expect(records.read(concept.workId).revision).toBe(3);
    expect(records.children(concept.workId).map((r) => r.workId)).toEqual([decision.workId, build.workId]);
    expect(records.children(build.workId).map((r) => r.workId)).toEqual([slice.workId]);
  });

  it('refuses a parent whose kind does not own the child, or a second parent, and changes nothing', async () => {
    const records = await open();
    const concept = lar(records, 'concept');
    const build = lar(records, 'build');
    const decision = lar(records, 'decision');
    const slice = lar(records, 'slice');
    records.setParent(build.workId, 1, concept.workId);
    const before = records.list({});

    expect(() => records.setParent(decision.workId, 1, build.workId)).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('A build owns only slice records') }));
    expect(() => records.setParent(slice.workId, 1, concept.workId)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.setParent(build.workId, 2, lar(records, 'concept').workId)).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('already has the parent') }));
    expect(() => records.setParent(slice.workId, 1, 'nope')).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(records.list({}).slice(0, 4)).toEqual(before);
  });

  it('refuses a kind change that its parent or children would not allow', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const slice = lar(records, 'slice');
    records.setParent(slice.workId, 1, build.workId);
    expect(() => records.update(slice.workId, 2, { kind: 'decision' })).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.update(build.workId, 2, { kind: 'feature' })).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('clears a parent, bumping both records', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const slice = lar(records, 'slice');
    records.setParent(slice.workId, 1, build.workId);
    expect(records.clearParent(slice.workId, 2)).toMatchObject({ parentId: null, revision: 3 });
    expect(records.read(build.workId).revision).toBe(3);
    expect(records.children(build.workId)).toEqual([]);
    expect(() => records.clearParent(slice.workId, 3)).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('records blockers and lists them from both ends', async () => {
    const records = await open();
    const [a, b, c] = [lar(records, 'feature'), lar(records, 'bug'), lar(records, 'build')];
    expect(records.addBlocker(a.workId, 1, b.workId).revision).toBe(2);
    records.addBlocker(a.workId, 2, c.workId);
    expect(records.read(b.workId).revision).toBe(2);
    expect(records.blockers(a.workId).map((r) => r.workId)).toEqual([b.workId, c.workId]);
    expect(records.dependents(b.workId).map((r) => r.workId)).toEqual([a.workId]);

    expect(records.removeBlocker(a.workId, 3, b.workId).revision).toBe(4);
    expect(records.blockers(a.workId).map((r) => r.workId)).toEqual([c.workId]);
    expect(() => records.removeBlocker(a.workId, 4, b.workId)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.addBlocker(a.workId, 4, c.workId)).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('refuses a self-blocker and an edge that closes a cycle', async () => {
    const records = await open();
    const [a, b, c] = [lar(records, 'feature'), lar(records, 'bug'), lar(records, 'build')];
    expect(() => records.addBlocker(a.workId, 1, a.workId)).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining("can't block itself") }));
    records.addBlocker(a.workId, 1, b.workId);
    records.addBlocker(b.workId, 2, c.workId);
    const before = records.list({});
    expect(() => records.addBlocker(c.workId, 2, a.workId)).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('cycle') }));
    expect(records.list({})).toEqual(before);
    expect(records.blockers(c.workId)).toEqual([]);
  });

  it('keeps parents and blockers across close and reopen', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    const slice = lar(first, 'slice');
    const other = lar(first, 'slice');
    first.setParent(slice.workId, 1, build.workId);
    first.addBlocker(slice.workId, 2, other.workId);
    first.close();

    const reopened = await open(path);
    expect(reopened.read(slice.workId).parentId).toBe(build.workId);
    expect(reopened.children(build.workId).map((r) => r.workId)).toEqual([slice.workId]);
    expect(reopened.blockers(slice.workId).map((r) => r.workId)).toEqual([other.workId]);
  });

  it('refuses a relationship change with a stale revision while a concurrent one succeeds', async () => {
    const path = join(tempDir(), 'work-records.db');
    const board = await open(path);
    const thread = await open(path);
    const build = lar(board, 'build');
    const slice = lar(board, 'slice');
    const blocker = lar(board, 'slice');

    expect(board.setParent(slice.workId, 1, build.workId).revision).toBe(2);
    expect(() => thread.addBlocker(slice.workId, 1, blocker.workId)).toThrow(expect.objectContaining({ code: 'stale-revision' }));
    expect(thread.blockers(slice.workId)).toEqual([]);
    expect(thread.read(blocker.workId).revision).toBe(1);
  });
});

