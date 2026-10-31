import { azureBoard } from './azure-board.ts';
import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item, Status } from '@lar-factory/shared';
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

const stateTo = (state: string) => ({ op: 'replace', path: '/fields/System.State', value: state });

test('Abandon moves the work item to its Removed-category state, and names a type with none', async () => {
  const story = await board(4);
  assert.equal(await story.source.abandon(story.item), null);
  assert.deepEqual(story.az.patches, [{ id: 4, ops: [{ op: 'test', path: '/rev', value: 1 }, stateTo('Removed')] }]);
  const issue = await board(5);
  assert.equal(await issue.source.abandon(issue.item),
    'Could not abandon work item 5. Issue in Fabrikam Fiber has no Removed-category state. Close or delete it in Azure DevOps.');
  assert.deepEqual(issue.az.patches, []);
});

test('Abandon reads the work item with one batch read and PATCHes it through az rest at 7.1, testing its rev', async () => {
  const { az, source, item } = await board(4);
  const before = az.calls.length;
  assert.equal(await source.abandon(item), null);
  const read = az.calls[before];
  const patch = az.calls.at(-1);
  assert.equal(read![read!.indexOf('--resource') + 1], 'workitemsbatch');
  assert.deepEqual(patch!.slice(0, 3), ['rest', '--method', 'patch']);
  assert.equal(patch![patch!.indexOf('--url') + 1], 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_apis/wit/workitems/4?api-version=7.1');
  assert.deepEqual(az.patches[0]!.ops[0], { op: 'test', path: '/rev', value: 1 });
});

test('a logged-out az shows its fix, and any other az error shows as it is', async () => {
  const loggedOut = await board(4, (args) => (args[0] === 'rest' && args.includes('patch') ? new Error('Please run az login to set up an account.') : undefined));
  assert.equal(await loggedOut.source.abandon(loggedOut.item), 'Could not abandon work item 4. az is logged out. Run az login, then try again.');
  const changed = await board(4, (args) => (args[0] === 'rest' && args.includes('patch') ? new Error('az devops invoke failed: TF26071: changed since you opened it') : undefined));
  assert.equal(await changed.source.abandon(changed.item), 'Could not abandon work item 4. az devops invoke failed: TF26071: changed since you opened it');
});

const workItem = (number: number) => ({ id: `azure:contoso/${number}`, content: 'ticket', revision: 0, kind: 'issue', parentId: null, repo: REPO, number } as Item);

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
