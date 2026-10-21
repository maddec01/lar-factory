import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { factoryRepo } from './repo-support.ts';
import { startBoard } from './server-support.ts';
import type { BoardData } from '../src/model.ts';

async function eventually(read: () => Promise<boolean>): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (await read()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail('Expected revision status did not arrive');
}

test('remote commits stay visible after checkout advancement, with startup assets and health identity preserved', async (t) => {
  const f = await factoryRepo(t);
  const running = f.git('rev-parse', 'HEAD');
  const board = await startBoard(t, {}, true, true, { BOARD_DATA_FILE: join(f.repo, 'sample.json'), BOARD_LAUNCH_TOKEN: 'launch-7' }, join(f.repo, 'board'));
  await eventually(async () => (await board.board()).codeUpdate?.behind === 0);
  const assets = await Promise.all(['client.ts', 'render.ts', 'model.ts', 'add-item.ts', 'anchor.ts'].map(async (name) => {
    return [name, await fetch(`${board.url}/assets/${name}`).then((r) => r.text())] as const;
  }));
  f.git('switch', '-c', 'merged');
  await writeFile(join(f.repo, 'board/src/model.ts'), 'throw new Error("new checkout must not be served");');
  await writeFile(join(f.repo, 'board/src/styles.css'), 'body { display: none; }');
  f.git('add', '.');
  f.git('commit', '-m', 'feat(board): incompatible next version');
  f.git('push', 'origin', 'HEAD:main');
  const remote = f.git('rev-parse', 'HEAD');
  f.git('switch', 'main');
  await eventually(async () => (await board.board()).codeUpdate?.behind === 1);
  f.git('merge', '--ff-only', 'merged');
  await eventually(async () => {
    const data = await board.board() as BoardData;
    return data.codeUpdate?.runningRevision === running && data.codeUpdate?.remoteRevision === remote && data.codeUpdate?.behind === 1;
  });
  const html = await fetch(board.url).then((r) => r.text());
  assert.match(html, /Board update available/);
  assert.match(html, /board\/scripts\/update.sh/);
  assert.ok(!html.includes('body { display: none; }'));
  for (const [name, content] of assets) assert.equal(await fetch(`${board.url}/assets/${name}`).then((r) => r.text()), content);
  const health = await fetch(`${board.url}/healthz`).then((r) => r.json());
  assert.equal(health.runningRevision, running);
  assert.equal(health.launchToken, 'launch-7');
});

test('failed revision checks remain distinct from fresh project data and recover', async (t) => {
  const f = await factoryRepo(t);
  f.git('remote', 'set-url', 'origin', join(f.dir, 'missing'));
  const board = await startBoard(t, {}, false, true, {}, join(f.repo, 'board'));
  await eventually(async () => {
    const data = await board.board();
    return Boolean(data.codeUpdate?.error && data.fetchedAt);
  });
  let data = await board.board() as BoardData;
  assert.equal(data.codeUpdate?.behind, null);
  assert.equal(data.error, null);
  assert.ok(data.fetchedAt);
  assert.match(await fetch(board.url).then((r) => r.text()), /Board update check failed/);
  f.git('remote', 'set-url', 'origin', f.origin);
  await eventually(async () => (await board.board()).codeUpdate?.behind === 0);
  f.git('remote', 'set-url', 'origin', join(f.dir, 'missing-again'));
  await eventually(async () => Boolean((await board.board()).codeUpdate?.error));
  data = await board.board() as BoardData;
  assert.equal(data.codeUpdate?.behind, 0, 'last known result is kept alongside the failed-check warning');
  assert.match(await fetch(board.url).then((r) => r.text()), /Board update check failed/);
});

test('a local-ahead running revision needs no update until remote contains absent commits', async (t) => {
  const f = await factoryRepo(t);
  const base = f.git('rev-parse', 'HEAD');
  f.git('commit', '--allow-empty', '-m', 'chore(board): local commit');
  const board = await startBoard(t, {}, true, true, { BOARD_DATA_FILE: join(f.repo, 'sample.json') }, join(f.repo, 'board'));
  await eventually(async () => (await board.board()).codeUpdate?.behind === 0);
  assert.doesNotMatch(await fetch(board.url).then((r) => r.text()), /Board update available/);
  f.git('switch', '-c', 'remote-work', base);
  f.git('commit', '--allow-empty', '-m', 'feat(board): different remote commit');
  f.git('push', 'origin', 'HEAD:main');
  await eventually(async () => (await board.board()).codeUpdate?.behind === 1);
});
