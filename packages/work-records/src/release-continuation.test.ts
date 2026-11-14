import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

test('release receipt atomically queues its owner, survives reopen and ignores unrelated revisions', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'release-resume-'));
    const path = join(dir, 'work.db');
    let records = await openWorkRecords(path);

    try {
        const id = records.create({ title: 'Group', repository: 'fake/app', kind: 'concept' }).workId;
        const at = () => records.read(id).revision;

        records.addThread(id, at(), 'release-owner', 'shape');

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
        records.setReleasePlan(id, at(), {
            steps: [
                { id: 'approve', who: 'Pedro', what: 'Approve activation of manifest' },
                { id: 'activate', who: 'Agent', what: 'Activate approved manifest' },
            ],
            outcomeCheck: 'Check actual composition',
        });
        expect(records.prepareReleaseContinuation(id).run).toBeNull();
        records.observe(part.workId, records.read(part.workId).revision, { of: 'pr', state: 'merged' });
        expect(records.prepareReleaseContinuation(id).run).toBeNull();
        records.completeReleaseStep(id, at(), 'approve', 'Pedro', 'Manifest SHA256 approved, exact merged SHAs.');

        const first = records.releaseContinuation(id).run!;

        expect(first).toMatchObject({ threadId: 'release-owner', sent: false });
        records.releaseContinuationDelivered(id, first.commandId, 'unconfirmed', 'Lost response');
        records.close();
        records = await openWorkRecords(path);
        expect(records.prepareReleaseContinuation(id).run).toMatchObject({
            commandId: first.commandId,
            messageId: first.messageId,
            error: 'Lost response',
        });
        records.retitle(id, at(), 'Group renamed');
        expect(records.prepareReleaseContinuation(id).run?.commandId).toBe(first.commandId);
        records.releaseContinuationDelivered(id, first.commandId, 'accepted');
        expect(records.prepareReleaseContinuation(id).run?.sent).toBe(true);
        records.setReleasePlan(id, at(), {
            steps: [{ id: 'activate', who: 'Agent', what: 'Activate changed manifest' }],
            outcomeCheck: 'Changed composition',
        });

        const next = records.prepareReleaseContinuation(id).run!;

        expect(next.commandId).not.toBe(first.commandId);
        records.releaseContinuationDelivered(id, first.commandId, 'accepted');
        expect(records.releaseContinuation(id).run?.sent).toBe(false);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
