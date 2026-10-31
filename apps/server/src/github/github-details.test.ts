import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { ITEM_DETAILS_QUERY, OLDER_COMMENTS_QUERY, readGithubItemDetails, readGithubOlderComments, saveGithubDescription } from './github-details.ts';
import type { Item } from '@lar-factory/shared';

const item = (id: string): Item => ({ id } as Item);

/** A fake gh whose one GraphQL answer is `node`; `calls` holds each call's arguments. */
function fakeGh(node: unknown) {
  const calls: string[][] = [];
  return { calls, run: async (args: string[]) => { calls.push(args); return JSON.stringify({ data: { node } }); } };
}

const comment = (n: number, author: string | null = 'maddec01') => ({ id: `IC_${n}`, author: author && { login: author }, createdAt: `2026-10-${10 + n}T08:00:00Z`, body: `Comment ${n}` });
const people = { author: { login: 'maddec01' }, assignees: { nodes: [{ login: 'maddec01' }, { login: 'claude-bot' }] }, createdAt: '2026-10-12T09:14:00Z' };
const sub = (number: number, state: 'OPEN' | 'CLOSED') => ({ number, title: `Slice ${number}`, url: `https://github.com/maddec01/lar-server/issues/${number}`, state, repository: { nameWithOwner: 'maddec01/lar-server' } });

test('an issue answers its body, people, milestone, sub-tickets and comments, newest first', async () => {
  const gh = fakeGh({ __typename: 'Issue', body: '## Owner accounts', ...people, milestone: { title: 'Cloud v0.1' },
    subIssues: { nodes: [sub(144, 'CLOSED'), sub(145, 'OPEN')] },
    comments: { pageInfo: { hasPreviousPage: true, startCursor: 'CUR_1' }, nodes: [comment(1), comment(2, null), comment(3)] } });
  assert.deepEqual(await readGithubItemDetails(item('I_1'), gh.run), {
    body: '## Owner accounts', format: 'markdown', author: 'maddec01', assignees: ['maddec01', 'claude-bot'], createdAt: '2026-10-12T09:14:00Z',
    milestone: 'Cloud v0.1',
    subTickets: [
      { number: 144, title: 'Slice 144', url: 'https://github.com/maddec01/lar-server/issues/144', repo: 'maddec01/lar-server', state: 'closed' },
      { number: 145, title: 'Slice 145', url: 'https://github.com/maddec01/lar-server/issues/145', repo: 'maddec01/lar-server', state: 'open' },
    ],
    comments: [
      { id: 'IC_3', author: 'maddec01', createdAt: '2026-10-13T08:00:00Z', body: 'Comment 3', format: 'markdown' },
      { id: 'IC_2', author: 'ghost', createdAt: '2026-10-12T08:00:00Z', body: 'Comment 2', format: 'markdown' },
      { id: 'IC_1', author: 'maddec01', createdAt: '2026-10-11T08:00:00Z', body: 'Comment 1', format: 'markdown' },
    ],
    hasOlderComments: true, olderCursor: 'CUR_1',
  });
});

test('an item with no body, author or comments answers empty details', async () => {
  const gh = fakeGh({ __typename: 'Issue', body: '', author: null, assignees: { nodes: [] }, createdAt: '2026-10-12T09:14:00Z', milestone: null,
    subIssues: { nodes: [] }, comments: { pageInfo: { hasPreviousPage: false, startCursor: null }, nodes: [] } });
  assert.deepEqual(await readGithubItemDetails(item('I_2'), gh.run), {
    body: '', format: 'markdown', author: null, assignees: [], createdAt: '2026-10-12T09:14:00Z', subTickets: [], comments: [], hasOlderComments: false, olderCursor: null,
  });
});

test('opening an item makes one GraphQL call, by node id, for the last 10 comments and no other page', async () => {
  const gh = fakeGh({ __typename: 'Issue', body: 'x', ...people, subIssues: { nodes: [] }, comments: { pageInfo: { hasPreviousPage: true, startCursor: 'CUR_1' }, nodes: [comment(1)] } });
  await readGithubItemDetails(item('I_3'), gh.run);
  assert.equal(gh.calls.length, 1);
  assert.deepEqual(gh.calls[0], ['api', 'graphql', '-f', `query=${ITEM_DETAILS_QUERY}`, '-f', 'id=I_3']);
  const connections = ITEM_DETAILS_QUERY.match(/comments\([^)]*\)/g) ?? [];
  assert.ok(connections.length > 0 && connections.every((c) => c === 'comments(last: 10)'), 'each comments connection reads the last 10, with no cursor');
});

test('an item GitHub does not know says so, and a failed gh call answers its message', async () => {
  assert.deepEqual(await readGithubItemDetails(item('I_gone'), fakeGh(null).run), { status: 404, error: 'GitHub has no such item.' });
  const failing = async () => { throw new Error('gh api graphql failed: HTTP 403: API rate limit exceeded'); };
  assert.deepEqual(await readGithubItemDetails(item('I_4'), failing), { status: 502, error: 'gh api graphql failed: HTTP 403: API rate limit exceeded' });
});

test('older comments are one graphql call for the 10 before the cursor, newest first, with the next cursor', async () => {
  const gh = fakeGh({ __typename: 'Issue', comments: { pageInfo: { hasPreviousPage: true, startCursor: 'CUR_0' }, nodes: [comment(1), comment(2, null)] } });
  assert.deepEqual(await readGithubOlderComments(item('I_5'), 'CUR_1', gh.run), {
    comments: [
      { id: 'IC_2', author: 'ghost', createdAt: '2026-10-12T08:00:00Z', body: 'Comment 2', format: 'markdown' },
      { id: 'IC_1', author: 'maddec01', createdAt: '2026-10-11T08:00:00Z', body: 'Comment 1', format: 'markdown' },
    ],
    olderCursor: 'CUR_0',
  });
  assert.deepEqual(gh.calls, [['api', 'graphql', '-f', `query=${OLDER_COMMENTS_QUERY}`, '-f', 'id=I_5', '-f', 'before=CUR_1']]);
  const connections = OLDER_COMMENTS_QUERY.match(/comments\([^)]*\)/g) ?? [];
  assert.ok(connections.length > 0 && connections.every((c) => c === 'comments(last: 10, before: $before)'));
});

test('older comments of an item GitHub no longer has or of a failed call answer the error', async () => {
  assert.deepEqual(await readGithubOlderComments(item('I_gone'), 'CUR_1', fakeGh(null).run), { status: 404, error: 'GitHub has no such item.' });
  const failing = async () => { throw new Error('gh api graphql failed: HTTP 403'); };
  assert.deepEqual(await readGithubOlderComments(item('I_7'), 'CUR_1', failing), { status: 502, error: 'gh api graphql failed: HTTP 403' });
});

/** A paginated issue history, oldest first, using the requested GraphQL page size and cursor. */
function historyGh(history: ReturnType<typeof comment>[]) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const query = args.find((arg) => arg.startsWith('query='))!;
    const limit = Number(query.match(/comments\(last: (\d+)/)![1]);
    const end = Number(args.find((arg) => arg.startsWith('before='))?.slice(7) ?? history.length);
    const start = Math.max(0, end - limit);
    return JSON.stringify({ data: { node: { body: 'Human description.\n\n<!-- lar-factory:structure\n{}\n-->',
      comments: { pageInfo: { hasPreviousPage: start > 0, startCursor: String(start) }, nodes: history.slice(start, end) } } } });
  };
  return { calls, run };
}

const managed = (n: number) => ({ ...comment(n), body: n % 2 ? '<!-- lar-factory:chunk version=1 -->\nc2VjcmV0LWJhc2U2NA==' : '<!-- lar-factory:structure\n{}\n-->' });

test('details and older pages skip managed-only history to its end without exposing transport comments', async () => {
  const history = Array.from({ length: 125 }, (_, i) => managed(i));
  for (const older of [false, true]) {
    const gh = historyGh(history);
    const page = older ? await readGithubOlderComments(item('I_managed'), '125', gh.run) : await readGithubItemDetails(item('I_managed'), gh.run);
    assert.ok(!('error' in page));
    assert.deepEqual([page.comments, page.olderCursor], [[], null]);
    if ('hasOlderComments' in page && 'body' in page) assert.deepEqual([page.hasOlderComments, page.body], [false, 'Human description.']);
    assert.equal(gh.calls.length, 3);
    assert.doesNotMatch(JSON.stringify(page), /lar-factory:|c2VjcmV0/);
  }
});

test('managed-only leading pages reveal all ordinary discussion from the larger lookahead page', async () => {
  const human = Array.from({ length: 30 }, (_, i) => comment(i + 1));
  const history = [...human, ...Array.from({ length: 15 }, (_, i) => managed(i + 31))];
  for (const older of [false, true]) {
    const gh = historyGh(history);
    const page = older ? await readGithubOlderComments(item('I_mixed'), '45', gh.run) : await readGithubItemDetails(item('I_mixed'), gh.run);
    assert.ok(!('error' in page));
    assert.deepEqual(page.comments.map((c) => c.id), human.map((c) => c.id).reverse());
    assert.equal(page.olderCursor, null);
    assert.equal(gh.calls.length, 2);
  }
});

test('large managed histories stop after three calls and preserve a cursor for continued discussion reads', async () => {
  const gh = historyGh([comment(1), ...Array.from({ length: 999 }, (_, i) => managed(i + 2))]);
  const details = await readGithubItemDetails(item('I_large'), gh.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.comments, details.hasOlderComments, details.olderCursor, gh.calls.length], [[], true, '790', 3]);
  let cursor = details.olderCursor;
  while (cursor !== null) {
    const before = gh.calls.length;
    const page = await readGithubOlderComments(item('I_large'), cursor, gh.run);
    assert.ok(!('error' in page));
    assert.ok(gh.calls.length - before <= 3);
    cursor = page.olderCursor;
    if (cursor === null) assert.deepEqual(page.comments.map((c) => c.id), ['IC_1']);
  }
});

test('ordinary history keeps ten-comment pages in order without gaps or duplicate comments', async () => {
  const gh = historyGh(Array.from({ length: 23 }, (_, i) => comment(i + 1)));
  const details = await readGithubItemDetails(item('I_ordinary'), gh.run);
  assert.ok(!('error' in details));
  const ids = details.comments.map((c) => c.id);
  let cursor = details.olderCursor;
  while (cursor !== null) {
    const page = await readGithubOlderComments(item('I_ordinary'), cursor, gh.run);
    assert.ok(!('error' in page));
    ids.push(...page.comments.map((c) => c.id));
    cursor = page.olderCursor;
  }
  assert.deepEqual(ids, Array.from({ length: 23 }, (_, i) => `IC_${23 - i}`));
  assert.equal(gh.calls.length, 3);
});

const issue = (number: number): Item => ({ id: `I_${number}`, repo: 'maddec01/lar-server', number } as Item);

test('a saved description is the issue body, through gh issue edit --body-file', async () => {
  const calls: { args: string[]; body: string }[] = [];
  const run = async (args: string[]) => {
    calls.push({ args, body: readFileSync(args[args.indexOf('--body-file') + 1]!, 'utf8') });
    return '';
  };
  assert.equal(await saveGithubDescription(issue(12), '- a\n- b', run), null);
  assert.deepEqual(calls.map((c) => [c.args.filter((a, i) => c.args[i - 1] !== '--body-file'), c.body]),
    [[['issue', 'edit', '12', '-R', 'maddec01/lar-server', '--body-file'], '- a\n- b']]);
  assert.ok(!existsSync(calls[0]!.args.at(-1)!), 'the body file is removed after');
});

test('a failed edit answers its message, and no right to edit the issue is 403', async () => {
  const failing = (message: string) => async () => { throw new Error(message); };
  assert.deepEqual(await saveGithubDescription(issue(12), 'x', failing('HTTP 403: Resource not accessible by integration')),
    { status: 403, error: 'Could not save the description. HTTP 403: Resource not accessible by integration' });
  assert.deepEqual(await saveGithubDescription(issue(12), 'x', failing('timed out')), { status: 502, error: 'Could not save the description. timed out' });
});
