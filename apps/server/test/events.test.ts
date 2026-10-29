import { test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { once } from 'node:events';
import { startBoard } from './server-support.ts';
import type { Board } from './server-support.ts';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import type { BoardData } from '@lar-factory/shared';

/** An open event stream: its response and a wait for the next pushed board that passes a check. */
async function openStream(t: TestContext, board: Board) {
  const abort = new AbortController();
  t.onTestFinished(() => abort.abort());
  const response = await fetch(`${board.url}/api/events`, { signal: abort.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  const pushed: BoardData[] = [];
  async function next(check: (data: BoardData) => boolean): Promise<BoardData> {
    for (;;) {
      const found = pushed.splice(0).find(check);
      if (found) return found;
      const { value, done } = await reader.read();
      if (done) throw new Error('The stream ended');
      buffered += value;
      const events = buffered.split('\n\n');
      buffered = events.pop()!;
      for (const event of events) {
        const data = event.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
        if (data) pushed.push(JSON.parse(data) as BoardData);
      }
    }
  }
  return { response, next };
}

const statusOf = (data: BoardData, id: string) => data.items.find((i) => i.id === id)?.status;
const askRead = (board: Board) => fetch(`${board.url}/api/read`, { method: 'POST',
  headers: { Origin: board.url, 'Content-Type': 'application/json' }, body: '{}' });

test('the stream sends the board at once with the same headers as other endpoints', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(1, 'List')] });
  const stream = await openStream(t, board);
  assert.equal(stream.response.status, 200);
  assert.equal(stream.response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  assert.equal(stream.response.headers.get('cache-control'), 'no-store');
  assert.match(stream.response.headers.get('content-security-policy') ?? '', /connect-src 'self'/);
  assert.equal(stream.response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await stream.next(() => true)).capture?.session, (await board.board()).capture.session);
});

test('the stream pushes each read of GitHub as soon as it finishes', async (t) => {
  // A source reads at most every 2 s however often a read is asked for, which the fast clock shortens, so the asked
  // read runs at once instead of on a later tick.
  // The slow source also outlasts the old three-second stream polling budget.
  const board = await startBoard(t, { items: [boardIssue(1, 'List')], readDelay: 3500, delayedRepos: ['maddec01/lar-factory'] }, false, true);
  const stream = await openStream(t, board);
  // A repository's items show as its read lands, before the first read ends, so wait for that read to end.
  await stream.next((d) => d.firstRead.settled && statusOf(d, 'I_1') === 'List');
  await board.update({ items: [boardIssue(1, 'Ready')] });
  assert.equal((await askRead(board)).status, 202);
  await stream.next((d) => statusOf(d, 'I_1') === 'Ready');
});

test('a change made through the board reaches every open stream', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(12, 'List')] });
  const first = await openStream(t, board);
  const second = await openStream(t, board);
  for (const stream of [first, second]) await stream.next((d) => statusOf(d, 'I_12') === 'List');
  assert.equal((await board.post({ itemId: 'I_12' }, board.url, '/api/queue')).status, 200);
  for (const stream of [first, second]) await stream.next((d) => statusOf(d, 'I_12') === 'Queued');
});

test('the stream refuses a foreign Host', async (t) => {
  const board = await startBoard(t, { items: [boardIssue(1, 'List')] });
  // fetch can't set Host.
  const req = request(`${board.url}/api/events`, { headers: { Host: 'evil.example' } });
  req.end();
  const [res] = await once(req, 'response') as [IncomingMessage];
  res.resume();
  assert.equal(res.statusCode, 421);
});
