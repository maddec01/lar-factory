import { execFile } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
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
    return { code: 0, stdout, stderr, record: stdout.startsWith('Usage:') ? null : JSON.parse(stdout) };
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

  it('reports usage mistakes before opening the database', async () => {
    const data = join(tempDir(), 'unused');
    expect(await larWork(data, 'frobnicate')).toMatchObject({ code: 2, stderr: expect.stringContaining('Unknown command "frobnicate"') });
    expect(await larWork(data, 'read')).toMatchObject({ code: 2, stderr: expect.stringContaining('read needs a work ID') });
    expect(readdirSync(join(data, '..'))).toEqual([]);
  });

  it('explains identifiers, reads, changes and errors in its help', async () => {
    const help = await larWork(tempDir(), '--help');
    expect(help.code).toBe(0);
    for (const heading of ['Identifiers', 'Reads', 'Changes', 'Errors']) expect(help.stdout).toContain(`\n${heading}\n`);
  });
});
