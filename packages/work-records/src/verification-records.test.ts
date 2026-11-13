import { verificationPassed } from '@lar-factory/shared';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

const opened: { dir: string; records: WorkRecords }[] = [];

afterEach(() => {
    for (const { dir, records } of opened.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

const head = 'a'.repeat(40);
const next = 'b'.repeat(40);

async function setup() {
    const dir = mkdtempSync(join(tmpdir(), 'verify-'));
    const records = await openWorkRecords(join(dir, 'work.db'));

    opened.push({ dir, records });

    let record = records.create({ title: 'Build', repository: 'owner/repo', kind: 'bug', status: 'Verify' });

    record = records.setPullRequest(record.workId, record.revision, 'owner/repo#8');
    record = records.addThread(record.workId, record.revision, 'same-build', 'build');
    records.observeVerificationHead(record.workId, record.pullRequest!, head);

    const input = {
        pr: record.pullRequest!,
        head,
        result: 'pass' as 'pass' | 'fail',
        by: 'Pedro',
        note: null as string | null,
        testSteps: '1. Press the button.',
    };
    const save = () => records.recordVerification(record.workId, records.read(record.workId).revision, input);

    return { records, id: record.workId, input, save, dir };
}

test('a pass records the exact head, operator, time and Test steps and survives reopen', async () => {
    const s = await setup();
    const state = s.save();

    expect(state.latest).toMatchObject({ head, result: 'pass', by: 'Pedro', testSteps: s.input.testSteps });
    expect(Date.parse(state.latest!.at)).not.toBeNaN();
    expect(verificationPassed(state, head)).toBe(true);
    expect(s.records.read(s.id).status).toBe('Ready to merge');

    const reopened = await openWorkRecords(join(s.dir, 'work.db'));

    expect(reopened.verification(s.id)).toEqual(state);
    reopened.close();
});
test('a new head invalidates the pass and returns Verify, while merged work stays closed', async () => {
    const s = await setup();

    s.save();
    s.records.observeVerificationHead(s.id, s.input.pr, next);
    expect(verificationPassed(s.records.verification(s.id), next)).toBe(false);
    expect(s.records.read(s.id).status).toBe('Verify');
    expect(() => s.records.update(s.id, s.records.read(s.id).revision, { status: 'Ready to merge' })).toThrow(
        'Pass Verify',
    );
    expect(() => s.save()).toThrow('head changed');
    s.records.recordFinished(s.id, s.records.read(s.id).revision);
    s.records.observeVerificationHead(s.id, s.input.pr, 'c'.repeat(40));
    expect(s.records.verification(s.id).head).toBe(next);
});
test('failure needs a note and returns to the same build and PR with a durable retry message', async () => {
    const s = await setup();

    s.input.result = 'fail';
    expect(() => s.save()).toThrow('nonempty Verify');
    s.input.note = 'The greeting is clipped on mobile.';

    const state = s.save();

    expect(s.records.read(s.id)).toMatchObject({
        status: 'In progress',
        buildPhase: 'implement',
        pullRequest: s.input.pr,
    });
    expect(s.records.threads(s.id)).toHaveLength(1);
    expect(s.records.list({})).toHaveLength(1);
    expect(state.latest?.note).toBe(s.input.note);
    expect(state.resume).toMatchObject({ threadId: 'same-build', sent: false });
    s.records.verificationResume(s.id, state.resume!.commandId, 'unconfirmed', 'Offline');
    expect(s.records.verification(s.id).resume).toMatchObject({
        commandId: state.resume!.commandId,
        error: 'Offline',
        sent: false,
    });
    s.records.verificationResume(s.id, state.resume!.commandId, 'accepted');
    expect(s.records.verification(s.id).resume?.sent).toBe(true);
    s.records.update(s.id, s.records.read(s.id).revision, { status: 'Verify' });
    s.records.observeVerificationHead(s.id, s.input.pr, next);
    s.input.head = next;
    s.input.result = 'pass';
    expect(verificationPassed(s.save(), next)).toBe(true);
});
test('stale revisions, replaced PRs, empty steps and invalid SHA never create a pass', async () => {
    const s = await setup();

    expect(() => s.records.recordVerification(s.id, 1, s.input)).toThrow('changed');
    s.input.head = 'short';
    expect(() => s.save()).toThrow('full PR head');
    s.input.head = head;
    s.input.testSteps = '';
    expect(() => s.save()).toThrow('nonempty Verify');
    s.input.testSteps = 'Test it.';
    s.save();
    s.records.setPullRequest(s.id, s.records.read(s.id).revision, 'owner/repo#9');
    expect(s.records.read(s.id).status).toBe('Verify');
    expect(s.records.verification(s.id).latest).toBeNull();
});

test('a reverted head does not resurrect a pass invalidated by a push', async () => {
    const s = await setup();

    s.save();
    s.records.observeVerificationHead(s.id, s.input.pr, next);
    s.records.observeVerificationHead(s.id, s.input.pr, head);
    expect(verificationPassed(s.records.verification(s.id), head)).toBe(false);
    expect(() => s.records.update(s.id, s.records.read(s.id).revision, { status: 'Ready to merge' })).toThrow(
        'Pass Verify',
    );
    expect(verificationPassed(s.save(), head)).toBe(true);
});

test('a failure can request missing PR Test steps while a pass still requires them', async () => {
    const s = await setup();

    s.input.testSteps = '';
    expect(() => s.save()).toThrow('nonempty Verify');
    s.input.result = 'fail';
    s.input.note = 'Add Test steps to the PR.';
    expect(s.save().latest).toMatchObject({ result: 'fail', testSteps: '', note: s.input.note });
});

test.each([30, 31, 32, 33])(
    'schema %s upgrades after the concept migrations and marks existing Verify records as required',
    async (version) => {
        const dir = mkdtempSync(join(tmpdir(), 'verify-upgrade-'));
        const path = join(dir, 'work.db');
        // Keep the pre-Verify boundaries fixed, including schema 33 with durable decision methods.
        const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, version) });

        old.db.exec(`INSERT INTO work_records
        (work_id, repository, kind, status, revision, created_at, updated_at, title, superseded_by)
        VALUES ('existing-verify', 'owner/repo', 'build', 'Verify', 1, '2026-11-13', '2026-11-13', 'Existing build', 'kept');
        INSERT INTO set_aside_changes(work_id, content) VALUES ('existing-verify', 'kept concept change');`);
        old.close();

        const records = await openWorkRecords(path);

        opened.push({ dir, records });
        expect(records.verification('existing-verify')).toMatchObject({ required: true, latest: null });

        const db = await openDatabase(path);

        try {
            expect(db.db.prepare('SELECT superseded_by FROM work_records').get()).toEqual({ superseded_by: 'kept' });
            expect(db.db.prepare('SELECT content FROM set_aside_changes').get()).toEqual({
                content: 'kept concept change',
            });
        } finally {
            db.close();
        }

        const later = records.create({ title: 'Later', repository: 'owner/repo', kind: 'build', status: 'Verify' });

        expect(records.verification(later.workId).required).toBe(true);
    },
);

test('Verify history retains failures and passes through pushes, PR replacement and reopen', async () => {
    const s = await setup();

    s.input.result = 'fail';
    s.input.note = 'Clipped greeting';

    const failed = s.save().latest!;

    s.records.update(s.id, s.records.read(s.id).revision, { status: 'Verify' });
    s.records.observeVerificationHead(s.id, s.input.pr, next);
    s.input.head = next;
    s.input.result = 'pass';

    const passed = s.save().latest!;

    expect(s.records.verification(s.id).history).toEqual([passed, failed]);
    s.records.setPullRequest(s.id, s.records.read(s.id).revision, 'owner/repo#9');
    expect(s.records.verification(s.id).latest).toBeNull();

    const reopened = await openWorkRecords(join(s.dir, 'work.db'));

    try {
        expect(reopened.verification(s.id).history).toEqual([passed, failed]);
    } finally {
        reopened.close();
    }
});

test('schema 38 preserves the pre-upgrade latest result in history', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-history-upgrade-'));
    const path = join(dir, 'work.db');
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 38) });
    const result = {
        id: 'legacy-pass',
        pr: 'owner/repo#8',
        head,
        result: 'pass',
        by: 'Pedro',
        at: '2026-11-13T12:00:00Z',
        note: null,
        testSteps: 'Test it.',
    };

    old.db.exec(
        "INSERT INTO work_records(work_id,repository,kind,status,revision,created_at,updated_at,title) VALUES('legacy','owner/repo','build','Verify',1,'2026-11-13','2026-11-13','Legacy')",
    );
    old.db.prepare('UPDATE verification SET latest=? WHERE work_id=?').run(JSON.stringify(result), 'legacy');
    old.close();

    const records = await openWorkRecords(path);

    opened.push({ dir, records });
    expect(records.verification('legacy')).toMatchObject({ latest: result, history: [result] });
});
