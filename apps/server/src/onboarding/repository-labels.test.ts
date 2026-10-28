import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { WORKFLOW_LABELS } from '@lar-factory/shared';
import { fakeAz } from '../azure/fake-az.ts';
import { createCustomLabel, createRepositoryLabels, readRepositoryLabels, renameRepositoryLabels, workflowLabelsProblem } from './repository-labels.ts';

/** A fake gh over a repository with `names` as its labels: it records each call and creates, renames and looks labels up. */
function fakeGh(names: string[], fail: Partial<Record<'list' | 'create' | 'edit', string>> = {}) {
  const labels = [...names];
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const [, verb] = args;
    if (args[0] === 'label' && fail[verb as 'list']) throw new Error(`gh label ${verb} failed: ${fail[verb as 'list']}`);
    // A label's name comes last, after --.
    const name = args.at(-1)!;
    if (verb === 'list') return JSON.stringify(labels.map((n) => ({ name: n })));
    if (verb === 'create') { labels.push(name); return ''; }
    if (verb === 'edit') { labels[labels.indexOf(name)] = args.find((a) => a.startsWith('--name='))!.slice('--name='.length); return ''; }
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
    ['label', 'create', '-R', REPO, '--color', 'D4C5F9', '--description', 'Concept decision settled by questions', '--', 'decision-grill'],
    ['label', 'create', '-R', REPO, '--color', 'BFD4F2', '--description', "Slice an implementer couldn't finish, waiting for a re-slice", '--', 'blocked'],
  ]);
  assert.deepEqual(answer, { labels: gh.labels });
});

test('Create leaves an old name Rename moves, and makes one Rename leaves', async () => {
  const gh = fakeGh(['decision: grill', 'decision: task']);
  await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: ['decision: grill'] }, gh.run);
  const created = gh.calls.filter((c) => c[1] === 'create').map((c) => c.at(-1));
  assert.ok(!created.includes('decision-grill'));
  assert.ok(created.includes('decision-task'));
});

test('for a repository that reads its issues Create makes the missing status labels with their colour and description', async () => {
  const gh = fakeGh([...ALL, 'status-list']);
  await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: [] }, gh.run);
  assert.deepEqual(gh.calls.find((c) => c[1] === 'create'), ['label', 'create', '-R', REPO, '--color', 'EDEDED', '--description', 'Status: Queued', '--', 'status-queued']);
  assert.ok(!gh.calls.some((c) => c[1] === 'create' && c.at(-1) === 'status-list'));
  assert.ok(!gh.calls.some((c) => c[0] === 'api'), 'the label list is read once, with no lookup per label');
});

test("Create also makes a reused file's custom labels the repository lacks, with GitHub's colour", async () => {
  const gh = fakeGh([...ALL, 'App: Music']);
  const source = { kind: 'github-project', owner: 'maddec01', number: 3 };
  await createRepositoryLabels({ repo: REPO, itemSource: source, renaming: [], custom: ['app: music', 'os: ios'] }, gh.run);
  assert.deepEqual(gh.calls.filter((c) => c[1] === 'create'), [['label', 'create', '-R', REPO, '--', 'os: ios']]);
});

test("Create leaves out a reused file's custom label that can't be one, and still makes the workflow labels", async () => {
  const gh = fakeGh(ALL.filter((n) => n !== 'blocked'));
  const source = { kind: 'github-project', owner: 'maddec01', number: 3 };
  const answer = await createRepositoryLabels({ repo: REPO, itemSource: source, renaming: [],
    custom: ['build', 'status-review', '-R', 'x'.repeat(51), 'web'] }, gh.run);
  assert.deepEqual(gh.calls.filter((c) => c[1] === 'create').map((c) => c.at(-1)), ['blocked', 'web']);
  assert.deepEqual(answer, { labels: gh.labels });
});

test("a create that gh refuses answers with gh's message", async () => {
  const answer = await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: [] }, fakeGh([], { create: 'HTTP 403' }).run);
  assert.deepEqual(answer, { status: 502, error: `Couldn't create bug in ${REPO}: gh label create failed: HTTP 403` });
});

test('Rename moves each picked old name to its new one with gh label edit', async () => {
  const gh = fakeGh(['decision: grill', 'decision: task', 'bug']);
  const answer = await renameRepositoryLabels({ repo: REPO, names: ['decision: grill', 'decision: task'] }, gh.run);
  assert.deepEqual(gh.calls.filter((c) => c[1] === 'edit'), [
    ['label', 'edit', '--name=decision-grill', '--repo', REPO, '--', 'decision: grill'],
    ['label', 'edit', '--name=decision-task', '--repo', REPO, '--', 'decision: task'],
  ]);
  assert.deepEqual(answer, { labels: ['decision-grill', 'decision-task', 'bug'] });
});

test('Rename refuses an old name whose new one exists, and a name that is no old workflow label', async () => {
  const both = fakeGh(['decision: grill', 'decision-grill']);
  assert.deepEqual(await renameRepositoryLabels({ repo: REPO, names: ['decision: grill'] }, both.run),
    { status: 409, error: `decision-grill already exists in ${REPO}. Move items to it before removing decision: grill.` });
  assert.ok(!both.calls.some((c) => c[1] === 'edit'));
  const other = fakeGh(['needs-triage']);
  assert.deepEqual(await renameRepositoryLabels({ repo: REPO, names: ['needs-triage'] }, other.run),
    { status: 400, error: 'needs-triage is not a label that can be renamed here.' });
  assert.ok(!other.calls.some((c) => c[1] === 'edit'));
});

test("a rename that gh refuses answers with gh's message", async () => {
  assert.deepEqual(await renameRepositoryLabels({ repo: REPO, names: ['decision: grill'] }, fakeGh(['decision: grill'], { edit: 'HTTP 422' }).run),
    { status: 502, error: `Couldn't rename decision: grill to decision-grill in ${REPO}: gh label edit failed: HTTP 422` });
});

test('a typed custom label, colon and all, is created with gh label create, and the answer lists it', async () => {
  const gh = fakeGh(['bug']);
  assert.deepEqual(await createCustomLabel({ repo: REPO, name: ' app: music ' }, gh.run), { labels: ['bug', 'app: music'] });
  assert.deepEqual(gh.calls.filter((c) => c[1] === 'create'), [['label', 'create', '-R', REPO, '--', 'app: music']]);
});

test('a custom label the repository has already is created no second time', async () => {
  const gh = fakeGh(['App: Music']);
  assert.deepEqual(await createCustomLabel({ repo: REPO, name: 'app: music' }, gh.run), { labels: ['App: Music'] });
  assert.ok(!gh.calls.some((c) => c[1] === 'create'));
});

test("a custom label that is a workflow or status label is refused, and one gh refuses answers with gh's message", async () => {
  const gh = fakeGh([]);
  assert.deepEqual(await createCustomLabel({ repo: REPO, name: 'build' }, gh.run), { status: 400, error: 'build is reserved for tracking work.' });
  assert.deepEqual(await createCustomLabel({ repo: REPO, name: 'status-list' }, gh.run), { status: 400, error: 'status-list is reserved for board status.' });
  assert.deepEqual(await createCustomLabel({ repo: REPO, name: '--repo=other/repo' }, gh.run), { status: 400, error: 'Do not start the label name with a hyphen.' });
  assert.deepEqual(gh.calls, []);
  assert.deepEqual(await createCustomLabel({ repo: REPO, name: 'web' }, fakeGh([], { create: 'HTTP 403' }).run),
    { status: 502, error: `Couldn't create web in ${REPO}: gh label create failed: HTTP 403` });
});

test('a body without its repository, item source or old names is refused', async () => {
  const gh = fakeGh([]);
  assert.equal((await readRepositoryLabels({ repo: '../x' }, gh.run) as { status: number }).status, 400);
  assert.equal((await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'x' }, renaming: [] }, gh.run) as { status: number }).status, 400);
  assert.equal((await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' } }, gh.run) as { status: number }).status, 400);
  assert.equal((await createRepositoryLabels({ repo: REPO, itemSource: { kind: 'issues' }, renaming: [], custom: 'web' }, gh.run) as { status: number }).status, 400);
  assert.equal((await renameRepositoryLabels({ repo: REPO, names: 'decision: grill' }, gh.run) as { status: number }).status, 400);
  assert.equal((await createCustomLabel({ repo: REPO, name: 3 }, gh.run) as { status: number }).status, 400);
  assert.deepEqual(gh.calls, []);
});

test("a GitHub repository still lacking a workflow label holds onboarding's PR back", async () => {
  assert.deepEqual(await workflowLabelsProblem(REPO, fakeGh(ALL.slice(1)).run),
    { status: 409, error: `${REPO} is missing a required label. Go back to Labels to create or rename it.` });
  assert.equal(await workflowLabelsProblem(REPO, fakeGh(ALL).run), null);
});

const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const tagsCall = ['devops', 'invoke', '--area', 'wit', '--resource', 'tags', '--route-parameters', 'project=Fabrikam Fiber', '--api-version', '7.1',
  '--org', 'https://dev.azure.com/contoso', '--detect', 'false', '--output', 'json'];

test("on Azure DevOps the step reads the project's tags with az", async () => {
  const az = fakeAz({ items: [], tags: ['repo-lar-api', 'decision: grill'] });
  assert.deepEqual(await readRepositoryLabels({ repo: AZURE }, az.run), { labels: ['repo-lar-api', 'decision: grill'] });
  assert.deepEqual(az.calls, [tagsCall]);
  const refused = fakeAz({ items: [], fail: () => new Error('az devops invoke failed: TF400813: not authorized') });
  assert.deepEqual(await readRepositoryLabels({ repo: AZURE }, refused.run),
    { status: 502, error: "Can't read contoso/Fabrikam Fiber/lar-api's tags: az devops invoke failed: TF400813: not authorized" });
});

test('on Azure DevOps Rename renames the old tag in the project, then reads the tags again', async () => {
  const az = fakeAz({ items: [], tags: ['decision: grill', 'web'] });
  assert.deepEqual(await renameRepositoryLabels({ repo: AZURE, names: ['decision: grill'] }, az.run), { labels: ['decision-grill', 'web'] });
  assert.deepEqual(az.tagRenames, [{ from: 'decision: grill', to: 'decision-grill' }]);
  const patch = az.calls.find((c) => c.includes('--http-method'))!;
  assert.deepEqual(patch.slice(0, 9), ['devops', 'invoke', '--area', 'wit', '--resource', 'tags', '--route-parameters', 'project=Fabrikam Fiber', 'tagIdOrName=decision: grill']);
  assert.equal(patch[patch.indexOf('--http-method') + 1], 'PATCH');
  assert.deepEqual(az.calls.at(-1), tagsCall);
});

test("on Azure DevOps a rename that az refuses answers with az's message", async () => {
  const az = fakeAz({ items: [], tags: ['decision: grill'], fail: (args) => args.includes('--http-method') ? new Error('az devops invoke failed: TF401289: access denied') : undefined });
  assert.deepEqual(await renameRepositoryLabels({ repo: AZURE, names: ['decision: grill'] }, az.run),
    { status: 502, error: "Couldn't rename decision: grill to decision-grill in contoso/Fabrikam Fiber/lar-api: az devops invoke failed: TF401289: access denied" });
});

test('on Azure DevOps nothing creates a tag, and no workflow tag holds the PR back', async () => {
  const az = fakeAz({ items: [] });
  assert.equal((await createRepositoryLabels({ repo: AZURE, itemSource: { kind: 'azure-sprint', team: 'Fabrikam Team' }, renaming: [] }, az.run) as { status: number }).status, 400);
  assert.equal((await createCustomLabel({ repo: AZURE, name: 'web' }, az.run) as { status: number }).status, 400);
  assert.equal(await workflowLabelsProblem(AZURE, az.run), null);
  assert.deepEqual(az.calls, []);
});
