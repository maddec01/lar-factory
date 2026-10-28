import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { abandonPrompt } from './board-view.ts';
import type { Item } from './model.ts';

for (const [repo, detail, done] of [
  ['owner/repo', 'This closes the issue as "not planned" on GitHub. You can reopen it on GitHub.', 'Closed #7 Keep history as "not planned".'],
  ['org/project/repo', 'This moves the work item to Removed in Azure DevOps. You can reactivate it in Azure DevOps.', 'Moved #7 Keep history to Removed.'],
]) {
  test(`Abandon explains how ${repo}'s item stays recoverable`, () => {
    assert.deepEqual(abandonPrompt({ content: 'ticket', repo, number: 7, title: 'Keep history' } as Item), {
      question: 'Abandon #7 Keep history?', detail, confirm: 'Abandon', done,
    });
  });
}
