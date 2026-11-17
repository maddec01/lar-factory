import type { ItemChecks } from '@lar-factory/shared';
import { expect, test } from 'vite-plus/test';

import { checkCommands, commandText } from './check-list';

type Run = ItemChecks['runs'][number];

const run = (checkId: string, command: string[], folder: string, more: Partial<Run> = {}): Run => ({
    checkId,
    command,
    folder,
    role: 'implementer',
    reason: null,
    outcome: 'passed',
    eligible: true,
    snapshotState: 'stable',
    failureState: null,
    failure: null,
    ...more,
});

test('a local check shows its command as plain text, quoting only arguments a shell would read differently', () => {
    expect(commandText(['pnpm', 'vitest', 'run', 'src/a b.test.ts', '-t', 'opens the dialog'])).toBe(
        "pnpm vitest run 'src/a b.test.ts' -t 'opens the dialog'",
    );
});

test('a local check quotes arguments with shell characters so the copied command runs the same', () => {
    expect(commandText(['grep', '-E', 'a|b', '$HOME', "it's", '', 'plain'])).toBe(
        `grep -E 'a|b' '$HOME' 'it'\\''s' '' plain`,
    );
    expect(commandText(['ls', 'src/[id].ts', '=ls', 'x^y', '--flag=a,b', 'user@host:path'])).toBe(
        `ls 'src/[id].ts' '=ls' 'x^y' --flag=a,b user@host:path`,
    );
});

test('a local check hides a "." folder and keeps any other', () => {
    const [root, web] = checkCommands([run('a', ['pnpm', 'test'], '.'), run('b', ['pnpm', 'test'], 'apps/web')]);

    expect(root).toMatchObject({ command: 'pnpm test', folder: null });
    expect(web).toMatchObject({ command: 'pnpm test', folder: 'apps/web' });
});

test('runs with the same arguments and folder show only the latest, earlier runs collapsed', () => {
    const commands = checkCommands([
        run('first', ['pnpm', 'test'], '.', { outcome: 'failed', failureState: 'resolved' }),
        run('other', ['pnpm', 'run', 'typecheck'], '.'),
        run('second', ['pnpm', 'test'], '.', { outcome: 'interrupted' }),
        run('third', ['pnpm', 'test'], '.'),
    ]);

    expect(
        commands.map(({ command, latest, earlier }) => ({
            command,
            latest: latest.checkId,
            earlier: earlier.map((run) => run.checkId),
        })),
    ).toEqual([
        { command: 'pnpm test', latest: 'third', earlier: ['second', 'first'] },
        { command: 'pnpm run typecheck', latest: 'other', earlier: [] },
    ]);
});

test('an open failure on a collapsed run stays visible', () => {
    const [command] = checkCommands([
        run('failed', ['pnpm', 'test'], '.', {
            outcome: 'failed',
            failureState: 'open',
            failure: { tests: ['opens the dialog'], diagnosis: 'Timer never fires.' },
        }),
        run('resolved', ['pnpm', 'test'], '.', { outcome: 'failed', failureState: 'resolved' }),
        run('passed', ['pnpm', 'test'], '.'),
    ]);

    expect(command!.openFailures.map((run) => run.checkId)).toEqual(['failed']);
});
