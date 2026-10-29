import { azureBoard } from './azure-board.ts';
import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item, Status } from '@lar-factory/shared';
import { DONE_REFUSED } from '../items/item-source.ts';
import { saveAzureDescription } from './azure-writes.ts';
import { fakeAz, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const TEAM = 'Fabrikam Team';

const ITEMS: WorkItem[] = [
  { id: 1, type: 'User Story', state: 'New', tags: 'area-api; status-queued' },
  { id: 2, type: 'Product Backlog Item', state: 'Committed', tags: 'status-shaping' },
  { id: 3, type: 'User Story', state: 'Closed', tags: 'status-verify; area-api' },
  { id: 4, type: 'User Story', state: 'Active', tags: 'status-shaping; area-api' },
  { id: 5, type: 'Issue', state: 'To Do' },
  { id: 6, type: 'User Story', state: 'New', tags: 'status-review; status-queued' },
  { id: 7, type: 'User Story', state: 'New', tags: Array.from({ length: 100 }, (_, i) => `tag-${i + 1}`).join('; ') },
];

/** The sprint over ITEMS, its fake az, and the item numbered `id` as the board read it. */
async function board(id: number, fail?: (args: string[]) => Error | undefined) {
  const az = fakeAz({ items: ITEMS, requirement: 'User Story', fail });
  const source = azureBoard([REPO], TEAM, az.run);
  const { items } = await source.read();
  // The read shows only the requirement level's type, so another type's item stands in as the first item renumbered.
  const item = items.find((i) => i.number === id) ?? { ...items[0]!, number: id, statuses: [] as Status[] };
  return { az, source, item };
}

const tagsAt = (tags: string) => [{ op: 'test', path: '/rev', value: 1 }, { op: 'replace', path: '/fields/System.Tags', value: tags }];
const stateTo = (state: string) => ({ op: 'replace', path: '/fields/System.State', value: state });

test('a Proposed item moved to Shaping or Review gets the status tag and its first InProgress-category state', async () => {
  for (const status of ['Shaping', 'Review'] as const) {
    const { az, source, item } = await board(1);
    assert.equal(await source.setStatus(item, status), null);
    assert.deepEqual(az.patches, [{ id: 1, ops: [...tagsAt(`area-api; status-${status.toLowerCase()}`), stateTo('Active')] }]);
  }
});

test('an item moved back to List or Queued gets its first Proposed-category state, from InProgress or Completed', async () => {
  const committed = await board(2);
  assert.equal(await committed.source.setStatus(committed.item, 'Queued'), null);
  assert.deepEqual(committed.az.patches, [{ id: 2, ops: [...tagsAt('status-queued'), stateTo('New')] }]);
  const closed = await board(3);
  assert.equal(await closed.source.setStatus(closed.item, 'List'), null);
  assert.deepEqual(closed.az.patches, [{ id: 3, ops: [...tagsAt('area-api; status-list'), stateTo('New')] }]);
});

test('a move within a category swaps the tag and leaves State alone', async () => {
  const { az, source, item } = await board(4);
  assert.equal(await source.setStatus(item, 'Review'), null);
  assert.deepEqual(az.patches, [{ id: 4, ops: tagsAt('area-api; status-review') }]);
});

test('Done is refused, and so is a move of an item carrying two status tags', async () => {
  const one = await board(4);
  assert.equal(await one.source.setStatus(one.item, 'Done'), DONE_REFUSED);
  assert.equal(await one.source.setParentStatus({ number: 4, title: '', url: '', repo: REPO, state: 'open' }, 'Done'), DONE_REFUSED);
  const two = await board(6);
  const refusal = 'This issue carries Queued and Review. Keep one to move it again.';
  assert.equal(two.source.statusRefusal(two.item), refusal);
  assert.equal(await two.source.setStatus(two.item, 'Shaping'), refusal);
  assert.equal(await two.source.setParentStatus({ number: 6, title: '', url: '', repo: REPO, state: 'open' }, 'Shaping'), refusal);
  assert.deepEqual([...one.az.patches, ...two.az.patches], []);
  assert.equal(one.source.statusRefusal(one.item), null);
});

test("a parent that isn't on the board moves the same way, read from Azure", async () => {
  const { az, source } = await board(4);
  assert.equal(await source.setParentStatus({ number: 1, title: 'Item 1', url: '', repo: REPO, state: 'open' }, 'Shaping'), null);
  assert.deepEqual(az.patches, [{ id: 1, ops: [...tagsAt('area-api; status-shaping'), stateTo('Active')] }]);
});

test('adding a label adds a tag and keeps the status tag; a tag it has is left alone', async () => {
  const { az, source, item } = await board(4);
  assert.equal(await source.addLabel(item, 'build'), null);
  assert.equal(await source.addLabel(item, 'area-api'), null);
  assert.deepEqual(az.patches, [{ id: 4, ops: tagsAt('status-shaping; area-api; build') }]);
});

test('a label with a comma or a semicolon is refused, as an Azure tag cannot hold one', async () => {
  const { az, source, item } = await board(4);
  const refusal = 'Could not add the a;b tag. An Azure DevOps tag cannot contain a comma or a semicolon. Name the label without them.';
  assert.equal(await source.addLabel(item, 'a;b'), refusal);
  assert.equal(await source.addLabel(item, 'a,b'), refusal.replace('a;b', 'a,b'));
  assert.deepEqual(az.patches, []);
});

test('Abandon moves the work item to its Removed-category state, and names a type with none', async () => {
  const story = await board(4);
  assert.equal(await story.source.abandon(story.item), null);
  assert.deepEqual(story.az.patches, [{ id: 4, ops: [{ op: 'test', path: '/rev', value: 1 }, stateTo('Removed')] }]);
  const issue = await board(5);
  assert.equal(await issue.source.abandon(issue.item),
    'Could not abandon work item 5. Issue in Fabrikam Fiber has no Removed-category state. Close or delete it in Azure DevOps.');
  assert.deepEqual(issue.az.patches, []);
});

test('a work item at the 100-tag limit gets no new tag, with the fix', async () => {
  const { az, source, item } = await board(7);
  const full = "Work item 7 has 100 tags, Azure's limit. Remove a tag in Azure DevOps, then try again.";
  assert.equal(await source.setStatus(item, 'Queued'), `Could not set Queued. ${full}`);
  assert.equal(await source.addLabel(item, 'build'), `Could not add the build tag. ${full}`);
  assert.deepEqual(az.patches, []);
});

test('a write reads the work item with one batch read and PATCHes it through az rest at 7.1, testing its rev', async () => {
  const { az, source, item } = await board(4);
  const before = az.calls.length;
  assert.equal(await source.addLabel(item, 'build'), null);
  const [read, patch] = az.calls.slice(before);
  assert.equal(read![read!.indexOf('--resource') + 1], 'workitemsbatch');
  assert.deepEqual(patch!.slice(0, 3), ['rest', '--method', 'patch']);
  assert.equal(patch![patch!.indexOf('--url') + 1], 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_apis/wit/workitems/4?api-version=7.1');
  assert.deepEqual(az.patches[0]!.ops[0], { op: 'test', path: '/rev', value: 1 });
});

test('no right to create tags shows its message and fix', async () => {
  const { source, item } = await board(4, (args) => (args[0] === 'rest' && args.includes('patch')
    ? new Error('az devops invoke failed: ERROR: TF401289: The current user does not have permissions to create tags.') : undefined));
  const fix = 'You have no right to create tags in Fabrikam Fiber. Ask a project administrator to allow you Create tag definition, then try again.';
  assert.equal(await source.addLabel(item, 'build'), `Could not add the build tag. ${fix}`);
  assert.equal(await source.setStatus(item, 'Review'), `Could not set Review. ${fix}`);
});

test('a logged-out az shows its fix, and any other az error shows as it is', async () => {
  const loggedOut = await board(4, (args) => (args[0] === 'rest' && args.includes('patch') ? new Error('Please run az login to set up an account.') : undefined));
  assert.equal(await loggedOut.source.setStatus(loggedOut.item, 'Review'), 'Could not set Review. az is logged out. Run az login, then try again.');
  const changed = await board(4, (args) => (args[0] === 'rest' && args.includes('patch') ? new Error('az devops invoke failed: TF26071: changed since you opened it') : undefined));
  assert.equal(await changed.source.abandon(changed.item), 'Could not abandon work item 4. az devops invoke failed: TF26071: changed since you opened it');
});

const workItem = (number: number) => ({ id: `azure:contoso/${number}`, content: 'ticket', repo: REPO, number } as Item);

test('a saved description replaces the field the details read, as markdown, at 7.2-preview.3 and testing the rev read', async () => {
  const az = fakeAz({ items: ITEMS });
  assert.equal(await saveAzureDescription(workItem(4), { body: '- a\n- b', bodyField: 'System.Description', revision: 1 }, az.run), null);
  const patch = az.calls.at(-1)!;
  assert.equal(patch[patch.indexOf('--url') + 1], 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_apis/wit/workitems/4?api-version=7.2-preview.3');
  assert.deepEqual(az.patches, [{ id: 4, ops: [
    { op: 'test', path: '/rev', value: 1 },
    { op: 'replace', path: '/fields/System.Description', value: '- a\n- b' },
    { op: 'replace', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
  ] }]);
});

test('a Bug whose description came from Repro Steps saves to Repro Steps', async () => {
  const az = fakeAz({ items: [{ id: 9, type: 'Bug', state: 'New', description: '', reproSteps: '<p>Open it.</p>' }] });
  assert.equal(await saveAzureDescription(workItem(9), { body: 'Open **it**.', bodyField: 'Microsoft.VSTS.TCM.ReproSteps', revision: 1 }, az.run), null);
  assert.deepEqual(az.patches[0]!.ops.slice(1), [
    { op: 'replace', path: '/fields/Microsoft.VSTS.TCM.ReproSteps', value: 'Open **it**.' },
    { op: 'replace', path: '/multilineFieldsFormat/Microsoft.VSTS.TCM.ReproSteps', value: 'Markdown' },
  ]);
});

test('a work item changed since its details were read is a conflict, and writes nothing', async () => {
  const az = fakeAz({ items: [{ ...ITEMS[3]!, rev: 3 }] });
  assert.deepEqual(await saveAzureDescription(workItem(4), { body: 'New.', bodyField: 'System.Description', revision: 2 }, az.run),
    { status: 409, error: 'Could not save the description. Someone else changed work item 4 since you opened it. Copy your text, close the item and open it again to edit the latest version.' });
  assert.deepEqual(az.patches, []);
});

test('no right to edit the work item, a logged-out az and any other az error each answer their message', async () => {
  const failing = (message: string) => fakeAz({ items: ITEMS, fail: (args) => (args[0] === 'rest' ? new Error(message) : undefined) });
  const save = (message: string) => saveAzureDescription(workItem(4), { body: 'New.', bodyField: 'System.Description', revision: 1 }, failing(message).run);
  assert.deepEqual(await save('ERROR: TF237111: The current user does not have permissions to save work items under the specified area path.'),
    { status: 403, error: 'Could not save the description. You have no right to edit work item 4 in Fabrikam Fiber. Ask a project administrator for Edit work items in this node.' });
  assert.deepEqual(await save('Please run az login to set up an account.'), { status: 502, error: 'Could not save the description. az is logged out. Run az login, then try again.' });
  assert.deepEqual(await save('az rest failed: timed out'), { status: 502, error: 'Could not save the description. az rest failed: timed out' });
});

test('an item that is not an Azure DevOps work item is refused', async () => {
  const az = fakeAz({ items: ITEMS });
  assert.deepEqual(await saveAzureDescription({ ...workItem(4), repo: 'maddec01/lar' }, { body: 'x', bodyField: 'System.Description', revision: 1 }, az.run),
    { status: 404, error: 'That item is not an Azure DevOps work item.' });
});
