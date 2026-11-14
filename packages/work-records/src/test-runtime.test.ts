import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

for (const kind of ['shaping', 'concept', 'decision'] as const)
    test(`${kind} preparation and every role use their own frozen runtime`, async () => {
        const dir = mkdtempSync(join(tmpdir(), 'shaping-runtime-'));
        const records = await openWorkRecords(join(dir, 'work-records.db'));

        try {
            const work = records.create({ title: 'Preparation', repository: 'fake/app', kind: 'feature' });
            const snapshot = (runId: string) =>
                records.snapshotRun(work.workId, records.read(work.workId).revision, {
                    runId,
                    kind,
                    skills: [],
                    packaged: {
                        version: 'test',
                        reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
                    },
                });
            const frozen = snapshot('preparation');

            writeFileSync(
                join(dir, 'project-runtimes.json'),
                JSON.stringify({
                    'fake/app': { node: process.execPath, version: 'v0.0.0' },
                }),
            );
            snapshot('later');
            expect(snapshot('preparation')).toEqual(frozen);
            expect(frozen.testRuntime).toEqual({ node: process.execPath, version: process.version });
            for (const role of ['thread', ...Object.keys(frozen.roles)]) {
                const result = spawnSync(
                    process.execPath,
                    [
                        join(import.meta.dirname, 'cli.ts'),
                        'run-test',
                        work.workId,
                        '--role',
                        role,
                        ...(role === 'checks' ? ['--record'] : []),
                        '--',
                        'node',
                        '-p',
                        'process.version',
                    ],
                    {
                        encoding: 'utf8',
                        cwd: dir,
                        env: { ...process.env, LAR_FACTORY_DATA_DIR: dir, LAR_FACTORY_RUN_ID: 'preparation' },
                    },
                );

                if (role === 'checks') expect(result.stderr).toContain('lar-work: check');
                else expect(result.stderr).toBe('');

                expect(result.status).toBe(0);
                expect(result.stdout).toBe(`${process.version}\n`);
            }

            // Emulate a persisted pre-runtime snapshot; it must not borrow 'later' or mutable project settings.
            const legacy = new DatabaseSync(join(dir, 'work-records.db'));

            legacy
                .prepare('INSERT INTO run_settings(work_id,run_id,content) VALUES (?,?,?)')
                .run(work.workId, 'legacy', JSON.stringify({ ...frozen, runId: 'legacy', testRuntime: undefined }));
            legacy.close();

            const held = spawnSync(
                process.execPath,
                [
                    join(import.meta.dirname, 'cli.ts'),
                    'run-test',
                    work.workId,
                    '--run-id',
                    'legacy',
                    '--role',
                    'explore',
                    '--',
                    'node',
                    '-e',
                    'console.log("MUST NOT RUN")',
                ],
                { encoding: 'utf8', env: { ...process.env, LAR_FACTORY_DATA_DIR: dir } },
            );

            expect(held.status).toBe(1);
            expect(held.stdout).not.toContain('MUST NOT RUN');
            expect(held.stderr).toContain(`Run legacy (${kind}) held: legacy run settings have no frozen test runtime`);
            expect(held.stderr).not.toMatch(/register|repair|Needs you/);
        } finally {
            records.close();
            rmSync(dir, { recursive: true, force: true });
        }
    }, 30000);

test('all build roles and slices use the runtime frozen at run start despite shell and later project changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-runtime-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const work = records.create({ title: 'Bug', repository: 'fake/app', kind: 'bug' });
        const wrongBin = join(dir, 'wrong-node');

        mkdirSync(wrongBin);
        writeFileSync(join(wrongBin, 'node'), '#!/bin/sh\necho v22.0.0\nexit 73\n');
        chmodSync(join(wrongBin, 'node'), 0o755);

        const cli = (...args: string[]) =>
            spawnSync(process.execPath, [join(import.meta.dirname, 'cli.ts'), ...args], {
                cwd: dir,
                encoding: 'utf8',
                env: { ...process.env, PATH: `${wrongBin}:${process.env.PATH}`, LAR_FACTORY_DATA_DIR: dir },
            });
        const missing = cli('run-test', work.workId, '--role', 'builder', '--', 'node', '-p', 'process.version');

        expect(missing.status).toBe(1);
        expect(missing.stderr).toContain('runtime');

        const snapshot = records.snapshotRun(work.workId, records.read(work.workId).revision, {
            runId: 'build-1',
            kind: 'build',
            skills: [],
            packaged: {
                version: 'test',
                reviewers: { code: 'Review', security: 'Security', ui: 'UI', performance: 'Performance' },
            },
        });

        expect(snapshot).toMatchObject({ testRuntime: { node: process.execPath, version: process.version } });
        writeFileSync(
            join(dir, 'project-runtimes.json'),
            JSON.stringify({ 'fake/app': { node: process.execPath, version: process.version } }),
        );

        const run = cli('run-test', work.workId, '--role', 'builder', '--', 'node', '-p', 'process.version');

        expect(run.status).toBe(0);
        expect(run.stdout).toBe(`${process.version}\n`);

        const recorded = cli(
            'run-test',
            work.workId,
            '--record',
            '--role',
            'checks',
            '--',
            'node',
            '-p',
            'process.version',
        );

        expect(recorded.status).toBe(0);
        expect(recorded.stdout).toBe(run.stdout);
        writeFileSync(
            join(dir, 'project-runtimes.json'),
            JSON.stringify({ 'fake/app': { node: '/missing/node', version: process.version } }),
        );

        const slice = records.create({ title: 'Slice', repository: 'fake/app', kind: 'slice' });

        records.setParent(slice.workId, slice.revision, work.workId);
        for (const id of [work.workId, slice.workId])
            for (const role of ['builder', 'implementer', 'checks', 'ci-fixer', 'approver']) {
                const result = cli('run-test', id, '--role', role, '--', 'node', '-p', 'process.version');

                expect(result.stderr).toBe('');
                expect(result.status).toBe(0);
                expect(result.stdout).toBe(`${process.version}\n`);
            }
        expect(
            cli('test-runtime', 'fake/app', '--node', process.execPath, '--version', process.version).status,
        ).not.toBe(0);

        writeFileSync(
            join(dir, 'project-runtimes.json'),
            JSON.stringify({ 'fake/app': { node: process.execPath, version: 'v0.0.0' } }),
        );

        const next = records.snapshotRun(work.workId, records.read(work.workId).revision, {
            runId: 'build-2',
            kind: 'build',
            skills: [],
            packaged: {
                version: 'test',
                reviewers: { code: 'Review', security: 'Security', ui: 'UI', performance: 'Performance' },
            },
        });

        expect(next).toMatchObject({ testRuntime: { node: process.execPath, version: 'v0.0.0' } });

        const held = cli(
            'run-test',
            work.workId,
            '--role',
            'checks',
            '--',
            'node',
            '-e',
            'console.log("MUST NOT RUN")',
        );

        expect(held.status).toBe(1);
        expect(held.stdout).not.toContain('MUST NOT RUN');
        expect(held.stderr).toContain('expected v0.0.0');
        expect(held.stderr).not.toMatch(/register|Set it with|Needs you/);
        expect(
            cli(
                'run-test',
                work.workId,
                '--run-id',
                'build-1',
                '--role',
                'checks',
                '--',
                'node',
                '-p',
                'process.version',
            ).status,
        ).toBe(0);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
}, 30000);
