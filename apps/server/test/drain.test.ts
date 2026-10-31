import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData } from '@lar-factory/shared';
import { startableEnv, startBoard, until } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';

const SECRET = 'app-secret-for-tests';
const DRAINING = 'The board is installing an update. Try again once Lar Factory restarts.';
const GUARDED = ['/api/items', '/api/queue', '/api/back-to-list', '/api/start', '/api/abandon', '/api/recheck'];

const post = (board: Board, path: string, body: unknown = {}, headers: Record<string, string> = { 'X-Board-Secret': SECRET }) =>
  fetch(`${board.url}${path}`, {
    method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

test('a drain answers once running writes finish, and refuses new writes from then on', async (t) => {
  const env = { ...startableEnv(t), BOARD_APP_SECRET: SECRET };
  const board = await startBoard(t, { items: [boardIssue(12, 'Queued')], t3: { delay: 300 } }, false, false, env);
  await until(board, (d) => d.items.length === 1);
  const { capture } = await board.board() as BoardData;
  const starting = post(board, '/api/start', { session: capture!.session, itemId: board.id(12) });
  await new Promise((r) => setTimeout(r, 100));

  const drain = await post(board, '/api/drain');
  assert.equal(drain.status, 200);
  assert.ok((await board.board() as BoardData).started?.[board.id(12)], 'the drain answered before the running Start finished');
  assert.equal((await starting).status, 200);

  for (const path of GUARDED) {
    const refused = await post(board, path);
    assert.equal(refused.status, 503, path);
    assert.equal((await refused.json()).error, DRAINING, path);
  }
  // Reads still answer, so the page keeps showing the board until the app quits.
  assert.equal((await fetch(`${board.url}/api/board`)).status, 200);
});

test('only the app, with its secret, can start a drain', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] }, false, false, { BOARD_APP_SECRET: SECRET });
  for (const headers of [{} as Record<string, string>, { 'X-Board-Secret': 'wrong' }]) {
    assert.equal((await post(board, '/api/drain', {}, headers)).status, 403);
  }
  assert.equal((await post(board, '/api/drain', {}, { 'X-Board-Secret': SECRET, Origin: 'https://evil.example' })).status, 403);
  // A refused drain leaves writes open.
  assert.notEqual((await post(board, '/api/recheck')).status, 503);

  const plain = await startBoard(t, { items: [boardIssue(12, 'List')] });
  assert.equal((await post(plain, '/api/drain', {}, {})).status, 403);
  assert.notEqual((await post(plain, '/api/recheck', {}, {})).status, 503);
});
