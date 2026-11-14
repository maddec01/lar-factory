import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

const fixture = JSON.parse(
    readFileSync(new URL('../../shared/test/s05-release-notice.json', import.meta.url), 'utf8'),
) as { savedNotice: string; recordedApproval: { evidence: string } };

test.each(['matching', 'structured notice', 'mismatched manifest', 'independent question', 'mixed notice'])(
    'legacy saved receipt recovery preserves other holds: %s',
    async (kind) => {
        const dir = mkdtempSync(join(tmpdir(), 'release-notice-'));
        const path = join(dir, 'work.db');
        let records = await openWorkRecords(path);

        try {
            const id = records.create({ title: 'Group', repository: 'fake/app', kind: 'concept' }).workId;
            const at = () => records.read(id).revision;

            records.addThread(id, at(), 'owner', 'shape');

            const part = records.createPart({
                parentId: id,
                parentRevision: at(),
                title: 'Part',
                repository: 'fake/app',
                kind: 'build',
                body: 'Part',
                blockerIds: [],
            });

            records.setPullRequest(part.workId, part.revision, 'fake/app#1');
            records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
            records.setReleasePlan(id, at(), {
                steps: [
                    { id: 'approve-joint-activation', who: 'Pedro', what: 'Approve exact manifest' },
                    { id: 'activate', who: 'Agent', what: 'Activate approved manifest' },
                ],
                outcomeCheck: 'Composition',
            });
            records.completeReleaseStep(
                id,
                at(),
                'approve-joint-activation',
                'Pedro',
                fixture.recordedApproval.evidence,
            );

            const notice =
                kind === 'structured notice'
                    ? 'Awaiting the recorded manifest action on the board.'
                    : kind === 'matching'
                      ? fixture.savedNotice
                      : kind === 'mismatched manifest'
                        ? fixture.savedNotice.replace(/2387e9fe[\da-f]+/g, 'f'.repeat(64))
                        : kind === 'mixed notice'
                          ? fixture.savedNotice + ' Which region?'
                          : 'Which region should we use?';
            const db = new DatabaseSync(path);

            db.prepare("UPDATE work_records SET needs_you=?,status='Needs you' WHERE work_id=?").run(notice, id);

            if (kind === 'structured notice')
                db.prepare('UPDATE work_records SET needs_you_release_step=? WHERE work_id=?').run(
                    'approve-joint-activation',
                    id,
                );

            db.close();
            records.close();
            records = await openWorkRecords(path);

            const recovered = records.prepareReleaseContinuation(id);

            expect(recovered.ready).toBe(['matching', 'structured notice'].includes(kind));
            expect(records.read(id).needsYou).toBe(['matching', 'structured notice'].includes(kind) ? null : notice);

            if (kind === 'mismatched manifest')
                expect(records.read(id).needsYouReleaseStep).toBe('approve-joint-activation');

            if (['matching', 'structured notice'].includes(kind)) expect(recovered.run?.threadId).toBe('owner');
        } finally {
            records.close();
            rmSync(dir, { recursive: true, force: true });
        }
    },
);
