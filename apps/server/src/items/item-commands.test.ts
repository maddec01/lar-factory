import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test, vi } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { effectiveVocabulary } from '@lar-factory/shared';
import type { BoardData, Item, ItemThread, NeedsYouCause, OperationAccess, ShapingThreadCleanup, StartResult, Status } from '@lar-factory/shared';
import { openWorkRecords, WorkRecordError, type WorkRecords } from '@lar-factory/work-records';
import { createBoardState } from '../board/board-state.ts';
import { createItemCommands, type ItemCommandsDeps } from './item-commands.ts';
import { NO_THREAD } from './needs-you-causes.ts';
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
    assert.equal((reply.body as { hold?: true }).hold, true, 'Auto-build holds instead of pausing the build');
    assert.equal(records.read(build.workId).revision, build.revision);
    assert.deepEqual(records.launchIntents({ workId: build.workId }), []);
    assert.deepEqual(log, []);
    const shape = records.importTicket({ title: 'Read-only shaping', repository: WEB, kind: 'issue', status: 'Queued', ticket: `${WEB}#8` }).record;
    reread();
    assert.equal((await commands.start(shape.workId, undefined)).status, 200);
    assert.equal(log.length, 1);
  });
}

test("Start build marks the refusals that pass by themselves, a project or default-branch read failing, and not a build that can't start", async () => {
  const records = await openRecords();
  const build = records.importTicket({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready', ticket: `${WEB}#7` }).record;
  const failing: [string, Partial<ItemCommandsDeps>][] = [
    ['T3 has no project for this repository.', { projectOf: async () => ({ error: 'T3 has no project for this repository.' }) }],
    ['Could not read the repository’s default branch. Retry after checking access.', { baseOf: async () => { throw new Error('offline'); } }],
  ];
  for (const [error, deps] of failing) {
    const { commands } = commandsOn([], undefined, records, [], undefined, undefined, undefined, deps);
    const { body } = await commands.startBuild(build.workId, undefined, undefined, true);
    assert.deepEqual([(body as { error: string }).error, (body as { hold?: true }).hold], [error, true]);
  }
  const queued = records.importTicket({ title: 'Queued', repository: WEB, kind: 'issue', status: 'Queued', ticket: `${WEB}#8` }).record;
  const { commands } = commandsOn([], undefined, records);
  const { body } = await commands.startBuild(queued.workId, undefined);
  assert.equal((body as { hold?: true }).hold, undefined);
});

/**
 * Commands on a board holding `items`, whose source records each abandon it gets. Given `records`, the board shows their items and Archive with `tickets` as the source read them, and reads them
 * again after each write.
 */
function commandsOn(items: Item[], showThread?: () => Promise<'live' | 'deleted' | 'unknown'>, records?: WorkRecords, tickets: Item[] = [], access: Partial<Record<'push-branch' | 'open-pr', OperationAccess>> = { 'push-branch': 'allowed', 'open-pr': 'allowed' }, whileReopening: () => void = () => {}, provider: { ticket?: ItemSource['observeTicket']; pr?: (repo: string, number: number) => Promise<'open' | 'closed' | 'merged'> } = {}, deps: Partial<ItemCommandsDeps> = {}) {
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
    readTicket: async (_repo: string, number: number) => ({number, title: `Item ${number}`, text: 'Description', kind: 'issue'}),
    observeTicket: provider.ticket ?? (async () => ({ state: 'open' })),
    abandon: async (item: Item) => {
      log.push(`abandon ${item.number}`);
      return null;
    },
  } as unknown as ItemSource;
  const commands = createItemCommands({ factoryContext:null, checkoutOf: async () => '/repo',
    inspectWorkRecovery: async () => ({ branch: 'old', branchExists: true, worktreePath: null, pr: 'none' }), board, items: source, records: records ?? null, reread, archive, offerModelChoices: () => [],
    showThread, reopenPr: async (repo, number) => { whileReopening(); log.push(`reopen ${repo}#${number}`); }, readPr: provider.pr ?? (async () => 'open'), projectOf: async (repo) => ({ projectId: repo }), baseOf: async () => 'release', buildAccessOf: () => access,
    startThread: async (project, message, _choice, worktree) => {
      branches.push(worktree?.branch);
      bases.push(worktree && 'base' in worktree ? worktree.base : undefined);
      log.push(`start ${project} ${message.split('\n')[1]}`);
      return { thread: { threadId: `thread-${branches.length}`, title: 't' }, error: null };
    }, ...deps });
  return { board, commands, log, branches, bases, archive, reread };
}

test('unpicked ticket abandonment saves a local record and offers Archive restore', async () => {
  const records = await openRecords();
  const ticket = queued(7);
  const { commands, board, archive } = commandsOn([], undefined, records, [ticket]);
  const reply = await commands.abandon(ticket.id);
  assert.equal(reply.status, 200);
  assert.equal(board.snapshot().items.length, 0);
  assert.equal(archive().length, 1);
  assert.notEqual(archive()[0]!.id, ticket.id);
  const restarted = await openWorkRecords(join(opened.at(-1)!.dir, 'work-records.db'));
  try {
    assert.equal(recordItems(restarted, [ticket], [WEB]).length, 0);
    assert.equal(archivedItems(restarted, [ticket], [WEB], new Set()).length, 1);
  } finally { restarted.close(); }
  assert.equal((await commands.restore(archive()[0]!.id)).status, 200);
  assert.equal(board.snapshot().items.length, 1);
});

for (const failure of ['none', 'import', 'close', 'read']) test(`unpicked combined abandonment handles ${failure} failure without duplicate closure or records`, async () => {
  const records = await openRecords();
  const ticket = queued(7);
  const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
  const reread = () => board.update({ items: recordItems(records, [ticket], [WEB]) });
  reread();
  let closed = false;
  let closes = 0;
  let fail = true;
  const source = {
    readTicket: async () => {
      if (failure === 'read' && fail) throw new Error('Read failed');
      return { number: 7, title: 'Target', text: 'Target description\n<!-- lar-factory:structure\n{}\n-->', kind: 'issue', tracker: { snapshot: 'must not restore' } };
    },
    observeTicket: async () => ({ state: closed ? 'closed' : 'open' }),
    abandon: async (item: Item) => {
      assert.equal(item.id, ticket.id);
      if (failure === 'close' && fail) return 'Close failed';
      closes++; closed = true; return null;
    },
  } as unknown as ItemSource;
  const commands = createItemCommands({ factoryContext: null, board, records, reread,
    archive: () => archivedItems(records, [ticket], [WEB], new Set()), offerModelChoices: () => [], items: source });
  const imported = records.importTicket.bind(records);
  const spy = vi.spyOn(records, 'importTicket').mockImplementation(input => {
    if (failure === 'import' && fail) throw new Error('Disk unavailable');
    return imported(input);
  });
  try {
    const first = await commands.abandonAndClose(ticket.id);
    assert.equal(first.status, failure === 'none' ? 200 : failure === 'import' ? 409 : 502);
    if (failure !== 'none') {
      assert.equal(records.list({}).length, 0);
      assert.ok(board.find(ticket.id));
      fail = false;
      assert.equal((await commands.abandonAndClose(ticket.id)).status, 200);
    }
    assert.equal(closes, 1);
    assert.equal(records.list({}).length, 1);
    assert.equal(records.list({})[0]!.setAside, true);
    assert.equal(records.list({})[0]!.parentId, null);
    assert.equal(recordItems(records, [ticket], [WEB]).length, 0);
    assert.equal((await commands.restore(records.list({})[0]!.workId)).status, 200);
  } finally { spy.mockRestore(); }
});

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
    const response = await commands.abandon(work.workId);
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
  assert.equal((await commands.abandon(work.workId)).status, 200);
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
  assert.equal((await commands.restore(work.workId)).status, 200);
  assert.deepEqual([board.find(work.workId)?.status, archive()], ['Queued', []]);
  const again = await commands.restore(work.workId);
  assert.deepEqual([again.status, (again.body as { error: string }).error], [409, "That work isn't set aside in Archive, so there is nothing to restore."]);
});

test("a ticket close refuses work whose abandonRefusal says why, and work whose ticket the board doesn't see open", async () => {
  const refusal = "Issue has no Removed state in Fabrikam, so the board can't abandon it. Close or delete it in Azure DevOps.";
  const records = await openRecords();
  const refused = records.importTicket({ title: 'Refused', repository: WEB, kind: 'bug', status: 'Queued', ticket: `${WEB}#7` }).record;
  const closed = records.importTicket({ title: 'Closed', repository: WEB, kind: 'bug', status: 'Queued', ticket: `${WEB}#8` }).record;
  const { commands, log } = commandsOn([], undefined, records, [queued(7, { abandonRefusal: refusal }), queued(8, { state: 'closed' })]);
  assert.equal((await commands.abandon(refused.workId)).status, 200);
  assert.equal((await commands.abandon(closed.workId)).status, 200);
  const answers = await Promise.all([commands.closeTicket(refused.workId), commands.closeTicket(closed.workId)]);
  assert.deepEqual(answers.map((a) => [a.status, (a.body as { error: string }).error]), [[409, refusal],
    [409, "The board doesn't see that work's ticket open, so it closes nothing. Check it in its provider."]]);
  assert.deepEqual(log, []);
});

/** A Review build on WEB whose PR #40 is observed closed unmerged, with its build thread, waiting on the user. */
async function closedPrBuild({ whileReopening, ticket = false, stored = (opened: WorkRecords) => opened }: { whileReopening?: (records: WorkRecords, workId: string) => void; ticket?: boolean; stored?: (records: WorkRecords) => WorkRecords } = {}) {
  const records = await openRecords();
  const created = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Review' });
  let record = records.setPullRequest(created.workId, created.revision, `${WEB}#40`);
  record = records.addThread(created.workId, record.revision, 'thread-0', 'build');
  record = records.observe(created.workId, record.revision, { of: 'pr', state: 'closed' });
  if (ticket) {
    record = records.attachTicket(created.workId, record.revision, `${WEB}#7`);
    record = records.observe(created.workId, record.revision, { of: 'ticket', state: 'closed' });
  }
  records.setNeedsYouCauses(created.workId, record.revision, [{ type: 'pr-closed' }, ...ticket ? [{ type: 'ticket-closed' } as const] : []]);
  return { records, workId: created.workId, ...commandsOn([], undefined, stored(records), [], undefined, () => whileReopening?.(records, created.workId)) };
}

test('reopening a closed PR from Needs you reopens it in its provider and clears the reason', async () => {
  const { records, workId, commands, log } = await closedPrBuild();
  assert.equal((await commands.resolveNeedsYou(workId, 'reopen-pr')).status, 200);
  assert.deepEqual(log, [`reopen ${WEB}#40`]);
  assert.deepEqual([records.read(workId).needsYouCauses, records.read(workId).status], [[], 'Review']);
});

test('a replacement build from Needs you readies the work, and Start build then starts a new thread on a new branch', async () => {
  const { records, workId, commands, branches } = await closedPrBuild();
  assert.equal((await commands.resolveNeedsYou(workId, 'replace-pr')).status, 200);
  assert.deepEqual([records.read(workId).needsYouCauses, records.read(workId).status], [[], 'Ready']);
  assert.equal((await commands.startBuild(workId, undefined)).status, 200);
  assert.equal(branches.length, 1, 'the closed PR\'s thread holds no start');
  assert.match(branches[0]!, /-retry-[a-f0-9]+$/);
});

test('setting work aside from Needs you works in any Status, though a thread worked on it', async () => {
  const { records, workId, commands } = await closedPrBuild();
  assert.equal((await commands.abandon(workId)).status, 200);
  assert.equal(records.read(workId).setAside, true);
});

test('Needs you refuses Clear, a removed choice and any choice its notice does not offer, and changes nothing', async () => {
  const { records, workId, commands, log } = await closedPrBuild();
  const before = records.read(workId);
  for (const choice of ['clear', 'reopen-work', 'keep-working', 'mark-handled', 'set-aside', 'start-again', 'back-to-list', undefined]) {
    assert.equal((await commands.resolveNeedsYou(workId, choice)).status, 409, String(choice));
  }
  assert.deepEqual([records.read(workId), log], [before, []]);
});

test('Start again on a no-thread notice stays out of Needs you, so only a started thread removes it', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  records.setNeedsYouCauses(work.workId, work.revision, [{ type: 'no-thread' }]);
  const { commands } = recordedCommands(records);
  assert.equal((await commands.resolveNeedsYou(work.workId, 'start-again')).status, 409);
  assert.deepEqual(records.read(work.workId).needsYouCauses, [{ type: 'no-thread' }]);
});

/** Work whose last `purpose` start failed with no thread, waiting on the user. */
async function noThreadWork(purpose: 'shape' | 'build', status: Status = purpose === 'build' ? 'Ready' : 'Queued') {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'build', status });
  const { record, intent } = records.recordLaunchIntent(work.workId, work.revision, purpose);
  const failed = records.resolveLaunchIntent(work.workId, record.revision, intent.intentId, { failure: NO_THREAD }).record;
  records.setNeedsYouCauses(work.workId, failed.revision, [{ type: 'no-thread' }]);
  return { records, workId: work.workId };
}

test('Start again on a no-thread notice keeps it when the start fails and removes it once a thread starts', async () => {
  const { records, workId } = await noThreadWork('shape');
  let answerWith: StartResult | null = { thread: null, error: 'T3 refused.' };
  const { commands, board, started } = recordedCommands(records, { startAnswer: () => answerWith });
  assert.equal(board.find(workId)!.needsYou!.startAgainPurpose, 'shape');
  const failed = await commands.startAgain(workId, undefined, {});
  assert.deepEqual([failed.status, (failed.body as { error: string }).error], [502, 'T3 refused.']);
  assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'no-thread' }]);
  answerWith = null;
  assert.equal((await commands.startAgain(workId, undefined, {})).status, 200);
  assert.equal(started.length, 1);
  assert.deepEqual(records.read(workId).needsYouCauses, []);
  assert.deepEqual(records.threads(workId).map((t) => t.purpose), ['shape']);
});

test('Start again on a no-thread notice takes the build purpose from its failed start, not an older shaping thread', async () => {
  const { records, workId } = await noThreadWork('build');
  records.addThread(workId, records.read(workId).revision, 'older-shape', 'shape');
  const { commands, board } = recordedCommands(records, { shown: (ids) => ids.map((id) => ({ id, title: 't', state: 'done' as const, updated: '2026-10-31T00:00:00Z' })) });
  assert.equal(board.find(workId)!.needsYou!.startAgainPurpose, 'build');
  assert.equal((await commands.inspectRecovery(workId)).status, 200);
  assert.equal((await commands.startAgain(workId, undefined, {})).status, 409, 'its branch waits for a choice');
  assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'no-thread' }]);
  assert.equal((await commands.startAgain(workId, undefined, { branchChoice: 'continue' })).status, 200);
  assert.deepEqual(records.read(workId).needsYouCauses, []);
  assert.deepEqual(records.threads(workId).map((t) => t.purpose), ['shape', 'build']);
});

test('Start again refuses while the board has not yet read a thread the record now holds', async () => {
  const { records, workId } = await noThreadWork('build');
  const { commands, board, started } = recordedCommands(records);
  records.addThread(workId, records.read(workId).revision, 'just-recorded', 'build');
  assert.equal(board.find(workId)?.threads, undefined, 'the board last read no threads');
  assert.equal((await commands.inspectRecovery(workId)).status, 409);
  assert.equal((await commands.startAgain(workId, undefined, {})).status, 409);
  assert.deepEqual(started, []);
});

test('Start again refuses while the board shows an older stopped thread but has not yet read a newer one', async () => {
  const { records, workId } = await noThreadWork('build');
  records.addThread(workId, records.read(workId).revision, 'older-shape', 'shape');
  const { commands, board, started, reread } = recordedCommands(records, { shown: (ids) => ids.map((id) => ({ id, title: 't', state: 'stopped' as const, updated: '2026-10-31T00:00:00Z' })) });
  records.addThread(workId, records.read(workId).revision, 'just-recorded', 'build');
  assert.deepEqual((board.find(workId)?.threads as ItemThread[]).map((t) => t.id), ['older-shape'], 'the board last read only the older thread');
  assert.equal((await commands.inspectRecovery(workId)).status, 409);
  assert.equal((await commands.startAgain(workId, undefined, {})).status, 409);
  assert.deepEqual(started, []);
  reread();
  assert.equal((await commands.inspectRecovery(workId)).status, 200, 'the next read shows both stopped');
});

test('an uncertain Start again keeps the no-thread notice until T3 shows its thread', async () => {
  const { records, workId } = await noThreadWork('shape');
  const { commands } = recordedCommands(records, { startAnswer: () => ({ thread: null, error: 'It may have started.', uncertain: true }), recover: async () => ({ threadId: 'late', title: 'Work' }) });
  const uncertain = await commands.startAgain(workId, undefined, {});
  assert.deepEqual([uncertain.status, (uncertain.body as { uncertain?: boolean }).uncertain], [502, true]);
  assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'no-thread' }]);
  assert.equal((await commands.startAgain(workId, undefined, {})).status, 200);
  assert.deepEqual(records.read(workId).needsYouCauses, []);
  assert.deepEqual(records.threads(workId).map((t) => t.threadId), ['late']);
});

test('Start again stays refused while T3 cannot be read, and on a notice that does not offer it', async () => {
  const { records, workId } = await noThreadWork('shape');
  const { commands, board } = recordedCommands(records);
  board.update({ items: [{ ...board.find(workId)!, threads: 'unavailable' }] });
  assert.equal((await commands.startAgain(workId, undefined, {})).status, 409);
  const closed = await noThreadWork('shape');
  closed.records.setNeedsYouCauses(closed.workId, closed.records.read(closed.workId).revision, [{ type: 'no-thread' }, { type: 'pr-closed' }]);
  assert.equal((await recordedCommands(closed.records).commands.startAgain(closed.workId, undefined, {})).status, 409);
  assert.deepEqual(closed.records.launchIntents({ workId: closed.workId, unresolved: true }), []);
});

test('Start refuses while causes and free text remain, and Mark as handled removes free text alone', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  records.setNeedsYou(work.workId, work.revision, 'Merge conflict.');
  records.setNeedsYouCauses(work.workId, records.read(work.workId).revision, [{ type: 'no-thread' }]);
  const { commands, started } = recordedCommands(records);
  const refused = await commands.start(work.workId, undefined);
  assert.equal(refused.status, 409);
  assert.match((refused.body as { error: string }).error, /^Needs you: The board asked T3 for a thread.* Merge conflict\.$/);
  assert.deepEqual(started, []);
  assert.equal((await commands.resolveNeedsYou(work.workId, 'mark-handled')).status, 409, 'the cause offers Start again');
  records.setNeedsYouCauses(work.workId, records.read(work.workId).revision, []);
  const before = records.read(work.workId);
  const handling = recordedCommands(records).commands;
  assert.equal((await handling.resolveNeedsYou(work.workId, 'mark-handled')).status, 200);
  const after = records.read(work.workId);
  assert.deepEqual({ ...after, revision: 0, updatedAt: '' }, { ...before, needsYou: null, revision: 0, updatedAt: '' });
  assert.equal((await handling.resolveNeedsYou(work.workId, 'mark-handled')).status, 409, 'work that no longer needs you has nothing to handle');
  assert.equal((await handling.start(work.workId, undefined)).status, 200);
});

/** An In progress feature on ticket WEB#7, read open and assigned to pedro, then read as `change`, with its observer and commands. */
async function observedTicketWork(change: { state: 'open' | 'closed'; assignee?: string }) {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'feature', status: 'In progress', ticket: `${WEB}#7` }).record;
  records.observe(work.workId, work.revision, { of: 'ticket', state: 'open', assignee: 'pedro' });
  const { commands, log, reread, board } = commandsOn([], undefined, records);
  const read = (next: { state: 'open' | 'closed'; assignee?: string }) => observeRecords(records, [WEB], { ticket: async () => next, pr: async () => 'open' }, new Set(), reread);
  await read(change);
  reread();
  return { records, workId: work.workId, commands, log, read, board };
}

/** In progress work on ticket WEB#7 and closed PR WEB#40, read open and assigned to pedro, set aside with the Needs you `causes`. */
async function archivedWork(causes: NeedsYouCause[], provider: Parameters<typeof commandsOn>[6]) {
  const records = await openRecords();
  const { record: work } = records.importTicket({ title: 'Work', repository: WEB, kind: 'feature', status: 'In progress', ticket: `${WEB}#7` });
  let record = records.setPullRequest(work.workId, work.revision, `${WEB}#40`);
  record = records.observe(work.workId, record.revision, { of: 'pr', state: 'closed' });
  record = records.observe(work.workId, record.revision, { of: 'ticket', state: causes.some((cause) => cause.type === 'ticket-closed') ? 'closed' : causes.some((cause) => cause.type === 'ticket-missing') ? 'not-found' : 'open',
    assignee: causes.some((cause) => cause.type === 'assignee-changed') ? 'sam' : 'pedro' });
  record = records.setNeedsYouCauses(work.workId, record.revision, causes);
  records.setAside(work.workId, record.revision);
  return { records, workId: work.workId, ...commandsOn([], undefined, records, [], undefined, undefined, provider) };
}

const TICKET_CLOSED: NeedsYouCause = { type: 'ticket-closed' };
const PR_CLOSED: NeedsYouCause = { type: 'pr-closed' };
const MOVED: NeedsYouCause = { type: 'assignee-changed', from: 'pedro', to: 'sam' };

test('Restore shows the notice and its offers when each cause still holds', async () => {
  const closed = await archivedWork([TICKET_CLOSED], { ticket: async () => ({ state: 'closed', assignee: 'pedro' }), pr: async () => 'open' });
  assert.equal((await closed.commands.restore(closed.workId)).status, 200);
  assert.deepEqual(closed.board.find(closed.workId)?.needsYou?.offers, ['keep-working', 'set-aside']);
  const pr = await archivedWork([PR_CLOSED], { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'closed' });
  assert.equal((await pr.commands.restore(pr.workId)).status, 200);
  assert.deepEqual(pr.board.find(pr.workId)?.needsYou?.offers, ['reopen-pr', 'replace-pr', 'set-aside']);
});

for (const [what, causes, provider] of [
  ['ticket reopened', [TICKET_CLOSED], { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'open' }],
  ['PR reopened', [PR_CLOSED], { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'open' }],
  ['assignee changed back', [MOVED], { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'open' }],
] as [string, NeedsYouCause[], Parameters<typeof commandsOn>[6]][]) test(`work whose ${what} while in Archive comes back with no notice`, async () => {
  const { records, workId, commands, board } = await archivedWork(causes, provider);
  assert.equal((await commands.restore(workId)).status, 200);
  assert.equal(board.find(workId)?.needsYou, undefined);
  assert.deepEqual(records.read(workId).needsYouCauses, []);
});

test('a failed read during Restore still restores, with the notice as last saved, and the next observer pass settles it', async () => {
  const fail = async () => { throw new Error('Provider unavailable.'); };
  const { records, workId, commands, board, reread } = await archivedWork([TICKET_CLOSED, PR_CLOSED], { ticket: fail, pr: fail });
  assert.equal((await commands.restore(workId)).status, 200);
  assert.deepEqual(board.find(workId)?.needsYou?.causes, [TICKET_CLOSED, PR_CLOSED]);
  await observeRecords(records, [WEB], { ticket: async () => ({ state: 'open', assignee: 'pedro' }), pr: async () => 'open' }, new Set(), reread);
  assert.equal(board.find(workId)?.needsYou, undefined);
});

test('a missing ticket that reads as found ends its cause at Restore, and one still not found goes back to Archive', async () => {
  const found = await archivedWork([{ type: 'ticket-missing' }], { ticket: async () => ({ state: 'open', assignee: 'pedro' }) });
  assert.equal((await found.commands.restore(found.workId)).status, 200);
  assert.equal(found.board.find(found.workId)?.needsYou, undefined);
  const missing = await archivedWork([{ type: 'ticket-missing' }], { ticket: async () => ({ state: 'not-found' }) });
  assert.equal((await missing.commands.restore(missing.workId)).status, 200);
  assert.equal(missing.board.find(missing.workId), undefined);
  assert.deepEqual(missing.archive().map((item) => item.id), [missing.workId]);
});

test('a free-text reason comes back from Restore as it was', async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'feature', status: 'In progress', ticket: `${WEB}#7` }).record;
  records.setAside(work.workId, records.setNeedsYou(work.workId, work.revision, 'Merge conflict.').revision);
  const { commands, board } = commandsOn([], undefined, records);
  assert.equal((await commands.restore(work.workId)).status, 200);
  assert.equal(board.find(work.workId)?.needsYou?.reason, 'Merge conflict.');
});

test('Keep working on a closed ticket removes the notice, keeps the Status and the closed read, and the same read raises nothing', async () => {
  const { records, workId, commands, log, read, board } = await observedTicketWork({ state: 'closed', assignee: 'pedro' });
  assert.deepEqual(board.find(workId)?.needsYou?.offers, ['keep-working', 'set-aside']);
  assert.equal((await commands.resolveNeedsYou(workId, 'keep-working')).status, 200);
  assert.equal(board.find(workId)?.needsYou, undefined);
  assert.deepEqual([records.read(workId).status, records.read(workId).ticket, log], ['In progress', `${WEB}#7`, []]);
  assert.equal(records.observations(workId).find((o) => o.of === 'ticket')?.state, 'closed');
  await read({ state: 'closed', assignee: 'pedro' });
  assert.deepEqual(records.read(workId).needsYouCauses, []);
});

test('Keep working on an assignee change removes the notice, and a later move to a new assignee raises a new one', async () => {
  const { records, workId, commands, read } = await observedTicketWork({ state: 'open', assignee: 'sam' });
  assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'assignee-changed', from: 'pedro', to: 'sam' }]);
  assert.equal((await commands.resolveNeedsYou(workId, 'keep-working')).status, 200);
  assert.equal(records.read(workId).status, 'In progress');
  await read({ state: 'open', assignee: 'sam' });
  assert.deepEqual(records.read(workId).needsYouCauses, []);
  await read({ state: 'open', assignee: 'alex' });
  assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'assignee-changed', from: 'sam', to: 'alex' }]);
});

test('Keep working removes a saved old wording with its cause and leaves other free text as a notice of its own', async () => {
  const { records, workId } = await observedTicketWork({ state: 'closed' });
  records.setNeedsYouCauses(workId, records.read(workId).revision, []);
  records.setNeedsYou(workId, records.read(workId).revision, `Its ticket ${WEB}#7 closed in its provider. Set the work aside, or clear this to keep working.`);
  assert.equal((await commandsOn([], undefined, records).commands.resolveNeedsYou(workId, 'keep-working')).status, 200);
  assert.deepEqual([records.read(workId).needsYou, records.read(workId).needsYouCauses], [null, []]);

  records.setNeedsYou(workId, records.read(workId).revision, 'Merge conflict.');
  records.setNeedsYouCauses(workId, records.read(workId).revision, [{ type: 'ticket-closed' }]);
  const mixed = commandsOn([], undefined, records);
  assert.equal((await mixed.commands.resolveNeedsYou(workId, 'keep-working')).status, 200);
  assert.deepEqual([records.read(workId).needsYou, records.read(workId).needsYouCauses], ['Merge conflict.', []]);
  assert.deepEqual(mixed.board.find(workId)?.needsYou?.offers, ['mark-handled', 'set-aside']);
});

test('Reopen PR on a notice that also names a closed ticket removes both causes, and the ticket stays closed', async () => {
  const { records, workId, commands, log } = await closedPrBuild({ ticket: true });
  assert.equal((await commands.resolveNeedsYou(workId, 'reopen-pr')).status, 200);
  assert.deepEqual(log, [`reopen ${WEB}#40`]);
  assert.deepEqual(records.read(workId).needsYouCauses, []);
  assert.equal(records.observations(workId).find((o) => o.of === 'ticket')?.state, 'closed');
});

test('a cause raised while the PR reopens stays, since the notice the user confirmed did not name it', async () => {
  const { records, workId, commands } = await closedPrBuild({ whileReopening: (opened, id) => {
    opened.setNeedsYouCauses(id, opened.read(id).revision, [{ type: 'pr-closed' }, { type: 'ticket-closed' }]);
  } });
  assert.equal((await commands.resolveNeedsYou(workId, 'reopen-pr')).status, 200);
  assert.deepEqual(records.read(workId).needsYouCauses, [{ type: 'ticket-closed' }]);
});

test('a failed PR reopen leaves the notice and the record unchanged', async () => {
  const { records, workId, commands } = await closedPrBuild({ whileReopening: () => { throw new Error('The provider refused.'); } });
  const before = records.read(workId);
  const failed = await commands.resolveNeedsYou(workId, 'reopen-pr');
  assert.equal(failed.status, 502);
  assert.equal((failed.body as { error: string }).error, 'The provider refused.');
  assert.deepEqual(records.read(workId), before);
});

test('a failed write in a replacement leaves the Status and the notice as they were', async () => {
  const { records, workId, commands, board } = await closedPrBuild({ stored: (opened) => ({ ...opened, setNeedsYouCauses: () => { throw new WorkRecordError('invalid', 'The record refused.'); } }) });
  const before = records.read(workId);
  assert.equal((await commands.resolveNeedsYou(workId, 'replace-pr')).status, 409);
  assert.deepEqual(records.read(workId), before);
  assert.deepEqual(board.find(workId)?.needsYou?.causes, [{ type: 'pr-closed' }]);
});

test('a replacement moves the work to Ready and its closed PR raises nothing afterwards', async () => {
  const { records, workId, commands, reread } = await closedPrBuild();
  assert.equal((await commands.resolveNeedsYou(workId, 'replace-pr')).status, 200);
  await observeRecords(records, [WEB], { ticket: async () => ({ state: 'open' }), pr: async () => 'closed' }, new Set(), reread);
  assert.deepEqual([records.read(workId).needsYouCauses, records.read(workId).needsYou, records.read(workId).status], [[], null, 'Ready']);
});

test('Start does not refuse saved old wording whose cause reads ended', async () => {
  const records = await openRecords();
  const work = records.importTicket({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued', ticket: `${WEB}#7` }).record;
  const observed = records.observe(work.workId, work.revision, { of: 'ticket', state: 'open' });
  records.setNeedsYou(work.workId, observed.revision, `Its ticket ${WEB}#7 closed in its provider. Set the work aside, or clear this to keep working.`);
  assert.equal((await recordedCommands(records).commands.start(work.workId, undefined)).status, 200);
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

test('a shaping thread the record holds as deleted raises no start check, with the CLI unavailable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'deleted-shaping-'));
  const records = await openWorkRecords(join(dir, 'records.db'));
  try {
    const { workId } = records.create({ title: 'Work', repository: WEB, kind: 'build', status: 'In progress' });
    records.addThread(workId, records.read(workId).revision, 'shape', 'shape');
    const { intent } = records.recordLaunchIntent(workId, records.read(workId).revision, 'build', undefined, 'delete');
    records.resolveLaunchIntent(workId, records.read(workId).revision, intent.intentId, { threadId: 'build' });
    records.markShapingThreadDeleted('shape');
    let calls = 0;
    const { commands, board } = commandsOn([], async () => { calls++; return 'unknown'; }, records);
    const item = { ...board.snapshot().items[0]!, threads: [{ id: 'build', state: 'done' } as never] };
    const revision = records.read(workId).revision;
    await commands.reconcileStarts([item]);
    assert.equal(calls, 0);
    assert.equal(board.snapshot().startCheckFailures?.[workId], undefined);
    assert.equal(records.read(workId).revision, revision);
  } finally { records.close(); rmSync(dir, { recursive: true, force: true }); }
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
  const decision = records.create({ title: 'Open decision', repository: WEB, kind: 'decision' });
  records.setParent(decision.workId, decision.revision, concept.workId);
  const { commands, log } = commandsOn([], undefined, records);
  assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
  assert.equal(records.read(concept.workId).status, 'In progress');
  assert.ok(log.every((line) => !line.startsWith('status')), log.join('; '));
});

test("Start build and Abandon write at the revision the board's own observations reached, which they show first", async () => {
  const records = await openRecords();
  const concept = records.create({ title: 'Concept', repository: WEB, kind: 'concept', status: 'Shaping', ticket: `${WEB}#40` });
  const made = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  const build = records.setParent(made.workId, made.revision, concept.workId);
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', ticket: `${WEB}#41` });
  let showObservations = () => {};
  // An observation pass commits while the build starts, and the board shows it some turns later.
  const observe = (workId: string) => records.observe(workId, records.read(workId).revision, { of: 'ticket', state: 'open' });
  const { commands, reread } = commandsOn([], undefined, records, [], undefined, undefined, {}, {
    showObservations: () => showObservations(), checkSkills: async () => { observe(concept.workId); return { refusal: null }; } });
  showObservations = reread;
  const started = await commands.startBuild(build.workId, undefined);
  assert.equal(started.status, 200, JSON.stringify(started.body));
  assert.equal(records.read(concept.workId).status, 'In progress');
  observe(work.workId);
  const abandoned = await commands.abandon(work.workId);
  assert.equal(abandoned.status, 200, JSON.stringify(abandoned.body));
  assert.ok(records.read(work.workId).setAside);
});

/**
 * Commands on the board of `records`, where each item shows the threads `shown` gives for its recorded thread IDs, as
 * T3 shows them. Starts record their messages in `started`, and `recover` plays T3's answer to a reconciliation.
 */
function recordedCommands(records: WorkRecords, { shown = (ids: string[]) => ids.map((id) => ({ id, title: 't', state: 'running' as const, updated: '2026-10-31T00:00:00Z' })),
  recover = async (_project: string, _messages: readonly string[]): Promise<{ threadId: string; title: string } | 'absent' | 'unknown'> => 'absent', lookup = async (): Promise<'live' | 'deleted' | 'unknown'> => 'unknown',
  skills = [] as string[], during = () => {}, beforeLaunch = () => {}, cleanupChoice = (): ShapingThreadCleanup => 'archive', startAnswer = () => null, clearedFailuresFile = null }: { clearedFailuresFile?: string | null; cleanupChoice?: () => ShapingThreadCleanup; startAnswer?: () => StartResult | null; shown?: (ids: string[]) => Item['threads']; recover?: (project: string, messages: readonly string[]) => Promise<{ threadId: string; title: string } | 'absent' | 'unknown'>;
  lookup?: () => Promise<'live' | 'deleted' | 'unknown'>; skills?: string[]; during?: () => void; beforeLaunch?: (board: ReturnType<typeof createBoardState>) => void } = {}) {
  const board = createBoardState({ items: [], repos: [], modelChoices: [] } as unknown as BoardData);
  const reread = () => board.update({ items: recordItems(records, [], [WEB]).map((item) => {
    const ids = records.threads(item.id).map((t) => t.threadId);
    return ids.length ? { ...item, threads: shown(ids) } : item;
  }) });
  reread();
  const started: string[] = [];
  const commands = createItemCommands({ clearedFailuresFile, factoryContext:null, checkoutOf: async () => '/repo',
    inspectWorkRecovery: async () => ({ branch: 'old', branchExists: true, worktreePath: null, pr: 'none' }), board, items: {} as ItemSource, records, reread, archive: () => [], offerModelChoices: () => [],
    showThread: lookup, projectOf: async (repo) => { beforeLaunch(board); return { projectId: repo }; }, baseOf: async () => 'release', buildAccessOf: () => ({ 'push-branch': 'allowed', 'open-pr': 'allowed' }), recoverThread: recover, skillsOf: () => skills, shapingThreadCleanupChoice: cleanupChoice,
    startThread: async (_project, message) => {
      during();
      const answered = startAnswer();
      if (answered) return answered;
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

const idle = (ids: string[]) => ids.map((id) => ({ id, title: 't', state: 'done' as const, updated: '2026-10-31T00:00:00Z' }));

/** A record ready to build, with one shaping thread that has stopped. */
async function shapedBuild() {
  const records = await openRecords();
  const made = records.create({ title: 'Build it', repository: WEB, kind: 'feature', status: 'Ready' });
  records.addThread(made.workId, made.revision, 'shape-1', 'shape');
  return { records, workId: made.workId };
}

test('Start build saves the setting, and its shaping threads wait for cleanup once the build thread is recorded', async () => {
  const { records, workId } = await shapedBuild();
  let intents = -1;
  let pendingDuring = -1;
  const { commands } = recordedCommands(records, { shown: idle, during: () => {
    intents = records.launchIntents({ workId, unresolved: true }).filter(intent => intent.shapingThreadCleanup === 'archive').length;
    pendingDuring = records.pendingShapingThreadCleanups().length;
  } });
  assert.equal((await commands.startBuild(workId, undefined)).status, 200);
  assert.deepEqual([intents, pendingDuring], [1, 0]);
  assert.deepEqual(records.pendingShapingThreadCleanups().map(({ threadId, action }) => [threadId, action]), [['shape-1', 'archive']]);
});

test('Start saves no choice on a shaping intent', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  await recordedCommands(records).commands.start(work.workId, undefined);
  assert.equal(records.launchIntents({ workId: work.workId })[0]?.shapingThreadCleanup, undefined);
});

test('an unreadable setting never stops the build, and Keep leaves nothing pending', async () => {
  const unreadable = await shapedBuild();
  const { commands } = recordedCommands(unreadable.records, { shown: idle, cleanupChoice: () => { throw new Error('Unreadable.'); } });
  assert.equal((await commands.startBuild(unreadable.workId, undefined)).status, 200);
  assert.equal(unreadable.records.launchIntents({ workId: unreadable.workId })[0]?.shapingThreadCleanup, 'unreadable');
  assert.deepEqual(unreadable.records.pendingShapingThreadCleanups().map(row => row.action), [null]);

  const keep = await shapedBuild();
  const kept = recordedCommands(keep.records, { shown: idle, cleanupChoice: () => 'keep' });
  assert.equal((await kept.commands.startBuild(keep.workId, undefined)).status, 200);
  assert.deepEqual(keep.records.pendingShapingThreadCleanups(), []);
});

test('a launch settled by a later refresh cleans up with the choice saved at Start build, and an uncertain one changes nothing', async () => {
  const { records, workId } = await shapedBuild();
  records.recordLaunchIntent(workId, records.read(workId).revision, 'build', undefined, 'archive');
  let answer: { threadId: string; title: string } | 'unknown' = 'unknown';
  const { commands, board } = recordedCommands(records, { shown: idle, recover: async () => answer, cleanupChoice: () => 'keep' });
  await commands.reconcileStarts(board.snapshot().items);
  assert.deepEqual(records.pendingShapingThreadCleanups(), []);
  answer = { threadId: 'build-late', title: 'Build it' };
  await commands.startBuild(workId, undefined);
  assert.deepEqual(records.threads(workId).map(t => t.threadId), ['shape-1', 'build-late']);
  assert.deepEqual(records.pendingShapingThreadCleanups().map(({ threadId, action }) => [threadId, action]), [['shape-1', 'archive']]);
});

test('an intent from before this shipped sends nothing, even once resolved', async () => {
  const { records, workId } = await shapedBuild();
  records.recordLaunchIntent(workId, records.read(workId).revision, 'build');
  const { commands } = recordedCommands(records, { shown: idle, recover: async () => ({ threadId: 'build-late', title: 'Build it' }) });
  await commands.startBuild(workId, undefined);
  assert.deepEqual(records.threads(workId).map(t => t.threadId), ['shape-1', 'build-late']);
  assert.deepEqual(records.pendingShapingThreadCleanups(), []);
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
    assert.deepEqual(records.read(work.workId).needsYouCauses, [{ type: 'no-thread' }]);
    assert.deepEqual(started, []);
    assert.equal((await commands.start(work.workId, undefined)).status, 409, 'Start waits while the notice stands');
    const record = records.read(work.workId);
    records.setNeedsYouCauses(work.workId, record.revision, []);
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

test('a finished T3 turn leaves the successfully started item in Shaping', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, board } = recordedCommands(records, { shown: (ids) => ids.map((id) => ({ id, title: 't', state: 'done', updated: '2026-10-31T00:00:00Z' })) });
  await commands.start(work.workId, undefined);
  await commands.reconcileStarts(board.snapshot().items);
  assert.equal(records.read(work.workId).status, 'Shaping');
  assert.equal(board.find(work.workId)?.status, 'Shaping');
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
  assert.equal((await commands.start(work.workId, undefined)).status, 200, 'a repeated request returns the running resumed thread');
  assert.equal(started.length, 1, 'a repeated request never starts another thread');
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
  assert.equal((await commands.abandon(queued(7).id)).status, 409);
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
  const item = queued(91, { status: 'Review', threads: [], needsYou: { reason: 'Deleted', causes: [], ticketOpen: false, deletedThread: true, offers: ['back-to-list'] } });
  const records = await openRecords();
  const { commands, board } = commandsOn([], undefined, records);
  board.update({ items: [item] });
  assert.equal((await commands.resolveNeedsYou(item.id, 'clear')).status, 409);
});

test('a deleted-thread move removes the causes its notice names', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Recover work', repository: WEB, kind: 'feature', status: 'In progress' });
  records.setNeedsYouCauses(work.workId, work.revision, [{ type: 'ticket-closed' }]);
  const { commands, board } = recordedCommands(records);
  board.update({ items: [{ ...board.find(work.workId)!, threads: [], needsYou: { reason: 'Deleted', causes: [{ type: 'ticket-closed' }], ticketOpen: false, deletedThread: true, offers: ['back-to-list', 'set-aside'] } }] });
  assert.equal((await commands.resolveNeedsYou(work.workId, 'back-to-list')).status, 200);
  assert.deepEqual([records.read(work.workId).status, records.read(work.workId).needsYouCauses], ['List', []]);
});

for (const briefChoice of ['keep', 'reshape'] as const) test(`deleted-thread move requires a brief choice and can ${briefChoice}`, async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Recover work', repository: WEB, kind: 'build', status: 'Review' });
  records.setBody(work.workId, work.revision, 'brief', 'Keep this brief.');
  records.recordGate(work.workId, records.read(work.workId).revision, { briefDigest: records.gate(work.workId).briefDigest!, approvedBy: 'test', evidence: 'Passed.' });
  const { commands, board } = recordedCommands(records);
  const item = board.find(work.workId)!;
  board.update({ items: [{ ...item, threads: [], needsYou: { reason: 'Deleted', causes: [], ticketOpen: false, deletedThread: true, offers: ['back-to-list'] } }] });
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
  board.update({ items: [{ ...item, threads: [], needsYou: { reason: 'Deleted', causes: [], ticketOpen: false, deletedThread: true, offers: ['start-again'] } }] });
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

test('changing the kind of an item with no record makes its record first, and a failed swap leaves it with the old kind', async () => {
  const records = await openRecords();
  const ticket = queued(9, { recorded: false, status: 'List', statuses: [], kind: 'bug', labels: ['bug'] });
  const board = createBoardState({ items: [ticket], repos: [{ repo: WEB, setup: { access: { 'tag-ticket': 'allowed' }, vocabulary: effectiveVocabulary({}).vocabulary } }], modelChoices: [] } as unknown as BoardData);
  const source = {
    readTicket: async () => ({ number: 9, title: 'Item 9', url: ticket.url!, text: '', kind: 'bug' }) } as unknown as ItemSource;
  let fail = true;
  const commands = createItemCommands({ factoryContext: null, board, items: source, records, reread: () => {}, archive: () => [], offerModelChoices: () => [],
    kindTracker: () => ({
      labels: { addToTicket: async () => {}, removeFromTicket: async () => { if (fail) throw new Error('az failed: TF26071'); } },
      kinds: { read: async () => ({ labels: ['bug'], type: 'Bug' }), setType: async () => {}, boardTypes: async () => null },
    }) });
  const failed = await commands.changeKind(ticket.id, 'feature');
  const { itemId } = failed.body as { itemId: string };
  assert.equal(failed.status, 502);
  assert.equal(records.read(itemId).kind, 'bug');
  assert.equal(records.read(itemId).ticket, `${WEB}#9`);
  fail = false;
  board.update({ items: recordItems(records, [], [WEB]) });
  const retried = await commands.changeKind(itemId, 'feature');
  assert.equal(retried.status, 200);
  assert.equal(records.read(itemId).kind, 'feature');
  assert.deepEqual(retried.labelChanges, [{ label: 'bug', action: 'remove' }]);
});

test('an item that can\'t change kind makes no record', async () => {
  const records = await openRecords();
  const concept = queued(9, { recorded: false, status: 'List', kind: 'concept' });
  const { commands, board } = commandsOn([], undefined, records);
  board.update({ items: [concept] });
  assert.equal((await commands.changeKind(concept.id, 'bug')).status, 422);
  assert.deepEqual(records.list({}), []);
});

/** A board showing record `workId` with this disagreement. */
const disagreeing = (records: WorkRecords, kindDisagreement: Item['kindDisagreement']) => {
  const { commands, board } = commandsOn([], undefined, records);
  const { workId } = records.importTicket({ title: 'T', repository: WEB, kind: 'feature', ticket: `${WEB}#9` }).record;
  board.update({ items: [queued(9, { id: workId, kind: 'feature', kindDisagreement })] });
  return { commands, workId };
};
const TICKET_MOVED: NonNullable<Item['kindDisagreement']> = { ticketKind: 'bug', changed: 'ticket', kept: false, swap: { add: [], remove: [], type: null } };

test('keeping both kinds records the answer for the two kinds and changes neither', async () => {
  const records = await openRecords();
  const { commands, workId } = disagreeing(records, TICKET_MOVED);
  assert.equal(commands.answerKind(workId, 'keep', 'bug').status, 200);
  assert.deepEqual(records.read(workId).kindAnswer, { answer: 'keep', itemKind: 'feature', ticketKind: 'bug' });
  assert.equal(records.read(workId).kind, 'feature');
});

test('updating the item takes the ticket\'s kind, with no tracker write, and agrees with it', async () => {
  const records = await openRecords();
  const { commands, workId } = disagreeing(records, TICKET_MOVED);
  assert.equal(commands.answerKind(workId, 'update-item', 'bug').status, 200);
  assert.deepEqual(records.read(workId), { ...records.read(workId), kind: 'bug', agreedTicketKind: 'bug', kindAnswer: null });
});

test('an answer for kinds the board no longer shows changes nothing', async () => {
  const records = await openRecords();
  const { commands, workId } = disagreeing(records, TICKET_MOVED);
  const before = records.read(workId);
  assert.equal(commands.answerKind(workId, 'keep', 'improvement').status, 409);
  assert.equal(commands.answerKind('gone', 'keep', 'bug').status, 404);
  assert.deepEqual(records.read(workId), before);
});

test('an update has no kind to take from a ticket with none, and other answers refuse', async () => {
  const records = await openRecords();
  const { commands, workId } = disagreeing(records, { ...TICKET_MOVED, ticketKind: null, changed: 'item' });
  const before = records.read(workId);
  assert.equal(commands.answerKind(workId, 'update-item', null).status, 422);
  assert.equal(commands.answerKind(workId, 'maybe', null).status, 422);
  assert.deepEqual(records.read(workId), before);
  assert.equal(commands.answerKind(workId, 'keep', null).status, 200);
  assert.deepEqual(records.read(workId).kindAnswer, { answer: 'keep', itemKind: 'feature', ticketKind: null });
});

/** The server's view of the item's start for `purpose`. */
const progressOf = (board: ReturnType<typeof createBoardState>, id: string, purpose: 'shape' | 'build') => board.snapshot().startProgress?.[id]?.[purpose];

test('Starting shows from the press, through the checks before the launch intent, until T3 answers', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  let duringChecks: unknown; let duringAsk: unknown; let unresolvedDuringChecks = -1;
  const held = { board: null as ReturnType<typeof createBoardState> | null };
  const { commands, board } = recordedCommands(records, {
    beforeLaunch: (b) => { held.board = b; duringChecks = progressOf(b, work.workId, 'shape'); unresolvedDuringChecks = records.launchIntents({ workId: work.workId, unresolved: true }).length; },
    during: () => { duringAsk = progressOf(held.board!, work.workId, 'shape'); },
  });
  const pushed: unknown[] = [];
  board.subscribe((data) => pushed.push(data.startProgress?.[work.workId]?.shape));
  const pressed = commands.start(work.workId, undefined);
  assert.deepEqual(progressOf(board, work.workId, 'shape'), { phase: 'starting' }, 'before any check finishes');
  assert.deepEqual(pushed[0], { phase: 'starting' }, 'every open page hears it at once');
  await pressed;
  assert.deepEqual([duringChecks, unresolvedDuringChecks, duringAsk], [{ phase: 'starting' }, 0, { phase: 'starting' }]);
  assert.equal(progressOf(board, work.workId, 'shape'), undefined);
});

test('T3 answering moves Queued work to Shaping and Ready work to In progress, and pushes in that step', async () => {
  const records = await openRecords();
  const concept = records.create({ title: 'Concept', repository: WEB, kind: 'concept', status: 'Queued' });
  const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  const { commands, board } = recordedCommands(records);
  const pushed: Status[] = [];
  board.subscribe((data) => { const status = data.items.find((i) => i.id === build.workId)?.status; if (status) pushed.push(status); });
  assert.equal((await commands.start(concept.workId, undefined)).status, 200);
  assert.equal(records.read(concept.workId).status, 'Shaping');
  assert.equal(board.find(concept.workId)?.status, 'Shaping');
  assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
  assert.equal(records.read(build.workId).status, 'In progress');
  assert.equal(pushed.at(-1), 'In progress');
});

test('a start restart recovery settles to a thread makes the same move, from the refresh too', async () => {
  const records = await openRecords();
  const concept = records.create({ title: 'Concept', repository: WEB, kind: 'concept', status: 'Queued' });
  records.recordLaunchIntent(concept.workId, concept.revision, 'shape');
  const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  records.recordLaunchIntent(build.workId, build.revision, 'build');
  const { commands, board } = recordedCommands(records, { recover: async (_project, messages) => ({ threadId: messages[0]!.includes(concept.workId) ? 'shaping' : 'building', title: 't' }) });
  assert.equal(progressOf(board, concept.workId, 'shape')?.phase, 'may-have-started', 'the server shows it from its first snapshot');
  await commands.reconcileStarts(board.snapshot().items);
  assert.deepEqual([records.read(concept.workId).status, records.read(build.workId).status], ['Shaping', 'In progress']);
  assert.equal(progressOf(board, concept.workId, 'shape'), undefined);
});

test('a refused start and a failed one move nothing and leave the error for every page until it is dismissed', async () => {
  const records = await openRecords();
  const failing = records.create({ title: 'Failing', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, board } = recordedCommands(records, { startAnswer: () => ({ thread: null, error: 'T3 said no' }) });
  assert.equal((await commands.start(failing.workId, undefined)).status, 502);
  assert.equal(records.read(failing.workId).status, 'Queued');
  assert.deepEqual(progressOf(board, failing.workId, 'shape'), { phase: 'failed', message: 'T3 said no' });
  assert.equal(commands.dismissStartError(failing.workId, 'shape').status, 200);
  assert.equal(progressOf(board, failing.workId, 'shape'), undefined);

  const refused = await commands.startBuild(failing.workId, undefined);
  assert.equal(refused.status, 409);
  assert.ok((refused.body as { board?: unknown }).board, 'a refusal shows the board it left');
  assert.match(progressOf(board, failing.workId, 'build')?.phase ?? '', /failed/);
});

test('a failure after the launch intent survives a restart, and a retry clears it', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  const first = recordedCommands(records, { startAnswer: () => ({ thread: null, error: 'T3 said no' }) });
  await first.commands.start(work.workId, undefined);
  const after = recordedCommands(records);
  assert.deepEqual(progressOf(after.board, work.workId, 'shape'), { phase: 'failed', message: 'T3 said no' });
  assert.equal((await after.commands.start(work.workId, undefined)).status, 200);
  assert.equal(progressOf(after.board, work.workId, 'shape'), undefined);
});

test('a Start after keeps its failure where it shows today', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, board } = recordedCommands(records, { startAnswer: () => ({ thread: null, error: 'T3 said no' }) });
  await commands.start(work.workId, undefined, true);
  assert.equal(progressOf(board, work.workId, 'shape'), undefined);
});

test('an unresolved start no longer running shows May have started, keeps today\'s recovery and starts nothing more', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, board, started } = recordedCommands(records, { startAnswer: () => ({ thread: null, error: 'T3 may have started it.', uncertain: true }) });
  await commands.start(work.workId, undefined);
  assert.equal(progressOf(board, work.workId, 'shape')?.phase, 'may-have-started');
  assert.equal(records.read(work.workId).status, 'Queued');
  assert.deepEqual(started, []);
});

test('a duplicate Start build after the move answers with the running thread', async () => {
  const records = await openRecords();
  const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  const { commands, started } = recordedCommands(records);
  await commands.startBuild(build.workId, undefined);
  const again = await commands.startBuild(build.workId, undefined);
  assert.equal(again.status, 200);
  assert.equal((again.body as StartResult).thread?.threadId, 'thread-1');
  assert.equal(started.length, 1);
});

test('a moved build whose thread stops before a phase offers a retry on a retry branch', async () => {
  const records = await openRecords();
  const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  const { commands, started, board, reread } = recordedCommands(records, { shown: (ids) => ids.map((id) => ({ id, title: 't', state: 'stopped' as const, purpose: 'build', updated: '2026-10-31T00:00:00Z' })) });
  await commands.startBuild(build.workId, undefined);
  const firstBranch = records.read(build.workId).buildBranch;
  reread();
  assert.equal(board.find(build.workId)?.status, 'In progress');
  assert.equal((await commands.startBuild(build.workId, undefined)).status, 200);
  assert.equal(started.length, 2);
  assert.equal(records.read(build.workId).status, 'In progress');
  assert.match(records.read(build.workId).buildBranch ?? '', new RegExp(`^${firstBranch}-retry-`));
});

test('a build that recorded a phase is not retried from In progress', async () => {
  const records = await openRecords();
  const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'Ready' });
  const { commands, started, reread } = recordedCommands(records, { shown: (ids) => ids.map((id) => ({ id, title: 't', state: 'stopped' as const, purpose: 'build', updated: '2026-10-31T00:00:00Z' })) });
  await commands.startBuild(build.workId, undefined);
  records.setBuildPhase(build.workId, records.read(build.workId).revision, 'plan');
  reread();
  assert.equal((await commands.startBuild(build.workId, undefined)).status, 409);
  assert.equal(started.length, 1);
});

test('a thrown start shows a fixed message on every page, not the raw error', async () => {
  const records = await openRecords();
  const work = records.create({ title: 'Work', repository: WEB, kind: 'feature', status: 'Queued' });
  const { commands, board } = recordedCommands(records, { beforeLaunch: () => { throw new Error('/Users/someone/private/path'); } });
  await assert.rejects(commands.start(work.workId, undefined), /private\/path/);
  assert.deepEqual(progressOf(board, work.workId, 'shape'), { phase: 'failed', message: 'The start failed. Check the board log.' });
});

test('a failure cleared by a dismissal, a move or Start after stays cleared across a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'cleared-failures-'));
  const clearedFailuresFile = join(dir, 'nested', 'cleared.json');
  try {
    const records = await openRecords();
    const dismissed = records.create({ title: 'Dismissed', repository: WEB, kind: 'feature', status: 'Queued' });
    const moved = records.create({ title: 'Moved', repository: WEB, kind: 'feature', status: 'Queued' });
    const armed = records.create({ title: 'Armed', repository: WEB, kind: 'feature', status: 'Queued' });
    const kept = records.create({ title: 'Kept', repository: WEB, kind: 'feature', status: 'Queued' });
    const { commands } = recordedCommands(records, { startAnswer: () => ({ thread: null, error: 'T3 said no' }), clearedFailuresFile });
    for (const { workId } of [dismissed, moved, kept]) await commands.start(workId, undefined);
    await commands.start(armed.workId, undefined, true);
    commands.dismissStartError(dismissed.workId, 'shape');
    assert.equal(commands.backToList(moved.workId).status, 200);
    assert.equal((await commands.queue(moved.workId)).status, 200);
    const after = recordedCommands(records, { clearedFailuresFile });
    assert.equal(progressOf(after.board, dismissed.workId, 'shape'), undefined);
    assert.equal(progressOf(after.board, moved.workId, 'shape'), undefined);
    assert.equal(progressOf(after.board, armed.workId, 'shape'), undefined);
    assert.equal(progressOf(after.board, kept.workId, 'shape')?.phase, 'failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a restart restores no failed retry of a build that recorded a phase', async () => {
  const records = await openRecords();
  const build = records.create({ title: 'Build', repository: WEB, kind: 'build', status: 'In progress' });
  const { intent } = records.recordLaunchIntent(build.workId, build.revision, 'build');
  records.resolveLaunchIntent(build.workId, build.revision + 1, intent.intentId, { failure: 'T3 said no' });
  assert.equal(progressOf(recordedCommands(records).board, build.workId, 'build')?.phase, 'failed');
  records.setBuildPhase(build.workId, records.read(build.workId).revision, 'plan');
  assert.equal(progressOf(recordedCommands(records).board, build.workId, 'build'), undefined);
});
