import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { ITEM_DETAILS_QUERY, readGithubItemDetails } from './github-details.ts';
import type { Item } from '@lar-factory/shared';

const item = (id: string, content: Item['content'] = 'ticket'): Item => ({ id, content } as Item);

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

test('a pull request answers the same fields, with no sub-tickets', async () => {
  const gh = fakeGh({ __typename: 'PullRequest', body: 'Closes #5', ...people, milestone: null, comments: { pageInfo: { hasPreviousPage: false, startCursor: 'CUR_1' }, nodes: [comment(1)] } });
  const details = await readGithubItemDetails(item('PR_1', 'pr'), gh.run);
  assert.ok(!('error' in details));
  assert.deepEqual([details.body, details.author, details.assignees, details.milestone, details.subTickets, details.comments.map((c) => c.id)], ['Closes #5', 'maddec01', ['maddec01', 'claude-bot'], undefined, [], ['IC_1']]);
  assert.deepEqual([details.hasOlderComments, details.olderCursor], [false, null], 'no older comments, so no cursor');
});

test('a draft answers its body and creator, with no comments', async () => {
  const gh = fakeGh({ __typename: 'DraftIssue', body: 'An idea.', creator: { login: 'maddec01' }, assignees: { nodes: [] }, createdAt: '2026-10-12T09:14:00Z' });
  assert.deepEqual(await readGithubItemDetails(item('DI_1'), gh.run), {
    body: 'An idea.', format: 'markdown', author: 'maddec01', assignees: [], createdAt: '2026-10-12T09:14:00Z', subTickets: [], comments: [], hasOlderComments: false, olderCursor: null,
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
