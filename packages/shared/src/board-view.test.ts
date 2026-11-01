import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { abandonPrompt, boardSections, closeTicketPrompt } from './board-view.ts';
import type { BoardData, Item } from './model.ts';

const ticketed = (repo: string) => ({ content: 'ticket', revision: 0, kind: 'issue', parentId: null, repo, number: 7, title: 'Keep history' } as Item);

test('a discovered concept stays in List until it has been added locally', () => {
  const concept = { ...ticketed('owner/repo'), id: 'concept', kind: 'concept', status: 'List', recorded: false } as Item;
  const data = { items: [concept], repos: [] } as unknown as BoardData;
  const fresh = boardSections(data, Date.now());
  assert.equal(fresh.list[0]?.id, concept.id);
  assert.deepEqual([fresh.concepts.length, fresh.queued.length, fresh.inFlight.length], [0, 0, 0]);
  data.items = [{ ...concept, recorded: true }];
  assert.equal(boardSections(data, Date.now()).concepts[0]?.id, concept.id);
});

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
