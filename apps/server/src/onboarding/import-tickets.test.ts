import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import type { TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { ImportableTicket, Item, PickedTicket, Status, TicketsImported } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { azureBoard } from '../azure/azure-board.ts';
import { fakeAz } from '../azure/fake-az.ts';
import type { ItemSource } from '../items/item-source.ts';
import { readT3Db, threadRows } from '../t3/t3-db.ts';
import { statsDb, type FixtureThread } from '../../test/stats-db.ts';
import { importTickets, importableTickets, type ImportReads } from './import-tickets.ts';

const REPO = 'maddec01/lar-web';
const ISSUES = { kind: 'issues' } as const;

const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  for (const { records, dir } of opened.splice(0)) {
    records.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

async function workRecords(): Promise<WorkRecords> {
  const dir = mkdtempSync(join(tmpdir(), 'import-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  return records;
}

/** An issue as the repository's item source reads it. */
const issue = (number: number, statuses: Status[], state: 'open' | 'closed' = 'open') => ({
  id: `I_${number}`, number, title: `Issue ${number}`, url: `https://github.com/${REPO}/issues/${number}`, repo: REPO,
  statuses, status: statuses[0] ?? 'List', state, kind: 'feature',
}) as unknown as Item;

/** A GitHub source listing `items`, whose picks read each open one's text; `calls` lists each call, `fail` makes one throw. */
function issuesSource(items: Item[], fail?: (call: string) => boolean) {
  const calls: string[] = [];
  const call = (name: string) => {
    calls.push(name);
    if (fail?.(name)) throw new Error(`${name} failed`);
  };
  const source = {
    read: async () => { call('read'); return { title: REPO, items }; },
    readTicket: async (_repo: string, number: number): Promise<PickedTicket | null> => {
      call(`readTicket ${number}`);
      const found = items.find((i) => i.number === number && i.state === 'open');
      return found ? { number, title: found.title, url: found.url!, text: `Text of ${number}`, kind: 'bug' } : null;
    },
    setStatus: async () => { call('setStatus'); return null; },
    addLabel: async () => { call('addLabel'); return null; },
    abandon: async () => { call('abandon'); return null; },
  } as unknown as ItemSource;
  return { source, calls };
}

const readsOf = (t: TestContext, source: ItemSource, threads: FixtureThread[] = []): ImportReads => {
  const db = statsDb(t, threads);
  return { source: () => source, threads: async () => readT3Db(db, threadRows) };
};

const listed = (answer: Awaited<ReturnType<typeof importableTickets>>): ImportableTicket[] =>
  'tickets' in answer ? answer.tickets : assert.fail(answer.error);
const done = (answer: Awaited<ReturnType<typeof importTickets>>): TicketsImported =>
  'imported' in answer ? answer : assert.fail(answer.error);

test('onboarding lists the open status-labelled tickets only, and imports each with its Status, ticket, text and named threads', async (t) => {
  const records = await workRecords();
  const { source, calls } = issuesSource([issue(1, ['Shaping']), issue(2, []), issue(3, ['Queued'], 'closed'), issue(4, ['Queued'])]);
  const reads = readsOf(t, source, [
    { id: 'shape-1', messages: [`$lar-shape ${REPO}#1`], turns: [{ id: 's1', startedAt: '2026-10-20T09:00:00Z' }] },
    { id: 'build-1', messages: [`Build ${REPO}#1`], turns: [{ id: 'b1', startedAt: '2026-10-20T10:00:00Z' }] },
    { id: 'other', messages: [`$lar-shape ${REPO}#2`] },
  ]);
  assert.deepEqual(listed(await importableTickets({ repo: REPO, itemSource: ISSUES }, records, reads)).map((ticket) => [ticket.number, ticket.statuses]),
    [[1, ['Shaping']], [4, ['Queued']]]);

  const answer = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }, { number: 4 }] }, records, reads));
  assert.deepEqual(answer.refused, []);
  assert.deepEqual(answer.imported.map(({ number, created, threads }) => [number, created, threads]), [[1, true, 2], [4, true, 0]]);
  const record = records.read(answer.imported[0]!.workId);
  assert.deepEqual([record.status, record.ticket, record.title, record.kind], ['Shaping', `${REPO}#1`, 'Issue 1', 'bug']);
  assert.equal(records.initialContext(record.workId), 'Text of 1');
  assert.deepEqual(records.threads(record.workId).map((thread) => [thread.threadId, thread.purpose]), [['shape-1', 'shape'], ['build-1', 'build']]);
  assert.equal(records.read(answer.imported[1]!.workId).status, 'Queued');
  assert.deepEqual(calls.filter((call) => ['setStatus', 'addLabel', 'abandon'].includes(call)), [], 'no write to any ticket');
});

test('a repeated onboarding lists recorded tickets with their record and imports none twice', async (t) => {
  const records = await workRecords();
  const { source } = issuesSource([issue(1, ['Shaping'])]);
  const reads = readsOf(t, source, [{ id: 'shape-1', messages: [`$lar-shape ${REPO}#1`] }]);
  const first = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }] }, records, reads));
  const { workId } = first.imported[0]!;
  records.update(workId, records.read(workId).revision, { status: 'Queued' });

  assert.equal(listed(await importableTickets({ repo: REPO, itemSource: ISSUES }, records, reads))[0]!.workId, workId);
  const again = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }] }, records, reads));
  assert.deepEqual(again.imported, [{ number: 1, workId, created: false, threads: 0 }]);
  assert.equal(records.list({ repository: REPO }).length, 1);
  assert.equal(records.read(workId).status, 'Queued', 'the record keeps the Status the user gave it');
  assert.equal(records.threads(workId).length, 1);
});

test('an import interrupted before its threads were recorded records them when onboarding resumes', async (t) => {
  const records = await workRecords();
  let failing = true;
  const { source } = issuesSource([issue(1, ['Shaping']), issue(2, ['Queued'])], (call) => failing && call === 'readTicket 2');
  const reads = readsOf(t, source, [{ id: 'shape-1', messages: [`$lar-shape ${REPO}#1`] }, { id: 'shape-2', messages: [`$lar-shape ${REPO}#2`] }]);
  const threads = reads.threads;
  // The board stops after recording #1's record, before its threads.
  let stopped = false;
  const interrupted = { ...reads, threads: async () => { if (!stopped) { stopped = true; throw new Error('T3 Code closed'); } return threads(); } };
  const before = await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }, { number: 2 }] }, records, interrupted);
  assert.match('error' in before ? before.error : '', /T3 Code closed/);
  assert.equal(records.list({ repository: REPO }).length, 0, 'nothing is recorded before the threads can be read');

  const partly = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }, { number: 2 }] }, records, interrupted));
  assert.deepEqual(partly.refused.map((r) => r.number), [2]);
  failing = false;
  const resumed = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }, { number: 2 }] }, records, interrupted));
  assert.deepEqual(resumed.imported.map(({ number, created }) => [number, created]), [[1, false], [2, true]]);
  assert.equal(records.list({ repository: REPO }).length, 2);
  for (const { workId } of resumed.imported) assert.equal(records.threads(workId).length, 1);
});

test('a resumed import records the threads an earlier run left unrecorded on an existing record', async (t) => {
  const records = await workRecords();
  const { source } = issuesSource([issue(1, ['Shaping'])]);
  const reads = readsOf(t, source, [{ id: 'shape-1', messages: [`$lar-shape ${REPO}#1`] }, { id: 'build-1', messages: [`Build ${REPO}#1`] }]);
  // An earlier run made the record and recorded one thread before the board stopped.
  const { record } = records.importTicket({ title: 'Issue 1', repository: REPO, kind: 'bug', status: 'Shaping', ticket: `${REPO}#1` });
  records.addThread(record.workId, record.revision, 'shape-1', 'shape');
  const resumed = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }] }, records, reads));
  assert.deepEqual(resumed.imported, [{ number: 1, workId: record.workId, created: false, threads: 1 }]);
  assert.deepEqual(records.threads(record.workId).map((thread) => thread.threadId), ['shape-1', 'build-1']);
});

test('a ticket carrying two status labels imports only once the user chooses one of them', async (t) => {
  const records = await workRecords();
  const { source } = issuesSource([issue(1, ['Shaping', 'Queued'])]);
  const reads = readsOf(t, source);
  assert.deepEqual(listed(await importableTickets({ repo: REPO, itemSource: ISSUES }, records, reads))[0]!.statuses, ['Shaping', 'Queued']);

  const unresolved = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1 }, { number: 1, status: 'Review' }] }, records, reads));
  assert.equal(unresolved.imported.length, 0);
  assert.deepEqual(unresolved.refused.map((r) => r.reason), [
    `${REPO}#1 carries status-shaping and status-queued. Choose its Status.`,
    `${REPO}#1 carries status-shaping and status-queued. Choose its Status.`,
  ]);
  assert.equal(records.list({ repository: REPO }).length, 0);

  const resolved = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 1, status: 'Queued' }] }, records, reads));
  assert.equal(records.read(resolved.imported[0]!.workId).status, 'Queued');
});

test('a ticket that is no longer open or labelled is refused, and the others still import', async (t) => {
  const records = await workRecords();
  const { source } = issuesSource([issue(1, ['Shaping']), issue(2, [])]);
  const answer = done(await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 2 }, { number: 1 }, { number: 9 }] }, records, readsOf(t, source)));
  assert.deepEqual(answer.imported.map((i) => i.number), [1]);
  assert.deepEqual(answer.refused, [
    { number: 2, reason: `${REPO}#2 isn't an open ticket with a status label or tag.` },
    { number: 9, reason: `${REPO}#9 isn't an open ticket with a status label or tag.` },
  ]);
});

const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const TEAM = { kind: 'azure-board', team: 'Fabrikam Team' } as const;

test("an Azure work item's repo- tag places it, and an untagged one imports only once the user says it is this repository's", async (t) => {
  const records = await workRecords();
  const az = fakeAz({ items: [
    { id: 1, type: 'User Story', state: 'Active', tags: 'status-in-progress; repo-lar-api', description: 'Tagged here' },
    { id: 2, type: 'User Story', state: 'New', tags: 'status-shaping', description: 'Untagged' },
    { id: 3, type: 'User Story', state: 'New', tags: 'status-shaping; repo-lar-web' },
    { id: 4, type: 'User Story', state: 'Closed', tags: 'status-queued; repo-lar-api' },
    { id: 5, type: 'User Story', state: 'Active', tags: 'repo-lar-api' },
  ] });
  const source = azureBoard([AZURE], TEAM.team, az.run);
  const reads = readsOf(t, source);
  assert.deepEqual(listed(await importableTickets({ repo: AZURE, itemSource: TEAM }, records, reads)).map((ticket) => [ticket.number, ticket.statuses, ticket.untagged]),
    [[1, ['In progress'], false], [2, ['Shaping'], true]], 'Azure State places nothing, and another repository\'s item is left out');

  const unconfirmed = done(await importTickets({ repo: AZURE, itemSource: TEAM, tickets: [{ number: 1 }, { number: 2 }] }, records, reads));
  assert.deepEqual(unconfirmed.imported.map((i) => i.number), [1]);
  assert.deepEqual(unconfirmed.refused, [{ number: 2, reason: `${AZURE}#2 has no repo- tag. Confirm it is this repository's work.` }]);
  assert.equal(records.initialContext(unconfirmed.imported[0]!.workId), 'Tagged here');

  const confirmed = done(await importTickets({ repo: AZURE, itemSource: TEAM, tickets: [{ number: 2, placeHere: true }] }, records, reads));
  assert.equal(records.read(confirmed.imported[0]!.workId).status, 'Shaping');
  assert.deepEqual(az.calls.filter((args) => args.includes('patch') || args.includes('PATCH')), [], 'no write to any work item');
});

test('an import needs the repository, an item source of its provider and the tickets', async (t) => {
  const records = await workRecords();
  const reads = readsOf(t, issuesSource([]).source);
  for (const input of [{ itemSource: ISSUES }, { repo: REPO, itemSource: TEAM }, { repo: AZURE, itemSource: ISSUES }, { repo: REPO }]) {
    const answer = await importableTickets(input, records, reads);
    assert.equal('status' in answer && answer.status, 400);
  }
  const answer = await importTickets({ repo: REPO, itemSource: ISSUES, tickets: [{ number: 'one' }] }, records, reads);
  assert.equal('status' in answer && answer.status, 400);
  const sample = await importableTickets({ repo: REPO, itemSource: ISSUES }, null, reads);
  assert.equal('status' in sample && sample.status, 409);
});

test('a source that cannot be read leaves nothing imported and says why', async (t) => {
  const records = await workRecords();
  const reads = readsOf(t, issuesSource([issue(1, ['Shaping'])], (call) => call === 'read').source);
  const answer = await importableTickets({ repo: REPO, itemSource: ISSUES }, records, reads);
  assert.deepEqual(answer, { status: 502, error: `Can't read ${REPO}'s tickets. read failed` });
});
