import { FACTORY_ROLES, defaultFactorySettings } from '@lar-factory/shared/factory-settings';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

async function fixture(instanceId = 'codex', effort: string | null = 'high') {
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

for (const provider of ['claude', 'codex']) {
    it(`prints exact targets for every ${provider} role using advertised effort, frozen instructions and paths`, async () => {
        const f = await fixture(provider);

        // Later Settings must not affect any role launched in this run.
        const changed = readFactorySettings(f.dir).settings;

        changed.threadKinds.build = { model: { instanceId: 'later', model: 'later' }, effort: 'low' };
        writeFactorySettings(changed, f.dir);

        for (const role of [
            ...FACTORY_ROLES,
            'reviewer:code',
            'reviewer:security',
            'reviewer:ui',
            'reviewer:performance',
            'reviewer:custom',
        ]) {
            const result = await f.launch(role);

            expect(result.stderr).toBe('');
            expect(result.status).toBe(0);

            const args = JSON.parse(result.stdout);
            const attempt = f.records.runSettings(f.workId).roleRuns.at(-1)!;

            expect(args.target).toEqual({
                providerInstanceId: provider,
                model: 'configured',
                options: { [provider === 'claude' ? 'effort' : 'reasoningEffort']: 'high' },
            });
            expect(args.clientRequestId).toBe(attempt.executionId);
            expect(args.isolation).toBe(['implementer', 'prototype'].includes(role) ? 'worktree' : 'shared');
            expect(args.task).toContain(`work ID ${f.workId}; run ID frozen-run`);
            expect(args.task).toContain(`Read ${f.build} first`);
            expect(args.task).toContain(JSON.stringify({ 'lar-shape': f.shape, 'lar-build': f.build }));
            expect(args.task).toContain("'\\''");
            expect(args.task).toContain('export LAR_FACTORY_DATA_DIR=');
            expect(args.task).toContain('export LAR_FACTORY_BIN=');
            expect(args.task).toContain('export LAR_FACTORY_SHAPE_SKILL=');
            expect(args.task).toContain('export LAR_FACTORY_BUILD_SKILL=');
            expect(args.task).toContain("export LAR_FACTORY_AZURE_READ_ONLY='1'");
            expect(args.task).toContain('role-launch');
            expect(args.task).toContain('role-finish');
            expect(args.task).toContain('Implement the brief.');

            if (role === 'reviewer:custom') expect(args.task).toContain('Frozen custom instructions');

            if (role === 'reviewer:code') expect(args.task).toContain('Frozen Code');
        }
    }, 30_000);
}

it('prints explicit empty options and reuses an execution ID for launch recovery', async () => {
    const f = await fixture('codex', null);
    const first = await f.launch('planner', ['--execution-id', 'stable-attempt']);
    const again = await f.launch('planner', ['--execution-id', 'stable-attempt']);

    expect(first.status).toBe(0);
    expect(again.stdout).toBe(first.stdout);
    expect(JSON.parse(first.stdout).target.options).toEqual({});
    expect(f.records.runSettings(f.workId).roleRuns).toHaveLength(1);
});

it('holds a recovered attempt when its capability becomes unavailable', async () => {
    const f = await fixture();

    expect((await f.launch('planner', ['--execution-id', 'recover'])).status).toBe(0);
    writeFileSync(f.capabilities, JSON.stringify({ providers: [] }));

    const retry = await f.launch('planner', ['--execution-id', 'recover']);

    expect(retry.status).toBe(1);
    expect(f.records.read(f.workId).needsYou).toContain('unavailable');
    expect(f.records.runSettings(f.workId).roleRuns).toMatchObject([{ executionId: 'recover', result: 'failed' }]);
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

it('uses a role override independently of the thread model and keeps all frozen options', async () => {
    const f = await fixture();
    const settings = readFactorySettings(f.dir).settings;

    settings.roles.approver = { model: { instanceId: 'claude', model: 'review-model' }, effort: 'low' };
    writeFactorySettings(settings, f.dir);
    f.records.snapshotRun(f.workId, f.records.read(f.workId).revision, {
        runId: 'override-run',
        kind: 'build',
        skills: ['selected-skill'],
        projectDefault: {
            instanceId: 'codex',
            model: 'configured',
            options: [
                { id: 'reasoningEffort', value: 'high' },
                { id: 'fast', value: true },
            ],
        },
        packaged: {
            version: 'fixture',
            reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
        },
    });
    writeFileSync(
        f.capabilities,
        JSON.stringify({
            providers: [
                {
                    providerInstanceId: 'codex',
                    canRunChildTask: true,
                    models: [
                        {
                            id: 'configured',
                            options: [
                                { id: 'reasoningEffort', values: ['high'] },
                                { id: 'fast', values: [true, false] },
                            ],
                        },
                    ],
                },
                {
                    providerInstanceId: 'claude',
                    canRunChildTask: true,
                    models: [{ id: 'review-model', options: [{ id: 'effort', values: ['low'] }] }],
                },
            ],
        }),
    );

    const approver = JSON.parse((await f.launch('approver', ['--run-id', 'override-run'])).stdout);
    const checks = JSON.parse((await f.launch('checks', ['--run-id', 'override-run'])).stdout);

    expect(approver.target).toEqual({
        providerInstanceId: 'claude',
        model: 'review-model',
        options: { effort: 'low' },
    });
    expect(checks.target).toEqual({
        providerInstanceId: 'codex',
        model: 'configured',
        options: { reasoningEffort: 'high', fast: true },
    });
    expect(checks.task).toContain('Frozen project skills: ["selected-skill"]');
    expect(
        (
            await f.finish(
                checks.clientRequestId,
                reported({
                    options: [
                        { id: 'reasoningEffort', value: 'high' },
                        { id: 'fast', value: true },
                    ],
                }),
            )
        ).status,
    ).toBe(0);

    const mismatch = JSON.parse((await f.launch('checks', ['--run-id', 'override-run'])).stdout);

    expect(
        (
            await f.finish(
                mismatch.clientRequestId,
                reported({
                    options: [
                        { id: 'reasoningEffort', value: 'high' },
                        { id: 'fast', value: false },
                    ],
                }),
            )
        ).status,
    ).toBe(1);
});

for (const [name, canRunChildTask, options, reason] of [
    ['disabled provider', false, [{ id: 'reasoningEffort', values: ['high'] }], 'cannot run child tasks'],
    ['unsupported effort', true, [{ id: 'reasoningEffort', values: ['low'] }], 'does not offer reasoningEffort=high'],
    ['no effort capability', true, [], 'does not offer configured effort high'],
] as const) {
    it(`records a hold for ${name}`, async () => {
        const f = await fixture();

        writeFileSync(
            f.capabilities,
            JSON.stringify({
                providers: [{ providerInstanceId: 'codex', canRunChildTask, models: [{ id: 'configured', options }] }],
            }),
        );

        const result = await f.launch();

        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(f.records.read(f.workId).needsYou).toContain(reason);
        expect(f.records.runSettings(f.workId).roleRuns.at(-1)).toMatchObject({
            result: 'failed',
            actual: null,
            report: null,
        });
    });
}

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

for (const launch of ['skill', 'direct handoff'] as const)
    it(`configured child roles preserve the ${launch} stage owner`, async () => {
        const f = await fixture();

        if (launch === 'skill') {
            const { intent, record } = f.records.recordLaunchIntent(
                f.workId,
                f.records.read(f.workId).revision,
                'build',
            );

            f.records.resolveLaunchIntent(f.workId, record.revision, intent.intentId, { threadId: 'owner' });
        } else f.records.addThread(f.workId, f.records.read(f.workId).revision, 'owner', 'build');

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

    // Contradictory later evidence cannot rewrite a completed report, but must still hold the work.
    expect((await f.finish(clientRequestId, reported({ executedModel: 'other' }))).status).toBe(1);
    expect(f.records.read(f.workId).needsYou).toContain('mismatch');
    expect(f.records.runSettings(f.workId).roleRuns.at(-1)!.actual!.model!.model).toBe('configured');
});

for (const [name, input] of [
    ['executed model', reported({ executedModel: 'substituted' })],
    ['provider', reported({ providerInstanceId: 'other' })],
    ['effort', reported({ options: [{ id: 'reasoningEffort', value: 'low' }] })],
    ['effort key', reported({ options: [{ id: 'effort', value: 'high' }] })],
    [
        'extra option',
        reported({
            options: [
                { id: 'reasoningEffort', value: 'high' },
                { id: 'unexpected', value: true },
            ],
        }),
    ],
    ['missing evidence', reported({ options: null })],
    [
        'duplicate option',
        reported({
            options: [
                { id: 'reasoningEffort', value: 'high' },
                { id: 'reasoningEffort', value: 'high' },
            ],
        }),
    ],
    ['unavailable', reported({ status: 'failed' })],
    ['unfinished children', reported({ hasPendingChildRuns: true })],
    ['malformed JSON', '{broken'],
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
        expect(f.records.read(f.workId).needsYou).toBe(attempt.failure);
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
