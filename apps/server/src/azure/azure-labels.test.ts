import { expect, test } from 'vite-plus/test';
import { trackerLabels } from '@lar-factory/shared/tracker-labels';
import { fakeAz, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';

function azure(items: WorkItem[], tags: string[] = [], fail?: (args: string[]) => Error | undefined) {
  const az = fakeAz({ items, tags, ...fail && { fail } });
  return { az, labels: trackerLabels(REPO, { az: az.run, gh: async () => { throw new Error('gh is not for an Azure repository'); } }) };
}

const manyTags = Array.from({ length: 150 }, (_, i) => `tag-${i + 1}`);

test('Azure lists the project tags', async () => {
  const { labels } = azure([], ['area-ui', 'docs']);
  expect(await labels.list()).toEqual([{ name: 'area-ui' }, { name: 'docs' }]);
});

test('renaming a tag changes it in the project and on every work item', async () => {
  const items: WorkItem[] = [{ id: 1, type: 'User Story', state: 'New', tags: 'old name; docs' }];
  const { az, labels } = azure(items, ['old name', 'docs']);
  expect(await labels.update('old name', { name: 'new name' })).toEqual({ name: 'new name' });
  expect(az.tags).toEqual(['new name', 'docs']);
  expect(items[0]!.tags).toBe('new name; docs');
});

test('deleting a tag removes it from the project and from every work item', async () => {
  const items: WorkItem[] = [{ id: 1, type: 'User Story', state: 'New', tags: 'gone; docs' }, { id: 2, type: 'User Story', state: 'New', tags: 'gone' }];
  const { az, labels } = azure(items, ['gone', 'docs']);
  await labels.delete('gone');
  expect(az.tags).toEqual(['docs']);
  expect(items.map((item) => item.tags)).toEqual(['docs', '']);
});

test('adding a tag keeps every other tag on the work item, however many it has, and tests its revision', async () => {
  const items: WorkItem[] = [{ id: 7, rev: 4, type: 'User Story', state: 'New', tags: manyTags.join('; ') }];
  const { az, labels } = azure(items);
  await labels.addToTicket(7, ['brand new', 'TAG-1']);
  expect(items[0]!.tags).toBe([...manyTags, 'brand new'].join('; '));
  expect(az.patches[0]!.ops[0]).toEqual({ op: 'test', path: '/rev', value: 4 });
});

test('adding a tag to a work item with none sets just that tag', async () => {
  const items: WorkItem[] = [{ id: 7, type: 'User Story', state: 'New' }];
  await azure(items).labels.addToTicket(7, ['first']);
  expect(items[0]!.tags).toBe('first');
});

test('removing a tag keeps every other tag, ignores its case and clears the field when none remain', async () => {
  const items: WorkItem[] = [{ id: 7, type: 'User Story', state: 'New', tags: manyTags.join('; ') }, { id: 8, type: 'User Story', state: 'New', tags: 'only' }];
  const { labels } = azure(items);
  await labels.removeFromTicket(7, ['TAG-2']);
  expect(items[0]!.tags).toBe(manyTags.filter((tag) => tag !== 'tag-2').join('; '));
  await labels.removeFromTicket(8, ['only']);
  expect(items[1]!.tags).toBe('');
});

test('a change with nothing to do writes nothing', async () => {
  const items: WorkItem[] = [{ id: 7, type: 'User Story', state: 'New', tags: 'one' }];
  const { az, labels } = azure(items);
  await labels.addToTicket(7, ['ONE']);
  await labels.removeFromTicket(7, ['two']);
  expect(az.patches).toEqual([]);
});

test('a work item changed since the read is refused and keeps its tags', async () => {
  const items: WorkItem[] = [{ id: 7, type: 'User Story', state: 'New', tags: 'one' }];
  const { az, labels } = azure(items, [], (args) => {
    if (args[0] === 'rest') items[0]!.rev = 9;
    return undefined;
  });
  await expect(labels.addToTicket(7, ['two'])).rejects.toThrow('TF26071');
  expect(items[0]!.tags).toBe('one');
  expect(az.patches).toEqual([]);
});

test('the fake refuses a tag create, as Azure documents none', async () => {
  const { az } = azure([], []);
  await expect(az.run(['devops', 'invoke', '--area', 'wit', '--resource', 'tags', '--route-parameters', 'project=p', 'tagIdOrName=new', '--http-method', 'PUT', '--api-version', '7.1']))
    .rejects.toThrow('fake az: unexpected');
  expect(az.tags).toEqual([]);
});
