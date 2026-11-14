import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { recordDetails } from '../item-details/item-details.ts';
import { recordItems } from './record-items.ts';

const opened: { records: WorkRecords; dir: string }[] = [];

afterEach(() => {
    for (const { records, dir } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture() {
    const dir = mkdtempSync(join(tmpdir(), 's05-projection-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ records, dir });

    return records;
}

test('S05 R2-001: linked parent has no Approve brief card or delivery gate', async () => {
    const records = await fixture();
    const parent = records.create({ title: 'Linked exchange', repository: 'fake/a', kind: 'build', status: 'Shaping' });

    records.setBody(parent.workId, parent.revision, 'brief', 'Shared destination.');
    for (const repo of ['fake/a', 'fake/b', 'fake/c'])
        records.createPart({
            title: `Build ${repo}`,
            repository: repo,
            parentId: parent.workId,
            parentRevision: records.read(parent.workId).revision,
            kind: 'build',
            body: 'Deliver agreed contract.',
            blockerIds: [],
        });
    records.waitForUser(parent.workId, records.read(parent.workId).revision, 'Approve this brief');

    const shown = recordItems(records, [], ['fake/a', 'fake/b', 'fake/c']).find((r) => r.id === parent.workId)!;

    expect(shown.briefApproval).toBeUndefined();
    expect(() => records.displayGate(parent.workId)).toThrow(/parent|delivery/);
});

test('S05 R2-002: a mismatched brief stays held until its replacement has current Doubt', async () => {
    const records = await fixture();
    const work = records.create({ title: 'Reader', repository: 'fake/b', kind: 'build', status: 'Ready' });

    records.setBody(work.workId, work.revision, 'brief', 'Read v1.');
    records.recordGate(work.workId, records.read(work.workId).revision, {
        briefDigest: records.gate(work.workId).briefDigest!,
        approvedBy: 'Pedro',
        evidence: 'Board fixture.',
    });
    records.confirmScope(
        work.workId,
        records.read(work.workId).revision,
        {
            files: [],
            tests: [],
            behaviour: ['Read v2.'],
            excluded: [],
            size: 'Small',
            verify: { required: false, visibleUi: null },
        },
        'Pedro',
        'Use v2.',
    );

    const shown = recordItems(records, [], ['fake/b']).find((r) => r.id === work.workId)!;

    expect(shown.passingBrief).toBe(false);
    expect(shown.briefApproval).toBeUndefined();
    expect(shown.briefReviewing).toBe(true);
});

test('S05 R2-001: linked parent details use the group map and child batch control instead of an own-brief button', async () => {
    const records = await fixture();
    const parent = records.create({ title: 'Linked exchange', repository: 'fake/a', kind: 'build' });

    records.setBody(parent.workId, parent.revision, 'brief', 'Shared greeting destination.');
    records.createPart({
        title: 'Producer',
        repository: 'fake/a',
        parentId: parent.workId,
        parentRevision: records.read(parent.workId).revision,
        kind: 'build',
        body: 'Produce v1.',
        blockerIds: [],
    });
    expect(recordDetails(records, parent.workId)).toMatchObject({
        bodyKind: 'map',
        body: 'Shared greeting destination.',
    });
});
