import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BoardData, Item } from '@lar-factory/shared';
import { createBoardState } from '../board/board-state.ts';
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
