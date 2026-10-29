import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepositoryList, saveOnboarding, savePrClosed } from '../config/repository-config.ts';
import { WORKFLOW_LABELS, type OnboardingPrChange } from '@lar-factory/shared';
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
  const run = async (args: string[], input?: string) => {
    if (input !== undefined) inputs.set(args, input);
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
  assert.deepEqual(await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress: { ...progress, step: 'pr' }, config, picks: { clashes: [pushRule], skills: {} } }),
    { status: 409, error: 'The text at line 3 in AGENTS.md has changed. Uncheck this change in Cleanup or check instructions again.' });
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
  const preview = await previewOnboardingPr({ repo: 'maddec01/lar-web', config, picks: { clashes: [pushRule], skills: {} } }, run);
  assert.ok('changes' in preview);
  assert.deepEqual(preview.changes.map(({ preview, ...change }) => change), [
    { kind: 'agent-skills', path: 'AGENTS.md' }, { kind: 'write', path: 'docs/agents/issue-tracker.md', created: true },
    { kind: 'write', path: 'docs/agents/triage-labels.md', created: true }, { kind: 'write', path: 'docs/agents/domain.md', created: true },
    { kind: 'write', path: '.lar-factory.json', created: true }, { kind: 'edit', path: 'AGENTS.md', line: 3, reason: pushRule.reason },
  ]);
  assert.deepEqual(writes(calls), []);
  assert.deepEqual(await previewOnboardingPr({ repo: 'maddec01/lar-web', config, picks }, gh({ 'repos/maddec01/lar-web': 'gh api failed: HTTP 502' }).run),
    { status: 502, error: "Can't read maddec01/lar-web's default branch: gh api failed: HTTP 502" });
});

test('a repository that lacks a workflow label, or has one under its old name, gets no PR', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  for (const labels of [ALL.filter((n) => n !== 'blocked'), [...ALL.filter((n) => n !== 'decision-task'), 'decision: task']]) {
    const { calls, run } = gh({}, {}, undefined, labels);
    assert.deepEqual(await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config, picks }),
      { status: 409, error: 'maddec01/lar-web is missing a required label. Go back to Labels to create or rename it.' });
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
  const run = async (args: string[], input?: string) => {
    if (input !== undefined) inputs.set(args, input);
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

test('onboarding finishes when its PR merges between the state read and closing it', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } }]);
  const states = { [PR]: 'OPEN' };
  const gh = github(states, { 'maddec01/lar-web': { role: 'Web client' } });
  const run = gh.run;
  gh.run = async (args) => {
    if (args[1] === 'close') {
      states[PR] = 'MERGED';
      throw new Error("can't be closed because it was already merged");
    }
    return run(args);
  };
  const finished: string[] = [];
  assert.deepEqual(await follow(dir, gh, undefined, (repo) => finished.push(repo)), [{ repo: 'maddec01/lar-web' }]);
  assert.deepEqual(finished, ['maddec01/lar-web']);
});

test('a PR closed before merging is marked closed, and the mark goes once it is open again; a file that lands then still finishes', async (t) => {
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

test('Reopen pull request runs gh pr reopen on the onboarding\'s PR and drops its closed mark', async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: { ...kept, prClosed: true } }]);
  const gh = github({});
  assert.deepEqual(await reopenOnboardingPr({ repo: 'maddec01/lar-web' }, dir, gh.run), { onboarding: [{ repo: 'maddec01/lar-web', progress: kept }] });
  assert.deepEqual(gh.changed, [['pr', 'reopen', PR]]);
});

test('Reopen pull request that gh refuses answers with gh\'s message and keeps the mark; one with no PR or repository is refused', async (t) => {
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

test('Reset of an onboarding whose PR closed before merging, or that has no PR yet, only drops its entry', async (t) => {
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
const azureConfig = { itemSource: { kind: 'azure-board', team: 'Fabrikam Team' }, show: 'all', role: 'API' };

test('on Azure Repos, a completed PR finishes onboarding, an abandoned one is marked closed and reactivated by Reopen pull request', async (t) => {
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

test('Azure onboarding previews and commits provider-specific agent setup from the repository provider', async (t) => {
  const az = fakeAzRepos({ files: { '/AGENTS.md': RULES } });
  // The provider comes from the repository, even when the answers still name GitHub issues.
  const preview = await previewOnboardingPr({ repo: AZURE, config, picks }, az.run);
  assert.ok('changes' in preview);
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: progress }]);
  await createPrOpener(dir, az.run)({ repo: AZURE, progress, config, picks });
  const content = (path: string) => az.pushes[0]!.changes.find((change) => change.path === path)!.content!;
  const tracker = content('/docs/agents/issue-tracker.md');
  assert.match(tracker, /Azure Boards work items/);
  assert.ok(tracker.includes('az boards work-item show --id "$id" --expand all --organization "$org"'));
  assert.ok(tracker.includes(String.raw`id=$(az boards work-item create --type "<requirement type>" --title "<title>" \
  --project "$project" --organization "$org" --query id -o tsv)`));
  assert.match(content('/docs/agents/triage-labels.md'), /System.Tags/);
  assert.match(content('/AGENTS.md'), /Azure Boards work items/);
  for (const path of ['/AGENTS.md', '/docs/agents/issue-tracker.md', '/docs/agents/triage-labels.md', '/docs/agents/domain.md']) {
    assert.doesNotMatch(content(path), /GitHub|\bgh |[\u2013\u2014\u2018\u2019\u201c\u201d]/);
    assert.equal(preview.changes.find((change) => `/${change.path}` === path)?.preview?.after, content(path));
  }
  assert.ok(az.calls.some((args) => args.includes('blobs')), 'the preview reads AGENTS.md');
  assert.ok(az.calls.filter((args) => args[1] === 'invoke').every((args) => args.includes('--api-version')));
  const body = az.calls.flat().find((arg) => arg.startsWith('--description='))!;
  assert.match(body, /Onboarding replaces the agent guides/);
  assert.match(body, /The board shows current and proposed contents before you open this PR/);
});

test('the preview shows current and proposed agent setup contents before opening a PR', async () => {
  const oldTracker = '# Azure work items\n\nKeep our team query.\n';
  const oldTags = '# Tags\n\nKeep our team tags.\n';
  const oldDomain = '# Domain\n\nUse the billing glossary.\n';
  const az = fakeAzRepos({ files: {
    '/AGENTS.md': RULES, '/docs/agents/issue-tracker.md': oldTracker,
    '/docs/agents/triage-labels.md': oldTags, '/docs/agents/domain.md': oldDomain,
  } });
  const result = await previewOnboardingPr({ repo: AZURE, config: { ...azureConfig, labels: [] }, picks }, az.run);
  assert.ok('changes' in result);
  for (const [path, before] of [['AGENTS.md', RULES], ['docs/agents/issue-tracker.md', oldTracker],
    ['docs/agents/triage-labels.md', oldTags], ['docs/agents/domain.md', oldDomain], ['.lar-factory.json', null]]) {
    const change: OnboardingPrChange | undefined = result.changes.find((candidate) => candidate.path === path);
    assert.ok(change && (change.kind === 'write' || change.kind === 'agent-skills'));
    assert.ok('preview' in change && change.preview, `${path} has a content preview`);
    assert.equal(change.preview.before, before);
    assert.ok(change.preview.after.length > 0);
  }
  assert.equal(az.pushes.length, 0);
  assert.equal(az.prs.length, 0);
});

test('on Azure Repos, the PR opener checks no workflow label', async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: progress }]);
  const az = fakeAzRepos();
  const opened = await createPrOpener(dir, az.run)({ repo: AZURE, progress, config: { ...azureConfig, labels: [] }, picks });
  assert.doesNotMatch((opened as { error?: string }).error ?? '', /still lacks a workflow label/);
  assert.ok(az.calls.length > 0 && !az.calls.some((args) => args[0] === 'label'), 'it goes on past the check, listing no label');
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

const AZURE_PR = `${REPO_URL}/pullrequest/100`;
const azFiles = { '/AGENTS.md': RULES, '/CONTEXT.md': '# Terms\n', '/.scratch/todo.md': 'x',
  '/.claude/skills/code-review/SKILL.md': '---\nname: code-review\n---\n', '/.claude/skills/code-review/notes.md': 'Notes\n' };
const azPicks = { skills: { '.claude/skills/code-review/': { kind: 'rename', name: 'api-review' } }, clashes: [pushRule,
  { id: 'context', file: 'CONTEXT.md', ticked: true, reason: 'Old name.', edit: { kind: 'rename', to: 'GLOSSARY.md' } },
  { id: 'scratch', file: '.scratch/', ticked: true, reason: 'Local tracker.', edit: { kind: 'delete' } }] };

test('on Azure Repos, one push makes the commit with every change on lar-factory/onboarding, then az opens the PR, with no gh call', async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: progress }]);
  const az = fakeAzRepos({ files: azFiles });
  const opened = await createPrOpener(dir, az.run)({ repo: AZURE, progress, config, picks: azPicks });
  assert.equal((opened as { prUrl: string }).prUrl, AZURE_PR);
  assert.equal(readRepositoryList(dir)[0]!.onboarding?.prUrl, AZURE_PR);
  assert.equal(az.pushes.length, 1);
  const [push] = az.pushes;
  assert.deepEqual([push!.ref, push!.oldObjectId, push!.parents, push!.comment],
    ['refs/heads/lar-factory/onboarding', '0'.repeat(40), ['abc123'], 'chore: onboard to lar Factory']);
  const change = (path: string) => push!.changes.find((c) => c.path === path);
  assert.deepEqual(['/.scratch/todo.md', '/CONTEXT.md', '/.claude/skills/code-review/SKILL.md', '/.claude/skills/code-review/notes.md'].map(change),
    ['/.scratch/todo.md', '/CONTEXT.md', '/.claude/skills/code-review/SKILL.md', '/.claude/skills/code-review/notes.md'].map((path) => ({ changeType: 'delete', path })));
  assert.deepEqual(change('/GLOSSARY.md'), { changeType: 'add', path: '/GLOSSARY.md', content: '# Terms\n' });
  assert.deepEqual(change('/.claude/skills/api-review/notes.md'), { changeType: 'add', path: '/.claude/skills/api-review/notes.md', content: 'Notes\n' });
  assert.equal(change('/.claude/skills/api-review/SKILL.md')?.content, '---\nname: api-review\n---\n');
  assert.equal(change('/AGENTS.md')?.changeType, 'edit');
  assert.match(change('/AGENTS.md')!.content!, /^# lar-web\n\n- Open a PR when done.\n\n## Agent skills/);
  assert.equal(change('/.lar-factory.json')?.changeType, 'add');
  assert.equal(az.heads.get('lar-factory/onboarding'), 'pushed1');
  const create = az.calls.find((args) => args.slice(0, 3).join(' ') === 'repos pr create')!;
  assert.deepEqual([create[create.indexOf('--source-branch') + 1], create[create.indexOf('--target-branch') + 1]], ['lar-factory/onboarding', 'main']);
  // The title and description go joined to their flags, so one starting with - is no option.
  assert.ok(create.includes('--title=chore: onboard to lar Factory') && !create.includes('--title'), create.join(' '));
  assert.ok(create.find((arg) => arg.startsWith('--description='))!.includes('- Renames `CONTEXT.md` to `GLOSSARY.md`.'));
  assert.ok(az.calls.every((args) => args[0] === 'devops' || args[0] === 'repos'), 'every call is az devops or az repos');
  assert.ok(az.calls.filter((args) => args[1] === 'invoke').every((args) => args.includes('--api-version')));
});

test('on Azure Repos, a taken lar-factory/onboarding with an active PR is pushed to a commit on the default branch\'s head and the PR gets the new description', async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: progress }]);
  const az = fakeAzRepos({ files: { '/AGENTS.md': RULES }, branches: { 'lar-factory/onboarding': 'old789' },
    prs: [{ pullRequestId: 7, status: 'active', sourceRefName: 'refs/heads/lar-factory/onboarding', description: 'This PR:\n\n- Old.' }] });
  const opened = await createPrOpener(dir, az.run)({ repo: AZURE, progress, config, picks });
  assert.equal((opened as { prUrl: string }).prUrl, `${REPO_URL}/pullrequest/7`);
  assert.deepEqual(az.pushes.map((p) => [p.ref, p.oldObjectId, p.parents]), [['refs/heads/lar-factory/onboarding', 'old789', ['abc123']]]);
  assert.match(az.prs[0]!.description!, /^This PR:\n\n- Writes lar Factory's/);
  assert.equal(az.prs.length, 1, 'it opens no PR');
});

test("on Azure Repos, a failed push answers with az's message, and Retry goes on from the call that failed", async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: progress }]);
  for (const [failing, retried] of [['pushes', ['repos ref list', 'repos ref list', 'invoke git/commits', 'invoke git/trees', 'invoke git/pushes', 'repos pr create']],
    ['repos pr create', ['repos pr create']]] as const) {
    let fails = true;
    const message = `az ${failing} failed: TF401027: You need the Git 'GenericContribute' permission.`;
    const az = fakeAzRepos({ files: { '/AGENTS.md': RULES }, fail: (args) => (fails && args.join(' ').includes(failing) ? new Error(message) : undefined) });
    const open = createPrOpener(dir, az.run);
    assert.deepEqual(await open({ repo: AZURE, progress, config, picks }), { status: 502, error: `Can't open ${AZURE}'s onboarding PR: ${message}` });
    assert.deepEqual(readRepositoryList(dir), [{ repo: AZURE, onboarding: progress }]);
    fails = false;
    az.calls.length = 0;
    assert.equal((await open({ repo: AZURE, progress, config, picks }) as { prUrl: string }).prUrl, AZURE_PR);
    assert.deepEqual(az.calls.map((args) => (args[0] === 'devops' ? `invoke ${args[args.indexOf('--area') + 1]}/${args[args.indexOf('--resource') + 1]}` : args.slice(0, 3).join(' '))), retried);
    assert.equal(az.pushes.length, 1);
    await writeFile(join(dir, 'repositories.json'), JSON.stringify({ repositories: [{ repo: AZURE, onboarding: progress }] }));
  }
});

const AZURE_EDIT = `${REPO_URL}/pullrequest/7`;
const RESET_PUSH = { ref: 'refs/heads/lar-factory/reset', parents: ['abc123'], paths: [['delete', '/.lar-factory.json']] };
const pushed = (az: ReturnType<typeof fakeAzRepos>) => az.pushes.map(({ ref, parents, changes }) => ({ ref, parents, paths: changes.map((c) => [c.changeType, c.path]) }));

test("on Azure Repos, Reset abandons the open Edit PR after a comment, pushes the reset commit and opens its PR set to complete work items, with no gh call", async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE }]);
  const az = fakeAzRepos({ files: { '/.lar-factory.json': '{}' }, branches: { 'lar-factory/edit-config': 'old789' },
    prs: [{ pullRequestId: 7, status: 'active', sourceRefName: 'refs/heads/lar-factory/edit-config' }] });
  const resetPr = `${REPO_URL}/pullrequest/101`;
  assert.deepEqual(await resetRepository({ repo: AZURE }, dir, az.run), { onboarding: [], prUrl: resetPr });
  assert.equal(az.prs[0]!.status, 'abandoned');
  assert.match(az.comments[0]!.content, /closed this Edit PR/);
  assert.deepEqual(pushed(az), [RESET_PUSH]);
  const create = az.calls.find((args) => args.slice(0, 3).join(' ') === 'repos pr create')!;
  assert.equal(create[create.indexOf('--transition-work-items') + 1], 'true');
  assert.deepEqual(readRepositoryList(dir), [{ repo: AZURE, resetting: { prUrl: resetPr } }]);
});

test('on Azure Repos, Reset of a repository still onboarding abandons its active PR and drops it, and keeps one whose PR completed', async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE, onboarding: { ...progress, step: 'pr', prUrl: AZURE_EDIT } }]);
  const az = fakeAzRepos({ prs: [{ pullRequestId: 7, status: 'active', sourceRefName: 'refs/heads/lar-factory/onboarding' }] });
  assert.deepEqual(await resetRepository({ repo: AZURE }, dir, az.run), { onboarding: [] });
  assert.equal(az.prs[0]!.status, 'abandoned');
  assert.deepEqual(readRepositoryList(dir), []);
  const merged = await dataDir(t, [{ repo: AZURE, onboarding: { ...progress, step: 'pr', prUrl: AZURE_EDIT } }]);
  const completed = fakeAzRepos({ prs: [{ pullRequestId: 7, status: 'completed', sourceRefName: 'refs/heads/lar-factory/onboarding' }] });
  assert.equal((await resetRepository({ repo: AZURE }, merged, completed.run) as { status: number }).status, 409);
});

test("on Azure Repos, a refused az call keeps the entry with az's message", async (t) => {
  const dir = await dataDir(t, [{ repo: AZURE }]);
  const az = fakeAzRepos({ files: { '/.lar-factory.json': '{}' },
    fail: (args) => (args.join(' ').includes('--resource pushes') ? new Error('TF401027: You need the Git Contribute permission.') : undefined) });
  assert.deepEqual(await resetRepository({ repo: AZURE }, dir, az.run),
    { status: 502, error: `Can't open ${AZURE}'s reset PR: TF401027: You need the Git Contribute permission.` });
  assert.deepEqual(readRepositoryList(dir), [{ repo: AZURE }]);
});

test('on Azure Repos, each refresh drops a resetting entry whose reset PR completed or was abandoned, and keeps an active one', async (t) => {
  const web = 'contoso/Fabrikam%20Fiber/lar-web';
  const dir = await dataDir(t, [{ repo: AZURE, resetting: { prUrl: `${REPO_URL}/pullrequest/7` } }, { repo: web, resetting: { prUrl: `${REPO_URL}/pullrequest/8` } }]);
  const az = fakeAzRepos({ prs: [{ pullRequestId: 7, status: 'completed', sourceRefName: 'refs/heads/lar-factory/reset' },
    { pullRequestId: 8, status: 'active', sourceRefName: 'refs/heads/lar-factory/reset' }] });
  const dropped: string[] = [];
  assert.deepEqual(await followResetPrs(readRepositoryList(dir), dir, az.run, { failed: () => assert.fail(), dropped: (repo) => dropped.push(repo) }),
    [{ repo: web, resetting: { prUrl: `${REPO_URL}/pullrequest/8` } }]);
  assert.deepEqual(dropped, [AZURE]);
});

test('onboarding replaces an unusable settings file for a repository already on the local list', async (t) => {
  const repo = 'maddec01/lar-web';
  const dir = await dataDir(t, [{ repo }]);
  const old = '{"role":"API","itemSource":{"kind":"github-project","owner":"maddec01","number":3}}';
  const boundary = gh({}, {}, { 'AGENTS.md': RULES, '.lar-factory.json': old });
  const answer = await createPrOpener(dir, boundary.run)({ repo, progress, config, picks: { clashes: [], skills: {} } });
  assert.ok('prUrl' in answer, JSON.stringify(answer));
  const preview = await previewOnboardingPr({ repo, config, picks: { clashes: [], skills: {} } }, boundary.run);
  assert.ok('changes' in preview);
  const replacement = preview.changes.find((change) => change.path === '.lar-factory.json');
  assert.equal(replacement?.kind, 'write');
  assert.equal(replacement?.preview?.before, old);
  assert.match(replacement?.preview?.after ?? '', /"kind": "issues"/);
});
