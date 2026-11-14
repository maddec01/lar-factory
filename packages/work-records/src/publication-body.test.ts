import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

test('S05-F4-002 the PR description command generates canonical manual checks on create and update', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pr-body-'));

    try {
        const body = join(dir, 'body.md'),
            steps = join(dir, 'steps.md'),
            out = join(dir, 'out.md');

        writeFileSync(body, '## Summary\nC displays the greeting.\n## Test\n1. Old check.\n## Checks\n11 passed.');
        writeFileSync(steps, '1. Open sim-891.html; Hello, Pedro! is visible.');

        const run = (...args: string[]) =>
            spawnSync(process.execPath, ['src/cli.ts', 'pr-body', '--file', body, '--to', out, ...args], {
                encoding: 'utf8',
            });
        const created = run('--test-steps', steps);

        expect(created.status).toBe(0);
        expect(readFileSync(out, 'utf8')).toBe(
            '## Summary\nC displays the greeting.\n\n## Checks\n11 passed.\n\n## Test steps\n1. Open sim-891.html; Hello, Pedro! is visible.\n',
        );
        writeFileSync(body, readFileSync(out, 'utf8').replace('## Test steps', '## Manual checks'));
        expect(run().status).toBe(0);
        expect(readFileSync(out, 'utf8')).toContain('## Test steps\n1. Open');
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
