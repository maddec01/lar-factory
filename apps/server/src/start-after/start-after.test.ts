import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blockedText } from '@lar-factory/shared';
import type { BoardData, Item } from '@lar-factory/shared';
import { openWorkRecords, type WorkRecords } from '@lar-factory/work-records';
import { createBoardState } from '../board/board-state.ts';
import { recordItems } from '../items/record-items.ts';
import { createStartAfter } from './start-after.ts';

const WEB = 'contoso/Fabrikam/web';
const API = 'contoso/Fabrikam/api';

const blocked = (blockerState: 'open' | 'closed'): Item => ({
  id: 'azure:contoso/7', status: 'Queued', statuses: ['Queued'], content: 'ticket', revision: 0, kind: 'issue', parentId: null, number: 7, title: 'Item 7', url: null, repo: WEB,
  untaggedFor: [WEB, API], labels: [], state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 },
  blockers: [{ number: 6, repo: WEB, state: blockerState }], updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
});

test('Start after on an untagged item asks which repository, keeps the one picked, and starts in it', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'lar-start-after-'));
  t.onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, 'armed.json');
  const board = createBoardState({ items: [blocked('open')], repos: [] } as unknown as BoardData);
  const started: unknown[][] = [];
  const startAfter = createStartAfter({ board, file, offerModelChoices: () => [], commands: {
    start: async (...args) => { started.push(args); return { status: 200, body: { error: null } }; },
    startBuild: async () => ({ status: 200, body: { error: null } }),
  } });
  const asked = startAfter.arm('azure:contoso/7', undefined);
  assert.deepEqual([asked.status, (asked.body as { error: string }).error], [409, 'Pick which repository #7 is for: web or api.']);
  assert.equal(startAfter.arm('azure:contoso/7', undefined, 'Contoso/Fabrikam/API').status, 200);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { 'azure:contoso/7': { repo: API } });
  board.applyRead([blocked('closed')], board.revision(), (items) => items);
  await startAfter.startUnblocked();
  assert.deepEqual(started, [['azure:contoso/7', undefined, API]]);
});

const REPO = 'maddec01/lar-factory';
const at = (records: WorkRecords, workId: string) => records.read(workId).revision;
/** Each kind of blocker with the local facts that complete it, the last fact left out until `finish`. */
const BLOCKERS: { kind: 'decision' | 'concept' | 'build'; start(records: WorkRecords, workId: string): void; finish(records: WorkRecords, workId: string): void }[] = [
  { kind: 'decision',
    start(records, workId) {
      const concept = records.create({ title: 'Concept', repository: REPO, kind: 'concept', status: 'Shaping' });
      records.setParent(workId, at(records, workId), concept.workId);
      records.setBody(workId, at(records, workId), 'answer', 'Use SQLite.');
      records.setBody(workId, at(records, workId), 'domain-drafts', 'None.');
    },
    finish(records, workId) {
      const concept = records.read(workId).parentId!;
      records.setBody(concept, at(records, concept), 'map', '# Map\n\nSettled.');
    } },
  { kind: 'concept', start() {}, finish: (records, workId) => void records.setFogGone(workId, at(records, workId), true) },
  { kind: 'build',
    start(records, workId) {
      records.setPullRequest(workId, at(records, workId), `${REPO}#90`);
      records.observe(workId, at(records, workId), { of: 'pr', state: 'open' });
    },
    finish: (records, workId) => void records.observe(workId, at(records, workId), { of: 'pr', state: 'merged' }) },
];

for (const { kind, start, finish } of BLOCKERS) {
  test(`Start after waits on a ${kind} blocker until its local facts complete it, never on its Status or thread`, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), 'lar-start-after-'));
    const records = await openWorkRecords(join(dir, 'work-records.db'));
    t.onTestFinished(() => {
      records.close();
      rmSync(dir, { recursive: true, force: true });
    });
    const blocker = records.create({ title: `The ${kind}`, repository: REPO, kind, status: kind === 'build' ? 'In progress' : 'Shaping' });
    const work = records.create({ title: 'Waiting work', repository: REPO, kind: 'feature', status: 'Queued' });
    records.addBlocker(work.workId, work.revision, blocker.workId);
    start(records, blocker.workId);
    records.update(blocker.workId, at(records, blocker.workId), { status: 'Done' });
    records.addThread(blocker.workId, at(records, blocker.workId), `thread-${kind}`, 'build');

    const board = createBoardState({ items: recordItems(records, [], [REPO]), repos: [] } as unknown as BoardData);
    const reread = () => board.applyRead(recordItems(records, [], [REPO]), board.revision(), (items) => items);
    const started: unknown[][] = [];
    const startAfter = createStartAfter({ board, file: join(dir, 'armed.json'), offerModelChoices: () => [], commands: {
      start: async (...args) => { started.push(args); return { status: 200, body: { error: null } }; },
      startBuild: async () => ({ status: 200, body: { error: null } }),
    } });
    assert.equal(blockedText(board.find(work.workId)!), `Blocked by The ${kind} until it completes`);
    assert.equal(startAfter.arm(work.workId, undefined).status, 200);
    await startAfter.startUnblocked();
    assert.deepEqual(started, []);

    finish(records, blocker.workId);
    reread();
    await startAfter.startUnblocked();
    assert.deepEqual(started, [[work.workId, undefined, undefined]]);
  });
}
