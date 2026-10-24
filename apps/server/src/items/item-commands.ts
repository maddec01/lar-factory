// The commands the board's buttons send: add, queue, back to List, start and abandon.
// The maps of commands in flight are private here, so every rule about which command
// blocks which lives in this file.

import { canAbandon, validateDraft, workMessage } from '@mux-factory/shared';
import type { ContentType, CreationProgress, CreationResult, ItemDraft, ModelChoice, ModelGroup, StartResult, Status } from '@mux-factory/shared';
import type { BoardState } from '../board/board-state.ts';
import { loadConfig } from '../config/config.ts';
import type { BoardConfig } from '../config/config.ts';
import { abandonItem, addProjectItem, setItemStatus } from '../github/github.ts';
import { repositoryProject } from '../t3/repository-project.ts';
import type { RepositoryProject } from '../t3/repository-project.ts';
import { findModelChoice } from '../t3/model-choices.ts';
import { startThread } from '../t3/t3.ts';

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
  /** Starts a T3 thread for a Queued item, at most once per board run. */
  start(itemId: string, model: unknown): Promise<Reply>;
  abandon(itemId: string): Promise<Reply>;
}

export interface ItemCommandsDeps {
  board: BoardState;
  /** The config, with the project number as found so far. */
  project(): BoardConfig;
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
const A_TYPE: Record<ContentType, string> = { Issue: 'an issue', PullRequest: 'a pull request', DraftIssue: 'a draft' };

/** Keeps `work` in `inFlight` under `key` until it settles, or for good when `keep` says so. */
function track<T>(inFlight: Map<string, Promise<T>>, key: string, work: Promise<T>, keep: (result: T) => boolean = () => false): Promise<T> {
  const tracked = work.then((result) => {
    if (!keep(result)) inFlight.delete(key);
    return result;
  });
  inFlight.set(key, tracked);
  return tracked;
}

/** The repository project from config.json as it is now, so a path fixed after a refusal works on the next Start. */
async function currentRepositoryProject(repo: string): Promise<RepositoryProject> {
  let repos;
  try { repos = loadConfig().repos; }
  catch (err) { return { error: `Can't read config.json: ${(err as Error).message}` }; }
  return repositoryProject(repo, repos);
}

export function createItemCommands({ board, project, offerModelChoices }: ItemCommandsDeps): ItemCommands {
  const submissions = new Map<string, {
    draft: ItemDraft; progress: CreationProgress; pending?: Promise<CreationResult>; published?: boolean;
  }>();
  /** Starts by item id. A kept result is reused, so one item starts at most one thread per board run. */
  const starts = new Map<string, Promise<Start>>();
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
    const busy = busyReason(itemId, action);
    if (busy) return withBoard(409, { error: busy });
    moving.add(itemId);
    const error = await setItemStatus(project(), itemId, to).finally(() => moving.delete(itemId));
    if (error) return withBoard(502, { error });
    board.showChanged({ ...item, status: to });
    return withBoard(200, { error: null });
  }

  return {
    async capture(input) {
      if (typeof input.requestId !== 'string' || !REQUEST_ID.test(input.requestId)) {
        return reply(400, { error: 'The submission needs a valid request ID.' });
      }
      let draft: ItemDraft;
      try { draft = validateDraft(input.draft, project().repos); }
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
      entry.pending ??= addProjectItem(project(), draft, entry.progress);
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

    async start(itemId, model) {
      // Only a choice the board offers right now reaches t3 as arguments.
      let choice: ModelChoice | undefined;
      if (model !== undefined) {
        const found = findModelChoice(offerModelChoices(), model);
        if (!found) return withBoard(422, { error: "That model choice isn't offered. Pick another one." });
        choice = found;
      }
      let pending = starts.get(itemId);
      if (!pending) {
        const item = board.find(itemId);
        if (!item) return reply(404, { error: GONE });
        if (item.status !== 'Queued') return reply(409, { error: `Only Queued items can be started; this one is in ${item.status}.` });
        const busy = busyReason(itemId, 'start');
        if (busy) return withBoard(409, { error: busy });
        const message = workMessage(item);
        if (!message || !item.repo) return reply(409, { error: 'This item needs an issue before it can start.' });
        const work = currentRepositoryProject(item.repo).then((repoProject): Promise<Start> | Start =>
          repoProject.error === undefined ? startThread(repoProject.projectId, message, choice) : { thread: null, error: repoProject.error, refused: true },
        ).then((result) => {
          if (result.thread) {
            board.update({ started: { ...board.snapshot().started, [itemId]: result.thread } });
            board.push();
          }
          return result;
        });
        // Only a refusal or a failure t3 reported may run again; a started or unconfirmed thread is kept.
        pending = track(starts, itemId, work, (result) => !!result.thread || !!result.uncertain);
      }
      const { refused, ...result } = await pending;
      return withBoard(refused ? 409 : result.error ? 502 : 200, result);
    },

    async abandon(itemId) {
      let pending = abandoning.get(itemId);
      if (!pending) {
        const item = board.find(itemId);
        // A second press after the delete finished has nothing left to do.
        if (!item && board.removed(itemId)) return withBoard(200, { error: null });
        if (!item) return withBoard(404, { error: GONE });
        if (!canAbandon(item)) return reply(409, { error: `Only List and Queued issues and drafts can be abandoned; this one is ${A_TYPE[item.type]} in ${item.status}.` });
        const busy = busyReason(itemId, 'abandon');
        if (busy) return withBoard(409, { error: busy });
        const work = abandonItem(project(), item).then((error) => {
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
