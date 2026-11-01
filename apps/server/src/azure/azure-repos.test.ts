import { afterEach, expect, test, vi } from 'vite-plus/test';
import { AZURE_REPOS } from './azure-repos.ts';

afterEach(() => vi.unstubAllEnvs());

test('deletes the exact slash branch with its observed object ID', async () => {
  const run = vi.fn().mockResolvedValueOnce(JSON.stringify([
    { name: 'refs/heads/feat/a-extra', objectId: 'wrong' },
    { name: 'refs/heads/feat/a', objectId: 'observed' },
  ])).mockResolvedValueOnce('{"success":true}');
  await AZURE_REPOS.deleteRemoteBranch('org/project/repo', 'feat/a', undefined, run);
  expect(run.mock.calls[1]![0]).toEqual(['repos', 'ref', 'delete', '--name', 'refs/heads/feat/a', '--object-id', 'observed',
    '--repository', 'repo', '--project', 'project', '--org', 'https://dev.azure.com/org', '--detect', 'false', '--output', 'json']);
});

test('rejects stale ref updates and provider failures', async () => {
  const run = vi.fn().mockResolvedValueOnce('[{"name":"refs/heads/topic","objectId":"old"}]')
    .mockResolvedValueOnce('{"success":false,"updateStatus":"staleOldObjectId"}');
  await expect(AZURE_REPOS.deleteRemoteBranch('org/project/repo', 'topic', undefined, run)).rejects.toThrow('staleOldObjectId');
  await expect(AZURE_REPOS.deleteRemoteBranch('org/project/repo', 'topic', undefined, async () => { throw Error('denied'); })).rejects.toThrow('denied');
});

test('read-only refuses deletion before calling the runner', async () => {
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  const run = vi.fn();
  await expect(AZURE_REPOS.deleteRemoteBranch('org/project/repo', 'topic', undefined, run)).rejects.toThrow('read-only');
  expect(run).not.toHaveBeenCalled();
});

test('a changed head is refused before Azure deletion and unchanged deletion uses its object ID', async () => {
  const changed = vi.fn().mockResolvedValue('[{"name":"refs/heads/topic","objectId":"new"}]');
  await expect(AZURE_REPOS.deleteRemoteBranch('org/project/repo', 'topic', 'old', changed)).rejects.toThrow('branch changed');
  expect(changed).toHaveBeenCalledTimes(1);
  const unchanged = vi.fn().mockResolvedValueOnce('[{"name":"refs/heads/topic","objectId":"old"}]').mockResolvedValueOnce('{"success":true}');
  await AZURE_REPOS.deleteRemoteBranch('org/project/repo', 'topic', 'old', unchanged);
  expect(unchanged.mock.calls[1]![0]).toContain('old');
});
