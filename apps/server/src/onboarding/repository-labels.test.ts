import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { WORKFLOW_LABELS } from '@lar-factory/shared';
import { createRepositoryLabels, readRepositoryLabels, renameRepositoryLabels } from './repository-labels.ts';

/** A fake gh over a repository with `names` as its labels: it records each call and creates, renames and looks labels up. */
function fakeGh(names: string[], fail: Partial<Record<'list' | 'create' | 'edit', string>> = {}) {
  const labels = [...names];
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const [, verb] = args;
    if (args[0] === 'label' && fail[verb as 'list']) throw new Error(`gh label ${verb} failed: ${fail[verb as 'list']}`);
    if (verb === 'list') return JSON.stringify(labels.map((name) => ({ name })));
    if (verb === 'create') { labels.push(args[2]!); return ''; }
    if (verb === 'edit') { labels[labels.indexOf(args[2]!)] = args[4]!; return ''; }
    if (args[0] === 'api') {
      if (labels.includes(args[1]!.split('/labels/')[1]!)) return '{}';
      throw new Error('gh api failed: Not Found (HTTP 404)');
    }
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { run, calls, labels };
}

const ALL = WORKFLOW_LABELS.map((l) => l.name);
const REPO = 'maddec01/lar-web';

test("reading a repository's labels lists every label's name", async () => {
  const gh = fakeGh(['bug', 'needs-triage']);
  assert.deepEqual(await readRepositoryLabels({ repo: REPO }, gh.run), { labels: ['bug', 'needs-triage'] });
  assert.deepEqual(gh.calls, [['label', 'list', '-R', REPO, '--limit', '1000', '--json', 'name']]);
});

test("labels that can't be read answer with gh's message", async () => {
  assert.deepEqual(await readRepositoryLabels({ repo: REPO }, fakeGh([], { list: 'HTTP 404' }).run),
    { status: 502, error: `Can't read ${REPO}'s labels: gh label list failed: HTTP 404` });
});

test('Create makes each missing workflow label with its colour and description, and no other label', async () => {
  const gh = fakeGh([...ALL.filter((n) => n !== 'blocked' && n !== 'decision-grill'), 'needs-triage']);
  const answer = await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, renaming: [] }, gh.run);
  assert.deepEqual(gh.calls.filter((c) => c[1] !== 'list'), [
    ['label', 'create', 'decision-grill', '-R', REPO, '--color', 'D4C5F9', '--description', 'Concept decision settled by questions'],
    ['label', 'create', 'blocked', '-R', REPO, '--color', 'BFD4F2', '--description', "Slice an implementer couldn't finish, waiting for a re-slice"],
  ]);
  assert.deepEqual(answer, { labels: gh.labels });
});

test('Create leaves an old name Rename moves, and makes one Rename leaves', async () => {
  const gh = fakeGh(['decision: grill', 'decision: task']);
  await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: ['decision: grill'] }, gh.run);
  const created = gh.calls.filter((c) => c[1] === 'create').map((c) => c[2]);
  assert.ok(!created.includes('decision-grill'));
  assert.ok(created.includes('decision-task'));
});

test('for a repository that reads its issues Create makes the missing status labels through createStatusLabel', async () => {
  const gh = fakeGh([...ALL, 'status-list']);
  await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: [] }, gh.run);
  assert.deepEqual(gh.calls.find((c) => c[1] === 'create'), ['label', 'create', 'status-queued', '-R', REPO, '--color', 'EDEDED', '--description', 'Status: Queued']);
  assert.ok(!gh.calls.some((c) => c[1] === 'create' && c[2] === 'status-list'));
  assert.ok(gh.calls.some((c) => c[0] === 'api' && c[1] === `repos/${REPO}/labels/status-queued`));
});

test("a create that gh refuses answers with gh's message", async () => {
  const answer = await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: [] }, fakeGh([], { create: 'HTTP 403' }).run);
  assert.deepEqual(answer, { status: 502, error: `Couldn't create bug in ${REPO}: gh label create failed: HTTP 403` });
});

test('Rename moves each picked old name to its new one with gh label edit', async () => {
  const gh = fakeGh(['decision: grill', 'decision: task', 'bug']);
  const answer = await renameRepositoryLabels({ repo: REPO, names: ['decision: grill', 'decision: task'] }, gh.run);
  assert.deepEqual(gh.calls.filter((c) => c[1] === 'edit'), [
    ['label', 'edit', 'decision: grill', '--name', 'decision-grill', '--repo', REPO],
    ['label', 'edit', 'decision: task', '--name', 'decision-task', '--repo', REPO],
  ]);
  assert.deepEqual(answer, { labels: ['decision-grill', 'decision-task', 'bug'] });
});

test('Rename refuses an old name whose new one exists, and a name that is no old workflow label', async () => {
  const both = fakeGh(['decision: grill', 'decision-grill']);
  assert.deepEqual(await renameRepositoryLabels({ repo: REPO, names: ['decision: grill'] }, both.run),
    { status: 409, error: `${REPO} has decision-grill already, so decision: grill can't be renamed to it.` });
  assert.ok(!both.calls.some((c) => c[1] === 'edit'));
  const other = fakeGh(['needs-triage']);
  assert.deepEqual(await renameRepositoryLabels({ repo: REPO, names: ['needs-triage'] }, other.run),
    { status: 400, error: 'needs-triage is no old workflow label the repository has.' });
  assert.ok(!other.calls.some((c) => c[1] === 'edit'));
});

test("a rename that gh refuses answers with gh's message", async () => {
  assert.deepEqual(await renameRepositoryLabels({ repo: REPO, names: ['decision: grill'] }, fakeGh(['decision: grill'], { edit: 'HTTP 422' }).run),
    { status: 502, error: `Couldn't rename decision: grill to decision-grill in ${REPO}: gh label edit failed: HTTP 422` });
});

test('a body without its repository, item source or old names is refused', async () => {
  const gh = fakeGh([]);
  assert.equal((await readRepositoryLabels({ repo: '../x' }, gh.run) as { status: number }).status, 400);
  assert.equal((await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'x' }, renaming: [] }, gh.run) as { status: number }).status, 400);
  assert.equal((await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' } }, gh.run) as { status: number }).status, 400);
  assert.equal((await renameRepositoryLabels({ repo: REPO, names: 'decision: grill' }, gh.run) as { status: number }).status, 400);
  assert.deepEqual(gh.calls, []);
});
