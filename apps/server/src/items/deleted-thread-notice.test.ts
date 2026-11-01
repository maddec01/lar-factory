import { test, expect } from 'vite-plus/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openWorkRecords } from '@lar-factory/work-records';
import { recordItems } from './record-items.ts';
import { deletedThreadNotice } from './deleted-thread-notice.ts';

test('confirmed latest deletion survives reopening, but live work and a newer thread suppress its notice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deleted-notice-'));
  let records = await openWorkRecords(join(dir, 'records.db'));
  try {
    let record = records.create({ title: 'Work', repository: 'owner/repo', kind: 'concept', status: 'Shaping' });
    record = records.addThread(record.workId, record.revision, 'old', 'shape');
    record = records.confirmThreadDeleted(record.workId, record.revision, 'old');
    records.close();
    records = await openWorkRecords(join(dir, 'records.db'));
    const item = { ...recordItems(records, [], ['owner/repo'])[0]!, threads: [] };
    expect(deletedThreadNotice(records, item)).toMatchObject({ deletedThread: true, offers: ['start-again', 'back-to-queue', 'back-to-list'] });
    expect(deletedThreadNotice(records, { ...item, threads: 'unavailable' })).toBeUndefined();
    expect(deletedThreadNotice(records, { ...item, threads: [{ id: 'live', state: 'running' } as never] })).toBeUndefined();
    records.addThread(record.workId, record.revision, 'new', 'shape');
    expect(deletedThreadNotice(records, item)).toBeUndefined();
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
});
