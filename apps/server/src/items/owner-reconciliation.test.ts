import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { reconcileOwnerActivity } from './owner-reconciliation.ts';
import { recordItems } from './record-items.ts';

test('S08 F04: an answered request clears its old desk notice when its owner resumes; new notices stay', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'owner-wait-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const work = records.create({ title: 'SA', repository: 'fake/a', kind: 'build', status: 'Shaping' });

        records.addThread(work.workId, work.revision, 'owner', 'shape');
        records.waitForUser(work.workId, records.read(work.workId).revision, 'Gold or amber?');

        const item = recordItems(records, [], ['fake/a'])[0]!;

        item.threads = [
            {
                id: 'owner',
                purpose: 'shape',
                title: 'Owner',
                state: 'running',
                currentRunning: true,
                updated: '2099-01-01T00:00:00Z',
            },
        ];
        item.threads[0]!.pendingRequest = { id: 'q1', threadId: 'owner', kind: 'question' };
        reconcileOwnerActivity(records, item);
        delete item.threads[0]!.pendingRequest;
        records.setBody(
            work.workId,
            records.read(work.workId).revision,
            'brief',
            'Gold answer saved before the next refresh',
        );
        reconcileOwnerActivity(records, item);
        expect(records.read(work.workId)).toMatchObject({ needsYou: null, status: 'Shaping' });
        records.waitForUser(work.workId, records.read(work.workId).revision, 'A new product question');
        item.threads[0]!.updated = '2000-01-01T00:00:00Z';
        reconcileOwnerActivity(records, item);
        expect(records.read(work.workId).needsYou).toBe('A new product question');
        item.threads[0]!.updated = '2099-01-01T00:00:00Z';
        item.threads[0]!.pendingRequest = { id: 'q2', threadId: 'owner', kind: 'question' };
        reconcileOwnerActivity(records, item);
        expect(records.read(work.workId).needsYou).toBe('A new product question');
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
