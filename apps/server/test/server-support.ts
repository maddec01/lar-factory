import { execFile, spawn } from 'node:child_process';
import { createServer, type Socket } from 'node:net';
import { existsSync, mkdirSync, mkdtempSync, rmSync, watch, writeFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import { promisify } from 'node:util';
import type { TestContext } from 'vite-plus/test';
import { DONE_WINDOW_MS, REPOSITORY_OPERATIONS, isSkillCheckRequest, normalizeItems, readBuilds, refKey, workMessage } from '@lar-factory/shared';
import type { BoardData, DriftChoice, Item, RawItem, SkillCheckAnswer, SkillCheckOutcome } from '@lar-factory/shared';
import { boardDataDir, DATA_DIR_ENV } from '@lar-factory/shared/data-dir';
import { openWorkRecords, workRecordsPath, type WorkRecords } from '@lar-factory/work-records';
import { checkouts, testEnv } from './repo-support.ts';
import { projectsDb } from './stats-db.ts';

/** The `repo#number` keys of the builds among sub-issues, and of the open slices whose records are active or blocked. */
type SliceSearches = { builds?: ReadonlySet<string>; active?: ReadonlySet<string>; blocked?: ReadonlySet<string> };

/** The calls the fakes logged, skipping a last line a running fake has not finished writing. */
async function readCalls(file: string): Promise<string[][]> {
  const lines = (await readFile(file, 'utf8')).split('\n');
  return lines.slice(0, -1).filter(Boolean).map((l) => JSON.parse(l) as string[]);
}

/** The board data sample mode serves. */
export const SAMPLE_DATA = fileURLToPath(import.meta.resolve('@lar-factory/shared/test/sample.json'));

/** Sample mode's T3 settings and model list, so the Start menu can be tried without T3. */
export const SAMPLE_MODELS = {
  T3_SETTINGS: new URL('./t3-settings.sample.json', import.meta.url).pathname,
  T3_MODEL_MANIFEST: new URL('./model-manifest.sample.json', import.meta.url).pathname,
};

export async function freePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return address.port;
}

/** The repositories a test board has onboarded unless its options name others. */
const TEST_REPOSITORIES = ['maddec01/lar-server', 'maddec01/lar-apple', 'maddec01/lar-factory'];

/** Writes the board app's list of onboarded repositories under `home`. */
export function writeRepositoryList(home: string, repos: readonly string[], setups: Record<string, unknown> = {}): void {
  const dir = join(home, 'Library/Application Support/Lar Factory');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'repository-settings.json'), JSON.stringify({ repositories: repos.map((repo) => ({ repo, settings: { structureSync: false, access: Object.fromEntries(REPOSITORY_OPERATIONS.map(operation => [operation, 'allowed'])), overrides: typeof setups[repo] === 'object' && setups[repo] !== null ? setups[repo] : {} } })) }));
}

/**
 * Records the work each issue the board used to show is, with the T3 thread IDs `threads` holds by `owner/name#number`: its title, its labels' kind and Status, or Done once closed
 * as done, its ticket, its parent and a build's slices. An issue done before the board's week of Done, a slice and an issue
 * closed as not planned are no work of their own. Returns each issue's work ID by its `owner/name#number`.
 */
async function recordIssues(home: string, raws: readonly RawItem[], searched: SliceSearches = {},
  threads: Record<string, string[]> = {}): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (!raws.length) return ids;
  const records = await openWorkRecords(workRecordsPath(boardDataDir(home, {})));
  try {
    const recent = (item: Item) => item.status !== 'Done' || Date.now() - Date.parse(item.closedAt ?? item.updatedAt) <= DONE_WINDOW_MS;
    const items = normalizeItems([...raws], { builds: new Set([...readBuilds([...raws]), ...searched.builds ?? []]) }).filter(recent);
    for (const item of items) {
      const ticket = `${item.repo}#${item.number}`;
      ids.set(ticket, records.importTicket({ title: item.title, repository: item.repo, kind: item.kind, status: item.status, ticket }).record.workId);
    }
    // A sub-issue whose kinds a work record allows, such as a concept's build, keeps its parent; other structure stays on GitHub.
    for (const item of items) {
      const parent = item.parent && ids.get(`${item.parent.repo}#${item.parent.number}`);
      const workId = ids.get(`${item.repo}#${item.number}`)!;
      if (parent) try { records.setParent(workId, records.read(workId).revision, parent); } catch { /* a parent of another kind */ }
      if (item.kind !== 'build') continue;
      for (const slice of item.slices) {
        const key = refKey(slice.repo, slice.number);
        const open = slice.progress !== 'done';
        const status = !open ? 'Done' : searched.active?.has(key) ? 'In progress' : 'List';
        let made = records.importTicket({ title: slice.title, repository: slice.repo, kind: 'slice', status, ticket: `${slice.repo}#${slice.number}` }).record;
        made = records.setParent(made.workId, made.revision, workId);
        if (open && searched.blocked?.has(key)) records.setNeedsYou(made.workId, made.revision, 'The implementer could not finish it.');
      }
    }
    for (const [ticket, threadIds] of Object.entries(threads)) {
      const workId = ids.get(ticket)!;
      for (const id of threadIds) records.addThread(workId, records.read(workId).revision, id, 'shape');
    }
  } finally { records.close(); }
  return ids;
}

/** The lar-work command threads run. */
export const LAR_WORK = join(dirname(fileURLToPath(import.meta.resolve('@lar-factory/work-records'))), 'cli.ts');

/** Runs lar-work on the database in `dataDir` as a thread does, and returns the record it printed. */
export async function larWork(dataDir: string, ...args: string[]): Promise<{ workId: string; revision: number }> {
  const { stdout } = await promisify(execFile)(process.execPath, ['--disable-warning=ExperimentalWarning', LAR_WORK, ...args, '--data-dir', dataDir]);
  const printed = JSON.parse(stdout) as { workId: string; revision: number } | { record: { workId: string; revision: number } };
  return 'record' in printed ? printed.record : printed;
}

/** A repository no test board onboards, so the decisions blocking its work stay off the board. */
const OFF_BOARD = 'maddec01/lar-docs';

/** Runs `change` on the board's work records, then waits until the board shows `item` as `shown` says. */
export async function changeRecords(board: Board, change: (records: WorkRecords) => void, item: string, shown: (item: Item) => boolean): Promise<BoardData> {
  const records = await openWorkRecords(workRecordsPath(board.dataDir));
  try { change(records); } finally { records.close(); }
  return until(board, (d) => { const found = d.items.find((i) => i.id === item); return !!found && shown(found); });
}

/**
 * Records that the board's work `workId` waits on a new decision for each of `titles`, in a repository off the
 * board, and waits until the board shows them; returns their work IDs, for settleDecisions.
 */
export async function recordBlockers(board: Board, workId: string, titles: string[]): Promise<string[]> {
  const ids: string[] = [];
  await changeRecords(board, (records) => {
    for (const title of titles) {
      const decision = records.create({ title, repository: OFF_BOARD, kind: 'decision', status: 'Shaping' });
      records.addBlocker(workId, records.read(workId).revision, decision.workId);
      ids.push(decision.workId);
    }
  }, workId, (item) => ids.every((id) => item.blockers.some((b) => b.workId === id)));
  return ids;
}

/** Completes each decision from local facts, its confirmed answer and domain drafts, and waits until `workId` shows them complete. */
export async function settleDecisions(board: Board, workId: string, decisions: string[]): Promise<BoardData> {
  return changeRecords(board, (records) => {
    for (const decision of decisions) {
      records.setBody(decision, records.read(decision).revision, 'answer', 'Settled.');
      records.setBody(decision, records.read(decision).revision, 'domain-drafts', 'None.');
    }
  }, workId, (item) => decisions.every((id) => item.blockers.some((b) => b.workId === id && b.state === 'closed')));
}

/**
 * Lists TEST_REPOSITORIES under `home` with `repo` still onboarding, its PR open. Its default branch has no
 * .lar-factory.json yet, as NOT_LANDED tells the fake gh, or the board finishes the onboarding with the file.
 */
export const NOT_LANDED = { localSetups: { 'maddec01/lar-factory': null } };

export function writeOnboarding(home: string, repo: string): void {
  const progress = { step: 'pr', done: ['project', 'setup', 'checks'], answers: { projectId: 'project-factory' } };
  writeRepositoryList(home, TEST_REPOSITORIES);
  const file = join(home, 'Library/Application Support/Lar Factory/repository-settings.json');
  writeFileSync(file, JSON.stringify({ repositories: TEST_REPOSITORIES.map((r) => (r === repo ? { repo: r, onboarding: progress } : { repo: r })) }));
}

/**
 * Starts a board on the fake gh, whose state `options` holds. Its home lists TEST_REPOSITORIES as onboarded, or
 * `options.repositories` (null for no list file), unless the home already has a list. `skillCheck`, when given, plays
 * the board app: the board gets an IPC channel, and each skill check it asks for gets `skillCheck`'s answer to its
 * Drift choice, a refusal or null standing for an outcome without Drift.
 */
export async function startBoard(t: TestContext, options = {}, fixture = false, fastRefresh = false, env: Record<string, string> = {}, directory?: string,
  skillCheck?: (drift?: DriftChoice) => string | null | SkillCheckOutcome) {
  const dir = await mkdtemp(join(tmpdir(), 'lar-board-test-'));
  const stateFile = join(dir, 'github.json');
  await writeFile(stateFile, JSON.stringify(options));
  await writeFile(stateFile + '.calls', '');
  await writeFile(stateFile + '.t3calls', '');
  // T3 settings whose built-in Claude instance has no transcripts, so tests never read real ones.
  const settingsFile = join(dir, 't3-settings.json');
  await writeFile(settingsFile, JSON.stringify({ providerInstances: { claudeAgent: { driver: 'claudeAgent', config: { homePath: join(dir, 'no-claude') } } } }));
  // T3 Code's runtime file, naming this test's process, so T3 Code counts as running.
  const runtimeFile = join(dir, 't3-runtime.json');
  await writeFile(runtimeFile, JSON.stringify({ version: 1, pid: process.pid, port: 3773, origin: 'http://127.0.0.1:3773' }));
  // Each test gets a spare port; BOARD_PORT '' leaves the board to pick one from its range.
  const home = env.HOME ?? dir;
  const { repositories = TEST_REPOSITORIES } = options as { repositories?: readonly string[] | null };
  if (repositories && !existsSync(join(home, 'Library/Application Support/Lar Factory/repository-settings.json'))) writeRepositoryList(home, repositories, (options as { localSetups?: Record<string, unknown> }).localSetups);
  // Only recorded work is on the board, so each fake issue starts recorded, unless `recorded: false` says none is.
  type Ref = { number: number; repository: { nameWithOwner: string } };
  const { items: issues = [], repoIssues = {}, builds = [], active = [], blocked = [], recorded = true, threads = {} } = options as {
    items?: RawItem[]; repoIssues?: Record<string, RawItem['content'][]>;
    builds?: Ref[]; active?: Ref[]; blocked?: Ref[]; recorded?: boolean; threads?: Record<string, string[]> };
  // The fake gh's issue searches, which tell a build sub-issue from a slice and a slice's progress, as a read does.
  const keys = (refs: Ref[]) => new Set(refs.map((r) => refKey(r.repository.nameWithOwner, r.number)));
  const listed = [...issues, ...Object.values(repoIssues).flat().map((content): RawItem => ({ id: content!.id, updatedAt: content!.updatedAt, content }))];
  const workIds = recorded ? await recordIssues(home, listed, { builds: keys(builds), active: keys(active), blocked: keys(blocked) }, threads)
    : new Map<string, string>();
  // Bind atomically in the child. Probing and releasing a free port before spawning races other tests.
  const port = 'BOARD_PORT' in env ? env.BOARD_PORT : '0';
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', '--import', new URL('./project-discovery-fixture.ts', import.meta.url).href,
    ...(fastRefresh ? ['--import', new URL('./fast-refresh.ts', import.meta.url).href] : []), 'src/server.ts'], {
    cwd: directory ?? new URL('../', import.meta.url),
    // A home of its own keeps a live board's record out of the real one.
    env: { ...Object.fromEntries(Object.entries(testEnv()).filter(([key]) => key !== DATA_DIR_ENV)), HOME: dir, BOARD_PORT: port, GH_PATH: new URL('./fake-gh.cjs', import.meta.url).pathname,
      T3_PATH: new URL('./fake-t3.cjs', import.meta.url).pathname, SHELL: new URL('./fake-shell.sh', import.meta.url).pathname,
      FAKE_GH_STATE: stateFile, T3_STATE_DB: join(dir, 'no-t3.sqlite'), T3_SETTINGS: settingsFile, T3_SERVER_RUNTIME: runtimeFile, BOARD_DATA_FILE: fixture ? SAMPLE_DATA : '',
      ...(fixture ? SAMPLE_MODELS : {}), ...env },
    stdio: skillCheck ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    // The board leads its own process group, which the gh it runs joins.
    detached: true,
  });
  // A board in its own group misses the terminal's Ctrl-C, and an interrupted run skips onTestFinished. So a
  // watchdog that ignores Ctrl-C reads this worker's pipe and, once the worker dies, stops the group and
  // removes the home.
  const watchdog = child.pid ? spawn('/bin/sh', ['-c', 'trap "" INT HUP; read _; kill -TERM -"$1" 2>/dev/null; sleep 1; rm -rf "$2"',
    'watchdog', String(child.pid), dir], { stdio: ['pipe', 'ignore', 'ignore'] }) : undefined;
  watchdog?.unref();
  (watchdog?.stdin as Socket | undefined)?.unref();
  let skillChecks = 0;
  if (skillCheck) child.on('message', (message) => {
    if (!isSkillCheckRequest(message)) return;
    skillChecks += 1;
    const outcome = skillCheck(message.drift);
    child.send({ type: 'skills-checked', id: message.id, ...typeof outcome === 'object' && outcome ? outcome : { refusal: outcome } } satisfies SkillCheckAnswer);
  });
  let logs = '';
  child.stdout!.on('data', (data: Buffer) => { logs += data.toString(); });
  child.stderr!.on('data', (data: Buffer) => { logs += data.toString(); });
  const stop = async () => {
    // A board that failed to start has already exited, or never got a pid.
    if (child.pid && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      // Stopping the whole group stops a gh still running, so none writes into the home as it is removed.
      process.kill(-child.pid, 'SIGTERM');
      await exited;
    }
  };
  t.onTestFinished(async () => {
    // The watchdog stays up through cleanup, so an interrupt during it is still covered, and goes even if cleanup
    // throws, so it never signals a group id the system may have reused.
    try {
      await stop();
      await rm(dir, { recursive: true, force: true, maxRetries: 5 });
    } finally {
      watchdog?.kill();
    }
  });
  const board = () => fetch(`${url}/api/board`).then((r) => r.json());
  const post = (body: unknown, origin = url, path = '/api/items') => fetch(`${url}${path}`, { method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  let url = '';
  // Wait for the current or next matching output. On failure, close follows the last diagnostic on stdout/stderr.
  // Let the caller's test deadline bound the wait, rather than racing a loaded child against a polling budget.
  const logged = (find: (output: string) => string | undefined) => new Promise<string>((resolve, reject) => {
    const cleanup = () => {
      child.stdout!.off('data', ready);
      child.stderr!.off('data', ready);
      child.off('close', closed);
      child.off('error', failed);
    };
    const ready = () => {
      const found = find(logs);
      if (found !== undefined) { cleanup(); resolve(found); }
    };
    const closed = () => { cleanup(); reject(new Error(`Board closed before the expected message: ${logs}`)); };
    const failed = (error: Error) => { cleanup(); reject(error); };
    child.stdout!.on('data', ready);
    child.stderr!.on('data', ready);
    child.once('close', closed);
    child.once('error', failed);
    ready();
    if (child.stdout!.closed && child.stderr!.closed) closed();
  });
  // The listening line follows bind.
  url = await logged((output) => output.match(/board on (http:\/\/127\.0\.0\.1:\d+)/)?.[1]);
  const response = await fetch(`${url}/api/board`);
  if (!response.ok) throw new Error(`Board answered ${response.status}: ${logs}`);
  return {
    url,
    /** The work ID of the fake issue `number` in `repo`, as startBoard recorded it. */
    id: (number: number, repo = 'maddec01/lar-factory') => workIds.get(`${repo}#${number}`) ?? `unrecorded ${repo}#${number}`,
    /** The folder holding the board's work-record database. */
    dataDir: boardDataDir(home, {}),
    pid: child.pid!,
    stop,
    update: (value: object) => writeFile(stateFile, JSON.stringify(value)),
    calls: () => readCalls(stateFile + '.calls'),
    /** Waits for the requested count of matching gh calls, including those already recorded, within the test deadline. */
    untilCalled: (check: (args: string[]) => boolean, count = 1) => new Promise<string[]>((resolve, reject) => {
      const ready = () => {
        void readCalls(stateFile + '.calls').then((calls) => {
          const found = calls.filter(check);
          if (found.length >= count) { watcher.close(); resolve(found[count - 1]!); }
        }).catch(failed);
      };
      const watcher = watch(stateFile + '.calls', ready);
      const failed = (error: Error) => { watcher.close(); reject(error); };
      watcher.on('error', failed);
      ready();
    }),
    t3Calls: () => readCalls(stateFile + '.t3calls'),
    logs: () => logs,
    /** Waits for a server log message, including one already printed, within the caller's test deadline. */
    untilLogged: (message: string) => logged((output) => output.includes(message) ? message : undefined),
    /** How many skill checks the board has asked for. */
    skillChecks: () => skillChecks,
    board,
    post,
    /** Posts the body with the session the board serves now, as the page does. */
    postSession: async (body: object, path: string, origin = url) =>
      post({ session: (await board() as BoardData).capture!.session, ...body }, origin, path),
  };
}

export type Board = Awaited<ReturnType<typeof startBoard>>;

/** Waits for the current or next pushed board that passes `check`, within the caller's test deadline. */
export async function until(board: Board, check: (data: BoardData) => boolean): Promise<BoardData> {
  const response = await fetch(`${board.url}/api/events`);
  if (!response.ok || !response.body) throw new Error(`Can't read board events: ${response.status}`);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffered = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) throw new Error('The board closed before reaching the expected state');
      buffered += value;
      const events = buffered.split('\n\n');
      buffered = events.pop()!;
      for (const event of events) {
        const json = event.split('\n').filter((line) => line.startsWith('data: ')).map((line) => line.slice(6)).join('\n');
        if (!json) continue;
        const data = JSON.parse(json) as BoardData;
        if (check(data)) return data;
      }
    }
  } finally {
    await reader.cancel();
  }
}

/** Waits for the board to load its repositories' configs, which Add item checks a draft's repository against. */
export const onboarded = (board: Board) => until(board, (data) => data.repos.length > 0);

/** Whether a gh call writes to a repository: a write to its API, or a label, issue or PR command other than a read. */
export const writesRepository = (args: readonly string[]) => args.some((a) => /^(POST|PATCH|PUT|DELETE)$/.test(a))
  || ['label', 'issue', 'pr'].includes(args[0]!) && !['list', 'view'].includes(args[1]!);

/** Whether a gh call reads a repository's .lar-factory.json. */
export const readsRepositoryConfig = (args: readonly string[]) => args[0] === 'api' && !!args[1]?.endsWith('/.lar-factory.json');


/** Environment for a board that can Start maddec01/lar-factory items: a temporary home holding its
 * checkout, and a T3 database with a live project there. */
export function startableEnv(t: TestContext): Record<string, string> {
  const home = mkdtempSync(join(tmpdir(), 'lar-start-home-'));
  t.onTestFinished(() => rmSync(home, { recursive: true, force: true, maxRetries: 5 }));
  checkouts(home, { 'lar-factory': 'git@github.com:maddec01/lar-factory.git' });
  return { HOME: home, T3_STATE_DB: projectsDb(t, [{ id: 'project-factory', root: `${home}/Developer/lar/lar-factory` }]) };
}

export const testFactoryContext = (home: string) => ({dataDir:boardDataDir(home,{}),bin:join(home,'.local/bin'),shapeSkill:join(home,'.agents/skills/lar-shape/SKILL.md'),azureReadOnly:process.env.LAR_FACTORY_AZURE_READ_ONLY==='1'});
export const shapePrompt = (board: Board, title: string, id: string) => workMessage({id,title,number:0} as Item,testFactoryContext(dirname(dirname(dirname(board.dataDir)))));
