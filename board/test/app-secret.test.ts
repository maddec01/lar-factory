import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rawIssue, startBoard } from './server-support.ts';

type Board = Awaited<ReturnType<typeof startBoard>>;

const SECRET = 'app-secret-for-tests';
const REFUSED = 'Submit from the board app.';
const GUARDED = ['/api/items', '/api/queue', '/api/back-to-list', '/api/start', '/api/abandon', '/api/recheck'];

const post = (board: Board, path: string, headers: Record<string, string> = {}) => fetch(`${board.url}${path}`, {
  method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json', ...headers }, body: '{}' });

async function answer(response: Response): Promise<{ status: number; error: unknown }> {
  const text = await response.text();
  let error: unknown = null;
  try { error = (JSON.parse(text) as { error?: unknown }).error ?? null; } catch { /* Not JSON. */ }
  return { status: response.status, error };
}

test('with the app secret set, guarded writes need it in X-Board-Secret', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(1, 'List')] }, false, false, { BOARD_APP_SECRET: SECRET });
  for (const path of GUARDED) {
    for (const headers of [{} as Record<string, string>, { 'X-Board-Secret': 'wrong' }, { 'X-Board-Secret': `${SECRET}x` }, { 'X-Board-Secret': '' }]) {
      assert.deepEqual(await answer(await post(board, path, headers)), { status: 403, error: REFUSED }, `${path} ${JSON.stringify(headers)}`);
    }
    // The right secret reaches the endpoint, which answers the empty request its own way.
    const passed = await answer(await post(board, path, { 'X-Board-Secret': SECRET }));
    assert.notEqual(passed.error, REFUSED, path);
  }
  // The Origin check still comes first.
  assert.equal((await post(board, '/api/queue', { Origin: 'https://evil.example', 'X-Board-Secret': SECRET })).status, 403);
});

test('with the app secret set, a read request needs no secret', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(1, 'List')] }, false, false, { BOARD_APP_SECRET: SECRET });
  assert.equal((await post(board, '/api/read')).status, 202);
});

test('without the app secret, guarded writes need no header', async (t) => {
  const board = await startBoard(t, { items: [rawIssue(1, 'List')] });
  for (const path of GUARDED) assert.notEqual((await answer(await post(board, path))).error, REFUSED, path);
  assert.equal((await post(board, '/api/read')).status, 202);
});
