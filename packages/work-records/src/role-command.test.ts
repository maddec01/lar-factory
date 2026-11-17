import { defaultFactorySettings } from '@lar-factory/shared/factory-settings';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vite-plus/test';

import { readFactorySettings, writeFactorySettings } from './factory-settings.ts';
import { roleCommand } from './role-command.ts';
import { openWorkRecords, workRecordsPath, type WorkRecords } from './work-records.ts';

const fixtures: { dir: string; records: WorkRecords }[] = [];

afterEach(() => {
    for (const { dir, records } of fixtures.splice(0)) {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

async function fixture(instanceId = 'codex', effort: string | null = 'high', { earlier = false } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "lar-role-O'Brien-"));
    const records = await openWorkRecords(workRecordsPath(dir));

    fixtures.push({ dir, records });

    const settings = defaultFactorySettings();

    settings.threadKinds.build = { model: { instanceId, model: 'configured' }, ...(effort && { effort }) };
    settings.reviewers.push({
        id: 'custom',
        name: 'Custom',
        mode: { kind: 'always' },
        instructions: { kind: 'revision', revision: 1 },
        revisions: [{ revision: 1, text: 'Frozen custom instructions' }],
    });
    writeFactorySettings(settings, dir);

    const { workId } = records.create({ title: 'Role command fixture', repository: 'test/repo', kind: 'build' });

    records.snapshotRun(workId, records.read(workId).revision, {
        runId: 'frozen-run',
        kind: 'build',
        skills: [],
        packaged: {
            version: 'fixture',
            reviewers: { code: 'Frozen Code', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
    });

    // A run saved before launches were recorded has no new-run mark.
    if (earlier) {
        const db = new DatabaseSync(workRecordsPath(dir));

        db.prepare('DELETE FROM new_runs WHERE work_id=?').run(workId);
        db.close();
    }

    const shape = join(dir, 'shape.md');
    const build = join(dir, 'build.md');
    const capabilities = join(dir, 'capabilities.json');
    const task = join(dir, 'task.md');

    for (const path of [shape, build, join(dir, 'lar-work')]) writeFileSync(path, 'fixture');

    writeFileSync(task, 'Implement the brief.');
    writeFileSync(
        capabilities,
        JSON.stringify({
            providers: [
                {
                    providerInstanceId: instanceId,
                    canRunChildTask: true,
                    models: [
                        {
                            id: 'configured',
                            options: [{ id: instanceId === 'claude' ? 'effort' : 'reasoningEffort', values: ['high'] }],
                        },
                    ],
                },
            ],
        }),
    );

    const processCli = (args: string[], input?: string, env: Record<string, string | undefined> = {}) =>
        spawnSync(
            process.execPath,
            ['--disable-warning=ExperimentalWarning', join(import.meta.dirname, 'cli.ts'), ...args, '--data-dir', dir],
            {
                encoding: 'utf8',
                timeout: 20_000,
                input,
                env: {
                    ...process.env,
                    LAR_FACTORY_BIN: dir,
                    LAR_FACTORY_SHAPE_SKILL: shape,
                    LAR_FACTORY_BUILD_SKILL: build,
                    LAR_FACTORY_AZURE_READ_ONLY: '1',
                    ...env,
                },
            },
        );
    const cli = async (args: string[], input?: string, env: Record<string, string | undefined> = {}) => {
        let stdout = '';
        let stderr = '';
        const out = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
            stdout += String(chunk);

            return true;
        });
        const err = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
            stderr += String(chunk);

            return true;
        });

        for (const [key, value] of Object.entries({
            LAR_FACTORY_BIN: dir,
            LAR_FACTORY_SHAPE_SKILL: shape,
            LAR_FACTORY_BUILD_SKILL: build,
            LAR_FACTORY_AZURE_READ_ONLY: '1',
            ...env,
        }))
            vi.stubEnv(key, value);

        try {
            if (input !== undefined && !args.includes('--file')) {
                const file = join(dir, 'stdin-fixture.json');

                writeFileSync(file, input);
                args = [...args, '--file', file];
            }

            const status = await roleCommand(args[0]!, [...args.slice(1), '--data-dir', dir]);

            return { status, stdout, stderr };
        } finally {
            out.mockRestore();
            err.mockRestore();
            vi.unstubAllEnvs();
        }
    };
    const launch = (role = 'implementer', extra: string[] = [], env?: Record<string, string | undefined>) =>
        cli(
            [
                'role-launch',
                workId,
                '--run-id',
                'frozen-run',
                '--role',
                role,
                '--capabilities',
                capabilities,
                '--task',
                task,
                ...extra,
            ],
            undefined,
            env,
        );
    const finish = (executionId: string, input: unknown, extra: string[] = []) =>
        cli(
            ['role-finish', workId, '--execution-id', executionId, ...extra],
            typeof input === 'string' ? input : JSON.stringify(input),
        );

    return { dir, records, workId, shape, build, capabilities, task, launch, finish, processCli };
}

it.each([
    ['saved before launches were recorded', true],
    ['with no recorded launch', false],
])(
    'prints exact targets for every claude role of a run %s, using advertised effort, frozen instructions and the environment paths',
    async (_name, earlier) => {
        const f = await fixture('claude', 'high', { earlier });

        // Later Settings must not affect any role launched in this run.
        const changed = readFactorySettings(f.dir).settings;

        changed.threadKinds.build = { model: { instanceId: 'later', model: 'later' }, effort: 'low' };
        changed.reviewers.find((reviewer) => reviewer.id === 'custom')!.name = 'Later name';
        writeFactorySettings(changed, f.dir);

        for (const [role, label] of Object.entries({
            thread: 'Build',
            explore: 'Explore',
            diagnose: 'Diagnose',
            research: 'Research',
            prototype: 'Prototype',
            planner: 'Planner',
            implementer: 'Implementer',
            checks: 'Checks',
            'domain-docs': 'Domain docs',
            fixer: 'Fixer',
            approver: 'Approver',
            'ci-fixer': 'Ci fixer',
            doubt: 'Doubt',
            'reviewer:code': 'Code review',
            'reviewer:security': 'Security review',
            'reviewer:ui': 'UI review',
            'reviewer:performance': 'Performance review',
            'reviewer:custom': 'Custom review',
        })) {
            const result = await f.launch(role);

            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);

            const args = JSON.parse(result.stdout);
            const attempt = f.records.runSettings(f.workId).roleRuns.at(-1)!;

            expect(args.target).toEqual({
                providerInstanceId: 'claude',
                model: 'configured',
                options: { effort: 'high' },
            });

            const title = `${label} · Role command fixture`;

            expect(args.title).toBe(title);
            expect(args.task.split('\n')[0]).toBe(title);
            expect(args.task).toContain('\n\n<!-- factory-runtime:start -->\n');
            expect(args.task).toContain('<!-- factory-runtime:end -->');
            expect(args.runtimeMode).toBe('inherit');
            expect(args.clientRequestId).toBe(attempt.executionId);
            expect(args.isolation).toBe(['implementer', 'prototype'].includes(role) ? 'worktree' : 'shared');
            expect(args.task).toContain(`work ID ${f.workId}; run ID frozen-run`);
            expect(args.task).toContain(`Read ${f.build} first`);
            expect(args.task).toContain(JSON.stringify({ 'lar-shape': f.shape, 'lar-build': f.build }));
            expect(args.task).toContain("'\\''");
            expect(args.task).toContain('export LAR_FACTORY_DATA_DIR=');
            expect(args.task).toContain(`export PATH='${f.dir.replaceAll("'", "'\\''")}':"$PATH"`);
            expect(args.task).toContain("export LAR_FACTORY_RUN_ID='frozen-run'");
            expect(args.task).toContain("export LAR_FACTORY_AZURE_READ_ONLY='1'");
            expect(args.task).toContain('All Azure DevOps organizations are read-only.');
            expect(args.task).toContain(`Use '${join(f.dir, 'lar-work').replaceAll("'", "'\\''")}' for work records.`);
            expect(args.task).toContain('Frozen project skills: []\nFrozen build method: TDD\nFrozen retro: on\n');
            expect(args.task).toContain('shared/orchestration.md');
            expect(args.task).toContain('Implement the brief.');

            if (earlier) {
                expect(args.task).toContain('export LAR_FACTORY_BIN=');
                expect(args.task).toContain('export LAR_FACTORY_SHAPE_SKILL=');
                expect(args.task).toContain('export LAR_FACTORY_BUILD_SKILL=');
                expect(args.task).toContain('Frozen role settings: ');
                expect(args.task).toContain('Frozen retro: on\nFor every child role');
                expect(args.task).toContain('role-finish');
                expect(args.task).toContain('Select reviewers with --run-id frozen-run');
            } else {
                expect(args.task).not.toMatch(/LAR_FACTORY_(?:BIN|SHAPE_SKILL|BUILD_SKILL)/);
                expect(args.task).not.toContain('Frozen role settings');
                expect(args.task).not.toContain('role-finish');
                expect(args.task).not.toContain('Select reviewers');
                expect(args.task.match(/"lar-shape"/g)).toHaveLength(1);
            }

            if (role === 'reviewer:custom') expect(args.task).toContain('Frozen custom instructions');

            if (role === 'reviewer:code') expect(args.task).toContain('Frozen Code');
        }
    },
    30_000,
);

it('prints explicit empty options and reuses an execution ID for launch recovery', async () => {
    const f = await fixture('codex', null);
    const first = await f.launch('planner', ['--execution-id', 'stable-attempt']);
    const again = await f.launch('planner', ['--execution-id', 'stable-attempt']);

    expect(first.status).toBe(0);
    expect(again.stdout).toBe(first.stdout);
    expect(JSON.parse(first.stdout).target.options).toEqual({});
    expect(f.records.runSettings(f.workId).roleRuns).toHaveLength(1);
});

it('records capability and missing-entry holds without printing delegate arguments', async () => {
    const f = await fixture();

    writeFileSync(f.capabilities, JSON.stringify({ providers: [] }));

    const unavailable = await f.launch();

    expect(unavailable.status).toBe(1);
    expect(unavailable.stdout).toBe('');
    expect(unavailable.stderr).toContain('codex/configured is unavailable');
    expect(f.records.read(f.workId).needsYou).toContain('codex/configured is unavailable');
    expect(f.records.runSettings(f.workId).roleRuns[0]).toMatchObject({ result: 'failed', report: null, actual: null });

    const g = await fixture();
    const missing = await g.launch('approver', [], { LAR_FACTORY_BUILD_SKILL: join(g.dir, 'missing.md') });

    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(g.records.read(g.workId).needsYou).toContain('missing.md');
});

it("reads the run's most recent recorded launch instead of the environment paths", async () => {
    const f = await fixture();
    const recorded = mkdtempSync(join(tmpdir(), 'lar-launch-'));
    const entries = {
        'lar-shape': join(recorded, 'lar-shape/SKILL.md'),
        'lar-build': join(recorded, 'lar-build/SKILL.md'),
    };

    fixtures.push({ dir: recorded, records: { close() {} } as WorkRecords });
    mkdirSync(join(recorded, 'lar-shape'));
    mkdirSync(join(recorded, 'lar-build'));
    mkdirSync(join(recorded, 'bin'));

    for (const path of [...Object.values(entries), join(recorded, 'bin/lar-work')]) writeFileSync(path, 'fixture');

    f.records.recordRunLaunch(f.workId, {
        runId: 'frozen-run',
        executionId: 'first-launch',
        skillEntries: { 'lar-shape': f.shape, 'lar-build': f.build },
        bin: f.dir,
    });
    f.records.recordRunLaunch(f.workId, {
        runId: 'frozen-run',
        executionId: 'retry',
        skillEntries: entries,
        bin: join(recorded, 'bin'),
    });

    const unset = {
        LAR_FACTORY_BIN: undefined,
        LAR_FACTORY_SHAPE_SKILL: undefined,
        LAR_FACTORY_BUILD_SKILL: undefined,
    };
    const result = await f.launch('implementer', [], unset);

    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);

    const { task } = JSON.parse(result.stdout);

    expect(task).toContain(`Read ${entries['lar-build']} first`);
    expect(task).toContain(`Factory skill entries: ${JSON.stringify(entries)}`);
    expect(task).toContain(`export PATH='${join(recorded, 'bin')}':"$PATH"`);
    expect(task).toContain(`Use '${join(recorded, 'bin/lar-work')}' for work records.`);
    expect(task).not.toContain(f.build);

    // A recorded path that no longer exists holds, as a missing environment path does.
    rmSync(entries['lar-shape']);

    const moved = await f.launch('approver', [], unset);

    expect(moved.status).toBe(1);
    expect(moved.stdout).toBe('');
    expect(f.records.read(f.workId).needsYou).toContain(entries['lar-shape']);
});

it.each([
    ['saved before launches were recorded', true],
    ['made with snapshot-run', false],
])('holds a run %s with no recorded launch when the environment paths are missing', async (_name, earlier) => {
    const f = await fixture('codex', 'high', { earlier });
    const missing = await f.launch('planner', [], { LAR_FACTORY_BIN: undefined });

    expect(missing.status).toBe(1);
    expect(missing.stdout).toBe('');
    expect(missing.stderr).toContain('LAR_FACTORY_BIN');
    expect(f.records.read(f.workId).needsYou).toContain('LAR_FACTORY_BIN');
});

const reported = (overrides: Record<string, unknown> = {}) => ({
    taskId: 't3-task',
    providerInstanceId: 'codex',
    model: 'configured',
    executedModel: 'configured',
    options: [{ id: 'reasoningEffort', value: 'high' }],
    status: 'completed',
    hasPendingChildRuns: false,
    ...overrides,
});

it('configured child roles preserve the skill stage owner', async () => {
    const f = await fixture();

    const { intent, record } = f.records.recordLaunchIntent(f.workId, f.records.read(f.workId).revision, 'build');

    f.records.resolveLaunchIntent(f.workId, record.revision, intent.intentId, { threadId: 'owner' });

    const owners = f.records.threads(f.workId);
    const launched = await f.launch('implementer');

    expect(launched.status).toBe(0);

    const { clientRequestId, target } = JSON.parse(launched.stdout);

    expect(target).toEqual({
        providerInstanceId: 'codex',
        model: 'configured',
        options: { reasoningEffort: 'high' },
    });
    expect((await f.finish(clientRequestId, reported({ childThreadId: 'implementer' }))).status).toBe(0);
    expect(f.records.runSettings(f.workId).roleRuns.at(-1)).toMatchObject({
        role: 'implementer',
        result: 'completed',
    });
    expect(f.records.threads(f.workId)).toEqual(owners);
    expect(f.records.launchIntents({ workId: f.workId, unresolved: true })).toEqual([]);
});

it('finishes from a file and preserves T3 evidence', async () => {
    const f = await fixture();
    const { clientRequestId } = JSON.parse((await f.launch()).stdout);
    const result = await f.finish(clientRequestId, reported());

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
        result: 'completed',
        report: {
            source: 't3',
            reference: 't3-task',
            actual: { model: { instanceId: 'codex', model: 'configured' }, effort: 'high' },
        },
    });
    expect(f.records.read(f.workId).needsYou).toBeNull();

    const file = join(f.dir, 'result.json');

    writeFileSync(file, JSON.stringify({ structuredContent: reported() }));
    expect((await f.finish(clientRequestId, '', ['--file', file])).status).toBe(0);

    // Contradictory evidence is an agent hold and cannot overwrite a completed report.
    expect((await f.finish(clientRequestId, reported({ executedModel: 'other' }))).status).toBe(1);
    expect(f.records.read(f.workId).needsYou).toBeNull();
    expect(f.records.runSettings(f.workId).roleRuns.at(-1)!.actual!.model!.model).toBe('configured');
});

for (const [name, input] of [
    ['executed model', reported({ executedModel: 'substituted' })],
    ['unavailable', reported({ status: 'failed' })],
    ['unfinished children', reported({ hasPendingChildRuns: true })],
] as const) {
    it(`holds and exits non-zero on ${name}`, async () => {
        const f = await fixture();
        const { clientRequestId } = JSON.parse((await f.launch()).stdout);
        const result = await f.finish(clientRequestId, input);
        const attempt = f.records.runSettings(f.workId).roleRuns.at(-1)!;

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(attempt.result).toBe('failed');
        expect(attempt.failure).toBeTruthy();
        expect(f.records.read(f.workId).needsYou).toBeNull();
        expect(result.stderr).toContain(attempt.failure!);
    });
}

it('routes the executable commands and reads a terminal T3 result from stdin', async () => {
    const f = await fixture();
    const launch = f.processCli([
        'role-launch',
        f.workId,
        '--run-id',
        'frozen-run',
        '--role',
        'checks',
        '--capabilities',
        f.capabilities,
        '--task',
        f.task,
    ]);

    expect(launch.status).toBe(0);

    const { clientRequestId } = JSON.parse(launch.stdout);
    const finish = f.processCli(
        ['role-finish', f.workId, '--execution-id', clientRequestId],
        JSON.stringify(reported()),
    );

    expect(finish.status).toBe(0);
    expect(JSON.parse(finish.stdout).result).toBe('completed');
}, 30_000);

it('keeps role runtime prompts out of product records after the title line', async () => {
    const f = await fixture();
    const result = await f.launch('explore');
    const args = JSON.parse(result.stdout);
    const before = f.records.read(f.workId);

    expect(result.status).toBe(0);
    expect(args.title).toBe('Explore · Role command fixture');
    expect(() => f.records.setBody(f.workId, before.revision, 'brief', args.task)).toThrow(/product content/i);
    expect(f.records.read(f.workId)).toEqual(before);
});
