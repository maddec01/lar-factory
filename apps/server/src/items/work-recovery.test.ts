import { describe, expect, it } from 'vite-plus/test';
import type { Item } from '@lar-factory/shared';
import { inspectWorkRecovery } from './work-recovery.ts';
import { prHost } from '../config/pr-host.ts';

describe('recovery inspection', () => {
  for (const present of [true, false]) it(`reads a ${present ? 'present' : 'missing'} branch in the project checkout`, async () => {
    const result = await inspectWorkRecovery({ repository: 'a/b', checkout: '/project', item: {} as Item, branch: 'build/exact',
      git: async (_tool, args) => {
        expect(args.slice(0, 2)).toEqual(['-C', '/project']);
        return { code: args.includes('show-ref') && !present ? 1 : 0, stdout: 'worktree /tree\nbranch refs/heads/build/exact\n\n', stderr: '', detail: '' };
      }, provider: { prState: async () => 'CLOSED', openPrByHead: async () => 'https://github.com/a/b/pull/1' } });
    expect(result).toEqual({ branch: 'build/exact', branchExists: present, worktreePath: '/tree', pr: 'open' });
  });
  it('keeps failed observations unknown', async () => {
    const result = await inspectWorkRecovery({ repository: 'a/b', checkout: '/project', item: {} as Item, branch: 'saved', recordedPr: 'url',
      git: async () => ({ code: 0, stdout: '', stderr: '', detail: '' }),
      provider: { prState: async () => { throw new Error('offline'); }, openPrByHead: async () => null } });
    expect(result.pr).toBe('unknown');
    expect(result.warning).toContain('second PR');
    expect(result.warning).toContain('remote branch');
  });
  for (const repo of ['a/b', 'org/project/repo']) it(`rejects prefix matches for ${repo}`, async () => {
    expect(await prHost(repo).openPrByHead(repo, 'saved', async () => JSON.stringify([
      { headRefName: 'saved-extra', sourceRefName: 'refs/heads/saved-extra', url: 'wrong', pullRequestId: 1 },
    ]))).toBeNull();
  });
});
