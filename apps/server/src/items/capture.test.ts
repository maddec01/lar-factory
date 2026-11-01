import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { BoardData, Item, PickedTicket, RepoConfig } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { createBoardState } from '../board/board-state.ts';
import { createCapture } from './capture.ts';
import type { ItemSource } from './item-source.ts';
import { recordItems } from './record-items.ts';

const WEB = 'example/source';
const REPOS: RepoConfig[] = [{ repo: WEB, role: 'app', items: 'issues', labels: [] }];
const emptyOptions = async () => ({ provider: 'github' as const, labels: [], types: [], assignees: [], milestones: [], iterations: [], problems: [] });
const REQUEST = '00000000-0000-4000-8000-000000000001';

const ticket = (number: number, extra: Partial<PickedTicket> = {}): PickedTicket =>
  ({ number, title: `Ticket ${number}`, url: `https://github.com/${WEB}/issues/${number}`, text: `Text of ${number}`, kind: 'bug', ...extra });

const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  for (const { records, dir } of opened.splice(0)) {
    records.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Capture on a board showing `records`, reading `tickets` as the repository's open tickets; `calls` lists each source call. */
async function captureOn(tickets: PickedTicket[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'capture-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  const board = createBoardState({ items: [], repos: REPOS, modelChoices: [] } as unknown as BoardData);
  const reread = () => board.update({ items: recordItems(records, [], [WEB]) });
  const calls: string[] = [];
  const source = {
    searchTickets: async (repo: string, query: string) => {
      calls.push(`search ${repo} ${query}`);
      return tickets.filter((t) => t.title.includes(query)).map(({ number, title, url }) => ({ number, title, url }));
    },
    readTicket: async (repo: string, number: number) => {
      calls.push(`read ${repo}#${number}`);
      return tickets.find((t) => t.number === number) ?? null;
    },
  } as unknown as ItemSource;
  const capture = createCapture({ board, items: source, records, reread, repos: () => REPOS });
  return { board, records, capture, calls };
}

const itemOf = (body: object) => (body as { item: Item }).item;

test('Add item records ticketless work with its title and description, and writes nothing to any ticket', async () => {
  const { records, capture, calls } = await captureOn();
  const draft = { repo: WEB, kind: 'feature', title: 'Export the report', description: '## Why\nAudits.' };
  const reply = await capture.capture({ requestId: REQUEST, draft });
  assert.equal(reply.status, 200);
  const item = itemOf(reply.body);
  assert.deepEqual([item.title, item.kind, item.status, item.number, item.url], ['Export the report', 'feature', 'List', 0, null]);
  const record = records.read(item.id);
  assert.equal(record.ticket, null);
  assert.equal(records.initialContext(item.id), '## Why\nAudits.');
  assert.deepEqual(calls, []);
});

test('a resent submission finds the work it recorded, and one reusing its request ID for other work is refused', async () => {
  const { records, capture } = await captureOn();
  const draft = { repo: WEB, kind: 'bug', title: 'Stall', description: '' };
  const first = itemOf((await capture.capture({ requestId: REQUEST, draft })).body);
  const again = await capture.capture({ requestId: REQUEST, draft });
  assert.equal(itemOf(again.body).id, first.id);
  assert.equal((await capture.capture({ requestId: REQUEST, draft: { ...draft, title: 'Other' } })).status, 409);
  assert.equal(records.list({}).length, 1);
});

test("a ticket search lists the source's matches, each naming the work ID of the record already holding it", async () => {
  const { capture, records } = await captureOn([ticket(7, { title: 'Seek stalls' }), ticket(8, { title: 'Seek is slow' })]);
  const held = records.importTicket({ title: 'Seek stalls', repository: WEB, kind: 'bug', ticket: `${WEB}#7` }).record;
  const reply = await capture.searchTickets({ repo: WEB, query: 'Seek' });
  assert.equal(reply.status, 200);
  assert.deepEqual((reply.body as { tickets: unknown[] }).tickets, [
    { number: 7, title: 'Seek stalls', url: `https://github.com/${WEB}/issues/7`, workId: held.workId },
    { number: 8, title: 'Seek is slow', url: `https://github.com/${WEB}/issues/8` },
  ]);
  assert.equal((await capture.searchTickets({ repo: 'example/other', query: 'Seek' })).status, 422);
});

test("picking a ticket records it with the ticket's text as initial context, and picking it again opens that record", async () => {
  const { capture, records, calls } = await captureOn([ticket(7)]);
  const first = await capture.pick({ repo: WEB, number: 7 });
  assert.equal(first.status, 200);
  const item = itemOf(first.body);
  assert.deepEqual([item.title, item.kind, item.status, (first.body as { created: boolean }).created], ['Ticket 7', 'bug', 'List', true]);
  assert.equal(records.read(item.id).ticket, `${WEB}#7`);
  assert.equal(records.initialContext(item.id), 'Text of 7');
  const again = await capture.pick({ repo: WEB, number: 7 });
  assert.deepEqual([itemOf(again.body).id, (again.body as { created: boolean }).created], [item.id, false]);
  assert.equal(records.list({}).length, 1);
  assert.deepEqual(calls, [`read ${WEB}#7`], 'a recorded ticket is opened without reading it again');
});

test('picking a ticket whose record is set aside restores that record, and a closed or missing ticket records nothing', async () => {
  const { capture, records } = await captureOn([ticket(7)]);
  const item = itemOf((await capture.pick({ repo: WEB, number: 7 })).body);
  records.setAside(item.id, records.read(item.id).revision);
  const restored = await capture.pick({ repo: WEB, number: 7 });
  assert.equal(itemOf(restored.body).id, item.id);
  assert.equal(records.read(item.id).setAside, false);
  const missing = await capture.pick({ repo: WEB, number: 9 });
  assert.equal(missing.status, 404);
  assert.equal((missing.body as { error: string }).error, `${WEB} has no open ticket #9.`);
  assert.equal(records.list({}).length, 1);
});

test('attaching a ticket to captured work keeps its work ID, and a ticket another record holds is refused', async () => {
  const { capture, records } = await captureOn([ticket(7), ticket(8)]);
  const captured = itemOf((await capture.capture({ requestId: REQUEST, draft: { repo: WEB, kind: 'bug', title: 'Stall', description: 'Mine.' } })).body);
  const picked = itemOf((await capture.pick({ repo: WEB, number: 8 })).body);
  const taken = await capture.attachTicket(captured.id, 8);
  assert.equal(taken.status, 409);
  assert.match((taken.body as { error: string }).error, new RegExp(`${picked.id} already holds`));
  const attached = await capture.attachTicket(captured.id, 7);
  assert.equal(attached.status, 200);
  assert.equal(records.read(captured.id).ticket, `${WEB}#7`);
  assert.equal(records.initialContext(captured.id), 'Mine.', 'the captured context stays');
  const again = await capture.attachTicket(captured.id, 8);
  assert.equal(again.status, 409, 'a record keeps the ticket it has');
});

test('ticket capture imports original text once and replays after the handler restarts', async () => {
  const { records, board } = await captureOn();
  let creates = 0;
  const provider = {
    create: async (repository: string, title: string, body: string) => {
      creates++;
      return { repository, number: 81, title, body, version: '1' };
    },
  } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const repo = { ...REPOS[0]!, setup: { repo: WEB, access: { 'publish-ticket': 'allowed' }, vocabulary: {} } } as RepoConfig;
  const restart = () => createCapture({ board, items: {} as ItemSource, records,
    reread: () => board.update({ items: recordItems(records, [], [WEB]) }), repos: () => [repo], provider, discoverOptions: emptyOptions });
  const draft = { repo: WEB, kind: 'feature', title: 'Export', description: '## Why\nAudits.' };
  const first = await restart().capture({ requestId: REQUEST, draft });
  assert.equal(first.status, 200);
  const item = itemOf(first.body);
  assert.equal(records.read(item.id).ticket, `${WEB}#81`);
  assert.equal(records.initialContext(item.id), draft.description);
  assert.equal(itemOf((await restart().capture({ requestId: REQUEST, draft })).body).id, item.id);
  assert.equal(creates, 1);
  assert.equal(records.list({}).length, 1);
});

test('uncertain creates reconcile by marker and never create again across a database restart', async () => {
  const { records, board } = await captureOn();
  let created: import('@lar-factory/work-records/tracker-sync').StructureTicket | undefined;
  let writes = 0;
  const provider = {
    create: async (repository: string, title: string, body: string) => {
      writes++;
      created = { repository, number: 91, title, body, version: '1' };
      throw Error('Response lost');
    },
    find: async () => created ? [created] : [],
  } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const repo = { ...REPOS[0]!, setup: { access: { 'publish-ticket': 'allowed' }, vocabulary: {} } } as RepoConfig;
  const handler = (store: WorkRecords) => createCapture({ board, items: {} as ItemSource, records: store,
    reread: () => board.update({ items: recordItems(store, [], [WEB]) }), repos: () => [repo], provider, discoverOptions: emptyOptions });
  const draft = { repo: WEB, kind: 'bug', title: 'Stall', description: 'Original.', createIssue: true };
  assert.equal((await handler(records).capture({ requestId: REQUEST, draft })).status, 409);
  assert.equal(records.list({}).length, 0);
  const handle = opened.find(handle => handle.records === records)!;
  records.close();
  handle.records = await openWorkRecords(join(handle.dir, 'work-records.db'));
  const result = await handler(handle.records).capture({ requestId: REQUEST, draft });
  assert.equal(result.status, 200);
  assert.equal(handle.records.read(itemOf(result.body).id).ticket, `${WEB}#91`);
  assert.equal(writes, 1);
});

test('Azure without a surviving marker stays blocked, and forbidden mappings never reach a create', async () => {
  const { records, board } = await captureOn();
  const repo = 'example/Project/source';
  const drafts = { repo, kind: 'bug', title: 'Failure', description: 'Steps', createIssue: true };
  let writes = 0;
  const provider = {
    creationTarget: async () => ({ type: 'Backlog Item', areaPath: 'Project\\Team' }),
    create: async (_repo: string, _title: string, _body: string, type: string, area: string, options: unknown) => {
      writes++;
      assert.equal(type, 'Backlog Item');
      assert.equal(area, 'Project\\Team');
      assert.deepEqual(options, { type: 'Backlog Item', labels: [] });
      throw Error('Timed out');
    },
    find: async () => [{ number: 9, body: '<p>Steps</p>' }],
  } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const config = { repo, team: 'Team', labels: [], setup: { access: { 'publish-ticket': 'allowed', 'tag-ticket': 'refused', 'type-ticket': 'refused' }, vocabulary: { bug: { labels: ['blocked'], type: 'Bug' } } } } as unknown as RepoConfig;
  const restart = () => createCapture({ board, items: {} as ItemSource, records, reread: () => {}, repos: () => [config], provider, discoverOptions: emptyOptions });
  assert.equal((await restart().capture({ requestId: REQUEST, draft: drafts })).status, 409);
  const result = await restart().capture({ requestId: REQUEST, draft: drafts });
  assert.match((result.body as { error: string }).error, /Azure may have stripped/);
  assert.equal(writes, 1);
  assert.equal(records.list({}).length, 0);
});

test('options read failures create with title/body only', async () => {
  const { records, board } = await captureOn();
  const provider = {
    create: async (_repo: string, _title: string, _body: string, type: string, _area: string, options: unknown) => {
      assert.equal(type, undefined);
      assert.deepEqual(options, { labels: [], type: undefined });
      return { number: 3 };
    },
  } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const repo = { ...REPOS[0]!, setup: { access: { 'publish-ticket': 'allowed', 'tag-ticket': 'allowed', 'type-ticket': 'allowed' }, vocabulary: { bug: { labels: ['backend'], type: 'Bug' } } } } as unknown as RepoConfig;
  const capture = createCapture({ board, items: {} as ItemSource, records, reread: () => board.update({ items: recordItems(records, [], [WEB]) }),
    repos: () => [repo], provider, discoverOptions: async () => { throw Error('HTTP 403'); } });
  const result = await capture.capture({ requestId: REQUEST, draft: { repo: WEB, kind: 'bug', title: 'Failure', description: '', createIssue: true } });
  assert.equal(result.status, 200);
});

test('Access refusals and unreadable Azure targets leave List empty', async () => {
  const { records, board } = await captureOn();
  let writes = 0;
  const provider = {
    creationTarget: async () => { throw Error('The team backlog type could not be read.'); },
    create: async () => { writes++; throw Error('Unexpected create'); },
  } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const configs = [
    { repo: WEB, setup: { access: { 'publish-ticket': 'refused' }, vocabulary: {} } },
    { repo: 'example/Project/source', team: 'Team', setup: { access: { 'publish-ticket': 'allowed' }, vocabulary: {} } },
    { repo: 'example/Project/readonly', team: 'Team', setup: { azureReadOnly: true, access: { 'publish-ticket': 'allowed' }, vocabulary: {} } },
  ] as unknown as RepoConfig[];
  const capture = createCapture({ board, items: {} as ItemSource, records, reread: () => {}, repos: () => configs, provider, discoverOptions: emptyOptions });
  for (const [index, repo] of configs.entries()) {
    const result = await capture.capture({ requestId: REQUEST.slice(0, -1) + (index + 1), draft: { repo: repo.repo, kind: 'bug', title: 'Failure', description: '', createIssue: true } });
    assert.equal(result.status, index === 1 ? 502 : 403);
  }
  assert.equal(writes, 0);
  assert.equal(records.list({}).length, 0);
});

test('a record-write failure names the created issue and replay recovers it without another create', async () => {
  const { records, board } = await captureOn();
  let writes = 0;
  let fail = true;
  const complete = records.completeCapture;
  records.completeCapture = (...args) => { if (fail) throw Error('Disk full'); return complete(...args); };
  const provider = { create: async () => { writes++; return { number: 7 }; } } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const repo = { ...REPOS[0]!, setup: { access: { 'publish-ticket': 'allowed' }, vocabulary: {} } } as RepoConfig;
  const capture = createCapture({ board, items: {} as ItemSource, records, reread: () => board.update({ items: recordItems(records, [], [WEB]) }), repos: () => [repo], provider, discoverOptions: emptyOptions });
  const request = { requestId: REQUEST, draft: { repo: WEB, kind: 'feature', title: 'Export', description: '  Original.\n\n', createIssue: true } };
  const result = await capture.capture(request);
  assert.match((result.body as { error: string }).error, /Created .*#7.*Find a ticket/);
  assert.equal(records.list({}).length, 0);
  fail = false;
  const recovered = await capture.capture(request);
  assert.equal(recovered.status, 200);
  assert.equal(records.initialContext(itemOf(recovered.body).id), request.draft.description);
  assert.equal(writes, 1);
});


test('converting local work preserves its ID and context even with Add item creation off', async () => {
  const { records, board } = await captureOn();
  const local = records.create({ repository: WEB, kind: 'bug', title: 'Local failure', context: 'Steps.' });
  const writes: unknown[][] = [];
  const provider = { create: async (...args: unknown[]) => { writes.push(args); return { number: 11 }; } } as unknown as import('@lar-factory/work-records/tracker-sync').StructureProvider;
  const repo = { ...REPOS[0]!, setup: { repo: WEB, createIssuesFromAddItem: false, access: { 'publish-ticket': 'allowed' }, vocabulary: {} } } as RepoConfig;
  const reread = () => board.update({ items: recordItems(records, [], [WEB]) });
  reread();
  const capture = createCapture({ board, items: {} as ItemSource, records, reread, repos: () => [repo], provider, discoverOptions: emptyOptions });
  const result = await capture.createTicket(local.workId, { requestId: REQUEST, revision: local.revision });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(itemOf(result.body).id, local.workId);
  assert.equal(records.read(local.workId).ticket, `${WEB}#11`);
  assert.equal(records.initialContext(local.workId), 'Steps.');
  assert.equal(records.list({}).length, 1);
  assert.deepEqual(writes[0]?.slice(0, 2), [WEB, 'Local failure']);
  assert.match(String(writes[0]?.[2]), /^Steps\./);
});

test('an Add item reservation from before local conversion support still recovers its known ticket', async () => {
  const { records, board } = await captureOn();
  const draft = { createIssue: true, repo: WEB, kind: 'bug', title: 'Recover export', description: 'Original.' };
  records.claimCapture(REQUEST, JSON.stringify(draft));
  records.saveCaptureTicket(REQUEST, `${WEB}#22`);
  const capture = createCapture({ board, items: {} as ItemSource, records,
    reread: () => board.update({ items: recordItems(records, [], [WEB]) }), repos: () => REPOS, provider: {} as import('@lar-factory/work-records/tracker-sync').StructureProvider });
  const result = await capture.capture({ requestId: REQUEST, draft });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(records.read(itemOf(result.body).id).ticket, `${WEB}#22`);
});
