import { test } from 'vite-plus/test';
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
function commandsOn(items: Item[], failTag?: string) {
  const board = createBoardState({ items, repos: [], modelChoices: [] } as unknown as BoardData);
  const log: string[] = [];
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
    projectOf: async (repo) => ({ projectId: repo }),
    startThread: async (project, message) => {
      log.push(`start ${project} ${message.split('\n')[1]}`);
      return { thread: { threadId: 'thread-1', title: 't' }, error: null };
    } });
  return { board, commands, log };
}

test('Start on an untagged item tags it for the repository picked, then starts shaping in that repository', async () => {
  const { board, commands, log } = commandsOn([queued(7, { untaggedFor: [WEB, API] })]);
  const reply = await commands.start('azure:contoso/7', undefined, 'Contoso/Fabrikam/API');
  assert.equal(reply.status, 200);
  assert.deepEqual(log, ['tag 7 repo-api', `start ${API} $lar-work ${API}#7`]);
  const shown = board.find('azure:contoso/7')!;
  assert.deepEqual([shown.repo, shown.untaggedFor], [API, undefined]);
});

test('Start on an untagged item that only one repository reads tags it for that one without asking', async () => {
  const { commands, log } = commandsOn([queued(7, { untaggedFor: [WEB] })]);
  assert.equal((await commands.start('azure:contoso/7', undefined)).status, 200);
  assert.deepEqual(log, ['tag 7 repo-web', `start ${WEB} $lar-work ${WEB}#7`]);
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
  assert.deepEqual(log, [`start ${WEB} $lar-work ${WEB}#7`]);
});

test("Abandon on an item whose abandonRefusal says why refuses with it, and writes nothing", async () => {
  const refusal = "Issue has no Removed state in Fabrikam, so the board can't abandon it. Close or delete it in Azure DevOps.";
  const { commands, log } = commandsOn([queued(7, { abandonRefusal: refusal }), queued(8)]);
  const refused = await commands.abandon('azure:contoso/7');
  assert.deepEqual([refused.status, (refused.body as { error: string }).error], [409, refusal]);
  assert.equal((await commands.abandon('azure:contoso/8')).status, 200);
  assert.deepEqual(log, ['abandon 8']);
});
