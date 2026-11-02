import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { abandonPrompt, boardSections, closeTicketPrompt } from './board-view.ts';
import type { BoardData, Item, Status } from './model.ts';

const ticketed = (repo: string) => ({ content: 'ticket', revision: 0, kind: 'issue', parentId: null, repo, number: 7, title: 'Keep history' } as Item);

test('a discovered concept stays in List until it has been added locally', () => {
  const concept = { ...ticketed('owner/repo'), id: 'concept', kind: 'concept', status: 'List', recorded: false } as Item;
  const data = { items: [concept], repos: [], firstRead: { settled: true } } as unknown as BoardData;
  const fresh = boardSections(data, Date.now());
  assert.equal(fresh.list[0]?.id, concept.id);
  assert.deepEqual([fresh.concepts.length, fresh.queued.length, fresh.inFlight.length], [0, 0, 0]);
  data.items = [{ ...concept, recorded: true }];
  assert.equal(boardSections(data, Date.now()).concepts[0]?.id, concept.id);
});

const AT = Date.parse('2026-11-02T12:00:00Z');
const boardWith = (item: Item, data: Partial<BoardData> = {}) =>
  ({ items: [item], repos: [], error: null, fetchedAt: new Date(AT).toISOString(), refreshSeconds: 60, firstRead: { settled: true }, ...data }) as unknown as BoardData;
const delivered = (status: Status, build: object, more: Partial<Item> = {}) =>
  ({ ...ticketed('owner/repo'), id: 'built', kind: 'issue', status, updatedAt: '2026-11-02', threads: [{ id: 'build', purpose: 'build', state: 'running', ...build }], ...more }) as Item;
const placed = (item: Item, data?: Partial<BoardData>, clientError?: string) => {
  const { needsYou, inFlight } = boardSections(boardWith(item, data), AT, clientError);
  return [needsYou.length, inFlight.length];
};

for (const status of ['Verify', 'Ready to merge'] as const) {
  test(`${status} moves to In flight while its build thread or a child runs`, () => {
    assert.deepEqual(placed(delivered(status, { currentRunning: true })), [0, 1]);
    assert.deepEqual(placed(delivered(status, { state: 'done', hasRunningChildren: true })), [0, 1]);
  });

  test(`${status} stays on the desk with an idle build thread, a queued run or another thread's run`, () => {
    assert.deepEqual(placed(delivered(status, { state: 'done' })), [1, 0]);
    assert.deepEqual(placed(delivered(status, {}), undefined), [1, 0], 'waiting counts as running in state alone');
    assert.deepEqual(placed(delivered(status, { purpose: 'shape', currentRunning: true })), [1, 0]);
    assert.deepEqual(placed(delivered(status, { currentRunning: true, observedAt: '2026-11-02' })), [1, 0]);
  });

  test(`${status} stays on the desk with an open question, even with a running child`, () => {
    assert.deepEqual(placed(delivered(status, { state: 'needs you' })), [1, 0]);
    assert.deepEqual(placed(delivered(status, { state: 'needs you', hasRunningChildren: true })), [1, 0]);
  });

  test(`${status} stays on the desk when paused, archived or holding a Needs you reason`, () => {
    for (const more of [{ paused: true }, { archived: true }, { needsYou: { reason: 'Stuck', offers: [] } }] as Partial<Item>[]) {
      assert.deepEqual(placed(delivered(status, { currentRunning: true }, more)), [1, 0]);
    }
  });

  test(`${status} stays on the desk while thread activity is unavailable`, () => {
    const running = delivered(status, { currentRunning: true });
    assert.deepEqual(placed(running, undefined, 'HTTP 502'), [1, 0], 'a client error');
    assert.deepEqual(placed(running, { error: 'HTTP 502' }), [1, 0], 'a failed read');
    assert.deepEqual(placed(running, { fetchedAt: '2026-11-02T11:00:00Z' }), [1, 0], 'old data');
    assert.deepEqual(placed(running, { firstRead: { settled: false } as BoardData['firstRead'] }), [1, 0], 'an unsettled first read');
  });
}

test('Abandon sets work aside on this Mac and says whether the board asks about its ticket next', () => {
  assert.deepEqual(abandonPrompt(ticketed('owner/repo')), {
    question: 'Abandon #7 Keep history?', confirm: 'Abandon', done: 'Set #7 Keep history aside on this Mac.',
    detail: 'Abandon sets the work aside on this Mac and leaves its ticket open. Abandon and close ticket closes the ticket first.',
  });
  assert.equal(abandonPrompt({ ...ticketed('owner/repo'), number: 0 }).detail, 'This sets the work aside on this Mac. It has no ticket, so nothing changes in its provider.');
});

for (const [repo, detail, confirm, done] of [
  ['owner/repo', 'This closes the issue as "not planned" on GitHub. You can reopen it on GitHub.', 'Close issue', 'Closed #7 Keep history as "not planned".'],
  ['org/project/repo', 'This moves the work item to Removed in Azure DevOps. You can reactivate it in Azure DevOps.', 'Move to Removed', 'Moved #7 Keep history to Removed.'],
]) {
  test(`closing ${repo}'s ticket after Abandon explains how it stays recoverable`, () => {
    assert.deepEqual(closeTicketPrompt(ticketed(repo!)), { question: 'Close the ticket of #7 Keep history too?', detail, confirm, keep: 'Keep it open', done });
  });
}

test('a current shaping question enters the desk and leaves when answered', () => {
  const item = { ...ticketed('owner/repo'), status: 'Shaping', threads: [{ id: 'question', state: 'needs you' }] } as Item;
  const data = { items: [item], repos: [], firstRead: { settled: true } } as unknown as BoardData;
  assert.deepEqual(boardSections(data, Date.now()).needsYou, [item]);
  item.threads = [{ id: 'question', state: 'running' }] as Item['threads'];
  assert.deepEqual(boardSections(data, Date.now()).needsYou, []);
});

for (const kind of ['issue', 'concept'] as const) {
  for (const status of ['List', 'Queued', 'Shaping', 'Ready', 'In progress', 'Review', 'Needs you', 'Verify', 'Ready to merge', 'Done'] as const) {
    test(kind + ' desk boundary in ' + status, () => {
      const item = { ...ticketed('owner/repo'), kind, status, threads: [{ id: 'q', state: 'needs you' }] } as Item;
      const data = { items: [item], repos: [], firstRead: { settled: true } } as unknown as BoardData;
      const expected = kind === 'concept' ? !['List', 'Queued', 'Done'].includes(status) : ['Shaping', 'Ready', 'Needs you', 'Verify', 'Ready to merge'].includes(status);
      assert.equal(boardSections(data, Date.now()).needsYou.length, Number(expected));
      item.threads = 'unavailable';
      const ordinary = kind === 'concept' ? status === 'Needs you' : ['Ready', 'Needs you', 'Verify', 'Ready to merge'].includes(status);
      assert.equal(boardSections(data, Date.now()).needsYou.length, Number(ordinary));
      item.threads = [{ id: 'q', state: 'needs you', observedAt: '2026-11-02' }] as Item['threads'];
      assert.equal(boardSections(data, Date.now()).needsYou.length, Number(ordinary));
    });
  }
}
