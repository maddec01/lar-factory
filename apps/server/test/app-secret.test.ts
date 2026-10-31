import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { startBoard } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';

const SECRET = 'app-secret-for-tests';
const REFUSED = 'Submit from the board app.';
/** Every write http.ts guards. */
const GUARDED = ['/api/pr-readiness', '/api/items', '/api/pick-ticket', '/api/attach-ticket', '/api/queue', '/api/back-to-list', '/api/start',
  '/api/start-build', '/api/arm', '/api/disarm', '/api/abandon', '/api/close-ticket', '/api/restore', '/api/retention', '/api/needs-you',
  '/api/item-description', '/api/item-export', '/api/onboarding/projects', '/api/onboarding/repositories', '/api/onboarding/detect',
  '/api/onboarding/setup', '/api/repositories/settings', '/api/t3/reauthorize', '/api/recheck'];

const post = (board: Board, path: string, headers: Record<string, string> = {}) => fetch(`${board.url}${path}`, {
  method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json', ...headers }, body: '{}' });

async function answer(response: Response): Promise<{ status: number; error: unknown }> {
  const text = await response.text();
  let error: unknown = null;
  try { error = (JSON.parse(text) as { error?: unknown }).error ?? null; } catch { /* Not JSON. */ }
  return { status: response.status, error };
}

test('with the app secret set, guarded writes need it in X-Board-Secret', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(1, 'List')] }, false, false, { BOARD_APP_SECRET: SECRET });
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
  const board = await startBoard(t, { items: [boardIssue(1, 'List')] }, false, false, { BOARD_APP_SECRET: SECRET });
  assert.equal((await post(board, '/api/read')).status, 202);
});

test('without the app secret, guarded writes need no header', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(1, 'List')] });
  for (const path of GUARDED) assert.notEqual((await answer(await post(board, path))).error, REFUSED, path);
  assert.equal((await post(board, '/api/read')).status, 202);
});

test('ordinary refinement publication routes are absent', async (t) => {
  const board = await startBoard(t, {}, true);
  for (const action of ['open', 'prepare', 'approve', 'inspect', 'resume', 'reconcile', 'fallback', 'resolve-url', 'attach-url', 'reconcile-url', 'resolve-outcome', 'retry']) {
    assert.equal((await post(board, `/api/publication/${action}`)).status, 405);
  }
  assert.equal((await fetch(`${board.url}/api/publication/vocabulary?repo=team/app`)).status, 404);
});
