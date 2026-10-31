import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vite-plus/test';

const CLI = join(import.meta.dirname, 'cli.ts');
const dirs: string[] = [];
const tempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-work-'));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs lar-work from an empty folder, with HOME pointed at another, as a thread would with the board closed. */
async function larWork(dataDir: string, ...args: string[]) {
  const cwd = tempDir();
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', CLI, ...args, '--data-dir', dataDir], {
      cwd, env: { ...process.env, HOME: cwd },
    });
    return { code: 0, stdout, stderr, record: /^[[{]/.test(stdout) ? JSON.parse(stdout) : null };
  } catch (error) {
    const { code, stdout, stderr } = error as { code: number; stdout: string; stderr: string };
    return { code, stdout, stderr, record: null };
  }
}

// Each run starts a Node process, about a second apiece.
describe('lar-work', { timeout: 30_000 }, () => {
  it('creates, reads and updates a record in a data folder with no board running', async () => {
    const data = join(tempDir(), 'Lar Factory');
    const created = await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'feature');
    expect(created).toMatchObject({ code: 0, record: { repository: 'maddec01/lar', status: 'List', revision: 1 } });
    const { workId } = created.record;

    const updated = await larWork(data, 'update', workId, '--revision', '1', '--status', 'Queued');
    expect(updated.record).toMatchObject({ workId, status: 'Queued', queueOrder: 1, revision: 2 });
    expect((await larWork(data, 'read', workId)).record).toEqual(updated.record);
    expect((await larWork(data, 'list', '--status', 'Queued')).record).toEqual([updated.record]);
    expect(readdirSync(data)).toContain('work-records.db');
  });

  it('imports a ticket once and attaches tickets without changing the work ID', async () => {
    const data = tempDir();
    const first = await larWork(data, 'import', '--repository', 'maddec01/lar', '--kind', 'bug', '--ticket', 'maddec01/lar#5');
    const again = await larWork(data, 'import', '--repository', 'maddec01/lar', '--kind', 'bug', '--ticket', 'maddec01/lar#5');
    expect(first.record.created).toBe(true);
    expect(again.record).toEqual({ record: first.record.record, created: false });

    const { workId } = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'concept')).record;
    const linked = await larWork(data, 'attach-ticket', workId, '--revision', '1', '--ticket', 'maddec01/lar#6');
    expect(linked.record).toMatchObject({ workId, ticket: 'maddec01/lar#6' });
    expect((await larWork(data, 'set-aside', workId, '--revision', '2')).record).toMatchObject({ setAside: true });
    expect((await larWork(data, 'restore', workId, '--revision', '3')).record).toMatchObject({ setAside: false });
  });

  it('reports a stale revision on stderr and changes nothing', async () => {
    const data = tempDir();
    const { workId } = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'bug')).record;
    await larWork(data, 'update', workId, '--revision', '1', '--status', 'Shaping');
    const stale = await larWork(data, 'update', workId, '--revision', '1', '--status', 'Ready');
    expect(stale).toMatchObject({ code: 1, stdout: '', stderr: `lar-work: The work record ${workId} is at revision 2, not 1; read it again and retry.\n` });
    expect((await larWork(data, 'read', workId)).record).toMatchObject({ status: 'Shaping', revision: 2 });
  });

  it('sets a parent and a blocker in a data folder with no board running', async () => {
    const data = tempDir();
    const create = async (kind: string) => (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', kind)).record.workId;
    const [build, slice, other] = [await create('build'), await create('slice'), await create('slice')];

    expect((await larWork(data, 'set-parent', slice, '--revision', '1', '--parent', build)).record).toMatchObject({ parentId: build, revision: 2 });
    expect((await larWork(data, 'add-blocker', slice, '--revision', '2', '--blocker', other)).record).toMatchObject({ revision: 3 });
    expect((await larWork(data, 'children', build)).record).toMatchObject([{ workId: slice }]);
    expect((await larWork(data, 'blockers', slice)).record).toMatchObject([{ workId: other }]);
    expect((await larWork(data, 'dependents', other)).record).toMatchObject([{ workId: slice }]);
    expect(await larWork(data, 'add-blocker', other, '--revision', '2', '--blocker', slice)).toMatchObject({ code: 1, stderr: expect.stringContaining('cycle') });
    expect((await larWork(data, 'remove-blocker', slice, '--revision', '3', '--blocker', other)).record).toMatchObject({ revision: 4 });
    expect((await larWork(data, 'clear-parent', slice, '--revision', '4')).record).toMatchObject({ parentId: null });
  });

  it('writes and reads a brief, a phase, a PR and a review round with no board running', async () => {
    const data = tempDir();
    const { workId } = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'build')).record;
    const brief = join(tempDir(), 'brief.md');
    writeFileSync(brief, '## What\n\nAdd it.\n');
    expect((await larWork(data, 'set-body', workId, '--revision', '1', '--body', 'brief', '--file', brief)).record).toMatchObject({ revision: 2 });
    expect(await larWork(data, 'body', workId, '--body', 'brief')).toMatchObject({ code: 0, stdout: '## What\n\nAdd it.\n' });
    expect(await larWork(data, 'body', workId, '--body', 'map')).toMatchObject({ code: 1, stderr: `lar-work: The work record ${workId} has no map.\n` });

    expect((await larWork(data, 'set-phase', workId, '--revision', '2', '--phase', 'review')).record).toMatchObject({ buildPhase: 'review' });
    expect((await larWork(data, 'set-pr', workId, '--revision', '3', '--pr', 'maddec01/lar#9')).record).toMatchObject({ pullRequest: 'maddec01/lar#9' });
    const round = join(tempDir(), 'round.json');
    writeFileSync(round, JSON.stringify({ base: 'c8890a1a', reviewers: [{ axis: 'code', verdict: 'changes', findings: [{ severity: 'should', summary: 'Spec: a.ts:1: x.', disposition: 'open' }] }] }));
    expect((await larWork(data, 'record-review-round', workId, '--revision', '4', '--file', round)).record).toMatchObject({ revision: 5 });
    await larWork(data, 'set-disposition', workId, '--revision', '5', '--round', '1', '--axis', 'code', '--finding', '1', '--disposition', 'rejected', '--reason', 'Out of scope.');
    expect((await larWork(data, 'review-rounds', workId)).record).toMatchObject([{ round: 1, reviewers: [{ axis: 'code', findings: [{ disposition: 'rejected', reason: 'Out of scope.' }] }] }]);
  });

  it('records a launch intent and resolves it to a thread with no board running', async () => {
    const data = tempDir();
    const { workId } = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'feature')).record;
    const { intent } = (await larWork(data, 'record-intent', workId, '--revision', '1', '--purpose', 'shape')).record;
    expect((await larWork(data, 'intents', '--unresolved')).record).toEqual([intent]);

    const resolved = await larWork(data, 'resolve-intent', workId, '--revision', '2', '--intent', intent.intentId, '--thread', 'thread-1');
    expect(resolved.record).toMatchObject({ record: { revision: 3 }, intent: { outcome: 'started', threadId: 'thread-1' } });
    expect((await larWork(data, 'intents', '--unresolved')).record).toEqual([]);
    expect((await larWork(data, 'threads', workId)).record).toMatchObject([{ threadId: 'thread-1', purpose: 'shape' }]);
    expect(await larWork(data, 'resolve-intent', workId, '--revision', '3', '--intent', intent.intentId, '--failure', 'x')).toMatchObject({ code: 1, stderr: expect.stringContaining('already resolved') });
    expect(await larWork(data, 'resolve-intent', workId, '--revision', '3', '--intent', intent.intentId)).toMatchObject({ code: 2, stderr: expect.stringContaining('--thread or --failure') });
  });

  it("saves this machine's retention setting and hides and deletes set-aside records with it", async () => {
    const data = tempDir();
    expect((await larWork(data, 'retention')).record).toEqual({ hideAfterDays: 7, deleteAfterDays: null });
    const { workId } = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'feature')).record;
    const kept = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'bug')).record;
    await larWork(data, 'set-aside', workId, '--revision', '1');
    expect((await larWork(data, 'hidden')).record).toEqual([]);

    expect((await larWork(data, 'retention', '--hide-after', '0')).record).toEqual({ hideAfterDays: 0, deleteAfterDays: null });
    expect((await larWork(data, 'hidden')).record).toMatchObject([{ workId }]);
    expect((await larWork(data, 'delete-expired')).record).toEqual({ deleted: [], kept: [] });
    expect((await larWork(data, 'retention', '--delete-after', '0')).record).toEqual({ hideAfterDays: 0, deleteAfterDays: 0 });
    expect((await larWork(data, 'delete-expired')).record).toEqual({ deleted: [workId], kept: [] });
    expect((await larWork(data, 'list')).record).toEqual([kept]);
    expect((await larWork(data, 'retention', '--delete-after', 'never')).record).toEqual({ hideAfterDays: 0, deleteAfterDays: null });
    expect(await larWork(data, 'retention', '--delete-after', 'soon')).toMatchObject({ code: 2, stderr: expect.stringContaining('whole number of days or never') });
  });

  it('exports a brief as markdown to a folder and refuses a missing folder', async () => {
    const data = tempDir();
    const { workId } = (await larWork(data, 'create', '--repository', 'maddec01/lar', '--kind', 'build')).record;
    const brief = join(tempDir(), 'brief.md');
    writeFileSync(brief, '# Add it\n');
    await larWork(data, 'set-body', workId, '--revision', '1', '--body', 'brief', '--file', brief);
    const to = tempDir();
    expect((await larWork(data, 'export', workId, '--to', to)).record).toEqual([join(to, 'brief-add-it.md')]);
    expect(readdirSync(to)).toEqual(['brief-add-it.md']);
    expect(await larWork(data, 'export', workId, '--to', join(to, 'missing'))).toMatchObject({ code: 1, stderr: expect.stringContaining("isn't a folder") });
  });

  it('reports usage mistakes before opening the database', async () => {
    const data = join(tempDir(), 'unused');
    expect(await larWork(data, 'frobnicate')).toMatchObject({ code: 2, stderr: expect.stringContaining('Unknown command "frobnicate"') });
    expect(await larWork(data, 'read')).toMatchObject({ code: 2, stderr: expect.stringContaining('read needs a work ID') });
    expect(readdirSync(join(data, '..'))).toEqual([]);
  });

  it('explains identifiers, reads, changes, structure and errors in its help', async () => {
    const help = await larWork(tempDir(), '--help');
    expect(help.code).toBe(0);
    for (const heading of ['Identifiers', 'Reads', 'Changes', 'Structure', 'Content', 'Threads and launch intents', 'Retention and export', 'Errors']) expect(help.stdout).toContain(`\n${heading}\n`);
  });
});
