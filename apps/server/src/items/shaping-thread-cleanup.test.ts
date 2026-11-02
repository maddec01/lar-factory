import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { createShapingThreadCleanup } from './shaping-thread-cleanup.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
afterEach(() => {
  for (const records of opened.splice(0)) records.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

async function setUp() {
  const dir = mkdtempSync(join(tmpdir(), 'shaping-thread-cleanup-'));
  dirs.push(dir);
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push(records);
  let changes = 0;
  const cleanup = createShapingThreadCleanup({ records, dir, changed: () => { changes += 1; } });
  return { dir, cleanup, changes: () => changes };
}

test('a saved choice shows in the state and reaches the board', async () => {
  const { cleanup, changes } = await setUp();
  assert.deepEqual(cleanup.state(), { choice: 'archive' });
  assert.deepEqual(cleanup.save({ choice: 'delete' }), { status: 200, body: { error: null } });
  assert.deepEqual(cleanup.state(), { choice: 'delete' });
  assert.equal(changes(), 1);
});

test('an invalid choice is refused with a 400 and changes nothing', async () => {
  const { cleanup, changes } = await setUp();
  cleanup.save({ choice: 'settle' });
  for (const choice of ['shred', 7, null, undefined]) assert.equal(cleanup.save({ choice }).status, 400, String(choice));
  assert.deepEqual(cleanup.state(), { choice: 'settle' });
  assert.equal(changes(), 1);
});

test("an unreadable setting shows why, and a valid choice replaces the file", async () => {
  const { dir, cleanup } = await setUp();
  writeFileSync(join(dir, 'shaping-thread-cleanup.json'), '{');
  const state = cleanup.state();
  assert.ok('problem' in state && state.problem.includes("isn't JSON"));
  assert.equal(cleanup.save({ choice: 'keep' }).status, 200);
  assert.deepEqual(cleanup.state(), { choice: 'keep' });
});

test('a board with no work records refuses the choice', () => {
  const cleanup = createShapingThreadCleanup({ records: null, dir: 'unused' });
  assert.equal(cleanup.save({ choice: 'keep' }).status, 409);
});
