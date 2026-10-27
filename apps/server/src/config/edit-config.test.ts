import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { openEditPr, readEditConfig } from './edit-config.ts';

const REPO = 'maddec01/lar-web';
const PR = 'https://github.com/maddec01/lar-web/pull/21';
const FILE = JSON.stringify({ version: 2, role: 'Web client', itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', labels: ['app: music'] });
const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: ' Web client for the API ', labels: ['app: music', 'app: video'] };

/** A call's values for a gh api field, such as `ref` for `-f ref=...`. */
const field = (args: string[], name: string) => args.filter((a, i) => /^-[fF]$/.test(args[i - 1] ?? '') && a.startsWith(`${name}=`))
  .map((a) => a.slice(name.length + 1));

/**
 * A gh that records each call and answers it like GitHub, over a repository whose default branch holds `file` as its
 * .lar-factory.json and that has `labels`, failing the calls `fails` names, by their first two args or their path.
 */
function gh({ file = FILE as string | null, labels = ['bug', 'app: music'], fails = {} as Record<string, string>, branch = false, openPr = '' } = {}) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const failure = fails[args.slice(0, 2).join(' ')] ?? fails[args[1]!];
    if (failure) throw new Error(failure);
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify(labels.map((name) => ({ name })));
    if (args[0] === 'label' && args[1] === 'create') return '';
    if (args[1] === `repos/${REPO}/contents/.lar-factory.json`) {
      if (file === null) throw new Error('gh: Not Found (HTTP 404)');
      return file;
    }
    if (args[1] === `repos/${REPO}`) return 'main\n';
    if (args[1] === `repos/${REPO}/git/ref/heads/main`) return 'abc123\n';
    if (args[1] === `repos/${REPO}/git/trees/abc123?recursive=1`) return JSON.stringify({ sha: 'tree0', truncated: false, tree: [] });
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

const writes = (calls: string[][]) => calls.filter((args) => args.includes('POST') || args.includes('PATCH') || args[1] === 'create');

test("Edit loads the default branch's .lar-factory.json and the repository's labels", async () => {
  assert.deepEqual(await readEditConfig({ repo: REPO }, gh().run), {
    config: { itemSource: { kind: 'github-project', owner: 'maddec01', number: 3 }, show: 'all', role: 'Web client', labels: ['app: music'] },
    labels: ['bug', 'app: music'],
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
    { version: 2, role: 'Web client for the API', itemSource: { kind: 'issues' }, show: 'opted-in', labels: ['app: music', 'app: video'] });
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

test('Save refuses while lar-factory/edit-config has an open PR, and writes nothing', async () => {
  const { calls, run } = gh({ branch: true, openPr: PR });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { status: 409, error: `${REPO} has an Edit PR open already: ${PR}` });
  assert.deepEqual(writes(calls).filter((args) => args[0] !== 'label'), []);
});

test("a label create that fails shows gh's message and opens no PR", async () => {
  const { calls, run } = gh({ fails: { 'label create': 'HTTP 403' } });
  assert.deepEqual(await openEditPr({ repo: REPO, config }, run), { status: 502, error: `Couldn't create app: video in ${REPO}: HTTP 403` });
  assert.ok(!calls.some((args) => args[0] === 'pr' || args.includes('POST')));
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
