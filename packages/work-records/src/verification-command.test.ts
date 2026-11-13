import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { expect, test } from 'vite-plus/test';

import { openWorkRecords } from './work-records.ts';

const execute = promisify(execFile);

test('CLI observes heads but refuses an agent-authored Verify result naming Pedro', { timeout: 15000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), 'verify-cli-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));

    try {
        let work = records.create({ title: 'Build', repository: 'owner/repo', kind: 'bug', status: 'Verify' });

        work = records.setPullRequest(work.workId, work.revision, 'owner/repo#8');

        const cli = (command: string, ...args: string[]) =>
            execute(
                process.execPath,
                [new URL('./cli.ts', import.meta.url).pathname, command, work.workId, '--data-dir', dir, ...args],
                { env: { ...process.env, LAR_BOARD_PORT: '0' } },
            );
        const head = 'a'.repeat(40);
        const observed = await cli('verification-head', '--pr', 'owner/repo#8', '--head', head);

        expect(JSON.parse(observed.stdout)).toMatchObject({ required: true, head });

        const file = join(dir, 'result.json');

        writeFileSync(
            file,
            JSON.stringify({
                pr: 'owner/repo#8',
                head,
                result: 'pass',
                by: 'Pedro',
                note: null,
                testSteps: '1. Test it.',
            }),
        );
        await expect(
            cli('record-verification', '--revision', String(records.read(work.workId).revision), '--file', file),
        ).rejects.toMatchObject({ stderr: expect.stringContaining('requires Pedro') });
        expect(JSON.parse((await cli('verification')).stdout).latest).toBeNull();
        expect(records.read(work.workId).status).toBe('Verify');
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
