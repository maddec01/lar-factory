// The board's HTTP side: serves the page and the board data on this machine only,
// streams changes over /api/events, and routes the page's writes to the item commands.

import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pageWithData, sameRepo, type ClashRun, type ItemCommentsPage, type ItemDetails, type RepositoryConfigAnswers, type FixedClashes, type OnboardingPrChange, type OnboardingRepository, type ProjectChoice, type RepoConfig, type SetupCheckResult } from '@lar-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import type { Refused } from '../config/edit-config.ts';
import { isRepo } from '../config/repository-config.ts';
import type { ItemCommands, Reply } from '../items/item-commands.ts';
import type { ItemDetailsReader } from '../item-details/item-details.ts';
import type { BuiltPage } from '../page/page.ts';
import type { StartAfter } from '../start-after/start-after.ts';
import { log } from '../log.ts';

export interface HttpDeps {
  board: BoardState;
  commands: ItemCommands;
  startAfter: Pick<StartAfter, 'arm' | 'disarm'>;
  page: BuiltPage;
  /** Set by the board app on each launch; while set, guarded writes must carry it in X-Board-Secret. */
  appSecret: string | null;
  /** Sample mode serves a fixed file: it writes nothing and runs no tools. */
  sample: boolean;
  /** Looks the tools up again, az too when `az` asks for it, as onboarding an Azure DevOps repository does. */
  recheck(options?: { gh?: boolean; az?: boolean }): Promise<void>;
  /** Reads one item's details and older comments for the item dialog. */
  itemDetails: ItemDetailsReader;
  /**
   * Reads the source listing the item at `url` now, or once more after the running read; with no url, loads the
   * repositories' configs again and reads every source.
   */
  readSoon(url?: string): void;
  /** The startup tool check; requests other than /healthz and assets wait for it. */
  ready(): Promise<void> | undefined;
  /** T3's projects as onboarding's T3 project step offers them; throws when they can't be read. */
  projectChoices(): Promise<ProjectChoice[]>;
  readProjectTeams(input: Record<string, unknown>): Promise<{ teams: string[] } | Refused>;
  /** Stores where a closed onboarding stopped, returning the repositories still onboarding, or why it can't. */
  keepOnboarding(input: Record<string, unknown>): Promise<{ onboarding: OnboardingRepository[] } | Refused>;
  /** Adds the body's folder as a T3 project, returning T3's projects and the new one's id, or why it can't. */
  createProject(input: Record<string, unknown>): Promise<{ projects: ProjectChoice[]; projectId: string } | Refused>;
  /** Runs one of onboarding's setup checks on the body's repository, T3 project and item source, or says why it can't. */
  runSetupCheck(input: Record<string, unknown>): Promise<{ result: SetupCheckResult } | Refused>;
  /** Runs onboarding's fixed checks for known Clashes on the body's repository's default branch, or says why it can't. */
  findFixedClashes(input: Record<string, unknown>): Promise<FixedClashes | Refused>;
  /** Starts onboarding's Clash agent on the body's repository, T3 project and model, or returns its running run; answers the repository's runs. */
  startClashRun(input: Record<string, unknown>): Promise<{ runs: ClashRun[] } | Refused>;
  /** The repository's Clash agent runs, oldest first. */
  clashRuns(repo: string): ClashRun[];
  /** Reads, creates or renames the labels of onboarding's Labels step, or creates a custom label, answering with the repository's labels, or gh's problem. */
  repositoryLabels: Record<'read' | 'create' | 'rename' | 'custom', (input: Record<string, unknown>, progress?: (labels: string[]) => void) => Promise<{ labels: string[] } | Refused>>;
  /** Opens an onboarding's PR and keeps its URL, returning it and the repositories still onboarding, or gh's problem. */
  openOnboardingPr(input: Record<string, unknown>): Promise<{ prUrl: string; onboarding: OnboardingRepository[] } | Refused>;
  /** What an onboarding's PR would change against its default branch with the body's answers and picks, or why it can't say. */
  previewOnboardingPr(input: Record<string, unknown>): Promise<{ changes: OnboardingPrChange[] } | Refused>;
  /** Reopens an onboarding's PR that closed without merging, returning the repositories still onboarding, or gh's problem. */
  reopenOnboardingPr(input: Record<string, unknown>): Promise<{ onboarding: OnboardingRepository[] } | Refused>;
  /**
   * Reset: closes a repository's open onboarding PR and drops its entry while it is still onboarding, or opens its reset
   * PR, returning its URL, and marks it resetting once onboarded; returns the repositories still onboarding, or gh's problem,
   * with `editPrClosed` when it closed the Edit PR before it failed.
   */
  resetRepository(input: Record<string, unknown>): Promise<{ onboarding: OnboardingRepository[]; prUrl?: string } | (Refused & { editPrClosed?: true })>;
  /**
   * Edit's load: an onboarded repository's .lar-factory.json values and its labels, or why it can't. The values come
   * from its open Edit PR's branch, which `editPr` names, while there is one, else from its default branch.
   */
  readEditConfig(input: Record<string, unknown>): Promise<{ config: RepositoryConfigAnswers; labels: string[]; editPr?: string } | Refused>;
  /** Edit's Save: creates the custom labels the repository lacks and opens the PR on its .lar-factory.json, or adds to the open one, returning its URL, or gh's problem. */
  openEditPr(input: Record<string, unknown>): Promise<{ prUrl: string } | Refused>;
  /** The config update notice's PR: rewrites the body's repository's .lar-factory.json at the app's version through Edit's PR, returning its URL, or gh's problem. */
  openConfigUpdatePr(input: Record<string, unknown>): Promise<{ prUrl: string } | Refused>;
  /** Records the repository's config update notice dismissed at the app's version, on this Mac, or says why it can't for a repository that isn't onboarded. */
  dismissConfigUpdate(repo: string): Refused | null;
}

export interface BoardServer {
  server: Server;
  /** Ends every page's event stream, so the server can close. */
  endStreams(): void;
}

/** A write only the board app's page may make. */
interface Write {
  /** What the body holds, for the errors about it. */
  what: string;
  /** The refusal in sample mode, before the body is read. */
  disabled?: string;
  /** The answer when the page's session is from an earlier board run; a write without one skips the check. */
  restarted?: () => object;
  progress?: boolean;
  run(input: Record<string, unknown>, progress?: (body: object) => void): Promise<Reply>;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'",
};

function send(res: ServerResponse, status: number, type: string, body: string | Buffer): void {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(value));
}

/** Whether the request carries the app secret, compared in constant time. Hashing first evens out the lengths. */
function hasAppSecret(req: IncomingMessage, secret: string): boolean {
  const given = req.headers['x-board-secret'];
  if (typeof given !== 'string') return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(given), digest(secret));
}

/** Reads a small JSON object body, or answers the request with the problem and returns null. */
async function readJson(req: IncomingMessage, res: ServerResponse, what: string): Promise<Record<string, unknown> | null> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') {
    json(res, 415, { error: `Send ${what} as JSON.` });
    return null;
  }
  try {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > 100_000) {
        json(res, 413, { error: `${what[0]!.toUpperCase()}${what.slice(1)} are too large.` });
        return null;
      }
      chunks.push(chunk as Buffer);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
    if (!input || typeof input !== 'object') throw new Error('Invalid JSON.');
    return input as Record<string, unknown>;
  } catch {
    json(res, 400, { error: `Send valid ${what} as JSON.` });
    return null;
  }
}

/** Runs an item command on the body's itemId, or refuses a body that names none. */
function forItem(unnamed: string, run: (itemId: string, input: Record<string, unknown>) => Promise<Reply>): Write['run'] {
  return async (input) => typeof input.itemId === 'string' ? run(input.itemId, input) : { status: 400, body: { error: unnamed } };
}

export function createBoardServer({ board, commands, startAfter, page, appSecret, sample, recheck, itemDetails, readSoon, ready, projectChoices, readProjectTeams, keepOnboarding, createProject,
  runSetupCheck, repositoryLabels, findFixedClashes, startClashRun, clashRuns, openOnboardingPr, previewOnboardingPr, reopenOnboardingPr,
  resetRepository, readEditConfig, openEditPr, openConfigUpdatePr, dismissConfigUpdate }: HttpDeps): BoardServer {
  /** Open /api/events responses, one per page. */
  const streams = new Set<ServerResponse>();
  /** Set once the app asks to drain before installing an update: guarded writes are refused from then on. */
  let draining = false;
  /** Guarded writes being answered, and the drain calls waiting for them to finish. */
  let runningWrites = 0;
  const drained: Array<() => void> = [];

  const withBoard = (body: object) => ({ ...body, board: board.snapshot() });

  /** Changes the repository's row on the board at once, before the next read sees it. */
  function changeRow(repo: string, change: (row: RepoConfig) => RepoConfig): void {
    board.update({ repos: board.snapshot().repos.map((r) => sameRepo(r.repo, repo) ? change(r) : r) });
    board.push();
  }

  /**
   * Records the repository's config update notice dismissed and takes it off its row at once, with `changes` to the row;
   * or answers why it can't.
   */
  function dismissNotice(repo: string, changes: object = {}): Refused | null {
    const refused = dismissConfigUpdate(repo);
    if (refused) return refused;
    changeRow(repo, ({ configUpdate: _, ...r }) => ({ ...r, ...changes }));
    return null;
  }

  /** A write of onboarding's Labels step, which answers with the repository's labels. */
  const labelsWrite = (action: keyof HttpDeps['repositoryLabels']): Write => ({
    progress: action === 'create',
    what: `the labels to ${action}`, disabled: 'Sample mode onboards no repository.',
    async run(input, progress) {
      const answer = await repositoryLabels[action](input, (labels) => progress?.({ labels }));
      return 'error' in answer ? { status: answer.status, body: { error: answer.error } } : { status: 200, body: { ...answer, error: null } };
    },
  });

  /** The guarded writes by path. /api/read stays open for status.sh, since it only starts a read. */
  const WRITES: Record<string, Write> = {
    '/api/items': {
      what: 'item details', disabled: 'Adding items is disabled in sample mode.',
      restarted: () => ({ uncertain: true, error: 'The board restarted. Check your items in GitHub or Azure DevOps before starting a new item.' }),
      run: (input) => commands.capture(input),
    },
    '/api/queue': {
      what: 'the item to queue', disabled: 'Queuing is disabled in sample mode.',
      run: forItem('Name the item to queue.', (itemId) => commands.queue(itemId)),
    },
    '/api/back-to-list': {
      what: 'the item to move back to List', disabled: 'Moving items back to List is disabled in sample mode.',
      run: forItem('Name the item to move back to List.', (itemId) => commands.backToList(itemId)),
    },
    '/api/pick-status': {
      what: 'the item and the status to keep', disabled: 'Picking a status is disabled in sample mode.',
      run: forItem('Name the item to pick a status for.', (itemId, input) => commands.pickStatus(itemId, input.status)),
    },
    '/api/start': {
      what: 'the item to start', disabled: 'Starting threads is disabled in sample mode.',
      restarted: () => withBoard({ error: 'The board restarted. Press Start again.' }),
      run: forItem('Name the item to start.', (itemId, input) => commands.start(itemId, input.model, input.repo)),
    },
    '/api/start-build': {
      what: 'the build to start', disabled: 'Starting builds is disabled in sample mode.',
      restarted: () => withBoard({ error: 'The board restarted. Press Start build again.' }),
      run: forItem('Name the build to start.', (itemId, input) => commands.startBuild(itemId, input.model)),
    },
    '/api/arm': {
      what: 'the item to start after its blockers', disabled: 'Start after is disabled in sample mode.',
      restarted: () => withBoard({ error: 'The board restarted. Press Start after again.' }),
      run: forItem('Name the item to start after its blockers.', async (itemId, input) => startAfter.arm(itemId, input.model, input.repo)),
    },
    '/api/disarm': {
      what: 'the item to disarm', disabled: 'Start after is disabled in sample mode.',
      run: forItem('Name the item to disarm.', async (itemId) => startAfter.disarm(itemId)),
    },
    '/api/abandon': {
      what: 'the item to abandon', disabled: 'Abandoning is disabled in sample mode.',
      restarted: () => withBoard({ error: 'The board restarted. Press Abandon again.' }),
      run: forItem('Name the item to abandon.', (itemId) => commands.abandon(itemId)),
    },
    '/api/item-description': {
      what: 'the description and its item', disabled: 'Saving descriptions is disabled in sample mode.',
      async run({ itemId, body, bodyField, revision }) {
        if (typeof itemId !== 'string' || !itemId || typeof body !== 'string') return { status: 400, body: { error: 'Name the item and send its description.' } };
        if ((bodyField !== undefined && bodyField !== 'System.Description' && bodyField !== 'Microsoft.VSTS.TCM.ReproSteps')
          || (revision !== undefined && !Number.isSafeInteger(revision))) return { status: 400, body: { error: 'Send the field and revision the work item\'s details gave.' } };
        const item = board.snapshot().items.find((i) => i.id === itemId);
        if (!item) return { status: 404, body: { error: 'That item is not on the board.' } };
        const refused = await itemDetails.saveDescription(item, { body, ...bodyField !== undefined && { bodyField }, ...revision !== undefined && { revision: revision as number } });
        return refused ? { status: refused.status, body: { error: refused.error } } : { status: 200, body: { error: null } };
      },
    },
    '/api/onboarding/projects': {
      what: 'the folder to add', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const created = await createProject(input);
        return 'error' in created ? { status: created.status, body: { error: created.error } } : { status: 200, body: { ...created, error: null } };
      },
    },
    '/api/onboarding/repositories': {
      what: 'the onboarding to keep', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const kept = await keepOnboarding(input);
        if ('error' in kept) return { status: kept.status, body: { error: kept.error } };
        board.update({ onboarding: kept.onboarding });
        board.push();
        return { status: 200, body: withBoard({ error: null }) };
      },
    },
    '/api/onboarding/teams': {
      what: 'the repository whose teams to load', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const answer = await readProjectTeams(input);
        return 'error' in answer ? { status: answer.status, body: { error: answer.error } } : { status: 200, body: answer };
      },
    },
    '/api/onboarding/checks': {
      what: 'the check to run', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const checked = await runSetupCheck(input);
        return 'error' in checked ? { status: checked.status, body: { error: checked.error } } : { status: 200, body: { ...checked, error: null } };
      },
    },
    '/api/onboarding/labels': labelsWrite('read'),
    '/api/onboarding/labels/create': labelsWrite('create'),
    '/api/onboarding/labels/rename': labelsWrite('rename'),
    '/api/onboarding/labels/custom': labelsWrite('custom'),
    '/api/onboarding/clashes': {
      what: 'the repository to check', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const found = await findFixedClashes(input);
        return 'error' in found ? { status: found.status, body: { error: found.error } } : { status: 200, body: { ...found, error: null } };
      },
    },
    '/api/onboarding/clash-runs': {
      what: 'the Clash run to start', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const started = await startClashRun(input);
        return 'error' in started ? { status: started.status, body: { error: started.error } } : { status: 200, body: { ...started, error: null } };
      },
    },
    '/api/onboarding/pr': {
      what: 'the onboarding whose PR to open', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const opened = await openOnboardingPr(input);
        if ('error' in opened) return { status: opened.status, body: { error: opened.error } };
        board.update({ onboarding: opened.onboarding });
        board.push();
        return { status: 200, body: withBoard({ prUrl: opened.prUrl, error: null }) };
      },
    },
    '/api/onboarding/pr/changes': {
      what: 'the onboarding PR to preview', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const previewed = await previewOnboardingPr(input);
        return 'error' in previewed ? { status: previewed.status, body: { error: previewed.error } } : { status: 200, body: { ...previewed, error: null } };
      },
    },
    '/api/onboarding/pr/reopen': {
      what: 'the onboarding whose PR to reopen', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const reopened = await reopenOnboardingPr(input);
        if ('error' in reopened) return { status: reopened.status, body: { error: reopened.error } };
        board.update({ onboarding: reopened.onboarding });
        board.push();
        return { status: 200, body: withBoard({ error: null }) };
      },
    },
    '/api/repositories/reset': {
      what: 'the repository to reset', disabled: 'Sample mode onboards no repository.',
      async run(input) {
        const reset = await resetRepository(input);
        if ('error' in reset) {
          if (!reset.editPrClosed) return { status: reset.status, body: { error: reset.error } };
          // The Edit PR Reset closed leaves the row at once, though the reset PR didn't open.
          changeRow(input.repo as string, ({ editPr: _, ...r }) => r);
          return { status: reset.status, body: withBoard({ error: reset.error }) };
        }
        // Hide its items at once, keeping the reset PR in Settings until the read sees it merge or close.
        const gone = (repo: string | null) => repo !== null && sameRepo(repo, input.repo as string);
        const { repos, items, resetting = [] } = board.snapshot();
        board.update({ onboarding: reset.onboarding, repos: repos.filter((r) => !gone(r.repo)), items: items.filter((i) => !gone(i.repo)),
          resetting: [...resetting.filter((r) => !gone(r.repo)), ...reset.prUrl ? [{ repo: input.repo as string, prUrl: reset.prUrl }] : []] });
        board.push();
        readSoon();
        return { status: 200, body: withBoard({ ...reset.prUrl && { prUrl: reset.prUrl }, error: null }) };
      },
    },
    '/api/repositories/config': {
      what: 'the repository to edit', disabled: 'Sample mode edits no repository.',
      async run(input) {
        const read = await readEditConfig(input);
        return 'error' in read ? { status: read.status, body: { error: read.error } } : { status: 200, body: { ...read, error: null } };
      },
    },
    '/api/repositories/config/pr': {
      what: 'the repository and its new values', disabled: 'Sample mode edits no repository.',
      async run(input) {
        const opened = await openEditPr(input);
        if ('error' in opened) return { status: opened.status, body: { error: opened.error } };
        // The row shows its Edit PR at once.
        changeRow(input.repo as string, (r) => ({ ...r, editPr: opened.prUrl }));
        return { status: 200, body: withBoard({ ...opened, error: null }) };
      },
    },
    // A config update PR the notice opened takes the notice's place, as the row's open Edit PR.
    '/api/repositories/config-update/pr': {
      what: 'the repository to update', disabled: 'Sample mode edits no repository.',
      async run(input) {
        const opened = await openConfigUpdatePr(input);
        if ('error' in opened) return { status: opened.status, body: { error: opened.error } };
        dismissNotice(input.repo as string, { editPr: opened.prUrl });
        return { status: 200, body: withBoard({ ...opened, error: null }) };
      },
    },
    '/api/repositories/config-update/dismiss': {
      what: 'the repository whose notice to dismiss', disabled: 'Sample mode edits no repository.',
      async run({ repo }) {
        if (!isRepo(repo)) return { status: 400, body: { error: 'Send the repository whose notice to dismiss.' } };
        const refused = dismissNotice(repo);
        if (refused) return { status: refused.status, body: { error: refused.error } };
        return { status: 200, body: withBoard({ error: null }) };
      },
    },
    // Looks the tools up again for the notices' Recheck button and onboarding's Checks step.
    '/api/recheck': {
      what: 'the recheck request',
      async run(input) {
        if (sample) return { status: 403, body: { error: 'Sample mode looks no tools up.' } };
        await recheck({ gh: input.gh === true, az: input.az === true });
        return { status: 200, body: withBoard({ error: null }) };
      },
    },
  };

  /** Opens a write: refuses it in sample mode, reads its body and checks its session. Answers and returns null on a problem. */
  async function writeInput(req: IncomingMessage, res: ServerResponse, write: Write): Promise<Record<string, unknown> | null> {
    if (sample && write.disabled) {
      json(res, 403, { error: write.disabled });
      return null;
    }
    const input = await readJson(req, res, write.what);
    if (input && write.restarted && input.session !== board.snapshot().capture?.session) {
      json(res, 409, write.restarted());
      return null;
    }
    return input;
  }

  /** Answers a guarded write and counts it as running until then. */
  async function guardedWrite(req: IncomingMessage, res: ServerResponse, write: Write): Promise<void> {
    runningWrites++;
    try {
      const input = await writeInput(req, res, write);
      if (!input) return;
      const streaming = write.progress && req.headers.accept === 'application/x-ndjson';
      const emit = (body: object) => {
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
        res.write(`${JSON.stringify(body)}\n`);
      };
      const { status, body } = await write.run(input, streaming ? (progress) => emit({ progress }) : undefined);
      if (res.headersSent) { emit({ result: body }); res.end(); }
      else json(res, status, body);
    } finally {
      if (--runningWrites === 0) for (const resolve of drained.splice(0)) resolve();
    }
  }

  /** Refuses new guarded writes and answers once the running ones finish, so the app can stop the server. */
  async function drainRequest(res: ServerResponse): Promise<void> {
    draining = true;
    if (runningWrites > 0) await new Promise<void>((resolve) => drained.push(resolve));
    log('drained writes for an update');
    json(res, 200, {});
  }

  /**
   * Starts a read for status.sh and slice.sh, so a moved item reaches the board before its next timed read: of the
   * source listing the `url` it sends, else of everything.
   */
  async function readRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readJson(req, res, 'the read request');
    if (!body) return;
    if (sample) return json(res, 200, {});
    readSoon(typeof body.url === 'string' ? body.url : undefined);
    json(res, 202, {});
  }

  /** Lists T3's projects for onboarding's T3 project step, which reads gh for each repository's Repository config. */
  async function projectsRequest(res: ServerResponse): Promise<void> {
    if (sample) return json(res, 403, { error: 'Sample mode onboards no repository.' });
    try { json(res, 200, { projects: await projectChoices() }); }
    catch (err) { json(res, 502, { error: err instanceof Error ? err.message : String(err) }); }
  }

  /** Answers a repository's Clash agent runs, which the Cleanup step reads while one runs. */
  function clashRunsRequest(url: URL, res: ServerResponse): void {
    if (sample) return json(res, 403, { error: 'Sample mode onboards no repository.' });
    const repo = url.searchParams.get('repo');
    if (!isRepo(repo)) return json(res, 400, { error: 'Name the repository whose Clash runs to read.' });
    json(res, 200, { runs: clashRuns(repo) });
  }

  /** Answers one item's details, which the item dialog reads when it opens. */
  async function itemDetailsRequest(url: URL, res: ServerResponse): Promise<void> {
    const itemId = url.searchParams.get('itemId');
    if (!itemId) return json(res, 400, { error: 'Name the item whose details to read.' });
    const item = board.snapshot().items.find((i) => i.id === itemId);
    if (!item) return json(res, 404, { error: 'That item is not on the board.' });
    try {
      const read = await itemDetails.details(item);
      if ('error' in read) json(res, read.status, { error: read.error });
      else json(res, 200, { details: read satisfies ItemDetails });
    } catch (err) { json(res, 502, { error: err instanceof Error ? err.message : String(err) }); }
  }

  /** Answers the next 10 older comments of one item, which the item dialog reads on "Load 10 more". */
  async function itemCommentsRequest(url: URL, res: ServerResponse): Promise<void> {
    const itemId = url.searchParams.get('itemId');
    if (!itemId) return json(res, 400, { error: 'Name the item whose comments to read.' });
    const before = url.searchParams.get('before');
    if (!before) return json(res, 400, { error: 'Name where the older comments start.' });
    const item = board.snapshot().items.find((i) => i.id === itemId);
    if (!item) return json(res, 404, { error: 'That item is not on the board.' });
    try {
      const read = await itemDetails.olderComments(item, before);
      if ('error' in read) json(res, read.status, { error: read.error });
      else json(res, 200, { page: read satisfies ItemCommentsPage });
    } catch (err) { json(res, 502, { error: err instanceof Error ? err.message : String(err) }); }
  }

  /** Opens a page's event stream and sends the board data at once, so a reconnecting page catches up. */
  function openStream(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
    if (req.method === 'HEAD') return void res.end();
    const sendBoard = (data: object) => res.write(`data: ${JSON.stringify(data)}\n\n`);
    streams.add(res);
    const unsubscribe = board.subscribe(sendBoard);
    res.on('close', () => {
      streams.delete(res);
      unsubscribe();
    });
    sendBoard(board.snapshot());
  }

  /** Only answer requests addressed to this machine, to block DNS rebinding. */
  function allowedHost(req: IncomingMessage): boolean {
    const host = (req.headers.host ?? '').toLowerCase();
    const { port } = server.address() as AddressInfo;
    return [`127.0.0.1:${port}`, `localhost:${port}`].includes(host);
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!allowedHost(req)) return send(res, 421, 'text/plain; charset=utf-8', 'Misdirected request\n');
    const url = new URL(req.url ?? '/', 'http://localhost');
    const { pathname: path } = url;
    // The health check must answer at once; everything else runs tools or shows what the lookup found.
    if (path !== '/healthz' && !path.startsWith('/assets/')) await ready();
    if (req.method === 'POST' && req.headers.origin !== `http://${req.headers.host}`) {
      return json(res, 403, { error: 'Submit from this board page.' });
    }
    const write = req.method === 'POST' && Object.hasOwn(WRITES, path) ? WRITES[path] : undefined;
    if (write && appSecret && !hasAppSecret(req, appSecret)) {
      return json(res, 403, { error: 'Submit from the board app.' });
    }
    if (req.method === 'POST' && path === '/api/drain') {
      if (!appSecret || !hasAppSecret(req, appSecret)) return json(res, 403, { error: 'Only the board app can drain the board.' });
      return drainRequest(res);
    }
    if (write) {
      if (draining) return json(res, 503, { error: 'The board is installing an update. Try again once Lar Factory restarts.' });
      return guardedWrite(req, res, write);
    }
    if (req.method === 'POST' && path === '/api/read') return readRequest(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(res, 405, 'text/plain; charset=utf-8', 'Method not allowed\n');
    }
    if (path === '/') {
      return send(res, 200, 'text/html; charset=utf-8', pageWithData(page.template, board.snapshot()));
    }
    if (path === '/api/events') return openStream(req, res);
    if (path === '/api/onboarding/projects') return projectsRequest(res);
    if (path === '/api/onboarding/clash-runs') return clashRunsRequest(url, res);
    if (path === '/api/item-details') return itemDetailsRequest(url, res);
    if (path === '/api/item-comments') return itemCommentsRequest(url, res);
    if (path === '/api/board') return send(res, 200, 'application/json; charset=utf-8', JSON.stringify(board.snapshot()));
    if (path === '/healthz') return json(res, 200, {});
    const asset = path.startsWith('/assets/') ? page.assets.get(path.slice('/assets/'.length)) : undefined;
    if (asset) return send(res, 200, asset.type, asset.body);
    send(res, 404, 'text/plain; charset=utf-8', 'Not found\n');
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      log(`request ${req.url} failed: ${err instanceof Error ? err.stack : String(err)}`);
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Internal error\n');
    });
  });

  return {
    server,
    endStreams() {
      for (const res of streams) res.end();
    },
  };
}
