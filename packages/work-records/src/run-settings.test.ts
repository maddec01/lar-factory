import {
    defaultFactorySettings,
    FACTORY_ROLES,
    THREAD_KINDS,
    type FactorySettings,
} from '@lar-factory/shared/factory-settings';
import type { RoleRunFinish, SnapshotRunInput } from '@lar-factory/shared/run-settings';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { writeFactorySettings } from './factory-settings.ts';
import { MIGRATIONS } from './migrations.ts';
import { selectReviewers } from './reviewer-selection.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const dirs: string[] = [];
const opened: WorkRecords[] = [];
const input = (runId = 'run-1', kind: SnapshotRunInput['kind'] = 'build'): SnapshotRunInput => ({
    runId,
    kind,
    projectDefault: {
        instanceId: 'codex-main',
        model: 'test-model',
        options: [
            { id: 'reasoningEffort', value: 'high' },
            { id: 'fastMode', value: true },
        ],
    },
    packaged: {
        version: 'v1-test',
        reviewers: {
            code: 'Review code.',
            security: 'Review security.',
            ui: 'Review UI.',
            performance: 'Review performance.',
        },
    },
    skills: ['test-skill'],
});
const open = async (path: string) => {
    const records = await openWorkRecords(path);

    opened.push(records);

    return records;
};
const fixture = async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-run-settings-'));

    dirs.push(dir);

    const records = await open(workRecordsPath(dir));
    const { workId } = records.create({ title: 'Snapshot fixture', repository: 'test/repo', kind: 'build' });

    return { dir, records, workId, revision: () => records.read(workId).revision };
};
const customSettings = (): FactorySettings => {
    const settings = defaultFactorySettings();

    settings.reviewers.push({
        id: 'custom',
        name: 'Custom',
        mode: { kind: 'always' },
        instructions: { kind: 'revision', revision: 1 },
        revisions: [{ revision: 1, text: 'Check the domain.' }],
    });
    settings.reviewers.find((reviewer) => reviewer.id === 'ui')!.mode = { kind: 'never' };
    settings.roles['reviewer:custom'] = { effort: 'low' };
    settings.roles.doubt = { model: { instanceId: 'other-instance', model: 'other-model' }, effort: 'medium' };

    return settings;
};

afterEach(() => {
    for (const records of opened.splice(0)) records.close();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it.each(THREAD_KINDS)('captures %s with every role, all modes and exact instruction provenance', async (kind) => {
    const { dir, records, workId } = await fixture();

    writeFactorySettings(customSettings(), dir);

    const snapshot = records.snapshotRun(workId, 1, input('run-1', kind));

    expect(snapshot.thread).toEqual({
        model: { instanceId: 'codex-main', model: 'test-model' },
        effort: 'high',
        options: [{ id: 'fastMode', value: true }],
    });
    for (const role of FACTORY_ROLES) expect(snapshot.roles[role]).toBeDefined();
    expect(snapshot.roles.doubt).toEqual({
        model: { instanceId: 'other-instance', model: 'other-model' },
        effort: 'medium',
        options: [],
    });
    expect(snapshot.roles['reviewer:custom']!.effort).toBe('low');
    expect(snapshot.reviewers.find((reviewer) => reviewer.id === 'ui')?.mode).toEqual({ kind: 'never' });
    expect(snapshot.reviewers.find((reviewer) => reviewer.id === 'code')?.instructions).toMatchObject({
        source: { kind: 'packaged', version: 'v1-test', path: 'skills/lar-build/agents/reviewer-code.md' },
        text: 'Review code.',
    });
    expect(snapshot.reviewers.find((reviewer) => reviewer.id === 'custom')?.instructions).toEqual({
        source: { kind: 'custom', revision: 1 },
        text: 'Check the domain.',
        digest: createHash('sha256').update('Check the domain.').digest('hex'),
    });
    expect(snapshot.skills).toEqual(['test-skill']);
    expect(snapshot.settingsDigest).toMatch(/^[a-f0-9]{64}$/);
});

it('captures only once; later edits, retry, handoff and reopening keep the snapshot, while the next run sees edits', async () => {
    const { dir, records, workId, revision } = await fixture();
    const settings = customSettings();

    writeFactorySettings(settings, dir);

    const snapshot = records.snapshotRun(workId, revision(), input());

    settings.threadKinds.build = { effort: 'low' };

    const custom = settings.reviewers.find((reviewer) => reviewer.id === 'custom')!;

    custom.revisions!.push({ revision: 2, text: 'New instructions.' });
    custom.instructions = { kind: 'revision', revision: 2 };
    writeFactorySettings(settings, dir);

    const changed = input();

    changed.packaged.version = 'v2';
    changed.packaged.reviewers.code = 'New package.';

    const before = revision();

    expect(records.snapshotRun(workId, before, changed)).toEqual(snapshot);
    expect(revision()).toBe(before);
    records.addThread(workId, revision(), 'first-thread', 'build');
    records.addThread(workId, revision(), 'handoff-thread', 'build');
    records.startRoleRun(workId, revision(), {
        runId: snapshot.runId,
        executionId: 'attempt-1',
        role: 'implementer',
        threadId: 'first-thread',
    });
    records.startRoleRun(workId, revision(), {
        runId: snapshot.runId,
        executionId: 'attempt-2',
        role: 'implementer',
        threadId: 'handoff-thread',
    });

    const reopened = await open(workRecordsPath(dir));
    const history = reopened.runSettings(workId);

    expect(history.runs).toEqual([snapshot]);
    expect(history.roleRuns.map((run) => run.requested)).toEqual([
        snapshot.roles.implementer,
        snapshot.roles.implementer,
    ]);
    history.runs[0]!.roles.implementer.effort = 'mutated read';
    expect(reopened.runSettings(workId).runs).toEqual([snapshot]);

    const next = records.snapshotRun(workId, revision(), { ...changed, runId: 'run-2' });

    expect(next.thread.effort).toBe('low');
    expect(next.reviewers.find((reviewer) => reviewer.id === 'custom')?.instructions.source).toEqual({
        kind: 'custom',
        revision: 2,
    });
    expect(next.reviewers.find((reviewer) => reviewer.id === 'code')?.instructions.text).toBe('New package.');
    writeFileSync(join(dir, 'factory-settings.json'), '{broken');
    writeFileSync(join(dir, 'factory-settings.last-good.json'), '{broken');
    expect(records.snapshotRun(workId, revision(), input())).toEqual(snapshot);
    expect(records.runSettings(workId, 'run-1').runs).toEqual([snapshot]);
});

it('keeps requested settings separate from mismatching T3 evidence and refuses rewriting completed attempts', async () => {
    const { dir, records, workId, revision } = await fixture();
    const snapshot = records.snapshotRun(workId, revision(), input());
    const request = { runId: snapshot.runId, executionId: 'attempt', role: 'implementer' as const, taskId: 'task-1' };
    const started = records.startRoleRun(workId, revision(), request);

    expect(started.actual).toBeNull();
    expect(started.requested).toEqual(snapshot.roles.implementer);

    const rev = revision();

    expect(records.startRoleRun(workId, rev, request)).toEqual(started);
    expect(revision()).toBe(rev);

    const finish: RoleRunFinish = {
        executionId: 'attempt',
        result: 'failed',
        failure: 'T3 used another choice.',
        report: {
            source: 't3',
            reference: 'task-1/result',
            actual: {
                model: { instanceId: 'other', model: 'other' },
                effort: 'medium',
                options: [{ id: 'fastMode', value: false }],
            },
        },
    };
    const completed = records.finishRoleRun(workId, revision(), finish);

    expect(completed.actual).toEqual(finish.report!.actual);
    expect(completed.requested).toEqual(snapshot.roles.implementer);
    expect(records.finishRoleRun(workId, revision(), finish)).toEqual(completed);
    expect(() => records.finishRoleRun(workId, revision(), { ...finish, report: null })).toThrow('immutable');
    expect(() => records.startRoleRun(workId, revision(), { ...request, role: 'doubt' })).toThrow('another attempt');

    const reopened = await open(workRecordsPath(dir));

    expect(reopened.runSettings(workId).roleRuns).toEqual([completed]);
    records.startRoleRun(workId, revision(), { ...request, executionId: 'attempt-2' });
    expect(
        records.finishRoleRun(workId, revision(), {
            executionId: 'attempt-2',
            report: null,
            result: 'failed',
            failure: 'T3 unavailable.',
        }),
    ).toMatchObject({ actual: null, requested: snapshot.roles.implementer });
});

it('links review rounds to frozen settings and retains deterministic skips and escalation evidence after edits', async () => {
    const { dir, records, workId, revision } = await fixture();
    const settings = customSettings();

    writeFactorySettings(settings, dir);

    const snapshot = records.snapshotRun(workId, revision(), input());

    settings.reviewers.find((entry) => entry.id === 'code')!.mode = { kind: 'never' };
    settings.reviewers.find((entry) => entry.id === 'security')!.mode = { kind: 'never' };
    writeFactorySettings(settings, dir);

    const selected = selectReviewers(snapshot.settings, { complete: true, files: [] }, [
        { reviewer: 'security', requestedBy: 'code', reason: 'Indirect auth change.' },
    ]);
    const reviewers = selected.map((entry) => ({
        axis: entry.id,
        verdict: entry.run ? ('approve' as const) : ('skipped' as const),
        findings: [],
        notChecked: entry.run ? undefined : entry.reason,
        escalation: entry.escalation,
        selection: {
            triggerVersion: entry.triggerVersion,
            outcome: entry.outcome,
            rule: entry.rule,
            evidence: entry.evidence,
            reason: entry.reason,
            run: entry.run,
        },
    }));

    records.recordReviewRound(workId, revision(), { runId: snapshot.runId, base: 'abc1234', reviewers });

    const rounds = records.reviewRounds(workId);

    expect(rounds[0]!.runId).toBe(snapshot.runId);
    expect(rounds[0]!.reviewers.find((entry) => entry.axis === 'security')).toMatchObject({
        escalation: { requestedBy: 'code', reason: 'Indirect auth change.' },
        selection: { outcome: 'unmatched', run: true },
    });
    expect(rounds[0]!.reviewers.find((entry) => entry.axis === 'ui')).toMatchObject({
        verdict: 'skipped',
        selection: { rule: 'mode.never', run: false },
    });

    const rev = revision();

    expect(() => records.recordReviewRound(workId, rev, { base: 'abc1234', reviewers })).toThrow('runId');
    expect(() => records.recordReviewRound(workId, rev, { runId: 'missing', base: 'abc1234', reviewers })).toThrow(
        'No run',
    );
    expect(() =>
        records.recordReviewRound(workId, rev, {
            runId: snapshot.runId,
            base: 'abc1234',
            reviewers: [{ axis: 'code', verdict: 'approve', findings: [] }],
        }),
    ).toThrow('selection evidence');
    expect(revision()).toBe(rev);
    expect(records.reviewRounds(workId)).toEqual(rounds);
});

it('rejects stale revisions, invalid evidence and cross-record IDs atomically', async () => {
    const { records, workId, revision } = await fixture();

    expect(() => records.snapshotRun(workId, 99, input())).toThrow('revision');
    expect(() => records.snapshotRun(workId, 1, { ...input(), packaged: { version: 'v1', reviewers: {} } })).toThrow(
        'nonempty',
    );
    expect(records.runSettings(workId).runs).toEqual([]);

    const snapshot = records.snapshotRun(workId, revision(), input());

    expect(() => records.snapshotRun(workId, revision(), input(snapshot.runId, 'decision'))).toThrow('change kind');

    const other = records.create({ title: 'Other', repository: 'test/repo', kind: 'build' });

    expect(() =>
        records.startRoleRun(other.workId, 1, { runId: snapshot.runId, executionId: 'x', role: 'thread' }),
    ).toThrow('belongs');
    expect(() =>
        records.startRoleRun(workId, revision(), {
            runId: snapshot.runId,
            executionId: 'x',
            role: 'toString' as never,
        }),
    ).toThrow('Unknown');
    records.startRoleRun(workId, revision(), { runId: snapshot.runId, executionId: 'x', role: 'thread' });

    const rev = revision();

    expect(() =>
        records.finishRoleRun(workId, rev, {
            executionId: 'x',
            result: 'completed',
            report: { source: 'guess' as never, reference: 'x', actual: snapshot.thread },
        }),
    ).toThrow('T3');
    expect(() =>
        records.finishRoleRun(workId, rev, {
            executionId: 'x',
            result: 'completed',
            report: {
                source: 't3',
                reference: 'x',
                actual: { ...snapshot.thread, options: [{ id: 'effort', value: 'low' }] },
            },
        }),
    ).toThrow('conflicts');
    expect(revision()).toBe(rev);
    expect(records.runSettings(workId).roleRuns[0]!.actual).toBeNull();
});

it('migrates legacy records without inventing snapshots or changing history; SQL prevents snapshot updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-run-settings-'));

    dirs.push(dir);

    const path = workRecordsPath(dir);
    const old = await openDatabase(path, { migrations: MIGRATIONS.slice(0, 25) });

    old.db
        .exec(`INSERT INTO work_records(work_id,repository,kind,status,revision,created_at,updated_at) VALUES ('legacy','test/repo','build','Review',3,'before','before');
        INSERT INTO review_rounds(work_id,round,base,recorded_at) VALUES ('legacy',1,'abc1234','before');`);
    old.close();

    const records = await open(path);

    expect(records.runSettings('legacy')).toEqual({ workId: 'legacy', runs: [], roleRuns: [] });
    expect(records.read('legacy')).toMatchObject({ revision: 3, status: 'Review', createdAt: 'before' });
    expect(records.reviewRounds('legacy')).toEqual([
        { round: 1, base: 'abc1234', recordedAt: 'before', reviewers: [] },
    ]);
    records.snapshotRun('legacy', 3, input());

    const database = await openDatabase(path);

    try {
        expect(() => database.db.prepare("UPDATE run_settings SET content='{}' WHERE work_id='legacy'").run()).toThrow(
            'immutable',
        );
    } finally {
        database.close();
    }
});

it('S08 F06: reconciliation terminates an unbound launch after its owner ends, preserving unknown actuals', async () => {
    const { records, workId, revision } = await fixture();

    records.snapshotRun(workId, revision(), input('shaping', 'shaping'));
    records.addThread(workId, revision(), 'owner', 'shape');
    records.startRoleRun(workId, revision(), { runId: 'shaping', executionId: 'orphan', role: 'explore' });
    records.startRoleRun(workId, revision(), { runId: 'shaping', executionId: 'later', role: 'explore' });
    records.finishRoleRun(workId, revision(), { executionId: 'later', result: 'completed', report: null });
    records.reconcileRoleRuns(workId, { ownerEnded: false });
    expect(records.runSettings(workId).roleRuns[0]!.result).toBe('running');
    records.reconcileRoleRuns(workId, { ownerEnded: true });

    const orphan = records.runSettings(workId).roleRuns[0]!;

    expect(orphan).toMatchObject({
        result: 'failed',
        actual: null,
        report: null,
        failure: expect.stringMatching(/abandoned|owner ended/i),
    });
    expect(orphan.endedAt).not.toBeNull();

    const before = revision();

    records.reconcileRoleRuns(workId, { ownerEnded: true });
    expect(revision()).toBe(before);
});
