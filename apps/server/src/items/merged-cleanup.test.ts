import type { Item } from '@lar-factory/shared';
import { openWorkRecords } from '@lar-factory/work-records';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vite-plus/test';

import { createMergedCleanup } from './merged-cleanup.ts';
import { inspectCleanup } from './work-cleanup.ts';

// A real squash-style branch is not an ancestor of main: a normal branch -d would retain it.
test('after the owner ends, confirmed merge removes only the clean exact delivery head and worktree', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'merged-cleanup-'));
    const checkout = join(dir, 'project');
    const tree = join(dir, 'owned');
    const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();

    git('init', '-b', 'main', checkout);
    git(
        '-C',
        checkout,
        '-c',
        'user.name=Test',
        '-c',
        'user.email=test@example.invalid',
        'commit',
        '--allow-empty',
        '-m',
        'Base',
    );
    git('-C', checkout, 'worktree', 'add', '-b', 'fix/delivery', tree);
    writeFileSync(join(tree, 'result.txt'), 'Delivered');
    git('-C', tree, 'add', 'result.txt');
    git('-C', tree, '-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'Result');

    const head = git('-C', tree, 'rev-parse', 'HEAD');
    const records = await openWorkRecords(join(dir, 'work.db'));

    try {
        const id = records.create({
            repository: 'example/repo',
            title: 'Result',
            kind: 'build',
            status: 'Ready',
        }).workId;
        const rev = () => records.read(id).revision;

        records.setBody(id, rev(), 'brief', 'Exact result');
        records.recordGate(id, rev(), {
            briefDigest: records.gate(id).briefDigest!,
            approvedBy: 'Human',
            evidence: 'Approved',
        });
        records.prepareBuild(id, rev(), { limit: 1 });
        records.setBuildBranch(id, rev(), 'fix/delivery');
        records.setPullRequest(id, rev(), 'example/repo#1');
        records.observe(id, rev(), { of: 'pr', state: 'merged' });
        records.update(id, rev(), { status: 'Done' });

        const owner = {
            id: 'build',
            purpose: 'build',
            state: 'done',
            currentRunning: true,
            hasRunningChildren: true,
            watchingPrs: ['https://github.com/example/repo/pull/1'],
            updated: new Date().toISOString(),
        };
        const item = { id, repo: 'example/repo', status: 'Done', threads: [owner] } as unknown as Item;
        const cleanup = createMergedCleanup(records, {
            context: async () => ({ checkout, defaultBranch: 'main', liveWorktreePaths: [], writable: true }),
            read: async () => ({
                number: 1,
                url: 'https://github.com/example/repo/pull/1',
                state: 'merged',
                sourceRevision: head,
                isDraft: false,
                checks: null,
                mergeState: 'can merge',
            }),
            inspect: (input) =>
                inspectCleanup({
                    ...input,
                    provider: { branchExists: async () => false, openPrByHead: async () => null },
                }),
        });

        await cleanup([item], 0);
        expect(existsSync(tree)).toBe(true);
        delete (owner as Partial<typeof owner>).currentRunning;
        // Dirty output is retained, even though GitHub confirmed a merge.
        writeFileSync(join(tree, 'scratch.txt'), 'Keep me');
        await cleanup([item], 60_000);
        expect(existsSync(tree)).toBe(true);
        rmSync(join(tree, 'scratch.txt'));
        await cleanup([item], 120_000);
        expect(existsSync(tree)).toBe(false);
        expect(git('-C', checkout, 'branch', '--list')).toBe('* main');
    } finally {
        records.close();
        rmSync(dir, { recursive: true, force: true });
    }
});
