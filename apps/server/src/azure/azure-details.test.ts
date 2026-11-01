import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item } from '@lar-factory/shared';
import { readAzureItemDetails, readAzureOlderComments } from './azure-details.ts';
import { fakeAz, type FakeComment, type WorkItem } from './fake-az.ts';

const REPO = 'contoso/Fabrikam%20Fiber/lar-api';
const item = (number: number): Item => ({ id: `azure:contoso/${number}`, content: 'ticket', revision: 0, kind: 'issue', parentId: null, repo: REPO, number } as Item);
const workItem = (extra: Partial<WorkItem> = {}): WorkItem => ({ id: 5, type: 'User Story', state: 'Active', createdBy: 'Ana Silva', assignedTo: 'Rui Costa',
  created: '2026-10-12T09:14:00Z', iteration: 'Fabrikam Fiber\\Sprint 12', ...extra });
const comment = (id: number, extra: Partial<FakeComment> = {}): FakeComment => ({ id, by: 'Ana Silva', date: `2026-10-${10 + id}T08:00:00Z`, text: `Comment ${id}`, format: 'markdown', ...extra });

test('a markdown description answers with its people, dates, iteration and area', async () => {
  const az = fakeAz({ items: [workItem({ description: '## Export\n\nAs **CSV**.', descriptionFormat: 'Markdown' })] });
  assert.deepEqual(await readAzureItemDetails(item(5), az.run), {
    body: '## Export\n\nAs **CSV**.', format: 'markdown', bodyField: 'System.Description', revision: 1, author: 'Ana Silva', assignees: ['Rui Costa'], createdAt: '2026-10-12T09:14:00Z',
    iteration: 'Fabrikam Fiber\\Sprint 12', area: 'Fabrikam Fiber\\Fabrikam Team', subTickets: [], comments: [], hasOlderComments: false, olderCursor: null,
  });
});

test('an HTML description is answered as HTML', async () => {
  const az = fakeAz({ items: [workItem({ description: '<div>As <b>CSV</b>.</div>', descriptionFormat: 'Html' })] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.body, details.format], ['<div>As <b>CSV</b>.</div>', 'html']);
});

test('a description whose format is missing is HTML when it opens with a tag, else markdown', async () => {
  for (const [description, format] of [['<div>Hi</div>', 'html'], ['  <p>Hi</p>', 'html'], ['Hi <b>there</b>', 'markdown'], ['# Hi', 'markdown'], ['', 'markdown']]) {
    const az = fakeAz({ items: [workItem({ description })] });
    const details = await readAzureItemDetails(item(5), az.run);
    assert.ok(!('error' in details));
    assert.equal(details.format, format, description);
  }
});

test('the work item is one batch read at 7.2-preview and its comments are read at 7.1-preview, 10 newest first', async () => {
  const az = fakeAz({ items: [workItem()] });
  await readAzureItemDetails(item(5), az.run);
  const version = (resource: string) => { const call = az.calls.find((args) => args.includes(resource))!; return call[call.indexOf('--api-version') + 1]; };
  assert.deepEqual([version('workitemsbatch'), version('comments')], ['7.2-preview', '7.1-preview']);
  assert.deepEqual(az.batches, [[5]]);
  const comments = az.calls.find((args) => args.includes('comments'))!;
  assert.deepEqual(comments.slice(comments.indexOf('--query-parameters') + 1, comments.indexOf('--query-parameters') + 3), ['$top=10', 'order=desc']);
  assert.ok(comments.includes('workItemId=5') && comments.includes('project=Fabrikam Fiber') && comments.includes('https://dev.azure.com/contoso'));
});

test('comments of mixed formats answer newest first, each in its own format', async () => {
  const az = fakeAz({ items: [workItem({ comments: [comment(1), comment(2, { format: 'html', text: '<p>Two</p>' }), comment(3, { format: undefined, text: '<div>Three</div>' }), comment(4, { format: undefined })] })] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual(details.comments.map((c) => [c.id, c.format]), [['4', 'markdown'], ['3', 'html'], ['2', 'html'], ['1', 'markdown']]);
  assert.deepEqual(details.comments[0], { id: '4', author: 'Ana Silva', createdAt: '2026-10-14T08:00:00Z', body: 'Comment 4', format: 'markdown' });
  assert.deepEqual([details.hasOlderComments, details.olderCursor], [false, null]);
});

test('more than 10 comments answer the newest 10 and the token of the older ones', async () => {
  const az = fakeAz({ items: [workItem({ comments: Array.from({ length: 12 }, (_, i) => comment(i + 1)) })] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.comments.length, details.comments[0]!.id, details.comments[9]!.id, details.hasOlderComments, details.olderCursor], [10, '12', '3', true, '10']);
});

test('a work item with no description, people or comments answers empty details', async () => {
  const az = fakeAz({ items: [{ id: 5, type: 'Task', state: 'New' }] });
  assert.deepEqual(await readAzureItemDetails(item(5), az.run), {
    body: '', format: 'markdown', bodyField: 'System.Description', revision: 1, author: null, assignees: [], createdAt: null, area: 'Fabrikam Fiber\\Fabrikam Team', subTickets: [], comments: [], hasOlderComments: false, olderCursor: null,
  });
});

test('the child work items answer as sub-tickets, Completed ones closed and Removed ones left out, from one batch read', async () => {
  const az = fakeAz({ items: [workItem({ type: 'User Story' }),
    { id: 6, type: 'Task', state: 'Active', parent: 5, title: 'Write the exporter' }, { id: 7, type: 'Task', state: 'Closed', parent: 5, title: 'Add the button' },
    { id: 8, type: 'Task', state: 'Removed', parent: 5, title: 'Dropped idea' }, { id: 9, type: 'Task', state: 'Active', title: 'Unrelated' }] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual(details.subTickets, [
    { number: 6, title: 'Write the exporter', url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/6', repo: REPO, state: 'open', azure: { type: 'Task', state: 'Active', assignee: null } },
    { number: 7, title: 'Add the button', url: 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/7', repo: REPO, state: 'closed', azure: { type: 'Task', state: 'Closed', assignee: null } },
  ]);
  assert.deepEqual(az.batches, [[5], [6, 7, 8]]);
});

test('a work item with no child links reads no batch', async () => {
  const az = fakeAz({ items: [workItem()] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.subTickets, az.batches], [[], [[5]]]);
});

test('an az failure answers its message', async () => {
  const az = fakeAz({ items: [workItem()], fail: (args) => (args.includes('comments') ? new Error('az devops invoke failed: timed out') : undefined) });
  assert.deepEqual(await readAzureItemDetails(item(5), az.run), { status: 502, error: 'az devops invoke failed: timed out' });
});

test('a logged-out az answers the fix', async () => {
  const az = fakeAz({ items: [workItem()], fail: () => new Error('Please run az login to setup account.') });
  const answer = await readAzureItemDetails(item(5), az.run);
  assert.ok('error' in answer && /az login/.test(answer.error));
});

test('a work item az no longer finds answers 404', async () => {
  const az = fakeAz({ items: [] });
  assert.deepEqual(await readAzureItemDetails(item(5), az.run), { status: 404, error: 'Work item 5 does not exist, or you have no right to read it.' });
});

test('an item without an Azure DevOps repository answers 404', async () => {
  const az = fakeAz({ items: [] });
  assert.deepEqual(await readAzureItemDetails({ ...item(5), repo: 'maddec01/lar' }, az.run), { status: 404, error: 'That item is not an Azure DevOps work item.' });
});

test('older comments are one comments call with the continuation token, 10 newest first, and the next token', async () => {
  const az = fakeAz({ items: [workItem({ comments: Array.from({ length: 25 }, (_, i) => comment(i + 1)) })] });
  const page = await readAzureOlderComments(item(5), '10', az.run);
  assert.ok(!('error' in page));
  assert.deepEqual([page.comments.length, page.comments[0]!.id, page.comments[9]!.id, page.olderCursor], [10, '15', '6', '20']);
  assert.equal(az.calls.length, 1);
  const call = az.calls[0]!;
  assert.ok(call.includes('comments') && call.includes('workItemId=5'));
  assert.deepEqual(call.slice(call.indexOf('--query-parameters') + 1, call.indexOf('--query-parameters') + 4), ['$top=10', 'order=desc', 'continuationToken=10']);
  assert.equal(call[call.indexOf('--api-version') + 1], '7.1-preview');
});

test('the oldest page answers no token', async () => {
  const az = fakeAz({ items: [workItem({ comments: Array.from({ length: 12 }, (_, i) => comment(i + 1)) })] });
  const page = await readAzureOlderComments(item(5), '10', az.run);
  assert.ok(!('error' in page));
  assert.deepEqual([page.comments.map((c) => c.id), page.olderCursor], [['2', '1'], null]);
});

const managed = (id: number) => comment(id, { text: id % 2 ? '<!-- lar-factory:chunk version=1 -->\nc2VjcmV0LWJhc2U2NA==' : '<!-- lar-factory:structure\n{}\n-->' });
const commentCalls = (az: ReturnType<typeof fakeAz>) => az.calls.filter((args) => args.includes('comments'));

test('details and older pages skip managed-only history to its end without exposing transport comments', async () => {
  for (const older of [false, true]) {
    const az = fakeAz({ items: [workItem({ description: 'Human description.\n\n<!-- lar-factory:structure\n{}\n-->', comments: Array.from({ length: 125 }, (_, i) => managed(i + 1)) })] });
    const page = older ? await readAzureOlderComments(item(5), '0', az.run) : await readAzureItemDetails(item(5), az.run);
    assert.ok(!('error' in page));
    assert.deepEqual([page.comments, page.olderCursor], [[], null]);
    if ('hasOlderComments' in page && 'body' in page) assert.deepEqual([page.hasOlderComments, page.body], [false, 'Human description.']);
    assert.equal(commentCalls(az).length, 3);
    assert.doesNotMatch(JSON.stringify(page), /lar-factory:|c2VjcmV0/);
  }
});

test('managed-only leading pages reveal all ordinary discussion from the larger lookahead page', async () => {
  const human = Array.from({ length: 30 }, (_, i) => comment(i + 1));
  for (const older of [false, true]) {
    const az = fakeAz({ items: [workItem({ comments: [...human, ...Array.from({ length: 15 }, (_, i) => managed(i + 31))] })] });
    const page = older ? await readAzureOlderComments(item(5), '0', az.run) : await readAzureItemDetails(item(5), az.run);
    assert.ok(!('error' in page));
    assert.deepEqual(page.comments.map((c) => c.id), human.map((c) => String(c.id)).reverse());
    assert.equal(page.olderCursor, null);
    assert.equal(commentCalls(az).length, 2);
  }
});

test('large managed histories stop after three comments calls and preserve a continuation token', async () => {
  const az = fakeAz({ items: [workItem({ comments: [comment(1), ...Array.from({ length: 999 }, (_, i) => managed(i + 2))] })] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.comments, details.hasOlderComments, details.olderCursor, commentCalls(az).length], [[], true, '210', 3]);
  let cursor = details.olderCursor;
  while (cursor !== null) {
    const before = commentCalls(az).length;
    const page = await readAzureOlderComments(item(5), cursor, az.run);
    assert.ok(!('error' in page));
    assert.ok(commentCalls(az).length - before <= 3);
    cursor = page.olderCursor;
    if (cursor === null) assert.deepEqual(page.comments.map((c) => c.id), ['1']);
  }
});

test('ordinary history keeps ten-comment pages in order without gaps or duplicate comments', async () => {
  const az = fakeAz({ items: [workItem({ comments: Array.from({ length: 23 }, (_, i) => comment(i + 1)) })] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  const ids = details.comments.map((c) => c.id);
  let cursor = details.olderCursor;
  while (cursor !== null) {
    const page = await readAzureOlderComments(item(5), cursor, az.run);
    assert.ok(!('error' in page));
    ids.push(...page.comments.map((c) => c.id));
    cursor = page.olderCursor;
  }
  assert.deepEqual(ids, Array.from({ length: 23 }, (_, i) => String(23 - i)));
  assert.equal(commentCalls(az).length, 3);
});

test('older comments of a repository not on Azure DevOps, or of a failed az, answer the error', async () => {
  assert.deepEqual(await readAzureOlderComments({ id: 'I_1', content: 'ticket', revision: 0, kind: 'issue', parentId: null, repo: 'maddec01/lar', number: 5 } as Item, '10', fakeAz({ items: [] }).run), { status: 404, error: 'That item is not an Azure DevOps work item.' });
  const failing = async () => { throw new Error('az exploded'); };
  assert.deepEqual(await readAzureOlderComments(item(5), '10', failing), { status: 502, error: 'az exploded' });
});

test('details hydrate 217 children in batches of at most 200', async () => {
  const az = fakeAz({ items: [workItem({ description: 'Keep this description' }), ...Array.from({ length: 217 }, (_, i): WorkItem => ({ id: i + 10, type: 'Task', state: 'Closed', parent: 5 }))] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.equal(details.body, 'Keep this description');
  assert.equal(details.subTickets.length, 217);
  assert.deepEqual(az.batches.map((ids) => ids.length).sort((a, b) => a - b), [1, 17, 200]);
});

test('a child relations failure preserves the main description, people and comments and names the failed section', async () => {
  const az = fakeAz({ items: [workItem({ description: 'Main text', comments: [comment(1)] }), { id: 6, type: 'Task', state: 'Active', parent: 5 }],
    fail: (args) => args.includes('workitemtypestates') ? new Error('Relations unavailable') : undefined });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.body, details.assignees, details.comments.length, details.subTickets, details.relationsError], ['Main text', ['Rui Costa'], 1, [], 'Relations unavailable']);
});

test('an empty Bug description falls back to Repro Steps, keeping Acceptance Criteria and System Info', async () => {
  const az = fakeAz({ items: [workItem({ type: 'Bug', description: '<div><br></div>', reproSteps: '<p>Open the broken screen.</p>', acceptanceCriteria: 'The screen opens.', systemInfo: '<div>macOS</div>' })] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.body, details.format, details.bodyField], ['<p>Open the broken screen.</p>', 'html', 'Microsoft.VSTS.TCM.ReproSteps']);
  assert.deepEqual(details.sections, [{ title: 'Acceptance Criteria', body: 'The screen opens.', format: 'markdown' }, { title: 'System Info', body: '<div>macOS</div>', format: 'html' }]);
});

test('an empty description is read from System.Description, except on a Bug, whose description is its Repro Steps', async () => {
  for (const [type, bodyField] of [['Task', 'System.Description'], ['User Story', 'System.Description'], ['Bug', 'Microsoft.VSTS.TCM.ReproSteps']]) {
    const az = fakeAz({ items: [workItem({ type })] });
    const details = await readAzureItemDetails(item(5), az.run);
    assert.ok(!('error' in details));
    assert.equal(details.bodyField, bodyField, type);
  }
});

test('details keep named Azure attachments, Related work and predecessors alongside children', async () => {
  const url = 'https://dev.azure.com/contoso/_apis/wit/attachments/document-id';
  const az = fakeAz({ items: [workItem({ related: [9], predecessors: [7], attachments: [{ name: 'OAuth implementation.pdf', url }] }),
    { id: 6, type: 'Task', state: 'Active', parent: 5, title: 'Implement OAuth' },
    { id: 7, type: 'User Story', state: 'Active', title: 'Get credentials' },
    { id: 9, type: 'User Story', state: 'Closed', title: 'Integrate provider' }] });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual(details.attachments, [{ name: 'OAuth implementation.pdf', url }]);
  assert.deepEqual(details.related?.map((ref) => [ref.number, ref.title, ref.url, ref.state]), [
    [9, 'Integrate provider', 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/9', 'closed'],
  ]);
  assert.deepEqual(details.blockers?.map((ref) => [ref.number, ref.title, ref.url, ref.state]), [
    [7, 'Get credentials', 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_workitems/edit/7', 'open'],
  ]);
  assert.deepEqual(details.subTickets.map((ref) => ref.number), [6]);
});

test('attachments survive a failed relation read and only link to Azure over HTTPS', async () => {
  const url = 'https://dev.azure.com/contoso/_apis/wit/attachments/document-id';
  const az = fakeAz({ items: [workItem({ predecessors: [7], attachments: [
    { name: 'Evidence.pdf', url }, { name: 'Bad scheme', url: 'javascript:alert(1)' },
    { name: 'Insecure', url: 'http://dev.azure.com/contoso/doc' }, { name: 'Other host', url: 'https://dev.azure.com.example.com/doc' },
  ] }), { id: 7, type: 'Task', state: 'Active' }], fail: (args) => args.includes('workitemtypestates') ? new Error('Relations unavailable') : undefined });
  const details = await readAzureItemDetails(item(5), az.run);
  assert.ok(!('error' in details));
  assert.deepEqual(details.attachments, [{ name: 'Evidence.pdf', url }]);
  assert.equal(details.relationsError, 'Relations unavailable');
});

test('a Bug displays Repro Steps even when Description also contains text', async () => {
  const run = fakeAz({ items: [workItem({ type: 'Bug', description: 'Separate description.', reproSteps: '<p>Displayed steps.</p>' })] });
  const details = await readAzureItemDetails(item(5), run.run);
  if ('error' in details) throw Error(details.error);
  assert.equal(details.bodyField, 'Microsoft.VSTS.TCM.ReproSteps');
  assert.equal(details.body, '<p>Displayed steps.</p>');
  assert.deepEqual(details.sections, [{ title: 'Description', body: 'Separate description.', format: 'markdown' }]);
});
