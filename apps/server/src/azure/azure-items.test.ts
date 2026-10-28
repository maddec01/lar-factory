import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item } from '@lar-factory/shared';
import { azureBacklog } from './azure-backlog.ts';
import { PR_READS, SETTINGS_TTL, azureItems } from './azure-items.ts';
import { azureSprint } from './azure-sprint.ts';
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
  const read = await azureSprint([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[1, WEB, [WEB, API]], [2, WEB, null], [3, API, null]]);
  assert.deepEqual(read.items[1]!.labels, ['area-ui'], 'the repository tag is no label');
});

test('a repo- tag matches its repository whatever its case', async () => {
  const items: WorkItem[] = [{ id: 1, type: 'User Story', state: 'New', tags: 'REPO-WEB API' }];
  const read = await azureBacklog([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[1, API, null]]);
});

test("an item tagged for a repository that isn't onboarded, or with two repo- tags, is hidden with its Tasks", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'repo-mobile' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 2, type: 'User Story', state: 'New', tags: 'repo-web; repo-Web Api' },
    { id: 3, type: 'User Story', state: 'New', tags: 'repo-web' },
  ];
  const read = await azureSprint([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[3, WEB, null]]);
});

test("an untagged Task goes with its parent, and a tagged one is for the repository it names", async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'repo-web' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 12, type: 'Task', state: 'New', parent: 1, tags: 'repo-web api' },
    { id: 2, type: 'User Story', state: 'New' },
    { id: 21, type: 'Task', state: 'New', parent: 2 },
  ];
  const read = await azureSprint([WEB, API], TEAM, fakeAz({ items }).run).read();
  assert.deepEqual(placed(read.items), [[1, WEB, null], [11, WEB, null], [12, API, null], [2, WEB, [WEB, API]], [21, WEB, [WEB, API]]]);
  assert.equal(read.items[2]!.parent?.repo, WEB, 'the parent keeps its own repository');
});

test('one repository reading the sprint still leaves an untagged item untagged, for Start to tag', async () => {
  const read = await azureSprint([WEB], TEAM, fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }] }).run).read();
  assert.deepEqual(placed(read.items), [[1, WEB, [WEB]]]);
});

test('Add item tags the new work item for its repository only when Only for <repo> is ticked', async () => {
  const draft = { repo: API, kind: 'feature' as const, title: 'Export', description: '', labels: [] };
  const az = fakeAz({ items: [] });
  const source = azureSprint([WEB, API], TEAM, az.run);
  const shared = await source.create(draft, {});
  const only = await source.create({ ...draft, onlyFor: true }, {});
  assert.deepEqual(az.created.map((c) => c.ops.find((op) => op.path === '/fields/System.Tags')!.value), ['feature; status-list', 'feature; status-list; repo-Web Api']);
  assert.deepEqual(placed([shared.item!, only.item!]), [[shared.item!.number, API, [WEB, API]], [only.item!.number, API, null]]);
});

test('a repository tag goes on an untagged item, and an item tagged for another repository refuses a second', async () => {
  const az = fakeAz({ items: [{ id: 1, type: 'User Story', state: 'New' }, { id: 2, type: 'User Story', state: 'New', tags: 'repo-web' }] });
  const source = azureSprint([WEB, API], TEAM, az.run);
  const [one, two] = (await source.read()).items as [Item, Item];
  assert.equal(await source.addLabel(one, 'repo-web'), null);
  assert.match((await source.addLabel(two, 'repo-Web Api'))!, /already tagged for web/);
  assert.equal(await source.addLabel(two, 'repo-WEB'), null, 'its own tag in another case is already there');
  assert.deepEqual(az.patches.map((p) => [p.id, (p.ops[1] as { value: string }).value]), [[1, 'repo-web']]);
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
  const [item] = (await azureSprint([WEB], TEAM, run).read()).items;
  assert.equal(item!.linkedPrs.length, 10);
  assert.equal(most, PR_READS);
});

test("an item whose type has no Removed state, such as Basic's Issue, carries why Abandon can't run; one whose type has one carries nothing", async () => {
  const items: WorkItem[] = [{ id: 1, type: 'Issue', state: 'To Do' }, { id: 11, type: 'Task', state: 'New', parent: 1 }];
  const [issue, task] = (await azureSprint([WEB], TEAM, fakeAz({ items, requirement: 'Issue' }).run).read()).items;
  assert.equal(issue!.abandonRefusal, "Issue has no Removed state in Fabrikam Fiber, so the board can't abandon it. Close or delete it in Azure DevOps.");
  assert.equal(task!.abandonRefusal, undefined);
});

test('an item read alone reads its work item and its Tasks, with no sprint listing, and a Task asked for reads its parent', async () => {
  const items: WorkItem[] = [
    { id: 1, type: 'User Story', state: 'New', tags: 'repo-web' },
    { id: 11, type: 'Task', state: 'New', parent: 1 },
    { id: 2, type: 'User Story', state: 'New', tags: 'repo-web' },
  ];
  const az = fakeAz({ items });
  const sprint = azureSprint([WEB, API], TEAM, az.run);
  const read = await sprint.read();
  az.calls.length = 0;
  const some = await sprint.readSome!([read.items.find((i) => i.number === 11)!]);
  assert.deepEqual(placed(some), [[1, WEB, null], [11, WEB, null]]);
  assert.equal(az.calls.some((args) => args.includes('iteration') || args.includes('wiql')), false, 'no listing call');
});
