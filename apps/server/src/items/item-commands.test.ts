import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData, Item, OperationAccess } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { createBoardState } from '../board/board-state.ts';
import { createItemCommands } from './item-commands.ts';
import type { ItemSource } from './item-source.ts';
import { archivedItems, recordItems } from './record-items.ts';
import { observeRecords } from './observe-records.ts';

const WEB = 'contoso/Fabrikam/web';

const queued = (id: number, extra: Partial<Item> = {}): Item => ({
  id: `azure:contoso/${id}`, revision: 1, status: 'Queued', statuses: ['Queued'], kind: 'issue', content: 'ticket', number: id, title: `Item ${id}`,
  url: `https://dev.azure.com/contoso/Fabrikam/_workitems/edit/${id}`, repo: WEB, labels: [], state: 'open', closedAs: null, parent: null, parentId: null,
  subIssues: { total: 0, completed: 0 }, blockers: [], updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [], ...extra,
});

const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const { records, dir } of opened.splice(0)) {
    records.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only Azure sessions refuse shaping and builds before any T3 or provider call', async () => {
  vi.stubEnv('LAR_FACTORY_AZURE_READ_ONLY', '1');
  const { commands, log } = commandsOn([queued(1), queued(2, { status: 'Ready', statuses: ['Ready'], kind: 'build' })]);
  assert.equal((await commands.start(queued(1).id, undefined)).status, 403);
  assert.equal((await commands.startBuild(queued(2).id, undefined)).status, 403);
  assert.deepEqual(log, []);
});
async function openRecords(): Promise<WorkRecords> {
  const dir = mkdtempSync(join(tmpdir(), 'item-commands-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  return records;
}

for (const operation of ['push-branch', 'open-pr'] as const) for (const state of ['refused', 'unverified'] as const) {
  test(`${state} ${operation} prevents a build intent while read-only shaping still works`, async () => {
    const records = await openRecords();
    const build = records.importTicket({ title: 'Read-only build', repository: WEB, kind: 'build', status: 'Ready', ticket: `${WEB}#7` }).record;
    const access = { 'push-branch': 'allowed', 'open-pr': 'allowed', [operation]: state } as const;
    const { commands, log, reread } = commandsOn([], undefined, records, [], access);
    const reply = await commands.startBuild(build.workId, undefined);
    assert.equal(reply.status, 403);
    assert.match(JSON.stringify(reply.body), new RegExp(operation));
    assert.equal(records.read(build.workId).revision, build.revision);
    assert.deepEqual(records.launchIntents({ workId: build.workId }), []);
    assert.deepEqual(log, []);
    const shape = records.importTicket({ title: 'Read-only shaping', repository: WEB, kind: 'issue', status: 'Queued', ticket: `${WEB}#8` }).record;
    reread();
    assert.equal((await commands.start(shape.workId, undefined)).status, 200);
    assert.equal(log.length, 1);
  });
}

/**
 * Commands on a board holding `items`, whose source records each abandon it gets. Given `records`, the board shows their items and Archive with `tickets` as the source read them, and reads them
 * again after each write.
 */
function commandsOn(items: Item[], showThread?: () => Promise<'live' | 'deleted' | 'unknown'>, records?: WorkRecords, tickets: Item[] = [], access: Partial<Record<'push-branch' | 'open-pr', OperationAccess>> = { 'push-branch': 'allowed', 'open-pr': 'allowed' }) {
  const board = createBoardState({ items, repos: [], modelChoices: [] } as unknown as BoardData);
  const reread = () => {
    if (records) board.update({ items: recordItems(records, tickets, [WEB]) });
  };
  const archive = () => (records ? archivedItems(records, tickets, [WEB], new Set()) : []);
  reread();
  const log: string[] = [];
  const branches: (string | undefined)[] = [];
  const bases: (string | undefined)[] = [];
  const source = {
    abandon: async (item: Item) => {
      log.push(`abandon ${item.number}`);
      return null;
    },
  } as unknown as ItemSource;
  const commands = createItemCommands({ factoryContext:null, checkoutOf: async () => '/repo',
    inspectWorkRecovery: async () => ({ branch: 'old', branchExists: true, worktreePath: null, pr: 'none' }), board, items: source, records: records ?? null, reread, archive, offerModelChoices: () => [],
    showThread, reopenPr: async (repo, number) => { log.push(`reopen ${repo}#${number}`); }, projectOf: async (repo) => ({ projectId: repo }), baseOf: async () => 'release', buildAccessOf: () => access,
    startThread: async (project, message, _choice, worktree) => {
      branches.push(worktree?.branch);
      bases.push(worktree && 'base' in worktree ? worktree.base : undefined);
      log.push(`start ${project} ${message.split('\n')[1]}`);
      return { thread: { threadId: `thread-${branches.length}`, title: 't' }, error: null };
    } });
  return { board, commands, log, branches, bases, archive, reread };
}

for (const failed of [false, true]) test(`Abandon uses the current record after a provider ${failed ? 'failure' : 'observation'} while another ticket still reads`, async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', status: 'List', ticket: `${WEB}#7` }).record;
  records.importTicket({ title: 'Other work', repository: WEB, kind: 'bug', status: 'List', ticket: `${WEB}#8` });
  const { commands, reread } = commandsOn([], undefined, records, [queued(7), queued(8)]);
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const pending = observeRecords(records, [WEB], {
    ticket: async (_repo, number) => {
      if (number === 8) await held;
      if (failed) throw new Error('Provider unavailable.');
      return { state: 'open' };
    },
    pr: async () => 'open',
  }, new Set(), reread);
  try {
    // Let the first observation finish while the second stays held, without a timer or a provider refresh.
    await new Promise(setImmediate);
    const response = commands.abandon(work.workId);
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(records.read(work.workId).setAside, true);
  } finally {
    release();
    await pending;
  }
});

test('Abandon sets the work aside on this Mac and leaves its ticket alone, which only its own close closes', async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', status: 'Queued', ticket: `${WEB}#7` }).record;
  const { board, commands, log } = commandsOn([], undefined, records, [queued(7)]);
  assert.deepEqual((await commands.closeTicket(work.workId)).status, 409, 'work Abandon never set aside has no ticket to close');
  assert.equal(commands.abandon(work.workId).status, 200);
  assert.equal(records.read(work.workId).setAside, true);
  assert.equal(board.find(work.workId), undefined);
  assert.deepEqual(log, [], 'Abandon writes nothing to the provider');
  const [first, second] = await Promise.all([commands.closeTicket(work.workId), commands.closeTicket(work.workId)]);
  assert.deepEqual([first.status, second.status], [200, 200]);
  assert.equal((await commands.closeTicket(work.workId)).status, 200);
  assert.deepEqual(log, ['abandon 7'], 'three presses close the ticket once');
});

test("Archive offers a set-aside ticket's close after the board restarts, and Restore brings the work back in its Status", async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', status: 'Queued', ticket: `${WEB}#7` }).record;
  records.setAside(work.workId, work.revision);
  const { board, commands, log, archive } = commandsOn([], undefined, records, [queued(7)]);
  assert.equal((await commands.closeTicket(work.workId)).status, 200);
  assert.deepEqual(log, ['abandon 7']);
  assert.equal(commands.restore(work.workId).status, 200);
  assert.deepEqual([board.find(work.workId)?.status, archive()], ['Queued', []]);
  const again = commands.restore(work.workId);
  assert.deepEqual([again.status, (again.body as { error: string }).error], [409, "That work isn't set aside in Archive, so there is nothing to restore."]);
});

test("a ticket close refuses work whose abandonRefusal says why, and work whose ticket the board doesn't see open", async () => {
  const refusal = "Issue has no Removed state in Fabrikam, so the board can't abandon it. Close or delete it in Azure DevOps.";
  const records = await openRecords();
  const refused = records.importTicket({ title: 'Refused', repository: WEB, kind: 'bug', status: 'Queued', ticket: `${WEB}#7` }).record;
  const closed = records.importTicket({ title: 'Closed', repository: WEB, kind: 'bug', status: 'Queued', ticket: `${WEB}#8` }).record;
  const { commands, log } = commandsOn([], undefined, records, [queued(7, { abandonRefusal: refusal }), queued(8, { state: 'closed' })]);
  assert.equal(commands.abandon(refused.workId).status, 200);
  assert.equal(commands.abandon(closed.workId).status, 200);
  const answers = await Promise.all([commands.closeTicket(refused.workId), commands.closeTicket(closed.workId)]);
  assert.deepEqual(answers.map((a) => [a.status, (a.body as { error: string }).error]), [[409, refusal],
    [409, "The board doesn't see that work's ticket open, so it closes nothing. Check it in its provider."]]);
  assert.deepEqual(log, []);
});

/** A Review build on WEB whose PR #40 is observed closed unmerged, with its build thread, waiting on the user. */
async function closedPrBuild() {
  const records = await openRecords();
  const created = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Review' });
  let record = records.setPullRequest(created.workId, created.revision, `${WEB}#40`);
  record = records.addThread(created.workId, record.revision, 'thread-0', 'build');
  record = records.observe(created.workId, record.revision, { of: 'pr', state: 'closed' });
  records.setNeedsYou(created.workId, record.revision, 'Its PR closed without merging.');
  return { records, workId: created.workId, ...commandsOn([], undefined, records) };
}

test('reopening a closed PR from Needs you reopens it in its provider and clears the reason', async () => {
  const { records, workId, commands, log } = await closedPrBuild();
  assert.equal((await commands.resolveNeedsYou(workId, 'reopen-pr')).status, 200);
  assert.deepEqual(log, [`reopen ${WEB}#40`]);
  assert.deepEqual([records.read(workId).needsYou, records.read(workId).status], [null, 'Review']);
});

test('a replacement build from Needs you readies the work, and Start build then starts a new thread on a new branch', async () => {
  const { records, workId, commands, branches } = await closedPrBuild();
  assert.equal((await commands.resolveNeedsYou(workId, 'replace-pr')).status, 200);
  assert.deepEqual([records.read(workId).needsYou, records.read(workId).status], [null, 'Ready']);
  assert.equal((await commands.startBuild(workId, undefined)).status, 200);
  assert.equal(branches.length, 1, 'the closed PR\'s thread holds no start');
  assert.match(branches[0]!, /-retry-[a-f0-9]+$/);
});

test('setting work aside from Needs you works in any Status, though a thread worked on it', async () => {
  const { records, workId, commands } = await closedPrBuild();
  assert.equal(commands.abandon(workId).status, 200);
  assert.equal(records.read(workId).setAside, true);
});

test('Needs you refuses a choice it does not offer, and Clear clears any reason', async () => {
  const { records, workId, commands, log } = await closedPrBuild();
  assert.equal((await commands.resolveNeedsYou(workId, 'reopen-work')).status, 409);
  assert.equal((await commands.resolveNeedsYou(workId, 'clear')).status, 200);
  assert.deepEqual([records.read(workId).needsYou, records.read(workId).status, log], [null, 'Review', []]);
  assert.equal((await commands.resolveNeedsYou(workId, 'clear')).status, 409, 'work that no longer needs you has nothing to clear');
});

test('reopening Done work from Needs you moves it back to List', async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', status: 'Done', ticket: `${WEB}#7` }).record;
  records.setNeedsYou(work.workId, records.observe(work.workId, work.revision, { of: 'ticket', state: 'open' }).revision, 'Its ticket reopened.');
  const { commands } = commandsOn([], undefined, records);
  assert.equal((await commands.resolveNeedsYou(work.workId, 'reopen-work')).status, 200);
  assert.deepEqual([records.read(work.workId).needsYou, records.read(work.workId).status], [null, 'List']);
});

test('Start build reuses a live start, but a confirmed stopped build can start again once', async () => {
  const item = queued(7, { status: 'Ready', statuses: ['Ready'], labels: ['build'] });
  const { board, commands, log, branches, bases } = commandsOn([item]);
  await commands.startBuild(item.id, undefined);
  await commands.startBuild(item.id, undefined);
  assert.equal(log.length, 1, 'a repeated request reuses the original start');
  assert.deepEqual(bases, ['release'], 'builds use the resolved target even when it is not main');
  board.update({ items: [{ ...item, threads: [{ id: 'thread-1', title: 'Build', state: 'stopped', updated: '2026-10-29T00:00:00Z' }] }] });
  await Promise.all([commands.startBuild(item.id, undefined), commands.startBuild(item.id, undefined)]);
  assert.equal(log.length, 2, 'concurrent retries start exactly one replacement');
  assert.equal(branches[0], 'chore/7-item-7');
  assert.notEqual(branches[1], branches[0], 'a replacement worktree must not reuse the stopped build branch');
});

for (const build of [false, true]) test(`deleted ${build ? 'build' : 'refining'} Start releases and concurrent retries create one thread`, async () => {
  const item = queued(7, { threads: [], ...(build ? { status: 'Ready', statuses: ['Ready'], labels: ['build'] } as Partial<Item> : {}) });
  const { commands, board, branches } = commandsOn([item], async () => 'deleted');
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
  const { commands, board, branches } = commandsOn([item], async () => { calls++; return 'unknown'; });
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
      const { commands, board } = commandsOn([item], async () => {
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

test('Queue and Back to List move the work record and write nothing to its ticket', async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', ticket: `${WEB}#7` }).record;
  const { board, commands, log } = commandsOn([], undefined, records);
  assert.equal((await commands.queue(work.workId)).status, 200);
  assert.equal(records.read(work.workId).status, 'Queued');
  assert.equal(board.find(work.workId)?.status, 'Queued', 'the board reads the record again at once');
  assert.equal((await commands.backToList(work.workId)).status, 200);
  assert.equal(records.read(work.workId).status, 'List');
  assert.deepEqual(log, []);
});

test('a move on a record a thread changed since the board read it is refused, and the board reads it again', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature' });
  const { board, commands } = commandsOn([], undefined, records);
  records.update(work.workId, work.revision, { kind: 'bug' });
  const refused = await commands.queue(work.workId);
  assert.equal(refused.status, 409);
  assert.match((refused.body as { error: string }).error, /read it again/);
  assert.equal(records.read(work.workId).status, 'List');
  assert.equal(board.find(work.workId)?.kind, 'bug');
  assert.equal((await commands.queue(work.workId)).status, 200, 'the next move names the revision the board read again');
});

test("Start build moves the build's concept record to In progress and writes no ticket's status", async () => {
  const records = await openRecords();
  const concept = records.create({ title: 'Concept', repository: WEB, kind: 'concept', status: 'Shaping' });
  const made = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  const build = records.setParent(made.workId, made.revision, concept.workId);
  const { commands, log } = commandsOn([], undefined, records);
  assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
  assert.equal(records.read(concept.workId).status, 'In progress');
  assert.ok(log.every((line) => !line.startsWith('status')), log.join('; '));
});

/**
 * Commands on the board of `records`, where each item shows the threads `shown` gives for its recorded thread IDs, as
 * T3 shows them. Starts record their messages in `started`, and `recover` plays T3's answer to a reconciliation.
 */
function recordedCommands(records: WorkRecords, { shown = (ids: string[]) => ids.map((id) => ({ id, title: 't', state: 'running' as const, updated: '2026-10-31T00:00:00Z' })),
  recover = async (_project: string, _messages: readonly string[]): Promise<{ threadId: string; title: string } | 'absent' | 'unknown'> => 'absent', lookup = async (): Promise<'live' | 'deleted' | 'unknown'> => 'unknown',
  skills = [] as string[], during = () => {}, beforeLaunch = () => {} }: { shown?: (ids: string[]) => Item['threads']; recover?: (project: string, messages: readonly string[]) => Promise<{ threadId: string; title: string } | 'absent' | 'unknown'>;
  lookup?: () => Promise<'live' | 'deleted' | 'unknown'>; skills?: string[]; during?: () => void; beforeLaunch?: (board: ReturnType<typeof createBoardState>) => void } = {}) {
  const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
  const reread = () => board.update({ items: recordItems(records, [], [WEB]).map((item) => {
    const ids = records.threads(item.id).map((t) => t.threadId);
    return ids.length ? { ...item, threads: shown(ids) } : item;
  }) });
  reread();
  const started: string[] = [];
  const commands = createItemCommands({ factoryContext:null, checkoutOf: async () => '/repo',
    inspectWorkRecovery: async () => ({ branch: 'old', branchExists: true, worktreePath: null, pr: 'none' }), board, items: {} as ItemSource, records, reread, archive: () => [], offerModelChoices: () => [],
    showThread: lookup, projectOf: async (repo) => { beforeLaunch(board); return { projectId: repo }; }, baseOf: async () => 'release', buildAccessOf: () => ({ 'push-branch': 'allowed', 'open-pr': 'allowed' }), recoverThread: recover, skillsOf: () => skills,
    startThread: async (_project, message) => {
      during();
      started.push(message);
      return { thread: { threadId: `thread-${started.length}`, title: 't' }, error: null };
    } });
  return { board, commands, started, reread };
}

test('Start writes a launch intent before it asks T3, and records the thread T3 starts', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Tidy the docs', repository: WEB, kind: 'improvement', status: 'Queued' });
  let unresolved = -1;
  const { commands, started } = recordedCommands(records, { during: () => { unresolved = records.launchIntents({ workId: work.workId, unresolved: true }).length; } });
  assert.equal((await commands.start(work.workId, undefined)).status, 200);
  assert.equal(unresolved, 1, 'the intent is on the record while T3 starts the thread');
  assert.deepEqual(started, [`Shaping Tidy the docs\n$lar-shape ${work.workId}`]);
  assert.deepEqual(records.threads(work.workId).map((t) => [t.threadId, t.purpose]), [['thread-1', 'shape']]);
  assert.deepEqual(records.launchIntents({ workId: work.workId }).map((i) => [i.outcome, i.threadId]), [['started', 'thread-1']]);
});

test('after a restart, an unresolved start records the thread T3 shows for it and starts no second one', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  records.recordLaunchIntent(work.workId, work.revision, 'shape');
  const { commands, started } = recordedCommands(records, { recover: async () => ({ threadId: 'late', title: 'Work' }) });
  const reply = await commands.start(work.workId, undefined);
  assert.deepEqual([reply.status, (reply.body as { thread: { threadId: string } }).thread.threadId], [200, 'late']);
  assert.deepEqual(started, []);
  assert.deepEqual(records.threads(work.workId).map((t) => t.threadId), ['late']);
  assert.equal((await commands.start(work.workId, undefined)).status, 200);
  assert.deepEqual(started, [], 'the recorded running thread is the start');
});

test('an unresolved start looks for its thread under both the new message and the one before the phase names', async () => {
  const records = await openRecords();
  const shaping = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  records.recordLaunchIntent(shaping.workId, shaping.revision, 'shape');
  const asked: (readonly string[])[] = [];
  let recovered = 0;
  const recover = async (_project: string, messages: readonly string[]) => { asked.push(messages); return { threadId: `late-${++recovered}`, title: 'Work' }; };
  const { commands } = recordedCommands(records, { recover });
  await commands.start(shaping.workId, undefined);
  assert.deepEqual(asked.pop(), [`Shaping Work\n$lar-shape ${shaping.workId}`, `Work\n$lar-shape ${shaping.workId}`]);

  const build = records.create({ title: 'Build it', repository: WEB, kind: 'feature', status: 'Ready' });
  records.recordLaunchIntent(build.workId, build.revision, 'build');
  const second = recordedCommands(records, { recover });
  await second.commands.startBuild(build.workId, undefined);
  const [current, earlier] = asked.pop()!;
  assert.match(current!, new RegExp(`^Build Build it\\nBuild ${build.workId}\\. Read .*/agents/builder\\.md and follow it\\.$`));
  assert.equal(earlier, current!.split('\n').slice(1).join('\n'));
});

test('Start names its thread with the title the record holds at launch', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Old title', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, started } = recordedCommands(records, { beforeLaunch: () => {
    const state = records.specState(work.workId);
    records.saveSpecState(work.workId, state.generation, state, { text: 'Brief', title: 'New title', source: 'user', identity: 'pedro', evidence: 'edited' });
  } });
  await commands.start(work.workId, undefined);
  assert.equal(started[0]?.split('\n')[0], 'Shaping New title');
});

test('Start build names its thread with the title the record holds at launch', async () => {
  const records = await openRecords();
  const build = records.create({ title: 'Old title', repository: WEB, kind: 'feature', status: 'Ready' });
  const { commands, started } = recordedCommands(records, { beforeLaunch: (board) => {
    board.update({ items: board.snapshot().items.map((item) => ({ ...item, title: 'New title' })) });
  } });
  await commands.startBuild(build.workId, undefined);
  assert.equal(started[0]?.split('\n')[0], 'Build New title');
});

test('after a restart, an unresolved start T3 shows no thread for sets Needs you, and one T3 cannot answer for waits', async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(Date.parse('2026-10-31T10:00:00Z'));
    const records = await openRecords();
    const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
    records.recordLaunchIntent(work.workId, work.revision, 'shape');
    let answer: 'absent' | 'unknown' = 'unknown';
    const { commands, started } = recordedCommands(records, { recover: async () => answer });
    const waiting = await commands.start(work.workId, undefined);
    assert.deepEqual([waiting.status, (waiting.body as { uncertain?: boolean }).uncertain], [502, true]);
    answer = 'absent';
    assert.equal((await commands.start(work.workId, undefined)).status, 502, 'T3 may not show a new thread yet');
    vi.setSystemTime(Date.parse('2026-10-31T10:01:00Z'));
    const refused = await commands.start(work.workId, undefined);
    assert.equal(refused.status, 409);
    assert.match((refused.body as { error: string }).error, /Needs you/);
    assert.match(records.read(work.workId).needsYou ?? '', /no thread/);
    assert.deepEqual(started, []);
    assert.equal((await commands.start(work.workId, undefined)).status, 409, 'Start waits until the user clears Needs you');
    const record = records.read(work.workId);
    records.clearNeedsYou(work.workId, record.revision);
    assert.equal((await commands.start(work.workId, undefined)).status, 200);
    assert.equal(started.length, 1);
  } finally { vi.useRealTimers(); }
});

test('a recorded thread T3 confirms deleted releases Start, and one T3 cannot be read for keeps it', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  records.addThread(work.workId, work.revision, 'gone', 'shape');
  const unavailable = recordedCommands(records, { shown: () => 'unavailable', lookup: async () => 'deleted' });
  await unavailable.commands.reconcileStarts(unavailable.board.snapshot().items);
  const kept = await unavailable.commands.start(work.workId, undefined);
  assert.deepEqual([kept.status, (kept.body as { thread: { threadId: string } }).thread.threadId], [200, 'gone']);
  assert.deepEqual(unavailable.started, [], 'an unavailable thread may still run');
  assert.equal(records.threads(work.workId)[0]!.deletedAt, null);
  const deleted = recordedCommands(records, { shown: () => [], lookup: async () => 'deleted' });
  await deleted.commands.reconcileStarts(deleted.board.snapshot().items);
  assert.ok(records.threads(work.workId)[0]!.deletedAt);
  assert.equal((await deleted.commands.start(work.workId, undefined)).status, 200);
  assert.equal(deleted.started.length, 1);
});

test('a finished T3 turn moves no Status', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, board } = recordedCommands(records, { shown: (ids) => ids.map((id) => ({ id, title: 't', state: 'done', updated: '2026-10-31T00:00:00Z' })) });
  await commands.start(work.workId, undefined);
  await commands.reconcileStarts(board.snapshot().items);
  assert.equal(records.read(work.workId).status, 'Queued');
  assert.equal(board.find(work.workId)?.status, 'Queued');
});

test('stopped shaping resumes in one new thread without changing its gate or starting a build', async () => {
  const records = await openRecords();
  let work = records.create({ title: 'Prototype', repository: WEB, kind: 'feature', status: 'Shaping' });
  work = records.addThread(work.workId, work.revision, 'old', 'shape');
  const { commands, started } = recordedCommands(records, { shown: ids => ids.map(id => ({ id, title: 'Shape',
    state: id === 'old' ? 'stopped' : 'running', updated: '2026-10-31T00:00:00Z' })) });
  const replies = await Promise.all([commands.start(work.workId, undefined), commands.start(work.workId, undefined)]);
  assert.deepEqual(replies.map(reply => reply.status), [200, 200]);
  assert.equal(started.length, 1);
  assert.equal(records.read(work.workId).status, 'Shaping');
  assert.deepEqual(records.threads(work.workId).map(thread => thread.purpose), ['shape', 'shape']);
  assert.equal((await commands.start(work.workId, undefined)).status, 409, 'a running resumed thread is not a second resume');
});

for (const state of ['running', 'needs you', 'done', 'unavailable', 'live child', 'stale'] as const) test(`shaping cannot resume from ${state} thread evidence`, async () => {
  const records = await openRecords();
  let work = records.create({ title: 'Prototype', repository: WEB, kind: 'feature', status: 'Shaping' });
  work = records.addThread(work.workId, work.revision, 'old', 'shape');
  const { commands, started } = recordedCommands(records, { shown: ids => state === 'unavailable' ? 'unavailable' : ids.map(id => ({ id,
    title: 'Shape', state: state === 'live child' || state === 'stale' ? 'stopped' : state,
    ...state === 'live child' && { hasLiveChildren: true }, ...state === 'stale' && { observedAt: '2026-10-31T00:00:00Z' },
    updated: '2026-10-31T00:00:00Z' })) });
  assert.equal((await commands.start(work.workId, undefined)).status, 409);
  assert.deepEqual(started, []);
});

test('a completed Ready shaping gate never resumes shaping even if its old thread stopped', async () => {
  const records = await openRecords();
  let work = records.create({ title: 'Prototype', repository: WEB, kind: 'feature', status: 'Ready' });
  work = records.addThread(work.workId, work.revision, 'old', 'shape');
  const { commands, started } = recordedCommands(records, { shown: ids => ids.map(id => ({ id, title: 'Shape', state: 'stopped', updated: '2026-10-31T00:00:00Z' })) });
  assert.equal((await commands.start(work.workId, undefined)).status, 409);
  assert.deepEqual(started, []);
});

test("Start build snapshots the repository's selected project skills on the record and names the work ID", async () => {
  const records = await openRecords();
  const build = records.create({ title: 'Fix login', repository: WEB, kind: 'build', status: 'Ready' });
  const { commands, started } = recordedCommands(records, { skills: ['code-review', 'web-deploy'] });
  assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
  assert.deepEqual(records.read(build.workId).skills, ['code-review', 'web-deploy']);
  assert.match(started[0]!, new RegExp(`^Build Fix login\\nBuild ${build.workId}\\. Read `));
  assert.deepEqual(records.threads(build.workId).map((t) => t.purpose), ['build']);
});

test('a closed ticket recovers from local failure without a second transition', async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'bug', status: 'List', ticket: `${WEB}#7` }).record;
  const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
  const tickets = [queued(7)];
  const reread = () => board.update({ items: recordItems(records, tickets, [WEB]) });
  reread();
  let transitions = 0;
  const commands = createItemCommands({ factoryContext: null, board, records, reread,
    archive: () => archivedItems(records, tickets, [WEB], new Set()), offerModelChoices: () => [],
    items: { observeTicket: async () => ({ state: 'closed' }), abandon: async () => { transitions++; return null; } } as unknown as ItemSource });
  const setAside = vi.spyOn(records, 'setAside').mockImplementationOnce(() => { throw new Error('Disk unavailable'); });
  const failed = await commands.abandonAndClose(work.workId);
  assert.equal(failed.status, 409);
  assert.match(JSON.stringify(failed.body), /ticket is closed.*work remains on the board/);
  assert.ok(board.find(work.workId));
  setAside.mockRestore();
  assert.equal((await commands.abandonAndClose(work.workId)).status, 200);
  assert.equal((await commands.abandonAndClose(work.workId)).status, 200);
  assert.equal(transitions, 0);
  assert.equal(board.find(work.workId), undefined);
});

for (const removed of [false, true]) test(`Azure ${removed ? 'Removed' : 'Completed'} recovery uses the intended abandonment outcome`, async () => {
  let transitions = 0;
  const board = createBoardState({ items: [queued(7)], repos: [], modelChoices: [] } as unknown as BoardData);
  const commands = createItemCommands({ factoryContext: null, board, records: null, reread: () => {}, archive: () => [], offerModelChoices: () => [],
    items: { observeTicket: async () => ({ state: 'closed', abandonmentComplete: removed }), abandon: async () => { transitions++; return null; } } as unknown as ItemSource });
  assert.equal((await commands.abandonAndClose(queued(7).id)).status, 200);
  assert.equal(transitions, removed ? 0 : 1);
});

test('combined requests share a transition and exclude Start while the provider is pending', async () => {
  let finish!: (error: string | null) => void;
  let transitions = 0;
  const board = createBoardState({ items: [queued(7)], repos: [], modelChoices: [] } as unknown as BoardData);
  const commands = createItemCommands({ factoryContext: null, board, records: null, reread: () => {}, archive: () => [], offerModelChoices: () => [],
    items: { observeTicket: async () => ({ state: 'open' }), abandon: () => { transitions++; return new Promise<string | null>(resolve => { finish = resolve; }); } } as unknown as ItemSource });
  const first = commands.abandonAndClose(queued(7).id);
  const duplicate = commands.abandonAndClose(queued(7).id);
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(transitions, 1);
  assert.equal((await commands.start(queued(7).id, undefined)).status, 409);
  assert.equal(commands.abandon(queued(7).id).status, 409);
  finish(null);
  assert.equal((await first).status, 200);
  assert.equal((await duplicate).status, 200);
});

for (const extra of [{ number: null }, { abandonRefusal: 'Refused' }, { status: 'In progress' }]) test(`ineligible combined abandonment causes no provider write: ${JSON.stringify(extra)}`, async () => {
  let calls = 0;
  const item = queued(7, extra as Partial<Item>);
  const board = createBoardState({ items: [item], repos: [], modelChoices: [] } as unknown as BoardData);
  const commands = createItemCommands({ factoryContext: null, board, records: null, reread: () => {}, archive: () => [], offerModelChoices: () => [],
    items: { observeTicket: async () => { calls++; return { state: 'open' }; }, abandon: async () => { calls++; return null; } } as unknown as ItemSource });
  assert.equal((await commands.abandonAndClose(item.id)).status, 409);
  assert.equal(calls, 0);
});

test('an active Start prevents combined abandonment before provider access', async () => {
  const { commands, log, board } = commandsOn([queued(7)]);
  assert.equal((await commands.start(queued(7).id, undefined)).status, 200);
  const before = [...log];
  assert.equal((await commands.abandonAndClose(queued(7).id)).status, 409);
  assert.deepEqual(log, before);
  assert.ok(board.find(queued(7).id));
});

 test('deleted-thread recovery refuses Clear without changing status', async () => {
  const item = queued(91, { status: 'Review', threads: [], needsYou: { reason: 'Deleted', deletedThread: true, offers: ['back-to-list'] } });
  const records = await openRecords();
  const { commands, board } = commandsOn([], undefined, records);
  board.update({ items: [item] });
  assert.equal((await commands.resolveNeedsYou(item.id, 'clear')).status, 409);
});

for (const briefChoice of ['keep', 'reshape'] as const) test(`deleted-thread move requires a brief choice and can ${briefChoice}`, async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Recover work', repository: WEB, kind: 'build', status: 'Review' });
  records.setBody(work.workId, work.revision, 'brief', 'Keep this brief.');
  records.recordGate(work.workId, records.read(work.workId).revision, { briefDigest: records.gate(work.workId).briefDigest!, approvedBy: 'test', evidence: 'Passed.' });
  const { commands, board } = recordedCommands(records);
  const item = board.find(work.workId)!;
  board.update({ items: [{ ...item, threads: [], needsYou: { reason: 'Deleted', deletedThread: true, offers: ['back-to-list'] } }] });
  assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list', 'invalid')).status, 422);
  assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list')).status, 422);
  assert.equal(records.read(work.workId).status, 'Review');
  assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list', briefChoice)).status, 200);
  assert.equal(records.read(work.workId).status, 'List');
  assert.equal(records.body(work.workId, 'brief'), 'Keep this brief.');
  assert.equal(records.gate(work.workId).current, briefChoice === 'keep');
});

test('Shape after moving back starts fresh despite an older idle thread', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Recover shaping', repository: WEB, kind: 'feature', status: 'Queued' });
  records.addThread(work.workId, work.revision, 'older', 'shape');
  records.addThread(work.workId, records.read(work.workId).revision, 'deleted', 'shape');
  records.confirmThreadDeleted(work.workId, records.read(work.workId).revision, 'deleted');
  const { commands, started } = recordedCommands(records, { shown: () => [{ id: 'older', title: 'Old work', updated: '2026-11-01T00:00:00Z', state: 'done' }] });
  assert.equal((await commands.start(work.workId, undefined)).status, 200);
  assert.equal(started.length, 1);
});

test('Start again preserves launch intents and continues a deleted build on its branch', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Recover build', repository: WEB, kind: 'build', status: 'In progress' });
  records.addThread(work.workId, records.read(work.workId).revision, 'deleted-build', 'build');
  records.confirmThreadDeleted(work.workId, records.read(work.workId).revision, 'deleted-build');
  const { board, commands, bases, branches } = commandsOn([], undefined, records);
  const item = board.find(work.workId)!;
  board.update({ items: [{ ...item, threads: [], needsYou: { reason: 'Deleted', deletedThread: true, offers: ['start-again'] } }] });
  assert.equal((await commands.startAgain(work.workId, undefined, {})).status, 409);
  assert.equal(records.launchIntents({ workId: work.workId }).length, 0);
  assert.equal((await commands.startAgain(work.workId, undefined, { branchChoice: 'continue' })).status, 200);
  assert.deepEqual(branches, ['old']);
  assert.deepEqual(bases, ['old']);
  assert.equal(records.threads(work.workId).length, 2);
  assert.equal(records.launchIntents({ workId: work.workId, unresolved: true }).length, 0);
});

test('recovery options reject invalid values before launching', async () => {
  const { commands, log } = commandsOn([queued(1)]);
  assert.equal((await commands.startAgain(queued(1).id, undefined, { branchChoice: 'erase' })).status, 422);
  assert.equal((await commands.inspectRecovery(queued(1).id)).status, 409);
  assert.deepEqual(log, []);
});

test('cleanup rejects malformed selections and unknown tokens before side effects', async () => {
  const { commands, log } = commandsOn([queued(1)]);
  for (const input of [null, [], { token: 'x', local: 'yes' }, { token: 'x', branch: 'main' }, { remote: true }]) {
    assert.equal((await commands.executeOwnedCleanup(queued(1).id, input)).status, 422);
  }
  assert.equal((await commands.executeOwnedCleanup(queued(1).id, { token: 'unknown', local: true })).status, 409);
  assert.deepEqual(log, []);
});

test('empty cleanup ownership is inspectable despite unrelated live repository threads', async () => {
  const records = await openRecords();
  const record = records.create({ title: 'Shaping', repository: WEB, kind: 'issue', status: 'Shaping' });
  const { board, commands } = commandsOn([], undefined, records);
  board.update({ items: [...board.snapshot().items, queued(999, { threads: [{ id: 'other', state: 'running', title: 'Live', updated: new Date().toISOString() }] })] });
  const reply = await commands.inspectOwnedCleanup(record.workId);
  assert.equal(reply.status, 200);
  assert.deepEqual((reply.body as { plans: unknown[] }).plans, []);
});

test('cleanup confirmations replace previous item tokens and expire', async () => {
  const records = await openRecords();
  const record = records.create({ title: 'Empty', repository: WEB, kind: 'issue' });
  const { commands } = commandsOn([], undefined, records);
  const first = (await commands.inspectOwnedCleanup(record.workId)).body as { token: string };
  const second = (await commands.inspectOwnedCleanup(record.workId)).body as { token: string };
  assert.equal((await commands.executeOwnedCleanup(record.workId, { token: first.token })).status, 409);
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 11 * 60_000);
  try { assert.equal((await commands.executeOwnedCleanup(record.workId, { token: second.token })).status, 409); }
  finally { clock.mockRestore(); }
});
