import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, test, vi } from 'vite-plus/test';

import { testRuntimeCommand } from './test-runtime.ts';
import { openWorkRecords } from './work-records.ts';

const packaged = {
    version: 'test',
    reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
};

test('shaping preparation keeps the runtime frozen at its start through later project changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'shaping-runtime-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const work = records.create({ title: 'Preparation', repository: 'fake/app', kind: 'feature' });
        const snapshot = (runId: string) =>
            records.snapshotRun(work.workId, records.read(work.workId).revision, {
                runId,
                kind: 'shaping',
                skills: [],
                packaged,
            });
        const frozen = snapshot('preparation');

        writeFileSync(
            join(dir, 'project-runtimes.json'),
            JSON.stringify({ 'fake/app': { node: process.execPath, version: 'v0.0.0' } }),
        );
        expect(snapshot('later').testRuntime).toEqual({ node: process.execPath, version: 'v0.0.0' });
        expect(snapshot('preparation')).toEqual(frozen);
        expect(frozen.testRuntime).toEqual({ node: process.execPath, version: process.version });
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('a build role runs the runtime frozen at run start despite the shell and later project changes', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-runtime-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const work = records.create({ title: 'Bug', repository: 'fake/app', kind: 'bug' });
        const wrongBin = join(dir, 'wrong-node');

        mkdirSync(wrongBin);
        writeFileSync(join(wrongBin, 'node'), '#!/bin/sh\necho v22.0.0\nexit 73\n');
        chmodSync(join(wrongBin, 'node'), 0o755);
        expect(
            records.snapshotRun(work.workId, work.revision, { runId: 'build-1', kind: 'build', skills: [], packaged }),
        ).toMatchObject({ testRuntime: { node: process.execPath, version: process.version } });
        writeFileSync(
            join(dir, 'project-runtimes.json'),
            JSON.stringify({ 'fake/app': { node: '/missing/node', version: process.version } }),
        );

        const result = spawnSync(
            process.execPath,
            [
                '--disable-warning=ExperimentalWarning',
                join(import.meta.dirname, 'cli.ts'),
                'run-test',
                work.workId,
                '--role',
                'implementer',
                '--',
                'node',
                '-p',
                'process.version',
            ],
            {
                cwd: dir,
                encoding: 'utf8',
                env: { ...process.env, PATH: `${wrongBin}:${process.env.PATH}`, LAR_FACTORY_DATA_DIR: dir },
            },
        );

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toBe(`${process.version}\n`);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
}, 30_000);

test('a run whose frozen runtime no longer matches its node is held before any test runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-runtime-mismatch-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

    try {
        const work = records.create({ title: 'Bug', repository: 'fake/app', kind: 'bug' });

        writeFileSync(
            join(dir, 'project-runtimes.json'),
            JSON.stringify({ 'fake/app': { node: process.execPath, version: 'v0.0.0' } }),
        );
        records.snapshotRun(work.workId, work.revision, { runId: 'build-1', kind: 'build', skills: [], packaged });

        const marker = join(dir, 'ran');
        const code = await testRuntimeCommand([
            work.workId,
            '--data-dir',
            dir,
            '--run-id',
            'build-1',
            '--role',
            'checks',
            '--',
            process.execPath,
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(marker)}, '')`,
        ]);

        expect(code).toBe(1);
        expect(existsSync(marker)).toBe(false);
        expect(stderr.mock.calls.join('')).toContain(
            `frozen test runtime mismatch: expected v0.0.0, found ${process.version}. Tests were not executed.`,
        );
    } finally {
        stderr.mockRestore();
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});

test('legacy run settings with no frozen runtime hold the run instead of borrowing another', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'test-runtime-legacy-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        const work = records.create({ title: 'Preparation', repository: 'fake/app', kind: 'feature' });
        const later = records.snapshotRun(work.workId, work.revision, {
            runId: 'later',
            kind: 'shaping',
            skills: [],
            packaged,
        });
        // Emulate a persisted pre-runtime snapshot; it must not borrow 'later' or mutable project settings.
        const legacy = new DatabaseSync(join(dir, 'work-records.db'));

        legacy
            .prepare('INSERT INTO run_settings(work_id,run_id,content) VALUES (?,?,?)')
            .run(work.workId, 'legacy', JSON.stringify({ ...later, runId: 'legacy', testRuntime: undefined }));
        legacy.close();

        expect(() => records.testRuntime(work.workId, 'legacy')).toThrow(
            'Run legacy (shaping) held: legacy run settings have no frozen test runtime. Tests were not executed.',
        );
        expect(records.testRuntime(work.workId, 'later')).toEqual(later.testRuntime);
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
