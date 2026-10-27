import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { draftItem, onboarded, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { projectIssue } from '@lar-factory/shared/test/raw-items';
import type { ItemDetails } from '@lar-factory/shared';

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
    DI_draft: { __typename: 'DraftIssue', body: 'An idea.', creator: { login: 'maddec01' }, assignees: { nodes: [] }, createdAt: '2026-10-12T09:14:00Z' },
  };
  const board = await startBoard(t, { items: [projectIssue(12, 'List'), draftItem('List')], details: nodes });
  await onboarded(board);
  const data = await until(board, (d) => d.items.length === 2);
  const before = (await board.calls()).length;
  const answers = [];
  for (const item of data.items) {
    const response = await details(board, `?itemId=${item.id}`);
    answers.push([response.status, ((await response.json()) as { details: ItemDetails }).details.body]);
  }
  assert.deepEqual(answers.sort(), [[200, 'An idea.'], [200, 'The **description**.']]);
  assert.equal((await board.calls()).length - before, 2, 'one call per open');
});

test('an item GitHub no longer has answers 404', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List')], details: {} });
  await onboarded(board);
  const [item] = (await until(board, (d) => d.items.length === 1)).items;
  const response = await details(board, `?itemId=${item!.id}`);
  assert.deepEqual([response.status, await response.json()], [404, { error: 'GitHub has no such item.' }]);
});
