import { defaultFactorySettings, FACTORY_ROLES, type FactorySettings } from '@lar-factory/shared/factory-settings';
import { frozenBuildMethodLine, type RoleRunFinish, type SnapshotRunInput } from '@lar-factory/shared/run-settings';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { openDatabase } from './database.ts';
import { writeFactorySettings } from './factory-settings.ts';
import { MIGRATIONS } from './migrations.ts';
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

it('captures a build with every role, all modes and exact instruction provenance', async () => {
    const { dir, records, workId } = await fixture();

    writeFactorySettings(customSettings(), dir);

    const snapshot = records.snapshotRun(workId, 1, input());

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

it('records the release a run starts on, and none for a run started without one or saved before releases', async () => {
    const { records, workId, revision } = await fixture();
    const onRelease = records.snapshotRun(workId, revision(), { ...input('run-1'), release: '2.0.0' });
    const without = records.snapshotRun(workId, revision(), input('run-2'));

    expect(onRelease.release).toBe('2.0.0');
    expect(without).not.toHaveProperty('release');
    expect(records.runSettings(workId).runs.map((run) => run.release)).toEqual(['2.0.0', undefined]);
    expect(() =>
        records.startRoleRun(workId, revision(), { runId: 'run-2', executionId: 'exec-1', role: 'thread' }),
    ).not.toThrow();
    for (const release of ['', '../2.0.0', 'a/b'])
        expect(() => records.snapshotRun(workId, revision(), { ...input('run-3'), release })).toThrow(
            'Invalid run release.',
        );
});

it('freezes the project Build method, keeps it after the setting changes, and reads a run without one as TDD', async () => {
    const { records, workId, revision } = await fixture();
    const proveIt = records.snapshotRun(workId, revision(), { ...input('run-1'), buildMethod: 'prove-it' });

    expect(records.snapshotRun(workId, revision(), { ...input('run-1'), buildMethod: 'tdd' })).toEqual(proveIt);
    expect(proveIt.buildMethod).toBe('prove-it');
    expect(records.snapshotRun(workId, revision(), { ...input('run-2'), buildMethod: 'tdd' }).buildMethod).toBe('tdd');
    expect(records.snapshotRun(workId, revision(), input('run-3')).buildMethod).toBe('tdd');
    expect(records.runSettings(workId).runs.map((run) => run.buildMethod)).toEqual(['prove-it', 'tdd', 'tdd']);
    expect(() =>
        records.snapshotRun(workId, revision(), {
            ...input('run-4'),
            buildMethod: 'waterfall' as SnapshotRunInput['buildMethod'],
        }),
    ).toThrow('Invalid run build method.');
});

it('prints Prove it for a run frozen with it, and TDD for a run saved before Build methods', async () => {
    const { dir, records, workId, revision } = await fixture();
    const { buildMethod: _, ...legacy } = records.snapshotRun(workId, revision(), input('run-1'));
    const database = await openDatabase(workRecordsPath(dir));

    try {
        database.db
            .prepare('INSERT INTO run_settings(work_id,run_id,content) VALUES (?,?,?)')
            .run(workId, 'legacy', JSON.stringify({ ...legacy, runId: 'legacy' }));
    } finally {
        database.close();
    }

    expect(records.runSettings(workId, 'legacy').runs[0]).not.toHaveProperty('buildMethod');
    expect(frozenBuildMethodLine(records.runSettings(workId, 'legacy').runs[0]!)).toBe('Frozen build method: TDD');
    expect(
        frozenBuildMethodLine(records.snapshotRun(workId, revision(), { ...input('run-2'), buildMethod: 'prove-it' })),
    ).toBe('Frozen build method: Prove it');
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

it('S05 F3: only the matching terminal T3 result can replace inferred abandonment, once', async () => {
    const { records, workId, revision } = await fixture();
    const snapshot = records.snapshotRun(workId, revision(), input());

    records.startRoleRun(workId, revision(), { runId: snapshot.runId, executionId: 'approver', role: 'approver' });
    records.reconcileRoleRuns(workId, { ownerEnded: true });

    const finish: RoleRunFinish = {
        executionId: 'approver',
        result: 'completed',
        summary: 'PR delivered',
        report: {
            source: 't3',
            reference: 'node:delegated-task:command%3Amcp%3Afixture%3Adelegate-task%3Aapprover',
            actual: snapshot.roles.approver,
        },
    };

    expect(() =>
        records.finishRoleRun(workId, revision(), { ...finish, report: { ...finish.report!, reference: 'unrelated' } }),
    ).toThrow('immutable');
    expect(() => records.finishRoleRun(workId, revision(), finish)).not.toThrow();
    expect(records.runSettings(workId).roleRuns[0]).toMatchObject({
        result: 'completed',
        failure: null,
        summary: 'PR delivered',
    });
    expect(() => records.finishRoleRun(workId, revision(), { ...finish, summary: 'Changed real result' })).toThrow(
        'immutable',
    );
    expect(() =>
        records.waitForUser(
            workId,
            revision(),
            'role-finish cannot save a completed role execution: bookkeeping conflict',
        ),
    ).toThrow(/agent|system|technical/i);
    expect(records.read(workId).needsYou).toBeNull();
});
