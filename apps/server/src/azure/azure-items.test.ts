import { azureBoard } from './azure-board.ts';
import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item } from '@lar-factory/shared';
import { PR_READS, SETTINGS_TTL, azureItems } from './azure-items.ts';
import { fakeAz, type WorkItem } from './fake-az.ts';

const WEB = 'contoso/Fabrikam%20Fiber/web';
const API = 'contoso/Fabrikam%20Fiber/Web%20Api';
const TEAM = 'Fabrikam Team';

const placed = (items: Item[]) => items.map((i) => [i.number, i.repo, i.untaggedFor ?? null]);

test("with web and api reading one sprint, an untagged item is for both, and a repo- tag places it in its repository's List only", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New' },
    { id: 2, type: 'User Story', state: 'New', tags: 'repo-web; area-ui' },
    { id: 3, type: 'User Story', state: 'New', tags: 'repo-Web Api' },
  ];
  const read = await azureBoard([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[1, WEB, [WEB, API]], [2, WEB, null], [3, API, null]]);
  assert.deepEqual(read.items[1]!.labels, ['area-ui'], 'the repository tag is no label');
});

test('a repo- tag matches its repository whatever its case', async () => {
  const items: WorkItem[] = [{ id: 1, type: 'User Story', state: 'New', tags: 'REPO-WEB API' }];
  const read = await azureBoard([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[1, API, null]]);
});

test("an item tagged for a repository that isn't onboarded, or with two repo- tags, is hidden with its Tasks", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'repo-mobile' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 2, type: 'User Story', state: 'New', tags: 'repo-web; repo-Web Api' },
    { id: 3, type: 'User Story', state: 'New', tags: 'repo-web' },
  ];
  const read = await azureBoard([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[3, WEB, null]]);
});

test("Tasks contribute to parent counts without becoming board items", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'repo-web' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 12, type: 'Task', state: 'New', parent: 1, tags: 'repo-web api' },
    { id: 2, type: 'User Story', state: 'New' },
    { id: 21, type: 'Task', state: 'New', parent: 2 },
  ];
  const read = await azureBoard([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[1, WEB, null], [2, WEB, [WEB, API]]]);
  assert.deepEqual(read.items.map((i) => i.subIssues), [{ total: 2, completed: 0 }, { total: 1, completed: 0 }]);
});

test('one repository reading the sprint still leaves an untagged item untagged, for Start to tag', async () => {
  const read = await azureBoard([WEB], TEAM, fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }] }).run).read();
  assert.deepEqual(placed(read.items), [[1, WEB, [WEB]]]);
});

test("a ticket search lists the open backlog items for the repository whose title has every word, and a number reads that item alone", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', title: 'Export the report' },
    { id: 2, type: 'User Story', state: 'Active', title: 'Report export for api', tags: 'repo-Web Api' },
    { id: 3, type: 'User Story', state: 'Closed', title: 'Export old report' },
    { id: 4, type: 'User Story', state: 'New', title: 'Export a report', tags: 'repo-web' },
    { id: 5, type: 'User Story', state: 'New', title: 'Import a report' },
  ];
  const source = azureBoard([WEB, API], TEAM, fakeAz({ items }).run);
  const url = (id: number) => `https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/${id}`;
  assert.deepEqual(await source.searchTickets(API, 'EXPORT report'), [{ number: 1, title: 'Export the report', url: url(1) }, { number: 2, title: 'Report export for api', url: url(2) }]);
  assert.deepEqual(await source.searchTickets(API, '#5'), [{ number: 5, title: 'Import a report', url: url(5) }]);
  assert.deepEqual(await source.searchTickets(API, '4'), [], "another repository's item");
});

test("a ticket read gives an open work item's description and kind, and nothing for a closed one or another repository's", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', title: 'Export', tags: 'bug', description: '## Steps', descriptionFormat: 'Markdown' },
    { id: 2, type: 'User Story', state: 'Closed', title: 'Old' },
    { id: 3, type: 'User Story', state: 'New', title: 'Theirs', tags: 'repo-web' },
  ];
  const source = azureBoard([WEB, API], TEAM, fakeAz({ items }).run);
  assert.deepEqual(await source.readTicket(API, 1),
    { number: 1, title: 'Export', url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/1', text: '## Steps', kind: 'bug' });
  assert.equal(await source.readTicket(API, 2), null);
  assert.equal(await source.readTicket(API, 3), null);
  assert.equal(await source.readTicket(API, 99), null);
});

test('a ticket observation reads a work item open or not, with its assignee, and a confirmed not-found', async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'Active', title: 'Export', assignedTo: 'Ana Silva' },
    { id: 2, type: 'User Story', state: 'Closed', title: 'Old', tags: 'repo-web' },
    { id: 3, type: 'User Story', state: 'Removed', title: 'Abandoned', tags: 'repo-web' },
  ];
  const source = azureBoard([WEB, API], TEAM, fakeAz({ items }).run);
  assert.deepEqual(await source.observeTicket(API, 1), { abandonmentComplete: false, state: 'open', assignee: 'Ana Silva' });
  assert.deepEqual(await source.observeTicket(API, 2), { abandonmentComplete: false, state: 'closed' });
  assert.deepEqual(await source.observeTicket(API, 3), { abandonmentComplete: true, state: 'closed' });
  assert.deepEqual(await source.observeTicket(API, 99), { state: 'not-found' });
});

/** A source that lists every work item the fake has, on a clock the test moves. */
const clocked = (az: ReturnType<typeof fakeAz>, clock: { now: number }) =>
  azureItems([WEB], TEAM, async ({ workItems }) => ({ title: 'Sprint', items: await workItems([1, 2]), completed: true }), az.run, () => clock.now);

test("a source reads the team's backlog levels and each type's states once per SETTINGS_TTL for its reads and writes, and again after a failed read", async () => {
  const clock = { now: 0 };
  let failing = true;
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }, { id: 2, type: 'Task', state: 'New', parent: 1 }],
    fail: (args) => (failing && args.includes('backlogconfiguration') ? new Error('az devops invoke failed: timed out') : undefined) });
  const source = clocked(az, clock);
  await assert.rejects(source.read());
  failing = false;
  const reads = (resource: string) => az.calls.filter((c) => c[c.indexOf('--resource') + 1] === resource).length;
  await source.read();
  clock.now = SETTINGS_TTL - 1;
  await source.read();
  assert.equal(await source.abandon({ number: 1 } as Item), null);
  assert.deepEqual([reads('backlogconfiguration'), reads('workitemtypestates')], [2, 2], 'the failed read, then one read of each, which a write reuses');
  clock.now = SETTINGS_TTL;
  await source.read();
  assert.deepEqual([reads('backlogconfiguration'), reads('workitemtypestates')], [3, 4]);
});

test(`a read runs at most ${PR_READS} az repos pr show calls at once`, async () => {
  const prs = Array.from({ length: 10 }, (_, i) => i + 41);
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New', prs }],
    pullRequests: prs.map((pullRequestId) => ({ pullRequestId, status: 'active', sourceRefName: 'refs/heads/x' })) });
  let running = 0;
  let most = 0;
  const run = async (args: string[]) => {
    if (args.slice(0, 3).join(' ') !== 'repos pr show') return az.run(args);
    most = Math.max(most, ++running);
    await new Promise((resolve) => setTimeout(resolve, 1));
    running--;
    return az.run(args);
  };
  const [item] = (await azureBoard([WEB], TEAM, run).read()).items;
  assert.equal(item!.linkedPrs.length, 10);
  assert.equal(most, PR_READS);
});

test("an item whose type has no Removed state, such as Basic's Issue, carries why Abandon can't run; one whose type has one carries nothing", async () => {
  const items: WorkItem[] = [{ id: 1, type: 'Issue', state: 'To Do' }, { id: 11, type: 'Task', state: 'New', parent: 1 }];
  const [issue] = (await azureBoard([WEB], TEAM, fakeAz({ items, requirement: 'Issue' }).run).read()).items;
  assert.equal(issue!.abandonRefusal, "Issue has no Removed state in Fabrikam Fiber, so the board can't abandon it. Close or delete it in Azure DevOps.");
});

test('an item read alone keeps sprint child counts without relisting the sprint', async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'repo-web' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 2, type: 'User Story', state: 'New', tags: 'repo-web' },
  ];
  const az = fakeAz({ items });
  const sprint = azureBoard([WEB, API], TEAM, az.run);
  const read = await sprint.read();
  az.calls.length = 0;
  const some = await sprint.readSome!([read.items.find((i) => i.number === 1)!]);
  assert.deepEqual(placed(some), [[1, WEB, null]]);
  assert.deepEqual(some[0]!.subIssues, { total: 1, completed: 0 });
  assert.equal(az.calls.some((args) => args.includes('iteration') || args.includes('wiql')), false, 'no listing call');
});

test('native Azure type, state and assignee survive independently of factory status', async () => {
  const az = fakeAz({ items: [{ id: 1, type: 'Product Backlog Item', state: 'Committed', assignedTo: 'Ana Silva' }], requirement: 'Product Backlog Item' });
  const [item] = (await azureBoard([WEB], TEAM, az.run).read()).items;
  assert.equal(item!.status, 'List');
  assert.deepEqual(item!.azure, { type: 'Product Backlog Item', state: 'Committed', assignee: 'Ana Silva' });
});

test('sprint counts stay scoped when a listing also contains children from the backlog', async () => {
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' },
    { id: 11, type: 'Task', state: 'Active', parent: 1 }, { id: 12, type: 'Task', state: 'Closed', parent: 1 }] });
  const source = azureItems([WEB], TEAM, async ({ workItems }) => ({ title: 'Team', items: await workItems([1, 11, 12]), childIds: [11], completed: true }), az.run);
  const [item] = (await source.read()).items;
  assert.deepEqual(item!.subIssues, { total: 1, completed: 0 });
});
