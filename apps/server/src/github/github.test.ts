// The queries gh sends. The rules that normalise their results are tested in packages/shared's github-items.test.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ISSUE_SEARCH_QUERY, ITEMS_QUERY } from './github.ts';

test('the board query asks only for the blocked-by count and reads linked PR bodies', () => {
  assert.doesNotMatch(ITEMS_QUERY, /blockedBy\(|blocking\(|fragment links/, 'the query asks only for the blocked-by count');
  assert.match(ITEMS_QUERY, /number url state isDraft body mergedAt\n/, 'linked PR bodies come with the board query, not a call per item');
});

test("the board query reads each slice's state reason", () => {
  assert.match(ITEMS_QUERY, /subIssues\(first: \d+\) \{ nodes \{ number title url state stateReason repository \{ nameWithOwner \} \} \}/,
    'the board query reads each slice\'s state reason; labels there would cost 60 points a page, not 10');
});

test('an issue search page reads only each issue\'s number and repo', () => {
  assert.match(ISSUE_SEARCH_QUERY, /search\(type: ISSUE, first: \d+, after: \$after, query: \$q\) \{ pageInfo \{ hasNextPage endCursor \} nodes \{ \.\.\. on Issue \{ number repository \{ nameWithOwner \} \} \} \}/);
});
