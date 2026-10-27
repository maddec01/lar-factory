import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { CreationProgress, ItemDraft } from '@lar-factory/shared';
import { azureBacklog } from './azure-backlog.ts';
import { azureSprint } from './azure-sprint.ts';
import { fakeAz } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const TEAM = 'Fabrikam Team';
const DRAFT: ItemDraft = { repo: REPO, kind: 'feature', title: 'Export the report', description: 'As **CSV**.', labels: [] };

test('Add item creates the requirement level default type of an Agile, a Scrum and a CMMI team', async () => {
  for (const requirement of ['User Story', 'Product Backlog Item', 'Requirement']) {
    const az = fakeAz({ items: [], requirement });
    const result = await azureSprint([REPO], TEAM, az.run).create(DRAFT, {});
    assert.equal(result.error, null);
    assert.deepEqual(az.created.map((c) => c.type), [requirement]);
    const create = az.calls.find((args) => args.includes('type=' + requirement))!;
    assert.ok(create.includes('project=Fabrikam Fiber'));
    assert.equal(create[create.indexOf('--http-method') + 1], 'POST');
  }
});

test('the new work item carries its title, its markdown description and its kind, labels and status-list as tags', async () => {
  const az = fakeAz({ items: [] });
  const result = await azureBacklog([REPO], TEAM, az.run).create({ ...DRAFT, labels: ['area: api'] }, {});
  assert.deepEqual(az.created[0]!.ops, [
    { op: 'add', path: '/fields/System.Title', value: 'Export the report' },
    { op: 'add', path: '/fields/System.Description', value: 'As **CSV**.' },
    { op: 'add', path: '/multilineFieldsFormat/System.Description', value: 'Markdown' },
    { op: 'add', path: '/fields/System.Tags', value: 'feature; area: api; status-list' },
  ]);
  const id = az.created[0]!.id;
  assert.deepEqual(result, {
    error: null,
    issueUrl: `https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/${id}`,
    item: {
      id: `azure:contoso/${id}`, status: 'List', statuses: ['List'], content: 'ticket', number: id, title: 'Export the report',
      url: `https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/${id}`, repo: REPO, untaggedFor: [REPO], labels: ['feature', 'area: api'],
      state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
      updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
    },
  });
});

test('a retry after a try that may have created the work item creates no second one', async () => {
  let fail = true;
  const az = fakeAz({ items: [], fail: (args) => (fail && args.includes('POST') ? new Error('az devops invoke failed: timed out') : undefined) });
  const source = azureSprint([REPO], TEAM, az.run);
  const progress: CreationProgress = {};
  const first = await source.create(DRAFT, progress);
  assert.equal(first.uncertain, true);
  fail = false;
  const retry = await source.create(DRAFT, progress);
  assert.equal(retry.uncertain, true);
  assert.match(retry.error!, /could not be confirmed/);
  assert.deepEqual(az.created, []);
});

test('a retry after a created work item returns it without creating another', async () => {
  const az = fakeAz({ items: [] });
  const source = azureSprint([REPO], TEAM, az.run);
  const progress: CreationProgress = {};
  const first = await source.create(DRAFT, progress);
  assert.deepEqual(await source.create(DRAFT, progress), first);
  assert.equal(az.created.length, 1);
});

test('a try that failed before creating, or that az refused while logged out, creates the work item on retry', async () => {
  for (const failure of ['backlogconfiguration', 'POST']) {
    let fail = true;
    const az = fakeAz({ items: [], fail: (args) => (fail && args.join(' ').includes(failure)
      ? new Error('Before you can run Azure DevOps commands, you need to run the login command (az login)') : undefined) });
    const source = azureSprint([REPO], TEAM, az.run);
    const progress: CreationProgress = {};
    const first = await source.create(DRAFT, progress);
    assert.equal(first.error, 'Could not create the work item. az is logged out. Run az login, then try again.');
    assert.equal(first.uncertain, undefined);
    fail = false;
    assert.equal((await source.create(DRAFT, progress)).error, null);
    assert.equal(az.created.length, 1);
  }
});

test('a work item whose new tags need a right the user lacks names the fix', async () => {
  const az = fakeAz({ items: [], fail: (args) => (args.includes('POST')
    ? new Error('az devops invoke failed: TF401289: The current user does not have permissions to create tags.') : undefined) });
  const result = await azureSprint([REPO], TEAM, az.run).create(DRAFT, {});
  assert.match(result.error!, /^Could not create the work item\. You have no right to create tags in Fabrikam Fiber\./);
  assert.equal(result.uncertain, undefined);
});
