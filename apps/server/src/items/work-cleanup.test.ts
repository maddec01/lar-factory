import { expect, it } from 'vite-plus/test';
import type { Item } from '@lar-factory/shared';
import { executeCleanup, inspectCleanup } from './work-cleanup.ts';

it('limits ownership to the saved build and its slices and protects live and default branches', async () => {
  const plan = await inspectCleanup({ repository: 'a/b', checkout: '/project', item: {} as Item,
    branch: 'saved', sliceIds: ['12345678-abcd'], defaultBranch: 'main', liveWorktreePaths: ['/live'], writable: true,
    provider: { branchExists: async () => true, openPrByHead: async () => null },
    git: async (_tool, args) => ({ code: 0, stderr: '', detail: '', stdout:
      args.includes('ls-files') ? '' : args.includes('worktree') ? 'worktree /old\nbranch refs/heads/saved\n\nworktree /live\nbranch refs/heads/slice/12345678-live\n\n' :
      args.includes('status') ? '?? untracked.txt\n' : args.includes('log') ? 'abc123 local work\n' :
      args.includes('--format=%(upstream:short)') ? '' : 'main\nsaved\nslice/12345678-live\nslice/87654321-other\nsaved-extra\n' }),
  });
  expect(plan.localBranches).toEqual(['saved']);
  expect(plan.worktreePaths).toEqual(['/old']);
  expect(plan.dirtyFiles).toEqual(['/old: ?? untracked.txt']);
  expect(plan.unpushedCommits).toEqual(['saved: abc123 local work']);
  expect(plan.remoteAvailable).toBe(true);
});

it('warns and leaves choices available when the remote cannot be observed', async () => {
  const plan = await inspectCleanup({ repository: 'a/b', checkout: '/project', item: {} as Item,
    branch: 'saved', sliceIds: [], defaultBranch: 'main', liveWorktreePaths: [], writable: true,
    provider: { branchExists: async () => { throw new Error('offline'); }, openPrByHead: async () => null },
    git: async () => ({ code: 0, stdout: '', stderr: '', detail: '' }),
  });
  expect(plan.remoteAvailable).toBe(true);
  expect(plan.warning).toContain('second PR');
  expect(plan.warning).toContain('close an open PR');
});

for (const branch of ['main', 'live']) it(`protects the ${branch} branch from cleanup`, async () => {
  const plan = await inspectCleanup({ repository: 'a/b', checkout: '/project', item: {} as Item,
    branch, sliceIds: [], defaultBranch: 'main', liveWorktreePaths: ['/live'], writable: true,
    provider: { branchExists: async () => true, openPrByHead: async () => null },
    git: async (_tool, args) => ({ code: 0, stderr: '', detail: '', stdout: args.includes('ls-files') ? '' : args.includes('worktree')
      ? 'worktree /live\nbranch refs/heads/live\n\n' : 'main\nlive\n' }),
  });
  expect(plan.localBranches).toEqual([]);
  expect(plan.remoteAvailable).toBe(false);
});

it('rejects changed losses before running any deletion', async () => {
  const plan = { branch: 'old', localBranches: ['old'], worktreePaths: [], dirtyFiles: [], unpushedCommits: [], remoteBranch: null, localAvailable: true, remoteAvailable: false };
  await expect(executeCleanup({ plan: { ...plan, dirtyFiles: ['new loss'] }, expectedPlan: plan,
    checkout: '/unused', repository: 'a/b', local: true, remote: false, confirmedLoss: true,
    git: async () => { throw new Error('Deletion must not run'); },
  })).rejects.toThrow('Cleanup changed');
});

it('requires explicit confirmation before discarding local losses', async () => {
  const plan = { branch: 'old', localBranches: ['old'], worktreePaths: [], dirtyFiles: ['dirty'], unpushedCommits: [], remoteBranch: null, localAvailable: true, remoteAvailable: false };
  await expect(executeCleanup({ plan, expectedPlan: plan, checkout: '/unused', repository: 'a/b', local: true, remote: false, confirmedLoss: false,
    git: async () => { throw new Error('Deletion must not run'); },
  })).rejects.toThrow('Confirm loss');
});

it('deletes an owned branch in a disposable repository and preserves main', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runTool } = await import('../tools/run-tool.ts');
  const checkout = await mkdtemp(join(tmpdir(), 'cleanup-'));
  const git = async (args: string[]) => {
    const result = await runTool('git', ['-C', checkout, ...args], { timeout: 10000 });
    expect(result.code, result.stderr).toBe(0);
    return result.stdout;
  };
  try {
    await git(['init', '-b', 'main']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial']);
    await git(['branch', 'owned']);
    const plan = await inspectCleanup({ repository: 'a/b', checkout, item: {} as Item, branch: 'owned', sliceIds: [], sliceBranches: [], defaultBranch: 'main', liveWorktreePaths: [], writable: true,
      provider: { branchExists: async () => false, openPrByHead: async () => null } });
    expect(await executeCleanup({ plan, expectedPlan: plan, checkout, repository: 'a/b', local: true, remote: false, confirmedLoss: false })).toEqual({ errors: [], remainingBranches: [] });
    expect(await git(['branch', '--format=%(refname:short)'])).toBe('main\n');
  } finally { await rm(checkout, { recursive: true, force: true }); }
});

it('refuses unsafe root and symlink worktrees before invoking Git', async () => {
  const { mkdtemp, symlink, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'cleanup-path-'));
  try {
    const alias = join(root, 'alias');
    await symlink(root, alias);
    for (const path of ['/', root, alias]) {
      const plan = { branch: 'owned', localBranches: ['owned'], worktreePaths: [path], dirtyFiles: ['loss'], unpushedCommits: [], remoteBranch: null, localAvailable: true, remoteAvailable: false };
      await expect(executeCleanup({ checkout: root, repository: 'a/b', plan, expectedPlan: plan, local: true, remote: false, confirmedLoss: true,
        git: async () => { throw new Error('Must not invoke Git'); } })).rejects.toThrow('Unsafe worktree path');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
it('passes the inspected head through the provider and retains failed remote deletion', async () => {
  const plan = { branch: 'owned', localBranches: [], worktreePaths: [], dirtyFiles: [], unpushedCommits: [], remoteBranch: 'owned', remoteHead: 'a'.repeat(40), localAvailable: false, remoteAvailable: true };
  const calls: unknown[][] = [];
  const result = await executeCleanup({ checkout: '/repo', repository: 'a/b', plan, expectedPlan: plan, local: false, remote: true, confirmedLoss: false,
    git: async () => { throw Error('Git must not perform remote deletion'); },
    provider: { deleteRemoteBranch: async (...args) => { calls.push(args); throw Error('changed'); } } });
  expect(calls).toEqual([['a/b', 'owned', 'a'.repeat(40)]]);
  expect(result.errors).toEqual(['Could not delete remote branch owned']);
  expect(result.remainingBranches).toContain('owned');
});

it('removes only a verified sibling worktree of the same repository', async () => {
  const { mkdtemp, mkdir, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { runTool } = await import('../tools/run-tool.ts');
  const root = await mkdtemp(join(tmpdir(), 'cleanup-worktree-'));
  const checkout = join(root, 'project');
  await mkdir(checkout);
  const git = async (args: string[]) => {
    const result = await runTool('git', ['-C', checkout, ...args], { timeout: 10000 });
    expect(result.code, result.stderr).toBe(0);
  };
  try {
    await git(['init', '-b', 'main']);
    await git(['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '--allow-empty', '-m', 'initial']);
    await git(['worktree', 'add', '-b', 'owned', join(root, 'work')]);
    const plan = await inspectCleanup({ repository: 'a/b', checkout, item: {} as Item, branch: 'owned', sliceIds: [], defaultBranch: 'main', liveWorktreePaths: [], writable: true,
      provider: { branchExists: async () => false, openPrByHead: async () => null } });
    expect(plan.worktreePaths).toHaveLength(1);
    expect(await executeCleanup({ plan, expectedPlan: plan, checkout, repository: 'a/b', local: true, remote: false, confirmedLoss: false })).toEqual({ errors: [], remainingBranches: [] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
