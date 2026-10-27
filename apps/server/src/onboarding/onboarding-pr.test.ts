import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepositoryList, saveOnboarding, savePrClosed } from '../config/repository-config.ts';
import { WORKFLOW_LABELS } from '@lar-factory/shared';
import { REPO_URL, fakeAzRepos } from '../azure/fake-az.ts';
import {
  createPrOpener, followOnboardingPrs, followResetPrs, previewOnboardingPr, reopenOnboardingPr, resetRepository,
} from './onboarding-pr.ts';

const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client', labels: ['app: music'] };
const PR = 'https://github.com/maddec01/lar-web/pull/14';

async function dataDir(t: TestContext, entries: object[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar onboarding pr test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'repositories.json'), JSON.stringify({ repositories: entries }));
  return dir;
}

const ALL = WORKFLOW_LABELS.map((l) => l.name);

/** A call's value for a gh api field, such as `ref` for `-f ref=...`; the values of `tree[][path]` for an array's. */
const field = (args: string[], name: string) => args.filter((a, i) => /^-[fF]$/.test(args[i - 1] ?? '') && a.startsWith(`${name}=`))
  .map((a) => a.slice(name.length + 1));

const RULES = '# lar-web\n\n- Push to main when done.\n';
const LAR_CONFIG = JSON.stringify({ version: 1, role: 'Web client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: [] });

/**
 * A gh that records each call and answers it like GitHub, failing the calls `fails` names, by their first two args or
 * their path, with its message. The default branch holds `files`; `branches` are the lar-factory/ branches the
 * repository has, each with its open PR's URL or null. It lists `labels` as the repository's, every workflow label unless
 * a test says otherwise, and records no label list.
 */
function gh(fails: Record<string, string> = {}, branches: Record<string, string | null> = {}, files: Record<string, string> = { 'AGENTS.md': RULES },
  labels = ALL) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    if (args[0] === 'label' && args[1] === 'list') return JSON.stringify(labels.map((name) => ({ name })));
    calls.push(args);
    const failure = fails[args.slice(0, 2).join(' ')] ?? fails[args[1]!];
    if (failure) throw new Error(failure);
    if (args[1] === 'repos/maddec01/lar-web') return 'main\n';
    if (args[1] === 'repos/maddec01/lar-web/git/ref/heads/main') return 'abc123\n';
    if (args[1] === 'repos/maddec01/lar-web/git/trees/abc123?recursive=1') {
      return JSON.stringify({ sha: 'tree0', truncated: false, tree: Object.keys(files).map((path) => ({ path, mode: '100644', type: 'blob', sha: `blob:${path}` })) });
    }
    const blob = /\/git\/blobs\/blob:(.+)$/.exec(args[1]!)?.[1];
    if (blob) return files[blob]!;
    if (args[1] === 'repos/maddec01/lar-web/contents/.lar-factory.json') {
      if (!files['.lar-factory.json']) throw new Error('gh: Not Found (HTTP 404)');
      return files['.lar-factory.json'];
    }
    if (args[1] === 'repos/maddec01/lar-web/git/trees') return 'tree1\n';
    if (args[1] === 'repos/maddec01/lar-web/git/commits') return 'commit1\n';
    const ref = /\/git\/ref\/heads\/(lar-factory\/.+)$/.exec(args[1]!)?.[1];
    if (ref) {
      if (!(ref in branches)) throw new Error('gh: Not Found (HTTP 404)');
      return 'def456\n';
    }
    if (args[0] === 'pr' && args[1] === 'list') return `${branches[args[args.indexOf('--head') + 1]!] ?? ''}\n`;
    if (args[0] === 'pr' && args[1] === 'create') return `${PR}\n`;
    return '{}';
  };
  return { calls, run };
}

const picks = { clashes: [], skills: {} };
const pushRule = { id: 'push', file: 'AGENTS.md', line: 3, ticked: true, reason: 'It pushes to main, and the factory opens PRs.',
  edit: { kind: 'lines', remove: ['- Push to main when done.'], add: ['- Open a PR when done.'] } };
const writes = (calls: string[][]) => calls.filter((args) => args.includes('POST') || args.includes('PATCH') || args[1] === 'create');

test('opening the PR makes one commit on the default branch\'s head with every change, puts lar-factory/onboarding on it and opens the PR', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh({}, {}, { 'AGENTS.md': RULES, 'CONTEXT.md': '# Terms\n', '.scratch/todo.md': 'x' });
  const opened = await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config, picks: { skills: {}, clashes: [pushRule,
    { id: 'context', file: 'CONTEXT.md', ticked: true, reason: 'Old name.', edit: { kind: 'rename', to: 'GLOSSARY.md' } },
    { id: 'scratch', file: '.scratch/', ticked: true, reason: 'Local tracker.', edit: { kind: 'delete' } }] } });
  const kept = { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web' }, prUrl: PR };
  assert.deepEqual(opened, { prUrl: PR, onboarding: [{ repo: 'maddec01/lar-web', progress: kept }] });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  const [tree, commit, branch, create] = writes(calls);
  assert.deepEqual(field(tree!, 'base_tree'), ['tree0']);
  assert.deepEqual(field(tree!, 'tree[][path]').sort(), ['.lar-factory.json', '.scratch/todo.md', 'AGENTS.md', 'CONTEXT.md', 'GLOSSARY.md',
    'docs/agents/domain.md', 'docs/agents/issue-tracker.md', 'docs/agents/triage-labels.md']);
  assert.ok(field(tree!, 'tree[][content]').some((text) => text.startsWith('# lar-web\n\n- Open a PR when done.\n\n## Agent skills')));
  assert.deepEqual(JSON.parse(field(tree!, 'tree[][content]').find((text) => text.includes('"version"'))!),
    { version: 1, role: 'Web client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: ['app: music'] });
  assert.deepEqual([field(commit!, 'tree'), field(commit!, 'parents[]')], [['tree1'], ['abc123']]);
  assert.deepEqual([field(branch!, 'ref'), field(branch!, 'sha')], [['refs/heads/lar-factory/onboarding'], ['commit1']]);
  assert.deepEqual([create![create!.indexOf('--base') + 1], create![create!.indexOf('--head') + 1]], ['main', 'lar-factory/onboarding']);
  const body = create![create!.indexOf('--body') + 1]!;
  for (const line of ["- Writes lar Factory's `## Agent skills` block in `AGENTS.md`.", '- Adds `docs/agents/domain.md`.',
    '- Adds `.lar-factory.json`, the Repository config lar Factory reads for this repository.',
    '- Edits `AGENTS.md` at line 3: It pushes to main, and the factory opens PRs.', '- Renames `CONTEXT.md` to `GLOSSARY.md`.', '- Deletes `.scratch/`.']) {
    assert.ok(body.includes(line), line);
  }
  assert.ok(!calls.some((args) => args[0] === 'label' || /\/labels\b/.test(args[1]!) || args.includes('--add-label')), 'onboarding touches no label');
});

test('a reused .lar-factory.json goes in no commit, and its PR is marked so only its merge finishes the onboarding', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh({}, {}, { 'AGENTS.md': RULES, '.lar-factory.json': LAR_CONFIG });
  await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config: null, picks });
  assert.equal(readRepositoryList(dir)[0]!.onboarding?.reusesConfig, true);
  assert.ok(!field(writes(calls)[0]!, 'tree[][path]').includes('.lar-factory.json'));
  const create = writes(calls).at(-1)!;
  assert.ok(!create[create.indexOf('--body') + 1]!.includes('.lar-factory.json'));
});

test('reusing a .lar-factory.json the default branch lacks is refused, writing nothing', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh();
  assert.deepEqual(await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config: null, picks }),
    { status: 409, error: 'maddec01/lar-web has no .lar-factory.json on its default branch to reuse.' });
  assert.deepEqual(writes(calls), []);
});

test('an edit whose lines moved on the default branch fails with its file and line, and writes nothing', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh({}, {}, { 'AGENTS.md': '# lar-web\n\nRead the README.\n\n- Push to main when done.\n' });
  assert.deepEqual(await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [pushRule], skills: {} } }),
    { status: 409, error: "AGENTS.md line 3 doesn't have the lines its edit removes. Untick it on Cleanup, or Look again there." });
  assert.deepEqual(writes(calls), []);
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: progress }]);
});

test('a skill renamed in the PR moves its folder and names itself anew in its SKILL.md', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh({}, {}, { '.claude/skills/code-review/SKILL.md': '---\nname: code-review\n---\n' });
  await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config,
    picks: { clashes: [], skills: { '.claude/skills/code-review/': { kind: 'rename', name: 'web-review' } } } });
  const tree = writes(calls)[0]!;
  assert.ok(field(tree, 'tree[][path]').includes('.claude/skills/web-review/SKILL.md'));
  assert.ok(field(tree, 'tree[][content]').includes('---\nname: web-review\n---\n'));
  const create = writes(calls).at(-1)!;
  assert.ok(create[create.indexOf('--body') + 1]!.includes('- Renames `.claude/skills/code-review/` to `.claude/skills/web-review/`.'));
});

test('a taken lar-factory/onboarding with an open PR is moved to the new commit and its PR reused with the new body, opening nothing', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const reused = 'https://github.com/maddec01/lar-web/pull/9';
  const { calls, run } = gh({}, { 'lar-factory/onboarding': reused });
  assert.equal((await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config, picks }) as { prUrl: string }).prUrl, reused);
  assert.equal(readRepositoryList(dir)[0]!.onboarding?.prUrl, reused);
  const [, , move, edit, ...rest] = writes(calls);
  assert.deepEqual(move!.slice(0, 4), ['api', 'repos/maddec01/lar-web/git/refs/heads/lar-factory/onboarding', '--method', 'PATCH']);
  assert.deepEqual([field(move!, 'sha'), field(move!, 'force')], [['commit1'], ['true']]);
  assert.equal(edit![3], 'repos/maddec01/lar-web/pulls/9');
  assert.match(field(edit!, 'body')[0]!, /^This PR:/);
  assert.deepEqual(rest, []);
});

test('a taken branch with no open PR moves on to the first free lar-factory/onboarding-N', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh({}, { 'lar-factory/onboarding': null, 'lar-factory/onboarding-2': null });
  assert.equal((await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config, picks }) as { prUrl: string }).prUrl, PR);
  const refs = calls.filter((args) => args[1]!.includes('/git/ref/heads/lar-factory/')).map((args) => args[1]!.split('heads/')[1]);
  assert.deepEqual(refs, ['lar-factory/onboarding', 'lar-factory/onboarding-2', 'lar-factory/onboarding-3']);
  assert.ok(calls.find((args) => args[1]!.endsWith('/git/refs'))!.includes('ref=refs/heads/lar-factory/onboarding-3'));
  const create = calls.find((args) => args[1] === 'create')!;
  assert.equal(create[create.indexOf('--head') + 1], 'lar-factory/onboarding-3');
});

test('a run never kept is kept with its PR, in place of the one it was kept under before', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-apple', onboarding: progress }]);
  await createPrOpener(dir, gh().run)({ repo: 'maddec01/lar-web', progress, config, picks, replaces: 'maddec01/lar-apple' });
  assert.deepEqual(readRepositoryList(dir).map((e) => [e.repo, e.onboarding?.prUrl]), [['maddec01/lar-web', PR]]);
});

test("a failing gh call answers with gh's message and keeps no PR; Retry goes on from the call that failed", async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  for (const [call, after] of [['repos/maddec01/lar-web/git/commits', ['repos/maddec01/lar-web/git/commits', 'repos/maddec01/lar-web/git/ref/heads/lar-factory/onboarding',
    'repos/maddec01/lar-web/git/refs', 'create']], ['pr create', ['create']]] as const) {
    const fails: Record<string, string> = { [call]: `gh ${call} failed: HTTP 502` };
    const { calls, run } = gh(fails);
    const open = createPrOpener(dir, run);
    assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config, picks }), { status: 502,
      error: `Can't open maddec01/lar-web's onboarding PR: gh ${call} failed: HTTP 502` });
    assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: progress }]);
    delete fails[call];
    calls.length = 0;
    assert.equal((await open({ repo: 'maddec01/lar-web', progress, config, picks }) as { prUrl: string }).prUrl, PR);
    assert.deepEqual(calls.map((args) => args[1]), after);
    await writeFile(join(dir, 'repositories.json'), JSON.stringify({ repositories: [{ repo: 'maddec01/lar-web', onboarding: progress }] }));
  }
});

test('Retry with other picks after the commit was made starts again from the default branch, with only the new picks', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const fails: Record<string, string> = { 'pr create': 'gh pr create failed: HTTP 502' };
  const { calls, run } = gh(fails);
  const open = createPrOpener(dir, run);
  await open({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [pushRule], skills: {} } });
  delete fails['pr create'];
  calls.length = 0;
  assert.equal((await open({ repo: 'maddec01/lar-web', progress, config, picks }) as { prUrl: string }).prUrl, PR);
  assert.ok(calls.some((args) => args[1] === 'repos/maddec01/lar-web/git/ref/heads/main'));
  assert.ok(!field(writes(calls)[0]!, 'tree[][content]').some((text) => text.includes('Open a PR when done')));
  const create = writes(calls).at(-1)!;
  assert.ok(!create[create.indexOf('--body') + 1]!.includes('Edits'));
});

test('the preview lists the changes the PR would make against the default branch, writing nothing', async () => {
  const { calls, run } = gh();
  assert.deepEqual(await previewOnboardingPr({ repo: 'maddec01/lar-web', config, picks: { clashes: [pushRule], skills: {} } }, run), { changes: [
    { kind: 'agent-skills', path: 'AGENTS.md' }, { kind: 'write', path: 'docs/agents/issue-tracker.md', created: true },
    { kind: 'write', path: 'docs/agents/triage-labels.md', created: true }, { kind: 'write', path: 'docs/agents/domain.md', created: true },
    { kind: 'write', path: '.lar-factory.json', created: true }, { kind: 'edit', path: 'AGENTS.md', line: 3, reason: pushRule.reason },
  ] });
  assert.deepEqual(writes(calls), []);
  assert.deepEqual(await previewOnboardingPr({ repo: 'maddec01/lar-web', config, picks }, gh({ 'repos/maddec01/lar-web': 'gh api failed: HTTP 502' }).run),
    { status: 502, error: "Can't read maddec01/lar-web's default branch: gh api failed: HTTP 502" });
});

test('a repository that lacks a workflow label, or has one under its old name, gets no PR', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  for (const labels of [ALL.filter((n) => n !== 'blocked'), [...ALL.filter((n) => n !== 'decision-task'), 'decision: task']]) {
    const { calls, run } = gh({}, {}, undefined, labels);
    assert.deepEqual(await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config, picks }),
      { status: 409, error: 'maddec01/lar-web still lacks a workflow label. Go back to the Labels step and create or rename it.' });
    assert.deepEqual(calls, []);
  }
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: progress }]);
});

test('a body without the repository, its progress, a whole Repository config or null, and whole picks is refused', async (t) => {
  const dir = await dataDir(t);
  const open = createPrOpener(dir, gh().run);
  const refused = { status: 400, error: "Send the repository, its .lar-factory.json's values or null to reuse its own, and the Cleanup step's picks." };
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, picks, config: { ...config, role: ' ' } }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, picks, config: { ...config, show: 'some' } }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, picks, config: { ...config, labels: [3] } }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, picks }), refused);
  assert.deepEqual(await open({ repo: 'lar-web', progress, config, picks }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', config, picks }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [{ ...pushRule, line: undefined }], skills: {} } }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [], skills: { '.claude/skills/x/': { kind: 'rename', name: '../x' } } } }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [], skills: { '.claude/skills/x/': { kind: 'rename', name: '..' } } } }), refused);
  // Only the fixed checks delete or rename, and only CONTEXT.md and .scratch/.
  for (const edit of [{ kind: 'delete' }, { kind: 'rename', to: 'GLOSSARY.md' }]) {
    const clash = { id: 'x', file: '.github/workflows/ci.yml', reason: 'Injected.', ticked: true, edit };
    assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [clash], skills: {} } }), refused);
  }
  const renamed = { id: 'context', file: 'CONTEXT.md', reason: 'Old name.', ticked: true, edit: { kind: 'rename', to: '.github/workflows/ci.yml' } };
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config, picks: { clashes: [renamed], skills: {} } }), refused);
});

/**
 * A gh that answers each PR's state from `states`, by URL, failing for a URL it doesn't have, reads `.lar-factory.json`
 * from `files`, by repository, 404ing for one it doesn't have, and records the PRs it closes and reopens.
 */
function github(byUrl: Record<string, string>, files: Record<string, object> = {}) {
  const changed: string[][] = [];
  const run = async (args: string[]) => {
    if (args[0] === 'pr' && (args[1] === 'close' || args[1] === 'reopen')) {
      changed.push(args);
      return '';
    }
    if (args[0] === 'pr') {
      const state = byUrl[args[2]!];
      if (!state) throw new Error('gh pr view failed: HTTP 502');
      return `${state}\n`;
    }
    const repo = /^repos\/(.+)\/contents\/\.lar-factory\.json$/.exec(args[1]!)?.[1];
    if (repo && repo in files) return JSON.stringify(files[repo]);
    throw new Error('gh: Not Found (HTTP 404)');
  };
  return { changed, run };
}
const follow = (dir: string, gh: ReturnType<typeof github>, failed: (repo: string, problem: string) => void = () => assert.fail(),
  finished: (repo: string) => void = () => {}) =>
  followOnboardingPrs(readRepositoryList(dir), dir, gh.run, { failed, finished });

test('an onboarding whose PR merged is finished; one whose PR is open, or that has none, stays onboarding', async (t) => {
  const open = { ...progress, step: 'pr', prUrl: 'https://github.com/maddec01/lar-cli/pull/3' };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } },
    { repo: 'maddec01/lar-cli', onboarding: open }, { repo: 'maddec01/lar-docs', onboarding: progress }]);
  const list = await follow(dir, github({ [PR]: 'MERGED', [open.prUrl]: 'OPEN' }));
  const expected = [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web' }, { repo: 'maddec01/lar-cli', onboarding: open },
    { repo: 'maddec01/lar-docs', onboarding: progress }];
  assert.deepEqual(list, expected);
  assert.deepEqual(readRepositoryList(dir), expected);
});

test('a save made while gh answers is in the list it returns, also when no PR changed', async (t) => {
  const open = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: open }]);
  const gh = github({ [PR]: 'OPEN' });
  const answer = gh.run;
  gh.run = async (args) => {
    if (args[0] === 'pr') saveOnboarding({ repo: 'maddec01/lar-cli', progress }, null, dir);
    return answer(args);
  };
  assert.deepEqual((await follow(dir, gh)).map((e) => e.repo), ['maddec01/lar-web', 'maddec01/lar-cli']);
});

test('each onboarding the follow finishes is reported, whether its PR merged or its file landed another way', async (t) => {
  const landed = 'https://github.com/maddec01/lar-cli/pull/3';
  const open = 'https://github.com/maddec01/lar-docs/pull/4';
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } },
    { repo: 'maddec01/lar-cli', onboarding: { ...progress, step: 'pr', prUrl: landed } },
    { repo: 'maddec01/lar-docs', onboarding: { ...progress, step: 'pr', prUrl: open } }, { repo: 'maddec01/lar-apple', onboarding: progress }]);
  const finished: string[] = [];
  await follow(dir, github({ [PR]: 'MERGED', [landed]: 'CLOSED', [open]: 'OPEN' }, { 'maddec01/lar-cli': { role: 'CLI' } }), undefined,
    (repo) => finished.push(repo));
  assert.deepEqual(finished, ['maddec01/lar-web', 'maddec01/lar-cli']);
});

test("a PR whose state can't be read leaves its onboarding as it is and reports why", async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  const problems: string[] = [];
  const list = await follow(dir, github({}), (repo, problem) => problems.push(`${repo}: ${problem}`));
  assert.deepEqual(list, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(problems, ['maddec01/lar-web: gh pr view failed: HTTP 502']);
});

test('a .lar-factory.json that reaches the default branch another way finishes onboarding and closes the open PR with a comment', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } }]);
  const gh = github({ [PR]: 'OPEN' }, { 'maddec01/lar-web': { role: 'Web client' } });
  assert.deepEqual(await follow(dir, gh), [{ repo: 'maddec01/lar-web' }]);
  assert.equal(gh.changed.length, 1);
  assert.deepEqual(gh.changed[0]!.slice(0, 4), ['pr', 'close', PR, '--comment']);
  assert.match(gh.changed[0]![4]!, /reached the default branch without this PR, so lar Factory finished onboarding with that file and closed this PR/);
});

test("a file that can't be used, or a PR that can't be closed, leaves the onboarding as it is", async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(await follow(dir, github({ [PR]: 'OPEN' }, { 'maddec01/lar-web': { show: 'all' } })), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  const refusing = github({ [PR]: 'OPEN' }, { 'maddec01/lar-web': { role: 'Web client' } });
  const run = refusing.run;
  refusing.run = async (args) => { if (args[1] === 'close') throw new Error('gh pr close failed: HTTP 403'); return run(args); };
  const problems: string[] = [];
  assert.deepEqual(await follow(dir, refusing, (repo, problem) => problems.push(`${repo}: ${problem}`)), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(problems, ['maddec01/lar-web: gh pr close failed: HTTP 403']);
});

test('a PR closed without merging is marked closed, and the mark goes once it is open again; a file that lands then still finishes', async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(await follow(dir, github({ [PR]: 'CLOSED' })), [{ repo: 'maddec01/lar-web', onboarding: { ...kept, prClosed: true } }]);
  assert.deepEqual(await follow(dir, github({ [PR]: 'OPEN' })), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  savePrClosed('maddec01/lar-web', true, dir);
  const gh = github({ [PR]: 'CLOSED' }, { 'maddec01/lar-web': { role: 'Web client' } });
  assert.deepEqual(await follow(dir, gh), [{ repo: 'maddec01/lar-web' }]);
  assert.deepEqual(gh.changed, [], 'a closed PR is not closed again');
});

test('an onboarding that reuses its .lar-factory.json finishes only once its PR merges, though the default branch has the file', async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR, reusesConfig: true };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  const gh = github({ [PR]: 'OPEN' }, { 'maddec01/lar-web': { role: 'Web client' } });
  assert.deepEqual(await follow(dir, gh), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(gh.changed, []);
  assert.deepEqual(await follow(dir, github({ [PR]: 'MERGED' })), [{ repo: 'maddec01/lar-web' }]);
});

const followReset = (dir: string, gh: ReturnType<typeof github>, failed: (repo: string, problem: string) => void = () => assert.fail(),
  dropped: (repo: string) => void = () => {}) =>
  followResetPrs(readRepositoryList(dir), dir, gh.run, { failed, dropped });

test('a repository whose reset PR merged or closed unmerged is dropped from the list; one whose PR is open stays resetting', async (t) => {
  const merged = 'https://github.com/maddec01/lar-cli/pull/3';
  const closed = 'https://github.com/maddec01/lar-docs/pull/4';
  const resetting = { repo: 'maddec01/lar-web', resetting: { prUrl: PR } };
  const onboarding = { repo: 'maddec01/lar-apple', onboarding: { ...progress, step: 'pr', prUrl: 'https://github.com/maddec01/lar-apple/pull/5' } };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-factory' }, resetting, { repo: 'maddec01/lar-cli', resetting: { prUrl: merged } },
    { repo: 'maddec01/lar-docs', resetting: { prUrl: closed } }, onboarding]);
  const dropped: string[] = [];
  const list = await followReset(dir, github({ [PR]: 'OPEN', [merged]: 'MERGED', [closed]: 'CLOSED' }), undefined, (repo) => dropped.push(repo));
  const expected = [{ repo: 'maddec01/lar-factory' }, resetting, onboarding];
  assert.deepEqual(list, expected);
  assert.deepEqual(readRepositoryList(dir), expected);
  assert.deepEqual(dropped, ['maddec01/lar-cli', 'maddec01/lar-docs']);
});

test("a reset PR whose state can't be read leaves its entry as it is and reports why", async (t) => {
  const resetting = { repo: 'maddec01/lar-web', resetting: { prUrl: PR } };
  const dir = await dataDir(t, [resetting]);
  const problems: string[] = [];
  assert.deepEqual(await followReset(dir, github({}), (repo, problem) => problems.push(`${repo}: ${problem}`)), [resetting]);
  assert.deepEqual(readRepositoryList(dir), [resetting]);
  assert.deepEqual(problems, ['maddec01/lar-web: gh pr view failed: HTTP 502']);
});

test('a list with no repository resetting is returned as it is, without asking gh', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-factory' }]);
  const list = readRepositoryList(dir);
  assert.equal(await followResetPrs(list, dir, async () => assert.fail('gh was asked')), list);
});

test("Reopen PR runs gh pr reopen on the onboarding's PR and drops its closed mark", async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: { ...kept, prClosed: true } }]);
  const gh = github({});
  assert.deepEqual(await reopenOnboardingPr({ repo: 'maddec01/lar-web' }, dir, gh.run), { onboarding: [{ repo: 'maddec01/lar-web', progress: kept }] });
  assert.deepEqual(gh.changed, [['pr', 'reopen', PR]]);
});

test("Reopen PR that gh refuses answers with gh's message and keeps the mark; one with no PR or repository is refused", async (t) => {
  const closed = { ...progress, step: 'pr', prUrl: PR, prClosed: true };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: closed }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
  const refusing = async () => { throw new Error('gh pr reopen failed: Could not reopen: the branch was deleted'); };
  assert.deepEqual(await reopenOnboardingPr({ repo: 'maddec01/lar-web' }, dir, refusing),
    { status: 502, error: "Can't reopen maddec01/lar-web's onboarding PR: gh pr reopen failed: Could not reopen: the branch was deleted" });
  assert.deepEqual(readRepositoryList(dir)[0], { repo: 'maddec01/lar-web', onboarding: closed });
  assert.deepEqual(await reopenOnboardingPr({ repo: 'maddec01/lar-cli' }, dir, refusing), { status: 409, error: 'maddec01/lar-cli has no onboarding PR to reopen.' });
  assert.deepEqual(await reopenOnboardingPr({ repo: 'lar-cli' }, dir, refusing), { status: 400, error: 'Send the repository whose onboarding PR to reopen.' });
});

const RESET = 'Reset on the lar Factory board dropped this onboarding, so it closed this PR.';

test('Reset closes an onboarding\'s open PR with a comment, then drops its entry and keeps the others', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } },
    { repo: 'maddec01/lar-cli', onboarding: progress }]);
  const gh = github({ [PR]: 'OPEN' });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, gh.run), { onboarding: [{ repo: 'maddec01/lar-cli', progress }] });
  assert.deepEqual(gh.changed, [['pr', 'close', PR, '--comment', RESET]]);
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
});

test('Reset of an onboarding whose PR closed without merging, or that has no PR yet, only drops its entry', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
  const gh = github({ [PR]: 'CLOSED' });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, gh.run), { onboarding: [{ repo: 'maddec01/lar-cli', progress }] });
  const none = async () => assert.fail('no PR, no gh call');
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-cli' }, dir, none), { onboarding: [] });
  assert.deepEqual(gh.changed, []);
  assert.deepEqual(readRepositoryList(dir), []);
});

test("Reset whose PR gh can't close or read answers with gh's message and keeps the entry", async (t) => {
  const waiting = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: waiting }]);
  const refusing = async (args: string[]) => {
    if (args[1] === 'view') return 'OPEN\n';
    throw new Error('gh pr close failed: HTTP 403: Resource not accessible');
  };
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, refusing),
    { status: 502, error: "Can't close maddec01/lar-web's onboarding PR: gh pr close failed: HTTP 403: Resource not accessible" });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, github({}).run),
    { status: 502, error: "Can't close maddec01/lar-web's onboarding PR: gh pr view failed: HTTP 502" });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: waiting }]);
});

test('Reset of an onboarding whose PR merged, of a repository resetting or off the list, or of no repository is refused and keeps the list', async (t) => {
  const waiting = { ...progress, step: 'pr', prUrl: PR };
  const resetting = { repo: 'maddec01/lar-factory', resetting: { prUrl: PR } };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: waiting }, resetting]);
  const gh = github({ [PR]: 'MERGED' });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, gh.run),
    { status: 409, error: 'maddec01/lar-web\'s onboarding PR merged, so the board finishes its onboarding on its next refresh.' });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-factory' }, dir, gh.run), { status: 409, error: 'maddec01/lar-factory is resetting already.' });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-cli' }, dir, gh.run), { status: 409, error: "maddec01/lar-cli is not on this Mac's list." });
  assert.deepEqual(await resetRepository({ repo: 'lar-web' }, dir, gh.run), { status: 400, error: 'Send the repository to reset.' });
  assert.deepEqual(gh.changed, []);
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: waiting }, resetting]);
});

test('Reset of an onboarded repository opens the reset PR, then keeps its URL in the entry and answers it, which leaves the repositories still onboarding alone', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
  const { calls, run } = gh({}, {}, { '.lar-factory.json': LAR_CONFIG, 'AGENTS.md': RULES });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, run), { onboarding: [{ repo: 'maddec01/lar-cli', progress }], prUrl: PR });
  assert.deepEqual(field(calls.find((args) => args[1] === 'repos/maddec01/lar-web/git/trees')!, 'tree[][path]'), ['.lar-factory.json']);
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', resetting: { prUrl: PR } }, { repo: 'maddec01/lar-cli', onboarding: progress }]);
});

test('Reset of an onboarded repository closes its open Edit PR with a comment before it opens the reset PR', async (t) => {
  const edit = 'https://github.com/maddec01/lar-web/pull/9';
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }]);
  const { calls, run } = gh({}, { 'lar-factory/edit-config': edit }, { '.lar-factory.json': LAR_CONFIG });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, run), { onboarding: [], prUrl: PR });
  const close = calls.findIndex((args) => args[0] === 'pr' && args[1] === 'close');
  assert.deepEqual(calls[close], ['pr', 'close', edit, '--comment',
    'Reset on the lar Factory board opened a PR that removes `.lar-factory.json`, so it closed this Edit PR.']);
  assert.ok(close < calls.findIndex((args) => args[0] === 'pr' && args[1] === 'create'));
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', resetting: { prUrl: PR } }]);
});

test("Reset of an onboarded repository whose Edit PR can't be closed answers with gh's message, opens no reset PR and keeps the entry", async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }]);
  const { calls, run } = gh({ 'pr close': 'HTTP 403' }, { 'lar-factory/edit-config': 'https://github.com/maddec01/lar-web/pull/9' }, { '.lar-factory.json': LAR_CONFIG });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, run), { status: 502, error: "Can't close maddec01/lar-web's Edit PR: HTTP 403" });
  assert.ok(!calls.some((args) => args[0] === 'pr' && args[1] === 'create'));
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web' }]);
});

test("Reset of an onboarded repository whose PR can't be opened after it closed the Edit PR says that PR is closed now, after gh's message less its period, and that it closed it", async (t) => {
  const edit = 'https://github.com/maddec01/lar-web/pull/9';
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }]);
  const { run } = gh({ 'pr create': 'pull request create failed: HTTP 403.' }, { 'lar-factory/edit-config': edit }, { '.lar-factory.json': LAR_CONFIG });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, run),
    { status: 502, error: `Can't open maddec01/lar-web's reset PR: pull request create failed: HTTP 403. Its Edit PR, ${edit}, is closed now.`, editPrClosed: true });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web' }]);
});

test("Reset of an onboarded repository whose entry can't be marked resetting names the reset PR it opened", async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }]);
  const { run } = gh({}, {}, { '.lar-factory.json': LAR_CONFIG });
  const marking = async (args: string[]) => {
    const out = await run(args);
    if (args[0] === 'pr' && args[1] === 'create') await writeFile(join(dir, 'repositories.json'), '{');
    return out;
  };
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, marking),
    { status: 409, error: `Opened maddec01/lar-web's reset PR, ${PR}, but can't mark it resetting: ${join(dir, 'repositories.json')} isn't valid JSON.` });
});

test("Reset of an onboarded repository whose PR can't be opened answers with gh's message and keeps the entry onboarded", async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web' }]);
  const { run } = gh({ 'pr create': 'pull request create failed: HTTP 403' }, {}, { '.lar-factory.json': LAR_CONFIG });
  assert.deepEqual(await resetRepository({ repo: 'maddec01/lar-web' }, dir, run),
    { status: 502, error: "Can't open maddec01/lar-web's reset PR: pull request create failed: HTTP 403" });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web' }]);
});

const AZURE = 'contoso/Fabrikam%20Fiber/lar-api';
const azureConfig = { itemSource: { kind: 'azure-sprint', team: 'Fabrikam Team' }, show: 'all', role: 'API' };

test('on Azure Repos, a completed PR finishes onboarding, an abandoned one is marked closed and reactivated by Reopen PR', async (t) => {
  const merged = `${REPO_URL}/pullrequest/7`;
  const abandoned = 'https://dev.azure.com/contoso/Fabrikam%20Fiber/_git/lar-web/pullrequest/8';
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: { ...progress, step: 'pr', prUrl: merged } },
    { repo: 'contoso/Fabrikam%20Fiber/lar-web', onboarding: { ...progress, step: 'pr', prUrl: abandoned } }]);
  const az = fakeAzRepos({ prs: [{ pullRequestId: 7, status: 'completed', sourceRefName: 'refs/heads/x' }, { pullRequestId: 8, status: 'abandoned', sourceRefName: 'refs/heads/x' }] });
  const kept = { ...progress, step: 'pr', prUrl: abandoned };
  assert.deepEqual(await followOnboardingPrs(readRepositoryList(dir), dir, az.run, { failed: () => assert.fail() }),
    [{ repo: AZURE }, { repo: 'contoso/Fabrikam%20Fiber/lar-web', onboarding: { ...kept, prClosed: true } }]);
  assert.deepEqual(await reopenOnboardingPr({ repo: 'contoso/Fabrikam%20Fiber/lar-web' }, dir, az.run),
    { onboarding: [{ repo: 'contoso/Fabrikam%20Fiber/lar-web', progress: kept }] });
  assert.equal(az.prs[1]!.status, 'active');
});

test('on Azure Repos, a .lar-factory.json that lands another way finishes onboarding and abandons the active PR after a comment', async (t) => {
  const pr = `${REPO_URL}/pullrequest/7`;
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: { ...progress, step: 'pr', prUrl: pr } }]);
  const az = fakeAzRepos({ files: { '/.lar-factory.json': JSON.stringify(azureConfig) }, prs: [{ pullRequestId: 7, status: 'active', sourceRefName: 'refs/heads/x' }] });
  assert.deepEqual(await followOnboardingPrs(readRepositoryList(dir), dir, az.run, { failed: () => assert.fail() }), [{ repo: AZURE }]);
  assert.equal(az.prs[0]!.status, 'abandoned');
  assert.equal(az.comments.length, 1);
  assert.match(az.comments[0]!.content, /reached the default branch without this PR/);
});
