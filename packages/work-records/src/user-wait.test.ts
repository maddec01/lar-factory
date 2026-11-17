import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

let records: WorkRecords;
let dir: string;

afterEach(() => {
    records?.close();

    if (dir) rmSync(dir, { recursive: true, force: true });
});

async function shaping() {
    dir = mkdtempSync(join(tmpdir(), 'user-wait-'));
    records = await openWorkRecords(join(dir, 'work.db'));

    return records.create({ title: 'Wait', repository: 'example/a', kind: 'build', status: 'Shaping' }).workId;
}

const earlier = 'Which tracker holds the design notes?';

it('keeps a standalone failure, a changed notice, a brief approval and another owner’s wait', async () => {
    const id = await shaping();

    records.waitForUser(id, records.read(id).revision, 'The launch failed.');
    records.reconcileUserWait(id, { threadId: 'owner' });
    expect(records.read(id).needsYou).toBe('The launch failed.');

    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.waitForUser(id, records.read(id).revision, 'A new failure needs attention.');
    records.reconcileUserWait(id, { threadId: 'owner' });
    expect(records.read(id).needsYou).toBe('A new failure needs attention.');

    records.waitForUser(id, records.read(id).revision, 'Approve the brief.');
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.reconcileUserWait(id, { threadId: 'owner' });
    expect(records.read(id).needsYou).toBe('Approve the brief.');

    records.waitForUser(id, records.read(id).revision, earlier);
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.reconcileUserWait(id, { threadId: 'replacement' });
    expect(records.read(id).needsYou).toBe(earlier);
});

it('clears a Needs you set while the question is open when that question is answered', async () => {
    const id = await shaping();

    records.reconcileUserWait(id, { threadId: 'owner' });
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.waitForUser(id, records.read(id).revision, 'Gold or amber?');
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.reconcileUserWait(id, { threadId: 'owner' });

    expect(records.read(id)).toMatchObject({ needsYou: null, status: 'Shaping' });
});

it('clears a Needs you set after an earlier one while the question is open', async () => {
    const id = await shaping();

    records.waitForUser(id, records.read(id).revision, earlier);
    records.reconcileUserWait(id, { threadId: 'owner' });
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.waitForUser(id, records.read(id).revision, 'Gold or amber?');
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question' });
    records.reconcileUserWait(id, { threadId: 'owner' });

    expect(records.read(id)).toMatchObject({ needsYou: null, status: 'Shaping' });
});
