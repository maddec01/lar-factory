import { symlinkSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';
import { openWorkRecords } from './work-records.ts';

it('persists a started check and finishes it without changing the build revision', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const pending = records.trackerPending();
    const run = records.startCheck(build.workId, { role: 'implementer', command: ['pnpm', 'test'], folder: '.', tree: 'a'.repeat(40) });
    expect(records.checks(build.workId).runs[0]).toMatchObject({ checkId: run.checkId, outcome: 'unfinished' });
    records.finishCheck(run.checkId, { tree: 'a'.repeat(40), exitStatus: 0, interrupted: false, log: null });
    expect(records.checks(build.workId).runs[0]).toMatchObject({ outcome: 'passed', eligible: true, log: null });
    expect(records.trackerPending()).toEqual(pending);
    expect(records.read(build.workId).revision).toBe(build.revision);
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('keeps failures open after a pass and validates reuse against the explicit target', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const start = { role: 'builder', command: ['pnpm', 'test'], folder: '.', tree: 'a'.repeat(40) };
    const failure = records.startCheck(build.workId, start);
    records.finishCheck(failure.checkId, { tree: start.tree, exitStatus: 1, interrupted: false, log: null });
    records.describeFailure(failure.checkId, { tests: ['saves a record'], diagnosis: 'Missing fixture' });
    const pass = records.startCheck(build.workId, start);
    records.finishCheck(pass.checkId, { tree: start.tree, exitStatus: 0, interrupted: false, log: null });
    expect(records.checks(build.workId).runs[0]?.failureState).toBe('open');
    expect(() => records.reuseCheck(build.workId, failure.checkId, { role: 'approver', reason: 'Reviewed', tree: start.tree })).toThrow();
    expect(() => records.reuseCheck(build.workId, pass.checkId, { role: 'approver', reason: ' ', tree: start.tree })).toThrow();
    expect(records.reuseCheck(build.workId, pass.checkId, { role: 'approver', reason: 'Only prose changed', tree: 'b'.repeat(40) }).tree).toBe('b'.repeat(40));
    records.resolveFailure(failure.checkId, 'Added the missing fixture');
    expect(records.checks(build.workId).runs[0]?.failureState).toBe('resolved');
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('distinguishes interrupted, unfinished, changed snapshots, missing snapshots and expired live results', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    for (const input of [
      { tree: 'b'.repeat(40), exitStatus: 0, interrupted: false, log: null },
      { tree: null, exitStatus: 0, interrupted: false, log: null },
      { tree: 'a'.repeat(40), exitStatus: null, interrupted: true, log: null },
    ]) {
      const run = records.startCheck(build.workId, { role: 'builder', command: ['test'], folder: '.', tree: 'a'.repeat(40) });
      records.finishCheck(run.checkId, input);
      expect(() => records.reuseCheck(build.workId, run.checkId, { role: 'approver', reason: 'same', tree: 'a'.repeat(40) })).toThrow();
    }
    records.startCheck(build.workId, { role: 'builder', command: ['test'], folder: '.', tree: null });
    const live = records.startCheck(build.workId, { role: 'builder', command: ['test'], folder: '.', tree: 'a'.repeat(40), live: true });
    records.finishCheck(live.checkId, { tree: live.tree, exitStatus: 0, interrupted: false, log: null });
    const result = records.checks(build.workId, new Date(Date.now() + 86400001));
    expect(result.runs.map(run => run.outcome)).toEqual(['passed', 'passed', 'interrupted', 'unfinished', 'expired']);
    expect(result.runs.every(run => !run.eligible)).toBe(true);
    expect(result.runs.every(run => run.failureState === null)).toBe(true);
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('shares the build record with slices and preserves independent concurrent runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  const path = join(dir, 'work-records.db');
  const first = await openWorkRecords(path), second = await openWorkRecords(path);
  try {
    const build = first.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const slice = first.create({ title: 'Slice', repository: 'owner/repo', kind: 'slice' });
    first.setParent(slice.workId, slice.revision, build.workId);
    first.setCheckList(slice.workId, [{ command: ['test', ''], folder: 'packages/work-records' }]);
    const start = { role: 'builder', command: ['test'], folder: '.', tree: 'a'.repeat(40) };
    const a = first.startCheck(slice.workId, start), b = second.startCheck(build.workId, start);
    second.finishCheck(b.checkId, { tree: start.tree, exitStatus: 0, interrupted: false, log: null });
    first.finishCheck(a.checkId, { tree: start.tree, exitStatus: 1, interrupted: false, log: null });
    expect(first.checks(slice.workId).runs).toHaveLength(2);
    expect(first.checks(build.workId).list).toEqual([{ command: ['test', ''], folder: 'packages/work-records' }]);
    const logs = join(dir, 'check-logs', build.workId);
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(logs, `${a.checkId}.log`), 'failed');
    first.resetBuild(build.workId, first.read(build.workId).revision);
    expect(existsSync(logs)).toBe(false);
    expect(second.checks(build.workId)).toMatchObject({ runs: [], list: [], reuses: [] });
  } finally { first.close(); second.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('rejects malformed input atomically and removes expired records and logs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    const start = { role: 'builder', command: ['test'], folder: '.', tree: 'a'.repeat(40) };
    for (const input of [{ ...start, folder: '../escape' }, { ...start, tree: 'invalid' }, { ...start, role: '' }, { ...start, command: [] }]) expect(() => records.startCheck(build.workId, input)).toThrow();
    expect(() => records.setCheckList(build.workId, [start, start])).toThrow();
    expect(records.checks(build.workId).runs).toEqual([]);
    const run = records.startCheck(build.workId, start);
    expect(() => records.finishCheck(run.checkId, { tree: start.tree, exitStatus: 256, interrupted: false, log: null })).toThrow();
    expect(() => records.describeFailure(run.checkId, { tests: ['test'], diagnosis: 'cause' })).toThrow();
    expect(() => records.resolveFailure(run.checkId, 'cause')).toThrow();
    expect(records.checks(build.workId).runs[0]?.outcome).toBe('unfinished');
    records.finishCheck(run.checkId, { tree: start.tree, exitStatus: 0, interrupted: false, log: null });
    expect(() => records.finishCheck(run.checkId, { tree: start.tree, exitStatus: 1, interrupted: false, log: null })).toThrow();
    const logs = join(dir, 'check-logs', build.workId);
    mkdirSync(logs, { recursive: true }); writeFileSync(join(logs, `${run.checkId}.log`), 'output');
    records.setAside(build.workId, records.read(build.workId).revision);
    expect(records.deleteExpired({ hideAfterDays: 0, deleteAfterDays: 0 }, new Date(Date.now() + 1000)).deleted).toEqual([build.workId]);
    expect(existsSync(logs)).toBe(false);
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
});

it('does not follow a redirected log root during reset', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'validation-'));
  const outside = mkdtempSync(join(tmpdir(), 'external-logs-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  try {
    const build = records.create({ title: 'Build', repository: 'owner/repo', kind: 'build' });
    mkdirSync(join(outside, build.workId));
    const sentinel = join(outside, build.workId, 'keep');
    writeFileSync(sentinel, 'external');
    symlinkSync(outside, join(dir, 'check-logs'));
    records.resetBuild(build.workId, records.read(build.workId).revision);
    expect(existsSync(sentinel)).toBe(true);
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
});
