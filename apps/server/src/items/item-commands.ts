// The commands the board's buttons send: add, queue, back to List, start, start build and abandon.
// The maps of commands in flight are private here, so every rule about which command
// blocks which lives in this file.

import { homedir } from 'node:os';
import { join } from 'node:path';
import { blockedText, buildBranch, buildMessage, canAbandon, isBuild, isDraft, validateDraft, workMessage } from '@lar-factory/shared';
import type { BoardData, CreationProgress, CreationResult, Item, ItemDraft, ModelChoice, ModelGroup, RepoConfig, StartResult, Status } from '@lar-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import { loadConfig } from '../config/config.ts';
import { issueLabels } from '../github/github.ts';
import { repositoryProject } from '../t3/repository-project.ts';
import type { RepositoryProject } from '../t3/repository-project.ts';
import { findModelChoice } from '../t3/model-choices.ts';
import { startThread } from '../t3/t3.ts';
import type { ItemSource } from './item-source.ts';

/** A command's answer: the HTTP status and the JSON body. */
export interface Reply {
  status: number;
  body: object;
}

export interface ItemCommands {
  /** Creates the issue a submission describes, once per request ID. */
  capture(input: Record<string, unknown>): Promise<Reply>;
  queue(itemId: string): Promise<Reply>;
  backToList(itemId: string): Promise<Reply>;
  /** Starts a T3 thread for a Queued item that nothing open blocks, at most once per board run. */
  start(itemId: string, model: unknown): Promise<Reply>;
  /**
   * Starts a Ready build's thread in a new worktree, at most once per board run, once nothing open blocks it, as
   * lar-work's step 5 does after Go: it adds the `build` label and moves a parent that isn't a build to In progress first.
   */
  startBuild(itemId: string, model: unknown): Promise<Reply>;
  abandon(itemId: string): Promise<Reply>;
}

export interface ItemCommandsDeps {
  board: BoardState;
  /** Where the commands write their changes. */
  items: ItemSource;
  /** The repositories config.json lists, which Add item may create in. */
  repos: RepoConfig[];
  /** Reads the model choices T3 offers now into the board data. */
  offerModelChoices(): ModelGroup[];
}

type Action = 'queue' | 'back to List' | 'start' | 'abandon';

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
/** What the item is, for Abandon's refusal. */
const aType = (item: Item) => (item.content === 'pr' ? 'a pull request' : isDraft(item) ? 'a draft' : 'an issue');

/** Keeps `work` in `inFlight` under `key` until it settles, or for good when `keep` says so. */
function track<T>(inFlight: Map<string, Promise<T>>, key: string, work: Promise<T>, keep: (result: T) => boolean = () => false): Promise<T> {
  const tracked = work.then((result) => {
    if (!keep(result)) inFlight.delete(key);
    return result;
  });
  inFlight.set(key, tracked);
  return tracked;
}

/** Where lar-work is installed, for the build message. */
const LAR_WORK = join(homedir(), '.agents/skills/lar-work');

/** The repository project from config.json as it is now, so a path fixed after a refusal works on the next Start. */
async function currentRepositoryProject(repo: string): Promise<RepositoryProject> {
  let repos;
  try { repos = loadConfig().repos; }
  catch (err) { return { error: `Can't read config.json: ${(err as Error).message}` }; }
  return repositoryProject(repo, repos);
}

export function createItemCommands({ board, items, repos, offerModelChoices }: ItemCommandsDeps): ItemCommands {
  const submissions = new Map<string, {
    draft: ItemDraft; progress: CreationProgress; pending?: Promise<CreationResult>; published?: boolean;
  }>();
  /** Starts by item id. A kept result is reused, so one item starts at most one thread per board run. */
  const starts = new Map<string, Promise<Start>>();
  /** Start builds by item id, kept like Starts, so an item started while Queued can still start its build. */
  const buildStarts = new Map<string, Promise<Start>>();
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

  /** Refuses a start while an issue the item is blocked by is open; Start after starts it once they close. */
  function blockedReply(item: Item): Reply | null {
    const blocked = blockedText(item);
    return blocked ? withBoard(409, { error: `${blocked}; use Start after to start it then.` }) : null;
  }

  /**
   * Runs a start at most once per item per board run, keyed in `runs`, on the model choice the
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
    if (!pending) {
      const item = board.find(itemId);
      if (!item) return reply(404, { error: GONE });
      const work = begin(item, choice);
      if (typeof work !== 'function') return work;
      // Only a refusal or a failure reported before or by t3 may run again; a started or unconfirmed thread is kept.
      pending = track(runs, itemId, work().then((result) => {
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
    const onBoard = board.snapshot().items.find((i) => i.content === 'ticket' && i.number === parent.number &&
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
    async capture(input) {
      if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
        return reply(400, { error: 'The submission needs a valid request ID.' });
      }
      let draft: ItemDraft;
      try { draft = validateDraft(input.draft, repos); }
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

    start: (itemId, model) => startOnce(starts, 'started', itemId, model, (item, choice) => {
      if (item.status !== 'Queued') return reply(409, { error: `Only Queued items can be started; this one is in ${item.status}.` });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy });
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      const message = workMessage(item);
      if (!message || !item.repo) return reply(409, { error: 'This item needs an issue before it can start.' });
      return async () => {
        const repoProject = await currentRepositoryProject(item.repo!);
        return repoProject.error === undefined ? startThread(repoProject.projectId, message, choice) : { thread: null, error: repoProject.error, refused: true };
      };
    }),

    startBuild: (itemId, model) => startOnce(buildStarts, 'startedBuilds', itemId, model, (item, choice) => {
      if (item.status !== 'Ready') return reply(409, { error: `Only Ready items can start a build; this one is in ${item.status}.` });
      const busy = busyReason(itemId, 'start');
      if (busy) return withBoard(409, { error: busy });
      const blocked = blockedReply(item);
      if (blocked) return blocked;
      const message = buildMessage(item, LAR_WORK);
      const branch = buildBranch(item);
      if (!message || !branch || !item.repo || item.number === null) return reply(409, { error: 'This item needs an issue before it can start.' });
      const { repo } = item;
      return async () => {
        // A refusal comes before any write, so a build that can't start changes nothing on GitHub.
        const repoProject = await currentRepositoryProject(repo);
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
        return startThread(repoProject.projectId, message, choice, { base: 'main', branch });
      };
    }),

    async abandon(itemId) {
      let pending = abandoning.get(itemId);
      if (!pending) {
        const item = board.find(itemId);
        // A second press after the delete finished has nothing left to do.
        if (!item && board.removed(itemId)) return withBoard(200, { error: null });
        if (!item) return withBoard(404, { error: GONE });
        if (!canAbandon(item)) return reply(409, { error: `Only List and Queued issues and drafts can be abandoned; this one is ${aType(item)} in ${item.status}.` });
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
