import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { normalizeItems } from '@lar-factory/shared';
import { boardIssue } from '@lar-factory/shared/test/raw-items';
import { DEFAULT_RETENTION, openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { archivedItems, recordItems } from './record-items.ts';

const REPO = 'maddec01/lar-factory';
const opened: { records: WorkRecords; dir: string }[] = [];
afterEach(() => {
  for (const { records, dir } of opened.splice(0)) {
    records.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
async function open(): Promise<WorkRecords> {
  const dir = mkdtempSync(join(tmpdir(), 'record-items-'));
  const records = await openWorkRecords(join(dir, 'work-records.db'));
  opened.push({ records, dir });
  return records;
}
const tickets = (...issues: Parameters<typeof boardIssue>[]) => normalizeItems(issues.map((args) => boardIssue(...args)));

test('only recorded work in an onboarded repository is a board item, named by its work ID', async () => {
  const records = await open();
  const recorded = records.importTicket({ title: 'Recorded', repository: REPO, kind: 'feature', status: 'Queued', ticket: `${REPO}#12` }).record;
  records.create({ title: 'Elsewhere', repository: 'maddec01/other', kind: 'bug' });
  const items = recordItems(records, tickets([12, 'List'], [13, 'Shaping']), [REPO]);
  assert.deepEqual(items.map((i) => [i.id, i.number, i.status, i.kind, i.revision]), [[recorded.workId, 12, 'Queued', 'feature', recorded.revision]]);
  assert.equal(items[0]!.url, `https://github.com/${REPO}/issues/12`);
});

test("a ticket edit never changes the record's Status, kind or title", async () => {
  const records = await open();
  records.importTicket({ title: 'Kept title', repository: REPO, kind: 'feature', status: 'Ready', ticket: `${REPO}#12` });
  const [item] = recordItems(records, tickets([12, 'Review', REPO, ['bug']]), [REPO]);
  assert.deepEqual([item!.status, item!.statuses, item!.kind, item!.title], ['Ready', ['Ready'], 'feature', 'Kept title']);
  assert.ok(item!.labels.includes('bug'), 'the ticket supplies its labels as context');
});

test('a ticketless record and a record whose ticket the read did not list show from the record alone', async () => {
  const records = await open();
  const local = records.create({ title: 'Local', repository: REPO, kind: 'improvement', status: 'Shaping' });
  records.importTicket({ title: 'Unread', repository: REPO, kind: 'bug', ticket: `${REPO}#40` });
  const items = recordItems(records, [], [REPO]);
  assert.deepEqual(items.map((i) => [i.title, i.number, i.url, i.status, i.state]), [['Local', 0, null, 'Shaping', 'open'], ['Unread', 40, null, 'List', 'open']]);
  assert.equal(items[0]!.id, local.workId);
});

test('set-aside work and slices are no board items; a Done record is closed as done', async () => {
  const records = await open();
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Done' });
  const aside = records.create({ title: 'Aside', repository: REPO, kind: 'bug' });
  records.setAside(aside.workId, aside.revision);
  const slice = records.create({ title: 'Slice', repository: REPO, kind: 'slice' });
  records.setParent(slice.workId, slice.revision, build.workId);
  const items = recordItems(records, [], [REPO]);
  assert.deepEqual(items.map((i) => [i.title, i.state, i.closedAs]), [['Build', 'closed', 'done']]);
});

test('finished work retention hides leaves the board for Archive, and set-aside work is in Archive until Restore brings it back', async () => {
  const records = await open();
  const finished = records.create({ title: 'Finished', repository: REPO, kind: 'build', status: 'Done' });
  records.recordFinished(finished.workId, finished.revision);
  const aside = records.importTicket({ title: 'Aside', repository: REPO, kind: 'bug', ticket: `${REPO}#12` }).record;
  records.setAside(aside.workId, aside.revision);
  const read = tickets([12, 'List']);
  const week = new Set(records.hidden(DEFAULT_RETENTION).map((r) => r.workId));
  assert.deepEqual(recordItems(records, read, [REPO], [], week).map((i) => i.title), ['Finished'], 'finished work stays for seven days');
  const later = new Set(records.hidden(DEFAULT_RETENTION, new Date(Date.now() + 8 * 86_400_000)).map((r) => r.workId));
  assert.deepEqual(recordItems(records, read, [REPO], [], later), []);
  assert.deepEqual(archivedItems(records, read, [REPO], later).map((i) => [i.title, i.archived]), [
    ['Finished', { setAside: false, hidden: true, ticketOpen: false }],
    ['Aside', { setAside: true, hidden: true, ticketOpen: true }],
  ]);
  records.restore(aside.workId, records.read(aside.workId).revision);
  assert.deepEqual(recordItems(records, read, [REPO], [], new Set(records.hidden(DEFAULT_RETENTION).map((r) => r.workId))).map((i) => i.title), ['Finished', 'Aside']);
});

test("a record's structure, blockers and slices come from records", async () => {
  const records = await open();
  const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
  let build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'In progress' });
  build = records.setParent(build.workId, build.revision, concept.workId);
  const blocker = records.importTicket({ title: 'Blocker', repository: REPO, kind: 'decision', ticket: `${REPO}#5` }).record;
  build = records.addBlocker(build.workId, build.revision, blocker.workId);
  const slice = records.create({ title: 'First slice', repository: REPO, kind: 'slice', status: 'In progress' });
  records.setParent(slice.workId, slice.revision, build.workId);
  records.setBody(concept.workId, records.read(concept.workId).revision, 'map', '## Destination\n\nWhere it goes.\n\n## Fog\n\n- What is left\n');
  const items = recordItems(records, [], [REPO]);
  const shown = (title: string) => items.find((i) => i.title === title)!;
  assert.equal(shown('Build').parentId, concept.workId);
  assert.deepEqual(shown('Build').parent && [shown('Build').parent!.title, shown('Build').parent!.number], ['Concept', 0]);
  assert.deepEqual(shown('Build').blockers, [{ number: 5, repo: REPO, state: 'open', workId: blocker.workId, title: 'Blocker' }]);
  assert.deepEqual(shown('Build').slices.map((s) => [s.title, s.progress]), [['First slice', 'active']]);
  assert.deepEqual(shown('Concept').subIssues, { total: 1, completed: 0 });
  assert.deepEqual(shown('Concept').map, { destination: 'Where it goes.', decisions: [], fog: ['What is left'] });
});

test("only the record's blockers hold it: its ticket's provider blockers never do", async () => {
  const records = await open();
  records.importTicket({ title: 'Ticketed', repository: REPO, kind: 'feature', status: 'Queued', ticket: `${REPO}#12` });
  const [ticket] = tickets([12, 'Queued']);
  const [item] = recordItems(records, [{ ...ticket!, blockers: [{ number: 11, repo: REPO, state: 'open' }] }], [REPO]);
  assert.deepEqual(item!.blockers, []);
});

test("in a repository whose source hasn't read yet, only a record with a ticket waits for it", async () => {
  const records = await open();
  records.importTicket({ title: 'Unread', repository: REPO, kind: 'bug', ticket: `${REPO}#40` });
  records.create({ title: 'Local', repository: REPO, kind: 'feature' });
  assert.deepEqual(recordItems(records, [], [REPO], [REPO]).map((i) => i.title), ['Local']);
  assert.deepEqual(recordItems(records, tickets([40, 'List']), [REPO], [REPO]).map((i) => i.title), ['Unread', 'Local']);
});

test('work that needs you shows the reason, with what its PR and ticket observations offer', async () => {
  const records = await open();
  const build = records.create({ title: 'Build', repository: REPO, kind: 'build', status: 'Review' });
  let record = records.setPullRequest(build.workId, build.revision, `${REPO}#40`);
  record = records.observe(build.workId, record.revision, { of: 'pr', state: 'closed' });
  records.setNeedsYou(build.workId, record.revision, 'Its PR closed without merging.');
  const closed = records.importTicket({ title: 'Closed', repository: REPO, kind: 'bug', status: 'Queued', ticket: `${REPO}#12` }).record;
  records.setNeedsYou(closed.workId, records.observe(closed.workId, closed.revision, { of: 'ticket', state: 'closed' }).revision, 'Its ticket closed.');
  const reopened = records.importTicket({ title: 'Reopened', repository: REPO, kind: 'bug', status: 'Done', ticket: `${REPO}#13` }).record;
  records.setNeedsYou(reopened.workId, records.observe(reopened.workId, reopened.revision, { of: 'ticket', state: 'open' }).revision, 'Its ticket reopened.');
  const calm = records.create({ title: 'Calm', repository: REPO, kind: 'bug' });
  const shown = new Map(recordItems(records, [], [REPO]).map((item) => [item.id, item.needsYou]));
  assert.deepEqual(shown.get(build.workId), { reason: 'Its PR closed without merging.', offers: ['reopen-pr', 'replace-pr', 'set-aside'] });
  assert.deepEqual(shown.get(closed.workId), { reason: 'Its ticket closed.', offers: ['set-aside'] });
  assert.deepEqual(shown.get(reopened.workId), { reason: 'Its ticket reopened.', offers: ['reopen-work'] });
  assert.equal(shown.get(calm.workId), undefined);
});
