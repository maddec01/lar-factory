import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { IssueRef, Item, Status } from '@lar-factory/shared';
import { repoIssues } from './repo-issues.ts';

const REPO = 'maddec01/lar-apple';

const item = (statuses: Status[]): Item => ({
  id: 'I_7', status: statuses[0] ?? 'List', statuses, content: 'ticket', number: 7, title: 'Seek', url: `https://github.com/${REPO}/issues/7`,
  repo: REPO, labels: [], state: 'open', closedAs: null, parent: null, subIssues: { total: 0, completed: 0 }, blockers: [],
  updatedAt: '2026-10-21T08:00:00Z', closedAt: null, linkedPrs: [], slices: [],
});

const parent: IssueRef = { number: 5, title: 'Parent', url: `https://github.com/${REPO}/issues/5`, repo: REPO, state: 'open' };

/** A fake gh: records each call, and answers it from `reply`, which throws to fail the call. */
function fakeGh(reply: (args: string[]) => string = () => '{}') {
  const calls: string[][] = [];
  const run = async (args: string[]) => { calls.push(args); return reply(args); };
  return { calls, run };
}

test('a move swaps every status label the issue carries for the new one in one edit', async () => {
  const gh = fakeGh();
  const issues = repoIssues(REPO, gh.run);
  assert.equal(await issues.setStatus(item(['Queued']), 'Shaping'), null);
  assert.deepEqual(gh.calls, [
    ['api', `repos/${REPO}/labels/status-shaping`],
    ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-shaping', '--remove-label', 'status-queued'],
  ]);
});

test('Start, Queue and Back to List each add their label, and an issue with no status label only gets one added', async () => {
  const gh = fakeGh();
  const issues = repoIssues(REPO, gh.run);
  await issues.setStatus(item([]), 'Queued');
  await issues.setStatus(item(['Ready']), 'In progress');
  await issues.setStatus(item(['Queued']), 'List');
  assert.deepEqual(gh.calls.filter((c) => c[0] === 'issue'), [
    ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-queued'],
    ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-in-progress', '--remove-label', 'status-ready'],
    ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-list', '--remove-label', 'status-queued'],
  ]);
});

test('a missing label is created once, then used', async () => {
  const gh = fakeGh((args) => {
    if (args[0] === 'api') throw new Error('gh api failed: HTTP 404: Not Found');
    return '{}';
  });
  const issues = repoIssues(REPO, gh.run);
  assert.equal(await issues.setStatus(item(['List']), 'Shaping'), null);
  assert.equal(await issues.setStatus(item(['List']), 'Shaping'), null);
  assert.deepEqual(gh.calls, [
    ['api', `repos/${REPO}/labels/status-shaping`],
    ['label', 'create', '-R', REPO, '--color', 'EDEDED', '--description', 'Status: Shaping', '--', 'status-shaping'],
    ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-shaping', '--remove-label', 'status-list'],
    ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-shaping', '--remove-label', 'status-list'],
  ]);
});

test("a failed label creation names the label and the repository, and edits nothing", async () => {
  const gh = fakeGh((args) => {
    if (args[0] === 'api') throw new Error('gh: Not Found (HTTP 404)');
    if (args[0] === 'label') throw new Error('HTTP 403: Must have admin rights');
    return '{}';
  });
  const error = await repoIssues(REPO, gh.run).setStatus(item(['List']), 'Shaping');
  assert.equal(error, `Could not create the status-shaping label in ${REPO}. HTTP 403: Must have admin rights`);
  assert.equal(gh.calls.some((c) => c[0] === 'issue'), false);
});

test("a label lookup that fails for another reason than a missing label gives its own error, and creates and edits nothing", async () => {
  const gh = fakeGh((args) => {
    if (args[0] === 'api') throw new Error('gh: Bad credentials (HTTP 401)');
    return '{}';
  });
  const error = await repoIssues(REPO, gh.run).setStatus(item(['List']), 'Shaping');
  assert.equal(error, `Could not look up the status-shaping label in ${REPO}. gh: Bad credentials (HTTP 401)`);
  assert.deepEqual(gh.calls, [['api', `repos/${REPO}/labels/status-shaping`]]);
});

test('a failed edit gives the status it could not set and gh\'s message', async () => {
  const gh = fakeGh((args) => {
    if (args[0] === 'issue') throw new Error('gh issue edit failed: HTTP 502');
    return '{}';
  });
  assert.equal(await repoIssues(REPO, gh.run).setStatus(item(['List']), 'Queued'), 'Could not set Queued. gh issue edit failed: HTTP 502');
});

test('a move on an issue with two status labels is refused before it runs', () => {
  const issues = repoIssues(REPO, fakeGh().run);
  assert.match(issues.statusRefusal(item(['Shaping', 'Ready'])) ?? '', /This issue carries Shaping and Ready\. Keep one to move it again\./);
  assert.equal(issues.statusRefusal(item(['Shaping'])), null);
  assert.equal(issues.statusRefusal({ ...item(['Shaping', 'Ready']), state: 'closed', closedAs: 'done' }), null);
  assert.equal(issues.statusRefusal(parent), null);
});

test('a status write adds the new label and removes every other status label the issue carries', async () => {
  const gh = fakeGh();
  const issues = repoIssues(REPO, gh.run);
  assert.equal(await issues.setStatus(item(['Shaping', 'Review']), 'Review'), null);
  assert.deepEqual(gh.calls.at(-1), ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-review', '--remove-label', 'status-shaping']);
  assert.equal(await issues.setStatus(item(['Shaping', 'Review']), 'Queued'), null);
  assert.deepEqual(gh.calls.at(-1), ['issue', 'edit', '7', '-R', REPO, '--add-label', 'status-queued', '--remove-label', 'status-shaping', '--remove-label', 'status-review']);
});

test("a parent's move reads its labels first, swaps them, and is refused when it carries two", async () => {
  let labels = ['bug', 'status-ready'];
  const gh = fakeGh((args) => (args[1] === `repos/${REPO}/issues/5` ? JSON.stringify({ labels: labels.map((name) => ({ name })) }) : '{}'));
  const issues = repoIssues(REPO, gh.run);
  assert.equal(await issues.setParentStatus(parent, 'In progress'), null);
  assert.deepEqual(gh.calls.at(-1), ['issue', 'edit', '5', '-R', REPO, '--add-label', 'status-in-progress', '--remove-label', 'status-ready']);
  labels = ['status-ready', 'status-verify'];
  gh.calls.length = 0;
  assert.match(await issues.setParentStatus(parent, 'In progress') ?? '', /Keep one/);
  assert.equal(gh.calls.some((c) => c[0] === 'issue'), false);
});

test('a Done write is refused before any call', async () => {
  const gh = fakeGh();
  const issues = repoIssues(REPO, gh.run);
  assert.match(await issues.setStatus(item(['Verify']), 'Done') ?? '', /Could not set Done/);
  assert.match(await issues.setParentStatus(parent, 'Done') ?? '', /Could not set Done/);
  assert.deepEqual(gh.calls, []);
});

test('Add item gives the new issue status-list, creating the label first', async () => {
  const gh = fakeGh((args) => {
    if (args[1] === `repos/${REPO}/labels/status-list`) throw new Error('HTTP 404');
    if (args[2] === 'POST') return JSON.stringify({ number: 81, node_id: 'I_81', html_url: `https://github.com/${REPO}/issues/81`, updated_at: '2026-10-21T10:00:00Z' });
    return '{}';
  });
  const result = await repoIssues(REPO, gh.run).create({ repo: REPO, kind: 'bug', title: 'Stall', description: '', labels: ['os: ios'] }, {});
  assert.equal(result.error, null);
  assert.deepEqual(result.item?.statuses, ['List']);
  assert.deepEqual(gh.calls.map((c) => c[0] === 'label' ? [...c.slice(0, 2), c.at(-1)] : c.slice(0, 3)),
    [['api', `repos/${REPO}/labels/status-list`], ['label', 'create', 'status-list'], ['api', '--method', 'POST']]);
  assert.deepEqual(gh.calls[2]!.filter((a) => a.startsWith('labels[]')), ['labels[]=bug', 'labels[]=os: ios', 'labels[]=status-list']);
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
