import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'vite-plus/test';
import { onboarded, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import type { ItemComment, ItemCommentsPage, ItemDetails } from '@lar-factory/shared';

const SAMPLE_DETAILS = JSON.parse(readFileSync(new URL(import.meta.resolve('@lar-factory/shared/test/sample-details.json')), 'utf8')) as Record<string, ItemDetails>;

const details = (board: Board, query: string) => fetch(`${board.url}/api/item-details${query}`);

test('sample mode answers an item with the details the sample file holds for it', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const id of ['I_sample13', 'I_sample26', 'I_sample04']) {
    const response = await details(board, `?itemId=${id}`);
    assert.deepEqual([response.status, await response.json()], [200, { details: SAMPLE_DETAILS[id] }], id);
  }
});

test('sample mode answers an item the file does not hold with empty details', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await details(board, '?itemId=I_sample01');
  assert.deepEqual([response.status, await response.json()], [200, { details: { body: '', format: 'markdown', author: null, assignees: [], createdAt: null, subTickets: [], comments: [], hasOlderComments: false, olderCursor: null } }]);
});

test('an item the board does not hold is 404 and a request naming none is 400', async (t) => {
  const board = await startBoard(t, {}, true);
  const unknown = await details(board, '?itemId=I_nope');
  assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
  for (const query of ['', '?itemId=']) {
    const missing = await details(board, query);
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'Name the item whose details to read.' }], query);
  }
});

test('outside sample mode a GitHub item reads its details from GitHub in one graphql call', async (t) => {
  const nodes = {
    I_12: { __typename: 'Issue', body: 'The **description**.', author: { login: 'maddec01' }, assignees: { nodes: [] }, createdAt: '2026-10-12T09:14:00Z', milestone: { title: 'v1' },
      subIssues: { nodes: [] }, comments: { pageInfo: { hasPreviousPage: false, startCursor: 'C1' }, nodes: [{ id: 'IC_1', author: { login: 'claude-bot' }, createdAt: '2026-10-13T08:00:00Z', body: 'Looks good.' }] } },
  };
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], details: nodes });
  await onboarded(board);
  const data = await until(board, (d) => d.items.length === 1);
  // Background refreshes may finish while the dialog reads; count only requests for this item's node.
  const itemCalls = async () => (await board.calls()).filter((args) => args[0] === 'api' && args[1] === 'graphql' && args.includes('id=I_12')).length;
  const before = await itemCalls();
  const answers = [];
  for (const item of data.items) {
    const response = await details(board, `?itemId=${item.id}`);
    answers.push([response.status, ((await response.json()) as { details: ItemDetails }).details.body]);
  }
  assert.deepEqual(answers.sort(), [[200, 'The **description**.']]);
  assert.equal(await itemCalls() - before, 1, 'one call per open');
});

test('an item GitHub no longer has answers 404', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], details: {} });
  await onboarded(board);
  const [item] = (await until(board, (d) => d.items.length === 1)).items;
  const response = await details(board, `?itemId=${item!.id}`);
  assert.deepEqual([response.status, await response.json()], [404, { error: 'GitHub has no such item.' }]);
});

const SAMPLE_OLDER = (SAMPLE_DETAILS as unknown as Record<string, Record<string, ItemComment[]>>)['$older']!['I_sample13']!;
const olderComments = (board: Board, query: string) => fetch(`${board.url}/api/item-comments${query}`);

test('sample mode pages an item\'s older comments 10 at a time from the cursor its details gave, to the end', async (t) => {
  const board = await startBoard(t, {}, true);
  const first = await olderComments(board, `?itemId=I_sample13&before=${SAMPLE_DETAILS['I_sample13']!.olderCursor}`);
  assert.deepEqual([first.status, await first.json()], [200, { page: { comments: SAMPLE_OLDER.slice(0, 10), olderCursor: '10' } }]);
  const last = await olderComments(board, '?itemId=I_sample13&before=10');
  assert.deepEqual([last.status, await last.json()], [200, { page: { comments: SAMPLE_OLDER.slice(10), olderCursor: null } }]);
  assert.ok(SAMPLE_OLDER.length > 10);
});

test('sample mode answers an item with no older comments an empty page', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await olderComments(board, '?itemId=I_sample26&before=0');
  assert.deepEqual([response.status, await response.json()], [200, { page: { comments: [], olderCursor: null } }]);
});

test('older comments of an item the board does not hold are 404, and a request naming no item or cursor is 400', async (t) => {
  const board = await startBoard(t, {}, true);
  const unknown = await olderComments(board, '?itemId=I_nope&before=0');
  assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
  for (const query of ['', '?itemId=', '?before=0']) {
    const missing = await olderComments(board, query);
    assert.deepEqual([missing.status, await missing.json()], [400, { error: 'Name the item whose comments to read.' }], query);
  }
  const noCursor = await olderComments(board, '?itemId=I_sample13');
  assert.deepEqual([noCursor.status, await noCursor.json()], [400, { error: 'Name where the older comments start.' }]);
});

test('outside sample mode older comments are one graphql call for the page before the cursor', async (t) => {
  const node = { __typename: 'Issue', comments: { pageInfo: { hasPreviousPage: true, startCursor: 'C0' }, nodes: [{ id: 'IC_1', author: { login: 'claude-bot' }, createdAt: '2026-10-13T08:00:00Z', body: 'Older.' }] } };
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], details: { I_12: node } });
  await onboarded(board);
  const [item] = (await until(board, (d) => d.items.length === 1)).items;
  // Background refreshes may finish while the dialog reads; count only requests for this item's node.
  const itemCalls = async () => (await board.calls()).filter((args) => args[0] === 'api' && args[1] === 'graphql' && args.includes('id=I_12')).length;
  const before = await itemCalls();
  const response = await olderComments(board, `?itemId=${item!.id}&before=C1`);
  assert.deepEqual([response.status, ((await response.json()) as { page: ItemCommentsPage }).page.olderCursor], [200, 'C0']);
  assert.equal(await itemCalls() - before, 1);
});

const save = (board: Board, body: object) => board.post(body, board.url, '/api/item-description');
const issueNode = { __typename: 'Issue', body: 'Old.', author: null, assignees: { nodes: [] }, createdAt: null, subIssues: { nodes: [] }, comments: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [] } };

/** A home with verified or refused access to edit this repository's tickets. */
function editingHome(t: TestContext, allowed = true): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'lar-board-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true }));
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: [{ repo: 'maddec01/lar-factory', settings: { access: { 'edit-ticket': allowed ? 'allowed' : 'refused' } } }] }));
  return { HOME: home };
}

test('saving a GitHub issue\'s description edits its body with gh, and its details then read the new text', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], details: { I_12: issueNode } }, false, false, editingHome(t));
  await onboarded(board);
  await until(board, (d) => d.items.length === 1);
  const response = await save(board, { itemId: board.id(12), body: '- a\n- b' });
  assert.deepEqual([response.status, await response.json()], [200, { error: null }]);
  assert.ok((await board.calls()).some((args) => args[0] === 'issue' && args[1] === 'edit' && args.includes('--body-file')));
  const read = await details(board, `?itemId=${board.id(12)}`);
  assert.equal(((await read.json()) as { details: ItemDetails }).details.body, '- a\n- b');
});

test("a save refuses denied write access and writes nothing", async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], details: { I_12: issueNode } }, false, false, editingHome(t, false));
  await until(board, (d) => d.items.length === 1);
  const response = await save(board, { itemId: board.id(12), body: 'New.' });
  assert.deepEqual([response.status, await response.json()],
    [403, { error: 'Access to edit-ticket was refused. Recheck access in Settings.' }]);
  assert.ok(!(await board.calls()).some((args) => args[0] === 'issue' && args[1] === 'edit'));
});

test('a failed save answers gh\'s message', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')], details: { I_12: issueNode }, fail: 'body' }, false, false, editingHome(t));
  await until(board, (d) => d.items.length === 1);
  const response = await save(board, { itemId: board.id(12), body: 'New.' });
  assert.deepEqual([response.status, await response.json()], [403, { error: 'Could not save the description. gh issue edit failed: HTTP 403: Resource not accessible by integration' }]);
});

test('a save for an item the board does not hold is 404, and one naming no item or body is 400', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
  await until(board, (d) => d.items.length === 1);
  const unknown = await save(board, { itemId: 'I_nope', body: 'x' });
  assert.deepEqual([unknown.status, await unknown.json()], [404, { error: 'That item is not on the board.' }]);
  for (const body of [{ body: 'x' }, { itemId: board.id(12) }, { itemId: board.id(12), body: 5 }]) {
    const bad = await save(board, body);
    assert.deepEqual([bad.status, await bad.json()], [400, { error: 'Name the item and send its description.' }], JSON.stringify(body));
  }
});

test('sample mode saves no description', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await save(board, { itemId: 'I_sample13', body: 'x' });
  assert.deepEqual([response.status, await response.json()], [403, { error: 'Saving descriptions is disabled in sample mode.' }]);
});

test('sample mode exports nothing', async (t) => {
  const board = await startBoard(t, {}, true);
  const response = await board.post({ itemId: 'I_sample13' }, board.url, '/api/item-export');
  assert.deepEqual([response.status, await response.json()], [403, { error: 'Exporting is disabled in sample mode.' }]);
});

test('readiness refuses foreign origins and sample mode without running Azure', async (t) => {
  const board = await startBoard(t, {}, true);
  const input = { itemId: 'I_sample01', number: 1, organization: 'untrusted' };
  const foreign = await fetch(`${board.url}/api/pr-readiness`, { method: 'POST', headers: { Origin: 'https://foreign.example', 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(foreign.status, 403);
  const sample = await fetch(`${board.url}/api/pr-readiness`, { method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  assert.equal(sample.status, 403);
  assert.equal((await board.calls()).length, 0);
});
