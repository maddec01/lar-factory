import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: WorkRecords[] = [];
const dirs: string[] = [];

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('a started build holds a reservation until its PR opens', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'build-reservations-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    dirs.push(dir);
    opened.push(records);

    const rev = (id: string) => records.read(id).revision;
    const started = (title: string) => {
        const id = records.create({ title, repository: 'example/a', kind: 'build', status: 'Ready' }).workId;

        records.setBody(id, rev(id), 'brief', title);
        records.recordGate(id, rev(id), {
            briefDigest: records.gate(id).briefDigest!,
            approvedBy: 'Pedro',
            evidence: 'Yes',
        });

        const intent = records.prepareBuild(id, rev(id), { limit: 2 }).intent;

        records.resolveLaunchIntent(id, rev(id), intent.intentId, { threadId: `owner-${rev(id)}-${title.length}` });

        return id;
    };
    const withoutPr = started('Still building');
    const withPr = started('Waiting on its PR');

    records.setPullRequest(withPr, rev(withPr), 'example/a#7');
    records.observe(withPr, rev(withPr), { of: 'pr', state: 'open' });

    expect(records.buildReservations()).toEqual([withoutPr]);
});
