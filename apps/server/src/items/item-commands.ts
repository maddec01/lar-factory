// The commands the board's buttons send: add, queue, back to List, pick a status, start, start build and abandon.
// The maps of commands in flight are private here, so every rule about which command
// blocks which lives in this file.

import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WAITS_FOR_ONBOARDING, blockedText, buildBranch, buildMessage, canAbandon, carriesTwoStatuses, isBuild, isOnboarding, pickRepoText, repoTag, startRepo, validateDraft, workMessage } from '@lar-factory/shared';
import type { BoardData, CreationProgress, CreationResult, Item, ItemDraft, ModelChoice, ModelGroup, RepoConfig, StartResult, Status } from '@lar-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import { readRepositoryList } from '../config/repository-config.ts';
import { issueLabels } from '../github/github.ts';
import { installHome } from '../skills/bundled-skills.ts';
import { repositoryProject } from '../t3/repository-project.ts';
import type { RepositoryProject } from '../t3/repository-project.ts';
import { findModelChoice } from '../t3/model-choices.ts';
import { lookupThread, startThread } from '../t3/t3.ts';
import type { ItemSource } from './item-source.ts';

/** A command's answer: the HTTP status and the JSON body. */
export interface Reply {
  status: number;
  body: object;
}

export interface ItemCommands {
  /** Checks settled Starts missing from an available thread read. */
  reconcileStarts(items: Item[]): Promise<void>;
  /** Creates the issue a submission describes, once per request ID. */
  capture(input: Record<string, unknown>): Promise<Reply>;
  queue(itemId: string): Promise<Reply>;
  backToList(itemId: string): Promise<Reply>;
  /** Keeps one of the statuses an issue carrying more than one has, and drops the others: the one move such an issue allows. */
  pickStatus(itemId: string, status: unknown): Promise<Reply>;
  /**
   * Starts a T3 thread for a Queued item that nothing open blocks, once unless its recorded run stopped. An untagged Azure work
   * item is tagged first for `repo`, one of the repositories reading it, or for the only one that does.
   */
  start(itemId: string, model: unknown, repo?: unknown): Promise<Reply>;
  /**
   * Starts a Ready build's thread in a new worktree, or retries a confirmed stopped run, once nothing open blocks it, as
   * lar-shape's step 5 does after Go: it adds the `build` label and moves a parent that isn't a build to In progress first.
   */
  startBuild(itemId: string, model: unknown): Promise<Reply>;
  abandon(itemId: string): Promise<Reply>;
}

export interface ItemCommandsDeps {
  board: BoardState;
  /** Where the commands write their changes. */
  items: ItemSource;
  /** The onboarded repositories as the last read found them, which Add item may create in. */
  repos(): RepoConfig[];
  /** Reads the model choices T3 offers now into the board data. */
  offerModelChoices(): ModelGroup[];
  /**
   * Checks the installed skills against the bundle and restores any that differ, before Start build: resolves with
   * why the build can't start, or null. Missing without a bundle, so Start build checks nothing.
   */
  checkSkills?: () => Promise<string | null>;
  /** The repository's T3 project as the onboarded repositories are now; tests stand in for it. */
  projectOf?: (repo: string) => Promise<RepositoryProject>;
  /** Starts a T3 thread; tests stand in for t3. */
  startThread?: typeof startThread;
  showThread?: typeof lookupThread;
}

type Action = 'queue' | 'back to List' | 'pick' | 'start' | 'abandon';

/** A status change the board's buttons make: Queue moves List to Queued, Back to List the reverse. */
interface Move {
  action: Action;
  from: Status;
  to: Status;
  refused: (status: Status) => string;
}

const QUEUE: Move = {
  action: 'queue', from: 'List', to: 'Queued',
  refused: (status) => `Only List items can be queued; this one is in ${status}.`,
};

const BACK_TO_LIST: Move = {
  action: 'back to List', from: 'Queued', to: 'List',
  refused: (status) => `Only Queued items can be moved back to List; this one is in ${status}.`,
};

/** A refused Start ran no t3: one of the repository project's checks failed. */
type Start = StartResult & { refused?: true };

const REQUEST_ID = /^[a-f0-9-]{36}$/;
const GONE = 'That item is no longer on the board.';

/** Keeps `work` in `inFlight` under `key` until it settles, or for good when `keep` says so. */
function track<T>(inFlight: Map<string, Promise<T>>, key: string, work: Promise<T>, keep: (result: T) => boolean = () => false): Promise<T> {
  const tracked = work.then((result) => {
    if (!keep(result)) inFlight.delete(key);
    return result;
  });
  inFlight.set(key, tracked);
  return tracked;
}

/** Where lar-build is installed, for the build message: under the board app's install root, else the home. */
const larBuild = () => join(installHome(), '.agents/skills/lar-build');

/** The repository project for an onboarded repository as the list is now, so a repository onboarded after a refusal starts on the next Start. */
async function currentRepositoryProject(repo: string): Promise<RepositoryProject> {
  let repos;
  try { repos = readRepositoryList(); }
  catch (err) { return { error: `Can't read the onboarded repositories: ${(err as Error).message}` }; }
  return repositoryProject(repo, repos);
}

export function createItemCommands({ board, items, repos, offerModelChoices, checkSkills, projectOf = currentRepositoryProject,
  showThread = lookupThread, startThread: startIn = startThread }: ItemCommandsDeps): ItemCommands {
  const retryBuilds = new Set<string>();
  const checks = new WeakMap<Promise<Start>, { pending: boolean; retryAt: number }>();
  const submissions = new Map<string, {
    draft: ItemDraft; progress: CreationProgress; pending?: Promise<CreationResult>; published?: boolean;
  }>();
  /** Starts by item id. A kept result is reused, so one item starts at most one thread per board run. */
  const starts = new Map<string, Promise<Start>>();
  /** Start builds by item id, kept like Starts, so an item started while Queued can still start its build. */
  const buildStarts = new Map<string, Promise<Start>>();
  // Only settled starts can be retried; requests arriving during a retry share its pending result.
  const finishedStarts = new WeakMap<Promise<Start>, string>();
  /** Status changes in flight by item id; Start and Abandon wait out a move, and a move waits out Abandon. */
  const moving = new Set<string>();
  /** Deletes in flight by item id, so a second press waits for the first. */
  const abandoning = new Map<string, Promise<string | null>>();

  const reply = (status: number, body: object): Reply => ({ status, body });
  const withBoard = (status: number, body: object): Reply => reply(status, { ...body, board: board.snapshot() });

  /** Why a command in flight on the item, or a Start this board run, blocks this action; null when nothing does. */
  function busyReason(itemId: string, action: Action): string | null {
    const started = starts.has(itemId) || !!board.snapshot().started?.[itemId];
    if (started && action === 'back to List') return 'Start is running or has run for this item. Check its T3 thread before moving it back to List.';
    if (started && action === 'abandon') return 'Start is running or has run for this item. Check its T3 thread before abandoning it.';
    if (moving.has(itemId) && action === 'start') return 'This item is moving back to List, so it can\'t start.';
    if (moving.has(itemId) && action === 'abandon') return 'This item is being moved, so it can\'t be abandoned.';
    if (abandoning.has(itemId) && action !== 'abandon') return `This item is being abandoned, so it can't ${action === 'start' ? 'start' : 'move'}.`;
    return null;
  }

  async function move(itemId: string, { action, from, to, refused }: Move): Promise<Reply> {
    const item = board.find(itemId);
    if (!item) return reply(404, { error: GONE });
    if (item.status === to) return withBoard(200, { error: null });
    if (item.status !== from) return reply(409, { error: refused(item.status) });
    const refusal = items.statusRefusal(item);
    if (refusal) return withBoard(409, { error: refusal });
    const busy = busyReason(itemId, action);
    if (busy) return withBoard(409, { error: busy });
    moving.add(itemId);
    const error = await items.setStatus(item, to).finally(() => moving.delete(itemId));
    if (error) return withBoard(502, { error });
    board.showChanged({ ...item, status: to, statuses: [to] });
    return withBoard(200, { error: null });
  }

  async function pickStatus(itemId: string, status: unknown): Promise<Reply> {
    const item = board.find(itemId);
    if (!item) return reply(404, { error: GONE });
    if (!carriesTwoStatuses(item)) return withBoard(409, { error: 'Only an open item that carries more than one status has one to pick.' });
    const picked = item.statuses.find((s) => s === status);
    if (!picked) return withBoard(409, { error: `Pick one of the statuses this item carries: ${item.statuses.join(', ')}.` });
    const busy = busyReason(itemId, 'pick');
    if (busy) return withBoard(409, { error: busy });
    moving.add(itemId);
    const error = await items.setStatus(item, picked).finally(() => moving.delete(itemId));
    if (error) return withBoard(502, { error });
    board.showChanged({ ...item, status: picked, statuses: [picked] });
    return withBoard(200, { error: null });
  }

  /**
   * The item a start runs on: as it is, or an untagged Azure work item for the repository `picked` names among those
   * reading it, or for the only one; a refusal asking which when that names none of them.
   */
  function startingItem(item: Item, picked: unknown): Item | Reply {
    const { untaggedFor, ...rest } = item;
    if (!untaggedFor) return item;
    const repo = startRepo(item, picked);
    return repo ? { ...rest, repo } : withBoard(409, { error: pickRepoText(board.snapshot(), item) });
  }

  /**
   * Refuses a start while the item's repository is still onboarding, until its PR merges, or while an issue the item
   * is blocked by is open; Start after starts it once they close.
   */
  function blockedReply(item: Item): Reply | null {
    if (isOnboarding(board.snapshot(), item.repo)) return withBoard(409, { error: WAITS_FOR_ONBOARDING });
    const blocked = blockedText(item);
    return blocked ? withBoard(409, { error: `${blocked}; use Start after to start it then.` }) : null;
  }

  /**
   * Runs a start once until its recorded thread stops, keyed in `runs`, on the model choice the
   * board offers now, and records the thread it opened in the board data's `record`. `begin`
   * refuses the item, or returns the work that starts its thread.
   */
  async function startOnce(runs: Map<string, Promise<Start>>, record: 'started' | 'startedBuilds', itemId: string, model: unknown,
    begin: (item: Item, choice: ModelChoice | undefined) => Reply | (() => Promise<Start>)): Promise<Reply> {
    // Only a choice the board offers right now reaches t3 as arguments.
    let choice: ModelChoice | undefined;
    if (model !== undefined) {
      const found = findModelChoice(offerModelChoices(), model);
      if (!found) return withBoard(422, { error: "That model choice isn't offered. Pick another one." });
      choice = found;
    }
    let pending = runs.get(itemId);
    const item = board.find(itemId);
    const previous = pending && finishedStarts.get(pending);
    if (previous && Array.isArray(item?.threads) && item.threads.some((t) => t.id === previous && t.state === 'stopped')
      && !item.threads.some((t) => t.state === 'running' || t.state === 'needs you')) {
      runs.delete(itemId);
      pending = undefined;
    }
    if (!pending) {
      const item = board.find(itemId);
      if (!item) return reply(404, { error: GONE });
      const work = begin(item, choice);
      if (typeof work !== 'function') return work;
      // Keep a started or unconfirmed thread; only a confirmed stop or a failure reported by t3 allows retry.
      pending = track(runs, itemId, work().then((result) => {
        if (result.thread) finishedStarts.set(pending!, result.thread.threadId);
        if (result.thread) board.update({ [record]: { ...board.snapshot()[record], [itemId]: result.thread } } satisfies Partial<BoardData>);
        board.push();
        return result;
      }), (result) => !!result.thread || !!result.uncertain);
    }
    const { refused, ...result } = await pending;
    return withBoard(refused ? 409 : result.error ? 502 : 200, result);
  }

  /**
   * Plans the move of the item's parent to In progress, unless it's a build or there already: null when there is
   * nothing to move, the error or refusal to show, or the move, which returns its error or null. The parent moves
   * through its own item source, so a source that refuses it does so here, before Start build writes anything.
   */
  async function parentInProgress({ parent }: Item): Promise<null | { error: string; refused?: true } | { move: () => Promise<string | null> }> {
    if (!parent) return null;
    const onBoard = board.snapshot().items.find((i) => i.number === parent.number &&
      i.repo?.toLowerCase() === parent.repo.toLowerCase());
    if (onBoard) {
      if (isBuild(onBoard) || onBoard.status === 'In progress') return null;
      const refusal = items.statusRefusal(onBoard);
      if (refusal) return { error: refusal, refused: true };
      return { move: async () => {
        const error = await items.setStatus(onBoard, 'In progress');
        if (!error) board.showChanged({ ...onBoard, status: 'In progress', statuses: ['In progress'] });
        return error;
      } };
    }
    // A parent off the board has no labels here, so GitHub says whether it's a build.
    let labels: string[];
    try { labels = await issueLabels(parent.repo, parent.number); }
    catch (err) { return { error: `Could not read the labels of ${parent.repo}#${parent.number}. ${(err as Error).message}` }; }
    if (isBuild({ labels })) return null;
    const refusal = items.statusRefusal(parent);
    return refusal ? { error: refusal, refused: true } : { move: () => items.setParentStatus(parent, 'In progress') };
  }

  return {
    async reconcileStarts(currentItems) {
      const warnings = { ...board.snapshot().startCheckFailures };
      for (const id of Object.keys(warnings)) if (!currentItems.some((item) => item.id === id)) delete warnings[id];
      if (JSON.stringify(warnings) !== JSON.stringify(board.snapshot().startCheckFailures ?? {})) {
        board.update({ startCheckFailures: warnings });
        board.push();
      }
      await Promise.all(([['started', starts], ['startedBuilds', buildStarts]] as const).flatMap(([record, runs]) =>
        [...runs].map(async ([id, run]) => {
          const threadId = finishedStarts.get(run);
          const item = currentItems.find((item) => item.id === id);
          if (!threadId || !item || !Array.isArray(item.threads)) return;
          if (item.threads.some((thread) => thread.id === threadId)) {
            const failures = { ...board.snapshot().startCheckFailures };
            if (id in failures) {
              delete failures[id];
              board.update({ startCheckFailures: failures });
              board.push();
            }
            return;
          }
          const previous = checks.get(run);
          if (previous?.pending || (previous && Date.now() < previous.retryAt)) return;
          checks.set(run, { pending: true, retryAt: Infinity });
          let answer: Awaited<ReturnType<typeof lookupThread>>;
          try { answer = await showThread(threadId); } catch { answer = 'unknown'; }
          if (runs.get(id) !== run || !board.find(id)) return;
          const failures = { ...board.snapshot().startCheckFailures };
          if (answer === 'unknown') failures[id] = item.title;
          else delete failures[id];
          checks.set(run, { pending: false, retryAt: answer === 'unknown' ? Date.now() + 30_000 : Infinity });
          if (answer === 'deleted') {
            runs.delete(id);
            finishedStarts.delete(run);
            if (record === 'startedBuilds') retryBuilds.add(id);
            const records = { ...board.snapshot()[record] };
            delete records[id];
            board.update({ [record]: records });
          }
          board.update({ startCheckFailures: failures });
          board.push();
        })));
    },
    async capture(input) {
      if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
        return reply(400, { error: 'The submission needs a valid request ID.' });
      }
      let draft: ItemDraft;
      try { draft = validateDraft(input.draft, repos()); }
      catch (err) { return reply(422, { error: (err as Error).message }); }
      let entry = submissions.get(input.requestId);
      if (entry && JSON.stringify(entry.draft) !== JSON.stringify(draft)) {
        return reply(409, { error: 'This submission already belongs to another item. Finish it before starting a new one.' });
      }
      if (!entry) {
        if (submissions.size >= 1000) return reply(503, { error: 'The board has reached its submission limit. Finish pending items and restart the board.' });
        entry = { draft, progress: {} };
        submissions.set(input.requestId, entry);
      }
      entry.pending ??= items.create(draft, entry.progress);
      const result = await entry.pending;
      entry.pending = undefined;
      if (result.item && !entry.published) {
        board.showChanged(result.item);
        entry.published = true;
      }
      return withBoard(result.error ? 502 : 200, result);
    },

    queue: (itemId) => move(itemId, QUEUE),
    backToList: (itemId) => move(itemId, BACK_TO_LIST),
    pickStatus,

    start: (itemId, model, picked) => startOnce(starts, 'started', itemId, model, (listed, choice) => {
      if (listed.status !== 'Queued') return reply(409, { error: `Only Queued items can be started; this one is in ${listed.status}.` });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy });
      const item = startingItem(listed, picked);
      if ('body' in item) return item;
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      const message = workMessage(item);
      const repo = item.repo;
      return async () => {
        const repoProject = await projectOf(repo);
        if (repoProject.error !== undefined) return { thread: null, error: repoProject.error, refused: true };
        // The tag comes first, so an item that fails to take it starts nothing; the board never tags an item by itself.
        if (listed.untaggedFor) {
          const error = await items.addLabel(listed, repoTag(repo));
          if (error) return { thread: null, error };
          board.showChanged(item);
        }
        return startIn(repoProject.projectId, message, choice);
      };
    }),

    startBuild: (itemId, model) => startOnce(buildStarts, 'startedBuilds', itemId, model, (item, choice) => {
      if (item.status !== 'Ready') return reply(409, { error: `Only Ready items can start a build; this one is in ${item.status}.` });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy });
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      const message = buildMessage(item, larBuild());
      const previous = board.snapshot().startedBuilds?.[itemId];
      const retry = retryBuilds.has(itemId) || previous && Array.isArray(item.threads) && item.threads.some((t) => t.id === previous.threadId && t.state === 'stopped');
      const branch = `${buildBranch(item)}${retry ? `-retry-${randomUUID().slice(0, 8)}` : ''}`;
      const { repo } = item;
      return async () => {
        // A refusal comes before any write, so a build that can't start changes nothing on GitHub.
        const skills = await checkSkills?.();
        if (skills) return { thread: null, error: skills, refused: true };
        const repoProject = await projectOf(repo);
        if (repoProject.error !== undefined) return { thread: null, error: repoProject.error, refused: true };
        const parent = await parentInProgress(item);
        if (parent && 'error' in parent) return { thread: null, ...parent };
        if (!item.labels.includes('build')) {
          const error = await items.addLabel(item, 'build');
          if (error) return { thread: null, error };
          board.showChanged({ ...item, labels: [...item.labels, 'build'] });
        }
        const error = await parent?.move();
        if (error) return { thread: null, error };
        return startIn(repoProject.projectId, message, choice, { base: 'main', branch });
      };
    }),

    async abandon(itemId) {
      let pending = abandoning.get(itemId);
      if (!pending) {
        const item = board.find(itemId);
        // A second press after Abandon finished has nothing left to do.
        if (!item && board.removed(itemId)) return withBoard(200, { error: null });
        if (!item) return withBoard(404, { error: GONE });
        if (!canAbandon(item)) return reply(409, { error: `Only List and Queued items can be abandoned; this one is in ${item.status}.` });
        if (item.abandonRefusal) return reply(409, { error: item.abandonRefusal });
        const busy = busyReason(itemId, 'abandon');
        if (busy) return withBoard(409, { error: busy });
        const work = items.abandon(item).then((error) => {
          if (!error) board.remove(itemId);
          return error;
        });
        pending = track(abandoning, itemId, work);
      }
      const error = await pending;
      return withBoard(error ? 502 : 200, { error });
    },
  };
}
