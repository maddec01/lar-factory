import { afterEach, expect, test, vi } from 'vite-plus/test';
import { trackerLabels } from './tracker-labels.ts';

afterEach(() => { vi.unstubAllEnvs(); });

/** A gh that records each call and its JSON body, answering from `answer`. */
function fakeGh(answer: (method: string, path: string) => unknown = () => ({ name: 'x' })) {
  const calls: { method: string; path: string; body?: unknown }[] = [];
  const gh = async (args: string[], input?: string) => {
    const method = args[args.indexOf('--method') + 1]!;
    const path = args[args.indexOf('--method') + 2]!;
    calls.push({ method, path, ...input !== undefined && { body: JSON.parse(input) as unknown } });
    const answered = answer(method, path);
    return answered === undefined ? '' : JSON.stringify(answered);
  };
  return { calls, commands: { gh, az: async () => { throw new Error('az is not for a GitHub repository'); } } };
}

test('GitHub lists every page of labels with their colour and description', async () => {
  const { commands } = fakeGh(() => [[{ name: 'area-ui', color: 'ff0000', description: 'The UI' }], [{ name: 'docs', color: '00ff00', description: null }]]);
  expect(await trackerLabels('team/app', commands).list()).toEqual([
    { name: 'area-ui', color: 'ff0000', description: 'The UI' }, { name: 'docs', color: '00ff00' },
  ]);
});

test('GitHub creates a label, with a default colour when none is given', async () => {
  const { calls, commands } = fakeGh((_, path) => path && { name: 'new', color: 'ededed', description: null });
  expect(await trackerLabels('team/app', commands).create({ name: 'new' })).toEqual({ name: 'new', color: 'ededed' });
  expect(calls).toEqual([{ method: 'POST', path: 'repos/team/app/labels', body: { name: 'new', color: 'ededed' } }]);
});

test('GitHub updates a label by its encoded name, sending only what changes', async () => {
  const { calls, commands } = fakeGh(() => ({ name: 'good first', color: 'aaaaaa', description: 'Start here' }));
  const updated = await trackerLabels('team/app', commands).update('needs help', { name: 'good first', color: 'aaaaaa', description: 'Start here' });
  expect(updated).toEqual({ name: 'good first', color: 'aaaaaa', description: 'Start here' });
  expect(calls).toEqual([{ method: 'PATCH', path: 'repos/team/app/labels/needs%20help', body: { new_name: 'good first', color: 'aaaaaa', description: 'Start here' } }]);
});

test('GitHub deletes a label, whose empty answer is success', async () => {
  const { calls, commands } = fakeGh(() => undefined);
  await trackerLabels('team/app', commands).delete('a/b');
  expect(calls).toEqual([{ method: 'DELETE', path: 'repos/team/app/labels/a%2Fb' }]);
});

test('GitHub adds and removes labels on a ticket one change at a time, never setting the whole list', async () => {
  const { calls, commands } = fakeGh(() => []);
  const labels = trackerLabels('team/app', commands);
  await labels.addToTicket(7, ['one', 'two']);
  await labels.removeFromTicket(7, ['three', 'four five']);
  expect(calls).toEqual([
    { method: 'POST', path: 'repos/team/app/issues/7/labels', body: { labels: ['one', 'two'] } },
    { method: 'DELETE', path: 'repos/team/app/issues/7/labels/three' },
    { method: 'DELETE', path: 'repos/team/app/issues/7/labels/four%20five' },
  ]);
});

test('adding or removing no labels calls no tracker', async () => {
  const { calls, commands } = fakeGh();
  await trackerLabels('team/app', commands).addToTicket(7, []);
  await trackerLabels('team/app', commands).removeFromTicket(7, []);
  expect(calls).toEqual([]);
});

const azureRepo = 'contoso/Fabrikam%20Fiber/lar-api';
const noAz = (calls: string[][]) => ({
  gh: async () => { throw new Error('gh is not for an Azure repository'); },
  az: async (args: string[]) => { calls.push(args); return '{"value":[]}'; },
});

test('Azure has no tag create, so create refuses with the capability reason and calls nothing', async () => {
  const calls: string[][] = [];
  await expect(trackerLabels(azureRepo, noAz(calls)).create({ name: 'new' })).rejects.toThrow('Azure DevOps has no way to create a tag on its own.');
  expect(calls).toEqual([]);
});

test('Azure tags have no colour or description to update', async () => {
  const calls: string[][] = [];
  await expect(trackerLabels(azureRepo, noAz(calls)).update('old', { color: 'ff0000' })).rejects.toThrow('no colour or description');
  expect(calls).toEqual([]);
});

test('in a read-only session every Azure label write is refused with the existing reason, before az runs', async () => {
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  const calls: string[][] = [];
  const labels = trackerLabels(azureRepo, noAz(calls));
  const reason = 'Azure DevOps is read-only in this test session.';
  await expect(labels.create({ name: 'new' })).rejects.toThrow(reason);
  await expect(labels.update('old', { name: 'new' })).rejects.toThrow(reason);
  await expect(labels.delete('old')).rejects.toThrow(reason);
  await expect(labels.addToTicket(1, ['new'])).rejects.toThrow(reason);
  await expect(labels.removeFromTicket(1, ['old'])).rejects.toThrow(reason);
  expect(calls).toEqual([]);
  await labels.list();
  expect(calls).toHaveLength(1);
});
