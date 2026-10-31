import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
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
    const made = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'feature' });
    expect(made).toMatchObject({ repository: 'maddec01/lar', kind: 'feature', status: 'List', ticket: null, setAside: false, revision: 1 });
    expect(made.workId).toMatch(/^[0-9a-f-]{36}$/);
    expect(made.createdAt).toBe(made.updatedAt);
    expect(records.read(made.workId)).toEqual(made);
  });

  it('keeps records and their tickets across close and reopen', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const made = first.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#12' });
    first.close();
    const reopened = await open(path);
    expect(reopened.read(made.workId)).toEqual(made);
  });

  it('attaches a ticket without changing the work ID', async () => {
    const records = await open();
    const made = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'concept' });
    const linked = records.attachTicket(made.workId, made.revision, 'maddec01/lar#7');
    expect(linked).toMatchObject({ workId: made.workId, ticket: 'maddec01/lar#7', revision: 2 });
    expect(records.attachTicket(made.workId, 2, 'maddec01/lar#7')).toEqual(linked);
    expect(() => records.attachTicket(made.workId, 1, 'maddec01/lar#7')).toThrow(expect.objectContaining({ code: 'stale-revision' }));
  });

  it('keeps the title and initial context it was captured with, which a repeated import never overwrites', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const captured = first.create({ title: 'Add dark mode', context: 'The board is too bright.\n', repository: 'maddec01/lar', kind: 'feature' });
    const imported = first.importTicket({ title: 'Fix login', context: '## Steps\n\nSign in.\n', repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#41' });
    first.close();

    const reopened = await open(path);
    expect(reopened.read(captured.workId)).toMatchObject({ title: 'Add dark mode' });
    expect(reopened.initialContext(captured.workId)).toBe('The board is too bright.\n');
    const edited = reopened.importTicket({ title: 'Fix login (edited)', context: 'Edited.', repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#41' });
    expect(edited).toEqual({ record: imported.record, created: false });
    expect(reopened.initialContext(imported.record.workId)).toBe('## Steps\n\nSign in.\n');
    expect(reopened.initialContext(reopened.create({ title: 'No context', repository: 'maddec01/lar', kind: 'bug' }).workId)).toBe('');
    expect(() => reopened.create({ title: ' ', repository: 'maddec01/lar', kind: 'bug' })).toThrow(/title/);
    expect(() => reopened.create({ title: 'Two\nlines', repository: 'maddec01/lar', kind: 'bug' })).toThrow(/title/);
  });

  it('brings an earlier database up to date, keeping its records with an empty title', async () => {
    const path = join(tempDir(), 'work-records.db');
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 4) });
    old.db.prepare(`INSERT INTO work_records (work_id, repository, kind, status, revision, created_at, updated_at)
      VALUES ('w-1', 'maddec01/lar', 'build', 'List', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`).run();
    old.close();

    const records = await open(path);
    expect(records.read('w-1')).toMatchObject({ title: '', revision: 1 });
    expect(records.initialContext('w-1')).toBe('');
    expect(readdirSync(dirname(path)).filter((file) => file.includes('.before-'))).toEqual([]);
  });

  it('resolves a repeated ticket import to the same record', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const imported = first.importTicket({ title: 'Work', repository: 'maddec01/lar', kind: 'build', ticket: 'maddec01/lar#40' });
    first.close();
    const again = (await open(path)).importTicket({ title: 'Work', repository: 'maddec01/lar', kind: 'build', ticket: 'maddec01/lar#40' });
    expect(imported.created).toBe(true);
    expect(again).toEqual({ record: imported.record, created: false });
  });

  it('refuses a ticket another record already holds', async () => {
    const records = await open();
    records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#3' });
    const other = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug' });
    expect(() => records.attachTicket(other.workId, 1, 'maddec01/lar#3')).toThrow(expect.objectContaining({ code: 'ticket-taken' }));
    expect(records.read(other.workId)).toEqual(other);
  });

  it('refuses to re-key a record that already has a different ticket', async () => {
    const records = await open();
    const made = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug', ticket: 'maddec01/lar#3' });
    expect(() => records.attachTicket(made.workId, 1, 'maddec01/lar#4')).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('updates with the current revision and refuses a stale one without overwriting', async () => {
    const path = join(tempDir(), 'work-records.db');
    const board = await open(path);
    const thread = await open(path);
    const made = board.create({ title: 'Work', repository: 'maddec01/lar', kind: 'feature' });

    const shaped = board.update(made.workId, made.revision, { status: 'Shaping' });
    expect(shaped).toMatchObject({ status: 'Shaping', revision: 2 });
    expect(() => thread.update(made.workId, made.revision, { status: 'Ready' })).toThrow(
      expect.objectContaining({ code: 'stale-revision', message: expect.stringContaining('revision 2') }),
    );
    expect(thread.read(made.workId)).toEqual(shaped);
  });

  it('keeps every commit from two processes writing at once, refusing only stale or locked writes', { timeout: 30_000 }, async () => {
    const path = join(tempDir(), 'work-records.db');
    const made = (await open(path)).create({ title: 'Work', repository: 'maddec01/lar', kind: 'build' });
    // Each writer appends a line named after itself to the brief it just read, naming the revision it read. Neither
    // starts writing until both have marked themselves ready.
    const writer = `import { existsSync, writeFileSync } from 'node:fs';
      import { openWorkRecords } from ${JSON.stringify(pathToFileURL(join(import.meta.dirname, 'work-records.ts')).href)};
      const [path, workId, name, other] = process.argv.slice(1);
      const records = await openWorkRecords(path);
      writeFileSync(path + '.' + name + '-ready', '');
      while (!existsSync(path + '.' + other + '-ready'));
      const outcomes = [];
      for (let i = 0; i < 100; i++) {
        const { revision } = records.read(workId);
        const brief = records.body(workId, 'brief') ?? '';
        try {
          records.setBody(workId, revision, 'brief', brief + name + '-' + i + '\\n');
          outcomes.push(name + '-' + i);
        } catch (error) {
          outcomes.push(error.code ?? String(error));
        }
      }
      records.close();
      process.stdout.write(JSON.stringify(outcomes));`;
    const run = (name: string, other: string) =>
      promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', '--input-type=module', '-e', writer, path, made.workId, name, other]);
    const outcomes = (await Promise.all([run('board', 'thread'), run('thread', 'board')])).flatMap(({ stdout }) => JSON.parse(stdout) as string[]);

    const committed = outcomes.filter((outcome) => /^(board|thread)-\d+$/.test(outcome));
    for (const name of ['board', 'thread']) expect(committed.some((outcome) => outcome.startsWith(`${name}-`))).toBe(true);
    for (const refused of outcomes.filter((outcome) => !committed.includes(outcome))) expect(['stale-revision', 'busy']).toContain(refused);
    const reader = await open(path);
    expect(reader.body(made.workId, 'brief')!.split('\n').filter(Boolean).toSorted()).toEqual(committed.toSorted());
    expect(reader.read(made.workId).revision).toBe(1 + committed.length);
  });

  it('keeps Queued records in the order they joined the Queue', async () => {
    const records = await open();
    const [a, b, c] = ['bug', 'feature', 'improvement'].map((kind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind: kind as 'bug' }));
    records.update(c!.workId, 1, { status: 'Queued' });
    records.update(a!.workId, 1, { status: 'Queued' });
    records.update(b!.workId, 1, { status: 'Queued' });
    expect(records.list({ status: 'Queued' }).map((r) => r.workId)).toEqual([c!.workId, a!.workId, b!.workId]);

    records.update(c!.workId, 2, { status: 'Shaping' });
    expect(records.read(c!.workId).queueOrder).toBeNull();
  });

  it('lists by repository, Status and kind', async () => {
    const records = await open();
    const lar = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug' });
    records.create({ title: 'Work', repository: 'maddec01/other', kind: 'bug' });
    const concept = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'concept' });
    expect(records.list({ repository: 'maddec01/lar' }).map((r) => r.workId)).toEqual([lar.workId, concept.workId]);
    expect(records.list({ repository: 'maddec01/lar', kind: 'concept' }).map((r) => r.workId)).toEqual([concept.workId]);
    expect(records.list({ status: 'Done' })).toEqual([]);
  });

  it('sets a record aside and restores it without touching its Status', async () => {
    const records = await open();
    const made = records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'feature', status: 'Ready' });
    const aside = records.setAside(made.workId, 1);
    expect(aside).toMatchObject({ status: 'Ready', setAside: true, revision: 2 });
    expect(records.restore(aside.workId, 2)).toMatchObject({ status: 'Ready', setAside: false, revision: 3 });
    expect(() => records.restore(aside.workId, 3)).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('refuses malformed input and missing records without changing anything', async () => {
    const records = await open();
    expect(() => records.create({ title: 'Work', repository: '', kind: 'bug' })).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'chore' as 'bug' })).toThrow(/kind "chore"/);
    expect(() => records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug', status: 'Doing' as 'List' })).toThrow(/Status "Doing"/);
    expect(() => records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'bug', ticket: 'lar-12' })).toThrow(/ticket "lar-12"/);
    expect(() => records.read('nope')).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => records.update('nope', 1, { status: 'Ready' })).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(records.list({})).toEqual([]);
  });
});

describe('work-record structure', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind });

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


describe('work-record content', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind });

  it('keeps a build brief, a decision text and a concept map across close and reopen', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const [build, decision, concept] = [lar(first, 'build'), lar(first, 'decision'), lar(first, 'concept')];
    expect(first.setBody(build.workId, 1, 'brief', '## What\n\nAdd it.\n')).toMatchObject({ revision: 2 });
    first.setBody(build.workId, 2, 'brief', '## What\n\nAdd it now.\n');
    first.setBody(decision.workId, 1, 'decision', 'Use SQLite.');
    first.setBody(concept.workId, 1, 'map', '# Map');
    first.close();

    const reopened = await open(path);
    expect(reopened.body(build.workId, 'brief')).toBe('## What\n\nAdd it now.\n');
    expect(reopened.body(decision.workId, 'decision')).toBe('Use SQLite.');
    expect(reopened.body(concept.workId, 'map')).toBe('# Map');
    expect(reopened.body(concept.workId, 'brief')).toBeNull();
  });

  it('refuses a body its kind does not hold, and a body that is not text', async () => {
    const records = await open();
    const build = lar(records, 'build');
    expect(() => records.setBody(build.workId, 1, 'map', '# Map')).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('Only a concept holds a map') }));
    expect(() => records.setBody(build.workId, 1, 'notes' as 'brief', 'x')).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.setBody(build.workId, 1, 'brief', 42 as unknown as string)).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(records.read(build.workId)).toEqual(build);
  });

  it('refuses a kind change that would leave a body, build phase or PR the new kind cannot hold', async () => {
    const records = await open();
    const [briefed, phased, released, mapped] = [lar(records, 'feature'), lar(records, 'build'), lar(records, 'build'), lar(records, 'concept')];
    records.setBody(briefed.workId, 1, 'brief', '# Brief');
    records.setBuildPhase(phased.workId, 1, 'plan');
    records.setPullRequest(released.workId, 1, 'maddec01/lar#88');
    records.setBody(mapped.workId, 1, 'map', '# Map');
    const refuse = (workId: string, kind: WorkKind, message: string) => {
      const before = records.read(workId);
      expect(() => records.update(workId, 2, { kind, status: 'Ready' })).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining(message) }));
      expect(records.read(workId)).toEqual(before);
    };
    refuse(briefed.workId, 'decision', 'A decision holds no brief');
    refuse(phased.workId, 'slice', 'A slice is never built');
    refuse(released.workId, 'concept', 'A concept is never built');
    refuse(mapped.workId, 'decision', 'Only a concept holds a map');
    expect(records.update(briefed.workId, 2, { kind: 'bug' })).toMatchObject({ kind: 'bug', revision: 3 });
  });

  it('records a build phase and its PR, refusing unknown phases and records that are never built', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    expect(build).toMatchObject({ buildPhase: null, pullRequest: null });
    expect(first.setBuildPhase(build.workId, 1, 'implement')).toMatchObject({ buildPhase: 'implement', revision: 2 });
    first.setPullRequest(build.workId, 2, 'maddec01/lar#88');
    first.close();

    const reopened = await open(path);
    expect(reopened.read(build.workId)).toMatchObject({ buildPhase: 'implement', pullRequest: 'maddec01/lar#88', revision: 3 });
    expect(() => reopened.setBuildPhase(build.workId, 3, 'deploy' as 'plan')).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('phase "deploy"') }));
    expect(() => reopened.setPullRequest(build.workId, 3, 'pr-88')).toThrow(expect.objectContaining({ code: 'invalid' }));
    const concept = lar(reopened, 'concept');
    expect(() => reopened.setBuildPhase(concept.workId, 1, 'plan')).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('A concept is never built') }));
  });

  it('holds one current delivery PR and keeps each replaced one as history', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    first.setPullRequest(build.workId, 1, 'maddec01/lar#88');
    expect(first.setPullRequest(build.workId, 2, 'maddec01/lar#88')).toMatchObject({ revision: 2 });
    first.setPullRequest(build.workId, 2, 'maddec01/lar#95');
    first.close();

    const reopened = await open(path);
    expect(reopened.read(build.workId)).toMatchObject({ pullRequest: 'maddec01/lar#95', revision: 3 });
    expect(reopened.replacedPullRequests(build.workId)).toEqual([{ pullRequest: 'maddec01/lar#88', replacedAt: expect.any(String) }]);
    expect(() => reopened.setPullRequest(build.workId, 2, 'maddec01/lar#96')).toThrow(expect.objectContaining({ code: 'stale-revision' }));
    expect(reopened.replacedPullRequests(build.workId)).toHaveLength(1);
  });

  const round1 = {
    base: 'c8890a1a',
    reviewers: [
      { axis: 'code', verdict: 'changes', findings: [
        { severity: 'should', summary: 'Spec: src/cli.ts:12: the help skips export.', disposition: 'open' },
        { severity: 'nit', summary: 'Standards: src/cli.ts:40: name it run.', disposition: 'rejected', reason: 'The repo names it so.' },
      ] },
      { axis: 'security', verdict: 'approve', findings: [], notChecked: 'Signed releases.' },
      { axis: 'ui', verdict: 'skipped', findings: [], notChecked: 'Nothing on screen changed.' },
    ],
  } as const;

  it('keeps a review round with every axis, finding and disposition across close and reopen', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    expect(first.recordReviewRound(build.workId, 1, round1)).toMatchObject({ revision: 2 });
    first.setFindingDisposition(build.workId, 2, { round: 1, axis: 'code', finding: 1 }, 'fixed');
    first.recordReviewRound(build.workId, 3, { base: 'aa11bb22', reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }] });
    first.close();

    const rounds = (await open(path)).reviewRounds(build.workId);
    expect(rounds.map((r) => [r.round, r.base])).toEqual([[1, 'c8890a1a'], [2, 'aa11bb22']]);
    expect(rounds[0]!.reviewers).toEqual([
      { axis: 'code', verdict: 'changes', notChecked: null, findings: [
        { severity: 'should', summary: 'Spec: src/cli.ts:12: the help skips export.', disposition: 'fixed', reason: null },
        { severity: 'nit', summary: 'Standards: src/cli.ts:40: name it run.', disposition: 'rejected', reason: 'The repo names it so.' },
      ] },
      { axis: 'security', verdict: 'approve', notChecked: 'Signed releases.', findings: [] },
      { axis: 'ui', verdict: 'skipped', notChecked: 'Nothing on screen changed.', findings: [] },
    ]);
  });

  it('leaves no round behind when one of its findings fails validation', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const broken = { ...round1, reviewers: [round1.reviewers[0], { axis: 'performance', verdict: 'changes', findings: [{ severity: 'huge', summary: 'Slow.', disposition: 'open' }] }] };
    expect(() => records.recordReviewRound(build.workId, 1, broken as never)).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('severity "huge"') }));
    expect(records.reviewRounds(build.workId)).toEqual([]);
    expect(records.read(build.workId)).toEqual(build);
  });

  it('refuses a malformed round, a repeated axis, a rejection without a reason and a missing finding', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const code = round1.reviewers[0];
    const refuse = (round: unknown, message: string) =>
      expect(() => records.recordReviewRound(build.workId, 1, round as never)).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining(message) }));
    refuse({ base: 'not a sha', reviewers: [code] }, 'base');
    refuse({ base: 'c8890a1a', reviewers: [] }, 'no reviewers');
    refuse({ base: 'c8890a1a', reviewers: [code, code] }, 'code reviewer twice');
    refuse({ base: 'c8890a1a', reviewers: [{ ...code, axis: 'style' }] }, 'axis "style"');
    refuse({ base: 'c8890a1a', reviewers: [{ ...code, findings: [{ ...code.findings[1], reason: undefined }] }] }, 'reason');
    refuse({ base: 'c8890a1a', reviewers: [{ axis: 'ui', verdict: 'skipped', findings: [] }] }, 'skipped');
    expect(() => records.recordReviewRound(lar(records, 'concept').workId, 1, round1)).toThrow(expect.objectContaining({ message: expect.stringContaining('never built') }));

    records.recordReviewRound(build.workId, 1, round1);
    expect(() => records.setFindingDisposition(build.workId, 2, { round: 1, axis: 'code', finding: 3 }, 'fixed')).toThrow(expect.objectContaining({ code: 'not-found' }));
    expect(() => records.setFindingDisposition(build.workId, 2, { round: 1, axis: 'code', finding: 1 }, 'rejected')).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(records.reviewRounds(build.workId)[0]!.reviewers[0]!.findings[0]!.disposition).toBe('open');
  });

  it('refuses to make a reviewed build a kind that is never built', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const reviewed = records.recordReviewRound(build.workId, 1, round1);
    expect(() => records.update(build.workId, 2, { kind: 'slice' })).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('A slice is never built') }));
    expect(records.read(build.workId)).toEqual(reviewed);
  });
});

describe('work-record threads and launch intents', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind });

  it('records thread IDs and a PR that stay on the same work ID when a ticket is attached', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    first.addThread(build.workId, 1, 'thread-shape-1', 'shape');
    first.addThread(build.workId, 2, 'thread-build-1', 'build');
    first.setPullRequest(build.workId, 3, 'maddec01/lar#90');
    first.attachTicket(build.workId, 4, 'maddec01/lar#89');
    first.close();

    const reopened = await open(path);
    expect(reopened.read(build.workId)).toMatchObject({ ticket: 'maddec01/lar#89', pullRequest: 'maddec01/lar#90', revision: 5 });
    expect(reopened.threads(build.workId).map((t) => [t.threadId, t.purpose])).toEqual([['thread-shape-1', 'shape'], ['thread-build-1', 'build']]);
    expect(() => reopened.addThread(lar(reopened, 'bug').workId, 1, 'thread-build-1', 'build')).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining(build.workId) }));
    expect(() => reopened.addThread(build.workId, 5, 'has space', 'build')).toThrow(expect.objectContaining({ code: 'invalid' }));
  });

  it('finds an unresolved launch intent after reopening and resolves it to a thread ID exactly once', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    const { record, intent } = first.recordLaunchIntent(build.workId, 1, 'build');
    expect(record.revision).toBe(2);
    expect(intent).toMatchObject({ workId: build.workId, purpose: 'build', outcome: null, threadId: null, resolvedAt: null });
    first.close();

    const board = await open(path);
    const thread = await open(path);
    expect(board.launchIntents({ unresolved: true })).toEqual([intent]);
    const resolved = board.resolveLaunchIntent(build.workId, 2, intent.intentId, { threadId: 'thread-9' });
    expect(resolved.intent).toMatchObject({ outcome: 'started', threadId: 'thread-9' });
    expect(resolved.record.revision).toBe(3);
    expect(board.threads(build.workId).map((t) => [t.threadId, t.purpose])).toEqual([['thread-9', 'build']]);

    expect(() => thread.resolveLaunchIntent(build.workId, 3, intent.intentId, { threadId: 'thread-10' })).toThrow(expect.objectContaining({ code: 'invalid', message: expect.stringContaining('already resolved') }));
    expect(thread.launchIntents({ unresolved: true })).toEqual([]);
    expect(thread.launchIntents({ workId: build.workId })).toEqual([resolved.intent]);
    expect(thread.threads(build.workId)).toHaveLength(1);
  });

  it('resolves an intent to a failure without recording a thread', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const other = records.create({ title: 'Work', repository: 'maddec01/other', kind: 'bug' });
    const { intent } = records.recordLaunchIntent(build.workId, 1, 'build');
    records.recordLaunchIntent(other.workId, 1, 'shape');
    expect(records.launchIntents({ repository: 'maddec01/lar', unresolved: true })).toEqual([intent]);

    expect(() => records.resolveLaunchIntent(build.workId, 2, intent.intentId, { failure: ' ' })).toThrow(expect.objectContaining({ code: 'invalid' }));
    expect(() => records.resolveLaunchIntent(other.workId, 2, intent.intentId, { failure: 'T3 refused.' })).toThrow(expect.objectContaining({ code: 'not-found' }));
    const failed = records.resolveLaunchIntent(build.workId, 2, intent.intentId, { failure: 'T3 refused the start.' });
    expect(failed.intent).toMatchObject({ outcome: 'failed', failure: 'T3 refused the start.', threadId: null });
    expect(records.threads(build.workId)).toEqual([]);
  });
});

describe('work-record facts the board sets', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind });

  it('sets, replaces and clears a Needs you reason without moving the Status', async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    expect(build.needsYou).toBeNull();
    first.setNeedsYou(build.workId, 1, 'Its PR closed without merging.');
    first.close();

    const reopened = await open(path);
    expect(reopened.read(build.workId)).toMatchObject({ needsYou: 'Its PR closed without merging.', status: 'List', revision: 2 });
    expect(reopened.setNeedsYou(build.workId, 2, "The start's outcome is unknown.")).toMatchObject({ needsYou: "The start's outcome is unknown.", revision: 3 });
    expect(() => reopened.setNeedsYou(build.workId, 3, ' ')).toThrow(/reason/);
    expect(reopened.clearNeedsYou(build.workId, 3)).toMatchObject({ needsYou: null, revision: 4 });
    expect(reopened.clearNeedsYou(build.workId, 4)).toMatchObject({ revision: 4 });
  });

  it("snapshots a build's selected project skills once, so later selections leave it alone", async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const build = lar(first, 'build');
    expect(build.skills).toBeNull();
    first.snapshotSkills(build.workId, 1, ['react-patterns', 'acme:testing']);
    first.close();

    const reopened = await open(path);
    expect(reopened.read(build.workId)).toMatchObject({ skills: ['react-patterns', 'acme:testing'], revision: 2 });
    expect(() => reopened.snapshotSkills(build.workId, 2, ['other'])).toThrow(/already snapshotted/);
    expect(reopened.snapshotSkills(lar(reopened, 'feature').workId, 1, [])).toMatchObject({ skills: [] });
    expect(() => reopened.snapshotSkills(lar(reopened, 'decision').workId, 1, [])).toThrow(/never built/);
    expect(() => reopened.snapshotSkills(lar(reopened, 'bug').workId, 1, ['a', 'a'])).toThrow(/twice/);
    expect(() => reopened.snapshotSkills(lar(reopened, 'bug').workId, 1, ['has space'])).toThrow(/skill/);
    expect(() => reopened.update(build.workId, 2, { kind: 'concept' })).toThrow(/never built/);
  });
});

describe('work-record provider observations', () => {
  const lar = (records: WorkRecords, kind: WorkKind, ticket?: string) => records.create({ title: 'Work', repository: 'maddec01/lar', kind, ticket });

  it("replaces the last observation of a ticket's state and assignee, and keeps it across reopen", async () => {
    const path = join(tempDir(), 'work-records.db');
    const first = await openWorkRecords(path);
    const bug = lar(first, 'bug', 'maddec01/lar#7');
    first.observe(bug.workId, 1, { of: 'ticket', state: 'open', assignee: 'pedro' });
    expect(first.observe(bug.workId, 2, { of: 'ticket', state: 'closed' })).toMatchObject({ revision: 3, finishedAt: null });
    first.close();

    const reopened = await open(path);
    expect(reopened.observations(bug.workId)).toEqual([
      { of: 'ticket', subject: 'maddec01/lar#7', state: 'closed', assignee: null, observedAt: expect.any(String), failedAt: null, failure: null },
    ]);
    reopened.observe(bug.workId, 3, { of: 'ticket', state: 'not-found' });
    expect(reopened.observations(bug.workId)).toMatchObject([{ state: 'not-found' }]);
    expect(() => reopened.observe(bug.workId, 3, { of: 'ticket', state: 'open' })).toThrow(expect.objectContaining({ code: 'stale-revision' }));
  });

  it('keeps the last observation after a failed read and records when it failed, until a read succeeds', async () => {
    const records = await open();
    const bug = lar(records, 'bug', 'maddec01/lar#7');
    records.observe(bug.workId, 1, { of: 'ticket', state: 'open', assignee: 'pedro' });
    const [observed] = records.observations(bug.workId);
    records.recordReadFailure(bug.workId, 2, 'ticket', 'GitHub answered 502.');
    expect(records.observations(bug.workId)).toEqual([{ ...observed, failedAt: expect.any(String), failure: 'GitHub answered 502.' }]);

    records.observe(bug.workId, 3, { of: 'ticket', state: 'open', assignee: 'ana' });
    expect(records.observations(bug.workId)).toMatchObject([{ assignee: 'ana', failedAt: null, failure: null }]);

    const unread = lar(records, 'feature', 'maddec01/lar#8');
    records.recordReadFailure(unread.workId, 1, 'ticket', 'Offline.');
    expect(records.observations(unread.workId)).toMatchObject([{ subject: 'maddec01/lar#8', state: null, observedAt: null, failure: 'Offline.' }]);
  });

  it("observes the recorded PR, finishing the work when it merged, and drops the observation when the PR is replaced", async () => {
    const records = await open();
    const build = lar(records, 'build');
    records.setPullRequest(build.workId, 1, 'maddec01/lar#90');
    records.observe(build.workId, 2, { of: 'pr', state: 'closed' });
    expect(records.observations(build.workId)).toMatchObject([{ of: 'pr', subject: 'maddec01/lar#90', state: 'closed' }]);

    records.setPullRequest(build.workId, 3, 'maddec01/lar#91');
    expect(records.observations(build.workId)).toEqual([]);
    expect(records.observe(build.workId, 4, { of: 'pr', state: 'merged' })).toMatchObject({ finishedAt: expect.any(String), revision: 5 });
    expect(records.observations(build.workId)).toMatchObject([{ subject: 'maddec01/lar#91', state: 'merged' }]);
  });

  it('refuses an observation of something the record lacks, an unknown state or a PR assignee, and changes nothing', async () => {
    const records = await open();
    const build = lar(records, 'build');
    expect(() => records.observe(build.workId, 1, { of: 'ticket', state: 'open' })).toThrow(/has no ticket/);
    expect(() => records.observe(build.workId, 1, { of: 'pr', state: 'open' })).toThrow(/has no PR/);
    expect(() => records.recordReadFailure(build.workId, 1, 'pr', 'Offline.')).toThrow(/has no PR/);
    records.setPullRequest(build.workId, 1, 'maddec01/lar#90');
    expect(() => records.observe(build.workId, 2, { of: 'pr', state: 'draft' as 'open' })).toThrow(/state "draft"/);
    expect(() => records.observe(build.workId, 2, { of: 'pr', state: 'open', assignee: 'pedro' } as never)).toThrow(/assignee/);
    expect(() => records.recordReadFailure(build.workId, 2, 'pr', ' ')).toThrow(/failure/);
    expect(records.observations(build.workId)).toEqual([]);
    expect(records.read(build.workId).revision).toBe(2);
  });
});

describe('work-record completion', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind });
  const at = (records: WorkRecords, workId: string) => records.read(workId).revision;
  /** Merges a new delivery PR for the build. */
  const merge = (records: WorkRecords, workId: string, pr: string) => {
    records.setPullRequest(workId, at(records, workId), pr);
    records.observe(workId, at(records, workId), { of: 'pr', state: 'merged' });
  };
  /** Makes a decision under `concept` complete: answer, domain drafts, then the concept's map. */
  const settle = (records: WorkRecords, decision: string, concept: string) => {
    records.setBody(decision, at(records, decision), 'answer', 'Use SQLite.');
    records.setBody(decision, at(records, decision), 'domain-drafts', 'None.');
    records.setBody(concept, at(records, concept), 'map', '# Map\n\nSettled.');
  };

  it('completes a build only once its recorded PR is observed merged', async () => {
    const records = await open();
    const build = lar(records, 'build');
    expect(records.completion(build.workId)).toEqual({ complete: false, reasons: ['It has no recorded PR.'] });
    records.setPullRequest(build.workId, 1, 'maddec01/lar#90');
    records.observe(build.workId, 2, { of: 'pr', state: 'open' });
    expect(records.completion(build.workId)).toEqual({ complete: false, reasons: ["Its PR maddec01/lar#90 isn't observed merged."] });
    records.observe(build.workId, 3, { of: 'pr', state: 'closed' });
    expect(records.completion(build.workId).complete).toBe(false);
    records.update(build.workId, 4, { status: 'Done' });
    expect(records.completion(build.workId).complete).toBe(false);

    records.observe(build.workId, 5, { of: 'pr', state: 'merged' });
    expect(records.completion(build.workId)).toEqual({ complete: true, reasons: [] });
    records.setPullRequest(build.workId, 6, 'maddec01/lar#91');
    expect(records.completion(build.workId)).toEqual({ complete: false, reasons: ["Its PR maddec01/lar#91 isn't observed merged."] });
  });

  it("completes a decision once its answer and domain drafts are recorded and its concept's map is updated after them", async () => {
    const records = await open();
    const [concept, decision] = [lar(records, 'concept'), lar(records, 'decision')];
    records.setParent(decision.workId, 1, concept.workId);
    records.setBody(concept.workId, 2, 'map', '# Map');
    expect(records.completion(decision.workId)).toEqual({ complete: false, reasons: ["Its confirmed answer isn't recorded.", "Its domain drafts aren't recorded."] });

    records.setBody(decision.workId, 2, 'answer', 'Use SQLite.');
    records.setBody(decision.workId, 3, 'domain-drafts', '');
    expect(records.completion(decision.workId)).toEqual({ complete: false, reasons: [`Its concept ${concept.workId}'s map isn't updated since its answer and domain drafts.`] });
    records.setBody(concept.workId, 3, 'map', '# Map\n\nSettled.');
    expect(records.completion(decision.workId)).toEqual({ complete: true, reasons: [] });
    expect(() => records.setBody(lar(records, 'build').workId, 1, 'answer', 'x')).toThrow('Only a decision holds an answer');
  });

  it('completes a concept once its Fog is gone, every decision is settled and every build is Done', async () => {
    const path = join(tempDir(), 'work-records.db');
    const records = await openWorkRecords(path);
    const [concept, decision, build, dropped] = [lar(records, 'concept'), lar(records, 'decision'), lar(records, 'build'), lar(records, 'build')];
    for (const child of [decision, build, dropped]) records.setParent(child.workId, 1, concept.workId);
    records.setAside(dropped.workId, 2);
    expect(records.completion(concept.workId)).toEqual({ complete: false, reasons: [
      "Its Fog isn't gone.", `Its decision ${decision.workId} isn't settled.`, `Its build ${build.workId} isn't Done.`,
    ] });

    expect(records.setFogGone(concept.workId, at(records, concept.workId), true)).toMatchObject({ fogGone: true });
    settle(records, decision.workId, concept.workId);
    merge(records, build.workId, 'maddec01/lar#90');
    records.close();
    const reopened = await open(path);
    expect(reopened.completion(concept.workId)).toEqual({ complete: true, reasons: [] });
    reopened.setFogGone(concept.workId, at(reopened, concept.workId), false);
    expect(reopened.completion(concept.workId).reasons).toEqual(["Its Fog isn't gone."]);
    expect(() => reopened.setFogGone(build.workId, at(reopened, build.workId), true)).toThrow(/Only a concept/);
  });

  it('completes a slice once it is finished', async () => {
    const records = await open();
    const slice = lar(records, 'slice');
    expect(records.completion(slice.workId)).toEqual({ complete: false, reasons: ["It isn't finished."] });
    records.recordFinished(slice.workId, 1);
    expect(records.completion(slice.workId).complete).toBe(true);
  });

  it('lets a dependent start once its blockers are complete, with no ticket closing', async () => {
    const records = await open();
    const [concept, decision, build, other] = [lar(records, 'concept'), lar(records, 'decision'), lar(records, 'build'), lar(records, 'build')];
    records.setParent(decision.workId, 1, concept.workId);
    records.addBlocker(build.workId, 1, decision.workId);
    records.addBlocker(build.workId, 2, other.workId);
    expect(records.waitingOn(build.workId)).toEqual([
      { workId: decision.workId, reasons: ["Its confirmed answer isn't recorded.", "Its domain drafts aren't recorded."] },
      { workId: other.workId, reasons: ['It has no recorded PR.'] },
    ]);

    settle(records, decision.workId, concept.workId);
    merge(records, other.workId, 'maddec01/lar#90');
    expect(records.waitingOn(build.workId)).toEqual([]);
    expect(records.read(build.workId).ticket).toBeNull();
  });
});

describe('work-record retention', () => {
  const lar = (records: WorkRecords, kind: WorkKind) => records.create({ title: 'Work', repository: 'maddec01/lar', kind });
  /** `n` days after now. */
  const later = (n: number) => new Date(Date.now() + n * 86_400_000);
  const KEEP = { hideAfterDays: 7, deleteAfterDays: null };
  const ids = (list: readonly { workId: string }[]) => list.map((record) => record.workId);

  it('records a finish once, as a fact of its own', async () => {
    const records = await open();
    const build = lar(records, 'build');
    const finished = records.recordFinished(build.workId, 1);
    expect(finished).toMatchObject({ status: 'List', revision: 2, finishedAt: expect.any(String) });
    expect(() => records.recordFinished(build.workId, 2)).toThrow('already finished');
  });

  it('hides a finished or set-aside record after seven days and keeps it by default', async () => {
    const records = await open();
    const [finished, setAside, active] = [lar(records, 'build'), lar(records, 'feature'), lar(records, 'bug')];
    records.recordFinished(finished.workId, 1);
    records.setAside(setAside.workId, 1);

    expect(records.hidden(KEEP, later(6))).toEqual([]);
    expect(ids(records.hidden(KEEP, later(8)))).toEqual([finished.workId, setAside.workId]);
    expect(records.deleteExpired(KEEP, later(800))).toEqual({ deleted: [], kept: [] });
    expect(ids(records.list({}))).toEqual([finished.workId, setAside.workId, active.workId]);
  });

  it('deletes a finished record only after the chosen number of days, with its owned data', async () => {
    const records = await open();
    const build = lar(records, 'build');
    records.setBody(build.workId, 1, 'brief', '# Brief');
    records.recordReviewRound(build.workId, 2, { base: 'c8890a1a', reviewers: [{ axis: 'code', verdict: 'changes', findings: [{ severity: 'nit', summary: 'x', disposition: 'open' }] }] });
    records.addThread(build.workId, 3, 'thread-1', 'build');
    records.recordLaunchIntent(build.workId, 4, 'build');
    records.setPullRequest(build.workId, 5, 'maddec01/lar#1');
    records.setPullRequest(build.workId, 6, 'maddec01/lar#2');
    records.observe(build.workId, 7, { of: 'pr', state: 'merged' });
    const setting = { hideAfterDays: 7, deleteAfterDays: 30 };

    expect(records.deleteExpired(setting, later(29))).toEqual({ deleted: [], kept: [] });
    expect(records.deleteExpired(setting, later(31))).toEqual({ deleted: [build.workId], kept: [] });
    expect(records.list({})).toEqual([]);
    expect(records.launchIntents({})).toEqual([]);
    // The thread ID is free again: no thread row was left behind.
    const other = lar(records, 'build');
    expect(records.addThread(other.workId, 1, 'thread-1', 'build')).toMatchObject({ revision: 2 });
  });

  it('never deletes active or unfinished work, even in Done without a recorded finish', async () => {
    const records = await open();
    const made = (['List', 'Queued', 'In progress', 'Done'] as const).map((status) => records.create({ title: 'Work', repository: 'maddec01/lar', kind: 'feature', status }));
    expect(records.deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }, later(10_000))).toEqual({ deleted: [], kept: [] });
    expect(ids(records.list({})).toSorted()).toEqual(ids(made).toSorted());
  });

  it('keeps a finished build while it owns an unfinished slice, and says why', async () => {
    const records = await open();
    const [build, done, open_] = [lar(records, 'build'), lar(records, 'slice'), lar(records, 'slice')];
    records.setParent(done.workId, 1, build.workId);
    records.setParent(open_.workId, 1, build.workId);
    records.recordFinished(done.workId, 2);
    records.recordFinished(build.workId, 3);

    const result = records.deleteExpired({ hideAfterDays: 7, deleteAfterDays: 30 }, later(31));
    expect(result).toEqual({ deleted: [done.workId], kept: [{ workId: build.workId, reason: `It owns the slice ${open_.workId}, which is kept.` }] });
    expect(records.children(build.workId)).toMatchObject([{ workId: open_.workId }]);
    expect(records.read(build.workId).revision).toBe(5);
  });

  it('keeps a finished record another kept record waits on, and deletes both once neither is needed', async () => {
    const records = await open();
    const [blocker, waiting] = [lar(records, 'build'), lar(records, 'build')];
    records.addBlocker(waiting.workId, 1, blocker.workId);
    records.recordFinished(blocker.workId, 2);
    const setting = { hideAfterDays: 7, deleteAfterDays: 30 };

    expect(records.deleteExpired(setting, later(31))).toEqual({ deleted: [], kept: [{ workId: blocker.workId, reason: `The build ${waiting.workId}, which is kept, waits on it.` }] });
    records.recordFinished(waiting.workId, 2);
    expect(records.deleteExpired(setting, later(31)).deleted.toSorted()).toEqual([blocker.workId, waiting.workId].toSorted());
    expect(records.list({})).toEqual([]);
  });
});

it('restores imported refinement and relationships atomically and preserves later local removals', async () => {
  const records = await open();
  const concept = records.create({ title: 'Concept', repository: 'team/repo', kind: 'concept' });
  const build = records.create({ title: 'Build', repository: 'team/repo', kind: 'build' });
  const blocker = records.create({ title: 'Blocker', repository: 'team/repo', kind: 'build' });
  expect(() => records.restoreImported(build.workId, build.revision, { body: 'brief', markdown: 'Imported brief', parentId: concept.workId, blockerIds: [blocker.workId, 'missing'] })).toThrow();
  expect(records.body(build.workId, 'brief')).toBe(null);
  expect(records.read(build.workId)).toEqual(build);
  expect(records.children(concept.workId)).toEqual([]);
  expect(records.blockers(build.workId)).toEqual([]);
  const restored = records.restoreImported(build.workId, build.revision, { body: 'brief', markdown: 'Imported brief', parentId: concept.workId, blockerIds: [blocker.workId] });
  expect(records.body(build.workId, 'brief')).toBe('Imported brief');
  expect(restored.parentId).toBe(concept.workId);
  expect(records.blockers(build.workId).map(record => record.workId)).toEqual([blocker.workId]);
  records.clearParent(build.workId, restored.revision);
  records.removeBlocker(build.workId, records.read(build.workId).revision, blocker.workId);
  records.setBody(build.workId, records.read(build.workId).revision, 'brief', 'Local brief');
  const before = records.read(build.workId);
  expect(records.restoreImported(build.workId, before.revision, { body: 'brief', markdown: 'Provider edit', parentId: concept.workId, blockerIds: [blocker.workId] })).toEqual(before);
  expect(records.body(build.workId, 'brief')).toBe('Local brief');
  expect(records.read(build.workId).parentId).toBe(null);
  expect(records.blockers(build.workId)).toEqual([]);
});
