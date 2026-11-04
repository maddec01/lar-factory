import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData, Item, ItemDetails } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { LAR_WORK, larWork, SAMPLE_MODELS, startBoard, until } from './server-support.ts';

test('the board lists the records lar-work writes while it runs, and their next change', { timeout: 30_000 }, async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], recorded: false });
  await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual((await board.board()).items.map((item:Item)=>[item.number,item.status,item.recorded]), [[12,'List',false]], 'unpicked issues appear fresh in List');
  const local = await larWork(board.dataDir, 'create', '--title', 'From a thread', '--repository', 'maddec01/lar-factory', '--kind', 'feature');
  const imported = await larWork(board.dataDir, 'import', '--title', 'Picked ticket', '--repository', 'maddec01/lar-factory', '--kind', 'bug',
    '--ticket', 'maddec01/lar-factory#12', '--status', 'Queued');
  const shown = await until(board, (d) => d.items.some(item=>item.id===imported.workId) && d.items.some(item=>item.id===local.workId));
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

test('Archive lists set-aside work with export and Restore, and a timed delete runs only once Settings confirms it', { timeout: 30_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  mkdirSync(join(home, 'Downloads'));
  const board = await startBoard(t, { recorded: false }, false, false, { HOME: home });
  await until(board, (d) => d.fetchedAt !== null);
  const created = await larWork(board.dataDir, 'create', '--title', 'Put away', '--repository', 'maddec01/lar-factory', '--kind', 'feature');
  const brief = join(home, 'brief.md');
  writeFileSync(brief, '# Put away\n');
  const written = await larWork(board.dataDir, 'set-body', created.workId, '--revision', String(created.revision), '--body', 'brief', '--file', brief);
  await larWork(board.dataDir, 'set-aside', created.workId, '--revision', String(written.revision));
  const archive = async () => (await (await fetch(`${board.url}/api/archive`)).json() as { items: Item[] }).items;
  const archived = await archive();
  const data = await board.board();
  assert.deepEqual([archived.map((i) => [i.id, i.archived]), data.retention, 'archive' in data], [[[created.workId, { setAside: true, hidden: false, ticketOpen: false }]],
    { hideAfterDays: 7, deleteAfterDays: null }, false], 'Archive has its own route, off the streamed board data');
  assert.equal((await board.postSession({ itemId: created.workId }, '/api/item-export')).status, 200);

  const asked = await (await board.postSession({ hideAfterDays: 7, deleteAfterDays: 0 }, '/api/retention')).json() as { saved: boolean; due: { workId: string }[] };
  assert.deepEqual([asked.saved, asked.due.map((d) => d.workId)], [false, [created.workId]]);
  assert.equal((await archive()).length, 1, 'nothing is deleted before the confirm');
  assert.equal((await board.postSession({ itemId: created.workId }, '/api/restore')).status, 200);
  await until(board, (d) => d.items.some((i) => i.id === created.workId));
  assert.deepEqual(await archive(), []);

  const again = await larWork(board.dataDir, 'read', created.workId);
  await larWork(board.dataDir, 'set-aside', created.workId, '--revision', String(again.revision));
  assert.equal((await archive()).length, 1);
  const confirmed = await board.postSession({ hideAfterDays: 7, deleteAfterDays: 0, confirmed: true }, '/api/retention');
  const { board: after } = await confirmed.json() as { board: BoardData };
  assert.deepEqual([await archive(), after.retention?.deleteAfterDays, after.retention?.lastDelete?.deleted], [[], 0, [created.workId]]);
});

test("the shaping thread cleanup setting reads Settle on a fresh machine, survives a restart, and refuses an invalid choice", { timeout: 30_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const board = await startBoard(t, { recorded: false }, false, false, { HOME: home });
  const fresh = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(fresh.shapingThreadCleanup, { choice: 'settle' });

  const refused = await board.postSession({ choice: 'shred' }, '/api/shaping-thread-cleanup');
  assert.equal(refused.status, 400);
  assert.deepEqual((await refused.json() as { board: BoardData }).board.shapingThreadCleanup, { choice: 'settle' });

  const saved = await board.postSession({ choice: 'delete' }, '/api/shaping-thread-cleanup');
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json() as { board: BoardData }).board.shapingThreadCleanup, { choice: 'delete' });

  await board.stop();
  const restarted = await startBoard(t, { recorded: false }, false, false, { HOME: home });
  assert.deepEqual((await until(restarted, (d) => d.fetchedAt !== null)).shapingThreadCleanup, { choice: 'delete' });
});

test('in sample mode the shaping thread cleanup setting is absent and saving it is refused', async (t) => {
  const sample = await startBoard(t, {}, true);
  assert.equal('shapingThreadCleanup' in await sample.board(), false);
  const refused = await sample.postSession({ choice: 'keep' }, '/api/shaping-thread-cleanup');
  assert.equal(refused.status, 403);
  assert.match((await refused.json() as { error: string }).error, /disabled in sample mode/);
});

test('the heavy command limit reads Automatic on a fresh machine, saves a whole number, and refuses anything else', { timeout: 30_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const board = await startBoard(t, { recorded: false }, false, false, { HOME: home });
  const fresh = (await until(board, (d) => d.fetchedAt !== null)).heavyCommandLimit;
  assert.equal(fresh?.limit, 'automatic');
  assert.ok(Number.isSafeInteger(fresh?.automatic) && fresh!.automatic >= 1);

  for (const limit of [0, 2.5, 'many']) {
    const refused = await board.postSession({ limit }, '/api/heavy-command-limit');
    assert.equal(refused.status, 400, String(limit));
    assert.equal((await refused.json() as { board: BoardData }).board.heavyCommandLimit?.limit, 'automatic');
  }

  const saved = await board.postSession({ limit: 3 }, '/api/heavy-command-limit');
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json() as { board: BoardData }).board.heavyCommandLimit, { limit: 3, automatic: fresh!.automatic });
});

test('the build limit reads Automatic at the heavy command limit, follows it, saves a whole number, and refuses anything else', { timeout: 30_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const board = await startBoard(t, { recorded: false }, false, false, { HOME: home });
  const fresh = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(fresh.buildLimit, { limit: 'automatic', automatic: fresh.heavyCommandLimit!.automatic });

  const heavy = await board.postSession({ limit: 5 }, '/api/heavy-command-limit');
  assert.deepEqual((await heavy.json() as { board: BoardData }).board.buildLimit, { limit: 'automatic', automatic: 5 });
  const refused = await board.postSession({ limit: 0 }, '/api/build-limit');
  assert.equal(refused.status, 400);
  const saved = await board.postSession({ limit: 1 }, '/api/build-limit');
  assert.equal(saved.status, 200);
  assert.deepEqual((await saved.json() as { board: BoardData }).board.buildLimit, { limit: 1, automatic: 5 });
});

test('Auto-build reads off on T3 Project default on a fresh machine, saves its switch and an offered model, and refuses anything else', { timeout: 30_000 }, async (t) => {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const board = await startBoard(t, { recorded: false }, false, false, { HOME: home, ...SAMPLE_MODELS });
  const fresh = await until(board, (d) => d.fetchedAt !== null);
  assert.deepEqual(fresh.autoBuild, { on: false });
  const [group] = fresh.modelChoices;
  const model = { instanceId: group!.instanceId, model: group!.models[0]!.slug };

  const on = await board.postSession({ on: true }, '/api/auto-build');
  assert.equal(on.status, 200);
  assert.deepEqual((await on.json() as { board: BoardData }).board.autoBuild, { on: true });
  const chosen = await board.postSession({ model }, '/api/auto-build');
  assert.deepEqual((await chosen.json() as { board: BoardData }).board.autoBuild, { on: true, model });
  const gone = await board.postSession({ model: { instanceId: group!.instanceId, model: 'no-such-model' } }, '/api/auto-build');
  assert.equal(gone.status, 422);
  const refused = await board.postSession({ on: 'yes' }, '/api/auto-build');
  assert.equal(refused.status, 400);
  assert.deepEqual((await refused.json() as { board: BoardData }).board.autoBuild, { on: true, model });
  assert.deepEqual(JSON.parse(readFileSync(join(board.dataDir, 'auto-build.json'), 'utf8')), { on: true, model });
});

test('in sample mode both limits and Auto-build are absent and saving them is refused', async (t) => {
  const sample = await startBoard(t, {}, true);
  const data = await sample.board();
  assert.deepEqual(['heavyCommandLimit' in data, 'buildLimit' in data, 'autoBuild' in data], [false, false, false]);
  for (const [path, input] of [['/api/heavy-command-limit', { limit: 2 }], ['/api/build-limit', { limit: 2 }], ['/api/auto-build', { on: true }]] as const) {
    const refused = await sample.postSession(input, path);
    assert.equal(refused.status, 403, path);
    assert.match((await refused.json() as { error: string }).error, /disabled in sample mode/);
  }
});
