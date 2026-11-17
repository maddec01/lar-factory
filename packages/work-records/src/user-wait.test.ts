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

it('keeps a Needs you the board saw before a question appeared, with its Status, after the answer', async () => {
    const id = await shaping();

    records.waitForUser(id, records.read(id).revision, earlier);
    records.reconcileUserWait(id, { threadId: 'owner', running: false });
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'unrelated', running: false });
    records.reconcileUserWait(id, { threadId: 'owner', running: true });

    expect(records.read(id)).toMatchObject({ needsYou: earlier, status: 'Needs you' });
});

it('clears a Needs you set while the question is open when that question is answered', async () => {
    const id = await shaping();

    records.reconcileUserWait(id, { threadId: 'owner', running: false });
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question', running: false });
    records.waitForUser(id, records.read(id).revision, 'Gold or amber?');
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question', running: false });
    records.reconcileUserWait(id, { threadId: 'owner', running: true });

    expect(records.read(id)).toMatchObject({ needsYou: null, status: 'Shaping' });
});

it('clears a Needs you set after an earlier one while the question is open', async () => {
    const id = await shaping();

    records.waitForUser(id, records.read(id).revision, earlier);
    records.reconcileUserWait(id, { threadId: 'owner', running: false });
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question', running: false });
    records.waitForUser(id, records.read(id).revision, 'Gold or amber?');
    records.reconcileUserWait(id, { threadId: 'owner', requestId: 'question', running: false });
    records.reconcileUserWait(id, { threadId: 'owner', running: true });

    expect(records.read(id)).toMatchObject({ needsYou: null, status: 'Shaping' });
});
