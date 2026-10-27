import { test } from 'vite-plus/test';
import assert from 'node:assert/strict';
import type { ClashRun, ModelGroup } from '@lar-factory/shared';
import type { WaitedRun } from '../t3/t3.ts';
import { fakeAzRepos } from '../azure/fake-az.ts';
import { createClashRuns, defaultBranch, parseClashReply, type ClashRunDeps } from './clash-runs.ts';

const GROUPS: ModelGroup[] = [{ instanceId: 'claudeAgent', name: 'Claude', models: [{ slug: 'claude-opus-5-5', label: 'Claude Opus 5.5' }] }];
const MODEL = { instanceId: 'claudeAgent', model: 'claude-opus-5-5' };
const INPUT = { repo: 'maddec01/lar-web', projectId: 'project-web', model: MODEL };
const REPLY = JSON.stringify({ clashes: [{ file: 'AGENTS.md', line: 14, reason: 'Builders would push to main.',
  remove: ['- Small fixes can go straight to main.'], add: ['- Every change goes through a PR.'] }] });

/** AGENTS.md on origin/main, with REPLY's removed line at line 14. */
const AGENTS = `${Array.from({ length: 13 }, (_, i) => `- Rule ${i + 1}.`).join('\n')}\n- Small fixes can go straight to main.\n`;

/** Deps whose t3 waits until the test ends each run with `end`; `calls` lists what ran, in order. */
function stubs(overrides: Partial<ClashRunDeps> = {}) {
  const calls: string[] = [];
  const pending: ((run: WaitedRun) => void)[] = [];
  const messages: string[] = [];
  let ids = 0;
  const deps: ClashRunDeps = {
    defaultBranch: async (repo) => { calls.push(`branch ${repo}`); return 'main'; },
    projectFolder: (id) => (id === 'project-web' ? '/dev/lar-web' : null),
    fetch: async (folder, branch) => { calls.push(`fetch ${folder} ${branch}`); return null; },
    show: async (_folder, ref, path) => (ref === 'origin/main' && path === 'AGENTS.md' ? AGENTS : null),
    isLink: async () => false,
    start: (project, message, choice, title) => {
      calls.push(`start ${project} ${choice.model} ${title}`);
      messages.push(message);
      return new Promise((resolve) => pending.push(resolve));
    },
    thread: () => null,
    runId: () => `r${++ids}`,
    now: () => new Date('2026-10-27T09:00:00Z'),
    ...overrides,
  };
  const end = async (run: WaitedRun) => {
    await until(() => pending.length > 0);
    pending.shift()!(run);
    await new Promise((resolve) => setImmediate(resolve));
  };
  return { deps, calls, messages, end };
}

async function until(done: () => boolean): Promise<void> {
  for (let i = 0; i < 50 && !done(); i++) await new Promise((resolve) => setImmediate(resolve));
}

const runsOf = (answer: unknown) => (answer as { runs: ClashRun[] }).runs;

test('a run fetches the default branch in the T3 project\'s folder before it starts the thread with the model', async () => {
  const { deps, calls, messages, end } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  assert.deepEqual(runsOf(await runs.start(INPUT)), [{ state: 'running', progress: null, title: 'Look for Clashes in maddec01/lar-web (run r1)',
    threadId: null, model: MODEL, startedAt: '2026-10-27T09:00:00.000Z' }]);
  await end({ ended: 'completed', threadId: 'thread-1', reply: REPLY });
  assert.deepEqual(calls, ['branch maddec01/lar-web', 'fetch /dev/lar-web main',
    'start project-web claude-opus-5-5 Look for Clashes in maddec01/lar-web (run r1)']);
});

test('a run on an Azure repository fetches the default branch az names', async () => {
  const az = fakeAzRepos({ defaultBranch: 'develop' });
  const { deps, calls, end } = stubs({ defaultBranch: (repo) => defaultBranch(repo, az.run) });
  await createClashRuns(() => GROUPS, deps).start({ ...INPUT, repo: 'contoso/Fabrikam%20Fiber/lar-api' });
  await end({ ended: 'completed', threadId: 'thread-1', reply: REPLY });
  assert.equal(calls[0], 'fetch /dev/lar-web develop');
  assert.ok(az.calls.length > 0);
});

test("the message has the agent read every file from the fetched origin/<default>, not the working tree, and answer in the Clash JSON", async () => {
  const { deps, messages, end } = stubs();
  await createClashRuns(() => GROUPS, deps).start(INPUT);
  await end({ ended: 'completed', threadId: 'thread-1', reply: REPLY });
  const [message] = messages;
  assert.match(message!, /git ls-tree -r --name-only origin\/main/);
  assert.match(message!, /git show origin\/main:<path>/);
  assert.match(message!, /not the working tree/);
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md', '.cursor/rules/', '.pi/APPEND_SYSTEM.md', 'opencode.json']) {
    assert.ok(message!.includes(file), file);
  }
  assert.match(message!, /"clashes": \[\{ "file": .*"line": .*"reason": .*"remove": .*"add": /);
});

test('exit 0 with a reply that parses is done with its Clashes, each a ticked edit at its line', async () => {
  const { deps, end } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await end({ ended: 'completed', threadId: 'thread-1', reply: REPLY });
  const [run] = runs.list('maddec01/lar-web');
  assert.deepEqual([run?.state, run?.threadId, run?.state === 'done' && run.clashes], ['done', 'thread-1', [{
    id: 'agent-1', file: 'AGENTS.md', line: 14, reason: 'Builders would push to main.', ticked: true,
    edit: { kind: 'lines', remove: ['- Small fixes can go straight to main.'], add: ['- Every change goes through a PR.'] },
  }]]);
});

test("an agent Clash whose removed lines aren't at its line on the default branch, or that touches another's lines, is unticked with why", async () => {
  const claude = '# lar-web\n- Push to main.\n- Skip the tests.\n';
  const { deps, end } = stubs({ show: async (_folder, _ref, path) => ({ 'AGENTS.md': AGENTS, 'CLAUDE.md': claude } as Record<string, string>)[path] ?? null });
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  const found = (file: string, line: number, remove: string[]) => ({ file, line, reason: 'It clashes.', remove, add: [] });
  await end({ ended: 'completed', threadId: 'thread-1', reply: JSON.stringify({ clashes: [
    found('AGENTS.md', 14, ['- Small fixes can go straight to main.']),
    found('AGENTS.md', 3, ['- Push to main.']),
    found('CLAUDE.md', 2, ['- Push to main.', '- Skip the tests.']),
    found('CLAUDE.md', 3, ['- Skip the tests.']),
    found('GEMINI.md', 1, ['x']),
  ] }) });
  const [run] = runs.list('maddec01/lar-web');
  assert.deepEqual(run?.state === 'done' && run.clashes.map(({ ticked, wontApply }) => [ticked, wontApply]), [
    [true, undefined],
    [false, "Line 3 of AGENTS.md on the default branch doesn't have the lines this edit removes."],
    [false, 'It edits the same lines of CLAUDE.md as another Clash, so neither can go in the PR.'],
    [false, 'It edits the same lines of CLAUDE.md as another Clash, so neither can go in the PR.'],
    [false, "GEMINI.md isn't on the default branch, so there's nothing to edit."],
  ]);
});

test('an agent Clash in a file that is a link on the default branch is unticked with why, not with a line mismatch', async () => {
  const looked: string[] = [];
  const { deps, end } = stubs({ show: async (_folder, _ref, path) => path === 'CLAUDE.md' ? 'AGENTS.md' : path === 'AGENTS.md' ? AGENTS : null,
    isLink: async (_folder, ref, path) => { looked.push(path); return ref === 'origin/main' && path === 'CLAUDE.md'; } });
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await end({ ended: 'completed', threadId: 'thread-1', reply: JSON.stringify({ clashes: [
    { file: 'CLAUDE.md', line: 14, reason: 'It clashes.', remove: ['- Small fixes can go straight to main.'], add: [] },
    { file: 'CLAUDE.md', line: 1, reason: 'It clashes too.', remove: ['AGENTS.md'], add: [] },
  ] }) });
  const [run] = runs.list('maddec01/lar-web');
  assert.deepEqual(run?.state === 'done' && run.clashes.map(({ ticked, wontApply }) => [ticked, wontApply]), [
    [false, 'CLAUDE.md is a link, so this edit has no lines of its own to change.'],
    [false, 'CLAUDE.md is a link, so this edit has no lines of its own to change.'],
  ]);
  assert.deepEqual(looked, ['CLAUDE.md'], 'one git ls-tree per file, however many Clashes it has');
});

test("an agent Clash in a file the agent wasn't told to read is dropped, unless opencode.json names it", async () => {
  const { deps, end } = stubs({ show: async (_folder, _ref, path) => path === 'opencode.json' ? '{ "instructions": ["./docs/rules.md", "guides/*.md"] }'
    : path === 'AGENTS.md' ? AGENTS : path.endsWith('.md') ? 'x\n' : null });
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  const found = (file: string) => ({ file, line: 1, reason: 'It clashes.', remove: ['x'], add: ['y'] });
  await end({ ended: 'completed', threadId: 'thread-1', reply: JSON.stringify({ clashes: [
    found('.github/workflows/ci.yml'), found('docs/rules.md'), found('guides/style.md'), found('README.md'), found('../AGENTS.md'),
  ] }) });
  const [run] = runs.list('maddec01/lar-web');
  assert.deepEqual(run?.state === 'done' && run.clashes.map((clash) => clash.file), ['docs/rules.md', 'guides/style.md']);
});

test('exit 0 with a reply that does not parse is a failed run', async () => {
  const { deps, end } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await end({ ended: 'completed', threadId: 'thread-1', reply: 'I found a rule to push to main in AGENTS.md.' });
  assert.deepEqual(runs.list('maddec01/lar-web').map(({ state, threadId }) => [state, threadId]), [['failed', 'thread-1']]);
  assert.match((runs.list('maddec01/lar-web')[0] as { why: string }).why, /^The agent's reply isn't the JSON the board asked for/);
});

test('exit 1 is a failed run with why, and exit 2 a run waiting on the user that names the runtime mode', async () => {
  const { deps, end } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await end({ ended: 'failed', threadId: 'thread-1', why: 'The run ended failed: Rate limited.' });
  await runs.start(INPUT);
  await end({ ended: 'waiting', threadId: 'thread-2' });
  const [failed, waiting] = runs.list('maddec01/lar-web') as { state: string; threadId: string; why: string }[];
  assert.deepEqual([failed?.state, failed?.threadId, failed?.why], ['failed', 'thread-1', 'The run ended failed: Rate limited.']);
  assert.deepEqual([waiting?.state, waiting?.threadId], ['waiting', 'thread-2']);
  assert.match(waiting!.why, /waiting for an answer in T3 Code.*Answer it in the thread, or .*full access/);
  assert.match(waiting!.why, /Full access lets the agent run any command without asking while it reads this repository's files/);
});

test('a timeout is its own end, and finds the thread through its title', async () => {
  const { deps, end } = stubs({ thread: (project, title) => (project === 'project-web' && title.endsWith('(run r1)') ? { threadId: 'thread-1', latest: 'Reading' } : null) });
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await end({ ended: 'timed-out', threadId: null });
  const [run] = runs.list('maddec01/lar-web') as { state: string; threadId: string; why: string }[];
  assert.deepEqual([run?.state, run?.threadId], ['timed-out', 'thread-1']);
  assert.match(run!.why, /15 minutes/);
});

test("a running run shows its thread and the agent's latest message from T3's database", async () => {
  const { deps } = stubs({ thread: () => ({ threadId: 'thread-1', latest: 'Reading CLAUDE.md' }) });
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  assert.deepEqual(runs.list('maddec01/lar-web').map(({ state, threadId }) => [state, threadId]), [['running', 'thread-1']]);
  assert.equal((runs.list('maddec01/lar-web')[0] as { progress: string }).progress, 'Reading CLAUDE.md');
});

test('a second start while a run is going returns the running one and starts nothing', async () => {
  const { deps, calls } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  const again = runsOf(await runs.start({ ...INPUT, repo: 'MADDEC01/lar-web' }));
  assert.deepEqual(again.map((run) => run.title), ['Look for Clashes in maddec01/lar-web (run r1)']);
  await until(() => calls.length === 3);
  assert.equal(calls.filter((call) => call.startsWith('start')).length, 1);
});

test('Retry after a run ends starts a new thread and keeps the old one listed', async () => {
  const { deps, end } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await end({ ended: 'waiting', threadId: 'thread-1' });
  const retried = runsOf(await runs.start(INPUT));
  assert.deepEqual(retried.map(({ state, threadId }) => [state, threadId]), [['waiting', 'thread-1'], ['running', null]]);
  await end({ ended: 'completed', threadId: 'thread-2', reply: '{"clashes":[]}' });
  assert.deepEqual(runs.list('maddec01/lar-web').map(({ state, threadId }) => [state, threadId]), [['waiting', 'thread-1'], ['done', 'thread-2']]);
});

test("a repository keeps only its last five runs", async () => {
  const { deps, end } = stubs();
  const runs = createClashRuns(() => GROUPS, deps);
  for (let i = 1; i <= 6; i++) {
    await runs.start(INPUT);
    await end({ ended: 'waiting', threadId: `thread-${i}` });
  }
  assert.deepEqual(runs.list('maddec01/lar-web').map((run) => run.threadId), ['thread-2', 'thread-3', 'thread-4', 'thread-5', 'thread-6']);
});

test('a fetch that fails ends the run with why and starts no thread', async () => {
  const { deps, calls } = stubs({ fetch: async () => "fatal: couldn't find remote ref main" });
  const runs = createClashRuns(() => GROUPS, deps);
  await runs.start(INPUT);
  await until(() => runs.list('maddec01/lar-web')[0]?.state !== 'running');
  assert.deepEqual(runs.list('maddec01/lar-web').map((run) => [run.state, (run as { why: string }).why]),
    [['failed', "Can't fetch origin/main in /dev/lar-web: fatal: couldn't find remote ref main"]]);
  assert.equal(calls.filter((call) => call.startsWith('start')).length, 0);
});

test('a start needs the repository, its T3 project and an offered model', async () => {
  const runs = createClashRuns(() => GROUPS, stubs().deps);
  const refused = { status: 400, error: 'Send the repository, its T3 project and a model T3 offers.' };
  assert.deepEqual(await runs.start({ repo: 'maddec01/lar-web', projectId: 'project-web' }), refused);
  assert.deepEqual(await runs.start({ ...INPUT, model: { instanceId: 'codex', model: 'gpt-5' } }), refused);
  assert.deepEqual(await runs.start({ ...INPUT, projectId: 7 }), refused);
  assert.deepEqual(runs.list('maddec01/lar-web'), []);
});

test('a reply parses in a json code fence, and any Clash without its fields fails the reply', () => {
  assert.equal(parseClashReply('```json\n{"clashes":[]}\n```')?.length, 0);
  const clash = { file: 'CLAUDE.md', line: 3, reason: 'Tracks work in Linear.', remove: ['Track all work in Linear.'], add: [] };
  assert.equal(parseClashReply(JSON.stringify({ clashes: [clash] }))?.length, 1);
  for (const broken of [{ ...clash, line: 0 }, { ...clash, file: '' }, { ...clash, remove: [] }, { ...clash, add: 'x' }, { ...clash, reason: ' ' }]) {
    assert.equal(parseClashReply(JSON.stringify({ clashes: [broken] })), null, JSON.stringify(broken));
  }
  assert.equal(parseClashReply('[]'), null);
  for (const file of ['.github/workflows/ci.yml', 'README.md', '../CLAUDE.md', '/CLAUDE.md']) {
    assert.deepEqual(parseClashReply(JSON.stringify({ clashes: [{ ...clash, file }] })), [], file);
  }
  for (const file of ['packages/web/AGENTS.md', '.claude/rules/git.md', '.cursor/rules/a/b.mdc', '.pi/SYSTEM.md', 'opencode.json']) {
    assert.equal(parseClashReply(JSON.stringify({ clashes: [{ ...clash, file }] }))?.length, 1, file);
  }
});
