import type { Item } from '@lar-factory/shared';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vite-plus/test';

import { executeCleanup, inspectCleanup } from './work-cleanup.ts';

it('limits ownership to the saved build and its slices and protects live and default branches', async () => {
    const plan = await inspectCleanup({
        repository: 'a/b',
        checkout: '/project',
        item: {} as Item,
        branch: 'saved',
        sliceIds: ['12345678-abcd'],
        defaultBranch: 'main',
        liveWorktreePaths: ['/live'],
        writable: true,
        provider: { branchExists: async () => true, openPrByHead: async () => null },
        git: async (_tool, args) => ({
            code: 0,
            stderr: '',
            detail: '',
            stdout: args.includes('ls-files')
                ? ''
                : args.includes('worktree')
                  ? 'worktree /old\nbranch refs/heads/saved\n\nworktree /live\nbranch refs/heads/slice/12345678-live\n\n'
                  : args.includes('status')
                    ? '?? untracked.txt\n'
                    : args.includes('log')
                      ? 'abc123 local work\n'
                      : args.includes('--format=%(upstream:short)')
                        ? ''
                        : 'main\nsaved\nslice/12345678-live\nslice/87654321-other\nsaved-extra\n',
        }),
    });

    expect(plan.localBranches).toEqual(['saved']);
    expect(plan.worktreePaths).toEqual(['/old']);
    expect(plan.dirtyFiles).toEqual(['/old: ?? untracked.txt']);
    expect(plan.unpushedCommits).toEqual(['saved: abc123 local work']);
    expect(plan.remoteAvailable).toBe(true);
});

const planFrom = (refs: { upstream?: string; remoteDefault?: string }, logged: string[]) =>
    inspectCleanup({
        repository: 'a/b',
        checkout: '/project',
        item: {} as Item,
        branch: 'saved',
        sliceIds: [],
        defaultBranch: 'main',
        liveWorktreePaths: [],
        writable: true,
        provider: { branchExists: async () => false, openPrByHead: async () => null },
        git: async (_tool, args) => {
            const at = args.indexOf('log');

            if (at >= 0) logged.push(args[at + 2]!);

            return {
                code: 0,
                stderr: '',
                detail: '',
                stdout: args.includes('--format=%(upstream:short)')
                    ? (refs.upstream ?? '')
                    : args.includes('--format=%(refname)')
                      ? (refs.remoteDefault ?? '')
                      : args.includes('--format=%(refname:short)')
                        ? 'main\nsaved\n'
                        : '',
            };
        },
    });

it("compares a branch with no upstream against the remote's default branch, not the local one", async () => {
    const logged: string[] = [];

    await planFrom({ remoteDefault: 'refs/remotes/origin/main\n' }, logged);
    expect(logged).toEqual(['refs/remotes/origin/main..refs/heads/saved']);
});

it('rejects changed losses before running any deletion', async () => {
    const plan = {
        branch: 'old',
        localBranches: ['old'],
        worktreePaths: [],
        dirtyFiles: [],
        unpushedCommits: [],
        remoteBranch: null,
        localAvailable: true,
        remoteAvailable: false,
    };

    await expect(
        executeCleanup({
            plan: { ...plan, dirtyFiles: ['new loss'] },
            expectedPlan: plan,
            checkout: '/unused',
            repository: 'a/b',
            local: true,
            remote: false,
            confirmedLoss: true,
            git: async () => {
                throw new Error('Deletion must not run');
            },
        }),
    ).rejects.toThrow('Cleanup changed');
});

it('requires explicit confirmation before discarding local losses', async () => {
    const plan = {
        branch: 'old',
        localBranches: ['old'],
        worktreePaths: [],
        dirtyFiles: ['dirty'],
        unpushedCommits: [],
        remoteBranch: null,
        localAvailable: true,
        remoteAvailable: false,
    };

    await expect(
        executeCleanup({
            plan,
            expectedPlan: plan,
            checkout: '/unused',
            repository: 'a/b',
            local: true,
            remote: false,
            confirmedLoss: false,
            git: async () => {
                throw new Error('Deletion must not run');
            },
        }),
    ).rejects.toThrow('Confirm loss');
});

it('deletes an owned branch in a disposable repository and preserves main', async () => {
    const { runTool } = await import('../tools/run-tool.ts');
    const checkout = await mkdtemp(join(tmpdir(), 'cleanup-'));
    const git = async (args: string[]) => {
        const result = await runTool('git', ['-C', checkout, ...args], { timeout: 10000 });

        expect(result.code, `stderr: ${result.stderr}`).toBe(0);

        return result.stdout;
    };

    try {
        await git(['init', '-b', 'main']);
        await git([
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.com',
            'commit',
            '--allow-empty',
            '-m',
            'initial',
        ]);
        await git(['branch', 'owned']);

        const plan = await inspectCleanup({
            repository: 'a/b',
            checkout,
            item: {} as Item,
            branch: 'owned',
            sliceIds: [],
            sliceBranches: [],
            defaultBranch: 'main',
            liveWorktreePaths: [],
            writable: true,
            provider: { branchExists: async () => false, openPrByHead: async () => null },
        });

        expect(
            await executeCleanup({
                plan,
                expectedPlan: plan,
                checkout,
                repository: 'a/b',
                local: true,
                remote: false,
                confirmedLoss: false,
            }),
        ).toEqual({ errors: [], remainingBranches: [] });
        expect(await git(['branch', '--format=%(refname:short)'])).toBe('main\n');
    } finally {
        await rm(checkout, { recursive: true, force: true });
    }
});

it('refuses unsafe root and symlink worktrees before invoking Git', async () => {
    const root = await mkdtemp(join(tmpdir(), 'cleanup-path-'));

    try {
        const alias = join(root, 'alias');

        await symlink(root, alias);
        for (const path of ['/', root, alias]) {
            const plan = {
                branch: 'owned',
                localBranches: ['owned'],
                worktreePaths: [path],
                dirtyFiles: ['loss'],
                unpushedCommits: [],
                remoteBranch: null,
                localAvailable: true,
                remoteAvailable: false,
            };

            await expect(
                executeCleanup({
                    checkout: root,
                    repository: 'a/b',
                    plan,
                    expectedPlan: plan,
                    local: true,
                    remote: false,
                    confirmedLoss: true,
                    git: async () => {
                        throw new Error('Must not invoke Git');
                    },
                }),
            ).rejects.toThrow('Unsafe worktree path');
        }
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
