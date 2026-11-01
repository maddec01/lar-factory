import { expect, it } from 'vite-plus/test';
import type { Item } from '@lar-factory/shared';
import { executeCleanup, inspectCleanup } from './work-cleanup.ts';

it('limits ownership to the saved build and its slices and protects live and default branches', async () => {
  const plan = await inspectCleanup({ repository: 'a/b', checkout: '/project', item: {} as Item,
    branch: 'saved', sliceIds: ['12345678-abcd'], defaultBranch: 'main', liveWorktreePaths: ['/live'], writable: true,
    provider: { branchExists: async () => true, openPrByHead: async () => null },
    git: async (_tool, args) => ({ code: 0, stderr: '', detail: '', stdout:
      args.includes('worktree') ? 'worktree /old\nbranch refs/heads/saved\n\nworktree /live\nbranch refs/heads/slice/12345678-live\n\n' :
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
    git: async (_tool, args) => ({ code: 0, stderr: '', detail: '', stdout: args.includes('worktree')
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
