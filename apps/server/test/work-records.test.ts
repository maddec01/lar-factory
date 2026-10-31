import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { ItemDetails } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { startBoard, until } from './server-support.ts';

const LAR_WORK = join(dirname(fileURLToPath(import.meta.resolve('@lar-factory/work-records'))), 'cli.ts');

/** Runs lar-work on the board's database as a thread does, and returns the record it printed. */
async function larWork(dataDir: string, ...args: string[]): Promise<{ workId: string; revision: number }> {
  const { stdout } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', LAR_WORK, ...args, '--data-dir', dataDir]);
  const printed = JSON.parse(stdout) as { workId: string; revision: number } | { record: { workId: string; revision: number } };
  return 'record' in printed ? printed.record : printed;
}

test('the board lists the records lar-work writes while it runs, and their next change', { timeout: 30_000 }, async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], recorded: false });
  await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual((await board.board()).items, [], 'an issue with no work record is not on the board');
  const local = await larWork(board.dataDir, 'create', '--title', 'From a thread', '--repository', 'maddec01/lar-factory', '--kind', 'feature');
  const imported = await larWork(board.dataDir, 'import', '--title', 'Picked ticket', '--repository', 'maddec01/lar-factory', '--kind', 'bug',
    '--ticket', 'maddec01/lar-factory#12', '--status', 'Queued');
  const shown = await until(board, (d) => d.items.length === 2);
  assert.deepEqual(shown.items.map((i) => [i.id, i.title, i.status, i.url]), [
    [imported.workId, 'Picked ticket', 'Queued', 'https://github.com/maddec01/lar-factory/issues/12'],
    [local.workId, 'From a thread', 'List', null],
  ]);
  await larWork(board.dataDir, 'update', local.workId, '--revision', String(local.revision), '--status', 'Shaping');
  await until(board, (d) => d.items.some((i) => i.id === local.workId && i.status === 'Shaping'));
});

test('an item outside the onboarded repositories is not on the board, though it has a work record', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List', 'maddec01/elsewhere')] });
  await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual((await board.board()).items, []);
});

test("the item dialog reads a build's brief that lar-work wrote, and export writes what lar-work export writes", { timeout: 30_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'Downloads'));
  const board = await startBoard(t, { recorded: false }, false, false, { HOME: home });
  await until(board, (d) => d.fetchedAt !== null);
  const created = await larWork(board.dataDir, 'create', '--title', 'Owner accounts', '--repository', 'maddec01/lar-factory', '--kind', 'build');
  const brief = join(home, 'brief.md');
  writeFileSync(brief, '# Owner accounts\n\nAdd an owner table.\n');
  await larWork(board.dataDir, 'set-body', created.workId, '--revision', String(created.revision), '--body', 'brief', '--file', brief);
  await until(board, (d) => d.items.some((i) => i.id === created.workId));

  const read = await fetch(`${board.url}/api/item-details?itemId=${created.workId}`);
  const { details } = await read.json() as { details: ItemDetails };
  assert.deepEqual([details.record?.bodyKind, details.record?.body], ['brief', '# Owner accounts\n\nAdd an owner table.\n']);

  const exported = await board.post({ itemId: created.workId }, board.url, '/api/item-export');
  const { paths } = await exported.json() as { paths: string[] };
  assert.deepEqual([exported.status, paths], [200, [join(home, 'Downloads', 'brief-owner-accounts.md')]]);
  const command = join(home, 'command');
  mkdirSync(command);
  const { stdout } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', LAR_WORK, 'export', created.workId, '--to', command, '--data-dir', board.dataDir]);
  assert.equal(readFileSync(paths[0]!, 'utf8'), readFileSync((JSON.parse(stdout) as string[])[0]!, 'utf8'));
});
