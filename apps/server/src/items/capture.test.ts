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

const WEB = 'maddec01/lar-web';
const REPOS: RepoConfig[] = [{ repo: WEB, role: 'app', items: 'issues', show: 'all', labels: [] }];
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
  assert.equal((await capture.searchTickets({ repo: 'maddec01/other', query: 'Seek' })).status, 422);
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
