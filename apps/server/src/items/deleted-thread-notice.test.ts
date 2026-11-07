import type { NeedsYouCause } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect } from 'vite-plus/test';

import { deletedThreadNotice } from './deleted-thread-notice.ts';
import { recordItems } from './record-items.ts';

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

        expect(deletedThreadNotice(records, item)).toMatchObject({
            deletedThread: true,
            startAgainPurpose: 'shape',
            offers: ['start-again', 'back-to-queue', 'back-to-list'],
        });
        expect(deletedThreadNotice(records, { ...item, threads: 'unavailable' })).toBeUndefined();
        expect(
            deletedThreadNotice(records, { ...item, threads: [{ id: 'live', state: 'running' } as never] }),
        ).toBeUndefined();
        records.addThread(record.workId, record.revision, 'new', 'shape');
        expect(deletedThreadNotice(records, item)).toBeUndefined();
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a shaping thread cleanup deleted after the build thread was recorded raises no notice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deleted-notice-'));
    const records = await openWorkRecords(join(dir, 'records.db'));

    try {
        const { workId } = records.create({
            title: 'Work',
            repository: 'owner/repo',
            kind: 'build',
            status: 'In progress',
        });

        records.addThread(workId, records.read(workId).revision, 'shape', 'shape');

        const { intent } = records.recordLaunchIntent(
            workId,
            records.read(workId).revision,
            'build',
            undefined,
            'delete',
        );

        records.resolveLaunchIntent(workId, records.read(workId).revision, intent.intentId, { threadId: 'build' });
        records.markShapingThreadDeleted('shape');

        const item = { ...recordItems(records, [], ['owner/repo'])[0]!, threads: [] };

        expect(deletedThreadNotice(records, item)).toBeUndefined();
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

/** A Review build on owner/repo#1 whose latest thread T3 confirms deleted, with PR #2 reading `pr`. */
async function deletedBuild(dir: string, name: string, pr: 'open' | 'closed' | null, causes: NeedsYouCause[]) {
    const records = await openWorkRecords(join(dir, name));
    const made = records.importTicket({
        title: 'Work',
        repository: 'owner/repo',
        kind: 'build',
        status: 'Review',
        ticket: 'owner/repo#1',
    }).record;
    let record = records.addThread(made.workId, made.revision, 'old', 'build');

    record = records.confirmThreadDeleted(record.workId, record.revision, 'old');

    if (pr) {
        record = records.setPullRequest(record.workId, record.revision, 'owner/repo#2');
        record = records.observe(record.workId, record.revision, { of: 'pr', state: pr });
    }

    record = records.observe(record.workId, record.revision, {
        of: 'ticket',
        state: causes.some((c) => c.type === 'ticket-closed') ? 'closed' : 'open',
    });
    records.setNeedsYouCauses(record.workId, record.revision, causes);

    return {
        records,
        notice: deletedThreadNotice(records, { ...recordItems(records, [], ['owner/repo'])[0]!, threads: [] }),
    };
}

test('a thread deleted on a closed ticket names both causes and adds Abandon to its offers', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deleted-notice-'));
    const { records, notice } = await deletedBuild(dir, 'records.db', null, [{ type: 'ticket-closed' }]);

    try {
        expect(notice).toEqual({
            reason: 'The latest work thread was deleted. Its ticket owner/repo#1 closed in its provider.',
            deletedThread: true,
            startAgainPurpose: 'build',
            causes: [{ type: 'ticket-closed' }],
            ticketOpen: false,
            offers: ['start-again', 'back-to-queue', 'back-to-list', 'set-aside'],
        });
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a thread deleted on work with free text keeps saying the notice has another note', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deleted-note-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        let record = records.create({ title: 'Noted', repository: 'owner/repo', kind: 'build', status: 'In progress' });

        record = records.addThread(record.workId, record.revision, 'gone', 'build');
        record = records.confirmThreadDeleted(record.workId, record.revision, 'gone');
        records.setNeedsYou(record.workId, record.revision, 'Merge conflict.');

        const item = recordItems(records, [], ['owner/repo'])[0]!;

        expect(deletedThreadNotice(records, { ...item, threads: [] })).toMatchObject({
            deletedThread: true,
            hasOtherNote: true,
        });
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a thread deleted with an open PR offers Start again, plus Abandon on a closed ticket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deleted-notice-'));
    const open = await deletedBuild(dir, 'open.db', 'open', []);

    open.records.close();

    const closed = await deletedBuild(dir, 'closed.db', 'open', [{ type: 'ticket-closed' }]);

    try {
        expect(open.notice).toMatchObject({ offers: ['start-again'], ticketOpen: true });
        expect(closed.notice).toMatchObject({ offers: ['start-again', 'set-aside'] });
    } finally {
        closed.records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a closed PR keeps its PR notice when the thread is deleted, and a stale one does not', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'deleted-notice-'));
    const closed = await deletedBuild(dir, 'closed.db', 'closed', [{ type: 'pr-closed' }]);

    closed.records.close();

    const stale = await deletedBuild(dir, 'stale.db', 'closed', []);

    try {
        expect(closed.notice).toMatchObject({
            reason: 'Its PR owner/repo#2 closed without merging.',
            offers: ['reopen-pr', 'replace-pr', 'set-aside'],
        });
        expect(closed.notice).not.toHaveProperty('deletedThread');
        expect(stale.notice).toMatchObject({
            deletedThread: true,
            offers: ['start-again', 'back-to-queue', 'back-to-list'],
        });
    } finally {
        stale.records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
