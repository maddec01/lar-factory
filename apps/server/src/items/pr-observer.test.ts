import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test, vi } from 'vite-plus/test';
import type { Item } from '@lar-factory/shared';
import { openWorkRecords, type PullRequestState, type WorkRecords } from '@lar-factory/work-records';
import { conditionalPrReader, createPrObserver } from './pr-observer.ts';

const repo = 'owner/repo';
const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  for (const { records, dir } of opened.splice(0)) { records.close(); rmSync(dir, { recursive: true, force: true }); }
});
async function fixture() {
  const dir = mkdtempSync(join(tmpdir(), 'pr-observer-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  const created = records.create({ repository: repo, title: 'Work without an issue', kind: 'build', status: 'Review' });
  const record = records.setPullRequest(created.workId, created.revision, `${repo}#4`);
  const read = vi.fn<(repo: string, number: number) => Promise<PullRequestState>>(async () => 'open');
  const changed = vi.fn();
  const hidden = new Set<string>();
  const options = { repositories: () => [repo], hidden: () => hidden, waits: () => false, read, changed };
  return { records, record, read, changed, hidden, options };
}

test('GitHub PR state reads retain their ETag and last state through a 304', async () => {
  const run = vi.fn<(args: string[]) => Promise<string>>(async () => 'HTTP/2.0 200 OK\r\nETag: "state-1"\r\n\r\n{"state":"open","merged_at":null}');
  const read = conditionalPrReader(run);
  expect(await read(repo, 4)).toBe('open');
  // gh represents an unchanged response as a nonzero exit.
  run.mockRejectedValueOnce(new Error('gh: HTTP 304'));
  expect(await read(repo, 4)).toBe('open');
  expect(run.mock.calls[1]![0]).toContain('If-None-Match: "state-1"');
});

test('an issue-free build follows its PR within fifteen seconds and stops reading once merged', async () => {
  const { records, record, options, read } = await fixture();
  const observer = createPrObserver(records, options);
  await observer.poll(0);
  await observer.poll(14_999);
  expect(read).toHaveBeenCalledTimes(1);
  read.mockResolvedValueOnce('merged');
  await observer.poll(15_000);
  expect(records.read(record.workId).status).toBe('Done');
  await observer.poll(30_000);
  expect(read).toHaveBeenCalledTimes(2);
});

test('a newly read linked PR finishes its record without a provider call', async () => {
  const { records, record, options, read } = await fixture();
  const observer = createPrObserver(records, options);
  await observer.known([{ linkedPrs: [{ url: `https://github.com/${repo}/pull/4`, state: 'merged' }] } as Item], 0);
  expect(records.read(record.workId).status).toBe('Done');
  expect(read).not.toHaveBeenCalled();
});

test('hidden work and repositories waiting on access are not polled', async () => {
  const { records, record, options, read, hidden } = await fixture();
  const observer = createPrObserver(records, options);
  hidden.add(record.workId);
  await observer.poll(0);
  hidden.clear();
  options.waits = () => true;
  await observer.poll(15_000);
  expect(read).not.toHaveBeenCalled();
});

test('a failed conditional read keeps the last state and waits before retrying', async () => {
  const { records, record, options, read } = await fixture();
  const observer = createPrObserver(records, options);
  await observer.poll(0);
  read.mockRejectedValueOnce(new Error('Provider unavailable'));
  await observer.poll(15_000);
  expect(records.read(record.workId).status).toBe('Review');
  expect(records.observations(record.workId)).toMatchObject([{ of: 'pr', state: 'open', failure: 'Provider unavailable' }]);
  await observer.poll(16_000);
  expect(read).toHaveBeenCalledTimes(2);
});
