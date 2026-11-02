import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { abandonPrompt, boardSections, closeTicketPrompt, needsYouPrompt } from './board-view.ts';
import type { BoardData, Item, NeedsYouCause, Status } from './model.ts';

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
    for (const more of [{ paused: true }, { archived: true }, { needsYou: { reason: 'Stuck', offers: [], causes: [], ticketOpen: true } }] as Partial<Item>[]) {
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

const waiting = (causes: NeedsYouCause[], change: Partial<Item> = {}) => ({ ...ticketed('owner/repo'), status: 'Review', needsYou: { reason: 'Why.', offers: [], causes, ticketOpen: false }, ...change } as Item);
const GOES = 'This notice goes away.';
const STAYS = 'The notice stays with only its other note, which you can then mark as handled.';

test('Keep working says the item stays on the desk at its Status and what happens to its ticket', () => {
  assert.deepEqual(needsYouPrompt(waiting([{ type: 'ticket-closed' }]), 'keep-working'), { question: 'Keep working on #7 Keep history?',
    detail: `The item stays on the desk at Review. Its ticket stays closed. Its PR, branch and worktree don't change. ${GOES}` });
  assert.equal(needsYouPrompt(waiting([{ type: 'assignee-changed', from: 'pedro', to: null }], { status: 'In progress' }), 'keep-working').detail,
    `The item stays on the desk at In progress. Its ticket stays with no one. Its PR, branch and worktree don't change. ${GOES}`);
});

test('Mark as handled changes nothing except removing the notice', () => {
  assert.deepEqual(needsYouPrompt(waiting([]), 'mark-handled'), { question: 'Mark #7 Keep history as handled?', detail: 'This changes nothing except removing the notice.' });
  assert.equal(needsYouPrompt(waiting([{ type: 'ticket-missing' }]), 'mark-handled').detail, 'This changes nothing except removing the notice. Its ticket stays missing from its provider.');
});

test('Reopen PR and a replacement build name the destination, and a closed ticket stays closed', () => {
  assert.deepEqual(needsYouPrompt(waiting([{ type: 'pr-closed' }, { type: 'ticket-closed' }]), 'reopen-pr'), { question: 'Reopen the PR of #7 Keep history?',
    detail: `This reopens its PR in its provider. The item stays at Review, and its branch and worktree don't change. Its ticket stays closed. ${GOES}` });
  assert.deepEqual(needsYouPrompt(waiting([{ type: 'pr-closed' }]), 'replace-pr'), { question: 'Start a replacement build for #7 Keep history?',
    detail: `This moves the item to Ready, where Start build starts a new thread on a new branch from the same brief. Its closed PR stays closed, and its old branch and worktree stay. Its ticket doesn't change. ${GOES}` });
});

test('a choice names the other note only when the notice has one, and then says the notice stays for it', () => {
  const noted = waiting([{ type: 'ticket-closed' }]);
  noted.needsYou!.hasOtherNote = true;
  for (const action of ['keep-working', 'reopen-pr', 'replace-pr', 'back-to-queue', 'back-to-list'] as const) {
    assert.ok(needsYouPrompt(noted, action).detail.endsWith(STAYS), action);
    assert.ok(needsYouPrompt(waiting([{ type: 'ticket-closed' }]), action).detail.endsWith(GOES), action);
  }
  assert.equal(needsYouPrompt(noted, 'mark-handled').detail, 'This changes nothing except removing the notice. Its ticket stays closed.');
});

test('a choice that starts nothing says so beside a no-thread cause', () => {
  assert.equal(needsYouPrompt(waiting([{ type: 'pr-closed' }, { type: 'no-thread' }]), 'reopen-pr').detail,
    `This reopens its PR in its provider. The item stays at Review, and its branch and worktree don't change. Its ticket doesn't change. No thread starts, so T3 still shows none for this work. ${GOES}`);
});

test('Start again says what it starts, and that the notice goes only once a thread does', () => {
  const after = 'Once T3 shows the thread, the notice goes away. If the start fails, the notice stays.';
  assert.deepEqual(needsYouPrompt(waiting([{ type: 'no-thread' }]), 'start-again'), { question: 'Start #7 Keep history again?',
    detail: `This starts a new shaping thread in T3. The item stays at Review. Its ticket doesn't change. Its PR, branch and worktree don't change. ${after}` });
  const build = waiting([{ type: 'no-thread' }]);
  build.needsYou!.startAgainPurpose = 'build';
  assert.equal(needsYouPrompt(build, 'start-again').detail,
    `This starts a new build thread in T3. The item stays at Review. Its ticket doesn't change. The board checks its PR, branch and worktree, then says what happens to them. ${after}`);
});

test('Back to Queue and Move to List name the destination, and a build says it resets', () => {
  assert.deepEqual(needsYouPrompt(waiting([]), 'back-to-queue'), { question: 'Move #7 Keep history back to Queue?',
    detail: `This moves the item to Queued. Its ticket and PR don't change. Its old branches and worktrees stay unless you choose to remove them next. ${GOES}` });
  assert.deepEqual(needsYouPrompt(waiting([{ type: 'ticket-closed' }], { kind: 'build' }), 'back-to-list'), { question: 'Move #7 Keep history to List?',
    detail: `This moves the item to List. Its slices and build progress reset. Its ticket stays closed. Its PR doesn't change. Its old branches and worktrees stay unless you choose to remove them next. ${GOES}` });
});

test('work with no ticket says so', () => {
  assert.match(needsYouPrompt(waiting([], { number: 0 }), 'keep-working').detail, /It has no ticket\./);
  assert.match(needsYouPrompt(waiting([], { number: 0 }), 'back-to-list').detail, /It has no ticket\. Its PR doesn't change\./);
});

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
