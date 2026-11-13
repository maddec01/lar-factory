import { defaultFactorySettings } from '@lar-factory/shared/factory-settings';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vite-plus/test';

import { writeFactorySettings } from './factory-settings.ts';
import { openWorkRecords, workRecordsPath } from './work-records.ts';

const dirs: string[] = [];

afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

it('round trips snapshot and execution commands in an isolated data folder, with no revision changes on reads', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-run-cli-'));

    dirs.push(dir);

    const records = await openWorkRecords(workRecordsPath(dir));

    try {
        const { workId } = records.create({ title: 'CLI fixture', repository: 'test/repo', kind: 'build' });
        const cli = (...args: string[]) =>
            JSON.parse(
                execFileSync(
                    process.execPath,
                    [
                        '--disable-warning=ExperimentalWarning',
                        join(import.meta.dirname, 'cli.ts'),
                        ...args,
                        '--data-dir',
                        dir,
                    ],
                    { encoding: 'utf8', timeout: 20_000 },
                ),
            );
        const file = join(dir, 'input.json');
        const write = (command: string, input: unknown) => {
            writeFileSync(file, JSON.stringify(input));

            return cli(command, workId, '--revision', String(records.read(workId).revision), '--file', file);
        };

        expect(cli('run-settings', workId)).toEqual({ workId, runs: [], roleRuns: [] });

        const snapshot = write('snapshot-run', {
            runId: 'cli-run',
            kind: 'build',
            skills: [],
            packaged: {
                version: 'fixture',
                reviewers: { code: 'Code', security: 'Security', ui: 'UI', performance: 'Performance' },
            },
        });

        expect(snapshot.thread).toEqual({ model: null, effort: null, options: [] });

        const settings = defaultFactorySettings();

        settings.threadKinds.build = { model: { instanceId: 'new', model: 'new' }, effort: 'high' };
        writeFactorySettings(settings, dir);

        const attempt = write('start-role-run', {
            runId: 'cli-run',
            executionId: 'cli-attempt',
            role: 'thread',
            threadId: 't3-thread',
        });

        expect(attempt.requested).toEqual(snapshot.thread);

        const report = {
            source: 't3',
            reference: 'thread/t3-thread',
            actual: {
                model: { instanceId: 'actual', model: 'actual' },
                effort: 'medium',
                options: [{ id: 'effort', value: 'medium' }],
            },
        };
        const completed = write('finish-role-run', { executionId: 'cli-attempt', result: 'completed', report });
        const rev = records.read(workId).revision;

        expect(cli('run-settings', workId, '--run-id', 'cli-run')).toEqual({
            workId,
            runs: [snapshot],
            roleRuns: [completed],
        });
        expect(records.read(workId).revision).toBe(rev);
        writeFileSync(file, '{broken');
        expect(() => cli('snapshot-run', workId, '--revision', String(rev), '--file', file)).toThrow('Command failed');
        expect(records.read(workId).revision).toBe(rev);
    } finally {
        records.close();
    }
}, 30_000);
