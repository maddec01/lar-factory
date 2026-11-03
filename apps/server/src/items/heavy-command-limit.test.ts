import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { createHeavyCommandLimit } from './heavy-command-limit.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setUp() {
  const dir = mkdtempSync(join(tmpdir(), 'heavy-command-limit-'));
  dirs.push(dir);
  let changes = 0;
  const limit = createHeavyCommandLimit({ dir, automatic: 2, changed: () => { changes += 1; } });
  return { dir, limit, changes: () => changes };
}

test('a saved limit shows in the state beside the automatic number and reaches the board', () => {
  const { limit, changes } = setUp();
  assert.deepEqual(limit.state(), { limit: 'automatic', automatic: 2 });
  assert.deepEqual(limit.save({ limit: 5 }), { status: 200, body: { error: null } });
  assert.deepEqual(limit.state(), { limit: 5, automatic: 2 });
  assert.deepEqual(limit.save({ limit: 'automatic' }), { status: 200, body: { error: null } });
  assert.deepEqual(limit.state(), { limit: 'automatic', automatic: 2 });
  assert.equal(changes(), 2);
});

test('an invalid limit is refused with a 400 and changes nothing', () => {
  const { limit, changes } = setUp();
  limit.save({ limit: 3 });
  for (const value of [0, -2, 1.5, '3', 'auto', null, undefined]) assert.equal(limit.save({ limit: value }).status, 400, String(value));
  assert.deepEqual(limit.state(), { limit: 3, automatic: 2 });
  assert.equal(changes(), 1);
});

test('an invalid file shows as Automatic with why, and a save replaces it', () => {
  const { dir, limit } = setUp();
  writeFileSync(join(dir, 'heavy-command-limit.json'), '{ "limit": 0 }');
  const state = limit.state();
  assert.equal(state.limit, 'automatic');
  assert.match(state.problem ?? '', /needs a limit/);
  assert.equal(limit.save({ limit: 1 }).status, 200);
  assert.deepEqual(limit.state(), { limit: 1, automatic: 2 });
});
