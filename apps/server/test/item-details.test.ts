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

test('outside sample mode every item says its details are not available yet, with no GitHub call beyond the board read', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(12, 'List'), draftItem('List')] });
  await onboarded(board);
  const data = await until(board, (d) => d.items.length === 2);
  const before = (await board.calls()).length;
  for (const item of data.items) {
    const response = await details(board, `?itemId=${item.id}`);
    assert.deepEqual([response.status, await response.json()], [501, { error: 'Item details are not available yet.' }], item.id);
  }
  assert.equal((await board.calls()).length, before);
});
