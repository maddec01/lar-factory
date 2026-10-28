import { afterAll, test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG_VERSION } from '@lar-factory/shared';
import { REPO_URL, fakeAzRepos } from '../azure/fake-az.ts';
import { notEditable, openConfigUpdatePr as openUpdate, openEditPr as openEdit, readEditConfig as readEdit, readEditPrs } from './edit-config.ts';

const REPO = 'maddec01/lar-web';
const PR = 'https://github.com/maddec01/lar-web/pull/21';
const FILE = JSON.stringify({ version: 2, role: 'Web client', itemSource: { kind: 'issues' }, show: 'all', labels: ['app: music'] });
const PR_FILE = JSON.stringify({ version: 3, role: 'Web client on the PR', show: 'opted-in', labels: ['app: video'] });
const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: ' Web client for the API ', labels: ['app: music', 'app: video'] };

/** The gh boundary's fields, read from JSON stdin for tree requests and flags for other requests. */
const inputs = new WeakMap<string[], string>();
const field = (args: string[], name: string): string[] => {
  const input = inputs.get(args);
  if (input) {
    const payload = JSON.parse(input) as { base_tree: string; tree: Record<string, string>[] };
    if (name === 'base_tree') return [payload.base_tree];
    const key = /^tree\[\]\[(.+)\]$/.exec(name)?.[1];
    if (key) return payload.tree.flatMap((entry) => typeof entry[key] === 'string' ? [entry[key]] : []);
  }
  return args.filter((a, i) => /^-[fF]$/.test(args[i - 1] ?? '') && a.startsWith(`${name}=`)).map((a) => a.slice(name.length + 1));
};

/**
 * A gh that records each call and answers it like GitHub, over a repository whose default branch holds `file` as its
 * .lar-factory.json and that has `labels`, failing the calls `fails` names, by their first two args or their path.
 * lar-factory/edit-config, when `branch` is set, is at the commit old, whose .lar-factory.json is PR_FILE, and `openPr`
 * is its open PR.
 */
function gh({ file = FILE as string | null, labels = ['bug', 'app: music'], fails = {} as Record<string, string>, branch = false, openPr = '' } = {}) {
  const calls: string[][] = [];
  const run = async (args: string[], input?: string) => {
    if (input !== undefined) inputs.set(args, input);
    calls.push(args);
    const failure = fails[args.slice(0, 2).join(' ')] ?? fails[args[1]!];
    if (failure) throw new Error(failure);
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify(labels.map((name) => ({ name })));
    if (args[0] === 'label' && args[1] === 'create') return '';
    if (args[1] === `repos/${REPO}/contents/.lar-factory.json`) {
      if (file === null) throw new Error('gh: Not Found (HTTP 404)');
      return file;
    }
    if (args[1] === `repos/${REPO}/contents/.lar-factory.json?ref=lar-factory%2Fedit-config`) return PR_FILE;
    if (args[1] === `repos/${REPO}`) return 'main\n';
    if (args[1] === `repos/${REPO}/git/ref/heads/main`) return 'abc123\n';
    if (args[1] === `repos/${REPO}/git/trees/abc123?recursive=1`) return JSON.stringify({ sha: 'tree0', truncated: false, tree: [] });
    if (args[1] === `repos/${REPO}/git/trees/old?recursive=1`) return JSON.stringify({ sha: 'treeOld', truncated: false, tree: [] });
    if (args[1] === `repos/${REPO}/git/trees`) return 'tree1\n';
    if (args[1] === `repos/${REPO}/git/commits`) return 'commit1\n';
    if (args[1] === `repos/${REPO}/git/ref/heads/lar-factory/edit-config`) {
      if (!branch) throw new Error('gh: Not Found (HTTP 404)');
      return 'old\n';
    }
    if (args[0] === 'pr' && args[1] === 'list') return `${openPr}\n`;
    if (args[0] === 'pr' && args[1] === 'create') return `${PR}\n`;
    return '{}';
  };
  return { calls, run };
}

/** A board data folder whose list has `entries`. */
function listDir(entries: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'lar edit config test '));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, 'repositories.json'), JSON.stringify({ repositories: entries }));
  return dir;
}

/** The list the tests edit REPO from, where it is onboarded. */
const ONBOARDED = listDir([{ repo: REPO }]);
type Run = (args: string[]) => Promise<string>;
const readEditConfig = (input: Record<string, unknown>, run: Run) => readEdit(input, run, ONBOARDED);
const openEditPr = (input: Record<string, unknown>, run: Run) => openEdit(input, run, ONBOARDED);
const openConfigUpdatePr = (input: Record<string, unknown>, run: Run, version?: number) => openUpdate(input, run, version, ONBOARDED);

const writes = (calls: string[][]) => calls.filter((args) => args.includes('POST') || args.includes('PATCH') || args[1] === 'create');

test("Edit loads the default branch's .lar-factory.json and the repository's labels", async () => {
  assert.deepEqual(await readEditConfig({ repo: REPO }, gh().run), {
    config: { itemSource: { kind: 'issues' }, show: 'all', role: 'Web client', labels: ['app: music'] },
    labels: ['bug', 'app: music'],
  });
});

test("Edit with an open Edit PR loads the .lar-factory.json on that PR's branch, and names the PR", async () => {
  assert.deepEqual(await readEditConfig({ repo: REPO }, gh({ branch: true, openPr: PR }).run), {
    config: { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client on the PR', labels: ['app: video'] },
    labels: ['bug', 'app: music'],
    editPr: PR,
  });
});

test("Edit can't load a repository whose .lar-factory.json is missing or wrong, or when gh fails", async () => {
  assert.deepEqual(await readEditConfig({ repo: REPO }, gh({ file: null }).run), { status: 409, error: `${REPO} has no .lar-factory.json on its default branch.` });
  assert.deepEqual(await readEditConfig({ repo: REPO }, gh({ file: '{"role": 3}' }).run), { status: 409, error: '.lar-factory.json field role is missing or not a string.' });
  assert.deepEqual(await readEditConfig({ repo: REPO }, gh({ fails: { 'label list': 'HTTP 401' } }).run), { status: 502, error: `Can't read ${REPO}'s .lar-factory.json and labels: HTTP 401` });
  assert.deepEqual(await readEditConfig({ repo: 'nope' }, gh().run), { status: 400, error: 'Send the repository to edit.' });
});

test('Save creates the custom labels the repository lacks, then opens a PR from lar-factory/edit-config that changes only .lar-factory.json', async () => {
  const { calls, run } = gh();
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { prUrl: PR });
  const [create, tree, commit, branch, pr] = writes(calls);
  assert.deepEqual(create, ['label', 'create', '-R', REPO, '--', 'app: video']);
  assert.deepEqual(field(tree!, 'base_tree'), ['tree0']);
  assert.deepEqual(field(tree!, 'tree[][path]'), ['.lar-factory.json']);
  assert.deepEqual(JSON.parse(field(tree!, 'tree[][content]')[0]!),
    { version: CONFIG_VERSION, role: 'Web client for the API', itemSource: { kind: 'issues' }, show: 'opted-in', labels: ['app: music', 'app: video'] });
  assert.deepEqual([field(commit!, 'tree'), field(commit!, 'parents[]')], [['tree1'], ['abc123']]);
  assert.deepEqual([field(branch!, 'ref'), field(branch!, 'sha')], [['refs/heads/lar-factory/edit-config'], ['commit1']]);
  assert.deepEqual(pr!.slice(0, 8), ['pr', 'create', '-R', REPO, '--base', 'main', '--head', 'lar-factory/edit-config']);
  assert.equal(writes(calls).length, 5);
});

test('Save moves a lar-factory/edit-config branch left without an open PR to its commit', async () => {
  const { calls, run } = gh({ branch: true });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { prUrl: PR });
  const moved = writes(calls).find((args) => args.includes('PATCH'))!;
  assert.equal(moved[1], `repos/${REPO}/git/refs/heads/lar-factory/edit-config`);
  assert.deepEqual(field(moved, 'sha'), ['commit1']);
});

test("Save with an Edit PR open adds a commit to its branch, at the app's version, and opens no second PR", async () => {
  const { calls, run } = gh({ branch: true, openPr: PR });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { prUrl: PR });
  const [create, tree, commit, moved, ...rest] = writes(calls);
  assert.deepEqual(create, ['label', 'create', '-R', REPO, '--', 'app: video']);
  assert.deepEqual(field(tree!, 'base_tree'), ['treeOld']);
  assert.equal(JSON.parse(field(tree!, 'tree[][content]')[0]!).version, CONFIG_VERSION);
  assert.deepEqual(field(commit!, 'parents[]'), ['old']);
  assert.equal(moved![1], `repos/${REPO}/git/refs/heads/lar-factory/edit-config`);
  assert.deepEqual(field(moved!, 'sha'), ['commit1']);
  assert.deepEqual(rest, []);
});

test('the open Edit PR of each repository, leaving out and reporting each one gh fails to read', async () => {
  const other = 'maddec01/lar-notes';
  const failed: [string, string][] = [];
  const run = async (args: string[]) => {
    if (args[3] === other) throw new Error('HTTP 502');
    return args[3] === REPO ? `${PR}\n` : '\n';
  };
  assert.deepEqual(await readEditPrs([REPO, other, 'maddec01/lar-apple'], run, (repo, problem) => failed.push([repo, problem])), new Map([[REPO, PR]]));
  assert.deepEqual(failed, [[other, 'HTTP 502']]);
});

test("a label create that fails shows gh's message and opens no PR", async () => {
  const { calls, run } = gh({ fails: { 'label create': 'HTTP 403' } });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { status: 502, error: `Couldn't create app: video in ${REPO}: HTTP 403` });
  assert.ok(!calls.some((args) => args[0] === 'pr' && args[1] === 'create' || args.includes('POST')));
});

test("a PR that can't be opened shows gh's message", async () => {
  const { run } = gh({ fails: { 'pr create': 'GraphQL: no permission' } });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { status: 502, error: `Can't open ${REPO}'s Edit PR: GraphQL: no permission` });
});

test("Save refuses answers that don't fit and a .lar-factory.json gone from the default branch", async () => {
  assert.deepEqual(await openEditPr({ repo: REPO, config: { ...config, role: ' ' } }, gh().run),
    { status: 400, error: "Send the repository and its .lar-factory.json's values." });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, gh({ file: null }).run), { status: 409, error: `${REPO} has no .lar-factory.json on its default branch.` });
});

test("the config update PR rewrites only .lar-factory.json with the default branch's values at the app's version, from lar-factory/edit-config", async () => {
  const { calls, run } = gh({ file: JSON.stringify({ role: 'Web client', labels: ['app: music'] }) });
  assert.deepEqual(await openConfigUpdatePr({ repo: REPO }, run, 2), { prUrl: PR });
  const [tree, commit, branch, pr, ...rest] = writes(calls);
  assert.deepEqual(field(tree!, 'tree[][path]'), ['.lar-factory.json']);
  assert.equal(field(tree!, 'tree[][content]')[0], `${JSON.stringify({ version: 2, role: 'Web client', itemSource: { kind: 'issues' }, show: 'all', labels: ['app: music'] }, null, 2)}\n`);
  assert.deepEqual(field(commit!, 'parents[]'), ['abc123']);
  assert.deepEqual(field(branch!, 'ref'), ['refs/heads/lar-factory/edit-config']);
  assert.deepEqual(pr!.slice(0, 8), ['pr', 'create', '-R', REPO, '--base', 'main', '--head', 'lar-factory/edit-config']);
  assert.match(pr!.join(' '), /update lar Factory's Repository config to version 2/);
  assert.deepEqual(rest, []);
});

test("the config update PR joins an open Edit PR, rewriting its branch's values, and creates no label", async () => {
  const { calls, run } = gh({ branch: true, openPr: PR });
  assert.deepEqual(await openConfigUpdatePr({ repo: REPO }, run, 4), { prUrl: PR });
  const [tree, commit, moved, ...rest] = writes(calls);
  assert.deepEqual(JSON.parse(field(tree!, 'tree[][content]')[0]!),
    { version: 4, role: 'Web client on the PR', itemSource: { kind: 'issues' }, show: 'opted-in', labels: ['app: video'] });
  assert.deepEqual(field(commit!, 'parents[]'), ['old']);
  assert.equal(moved![1], `repos/${REPO}/git/refs/heads/lar-factory/edit-config`);
  assert.deepEqual(rest, []);
});

test("the config update PR refuses a body without a repository and shows a missing file or gh's message", async () => {
  assert.deepEqual(await openConfigUpdatePr({ repo: 'nope' }, gh().run), { status: 400, error: 'Send the repository to update.' });
  assert.deepEqual(await openConfigUpdatePr({ repo: REPO }, gh({ file: null }).run), { status: 409, error: `${REPO} has no .lar-factory.json on its default branch.` });
  assert.deepEqual(await openConfigUpdatePr({ repo: REPO }, gh({ fails: { 'pr create': 'HTTP 403' } }).run, 2), { status: 502, error: `Can't open ${REPO}'s Edit PR: HTTP 403` });
});

test('Edit, its Save and the config update PR refuse a repository off the list, still onboarding or resetting, and call no gh', async () => {
  const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
  const lists: [object[], string][] = [
    [[{ repo: 'maddec01/lar-cli' }], `${REPO} is not on this Mac's list.`],
    [[{ repo: REPO, onboarding: progress }], `${REPO} is still onboarding.`],
    [[{ repo: REPO, resetting: { prUrl: PR } }], `${REPO} is resetting.`],
  ];
  for (const [entries, error] of lists) {
    const dir = listDir(entries);
    const { calls, run } = gh();
    assert.deepEqual(notEditable(REPO, dir), { status: 409, error });
    assert.deepEqual(await readEdit({ repo: REPO }, run, dir), { status: 409, error });
    assert.deepEqual(await openEdit({ repo: REPO, config }, run, dir), { status: 409, error });
    assert.deepEqual(await openUpdate({ repo: REPO }, run, 2, dir), { status: 409, error });
    assert.deepEqual(calls, []);
  }
  assert.equal(notEditable('MADDEC01/lar-web', ONBOARDED), null);
});

const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const AZURE_PR = `${REPO_URL}/pullrequest/7`;
const AZURE_FILE = JSON.stringify({ version: 2, role: 'API', itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'all', labels: ['app: music'] });
const AZURE_PR_FILE = JSON.stringify({ version: 3, role: 'API on the PR', itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'opted-in', labels: [] });
const azureConfig = { itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'opted-in', role: ' API ', labels: ['app: music', 'app: video'] };
const AZURE_LISTED = listDir([{ repo: AZURE }]);

/**
 * A fake az over AZURE, whose default branch holds AZURE_FILE and whose project has two tags; with `open`,
 * lar-factory/edit-config is at old789, holds AZURE_PR_FILE and has the active PR 7.
 */
const azRepos = ({ open = false, fail }: { open?: boolean; fail?: (args: string[]) => Error | undefined } = {}) => fakeAzRepos({
  files: { '/.lar-factory.json': AZURE_FILE }, tags: ['app: music', 'status-list'], fail,
  ...open && { branches: { 'lar-factory/edit-config': 'old789' }, branchFiles: { 'lar-factory/edit-config': { '/.lar-factory.json': AZURE_PR_FILE } },
    prs: [{ pullRequestId: 7, status: 'active', sourceRefName: 'refs/heads/lar-factory/edit-config' }] },
});
const pushedFile = (push: { changes: { path: string; content?: string }[] }) => JSON.parse(push.changes[0]!.content!) as Record<string, unknown>;
const created = (calls: string[][]) => calls.filter((args) => args.slice(0, 3).join(' ') === 'repos pr create');

test("on Azure, Edit loads the default branch's .lar-factory.json and the project's tags through az, and an open Edit PR's branch file", async () => {
  assert.deepEqual(await readEdit({ repo: AZURE }, azRepos().run, AZURE_LISTED), {
    config: { itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'all', role: 'API', labels: ['app: music'] },
    labels: ['app: music', 'status-list'],
  });
  assert.deepEqual(await readEdit({ repo: AZURE }, azRepos({ open: true }).run, AZURE_LISTED), {
    config: { itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'opted-in', role: 'API on the PR', labels: [] },
    labels: ['app: music', 'status-list'],
    editPr: AZURE_PR,
  });
});

test('on Azure, Save pushes one commit with only .lar-factory.json to lar-factory/edit-config and opens a PR that completes its work items, creating no tag', async () => {
  const az = azRepos();
  const opened = await openEdit({ repo: AZURE, config: azureConfig }, az.run, AZURE_LISTED);
  assert.deepEqual(opened, { prUrl: `${REPO_URL}/pullrequest/100` });
  assert.deepEqual(az.pushes.map(({ ref, oldObjectId, parents, changes }) => ({ ref, oldObjectId, parents, paths: changes.map((c) => [c.changeType, c.path]) })),
    [{ ref: 'refs/heads/lar-factory/edit-config', oldObjectId: '0'.repeat(40), parents: ['abc123'], paths: [['edit', '/.lar-factory.json']] }]);
  assert.deepEqual(pushedFile(az.pushes[0]!),
    { version: CONFIG_VERSION, role: 'API', itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'opted-in', labels: ['app: music', 'app: video'] });
  const [create] = created(az.calls);
  assert.deepEqual([create![create!.indexOf('--source-branch') + 1], create![create!.indexOf('--target-branch') + 1]], ['lar-factory/edit-config', 'main']);
  assert.equal(create![create!.indexOf('--transition-work-items') + 1], 'true');
  assert.ok(!az.calls.some((args) => args.includes('tags')));
});

test("on Azure, a second Save pushes onto the open Edit PR's branch and opens no second PR, and the PR shows on the row", async () => {
  const az = azRepos({ open: true });
  assert.deepEqual(await openEdit({ repo: AZURE, config: azureConfig }, az.run, AZURE_LISTED), { prUrl: AZURE_PR });
  assert.deepEqual(az.pushes.map(({ oldObjectId, parents }) => [oldObjectId, parents]), [['old789', ['old789']]]);
  assert.deepEqual(created(az.calls), []);
  assert.deepEqual(await readEditPrs([AZURE], azRepos({ open: true }).run), new Map([[AZURE, AZURE_PR]]));
});

test("on Azure, the config update PR rewrites .lar-factory.json at the app's version through one push and az's PR", async () => {
  const az = azRepos();
  assert.deepEqual(await openUpdate({ repo: AZURE }, az.run, 4, AZURE_LISTED), { prUrl: `${REPO_URL}/pullrequest/100` });
  assert.deepEqual(pushedFile(az.pushes[0]!), { ...JSON.parse(AZURE_FILE), version: 4 });
  assert.equal(created(az.calls)[0]!.includes('--transition-work-items'), true);
});

test("on Azure, a refused push or PR shows az's message", async () => {
  const refused = (match: string, message: string) => azRepos({ fail: (args) => (args.join(' ').includes(match) ? new Error(message) : undefined) }).run;
  assert.deepEqual(await openEdit({ repo: AZURE, config: azureConfig }, refused('--resource pushes', 'TF401027: You need the Git Contribute permission.'), AZURE_LISTED),
    { status: 502, error: `Can't open ${AZURE}'s Edit PR: TF401027: You need the Git Contribute permission.` });
  assert.deepEqual(await openUpdate({ repo: AZURE }, refused('pr create', 'TF401179: An active pull request already exists.'), 4, AZURE_LISTED),
    { status: 502, error: `Can't open ${AZURE}'s Edit PR: TF401179: An active pull request already exists.` });
  assert.deepEqual(await readEdit({ repo: AZURE }, refused('--resource tags', 'Please run az login.'), AZURE_LISTED),
    { status: 502, error: `Can't read ${AZURE}'s .lar-factory.json and tags: Please run az login.` });
});
