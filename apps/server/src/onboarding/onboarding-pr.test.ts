import { test, type TestContext } from 'vite-plus/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readRepositoryList, saveOnboarding, savePrClosed } from '../config/repository-config.ts';
import { createPrOpener, followOnboardingPrs, reopenOnboardingPr } from './onboarding-pr.ts';

const progress = { step: 'checks', done: ['project', 'setup'], answers: { projectId: 'lar-web' } };
const config = { itemSource: { kind: 'issues' }, show: 'opted-in', role: 'Web client' };
const PR = 'https://github.com/maddec01/lar-web/pull/14';

async function dataDir(t: TestContext, entries: object[] = []): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'lar onboarding pr test '));
  t.onTestFinished(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'repositories.json'), JSON.stringify({ repositories: entries }));
  return dir;
}

/**
 * A gh that records each call and answers it like GitHub, failing the calls `fails` names, by their first two args, with
 * its message. `branches` are the lar-factory/ branches the repository has, each with its open PR's URL or null.
 */
function gh(fails: Record<string, string> = {}, branches: Record<string, string | null> = {}) {
  const calls: string[][] = [];
  const run = async (args: string[]) => {
    calls.push(args);
    const failure = fails[args.slice(0, 2).join(' ')];
    if (failure) throw new Error(failure);
    if (args[1] === 'repos/maddec01/lar-web') return 'main\n';
    if (args[1] === 'repos/maddec01/lar-web/git/ref/heads/main') return 'abc123\n';
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

test('opening the PR makes lar-factory/onboarding from the default branch, adds .lar-factory.json, opens the PR and keeps its URL', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh();
  const opened = await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config });
  const kept = { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'lar-web' }, prUrl: PR };
  assert.deepEqual(opened, { prUrl: PR, onboarding: [{ repo: 'maddec01/lar-web', progress: kept }] });
  assert.deepEqual(readRepositoryList(dir), [{ repo: 'maddec01/lar-web', onboarding: kept }]);
  assert.deepEqual(calls.map((args) => args.slice(0, 2)), [
    ['api', 'repos/maddec01/lar-web'], ['api', 'repos/maddec01/lar-web/git/ref/heads/main'],
    ['api', 'repos/maddec01/lar-web/git/ref/heads/lar-factory/onboarding'], ['api', 'repos/maddec01/lar-web/git/refs'],
    ['api', 'repos/maddec01/lar-web/contents/.lar-factory.json'], ['pr', 'create'],
  ]);
  calls.splice(2, 1);
  assert.deepEqual(calls[2]!.slice(2), ['--method', 'POST', '-f', 'ref=refs/heads/lar-factory/onboarding', '-f', 'sha=abc123']);
  const content = calls[3]!.find((a) => a.startsWith('content='))!.slice('content='.length);
  assert.deepEqual(JSON.parse(Buffer.from(content, 'base64').toString()),
    { version: 1, role: 'Web client', itemSource: { kind: 'issues' }, show: 'opted-in', labels: [] });
  assert.ok(calls[3]!.includes('branch=lar-factory/onboarding'));
  const create = calls[4]!;
  assert.deepEqual([create[create.indexOf('--base') + 1], create[create.indexOf('--head') + 1]], ['main', 'lar-factory/onboarding']);
});

test('a taken lar-factory/onboarding with an open PR is reused, opening nothing', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const reused = 'https://github.com/maddec01/lar-web/pull/9';
  const { calls, run } = gh({}, { 'lar-factory/onboarding': reused });
  assert.equal((await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config }) as { prUrl: string }).prUrl, reused);
  assert.equal(readRepositoryList(dir)[0]!.onboarding?.prUrl, reused);
  assert.deepEqual(calls.slice(2).map((args) => args.slice(0, 2)), [['api', 'repos/maddec01/lar-web/git/ref/heads/lar-factory/onboarding'], ['pr', 'list']]);
  assert.deepEqual(calls[3]!.slice(2, 8), ['-R', 'maddec01/lar-web', '--head', 'lar-factory/onboarding', '--state', 'open']);
});

test('a taken branch with no open PR moves on to the first free lar-factory/onboarding-N', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const { calls, run } = gh({}, { 'lar-factory/onboarding': null, 'lar-factory/onboarding-2': null });
  assert.equal((await createPrOpener(dir, run)({ repo: 'maddec01/lar-web', progress, config }) as { prUrl: string }).prUrl, PR);
  const refs = calls.filter((args) => args[1]!.includes('/git/ref/heads/lar-factory/')).map((args) => args[1]!.split('heads/')[1]);
  assert.deepEqual(refs, ['lar-factory/onboarding', 'lar-factory/onboarding-2', 'lar-factory/onboarding-3']);
  assert.ok(calls.find((args) => args[1]!.endsWith('/git/refs'))!.includes('ref=refs/heads/lar-factory/onboarding-3'));
  assert.ok(calls.find((args) => args[1]!.endsWith('/contents/.lar-factory.json'))!.includes('branch=lar-factory/onboarding-3'));
  const create = calls.find((args) => args[1] === 'create')!;
  assert.equal(create[create.indexOf('--head') + 1], 'lar-factory/onboarding-3');
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

test('Retry with changed answers after the file went on the branch starts again, adding the new file on a new branch', async (t) => {
  const dir = await dataDir(t, [{ repo: 'maddec01/lar-web', onboarding: progress }]);
  const fails: Record<string, string> = { 'pr create': 'gh pr create failed: HTTP 502' };
  const { calls, run } = gh(fails);
  const open = createPrOpener(dir, run);
  await open({ repo: 'maddec01/lar-web', progress, config });
  delete fails['pr create'];
  calls.length = 0;
  assert.equal((await open({ repo: 'maddec01/lar-web', progress, config: { ...config, role: 'Web app' } }) as { prUrl: string }).prUrl, PR);
  const add = calls.find((args) => args[1]!.endsWith('/contents/.lar-factory.json'));
  const content = add!.find((a) => a.startsWith('content='))!.slice('content='.length);
  assert.equal(JSON.parse(Buffer.from(content, 'base64').toString()).role, 'Web app');
  assert.ok(calls.some((args) => args[1]!.endsWith('/git/refs')));
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
