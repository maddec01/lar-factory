// The queries gh sends. The rules that normalise their results are tested in packages/shared's github-items.test.ts.

import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { DOSSIER_BODIES_QUERY, ISSUE_SEARCH_QUERY, ITEMS_QUERY } from './github.ts';

test('the board query reads the blocked-by issues, no issue bodies, and linked PR bodies', () => {
  assert.match(ITEMS_QUERY, /blockedBy\(first: \d+\) \{ nodes \{ number state repository \{ nameWithOwner \} \} \}/, 'each blocked-by issue comes with its repo and state');
  assert.doesNotMatch(ITEMS_QUERY, /blocking\(/, 'the query reads no blocking links');
  assert.doesNotMatch(ITEMS_QUERY, /issueDependenciesSummary/, 'the open blockers come from the blocked-by issues, not a summary count');
  assert.doesNotMatch(ITEMS_QUERY, /\.\.\. on Issue \{[^}]*\bbody\b/, "issue bodies are read for dossiers only, in a query of their own");
  assert.match(ITEMS_QUERY, /number url state isDraft body mergedAt mergeStateStatus\n/, 'linked PR bodies come with the board query, not a call per item');
});

test('the board query reads a pull request item\'s own checks and merge state', () => {
  const pr = /\.\.\. on PullRequest \{([\s\S]*)\n {4}\}/.exec(ITEMS_QUERY)?.[1] ?? '';
  assert.match(pr, /\bmergeStateStatus\b/);
  assert.match(pr, /statusCheckRollup \{\s+contexts\(first: \d+\) \{\s+checkRunCountsByState/);
});

test("the board query reads each slice's state reason", () => {
  assert.match(ITEMS_QUERY, /subIssues\(first: \d+\) \{ nodes \{ number title url state stateReason repository \{ nameWithOwner \} \} \}/,
    'the board query reads each slice\'s state reason; labels there would cost 60 points a page, not 10');
});

test('an issue search page reads only each issue\'s number and repo', () => {
  assert.match(ISSUE_SEARCH_QUERY, /search\(type: ISSUE, first: \d+, after: \$after, query: \$q\) \{ pageInfo \{ hasNextPage endCursor \} nodes \{ \.\.\. on Issue \{ number repository \{ nameWithOwner \} \} \} \}/);
});

test("the dossier bodies query reads only each issue's id and body", () => {
  assert.match(DOSSIER_BODIES_QUERY, /nodes\(ids: \$ids\) \{ \.\.\. on Issue \{ id body \} \}/);
});
