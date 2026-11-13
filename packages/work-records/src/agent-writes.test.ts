import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { agentWrites } from './agent-writes.ts';
import { openDatabase } from './database.ts';
import { MIGRATIONS } from './migrations.ts';
import { openWorkRecords, type WorkRecords } from './work-records.ts';

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
    const record = records.setBody(made.workId, withPr.revision, 'brief', 'Approved scope');
    const other = await open(path);

    return { path, records, other, record, agent: agentWrites(records) };
};

afterEach(() => {
    vi.restoreAllMocks();
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it.each([
    ['title', (a, id, r) => a.retitle(id, r, 'A clearer title')],
    ['phase', (a, id, r) => a.setBuildPhase(id, r, 'checks')],
    ['Status', (a, id, r) => a.update(id, r, { status: 'Review' })],
    ['Needs you', (a, id, r) => a.setNeedsYou(id, r, 'Verify this head')],
    ['clear Needs you', (a, id, r) => a.clearNeedsYou(id, r)],
    ['wait for user', (a, id, r) => a.waitForUser(id, r, 'Approve this brief')],
    ['resume from user', (a, id, r) => a.resumeFromUser(id, r, 'Shaping')],
    ['brief note', (a, id, r) => a.setBody(id, r, 'brief', 'Scope with a note')],
    ['skills', (a, id, r) => a.snapshotSkills(id, r, [])],
    ['branch', (a, id, r) => a.setBuildBranch(id, r, 'build/example')],
    ['thread', (a, id, r) => a.addThread(id, r, 'builder', 'build')],
    ['launch intent', (a, id, r) => a.recordLaunchIntent(id, r, 'build')],
    ['gate invalidation', (a, id, r) => a.invalidateGate(id, r)],
    ['build reset', (a, id, r) => a.resetBuild(id, r)],
    ['set aside', (a, id, r) => a.setAside(id, r)],
    [
        'gate',
        (a, id, r) =>
            a.recordGate(id, r, {
                briefDigest: a.gate(id).briefDigest!,
                approvedBy: 'Pedro',
                evidence: 'Approved this digest',
            }),
    ],
    [
        'review round',
        (a, id, r) =>
            a.recordReviewRound(id, r, {
                base: 'abcdef1',
                reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }],
            }),
    ],
] satisfies [string, (a: WorkRecords, id: string, revision: number) => unknown][])(
    'reapplies %s after the board observes an open PR',
    async (_, write) => {
        const { records, other, record, agent } = await fixture();

        other.observe(record.workId, record.revision, { of: 'pr', state: 'open' });
        expect(() => write(agent, record.workId, record.revision)).not.toThrow();
        expect(records.observations(record.workId)[0]).toMatchObject({ state: 'open', subject: 'test/repo#2' });
    },
);

it.each(['status', 'needsYou'] as const)(
    'wait/resume reject concurrent %s changes without partial writes',
    async (field) => {
        for (const resume of [false, true]) {
            const { records, other, record, agent } = await fixture();
            const waiting = records.waitForUser(record.workId, record.revision, 'Approve this brief');
            const changed =
                field === 'status'
                    ? other.update(record.workId, waiting.revision, { status: 'Review' })
                    : other.setNeedsYou(record.workId, waiting.revision, 'Answer a different question');

            expect(() =>
                resume
                    ? agent.resumeFromUser(record.workId, waiting.revision, 'Shaping')
                    : agent.waitForUser(record.workId, waiting.revision, 'Approve this brief'),
            ).toThrow(new RegExp(`conflicting fields: ${field}`));
            expect(records.read(record.workId)).toEqual(changed);
        }
    },
);

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
        revision: moved.revision + 1,
    });
});

it('detects a field changed and restored, even across reopen', async () => {
    const { path, other, record } = await fixture();
    const changed = other.setBody(record.workId, record.revision, 'brief', 'New scope');

    other.setBody(record.workId, changed.revision, 'brief', 'Approved scope');

    const reopened = agentWrites(await open(path));

    expect(() => reopened.setBody(record.workId, record.revision, 'brief', 'Old author note')).toThrow(/body.brief/);
    expect(reopened.body(record.workId, 'brief')).toBe('Approved scope');
});

it.each([false, true])('rechecks after a writer races the guard; conflict=%s', async (conflicting) => {
    const { records, other, record, agent } = await fixture();
    const strict = records.setBuildPhase.bind(records);

    vi.spyOn(records, 'setBuildPhase').mockImplementationOnce((id, revision, phase) => {
        if (conflicting) other.setBuildPhase(id, revision, 'review');
        else other.setNeedsYou(id, revision, 'Keep this concurrent note');

        return strict(id, revision, phase);
    });

    if (conflicting) {
        expect(() => agent.setBuildPhase(record.workId, record.revision, 'checks')).toThrow(/buildPhase/);
        expect(records.read(record.workId).buildPhase).toBe('review');
    } else {
        expect(agent.setBuildPhase(record.workId, record.revision, 'checks')).toMatchObject({
            buildPhase: 'checks',
            needsYou: 'Keep this concurrent note',
        });
    }
});

it('rechecks structural invariants and keeps relationship changes atomic', async () => {
    const { records, other, record, agent } = await fixture();
    const parent = records.create({ title: 'Concept', repository: 'test/repo', kind: 'concept' });

    other.observe(record.workId, record.revision, { of: 'pr', state: 'open' });
    agent.setParent(record.workId, record.revision, parent.workId);

    const parentRead = records.read(parent.workId);

    other.setNeedsYou(parent.workId, parentRead.revision, 'A note');

    const part = agent.createPart({
        parentId: parent.workId,
        parentRevision: parentRead.revision,
        title: 'Part',
        repository: 'test/repo',
        kind: 'build',
        body: 'Scope',
        blockerIds: [],
    });

    expect(records.children(parent.workId).map((child) => child.workId)).toEqual([record.workId, part.workId]);
    expect(records.read(parent.workId).needsYou).toBe('A note');
    expect(() =>
        agent.createPart({
            parentId: parent.workId,
            parentRevision: parentRead.revision,
            title: 'Duplicate attempt',
            repository: 'test/repo',
            kind: 'build',
            body: 'Scope',
            blockerIds: [],
        }),
    ).toThrow(/children/);
    expect(records.children(parent.workId)).toHaveLength(2);
});

it('merges Dependency edits with observations but refuses a changed contract', async () => {
    const { records, other, record, agent } = await fixture();
    const dependency = records.addDependency(record.workId, {
        need: 'An API',
        owner: 'test/other',
        ticket: 'test/other#1',
    });

    other.observeDependency(dependency.dependencyId, dependency.revision, { subject: 'test/other#1', kind: 'open' });

    const saved = agent.updateDependency(dependency.dependencyId, dependency.revision, { contract: 'The exact API' });

    expect(saved.observations).toHaveLength(1);
    expect(() =>
        agent.updateDependency(dependency.dependencyId, dependency.revision, { contract: 'Old contract' }),
    ).toThrow(/contract/);
    expect(agent.updateDependency(dependency.dependencyId, saved.revision, { evidence: 'A check' }).contract).toBe(
        'The exact API',
    );
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
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, -1) });

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

it('keeps concurrent role evidence and refuses finishing an execution that changed', async () => {
    const { records, other, record, agent } = await fixture();
    const snapshot = {
        runId: 'build-1',
        kind: 'build' as const,
        skills: [],
        packaged: {
            version: 'test',
            reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
    };

    other.observe(record.workId, record.revision, { of: 'pr', state: 'open' });
    agent.snapshotRun(record.workId, record.revision, snapshot);

    const revision = records.read(record.workId).revision;

    agent.startRoleRun(record.workId, revision, {
        runId: snapshot.runId,
        executionId: 'code-1',
        role: 'reviewer:code',
    });
    agent.startRoleRun(record.workId, revision, {
        runId: snapshot.runId,
        executionId: 'security-1',
        role: 'reviewer:security',
    });
    expect(records.runSettings(record.workId).roleRuns).toHaveLength(2);

    const beforeFinish = records.read(record.workId).revision;

    other.setNeedsYou(record.workId, beforeFinish, 'Keep this note');
    agent.finishRoleRun(record.workId, beforeFinish, { executionId: 'code-1', report: null, result: 'completed' });
    expect(records.read(record.workId).needsYou).toBe('Keep this note');
    expect(() =>
        agent.finishRoleRun(record.workId, beforeFinish, {
            executionId: 'code-1',
            report: null,
            result: 'failed',
            failure: 'Old result',
        }),
    ).toThrow(/roleRuns.code-1/);
});

it('requires a fresh decision when delivery or the approved brief changed', async () => {
    const { records, other, record, agent } = await fixture();
    const digest = records.gate(record.workId).briefDigest!;

    other.setBody(record.workId, record.revision, 'brief', 'Unapproved scope');
    expect(() =>
        agent.recordGate(record.workId, record.revision, {
            briefDigest: digest,
            approvedBy: 'Pedro',
            evidence: 'Old approval',
        }),
    ).toThrow(/body.brief/);

    const beforeMerge = records.read(record.workId);

    other.observe(record.workId, beforeMerge.revision, { of: 'pr', state: 'merged' });
    expect(() => agent.setBuildPhase(record.workId, beforeMerge.revision, 'checks')).toThrow(/finishedAt/);
    expect(records.read(record.workId).buildPhase).toBeNull();
});
