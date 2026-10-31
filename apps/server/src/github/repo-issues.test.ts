import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { Item, Status } from '@lar-factory/shared';
import { repoIssues } from './repo-issues.ts';

const REPO = 'maddec01/lar-apple';

const item = (statuses: Status[]): Item => ({
  id: 'I_7', status: statuses[0] ?? 'List', statuses, content: 'ticket', revision: 0, kind: 'issue', parentId: null, number: 7, title: 'Seek', url: `https://github.com/${REPO}/issues/7`,
  repo: REPO, labels: [], state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
  updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
});

/** A fake gh: records each call, and answers it from `reply`, which throws to fail the call. */
function fakeGh(reply: (args: string[]) => string = () => '{}') {
  const calls: string[][] = [];
  const run = async (args: string[]) => { calls.push(args); return reply(args); };
  return { calls, run };
}

test("a ticket search lists the repository's open issues matching the words, and a number reads that issue alone", async () => {
  const gh = fakeGh((args) => args[1] === 'list'
    ? JSON.stringify([{ number: 8, title: 'Stall on seek', url: `https://github.com/${REPO}/issues/8` }])
    : JSON.stringify({ number: 12, title: 'Seek', url: `https://github.com/${REPO}/issues/12`, body: '', labels: [], state: 'OPEN' }));
  const issues = repoIssues(REPO, gh.run);
  assert.deepEqual(await issues.searchTickets(REPO, 'stall'), [{ number: 8, title: 'Stall on seek', url: `https://github.com/${REPO}/issues/8` }]);
  assert.deepEqual(await issues.searchTickets(REPO, '#12'), [{ number: 12, title: 'Seek', url: `https://github.com/${REPO}/issues/12` }]);
  assert.deepEqual(gh.calls, [
    ['issue', 'list', '-R', REPO, '--state', 'open', '--limit', '20', '--json', 'number,title,url', '--search', 'stall'],
    ['issue', 'view', '12', '-R', REPO, '--json', 'number,title,url,body,labels,state'],
  ]);
});

test("a ticket read gives an open issue's text and kind, and nothing for a closed or missing one", async () => {
  const answers: Record<string, () => string> = {
    7: () => JSON.stringify({ number: 7, title: 'Stall', url: `https://github.com/${REPO}/issues/7`, body: '## Steps', labels: [{ name: 'bug' }], state: 'OPEN' }),
    8: () => JSON.stringify({ number: 8, title: 'Old', url: `https://github.com/${REPO}/issues/8`, body: '', labels: [], state: 'CLOSED' }),
    9: () => { throw new Error('gh issue view failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.'); },
  };
  const issues = repoIssues(REPO, fakeGh((args) => answers[args[2]!]!()).run);
  assert.deepEqual(await issues.readTicket(REPO, 7), { number: 7, title: 'Stall', url: `https://github.com/${REPO}/issues/7`, text: '## Steps', kind: 'bug' });
  assert.equal(await issues.readTicket(REPO, 8), null);
  assert.equal(await issues.readTicket(REPO, 9), null);
});

test('a ticket observation reads its state and assignees, and a confirmed not-found, but throws on any other failure', async () => {
  const answers: Record<string, () => string> = {
    7: () => JSON.stringify({ state: 'OPEN', assignees: [{ login: 'pedro' }, { login: 'ana' }] }),
    8: () => JSON.stringify({ state: 'CLOSED', assignees: [] }),
    9: () => { throw new Error('gh issue view failed: GraphQL: Could not resolve to an issue or pull request with the number of 9.'); },
    10: () => { throw new Error('gh issue view failed: HTTP 502'); },
  };
  const gh = fakeGh((args) => answers[args[2]!]!());
  const issues = repoIssues(REPO, gh.run);
  assert.deepEqual(await issues.observeTicket(REPO, 7), { state: 'open', assignee: 'ana, pedro' });
  assert.deepEqual(gh.calls[0], ['issue', 'view', '7', '-R', REPO, '--json', 'state,assignees']);
  assert.deepEqual(await issues.observeTicket(REPO, 8), { state: 'closed' });
  assert.deepEqual(await issues.observeTicket(REPO, 9), { state: 'not-found' });
  await assert.rejects(issues.observeTicket(REPO, 10), /HTTP 502/);
});

test("a change check lists the issues and PRs updated since, and can't tell once every one it lists changed", async () => {
  const updated = (number: number, at: string, pr = false) => ({ html_url: `https://github.com/${REPO}/${pr ? 'pull' : 'issues'}/${number}`, updated_at: at, closed_at: null });
  let page = [updated(9, '2026-10-21T08:10:00Z', true), updated(7, '2026-10-21T08:09:45Z'), updated(5, '2026-10-21T08:00:00Z')];
  const gh = fakeGh((args) => `HTTP/2.0 200 OK\r\nEtag: W/"${args.length}"\r\n\r\n${JSON.stringify(page)}`);
  const issues = repoIssues(REPO, gh.run);
  assert.deepEqual(await issues.changes!(Date.parse('2026-10-21T08:10:00Z')), [`https://github.com/${REPO}/pull/9`, `https://github.com/${REPO}/issues/7`],
    'it looks 30 seconds further back, for a clock behind GitHub');
  assert.deepEqual(gh.calls[0], ['api', '-i', `repos/${REPO}/issues?state=all&sort=updated&direction=desc&per_page=30`]);
  page = Array.from({ length: 30 }, (_, i) => updated(i + 1, '2026-10-21T09:00:00Z'));
  assert.equal(await issues.changes!(Date.parse('2026-10-21T08:30:00Z')), null);
  assert.deepEqual(gh.calls[1]!.slice(2, 4), ['-H', 'If-None-Match: W/"3"'], 'the next check sends the last ETag');
});

test('a change check leaves out an edit to an issue that closed before it, as a comment on an old one', async () => {
  const page = [{ html_url: `https://github.com/${REPO}/issues/3`, updated_at: '2026-10-21T08:10:00Z', closed_at: '2026-09-01T00:00:00Z' },
    { html_url: `https://github.com/${REPO}/issues/4`, updated_at: '2026-10-21T08:10:00Z', closed_at: '2026-10-21T08:10:00Z' }];
  const issues = repoIssues(REPO, fakeGh(() => `HTTP/2.0 200 OK\r\n\r\n${JSON.stringify(page)}`).run);
  assert.deepEqual(await issues.changes!(Date.parse('2026-10-21T08:10:00Z')), [`https://github.com/${REPO}/issues/4`]);
});

test('Abandon closes an issue as not planned and reports close failures', async () => {
  const gh = fakeGh();
  assert.equal(await repoIssues(REPO, gh.run).abandon(item(['List'])), null);
  assert.deepEqual(gh.calls, [['issue', 'close', '7', '-R', REPO, '--reason', 'not planned']]);
  const failed = fakeGh(() => { throw new Error('GitHub unavailable'); });
  assert.equal(await repoIssues(REPO, failed.run).abandon(item(['Queued'])), 'Could not abandon #7. GitHub unavailable');
});
