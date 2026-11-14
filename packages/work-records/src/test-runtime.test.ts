import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

test('focused tests refuse an unknown runtime and use the configured Node even when shell PATH names another one', async () => {
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
        expect(cli('run-test', work.workId, '--role', 'approver', '--', 'node', '-p', 'process.version').status).toBe(
            1,
        );
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
