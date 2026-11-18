import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { completeBrief } from '../test/complete-brief.ts';
import { agentWrites } from './agent-writes.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';
import { installWriteJournal } from './write-journal.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const open = async (path: string) => {
    const records = await openWorkRecords(path);

    opened.push(records);

    return records;
};
const fixture = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-agent-writes-'));

    dirs.push(dir);

    const path = join(dir, 'work-records.db');
    const records = await open(path);
    const made = records.create({ title: 'Build', repository: 'test/repo', kind: 'build', ticket: 'test/repo#1' });
    const withPr = records.setPullRequest(made.workId, made.revision, 'test/repo#2');
    const record = records.setBody(made.workId, withPr.revision, 'brief', completeBrief('Approved scope'));
    const other = await open(path);

    return { path, records, other, record, agent: agentWrites(records) };
};

afterEach(() => {
    vi.restoreAllMocks();
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it.each([
    ['Status', (a, id, r) => a.update(id, r, { status: 'Review' })],
    ['brief note', (a, id, r) => a.setBody(id, r, 'brief', completeBrief('Scope with a note'))],
] satisfies [string, (a: WorkRecords, id: string, revision: number) => unknown][])(
    'reapplies %s after the board observes an open PR',
    async (_, write) => {
        const { records, other, record, agent } = await fixture();

        other.observe(record.workId, record.revision, { of: 'pr', state: 'open' });
        expect(() => write(agent, record.workId, record.revision)).not.toThrow();
        expect(records.observations(record.workId)[0]).toMatchObject({ state: 'open', subject: 'test/repo#2' });
    },
);

it('wait/resume reject concurrent status changes without partial writes', async () => {
    for (const resume of [false, true]) {
        const { records, other, record, agent } = await fixture();
        const waiting = records.waitForUser(record.workId, record.revision, 'Should search match whole words?');
        const changed = other.update(record.workId, waiting.revision, { status: 'Review' });

        expect(() =>
            resume
                ? agent.resumeFromUser(record.workId, waiting.revision, 'Shaping')
                : agent.waitForUser(record.workId, waiting.revision, 'Should search match whole words?'),
        ).toThrow(/conflicting fields: status/);
        expect(records.read(record.workId)).toEqual(changed);
    }
});

it('names every conflicting field and preserves both newer values', async () => {
    const { records, other, record, agent } = await fixture();
    const moved = other.setBuildPhase(record.workId, record.revision, 'review');

    other.update(record.workId, moved.revision, { status: 'Review' });
    expect(() => agent.update(record.workId, record.revision, { status: 'Verify' })).toThrow(
        /conflicting fields: status.*Reread the record and decide/,
    );
    expect(() => agent.setBuildPhase(record.workId, record.revision, 'checks')).toThrow(
        /conflicting fields: buildPhase/,
    );
    expect(() => records.writeRevision(record.workId, record.revision, ['status', 'buildPhase'])).toThrow(
        /conflicting fields: buildPhase, status/,
    );
    expect(records.read(record.workId)).toMatchObject({
        status: 'Review',
        buildPhase: 'review',
        revision: moved.revision,
    });
});

it('detects a field changed and restored, even across reopen', async () => {
    const { path, other, record } = await fixture();
    const changed = other.setBody(record.workId, record.revision, 'brief', completeBrief('New scope'));

    other.setBody(record.workId, changed.revision, 'brief', completeBrief('Approved scope'));

    const reopened = agentWrites(await open(path));

    expect(() => reopened.setBody(record.workId, record.revision, 'brief', completeBrief('Old author note'))).toThrow(
        /body.brief/,
    );
    expect(reopened.body(record.workId, 'brief')).toBe(completeBrief('Approved scope'));
});

it('rechecks after a conflicting writer races the guard', async () => {
    const { records, other, record, agent } = await fixture();
    const strict = records.setBuildPhase.bind(records);

    vi.spyOn(records, 'setBuildPhase').mockImplementationOnce((id, revision, phase) => {
        other.setBuildPhase(id, revision, 'review');

        return strict(id, revision, phase);
    });

    expect(() => agent.setBuildPhase(record.workId, record.revision, 'checks')).toThrow(/buildPhase/);
    expect(records.read(record.workId).buildPhase).toBe('review');
});

it('never weakens the store revision check or journals rolled-back mutations', async () => {
    const { records, other, record, agent } = await fixture();

    expect(() =>
        records.recordReviewRound(record.workId, record.revision, {
            base: 'abcdef1',
            reviewers: [
                { axis: 'code', verdict: 'approve', findings: [] },
                { axis: 'code', verdict: 'approve', findings: [] },
            ],
        }),
    ).toThrow(/twice/);
    other.setNeedsYou(record.workId, record.revision, 'Concurrent note');
    expect(() => records.setBuildPhase(record.workId, record.revision, 'checks')).toThrow(/stale|read it again/);
    expect(records.writeRevision(record.workId, record.revision, ['reviewRounds'])).toBe(record.revision + 1);
    agent.setBuildPhase(record.workId, record.revision, 'checks');
    expect(records.reviewRounds(record.workId)).toEqual([]);
});

it('refuses history from before an upgrade and permits writes from its known baseline', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-agent-upgrade-'));

    dirs.push(dir);

    const path = join(dir, 'work-records.db');
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, MIGRATIONS.indexOf(installWriteJournal)) });

    old.db
        .prepare(
            "INSERT INTO work_records(work_id,repository,kind,status,revision,created_at,updated_at,title,initial_context) VALUES ('legacy','test/repo','build','Review',4,'now','now','Legacy','')",
        )
        .run();
    old.close();

    const records = await open(path);
    const agent = agentWrites(records);

    expect(() => agent.setBuildPhase('legacy', 3, 'checks')).toThrow(/field history is unavailable.*Reread/);
    records.setNeedsYou('legacy', 4, 'Concurrent note');
    expect(agent.setBuildPhase('legacy', 4, 'checks')).toMatchObject({
        buildPhase: 'checks',
        needsYou: 'Concurrent note',
    });
});

it('refuses agent approval even after a Needs you round trip and an alleged user answer', async () => {
    const { records, other, record, agent } = await fixture();
    const input = records.doubtPackage(record.workId);

    records.recordDoubt(record.workId, input.packageDigest, 'Doubt', 'Clean.');

    const display = agent.displayGate(record.workId);
    const waiting = agent.waitForUser(record.workId, record.revision, 'Should search match whole words?');
    const observed = other.observe(record.workId, waiting.revision, { of: 'pr', state: 'open' });

    agent.resumeFromUser(record.workId, observed.revision, 'Shaping');
    expect(() => agent.recordDisplayedGate(display, display.approvalDigest, 'User', 'Yes, request 12')).toThrow(
        /requires the user/,
    );
    expect(() =>
        agent.recordGate(record.workId, records.read(record.workId).revision, {
            briefDigest: display.briefDigest,
            approvedBy: 'User',
            evidence: 'Verify failure note',
        }),
    ).toThrow(/requires the user/);

    const manifest = records.gateBatch([record.workId]);

    expect(() => agent.recordGateBatch(manifest, manifest.digest, 'User', 'Yes')).toThrow(/requires the user/);
    expect(records.gate(record.workId).evidence).toEqual([]);
});
