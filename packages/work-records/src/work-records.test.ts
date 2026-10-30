import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

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
