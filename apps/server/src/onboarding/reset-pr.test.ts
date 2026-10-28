import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { REPO_URL, fakeAzRepos } from '../azure/fake-az.ts';
import { AGENT_SKILLS_BLOCK } from './agent-setup.ts';
import { openResetPr } from './reset-pr.ts';

const PR = 'https://github.com/maddec01/lar-web/pull/9';
const LINK = '120000';

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
 * A gh that records each call and answers it like GitHub. The default branch, main at abc123, holds `files`, each a
 * text or a link `{ link: target }`; `branch` is lar-factory/reset's open PR's URL, or null when the branch has none,
 * and it is missing when the repository has no such branch. A call `fails` names, by its first two args, fails.
 */
function gh(files: Record<string, string | { link: string }>, { branch, fails = {} }: { branch?: string | null; fails?: Record<string, string> } = {}) {
  const calls: string[][] = [];
  const run = async (args: string[], input?: string) => {
    if (input !== undefined) inputs.set(args, input);
    calls.push(args);
    const failure = fails[args.slice(0, 2).join(' ')];
    if (failure) throw new Error(failure);
    if (args[1] === 'repos/maddec01/lar-web') return 'main\n';
    if (args[1] === 'repos/maddec01/lar-web/git/ref/heads/main') return 'abc123\n';
    if (args[1] === 'repos/maddec01/lar-web/git/trees/abc123?recursive=1') {
      return JSON.stringify({ sha: 'tree0', truncated: false, tree: Object.entries(files).map(([path, file]) =>
        ({ path, mode: typeof file === 'string' ? '100644' : LINK, type: 'blob', sha: `blob:${path}` })) });
    }
    const blob = /\/git\/blobs\/blob:(.+)$/.exec(args[1]!)?.[1];
    if (blob) {
      const file = files[blob]!;
      return typeof file === 'string' ? file : file.link;
    }
    if (args[1] === 'repos/maddec01/lar-web/git/ref/heads/lar-factory/reset') {
      if (branch === undefined) throw new Error('gh: Not Found (HTTP 404)');
      return 'def456\n';
    }
    if (args[0] === 'pr' && args[1] === 'list') return `${branch ?? ''}\n`;
    if (args[1] === 'repos/maddec01/lar-web/git/trees') return 'tree1\n';
    if (args[1] === 'repos/maddec01/lar-web/git/commits') return 'commit1\n';
    if (args[0] === 'pr' && args[1] === 'create') return `${PR}\n`;
    return '{}';
  };
  return { calls, run };
}

const treeCall = (calls: string[][]) => calls.find((args) => args[1] === 'repos/maddec01/lar-web/git/trees')!;
/** The tree's entries by path: the text a file gets, or null for a file it deletes. */
function entries(calls: string[][]): Record<string, string | null> {
  const payload = JSON.parse(inputs.get(treeCall(calls))!) as { tree: { path: string; content?: string; sha?: null }[] };
  return Object.fromEntries(payload.tree.map((entry) => [entry.path, entry.content ?? entry.sha ?? null]));
}

const DOCS = ['docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md', 'docs/agents/domain.md'];

test("the reset PR's one commit on the default branch's head deletes .lar-factory.json and the three docs/agents/ files, and removes only the Agent skills section from both files", async () => {
  const fenced = '## Agent skills\n\n```md\n## Not a heading\n```\n\n';
  const { calls, run } = gh({
    '.lar-factory.json': '{}', 'AGENTS.md': `# lar-web\n\nUse pnpm.\n\n${fenced}## Testing\n\nRun it.\n`, 'CLAUDE.md': `# Claude\n\n${AGENT_SKILLS_BLOCK}`,
    ...Object.fromEntries(DOCS.map((path) => [path, '# Doc\n'])), 'docs/agents/notes.md': '# Ours\n', 'README.md': '# lar-web\n',
  });
  assert.equal(await openResetPr('maddec01/lar-web', run), PR);
  assert.deepEqual(entries(calls), {
    'AGENTS.md': '# lar-web\n\nUse pnpm.\n\n## Testing\n\nRun it.\n', 'CLAUDE.md': '# Claude\n\n',
    '.lar-factory.json': null, ...Object.fromEntries(DOCS.map((path) => [path, null])),
  });
  assert.deepEqual(field(treeCall(calls), 'base_tree'), ['tree0']);
  const commit = calls.find((args) => args[1] === 'repos/maddec01/lar-web/git/commits')!;
  assert.deepEqual([field(commit, 'tree'), field(commit, 'parents[]')], [['tree1'], ['abc123']]);
  const branch = calls.find((args) => args[1] === 'repos/maddec01/lar-web/git/refs')!;
  assert.deepEqual([field(branch, 'ref'), field(branch, 'sha')], [['refs/heads/lar-factory/reset'], ['commit1']]);
  const create = calls.find((args) => args[0] === 'pr' && args[1] === 'create')!;
  assert.deepEqual([create[create.indexOf('--base') + 1], create[create.indexOf('--head') + 1]], ['main', 'lar-factory/reset']);
  assert.equal(create[create.indexOf('--body') + 1], 'This PR:\n\n'
    + '- Deletes `.lar-factory.json`, the Repository config lar Factory reads for this repository.\n'
    + "- Removes lar Factory's `## Agent skills` section from `CLAUDE.md`.\n"
    + "- Removes lar Factory's `## Agent skills` section from `AGENTS.md`.\n"
    + DOCS.map((path) => `- Deletes \`${path}\`.\n`).join('')
    + '\nReset on the lar Factory board opened it. Once it merges, everyone who onboarded this repository loses its Repository config.');
});

test('a file without the section, or a missing file, is left alone, and a CLAUDE.md linked to AGENTS.md changes AGENTS.md once', async () => {
  const linked = gh({ '.lar-factory.json': '{}', 'AGENTS.md': `# lar-web\n\n${AGENT_SKILLS_BLOCK}`, 'CLAUDE.md': { link: 'AGENTS.md' } });
  await openResetPr('maddec01/lar-web', linked.run);
  assert.deepEqual(entries(linked.calls), { 'AGENTS.md': '# lar-web\n\n', '.lar-factory.json': null });
  const plain = gh({ '.lar-factory.json': '{}', 'CLAUDE.md': '# Claude\n' });
  await openResetPr('maddec01/lar-web', plain.run);
  assert.deepEqual(entries(plain.calls), { '.lar-factory.json': null });
});

test('a lar-factory/reset left from before moves to the new commit, and its open PR is reused with the new body', async () => {
  const left = gh({ '.lar-factory.json': '{}' }, { branch: null });
  assert.equal(await openResetPr('maddec01/lar-web', left.run), PR);
  assert.deepEqual(left.calls.find((args) => args.includes('PATCH'))?.slice(0, 2), ['api', 'repos/maddec01/lar-web/git/refs/heads/lar-factory/reset']);
  const open = gh({ '.lar-factory.json': '{}' }, { branch: 'https://github.com/maddec01/lar-web/pull/3' });
  assert.equal(await openResetPr('maddec01/lar-web', open.run), 'https://github.com/maddec01/lar-web/pull/3');
  assert.ok(open.calls.some((args) => args.includes('PATCH') && args.includes('repos/maddec01/lar-web/pulls/3')));
  assert.ok(!open.calls.some((args) => args[1] === 'create'));
});

test('a default branch with nothing of the setup opens no PR', async () => {
  const { calls, run } = gh({ 'README.md': '# lar-web\n' });
  await assert.rejects(openResetPr('maddec01/lar-web', run), { message: "the default branch has none of lar Factory's setup to remove." });
  assert.ok(!calls.some((args) => args.includes('POST')));
});

test("a gh call that fails throws gh's message", async () => {
  const { run } = gh({ '.lar-factory.json': '{}' }, { fails: { 'pr create': 'pull request create failed: HTTP 403' } });
  await assert.rejects(openResetPr('maddec01/lar-web', run), { message: 'pull request create failed: HTTP 403' });
});

test('on Azure Repos, one push makes the reset commit on lar-factory/reset, and an active PR from it gets the new description', async () => {
  const az = fakeAzRepos({ files: { '/.lar-factory.json': '{}', '/AGENTS.md': `# lar-api\n\n${AGENT_SKILLS_BLOCK}`, '/README.md': '# lar-api\n' },
    branches: { 'lar-factory/reset': 'old789' }, prs: [{ pullRequestId: 7, status: 'active', sourceRefName: 'refs/heads/lar-factory/reset' }] });
  assert.equal(await openResetPr('contoso/Fabrikam%20Fiber/lar-api', az.run), `${REPO_URL}/pullrequest/7`);
  assert.deepEqual(az.pushes.map(({ ref, oldObjectId, parents, changes }) => ({ ref, oldObjectId, parents, changes })), [{
    ref: 'refs/heads/lar-factory/reset', oldObjectId: 'old789', parents: ['abc123'],
    changes: [{ changeType: 'delete', path: '/.lar-factory.json' }, { changeType: 'edit', path: '/AGENTS.md', content: '# lar-api\n\n' }],
  }]);
  assert.match(az.prs[0]!.description!, /^This PR:\n\n- Deletes `.lar-factory.json`/);
});
