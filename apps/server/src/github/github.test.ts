// The queries gh sends. The rules that normalise their results are tested in packages/shared's github-items.test.ts.

import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { DOSSIER_BODIES_QUERY, ISSUE_SEARCH_QUERY, OPEN_ISSUES_QUERY, PR_BODIES_QUERY, createTree, getIfChanged } from './github.ts';

test('the board query reads the blocked-by issues, and no issue or linked PR bodies', () => {
  assert.match(OPEN_ISSUES_QUERY, /blockedBy\(first: \d+\) \{ nodes \{ number state repository \{ nameWithOwner \} \} \}/, 'each blocked-by issue comes with its repo and state');
  assert.doesNotMatch(OPEN_ISSUES_QUERY, /blocking\(/, 'the query reads no blocking links');
  assert.doesNotMatch(OPEN_ISSUES_QUERY, /issueDependenciesSummary/, 'the open blockers come from the blocked-by issues, not a summary count');
  assert.doesNotMatch(OPEN_ISSUES_QUERY, /\.\.\. on Issue \{[^}]*\bbody\b/, "issue bodies are read for dossiers only, in a query of their own");
  assert.match(OPEN_ISSUES_QUERY, /id number url state isDraft mergeStateStatus\n/, "linked PRs' bodies and merge times are read for builds only, by id");
});

test("the PR bodies query reads only each linked PR's id, body and merge time", () => {
  assert.match(PR_BODIES_QUERY, /nodes\(ids: \$ids\) \{ \.\.\. on PullRequest \{ id body mergedAt \} \}/);
});

test('the board query reads a pull request item\'s own checks and merge state', () => {
  const pr = /\.\.\. on PullRequest \{([\s\S]*)\n {4}\}/.exec(OPEN_ISSUES_QUERY)?.[1] ?? '';
  assert.match(pr, /\bmergeStateStatus\b/);
  assert.match(pr, /statusCheckRollup \{\s+contexts\(first: \d+\) \{\s+checkRunCountsByState/);
});

test("the board query reads each slice's state reason", () => {
  assert.match(OPEN_ISSUES_QUERY, /subIssues\(first: \d+\) \{ nodes \{ number title url state stateReason repository \{ nameWithOwner \} \} \}/,
    'the board query reads each slice\'s state reason; labels there would cost 60 points a page, not 10');
});

test('an issue search page reads only each issue\'s number and repo', () => {
  assert.match(ISSUE_SEARCH_QUERY, /search\(type: ISSUE, first: \d+, after: \$after, query: \$q\) \{ pageInfo \{ hasNextPage endCursor \} nodes \{ \.\.\. on Issue \{ number repository \{ nameWithOwner \} \} \} \}/);
});

test("the dossier bodies query reads only each issue's id and body", () => {
  assert.match(DOSSIER_BODIES_QUERY, /nodes\(ids: \$ids\) \{ \.\.\. on Issue \{ id body \} \}/);
});

test('a change check asks again with the last ETag, and an unchanged answer, a 304, is null', async () => {
  const asked: string[][] = [];
  const answer = async (args: string[]) => {
    asked.push(args);
    if (args.includes('If-None-Match: W/"1"')) throw new Error('gh api -H failed: gh: HTTP 304');
    return 'HTTP/2.0 200 OK\r\nEtag: W/"1"\r\nX-Ratelimit-Remaining: 4999\r\n\r\n[{"number":1}]';
  };
  assert.deepEqual(await getIfChanged('repos/a/b/issues', undefined, answer), { etag: 'W/"1"', body: [{ number: 1 }] });
  assert.equal(await getIfChanged('repos/a/b/issues', 'W/"1"', answer), null);
  assert.deepEqual(asked, [['api', '-i', 'repos/a/b/issues'], ['api', '-i', '-H', 'If-None-Match: W/"1"', 'repos/a/b/issues']]);
  await assert.rejects(getIfChanged('repos/a/b/issues', undefined, async () => { throw new Error('HTTP 404'); }), /404/);
});


test('a tree sends edits, kept blobs and deletions as JSON without gh form parsing', async () => {
  let payload: unknown;
  const sha = await createTree('owner/repo', 'base123', [
    { path: 'AGENTS.md', mode: '100644', content: '# Rules\n"Keep quotes"\n' },
    { path: 'renamed.md', mode: '100755', sha: 'blob123' },
    { path: '.lar-factory.json', mode: '100644', sha: null },
  ], async (args, input?: string) => {
    assert.deepEqual(args, ['api', 'repos/owner/repo/git/trees', '--method', 'POST', '--input', '-', '--jq', '.sha']);
    payload = JSON.parse(input!);
    return 'tree123\n';
  });
  assert.equal(sha, 'tree123');
  assert.deepEqual(payload, { base_tree: 'base123', tree: [
    { path: 'AGENTS.md', mode: '100644', type: 'blob', content: '# Rules\n"Keep quotes"\n' },
    { path: 'renamed.md', mode: '100755', type: 'blob', sha: 'blob123' },
    { path: '.lar-factory.json', mode: '100644', type: 'blob', sha: null },
  ] });
});
