import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { openWorkRecords, readRetention, type WorkRecords } from '@lar-factory/work-records';
import { createRetention } from './retention.ts';

const REPO = 'maddec01/lar-factory';
const DAY = 86_400_000;
const dirs: string[] = [];
const opened: WorkRecords[] = [];
afterEach(() => {
  for (const records of opened.splice(0)) records.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Records in a fresh data folder holding finished work and the build that owns a kept slice, both finished now. */
async function setUp() {
  const dir = mkdtempSync(join(tmpdir(), 'retention-'));
  dirs.push(dir);
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push(records);
  const finished = records.create({ title: 'Finished', repository: REPO, kind: 'bug', status: 'Done' });
  records.recordFinished(finished.workId, finished.revision);
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Done' });
  records.recordFinished(build.workId, build.revision);
  const slice = records.create({ title: 'Slice', repository: REPO, kind: 'slice' });
  records.setParent(slice.workId, slice.revision, build.workId);
  let at = Date.now();
  const retention = createRetention({ records, dir, now: () => new Date(at) });
  return { dir, records, retention, finished, build, later: (days: number) => { at += days * DAY; } };
}

test('by default retention keeps every record and hides finished work after seven days', async () => {
  const { records, retention, later } = await setUp();
  assert.deepEqual(retention.state(), { hideAfterDays: 7, deleteAfterDays: null });
  assert.deepEqual(retention.hidden(), new Set());
  later(8);
  assert.equal(retention.hidden().size, 2);
  retention.deleteDue();
  assert.equal(records.list({}).length, 3, 'nothing is deleted until Settings chooses a timed delete');
});

test('a timed delete answers the work it would delete and saves nothing until confirmed', async () => {
  const { dir, records, retention, later } = await setUp();
  later(31);
  const asked = retention.save({ hideAfterDays: 7, deleteAfterDays: 30 });
  assert.deepEqual(asked, { status: 200, body: { error: null, saved: false, due: [
    { workId: records.list({})[0]!.workId, title: 'Finished' }, { workId: records.list({})[1]!.workId, title: 'Build' }] } });
  assert.deepEqual(readRetention(dir), { hideAfterDays: 7, deleteAfterDays: null });
  assert.equal(records.list({}).length, 3);
});

test('a confirmed timed delete saves, deletes the due work through deleteExpired and reports the work it kept', async () => {
  const { dir, records, retention, finished, build, later } = await setUp();
  later(31);
  assert.deepEqual(retention.save({ hideAfterDays: 3, deleteAfterDays: 30, confirmed: true }), { status: 200, body: { error: null, saved: true } });
  assert.deepEqual(readRetention(dir), { hideAfterDays: 3, deleteAfterDays: 30 });
  assert.deepEqual(records.list({}).map((r) => r.title), ['Build', 'Slice']);
  const { lastDelete } = retention.state();
  assert.deepEqual([lastDelete?.deleted, lastDelete?.kept.map((k) => k.workId)], [[finished.workId], [build.workId]]);
  assert.match(lastDelete!.kept[0]!.reason, /owns the slice/);
  assert.deepEqual(retention.save({ hideAfterDays: 5, deleteAfterDays: 30 }), { status: 200, body: { error: null, saved: true } },
    'changing only when work hides asks nothing');
});

test('days that are not whole numbers save nothing, and an unreadable setting hides nothing', async () => {
  const { dir, retention, later } = await setUp();
  assert.equal(retention.save({ hideAfterDays: -1, deleteAfterDays: null }).status, 400);
  assert.equal(retention.save({ hideAfterDays: 7, deleteAfterDays: 'soon' }).status, 400);
  writeFileSync(join(dir, 'retention.json'), 'not json');
  later(8);
  assert.deepEqual(retention.hidden(), new Set());
  assert.match(retention.state().problem!, /isn't JSON/);
});
