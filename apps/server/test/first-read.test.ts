import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { projectIssue } from '@lar-factory/shared/test/raw-items';
import type { BoardData } from '@lar-factory/shared';
import { startBoard, until } from './server-support.ts';

const settled = (board: Parameters<typeof until>[0]) => until(board, (d) => d.firstRead.settled);

test('the first read settles once the repositories are read, with nothing running', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')] });
  const data = await settled(board);
  assert.ok(data.fetchedAt, 'the read finished');
  assert.deepEqual(data.firstRead, { step: 'finishing', running: [], settled: true });
});

test('the first read settles with zero repositories', async (t) => {
  const board = await startBoard(t, { repositories: [] });
  assert.deepEqual((await settled(board)).firstRead, { step: 'finishing', running: [], settled: true });
});

test('the first read settles when the read fails', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')], fail: 'read' });
  const data = await settled(board);
  assert.match(data.error ?? '', /502/);
  assert.equal(data.fetchedAt, null);
});

test('the first read settles when gh is logged out at launch, though the read never starts', async (t) => {
  const board = await startBoard(t, { ghAuth: 'logged-out' });
  const data = await settled(board);
  assert.equal(data.tools?.gh?.result, 'logged-out');
  assert.equal(data.fetchedAt, null);
  assert.equal((await board.calls()).filter((args) => args[1] === 'graphql').length, 0);
});

test('the first read settles when gh is missing at launch', async (t) => {
  const board = await startBoard(t, {}, false, false, { GH_PATH: '/nowhere/gh' });
  const data = await settled(board);
  assert.equal(data.tools?.gh?.result, 'missing');
});

test('a read after the first never un-settles it', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')] });
  await settled(board);
  await fetch(`${board.url}/api/read`, { method: 'POST', headers: { Origin: board.url, 'Content-Type': 'application/json' }, body: '{}' });
  await board.update({ items: [projectIssue(1, 'Ready')] });
  await until(board, (d) => d.items[0]?.status === 'Ready');
  assert.equal((await board.board() as BoardData).firstRead.settled, true);
});

test('the sample board is settled at once', async (t) => {
  const board = await startBoard(t, {}, true);
  assert.deepEqual((await board.board() as BoardData).firstRead, { step: 'finishing', running: [], settled: true });
});

test('the page embeds the first read in its board data', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')] });
  await settled(board);
  const page = await (await fetch(`${board.url}/`)).text();
  const inline = JSON.parse(page.match(/<script id="board-data" type="application\/json">(.*?)<\/script>/s)![1]!);
  assert.equal(inline.firstRead.settled, true);
});

test('the stream pushes the first read as it moves from unsettled to settled, naming what runs', async (t) => {
  const board = await startBoard(t, { items: [projectIssue(1, 'List')], readDelay: 400, repositories: ['maddec01/lar-server', 'maddec01/lar-apple'] });
  const abort = new AbortController();
  t.onTestFinished(() => abort.abort());
  const response = await fetch(`${board.url}/api/events`, { signal: abort.signal });
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  const seen: BoardData['firstRead'][] = [];
  let buffered = '';
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline && !seen.at(-1)?.settled) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += value;
    const events = buffered.split('\n\n');
    buffered = events.pop()!;
    for (const event of events) {
      const data = event.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
      if (data) seen.push((JSON.parse(data) as BoardData).firstRead);
    }
  }
  assert.equal(seen.at(-1)?.settled, true);
  assert.ok(seen.some((f) => f.step === 'items' && f.running.length > 0), `a push names the reads running: ${JSON.stringify(seen)}`);
  const first = seen.findIndex((f) => f.settled);
  assert.ok(seen.slice(first).every((f) => f.settled), 'a push after the settled one never un-settles it');
  assert.deepEqual(seen.slice(0, first).map((f) => f.step).filter((step, at, steps) => steps.indexOf(step) === at), ['repositories', 'items', 'finishing']);
  assert.deepEqual(seen[first], { step: 'finishing', running: [], settled: true });
});
