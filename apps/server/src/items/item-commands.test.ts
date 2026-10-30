import { test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData, Item } from '@lar-factory/shared';
import { createBoardState } from '../board/board-state.ts';
import { createItemCommands } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';

const WEB = 'contoso/Fabrikam/web';
const API = 'contoso/Fabrikam/api';

const queued = (id: number, extra: Partial<Item> = {}): Item => ({
  id: `azure:contoso/${id}`, status: 'Queued', statuses: ['Queued'], content: 'ticket', number: id, title: `Item ${id}`,
  url: `https://dev.azure.com/contoso/Fabrikam/_workitems/edit/${id}`, repo: WEB, labels: [], state: 'open', closedAs: null, parent: null,
  subIssues: { total: 0, completed: 0 }, blockers: [], updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [], ...extra,
});

/** Commands on a board holding `items`, whose source records each tag it writes and fails one when `failTag` is set. */
function commandsOn(items: Item[], failTag?: string, showThread?: () => Promise<'live' | 'deleted' | 'unknown'>) {
  const board = createBoardState({ items, repos: [], modelChoices: [] } as unknown as BoardData);
  const log: string[] = [];
  const branches: (string | undefined)[] = [];
  const source = {
    statusRefusal: () => null,
    addLabel: async (item: Item, label: string) => {
      log.push(`tag ${item.number} ${label}`);
      return failTag ?? null;
    },
    abandon: async (item: Item) => {
      log.push(`abandon ${item.number}`);
      return null;
    },
  } as unknown as ItemSource;
  const commands = createItemCommands({ board, items: source, repos: () => [], offerModelChoices: () => [],
    showThread, projectOf: async (repo) => ({ projectId: repo }),
    startThread: async (project, message, _choice, worktree) => {
      branches.push(worktree?.branch);
      log.push(`start ${project} ${message.split('\n')[1]}`);
      return { thread: { threadId: `thread-${branches.length}`, title: 't' }, error: null };
    } });
  return { board, commands, log, branches };
}

test('Start on an untagged item tags it for the repository picked, then starts shaping in that repository', async () => {
  const { board, commands, log } = commandsOn([queued(7, { untaggedFor: [WEB, API] })]);
  const reply = await commands.start('azure:contoso/7', undefined, 'Contoso/Fabrikam/API');
  assert.equal(reply.status, 200);
  assert.deepEqual(log, ['tag 7 repo-api', `start ${API} $lar-shape ${API}#7`]);
  const shown = board.find('azure:contoso/7')!;
  assert.deepEqual([shown.repo, shown.untaggedFor], [API, undefined]);
});

test('Start on an untagged item that only one repository reads tags it for that one without asking', async () => {
  const { commands, log } = commandsOn([queued(7, { untaggedFor: [WEB] })]);
  assert.equal((await commands.start('azure:contoso/7', undefined)).status, 200);
  assert.deepEqual(log, ['tag 7 repo-web', `start ${WEB} $lar-shape ${WEB}#7`]);
});

test('Start on an untagged item two repositories read asks which, and refuses one that does not read it', async () => {
  const { commands, log } = commandsOn([queued(7, { untaggedFor: [WEB, API] })]);
  const asked = await commands.start('azure:contoso/7', undefined);
  assert.equal(asked.status, 409);
  assert.match((asked.body as { error: string }).error, /Pick which repository/);
  assert.equal((await commands.start('azure:contoso/7', undefined, 'contoso/Fabrikam/docs')).status, 409);
  assert.deepEqual(log, []);
});

test('a failed tag write starts nothing, and Start may run again', async () => {
  const { commands, log } = commandsOn([queued(7, { untaggedFor: [WEB, API] })], 'Could not add the repo-web tag.');
  const reply = await commands.start('azure:contoso/7', undefined, WEB);
  assert.equal(reply.status, 502);
  assert.equal((reply.body as { error: string }).error, 'Could not add the repo-web tag.');
  assert.deepEqual(log, ['tag 7 repo-web']);
  await commands.start('azure:contoso/7', undefined, WEB);
  assert.equal(log.length, 2);
});

test('Start on a tagged item writes no tag and ignores a repository sent with it', async () => {
  const { commands, log } = commandsOn([queued(7)]);
  assert.equal((await commands.start('azure:contoso/7', undefined, API)).status, 200);
  assert.deepEqual(log, [`start ${WEB} $lar-shape ${WEB}#7`]);
});

test("Abandon on an item whose abandonRefusal says why refuses with it, and writes nothing", async () => {
  const refusal = "Issue has no Removed state in Fabrikam, so the board can't abandon it. Close or delete it in Azure DevOps.";
  const { commands, log } = commandsOn([queued(7, { abandonRefusal: refusal }), queued(8)]);
  const refused = await commands.abandon('azure:contoso/7');
  assert.deepEqual([refused.status, (refused.body as { error: string }).error], [409, refusal]);
  assert.equal((await commands.abandon('azure:contoso/8')).status, 200);
  assert.deepEqual(log, ['abandon 8']);
});

test('Start build reuses a live start, but a confirmed stopped build can start again once', async () => {
  const item = queued(7, { status: 'Ready', statuses: ['Ready'], labels: ['build'] });
  const { board, commands, log, branches } = commandsOn([item]);
  await commands.startBuild(item.id, undefined);
  await commands.startBuild(item.id, undefined);
  assert.equal(log.length, 1, 'a repeated request reuses the original start');
  board.update({ items: [{ ...item, threads: [{ id: 'thread-1', title: 'Build', state: 'stopped', updated: '2026-10-29T00:00:00Z' }] }] });
  await Promise.all([commands.startBuild(item.id, undefined), commands.startBuild(item.id, undefined)]);
  assert.equal(log.length, 2, 'concurrent retries start exactly one replacement');
  assert.equal(branches[0], 'chore/7-item-7');
  assert.notEqual(branches[1], branches[0], 'a replacement worktree must not reuse the stopped build branch');
});

for (const build of [false, true]) test(`deleted ${build ? 'build' : 'refining'} Start releases and concurrent retries create one thread`, async () => {
  const item = queued(7, { threads: [], ...(build ? { status: 'Ready', statuses: ['Ready'], labels: ['build'] } as Partial<Item> : {}) });
  const { commands, board, branches } = commandsOn([item], undefined, async () => 'deleted');
  const start = () => build ? commands.startBuild(item.id, undefined) : commands.start(item.id, undefined);
  await start();
  await commands.reconcileStarts([item]);
  assert.equal(board.snapshot()[build ? 'startedBuilds' : 'started']?.[item.id], undefined);
  await Promise.all([start(), start(), start()]);
  assert.equal(branches.length, 2);
  if (build) assert.match(branches[1]!, /-retry-[a-f0-9]+$/);
});

test('unknown lookup retains protection and warns without concurrent duplicate checks', async () => {
  const item = queued(7, { threads: [] });
  let calls = 0;
  const { commands, board, branches } = commandsOn([item], undefined, async () => { calls++; return 'unknown'; });
  await commands.start(item.id, undefined);
  await Promise.all([commands.reconcileStarts([item]), commands.reconcileStarts([item])]);
  await commands.start(item.id, undefined);
  assert.equal(calls, 1);
  assert.equal(branches.length, 1);
  assert.equal((await commands.backToList(item.id)).status, 409);
  assert.equal(board.snapshot().startCheckFailures?.[item.id], item.title);
});

for (const build of [false, true]) for (const outcome of ['live', 'deleted', 'removed'] as const) {
  test(`${build ? 'build' : 'refining'} lookup retries at 30 seconds and clears warning when ${outcome}`, async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(0);
      const item = queued(7, { threads: [], ...(build ? { status: 'Ready', statuses: ['Ready'], labels: ['build'] } as Partial<Item> : {}) });
      let calls = 0;
      const { commands, board } = commandsOn([item], undefined, async () => {
        calls++;
        return calls === 1 ? 'unknown' : outcome === 'deleted' ? 'deleted' : 'live';
      });
      await (build ? commands.startBuild(item.id, undefined) : commands.start(item.id, undefined));
      await commands.reconcileStarts([{ ...item, threads: 'unavailable' }]);
      assert.equal(calls, 0, 'unavailable reads never trigger a lookup');
      await commands.reconcileStarts([item]);
      assert.equal(board.snapshot().startCheckFailures?.[item.id], item.title);
      vi.setSystemTime(29_999);
      await commands.reconcileStarts([item]);
      assert.equal(calls, 1);
      vi.setSystemTime(30_000);
      await commands.reconcileStarts(outcome === 'removed' ? [] : [item]);
      assert.equal(calls, outcome === 'removed' ? 1 : 2);
      assert.equal(board.snapshot().startCheckFailures?.[item.id], undefined);
      if (outcome !== 'removed') {
        assert.equal(Boolean(board.snapshot()[build ? 'startedBuilds' : 'started']?.[item.id]), outcome === 'live');
        vi.setSystemTime(90_000);
        await commands.reconcileStarts([item]);
        assert.equal(calls, 2, 'a conclusive answer is not checked again');
      }
    } finally { vi.useRealTimers(); }
  });
}
