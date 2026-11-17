import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { readRetention, writeRetention } from './retention.ts';
import { openWorkRecords } from './work-records.ts';

it('refuses a malformed setting and leaves the saved one as it was', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retention-'));

    try {
        writeRetention({ hideAfterDays: 3, deleteAfterDays: null }, dir);
        expect(() => writeRetention({ hideAfterDays: -1, deleteAfterDays: null }, dir)).toThrow(
            'whole numbers of days',
        );
        expect(() => writeRetention({ hideAfterDays: 7, deleteAfterDays: 1.5 }, dir)).toThrow('whole numbers of days');
        expect(readRetention(dir)).toEqual({ hideAfterDays: 3, deleteAfterDays: null });
        writeFileSync(join(dir, 'retention.json'), '{');
        expect(() => readRetention(dir)).toThrow("isn't JSON");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

it('hides and deletes a merged Done build on schedule whatever its Retro record holds', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'retention-'));
    const records = await openWorkRecords(join(dir, 'work.db'));
    const retention = { hideAfterDays: 0, deleteAfterDays: 0 };
    const later = new Date(Date.now() + 86400000);

    try {
        let record = records.create({
            title: 'Build',
            repository: 'owner/repo',
            kind: 'bug',
            status: 'Ready to merge',
        });
        const id = record.workId;

        record = records.setPullRequest(id, record.revision, 'owner/repo#1');
        record = records.addThread(id, record.revision, 'build-thread', 'build');
        record = records.setBuildPhase(id, record.revision, 'checks');
        records.proposeRetro(id, record.revision, [
            { title: 'Improve help', description: 'Explain evidence.', repository: 'owner/repo', kind: 'improvement' },
        ]);
        record = records.observe(id, records.read(id).revision, { of: 'pr', state: 'merged' });
        records.update(id, record.revision, { status: 'Done' });

        expect(records.hidden(retention, later).map((r) => r.workId)).toEqual([id]);
        expect(records.deleteExpired(retention, later)).toMatchObject({ deleted: [id], kept: [] });
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
