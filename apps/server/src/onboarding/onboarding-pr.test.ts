import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepositoryList } from '../config/repository-config.ts';
import { createPrOpener, finishMergedOnboardings } from './onboarding-pr.ts';

const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client' };
const PR = 'https://github.com/maddec01/lar-web/pull/14';

async function dataDir(t: TestContext, entries: object[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar onboarding pr test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'repositories.json'), JSON.stringify({ repositories: entries }));
  return dir;
}

/** A gh that records each call and answers it like GitHub, failing the calls `fails` names, by their first two args, with its message. */
function gh(fails: Record<string, string> = {}) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const failure = fails[args.slice(0, 2).join(' ')];
    if (failure) throw new Error(failure);
    if (args[1] === 'repos/maddec01/lar-web') return 'main\n';
    if (args[1] === 'repos/maddec01/lar-web/git/ref/heads/main') return 'abc123\n';
    if (args[0] === 'pr' && args[1] === 'create') return `${PR}\n`;
    return '{}';
  };
  return { calls, run };
}

test('opening the PR makes lar-factory/onboarding from the default branch, adds .lar-factory.json, opens the PR and keeps its URL', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh();
  const opened = await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config });
  const kept = { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web' }, prUrl: PR };
  assert.deepEqual(opened, { prUrl: PR, onboarding: [{ repo: 'maddec01/lar-web', progress: kept }] });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [
    ['api', 'repos/maddec01/lar-web'], ['api', 'repos/maddec01/lar-web/git/ref/heads/main'], ['api', 'repos/maddec01/lar-web/git/refs'],
    ['api', 'repos/maddec01/lar-web/contents/.lar-factory.json'], ['pr', 'create'],
  ]);
  assert.deepEqual(calls[2]!.slice(2), ['--method', 'POST', '-f', 'ref=refs/heads/lar-factory/onboarding', '-f', 'sha=abc123']);
  const content = calls[3]!.find((a) => a.startsWith('content='))!.slice('content='.length);
  assert.deepEqual(JSON.parse(Buffer.from(content, 'base64').toString()),
    { version: 1, role: 'Web client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: [] });
  assert.ok(calls[3]!.includes('branch=lar-factory/onboarding'));
  const create = calls[4]!;
  assert.deepEqual([create[create.indexOf('--base') + 1], create[create.indexOf('--head') + 1]], ['main', 'lar-factory/onboarding']);
});

test('a run never kept is kept with its PR, in place of the one it was kept under before', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-apple', onboarding: progress }]);
  await createPrOpener(dir, gh().run)({ repo: 'maddec01/lar-web', progress, config, replaces: 'maddec01/lar-apple' });
  assert.deepEqual(readRepositoryList(dir).map((e) => [e.repo, e.onboarding?.prUrl]), [['maddec01/lar-web', PR]]);
});

test("a failing gh call answers with gh's message and keeps no PR; Retry goes on from the call that failed", async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const fails: Record<string, string> = { 'pr create': 'gh pr create failed: GraphQL: No commits between main and lar-factory/onboarding' };
  const { calls, run } = gh(fails);
  const open = createPrOpener(dir, run);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config }), { status: 502,
    error: "Can't open maddec01/lar-web's onboarding PR: gh pr create failed: GraphQL: No commits between main and lar-factory/onboarding" });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  delete fails['pr create'];
  calls.length = 0;
  assert.equal((await open({ repo: 'maddec01/lar-web', progress, config }) as { prUrl: string }).prUrl, PR);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [['pr', 'create']]);
});

test('a body without the repository, its progress and a whole Repository config is refused', async (t) => {
  const dir = await dataDir(t);
  const open = createPrOpener(dir, gh().run);
  const refused = { status: 400, error: "Send the repository, where its onboarding stopped and its .lar-factory.json's values." };
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config: { ...config, role: ' ' } }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', progress, config: { ...config, show: 'some' } }), refused);
  assert.deepEqual(await open({ repo: 'lar-web', progress, config }), refused);
  assert.deepEqual(await open({ repo: 'maddec01/lar-web', config }), refused);
});

/** A gh that answers each PR's state from `states`, by URL, and fails for a URL it doesn't have. */
const states = (byUrl: Record<string, string>) => async (args: string[]) => {
  const state = byUrl[args[2]!];
  if (!state) throw new Error('gh pr view failed: HTTP 502');
  return `${state}\n`;
};

test('an onboarding whose PR merged is finished; one whose PR is open, or that has none, stays onboarding', async (t) => {
  const open = { ...progress, step: 'pr', prUrl: 'https://github.com/maddec01/lar-cli/pull/3' };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web', onboarding: { ...progress, step: 'pr', prUrl: PR } },
    { repo: 'maddec01/lar-cli', onboarding: open }, { repo: 'maddec01/lar-docs', onboarding: progress }]);
  const list = await finishMergedOnboardings(readRepositoryList(dir), dir, states({ [PR]: 'MERGED', [open.prUrl]: 'OPEN' }), () => assert.fail());
  const expected = [{ repo: 'maddec01/lar-factory' }, { repo: 'maddec01/lar-web' }, { repo: 'maddec01/lar-cli', onboarding: open },
    { repo: 'maddec01/lar-docs', onboarding: progress }];
  assert.deepEqual(list, expected);
  assert.deepEqual(readRepositoryList(dir), expected);
});

test("a PR whose state can't be read leaves its onboarding as it is and reports why", async (t) => {
  const kept = { ...progress, step: 'pr', prUrl: PR };
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  const problems: string[] = [];
  const list = await finishMergedOnboardings(readRepositoryList(dir), dir, states({}), (repo, problem) => problems.push(`${repo}: ${problem}`));
  assert.deepEqual(list, [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(problems, ['maddec01/lar-web: gh pr view failed: HTTP 502']);
});
