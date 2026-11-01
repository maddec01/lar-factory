import { expect, test, vi } from 'vite-plus/test';
import { deleteRemoteBranch } from './github.ts';
import { prHost } from '../config/pr-host.ts';

test('the facade deletes the encoded exact branch ref', async () => {
  const run = vi.fn().mockResolvedValue('');
  expect(prHost('owner/repo').deleteRemoteBranch).toBe(deleteRemoteBranch);
  await deleteRemoteBranch('owner/repo', 'feat/a#b', undefined, run);
  expect(run).toHaveBeenCalledWith(['api', '--method', 'DELETE', 'repos/owner/repo/git/refs/heads/feat%2Fa%23b']);
});

test('deletion failures propagate', async () => {
  await expect(deleteRemoteBranch('owner/repo', 'topic', undefined, async () => { throw Error('denied'); })).rejects.toThrow('denied');
});

test('checks the expected remote head using the provider login before deletion', async () => {
  const run = vi.fn().mockResolvedValueOnce('observed\n').mockResolvedValueOnce('');
  await deleteRemoteBranch('owner/repo', 'topic', 'observed', run);
  expect(run.mock.calls).toEqual([
    [['api', 'repos/owner/repo/git/refs/heads/topic', '--jq', '.object.sha']],
    [['api', '--method', 'DELETE', 'repos/owner/repo/git/refs/heads/topic']],
  ]);
});
test('a changed remote head prevents GitHub deletion', async () => {
  const run = vi.fn().mockResolvedValue('new-head');
  await expect(deleteRemoteBranch('owner/repo', 'topic', 'old-head', run)).rejects.toThrow('branch changed');
  expect(run).toHaveBeenCalledTimes(1);
});
