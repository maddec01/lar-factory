import type { Item } from '@lar-factory/shared';
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
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

for (const branch of ['main', 'live'])
    it(`protects the ${branch} branch from cleanup`, async () => {
        const plan = await inspectCleanup({
            repository: 'a/b',
            checkout: '/project',
            item: {} as Item,
            branch,
            sliceIds: [],
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
                      ? 'worktree /live\nbranch refs/heads/live\n\n'
                      : 'main\nlive\n',
            }),
        });

        expect(plan.localBranches).toEqual([]);
        expect(plan.remoteAvailable).toBe(false);
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

it('deletes only the owned branch and its worktree, and never names main', async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'cleanup-local-')));
    const checkout = join(root, 'project');
    const worktree = join(root, 'project-owned');

    await mkdir(checkout);
    await mkdir(worktree);

    try {
        const plan = {
            branch: 'owned',
            localBranches: ['owned'],
            worktreePaths: [worktree],
            dirtyFiles: [],
            unpushedCommits: [],
            remoteBranch: null,
            localAvailable: true,
            remoteAvailable: false,
        };
        const calls: string[][] = [];
        const result = await executeCleanup({
            plan,
            expectedPlan: plan,
            checkout,
            repository: 'a/b',
            local: true,
            remote: false,
            confirmedLoss: true,
            git: async (_tool, args) => {
                calls.push(args);

                return {
                    code: 0,
                    stderr: '',
                    detail: '',
                    stdout: args.includes('list')
                        ? `worktree ${checkout}\nbranch refs/heads/main\n\nworktree ${worktree}\nbranch refs/heads/owned\n\n`
                        : args.includes('rev-parse')
                          ? `${checkout}\n`
                          : '',
                };
            },
        });

        expect(result).toEqual({ errors: [], remainingBranches: [] });
        expect(calls.filter((args) => args.includes('remove') || args.includes('branch'))).toEqual([
            ['-C', checkout, 'worktree', 'remove', '--force', '--', worktree],
            ['-C', checkout, 'branch', '-D', '--', 'owned'],
        ]);
        expect(calls.flat()).not.toContain('main');
    } finally {
        await rm(root, { recursive: true, force: true });
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

it('passes the inspected head through the provider and retains failed remote deletion', async () => {
    const plan = {
        branch: 'owned',
        localBranches: [],
        worktreePaths: [],
        dirtyFiles: [],
        unpushedCommits: [],
        remoteBranch: 'owned',
        remoteHead: 'a'.repeat(40),
        localAvailable: false,
        remoteAvailable: true,
    };
    const calls: unknown[][] = [];
    const result = await executeCleanup({
        checkout: '/repo',
        repository: 'a/b',
        plan,
        expectedPlan: plan,
        local: false,
        remote: true,
        confirmedLoss: false,
        git: async () => {
            throw Error('Git must not perform remote deletion');
        },
        provider: {
            deleteRemoteBranch: async (...args) => {
                calls.push(args);
                throw Error('changed');
            },
        },
    });

    expect(calls).toEqual([['a/b', 'owned', 'a'.repeat(40)]]);
    expect(result.errors).toEqual(['Could not delete remote branch owned']);
    expect(result.remainingBranches).toContain('owned');
});
