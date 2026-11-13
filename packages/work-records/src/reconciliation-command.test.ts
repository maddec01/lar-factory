import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

test('reconcile CLI returns a deterministic checklist without draining a pending ticket write', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'reconcile-cli-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const g = records.create({ title: 'Group', repository: 'fake/api', kind: 'concept' });
        let b = records.createPart({
            title: 'Part',
            repository: 'fake/api',
            parentId: g.workId,
            parentRevision: g.revision,
            kind: 'build',
            body: 'Approved text.',
            blockerIds: [],
        });

        b = records.attachTicket(b.workId, b.revision, 'fake/api#7');
        records.recordGate(b.workId, b.revision, {
            briefDigest: records.gate(b.workId).briefDigest!,
            approvedBy: 'Fixture',
            evidence: 'Fake earlier board approval.',
        });

        const before = records.specState(b.workId);
        const run = () =>
            JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        '--disable-warning=ExperimentalWarning',
                        fileURLToPath(new URL('cli.ts', import.meta.url)),
                        'reconcile',
                        g.workId,
                        '--data-dir',
                        dir,
                    ],
                    { encoding: 'utf8' },
                ),
            );
        const first = run();

        expect(records.specState(b.workId)).toEqual(before);
        expect(first.items.some((i: { key: string }) => i.key === `ticket:${b.workId}`)).toBe(true);
        expect(run()).toEqual(first);
        expect(records.specState(b.workId).error).toBeNull();
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
}, 20000);
